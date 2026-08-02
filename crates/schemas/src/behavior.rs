//! Behavior and posture types for surveillance action analysis.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::decision::Provenance;

/// Closed list of recognizable human and object behaviors.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorType {
    /// Looking around, peering, inspecting object or entry point.
    Looking,
    /// Waving hand, signaling, SOS or greeting motion.
    Waving,
    /// Physical altercation, fighting, punching, wrestling, or grappling.
    Fighting,
    /// Lingering, pacing back and forth, or remaining stationary in a restricted zone.
    Loitering,
    /// Fast movement, sprinting, or fleeing.
    Running,
    /// Crouching down, sneaking, or hiding.
    Crouching,
    /// Falling down, collapsing, or slipping.
    Falling,
    /// Hand gesture, pointing, or arm signaling.
    Gesturing,
    /// Drawing or wielding a weapon (gun, knife, firearm).
    PullingWeapon,
    /// Presence or activity of a military/tactical vehicle.
    MilitaryVehicle,
    /// Sighting of a missing or distressed person in remote/forest area.
    MissingPerson,
    /// Validated observation with an unclassified behavior pattern.
    Unknown,
    /// User-defined custom behavior string.
    Custom(String),
}

/// A validated behavior observation emitted by the analysis pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorObservation {
    /// Unique identifier for this observation.
    pub id: Uuid,
    /// Tracked object exhibiting the behavior.
    pub target_object_id: Uuid,
    /// The classified behavior type.
    pub behavior: BehaviorType,
    /// Model confidence in `[0.0, 1.0]`.
    pub confidence: f32,
    /// Subjective intensity or magnitude score in `[0.0, 1.0]`.
    pub intensity: f32,
    /// Enumerated evidence labels supporting this behavior classification.
    pub evidence_labels: Vec<String>,
    /// Capture timestamp.
    pub timestamp: DateTime<Utc>,
    /// Full provenance for zero-black-box auditing.
    pub provenance: Provenance,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn behavior_type_serializes_snake_case() {
        let json = serde_json::to_string(&BehaviorType::Fighting).unwrap();
        assert_eq!(json, "\"fighting\"");
    }

    #[test]
    fn behavior_observation_roundtrips_json() {
        let obs = BehaviorObservation {
            id: Uuid::new_v4(),
            target_object_id: Uuid::new_v4(),
            behavior: BehaviorType::Waving,
            confidence: 0.94,
            intensity: 0.8,
            evidence_labels: vec!["raised_hand".into(), "repetitive_wave".into()],
            timestamp: Utc::now(),
            provenance: Provenance {
                model_version: "qwen2.5-vl:7b".into(),
                prompt_version: "behavior-v1".into(),
                input_images: vec!["snap-001.jpg".into()],
                timestamp: Utc::now(),
            },
        };

        let json = serde_json::to_string(&obs).unwrap();
        let back: BehaviorObservation = serde_json::from_str(&json).unwrap();
        assert_eq!(back.behavior, BehaviorType::Waving);
        assert_eq!(back.evidence_labels.len(), 2);
    }
}
