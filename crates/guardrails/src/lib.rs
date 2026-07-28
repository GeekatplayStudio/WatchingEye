//! Guardrails — the "never trust an LLM" enforcement layer.
//!
//! Pipeline: raw LLM text → JSON schema validation (serde) → confidence
//! validation → policy validation → validated [`AgentDecision`].
//! Any failure returns a typed error; callers fall back to a safe default.
//! There is no path from raw model output to execution that skips this.

use schemas::AgentDecision;
use thiserror::Error;

/// Why a model output was rejected.
#[derive(Debug, Error)]
pub enum GuardrailError {
    /// Output was not valid JSON or did not match the decision schema.
    #[error("schema validation failed: {0}")]
    Schema(#[from] serde_json::Error),
    /// A numeric field was outside its allowed range.
    #[error("range violation: {field} = {value}, expected [0.0, 1.0]")]
    Range {
        /// Offending field name.
        field: &'static str,
        /// Offending value.
        value: f32,
    },
    /// Decision confidence fell below the configured floor.
    #[error("confidence {actual} below required minimum {required}")]
    LowConfidence {
        /// Confidence in the decision.
        actual: f32,
        /// Configured minimum.
        required: f32,
    },
    /// Decision proposed an action not on the allowlist.
    #[error("action '{0}' is not in the allowed action set")]
    DisallowedAction(String),
    /// Decision carried no evidence — violates zero-black-box policy.
    #[error("decision has no evidence")]
    NoEvidence,
}

/// Static policy applied to every decision.
#[derive(Debug, Clone)]
pub struct Policy {
    /// Minimum acceptable confidence, e.g. `0.95`.
    pub min_confidence: f32,
    /// Actions the agent may propose; anything else is rejected.
    pub allowed_actions: Vec<String>,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            min_confidence: 0.95,
            allowed_actions: vec!["notify".into(), "log_only".into()],
        }
    }
}

/// Validate raw LLM output into a trusted [`AgentDecision`].
///
/// # Errors
/// Returns a [`GuardrailError`] describing the first gate that failed.
/// Callers must treat any error as "do nothing / safe default".
pub fn validate(raw: &str, policy: &Policy) -> Result<AgentDecision, GuardrailError> {
    let decision: AgentDecision = serde_json::from_str(raw)?;

    for (field, value) in [("risk", decision.risk), ("confidence", decision.confidence)] {
        if !(0.0..=1.0).contains(&value) {
            return Err(GuardrailError::Range { field, value });
        }
    }
    if decision.confidence < policy.min_confidence {
        return Err(GuardrailError::LowConfidence {
            actual: decision.confidence,
            required: policy.min_confidence,
        });
    }
    if decision.evidence.is_empty() {
        return Err(GuardrailError::NoEvidence);
    }
    if !policy.allowed_actions.contains(&decision.proposed_action) {
        return Err(GuardrailError::DisallowedAction(decision.proposed_action));
    }
    Ok(decision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_json(confidence: f32, action: &str, evidence: bool) -> String {
        json!({
            "id": "6f1c1a34-1111-4222-8333-444455556666",
            "object_id": "6f1c1a34-7777-4888-9999-aaaabbbbcccc",
            "risk": 0.82,
            "evidence": if evidence {
                json!([{"label": "running", "description": "Running near door"}])
            } else { json!([]) },
            "confidence": confidence,
            "proposed_action": action,
            "provenance": {
                "model_version": "qwen2.5-vl:7b",
                "prompt_version": "risk-v1",
                "input_images": ["snap-1.jpg"],
                "timestamp": "2026-07-27T00:00:00Z"
            }
        })
        .to_string()
    }

    #[test]
    fn valid_decision_passes_all_gates() {
        let d = validate(&valid_json(0.97, "notify", true), &Policy::default()).unwrap();
        assert_eq!(d.proposed_action, "notify");
    }

    #[test]
    fn malformed_json_is_rejected() {
        assert!(matches!(
            validate("looks suspicious to me", &Policy::default()),
            Err(GuardrailError::Schema(_))
        ));
    }

    #[test]
    fn low_confidence_is_rejected() {
        assert!(matches!(
            validate(&valid_json(0.60, "notify", true), &Policy::default()),
            Err(GuardrailError::LowConfidence { .. })
        ));
    }

    #[test]
    fn hallucinated_action_is_rejected() {
        assert!(matches!(
            validate(&valid_json(0.99, "open_garage_door", true), &Policy::default()),
            Err(GuardrailError::DisallowedAction(_))
        ));
    }

    #[test]
    fn missing_evidence_is_rejected() {
        assert!(matches!(
            validate(&valid_json(0.99, "notify", false), &Policy::default()),
            Err(GuardrailError::NoEvidence)
        ));
    }
}
