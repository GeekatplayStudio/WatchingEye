//! Named rectangle zones in sample space and enter/exit detection.
//!
//! A track's centroid is tested against each zone every frame. The monitor
//! emits an enter exactly once per continuous stay; leaving and re-entering
//! fires again. Used by the live engine before [`rules::evaluate`].
//!
//! # Example
//!
//! ```ignore
//! let mut mon = ZoneMonitor::new(vec![Zone::normalized("garage", 0.5, 0.0, 0.5, 1.0)]);
//! let entered = mon.update(&[(id, bbox)], 100, 100);
//! assert_eq!(entered[0].1, "garage");
//! ```

use schemas::detection::BoundingBox;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// A named axis-aligned rectangle in normalized sample coordinates `[0, 1]`.
#[derive(Debug, Clone, PartialEq)]
pub struct Zone {
    /// Human-readable zone name (matched by [`rules::Condition::InZone`]).
    pub name: String,
    /// Left edge in `[0, 1]`.
    pub x: f32,
    /// Top edge in `[0, 1]`.
    pub y: f32,
    /// Width in `[0, 1]`.
    pub width: f32,
    /// Height in `[0, 1]`.
    pub height: f32,
}

impl Zone {
    /// Build a zone from normalized coordinates (clamped into `[0, 1]`).
    ///
    /// # Example
    ///
    /// ```ignore
    /// let z = Zone::normalized("garage", 0.5, 0.0, 0.5, 1.0);
    /// assert_eq!(z.name, "garage");
    /// ```
    #[must_use]
    pub fn normalized(name: impl Into<String>, x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            name: name.into(),
            x: x.clamp(0.0, 1.0),
            y: y.clamp(0.0, 1.0),
            width: width.clamp(0.0, 1.0),
            height: height.clamp(0.0, 1.0),
        }
    }

    /// True when the point `(nx, ny)` in normalized coords lies inside.
    #[must_use]
    pub fn contains_norm(&self, nx: f32, ny: f32) -> bool {
        nx >= self.x && nx <= self.x + self.width && ny >= self.y && ny <= self.y + self.height
    }
}

/// Tracks which objects are currently inside which zones.
#[derive(Debug, Clone)]
pub struct ZoneMonitor {
    zones: Vec<Zone>,
    /// `track_id` → zone names currently occupied.
    inside: HashMap<Uuid, HashSet<String>>,
}

impl ZoneMonitor {
    /// Create a monitor for the given zones.
    #[must_use]
    pub fn new(zones: Vec<Zone>) -> Self {
        Self {
            zones,
            inside: HashMap::new(),
        }
    }

    /// Default live path: a `"garage"` zone covering the right half of the frame.
    #[must_use]
    pub fn default_garage() -> Self {
        Self::new(vec![Zone::normalized("garage", 0.5, 0.0, 0.5, 1.0)])
    }

    /// Update membership from the current tracks.
    ///
    /// Returns newly entered `(track_id, zone_name)` pairs — at most one
    /// enter per track/zone continuous stay. Tracks that disappear are
    /// forgotten so a later reappearance can enter again.
    pub fn update(
        &mut self,
        tracks: &[(Uuid, BoundingBox)],
        frame_width: u32,
        frame_height: u32,
    ) -> Vec<(Uuid, String)> {
        #[allow(clippy::cast_precision_loss)]
        let fw = frame_width.max(1) as f32;
        #[allow(clippy::cast_precision_loss)]
        let fh = frame_height.max(1) as f32;
        let mut entered = Vec::new();
        let mut seen: HashSet<Uuid> = HashSet::new();

        for &(id, bbox) in tracks {
            seen.insert(id);
            let cx = (bbox.x + bbox.width / 2.0) / fw;
            let cy = (bbox.y + bbox.height / 2.0) / fh;
            let membership = self.inside.entry(id).or_default();
            let mut still_inside = HashSet::new();
            for zone in &self.zones {
                if zone.contains_norm(cx, cy) {
                    still_inside.insert(zone.name.clone());
                    if !membership.contains(&zone.name) {
                        entered.push((id, zone.name.clone()));
                    }
                }
            }
            *membership = still_inside;
        }

        self.inside.retain(|id, _| seen.contains(id));
        entered
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn box_at(x: f32, y: f32) -> BoundingBox {
        BoundingBox {
            x,
            y,
            width: 10.0,
            height: 10.0,
        }
    }

    #[test]
    fn enter_fires_once_while_staying() {
        let mut mon = ZoneMonitor::default_garage();
        let id = Uuid::new_v4();
        // Centroid at (75, 15) on 100×100 → norm (0.75, 0.15) → right half.
        let first = mon.update(&[(id, box_at(70.0, 10.0))], 100, 100);
        assert_eq!(first, vec![(id, "garage".into())]);
        let second = mon.update(&[(id, box_at(70.0, 10.0))], 100, 100);
        assert!(second.is_empty());
    }

    #[test]
    fn left_half_does_not_enter_garage() {
        let mut mon = ZoneMonitor::default_garage();
        let id = Uuid::new_v4();
        let hits = mon.update(&[(id, box_at(10.0, 10.0))], 100, 100);
        assert!(hits.is_empty());
    }

    #[test]
    fn reenter_after_leaving_fires_again() {
        let mut mon = ZoneMonitor::default_garage();
        let id = Uuid::new_v4();
        assert_eq!(mon.update(&[(id, box_at(70.0, 10.0))], 100, 100).len(), 1);
        assert!(mon.update(&[(id, box_at(10.0, 10.0))], 100, 100).is_empty());
        assert_eq!(mon.update(&[(id, box_at(70.0, 10.0))], 100, 100).len(), 1);
    }

    #[test]
    fn disappeared_track_is_forgotten() {
        let mut mon = ZoneMonitor::default_garage();
        let id = Uuid::new_v4();
        mon.update(&[(id, box_at(70.0, 10.0))], 100, 100);
        mon.update(&[], 100, 100);
        assert_eq!(mon.update(&[(id, box_at(70.0, 10.0))], 100, 100).len(), 1);
    }
}
