//! Motion-gated object-detector invoke (ROADMAP Step 1.2).
//!
//! The live engine leaves the detector unset — YOLO stays in the orchestrator
//! (ADR 0004). When a backend is injected (tests / future Rust ONNX), it runs
//! **only** if motion is true so a static scene never pays for inference.

use camera::Frame;
use detector::Detector;

/**
 * Invoke `detector` only when `motion` is true.
 *
 * Returns whether `detect` was called (not whether it found objects).
 *
 * # Example
 * ```ignore
 * maybe_invoke(false, Some(&mut det), &frame); // never calls detect
 * ```
 */
pub fn maybe_invoke(
    motion: bool,
    detector: Option<&mut dyn Detector>,
    frame: &Frame,
) -> bool {
    if !motion {
        return false;
    }
    let Some(det) = detector else {
        return false;
    };
    let _ = det.detect(frame);
    true
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use chrono::Utc;
    use detector::DetectorError;
    use schemas::Detection;

    struct CountingDetector {
        calls: u32,
    }

    impl Detector for CountingDetector {
        fn model_id(&self) -> &str {
            "counting-stub"
        }

        fn detect(&mut self, _frame: &Frame) -> Result<Vec<Detection>, DetectorError> {
            self.calls += 1;
            Ok(Vec::new())
        }
    }

    fn tiny_frame() -> Frame {
        Frame {
            number: 1,
            width: 2,
            height: 2,
            data: vec![0, 0, 0, 0],
            format: "gray8".into(),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn static_never_invokes() {
        let mut det = CountingDetector { calls: 0 };
        let frame = tiny_frame();
        assert!(!maybe_invoke(false, Some(&mut det), &frame));
        assert_eq!(det.calls, 0);
    }

    #[test]
    fn motion_invokes_once() {
        let mut det = CountingDetector { calls: 0 };
        let frame = tiny_frame();
        assert!(maybe_invoke(true, Some(&mut det), &frame));
        assert_eq!(det.calls, 1);
    }

    #[test]
    fn missing_backend_is_a_no_op() {
        let frame = tiny_frame();
        assert!(!maybe_invoke(true, None, &frame));
    }
}
