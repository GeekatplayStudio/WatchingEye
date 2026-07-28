//! Detector output types: raw detections and their validated form.

use crate::object::ObjectClass;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Axis-aligned bounding box in pixel coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoundingBox {
    /// Left edge.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width in pixels.
    pub width: f32,
    /// Height in pixels.
    pub height: f32,
}

/// Raw output of an object detector for a single frame. Untrusted until it
/// passes the confidence and temporal validators.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Detection {
    /// Predicted class.
    pub class: ObjectClass,
    /// Model confidence in `[0.0, 1.0]`.
    pub confidence: f32,
    /// Location in the frame.
    pub bbox: BoundingBox,
    /// Frame number this detection came from.
    pub frame: u64,
    /// Identifier of the model that produced this (e.g. `"yolo11-nano"`).
    pub model: String,
    /// Capture timestamp.
    pub timestamp: DateTime<Utc>,
}

/// A detection that has passed confidence and temporal validation and is
/// safe to hand to the tracker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedDetection {
    /// The underlying detection.
    pub detection: Detection,
    /// Names of validators that passed (audit trail).
    pub validators_passed: Vec<String>,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn detection_roundtrips_through_json() {
        let d = Detection {
            class: ObjectClass::Dog,
            confidence: 0.97,
            bbox: BoundingBox {
                x: 1.0,
                y: 2.0,
                width: 3.0,
                height: 4.0,
            },
            frame: 42,
            model: "yolo11-nano".into(),
            timestamp: Utc::now(),
        };
        let json = serde_json::to_string(&d).unwrap();
        let back: Detection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.class, ObjectClass::Dog);
        assert_eq!(back.frame, 42);
    }
}
