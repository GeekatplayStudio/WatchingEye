//! Edge node — the pipeline for small devices, and nothing else.
//!
//! Same deterministic chain as the desktop engine (validate → background →
//! blobs → track → gate → aim), same JSON contract, but built for a
//! Raspberry Pi-class budget: synchronous, single camera, no async runtime,
//! no identity registry, no VLM. Classification is the hub's job — this
//! node's job is to never miss a frame and never slam a servo.
//!
//! Listens on `:8090` (override with `EDGE_PORT`). Build small with
//! `cargo build -p edge-node --profile edge`.

mod pipeline;

use tiny_http::{Header, Method, Response, Server};

fn json_header() -> Header {
    #[allow(clippy::expect_used)] // static string, cannot fail
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header is valid")
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

    let mut node = pipeline::Node::new();
    let mut body = String::new();

    for mut request in server.incoming_requests() {
        let response = match (request.method(), request.url()) {
            (Method::Get, "/health") => {
                Response::from_string(r#"{"status":"ok","service":"edge-node"}"#)
                    .with_header(json_header())
            }
            (Method::Post, "/api/frame") => {
                body.clear();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    Response::from_string(r#"{"error":"unreadable body"}"#)
                        .with_status_code(400)
                        .with_header(json_header())
                } else {
                    match node.handle(&body) {
                        Ok(json) => Response::from_string(json).with_header(json_header()),
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
