//! The edge pipeline: the desktop engine's chain, sized for one camera.
//!
//! Differences from the desktop engine, all in the direction of less:
//! sequential `u32` track ids instead of UUIDs (no RNG dependency), one
//! camera's state instead of a map, and fixed thresholds compiled in (the
//! hub is where an operator tunes; a deployed node should be predictable).

use actuator::Head;
use camera::Frame;
use chrono::Utc;
use motion::blobs::{extract_into, BlobScratch};
use motion::BackgroundModel;
use schemas::detection::BoundingBox;
use serde::{Deserialize, Serialize};
use spatial::motion::{describe, MotionVector};
use tracker::association::associate;

const MIN_BLOB_AREA: usize = 12;
const MIN_TRACK_IOU: f32 = 0.15;
const GATE_FRAMES: u32 = 3;
const MAX_MISSED_FRAMES: u32 = 8;

/// Incoming frame, wire-compatible with the desktop engine's request.
#[derive(Deserialize)]
struct FrameRequest {
    width: u32,
    height: u32,
    samples: Vec<u8>,
    #[serde(default)]
    dt_secs: Option<f32>,
}

/// One tracked region. Ids are sequential per boot — stable enough for a
/// node whose history lives on the hub.
#[derive(Serialize, Clone)]
struct Track {
    id: u32,
    bbox: BoundingBox,
    seen_frames: u32,
    missed_frames: u32,
    gate_open: bool,
    motion: MotionVector,
}

/// Everything the node concluded about one frame.
#[derive(Serialize)]
struct Outcome<'a> {
    frame: u64,
    regions: &'a [Track],
    triggered: Vec<u32>,
    servo: actuator::ServoCommand,
    rejected_reason: Option<String>,
}

/// Single-camera pipeline state.
pub struct Node {
    background: BackgroundModel,
    scratch: BlobScratch,
    tracks: Vec<Track>,
    head: Head,
    frame: u64,
    next_id: u32,
}

impl Node {
    /// A node with the compiled-in defaults, head parked.
    #[must_use]
    pub fn new() -> Self {
        Self {
            background: BackgroundModel::default(),
            scratch: BlobScratch::default(),
            tracks: Vec::new(),
            head: Head::default(),
            frame: 0,
            next_id: 1,
        }
    }

    /// Process one JSON frame request, returning the JSON outcome.
    ///
    /// # Errors
    /// Returns a short message for undecodable JSON; pipeline-level
    /// rejections (wrong sample count) are reported inside a `200` body the
    /// same way the desktop engine does it.
    pub fn handle(&mut self, body: &str) -> Result<String, &'static str> {
        let req: FrameRequest = serde_json::from_str(body).map_err(|_| "malformed request")?;
        self.frame += 1;
        let dt = req.dt_secs.unwrap_or(0.1).clamp(0.005, 0.5);
        let fps = 1.0 / dt;

        let expected = (req.width as usize) * (req.height as usize);
        if expected == 0 || req.samples.len() != expected {
            let outcome = Outcome {
                frame: self.frame,
                regions: &[],
                triggered: Vec::new(),
                servo: self.head.update(None, dt),
                rejected_reason: Some(format!(
                    "expected {expected} samples, got {}",
                    req.samples.len()
                )),
            };
            return serde_json::to_string(&outcome).map_err(|_| "serialize failed");
        }

        let frame = Frame {
            number: self.frame,
            width: req.width,
            height: req.height,
            data: req.samples,
            format: "gray8".into(),
            timestamp: Utc::now(),
        };
        let Ok(mask) = self.background.update(&frame) else {
            let outcome = Outcome {
                frame: self.frame,
                regions: &[],
                triggered: Vec::new(),
                servo: self.head.update(None, dt),
                rejected_reason: Some("frame size changed; relearning".into()),
            };
            return serde_json::to_string(&outcome).map_err(|_| "serialize failed");
        };

        let regions = extract_into(&mask, MIN_BLOB_AREA, &mut self.scratch);
        let triggered = self.associate(&regions, req.width, fps);

        // Aim at the best-confirmed, largest region.
        let target = self
            .tracks
            .iter()
            .max_by(|a, b| {
                a.gate_open
                    .cmp(&b.gate_open)
                    .then((a.bbox.width * a.bbox.height).total_cmp(&(b.bbox.width * b.bbox.height)))
            })
            .map(|t| {
                #[allow(clippy::cast_precision_loss)]
                let (fw, fh) = (req.width as f32, req.height as f32);
                actuator::Target {
                    x: (((t.bbox.x + t.bbox.width / 2.0) / fw) * 2.0 - 1.0).clamp(-1.0, 1.0),
                    y: (((t.bbox.y + t.bbox.height * 0.3) / fh) * 2.0 - 1.0).clamp(-1.0, 1.0),
                    area: ((t.bbox.width * t.bbox.height) / (fw * fh)).clamp(0.0, 1.0),
                }
            });
        let servo = self.head.update(target, dt);

        let outcome = Outcome {
            frame: self.frame,
            regions: &self.tracks,
            triggered,
            servo,
            rejected_reason: None,
        };
        serde_json::to_string(&outcome).map_err(|_| "serialize failed")
    }

    /// Match regions to tracks, age the unmatched, open gates.
    fn associate(&mut self, regions: &[BoundingBox], frame_width: u32, fps: f32) -> Vec<u32> {
        let existing: Vec<BoundingBox> = self.tracks.iter().map(|t| t.bbox).collect();
        let matches = associate(regions, &existing, MIN_TRACK_IOU);

        let mut matched_regions = vec![false; regions.len()];
        let mut matched_tracks = vec![false; self.tracks.len()];
        let mut triggered = Vec::new();

        for m in matches {
            matched_regions[m.detection_index] = true;
            matched_tracks[m.track_index] = true;
            let (Some(region), Some(track)) = (
                regions.get(m.detection_index),
                self.tracks.get_mut(m.track_index),
            ) else {
                continue;
            };
            let vx = (region.x + region.width / 2.0) - (track.bbox.x + track.bbox.width / 2.0);
            let vy = (region.y + region.height / 2.0) - (track.bbox.y + track.bbox.height / 2.0);
            track.motion = describe(vx, vy, frame_width, fps);
            track.bbox = *region;
            track.seen_frames += 1;
            track.missed_frames = 0;
            if !track.gate_open && track.seen_frames >= GATE_FRAMES {
                track.gate_open = true;
                triggered.push(track.id);
            }
        }

        for (i, seen) in matched_tracks.iter().enumerate() {
            if !seen {
                if let Some(track) = self.tracks.get_mut(i) {
                    track.missed_frames += 1;
                }
            }
        }
        self.tracks.retain(|t| t.missed_frames <= MAX_MISSED_FRAMES);

        for (i, region) in regions.iter().enumerate() {
            if !matched_regions[i] {
                self.tracks.push(Track {
                    id: self.next_id,
                    bbox: *region,
                    seen_frames: 1,
                    missed_frames: 0,
                    gate_open: false,
                    motion: describe(0.0, 0.0, frame_width, fps),
                });
                self.next_id = self.next_id.wrapping_add(1);
            }
        }
        triggered
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn frame_json(samples: &[u8]) -> String {
        serde_json::json!({
            "width": 20, "height": 20, "samples": samples, "dt_secs": 0.1
        })
        .to_string()
    }

    fn square(x: u32) -> Vec<u8> {
        let mut s = vec![10u8; 400];
        for dy in 0..6u32 {
            for dx in 0..6u32 {
                if x + dx < 20 {
                    s[((5 + dy) * 20 + x + dx) as usize] = 220;
                }
            }
        }
        s
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(Node::new().handle("not json").is_err());
    }

    #[test]
    fn reports_a_sample_mismatch_inside_the_outcome() {
        let out = Node::new().handle(&frame_json(&[1, 2, 3])).unwrap();
        assert!(out.contains("rejected_reason"));
        assert!(out.contains("expected 400 samples"));
    }

    #[test]
    fn tracks_a_moving_square_and_opens_the_gate_once() {
        let mut node = Node::new();
        node.handle(&frame_json(&vec![10u8; 400])).unwrap();
        let mut triggered_total = 0;
        for step in 0..6u32 {
            let out = node.handle(&frame_json(&square(step * 2))).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
            triggered_total += parsed["triggered"].as_array().unwrap().len();
        }
        assert_eq!(triggered_total, 1, "one object, one gate opening");
    }

    #[test]
    fn the_servo_tracks_and_then_recentres() {
        let mut node = Node::new();
        node.handle(&frame_json(&vec![10u8; 400])).unwrap();
        for step in 0..6u32 {
            node.handle(&frame_json(&square(step * 2))).unwrap();
        }
        let mut last = String::new();
        for _ in 0..60 {
            last = node.handle(&frame_json(&vec![10u8; 400])).unwrap();
        }
        let parsed: serde_json::Value = serde_json::from_str(&last).unwrap();
        assert_eq!(parsed["servo"]["pan_deg"].as_f64().unwrap(), 90.0);
        assert_eq!(parsed["servo"]["tracking"], false);
    }
}
