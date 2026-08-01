//! Registry-level integration tests, kept out of `lib.rs` to respect the
//! workspace's per-file line budget. Exercises [`crate::Registry`] end to
//! end rather than any single function in isolation.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
use super::*;
use crate::appearance::AppearanceVec;
use crate::memory::{IdentityStatus, MatchQuality, CONFIRM_HITS, PROMOTE_AFTER};

fn d(key: &str, value: &str) -> Descriptor {
    Descriptor::new(key, value)
}

fn sighting(class: &str, descriptors: Vec<Descriptor>) -> Sighting {
    Sighting {
        class: class.into(),
        descriptors,
        camera_id: "driveway".into(),
        at: Utc::now(),
        appearance: None,
    }
}

fn sighting_with_appearance(
    class: &str,
    descriptors: Vec<Descriptor>,
    embed: AppearanceVec,
) -> Sighting {
    Sighting {
        class: class.into(),
        descriptors,
        camera_id: "driveway".into(),
        at: Utc::now(),
        appearance: Some(embed),
    }
}

fn sighting_with_appearance_and_tag(tag: &str, embed: AppearanceVec) -> Sighting {
    sighting_with_appearance("person", vec![d("name_tag", tag)], embed)
}

fn embed(values: Vec<f32>) -> AppearanceVec {
    AppearanceVec {
        model: "clip".into(),
        values,
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

#[test]
fn enrolled_identities_start_confirmed() {
    let mut r = Registry::new();
    let id = r.enroll("Mochi", "dog", vec![d("fur_color", "brown")]);
    assert_eq!(r.get(id).unwrap().status, IdentityStatus::Confirmed);
}

#[test]
fn auto_created_identities_start_tentative() {
    let mut r = Registry::new();
    let out = r.observe(&sighting("dog", vec![d("fur_color", "brown")]));
    assert_eq!(out.status, IdentityStatus::Tentative);
    assert_eq!(
        r.get(out.identity_id).unwrap().status,
        IdentityStatus::Tentative
    );
    assert_eq!(out.quality, MatchQuality::Weak);
    assert!(!out.ambiguous);
}

#[test]
fn a_strong_match_confirms_a_tentative_identity_immediately() {
    let mut r = Registry::new();
    r.observe(&sighting_with_appearance(
        "person",
        vec![],
        embed(vec![1.0, 0.0, 0.0]),
    ));
    let second = r.observe(&sighting_with_appearance(
        "person",
        vec![],
        embed(vec![1.0, 0.0, 0.0]),
    ));
    assert_eq!(second.quality, MatchQuality::Strong);
    assert_eq!(second.status, IdentityStatus::Confirmed);
}

#[test]
fn repeated_ambiguous_matches_confirm_after_confirm_hits() {
    let mut r = Registry::new();
    // A three-way partial match (two agreeing, one conflicting supporting
    // attribute) lands at 2/3 ≈ 0.67: an accepted match, but well under
    // STRONG_SCORE, so it stays Ambiguous every time — only accumulated
    // sightings, not quality, should confirm this identity.
    let create = r.observe(&sighting(
        "dog",
        vec![
            d("breed", "shiba"),
            d("accessory", "red_collar"),
            d("hair_color", "blonde"),
        ],
    ));
    assert_eq!(create.status, IdentityStatus::Tentative);

    let partial = || {
        sighting(
            "dog",
            vec![
                d("breed", "shiba"),
                d("accessory", "red_collar"),
                d("hair_color", "brown"),
            ],
        )
    };

    let second = r.observe(&partial());
    assert_eq!(second.quality, MatchQuality::Ambiguous);
    assert_eq!(second.status, IdentityStatus::Tentative);

    let third = r.observe(&partial());
    assert_eq!(third.status, IdentityStatus::Confirmed);
    assert_eq!(r.get(create.identity_id).unwrap().sightings, CONFIRM_HITS);
}

#[test]
fn appearance_memory_promotes_to_stable_after_enough_strong_matches() {
    let mut r = Registry::new();
    let first = r.observe(&sighting_with_appearance(
        "person",
        vec![],
        embed(vec![1.0, 0.0, 0.0]),
    ));
    for _ in 0..PROMOTE_AFTER {
        r.observe(&sighting_with_appearance(
            "person",
            vec![],
            embed(vec![1.0, 0.0, 0.0]),
        ));
    }
    let identity = r.get(first.identity_id).unwrap();
    let memory = identity.appearance.as_ref().unwrap();
    assert!(memory.stable.is_some());
}

#[test]
fn a_new_identity_seeds_appearance_from_its_first_sighting() {
    let mut r = Registry::new();
    let out = r.observe(&sighting_with_appearance(
        "person",
        vec![],
        embed(vec![1.0, 0.0]),
    ));
    let identity = r.get(out.identity_id).unwrap();
    let memory = identity.appearance.as_ref().unwrap();
    assert_eq!(memory.model, "clip");
    assert!(memory.stable.is_none());
}

#[test]
fn observe_batch_resolves_the_classic_swap_conflict() {
    // Two enrolled people, each seeded with an orthogonal appearance axis
    // via an unambiguous name-tag match (a distinctive attribute, so the
    // seeding sighting cannot itself be confused between them).
    let mut r = Registry::new();
    r.enroll("Alice", "person", vec![d("name_tag", "alice_tag")]);
    r.enroll("Bob", "person", vec![d("name_tag", "bob_tag")]);
    let alice_seen = r.observe(&sighting_with_appearance_and_tag(
        "alice_tag",
        embed(vec![1.0, 0.0, 0.0]),
    ));
    let bob_seen = r.observe(&sighting_with_appearance_and_tag(
        "bob_tag",
        embed(vec![0.0, 1.0, 0.0]),
    ));
    assert_eq!(alice_seen.name.as_deref(), Some("Alice"));
    assert_eq!(bob_seen.name.as_deref(), Some("Bob"));

    // Two appearance-only sightings (no name tag observed this time) that
    // greedy sequential `observe` would resolve wrong: detection 0 prefers
    // Alice only *slightly* over Bob, but detection 1 prefers Alice far
    // more strongly than detection 0 does. Processed one at a time in
    // order, greedy would give Alice to detection 0 (its own best) and
    // leave detection 1 with Bob's much weaker similarity (0.10) — well
    // under the acceptance threshold, so detection 1 would wrongly become
    // a brand new identity instead of being recognised as Bob. The batch
    // solver must instead swap them: detection 0 to Bob, detection 1 to
    // Alice, which is both collision-free and has the higher total score.
    let det0 = sighting_with_appearance("person", vec![], embed(vec![0.9, 0.85, 0.0]));
    let det1 = sighting_with_appearance("person", vec![], embed(vec![0.95, 0.1, 0.0]));
    let outcomes = r.observe_batch(&[det0, det1]);

    assert_eq!(outcomes[0].identity_id, bob_seen.identity_id);
    assert_eq!(outcomes[1].identity_id, alice_seen.identity_id);
    assert_ne!(
        outcomes[0].identity_id, outcomes[1].identity_id,
        "one identity must not be claimed by both detections"
    );
}

#[test]
fn observe_batch_of_one_matches_observe_for_the_same_sighting() {
    let mut enrolled = Registry::new();
    enrolled.enroll(
        "Mochi",
        "dog",
        vec![d("fur_color", "brown"), d("breed", "shiba")],
    );
    let mut batched = Registry::new();
    batched.enroll(
        "Mochi",
        "dog",
        vec![d("fur_color", "brown"), d("breed", "shiba")],
    );

    let s = sighting("dog", vec![d("fur_color", "brown"), d("breed", "shiba")]);
    let via_observe = enrolled.observe(&s);
    let via_batch = batched.observe_batch(std::slice::from_ref(&s));

    // `enroll` mints a fresh random id per registry, so the two registries'
    // identities are never literally the same `Uuid` — compare the
    // decisions the two paths reached instead.
    assert_eq!(via_batch.len(), 1);
    assert_eq!(via_batch[0].is_new, via_observe.is_new);
    assert_eq!(via_batch[0].name, via_observe.name);
    assert_eq!(via_batch[0].quality, via_observe.quality);
    assert_eq!(via_batch[0].sightings, via_observe.sightings);
    assert_eq!(
        via_batch[0].evidence.as_ref().map(|e| &e.matched),
        via_observe.evidence.as_ref().map(|e| &e.matched)
    );
}

#[test]
fn observe_batch_of_one_new_identity_matches_observe() {
    let mut enrolled = Registry::new();
    let mut batched = Registry::new();
    let s = sighting("dog", vec![d("fur_color", "brown")]);

    let via_observe = enrolled.observe(&s);
    let via_batch = batched.observe_batch(std::slice::from_ref(&s));

    assert_eq!(via_batch.len(), 1);
    assert!(via_batch[0].is_new);
    assert_eq!(via_batch[0].is_new, via_observe.is_new);
    assert_eq!(via_batch[0].quality, via_observe.quality);
}

#[test]
fn observe_batch_is_empty_for_empty_input() {
    let mut r = Registry::new();
    assert!(r.observe_batch(&[]).is_empty());
}

#[test]
fn observe_batch_creates_new_identities_when_none_of_the_class_exist() {
    let mut r = Registry::new();
    let sightings = vec![
        sighting("cat", vec![d("fur_color", "black")]),
        sighting("cat", vec![d("fur_color", "white")]),
    ];
    let outcomes = r.observe_batch(&sightings);
    assert!(outcomes.iter().all(|o| o.is_new));
    assert_ne!(outcomes[0].identity_id, outcomes[1].identity_id);
}

#[test]
fn observe_batch_handles_mixed_classes_independently() {
    let mut r = Registry::new();
    r.enroll("Mochi", "dog", vec![d("breed", "shiba")]);
    r.enroll("Rex", "cat", vec![d("breed", "tabby")]);

    let outcomes = r.observe_batch(&[
        sighting("dog", vec![d("breed", "shiba")]),
        sighting("cat", vec![d("breed", "tabby")]),
    ]);
    assert_eq!(outcomes[0].name.as_deref(), Some("Mochi"));
    assert_eq!(outcomes[1].name.as_deref(), Some("Rex"));
}

#[test]
fn observe_batch_never_assigns_a_refuted_plate_pair() {
    let mut r = Registry::new();
    r.observe(&sighting(
        "car",
        vec![d("license_plate", "123ABC"), d("vehicle_make", "subaru")],
    ));
    // A different plate on the same make must never be assigned, even when
    // it is the only candidate in the batch.
    let outcomes = r.observe_batch(&[sighting(
        "car",
        vec![d("license_plate", "999XYZ"), d("vehicle_make", "subaru")],
    )]);
    assert!(outcomes[0].is_new);
    assert_eq!(
        outcomes[0].rejected[0].refuted_by.as_deref(),
        Some("license_plate")
    );
}
