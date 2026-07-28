//! Observed attributes and how much each one is worth as evidence of identity.
//!
//! A descriptor is one structured observation — `fur_color = brown`,
//! `license_plate = 123ABC`. Attributes are not equal: a licence plate
//! identifies a vehicle, while "medium sized" barely narrows anything. The
//! weights below encode that, and they are fixed data rather than something
//! a model can influence.

use serde::{Deserialize, Serialize};

/// One observed attribute of an object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Descriptor {
    /// Attribute name in `snake_case`, e.g. `"fur_color"`.
    pub key: String,
    /// Observed value, e.g. `"brown"`.
    pub value: String,
}

impl Descriptor {
    /// Build a descriptor, normalising key and value for comparison.
    #[must_use]
    pub fn new(key: &str, value: &str) -> Self {
        Self {
            key: key.trim().to_ascii_lowercase(),
            value: value.trim().to_ascii_lowercase(),
        }
    }
}

/// How strongly an attribute implies identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strength {
    /// Effectively unique: a match confirms, a mismatch refutes outright.
    Distinctive,
    /// Meaningfully narrowing, but shared by many objects.
    Supporting,
    /// Weak on its own; useful only in aggregate.
    Weak,
}

impl Strength {
    /// Weight used when scoring agreement.
    #[must_use]
    pub fn weight(self) -> f32 {
        match self {
            Strength::Distinctive => 4.0,
            Strength::Supporting => 1.5,
            Strength::Weak => 0.5,
        }
    }
}

/// Attributes that are effectively unique to one object.
const DISTINCTIVE: &[&str] = &[
    "license_plate",
    "name_tag",
    "unique_marking",
    "text_on_object",
    "serial",
];

/// Attributes that narrow the field without settling it.
const SUPPORTING: &[&str] = &[
    "fur_color",
    "coat_pattern",
    "clothing_color",
    "upper_clothing",
    "lower_clothing",
    "hair_color",
    "vehicle_make",
    "vehicle_model",
    "vehicle_color",
    "breed",
    "carried_item",
    "accessory",
];

/// Classify an attribute key. Unknown keys are treated as [`Strength::Weak`]
/// so a model inventing attribute names cannot manufacture confidence.
#[must_use]
pub fn strength_of(key: &str) -> Strength {
    let key = key.to_ascii_lowercase();
    if DISTINCTIVE.contains(&key.as_str()) {
        Strength::Distinctive
    } else if SUPPORTING.contains(&key.as_str()) {
        Strength::Supporting
    } else {
        Strength::Weak
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn descriptors_normalise_case_and_padding() {
        let d = Descriptor::new("  Fur_Color ", " Brown ");
        assert_eq!(d.key, "fur_color");
        assert_eq!(d.value, "brown");
    }

    #[test]
    fn plates_outweigh_colors() {
        assert!(strength_of("license_plate").weight() > strength_of("vehicle_color").weight());
        assert!(strength_of("vehicle_color").weight() > strength_of("size").weight());
    }

    #[test]
    fn invented_attribute_names_are_weak() {
        // A model cannot mint a high-value attribute by naming it creatively.
        assert_eq!(strength_of("definitely_the_same_dog"), Strength::Weak);
    }

    #[test]
    fn classification_is_case_insensitive() {
        assert_eq!(strength_of("LICENSE_PLATE"), Strength::Distinctive);
    }
}
