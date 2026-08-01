//! Pump a file or video into the deterministic engine — the CLI twin of
//! [`crate::rtsp`].
//!
//! - **Raw gray / directory**: [`camera::file::FileCamera`] (no ffmpeg).
//! - **Container video** (`.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`): ffmpeg
//!   subprocess decoding to the same 96×72 gray8 rawvideo grid RTSP uses.

use crate::api::{FrameRequest, SharedEngine};
use crate::cli::FileCameraArgs;
use camera::file::{FileCamera, GRID_HEIGHT, GRID_WIDTH};
use camera::{CameraError, CameraSource};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tracing::{info, warn};

/// Nominal cadence when pumping a silent file (matches RTSP `CAPTURE_FPS`).
const CAPTURE_FPS: u32 = 8;

/// True when `path` should be decoded by ffmpeg rather than [`FileCamera`].
#[must_use]
pub fn is_container_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp4" | "mkv" | "avi" | "mov" | "webm" | "m4v"
            )
        })
}

/// Spawn a background task that feeds `args.input` into `engine`.
///
/// Returns the join handle so tests can await completion. The HTTP server
/// keeps running after the file ends (same as an RTSP disconnect).
pub fn spawn(engine: SharedEngine, args: FileCameraArgs) -> JoinHandle<u64> {
    tokio::spawn(async move {
        let camera_id = args.camera_id.clone();
        let path = args.input.clone();
        let frames = if is_container_video(&path) {
            pump_ffmpeg(engine, path, camera_id).await
        } else {
            pump_file_camera(engine, path, camera_id).await
        };
        frames
    })
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn ingest(engine: &SharedEngine, camera_id: &str, samples: Vec<u8>, dt_secs: f32) {
    let req = FrameRequest {
        camera_id: camera_id.to_owned(),
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        samples,
        dt_secs: Some(dt_secs),
        pinned_target: None,
    };
    let _ = lock(engine).process(req);
}

async fn pump_file_camera(engine: SharedEngine, path: PathBuf, camera_id: String) -> u64 {
    let open_result = tokio::task::spawn_blocking({
        let path = path.clone();
        let camera_id = camera_id.clone();
        move || FileCamera::open_grid(&path, camera_id)
    })
    .await;

    let mut cam = match open_result {
        Ok(Ok(cam)) => cam,
        Ok(Err(err)) => {
            warn!(%err, path = %path.display(), "file camera failed to open");
            return 0;
        }
        Err(err) => {
            warn!(%err, "file camera open task failed");
            return 0;
        }
    };

    info!(
        camera_id = %camera_id,
        path = %path.display(),
        "file camera pumping (raw gray / directory)"
    );

    let dt = 1.0 / f32::from(u16::try_from(CAPTURE_FPS).unwrap_or(8));
    let mut frames: u64 = 0;

    loop {
        let result = tokio::task::spawn_blocking(move || {
            let frame = cam.next_frame();
            (cam, frame)
        })
        .await;

        let (next_cam, frame) = match result {
            Ok(pair) => pair,
            Err(err) => {
                warn!(%err, "file camera read task failed");
                break;
            }
        };
        cam = next_cam;

        match frame {
            Ok(frame) => {
                ingest(&engine, &camera_id, frame.data, dt);
                frames = frames.saturating_add(1);
                // Yield so the HTTP server stays responsive during a long file.
                tokio::task::yield_now().await;
            }
            Err(CameraError::Disconnected(_)) => {
                info!(camera_id = %camera_id, frames, "file camera exhausted");
                break;
            }
            Err(err) => {
                warn!(camera_id = %camera_id, %err, frames, "file camera stopped on bad frame");
                break;
            }
        }
    }

    frames
}

async fn pump_ffmpeg(engine: SharedEngine, path: PathBuf, camera_id: String) -> u64 {
    let path_str = path.to_string_lossy().into_owned();
    let mut child = match Command::new("ffmpeg")
        .args([
            "-i",
            &path_str,
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
            warn!(
                %err,
                path = %path.display(),
                "could not start ffmpeg for file camera — is it on PATH?"
            );
            return 0;
        }
    };

    let Some(mut stdout) = child.stdout.take() else {
        warn!(camera_id = %camera_id, "ffmpeg started with no stdout");
        return 0;
    };

    info!(
        camera_id = %camera_id,
        path = %path.display(),
        "file camera pumping (ffmpeg container)"
    );

    let frame_bytes = (GRID_WIDTH * GRID_HEIGHT) as usize;
    let mut buf = vec![0u8; frame_bytes];
    let dt = 1.0 / f32::from(u16::try_from(CAPTURE_FPS).unwrap_or(8));
    let mut frames: u64 = 0;

    loop {
        if let Err(err) = stdout.read_exact(&mut buf).await {
            info!(camera_id = %camera_id, %err, frames, "ffmpeg file stream ended");
            break;
        }
        frames = frames.saturating_add(1);
        ingest(&engine, &camera_id, buf.clone(), dt);
    }

    let _ = child.kill().await;
    tokio::time::sleep(Duration::from_millis(10)).await;
    frames
}

/// Drain a [`FileCamera`] synchronously and count frames — used by the golden
/// integration test so CI never depends on ffmpeg or a running HTTP server.
///
/// # Errors
/// Propagates the first non-disconnect [`CameraError`] from the camera.
#[cfg(test)]
fn count_frames(mut cam: FileCamera) -> Result<u64, CameraError> {
    let mut n = 0u64;
    loop {
        match cam.next_frame() {
            Ok(_) => n = n.saturating_add(1),
            Err(CameraError::Disconnected(_)) => return Ok(n),
            Err(err) => return Err(err),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::sync::Arc;

    #[test]
    fn container_extensions_are_detected() {
        assert!(is_container_video(Path::new("a.MP4")));
        assert!(is_container_video(Path::new("b.mkv")));
        assert!(!is_container_video(Path::new("c.gray")));
        assert!(!is_container_video(Path::new("frames")));
    }

    #[test]
    fn golden_file_camera_into_engine_fixed_frame_count() {
        let dir =
            std::env::temp_dir().join(format!("watchingeye-pump-golden-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("seq.gray");
        let n_frames = 11u64;
        let frame_len = (GRID_WIDTH * GRID_HEIGHT) as usize;
        let mut file = File::create(&path).unwrap();
        for i in 0..n_frames {
            file.write_all(&vec![u8::try_from(i).unwrap(); frame_len])
                .unwrap();
        }
        drop(file);

        let cam = FileCamera::open_grid(&path, "golden-pump").unwrap();
        assert_eq!(count_frames(cam).unwrap(), n_frames);

        // Also prove the engine accepts every frame from the same fixture.
        let engine = Arc::new(Mutex::new(crate::engine::Engine::new()));
        let cam = FileCamera::open_grid(&path, "golden-pump").unwrap();
        let mut ingested = 0u64;
        let mut cam = cam;
        loop {
            match cam.next_frame() {
                Ok(frame) => {
                    ingest(&engine, "golden-pump", frame.data, 0.125);
                    ingested += 1;
                }
                Err(CameraError::Disconnected(_)) => break,
                Err(err) => panic!("{err}"),
            }
        }
        assert_eq!(ingested, n_frames);
        let _ = fs::remove_dir_all(&dir);
    }
}
