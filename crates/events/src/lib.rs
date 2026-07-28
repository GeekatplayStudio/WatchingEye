//! Event engine — typed lifecycle events emitted by the detection pipeline.
//!
//! Events are the only way state changes propagate between subsystems.
//! Every event is serializable, timestamped, and tied to a tracked object.

use chrono::{DateTime, Utc};
use schemas::ObjectClass;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// What happened. Mirrors the PRD event list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum EventKind {
    /// Object newly detected and validated.
    Detected,
    /// Tracker lost the object.
    Lost,
    /// Object entered a named zone.
    EnteredZone {
        /// Zone name, e.g. `"garage"`.
        zone: String,
    },
    /// Object exited a named zone.
    ExitedZone {
        /// Zone name.
        zone: String,
    },
    /// Object stopped moving.
    Stopped,
    /// Object is running.
    Running,
    /// A vehicle parked.
    VehicleParked,
    /// A previously-seen object disappeared.
    ObjectRemoved,
    /// An animal appeared.
    AnimalAppeared,
    /// A validated detection with no known class.
    UnknownObject,
}

/// A pipeline event: the unit of communication between subsystems.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Unique event id.
    pub id: Uuid,
    /// Tracked object this event concerns.
    pub object_id: Uuid,
    /// Class of the object at event time.
    pub class: ObjectClass,
    /// What happened.
    pub kind: EventKind,
    /// When it happened.
    pub timestamp: DateTime<Utc>,
    /// Camera that observed it.
    pub camera_id: String,
}

impl Event {
    /// Create a new event with a fresh id, stamped now.
    #[must_use]
    pub fn new(object_id: Uuid, class: ObjectClass, kind: EventKind, camera_id: &str) -> Self {
        Self {
            id: Uuid::new_v4(),
            object_id,
            class,
            kind,
            timestamp: Utc::now(),
            camera_id: camera_id.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn zone_event_tags_serialize() {
        let e = Event::new(
            Uuid::new_v4(),
            ObjectClass::Person,
            EventKind::EnteredZone {
                zone: "garage".into(),
            },
            "cam-1",
        );
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"kind\":\"entered_zone\""));
        assert!(json.contains("\"zone\":\"garage\""));
    }
}
