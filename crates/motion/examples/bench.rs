//! Pipeline micro-benchmark: background subtraction + blob extraction on a
//! synthetic moving scene, at the grid size the dashboard actually sends.
//!
//! Run with `cargo run -p motion --example bench --release`. Not a criterion
//! suite on purpose — this is the number an ESP32/Pi budget conversation
//! needs, reproducible with zero extra dependencies.

use camera::Frame;
use chrono::Utc;
use motion::{blobs, BackgroundModel};
use std::time::Instant;

const W: u32 = 96;
const H: u32 = 72;
const FRAMES: usize = 2_000;

fn frame(n: u64, obj_x: u32) -> Frame {
    let mut data = vec![30u8; (W * H) as usize];
    for dy in 0..18u32 {
        for dx in 0..14u32 {
            let px = obj_x + dx;
            let py = 20 + dy;
            if px < W && py < H {
                data[(py * W + px) as usize] = 230;
            }
        }
    }
    Frame {
        number: n,
        width: W,
        height: H,
        data,
        format: "gray8".into(),
        timestamp: Utc::now(),
    }
}

#[allow(clippy::cast_possible_truncation, clippy::expect_used)]
fn main() {
    let mut model = BackgroundModel::default();
    // Pre-build frames so allocation of test data is outside the timing.
    let frames: Vec<Frame> = (0..FRAMES)
        .map(|i| frame(i as u64, (i as u32 * 2) % (W - 16)))
        .collect();

    // Warm up the background.
    for f in frames.iter().take(50) {
        let _ = model.update(f);
    }

    let mut regions_total = 0usize;
    let start = Instant::now();
    for f in &frames {
        let mask = model.update(f).expect("bench frames are valid");
        regions_total += blobs::extract(&mask, 12).len();
    }
    let elapsed = start.elapsed();

    let per_frame = elapsed / FRAMES as u32;
    println!(
        "{FRAMES} frames of {W}x{H}: {:?} total, {:?}/frame ({:.0} fps possible), {} regions found",
        elapsed,
        per_frame,
        1.0 / per_frame.as_secs_f64(),
        regions_total,
    );
}
