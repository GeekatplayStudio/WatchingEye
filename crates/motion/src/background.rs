//! Running-average background subtraction.
//!
//! Frame-to-frame differencing (see [`crate::MotionDetector`]) answers "did
//! anything change", but it marks only the *edges* of a moving object: the
//! interior looks identical between consecutive frames. Those edge slivers
//! do not overlap frame to frame, so a tracker can never lock onto them.
//!
//! Subtracting a slowly-adapting background instead yields one solid region
//! at the object's *current* position, which does overlap between frames —
//! that is what makes `IoU` association work.
//!
//! Known limitation, by construction: an object that stops moving is
//! absorbed into the background over roughly `1/(1-alpha)` frames and stops
//! being reported. That is the documented trade-off of this model, not a bug.

use crate::blobs::MotionMask;
use crate::MotionError;
use camera::Frame;

/// How much more slowly foreground samples are folded into the background
/// than background samples. Without this damping, a moving object smears its
/// own brightness into the model and leaves a false-positive trail behind it
/// — which fragments into extra "objects" and breaks tracking.
const FOREGROUND_ADAPT: f32 = 0.08;

/// A per-sample running-average background model with selective update.
#[derive(Debug, Clone)]
pub struct BackgroundModel {
    background: Option<Vec<f32>>,
    alpha: f32,
    threshold: f32,
}

impl Default for BackgroundModel {
    /// `alpha` 0.97 (≈33-frame memory), threshold 18/255.
    fn default() -> Self {
        Self::new(0.97, 18.0)
    }
}

impl BackgroundModel {
    /// Create a model.
    ///
    /// `alpha` is the retention factor in `[0.0, 1.0)` — higher adapts more
    /// slowly and holds objects longer. `threshold` is the per-sample
    /// deviation from background at which a sample counts as foreground.
    #[must_use]
    pub fn new(alpha: f32, threshold: f32) -> Self {
        Self {
            background: None,
            alpha: alpha.clamp(0.0, 0.999),
            threshold,
        }
    }

    /// Forget the learned background (camera moved, stream restarted).
    pub fn reset(&mut self) {
        self.background = None;
    }

    /// Compare a frame to the background, then fold it in.
    ///
    /// The first frame initializes the background and yields an all-false
    /// mask — there is nothing to compare against yet.
    ///
    /// # Errors
    /// [`MotionError::EmptyFrame`] for a frame with no samples;
    /// [`MotionError::SizeMismatch`] if the frame size changed.
    pub fn update(&mut self, frame: &Frame) -> Result<MotionMask, MotionError> {
        if frame.data.is_empty() {
            return Err(MotionError::EmptyFrame(frame.number));
        }
        let Some(background) = self.background.as_mut() else {
            self.background = Some(frame.data.iter().map(|&s| f32::from(s)).collect());
            return Ok(MotionMask {
                width: frame.width,
                height: frame.height,
                changed: vec![false; frame.data.len()],
            });
        };
        if background.len() != frame.data.len() {
            let err = MotionError::SizeMismatch {
                expected: background.len(),
                actual: frame.data.len(),
            };
            self.background = Some(frame.data.iter().map(|&s| f32::from(s)).collect());
            return Err(err);
        }

        let base_rate = 1.0 - self.alpha;
        let mut changed = Vec::with_capacity(frame.data.len());
        for (bg, &sample) in background.iter_mut().zip(&frame.data) {
            let value = f32::from(sample);
            let is_foreground = (value - *bg).abs() > self.threshold;
            changed.push(is_foreground);
            // Foreground samples adapt far more slowly, so a passing object
            // does not contaminate the model of the scene behind it. They do
            // still adapt, so something that parks becomes scenery.
            let rate = if is_foreground {
                base_rate * FOREGROUND_ADAPT
            } else {
                base_rate
            };
            *bg = (1.0 - rate) * *bg + rate * value;
        }
        Ok(MotionMask {
            width: frame.width,
            height: frame.height,
            changed,
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use chrono::Utc;

    fn frame(number: u64, data: Vec<u8>) -> Frame {
        Frame {
            number,
            width: 10,
            height: 10,
            data,
            format: "gray8".into(),
            timestamp: Utc::now(),
        }
    }

    /// A 10x10 field with a solid 4x4 block at column `x`.
    fn with_block(x: u32) -> Vec<u8> {
        let mut data = vec![20_u8; 100];
        for dy in 0..4 {
            for dx in 0..4 {
                let px = x + dx;
                if px < 10 {
                    data[(dy * 10 + px) as usize] = 230;
                }
            }
        }
        data
    }

    #[test]
    fn first_frame_learns_and_reports_nothing() {
        let mut m = BackgroundModel::default();
        let mask = m.update(&frame(1, vec![20; 100])).unwrap();
        assert!(mask.changed.iter().all(|c| !c));
    }

    #[test]
    fn static_scene_stays_empty() {
        let mut m = BackgroundModel::default();
        m.update(&frame(1, vec![20; 100])).unwrap();
        let mask = m.update(&frame(2, vec![20; 100])).unwrap();
        assert_eq!(mask.changed.iter().filter(|c| **c).count(), 0);
    }

    #[test]
    fn foreground_object_is_a_solid_region_at_its_position() {
        let mut m = BackgroundModel::default();
        m.update(&frame(1, vec![20; 100])).unwrap();
        let mask = m.update(&frame(2, with_block(0))).unwrap();
        // The whole 4x4 block reads as foreground, not just its edges.
        assert_eq!(mask.changed.iter().filter(|c| **c).count(), 16);
        assert!(mask.at(0, 0) && mask.at(3, 3));
    }

    #[test]
    fn a_moving_object_stays_solid_so_regions_overlap() {
        let mut m = BackgroundModel::default();
        m.update(&frame(1, vec![20; 100])).unwrap();
        let first = m.update(&frame(2, with_block(0))).unwrap();
        let second = m.update(&frame(3, with_block(1))).unwrap();
        assert!(
            first.at(1, 1) && second.at(1, 1),
            "regions must overlap between frames"
        );
    }

    #[test]
    fn stationary_object_is_absorbed_over_time() {
        let mut m = BackgroundModel::new(0.5, 18.0);
        m.update(&frame(1, vec![20; 100])).unwrap();
        let mut last = 0;
        for n in 2..200 {
            last = m
                .update(&frame(n, with_block(0)))
                .unwrap()
                .changed
                .iter()
                .filter(|c| **c)
                .count();
        }
        assert_eq!(
            last, 0,
            "documented trade-off: a still object joins the background"
        );
    }

    #[test]
    fn a_passing_object_leaves_no_ghost_trail() {
        // A moving object must not smear itself into the background model:
        // the vacated area has to read as background again immediately,
        // otherwise the trail fragments into phantom objects downstream.
        let mut m = BackgroundModel::default();
        m.update(&frame(1, vec![20; 100])).unwrap();
        for n in 2..8 {
            m.update(&frame(n, with_block(0))).unwrap();
        }
        // Object moves away from column 0 entirely.
        let mask = m.update(&frame(9, with_block(6))).unwrap();
        assert!(!mask.at(0, 0), "vacated position must not stay foreground");
        assert!(mask.at(6, 0), "the object's new position is foreground");
    }

    #[test]
    fn empty_frame_is_rejected() {
        let mut m = BackgroundModel::default();
        assert!(matches!(
            m.update(&frame(1, vec![])),
            Err(MotionError::EmptyFrame(1))
        ));
    }

    #[test]
    fn resize_is_rejected_then_relearned() {
        let mut m = BackgroundModel::default();
        m.update(&frame(1, vec![20; 100])).unwrap();
        assert!(m.update(&frame(2, vec![20; 64])).is_err());
        assert!(m.update(&frame(3, vec![20; 64])).is_ok());
    }

    #[test]
    fn reset_forgets_the_background() {
        let mut m = BackgroundModel::default();
        m.update(&frame(1, vec![20; 100])).unwrap();
        m.reset();
        let mask = m.update(&frame(2, with_block(0))).unwrap();
        assert!(
            mask.changed.iter().all(|c| !c),
            "first frame after reset only learns"
        );
    }
}
