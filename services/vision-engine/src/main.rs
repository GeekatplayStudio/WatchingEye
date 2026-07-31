//! Vision engine — the deterministic core, served over HTTP.
//!
//! Camera → frame validator → motion detection → blob extraction → tracking
//! → temporal validation → `TriggerGate` → aim. Nothing in this binary
//! consults a model; classification of gated events is the agent layer's job.
//!
//! Listens on `:8090` by default (override with `ENGINE_PORT`). If that port
//! is busy it moves to the next free one and records the choice in
//! `.runtime/engine.port` rather than refusing to start.

mod api;
mod bind;
mod cameras_api;
mod config;
mod engine;
mod identify;
mod netscan;
mod onvif_client;
mod pinned;
mod pipeline;
mod reolink_client;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();

    let demo = pipeline::run_demo();
    info!(?demo, "self-check: stub pipeline");

    let preferred: u16 = std::env::var("ENGINE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);

    let bound = match bind::bind_with_fallback(preferred).await {
        Ok(bound) => bound,
        Err(err) => {
            error!(
                preferred,
                range = bind::PORT_SCAN_RANGE,
                %err,
                "no free port; stop the running instance with scripts/stop.ps1"
            );
            std::process::exit(1);
        }
    };
    if bound.fell_back {
        warn!(
            preferred,
            port = bound.port,
            "preferred port was busy — another engine is probably already running"
        );
    }

    // Repo root is two levels above this crate.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map_or_else(|| PathBuf::from("."), PathBuf::from);
    match bind::write_port_file(&root, bound.port) {
        Ok(path) => info!(?path, "recorded port for the rest of the stack"),
        Err(err) => warn!(%err, "could not record port file; clients may look on the wrong port"),
    }

    let state = Arc::new(Mutex::new(engine::Engine::new()));
    let registry = Arc::new(Mutex::new(identity::Registry::new()));
    let app = api::router(state, registry);

    info!(port = bound.port, "vision-engine listening");
    if let Err(err) = axum::serve(bound.listener, app).await {
        error!(%err, "vision engine stopped");
        std::process::exit(1);
    }
}
