//! Object classes and tracked-object state.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Every object class the platform can detect.
///
/// `Custom` carries a user-defined label; `Unknown` is a detection that
/// passed validation but matched no known class.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectClass {
    /// A human being.
    Person,
    /// A dog.
    Dog,
    /// A cat.
    Cat,
    /// A horse.
    Horse,
    /// A bird.
    Bird,
    /// A passenger car.
    Car,
    /// A truck.
    Truck,
    /// A bus.
    Bus,
    /// A motorcycle.
    Motorcycle,
    /// A bicycle.
    Bike,
    /// A delivered package.
    Package,
    /// A door.
    Door,
    /// A window.
    Window,
    /// A weapon.
    Weapon,
    /// Smoke.
    Smoke,
    /// Fire.
    Fire,
    /// A validated detection with no known class.
    Unknown,
    /// A user-trained custom class.
    Custom(String),
}

/// A tracked object with identity, timeline, and confidence history.
///
/// Created by the tracker crate once a detection survives confidence and
/// temporal validation. The `id` is stable across frames.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedObject {
    /// Stable identity across frames.
    pub id: Uuid,
    /// What this object is.
    pub class: ObjectClass,
    /// When the object was first seen.
    pub first_seen: DateTime<Utc>,
    /// When the object was last seen.
    pub last_seen: DateTime<Utc>,
    /// Per-frame confidence values, oldest first.
    pub confidence_history: Vec<f32>,
    /// Frame numbers in which the object appeared, oldest first.
    pub frames: Vec<u64>,
}

impl TrackedObject {
    /// Latest confidence, or 0.0 if no history exists yet.
    #[must_use]
    pub fn current_confidence(&self) -> f32 {
        self.confidence_history.last().copied().unwrap_or(0.0)
    }

    /// True when the object has been seen in at least `n` consecutive frames.
    #[must_use]
    pub fn seen_consecutive(&self, n: usize) -> bool {
        if self.frames.len() < n {
            return false;
        }
        self.frames
            .windows(2)
            .rev()
            .take(n - 1)
            .all(|w| w[1] == w[0] + 1)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn obj(frames: Vec<u64>) -> TrackedObject {
        TrackedObject {
            id: Uuid::new_v4(),
            class: ObjectClass::Person,
            first_seen: Utc::now(),
            last_seen: Utc::now(),
            confidence_history: vec![0.9; frames.len()],
            frames,
        }
    }

    #[test]
    fn consecutive_frames_detected() {
        assert!(obj(vec![45, 46, 47]).seen_consecutive(3));
        assert!(!obj(vec![45, 46, 48]).seen_consecutive(3));
        assert!(!obj(vec![45]).seen_consecutive(3));
    }

    #[test]
    fn class_serializes_snake_case() {
        let json = serde_json::to_string(&ObjectClass::Person).unwrap();
        assert_eq!(json, "\"person\"");
    }

    #[test]
    fn empty_history_confidence_is_zero() {
        assert_eq!(obj(vec![]).current_confidence(), 0.0);
    }
}
