//! Agent decision types with full zero-black-box provenance.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// A single piece of evidence supporting a decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    /// Short machine-readable label, e.g. `"face_detected"`.
    pub label: String,
    /// Human-readable description, e.g. `"Face detected in frame 46"`.
    pub description: String,
}

/// Where a decision came from — required on every decision, no exceptions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    /// Model identifier and version, e.g. `"qwen2.5-vl:7b"`.
    pub model_version: String,
    /// Prompt template version, e.g. `"identity-v3"`.
    pub prompt_version: String,
    /// Snapshot/image identifiers used as input.
    pub input_images: Vec<String>,
    /// When the inference ran.
    pub timestamp: DateTime<Utc>,
}

/// A validated agent decision. Free-form text is not allowed anywhere in the
/// pipeline: risk is a number, reasons are enumerated evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDecision {
    /// Unique id for audit and replay.
    pub id: Uuid,
    /// Tracked object this decision is about.
    pub object_id: Uuid,
    /// Risk score in `[0.0, 1.0]`.
    pub risk: f32,
    /// Enumerated evidence — never a prose blob.
    pub evidence: Vec<Evidence>,
    /// Overall confidence in `[0.0, 1.0]`.
    pub confidence: f32,
    /// Action the agent proposes (validated downstream before execution).
    pub proposed_action: String,
    /// Full provenance for the zero-black-box policy.
    pub provenance: Provenance,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_roundtrips_and_keeps_provenance() {
        let d = AgentDecision {
            id: Uuid::new_v4(),
            object_id: Uuid::new_v4(),
            risk: 0.82,
            evidence: vec![Evidence {
                label: "running".into(),
                description: "Subject running near restricted area".into(),
            }],
            confidence: 0.97,
            proposed_action: "notify".into(),
            provenance: Provenance {
                model_version: "qwen2.5-vl:7b".into(),
                prompt_version: "risk-v1".into(),
                input_images: vec!["snap-001.jpg".into()],
                timestamp: Utc::now(),
            },
        };
        let back: AgentDecision =
            serde_json::from_str(&serde_json::to_string(&d).unwrap()).unwrap();
        assert_eq!(back.provenance.prompt_version, "risk-v1");
        assert_eq!(back.evidence.len(), 1);
    }
}
