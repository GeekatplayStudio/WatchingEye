//! Where things are going, and roughly how far away they are.
//!
//! Two separate jobs that both turn tracker output into something an operator
//! or an animatronic can act on:
//!
//! - [`motion`] — direction and speed of travel, from tracked velocity.
//! - [`distance`] — a *rough* range estimate from apparent size, carrying its
//!   own assumptions because one camera cannot actually measure depth.
//!
//! Neither module consults a model. Both are arithmetic over numbers the
//! deterministic pipeline already produced, so both replay identically.

pub mod distance;
pub mod motion;

pub use distance::{estimate, focal_length_px, DistanceEstimate};
pub use motion::{describe, Heading, MotionVector};
