//! Shared serde types — the single source of truth for every structured
//! payload in the system. No free-form text crosses component boundaries;
//! everything is one of these types.
//!
//! # Modules
//! - [`object`] — detectable object classes and tracked-object state
//! - [`detection`] — raw detector output and validated detections
//! - [`decision`] — agent decisions with full zero-black-box provenance
//! - [`behavior`] — behavior analysis, postures, and gestures

pub mod behavior;
pub mod decision;
pub mod detection;
pub mod object;

pub use behavior::{BehaviorObservation, BehaviorType};
pub use decision::{AgentDecision, Evidence, Provenance};
pub use detection::{Detection, ValidatedDetection};
pub use object::{ObjectClass, TrackedObject};
