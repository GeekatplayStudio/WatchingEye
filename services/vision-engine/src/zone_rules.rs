//! Evaluate zone-enter events against the rule set and build notify payloads.
//!
//! Pure relative to HTTP: returns actions + payloads; [`crate::notify`] delivers.

use crate::notify::{payload_from_event, NotifyPayload};
use events::{Event, EventKind};
use rules::{Action, Rule};
use schemas::{Evidence, ObjectClass};
use uuid::Uuid;

/// One rule action ready for asynchronous webhook delivery.
#[derive(Debug, Clone)]
pub struct PendingNotify {
    /// Action the rule engine emitted.
    pub action: Action,
    /// JSON body to POST (or ignore for `LogOnly`).
    pub payload: NotifyPayload,
}

/// Turn zone-enter hits into events, evaluate rules, and collect pending notifies.
///
/// Motion tracks use [`ObjectClass::Unknown`] until classify attaches a class.
#[must_use]
pub fn process_zone_enters(
    camera_id: &str,
    enters: &[(Uuid, String)],
    rules: &[Rule],
) -> (Vec<Event>, Vec<PendingNotify>) {
    let mut events = Vec::with_capacity(enters.len());
    let mut pending = Vec::new();

    for (track_id, zone) in enters {
        let event = Event::new(
            *track_id,
            ObjectClass::Unknown,
            EventKind::EnteredZone { zone: zone.clone() },
            camera_id,
        );
        let evidence = vec![Evidence {
            label: "entered_zone".into(),
            description: format!("Track centroid entered zone {zone}"),
        }];
        let actions = rules::evaluate(rules, &event);
        for action in actions {
            let channel = match &action {
                Action::Notify { channel } => channel.as_str(),
                Action::LogOnly => "log",
            };
            let payload = payload_from_event(&event, channel, evidence.clone());
            pending.push(PendingNotify { action, payload });
        }
        events.push(event);
    }

    (events, pending)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use rules::{Condition, Rule};

    fn garage_rule() -> Rule {
        Rule {
            name: "test".into(),
            conditions: vec![
                Condition::IsClass(ObjectClass::Unknown),
                Condition::InZone("garage".into()),
            ],
            action: Action::Notify {
                channel: "default".into(),
            },
        }
    }

    #[test]
    fn matching_enter_produces_notify() {
        let id = Uuid::new_v4();
        let (events, pending) =
            process_zone_enters("cam-1", &[(id, "garage".into())], &[garage_rule()]);
        assert_eq!(events.len(), 1);
        assert_eq!(pending.len(), 1);
        assert!(matches!(
            pending[0].action,
            Action::Notify { ref channel } if channel == "default"
        ));
        assert_eq!(pending[0].payload.zone.as_deref(), Some("garage"));
        assert_eq!(pending[0].payload.camera_id, "cam-1");
    }

    #[test]
    fn wrong_zone_produces_no_actions() {
        let id = Uuid::new_v4();
        let (_events, pending) =
            process_zone_enters("cam-1", &[(id, "driveway".into())], &[garage_rule()]);
        assert!(pending.is_empty());
    }
}
