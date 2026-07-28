//! Camera source abstraction.
//!
//! Every camera type (ESP32 stream, RTSP, USB, video file, image upload,
//! WebRTC, drone) implements [`CameraSource`]. The pipeline only ever sees
//! this trait, so backends are swappable and testable in isolation.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// A single captured frame. Pixel data is raw RGB8 unless noted by `format`.
#[derive(Debug, Clone)]
pub struct Frame {
    /// Monotonic frame number per camera.
    pub number: u64,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Pixel payload.
    pub data: Vec<u8>,
    /// Pixel format, e.g. `"rgb8"` or `"jpeg"`.
    pub format: String,
    /// Capture time.
    pub timestamp: DateTime<Utc>,
}

/// Camera failure modes.
#[derive(Debug, Error)]
pub enum CameraError {
    /// The source disconnected or timed out.
    #[error("camera '{0}' disconnected")]
    Disconnected(String),
    /// The source produced an undecodable frame.
    #[error("bad frame from camera '{0}': {1}")]
    BadFrame(String, String),
}

/// Static description of a camera, used by the dashboard and config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraInfo {
    /// Stable camera id, e.g. `"driveway-esp32"`.
    pub id: String,
    /// Backend kind, e.g. `"esp32"`, `"rtsp"`, `"usb"`, `"file"`.
    pub kind: String,
    /// Human-readable location label.
    pub location: String,
}

/// The one interface all camera backends implement.
pub trait CameraSource: Send {
    /// Metadata about this camera.
    fn info(&self) -> CameraInfo;

    /// Fetch the next frame, blocking until available.
    ///
    /// # Errors
    /// Returns [`CameraError`] if the source is gone or the frame is invalid.
    fn next_frame(&mut self) -> Result<Frame, CameraError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic in-memory camera for tests.
    struct FakeCamera {
        n: u64,
    }

    impl CameraSource for FakeCamera {
        fn info(&self) -> CameraInfo {
            CameraInfo {
                id: "fake".into(),
                kind: "test".into(),
                location: "unit test".into(),
            }
        }

        fn next_frame(&mut self) -> Result<Frame, CameraError> {
            self.n += 1;
            Ok(Frame {
                number: self.n,
                width: 2,
                height: 2,
                data: vec![0; 12],
                format: "rgb8".into(),
                timestamp: Utc::now(),
            })
        }
    }

    #[test]
    fn frames_are_monotonic() {
        let mut cam = FakeCamera { n: 0 };
        let a = cam.next_frame().unwrap();
        let b = cam.next_frame().unwrap();
        assert_eq!(b.number, a.number + 1);
    }
}
