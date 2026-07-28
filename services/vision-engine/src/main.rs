//! Vision engine — the deterministic core, served over HTTP.
//!
//! Camera → frame validator → motion detection → blob extraction → tracking
//! → temporal validation → `TriggerGate`. Classification of gated events is
//! handled by the agent layer; nothing in this binary consults a model.
//!
//! Listens on `:8090` (override with `ENGINE_PORT`).

mod api;
mod engine;
mod pipeline;

use std::sync::{Arc, Mutex};
use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();

    let demo = pipeline::run_demo();
    info!(?demo, "self-check: stub pipeline");

    let port: u16 = std::env::var("ENGINE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);

    let state = Arc::new(Mutex::new(engine::Engine::new()));
    let app = api::router(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(%addr, %err, "could not bind vision engine");
            std::process::exit(1);
        }
    };
    info!(%addr, "vision-engine listening");
    if let Err(err) = axum::serve(listener, app).await {
        tracing::error!(%err, "vision engine stopped");
        std::process::exit(1);
    }
}
