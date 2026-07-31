//! Point Cross Assign: lock onto the subject under the crosshair and follow
//! it.
//!
//! Resolving the clicked point against the track list on every frame aims at
//! a *place*, not at a *thing* — the moment the assigned subject walks away
//! from that coordinate, the aim stays behind and may jump to whatever else
//! drifts past it. So the point is resolved to a track once, at assignment,
//! and the track id is what gets followed afterwards.
//!
//! Nothing here consults a model: the lock is deterministic state derived
//! from the click and the track list.

use crate::engine::TrackedRegion;
use serde::Serialize;
use uuid::Uuid;

/// How far from the click a track may be and still be considered the thing
/// that was assigned, as a fraction of the frame diagonal.
const ACQUIRE_RADIUS: f32 = 0.35;

/// An active Point Cross assignment.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PinnedLock {
    /// Where the operator clicked, normalised to [0.0, 1.0].
    pub origin: [f32; 2],
    /// The track being followed, once one has been acquired.
    pub track_id: Option<Uuid>,
}

/// What the assignment is doing right now, for the operator to see.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PinnedStatus {
    /// No assignment active.
    Idle,
    /// Following the subject the crosshair was assigned to.
    Following,
    /// Assigned, but nothing is there to follow — holding at the click point.
    Searching,
}

/// Two clicks are the same assignment when they land on the same point.
///
/// The client echoes the stored point back verbatim each frame, so this only
/// has to tolerate float round-tripping, not genuine near-misses.
fn same_point(a: [f32; 2], b: [f32; 2]) -> bool {
    (a[0] - b[0]).abs() < 1e-6 && (a[1] - b[1]).abs() < 1e-6
}

/// Find the track the operator meant when they clicked at `point`.
///
/// A track containing the point wins outright; otherwise the nearest centre
/// within [`ACQUIRE_RADIUS`] of the frame diagonal. Beyond that, the click
/// was on empty space and nothing is acquired.
#[must_use]
pub fn acquire(tracks: &[TrackedRegion], point: [f32; 2], width: u32, height: u32) -> Option<Uuid> {
    #[allow(clippy::cast_precision_loss)]
    let (fw, fh) = (width as f32, height as f32);
    let (sx, sy) = (point[0] * fw, point[1] * fh);

    let containing = tracks.iter().find(|r| {
        sx >= r.bbox.x
            && sx <= (r.bbox.x + r.bbox.width)
            && sy >= r.bbox.y
            && sy <= (r.bbox.y + r.bbox.height)
    });
    if let Some(r) = containing {
        return Some(r.id);
    }

    let centre = |r: &TrackedRegion| {
        (
            r.bbox.x + r.bbox.width / 2.0,
            r.bbox.y + r.bbox.height / 2.0,
        )
    };
    let nearest = tracks.iter().min_by(|a, b| {
        let (ax, ay) = centre(a);
        let (bx, by) = centre(b);
        (ax - sx)
            .hypot(ay - sy)
            .total_cmp(&(bx - sx).hypot(by - sy))
    })?;

    let (nx, ny) = centre(nearest);
    let max_dist = (fw * fw + fh * fh).sqrt() * ACQUIRE_RADIUS;
    if (nx - sx).hypot(ny - sy) <= max_dist {
        Some(nearest.id)
    } else {
        None
    }
}

/// Advance the assignment by one frame.
///
/// Keeps following the locked track wherever it has moved to. Re-acquires
/// only when the operator clicks somewhere new, or when the followed track
/// disappears — a subject that leaves must not silently hand the camera to
/// an unrelated one, so re-acquisition starts from the original click.
///
/// @example
/// ```ignore
/// let mut lock = None;
/// let status = update(&mut lock, Some([0.5, 0.5]), &tracks, 40, 30);
/// assert_eq!(status, PinnedStatus::Following);
/// ```
pub fn update(
    lock: &mut Option<PinnedLock>,
    point: Option<[f32; 2]>,
    tracks: &[TrackedRegion],
    width: u32,
    height: u32,
) -> PinnedStatus {
    let Some(point) = point else {
        *lock = None;
        return PinnedStatus::Idle;
    };

    let reassigned = lock.is_none_or(|l| !same_point(l.origin, point));
    if reassigned {
        *lock = Some(PinnedLock {
            origin: point,
            track_id: acquire(tracks, point, width, height),
        });
    } else if let Some(current) = lock.as_mut() {
        let alive = current
            .track_id
            .is_some_and(|id| tracks.iter().any(|r| r.id == id));
        if !alive {
            // Either nothing was acquired yet, or the subject is gone: try
            // again from the point the operator actually chose.
            current.track_id = acquire(tracks, point, width, height);
        }
    }

    match lock.and_then(|l| l.track_id) {
        Some(_) => PinnedStatus::Following,
        None => PinnedStatus::Searching,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
mod tests {
    use super::*;
    use schemas::detection::BoundingBox;
    use spatial::motion::{Heading, MotionVector};

    fn track(id: Uuid, x: f32, y: f32, w: f32, h: f32) -> TrackedRegion {
        TrackedRegion {
            id,
            bbox: BoundingBox {
                x,
                y,
                width: w,
                height: h,
            },
            seen_frames: 5,
            missed_frames: 0,
            gate_open: true,
            vx: 0.0,
            vy: 0.0,
            motion: MotionVector {
                heading: Heading::Still,
                speed: 0.0,
                angle_deg: 0.0,
            },
        }
    }

    const W: u32 = 40;
    const H: u32 = 30;

    #[test]
    fn acquires_the_track_under_the_click() {
        let a = Uuid::new_v4();
        let tracks = vec![track(a, 10.0, 5.0, 8.0, 8.0)];
        assert_eq!(acquire(&tracks, [0.35, 0.3], W, H), Some(a));
    }

    #[test]
    fn acquires_nothing_when_the_click_is_far_from_everything() {
        let tracks = vec![track(Uuid::new_v4(), 0.0, 0.0, 2.0, 2.0)];
        assert_eq!(acquire(&tracks, [1.0, 1.0], W, H), None);
    }

    #[test]
    fn follows_the_assigned_subject_after_it_moves_away_from_the_click() {
        // The regression this module exists for: aim must travel with the
        // subject, not stay at the coordinate that was clicked.
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let mut lock = None;

        let start = vec![track(a, 10.0, 5.0, 8.0, 8.0)];
        assert_eq!(
            update(&mut lock, Some([0.35, 0.3]), &start, W, H),
            PinnedStatus::Following
        );
        assert_eq!(lock.unwrap().track_id, Some(a));

        // `a` walks to the far side; `b` wanders into the original click.
        let later = vec![
            track(a, 30.0, 20.0, 8.0, 8.0),
            track(b, 10.0, 5.0, 8.0, 8.0),
        ];
        assert_eq!(
            update(&mut lock, Some([0.35, 0.3]), &later, W, H),
            PinnedStatus::Following
        );
        assert_eq!(
            lock.unwrap().track_id,
            Some(a),
            "must keep following the assigned subject, not the newcomer at the click point"
        );
    }

    #[test]
    fn a_new_click_reassigns() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let tracks = vec![track(a, 4.0, 4.0, 6.0, 6.0), track(b, 30.0, 20.0, 6.0, 6.0)];
        let mut lock = None;
        update(&mut lock, Some([0.17, 0.23]), &tracks, W, H);
        assert_eq!(lock.unwrap().track_id, Some(a));
        update(&mut lock, Some([0.82, 0.76]), &tracks, W, H);
        assert_eq!(lock.unwrap().track_id, Some(b));
    }

    #[test]
    fn re_acquires_from_the_origin_when_the_subject_disappears() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let mut lock = None;
        update(
            &mut lock,
            Some([0.35, 0.3]),
            &[track(a, 10.0, 5.0, 8.0, 8.0)],
            W,
            H,
        );

        let status = update(&mut lock, Some([0.35, 0.3]), &[], W, H);
        assert_eq!(status, PinnedStatus::Searching, "nothing left to follow");
        assert_eq!(lock.unwrap().track_id, None);

        let status = update(
            &mut lock,
            Some([0.35, 0.3]),
            &[track(b, 10.0, 5.0, 8.0, 8.0)],
            W,
            H,
        );
        assert_eq!(status, PinnedStatus::Following);
        assert_eq!(lock.unwrap().track_id, Some(b));
    }

    #[test]
    fn holds_the_assignment_while_nothing_is_there() {
        let mut lock = None;
        assert_eq!(
            update(&mut lock, Some([0.5, 0.5]), &[], W, H),
            PinnedStatus::Searching
        );
        assert_eq!(lock.unwrap().origin, [0.5, 0.5], "the click point survives");
    }

    #[test]
    fn clearing_the_assignment_drops_the_lock() {
        let a = Uuid::new_v4();
        let mut lock = None;
        update(
            &mut lock,
            Some([0.35, 0.3]),
            &[track(a, 10.0, 5.0, 8.0, 8.0)],
            W,
            H,
        );
        assert_eq!(update(&mut lock, None, &[], W, H), PinnedStatus::Idle);
        assert!(lock.is_none());
    }
}
