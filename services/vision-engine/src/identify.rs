//! Identity endpoints: who a classified object is.
//!
//! The orchestrator supplies attributes a vision model observed; the
//! matching itself happens here in deterministic Rust so "is this the same
//! dog" can be replayed and audited. The model never gets a vote.

use axum::{extract::State, Json};
use chrono::Utc;
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
}

/// Wire form of a descriptor.
#[derive(Debug, Deserialize, Serialize)]
pub struct DescriptorDto {
    /// Attribute name.
    pub key: String,
    /// Observed value.
    pub value: String,
}

/// Request to name an identity discovered automatically.
#[derive(Debug, Deserialize)]
pub struct NameRequest {
    /// Identity to name.
    pub identity_id: Uuid,
    /// Name to assign.
    pub name: String,
}

/// Listing of known identities.
#[derive(Debug, Serialize)]
pub struct IdentityListing {
    /// Everything the registry remembers.
    pub identities: Vec<Identity>,
}

/// Take a lock, recovering rather than panicking if it was poisoned.
fn lock(registry: &SharedRegistry) -> std::sync::MutexGuard<'_, Registry> {
    match registry.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Attribute a sighting to a known identity, or record a new one.
pub async fn identify(
    State(registry): State<SharedRegistry>,
    Json(req): Json<IdentifyRequest>,
) -> Json<IdentificationOutcome> {
    let sighting = Sighting {
        class: req.class,
        descriptors: req
            .descriptors
            .iter()
            .map(|d| Descriptor::new(&d.key, &d.value))
            .collect(),
        camera_id: req.camera_id,
        at: Utc::now(),
    };
    Json(lock(&registry).observe(&sighting))
}

/// List everything the registry remembers.
pub async fn list_identities(State(registry): State<SharedRegistry>) -> Json<IdentityListing> {
    let guard = lock(&registry);
    Json(IdentityListing {
        identities: guard.all().into_iter().cloned().collect(),
    })
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
        assert_eq!(listing.identities[0].name.as_deref(), Some("Mochi"));
    }
}
