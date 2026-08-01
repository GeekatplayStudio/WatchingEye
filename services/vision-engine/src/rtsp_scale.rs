//! ROADMAP 3.3: four simultaneous RTSP-*like* pumps into the real engine.
//!
//! Does not claim live IP cameras or ffmpeg. Proves the shared pipeline can
//! keep four independent camera_ids advancing on the same gray-grid path
//! RTSP uses after decode (`process_frame`).

#![cfg(test)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

use crate::api::{process_frame, FrameRequest, FrameState};
use crate::camera_store::{CameraRecord, CameraStore};
use crate::engine::Engine;
use crate::fixture_streams::{blank, frame_with_squares, GRID_H, GRID_W};
use crate::notify::Notifier;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;

const CAMERAS: [&str; 4] = ["rtsp-a", "rtsp-b", "rtsp-c", "rtsp-d"];
const FRAMES_EACH: u64 = 40;

fn frame_state() -> FrameState {
    FrameState {
        engine: Arc::new(Mutex::new(Engine::new())),
        notifier: Arc::new(Notifier::from_channels(HashMap::new()).unwrap()),
    }
}

fn req(camera_id: &str, samples: Vec<u8>) -> FrameRequest {
    FrameRequest {
        camera_id: camera_id.into(),
        width: GRID_W,
        height: GRID_H,
        samples,
        dt_secs: Some(0.1),
        pinned_target: None,
    }
}

#[test]
fn four_concurrent_synthetic_pumps_keep_independent_frame_counters() {
    let frames = frame_state();
    let frames_for_threads = frames.clone();

    let handles: Vec<_> = CAMERAS
        .iter()
        .enumerate()
        .map(|(idx, cam)| {
            let frames = frames_for_threads.clone();
            let camera_id = (*cam).to_owned();
            thread::spawn(move || {
                // Background learn.
                let _ = process_frame(&frames, req(&camera_id, blank()));
                let mut last_frame = 0_u64;
                for step in 0..FRAMES_EACH {
                    let x = 10 + (step as u32 % 20) + (idx as u32) * 2;
                    let out = process_frame(
                        &frames,
                        req(
                            &camera_id,
                            frame_with_squares(&[(x, 20, 8, 12)]),
                        ),
                    );
                    assert!(
                        out.frame > last_frame,
                        "{camera_id}: frame counter must advance (was {last_frame}, got {})",
                        out.frame
                    );
                    last_frame = out.frame;
                }
                last_frame
            })
        })
        .collect();

    let mut finals = Vec::new();
    for h in handles {
        finals.push(h.join().expect("camera thread"));
    }

    // Each camera advanced FRAMES_EACH (+ learn) on its own counter.
    for (i, n) in finals.iter().enumerate() {
        assert!(
            *n >= FRAMES_EACH,
            "camera {} frame count {n} < {FRAMES_EACH}",
            CAMERAS[i]
        );
    }

    // Spot-check per-camera state: each id advances from *its* thread-local
    // final (equal workloads can share the same absolute frame number).
    for (i, cam) in CAMERAS.iter().enumerate() {
        let expected = finals[i] + 1;
        let out = process_frame(&frames, req(cam, blank()));
        assert_eq!(
            out.frame, expected,
            "{cam}: expected frame {expected} after soak, got {}",
            out.frame
        );
    }
}

#[test]
fn camera_store_survives_reconnect_list() {
    let store = CameraStore::open_in_memory().unwrap();
    for (i, id) in CAMERAS.iter().enumerate() {
        store
            .upsert(&CameraRecord {
                camera_id: (*id).into(),
                url: format!("rtsp://admin:x@192.168.1.{}/h264", 10 + i),
                url_redacted: format!("rtsp://192.168.1.{}/h264", 10 + i),
                enabled: true,
                updated_at: Utc::now(),
            })
            .unwrap();
    }
    let enabled = store.list_enabled().unwrap();
    assert_eq!(enabled.len(), 4);
    store.remove("rtsp-b").unwrap();
    assert_eq!(store.list_enabled().unwrap().len(), 3);
}
