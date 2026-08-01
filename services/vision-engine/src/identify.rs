//! Identity endpoints: who a classified object is.
//!
//! The orchestrator supplies attributes a vision model observed; the
//! matching itself happens here in deterministic Rust so "is this the same
//! dog" can be replayed and audited. The model never gets a vote.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{extract::State, Json};
use chrono::Utc;
use identity::appearance::AppearanceVec;
use identity::descriptor::Descriptor;
use identity::{IdentificationOutcome, Identity, Registry, Sighting};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Shared identity registry.
pub type SharedRegistry = Arc<Mutex<Registry>>;

/// Request to identify one classified sighting.
#[derive(Debug, Deserialize)]
pub struct IdentifyRequest {
    /// Class the pipeline established, e.g. `"dog"`.
    pub class: String,
    /// Attributes observed, as `key`/`value` pairs.
    pub descriptors: Vec<DescriptorDto>,
    /// Camera that saw it.
    pub camera_id: String,
    /// Optional appearance embedding.
    #[serde(default)]
    pub appearance: Option<AppearanceDto>,
}

/// Wire form of a descriptor.
#[derive(Debug, Deserialize, Serialize)]
pub struct DescriptorDto {
    /// Attribute name.
    pub key: String,
    /// Observed value.
    pub value: String,
}

/// Wire form of an appearance embedding.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AppearanceDto {
    /// Model that produced the embedding.
    pub model: String,
    /// Embedding components.
    pub values: Vec<f32>,
}

/// Request to identify many classified sightings in one global pass.
///
/// See [`crate::identify::identify_batch`] and
/// [`identity::Registry::observe_batch`] for why this exists: sightings
/// submitted together are resolved with a collision-free global assignment
/// instead of one-at-a-time greedy matching.
#[derive(Debug, Deserialize)]
pub struct IdentifyBatchRequest {
    /// Sightings to attribute together, in detection order.
    pub sightings: Vec<IdentifyRequest>,
}

/// Outcomes for a batch identify call, in the same order as the request.
#[derive(Debug, Serialize)]
pub struct IdentifyBatchResponse {
    /// One outcome per input sighting, same order as submitted.
    pub outcomes: Vec<IdentificationOutcome>,
}

/// Request to name an identity discovered automatically.
#[derive(Debug, Deserialize)]
pub struct NameRequest {
    /// Identity to name.
    pub identity_id: Uuid,
    /// Name to assign.
    pub name: String,
}

/// An identity plus the cross-camera summary derived from its memory.
///
/// [`Identity::cameras_seen`] and [`Identity::is_multi_camera`] are methods
/// rather than stored fields, so this DTO computes them once for the wire
/// instead of asking every client to re-derive them from raw memory.
#[derive(Debug, Serialize)]
pub struct IdentitySummary {
    /// The identity and its full history.
    #[serde(flatten)]
    pub identity: Identity,
    /// Distinct cameras this identity has been seen on, sorted.
    pub cameras_seen: Vec<String>,
    /// True when `cameras_seen` has more than one camera.
    pub multi_camera: bool,
}

impl From<Identity> for IdentitySummary {
    fn from(identity: Identity) -> Self {
        let cameras_seen = identity.cameras_seen();
        let multi_camera = identity.is_multi_camera();
        Self {
            identity,
            cameras_seen,
            multi_camera,
        }
    }
}

/// Listing of known identities.
#[derive(Debug, Serialize)]
pub struct IdentityListing {
    /// Everything the registry remembers, newest-seen first.
    pub identities: Vec<IdentitySummary>,
}

/// Take a lock, recovering rather than panicking if it was poisoned.
fn lock(registry: &SharedRegistry) -> std::sync::MutexGuard<'_, Registry> {
    match registry.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Turn a wire-form request into the `Sighting` the registry expects,
/// stamping the current time as the observation moment.
fn to_sighting(req: IdentifyRequest) -> Sighting {
    Sighting {
        class: req.class,
        descriptors: req
            .descriptors
            .iter()
            .map(|d| Descriptor::new(&d.key, &d.value))
            .collect(),
        camera_id: req.camera_id,
        at: Utc::now(),
        appearance: req.appearance.map(|a| AppearanceVec {
            model: a.model,
            values: a.values,
        }),
    }
}

/// Attribute a sighting to a known identity, or record a new one.
pub async fn identify(
    State(registry): State<SharedRegistry>,
    Json(req): Json<IdentifyRequest>,
) -> Json<IdentificationOutcome> {
    let sighting = to_sighting(req);
    Json(lock(&registry).observe(&sighting))
}

/// Attribute many sightings in one global pass, so two detections in the
/// same batch can never be assigned to the same identity.
///
/// See [`identity::Registry::observe_batch`] for the Hungarian assignment
/// this delegates to.
pub async fn identify_batch(
    State(registry): State<SharedRegistry>,
    Json(req): Json<IdentifyBatchRequest>,
) -> Json<IdentifyBatchResponse> {
    let sightings: Vec<Sighting> = req.sightings.into_iter().map(to_sighting).collect();
    let outcomes = lock(&registry).observe_batch(&sightings);
    Json(IdentifyBatchResponse { outcomes })
}

/// List everything the registry remembers.
pub async fn list_identities(State(registry): State<SharedRegistry>) -> Json<IdentityListing> {
    let guard = lock(&registry);
    Json(IdentityListing {
        identities: guard
            .all()
            .into_iter()
            .cloned()
            .map(IdentitySummary::from)
            .collect(),
    })
}

/// Look up one identity's full cross-camera timeline.
///
/// Returns `404` with a JSON error body when the id is unknown, rather than
/// an empty success, so callers can distinguish "no such identity" from
/// "identity with no history".
pub async fn get_identity(
    State(registry): State<SharedRegistry>,
    Path(id): Path<Uuid>,
) -> Response {
    let guard = lock(&registry);
    match guard.get(id) {
        Some(identity) => Json(IdentitySummary::from(identity.clone())).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "no such identity" })),
        )
            .into_response(),
    }
}

/// Give a name to an auto-discovered identity.
pub async fn name_identity(
    State(registry): State<SharedRegistry>,
    Json(req): Json<NameRequest>,
) -> Json<serde_json::Value> {
    let renamed = lock(&registry).name_identity(req.identity_id, &req.name);
    Json(serde_json::json!({ "ok": renamed }))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn registry() -> SharedRegistry {
        Arc::new(Mutex::new(Registry::new()))
    }

    fn request(class: &str, pairs: &[(&str, &str)]) -> IdentifyRequest {
        IdentifyRequest {
            class: class.into(),
            descriptors: pairs
                .iter()
                .map(|(k, v)| DescriptorDto {
                    key: (*k).into(),
                    value: (*v).into(),
                })
                .collect(),
            camera_id: "webcam".into(),
            appearance: None,
        }
    }

    fn request_with_appearance(
        class: &str,
        pairs: &[(&str, &str)],
        appearance: AppearanceDto,
    ) -> IdentifyRequest {
        IdentifyRequest {
            class: class.into(),
            descriptors: pairs
                .iter()
                .map(|(k, v)| DescriptorDto {
                    key: (*k).into(),
                    value: (*v).into(),
                })
                .collect(),
            camera_id: "webcam".into(),
            appearance: Some(appearance),
        }
    }

    #[tokio::test]
    async fn first_sighting_creates_an_identity() {
        let r = registry();
        let Json(out) = identify(State(r), Json(request("dog", &[("fur_color", "brown")]))).await;
        assert!(out.is_new);
    }

    #[tokio::test]
    async fn the_same_object_is_recognised_on_return() {
        let r = registry();
        let Json(first) = identify(
            State(Arc::clone(&r)),
            Json(request("car", &[("license_plate", "123ABC")])),
        )
        .await;
        let Json(second) = identify(
            State(Arc::clone(&r)),
            Json(request("car", &[("license_plate", "123ABC")])),
        )
        .await;
        assert_eq!(first.identity_id, second.identity_id);
        assert_eq!(second.sightings, 2);
    }

    #[tokio::test]
    async fn naming_then_listing_shows_the_name() {
        let r = registry();
        let Json(out) = identify(
            State(Arc::clone(&r)),
            Json(request("dog", &[("breed", "shiba")])),
        )
        .await;
        let Json(res) = name_identity(
            State(Arc::clone(&r)),
            Json(NameRequest {
                identity_id: out.identity_id,
                name: "Mochi".into(),
            }),
        )
        .await;
        assert_eq!(res["ok"], true);

        let Json(listing) = list_identities(State(r)).await;
        assert_eq!(
            listing.identities[0].identity.name.as_deref(),
            Some("Mochi")
        );
    }

    #[tokio::test]
    async fn same_appearance_embedding_without_descriptors_matches() {
        let r = registry();
        let embed = AppearanceDto {
            model: "clip".into(),
            values: vec![1.0, 0.0, 0.0],
        };
        let Json(first) = identify(
            State(Arc::clone(&r)),
            Json(request_with_appearance("person", &[], embed.clone())),
        )
        .await;
        let Json(second) = identify(
            State(r),
            Json(request_with_appearance("person", &[], embed)),
        )
        .await;
        assert_eq!(first.identity_id, second.identity_id);
        assert_eq!(second.sightings, 2);
    }

    #[tokio::test]
    async fn batch_assigns_two_sightings_to_two_distinct_identities() {
        let r = registry();
        // Enroll by observing two distinguishable individuals first.
        let Json(first) = identify(
            State(Arc::clone(&r)),
            Json(request("dog", &[("breed", "shiba")])),
        )
        .await;
        let Json(second) = identify(
            State(Arc::clone(&r)),
            Json(request("dog", &[("breed", "labrador")])),
        )
        .await;

        let Json(batch) = identify_batch(
            State(Arc::clone(&r)),
            Json(IdentifyBatchRequest {
                sightings: vec![
                    request("dog", &[("breed", "labrador")]),
                    request("dog", &[("breed", "shiba")]),
                ],
            }),
        )
        .await;

        assert_eq!(batch.outcomes.len(), 2);
        assert_eq!(batch.outcomes[0].identity_id, second.identity_id);
        assert_eq!(batch.outcomes[1].identity_id, first.identity_id);
        assert_ne!(
            batch.outcomes[0].identity_id, batch.outcomes[1].identity_id,
            "two sightings in one batch must not collide on one identity"
        );
    }

    #[tokio::test]
    async fn batch_with_no_sightings_returns_no_outcomes() {
        let Json(batch) = identify_batch(
            State(registry()),
            Json(IdentifyBatchRequest { sightings: vec![] }),
        )
        .await;
        assert!(batch.outcomes.is_empty());
    }

    #[tokio::test]
    async fn batch_of_one_creates_a_new_identity_like_the_single_endpoint() {
        let Json(batch) = identify_batch(
            State(registry()),
            Json(IdentifyBatchRequest {
                sightings: vec![request("cat", &[("fur_color", "black")])],
            }),
        )
        .await;
        assert_eq!(batch.outcomes.len(), 1);
        assert!(batch.outcomes[0].is_new);
    }

    fn request_on_camera(class: &str, pairs: &[(&str, &str)], camera_id: &str) -> IdentifyRequest {
        IdentifyRequest {
            class: class.into(),
            descriptors: pairs
                .iter()
                .map(|(k, v)| DescriptorDto {
                    key: (*k).into(),
                    value: (*v).into(),
                })
                .collect(),
            camera_id: camera_id.into(),
            appearance: None,
        }
    }

    #[tokio::test]
    async fn get_identity_returns_404_for_an_unknown_id() {
        let res = get_identity(State(registry()), Path(Uuid::new_v4())).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn get_identity_returns_the_full_timeline_for_a_known_id() {
        let r = registry();
        let Json(out) = identify(
            State(Arc::clone(&r)),
            Json(request("dog", &[("breed", "shiba")])),
        )
        .await;
        let res = get_identity(State(r), Path(out.identity_id)).await;
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_sighting_on_two_cameras_stays_one_identity_and_is_flagged_multi_camera() {
        let r = registry();
        let Json(first) = identify(
            State(Arc::clone(&r)),
            Json(request_on_camera(
                "car",
                &[("license_plate", "123ABC")],
                "front",
            )),
        )
        .await;
        assert!(!first.crossed_camera);
        assert_eq!(first.cameras_seen, vec!["front".to_string()]);

        let Json(second) = identify(
            State(Arc::clone(&r)),
            Json(request_on_camera(
                "car",
                &[("license_plate", "123ABC")],
                "backyard",
            )),
        )
        .await;
        assert_eq!(second.identity_id, first.identity_id);
        assert!(second.crossed_camera);
        assert_eq!(
            second.cameras_seen,
            vec!["backyard".to_string(), "front".to_string()]
        );

        let Json(listing) = list_identities(State(Arc::clone(&r))).await;
        let summary = listing
            .identities
            .iter()
            .find(|s| s.identity.id == first.identity_id)
            .expect("identity must be listed");
        assert!(summary.multi_camera);
        assert_eq!(
            summary.cameras_seen,
            vec!["backyard".to_string(), "front".to_string()]
        );
    }
}
