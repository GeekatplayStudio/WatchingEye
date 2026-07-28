//! Live-tunable pipeline settings.
//!
//! Every threshold the pipeline uses is here rather than scattered as
//! constants, so an operator can adjust sensitivity while watching the
//! effect. Values are clamped on the way in: a slider cannot put the
//! pipeline into a state the code does not expect.

use serde::{Deserialize, Serialize};

/// Thresholds governing detection, tracking, and gating.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct EngineConfig {
    /// Per-sample deviation from the background counted as foreground.
    pub sensitivity: f32,
    /// How quickly the background model adapts, in `[0.5, 0.999]`.
    pub background_alpha: f32,
    /// Smallest region, in samples, that is not treated as noise.
    pub min_region_area: usize,
    /// Overlap required to consider a region the same object as a track.
    pub min_track_iou: f32,
    /// Consecutive frames a track needs before the gate opens.
    pub gate_frames: u32,
    /// Frames a track may go unseen before it is dropped.
    pub max_missed_frames: u32,
    /// Foreground fraction above which the frame counts as "motion".
    pub motion_ratio: f32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            sensitivity: 18.0,
            background_alpha: 0.97,
            min_region_area: 12,
            min_track_iou: 0.15,
            gate_frames: 3,
            max_missed_frames: 8,
            motion_ratio: 0.004,
        }
    }
}

impl EngineConfig {
    /// Clamp every field into a range the pipeline behaves sensibly in.
    ///
    /// Applied to anything arriving from outside, so an out-of-range value
    /// is corrected rather than rejected — an operator dragging a slider
    /// should never be able to wedge the pipeline.
    #[must_use]
    pub fn sanitized(self) -> Self {
        Self {
            sensitivity: self.sensitivity.clamp(2.0, 120.0),
            background_alpha: self.background_alpha.clamp(0.5, 0.999),
            min_region_area: self.min_region_area.clamp(1, 5000),
            min_track_iou: self.min_track_iou.clamp(0.01, 0.9),
            gate_frames: self.gate_frames.clamp(1, 60),
            max_missed_frames: self.max_missed_frames.clamp(1, 120),
            motion_ratio: self.motion_ratio.clamp(0.0, 0.5),
        }
    }

    /// True when a change requires rebuilding the background model, which
    /// discards what it has learned about the scene.
    #[must_use]
    pub fn requires_background_reset(self, other: Self) -> bool {
        (self.sensitivity - other.sensitivity).abs() > f32::EPSILON
            || (self.background_alpha - other.background_alpha).abs() > f32::EPSILON
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn defaults_survive_sanitizing_unchanged() {
        let d = EngineConfig::default();
        let s = d.sanitized();
        assert_eq!(s.sensitivity, d.sensitivity);
        assert_eq!(s.gate_frames, d.gate_frames);
    }

    #[test]
    fn absurd_values_are_clamped_not_rejected() {
        let wild = EngineConfig {
            sensitivity: -50.0,
            background_alpha: 5.0,
            min_region_area: 0,
            min_track_iou: 9.0,
            gate_frames: 0,
            max_missed_frames: 0,
            motion_ratio: 10.0,
        }
        .sanitized();
        assert_eq!(wild.sensitivity, 2.0);
        assert_eq!(wild.background_alpha, 0.999);
        assert_eq!(wild.min_region_area, 1);
        assert_eq!(wild.min_track_iou, 0.9);
        assert_eq!(wild.gate_frames, 1);
        assert_eq!(wild.max_missed_frames, 1);
        assert_eq!(wild.motion_ratio, 0.5);
    }

    #[test]
    fn only_background_fields_force_a_reset() {
        let base = EngineConfig::default();
        let gate_changed = EngineConfig {
            gate_frames: 9,
            ..base
        };
        assert!(!base.requires_background_reset(gate_changed));

        let sensitivity_changed = EngineConfig {
            sensitivity: 40.0,
            ..base
        };
        assert!(base.requires_background_reset(sensitivity_changed));
    }

    #[test]
    fn partial_json_falls_back_to_defaults() {
        let cfg: EngineConfig = serde_json::from_str(r#"{"gate_frames": 5}"#).unwrap();
        assert_eq!(cfg.gate_frames, 5);
        assert_eq!(cfg.sensitivity, EngineConfig::default().sensitivity);
    }
}
