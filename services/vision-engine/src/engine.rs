//! The live pipeline: frame → validate → motion → blobs → track → gate.
//!
//! Every stage records what it concluded and why, so [`FrameOutcome`] alone
//! is enough to explain any result the dashboard renders. Nothing here
//! consults a model; classification happens later, only for gated events.

use crate::api::FrameRequest;
use camera::Frame;
use chrono::Utc;
use motion::{blobs, BackgroundModel};
use schemas::detection::BoundingBox;
use serde::Serialize;
use std::collections::HashMap;
use tracker::association::associate;
use uuid::Uuid;

/// Minimum blob area (in samples) to be considered a region, not noise.
const MIN_BLOB_AREA: usize = 12;
/// `IoU` above which a region is considered the same object as a track.
const MIN_TRACK_IOU: f32 = 0.15;
/// Frames a track may go unseen before it is dropped.
const MAX_MISSED_FRAMES: u32 = 8;
/// Consecutive frames a track needs before the gate can open.
const GATE_FRAMES: u32 = 3;

/// A region the pipeline is currently tracking.
#[derive(Debug, Clone, Serialize)]
pub struct TrackedRegion {
    /// Stable identity across frames.
    pub id: Uuid,
    /// Current position, in sample coordinates.
    pub bbox: BoundingBox,
    /// How many frames this track has been seen.
    pub seen_frames: u32,
    /// Frames since it was last matched.
    pub missed_frames: u32,
    /// True once it has satisfied the trigger gate.
    pub gate_open: bool,
}

/// Everything the pipeline concluded about one frame.
#[derive(Debug, Clone, Serialize)]
pub struct FrameOutcome {
    /// Frame sequence number assigned by the engine.
    pub frame: u64,
    /// Whether motion was detected.
    pub motion: bool,
    /// Fraction of samples that changed.
    pub changed_ratio: f32,
    /// Currently tracked regions.
    pub regions: Vec<TrackedRegion>,
    /// Ids of tracks whose gate opened on this frame.
    pub triggered: Vec<Uuid>,
    /// Set when the frame was rejected before processing.
    pub rejected_reason: Option<String>,
    /// Human-readable trace of each stage, for the zero-black-box view.
    pub trace: Vec<String>,
}

/// Fraction of foreground samples above which the frame counts as "motion".
const MOTION_RATIO: f32 = 0.004;

/// Per-camera pipeline state.
struct CameraState {
    background: BackgroundModel,
    tracks: Vec<TrackedRegion>,
    frame: u64,
}

/// The live engine. One instance holds state for every connected camera.
pub struct Engine {
    cameras: HashMap<String, CameraState>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    /// Create an engine with no cameras attached.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cameras: HashMap::new(),
        }
    }

    /// Run one frame through every stage.
    ///
    /// Invalid frames are rejected with a reason rather than processed —
    /// the frame validator is the first gate for a purpose.
    pub fn process(&mut self, req: &FrameRequest) -> FrameOutcome {
        let expected = (req.width as usize) * (req.height as usize);
        let state = self
            .cameras
            .entry(req.camera_id.clone())
            .or_insert_with(|| CameraState {
                background: BackgroundModel::default(),
                tracks: Vec::new(),
                frame: 0,
            });
        state.frame += 1;
        let frame_no = state.frame;

        let mut trace = Vec::new();
        if req.samples.len() != expected || expected == 0 {
            return FrameOutcome {
                frame: frame_no,
                motion: false,
                changed_ratio: 0.0,
                regions: Vec::new(),
                triggered: Vec::new(),
                rejected_reason: Some(format!(
                    "frame validator: expected {expected} samples, got {}",
                    req.samples.len()
                )),
                trace: vec!["frame_validator: REJECT".into()],
            };
        }
        trace.push(format!("frame_validator: PASS ({expected} samples)"));

        let frame = Frame {
            number: frame_no,
            width: req.width,
            height: req.height,
            data: req.samples.clone(),
            format: "gray8".into(),
            timestamp: Utc::now(),
        };

        let mask = match state.background.update(&frame) {
            Ok(mask) => mask,
            Err(err) => {
                return FrameOutcome {
                    frame: frame_no,
                    motion: false,
                    changed_ratio: 0.0,
                    regions: Vec::new(),
                    triggered: Vec::new(),
                    rejected_reason: Some(format!("motion detection: {err}")),
                    trace: vec!["motion_detection: ERROR".into()],
                };
            }
        };
        let foreground = mask.changed.iter().filter(|c| **c).count();
        #[allow(clippy::cast_precision_loss)]
        let changed_ratio = foreground as f32 / mask.changed.len() as f32;
        let motion = changed_ratio >= MOTION_RATIO;
        trace.push(format!(
            "motion_detection: {} ({:.2}% foreground vs background model)",
            if motion { "MOTION" } else { "static" },
            changed_ratio * 100.0
        ));

        let regions = blobs::extract(&mask, MIN_BLOB_AREA);
        trace.push(format!("blob_extraction: {} region(s)", regions.len()));

        let triggered = update_tracks(state, &regions);
        trace.push(format!("tracking: {} active track(s)", state.tracks.len()));
        trace.push(format!(
            "trigger_gate: {} (needs {GATE_FRAMES} consecutive frames)",
            if triggered.is_empty() {
                "closed"
            } else {
                "OPEN"
            }
        ));

        FrameOutcome {
            frame: frame_no,
            motion,
            changed_ratio,
            regions: state.tracks.clone(),
            triggered,
            rejected_reason: None,
            trace,
        }
    }
}

/// Associate regions to tracks, age unmatched tracks, and open gates.
fn update_tracks(state: &mut CameraState, regions: &[BoundingBox]) -> Vec<Uuid> {
    let existing: Vec<BoundingBox> = state.tracks.iter().map(|t| t.bbox).collect();
    let matches = associate(regions, &existing, MIN_TRACK_IOU);

    let mut matched_regions = vec![false; regions.len()];
    let mut matched_tracks = vec![false; state.tracks.len()];
    let mut triggered = Vec::new();

    for m in matches {
        matched_regions[m.detection_index] = true;
        matched_tracks[m.track_index] = true;
        let Some(region) = regions.get(m.detection_index) else {
            continue;
        };
        let Some(track) = state.tracks.get_mut(m.track_index) else {
            continue;
        };
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
            if let Some(track) = state.tracks.get_mut(i) {
                track.missed_frames += 1;
            }
        }
    }
    state
        .tracks
        .retain(|t| t.missed_frames <= MAX_MISSED_FRAMES);

    for (i, region) in regions.iter().enumerate() {
        if !matched_regions[i] {
            state.tracks.push(TrackedRegion {
                id: Uuid::new_v4(),
                bbox: *region,
                seen_frames: 1,
                missed_frames: 0,
                gate_open: false,
            });
        }
    }
    triggered
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    /// A 20x20 frame with a filled square at (x, y).
    fn frame_with_square(x: u32, y: u32, size: u32) -> Vec<u8> {
        let mut data = vec![10_u8; 400];
        for dy in 0..size {
            for dx in 0..size {
                let px = x + dx;
                let py = y + dy;
                if px < 20 && py < 20 {
                    data[(py * 20 + px) as usize] = 220;
                }
            }
        }
        data
    }

    fn req(samples: Vec<u8>) -> FrameRequest {
        FrameRequest {
            camera_id: "cam".into(),
            width: 20,
            height: 20,
            samples,
        }
    }

    #[test]
    fn rejects_a_frame_whose_size_does_not_match() {
        let mut e = Engine::new();
        let out = e.process(&FrameRequest {
            camera_id: "cam".into(),
            width: 20,
            height: 20,
            samples: vec![0; 7],
        });
        assert!(out.rejected_reason.is_some());
        assert_eq!(out.trace, vec!["frame_validator: REJECT"]);
    }

    #[test]
    fn static_scene_produces_no_tracks() {
        let mut e = Engine::new();
        for _ in 0..5 {
            let out = e.process(&req(vec![10; 400]));
            assert!(out.regions.is_empty());
        }
    }

    #[test]
    fn a_moving_object_is_tracked_and_gates_open() {
        let mut e = Engine::new();
        e.process(&req(vec![10; 400])); // learn the background
        let mut opened = Vec::new();
        let mut ids = Vec::new();
        for step in 0..5 {
            let out = e.process(&req(frame_with_square(step, 5, 6)));
            opened.extend(out.triggered);
            ids.extend(out.regions.iter().map(|r| r.id));
        }
        assert!(
            !opened.is_empty(),
            "gate should open for a persistent moving object"
        );
        assert_eq!(
            opened.len(),
            1,
            "the gate opens once per object, not once per frame"
        );
    }

    #[test]
    fn a_moving_object_keeps_one_identity_across_frames() {
        let mut e = Engine::new();
        e.process(&req(vec![10; 400]));
        let mut seen = std::collections::HashSet::new();
        for step in 0..5 {
            for region in e.process(&req(frame_with_square(step, 5, 6))).regions {
                seen.insert(region.id);
            }
        }
        assert_eq!(
            seen.len(),
            1,
            "one object must not fragment into many tracks"
        );
    }

    #[test]
    fn every_frame_carries_an_explanation_trace() {
        let mut e = Engine::new();
        let out = e.process(&req(vec![10; 400]));
        assert!(out.trace.iter().any(|t| t.starts_with("frame_validator")));
        assert!(out.trace.iter().any(|t| t.starts_with("motion_detection")));
        assert!(out.trace.iter().any(|t| t.starts_with("trigger_gate")));
    }

    #[test]
    fn cameras_keep_independent_state() {
        let mut e = Engine::new();
        e.process(&req(vec![10; 400]));
        let other = FrameRequest {
            camera_id: "other".into(),
            width: 20,
            height: 20,
            samples: vec![10; 400],
        };
        let out = e.process(&other);
        assert_eq!(out.frame, 1, "a second camera starts its own frame count");
    }
}
