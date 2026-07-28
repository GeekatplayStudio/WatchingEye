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
//! });
//! assert_eq!(outcome.name.as_deref(), Some("Mochi"));
//! assert!(!outcome.is_new);
//! ```

pub mod descriptor;
pub mod matching;

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
}

/// Maximum history entries retained per identity.
const MAX_MEMORY: usize = 200;

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
            },
        );
        id
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
    /// matched against a car no matter how attributes line up.
    pub fn observe(&mut self, sighting: &Sighting) -> IdentificationOutcome {
        let class = sighting.class.to_ascii_lowercase();
        let mut reports: Vec<MatchReport> = self
            .identities
            .values()
            .filter(|i| i.class == class)
            .map(|i| compare(i.id, &i.descriptors, &sighting.descriptors))
            .collect();
        reports.sort_by_key(|r| r.identity_id);

        let winner = best_match(reports.clone());
        let rejected: Vec<MatchReport> = reports
            .into_iter()
            .filter(|r| {
                winner
                    .as_ref()
                    .is_none_or(|w| w.identity_id != r.identity_id)
            })
            .collect();

        match winner {
            Some(report) => {
                let Some(existing) = self.identities.get_mut(&report.identity_id) else {
                    return self.create(sighting, &class, rejected);
                };
                existing.last_seen = sighting.at;
                existing.sightings += 1;
                // Newly observed attributes enrich what we know.
                for observed in &sighting.descriptors {
                    if !existing.descriptors.iter().any(|k| k.key == observed.key) {
                        existing.descriptors.push(observed.clone());
                    }
                }
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
                }
            }
            None => self.create(sighting, &class, rejected),
        }
    }

    /// Record a previously unseen individual.
    fn create(
        &mut self,
        sighting: &Sighting,
        class: &str,
        rejected: Vec<MatchReport>,
    ) -> IdentificationOutcome {
        let id = Uuid::new_v4();
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn d(key: &str, value: &str) -> Descriptor {
        Descriptor::new(key, value)
    }

    fn sighting(class: &str, descriptors: Vec<Descriptor>) -> Sighting {
        Sighting {
            class: class.into(),
            descriptors,
            camera_id: "driveway".into(),
            at: Utc::now(),
        }
    }

    #[test]
    fn an_unknown_object_becomes_a_new_identity() {
        let mut r = Registry::new();
        let out = r.observe(&sighting("dog", vec![d("fur_color", "brown")]));
        assert!(out.is_new);
        assert_eq!(out.sightings, 1);
        assert!(out.name.is_none());
    }

    #[test]
    fn an_enrolled_pet_is_recognised_by_name() {
        let mut r = Registry::new();
        r.enroll(
            "Mochi",
            "dog",
            vec![d("fur_color", "brown"), d("breed", "shiba")],
        );
        let out = r.observe(&sighting(
            "dog",
            vec![d("fur_color", "brown"), d("breed", "shiba")],
        ));
        assert_eq!(out.name.as_deref(), Some("Mochi"));
        assert!(!out.is_new);
        assert!(out.evidence.unwrap().matched.contains(&"breed".to_string()));
    }

    #[test]
    fn a_different_dog_is_not_confused_with_the_enrolled_one() {
        let mut r = Registry::new();
        r.enroll(
            "Mochi",
            "dog",
            vec![d("fur_color", "brown"), d("breed", "shiba")],
        );
        let out = r.observe(&sighting(
            "dog",
            vec![d("fur_color", "black"), d("breed", "labrador")],
        ));
        assert!(out.is_new);
        assert!(
            !out.rejected.is_empty(),
            "the rejection must be recorded, not silent"
        );
    }

    #[test]
    fn identities_never_cross_classes() {
        let mut r = Registry::new();
        r.enroll("Mochi", "dog", vec![d("fur_color", "brown")]);
        // A brown car is not the brown dog.
        let out = r.observe(&sighting("car", vec![d("fur_color", "brown")]));
        assert!(out.is_new);
        assert_eq!(out.class, "car");
        assert!(
            out.rejected.is_empty(),
            "other classes are not even considered"
        );
    }

    #[test]
    fn repeat_sightings_accumulate_memory() {
        let mut r = Registry::new();
        let id = r.enroll(
            "Mochi",
            "dog",
            vec![d("fur_color", "brown"), d("breed", "shiba")],
        );
        for _ in 0..3 {
            r.observe(&sighting(
                "dog",
                vec![d("fur_color", "brown"), d("breed", "shiba")],
            ));
        }
        let identity = r.get(id).unwrap();
        assert_eq!(identity.sightings, 3);
        assert_eq!(identity.memory.len(), 3);
        assert_eq!(identity.memory[0].camera_id, "driveway");
    }

    #[test]
    fn new_attributes_enrich_a_known_identity() {
        let mut r = Registry::new();
        let id = r.enroll(
            "Mochi",
            "dog",
            vec![d("fur_color", "brown"), d("breed", "shiba")],
        );
        r.observe(&sighting(
            "dog",
            vec![
                d("fur_color", "brown"),
                d("breed", "shiba"),
                d("accessory", "red_collar"),
            ],
        ));
        let identity = r.get(id).unwrap();
        assert!(identity.descriptors.iter().any(|x| x.key == "accessory"));
    }

    #[test]
    fn a_vehicle_is_identified_by_its_plate_across_sightings() {
        let mut r = Registry::new();
        let first = r.observe(&sighting(
            "car",
            vec![d("license_plate", "123ABC"), d("vehicle_color", "green")],
        ));
        // Seen again in different light, colour reported differently.
        let second = r.observe(&sighting(
            "car",
            vec![d("license_plate", "123abc"), d("vehicle_color", "grey")],
        ));
        assert_eq!(first.identity_id, second.identity_id);
        assert!(!second.is_new);
    }

    #[test]
    fn a_different_plate_creates_a_separate_vehicle() {
        let mut r = Registry::new();
        r.observe(&sighting(
            "car",
            vec![d("license_plate", "123ABC"), d("vehicle_make", "subaru")],
        ));
        let other = r.observe(&sighting(
            "car",
            vec![d("license_plate", "999XYZ"), d("vehicle_make", "subaru")],
        ));
        assert!(other.is_new);
        assert_eq!(
            other.rejected[0].refuted_by.as_deref(),
            Some("license_plate"),
            "the reason for treating it as a different car must be explicit"
        );
    }

    #[test]
    fn an_auto_discovered_identity_can_be_named_later() {
        let mut r = Registry::new();
        let out = r.observe(&sighting("dog", vec![d("fur_color", "brown")]));
        assert!(r.name_identity(out.identity_id, "Rex"));
        assert_eq!(r.get(out.identity_id).unwrap().name.as_deref(), Some("Rex"));
    }

    #[test]
    fn naming_an_unknown_identity_fails() {
        let mut r = Registry::new();
        assert!(!r.name_identity(Uuid::new_v4(), "Ghost"));
    }

    #[test]
    fn listing_is_ordered_by_most_recently_seen() {
        let mut r = Registry::new();
        r.observe(&sighting("dog", vec![d("fur_color", "brown")]));
        let mut later = sighting("car", vec![d("license_plate", "111AAA")]);
        later.at = Utc::now() + chrono::Duration::seconds(60);
        r.observe(&later);
        assert_eq!(r.all()[0].class, "car");
    }
}
