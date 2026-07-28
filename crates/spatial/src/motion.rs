//! Which way a tracked object is going, and how fast.
//!
//! Velocity arrives as samples-per-frame in image space. That is awkward to
//! read and depends on the grid size, so it is converted to a compass-style
//! heading plus a speed in fractions-of-frame per second — comparable across
//! cameras and resolutions.

use serde::{Deserialize, Serialize};

/// Speeds below this (fraction of frame per second) read as stationary.
/// Tracker jitter alone produces small non-zero velocities every frame.
const STILL_THRESHOLD: f32 = 0.02;

/// Eight-point heading, which is as much precision as a jittery box supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Heading {
    /// Not moving meaningfully.
    Still,
    /// Toward the top of frame.
    Up,
    /// Toward the top-right.
    UpRight,
    /// Toward the right.
    Right,
    /// Toward the bottom-right.
    DownRight,
    /// Toward the bottom of frame.
    Down,
    /// Toward the bottom-left.
    DownLeft,
    /// Toward the left.
    Left,
    /// Toward the top-left.
    UpLeft,
}

impl Heading {
    /// A short arrow suitable for an overlay label.
    #[must_use]
    pub fn arrow(self) -> &'static str {
        match self {
            Heading::Still => "•",
            Heading::Up => "↑",
            Heading::UpRight => "↗",
            Heading::Right => "→",
            Heading::DownRight => "↘",
            Heading::Down => "↓",
            Heading::DownLeft => "↙",
            Heading::Left => "←",
            Heading::UpLeft => "↖",
        }
    }
}

/// How an object is moving.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MotionVector {
    /// Direction of travel.
    pub heading: Heading,
    /// Speed as a fraction of frame width per second.
    pub speed: f32,
    /// Angle in degrees, 0 = right, 90 = up. Only meaningful when moving.
    pub angle_deg: f32,
}

/// Describe a track's motion.
///
/// `vx`/`vy` are samples per frame in image coordinates, where y grows
/// downward; the returned angle uses the conventional orientation with y up,
/// so "up" reads as 90° rather than -90°.
///
/// # Example
/// ```
/// use spatial::motion::{describe, Heading};
/// // Moving right across a 96-wide grid at 10 fps.
/// let m = describe(4.0, 0.0, 96, 10.0);
/// assert_eq!(m.heading, Heading::Right);
/// ```
#[must_use]
pub fn describe(vx: f32, vy: f32, frame_width: u32, fps: f32) -> MotionVector {
    if !vx.is_finite() || !vy.is_finite() || frame_width == 0 || !fps.is_finite() || fps <= 0.0 {
        return MotionVector {
            heading: Heading::Still,
            speed: 0.0,
            angle_deg: 0.0,
        };
    }
    #[allow(clippy::cast_precision_loss)]
    let width = frame_width as f32;
    let speed = ((vx * vx + vy * vy).sqrt() / width) * fps;
    if speed < STILL_THRESHOLD {
        return MotionVector {
            heading: Heading::Still,
            speed,
            angle_deg: 0.0,
        };
    }

    // Image y grows downward; negate so the angle reads conventionally.
    let angle = (-vy).atan2(vx).to_degrees();
    let normalized = if angle < 0.0 { angle + 360.0 } else { angle };
    let heading = match normalized {
        a if !(22.5..337.5).contains(&a) => Heading::Right,
        a if a < 67.5 => Heading::UpRight,
        a if a < 112.5 => Heading::Up,
        a if a < 157.5 => Heading::UpLeft,
        a if a < 202.5 => Heading::Left,
        a if a < 247.5 => Heading::DownLeft,
        a if a < 292.5 => Heading::Down,
        _ => Heading::DownRight,
    };
    MotionVector {
        heading,
        speed,
        angle_deg: normalized,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    /// Fast enough to clear the stationary threshold on a 96-wide grid.
    const FAST: f32 = 6.0;

    #[test]
    fn all_eight_directions_are_distinguished() {
        let cases = [
            (FAST, 0.0, Heading::Right),
            (FAST, -FAST, Heading::UpRight),
            (0.0, -FAST, Heading::Up),
            (-FAST, -FAST, Heading::UpLeft),
            (-FAST, 0.0, Heading::Left),
            (-FAST, FAST, Heading::DownLeft),
            (0.0, FAST, Heading::Down),
            (FAST, FAST, Heading::DownRight),
        ];
        for (vx, vy, expected) in cases {
            assert_eq!(
                describe(vx, vy, 96, 10.0).heading,
                expected,
                "vx={vx} vy={vy}"
            );
        }
    }

    #[test]
    fn small_jitter_reads_as_stationary() {
        // A tracker box wobbling by a fraction of a sample is not movement.
        assert_eq!(describe(0.05, 0.05, 96, 10.0).heading, Heading::Still);
    }

    #[test]
    fn speed_is_independent_of_grid_size() {
        // Crossing the same fraction of frame per second gives the same speed
        // whether the grid is coarse or fine.
        let coarse = describe(4.8, 0.0, 96, 10.0).speed;
        let fine = describe(9.6, 0.0, 192, 10.0).speed;
        assert!((coarse - fine).abs() < 1e-5, "{coarse} vs {fine}");
    }

    #[test]
    fn speed_scales_with_frame_rate() {
        let slow = describe(FAST, 0.0, 96, 5.0).speed;
        let fast = describe(FAST, 0.0, 96, 10.0).speed;
        assert!((fast - slow * 2.0).abs() < 1e-5);
    }

    #[test]
    fn up_is_ninety_degrees_not_negative() {
        let m = describe(0.0, -FAST, 96, 10.0);
        assert!((m.angle_deg - 90.0).abs() < 0.01, "got {}", m.angle_deg);
    }

    #[test]
    fn nonfinite_or_impossible_inputs_are_treated_as_still() {
        assert_eq!(describe(f32::NAN, 0.0, 96, 10.0).heading, Heading::Still);
        assert_eq!(describe(FAST, 0.0, 0, 10.0).heading, Heading::Still);
        assert_eq!(describe(FAST, 0.0, 96, 0.0).heading, Heading::Still);
    }

    #[test]
    fn every_heading_has_an_arrow() {
        for h in [
            Heading::Still,
            Heading::Up,
            Heading::UpRight,
            Heading::Right,
            Heading::DownRight,
            Heading::Down,
            Heading::DownLeft,
            Heading::Left,
            Heading::UpLeft,
        ] {
            assert!(!h.arrow().is_empty());
        }
    }
}
