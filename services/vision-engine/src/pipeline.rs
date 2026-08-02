//! End-to-end pipeline wiring with stub camera/detector backends.
//!
//! The stubs are deterministic so the integration test proves the full
//! chain: detect → filter → track → gate → guardrails → rules → actions.
//! Live webhook delivery is covered by [`crate::notify`] tests; this demo
//! only proves the pure evaluate path.

use chrono::Utc;
use detector::filter_by_confidence;
use events::{Event, EventKind};
use guardrails::Policy;
use rules::{Action, Condition, Rule};
use schemas::detection::BoundingBox;
use schemas::{Detection, ObjectClass};
use tracker::{Tracker, TriggerGate};

/// Summary of one demo pipeline run, for logging and tests.
#[derive(Debug, PartialEq, Eq)]
pub struct RunReport {
    /// Detections that survived the confidence filter.
    pub validated_detections: usize,
    /// Whether the super-agent gate opened.
    pub agent_triggered: bool,
    /// Whether the (stub) agent decision passed guardrails.
    pub decision_validated: bool,
    /// Actions the rule engine emitted.
    pub actions: Vec<Action>,
}

/// Deterministic stub detection stream: a person in 3 consecutive frames
/// plus one low-confidence noise detection that must be filtered out.
fn stub_detections() -> Vec<Detection> {
    let mk = |frame: u64, confidence: f32| Detection {
        class: ObjectClass::Person,
        confidence,
        bbox: BoundingBox {
            x: 10.0,
            y: 10.0,
            width: 50.0,
            height: 120.0,
        },
        contour: None,
        frame,
        model: "stub-yolo".into(),
        timestamp: Utc::now(),
    };
    vec![mk(45, 0.98), mk(46, 0.97), mk(47, 0.99), mk(47, 0.40)]
}

/// Stub super-agent output: valid JSON matching the decision schema.
fn stub_agent_response(object_id: uuid::Uuid) -> String {
    serde_json::json!({
        "id": uuid::Uuid::new_v4(),
        "object_id": object_id,
        "risk": 0.30,
        "evidence": [
            {"label": "walking", "description": "Person walking toward door"}
        ],
        "confidence": 0.97,
        "proposed_action": "notify",
        "provenance": {
            "model_version": "stub-vlm",
            "prompt_version": "demo-v1",
            "input_images": ["frame-47.jpg"],
            "timestamp": Utc::now()
        }
    })
    .to_string()
}

/// Garage / person / notify rule used by the stub demo.
fn demo_rules() -> Vec<Rule> {
    vec![Rule {
        name: "person-in-garage".into(),
        conditions: vec![
            Condition::IsClass(ObjectClass::Person),
            Condition::InZone("garage".into()),
        ],
        action: Action::Notify {
            channel: "default".into(),
        },
    }]
}

/// Run the full pipeline once with stub backends.
#[must_use]
pub fn run_demo() -> RunReport {
    let detections = filter_by_confidence(stub_detections(), 0.95);
    let validated_detections = detections.len();

    let mut tracker = Tracker::new();
    let gate = TriggerGate::default();
    let mut triggered_id = None;
    for d in &detections {
        let id = tracker.observe(d);
        if let Some(obj) = tracker.get(id) {
            if gate.should_trigger(obj) {
                triggered_id = Some(id);
            }
        }
    }

    let (agent_triggered, decision_validated, actions) = match triggered_id {
        None => (false, false, Vec::new()),
        Some(id) => {
            let decision = guardrails::validate(&stub_agent_response(id), &Policy::default());
            let validated = decision.is_ok();
            let event = Event::new(
                id,
                ObjectClass::Person,
                EventKind::EnteredZone {
                    zone: "garage".into(),
                },
                "stub-cam",
            );
            (true, validated, rules::evaluate(&demo_rules(), &event))
        }
    };

    RunReport {
        validated_detections,
        agent_triggered,
        decision_validated,
        actions,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;

    #[test]
    fn full_pipeline_triggers_validates_and_notifies() {
        let report = run_demo();
        assert_eq!(report.validated_detections, 3);
        assert!(report.agent_triggered);
        assert!(report.decision_validated);
        assert_eq!(
            report.actions,
            vec![Action::Notify {
                channel: "default".into()
            }]
        );
    }

    #[test]
    fn demo_evaluate_is_stable_across_calls() {
        let a = run_demo().actions;
        let b = run_demo().actions;
        assert_eq!(a, b);
    }
}
