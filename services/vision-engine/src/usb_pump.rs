//! Pump a local USB / V4L2 camera into the deterministic engine via ffmpeg.
//!
//! Mirrors [`crate::rtsp`] and the container path in [`crate::file_pump`]:
//! ffmpeg decodes the device to the same 96×72 gray8 rawvideo grid. The
//! `camera` crate stays free of ffmpeg (same split as RTSP).
//!
//! # Device selection
//!
//! | Platform | Default input | Override |
//! |----------|---------------|----------|
//! | Windows (dshow) | `WATCHINGEYE_USB_DEVICE`, else `"0"` | `--input <DirectShow name>` |
//! | Linux/Unix (v4l2) | `/dev/video0` | `--input /dev/videoN` |
//!
//! On Windows, `"0"` is a common first-device style; if ffmpeg rejects it,
//! list devices with `ffmpeg -list_devices true -f dshow -i dummy` and pass
//! the quoted camera name (or set `WATCHINGEYE_USB_DEVICE`).
//!
//! Soft-fail: missing ffmpeg or a missing device logs a warning and returns
//! `0` frames — never panics.

use crate::api::{process_frame, FrameRequest, FrameState};
use crate::cli::UsbCameraArgs;
use camera::file::{GRID_HEIGHT, GRID_WIDTH};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tracing::{info, warn};

/// Nominal cadence when pumping a USB device (matches RTSP `CAPTURE_FPS`).
const CAPTURE_FPS: u32 = 8;

/// Environment variable for the Windows `DirectShow` device name.
pub const USB_DEVICE_ENV: &str = "WATCHINGEYE_USB_DEVICE";

/// Resolve the ffmpeg device string when `--input` was omitted.
///
/// Windows: `WATCHINGEYE_USB_DEVICE` or `"0"`.
/// Unix: `/dev/video0`.
#[must_use]
pub fn default_device() -> String {
    #[cfg(windows)]
    {
        std::env::var(USB_DEVICE_ENV).unwrap_or_else(|_| "0".to_owned())
    }
    #[cfg(not(windows))]
    {
        "/dev/video0".to_owned()
    }
}

/// Build the ffmpeg argv prefix that opens a live capture device.
///
/// Returns `(input_flag_args, device_for_logs)` — the `-i` value is the last
/// element of the returned arg list after `-i` is applied by the caller.
#[must_use]
pub fn device_input_args(device: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        vec![
            "-f".to_owned(),
            "dshow".to_owned(),
            "-i".to_owned(),
            format!("video={device}"),
        ]
    }
    #[cfg(not(windows))]
    {
        vec![
            "-f".to_owned(),
            "v4l2".to_owned(),
            "-i".to_owned(),
            device.to_owned(),
        ]
    }
}

/// Spawn a background task that feeds a USB/V4L2 device into `engine`.
///
/// Returns the join handle so tests can await completion. Soft-fails (0
/// frames) when ffmpeg is missing or the device cannot be opened.
pub fn spawn(frames: FrameState, args: UsbCameraArgs) -> JoinHandle<u64> {
    tokio::spawn(async move { pump_usb(frames, args).await })
}

fn ingest(frames: &FrameState, camera_id: &str, samples: Vec<u8>, dt_secs: f32) {
    let req = FrameRequest {
        camera_id: camera_id.to_owned(),
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        samples,
        dt_secs: Some(dt_secs),
        pinned_target: None,
    };
    let _ = process_frame(frames, req);
}

async fn pump_usb(frames: FrameState, args: UsbCameraArgs) -> u64 {
    let device = args.input;
    let camera_id = args.camera_id;
    let input_args = device_input_args(&device);

    let vf = format!("fps={CAPTURE_FPS},scale={GRID_WIDTH}:{GRID_HEIGHT},format=gray");
    let mut cmd = Command::new("ffmpeg");
    cmd.args(&input_args)
        .args([
            "-an",
            "-sn",
            "-vf",
            &vf,
            "-f",
            "rawvideo",
            "-loglevel",
            "error",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            warn!(
                %err,
                device = %device,
                "could not start ffmpeg for USB camera — is it on PATH?"
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
        device = %device,
        "USB camera pumping (ffmpeg)"
    );

    let frame_bytes = (GRID_WIDTH * GRID_HEIGHT) as usize;
    let mut buf = vec![0u8; frame_bytes];
    let dt = 1.0 / f32::from(u16::try_from(CAPTURE_FPS).unwrap_or(8));
    let mut frames_read: u64 = 0;

    loop {
        if let Err(err) = stdout.read_exact(&mut buf).await {
            // Missing device / open failure usually yields immediate EOF with
            // zero frames — treat that as a soft-fail rather than a crash.
            if frames_read == 0 {
                warn!(
                    camera_id = %camera_id,
                    device = %device,
                    %err,
                    "USB camera produced no frames (device missing or ffmpeg failed)"
                );
            } else {
                info!(
                    camera_id = %camera_id,
                    %err,
                    frames = frames_read,
                    "USB camera stream ended"
                );
            }
            break;
        }
        frames_read = frames_read.saturating_add(1);
        ingest(&frames, &camera_id, buf.clone(), dt);
    }

    let _ = child.kill().await;
    tokio::time::sleep(Duration::from_millis(10)).await;
    frames_read
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::api::FrameState;
    use crate::cli::UsbCameraArgs;
    use crate::engine::Engine;
    use crate::notify::Notifier;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    fn test_frames() -> FrameState {
        FrameState {
            engine: Arc::new(Mutex::new(Engine::new())),
            notifier: Arc::new(Notifier::from_channels(HashMap::new()).expect("empty notifier")),
        }
    }

    #[test]
    fn device_input_args_include_platform_demuxer() {
        let args = device_input_args("probe-device");
        assert!(args.iter().any(|a| a == "-f"));
        assert!(args.iter().any(|a| a == "-i"));
        #[cfg(windows)]
        {
            assert!(args.iter().any(|a| a == "dshow"));
            assert!(args.iter().any(|a| a == "video=probe-device"));
        }
        #[cfg(not(windows))]
        {
            assert!(args.iter().any(|a| a == "v4l2"));
            assert!(args.iter().any(|a| a == "probe-device"));
        }
    }

    #[test]
    fn default_device_is_non_empty() {
        assert!(!default_device().is_empty());
    }

    #[tokio::test]
    async fn nonsense_device_soft_fails_with_zero_frames() {
        let frames = test_frames();
        let args = UsbCameraArgs {
            input: "__watchingeye_no_such_usb_device__".into(),
            camera_id: "usb-test".into(),
        };
        let n = pump_usb(frames, args).await;
        assert_eq!(n, 0);
    }
}
