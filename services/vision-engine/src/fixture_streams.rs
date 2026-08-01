//! Snapshot tests of full engine event streams over synthetic gray sequences.
//!
//! These are FileCamera-compatible **96×72 gray8** frame generators — not
//! MP4 videos. They exercise [`Engine::process`] end-to-end so association,
//! gating, and motion flags stay locked to a compact, UUID-normalized table.

#![cfg(test)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

use crate::api::FrameRequest;
use crate::engine::Engine;
use std::collections::HashMap;
use uuid::Uuid;

/// Engine grid width (96) matching `FileCamera` / RTSP decode.
pub(crate) const GRID_W: u32 = 96;
/// Engine grid height (72) matching `FileCamera` / RTSP decode.
pub(crate) const GRID_H: u32 = 72;

const BG: u8 = 10;
const FG: u8 = 220;

/// Flat gray background frame.
pub(crate) fn blank() -> Vec<u8> {
    vec![BG; (GRID_W * GRID_H) as usize]
}

/// One filled rectangle on a flat background (sample coordinates).
pub(crate) fn paint_square(data: &mut [u8], x: u32, y: u32, w: u32, h: u32) {
    for dy in 0..h {
        for dx in 0..w {
            let px = x + dx;
            let py = y + dy;
            if px < GRID_W && py < GRID_H {
                data[(py * GRID_W + px) as usize] = FG;
            }
        }
    }
}

/// Frame with zero or more bright squares.
pub(crate) fn frame_with_squares(squares: &[(u32, u32, u32, u32)]) -> Vec<u8> {
    let mut data = blank();
    for &(x, y, w, h) in squares {
        paint_square(&mut data, x, y, w, h);
    }
    data
}

/// Build a [`FrameRequest`] for the standard gray grid.
pub(crate) fn req(samples: Vec<u8>) -> FrameRequest {
    FrameRequest {
        camera_id: "fixture".into(),
        width: GRID_W,
        height: GRID_H,
        samples,
        dt_secs: Some(0.1),
        pinned_target: None,
    }
}

/// Bounce `step` across `[0, span]` so a walker never teleports.
fn bounce(step: u32, span: u32) -> u32 {
    let cycle = span.saturating_mul(2).max(1);
    let t = step % cycle;
    if t <= span {
        t
    } else {
        cycle - t
    }
}

/// Left-half walker position that stays clear of the right half.
pub(crate) fn left_walker_xy(step: u32) -> (u32, u32) {
    (8 + bounce(step, 40), 24)
}

/// Right-half walker position, always separated from [`left_walker_xy`].
pub(crate) fn right_walker_xy(step: u32) -> (u32, u32) {
    (50 + bounce(step, 40), 24)
}

/// Compact per-frame summary after remapping raw track UUIDs to ordinals.
#[derive(Debug, Clone, PartialEq, Eq)]
struct StreamFrame {
    frame: u64,
    motion: bool,
    /// Ordinal id + whether the gate is open.
    tracks: Vec<(u32, bool)>,
    /// Ordinals whose gate opened on this frame.
    triggered: Vec<u32>,
}

/// Remap UUIDs to stable ordinals in first-seen order.
struct IdMap {
    order: HashMap<Uuid, u32>,
    next: u32,
}

impl IdMap {
    fn new() -> Self {
        Self {
            order: HashMap::new(),
            next: 0,
        }
    }

    fn ordinal(&mut self, id: Uuid) -> u32 {
        if let Some(&n) = self.order.get(&id) {
            return n;
        }
        let n = self.next;
        self.next += 1;
        self.order.insert(id, n);
        n
    }
}

fn compact_stream(outcomes: &[crate::engine::FrameOutcome]) -> Vec<StreamFrame> {
    let mut ids = IdMap::new();
    outcomes
        .iter()
        .map(|out| {
            let mut tracks: Vec<(u32, bool)> = out
                .regions
                .iter()
                .map(|r| (ids.ordinal(r.id), r.gate_open))
                .collect();
            tracks.sort_by_key(|(ord, _)| *ord);
            let mut triggered: Vec<u32> = out.triggered.iter().map(|id| ids.ordinal(*id)).collect();
            triggered.sort_unstable();
            StreamFrame {
                frame: out.frame,
                motion: out.motion,
                tracks,
                triggered,
            }
        })
        .collect()
}

fn run_sequence(frames: impl IntoIterator<Item = Vec<u8>>) -> Vec<StreamFrame> {
    let mut engine = Engine::new();
    let outcomes: Vec<_> = frames.into_iter().map(|s| engine.process(req(s))).collect();
    compact_stream(&outcomes)
}

/// `static`: background learn + flat frames — no tracks ever.
fn sequence_static(n: u32) -> Vec<Vec<u8>> {
    (0..n).map(|_| blank()).collect()
}

/// `one_walker`: learn, then one left-half blob walking for `n` frames.
fn sequence_one_walker(n: u32) -> Vec<Vec<u8>> {
    let mut frames = vec![blank()];
    for step in 0..n {
        let (x, y) = left_walker_xy(step);
        frames.push(frame_with_squares(&[(x, y, 8, 12)]));
    }
    frames
}

/// `two_walkers`: learn, then two well-separated walkers for `n` frames.
fn sequence_two_walkers(n: u32) -> Vec<Vec<u8>> {
    let mut frames = vec![blank()];
    for step in 0..n {
        let (lx, ly) = left_walker_xy(step);
        let (rx, ry) = right_walker_xy(step);
        frames.push(frame_with_squares(&[(lx, ly, 8, 12), (rx, ry, 8, 12)]));
    }
    frames
}

fn fmt_stream(stream: &[StreamFrame]) -> String {
    stream
        .iter()
        .map(|f| {
            let tracks: Vec<String> = f
                .tracks
                .iter()
                .map(|(id, gate)| format!("{id}{}", if *gate { "G" } else { "g" }))
                .collect();
            let trig: Vec<String> = f.triggered.iter().map(ToString::to_string).collect();
            format!(
                "f{}:{}:[{}]:[{}]",
                f.frame,
                if f.motion { "M" } else { "s" },
                tracks.join(","),
                trig.join(",")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn snapshot_static_sequence_has_no_tracks() {
    // 1 learn + 5 static (6 total). Frame numbers start at 1.
    let stream = run_sequence(sequence_static(6));
    let expected = [
        "f1:s:[]:[]",
        "f2:s:[]:[]",
        "f3:s:[]:[]",
        "f4:s:[]:[]",
        "f5:s:[]:[]",
        "f6:s:[]:[]",
    ]
    .join("\n");
    assert_eq!(fmt_stream(&stream), expected);
}

#[test]
fn snapshot_one_walker_stream() {
    // Learn + 6 walk frames. Gate opens on the 3rd consecutive sighting
    // (default `gate_frames = 3`) → engine frame 4.
    let stream = run_sequence(sequence_one_walker(6));
    let expected = [
        "f1:s:[]:[]",
        "f2:M:[0g]:[]",
        "f3:M:[0g]:[]",
        "f4:M:[0G]:[0]",
        "f5:M:[0G]:[]",
        "f6:M:[0G]:[]",
        "f7:M:[0G]:[]",
    ]
    .join("\n");
    assert_eq!(fmt_stream(&stream), expected);
}

#[test]
fn snapshot_two_walkers_stream() {
    // Learn + 6 frames with two separated blobs. Both gates open together.
    let stream = run_sequence(sequence_two_walkers(6));
    let expected = [
        "f1:s:[]:[]",
        "f2:M:[0g,1g]:[]",
        "f3:M:[0g,1g]:[]",
        "f4:M:[0G,1G]:[0,1]",
        "f5:M:[0G,1G]:[]",
        "f6:M:[0G,1G]:[]",
        "f7:M:[0G,1G]:[]",
    ]
    .join("\n");
    assert_eq!(fmt_stream(&stream), expected);
}
