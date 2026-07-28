//! Object tracking and the super-agent trigger gate.
//!
//! The tracker turns per-frame detections into [`TrackedObject`]s with
//! stable identity, and decides — deterministically — when an object has
//! earned a super-agent invocation. The agent NEVER runs continuously; it
//! runs only when [`TriggerGate::should_trigger`] returns `true`.

pub mod association;

use schemas::{Detection, TrackedObject};
use std::collections::HashMap;
use uuid::Uuid;

/// The deterministic gate in front of the super agent.
///
/// Mirrors the PRD: confidence above threshold AND seen in N consecutive
/// frames. Motion/tracking-stability gates plug in as further fields.
#[derive(Debug, Clone)]
pub struct TriggerGate {
    /// Minimum current confidence (PRD default: 0.95).
    pub min_confidence: f32,
    /// Required consecutive frames (PRD default: 3).
    pub consecutive_frames: usize,
}

impl Default for TriggerGate {
    fn default() -> Self {
        Self {
            min_confidence: 0.95,
            consecutive_frames: 3,
        }
    }
}

impl TriggerGate {
    /// True when the object satisfies every gate condition. Pure.
    #[must_use]
    pub fn should_trigger(&self, object: &TrackedObject) -> bool {
        object.current_confidence() >= self.min_confidence
            && object.seen_consecutive(self.consecutive_frames)
    }
}

/// Minimal single-camera tracker: associates detections to objects by class.
///
/// This is the naive baseline; IoU/appearance matching replaces the
/// association strategy behind the same API.
#[derive(Debug, Default)]
pub struct Tracker {
    objects: HashMap<Uuid, TrackedObject>,
}

impl Tracker {
    /// Create an empty tracker.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Ingest one validated detection, updating or creating a tracked object.
    /// Returns the id of the object it was associated with.
    pub fn observe(&mut self, detection: &Detection) -> Uuid {
        let existing = self
            .objects
            .values_mut()
            .find(|o| o.class == detection.class);
        if let Some(obj) = existing {
            obj.last_seen = detection.timestamp;
            obj.confidence_history.push(detection.confidence);
            obj.frames.push(detection.frame);
            obj.id
        } else {
            let id = Uuid::new_v4();
            self.objects.insert(
                id,
                TrackedObject {
                    id,
                    class: detection.class.clone(),
                    first_seen: detection.timestamp,
                    last_seen: detection.timestamp,
                    confidence_history: vec![detection.confidence],
                    frames: vec![detection.frame],
                },
            );
            id
        }
    }

    /// Look up a tracked object by id.
    #[must_use]
    pub fn get(&self, id: Uuid) -> Option<&TrackedObject> {
        self.objects.get(&id)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use chrono::Utc;
    use schemas::detection::BoundingBox;
    use schemas::ObjectClass;

    fn det(frame: u64, confidence: f32) -> Detection {
        Detection {
            class: ObjectClass::Person,
            confidence,
            bbox: BoundingBox {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            frame,
            model: "test".into(),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn same_class_reuses_identity() {
        let mut t = Tracker::new();
        let a = t.observe(&det(1, 0.9));
        let b = t.observe(&det(2, 0.9));
        assert_eq!(a, b);
    }

    #[test]
    fn gate_requires_confidence_and_consecutive_frames() {
        let mut t = Tracker::new();
        let gate = TriggerGate::default();
        let id = t.observe(&det(45, 0.98));
        assert!(!gate.should_trigger(t.get(id).unwrap()));
        t.observe(&det(46, 0.97));
        t.observe(&det(47, 0.99));
        assert!(gate.should_trigger(t.get(id).unwrap()));
    }

    #[test]
    fn gate_rejects_low_confidence_even_when_stable() {
        let mut t = Tracker::new();
        let gate = TriggerGate::default();
        let id = t.observe(&det(1, 0.98));
        t.observe(&det(2, 0.98));
        t.observe(&det(3, 0.80));
        assert!(!gate.should_trigger(t.get(id).unwrap()));
    }
}
