//! Formal tracker soak: two people keep distinct UUIDs across 100 frames.
//!
//! Exercises the live path — [`Engine::process`] → `associate_predicted` —
//! on synthetic 96×72 gray8 sequences (FileCamera-compatible), not MP4s.

#![cfg(test)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

use crate::engine::Engine;
use crate::fixture_streams::{blank, frame_with_squares, left_walker_xy, req, right_walker_xy};
use std::collections::HashSet;
use uuid::Uuid;

const SOAK_FRAMES: u32 = 100;
const BLOB_W: u32 = 8;
const BLOB_H: u32 = 12;

#[test]
fn two_people_keep_distinct_uuids_across_100_frames() {
    let mut engine = Engine::new();
    // Background learn (first frame yields an all-false mask).
    engine.process(req(blank()));

    let mut all_ids: HashSet<Uuid> = HashSet::new();
    let mut first_pair: Option<(Uuid, Uuid)> = None;

    for step in 0..SOAK_FRAMES {
        let (lx, ly) = left_walker_xy(step);
        let (rx, ry) = right_walker_xy(step);
        let out = engine.process(req(frame_with_squares(&[
            (lx, ly, BLOB_W, BLOB_H),
            (rx, ry, BLOB_W, BLOB_H),
        ])));

        assert_eq!(
            out.regions.len(),
            2,
            "frame {}: expected exactly 2 tracks, got {}",
            out.frame,
            out.regions.len()
        );

        let mut frame_ids: Vec<Uuid> = out.regions.iter().map(|r| r.id).collect();
        frame_ids.sort_unstable();
        all_ids.extend(frame_ids.iter().copied());

        match &first_pair {
            None => {
                first_pair = Some((frame_ids[0], frame_ids[1]));
            }
            Some((a, b)) => {
                assert_eq!(
                    frame_ids,
                    vec![*a, *b],
                    "frame {}: track UUIDs flipped or replaced (got {frame_ids:?}, want [{a}, {b}])",
                    out.frame
                );
            }
        }
    }

    assert_eq!(
        all_ids.len(),
        2,
        "entire soak must use exactly 2 stable UUIDs, saw {}",
        all_ids.len()
    );
}
