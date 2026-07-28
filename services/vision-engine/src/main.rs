//! Vision engine — wires the deterministic pipeline together.
//!
//! Camera → Detector → confidence filter → Tracker → `TriggerGate` →
//! (Super Agent, stubbed) → Guardrails → Rules → Actions.
//!
//! This binary currently runs the pipeline against stub backends so the
//! wiring, gating, and guardrails are exercised end-to-end before any real
//! camera or model backend lands.

mod pipeline;

use tracing::info;

fn main() {
    tracing_subscriber::fmt().init();
    info!("vision-engine starting (stub backends)");
    let report = pipeline::run_demo();
    info!(?report, "pipeline demo complete");
}
