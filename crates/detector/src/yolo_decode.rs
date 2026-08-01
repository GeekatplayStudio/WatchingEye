//! Pure YOLO11 decode / NMS (mirrors orchestrator `yolo.ts`).
//!
//! No ONNX runtime here — keeps the math unit-testable without model weights.

use schemas::ObjectClass;

/// Square input size `YOLO11n` was exported at.
pub const INPUT_SIZE: usize = 640;
/// Anchor count for a 640×640 input.
pub const ANCHORS: usize = 8400;

/// The 80 COCO class names, in model output order.
pub const COCO_CLASSES: [&str; 80] = [
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush",
];

/// One decoded box in model-input normalised coordinates (0..1 of 640).
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedBox {
    /// System vocabulary class.
    pub class: ObjectClass,
    /// Raw COCO label.
    pub coco_label: String,
    /// Confidence in `[0, 1]`.
    pub confidence: f32,
    /// Left x (0..1 of model square).
    pub x: f32,
    /// Top y.
    pub y: f32,
    /// Width.
    pub width: f32,
    /// Height.
    pub height: f32,
}

/**
 * Map a COCO label into [`ObjectClass`].
 *
 * # Example
 * ```
 * use detector::yolo_decode::map_class;
 * use schemas::ObjectClass;
 * assert_eq!(map_class("dog"), ObjectClass::Dog);
 * ```
 */
#[must_use]
pub fn map_class(coco: &str) -> ObjectClass {
    match coco {
        "person" => ObjectClass::Person,
        "dog" => ObjectClass::Dog,
        "cat" => ObjectClass::Cat,
        "horse" => ObjectClass::Horse,
        "bird" => ObjectClass::Bird,
        "car" => ObjectClass::Car,
        "truck" | "bus" => ObjectClass::Truck,
        "motorcycle" | "bicycle" => ObjectClass::Bike,
        "backpack" | "suitcase" => ObjectClass::Package,
        other => ObjectClass::Custom(other.to_owned()),
    }
}

fn iou(a: &DecodedBox, b: &DecodedBox) -> f32 {
    let ax2 = a.x + a.width;
    let ay2 = a.y + a.height;
    let bx2 = b.x + b.width;
    let by2 = b.y + b.height;
    let ix = (ax2.min(bx2) - a.x.max(b.x)).max(0.0);
    let iy = (ay2.min(by2) - a.y.max(b.y)).max(0.0);
    let inter = ix * iy;
    let union = a.width * a.height + b.width * b.height - inter;
    if union > 0.0 {
        inter / union
    } else {
        0.0
    }
}

/**
 * Greedy per-class NMS.
 *
 * # Example
 * ```
 * use detector::yolo_decode::nms;
 * assert!(nms(vec![], 0.45).is_empty());
 * ```
 */
#[must_use]
pub fn nms(mut detections: Vec<DecodedBox>, iou_threshold: f32) -> Vec<DecodedBox> {
    detections.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut kept = Vec::new();
    for candidate in detections {
        let overlaps = kept.iter().any(|k: &DecodedBox| {
            k.coco_label == candidate.coco_label && iou(k, &candidate) > iou_threshold
        });
        if !overlaps {
            kept.push(candidate);
        }
    }
    kept
}

/**
 * Decode a flat `[1, 84, anchors]` YOLO11 tensor (attribute-major layout).
 *
 * # Example
 * ```
 * use detector::yolo_decode::{decode, ANCHORS, INPUT_SIZE};
 * let data = vec![0.0_f32; 84 * ANCHORS];
 * assert!(decode(&data, ANCHORS, INPUT_SIZE, 0.4).is_empty());
 * ```
 */
#[must_use]
pub fn decode(
    data: &[f32],
    anchors: usize,
    input_size: usize,
    min_confidence: f32,
) -> Vec<DecodedBox> {
    if anchors == 0 || data.len() < 84 * anchors {
        return Vec::new();
    }
    // YOLO input sizes are small (e.g. 640); clamp via u16 for an exact f32 cast.
    let input_size_f = f32::from(u16::try_from(input_size).unwrap_or(u16::MAX));
    let mut out = Vec::new();
    for i in 0..anchors {
        let mut best = 0.0_f32;
        let mut best_class: Option<usize> = None;
        for c in 0..COCO_CLASSES.len() {
            let score = data[(4 + c) * anchors + i];
            if score > best {
                best = score;
                best_class = Some(c);
            }
        }
        let Some(class_idx) = best_class else {
            continue;
        };
        if best < min_confidence {
            continue;
        }
        let cx = data[i];
        let cy = data[anchors + i];
        let w = data[2 * anchors + i];
        let h = data[3 * anchors + i];
        if !(cx.is_finite() && cy.is_finite() && w.is_finite() && h.is_finite())
            || w <= 0.0
            || h <= 0.0
        {
            continue;
        }
        let coco = COCO_CLASSES[class_idx];
        out.push(DecodedBox {
            class: map_class(coco),
            coco_label: coco.to_owned(),
            confidence: best,
            x: ((cx - w / 2.0) / input_size_f).max(0.0),
            y: ((cy - h / 2.0) / input_size_f).max(0.0),
            width: (w / input_size_f).min(1.0),
            height: (h / input_size_f).min(1.0),
        });
    }
    nms(out, 0.45)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn map_class_covers_core_vocab() {
        assert_eq!(map_class("person"), ObjectClass::Person);
        assert_eq!(map_class("bus"), ObjectClass::Truck);
        assert_eq!(map_class("bicycle"), ObjectClass::Bike);
    }

    #[test]
    fn decode_finds_a_confident_person_anchor() {
        let anchors = 100;
        let mut data = vec![0.0_f32; 84 * anchors];
        let i = 3;
        data[i] = 320.0;
        data[anchors + i] = 320.0;
        data[2 * anchors + i] = 128.0;
        data[3 * anchors + i] = 320.0;
        data[4 * anchors + i] = 0.9; // person class score
        let out = decode(&data, anchors, 640, 0.4);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].class, ObjectClass::Person);
        assert!((out[0].confidence - 0.9).abs() < 1e-5);
    }
}
