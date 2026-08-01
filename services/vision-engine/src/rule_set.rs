//! Hard-coded / env-configurable rule set for the live engine.
//!
//! Keeps rule construction out of [`crate::engine`] so the hot path only
//! calls [`rules::evaluate`]. Motion tracks are labelled
//! [`schemas::ObjectClass::Unknown`] until a later classify step attaches a
//! real class.
//!
//! # Environment
//!
//! - `WATCHINGEYE_RULE_ZONE` — zone name to match (default `"garage"`)
//! - `WATCHINGEYE_RULE_CLASS` — class name (default `"unknown"`)
//! - `WATCHINGEYE_RULE_HOURS` — optional `"start-end"` inclusive UTC hours
//!   (e.g. `"0-5"`); omitted → no hour condition
//! - `WATCHINGEYE_RULE_CHANNEL` — notify channel (default `"default"`)

use rules::{Action, Condition, Rule};
use schemas::ObjectClass;

/// Build the live rule set from environment variables, falling back to a
/// garage / unknown / notify-default rule.
///
/// # Example
///
/// ```ignore
/// let rules = default_rules();
/// assert_eq!(rules[0].name, "zone-enter-notify");
/// ```
#[must_use]
pub fn default_rules() -> Vec<Rule> {
    let zone = std::env::var("WATCHINGEYE_RULE_ZONE").unwrap_or_else(|_| "garage".into());
    let class =
        parse_class(&std::env::var("WATCHINGEYE_RULE_CLASS").unwrap_or_else(|_| "unknown".into()));
    let channel = std::env::var("WATCHINGEYE_RULE_CHANNEL").unwrap_or_else(|_| "default".into());

    let mut conditions = vec![Condition::IsClass(class), Condition::InZone(zone)];
    if let Ok(raw) = std::env::var("WATCHINGEYE_RULE_HOURS") {
        if let Some((start, end)) = parse_hours(&raw) {
            conditions.push(Condition::HourBetween { start, end });
        }
    }

    vec![Rule {
        name: "zone-enter-notify".into(),
        conditions,
        action: Action::Notify { channel },
    }]
}

fn parse_class(raw: &str) -> ObjectClass {
    match raw.trim().to_ascii_lowercase().as_str() {
        "person" => ObjectClass::Person,
        "dog" => ObjectClass::Dog,
        "cat" => ObjectClass::Cat,
        "car" => ObjectClass::Car,
        "truck" => ObjectClass::Truck,
        "unknown" | "" => ObjectClass::Unknown,
        other => ObjectClass::Custom(other.to_owned()),
    }
}

fn parse_hours(raw: &str) -> Option<(u32, u32)> {
    let (a, b) = raw.trim().split_once('-')?;
    let start: u32 = a.trim().parse().ok()?;
    let end: u32 = b.trim().parse().ok()?;
    if start > 23 || end > 23 {
        return None;
    }
    Some((start, end))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn parsers_accept_known_inputs() {
        assert_eq!(parse_class("unknown"), ObjectClass::Unknown);
        assert_eq!(parse_class("person"), ObjectClass::Person);
        assert_eq!(parse_hours("0-5"), Some((0, 5)));
        assert_eq!(parse_hours("25-1"), None);
    }

    #[test]
    fn default_rules_non_empty() {
        let rules = default_rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].name, "zone-enter-notify");
    }
}
