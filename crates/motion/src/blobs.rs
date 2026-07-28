//! Connected-component extraction: turns a motion mask into regions.
//!
//! This is what makes motion *trackable*. The mask says "these samples
//! changed"; blobs group adjacent changed samples into boxes the tracker can
//! follow frame to frame. Pure, allocation-bounded, no ML.

use schemas::detection::BoundingBox;

/// A binary motion mask over a downscaled grayscale frame.
#[derive(Debug, Clone)]
pub struct MotionMask {
    /// Mask width in samples.
    pub width: u32,
    /// Mask height in samples.
    pub height: u32,
    /// One entry per sample; `true` means "changed".
    pub changed: Vec<bool>,
}

impl MotionMask {
    /// Read a sample, returning `false` outside bounds.
    #[must_use]
    pub fn at(&self, x: u32, y: u32) -> bool {
        if x >= self.width || y >= self.height {
            return false;
        }
        let idx = (y as usize) * (self.width as usize) + (x as usize);
        self.changed.get(idx).copied().unwrap_or(false)
    }
}

/// Extract bounding boxes of connected changed regions.
///
/// Uses 8-connectivity flood fill with an explicit stack (no recursion, so
/// a full-frame blob cannot overflow the stack). Regions smaller than
/// `min_area` samples are discarded as noise.
///
/// Boxes are returned in raster order of their first-encountered sample,
/// which makes the output deterministic for a given mask.
///
/// # Example
/// ```
/// use motion::blobs::{extract, MotionMask};
/// let mask = MotionMask { width: 3, height: 1, changed: vec![true, true, false] };
/// let boxes = extract(&mask, 1);
/// assert_eq!(boxes.len(), 1);
/// assert_eq!(boxes[0].width, 2.0);
/// ```
#[must_use]
// Sample coordinates are bounded by the frame dimensions (hundreds, not
// millions), so the u32 -> f32 conversions below are always exact.
#[allow(clippy::cast_precision_loss)]
pub fn extract(mask: &MotionMask, min_area: usize) -> Vec<BoundingBox> {
    let total = (mask.width as usize) * (mask.height as usize);
    let mut visited = vec![false; total];
    let mut boxes = Vec::new();
    let mut stack: Vec<(u32, u32)> = Vec::new();

    for start_y in 0..mask.height {
        for start_x in 0..mask.width {
            let start_idx = (start_y as usize) * (mask.width as usize) + (start_x as usize);
            if visited[start_idx] || !mask.at(start_x, start_y) {
                continue;
            }
            let (mut min_x, mut max_x) = (start_x, start_x);
            let (mut min_y, mut max_y) = (start_y, start_y);
            let mut area = 0_usize;

            visited[start_idx] = true;
            stack.push((start_x, start_y));
            while let Some((x, y)) = stack.pop() {
                area += 1;
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);

                for (nx, ny) in neighbors(x, y, mask.width, mask.height) {
                    let idx = (ny as usize) * (mask.width as usize) + (nx as usize);
                    if !visited[idx] && mask.at(nx, ny) {
                        visited[idx] = true;
                        stack.push((nx, ny));
                    }
                }
            }

            if area >= min_area {
                boxes.push(BoundingBox {
                    x: min_x as f32,
                    y: min_y as f32,
                    width: (max_x - min_x + 1) as f32,
                    height: (max_y - min_y + 1) as f32,
                });
            }
        }
    }
    boxes
}

/// The up-to-eight in-bounds neighbours of a sample.
fn neighbors(x: u32, y: u32, width: u32, height: u32) -> Vec<(u32, u32)> {
    let mut out = Vec::with_capacity(8);
    let x0 = x.saturating_sub(1);
    let y0 = y.saturating_sub(1);
    for ny in y0..=(y + 1).min(height.saturating_sub(1)) {
        for nx in x0..=(x + 1).min(width.saturating_sub(1)) {
            if (nx, ny) != (x, y) {
                out.push((nx, ny));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    fn mask(width: u32, height: u32, on: &[(u32, u32)]) -> MotionMask {
        let mut changed = vec![false; (width * height) as usize];
        for &(x, y) in on {
            changed[(y * width + x) as usize] = true;
        }
        MotionMask {
            width,
            height,
            changed,
        }
    }

    #[test]
    fn empty_mask_yields_no_blobs() {
        assert!(extract(&mask(4, 4, &[]), 1).is_empty());
    }

    #[test]
    fn single_region_becomes_one_box() {
        let m = mask(5, 5, &[(1, 1), (2, 1), (1, 2), (2, 2)]);
        let boxes = extract(&m, 1);
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0].x, 1.0);
        assert_eq!(boxes[0].y, 1.0);
        assert_eq!(boxes[0].width, 2.0);
        assert_eq!(boxes[0].height, 2.0);
    }

    #[test]
    fn two_separated_regions_stay_separate() {
        let m = mask(9, 3, &[(0, 0), (1, 0), (7, 2), (8, 2)]);
        assert_eq!(extract(&m, 1).len(), 2);
    }

    #[test]
    fn diagonal_samples_are_one_region() {
        // 8-connectivity: a diagonal touch joins the region.
        let m = mask(4, 4, &[(0, 0), (1, 1), (2, 2)]);
        assert_eq!(extract(&m, 1).len(), 1);
    }

    #[test]
    fn regions_below_min_area_are_discarded_as_noise() {
        let m = mask(9, 3, &[(0, 0), (1, 0), (2, 0), (8, 2)]);
        let boxes = extract(&m, 2);
        assert_eq!(boxes.len(), 1, "the single-sample speck is noise");
        assert_eq!(boxes[0].width, 3.0);
    }

    #[test]
    fn full_frame_blob_does_not_overflow() {
        let all: Vec<(u32, u32)> = (0..40).flat_map(|y| (0..40).map(move |x| (x, y))).collect();
        let boxes = extract(&mask(40, 40, &all), 1);
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0].width, 40.0);
    }

    #[test]
    fn out_of_bounds_reads_are_false() {
        let m = mask(2, 2, &[(0, 0)]);
        assert!(m.at(0, 0));
        assert!(!m.at(9, 9));
    }
}
