//! HTTP API: the deterministic pipeline exposed to the dashboard.
//!
//! The browser captures webcam frames, downscales them to grayscale, and
//! POSTs the raw samples here. All detection, tracking, and gating happens
//! in this Rust process — the frontend only renders what it is told.

use crate::config::EngineConfig;
use crate::engine::{Engine, FrameOutcome};
use crate::identify::{self, SharedRegistry};
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

/// Health/identity payload.
#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
    /// Names of the pipeline stages, in the only order they can execute.
    stages: [&'static str; 6],
}

/// Build the router.
///
/// Frame processing and identity are separate sub-routers because they hold
/// different state: per-camera pipeline state versus the identity registry.
/// `gateway_url` is where network cameras POST classify requests on a
/// trigger — see [`crate::rtsp`].
pub fn router(engine: SharedEngine, registry: SharedRegistry, gateway_url: String) -> Router {
    let rtsp = crate::rtsp::router(engine.clone(), gateway_url);

    let frames = Router::new()
        .route("/health", get(health))
        .route("/api/frame", post(ingest_frame))
        .route("/api/config", get(get_config).post(set_config))
        .with_state(engine);

    let identities = Router::new()
        .route("/api/identify", post(identify::identify))
        .route("/api/identities", get(identify::list_identities))
        .route("/api/identities/name", post(identify::name_identity))
        .with_state(registry);

    frames
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
        ],
    })
}

/// Ingest one frame and return everything the pipeline concluded about it.
///
/// A poisoned engine mutex is reported as a failed outcome rather than
/// panicking the server — a stuck camera must not take the process down.
async fn ingest_frame(
    State(engine): State<SharedEngine>,
    Json(req): Json<FrameRequest>,
) -> Json<FrameOutcome> {
    let mut guard = match engine.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    Json(guard.process(req))
}

/// Read the thresholds currently in force.
async fn get_config(State(engine): State<SharedEngine>) -> Json<EngineConfig> {
    let guard = match engine.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    Json(guard.config())
}

/// Apply new thresholds. Returns what was actually applied after clamping,
/// so the caller's sliders can snap to the accepted value.
async fn set_config(
    State(engine): State<SharedEngine>,
    Json(config): Json<EngineConfig>,
) -> Json<EngineConfig> {
    let mut guard = match engine.lock() {
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

    fn engine() -> SharedEngine {
        Arc::new(Mutex::new(Engine::new()))
    }

    #[tokio::test]
    async fn health_lists_the_pipeline_stages() {
        let Json(h) = health().await;
        assert_eq!(h.status, "ok");
        assert_eq!(h.stages[0], "frame_validator");
        assert_eq!(h.stages[5], "trigger_gate");
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
        let Json(out) = ingest_frame(State(engine()), Json(req)).await;
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
        let Json(out) = ingest_frame(State(engine()), Json(req)).await;
        assert!(out.rejected_reason.is_some());
    }
}
