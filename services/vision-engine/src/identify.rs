//! Identity endpoints: who a classified object is.
//!
//! The orchestrator supplies attributes a vision model observed; the
//! matching itself happens here in deterministic Rust so "is this the same
//! dog" can be replayed and audited. The model never gets a vote.

use crate::identity_store::IdentityStore;
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
use tracing::warn;
use uuid::Uuid;

/// Shared identity registry.
pub type SharedRegistry = Arc<Mutex<Registry>>;

/// Shared durable store, written to after every mutation to the registry.
pub type SharedStore = Arc<IdentityStore>;

/// Axum state for the identity routes: the in-memory [`Registry`] that does
/// all matching, plus the durable [`IdentityStore`] every mutation is saved
/// to. Cheap to clone — both fields are `Arc`s.
#[derive(Clone)]
pub struct IdentityState {
    /// In-memory matching state, guarded by a mutex.
    pub registry: SharedRegistry,
    /// Durable backing store.
    pub store: SharedStore,
}

/// Persist whichever identity a sighting touched.
///
/// A failed write is logged and otherwise swallowed: durability is best
/// effort, and a store outage must not make the (already-decided) in-memory
/// match fail or roll back.
fn persist(state: &IdentityState, id: Uuid) {
    let snapshot = lock(&state.registry).get(id).cloned();
    let Some(identity) = snapshot else {
        return;
    };
    if let Err(err) = state.store.save_identity(&identity) {
        warn!(%err, identity_id = %id, "failed to persist identity");
    }
}

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
///
/// The touched identity is persisted to the durable store before the
/// response is returned, so a restart immediately after this call resumes
/// with the sighting already applied.
pub async fn identify(
    State(state): State<IdentityState>,
    Json(req): Json<IdentifyRequest>,
) -> Json<IdentificationOutcome> {
    let sighting = to_sighting(req);
    let outcome = lock(&state.registry).observe(&sighting);
    persist(&state, outcome.identity_id);
    Json(outcome)
}

/// Attribute many sightings in one global pass, so two detections in the
/// same batch can never be assigned to the same identity.
///
/// See [`identity::Registry::observe_batch`] for the Hungarian assignment
/// this delegates to. Every identity touched by the batch is persisted.
pub async fn identify_batch(
    State(state): State<IdentityState>,
    Json(req): Json<IdentifyBatchRequest>,
) -> Json<IdentifyBatchResponse> {
    let sightings: Vec<Sighting> = req.sightings.into_iter().map(to_sighting).collect();
    let outcomes = lock(&state.registry).observe_batch(&sightings);
    let mut persisted: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    for outcome in &outcomes {
        if persisted.insert(outcome.identity_id) {
            persist(&state, outcome.identity_id);
        }
    }
    Json(IdentifyBatchResponse { outcomes })
}

/// List everything the registry remembers.
pub async fn list_identities(State(state): State<IdentityState>) -> Json<IdentityListing> {
    let guard = lock(&state.registry);
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
pub async fn get_identity(State(state): State<IdentityState>, Path(id): Path<Uuid>) -> Response {
    let guard = lock(&state.registry);
    match guard.get(id) {
        Some(identity) => Json(IdentitySummary::from(identity.clone())).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "no such identity" })),
        )
            .into_response(),
    }
}

/// Read one identity's chronological history straight from the durable
/// store (see [`IdentityStore::timeline`]), independent of whatever the
/// in-memory registry currently holds.
///
/// Returns an empty list — never an error response — for an unknown id or a
/// read failure, since "no history" and "unknown id" both mean there is
/// nothing to show a caller.
pub async fn get_timeline(
    State(state): State<IdentityState>,
    Path(id): Path<Uuid>,
) -> Json<Vec<identity::MemoryEntry>> {
    match state.store.timeline(id) {
        Ok(entries) => Json(entries),
        Err(err) => {
            warn!(%err, identity_id = %id, "failed to read persisted timeline");
            Json(Vec::new())
        }
    }
}

/// Give a name to an auto-discovered identity.
pub async fn name_identity(
    State(state): State<IdentityState>,
    Json(req): Json<NameRequest>,
) -> Json<serde_json::Value> {
    let renamed = lock(&state.registry).name_identity(req.identity_id, &req.name);
    if renamed {
        persist(&state, req.identity_id);
    }
    Json(serde_json::json!({ "ok": renamed }))
}

// HTTP handler tests live in `identify_tests.rs` to keep this file within
// the workspace's per-file line budget now that persistence is wired in.
#[cfg(test)]
#[path = "identify_tests.rs"]
mod tests;
