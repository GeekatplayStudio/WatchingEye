//! Estimating how far away something is from how large it appears.
//!
//! One camera cannot measure depth. What it can do is compare an object's
//! apparent height against how tall that kind of object usually is — the
//! pinhole model, `distance = real_height × focal_length / apparent_height`.
//!
//! This is an **estimate with a known failure mode**, and callers are given
//! the means to say so: a seated adult, a child, or a scale model of a car
//! all break the assumption, and the estimate will be confidently wrong.
//! Every result therefore carries the assumption it was built on.
//!
//! Real depth requires a depth model or a second camera. This exists so the
//! system can say "roughly 4 metres" instead of nothing, not so it can
//! pretend to have measured.

use serde::{Deserialize, Serialize};

/// A distance estimate and the assumption behind it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DistanceEstimate {
    /// Best estimate in metres.
    pub metres: f32,
    /// Plausible range, reflecting how much real objects vary in size.
    pub min_metres: f32,
    /// Upper end of the plausible range.
    pub max_metres: f32,
    /// The assumed real-world height this was derived from.
    pub assumed_height_m: f32,
    /// Human-readable caveat, shown wherever the number is shown.
    pub basis: String,
}

/// Typical height in metres, and the spread that makes an estimate honest.
struct Assumption {
    height_m: f32,
    /// Fractional spread: 0.2 means "could plausibly be ±20% of this".
    spread: f32,
    note: &'static str,
}

/// What a class of object is usually the size of.
///
/// Unknown classes get no estimate at all rather than a guess — inventing a
/// size would produce a number with no meaning attached.
fn assumption_for(class: &str) -> Option<Assumption> {
    let a = match class.to_ascii_lowercase().as_str() {
        "person" => Assumption {
            height_m: 1.70,
            spread: 0.25,
            note: "assuming a standing adult; a seated person or child reads as further away",
        },
        "dog" => Assumption {
            height_m: 0.55,
            spread: 0.45,
            note: "assuming a mid-sized dog; breeds vary enormously",
        },
        "cat" => Assumption {
            height_m: 0.30,
            spread: 0.30,
            note: "assuming an adult cat",
        },
        "bird" => Assumption {
            height_m: 0.25,
            spread: 0.60,
            note: "assuming a mid-sized bird; species vary hugely",
        },
        "car" => Assumption {
            height_m: 1.50,
            spread: 0.20,
            note: "assuming a passenger car",
        },
        "truck" => Assumption {
            height_m: 3.00,
            spread: 0.40,
            note: "assuming a delivery truck",
        },
        "bicycle" => Assumption {
            height_m: 1.10,
            spread: 0.25,
            note: "assuming a bicycle with no rider",
        },
        "drone" => Assumption {
            height_m: 0.30,
            spread: 0.70,
            note: "assuming a consumer quadcopter; size varies wildly and this is a weak estimate",
        },
        "package" => Assumption {
            height_m: 0.35,
            spread: 0.50,
            note: "assuming a parcel",
        },
        _ => return None,
    };
    Some(a)
}

/// Focal length in pixels for a given vertical field of view.
///
/// Most webcams are somewhere near 50° vertical; the value is configurable
/// because getting it wrong scales every estimate proportionally.
#[must_use]
pub fn focal_length_px(frame_height: u32, vertical_fov_deg: f32) -> f32 {
    #[allow(clippy::cast_precision_loss)]
    let height = frame_height as f32;
    let half_fov = (vertical_fov_deg.clamp(5.0, 170.0) / 2.0).to_radians();
    (height / 2.0) / half_fov.tan()
}

/// Estimate distance from apparent height.
///
/// Returns `None` when the class is unknown or the object is too small on
/// screen for the estimate to mean anything.
///
/// # Example
/// ```
/// use spatial::distance::{estimate, focal_length_px};
/// let focal = focal_length_px(72, 50.0);
/// // A person occupying half the frame height is close.
/// let near = estimate("person", 36.0, focal).unwrap();
/// let far = estimate("person", 9.0, focal).unwrap();
/// assert!(near.metres < far.metres);
/// ```
#[must_use]
pub fn estimate(class: &str, apparent_height_px: f32, focal_px: f32) -> Option<DistanceEstimate> {
    let a = assumption_for(class)?;
    if !apparent_height_px.is_finite() || apparent_height_px < 2.0 || !focal_px.is_finite() {
        return None;
    }
    let metres = (a.height_m * focal_px) / apparent_height_px;
    if !metres.is_finite() || metres <= 0.0 {
        return None;
    }
    Some(DistanceEstimate {
        metres,
        min_metres: metres * (1.0 - a.spread),
        max_metres: metres * (1.0 + a.spread),
        assumed_height_m: a.height_m,
        basis: a.note.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    const FOCAL: f32 = 77.2; // ~72px tall frame at 50 degrees vertical FOV

    #[test]
    fn a_larger_object_on_screen_is_nearer() {
        let near = estimate("person", 40.0, FOCAL).unwrap();
        let far = estimate("person", 10.0, FOCAL).unwrap();
        assert!(near.metres < far.metres);
    }

    #[test]
    fn halving_apparent_size_doubles_the_distance() {
        let a = estimate("person", 20.0, FOCAL).unwrap();
        let b = estimate("person", 10.0, FOCAL).unwrap();
        assert!((b.metres - a.metres * 2.0).abs() < 0.01);
    }

    #[test]
    fn a_person_filling_half_the_frame_is_a_few_metres_away() {
        // Sanity check against reality: 1.7m person, 36px in a 72px frame.
        let d = estimate("person", 36.0, FOCAL).unwrap();
        assert!(d.metres > 2.0 && d.metres < 6.0, "got {}m", d.metres);
    }

    #[test]
    fn a_truck_at_the_same_apparent_size_is_further_than_a_car() {
        let car = estimate("car", 20.0, FOCAL).unwrap();
        let truck = estimate("truck", 20.0, FOCAL).unwrap();
        assert!(
            truck.metres > car.metres,
            "a truck looking that small must be further"
        );
    }

    #[test]
    fn unknown_classes_get_no_estimate_rather_than_a_guess() {
        assert!(estimate("unknown", 20.0, FOCAL).is_none());
        assert!(estimate("spaceship", 20.0, FOCAL).is_none());
    }

    #[test]
    fn objects_too_small_to_measure_are_refused() {
        assert!(estimate("person", 1.0, FOCAL).is_none());
        assert!(estimate("person", 0.0, FOCAL).is_none());
    }

    #[test]
    fn nonfinite_inputs_are_refused() {
        assert!(estimate("person", f32::NAN, FOCAL).is_none());
        assert!(estimate("person", 20.0, f32::NAN).is_none());
    }

    #[test]
    fn every_estimate_carries_its_assumption() {
        let d = estimate("dog", 20.0, FOCAL).unwrap();
        assert_eq!(d.assumed_height_m, 0.55);
        assert!(
            d.basis.contains("breeds vary"),
            "must state why it might be wrong"
        );
        assert!(d.min_metres < d.metres && d.metres < d.max_metres);
    }

    #[test]
    fn uncertain_classes_get_a_wider_range() {
        let person = estimate("person", 20.0, FOCAL).unwrap();
        let drone = estimate("drone", 20.0, FOCAL).unwrap();
        let person_spread = (person.max_metres - person.min_metres) / person.metres;
        let drone_spread = (drone.max_metres - drone.min_metres) / drone.metres;
        assert!(
            drone_spread > person_spread,
            "drone sizes vary more than people"
        );
    }

    #[test]
    fn a_wider_lens_shortens_the_estimate() {
        // Same object, wider field of view: it must be closer than a narrow
        // lens would imply, or the numbers are meaningless.
        let narrow = estimate("person", 20.0, focal_length_px(72, 35.0)).unwrap();
        let wide = estimate("person", 20.0, focal_length_px(72, 80.0)).unwrap();
        assert!(wide.metres < narrow.metres);
    }

    #[test]
    fn focal_length_is_clamped_to_sane_optics() {
        assert!(focal_length_px(72, 0.0).is_finite());
        assert!(focal_length_px(72, 500.0).is_finite());
    }
}
