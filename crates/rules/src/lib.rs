//! Deterministic rule engine.
//!
//! Rules are declarative data (deserializable from config), evaluated with
//! pure functions — same inputs always produce the same actions. Example:
//!
//! ```
//! use rules::{Condition, Rule, Action, evaluate};
//! use schemas::ObjectClass;
//! use events::{Event, EventKind};
//! use uuid::Uuid;
//!
//! let rule = Rule {
//!     name: "night-garage-person".into(),
//!     conditions: vec![
//!         Condition::IsClass(ObjectClass::Person),
//!         Condition::InZone("garage".into()),
//!         Condition::HourBetween { start: 0, end: 5 },
//!     ],
//!     action: Action::Notify { channel: "default".into() },
//! };
//! let event = Event::new(
//!     Uuid::new_v4(),
//!     ObjectClass::Person,
//!     EventKind::EnteredZone { zone: "garage".into() },
//!     "cam-1",
//! );
//! // Fires only if the event hour is within [0, 5].
//! let _actions = evaluate(&[rule], &event);
//! ```

use chrono::Timelike;
use events::{Event, EventKind};
use schemas::ObjectClass;
use serde::{Deserialize, Serialize};

pub use uuid;

/// A single condition. All conditions in a rule must hold (AND semantics).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    /// Object is of this class.
    IsClass(ObjectClass),
    /// Event is an `EnteredZone` for this zone.
    InZone(String),
    /// Event hour-of-day (UTC) is within `[start, end]` inclusive.
    HourBetween {
        /// Start hour, 0–23.
        start: u32,
        /// End hour, 0–23.
        end: u32,
    },
}

/// Action produced when a rule fires. Executed elsewhere, never here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Send a notification on the named channel.
    Notify {
        /// Notification channel name.
        channel: String,
    },
    /// Record the event without notifying.
    LogOnly,
}

/// A declarative rule: IF all conditions THEN action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    /// Unique human-readable rule name.
    pub name: String,
    /// Conditions combined with AND.
    pub conditions: Vec<Condition>,
    /// Action when the rule fires.
    pub action: Action,
}

/// True when the condition holds for the event. Pure function.
#[must_use]
fn matches(cond: &Condition, event: &Event) -> bool {
    match cond {
        Condition::IsClass(class) => &event.class == class,
        Condition::InZone(zone) => {
            matches!(&event.kind, EventKind::EnteredZone { zone: z } if z == zone)
        }
        Condition::HourBetween { start, end } => {
            let hour = event.timestamp.hour();
            hour >= *start && hour <= *end
        }
    }
}

/// Evaluate all rules against one event; return actions of rules that fired.
/// Deterministic: output order follows rule order.
#[must_use]
pub fn evaluate(rules: &[Rule], event: &Event) -> Vec<Action> {
    rules
        .iter()
        .filter(|r| r.conditions.iter().all(|c| matches(c, event)))
        .map(|r| r.action.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use uuid::Uuid;

    fn garage_event(class: ObjectClass) -> Event {
        Event::new(
            Uuid::new_v4(),
            class,
            EventKind::EnteredZone {
                zone: "garage".into(),
            },
            "cam-1",
        )
    }

    fn person_garage_rule() -> Rule {
        Rule {
            name: "person-in-garage".into(),
            conditions: vec![
                Condition::IsClass(ObjectClass::Person),
                Condition::InZone("garage".into()),
            ],
            action: Action::Notify {
                channel: "default".into(),
            },
        }
    }

    #[test]
    fn rule_fires_when_all_conditions_match() {
        let actions = evaluate(&[person_garage_rule()], &garage_event(ObjectClass::Person));
        assert_eq!(
            actions,
            vec![Action::Notify {
                channel: "default".into()
            }]
        );
    }

    #[test]
    fn rule_skips_wrong_class() {
        let actions = evaluate(&[person_garage_rule()], &garage_event(ObjectClass::Dog));
        assert!(actions.is_empty());
    }

    #[test]
    fn hour_window_is_inclusive() {
        let mut event = garage_event(ObjectClass::Person);
        event.timestamp = event
            .timestamp
            .with_hour(3)
            .and_then(|t| t.with_minute(0))
            .unwrap();
        let mut rule = person_garage_rule();
        rule.conditions
            .push(Condition::HourBetween { start: 0, end: 5 });
        assert_eq!(evaluate(&[rule], &event).len(), 1);
    }
}
