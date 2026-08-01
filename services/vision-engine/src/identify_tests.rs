//! Unit tests for `identify.rs`'s HTTP handlers, kept out of that file to
//! respect the workspace's per-file line budget.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
use super::*;

fn registry() -> IdentityState {
    IdentityState {
        registry: Arc::new(Mutex::new(Registry::new())),
        store: Arc::new(IdentityStore::open_in_memory().expect("in-memory store")),
    }
}

fn request(class: &str, pairs: &[(&str, &str)]) -> IdentifyRequest {
    IdentifyRequest {
        class: class.into(),
        descriptors: pairs
            .iter()
            .map(|(k, v)| DescriptorDto {
                key: (*k).into(),
                value: (*v).into(),
            })
            .collect(),
        camera_id: "webcam".into(),
        appearance: None,
    }
}

fn request_with_appearance(
    class: &str,
    pairs: &[(&str, &str)],
    appearance: AppearanceDto,
) -> IdentifyRequest {
    IdentifyRequest {
        class: class.into(),
        descriptors: pairs
            .iter()
            .map(|(k, v)| DescriptorDto {
                key: (*k).into(),
                value: (*v).into(),
            })
            .collect(),
        camera_id: "webcam".into(),
        appearance: Some(appearance),
    }
}

#[tokio::test]
async fn first_sighting_creates_an_identity() {
    let r = registry();
    let Json(out) = identify(State(r), Json(request("dog", &[("fur_color", "brown")]))).await;
    assert!(out.is_new);
}

#[tokio::test]
async fn the_same_object_is_recognised_on_return() {
    let r = registry();
    let Json(first) = identify(
        State(r.clone()),
        Json(request("car", &[("license_plate", "123ABC")])),
    )
    .await;
    let Json(second) = identify(
        State(r.clone()),
        Json(request("car", &[("license_plate", "123ABC")])),
    )
    .await;
    assert_eq!(first.identity_id, second.identity_id);
    assert_eq!(second.sightings, 2);
}

#[tokio::test]
async fn naming_then_listing_shows_the_name() {
    let r = registry();
    let Json(out) = identify(
        State(r.clone()),
        Json(request("dog", &[("breed", "shiba")])),
    )
    .await;
    let Json(res) = name_identity(
        State(r.clone()),
        Json(NameRequest {
            identity_id: out.identity_id,
            name: "Mochi".into(),
        }),
    )
    .await;
    assert_eq!(res["ok"], true);

    let Json(listing) = list_identities(State(r)).await;
    assert_eq!(
        listing.identities[0].identity.name.as_deref(),
        Some("Mochi")
    );
}

#[tokio::test]
async fn same_appearance_embedding_without_descriptors_matches() {
    let r = registry();
    let embed = AppearanceDto {
        model: "clip".into(),
        values: vec![1.0, 0.0, 0.0],
    };
    let Json(first) = identify(
        State(r.clone()),
        Json(request_with_appearance("person", &[], embed.clone())),
    )
    .await;
    let Json(second) = identify(
        State(r),
        Json(request_with_appearance("person", &[], embed)),
    )
    .await;
    assert_eq!(first.identity_id, second.identity_id);
    assert_eq!(second.sightings, 2);
}

#[tokio::test]
async fn batch_assigns_two_sightings_to_two_distinct_identities() {
    let r = registry();
    // Enroll by observing two distinguishable individuals first.
    let Json(first) = identify(
        State(r.clone()),
        Json(request("dog", &[("breed", "shiba")])),
    )
    .await;
    let Json(second) = identify(
        State(r.clone()),
        Json(request("dog", &[("breed", "labrador")])),
    )
    .await;

    let Json(batch) = identify_batch(
        State(r.clone()),
        Json(IdentifyBatchRequest {
            sightings: vec![
                request("dog", &[("breed", "labrador")]),
                request("dog", &[("breed", "shiba")]),
            ],
        }),
    )
    .await;

    assert_eq!(batch.outcomes.len(), 2);
    assert_eq!(batch.outcomes[0].identity_id, second.identity_id);
    assert_eq!(batch.outcomes[1].identity_id, first.identity_id);
    assert_ne!(
        batch.outcomes[0].identity_id, batch.outcomes[1].identity_id,
        "two sightings in one batch must not collide on one identity"
    );
}

#[tokio::test]
async fn batch_with_no_sightings_returns_no_outcomes() {
    let Json(batch) = identify_batch(
        State(registry()),
        Json(IdentifyBatchRequest { sightings: vec![] }),
    )
    .await;
    assert!(batch.outcomes.is_empty());
}

#[tokio::test]
async fn batch_of_one_creates_a_new_identity_like_the_single_endpoint() {
    let Json(batch) = identify_batch(
        State(registry()),
        Json(IdentifyBatchRequest {
            sightings: vec![request("cat", &[("fur_color", "black")])],
        }),
    )
    .await;
    assert_eq!(batch.outcomes.len(), 1);
    assert!(batch.outcomes[0].is_new);
}

fn request_on_camera(class: &str, pairs: &[(&str, &str)], camera_id: &str) -> IdentifyRequest {
    IdentifyRequest {
        class: class.into(),
        descriptors: pairs
            .iter()
            .map(|(k, v)| DescriptorDto {
                key: (*k).into(),
                value: (*v).into(),
            })
            .collect(),
        camera_id: camera_id.into(),
        appearance: None,
    }
}

#[tokio::test]
async fn get_identity_returns_404_for_an_unknown_id() {
    let res = get_identity(State(registry()), Path(Uuid::new_v4())).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_identity_returns_the_full_timeline_for_a_known_id() {
    let r = registry();
    let Json(out) = identify(
        State(r.clone()),
        Json(request("dog", &[("breed", "shiba")])),
    )
    .await;
    let res = get_identity(State(r), Path(out.identity_id)).await;
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_sighting_on_two_cameras_stays_one_identity_and_is_flagged_multi_camera() {
    let r = registry();
    let Json(first) = identify(
        State(r.clone()),
        Json(request_on_camera(
            "car",
            &[("license_plate", "123ABC")],
            "front",
        )),
    )
    .await;
    assert!(!first.crossed_camera);
    assert_eq!(first.cameras_seen, vec!["front".to_string()]);

    let Json(second) = identify(
        State(r.clone()),
        Json(request_on_camera(
            "car",
            &[("license_plate", "123ABC")],
            "backyard",
        )),
    )
    .await;
    assert_eq!(second.identity_id, first.identity_id);
    assert!(second.crossed_camera);
    assert_eq!(
        second.cameras_seen,
        vec!["backyard".to_string(), "front".to_string()]
    );

    let Json(listing) = list_identities(State(r.clone())).await;
    let summary = listing
        .identities
        .iter()
        .find(|s| s.identity.id == first.identity_id)
        .expect("identity must be listed");
    assert!(summary.multi_camera);
    assert_eq!(
        summary.cameras_seen,
        vec!["backyard".to_string(), "front".to_string()]
    );
}

#[tokio::test]
async fn identify_persists_and_survives_a_registry_restart() {
    let dir = std::env::temp_dir().join(format!("we-identify-restart-{}", Uuid::new_v4()));
    let db_path = dir.join("identities.sqlite");

    let store = Arc::new(IdentityStore::open(&db_path).expect("open store"));
    let state = IdentityState {
        registry: Arc::new(Mutex::new(Registry::new())),
        store: store.clone(),
    };
    let Json(first) = identify(
        State(state.clone()),
        Json(request("car", &[("license_plate", "123ABC")])),
    )
    .await;
    drop(state);
    drop(store);

    // Simulate a restart: fresh registry, reopen the same database file,
    // and seed the registry from what was persisted.
    let reopened_store = Arc::new(IdentityStore::open(&db_path).expect("reopen store"));
    let mut reloaded_registry = Registry::new();
    reloaded_registry.import(
        reopened_store
            .load_all()
            .expect("load persisted identities"),
    );
    let reloaded_state = IdentityState {
        registry: Arc::new(Mutex::new(reloaded_registry)),
        store: reopened_store,
    };

    let Json(second) = identify(
        State(reloaded_state),
        Json(request("car", &[("license_plate", "123ABC")])),
    )
    .await;
    assert_eq!(second.identity_id, first.identity_id);
    assert_eq!(second.sightings, 2);
    assert!(!second.is_new);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn get_timeline_reads_persisted_history_and_is_empty_for_unknown_ids() {
    let state = registry();
    let Json(out) = identify(
        State(state.clone()),
        Json(request("dog", &[("breed", "shiba")])),
    )
    .await;

    let Json(timeline) = get_timeline(State(state.clone()), Path(out.identity_id)).await;
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].camera_id, "webcam");

    let Json(empty) = get_timeline(State(state), Path(Uuid::new_v4())).await;
    assert!(empty.is_empty());
}
