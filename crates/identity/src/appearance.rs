//! Hybrid appearance embeddings for re-identification.
//!
//! Appearance vectors supplement attribute matching with deterministic
//! cosine similarity. Distinctive attribute refutes still win outright.

use crate::matching::MatchReport;
use crate::memory::AppearanceMemory;
use serde::{Deserialize, Serialize};

/// Weight given to attribute agreement when both signals are present.
pub const ATTR_WEIGHT: f32 = 0.4;

/// Weight given to appearance similarity when both signals are present.
pub const APPEAR_WEIGHT: f32 = 0.6;

/// Smoothing factor when updating a stored embedding from a new sighting.
pub const EMA_ALPHA: f32 = 0.3;

/// Minimum cosine similarity to record `"appearance"` as matched evidence.
const APPEAR_MATCH_THRESHOLD: f32 = 0.72;

const NORM_EPS: f32 = 1e-8;

/// A model-produced appearance embedding attached to a sighting or identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppearanceVec {
    /// Model that produced the embedding, e.g. `"clip-vit-b32"`.
    pub model: String,
    /// L2-normalized or raw embedding components.
    pub values: Vec<f32>,
}

/// Cosine similarity between two vectors.
///
/// Returns `None` when either slice is empty or lengths differ. Returns
/// `Some(0.0)` when either vector has near-zero norm.
///
/// # Example
/// ```
/// use identity::appearance::cosine_similarity;
///
/// let a = [1.0, 0.0];
/// let b = [1.0, 0.0];
/// assert_eq!(cosine_similarity(&a, &b), Some(1.0));
/// ```
#[must_use]
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> Option<f32> {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return None;
    }
    let norm_a = l2_norm(a);
    let norm_b = l2_norm(b);
    if norm_a < NORM_EPS || norm_b < NORM_EPS {
        return Some(0.0);
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    Some(dot / (norm_a * norm_b))
}

/// L2-normalize a vector in place logically (returns a new vec).
///
/// Near-zero input yields an all-zero vector of the same length.
///
/// # Example
/// ```
/// use identity::appearance::l2_normalize;
///
/// let out = l2_normalize(&[3.0, 4.0]);
/// assert!((out[0] - 0.6).abs() < 1e-5);
/// assert!((out[1] - 0.8).abs() < 1e-5);
/// ```
#[must_use]
pub fn l2_normalize(values: &[f32]) -> Vec<f32> {
    let norm = l2_norm(values);
    if norm < NORM_EPS {
        vec![0.0; values.len()]
    } else {
        values.iter().map(|v| v / norm).collect()
    }
}

/// Exponential moving average of two same-length vectors, then L2-normalized.
///
/// `alpha` is clamped to `[0.0, 1.0]`. Returns `None` when lengths differ.
///
/// # Example
/// ```
/// use identity::appearance::ema_update;
///
/// let existing = [1.0, 0.0];
/// let observed = [0.0, 1.0];
/// let blended = ema_update(&existing, &observed, 0.5).unwrap();
/// assert_eq!(blended.len(), 2);
/// ```
#[must_use]
pub fn ema_update(existing: &[f32], observed: &[f32], alpha: f32) -> Option<Vec<f32>> {
    if existing.len() != observed.len() {
        return None;
    }
    let alpha = alpha.clamp(0.0, 1.0);
    let blended: Vec<f32> = existing
        .iter()
        .zip(observed.iter())
        .map(|(e, o)| (1.0 - alpha) * e + alpha * o)
        .collect();
    Some(l2_normalize(&blended))
}

/// Fuse attribute and appearance scores into one [`MatchReport`].
///
/// When either side is missing, models differ, or both memory banks are
/// empty, the report is returned unchanged (no `appearance_score`). When a
/// distinctive attribute refutes the candidate, the attribute score is
/// preserved and only `appearance_score` is attached.
///
/// # Example
/// ```
/// use identity::appearance::{fuse_appearance, AppearanceVec};
/// use identity::matching::MatchReport;
/// use identity::memory::AppearanceMemory;
/// use uuid::Uuid;
///
/// let report = MatchReport {
///     identity_id: Uuid::nil(),
///     score: 0.0,
///     matched: vec![],
///     conflicting: vec![],
///     refuted_by: None,
///     appearance_score: None,
///     quality: Default::default(),
/// };
/// let seen = AppearanceVec {
///     model: "clip".into(),
///     values: vec![1.0, 0.0],
/// };
/// let known = AppearanceMemory::from_observation(&seen);
/// let fused = fuse_appearance(report, Some(&known), Some(&seen));
/// assert!(fused.is_match());
/// assert_eq!(fused.appearance_score, Some(1.0));
/// ```
#[must_use]
pub fn fuse_appearance(
    mut report: MatchReport,
    known: Option<&AppearanceMemory>,
    seen: Option<&AppearanceVec>,
) -> MatchReport {
    let (Some(k), Some(s)) = (known, seen) else {
        return report;
    };
    let Some(cos) = k.best_similarity(s) else {
        return report;
    };
    let appear = cos.max(0.0);
    report.appearance_score = Some(appear);

    if report.refuted_by.is_some() {
        return report;
    }

    let attr_score = report.score;
    let no_attr_evidence =
        attr_score == 0.0 && report.matched.is_empty() && report.conflicting.is_empty();

    report.score = if no_attr_evidence {
        appear
    } else {
        ATTR_WEIGHT * attr_score + APPEAR_WEIGHT * appear
    };

    if appear >= APPEAR_MATCH_THRESHOLD && !report.matched.iter().any(|m| m == "appearance") {
        report.matched.push("appearance".into());
    }

    report
}

fn l2_norm(values: &[f32]) -> f32 {
    values.iter().map(|v| v * v).sum::<f32>().sqrt()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use crate::descriptor::Descriptor;
    use crate::matching::{compare, ACCEPT_THRESHOLD};
    use crate::memory::MatchQuality;
    use crate::{Registry, Sighting};
    use chrono::Utc;
    use uuid::Uuid;

    fn app(model: &str, values: Vec<f32>) -> AppearanceVec {
        AppearanceVec {
            model: model.into(),
            values,
        }
    }

    fn d(key: &str, value: &str) -> Descriptor {
        Descriptor::new(key, value)
    }

    fn sighting_with_appearance(
        class: &str,
        descriptors: Vec<Descriptor>,
        appearance: AppearanceVec,
    ) -> Sighting {
        Sighting {
            class: class.into(),
            descriptors,
            camera_id: "driveway".into(),
            at: Utc::now(),
            appearance: Some(appearance),
        }
    }

    fn empty_report() -> MatchReport {
        MatchReport {
            identity_id: Uuid::nil(),
            score: 0.0,
            matched: vec![],
            conflicting: vec![],
            refuted_by: None,
            appearance_score: None,
            quality: MatchQuality::default(),
        }
    }

    fn mem(known: &AppearanceVec) -> AppearanceMemory {
        AppearanceMemory::from_observation(known)
    }

    #[test]
    fn cosine_same_direction_is_one() {
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[2.0, 0.0]), Some(1.0));
    }

    #[test]
    fn cosine_orthogonal_is_zero() {
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]), Some(0.0));
    }

    #[test]
    fn cosine_empty_or_mismatch_is_none() {
        assert!(cosine_similarity(&[], &[1.0]).is_none());
        assert!(cosine_similarity(&[1.0], &[]).is_none());
        assert!(cosine_similarity(&[1.0], &[1.0, 2.0]).is_none());
    }

    #[test]
    fn cosine_near_zero_norm_returns_zero() {
        assert_eq!(cosine_similarity(&[0.0, 0.0], &[1.0, 0.0]), Some(0.0));
    }

    #[test]
    fn l2_normalize_unit_vector() {
        let out = l2_normalize(&[3.0, 4.0]);
        assert!((out[0] - 0.6).abs() < 1e-5);
        assert!((out[1] - 0.8).abs() < 1e-5);
    }

    #[test]
    fn ema_update_blends_and_normalizes() {
        let out = ema_update(&[1.0, 0.0], &[0.0, 1.0], 0.5).unwrap();
        let norm = l2_norm(&out);
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn ema_update_rejects_length_mismatch() {
        assert!(ema_update(&[1.0], &[1.0, 2.0], 0.3).is_none());
    }

    #[test]
    fn ema_update_clamps_alpha() {
        let out_low = ema_update(&[1.0, 0.0], &[0.0, 1.0], -1.0).unwrap();
        assert_eq!(out_low, l2_normalize(&[1.0, 0.0]));
        let out_high = ema_update(&[1.0, 0.0], &[0.0, 1.0], 2.0).unwrap();
        assert_eq!(out_high, l2_normalize(&[0.0, 1.0]));
    }

    #[test]
    fn fuse_appearance_only_reidentifies() {
        let fused = fuse_appearance(
            empty_report(),
            Some(&mem(&app("clip", vec![1.0, 0.0, 0.0]))),
            Some(&app("clip", vec![1.0, 0.0, 0.0])),
        );
        assert!(fused.score >= ACCEPT_THRESHOLD);
        assert_eq!(fused.appearance_score, Some(1.0));
        assert!(fused.matched.contains(&"appearance".into()));
    }

    #[test]
    fn fuse_plate_refute_beats_high_appearance() {
        let attr = compare(
            Uuid::nil(),
            &[
                Descriptor::new("license_plate", "123ABC"),
                Descriptor::new("vehicle_make", "subaru"),
            ],
            &[
                Descriptor::new("license_plate", "999XYZ"),
                Descriptor::new("vehicle_make", "subaru"),
            ],
        );
        let fused = fuse_appearance(
            attr,
            Some(&mem(&app("clip", vec![1.0, 0.0]))),
            Some(&app("clip", vec![1.0, 0.0])),
        );
        assert_eq!(fused.refuted_by, Some("license_plate".into()));
        assert!(!fused.is_match());
        assert_eq!(fused.appearance_score, Some(1.0));
        assert!(fused.score < 1.0 || fused.refuted_by.is_some());
    }

    #[test]
    fn fuse_hybrid_blend_weights_attributes_and_appearance() {
        let mut report = empty_report();
        report.score = 1.0;
        report.matched.push("fur_color".into());
        let fused = fuse_appearance(
            report,
            Some(&mem(&app("clip", vec![1.0, 0.0]))),
            Some(&app("clip", vec![0.0, 1.0])),
        );
        let expected = ATTR_WEIGHT * 1.0 + APPEAR_WEIGHT * 0.0;
        assert!((fused.score - expected).abs() < 1e-5);
        assert_eq!(fused.appearance_score, Some(0.0));
    }

    #[test]
    fn fuse_skips_when_models_differ() {
        let fused = fuse_appearance(
            empty_report(),
            Some(&mem(&app("clip", vec![1.0, 0.0]))),
            Some(&app("dino", vec![1.0, 0.0])),
        );
        assert!(fused.appearance_score.is_none());
        assert_eq!(fused.score, 0.0);
    }

    #[test]
    fn registry_appearance_only_same_embedding_matches() {
        let mut r = Registry::new();
        let embed = app("clip", vec![1.0, 0.0, 0.0]);
        let first = r.observe(&sighting_with_appearance("person", vec![], embed.clone()));
        let second = r.observe(&sighting_with_appearance("person", vec![], embed));
        assert!(first.is_new);
        assert_eq!(first.identity_id, second.identity_id);
        assert!(!second.is_new);
    }

    #[test]
    fn registry_appearance_only_different_embedding_creates_new_identity() {
        let mut r = Registry::new();
        r.observe(&sighting_with_appearance(
            "person",
            vec![],
            app("clip", vec![1.0, 0.0, 0.0]),
        ));
        let other = r.observe(&sighting_with_appearance(
            "person",
            vec![],
            app("clip", vec![0.0, 1.0, 0.0]),
        ));
        assert!(other.is_new);
    }

    #[test]
    fn registry_plate_refute_beats_high_appearance_similarity() {
        let mut r = Registry::new();
        let embed = app("clip", vec![1.0, 0.0, 0.0]);
        r.observe(&sighting_with_appearance(
            "car",
            vec![d("license_plate", "123ABC")],
            embed.clone(),
        ));
        let other = r.observe(&sighting_with_appearance(
            "car",
            vec![d("license_plate", "999XYZ")],
            embed,
        ));
        assert!(other.is_new);
        assert_eq!(
            other.rejected[0].refuted_by.as_deref(),
            Some("license_plate")
        );
    }
}
