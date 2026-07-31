//! Object tracking and the super-agent trigger gate.
//!
//! The tracker turns per-frame detections into [`TrackedObject`]s with
//! stable identity, and decides — deterministically — when an object has
//! earned a super-agent invocation. The agent NEVER runs continuously; it
//! runs only when [`TriggerGate::should_trigger`] returns `true`.

pub mod association;

use schemas::detection::BoundingBox;
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

/// Single-camera object tracker with spatial overlap (`IoU`) association.
#[derive(Debug, Clone)]
struct ActiveTrack {
    object: TrackedObject,
    last_bbox: BoundingBox,
}

/// Single-camera tracker associating detections to tracks using spatial overlap.
#[derive(Debug)]
pub struct Tracker {
    objects: HashMap<Uuid, ActiveTrack>,
    min_iou: f32,
}

impl Default for Tracker {
    fn default() -> Self {
        Self {
            objects: HashMap::new(),
            min_iou: 0.25,
        }
    }
}

impl Tracker {
    /// Create an empty tracker with default threshold.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a tracker with explicit minimum `IoU` threshold.
    #[must_use]
    pub fn with_min_iou(min_iou: f32) -> Self {
        Self {
            objects: HashMap::new(),
            min_iou,
        }
    }

    /// Ingest one validated detection, updating or creating a tracked object.
    /// Returns the id of the object it was associated with.
    pub fn observe(&mut self, detection: &Detection) -> Uuid {
        let matched_id = self.objects.values().find_map(|track| {
            if track.object.class == detection.class {
                let overlap = association::iou(&track.last_bbox, &detection.bbox);
                if overlap >= self.min_iou {
                    Some(track.object.id)
                } else {
                    let dc_x = detection.bbox.x + detection.bbox.width / 2.0;
                    let dc_y = detection.bbox.y + detection.bbox.height / 2.0;
                    let tc_x = track.last_bbox.x + track.last_bbox.width / 2.0;
                    let tc_y = track.last_bbox.y + track.last_bbox.height / 2.0;
                    let dist = ((dc_x - tc_x).powi(2) + (dc_y - tc_y).powi(2)).sqrt();
                    let max_dim = detection.bbox.width.max(detection.bbox.height);
                    if max_dim > 0.0 && dist <= max_dim * 1.5 {
                        Some(track.object.id)
                    } else {
                        None
                    }
                }
            } else {
                None
            }
        });

        if let Some(id) = matched_id {
            if let Some(track) = self.objects.get_mut(&id) {
                track.object.last_seen = detection.timestamp;
                track.object.confidence_history.push(detection.confidence);
                track.object.frames.push(detection.frame);
                track.last_bbox = detection.bbox;
            }
            id
        } else {
            let id = Uuid::new_v4();
            self.objects.insert(
                id,
                ActiveTrack {
                    object: TrackedObject {
                        id,
                        class: detection.class.clone(),
                        first_seen: detection.timestamp,
                        last_seen: detection.timestamp,
                        confidence_history: vec![detection.confidence],
                        frames: vec![detection.frame],
                    },
                    last_bbox: detection.bbox,
                },
            );
            id
        }
    }

    /// Look up a tracked object by id.
    #[must_use]
    pub fn get(&self, id: Uuid) -> Option<&TrackedObject> {
        self.objects.get(&id).map(|t| &t.object)
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

    #[test]
    fn two_separated_people_get_distinct_tracks() {
        let mut t = Tracker::with_min_iou(0.5);
        let mut p1 = det(1, 0.9);
        p1.bbox = BoundingBox {
            x: 0.0,
            y: 0.0,
            width: 0.2,
            height: 0.2,
        };
        let mut p2 = det(1, 0.9);
        p2.bbox = BoundingBox {
            x: 0.8,
            y: 0.8,
            width: 0.2,
            height: 0.2,
        };

        let id1 = t.observe(&p1);
        let id2 = t.observe(&p2);
        assert_ne!(id1, id2);
    }
}
