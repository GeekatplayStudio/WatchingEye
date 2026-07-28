//! Physical limits for one servo axis.
//!
//! These exist because software drives real hardware here. A servo commanded
//! past its mechanical stop stalls and burns out; commanded to jump 120° in
//! one step it slams, drawing a current spike and shaking the whole rig. Both
//! are prevented at this layer rather than trusted to whatever produced the
//! target.

use serde::{Deserialize, Serialize};

/// Travel and speed limits for a single axis.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AxisLimits {
    /// Lowest angle the mechanism can reach, in degrees.
    pub min_deg: f32,
    /// Highest angle the mechanism can reach, in degrees.
    pub max_deg: f32,
    /// Angle the axis returns to when there is nothing to track.
    pub rest_deg: f32,
    /// Fastest permitted movement, in degrees per second.
    pub max_deg_per_sec: f32,
}

impl Default for AxisLimits {
    /// Conservative defaults for a hobby servo on a small head.
    fn default() -> Self {
        Self {
            min_deg: 20.0,
            max_deg: 160.0,
            rest_deg: 90.0,
            max_deg_per_sec: 180.0,
        }
    }
}

impl AxisLimits {
    /// Clamp an angle into the mechanically reachable range.
    #[must_use]
    pub fn clamp_angle(&self, deg: f32) -> f32 {
        if !deg.is_finite() {
            return self.rest_deg;
        }
        deg.clamp(
            self.min_deg.min(self.max_deg),
            self.max_deg.max(self.min_deg),
        )
    }

    /// Limit how far an axis may move in `dt` seconds.
    ///
    /// Returns the angle actually permitted this step, so a large jump
    /// becomes a fast sweep rather than a slam.
    #[must_use]
    pub fn rate_limit(&self, current_deg: f32, desired_deg: f32, dt_secs: f32) -> f32 {
        let target = self.clamp_angle(desired_deg);
        if !dt_secs.is_finite() || dt_secs <= 0.0 {
            return current_deg;
        }
        let max_step = self.max_deg_per_sec * dt_secs;
        let delta = target - current_deg;
        if delta.abs() <= max_step {
            target
        } else {
            current_deg + max_step * delta.signum()
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn limits() -> AxisLimits {
        AxisLimits {
            min_deg: 30.0,
            max_deg: 150.0,
            rest_deg: 90.0,
            max_deg_per_sec: 100.0,
        }
    }

    #[test]
    fn angles_are_clamped_to_the_mechanism() {
        assert_eq!(limits().clamp_angle(500.0), 150.0);
        assert_eq!(limits().clamp_angle(-500.0), 30.0);
        assert_eq!(limits().clamp_angle(90.0), 90.0);
    }

    #[test]
    fn a_nonfinite_angle_falls_back_to_rest() {
        // Never send NaN to hardware; a bad computation must not become motion.
        assert_eq!(limits().clamp_angle(f32::NAN), 90.0);
        assert_eq!(limits().clamp_angle(f32::INFINITY), 90.0);
    }

    #[test]
    fn a_large_jump_becomes_a_bounded_step() {
        // 100 deg/s for 0.1s = 10 degrees, not the full 60 requested.
        assert_eq!(limits().rate_limit(90.0, 150.0, 0.1), 100.0);
    }

    #[test]
    fn a_small_move_completes_in_one_step() {
        assert_eq!(limits().rate_limit(90.0, 95.0, 0.1), 95.0);
    }

    #[test]
    fn rate_limiting_respects_direction() {
        assert_eq!(limits().rate_limit(90.0, 30.0, 0.1), 80.0);
    }

    #[test]
    fn a_zero_or_bad_timestep_produces_no_movement() {
        assert_eq!(limits().rate_limit(90.0, 150.0, 0.0), 90.0);
        assert_eq!(limits().rate_limit(90.0, 150.0, f32::NAN), 90.0);
    }

    #[test]
    fn rate_limiting_cannot_exceed_travel_limits() {
        // Even over a long step, the axis stops at its mechanical stop.
        assert_eq!(limits().rate_limit(140.0, 900.0, 10.0), 150.0);
    }
}
