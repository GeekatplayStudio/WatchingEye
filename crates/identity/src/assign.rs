//! Deterministic Hungarian (Munkres) assignment for multi-object identity.
//!
//! [`Registry::observe`](crate::Registry::observe) matches sightings one at
//! a time, greedily: it is possible for two sightings that arrive together
//! to be attracted to the same identity, with whichever is processed first
//! claiming it and the second falling back to a worse candidate (or a
//! spurious new identity). When several same-class sightings arrive in one
//! batch, this module instead finds the assignment that maximizes total
//! agreement across *all* of them at once, so two detections can never
//! collide on one identity.
//!
//! The algorithm is the classical O(n³) primal-dual (Kuhn-Munkres) method:
//! no randomness, no floating-point-order dependence beyond ordinary IEEE
//! arithmetic, and no external crate — just arrays and a cost matrix.

/// One cell of the detection×identity score table.
///
/// `None` means ineligible: refuted by a distinctive attribute, a model
/// mismatch, or no shared evidence at all. A present score is expected to
/// lie in `[0.0, 1.0]`, higher is a better match.
pub type ScoreCell = Option<f32>;

/// Cost of leaving a detection unmatched (an "opt out" to a dummy column).
///
/// Chosen strictly above the worst possible eligible cost (`1.0 - 0.0`) so
/// a detection always prefers a real eligible identity over going unmatched,
/// but strictly below [`INELIGIBLE_COST`] so it always prefers going
/// unmatched over being forced onto a refuted or below-threshold identity.
const DUMMY_COST: f64 = 2.0;

/// Cost of a cell that is `None` or scores below `min_score`.
///
/// Large enough that the solver only ever picks it when forced to (a square
/// matrix with no dummy column left to absorb the detection); the caller
/// then reinterprets that forced pick as "no match" rather than exposing it.
const INELIGIBLE_COST: f64 = 1_000.0;

/// Assign each detection row to at most one identity column.
///
/// `scores[d][i]` is the similarity between detection `d` and identity `i`
/// in `[0, 1]`, or `None` when the pairing is ineligible. Returns
/// `assignments[d] = Some(identity_col)` for a global match, or `None`
/// meaning "create a new identity for this detection".
///
/// # Rules
/// - Maximizes total score over the whole batch (internally: cost = 1.0 −
///   score, so minimizing cost maximizes score).
/// - A cell that is `None` or scores below `min_score` is ineligible and is
///   never returned as an assignment.
/// - Rectangular inputs are padded to square with dummy rows or columns so
///   that surplus detections or surplus identities are left unmatched
///   rather than forced onto a bad pairing.
/// - Deterministic: when total costs tie, the solver prefers the lower
///   column index, then the lower row index (see "Determinism" below).
/// - Empty input returns an empty output.
///
/// # Determinism
/// Ties are broken by the iteration order of the underlying primal-dual
/// search: each row is solved in ascending order and, within a row, the
/// first (lowest-index) column achieving the minimum reduced cost is kept
/// (strict `<` comparisons only). Because earlier rows commit to a column
/// before later rows are considered, and a later row's augmenting path only
/// ever displaces an earlier commitment on a *strict* improvement, an exact
/// tie always leaves the lower row index in its original column.
///
/// # Example
/// ```
/// use identity::assign::hungarian_assign;
///
/// // Detection 0 mildly prefers identity 0; detection 1 clearly prefers
/// // identity 0 too. Greedy row-by-row would give detection 0 identity 0
/// // (its best) and leave detection 1 with a poor leftover. The globally
/// // optimal assignment instead swaps them for a higher total score.
/// let scores = vec![
///     vec![Some(0.9), Some(0.85)],
///     vec![Some(0.95), Some(0.1)],
/// ];
/// let assignment = hungarian_assign(&scores, 0.5);
/// assert_eq!(assignment, vec![Some(1), Some(0)]);
/// ```
#[must_use]
pub fn hungarian_assign(scores: &[Vec<ScoreCell>], min_score: f32) -> Vec<Option<usize>> {
    let rows = scores.len();
    if rows == 0 {
        return Vec::new();
    }
    let cols = scores.iter().map(Vec::len).max().unwrap_or(0);
    let n = rows.max(cols);

    let is_eligible = |d: usize, i: usize| -> Option<f32> {
        scores.get(d).and_then(|row| row.get(i)).copied().flatten()
    };

    // 1-indexed (n+1) x (n+1) cost matrix for the classic potentials
    // algorithm below; row/col 0 are unused sentinels.
    let mut cost = vec![vec![0.0_f64; n + 1]; n + 1];
    for d in 0..n {
        for i in 0..n {
            cost[d + 1][i + 1] = if d < rows && i < cols {
                match is_eligible(d, i) {
                    Some(score) if score >= min_score => f64::from(1.0 - score),
                    _ => INELIGIBLE_COST,
                }
            } else {
                DUMMY_COST // padded dummy row or column: always an opt out
            };
        }
    }

    let row_for_col = solve_square(&cost, n);

    let mut assignments = vec![None; rows];
    for (col_1based, &row_1based) in row_for_col.iter().enumerate().skip(1) {
        if row_1based == 0 {
            continue;
        }
        let (row, col) = (row_1based - 1, col_1based - 1);
        if row >= rows || col >= cols {
            continue; // matched a dummy row or dummy column: not a real pair
        }
        if is_eligible(row, col).is_some_and(|s| s >= min_score) {
            assignments[row] = Some(col);
        }
    }
    assignments
}

/// Kuhn-Munkres on a square 1-indexed `(n+1) x (n+1)` cost matrix.
///
/// Successive shortest augmenting paths with potentials, O(n³). Returns
/// `p` where `p[j]` is the 1-indexed row assigned to column `j` (`0` when
/// nothing landed there); `p[0]` is a working sentinel, never a real
/// assignment.
#[allow(clippy::needless_range_loop)] // parallel arrays keyed by the same index
fn solve_square(cost: &[Vec<f64>], n: usize) -> Vec<usize> {
    let mut u = vec![0.0_f64; n + 1];
    let mut v = vec![0.0_f64; n + 1];
    let mut p = vec![0usize; n + 1];
    let mut way = vec![0usize; n + 1];

    for i in 1..=n {
        p[0] = i;
        let mut j0 = 0usize;
        let mut min_to = vec![f64::INFINITY; n + 1];
        let mut visited = vec![false; n + 1];
        loop {
            visited[j0] = true;
            let i0 = p[j0];
            let mut delta = f64::INFINITY;
            let mut j1 = 0usize;
            for j in 1..=n {
                if visited[j] {
                    continue;
                }
                let reduced = cost[i0][j] - u[i0] - v[j];
                if reduced < min_to[j] {
                    min_to[j] = reduced;
                    way[j] = j0;
                }
                if min_to[j] < delta {
                    delta = min_to[j];
                    j1 = j;
                }
            }
            for j in 0..=n {
                if visited[j] {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    min_to[j] -= delta;
                }
            }
            j0 = j1;
            if p[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }
    p
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn empty_matrix_yields_empty_assignment() {
        assert_eq!(hungarian_assign(&[], 0.6), Vec::<Option<usize>>::new());
    }

    #[test]
    fn clear_diagonal_two_by_two() {
        let scores = vec![vec![Some(0.9), Some(0.1)], vec![Some(0.1), Some(0.9)]];
        assert_eq!(hungarian_assign(&scores, 0.5), vec![Some(0), Some(1)]);
    }

    #[test]
    fn crossed_scores_beat_greedy() {
        // Greedy would give det0 -> id0 (0.9 > 0.85) then force det1 -> id1
        // (0.1). The optimal total instead swaps both: 0.85 + 0.95 > 0.9 + 0.1.
        let scores = vec![vec![Some(0.9), Some(0.85)], vec![Some(0.95), Some(0.1)]];
        assert_eq!(hungarian_assign(&scores, 0.5), vec![Some(1), Some(0)]);
    }

    #[test]
    fn ineligible_cells_are_never_assigned() {
        let scores = vec![vec![None, Some(0.9)], vec![Some(0.95), Some(0.2)]];
        let out = hungarian_assign(&scores, 0.6);
        assert_ne!(out[0], Some(0), "det0/id0 was None and must not be chosen");
        assert_eq!(out, vec![Some(1), Some(0)]);
    }

    #[test]
    fn more_detections_than_identities_gives_extras_none() {
        let scores = vec![vec![Some(0.9)], vec![Some(0.8)], vec![Some(0.95)]];
        let out = hungarian_assign(&scores, 0.5);
        assert_eq!(out.iter().filter(|o| o.is_some()).count(), 1);
        // The single identity should go to whichever detection scored best.
        assert_eq!(out[2], Some(0));
        assert_eq!(out[0], None);
        assert_eq!(out[1], None);
    }

    #[test]
    fn more_identities_than_detections_leaves_unused_ids_out() {
        let scores = vec![vec![Some(0.9), Some(0.5), Some(0.7)]];
        let out = hungarian_assign(&scores, 0.6);
        assert_eq!(out, vec![Some(0)]);
    }

    #[test]
    fn scores_below_min_score_are_none() {
        let scores = vec![vec![Some(0.5)]];
        assert_eq!(hungarian_assign(&scores, 0.6), vec![None]);
    }

    #[test]
    fn all_ineligible_square_matrix_forces_none_everywhere() {
        // rows == cols, so there is no dummy padding at all: every cell is
        // ineligible and the solver is forced into some perfect matching,
        // but every entry must still be reported as unmatched.
        let scores = vec![vec![None, Some(0.1)], vec![Some(0.2), None]];
        assert_eq!(hungarian_assign(&scores, 0.6), vec![None, None]);
    }

    #[test]
    fn ties_prefer_lower_column_then_lower_row() {
        let scores = vec![vec![Some(0.8), Some(0.8)], vec![Some(0.8), Some(0.8)]];
        assert_eq!(hungarian_assign(&scores, 0.5), vec![Some(0), Some(1)]);
    }
}
