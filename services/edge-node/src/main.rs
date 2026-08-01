//! Edge node — the pipeline for small devices, and nothing else.
//!
//! Same deterministic chain as the desktop engine (validate → background →
//! blobs → track → gate → aim), same JSON contract, but built for a
//! Raspberry Pi-class budget: synchronous, single camera, no async runtime,
//! no identity registry, no VLM. Classification is the hub's job — this
//! node's job is to never miss a frame and never slam a servo.
//!
//! Offline cache (ROADMAP 3.2): gate-open metadata lands in `SQLite`
//! (`EDGE_CACHE_DB`); when `EDGE_HUB_URL` is set, pending rows POST to
//! `{hub}/api/edge/sync` and drop on ACK. No frames or AI on the edge.
//!
//! Listens on `:8090` (override with `EDGE_PORT`). Build small with
//! `cargo build -p edge-node --profile edge`.

mod cache;
mod pipeline;
mod sync;

use cache::{EventCache, PendingEvent};
use chrono::Utc;
use pipeline::{FrameResult, TriggerSnapshot};
use tiny_http::{Header, Method, Response, Server};

fn json_header() -> Header {
    #[allow(clippy::expect_used)] // static string, cannot fail
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header is valid")
}

fn node_id() -> String {
    std::env::var("EDGE_NODE_ID").unwrap_or_else(|_| "edge-1".into())
}

fn hub_url() -> Option<String> {
    std::env::var("EDGE_HUB_URL").ok().filter(|u| !u.trim().is_empty())
}

fn open_cache() -> EventCache {
    match EventCache::open(EventCache::default_path()) {
        Ok(c) => c,
        Err(err) => {
            eprintln!("edge-node: cache open failed ({err}); using in-memory");
            EventCache::open_in_memory().unwrap_or_else(|e| {
                eprintln!("edge-node: in-memory cache failed: {e}");
                std::process::exit(1);
            })
        }
    }
}

fn cache_triggers(cache: &EventCache, frame: u64, triggers: &[TriggerSnapshot]) {
    let cam = node_id();
    let now = Utc::now().to_rfc3339();
    for t in triggers {
        let id = format!("{cam}-{frame}-{}", t.track_id);
        let Ok(payload) = serde_json::to_string(&t) else {
            continue;
        };
        let event = PendingEvent {
            id,
            camera_id: cam.clone(),
            frame,
            track_id: t.track_id,
            kind: "gate_open".into(),
            payload,
            created_at: now.clone(),
        };
        if let Err(err) = cache.append(&event) {
            eprintln!("edge-node: cache append failed: {err}");
        }
    }
}

fn try_flush(cache: &EventCache) {
    let Some(hub) = hub_url() else {
        return;
    };
    match sync::flush(cache, &hub) {
        Ok(0) => {}
        Ok(n) => eprintln!("edge-node: synced {n} pending event(s)"),
        Err(err) => eprintln!("edge-node: sync soft-fail: {err}"),
    }
}

fn health_body(cache: &EventCache) -> String {
    let pending = cache.pending_count().unwrap_or(0);
    format!(r#"{{"status":"ok","service":"edge-node","pending":{pending}}}"#)
}

fn main() {
    let port: u16 = std::env::var("EDGE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);

    let server = match Server::http(("0.0.0.0", port)) {
        Ok(server) => server,
        Err(err) => {
            eprintln!("edge-node: could not bind port {port}: {err}");
            std::process::exit(1);
        }
    };
    println!("edge-node listening on :{port}");

    let cache = open_cache();
    try_flush(&cache);

    let mut node = pipeline::Node::new();
    let mut body = String::new();

    for mut request in server.incoming_requests() {
        let response = match (request.method(), request.url()) {
            (Method::Get, "/health") => {
                Response::from_string(health_body(&cache)).with_header(json_header())
            }
            (Method::Post, "/api/sync") => {
                try_flush(&cache);
                Response::from_string(health_body(&cache)).with_header(json_header())
            }
            (Method::Post, "/api/frame") => {
                body.clear();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    Response::from_string(r#"{"error":"unreadable body"}"#)
                        .with_status_code(400)
                        .with_header(json_header())
                } else {
                    match node.handle(&body) {
                        Ok(FrameResult {
                            json,
                            frame,
                            triggers,
                        }) => {
                            if !triggers.is_empty() {
                                cache_triggers(&cache, frame, &triggers);
                                try_flush(&cache);
                            }
                            Response::from_string(json).with_header(json_header())
                        }
                        Err(msg) => Response::from_string(format!(r#"{{"error":"{msg}"}}"#))
                            .with_status_code(400)
                            .with_header(json_header()),
                    }
                }
            }
            _ => Response::from_string(r#"{"error":"not found"}"#)
                .with_status_code(404)
                .with_header(json_header()),
        };
        // A client vanishing mid-response is routine on flaky WiFi, not fatal.
        let _ = request.respond(response);
    }
}
