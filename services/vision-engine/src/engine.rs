//! The live pipeline: frame → validate → motion → (optional detector) → blobs → track → gate → zones → rules.
//!
//! Every stage records what it concluded and why, so [`FrameOutcome`] alone
//! is enough to explain any result the dashboard renders. Object detection is
//! motion-gated ([`crate::motion_detector_gate`]); the live binary leaves the
//! detector unset (ADR 0004 — YOLO in the orchestrator). Classification of
//! gated events remains the agent layer's job. Rule actions are returned as
//! [`PendingNotify`] — HTTP delivery lives in [`crate::notify`], never here.

use crate::api::FrameRequest;
use crate::config::EngineConfig;
use crate::pinned::{self, PinnedLock, PinnedStatus};
use crate::rule_set;
use crate::zone_rules::{self, PendingNotify};
use crate::zones::ZoneMonitor;
use actuator::{Head, ServoCommand, Target};
use camera::Frame;
use chrono::Utc;
use events::Event;
use motion::blobs::BlobScratch;
use motion::{blobs, BackgroundModel};
use rules::Rule;
use schemas::detection::BoundingBox;
use serde::Serialize;
use spatial::motion::{describe, MotionVector};
use std::collections::HashMap;
use tracker::association::{associate_predicted, TrackState};
use uuid::Uuid;

// Thresholds live in `EngineConfig` so they can be tuned while watching the
// effect; see `crate::config`.

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
    /// Horizontal movement per frame, in samples. Lets a client extrapolate
    /// between engine updates so the overlay stays smooth at display rate.
    pub vx: f32,
    /// Vertical movement per frame, in samples.
    pub vy: f32,
    /// Direction and speed of travel, derived from the velocity above.
    pub motion: MotionVector,
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
    /// The subject the head should aim at, in normalised coordinates.
    pub target: Option<Target>,
    /// Where the pan/tilt head has been commanded to point.
    pub servo: ServoCommand,
    /// Id of the region chosen as the aim point.
    pub target_id: Option<Uuid>,
    /// Optional target point [x, y] in normalized coordinates [0.0, 1.0] for Point Cross Assign.
    pub pinned_target: Option<[f32; 2]>,
    /// Whether the Point Cross assignment is following a subject, holding at
    /// the click point, or inactive.
    pub pinned_status: PinnedStatus,
    /// The track the assignment is following, when it has one.
    pub pinned_track_id: Option<Uuid>,
    /// Zone-enter events emitted on this frame (at most once per stay).
    pub zone_events: Vec<Event>,
    /// True when the motion-gated object detector ran on this frame.
    pub detector_invoked: bool,
    /// Rule actions awaiting async webhook delivery (not executed here).
    #[serde(skip)]
    pub pending_notifies: Vec<PendingNotify>,
}

/// Per-camera pipeline state.
struct CameraState {
    background: BackgroundModel,
    tracks: Vec<TrackedRegion>,
    frame: u64,
    head: Head,
    /// Flood-fill scratch, reused so blob extraction allocates nothing
    /// per frame after the first.
    scratch: BlobScratch,
    /// Active Point Cross assignment, held across frames so the aim follows
    /// the subject rather than the coordinate it was assigned at.
    pinned: Option<PinnedLock>,
    /// Named zones and which tracks are currently inside them.
    zones: ZoneMonitor,
}

/// Aim at a bare screen point, used while an assignment has nothing to
/// follow. Holding the crosshair position is honest about the situation;
/// silently falling back to some other subject would not be.
fn point_target(point: [f32; 2]) -> Target {
    Target {
        x: (point[0] * 2.0 - 1.0).clamp(-1.0, 1.0),
        y: (point[1] * 2.0 - 1.0).clamp(-1.0, 1.0),
        area: 0.05,
    }
}

/// Choose what the head should aim at when no assignment is active:
/// confirmed subjects win over unconfirmed ones, then larger over smaller.
fn pick_target(
    tracks: &[TrackedRegion],
    width: u32,
    height: u32,
) -> Option<(&TrackedRegion, Target)> {
    let region = tracks.iter().max_by(|a, b| {
        a.gate_open
            .cmp(&b.gate_open)
            .then((a.bbox.width * a.bbox.height).total_cmp(&(b.bbox.width * b.bbox.height)))
            .then(b.id.cmp(&a.id))
    })?;
    Some((region, aim_point(region, width, height)))
}

/// Convert a region's centre into normalised aim coordinates.
///
/// The aim point sits above centre by a fraction of the region's height:
/// for a person-shaped blob the head is near the top, so aiming at the
/// centroid would point the camera at their chest.
fn aim_point(region: &TrackedRegion, width: u32, height: u32) -> Target {
    #[allow(clippy::cast_precision_loss)]
    let (fw, fh) = (width as f32, height as f32);
    let cx = region.bbox.x + region.bbox.width / 2.0;
    let cy = region.bbox.y + region.bbox.height * 0.3;
    Target {
        x: ((cx / fw) * 2.0 - 1.0).clamp(-1.0, 1.0),
        y: ((cy / fh) * 2.0 - 1.0).clamp(-1.0, 1.0),
        area: ((region.bbox.width * region.bbox.height) / (fw * fh)).clamp(0.0, 1.0),
    }
}

/// What the head was told to do this frame, and why.
struct Aim {
    target: Option<Target>,
    target_id: Option<Uuid>,
    pinned_status: PinnedStatus,
    pinned_track_id: Option<Uuid>,
}

/// Decide what to aim at, advancing any Point Cross assignment first.
///
/// An active assignment always wins over automatic selection: the operator
/// chose a subject, and quietly aiming somewhere else would make the
/// crosshair a suggestion rather than an instruction.
fn resolve_aim(
    state: &mut CameraState,
    point: Option<[f32; 2]>,
    width: u32,
    height: u32,
    trace: &mut Vec<String>,
) -> Aim {
    let pinned_status = pinned::update(&mut state.pinned, point, &state.tracks, width, height);
    let pinned_track_id = state.pinned.and_then(|l| l.track_id);

    let (target, target_id) = match pinned_status {
        // `Following` guarantees the id resolved against this frame's tracks.
        PinnedStatus::Following => pinned_track_id
            .and_then(|id| state.tracks.iter().find(|r| r.id == id))
            .map_or((None, None), |r| {
                (Some(aim_point(r, width, height)), Some(r.id))
            }),
        PinnedStatus::Searching => (point.map(point_target), None),
        PinnedStatus::Idle => match pick_target(&state.tracks, width, height) {
            Some((region, aim)) => (Some(aim), Some(region.id)),
            None => (None, None),
        },
    };

    match pinned_status {
        PinnedStatus::Following => {
            let short: String = pinned_track_id.map_or_else(
                || "?".to_owned(),
                |id| id.to_string().chars().take(8).collect(),
            );
            trace.push(format!("point_cross_assign: FOLLOWING track {short}"));
        }
        PinnedStatus::Searching => {
            trace.push("point_cross_assign: SEARCHING (holding at the assigned point)".to_owned());
        }
        PinnedStatus::Idle => {}
    }

    Aim {
        target,
        target_id,
        pinned_status,
        pinned_track_id,
    }
}

/// Build the outcome for a frame that never made it through a stage.
///
/// The head is still commanded — a bad frame must not leave the servo loop
/// without instruction, or it would silently keep its last angle forever.
fn rejected(frame_no: u64, servo: ServoCommand, reason: String, stage: &str) -> FrameOutcome {
    FrameOutcome {
        frame: frame_no,
        motion: false,
        changed_ratio: 0.0,
        regions: Vec::new(),
        triggered: Vec::new(),
        rejected_reason: Some(reason),
        trace: vec![stage.to_owned()],
        target: None,
        servo,
        target_id: None,
        pinned_target: None,
        pinned_status: PinnedStatus::Idle,
        pinned_track_id: None,
        zone_events: Vec::new(),
        detector_invoked: false,
        pending_notifies: Vec::new(),
    }
}

/// The live engine. One instance holds state for every connected camera.
pub struct Engine {
    cameras: HashMap<String, CameraState>,
    config: EngineConfig,
    rules: Vec<Rule>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    /// Create an engine with no cameras attached, default thresholds, and
    /// the env/hard-coded rule set.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cameras: HashMap::new(),
            config: EngineConfig::default(),
            rules: rule_set::default_rules(),
        }
    }

    /// The thresholds currently in force.
    #[must_use]
    pub fn config(&self) -> EngineConfig {
        self.config
    }

    /// Replace the rule set (tests and live reconfiguration).
    #[cfg(test)]
    pub fn set_rules(&mut self, rules: Vec<Rule>) {
        self.rules = rules;
    }

    /// Apply new thresholds, clamping them into safe ranges.
    ///
    /// Changing how the background is modelled invalidates what every camera
    /// has learned, so those models are rebuilt; the scene is re-learned over
    /// the next few frames rather than producing a burst of false regions.
    pub fn set_config(&mut self, config: EngineConfig) -> EngineConfig {
        let next = config.sanitized();
        if self.config.requires_background_reset(next) {
            for state in self.cameras.values_mut() {
                state.background = BackgroundModel::new(next.background_alpha, next.sensitivity);
                state.tracks.clear();
                state.zones = ZoneMonitor::default_garage();
            }
        }
        self.config = next;
        next
    }

    /// Run one frame through every stage (no object-detector backend).
    ///
    /// Takes the request by value so the sample buffer moves into the
    /// pipeline instead of being cloned — one fewer full-frame copy per
    /// frame per camera, which is what a Pi-class budget notices.
    ///
    /// Invalid frames are rejected with a reason rather than processed —
    /// the frame validator is the first gate for a purpose.
    pub fn process(&mut self, req: FrameRequest) -> FrameOutcome {
        self.process_with_optional_detector(req, None)
    }

    /// Like [`process`], optionally invoking `detector` **only when motion
    /// is true** (ROADMAP 1.2). Static scenes never call `detect`.
    pub fn process_with_detector(
        &mut self,
        req: FrameRequest,
        detector: &mut dyn detector::Detector,
    ) -> FrameOutcome {
        self.process_with_optional_detector(req, Some(detector))
    }

    fn process_with_optional_detector(
        &mut self,
        req: FrameRequest,
        detector: Option<&mut dyn detector::Detector>,
    ) -> FrameOutcome {
        let expected = (req.width as usize) * (req.height as usize);
        let config = self.config;
        let rules = self.rules.clone();
        // Frame interval reported by the client, clamped to something sane so
        // a stalled tab cannot command a huge servo step on resume.
        let dt = req.dt_secs.unwrap_or(0.1).clamp(0.005, 0.5);
        let camera_id = req.camera_id.clone();
        let state = self
            .cameras
            .entry(req.camera_id)
            .or_insert_with(|| CameraState {
                background: BackgroundModel::new(config.background_alpha, config.sensitivity),
                tracks: Vec::new(),
                frame: 0,
                head: Head::default(),
                scratch: BlobScratch::default(),
                pinned: None,
                zones: ZoneMonitor::default_garage(),
            });
        state.frame += 1;
        let frame_no = state.frame;

        let mut trace = Vec::new();
        if req.samples.len() != expected || expected == 0 {
            return rejected(
                frame_no,
                state.head.update(None, dt),
                format!(
                    "frame validator: expected {expected} samples, got {}",
                    req.samples.len()
                ),
                "frame_validator: REJECT",
            );
        }
        trace.push(format!("frame_validator: PASS ({expected} samples)"));

        let frame = Frame {
            number: frame_no,
            width: req.width,
            height: req.height,
            data: req.samples,
            format: "gray8".into(),
            timestamp: Utc::now(),
        };

        let mask = match state.background.update(&frame) {
            Ok(mask) => mask,
            Err(err) => {
                return rejected(
                    frame_no,
                    state.head.update(None, dt),
                    format!("motion detection: {err}"),
                    "motion_detection: ERROR",
                );
            }
        };
        let foreground = mask.changed.iter().filter(|c| **c).count();
        #[allow(clippy::cast_precision_loss)]
        let changed_ratio = foreground as f32 / mask.changed.len() as f32;
        let motion = changed_ratio >= config.motion_ratio;
        trace.push(format!(
            "motion_detection: {} ({:.2}% foreground vs background model)",
            if motion { "MOTION" } else { "static" },
            changed_ratio * 100.0
        ));

        let had_detector = detector.is_some();
        let detector_invoked = crate::motion_detector_gate::maybe_invoke(motion, detector, &frame);
        if had_detector {
            if detector_invoked {
                trace.push("object_detector: invoked (motion)".to_owned());
            } else {
                trace.push("object_detector: skipped (static)".to_owned());
            }
        }

        let regions = blobs::extract_into(&mask, config.min_region_area, &mut state.scratch);
        trace.push(format!("blob_extraction: {} region(s)", regions.len()));

        let triggered = update_tracks(state, &regions, config, req.width, 1.0 / dt);
        trace.push(format!("tracking: {} active track(s)", state.tracks.len()));
        trace.push(format!(
            "trigger_gate: {} (needs {} consecutive frames)",
            if triggered.is_empty() {
                "closed"
            } else {
                "OPEN"
            },
            config.gate_frames
        ));

        let (zone_events, pending_notifies) =
            evaluate_zones(state, &camera_id, &rules, req.width, req.height, &mut trace);

        let aim = resolve_aim(state, req.pinned_target, req.width, req.height, &mut trace);
        let target = aim.target;
        let servo = state.head.update(target, dt);
        push_aim_trace(&mut trace, target, &servo);

        FrameOutcome {
            frame: frame_no,
            motion,
            changed_ratio,
            regions: state.tracks.clone(),
            triggered,
            rejected_reason: None,
            trace,
            target,
            servo,
            target_id: aim.target_id,
            pinned_target: req.pinned_target,
            pinned_status: aim.pinned_status,
            pinned_track_id: aim.pinned_track_id,
            zone_events,
            detector_invoked,
            pending_notifies,
        }
    }
}

/// Zone membership + rule evaluation for the current tracks.
fn evaluate_zones(
    state: &mut CameraState,
    camera_id: &str,
    rules: &[Rule],
    width: u32,
    height: u32,
    trace: &mut Vec<String>,
) -> (Vec<Event>, Vec<PendingNotify>) {
    let track_boxes: Vec<(Uuid, BoundingBox)> =
        state.tracks.iter().map(|t| (t.id, t.bbox)).collect();
    let enters = state.zones.update(&track_boxes, width, height);
    let (zone_events, pending_notifies) =
        zone_rules::process_zone_enters(camera_id, &enters, rules);
    trace.push(format!(
        "zones: {} enter(s), {} rule action(s)",
        zone_events.len(),
        pending_notifies.len()
    ));
    (zone_events, pending_notifies)
}

fn push_aim_trace(trace: &mut Vec<String>, target: Option<Target>, servo: &ServoCommand) {
    trace.push(format!(
        "aim: {} -> pan {:.0}° tilt {:.0}° ({})",
        target.map_or_else(
            || "no target".to_string(),
            |t| format!("x {:+.2} y {:+.2}", t.x, t.y)
        ),
        servo.pan_deg,
        servo.tilt_deg,
        servo.reason
    ));
}

/// Associate regions to tracks, age unmatched tracks, and open gates.
fn update_tracks(
    state: &mut CameraState,
    regions: &[BoundingBox],
    config: EngineConfig,
    frame_width: u32,
    fps: f32,
) -> Vec<Uuid> {
    let existing_states: Vec<TrackState> = state
        .tracks
        .iter()
        .map(|t| TrackState {
            bbox: t.bbox,
            vx: t.vx,
            vy: t.vy,
        })
        .collect();
    let matches = associate_predicted(regions, &existing_states, config.min_track_iou);

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
        // Velocity in samples per frame, so a client can extrapolate between
        // engine updates rather than waiting for the next one to redraw.
        track.vx = (region.x + region.width / 2.0) - (track.bbox.x + track.bbox.width / 2.0);
        track.vy = (region.y + region.height / 2.0) - (track.bbox.y + track.bbox.height / 2.0);
        track.bbox = *region;
        track.motion = describe(track.vx, track.vy, frame_width, fps);
        track.seen_frames += 1;
        track.missed_frames = 0;
        if !track.gate_open && track.seen_frames >= config.gate_frames {
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
        .retain(|t| t.missed_frames <= config.max_missed_frames);

    for (i, region) in regions.iter().enumerate() {
        if !matched_regions[i] {
            state.tracks.push(TrackedRegion {
                id: Uuid::new_v4(),
                bbox: *region,
                seen_frames: 1,
                missed_frames: 0,
                gate_open: false,
                vx: 0.0,
                vy: 0.0,
                motion: describe(0.0, 0.0, frame_width, fps),
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
            dt_secs: Some(0.1),
            pinned_target: None,
        }
    }

    #[test]
    fn rejects_a_frame_whose_size_does_not_match() {
        let mut e = Engine::new();
        let out = e.process(FrameRequest {
            camera_id: "cam".into(),
            width: 20,
            height: 20,
            samples: vec![0; 7],
            dt_secs: Some(0.1),
            pinned_target: None,
        });
        assert!(out.rejected_reason.is_some());
        assert_eq!(out.trace, vec!["frame_validator: REJECT"]);
    }

    #[test]
    fn static_scene_produces_no_tracks() {
        let mut e = Engine::new();
        for _ in 0..5 {
            let out = e.process(req(vec![10; 400]));
            assert!(out.regions.is_empty());
        }
    }

    #[test]
    fn a_moving_object_is_tracked_and_gates_open() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400])); // learn the background
        let mut opened = Vec::new();
        let mut ids = Vec::new();
        for step in 0..5 {
            let out = e.process(req(frame_with_square(step, 5, 6)));
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
        e.process(req(vec![10; 400]));
        let mut seen = std::collections::HashSet::new();
        for step in 0..5 {
            for region in e.process(req(frame_with_square(step, 5, 6))).regions {
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
        let out = e.process(req(vec![10; 400]));
        assert!(out.trace.iter().any(|t| t.starts_with("frame_validator")));
        assert!(out.trace.iter().any(|t| t.starts_with("motion_detection")));
        assert!(out.trace.iter().any(|t| t.starts_with("trigger_gate")));
    }

    #[test]
    fn raising_the_gate_threshold_delays_the_trigger() {
        let mut e = Engine::new();
        e.set_config(EngineConfig {
            gate_frames: 5,
            ..EngineConfig::default()
        });
        e.process(req(vec![10; 400]));
        let mut opened_at = None;
        for step in 0..6 {
            let out = e.process(req(frame_with_square(step, 5, 6)));
            if !out.triggered.is_empty() && opened_at.is_none() {
                opened_at = Some(out.frame);
            }
        }
        assert_eq!(opened_at, Some(6), "gate must wait the configured 5 frames");
    }

    #[test]
    fn config_changes_are_clamped_and_reported() {
        let mut e = Engine::new();
        let applied = e.set_config(EngineConfig {
            gate_frames: 0,
            ..EngineConfig::default()
        });
        assert_eq!(applied.gate_frames, 1);
        assert_eq!(e.config().gate_frames, 1);
    }

    #[test]
    fn changing_sensitivity_relearns_the_scene() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        e.process(req(frame_with_square(0, 5, 6)));
        e.set_config(EngineConfig {
            sensitivity: 60.0,
            ..EngineConfig::default()
        });
        // The model was rebuilt, so this frame only re-learns the background.
        let out = e.process(req(frame_with_square(0, 5, 6)));
        assert!(out.regions.is_empty());
    }

    #[test]
    fn the_head_aims_at_a_tracked_subject() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        // Subject on the right of the frame.
        let mut out = e.process(req(frame_with_square(13, 5, 6)));
        for _ in 0..10 {
            out = e.process(req(frame_with_square(13, 5, 6)));
        }
        let target = out
            .target
            .expect("a tracked subject should produce a target");
        assert!(
            target.x > 0.0,
            "target on the right must read positive, got {}",
            target.x
        );
        assert!(out.servo.tracking);
        assert!(out.target_id.is_some());
    }

    #[test]
    fn the_head_returns_to_rest_when_nothing_is_there() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        for _ in 0..12 {
            e.process(req(frame_with_square(13, 5, 6)));
        }
        let mut out = e.process(req(vec![10; 400]));
        for _ in 0..60 {
            out = e.process(req(vec![10; 400]));
        }
        assert!(out.target.is_none());
        assert!(!out.servo.tracking);
        assert_eq!(out.servo.pan_deg, 90.0, "failsafe must recentre the head");
    }

    #[test]
    fn a_rejected_frame_still_commands_the_head_safely() {
        // A bad frame must not leave the servo loop without a command.
        let mut e = Engine::new();
        let out = e.process(FrameRequest {
            camera_id: "cam".into(),
            width: 20,
            height: 20,
            samples: vec![0; 3],
            dt_secs: Some(0.1),
            pinned_target: None,
        });
        assert!(out.rejected_reason.is_some());
        assert!(!out.servo.tracking);
    }

    #[test]
    fn a_subject_moving_right_is_reported_as_moving_right() {
        use spatial::motion::Heading;
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        let mut out = e.process(req(frame_with_square(1, 5, 6)));
        for step in 1..6 {
            out = e.process(req(frame_with_square(1 + step * 2, 5, 6)));
        }
        let headings: Vec<Heading> = out.regions.iter().map(|r| r.motion.heading).collect();
        assert!(
            headings.contains(&Heading::Right),
            "expected rightward motion, got {headings:?}"
        );
    }

    #[test]
    fn a_stationary_subject_reports_no_direction() {
        use spatial::motion::Heading;
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        let mut out = e.process(req(frame_with_square(5, 5, 6)));
        for _ in 0..4 {
            out = e.process(req(frame_with_square(5, 5, 6)));
        }
        assert!(
            out.regions
                .iter()
                .all(|r| r.motion.heading == Heading::Still),
            "a subject holding position must not report a direction"
        );
    }

    #[test]
    fn tracks_report_velocity_for_smooth_extrapolation() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        let mut out = e.process(req(frame_with_square(2, 5, 6)));
        for step in 1..5 {
            out = e.process(req(frame_with_square(2 + step * 2, 5, 6)));
        }
        let moving = out.regions.iter().any(|r| r.vx.abs() > 0.0);
        assert!(moving, "a moving subject should report non-zero velocity");
    }

    #[test]
    fn cameras_keep_independent_state() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        let other = FrameRequest {
            camera_id: "other".into(),
            width: 20,
            height: 20,
            samples: vec![10; 400],
            dt_secs: Some(0.1),
            pinned_target: None,
        };
        let out = e.process(other);
        assert_eq!(out.frame, 1, "a second camera starts its own frame count");
    }

    #[test]
    fn pinned_target_locks_aim_to_specified_point() {
        let mut e = Engine::new();
        e.process(req(vec![10; 400]));
        let mut req_pinned = req(frame_with_square(2, 5, 6));
        req_pinned.pinned_target = Some([0.75, 0.25]);
        let out = e.process(req_pinned);
        assert_eq!(out.pinned_target, Some([0.75, 0.25]));
        assert!(out.trace.iter().any(|t| t.contains("point_cross_assign")));
    }

    #[test]
    fn track_entering_right_half_emits_zone_enter_once() {
        use rules::{Action, Condition, Rule};
        use schemas::ObjectClass;

        let mut e = Engine::new();
        e.set_rules(vec![Rule {
            name: "test-garage".into(),
            conditions: vec![
                Condition::IsClass(ObjectClass::Unknown),
                Condition::InZone("garage".into()),
            ],
            action: Action::Notify {
                channel: "default".into(),
            },
        }]);
        e.process(req(vec![10; 400]));
        // Square on the right half (x=12 on 20-wide → centroid ~15 → norm 0.75).
        let mut enters = 0;
        let mut notifies = 0;
        for _ in 0..6 {
            let out = e.process(req(frame_with_square(12, 5, 6)));
            enters += out.zone_events.len();
            notifies += out.pending_notifies.len();
        }
        assert_eq!(enters, 1, "EnteredZone must fire once per stay");
        assert_eq!(notifies, 1, "matching rule must yield one Notify");
        assert!(e
            .process(req(frame_with_square(12, 5, 6)))
            .zone_events
            .is_empty());
    }
}
