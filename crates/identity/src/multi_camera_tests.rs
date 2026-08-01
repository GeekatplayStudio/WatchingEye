//! Cross-camera integration tests, kept out of `registry_tests.rs` to
//! respect the workspace's per-file line budget.
//!
//! Matching is deliberately camera-agnostic — [`crate::Registry::observe`]
//! never filters candidates by `camera_id` — so the same individual seen on
//! two different cameras must resolve to one [`crate::Identity`], and the
//! [`crate::IdentificationOutcome`] returned on the second sighting must
//! say so via `crossed_camera` and `cameras_seen`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
use super::*;
use crate::appearance::AppearanceVec;

fn d(key: &str, value: &str) -> Descriptor {
    Descriptor::new(key, value)
}

fn sighting_on(class: &str, descriptors: Vec<Descriptor>, camera_id: &str) -> Sighting {
    Sighting {
        class: class.into(),
        descriptors,
        camera_id: camera_id.into(),
        at: Utc::now(),
        appearance: None,
    }
}

fn sighting_with_appearance_on(
    class: &str,
    descriptors: Vec<Descriptor>,
    embed: AppearanceVec,
    camera_id: &str,
) -> Sighting {
    Sighting {
        class: class.into(),
        descriptors,
        camera_id: camera_id.into(),
        at: Utc::now(),
        appearance: Some(embed),
    }
}

fn embed(values: Vec<f32>) -> AppearanceVec {
    AppearanceVec {
        model: "clip".into(),
        values,
    }
}

#[test]
fn the_same_appearance_on_a_second_camera_keeps_one_identity_and_flags_the_crossing() {
    let mut r = Registry::new();
    let front = r.observe(&sighting_with_appearance_on(
        "person",
        vec![],
        embed(vec![1.0, 0.0, 0.0]),
        "front",
    ));
    assert!(front.is_new);
    assert!(!front.crossed_camera);
    assert_eq!(front.camera_id, "front");
    assert_eq!(front.cameras_seen, vec!["front".to_string()]);

    let backyard = r.observe(&sighting_with_appearance_on(
        "person",
        vec![],
        embed(vec![1.0, 0.0, 0.0]),
        "backyard",
    ));
    assert_eq!(backyard.identity_id, front.identity_id);
    assert!(!backyard.is_new);
    assert!(backyard.crossed_camera);
    assert_eq!(backyard.camera_id, "backyard");
    assert_eq!(
        backyard.cameras_seen,
        vec!["backyard".to_string(), "front".to_string()]
    );

    let identity = r.get(front.identity_id).unwrap();
    assert!(identity.is_multi_camera());
    assert_eq!(
        identity.cameras_seen(),
        vec!["backyard".to_string(), "front".to_string()]
    );
}

#[test]
fn a_repeat_sighting_on_the_same_camera_does_not_count_as_crossed() {
    let mut r = Registry::new();
    let first = r.observe(&sighting_on(
        "dog",
        vec![d("fur_color", "brown"), d("breed", "shiba")],
        "front",
    ));
    let second = r.observe(&sighting_on(
        "dog",
        vec![d("fur_color", "brown"), d("breed", "shiba")],
        "front",
    ));
    assert_eq!(first.identity_id, second.identity_id);
    assert!(!second.crossed_camera);
    assert_eq!(second.cameras_seen, vec!["front".to_string()]);
}

#[test]
fn a_plate_match_across_two_cameras_also_keeps_one_identity() {
    let mut r = Registry::new();
    let first = r.observe(&sighting_on(
        "car",
        vec![d("license_plate", "123ABC"), d("vehicle_color", "green")],
        "driveway",
    ));
    let second = r.observe(&sighting_on(
        "car",
        vec![d("license_plate", "123abc"), d("vehicle_color", "green")],
        "street",
    ));
    assert_eq!(first.identity_id, second.identity_id);
    assert!(!second.is_new);
    assert!(second.crossed_camera);
    assert_eq!(
        second.cameras_seen,
        vec!["driveway".to_string(), "street".to_string()]
    );
}

#[test]
fn observe_does_not_prefer_the_same_camera_over_another_camera() {
    // Matching compares attributes only; camera identity never enters the
    // score. An identity last seen on "backyard" is exactly as eligible for
    // a "front" sighting as one last seen on "front" would be, provided the
    // attributes agree equally well.
    let mut r = Registry::new();
    let backyard_dog = r.observe(&sighting_on(
        "dog",
        vec![d("breed", "shiba"), d("fur_color", "brown")],
        "backyard",
    ));
    let seen_from_front = r.observe(&sighting_on(
        "dog",
        vec![d("breed", "shiba"), d("fur_color", "brown")],
        "front",
    ));
    assert_eq!(seen_from_front.identity_id, backyard_dog.identity_id);
    assert!(!seen_from_front.is_new);
}

#[test]
fn cameras_seen_is_sorted_and_deduplicated() {
    let mut r = Registry::new();
    let cameras = ["front", "backyard", "front", "driveway", "backyard"];
    let mut last = None;
    for camera in cameras {
        last = Some(r.observe(&sighting_with_appearance_on(
            "person",
            vec![],
            embed(vec![1.0, 0.0, 0.0]),
            camera,
        )));
    }
    let out = last.unwrap();
    assert_eq!(
        out.cameras_seen,
        vec![
            "backyard".to_string(),
            "driveway".to_string(),
            "front".to_string(),
        ]
    );
    let identity = r.get(out.identity_id).unwrap();
    assert_eq!(identity.cameras_seen(), out.cameras_seen);
}
