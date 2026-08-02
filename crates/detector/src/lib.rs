//! Object detector abstraction.
//!
//! Every vision model (`YOLO` nano→11, `GroundingDINO`, Florence, Qwen-VL, …)
//! implements [`Detector`]. ONNX Runtime / Candle backends live in separate
//! modules; the pipeline depends only on the trait.
//!
//! Enable `--features ort` for the `YOLO11n` ONNX backend ([`onnx_yolo`]).

pub mod yolo_decode;

#[cfg(feature = "ort")]
pub mod onnx_yolo;

use camera::Frame;
use schemas::Detection;
use thiserror::Error;

/// Detector failure modes.
#[derive(Debug, Error)]
pub enum DetectorError {
    /// The model failed to run inference.
    #[error("inference failed in model '{model}': {reason}")]
    Inference {
        /// Model identifier.
        model: String,
        /// Backend-specific reason.
        reason: String,
    },
    /// The frame was incompatible with the model input.
    #[error("unsupported frame format '{0}'")]
    UnsupportedFormat(String),
}

/// The one interface all detection backends implement.
pub trait Detector: Send {
    /// Stable model identifier, e.g. `"yolo11-nano"`.
    fn model_id(&self) -> &'static str;

    /// Run detection on one frame.
    ///
    /// # Errors
    /// Returns [`DetectorError`] on inference or format failure. An empty
    /// `Vec` means "ran fine, found nothing" — never an error.
    fn detect(&mut self, frame: &Frame) -> Result<Vec<Detection>, DetectorError>;
}

/// Drop detections below `min_confidence`. First validation gate; pure.
#[must_use]
pub fn filter_by_confidence(detections: Vec<Detection>, min_confidence: f32) -> Vec<Detection> {
    detections
        .into_iter()
        .filter(|d| d.confidence >= min_confidence)
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use chrono::Utc;
    use schemas::detection::BoundingBox;
    use schemas::ObjectClass;

    fn det(confidence: f32) -> Detection {
        Detection {
            class: ObjectClass::Person,
            confidence,
            bbox: BoundingBox {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            contour: None,
            frame: 1,
            model: "test".into(),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn confidence_filter_is_inclusive_at_threshold() {
        let out = filter_by_confidence(vec![det(0.95), det(0.94), det(0.99)], 0.95);
        assert_eq!(out.len(), 2);
    }
}
