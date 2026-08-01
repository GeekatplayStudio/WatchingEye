//! ONNX Runtime YOLO11n backend for [`crate::Detector`] (ROADMAP 1.3).
//!
//! Enabled with `--features ort`. Soft-fails construction when the model file
//! is missing; live vision-engine stays AI-free unless an operator injects this
//! backend through `process_with_detector`.

use crate::yolo_decode::{decode, ANCHORS, INPUT_SIZE};
use crate::{Detector, DetectorError};
use camera::Frame;
use chrono::Utc;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use schemas::detection::BoundingBox;
use schemas::Detection;
use std::path::{Path, PathBuf};

const MODEL_ID: &str = "yolo11n-onnx";

/// Resolve the default model path relative to the repo (or `WATCHINGEYE_YOLO_MODEL`).
#[must_use]
pub fn default_model_path() -> PathBuf {
    if let Ok(p) = std::env::var("WATCHINGEYE_YOLO_MODEL") {
        return PathBuf::from(p);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../models/vision/yolo11n.onnx")
}

/// YOLO11n detector backed by ONNX Runtime.
pub struct OnnxYoloDetector {
    session: Session,
    min_confidence: f32,
}

impl OnnxYoloDetector {
    /**
     * Load YOLO11n from `model_path`.
     *
     * # Errors
     * [`DetectorError::Inference`] when the file is missing or ORT fails.
     *
     * # Example
     * ```ignore
     * let det = OnnxYoloDetector::from_path("models/vision/yolo11n.onnx", 0.4)?;
     * ```
     */
    pub fn from_path(model_path: impl AsRef<Path>, min_confidence: f32) -> Result<Self, DetectorError> {
        let path = model_path.as_ref();
        if !path.is_file() {
            return Err(DetectorError::Inference {
                model: MODEL_ID.into(),
                reason: format!("model not found at {}", path.display()),
            });
        }
        let session = Session::builder()
            .map_err(|e| DetectorError::Inference {
                model: MODEL_ID.into(),
                reason: e.to_string(),
            })?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| DetectorError::Inference {
                model: MODEL_ID.into(),
                reason: e.to_string(),
            })?
            .commit_from_file(path)
            .map_err(|e| DetectorError::Inference {
                model: MODEL_ID.into(),
                reason: e.to_string(),
            })?;
        Ok(Self {
            session,
            min_confidence,
        })
    }

    /// Load from [`default_model_path`].
    ///
    /// # Errors
    /// Same as [`from_path`].
    pub fn from_default_path(min_confidence: f32) -> Result<Self, DetectorError> {
        Self::from_path(default_model_path(), min_confidence)
    }
}

impl Detector for OnnxYoloDetector {
    fn model_id(&self) -> &str {
        MODEL_ID
    }

    fn detect(&mut self, frame: &Frame) -> Result<Vec<Detection>, DetectorError> {
        if frame.format != "gray8" && frame.format != "rgb8" {
            return Err(DetectorError::UnsupportedFormat(frame.format.clone()));
        }
        let (tensor, meta) = letterbox_frame(frame)?;
        let input = Tensor::from_array(([1_usize, 3, INPUT_SIZE, INPUT_SIZE], tensor)).map_err(
            |e| DetectorError::Inference {
                model: MODEL_ID.into(),
                reason: e.to_string(),
            },
        )?;
        let outputs = self.session.run(ort::inputs![input]).map_err(|e| DetectorError::Inference {
            model: MODEL_ID.into(),
            reason: e.to_string(),
        })?;
        let (_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| DetectorError::Inference {
                model: MODEL_ID.into(),
                reason: e.to_string(),
            })?;
        let decoded = decode(data, ANCHORS, INPUT_SIZE, self.min_confidence);
        Ok(decoded
            .into_iter()
            .map(|d| {
                let (x, y, w, h) = unletterbox_box(d.x, d.y, d.width, d.height, &meta, frame);
                Detection {
                    class: d.class,
                    confidence: d.confidence,
                    bbox: BoundingBox {
                        x,
                        y,
                        width: w,
                        height: h,
                    },
                    frame: frame.number,
                    model: MODEL_ID.into(),
                    timestamp: Utc::now(),
                }
            })
            .collect())
    }
}

struct LetterboxMeta {
    scale: f32,
    pad_x: f32,
    pad_y: f32,
}

fn letterbox_frame(frame: &Frame) -> Result<(Vec<f32>, LetterboxMeta), DetectorError> {
    let width = frame.width as usize;
    let height = frame.height as usize;
    if width == 0 || height == 0 || frame.data.is_empty() {
        return Err(DetectorError::UnsupportedFormat("empty frame".into()));
    }
    let scale = (INPUT_SIZE as f32 / width as f32).min(INPUT_SIZE as f32 / height as f32);
    let out_w = (width as f32 * scale).round() as usize;
    let out_h = (height as f32 * scale).round() as usize;
    let pad_x = ((INPUT_SIZE - out_w) / 2) as f32;
    let pad_y = ((INPUT_SIZE - out_h) / 2) as f32;
    let plane = INPUT_SIZE * INPUT_SIZE;
    let mut tensor = vec![0.5_f32; 3 * plane];
    for y in 0..out_h {
        let src_y = ((y as f32 / scale) as usize).min(height - 1);
        for x in 0..out_w {
            let src_x = ((x as f32 / scale) as usize).min(width - 1);
            let dst = (y + pad_y as usize) * INPUT_SIZE + (x + pad_x as usize);
            let (r, g, b) = sample_rgb(frame, src_x, src_y, width);
            tensor[dst] = r;
            tensor[plane + dst] = g;
            tensor[2 * plane + dst] = b;
        }
    }
    Ok((
        tensor,
        LetterboxMeta {
            scale,
            pad_x,
            pad_y,
        },
    ))
}

fn sample_rgb(frame: &Frame, x: usize, y: usize, width: usize) -> (f32, f32, f32) {
    if frame.format == "rgb8" {
        let i = (y * width + x) * 3;
        let r = f32::from(*frame.data.get(i).unwrap_or(&0)) / 255.0;
        let g = f32::from(*frame.data.get(i + 1).unwrap_or(&0)) / 255.0;
        let b = f32::from(*frame.data.get(i + 2).unwrap_or(&0)) / 255.0;
        (r, g, b)
    } else {
        let i = y * width + x;
        let g = f32::from(*frame.data.get(i).unwrap_or(&0)) / 255.0;
        (g, g, g)
    }
}

fn unletterbox_box(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    meta: &LetterboxMeta,
    frame: &Frame,
) -> (f32, f32, f32, f32) {
    let px = x * INPUT_SIZE as f32;
    let py = y * INPUT_SIZE as f32;
    let pw = w * INPUT_SIZE as f32;
    let ph = h * INPUT_SIZE as f32;
    let left = ((px - meta.pad_x) / meta.scale).max(0.0);
    let top = ((py - meta.pad_y) / meta.scale).max(0.0);
    let width = (pw / meta.scale).min(frame.width as f32);
    let height = (ph / meta.scale).min(frame.height as f32);
    (left, top, width, height)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn missing_model_is_a_clean_error() {
        let result = OnnxYoloDetector::from_path("definitely-missing-yolo.onnx", 0.4);
        match result {
            Err(DetectorError::Inference { model, reason }) => {
                assert_eq!(model, MODEL_ID);
                assert!(reason.contains("not found"));
            }
            Ok(_) => panic!("expected missing-model error"),
            Err(other) => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn default_path_runs_when_weights_present() {
        let path = default_model_path();
        if !path.is_file() {
            return;
        }
        let mut det = OnnxYoloDetector::from_path(&path, 0.4).expect("load yolo");
        let frame = Frame {
            number: 1,
            width: 64,
            height: 48,
            data: vec![40; 64 * 48],
            format: "gray8".into(),
            timestamp: Utc::now(),
        };
        let out = det.detect(&frame).expect("infer");
        // Flat gray may yield zero boxes; the contract is Ok, not Err.
        assert!(out.iter().all(|d| d.model == MODEL_ID));
    }
}
