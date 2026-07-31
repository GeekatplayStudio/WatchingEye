//! Detection-to-track association by spatial overlap (`IoU`).
//!
//! Replaces naive class-only matching so two people in frame keep distinct
//! identities (PRD Step 1.4). Greedy highest-overlap-first matching: for the
//! camera counts this system targets, greedy is deterministic, allocation
//! free, and indistinguishable from Hungarian matching in practice.

use schemas::detection::BoundingBox;

/// Intersection over Union of two boxes, in `[0.0, 1.0]`.
///
/// Returns `0.0` for disjoint boxes and for any box with zero area.
///
/// # Example
/// ```
/// use tracker::association::iou;
/// use schemas::detection::BoundingBox;
/// let a = BoundingBox { x: 0.0, y: 0.0, width: 10.0, height: 10.0 };
/// assert_eq!(iou(&a, &a), 1.0);
/// ```
#[must_use]
pub fn iou(a: &BoundingBox, b: &BoundingBox) -> f32 {
    let area_a = a.width * a.height;
    let area_b = b.width * b.height;
    if area_a <= 0.0 || area_b <= 0.0 {
        return 0.0;
    }
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.width).min(b.x + b.width);
    let y2 = (a.y + a.height).min(b.y + b.height);
    let overlap = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let union = area_a + area_b - overlap;
    if union <= 0.0 {
        return 0.0;
    }
    overlap / union
}

/// One matched pair: index into the candidate list, and its `IoU` score.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Match {
    /// Index of the detection being matched.
    pub detection_index: usize,
    /// Index of the track it matched.
    pub track_index: usize,
    /// Overlap score of the match.
    pub score: f32,
}

/// A track with estimated position and velocity for prediction.
#[derive(Debug, Clone, Copy)]
pub struct TrackState {
    /// Bounding box of the track in sample coordinates.
    pub bbox: BoundingBox,
    /// Estimated horizontal velocity in samples per frame.
    pub vx: f32,
    /// Estimated vertical velocity in samples per frame.
    pub vy: f32,
}

/// Greedily pair detections to tracks by descending `IoU`.
///
/// Each detection and each track is used at most once. Pairs scoring below
/// `min_iou` are not matched at all — those detections become new tracks.
/// Deterministic: ties break toward the lower detection index.
#[must_use]
pub fn associate(detections: &[BoundingBox], tracks: &[BoundingBox], min_iou: f32) -> Vec<Match> {
    let states: Vec<TrackState> = tracks
        .iter()
        .map(|&bbox| TrackState {
            bbox,
            vx: 0.0,
            vy: 0.0,
        })
        .collect();
    associate_predicted(detections, &states, min_iou)
}

/// Greedily pair detections to velocity-predicted tracks by `IoU` or proximity fallback.
#[must_use]
pub fn associate_predicted(
    detections: &[BoundingBox],
    tracks: &[TrackState],
    min_iou: f32,
) -> Vec<Match> {
    let mut candidates: Vec<Match> = Vec::new();
    for (di, d) in detections.iter().enumerate() {
        let dc_x = d.x + d.width / 2.0;
        let dc_y = d.y + d.height / 2.0;

        for (ti, t) in tracks.iter().enumerate() {
            let pred_box = BoundingBox {
                x: t.bbox.x + t.vx,
                y: t.bbox.y + t.vy,
                width: t.bbox.width,
                height: t.bbox.height,
            };
            let iou_score = iou(d, &pred_box);
            let score = if iou_score >= min_iou {
                iou_score
            } else {
                let tc_x = pred_box.x + pred_box.width / 2.0;
                let tc_y = pred_box.y + pred_box.height / 2.0;
                let dist = ((dc_x - tc_x).powi(2) + (dc_y - tc_y).powi(2)).sqrt();
                let max_dim = d
                    .width
                    .max(d.height)
                    .max(pred_box.width)
                    .max(pred_box.height)
                    .max(4.0);
                let max_dist = max_dim * 1.5;
                if dist <= max_dist {
                    (1.0 - (dist / max_dist)) * min_iou
                } else {
                    0.0
                }
            };

            if score >= min_iou && score > 0.0 {
                candidates.push(Match {
                    detection_index: di,
                    track_index: ti,
                    score,
                });
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.detection_index.cmp(&b.detection_index))
            .then(a.track_index.cmp(&b.track_index))
    });

    let mut used_detections = vec![false; detections.len()];
    let mut used_tracks = vec![false; tracks.len()];
    let mut matches = Vec::new();
    for c in candidates {
        let (Some(&false), Some(&false)) = (
            used_detections.get(c.detection_index),
            used_tracks.get(c.track_index),
        ) else {
            continue;
        };
        used_detections[c.detection_index] = true;
        used_tracks[c.track_index] = true;
        matches.push(c);
    }
    matches
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn bbox(x: f32, y: f32, w: f32, h: f32) -> BoundingBox {
        BoundingBox {
            x,
            y,
            width: w,
            height: h,
        }
    }

    #[test]
    fn identical_boxes_have_iou_one() {
        let b = bbox(0.0, 0.0, 10.0, 10.0);
        assert_eq!(iou(&b, &b), 1.0);
    }

    #[test]
    fn disjoint_boxes_have_iou_zero() {
        assert_eq!(
            iou(&bbox(0.0, 0.0, 5.0, 5.0), &bbox(100.0, 100.0, 5.0, 5.0)),
            0.0
        );
    }

    #[test]
    fn zero_area_box_has_iou_zero() {
        assert_eq!(
            iou(&bbox(0.0, 0.0, 0.0, 10.0), &bbox(0.0, 0.0, 10.0, 10.0)),
            0.0
        );
    }

    #[test]
    fn half_overlap_is_one_third() {
        // Two 10x10 boxes overlapping by 5x10 = 50; union = 100+100-50 = 150.
        let score = iou(&bbox(0.0, 0.0, 10.0, 10.0), &bbox(5.0, 0.0, 10.0, 10.0));
        assert!((score - 50.0 / 150.0).abs() < 1e-6);
    }

    #[test]
    fn two_people_keep_distinct_identities() {
        let tracks = vec![bbox(0.0, 0.0, 10.0, 20.0), bbox(100.0, 0.0, 10.0, 20.0)];
        // Both moved slightly right.
        let detections = vec![bbox(2.0, 0.0, 10.0, 20.0), bbox(102.0, 0.0, 10.0, 20.0)];
        let matches = associate(&detections, &tracks, 0.3);
        assert_eq!(matches.len(), 2);
        assert_eq!(
            matches
                .iter()
                .find(|m| m.detection_index == 0)
                .unwrap()
                .track_index,
            0
        );
        assert_eq!(
            matches
                .iter()
                .find(|m| m.detection_index == 1)
                .unwrap()
                .track_index,
            1
        );
    }

    #[test]
    fn a_track_is_never_matched_twice() {
        let tracks = vec![bbox(0.0, 0.0, 10.0, 10.0)];
        let detections = vec![bbox(0.0, 0.0, 10.0, 10.0), bbox(1.0, 1.0, 10.0, 10.0)];
        let matches = associate(&detections, &tracks, 0.1);
        assert_eq!(matches.len(), 1, "one track can absorb only one detection");
        assert_eq!(matches[0].detection_index, 0, "best overlap wins");
    }

    #[test]
    fn below_threshold_produces_no_match() {
        let tracks = vec![bbox(0.0, 0.0, 10.0, 10.0)];
        let detections = vec![bbox(9.0, 9.0, 10.0, 10.0)];
        assert!(associate(&detections, &tracks, 0.5).is_empty());
    }

    #[test]
    fn empty_inputs_are_handled() {
        assert!(associate(&[], &[bbox(0.0, 0.0, 1.0, 1.0)], 0.1).is_empty());
        assert!(associate(&[bbox(0.0, 0.0, 1.0, 1.0)], &[], 0.1).is_empty());
    }

    #[test]
    fn velocity_predicted_track_matches_displaced_detection() {
        let track = TrackState {
            bbox: bbox(0.0, 0.0, 10.0, 10.0),
            vx: 5.0,
            vy: 0.0,
        };
        let detection = bbox(5.0, 0.0, 10.0, 10.0);
        let matches = associate_predicted(&[detection], &[track], 0.3);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].track_index, 0);
    }
}
