//! Connected-component extraction: turns a motion mask into regions.
//!
//! This is what makes motion *trackable*. The mask says "these samples
//! changed"; blobs group adjacent changed samples into boxes the tracker can
//! follow frame to frame. Pure, allocation-bounded, no ML.
//!
//! This sits on the per-frame hot path for every camera, so the flood fill
//! works directly on the mask slice with an explicit stack: no per-pixel
//! allocation, no per-read bounds-check chain. The scratch buffers are the
//! only allocations, and [`extract_into`] lets a caller reuse them.

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

/// Reusable flood-fill scratch space, so a per-camera caller allocates once
/// instead of twice per frame.
#[derive(Debug, Default)]
pub struct BlobScratch {
    visited: Vec<bool>,
    stack: Vec<u32>,
}

/// Extract bounding boxes of connected changed regions.
///
/// Convenience wrapper over [`extract_into`] that allocates fresh scratch.
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
pub fn extract(mask: &MotionMask, min_area: usize) -> Vec<BoundingBox> {
    let mut scratch = BlobScratch::default();
    extract_into(mask, min_area, &mut scratch)
}

/// Extract regions using caller-owned scratch buffers.
///
/// Uses 8-connectivity flood fill with an explicit stack (no recursion, so a
/// full-frame blob cannot overflow). Regions smaller than `min_area` samples
/// are discarded as noise. Output order is deterministic: raster order of
/// each region's first-encountered sample.
#[must_use]
#[allow(clippy::cast_precision_loss)] // sample coords are far below 2^24
pub fn extract_into(
    mask: &MotionMask,
    min_area: usize,
    scratch: &mut BlobScratch,
) -> Vec<BoundingBox> {
    let width = mask.width as usize;
    let height = mask.height as usize;
    let total = width * height;
    if total == 0 || mask.changed.len() != total {
        return Vec::new();
    }
    let changed: &[bool] = &mask.changed;

    scratch.visited.clear();
    scratch.visited.resize(total, false);
    scratch.stack.clear();
    let visited = &mut scratch.visited;
    let stack = &mut scratch.stack;
    let mut boxes = Vec::new();

    for start in 0..total {
        if visited[start] || !changed[start] {
            continue;
        }
        let (mut min_x, mut max_x) = (start % width, start % width);
        let (mut min_y, mut max_y) = (start / width, start / width);
        let mut area = 0usize;

        visited[start] = true;
        #[allow(clippy::cast_possible_truncation)] // total fits u32 by construction
        stack.push(start as u32);
        while let Some(idx) = stack.pop() {
            let idx = idx as usize;
            let x = idx % width;
            let y = idx / width;
            area += 1;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);

            // Visit the 8-neighbourhood without allocating: row and column
            // ranges are clamped once, then indices are plain arithmetic.
            let y0 = y.saturating_sub(1);
            let y1 = (y + 1).min(height - 1);
            let x0 = x.saturating_sub(1);
            let x1 = (x + 1).min(width - 1);
            for ny in y0..=y1 {
                let row = ny * width;
                for nx in x0..=x1 {
                    let n = row + nx;
                    if !visited[n] && changed[n] {
                        visited[n] = true;
                        #[allow(clippy::cast_possible_truncation)]
                        stack.push(n as u32);
                    }
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
    boxes
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

    #[test]
    fn a_malformed_mask_yields_nothing_rather_than_panicking() {
        let m = MotionMask {
            width: 4,
            height: 4,
            changed: vec![true; 3], // wrong length
        };
        assert!(extract(&m, 1).is_empty());
    }

    #[test]
    fn reused_scratch_gives_identical_results() {
        let m1 = mask(6, 6, &[(0, 0), (1, 0), (1, 1)]);
        let m2 = mask(6, 6, &[(4, 4), (5, 4), (5, 5), (4, 5)]);
        let mut scratch = BlobScratch::default();
        let a1 = extract_into(&m1, 1, &mut scratch);
        let a2 = extract_into(&m2, 1, &mut scratch);
        assert_eq!(a1, extract(&m1, 1));
        assert_eq!(a2, extract(&m2, 1));
    }
}
