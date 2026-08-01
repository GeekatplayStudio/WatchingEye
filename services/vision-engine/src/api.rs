//! HTTP API: the deterministic pipeline exposed to the dashboard.
//!
//! The browser captures webcam frames, downscales them to grayscale, and
//! POSTs the raw samples here. All detection, tracking, and gating happens
//! in this Rust process — the frontend only renders what it is told.

use crate::config::EngineConfig;
use crate::engine::{Engine, FrameOutcome};
use crate::identify::{self, IdentityState};
use crate::notify::Notifier;
use crate::zone_rules::PendingNotify;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// One frame submitted by a camera client.
#[derive(Debug, Deserialize)]
pub struct FrameRequest {
    /// Camera this frame came from.
    pub camera_id: String,
    /// Sample grid width.
    pub width: u32,
    /// Sample grid height.
    pub height: u32,
    /// Row-major grayscale samples, one byte each.
    pub samples: Vec<u8>,
    /// Seconds since the client's previous frame. Drives servo rate limiting,
    /// so it must reflect real elapsed time rather than a nominal frame rate.
    #[serde(default)]
    pub dt_secs: Option<f32>,
    /// Optional target point [x, y] in normalized coordinates [0.0, 1.0] for Point Cross Assign.
    #[serde(default)]
    pub pinned_target: Option<[f32; 2]>,
}

/// Engine state shared across requests.
pub type SharedEngine = Arc<Mutex<Engine>>;

/// Webhook notifier shared across frame ingest paths.
pub type SharedNotifier = Arc<Notifier>;

/// Frame pipeline + async notify delivery.
#[derive(Clone)]
pub struct FrameState {
    /// Live motion/track/zone engine.
    pub engine: SharedEngine,
    /// Channel→URL webhook delivery (never blocks the motion path).
    pub notifier: SharedNotifier,
}

/// Spawn webhook delivery for each pending rule action. Safe to call from
/// any Tokio task; never panics.
pub fn flush_notifies(notifier: &SharedNotifier, pending: Vec<PendingNotify>) {
    for item in pending {
        notifier.dispatch_spawn(item.action, item.payload);
    }
}

/// Run one frame through the engine and kick off any notify webhooks.
pub fn process_frame(state: &FrameState, req: FrameRequest) -> FrameOutcome {
    let mut outcome = {
        let mut guard = match state.engine.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.process(req)
    };
    let pending = std::mem::take(&mut outcome.pending_notifies);
    flush_notifies(&state.notifier, pending);
    outcome
}

/// Health/identity payload.
#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
    /// Names of the pipeline stages, in the only order they can execute.
    stages: [&'static str; 8],
}

/// Build the router.
///
/// Frame processing and identity are separate sub-routers because they hold
/// different state: per-camera pipeline state versus the identity registry
/// (and its durable store). `gateway_url` is where network cameras POST
/// classify requests on a trigger — see [`crate::rtsp`].
pub fn router(frames: FrameState, identity_state: IdentityState, gateway_url: String) -> Router {
    let rtsp = crate::rtsp::router(frames.clone(), gateway_url);

    let frame_routes = Router::new()
        .route("/health", get(health))
        .route("/api/frame", post(ingest_frame))
        .route("/api/config", get(get_config).post(set_config))
        .with_state(frames);

    let identities = Router::new()
        .route("/api/identify", post(identify::identify))
        .route("/api/identify/batch", post(identify::identify_batch))
        .route("/api/identities", get(identify::list_identities))
        .route("/api/identities/name", post(identify::name_identity))
        .route("/api/identities/{id}", get(identify::get_identity))
        .route("/api/identities/{id}/timeline", get(identify::get_timeline))
        .with_state(identity_state);

    frame_routes
        .merge(identities)
        .merge(crate::cameras_api::router())
        .merge(rtsp)
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        service: "vision-engine",
        stages: [
            "frame_validator",
            "motion_detection",
            "blob_extraction",
            "tracking",
            "temporal_validation",
            "trigger_gate",
            "zones",
            "rules_notify",
        ],
    })
}

/// Ingest one frame and return everything the pipeline concluded about it.
///
/// A poisoned engine mutex is reported as a failed outcome rather than
/// panicking the server — a stuck camera must not take the process down.
/// Notify webhooks are spawned asynchronously and do not delay the response.
async fn ingest_frame(
    State(state): State<FrameState>,
    Json(req): Json<FrameRequest>,
) -> Json<FrameOutcome> {
    Json(process_frame(&state, req))
}

/// Read the thresholds currently in force.
async fn get_config(State(state): State<FrameState>) -> Json<EngineConfig> {
    let guard = match state.engine.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    Json(guard.config())
}

/// Apply new thresholds. Returns what was actually applied after clamping,
/// so the caller's sliders can snap to the accepted value.
async fn set_config(
    State(state): State<FrameState>,
    Json(config): Json<EngineConfig>,
) -> Json<EngineConfig> {
    let mut guard = match state.engine.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    Json(guard.set_config(config))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use crate::engine::Engine;
    use std::collections::HashMap;

    fn frame_state() -> FrameState {
        FrameState {
            engine: Arc::new(Mutex::new(Engine::new())),
            notifier: Arc::new(Notifier::from_channels(HashMap::new()).unwrap()),
        }
    }

    #[tokio::test]
    async fn health_lists_the_pipeline_stages() {
        let Json(h) = health().await;
        assert_eq!(h.status, "ok");
        assert_eq!(h.stages[0], "frame_validator");
        assert_eq!(h.stages[5], "trigger_gate");
        assert_eq!(h.stages[6], "zones");
        assert_eq!(h.stages[7], "rules_notify");
    }

    #[tokio::test]
    async fn first_frame_reports_no_motion() {
        let req = FrameRequest {
            camera_id: "test".into(),
            width: 4,
            height: 4,
            samples: vec![10; 16],
            dt_secs: Some(0.1),
            pinned_target: None,
        };
        let Json(out) = ingest_frame(State(frame_state()), Json(req)).await;
        assert!(!out.motion);
        assert!(out.regions.is_empty());
    }

    #[tokio::test]
    async fn a_mismatched_sample_count_is_rejected() {
        let req = FrameRequest {
            camera_id: "test".into(),
            width: 4,
            height: 4,
            samples: vec![10; 5],
            dt_secs: Some(0.1),
            pinned_target: None,
        };
        let Json(out) = ingest_frame(State(frame_state()), Json(req)).await;
        assert!(out.rejected_reason.is_some());
    }
}
