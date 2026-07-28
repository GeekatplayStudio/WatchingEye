//! Frame-differencing motion detection.
//!
//! This is the cheap gate in front of the expensive object detector: no ML,
//! no allocation per frame beyond the retained reference frame. A static
//! scene must never invoke the detector (PRD Step 1.2).
//!
//! Deliberately invariant to uniform brightness shifts (clouds, auto-exposure)
//! by comparing each pixel against the frame's mean shift rather than its raw
//! value — see [`MotionDetector::evaluate`].

pub mod background;
pub mod blobs;

pub use background::BackgroundModel;
use blobs::MotionMask;
use camera::Frame;
use thiserror::Error;

/// Why a motion evaluation could not be performed.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum MotionError {
    /// Frames had differing dimensions, so they cannot be differenced.
    #[error("frame size changed: expected {expected} bytes, got {actual}")]
    SizeMismatch {
        /// Byte length of the retained reference frame.
        expected: usize,
        /// Byte length of the incoming frame.
        actual: usize,
    },
    /// The frame carried no pixel data.
    #[error("frame {0} is empty")]
    EmptyFrame(u64),
}

/// Outcome of evaluating one frame against the reference.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionResult {
    /// True when the changed-pixel ratio exceeded the configured threshold.
    pub motion: bool,
    /// Fraction of pixels that changed, in `[0.0, 1.0]`.
    pub changed_ratio: f32,
    /// Frame number this result describes.
    pub frame: u64,
}

/// Stateful motion detector holding one reference frame.
///
/// # Example
/// ```
/// use motion::MotionDetector;
/// let detector = MotionDetector::new(20, 0.02);
/// assert_eq!(detector.pixel_threshold(), 20);
/// ```
#[derive(Debug, Clone)]
pub struct MotionDetector {
    reference: Option<Vec<u8>>,
    pixel_threshold: u8,
    ratio_threshold: f32,
}

impl Default for MotionDetector {
    /// Sensible defaults: 20/255 per-pixel delta, 2% of pixels changed.
    fn default() -> Self {
        Self::new(20, 0.02)
    }
}

impl MotionDetector {
    /// Create a detector.
    ///
    /// `pixel_threshold` is the per-channel delta (after brightness
    /// compensation) at which a sample counts as changed. `ratio_threshold`
    /// is the fraction of changed samples required to report motion.
    #[must_use]
    pub fn new(pixel_threshold: u8, ratio_threshold: f32) -> Self {
        Self {
            reference: None,
            pixel_threshold,
            ratio_threshold,
        }
    }

    /// The configured per-pixel delta threshold.
    #[must_use]
    pub fn pixel_threshold(&self) -> u8 {
        self.pixel_threshold
    }

    /// Discard the reference frame (e.g. after a camera reconnect).
    pub fn reset(&mut self) {
        self.reference = None;
    }

    /// Evaluate a frame and retain it as the new reference.
    ///
    /// The first frame after construction or [`reset`](Self::reset) always
    /// reports no motion — there is nothing to compare against yet.
    ///
    /// # Errors
    /// [`MotionError::EmptyFrame`] if the frame has no data,
    /// [`MotionError::SizeMismatch`] if its size differs from the reference.
    pub fn evaluate(&mut self, frame: &Frame) -> Result<MotionResult, MotionError> {
        if frame.data.is_empty() {
            return Err(MotionError::EmptyFrame(frame.number));
        }
        let Some(reference) = self.reference.take() else {
            self.reference = Some(frame.data.clone());
            return Ok(MotionResult {
                motion: false,
                changed_ratio: 0.0,
                frame: frame.number,
            });
        };
        if reference.len() != frame.data.len() {
            let err = MotionError::SizeMismatch {
                expected: reference.len(),
                actual: frame.data.len(),
            };
            self.reference = Some(frame.data.clone());
            return Err(err);
        }

        let shift = mean_shift(&reference, &frame.data);
        let changed = count_changed(&reference, &frame.data, shift, self.pixel_threshold);
        #[allow(clippy::cast_precision_loss)]
        let changed_ratio = changed as f32 / reference.len() as f32;
        self.reference = Some(frame.data.clone());
        Ok(MotionResult {
            motion: changed_ratio >= self.ratio_threshold,
            changed_ratio,
            frame: frame.number,
        })
    }
}

impl MotionDetector {
    /// Evaluate a frame and also return the per-sample change mask.
    ///
    /// Same semantics and state updates as [`MotionDetector::evaluate`]; the
    /// mask feeds [`blobs::extract`] so motion becomes trackable regions.
    /// The first frame returns an all-false mask.
    ///
    /// # Errors
    /// Same conditions as [`MotionDetector::evaluate`].
    pub fn evaluate_mask(
        &mut self,
        frame: &Frame,
    ) -> Result<(MotionResult, MotionMask), MotionError> {
        if frame.data.is_empty() {
            return Err(MotionError::EmptyFrame(frame.number));
        }
        let empty_mask = || MotionMask {
            width: frame.width,
            height: frame.height,
            changed: vec![false; frame.data.len()],
        };
        let Some(reference) = self.reference.take() else {
            self.reference = Some(frame.data.clone());
            let result = MotionResult {
                motion: false,
                changed_ratio: 0.0,
                frame: frame.number,
            };
            return Ok((result, empty_mask()));
        };
        if reference.len() != frame.data.len() {
            let err = MotionError::SizeMismatch {
                expected: reference.len(),
                actual: frame.data.len(),
            };
            self.reference = Some(frame.data.clone());
            return Err(err);
        }

        let shift = mean_shift(&reference, &frame.data);
        let threshold = f32::from(self.pixel_threshold);
        let changed: Vec<bool> = reference
            .iter()
            .zip(&frame.data)
            .map(|(&r, &c)| ((f32::from(c) - f32::from(r)) - shift).abs() > threshold)
            .collect();
        let count = changed.iter().filter(|c| **c).count();
        #[allow(clippy::cast_precision_loss)]
        let changed_ratio = count as f32 / reference.len() as f32;
        self.reference = Some(frame.data.clone());

        let result = MotionResult {
            motion: changed_ratio >= self.ratio_threshold,
            changed_ratio,
            frame: frame.number,
        };
        let mask = MotionMask {
            width: frame.width,
            height: frame.height,
            changed,
        };
        Ok((result, mask))
    }
}

/// Mean signed difference between two equal-length buffers.
/// Subtracting this makes the comparison ignore uniform lighting changes.
fn mean_shift(reference: &[u8], current: &[u8]) -> f32 {
    let total: i64 = reference
        .iter()
        .zip(current)
        .map(|(&r, &c)| i64::from(c) - i64::from(r))
        .sum();
    #[allow(clippy::cast_precision_loss)]
    let mean = total as f32 / reference.len() as f32;
    mean
}

/// Count samples whose brightness-compensated delta exceeds `threshold`.
fn count_changed(reference: &[u8], current: &[u8], shift: f32, threshold: u8) -> usize {
    let threshold = f32::from(threshold);
    reference
        .iter()
        .zip(current)
        .filter(|(&r, &c)| ((f32::from(c) - f32::from(r)) - shift).abs() > threshold)
        .count()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use chrono::Utc;

    fn frame(number: u64, data: Vec<u8>) -> Frame {
        Frame {
            number,
            width: 4,
            height: 4,
            data,
            format: "gray8".into(),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn first_frame_never_reports_motion() {
        let mut d = MotionDetector::default();
        let r = d.evaluate(&frame(1, vec![10; 16])).unwrap();
        assert!(!r.motion);
        assert_eq!(r.changed_ratio, 0.0);
    }

    #[test]
    fn static_scene_reports_no_motion() {
        let mut d = MotionDetector::default();
        d.evaluate(&frame(1, vec![10; 16])).unwrap();
        let r = d.evaluate(&frame(2, vec![10; 16])).unwrap();
        assert!(!r.motion);
    }

    #[test]
    fn localized_change_reports_motion() {
        let mut d = MotionDetector::new(20, 0.02);
        d.evaluate(&frame(1, vec![10; 16])).unwrap();
        let mut moved = vec![10_u8; 16];
        moved[5] = 200;
        moved[6] = 200;
        let r = d.evaluate(&frame(2, moved)).unwrap();
        assert!(r.motion);
        assert!(r.changed_ratio > 0.0);
    }

    #[test]
    fn uniform_brightness_shift_is_ignored() {
        let mut d = MotionDetector::new(20, 0.02);
        d.evaluate(&frame(1, vec![10; 16])).unwrap();
        // Every pixel brightens by 60 — a cloud passing, not an intruder.
        let r = d.evaluate(&frame(2, vec![70; 16])).unwrap();
        assert!(!r.motion, "uniform lighting change must not trigger motion");
    }

    #[test]
    fn empty_frame_is_rejected() {
        let mut d = MotionDetector::default();
        assert_eq!(
            d.evaluate(&frame(7, vec![])),
            Err(MotionError::EmptyFrame(7))
        );
    }

    #[test]
    fn size_change_is_rejected_then_recovers() {
        let mut d = MotionDetector::default();
        d.evaluate(&frame(1, vec![10; 16])).unwrap();
        let err = d.evaluate(&frame(2, vec![10; 9])).unwrap_err();
        assert_eq!(
            err,
            MotionError::SizeMismatch {
                expected: 16,
                actual: 9
            }
        );
        // The new size becomes the reference, so the next frame works.
        assert!(d.evaluate(&frame(3, vec![10; 9])).is_ok());
    }

    #[test]
    fn reset_clears_reference() {
        let mut d = MotionDetector::new(20, 0.02);
        d.evaluate(&frame(1, vec![10; 16])).unwrap();
        d.reset();
        let r = d.evaluate(&frame(2, vec![200; 16])).unwrap();
        assert!(!r.motion, "first frame after reset has no reference");
    }
}
