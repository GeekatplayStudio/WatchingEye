//! ffmpeg decode loop and gateway classify POST for RTSP cameras.
//!
//! Kept separate from the HTTP surface in [`crate::rtsp`] so that module
//! stays under the project line budget.

use crate::api::{process_frame, FrameRequest};
use crate::cameras_api::base64;
use crate::rtsp::{lock, LatestFrame, RtspState, GRID_HEIGHT, GRID_WIDTH};
use std::collections::HashSet;
use std::process::Stdio;
use std::time::Instant;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tracing::{info, warn};
use uuid::Uuid;

/// Frames per second requested from ffmpeg's decode.
const CAPTURE_FPS: u32 = 8;

/// Width of the JPEG grabbed for classification (matches browser `grabSnapshot`).
const SNAPSHOT_WIDTH: u32 = 640;

/// Decode `url` at the tracking grid resolution and feed every frame into
/// the deterministic engine, exactly as the browser's capture loop does.
///
/// Runs until ffmpeg exits — a bad URL, a dropped connection, or wrong
/// credentials all end the same way: the process exits, this loop returns,
/// and the camera drops out of the connected list. There is no automatic
/// reconnect; a stream that keeps failing should be visibly stopped rather
/// than silently retrying against the same bad address forever.
pub(crate) async fn capture_loop(state: RtspState, camera_id: String, url: String) {
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
        .stderr(Stdio::null())
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

        let outcome = process_frame(&state.frames, req);

        for object_id in &outcome.triggered {
            if !classified.insert(*object_id) {
                continue;
            }
            tokio::spawn(snapshot_and_classify(
                state.clone(),
                url.clone(),
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

    state.forget_task(&camera_id);
    let _ = child.kill().await;
}

/// Grab one full-colour still and POST it to the gateway for classification.
async fn snapshot_and_classify(
    state: RtspState,
    url: String,
    camera_id: String,
    object_id: Uuid,
    frame: u64,
) {
    let _permit = match state.snapshot_semaphore.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            warn!(camera_id, %object_id, "snapshot skipped — max concurrent ffmpeg snapshot processes reached");
            return;
        }
    };

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
    let url = format!("{}/api/classify", state.gateway_url);
    match state.http_client.post(&url).json(&body).send().await {
        Ok(res) if res.status().is_success() => {
            info!(camera_id, %object_id, "classification requested");
        }
        Ok(res) => {
            warn!(camera_id, %object_id, status = %res.status(), "gateway refused the classify request");
        }
        Err(err) => warn!(camera_id, %object_id, %err, "could not reach the gateway to classify"),
    }
}

/// Body of the classify request this module sends to the gateway.
///
/// Field values match exactly what the browser's `classifyObject` sends.
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

    use super::*;

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
        let body = classify_payload("cam", Uuid::nil(), 0, "");
        assert_eq!(body["event"]["frames"], serde_json::json!([0, 0, 0]));
    }
}
