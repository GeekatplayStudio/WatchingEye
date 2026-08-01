//! ROADMAP 1.2: 1000-frame static soak → zero object-detector invocations.
//!
//! Injects a counting [`Detector`] into [`Engine::process_with_detector`].
//! Live production leaves the detector unset (ADR 0004).

#![cfg(test)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

use crate::engine::Engine;
use crate::fixture_streams::{blank, frame_with_squares, req};
use camera::Frame;
use detector::{Detector, DetectorError};
use schemas::Detection;

const SOAK_FRAMES: u32 = 1000;

struct CountingDetector {
    calls: u32,
}

impl Detector for CountingDetector {
    fn model_id(&self) -> &'static str {
        "counting-stub"
    }

    fn detect(&mut self, _frame: &Frame) -> Result<Vec<Detection>, DetectorError> {
        self.calls += 1;
        Ok(Vec::new())
    }
}

#[test]
fn static_1000_frames_never_invoke_object_detector() {
    let mut engine = Engine::new();
    let mut det = CountingDetector { calls: 0 };

    // Background learn — first frame is always static.
    let out = engine.process_with_detector(req(blank()), &mut det);
    assert!(!out.motion);
    assert!(!out.detector_invoked);
    assert_eq!(det.calls, 0);

    for step in 0..SOAK_FRAMES {
        let out = engine.process_with_detector(req(blank()), &mut det);
        assert!(
            !out.motion,
            "frame {step}: static blank must not report motion"
        );
        assert!(
            !out.detector_invoked,
            "frame {step}: detector must stay idle on static"
        );
        assert!(
            out.trace
                .iter()
                .any(|t| t.contains("object_detector: skipped (static)")),
            "frame {step}: missing static skip trace"
        );
    }

    assert_eq!(
        det.calls, 0,
        "1000-frame static soak must never call Detector::detect"
    );
}

#[test]
fn motion_frame_invokes_object_detector() {
    let mut engine = Engine::new();
    let mut det = CountingDetector { calls: 0 };

    engine.process_with_detector(req(blank()), &mut det);
    assert_eq!(det.calls, 0);

    let out = engine.process_with_detector(req(frame_with_squares(&[(40, 30, 16, 20)])), &mut det);
    assert!(out.motion, "bright square must trip motion");
    assert!(out.detector_invoked);
    assert_eq!(det.calls, 1);
    assert!(out
        .trace
        .iter()
        .any(|t| t.contains("object_detector: invoked (motion)")));
}
