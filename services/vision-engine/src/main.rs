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
mod cli;
mod config;
mod engine;
mod file_pump;
mod identify;
mod identity_store;
mod netscan;
mod onvif_client;
mod pinned;
mod pipeline;
mod reolink_client;
mod rtsp;
mod scan_jobs;

use identify::IdentityState;
use identity_store::IdentityStore;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

/// Open the durable identity store at `db_path` and seed a fresh
/// [`identity::Registry`] from it, so a restart resumes with prior
/// identities intact.
///
/// Falls back to an in-memory (non-persistent) store if the on-disk
/// database cannot be opened — a stuck or missing database must not stop
/// the engine from starting — and to an empty registry if the store cannot
/// be read, logging both cases rather than failing.
fn load_identity_state(db_path: &Path) -> Result<IdentityState, identity_store::StoreError> {
    let store = IdentityStore::open(db_path).or_else(|err| {
        warn!(
            %err,
            path = ?db_path,
            "failed to open identity database; falling back to in-memory store (identities will not persist)"
        );
        IdentityStore::open_in_memory()
    })?;

    let mut registry = identity::Registry::new();
    match store.load_all() {
        Ok(identities) => {
            let count = identities.len();
            registry.import(identities);
            info!(count, path = ?db_path, "loaded identities from durable store");
        }
        Err(err) => warn!(%err, "failed to load identities from store; starting empty"),
    }

    Ok(IdentityState {
        registry: Arc::new(Mutex::new(registry)),
        store: Arc::new(store),
    })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();

    let cli = cli::parse_args(std::env::args());

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

    let identity_db_path = identity_store::IdentityStore::default_path();
    let identity_state = match load_identity_state(&identity_db_path) {
        Ok(state) => state,
        Err(err) => {
            error!(%err, "failed to open identity store, even in-memory; exiting");
            std::process::exit(1);
        }
    };

    let gateway_url =
        std::env::var("GATEWAY_URL").unwrap_or_else(|_| "http://localhost:8080".to_owned());

    if let Some(file_args) = cli.file_camera.clone() {
        info!(
            path = %file_args.input.display(),
            camera_id = %file_args.camera_id,
            "starting file camera pump"
        );
        let _pump = file_pump::spawn(state.clone(), file_args);
    }

    let app = api::router(state, identity_state, gateway_url);

    info!(port = bound.port, "vision-engine listening");
    if let Err(err) = axum::serve(bound.listener, app).await {
        error!(%err, "vision engine stopped");
        std::process::exit(1);
    }
}
