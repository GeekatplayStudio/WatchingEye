//! Deterministic identity matching.
//!
//! Given the attributes observed on a sighting, decide whether it is a known
//! individual or someone new. No model participates in this decision — a
//! vision model may describe what it sees, but "is this the same dog as
//! yesterday" is answered by arithmetic that can be replayed and audited.
//!
//! The result always carries which attributes agreed and which conflicted,
//! so any identification can be argued with.

use crate::descriptor::{strength_of, Descriptor, Strength};
use crate::memory::MatchQuality;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Score at or above which a sighting is accepted as a known identity.
pub const ACCEPT_THRESHOLD: f32 = 0.6;

/// Why a candidate was or was not accepted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MatchReport {
    /// Candidate identity considered.
    pub identity_id: Uuid,
    /// Agreement score in `[0.0, 1.0]`.
    pub score: f32,
    /// Attribute keys that agreed.
    pub matched: Vec<String>,
    /// Attribute keys that disagreed.
    pub conflicting: Vec<String>,
    /// Set when a distinctive attribute ruled the candidate out.
    pub refuted_by: Option<String>,
    /// Cosine similarity of appearance embeddings, when both sides had one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance_score: Option<f32>,
    /// Confidence diagnosis, filled in by [`crate::memory::diagnose_quality`]
    /// for the winning report. Defaults to [`MatchQuality::Weak`] until then.
    #[serde(default)]
    pub quality: MatchQuality,
}

impl MatchReport {
    /// Whether this candidate is an acceptable match.
    #[must_use]
    pub fn is_match(&self) -> bool {
        self.refuted_by.is_none() && self.score >= ACCEPT_THRESHOLD
    }
}

/// Compare a sighting's attributes against a known identity's.
///
/// Only attributes present on *both* sides can contribute; an attribute the
/// observer did not record is missing evidence, never evidence of a
/// difference. A conflicting distinctive attribute (a different licence
/// plate) refutes the candidate outright regardless of everything else.
///
/// # Example
/// ```
/// use identity::descriptor::Descriptor;
/// use identity::matching::compare;
/// use uuid::Uuid;
///
/// let known = vec![Descriptor::new("license_plate", "123ABC")];
/// let seen = vec![Descriptor::new("license_plate", "123ABC")];
/// let report = compare(Uuid::nil(), &known, &seen);
/// assert!(report.is_match());
/// ```
#[must_use]
pub fn compare(identity_id: Uuid, known: &[Descriptor], seen: &[Descriptor]) -> MatchReport {
    let mut matched_weight = 0.0_f32;
    let mut total_weight = 0.0_f32;
    let mut matched = Vec::new();
    let mut conflicting = Vec::new();
    let mut refuted_by = None;

    for observed in seen {
        let Some(reference) = known.iter().find(|k| k.key == observed.key) else {
            continue; // not previously recorded — no evidence either way
        };
        let strength = strength_of(&observed.key);
        total_weight += strength.weight();
        if reference.value == observed.value {
            matched_weight += strength.weight();
            matched.push(observed.key.clone());
        } else {
            conflicting.push(observed.key.clone());
            if strength == Strength::Distinctive && refuted_by.is_none() {
                refuted_by = Some(observed.key.clone());
            }
        }
    }

    let score = if total_weight > 0.0 {
        matched_weight / total_weight
    } else {
        0.0
    };
    MatchReport {
        identity_id,
        score,
        matched,
        conflicting,
        refuted_by,
        appearance_score: None,
        quality: MatchQuality::default(),
    }
}

/// Pick the best candidate among several, or `None` if none qualify.
///
/// Deterministic: the highest score wins, ties break toward the candidate
/// with more matched attributes, then by id, so the same inputs always
/// produce the same answer.
#[must_use]
pub fn best_match(reports: Vec<MatchReport>) -> Option<MatchReport> {
    reports
        .into_iter()
        .filter(MatchReport::is_match)
        .max_by(|a, b| {
            a.score
                .partial_cmp(&b.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.matched.len().cmp(&b.matched.len()))
                .then(b.identity_id.cmp(&a.identity_id))
        })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn d(key: &str, value: &str) -> Descriptor {
        Descriptor::new(key, value)
    }

    #[test]
    fn identical_distinctive_attribute_is_a_match() {
        let r = compare(
            Uuid::nil(),
            &[d("license_plate", "123ABC")],
            &[d("license_plate", "123abc")],
        );
        assert!(r.is_match());
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn a_different_plate_refutes_everything_else() {
        // Same make, model, and colour — but it is not the same car.
        let known = vec![
            d("license_plate", "123ABC"),
            d("vehicle_make", "subaru"),
            d("vehicle_color", "green"),
        ];
        let seen = vec![
            d("license_plate", "999XYZ"),
            d("vehicle_make", "subaru"),
            d("vehicle_color", "green"),
        ];
        let r = compare(Uuid::nil(), &known, &seen);
        assert!(!r.is_match());
        assert_eq!(r.refuted_by, Some("license_plate".into()));
    }

    #[test]
    fn unobserved_attributes_are_not_evidence_of_difference() {
        let known = vec![d("fur_color", "brown"), d("breed", "shiba")];
        let seen = vec![d("fur_color", "brown")]; // breed simply not seen
        let r = compare(Uuid::nil(), &known, &seen);
        assert!(r.is_match());
        assert!(r.conflicting.is_empty());
    }

    #[test]
    fn weak_attributes_alone_do_not_confirm_identity() {
        let known = vec![d("size", "medium"), d("fur_color", "brown")];
        let seen = vec![d("size", "medium"), d("fur_color", "black")];
        let r = compare(Uuid::nil(), &known, &seen);
        // 0.5 weak matched vs 1.5 supporting conflicting = 0.25.
        assert!(!r.is_match());
        assert_eq!(r.conflicting, vec!["fur_color"]);
    }

    #[test]
    fn no_shared_attributes_scores_zero() {
        let r = compare(
            Uuid::nil(),
            &[d("fur_color", "brown")],
            &[d("vehicle_make", "subaru")],
        );
        assert_eq!(r.score, 0.0);
        assert!(!r.is_match());
    }

    #[test]
    fn report_names_what_agreed_and_what_did_not() {
        let known = vec![d("fur_color", "brown"), d("accessory", "red_collar")];
        let seen = vec![d("fur_color", "brown"), d("accessory", "blue_collar")];
        let r = compare(Uuid::nil(), &known, &seen);
        assert_eq!(r.matched, vec!["fur_color"]);
        assert_eq!(r.conflicting, vec!["accessory"]);
    }

    #[test]
    fn best_match_picks_the_strongest_candidate() {
        let weak = MatchReport {
            identity_id: Uuid::from_u128(1),
            score: 0.7,
            matched: vec!["fur_color".into()],
            conflicting: vec![],
            refuted_by: None,
            appearance_score: None,
            quality: MatchQuality::default(),
        };
        let strong = MatchReport {
            identity_id: Uuid::from_u128(2),
            score: 0.95,
            matched: vec!["fur_color".into(), "breed".into()],
            conflicting: vec![],
            refuted_by: None,
            appearance_score: None,
            quality: MatchQuality::default(),
        };
        let best = best_match(vec![weak, strong]).unwrap();
        assert_eq!(best.identity_id, Uuid::from_u128(2));
    }

    #[test]
    fn best_match_returns_none_when_nothing_qualifies() {
        let poor = MatchReport {
            identity_id: Uuid::from_u128(1),
            score: 0.2,
            matched: vec![],
            conflicting: vec!["fur_color".into()],
            refuted_by: None,
            appearance_score: None,
            quality: MatchQuality::default(),
        };
        assert!(best_match(vec![poor]).is_none());
    }

    #[test]
    fn a_refuted_candidate_never_wins_however_high_it_scores() {
        let refuted = MatchReport {
            identity_id: Uuid::from_u128(1),
            score: 0.99,
            matched: vec!["vehicle_make".into()],
            conflicting: vec!["license_plate".into()],
            refuted_by: Some("license_plate".into()),
            appearance_score: None,
            quality: MatchQuality::default(),
        };
        assert!(best_match(vec![refuted]).is_none());
    }
}
