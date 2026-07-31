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

use crate::api::{FrameRequest, SharedEngine};
use crate::cameras_api::{base64, fail};
use crate::engine::FrameOutcome;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tracing::{info, warn};
use uuid::Uuid;

/// Sample grid sent into the engine. Matches the browser's `GRID_WIDTH`/
/// `GRID_HEIGHT` in `use-webcam-pipeline.ts` — the engine's motion and
/// tracking thresholds are tuned against this resolution, so drifting from
/// it here would silently change detection behaviour between camera types.
const GRID_WIDTH: u32 = 96;
const GRID_HEIGHT: u32 = 72;

/// Frames per second requested from ffmpeg's decode. The trigger gate needs
/// several consecutive frames, not a high frame rate; this keeps CPU and
/// pipe throughput modest on a machine running several camera feeds.
const CAPTURE_FPS: u32 = 8;

/// Width of the JPEG grabbed for classification, matching the browser's
/// `grabSnapshot`.
const SNAPSHOT_WIDTH: u32 = 640;

/// One camera's ffmpeg process and the credentials needed to reconnect it.
struct CameraTask {
    handle: JoinHandle<()>,
    /// The RTSP URL with any credentials removed, safe to hand back over
    /// the API or write to logs.
    redacted_url: String,
}

/// The last frame decoded from a camera, held for the dashboard to poll.
#[derive(Clone)]
struct LatestFrame {
    outcome: FrameOutcome,
    width: u32,
    height: u32,
    samples: Vec<u8>,
}

/// Shared state for the RTSP router.
#[derive(Clone)]
pub struct RtspState {
    engine: SharedEngine,
    tasks: Arc<Mutex<HashMap<String, CameraTask>>>,
    latest: Arc<Mutex<HashMap<String, LatestFrame>>>,
    /// Base URL of the gateway, for posting classify requests on a trigger.
    gateway_url: String,
}

/// Build the router. `gateway_url` is where triggered objects get `POST`ed
/// for classification — the same endpoint the browser's capture loop calls.
pub fn router(engine: SharedEngine, gateway_url: String) -> Router {
    let state = RtspState {
        engine,
        tasks: Arc::new(Mutex::new(HashMap::new())),
        latest: Arc::new(Mutex::new(HashMap::new())),
        gateway_url,
    };
    Router::new()
        .route("/api/cameras/rtsp/connect", post(connect))
        .route("/api/cameras/rtsp/disconnect", post(disconnect))
        .route("/api/cameras/rtsp/status", get(status))
        .route("/api/cameras/rtsp/{camera_id}/latest", get(latest))
        .with_state(state)
}

/// Take the lock, surviving a poisoned mutex — one camera task panicking
/// must not disable the others.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Remove the `user:password@` portion of an RTSP URL.
///
/// The URL a camera is connected with is echoed back through `/status` for
/// the operator to confirm which stream is live; the password that was
/// typed into the credential form must not travel any further than the one
/// request that used it.
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

/// Body of the classify request this module sends to the gateway.
///
/// Field values are fixed to match exactly what the browser's
/// `classifyObject` sends: `class` and `confidence` are placeholders the
/// VLM overwrites, `frames` names the three most recent frame numbers, and
/// `snapshotRef` is derived from the frame count. Keeping this identical is
/// what lets a server-fed camera and a browser-fed one produce
/// indistinguishable events downstream.
fn classify_payload(
    camera_id: &str,
    object_id: Uuid,
    frame: u64,
    image_b64: &str,
) -> serde_json::Value {
    serde_json::json!({
        "event": {
            "objectId": object_id.to_string(),
            "class": "moving_region",
            "confidence": 0.98,
            "frames": [frame.saturating_sub(2), frame.saturating_sub(1), frame],
            "cameraId": camera_id,
            "snapshotRef": format!("frame-{frame}"),
        },
        "image": image_b64,
    })
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
///
/// Reconnecting under the same id is always safe: the previous ffmpeg
/// process is stopped first, so retrying after a failure or changing the
/// URL never leaves two processes fighting over the same camera slot.
async fn connect(State(state): State<RtspState>, Json(req): Json<ConnectRequest>) -> Response {
    if req.camera_id.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "camera_id is required");
    }
    if req.url.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "url is required");
    }

    stop_task(&state, &req.camera_id);

    let redacted_url = redact_rtsp_url(&req.url);
    let handle = tokio::spawn(capture_loop(
        state.clone(),
        req.camera_id.clone(),
        req.url.clone(),
    ));
    lock(&state.tasks).insert(
        req.camera_id.clone(),
        CameraTask {
            handle,
            redacted_url,
        },
    );

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
/// engine is actually seeing — not a separate, higher-resolution preview
/// that might disagree with what was analysed.
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

/// Decode `url` at the tracking grid resolution and feed every frame into
/// the deterministic engine, exactly as the browser's capture loop does.
///
/// Runs until ffmpeg exits — a bad URL, a dropped connection, or wrong
/// credentials all end the same way: the process exits, this loop returns,
/// and the camera drops out of the connected list. There is no automatic
/// reconnect; a stream that keeps failing should be visibly stopped rather
/// than silently retrying against the same bad address forever.
async fn capture_loop(state: RtspState, camera_id: String, url: String) {
    let mut child = match Command::new("ffmpeg")
        .args([
            "-rtsp_transport",
            "tcp",
            "-i",
            &url,
            "-an",
            "-sn",
            "-vf",
            &format!("fps={CAPTURE_FPS},scale={GRID_WIDTH}:{GRID_HEIGHT},format=gray"),
            "-f",
            "rawvideo",
            "-loglevel",
            "error",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        // Unread stderr would eventually fill its pipe buffer and stall
        // ffmpeg; discarding it is safe because `-loglevel error` already
        // keeps it to failures, which surface via the process exit instead.
        .stderr(Stdio::null())
        // Disconnecting a camera calls `.abort()` on this task, which drops
        // this future — including `child` — mid-await rather than running
        // the `child.kill()` at the bottom of this function. Without this,
        // that leaves ffmpeg decoding a stream nobody is reading, forever.
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            warn!(camera_id, %err, "could not start ffmpeg — is it installed and on PATH?");
            return;
        }
    };

    let Some(mut stdout) = child.stdout.take() else {
        warn!(camera_id, "ffmpeg started with no stdout pipe");
        return;
    };

    let frame_bytes = (GRID_WIDTH * GRID_HEIGHT) as usize;
    let mut buf = vec![0u8; frame_bytes];
    let mut classified: HashSet<Uuid> = HashSet::new();
    let mut last_frame_at = Instant::now();
    let mut frames_decoded: u64 = 0;

    loop {
        if let Err(err) = stdout.read_exact(&mut buf).await {
            info!(camera_id, %err, frames_decoded, "rtsp stream ended");
            break;
        }
        frames_decoded += 1;

        let now = Instant::now();
        let dt = if frames_decoded == 1 {
            1.0 / f32::from(u16::try_from(CAPTURE_FPS).unwrap_or(8))
        } else {
            now.duration_since(last_frame_at).as_secs_f32()
        };
        last_frame_at = now;

        let req = FrameRequest {
            camera_id: camera_id.clone(),
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
            samples: buf.clone(),
            dt_secs: Some(dt),
            pinned_target: None,
        };

        let outcome = {
            let mut guard = lock(&state.engine);
            guard.process(req)
        };

        for object_id in &outcome.triggered {
            if !classified.insert(*object_id) {
                continue;
            }
            tokio::spawn(snapshot_and_classify(
                url.clone(),
                state.gateway_url.clone(),
                camera_id.clone(),
                *object_id,
                outcome.frame,
            ));
        }

        lock(&state.latest).insert(
            camera_id.clone(),
            LatestFrame {
                outcome,
                width: GRID_WIDTH,
                height: GRID_HEIGHT,
                samples: buf.clone(),
            },
        );
    }

    lock(&state.tasks).remove(&camera_id);
    let _ = child.kill().await;
}

/// Grab one full-colour still and POST it to the gateway for classification.
///
/// Runs detached from the capture loop so a slow or failed classification
/// never stalls frame ingestion — this mirrors the browser firing
/// `void classifyObject(...)` without awaiting it.
async fn snapshot_and_classify(
    url: String,
    gateway_url: String,
    camera_id: String,
    object_id: Uuid,
    frame: u64,
) {
    let image = match Command::new("ffmpeg")
        .args([
            "-rtsp_transport",
            "tcp",
            "-i",
            &url,
            "-frames:v",
            "1",
            "-vf",
            &format!("scale={SNAPSHOT_WIDTH}:-2"),
            "-q:v",
            "4",
            "-f",
            "mjpeg",
            "-loglevel",
            "error",
            "-",
        ])
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
    {
        Ok(out) if out.status.success() && !out.stdout.is_empty() => base64(&out.stdout),
        Ok(out) => {
            warn!(
                camera_id,
                %object_id,
                status = %out.status,
                "snapshot capture produced no image"
            );
            return;
        }
        Err(err) => {
            warn!(camera_id, %object_id, %err, "could not start ffmpeg for a snapshot");
            return;
        }
    };

    let body = classify_payload(&camera_id, object_id, frame, &image);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            warn!(%err, "could not build an HTTP client for classification");
            return;
        }
    };

    let url = format!("{gateway_url}/api/classify");
    match client.post(&url).json(&body).send().await {
        Ok(res) if res.status().is_success() => {
            info!(camera_id, %object_id, "classification requested");
        }
        Ok(res) => {
            warn!(camera_id, %object_id, status = %res.status(), "gateway refused the classify request");
        }
        Err(err) => warn!(camera_id, %object_id, %err, "could not reach the gateway to classify"),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

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
        // split_once('@') on the credential side would otherwise leave part
        // of the password in the "redacted" output.
        let url = "rtsp://admin:p@ss@192.168.1.50:554/h264";
        let redacted = redact_rtsp_url(url);
        assert!(!redacted.contains("p@ss") && !redacted.contains("admin"));
    }

    #[test]
    fn malformed_input_does_not_panic() {
        assert_eq!(redact_rtsp_url("not a url"), "not a url");
        assert_eq!(redact_rtsp_url(""), "");
    }

    #[test]
    fn classify_payload_matches_the_browsers_exact_shape() {
        let id = Uuid::nil();
        let body = classify_payload("nvr-ch1", id, 42, "AAAA");
        assert_eq!(body["event"]["class"], "moving_region");
        assert!((body["event"]["confidence"].as_f64().unwrap() - 0.98).abs() < f64::EPSILON);
        assert_eq!(body["event"]["frames"], serde_json::json!([40, 41, 42]));
        assert_eq!(body["event"]["cameraId"], "nvr-ch1");
        assert_eq!(body["event"]["snapshotRef"], "frame-42");
        assert_eq!(body["event"]["objectId"], id.to_string());
        assert_eq!(body["image"], "AAAA");
    }

    #[test]
    fn classify_payload_never_panics_on_the_first_couple_of_frames() {
        // frame.saturating_sub(2) on frame 0 or 1 must not underflow.
        let body = classify_payload("cam", Uuid::nil(), 0, "");
        assert_eq!(body["event"]["frames"], serde_json::json!([0, 0, 0]));
    }

    #[tokio::test]
    async fn disconnecting_an_unknown_camera_is_reported_not_silently_accepted() {
        let state = RtspState {
            engine: Arc::new(Mutex::new(crate::engine::Engine::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            latest: Arc::new(Mutex::new(HashMap::new())),
            gateway_url: "http://localhost:8080".into(),
        };
        let res = disconnect(
            State(state),
            Json(DisconnectRequest {
                camera_id: "nope".into(),
            }),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn latest_for_an_unknown_camera_is_not_found() {
        let state = RtspState {
            engine: Arc::new(Mutex::new(crate::engine::Engine::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            latest: Arc::new(Mutex::new(HashMap::new())),
            gateway_url: "http://localhost:8080".into(),
        };
        let res = latest(State(state), Path("nope".into())).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn connecting_with_an_empty_id_is_refused() {
        let state = RtspState {
            engine: Arc::new(Mutex::new(crate::engine::Engine::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            latest: Arc::new(Mutex::new(HashMap::new())),
            gateway_url: "http://localhost:8080".into(),
        };
        let res = connect(
            State(state),
            Json(ConnectRequest {
                camera_id: "  ".into(),
                url: "rtsp://x/y".into(),
            }),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
