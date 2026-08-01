//! Re-identification and object memory: *who* something is, not just *what*.
//!
//! Classification answers "a dog". Identity answers "Mochi, seen four times
//! this week, last in the driveway at 15:14". The two are deliberately
//! separate: a vision model supplies observed attributes, and the
//! deterministic code here decides whether those attributes belong to
//! someone already known.
//!
//! # Example
//! ```
//! use identity::{Registry, Sighting};
//! use identity::descriptor::Descriptor;
//! use chrono::Utc;
//!
//! let mut registry = Registry::new();
//! registry.enroll("Mochi", "dog", vec![
//!     Descriptor::new("fur_color", "brown"),
//!     Descriptor::new("breed", "shiba"),
//! ]);
//!
//! let outcome = registry.observe(&Sighting {
//!     class: "dog".into(),
//!     descriptors: vec![Descriptor::new("fur_color", "brown"), Descriptor::new("breed", "shiba")],
//!     camera_id: "driveway".into(),
//!     at: Utc::now(),
//!     appearance: None,
//! });
//! assert_eq!(outcome.name.as_deref(), Some("Mochi"));
//! assert!(!outcome.is_new);
//! ```

pub mod appearance;
pub mod assign;
mod batch;
pub mod descriptor;
pub mod matching;
pub mod memory;

use appearance::{fuse_appearance, AppearanceVec};
use memory::{diagnose_quality, AppearanceMemory, IdentityStatus, MatchQuality, CONFIRM_HITS};

use chrono::{DateTime, Utc};
use descriptor::Descriptor;
use matching::{best_match, compare, MatchReport};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// One observation offered to the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sighting {
    /// Class established by the pipeline, e.g. `"dog"`.
    pub class: String,
    /// Attributes observed on this sighting.
    pub descriptors: Vec<Descriptor>,
    /// Camera that saw it.
    pub camera_id: String,
    /// When it was seen.
    pub at: DateTime<Utc>,
    /// Optional appearance embedding from a vision model.
    #[serde(default)]
    pub appearance: Option<AppearanceVec>,
}

/// A single entry in an identity's history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    /// When this sighting happened.
    pub at: DateTime<Utc>,
    /// Where it happened.
    pub camera_id: String,
    /// Attributes that agreed on this sighting.
    pub matched: Vec<String>,
}

/// A known individual and everything remembered about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    /// Stable id across sightings.
    pub id: Uuid,
    /// Human-given name, once enrolled. `None` for auto-created identities.
    pub name: Option<String>,
    /// Class this identity belongs to; identities never cross classes.
    pub class: String,
    /// Accumulated attributes.
    pub descriptors: Vec<Descriptor>,
    /// First and most recent times seen.
    pub first_seen: DateTime<Utc>,
    /// Most recent sighting time.
    pub last_seen: DateTime<Utc>,
    /// How many times this identity has been recognised.
    pub sightings: u32,
    /// Chronological history, oldest first.
    pub memory: Vec<MemoryEntry>,
    /// Dual-bank appearance memory, updated on match per [`MatchQuality`].
    #[serde(default)]
    pub appearance: Option<AppearanceMemory>,
    /// Lifecycle stage: unconfirmed until enough sightings agree.
    #[serde(default)]
    pub status: IdentityStatus,
}

impl Identity {
    /// Distinct camera ids this identity has been seen on, sorted.
    ///
    /// Matching is camera-agnostic by design (see [`Registry::observe`]),
    /// so a single identity's memory can span any number of cameras; this
    /// is how a caller discovers which ones.
    ///
    /// # Example
    /// ```
    /// use identity::{Identity, MemoryEntry};
    /// use identity::descriptor::Descriptor;
    /// use chrono::Utc;
    /// use uuid::Uuid;
    ///
    /// let mut identity = Identity {
    ///     id: Uuid::nil(),
    ///     name: None,
    ///     class: "person".into(),
    ///     descriptors: Vec::<Descriptor>::new(),
    ///     first_seen: Utc::now(),
    ///     last_seen: Utc::now(),
    ///     sightings: 2,
    ///     memory: vec![
    ///         MemoryEntry { at: Utc::now(), camera_id: "backyard".into(), matched: vec![] },
    ///         MemoryEntry { at: Utc::now(), camera_id: "front".into(), matched: vec![] },
    ///     ],
    ///     appearance: None,
    ///     status: identity::memory::IdentityStatus::default(),
    /// };
    /// assert_eq!(identity.cameras_seen(), vec!["backyard".to_string(), "front".to_string()]);
    /// assert!(identity.is_multi_camera());
    /// identity.memory.truncate(1);
    /// assert!(!identity.is_multi_camera());
    /// ```
    #[must_use]
    pub fn cameras_seen(&self) -> Vec<String> {
        let mut seen: Vec<String> = Vec::new();
        for entry in &self.memory {
            if !seen.contains(&entry.camera_id) {
                seen.push(entry.camera_id.clone());
            }
        }
        seen.sort();
        seen
    }

    /// True when this identity's memory mentions more than one camera.
    #[must_use]
    pub fn is_multi_camera(&self) -> bool {
        self.cameras_seen().len() > 1
    }
}

/// What the registry concluded about a sighting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentificationOutcome {
    /// Identity the sighting was attributed to.
    pub identity_id: Uuid,
    /// Name, if this identity has been enrolled.
    pub name: Option<String>,
    /// Class of the identity.
    pub class: String,
    /// True when a new identity was created for this sighting.
    pub is_new: bool,
    /// How many times this identity has now been seen.
    pub sightings: u32,
    /// The winning comparison, absent when a new identity was created.
    pub evidence: Option<MatchReport>,
    /// Candidates that were considered and rejected, with reasons.
    pub rejected: Vec<MatchReport>,
    /// Confidence diagnosis for this observation. [`MatchQuality::Weak`]
    /// when a new identity was created.
    #[serde(default)]
    pub quality: MatchQuality,
    /// Lifecycle stage of the identity after this observation.
    #[serde(default)]
    pub status: IdentityStatus,
    /// Convenience flag for UIs: `true` exactly when `quality` is
    /// [`MatchQuality::Ambiguous`].
    #[serde(default)]
    pub ambiguous: bool,
    /// Camera that produced this sighting.
    #[serde(default)]
    pub camera_id: String,
    /// True when this match continues an identity last seen on a
    /// *different* camera than this sighting. Always `false` when
    /// `is_new` is `true`.
    #[serde(default)]
    pub crossed_camera: bool,
    /// Distinct cameras this identity has been seen on after this
    /// observation, sorted.
    #[serde(default)]
    pub cameras_seen: Vec<String>,
}

/// Maximum history entries retained per identity.
const MAX_MEMORY: usize = 200;

/// Add any observed attributes not already recorded, without overwriting
/// what is already known.
fn enrich_descriptors(existing: &mut Vec<Descriptor>, observed: &[Descriptor]) {
    for observed in observed {
        if !existing.iter().any(|k| k.key == observed.key) {
            existing.push(observed.clone());
        }
    }
}

/// In-memory store of known identities.
#[derive(Debug, Default)]
pub struct Registry {
    identities: HashMap<Uuid, Identity>,
}

impl Registry {
    /// Create an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a named individual up front, e.g. a household pet.
    pub fn enroll(&mut self, name: &str, class: &str, descriptors: Vec<Descriptor>) -> Uuid {
        let now = Utc::now();
        let id = Uuid::new_v4();
        self.identities.insert(
            id,
            Identity {
                id,
                name: Some(name.to_owned()),
                class: class.to_ascii_lowercase(),
                descriptors,
                first_seen: now,
                last_seen: now,
                sightings: 0,
                memory: Vec::new(),
                appearance: None,
                status: IdentityStatus::Confirmed,
            },
        );
        id
    }

    /// Seed the registry from previously persisted identities, e.g. after
    /// loading a durable store on startup.
    ///
    /// Entries are inserted by [`Identity::id`](struct.Identity.html#structfield.id);
    /// an identity already present under the same id is overwritten. Matching
    /// itself is unaffected by import order since [`observe`](Self::observe)
    /// only ever compares by class.
    ///
    /// # Example
    /// ```
    /// use identity::Registry;
    ///
    /// let mut registry = Registry::new();
    /// let id = registry.enroll("Mochi", "dog", vec![]);
    /// let saved: Vec<_> = registry.all().into_iter().cloned().collect();
    ///
    /// let mut reloaded = Registry::new();
    /// reloaded.import(saved);
    /// assert_eq!(reloaded.get(id).and_then(|i| i.name.clone()), Some("Mochi".to_string()));
    /// ```
    pub fn import(&mut self, identities: impl IntoIterator<Item = Identity>) {
        for identity in identities {
            self.identities.insert(identity.id, identity);
        }
    }

    /// All known identities, ordered by most recently seen.
    #[must_use]
    pub fn all(&self) -> Vec<&Identity> {
        let mut out: Vec<&Identity> = self.identities.values().collect();
        out.sort_by(|a, b| b.last_seen.cmp(&a.last_seen).then(a.id.cmp(&b.id)));
        out
    }

    /// Look up one identity.
    #[must_use]
    pub fn get(&self, id: Uuid) -> Option<&Identity> {
        self.identities.get(&id)
    }

    /// Attribute a sighting to a known identity, or create a new one.
    ///
    /// Only identities of the same class are considered — a dog is never
    /// matched against a car no matter how attributes line up. The winning
    /// comparison (if any) is diagnosed for [`MatchQuality`] against every
    /// candidate considered, which gates how appearance memory updates and
    /// whether the identity's [`IdentityStatus`] advances.
    pub fn observe(&mut self, sighting: &Sighting) -> IdentificationOutcome {
        let class = sighting.class.to_ascii_lowercase();
        let mut reports: Vec<MatchReport> = self
            .identities
            .values()
            .filter(|i| i.class == class)
            .map(|i| {
                let report = compare(i.id, &i.descriptors, &sighting.descriptors);
                fuse_appearance(report, i.appearance.as_ref(), sighting.appearance.as_ref())
            })
            .collect();
        reports.sort_by_key(|r| r.identity_id);

        let winner = best_match(reports.clone());
        let quality = diagnose_quality(winner.as_ref(), &reports);
        let winner = winner.map(|mut w| {
            w.quality = quality;
            w
        });
        let rejected: Vec<MatchReport> = reports
            .into_iter()
            .filter(|r| {
                winner
                    .as_ref()
                    .is_none_or(|w| w.identity_id != r.identity_id)
            })
            .collect();

        match winner {
            Some(report) => self.record_match(sighting, report, rejected, quality),
            None => self.create(sighting, &class, rejected, quality),
        }
    }

    /// Update an existing identity with a sighting that matched it.
    fn record_match(
        &mut self,
        sighting: &Sighting,
        report: MatchReport,
        rejected: Vec<MatchReport>,
        quality: MatchQuality,
    ) -> IdentificationOutcome {
        let class = sighting.class.to_ascii_lowercase();
        let Some(existing) = self.identities.get_mut(&report.identity_id) else {
            return self.create(sighting, &class, rejected, quality);
        };
        existing.last_seen = sighting.at;
        existing.sightings += 1;
        enrich_descriptors(&mut existing.descriptors, &sighting.descriptors);

        if let Some(seen_app) = &sighting.appearance {
            match &mut existing.appearance {
                Some(known) => known.apply_update(seen_app, quality),
                None if quality != MatchQuality::Weak => {
                    existing.appearance = Some(AppearanceMemory::from_observation(seen_app));
                }
                None => {}
            }
        }

        if existing.status == IdentityStatus::Tentative
            && (quality == MatchQuality::Strong || existing.sightings >= CONFIRM_HITS)
        {
            existing.status = IdentityStatus::Confirmed;
        }

        // Compare against the last sighting *before* recording this one, so
        // a same-camera repeat is never mistaken for a crossing.
        let crossed_camera = existing
            .memory
            .last()
            .is_some_and(|last| last.camera_id != sighting.camera_id);

        existing.memory.push(MemoryEntry {
            at: sighting.at,
            camera_id: sighting.camera_id.clone(),
            matched: report.matched.clone(),
        });
        if existing.memory.len() > MAX_MEMORY {
            existing.memory.remove(0);
        }

        IdentificationOutcome {
            identity_id: existing.id,
            name: existing.name.clone(),
            class: existing.class.clone(),
            is_new: false,
            sightings: existing.sightings,
            evidence: Some(report),
            rejected,
            quality,
            status: existing.status,
            ambiguous: quality == MatchQuality::Ambiguous,
            camera_id: sighting.camera_id.clone(),
            crossed_camera,
            cameras_seen: existing.cameras_seen(),
        }
    }

    /// Record a previously unseen individual.
    ///
    /// New identities always start [`IdentityStatus::Tentative`]; `quality`
    /// is [`MatchQuality::Weak`] whenever this is reached from [`observe`](Self::observe)
    /// (no winner means nothing to be confident about), but a defensive
    /// caller-supplied value is still threaded through onto the outcome.
    fn create(
        &mut self,
        sighting: &Sighting,
        class: &str,
        rejected: Vec<MatchReport>,
        quality: MatchQuality,
    ) -> IdentificationOutcome {
        let id = Uuid::new_v4();
        let appearance = sighting
            .appearance
            .as_ref()
            .map(AppearanceMemory::from_observation);
        self.identities.insert(
            id,
            Identity {
                id,
                name: None,
                class: class.to_owned(),
                descriptors: sighting.descriptors.clone(),
                first_seen: sighting.at,
                last_seen: sighting.at,
                sightings: 1,
                memory: vec![MemoryEntry {
                    at: sighting.at,
                    camera_id: sighting.camera_id.clone(),
                    matched: Vec::new(),
                }],
                appearance,
                status: IdentityStatus::Tentative,
            },
        );
        IdentificationOutcome {
            identity_id: id,
            name: None,
            class: class.to_owned(),
            is_new: true,
            sightings: 1,
            evidence: None,
            rejected,
            quality,
            status: IdentityStatus::Tentative,
            ambiguous: quality == MatchQuality::Ambiguous,
            camera_id: sighting.camera_id.clone(),
            crossed_camera: false,
            cameras_seen: vec![sighting.camera_id.clone()],
        }
    }

    /// Give a name to an identity discovered automatically.
    ///
    /// # Errors
    /// Returns `false` when the identity is unknown.
    pub fn name_identity(&mut self, id: Uuid, name: &str) -> bool {
        match self.identities.get_mut(&id) {
            Some(identity) => {
                identity.name = Some(name.to_owned());
                true
            }
            None => false,
        }
    }
}

// Registry integration tests live in `registry_tests.rs` (and cross-camera
// tests in `multi_camera_tests.rs`) to keep this file within the
// workspace's per-file line budget.
#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "multi_camera_tests.rs"]
mod multi_camera_tests;
