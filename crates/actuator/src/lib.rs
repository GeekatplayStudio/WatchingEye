//! Turning "something is over there" into servo commands, safely.
//!
//! The vision pipeline produces a target in normalised image coordinates.
//! This crate converts that into pan/tilt angles for an animatronic head and
//! emits commands an ESP32 or Pi can execute.
//!
//! Three properties matter more than tracking quality, because this drives
//! physical hardware:
//!
//! - **Bounded travel and speed** — see [`limits`]. Nothing here can command
//!   a servo past its stop or faster than it can safely move.
//! - **Failsafe on silence** — if vision stops arriving, the head returns to
//!   rest rather than holding its last command forever. A crashed detector
//!   must not leave a head staring at a wall indefinitely.
//! - **Deadband** — small target jitter produces no movement at all, so the
//!   servos are not buzzing continuously at their resolution limit.
//!
//! # Example
//! ```
//! use actuator::{Head, Target};
//!
//! let mut head = Head::default();
//! // Target slightly right of centre and above it.
//! let cmd = head.update(Some(Target { x: 0.4, y: -0.2, area: 0.1 }), 0.1);
//! assert!(cmd.pan_deg < 90.0, "pans toward the target");
//! ```

pub mod limits;

use limits::AxisLimits;
use serde::{Deserialize, Serialize};

/// Where the tracked subject is, in normalised image coordinates.
///
/// `x` and `y` run from `-1.0` (left/top) through `0.0` (centre) to `1.0`
/// (right/bottom). `area` is the fraction of frame the subject occupies,
/// useful for driving a "lean in" axis later.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Target {
    /// Horizontal offset from centre, `-1.0..=1.0`.
    pub x: f32,
    /// Vertical offset from centre, `-1.0..=1.0`.
    pub y: f32,
    /// Fraction of the frame the subject covers.
    pub area: f32,
}

/// A command to send to the servo controller.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ServoCommand {
    /// Pan angle in degrees.
    pub pan_deg: f32,
    /// Tilt angle in degrees.
    pub tilt_deg: f32,
    /// True when the head is tracking rather than resting.
    pub tracking: bool,
    /// Why the head is where it is, for the zero-black-box view.
    pub reason: &'static str,
}

/// Configuration of a pan/tilt head.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HeadConfig {
    /// Pan axis limits.
    pub pan: AxisLimits,
    /// Tilt axis limits.
    pub tilt: AxisLimits,
    /// Degrees of pan per unit of normalised horizontal offset.
    pub pan_gain_deg: f32,
    /// Degrees of tilt per unit of normalised vertical offset.
    pub tilt_gain_deg: f32,
    /// Offsets smaller than this are treated as centred (no movement).
    pub deadband: f32,
    /// Invert pan, for heads whose servo faces the other way.
    pub invert_pan: bool,
    /// Invert tilt.
    pub invert_tilt: bool,
    /// Seconds without a target before the head returns to rest.
    pub failsafe_secs: f32,
}

impl Default for HeadConfig {
    fn default() -> Self {
        Self {
            pan: AxisLimits::default(),
            tilt: AxisLimits::default(),
            pan_gain_deg: 45.0,
            tilt_gain_deg: 30.0,
            deadband: 0.04,
            invert_pan: false,
            invert_tilt: false,
            failsafe_secs: 1.5,
        }
    }
}

/// A pan/tilt head that follows a target.
#[derive(Debug, Clone)]
pub struct Head {
    config: HeadConfig,
    pan_deg: f32,
    tilt_deg: f32,
    secs_since_target: f32,
}

impl Default for Head {
    fn default() -> Self {
        Self::new(HeadConfig::default())
    }
}

impl Head {
    /// Create a head parked at its rest position.
    #[must_use]
    pub fn new(config: HeadConfig) -> Self {
        Self {
            pan_deg: config.pan.rest_deg,
            tilt_deg: config.tilt.rest_deg,
            config,
            secs_since_target: 0.0,
        }
    }

    /// Current configuration.
    #[must_use]
    pub fn config(&self) -> HeadConfig {
        self.config
    }

    /// Replace the configuration, re-clamping the current position into the
    /// new limits so a tightened range takes effect immediately.
    pub fn set_config(&mut self, config: HeadConfig) {
        self.config = config;
        self.pan_deg = config.pan.clamp_angle(self.pan_deg);
        self.tilt_deg = config.tilt.clamp_angle(self.tilt_deg);
    }

    /// Advance the head by `dt_secs`, following `target` if there is one.
    ///
    /// Pass `None` when nothing is being tracked; after
    /// [`HeadConfig::failsafe_secs`] of that, the head returns to rest.
    pub fn update(&mut self, target: Option<Target>, dt_secs: f32) -> ServoCommand {
        let dt = if dt_secs.is_finite() && dt_secs > 0.0 {
            dt_secs
        } else {
            0.0
        };

        let (desired_pan, desired_tilt, tracking, reason) = match target {
            Some(t) if t.x.is_finite() && t.y.is_finite() => {
                self.secs_since_target = 0.0;
                let centred = t.x.abs() < self.config.deadband && t.y.abs() < self.config.deadband;
                if centred {
                    (
                        self.pan_deg,
                        self.tilt_deg,
                        true,
                        "target centred (within deadband)",
                    )
                } else {
                    let pan_sign = if self.config.invert_pan { -1.0 } else { 1.0 };
                    let tilt_sign = if self.config.invert_tilt { -1.0 } else { 1.0 };
                    (
                        self.config.pan.rest_deg - pan_sign * t.x * self.config.pan_gain_deg,
                        self.config.tilt.rest_deg - tilt_sign * t.y * self.config.tilt_gain_deg,
                        true,
                        "following target",
                    )
                }
            }
            _ => {
                self.secs_since_target += dt;
                if self.secs_since_target >= self.config.failsafe_secs {
                    (
                        self.config.pan.rest_deg,
                        self.config.tilt.rest_deg,
                        false,
                        "failsafe: no target, returning to rest",
                    )
                } else {
                    (
                        self.pan_deg,
                        self.tilt_deg,
                        false,
                        "target lost, holding briefly",
                    )
                }
            }
        };

        self.pan_deg = self.config.pan.rate_limit(self.pan_deg, desired_pan, dt);
        self.tilt_deg = self.config.tilt.rate_limit(self.tilt_deg, desired_tilt, dt);

        ServoCommand {
            pan_deg: self.pan_deg,
            tilt_deg: self.tilt_deg,
            tracking,
            reason,
        }
    }

    /// Immediately park the head at rest, ignoring rate limits.
    ///
    /// For shutdown and emergency stop, where getting there matters more
    /// than getting there smoothly.
    pub fn park(&mut self) -> ServoCommand {
        self.pan_deg = self.config.pan.rest_deg;
        self.tilt_deg = self.config.tilt.rest_deg;
        self.secs_since_target = self.config.failsafe_secs;
        ServoCommand {
            pan_deg: self.pan_deg,
            tilt_deg: self.tilt_deg,
            tracking: false,
            reason: "parked",
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::float_cmp,
        clippy::unnecessary_wraps,
        clippy::similar_names
    )]
    use super::*;

    fn target(x: f32, y: f32) -> Option<Target> {
        Some(Target { x, y, area: 0.1 })
    }

    /// Run enough steps for the head to settle.
    fn settle(head: &mut Head, t: Option<Target>) -> ServoCommand {
        let mut cmd = head.update(t, 0.1);
        for _ in 0..80 {
            cmd = head.update(t, 0.1);
        }
        cmd
    }

    #[test]
    fn starts_parked_at_rest() {
        let head = Head::default();
        assert_eq!(head.pan_deg, 90.0);
        assert_eq!(head.tilt_deg, 90.0);
    }

    #[test]
    fn pans_toward_a_target_on_the_right() {
        let mut head = Head::default();
        let cmd = settle(&mut head, target(0.5, 0.0));
        assert!(
            cmd.pan_deg < 90.0,
            "expected pan away from rest, got {}",
            cmd.pan_deg
        );
        assert!(cmd.tracking);
    }

    #[test]
    fn pans_the_other_way_for_a_target_on_the_left() {
        let mut head = Head::default();
        let cmd = settle(&mut head, target(-0.5, 0.0));
        assert!(cmd.pan_deg > 90.0);
    }

    #[test]
    fn inverting_an_axis_reverses_the_direction() {
        let mut head = Head::new(HeadConfig {
            invert_pan: true,
            ..HeadConfig::default()
        });
        let cmd = settle(&mut head, target(0.5, 0.0));
        assert!(
            cmd.pan_deg > 90.0,
            "inverted head should pan the opposite way"
        );
    }

    #[test]
    fn small_jitter_produces_no_movement() {
        let mut head = Head::default();
        let cmd = head.update(target(0.01, 0.01), 0.1);
        assert_eq!(cmd.pan_deg, 90.0);
        assert_eq!(cmd.reason, "target centred (within deadband)");
    }

    #[test]
    fn never_exceeds_the_mechanical_limits() {
        let mut head = Head::default();
        // Absurd target far outside the frame.
        let cmd = settle(&mut head, target(50.0, 50.0));
        assert!(cmd.pan_deg >= 20.0 && cmd.pan_deg <= 160.0);
        assert!(cmd.tilt_deg >= 20.0 && cmd.tilt_deg <= 160.0);
    }

    #[test]
    fn movement_is_rate_limited_not_instant() {
        let mut head = Head::default();
        let cmd = head.update(target(1.0, 0.0), 0.02); // one 20ms step
        assert!(
            (cmd.pan_deg - 90.0).abs() <= 180.0 * 0.02 + f32::EPSILON,
            "moved {} degrees in one 20ms step",
            (cmd.pan_deg - 90.0).abs()
        );
    }

    #[test]
    fn a_nonfinite_target_is_ignored_rather_than_obeyed() {
        let mut head = Head::default();
        let cmd = head.update(
            Some(Target {
                x: f32::NAN,
                y: 0.0,
                area: 0.0,
            }),
            0.1,
        );
        assert!(!cmd.tracking);
        assert_eq!(cmd.pan_deg, 90.0);
    }

    #[test]
    fn holds_position_briefly_when_the_target_is_lost() {
        let mut head = Head::default();
        settle(&mut head, target(0.5, 0.0));
        let held = head.pan_deg;
        let cmd = head.update(None, 0.1);
        assert_eq!(cmd.pan_deg, held, "should not snap back immediately");
        assert_eq!(cmd.reason, "target lost, holding briefly");
    }

    #[test]
    fn returns_to_rest_after_the_failsafe_period() {
        let mut head = Head::default();
        settle(&mut head, target(0.6, 0.4));
        let cmd = settle(&mut head, None);
        assert_eq!(cmd.pan_deg, 90.0);
        assert_eq!(cmd.tilt_deg, 90.0);
        assert!(!cmd.tracking);
        assert_eq!(cmd.reason, "failsafe: no target, returning to rest");
    }

    #[test]
    fn parking_is_immediate() {
        let mut head = Head::default();
        settle(&mut head, target(0.9, 0.9));
        let cmd = head.park();
        assert_eq!(cmd.pan_deg, 90.0);
        assert_eq!(cmd.reason, "parked");
    }

    #[test]
    fn tightening_limits_pulls_the_head_into_range() {
        let mut head = Head::default();
        settle(&mut head, target(1.0, 0.0));
        let wide = head.pan_deg;
        head.set_config(HeadConfig {
            pan: AxisLimits {
                min_deg: 85.0,
                max_deg: 95.0,
                ..AxisLimits::default()
            },
            ..HeadConfig::default()
        });
        assert!(head.pan_deg >= 85.0 && head.pan_deg <= 95.0);
        assert_ne!(head.pan_deg, wide);
    }

    #[test]
    fn every_command_explains_itself() {
        let mut head = Head::default();
        assert!(!head.update(target(0.5, 0.0), 0.1).reason.is_empty());
        assert!(!head.update(None, 0.1).reason.is_empty());
    }
}
