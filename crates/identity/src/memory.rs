//! REMIND-inspired dual-bank appearance memory.
//!
//! A single blindly-EMA-updated embedding drifts: a run of ambiguous or
//! outright wrong matches slowly drags the stored appearance away from the
//! truth. This module splits storage into a `work` bank (updated whenever a
//! sighting is accepted) and a `stable` bank (promoted only after enough
//! *strong* observations agree), and gates every update by
//! [`MatchQuality`] — an uncertain match must never move memory.
//!
//! This is a single prototype per bank, not the multi-prototype/neighbor
//! graph memory a full REMIND replay buffer would use; that is future work.

use crate::appearance::{cosine_similarity, ema_update, l2_normalize, AppearanceVec, EMA_ALPHA};
use crate::matching::{MatchReport, ACCEPT_THRESHOLD};
use serde::{Deserialize, Serialize};

/// How confidently a sighting matched its winning identity.
///
/// Diagnosed once per [`crate::Registry::observe`] call by
/// [`diagnose_quality`] and used to decide how (or whether) appearance
/// memory should move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MatchQuality {
    /// A clear winner, comfortably ahead of the next candidate.
    Strong,
    /// A match, but another candidate scored almost as well.
    Ambiguous,
    /// No match, or one too weak to trust with an update.
    #[default]
    Weak,
}

/// Lifecycle stage of an identity.
///
/// Every identity starts [`Tentative`](IdentityStatus::Tentative) — created
/// from a single sighting with no corroboration — and graduates to
/// [`Confirmed`](IdentityStatus::Confirmed) once enough strong or repeated
/// observations agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum IdentityStatus {
    /// Created from one sighting; not yet corroborated.
    #[default]
    Tentative,
    /// Corroborated by enough strong or repeated sightings.
    Confirmed,
}

/// Dual-bank appearance memory for one identity.
///
/// `work` absorbs every trustworthy update; `stable` is a conservative
/// snapshot promoted from `work` only after [`PROMOTE_AFTER`] strong
/// observations, so a temporary run of lookalike matches cannot permanently
/// corrupt the reference embedding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppearanceMemory {
    /// Model that produced the embeddings in both banks.
    pub model: String,
    /// Actively updated bank.
    pub work: Vec<f32>,
    /// Conservative bank promoted after enough strong observations.
    #[serde(default)]
    pub stable: Option<Vec<f32>>,
    /// Strong updates applied so far, toward promotion.
    #[serde(default)]
    pub observations: u32,
}

/// Strong observations required before `work` is promoted into `stable`.
pub const PROMOTE_AFTER: u32 = 3;

/// Sightings required to confirm an identity when quality alone does not.
pub const CONFIRM_HITS: u32 = 3;

/// Score at or above which a match is considered decisively strong.
pub const STRONG_SCORE: f32 = 0.75;

/// Gap between the best and next-best score below which a match is ambiguous.
pub const AMBIGUITY_MARGIN: f32 = 0.08;

/// EMA rate used for ambiguous matches — much slower than [`EMA_ALPHA`] so a
/// possibly-wrong match can only nudge memory, never dominate it.
pub const AMBIGUOUS_EMA_ALPHA: f32 = 0.1;

impl AppearanceMemory {
    /// Seed a fresh memory from a single observation.
    ///
    /// The observation becomes the initial `work` bank; `stable` starts
    /// empty because one sighting is never enough to promote.
    ///
    /// # Example
    /// ```
    /// use identity::appearance::AppearanceVec;
    /// use identity::memory::AppearanceMemory;
    ///
    /// let seen = AppearanceVec { model: "clip".into(), values: vec![3.0, 4.0] };
    /// let mem = AppearanceMemory::from_observation(&seen);
    /// assert!((mem.work[0] - 0.6).abs() < 1e-5);
    /// assert!(mem.stable.is_none());
    /// ```
    #[must_use]
    pub fn from_observation(seen: &AppearanceVec) -> Self {
        Self {
            model: seen.model.clone(),
            work: l2_normalize(&seen.values),
            stable: None,
            observations: 0,
        }
    }

    /// Best cosine similarity between `seen` and either bank.
    ///
    /// Returns `None` when the models differ or both banks are empty, so
    /// callers can distinguish "no evidence" from "zero similarity".
    ///
    /// # Example
    /// ```
    /// use identity::appearance::AppearanceVec;
    /// use identity::memory::AppearanceMemory;
    ///
    /// let seed = AppearanceVec { model: "clip".into(), values: vec![1.0, 0.0] };
    /// let mem = AppearanceMemory::from_observation(&seed);
    /// let seen = AppearanceVec { model: "clip".into(), values: vec![1.0, 0.0] };
    /// assert_eq!(mem.best_similarity(&seen), Some(1.0));
    /// ```
    #[must_use]
    pub fn best_similarity(&self, seen: &AppearanceVec) -> Option<f32> {
        if !self.model.eq_ignore_ascii_case(&seen.model) {
            return None;
        }
        let work_sim = cosine_similarity(&self.work, &seen.values);
        let stable_sim = self
            .stable
            .as_deref()
            .and_then(|s| cosine_similarity(s, &seen.values));
        match (work_sim, stable_sim) {
            (Some(w), Some(s)) => Some(w.max(s)),
            (Some(w), None) => Some(w),
            (None, Some(s)) => Some(s),
            (None, None) => None,
        }
    }

    /// Update memory from a fresh sighting, gated by match quality.
    ///
    /// - [`MatchQuality::Weak`]: no-op. An uncertain match must never move
    ///   memory.
    /// - [`MatchQuality::Ambiguous`]: a cautious, slow-rate EMA into `work`
    ///   only; never counts toward promotion.
    /// - [`MatchQuality::Strong`]: a full-rate EMA into `work`, then
    ///   promotes `work` into `stable` once [`PROMOTE_AFTER`] strong
    ///   observations have accumulated.
    ///
    /// A model mismatch between the stored memory and the new sighting is a
    /// no-op, matching [`best_similarity`](Self::best_similarity)'s refusal
    /// to compare across models.
    pub fn apply_update(&mut self, seen: &AppearanceVec, quality: MatchQuality) {
        if !self.model.eq_ignore_ascii_case(&seen.model) {
            return;
        }
        match quality {
            MatchQuality::Weak => {}
            MatchQuality::Ambiguous => {
                if let Some(updated) = ema_update(&self.work, &seen.values, AMBIGUOUS_EMA_ALPHA) {
                    self.work = updated;
                }
            }
            MatchQuality::Strong => {
                if let Some(updated) = ema_update(&self.work, &seen.values, EMA_ALPHA) {
                    self.work = updated;
                }
                self.observations += 1;
                if self.observations >= PROMOTE_AFTER {
                    self.stable = Some(self.work.clone());
                }
            }
        }
    }
}

/// Diagnose match confidence from the winning report and every candidate
/// considered for this sighting (winner, rejected, and refuted alike).
///
/// Rules, applied in order:
/// 1. No winner → [`MatchQuality::Weak`].
/// 2. Among candidates that were not refuted, find the highest score
///    belonging to a different identity than the winner ("second").
/// 3. If the gap between the winner's score and the second's is smaller
///    than [`AMBIGUITY_MARGIN`] → [`MatchQuality::Ambiguous`]: another
///    candidate was nearly as good, so an update should be cautious.
/// 4. Otherwise, a winner scoring at least [`STRONG_SCORE`] is
///    [`MatchQuality::Strong`]; anything lower (but still an accepted
///    match) is [`MatchQuality::Ambiguous`].
///
/// # Example
/// ```
/// use identity::matching::MatchReport;
/// use identity::memory::{diagnose_quality, MatchQuality};
/// use uuid::Uuid;
///
/// let winner = MatchReport {
///     identity_id: Uuid::nil(),
///     score: 0.9,
///     matched: vec![],
///     conflicting: vec![],
///     refuted_by: None,
///     appearance_score: None,
///     quality: MatchQuality::default(),
/// };
/// let quality = diagnose_quality(Some(&winner), std::slice::from_ref(&winner));
/// assert_eq!(quality, MatchQuality::Strong);
/// ```
#[must_use]
pub fn diagnose_quality(winner: Option<&MatchReport>, reports: &[MatchReport]) -> MatchQuality {
    let Some(winner) = winner else {
        return MatchQuality::Weak;
    };
    if winner.score < ACCEPT_THRESHOLD {
        return MatchQuality::Weak;
    }

    let second = reports
        .iter()
        .filter(|r| r.refuted_by.is_none() && r.identity_id != winner.identity_id)
        .map(|r| r.score)
        .fold(None, |best: Option<f32>, score| {
            Some(best.map_or(score, |b| b.max(score)))
        });

    if let Some(second_score) = second {
        if winner.score - second_score < AMBIGUITY_MARGIN {
            return MatchQuality::Ambiguous;
        }
    }

    if winner.score >= STRONG_SCORE {
        MatchQuality::Strong
    } else {
        MatchQuality::Ambiguous
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use uuid::Uuid;

    fn app(model: &str, values: Vec<f32>) -> AppearanceVec {
        AppearanceVec {
            model: model.into(),
            values,
        }
    }

    fn report(id: u128, score: f32, refuted: bool) -> MatchReport {
        MatchReport {
            identity_id: Uuid::from_u128(id),
            score,
            matched: vec![],
            conflicting: vec![],
            refuted_by: refuted.then(|| "license_plate".to_string()),
            appearance_score: None,
            quality: MatchQuality::default(),
        }
    }

    #[test]
    fn from_observation_seeds_work_and_leaves_stable_empty() {
        let mem = AppearanceMemory::from_observation(&app("clip", vec![3.0, 4.0]));
        assert!((mem.work[0] - 0.6).abs() < 1e-5);
        assert!(mem.stable.is_none());
        assert_eq!(mem.observations, 0);
    }

    #[test]
    fn best_similarity_prefers_the_higher_bank() {
        let mut mem = AppearanceMemory::from_observation(&app("clip", vec![0.0, 1.0]));
        mem.stable = Some(vec![1.0, 0.0]);
        let sim = mem.best_similarity(&app("clip", vec![1.0, 0.0])).unwrap();
        assert!((sim - 1.0).abs() < 1e-5);
    }

    #[test]
    fn best_similarity_rejects_model_mismatch() {
        let mem = AppearanceMemory::from_observation(&app("clip", vec![1.0, 0.0]));
        assert!(mem.best_similarity(&app("dino", vec![1.0, 0.0])).is_none());
    }

    #[test]
    fn weak_update_is_a_no_op() {
        let mut mem = AppearanceMemory::from_observation(&app("clip", vec![1.0, 0.0]));
        let before = mem.clone();
        mem.apply_update(&app("clip", vec![0.0, 1.0]), MatchQuality::Weak);
        assert_eq!(mem, before);
    }

    #[test]
    fn ambiguous_update_moves_work_slowly_and_never_promotes() {
        let mut mem = AppearanceMemory::from_observation(&app("clip", vec![1.0, 0.0]));
        for _ in 0..10 {
            mem.apply_update(&app("clip", vec![0.0, 1.0]), MatchQuality::Ambiguous);
        }
        assert!(mem.stable.is_none());
        assert_eq!(mem.observations, 0);
        // Ten slow nudges move it, but nowhere near fully onto the new vector.
        assert!(mem.work[0] > 0.0);
    }

    #[test]
    fn strong_updates_promote_after_threshold() {
        let mut mem = AppearanceMemory::from_observation(&app("clip", vec![1.0, 0.0]));
        for i in 0..PROMOTE_AFTER {
            assert!(mem.stable.is_none(), "must not promote early at {i}");
            mem.apply_update(&app("clip", vec![1.0, 0.0]), MatchQuality::Strong);
        }
        assert!(mem.stable.is_some());
        assert_eq!(mem.observations, PROMOTE_AFTER);
    }

    #[test]
    fn model_mismatch_update_is_a_no_op() {
        let mut mem = AppearanceMemory::from_observation(&app("clip", vec![1.0, 0.0]));
        let before = mem.clone();
        mem.apply_update(&app("dino", vec![0.0, 1.0]), MatchQuality::Strong);
        assert_eq!(mem, before);
    }

    #[test]
    fn diagnose_no_winner_is_weak() {
        assert_eq!(diagnose_quality(None, &[]), MatchQuality::Weak);
    }

    #[test]
    fn diagnose_lone_high_score_is_strong() {
        let winner = report(1, 0.9, false);
        let reports = vec![winner.clone()];
        assert_eq!(
            diagnose_quality(Some(&winner), &reports),
            MatchQuality::Strong
        );
    }

    #[test]
    fn diagnose_close_runner_up_is_ambiguous() {
        let winner = report(1, 0.9, false);
        let runner_up = report(2, 0.85, false);
        let reports = vec![winner.clone(), runner_up];
        assert_eq!(
            diagnose_quality(Some(&winner), &reports),
            MatchQuality::Ambiguous
        );
    }

    #[test]
    fn diagnose_distant_runner_up_is_strong() {
        let winner = report(1, 0.9, false);
        let runner_up = report(2, 0.5, false);
        let reports = vec![winner.clone(), runner_up];
        assert_eq!(
            diagnose_quality(Some(&winner), &reports),
            MatchQuality::Strong
        );
    }

    #[test]
    fn diagnose_refuted_runner_up_is_ignored() {
        let winner = report(1, 0.9, false);
        let refuted = report(2, 0.99, true);
        let reports = vec![winner.clone(), refuted];
        assert_eq!(
            diagnose_quality(Some(&winner), &reports),
            MatchQuality::Strong
        );
    }

    #[test]
    fn diagnose_moderate_score_without_rival_is_ambiguous() {
        let winner = report(1, 0.65, false);
        let reports = vec![winner.clone()];
        assert_eq!(
            diagnose_quality(Some(&winner), &reports),
            MatchQuality::Ambiguous
        );
    }

    #[test]
    fn diagnose_below_accept_threshold_is_weak() {
        // Defensive: should not happen since winners already clear the
        // threshold, but the diagnosis must not fabricate confidence.
        let winner = report(1, 0.4, false);
        let reports = vec![winner.clone()];
        assert_eq!(
            diagnose_quality(Some(&winner), &reports),
            MatchQuality::Weak
        );
    }
}
