//! RTSP camera ingestion: the same deterministic pipeline the browser
//! webcam drives, fed by a network camera instead.
//!
//! The browser's capture loop (`use-webcam-pipeline.ts`) downsamples frames
//! to a small grayscale grid, POSTs them to `/api/frame`, and on a trigger
//! POSTs a full-colour snapshot to the gateway's `/api/classify`. This
//! module is that same protocol running server-side against an RTSP URL
//! instead of `getUserMedia` — the engine cannot tell the difference, so
//! motion, tracking, gating, and Point Cross Assign all work unchanged.
//!
//! Decoding is delegated to `ffmpeg` as a subprocess rather than an
//! embedded decoder: RTSP/RTP/H.264 is a large surface to get right, ffmpeg
//! already handles it correctly, and it is already a dependency of this
//! project's toolchain.

use crate::api::FrameState;
use crate::camera_store::{CameraRecord, CameraStore};
use crate::cameras_api::{base64, fail};
use crate::engine::FrameOutcome;
use crate::rtsp_capture;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::{info, warn};

/// Sample grid sent into the engine. Matches the browser's `GRID_WIDTH`/
/// `GRID_HEIGHT` in `use-webcam-pipeline.ts`.
pub(crate) const GRID_WIDTH: u32 = 96;
/// See [`GRID_WIDTH`].
pub(crate) const GRID_HEIGHT: u32 = 72;

/// One camera's ffmpeg process and the credentials needed to reconnect it.
struct CameraTask {
    handle: JoinHandle<()>,
    /// The RTSP URL with any credentials removed, safe to hand back over
    /// the API or write to logs.
    redacted_url: String,
}

/// The last frame decoded from a camera, held for the dashboard to poll.
#[derive(Clone)]
pub(crate) struct LatestFrame {
    pub(crate) outcome: FrameOutcome,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) samples: Vec<u8>,
}

/// Shared state for the RTSP router.
#[derive(Clone)]
pub(crate) struct RtspState {
    pub(crate) frames: FrameState,
    tasks: Arc<Mutex<HashMap<String, CameraTask>>>,
    pub(crate) latest: Arc<Mutex<HashMap<String, LatestFrame>>>,
    /// Base URL of the gateway, for posting classify requests on a trigger.
    pub(crate) gateway_url: String,
    /// Durable camera config (restart restore).
    store: Arc<CameraStore>,
    /// Shared HTTP client for posting classify requests.
    pub(crate) http_client: reqwest::Client,
    /// Concurrency semaphore capping parallel ffmpeg snapshot processes (max 3).
    pub(crate) snapshot_semaphore: Arc<tokio::sync::Semaphore>,
}

impl RtspState {
    /// Drop a finished capture task from the connected map (stream ended).
    pub(crate) fn forget_task(&self, camera_id: &str) {
        lock(&self.tasks).remove(camera_id);
    }
}

/// Build the router. `gateway_url` is where triggered objects get `POST`ed
/// for classification — the same endpoint the browser's capture loop calls.
///
/// Enabled cameras from `store` are re-spawned immediately so a restart
/// resumes prior RTSP ingest without rediscovering.
pub fn router(frames: FrameState, gateway_url: String, store: Arc<CameraStore>) -> Router {
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let state = RtspState {
        frames,
        tasks: Arc::new(Mutex::new(HashMap::new())),
        latest: Arc::new(Mutex::new(HashMap::new())),
        gateway_url,
        store,
        http_client,
        snapshot_semaphore: Arc::new(tokio::sync::Semaphore::new(3)),
    };
    restore_enabled(&state);
    Router::new()
        .route("/api/cameras/rtsp/connect", post(connect))
        .route("/api/cameras/rtsp/disconnect", post(disconnect))
        .route("/api/cameras/rtsp/status", get(status))
        .route("/api/cameras/rtsp/{camera_id}/latest", get(latest))
        .with_state(state)
}

/// Re-spawn ffmpeg loops for every enabled row in the camera store.
fn restore_enabled(state: &RtspState) {
    let cameras = match state.store.list_enabled() {
        Ok(rows) => rows,
        Err(err) => {
            warn!(%err, "could not load saved cameras; starting with none");
            return;
        }
    };
    for cam in cameras {
        info!(
            camera_id = %cam.camera_id,
            url = %cam.url_redacted,
            "restoring saved RTSP camera"
        );
        start_camera(state, cam.camera_id, cam.url, false);
    }
}

/// Start (or replace) a capture task; optionally persist to the store.
fn start_camera(state: &RtspState, camera_id: String, url: String, persist: bool) {
    stop_task(state, &camera_id);
    let redacted_url = redact_rtsp_url(&url);
    if persist {
        let record = CameraRecord {
            camera_id: camera_id.clone(),
            url: url.clone(),
            url_redacted: redacted_url.clone(),
            enabled: true,
            updated_at: Utc::now(),
        };
        if let Err(err) = state.store.upsert(&record) {
            warn!(camera_id = %camera_id, %err, "failed to persist camera config");
        }
    }
    let handle = tokio::spawn(rtsp_capture::capture_loop(
        state.clone(),
        camera_id.clone(),
        url,
    ));
    lock(&state.tasks).insert(
        camera_id,
        CameraTask {
            handle,
            redacted_url,
        },
    );
}

/// Take the lock, surviving a poisoned mutex — one camera task panicking
/// must not disable the others.
pub(crate) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Remove the `user:password@` portion of an RTSP URL.
///
/// @example
/// ```ignore
/// redact_rtsp_url("rtsp://admin:secret@192.168.1.50:554/h264")
///     == "rtsp://192.168.1.50:554/h264"
/// ```
fn redact_rtsp_url(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_owned();
    };
    match rest.split_once('@') {
        Some((_, after)) => format!("{scheme}://{after}"),
        None => url.to_owned(),
    }
}

/// Request to start ingesting a camera.
#[derive(Debug, Deserialize)]
struct ConnectRequest {
    /// Stable id for this camera within the pipeline, e.g. `"nvr-ch1"`.
    camera_id: String,
    /// Full RTSP URL, credentials included if the stream needs them.
    url: String,
}

/// Connect a camera, replacing any existing connection under the same id.
async fn connect(State(state): State<RtspState>, Json(req): Json<ConnectRequest>) -> Response {
    if req.camera_id.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "camera_id is required");
    }
    if req.url.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "url is required");
    }

    start_camera(&state, req.camera_id.clone(), req.url.clone(), true);

    info!(camera_id = %req.camera_id, url = %redact_rtsp_url(&req.url), "rtsp camera connecting");
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "camera_id": req.camera_id })),
    )
        .into_response()
}

fn stop_task(state: &RtspState, camera_id: &str) {
    if let Some(existing) = lock(&state.tasks).remove(camera_id) {
        existing.handle.abort();
    }
}

/// Request to stop ingesting a camera.
#[derive(Debug, Deserialize)]
struct DisconnectRequest {
    camera_id: String,
}

async fn disconnect(
    State(state): State<RtspState>,
    Json(req): Json<DisconnectRequest>,
) -> Response {
    let existed = lock(&state.tasks).contains_key(&req.camera_id);
    stop_task(&state, &req.camera_id);
    lock(&state.latest).remove(&req.camera_id);
    if let Err(err) = state.store.remove(&req.camera_id) {
        warn!(camera_id = %req.camera_id, %err, "failed to remove saved camera");
    }
    if existed {
        (StatusCode::OK, Json(serde_json::json!({ "stopped": true }))).into_response()
    } else {
        fail(StatusCode::NOT_FOUND, "no camera connected under that id")
    }
}

/// One camera's connection state, for the status list.
#[derive(Debug, Serialize)]
struct CameraStatus {
    camera_id: String,
    url: String,
}

async fn status(State(state): State<RtspState>) -> Response {
    let cameras: Vec<CameraStatus> = lock(&state.tasks)
        .iter()
        .map(|(id, task)| CameraStatus {
            camera_id: id.clone(),
            url: task.redacted_url.clone(),
        })
        .collect();
    Json(cameras).into_response()
}

/// What `/latest` reports: the same [`FrameOutcome`] the HTTP frame API
/// returns, plus the grid samples so the dashboard can render what the
/// engine is actually seeing.
#[derive(Debug, Serialize)]
struct LatestResponse {
    connected: bool,
    outcome: Option<FrameOutcome>,
    width: u32,
    height: u32,
    /// Grayscale grid, base64-encoded, one byte per pixel.
    samples_b64: Option<String>,
}

async fn latest(State(state): State<RtspState>, Path(camera_id): Path<String>) -> Response {
    let connected = lock(&state.tasks).contains_key(&camera_id);
    let frame = lock(&state.latest).get(&camera_id).cloned();

    if !connected && frame.is_none() {
        return fail(StatusCode::NOT_FOUND, "no camera connected under that id");
    }

    Json(LatestResponse {
        connected,
        width: frame.as_ref().map_or(GRID_WIDTH, |f| f.width),
        height: frame.as_ref().map_or(GRID_HEIGHT, |f| f.height),
        samples_b64: frame.as_ref().map(|f| base64(&f.samples)),
        outcome: frame.map(|f| f.outcome),
    })
    .into_response()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::notify::Notifier;
    use std::collections::HashMap as Map;

    fn test_state() -> RtspState {
        RtspState {
            frames: FrameState {
                engine: Arc::new(Mutex::new(crate::engine::Engine::new())),
                notifier: Arc::new(Notifier::from_channels(Map::new()).unwrap()),
            },
            tasks: Arc::new(Mutex::new(HashMap::new())),
            latest: Arc::new(Mutex::new(HashMap::new())),
            gateway_url: "http://localhost:8080".into(),
            store: Arc::new(CameraStore::open_in_memory().unwrap()),
            http_client: reqwest::Client::new(),
            snapshot_semaphore: Arc::new(tokio::sync::Semaphore::new(3)),
        }
    }

    #[test]
    fn strips_credentials_from_an_rtsp_url() {
        assert_eq!(
            redact_rtsp_url("rtsp://admin:secret@192.168.1.50:554/h264Preview_01_main"),
            "rtsp://192.168.1.50:554/h264Preview_01_main"
        );
    }

    #[test]
    fn a_url_with_no_credentials_is_unchanged() {
        assert_eq!(
            redact_rtsp_url("rtsp://192.168.1.50:554/h264Preview_01_main"),
            "rtsp://192.168.1.50:554/h264Preview_01_main"
        );
    }

    #[test]
    fn a_password_containing_an_at_sign_is_still_fully_removed() {
        let url = "rtsp://admin:p@ss@192.168.1.50:554/h264";
        let redacted = redact_rtsp_url(url);
        assert!(!redacted.contains("p@ss") && !redacted.contains("admin"));
    }

    #[test]
    fn malformed_input_does_not_panic() {
        assert_eq!(redact_rtsp_url("not a url"), "not a url");
        assert_eq!(redact_rtsp_url(""), "");
    }

    #[tokio::test]
    async fn disconnecting_an_unknown_camera_is_reported_not_silently_accepted() {
        let res = disconnect(
            State(test_state()),
            Json(DisconnectRequest {
                camera_id: "nope".into(),
            }),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn latest_for_an_unknown_camera_is_not_found() {
        let res = latest(State(test_state()), Path("nope".into())).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn connecting_with_an_empty_id_is_refused() {
        let res = connect(
            State(test_state()),
            Json(ConnectRequest {
                camera_id: "  ".into(),
                url: "rtsp://x/y".into(),
            }),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
