//! [`Registry::observe_batch`]: global, collision-free multi-sighting
//! attribution.
//!
//! Kept out of `lib.rs` to respect the workspace's per-file line budget.
//! [`Registry::observe`] matches sightings one at a time, so two sightings
//! offered together can be pulled toward the same identity — whichever is
//! processed first wins it, and the second either falls back to a worse
//! candidate or spuriously becomes a new identity. `observe_batch` instead
//! groups sightings by lowercase class, and within each class builds a
//! full detection×identity score table (identities sorted by id,
//! [`compare`] fused with [`fuse_appearance`]) and hands it to
//! [`assign::hungarian_assign`] with [`matching::ACCEPT_THRESHOLD`], so no
//! two sightings in the batch can claim the same identity.

use crate::appearance::fuse_appearance;
use crate::assign::{self, ScoreCell};
use crate::matching::{compare, MatchReport, ACCEPT_THRESHOLD};
use crate::memory::{diagnose_quality, MatchQuality};
use crate::{IdentificationOutcome, Identity, Registry, Sighting};
use std::collections::HashMap;

/// One decision computed by [`Registry::plan_class`], not yet applied.
///
/// Kept separate from mutation so an entire class group can be scored
/// against a single frozen snapshot before any identity changes; plans are
/// then applied in ascending sighting order by [`Registry::apply_plan`].
struct Plan {
    /// Index of the sighting this plan resolves, within the original batch
    /// passed to [`Registry::observe_batch`].
    sighting_index: usize,
    /// What to do once applied.
    kind: PlanKind,
}

/// What a [`Plan`] resolves to.
enum PlanKind {
    /// Attribute the sighting to an existing identity, carried by
    /// `report.identity_id`.
    Match {
        /// The winning comparison, quality already diagnosed.
        report: MatchReport,
        /// Every other candidate considered for this sighting.
        rejected: Vec<MatchReport>,
        /// Confidence diagnosis for the match.
        quality: MatchQuality,
    },
    /// Record a previously unseen individual.
    Create {
        /// Every candidate considered and rejected before deciding this was new.
        rejected: Vec<MatchReport>,
        /// Confidence diagnosis (always [`MatchQuality::Weak`] here).
        quality: MatchQuality,
    },
}

impl Registry {
    /// Attribute many same-class (or mixed) sightings in one global pass.
    ///
    /// Each detection is resolved to either
    /// [`record_match`](Self::record_match) or [`create`](Self::create);
    /// [`MatchQuality`] is diagnosed from that detection's full row of
    /// candidates against its chosen winner (or lack of one), exactly as
    /// [`observe`](Self::observe) would.
    ///
    /// Mixed-class batches are fine: every class group is solved
    /// independently. A single-element batch produces the same outcome as
    /// calling [`observe`](Self::observe) with that sighting.
    ///
    /// All scoring happens against a read-only snapshot taken before any
    /// mutation, so within a class the plan is computed once and then
    /// applied in ascending input order — the registry mutations from
    /// attributing one sighting never influence the scores used for
    /// another sighting in the same batch.
    ///
    /// Returns outcomes in the **same order** as the input sightings.
    ///
    /// # Example
    /// ```
    /// use identity::{Registry, Sighting};
    /// use identity::descriptor::Descriptor;
    /// use chrono::Utc;
    ///
    /// let mut registry = Registry::new();
    /// registry.enroll("Mochi", "dog", vec![Descriptor::new("breed", "shiba")]);
    /// registry.enroll("Rex", "dog", vec![Descriptor::new("breed", "labrador")]);
    ///
    /// let sighting = |breed: &str| Sighting {
    ///     class: "dog".into(),
    ///     descriptors: vec![Descriptor::new("breed", breed)],
    ///     camera_id: "yard".into(),
    ///     at: Utc::now(),
    ///     appearance: None,
    /// };
    /// let outcomes = registry.observe_batch(&[sighting("labrador"), sighting("shiba")]);
    /// assert_eq!(outcomes[0].name.as_deref(), Some("Rex"));
    /// assert_eq!(outcomes[1].name.as_deref(), Some("Mochi"));
    /// ```
    pub fn observe_batch(&mut self, sightings: &[Sighting]) -> Vec<IdentificationOutcome> {
        if sightings.is_empty() {
            return Vec::new();
        }

        let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, sighting) in sightings.iter().enumerate() {
            groups
                .entry(sighting.class.to_ascii_lowercase())
                .or_default()
                .push(index);
        }
        let mut classes: Vec<&str> = groups.keys().map(String::as_str).collect();
        classes.sort_unstable();

        let mut indexed: Vec<(usize, IdentificationOutcome)> = Vec::with_capacity(sightings.len());
        for class in classes {
            for plan in self.plan_class(class, &groups[class], sightings) {
                let sighting_index = plan.sighting_index;
                let outcome = self.apply_plan(plan, sightings);
                indexed.push((sighting_index, outcome));
            }
        }

        indexed.sort_by_key(|(index, _)| *index);
        indexed.into_iter().map(|(_, outcome)| outcome).collect()
    }

    /// Build the assignment plan for one class group without mutating the
    /// registry, so every sighting in the group is scored against the same
    /// frozen snapshot of known identities.
    fn plan_class(&self, class: &str, indices: &[usize], sightings: &[Sighting]) -> Vec<Plan> {
        let mut identities: Vec<&Identity> = self
            .identities
            .values()
            .filter(|identity| identity.class == class)
            .collect();
        identities.sort_by_key(|identity| identity.id);

        if identities.is_empty() {
            return indices
                .iter()
                .map(|&sighting_index| Plan {
                    sighting_index,
                    kind: PlanKind::Create {
                        rejected: Vec::new(),
                        quality: MatchQuality::Weak,
                    },
                })
                .collect();
        }

        let reports: Vec<Vec<MatchReport>> = indices
            .iter()
            .map(|&sighting_index| {
                let sighting = &sightings[sighting_index];
                identities
                    .iter()
                    .map(|identity| {
                        let report =
                            compare(identity.id, &identity.descriptors, &sighting.descriptors);
                        fuse_appearance(
                            report,
                            identity.appearance.as_ref(),
                            sighting.appearance.as_ref(),
                        )
                    })
                    .collect()
            })
            .collect();
        let scores: Vec<Vec<ScoreCell>> = reports
            .iter()
            .map(|row| {
                row.iter()
                    .map(|r| (r.refuted_by.is_none()).then_some(r.score))
                    .collect()
            })
            .collect();

        let assignment = assign::hungarian_assign(&scores, ACCEPT_THRESHOLD);

        indices
            .iter()
            .zip(reports)
            .zip(assignment)
            .map(|((&sighting_index, row), maybe_col)| {
                plan_for_detection(sighting_index, row, maybe_col)
            })
            .collect()
    }

    /// Apply one planned outcome, mutating the registry exactly as
    /// [`record_match`](Self::record_match) or [`create`](Self::create)
    /// would from [`observe`](Self::observe).
    fn apply_plan(&mut self, plan: Plan, sightings: &[Sighting]) -> IdentificationOutcome {
        let sighting = &sightings[plan.sighting_index];
        match plan.kind {
            PlanKind::Match {
                report,
                rejected,
                quality,
            } => self.record_match(sighting, report, rejected, quality),
            PlanKind::Create { rejected, quality } => {
                let class = sighting.class.to_ascii_lowercase();
                self.create(sighting, &class, rejected, quality)
            }
        }
    }
}

/// Turn one detection's full candidate row plus its Hungarian assignment
/// (if any) into a [`Plan`].
fn plan_for_detection(
    sighting_index: usize,
    row: Vec<MatchReport>,
    maybe_col: Option<usize>,
) -> Plan {
    let Some(col) = maybe_col else {
        let quality = diagnose_quality(None, &row);
        return Plan {
            sighting_index,
            kind: PlanKind::Create {
                rejected: row,
                quality,
            },
        };
    };

    let quality = diagnose_quality(Some(&row[col]), &row);
    let mut winner = row[col].clone();
    winner.quality = quality;
    let rejected = row
        .into_iter()
        .enumerate()
        .filter(|(i, _)| *i != col)
        .map(|(_, r)| r)
        .collect();
    Plan {
        sighting_index,
        kind: PlanKind::Match {
            report: winner,
            rejected,
            quality,
        },
    }
}
