//! Camera discovery and Reolink endpoints.
//!
//! Discovery reports what it *found*; it never registers a camera on its
//! own. Adding a device to the pipeline stays an explicit operator action,
//! because a scan that silently adopted every answering host would put
//! unvetted sources into the decision path.

use crate::reolink_client::ReolinkClient;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use camera::discovery::{self, Candidate};
use camera::reolink::{ReolinkHost, Stream};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

/// Request to sweep a subnet.
#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    /// CIDR range to sweep, e.g. `"192.168.1.0/24"`.
    pub cidr: String,
}

/// What a sweep turned up.
#[derive(Debug, Serialize)]
pub struct ScanResponse {
    /// The range that was swept.
    pub cidr: String,
    /// Hosts that answered on a camera port or via ONVIF.
    pub candidates: Vec<Candidate>,
}

/// Request to log into a Reolink device.
#[derive(Debug, Deserialize)]
pub struct ReolinkRequest {
    /// Device address.
    pub host: String,
    /// Username.
    pub user: String,
    /// Password.
    pub password: String,
    /// API port. Defaults to 80.
    #[serde(default)]
    pub port: Option<u16>,
    /// Whether the API is served over TLS.
    #[serde(default)]
    pub https: bool,
}

impl ReolinkRequest {
    fn to_host(&self) -> ReolinkHost {
        ReolinkHost {
            host: self.host.clone(),
            port: self.port.unwrap_or(if self.https { 443 } else { 80 }),
            rtsp_port: 554,
            https: self.https,
        }
    }
}

/// A local network this machine is attached to.
#[derive(Debug, Clone, Serialize)]
pub struct Interface {
    /// Interface name, e.g. `"Ethernet"`.
    pub name: String,
    /// This machine's address on it.
    pub address: String,
    /// The CIDR range to sweep to reach the rest of that network.
    pub cidr: String,
    /// How many hosts that range covers, so the UI can warn before a long scan.
    pub hosts: u64,
}

/// Report the subnets worth scanning.
///
/// Guessing `/24` is wrong on any network that is not one — and getting the
/// mask wrong means most of the cameras are never probed. The interface's
/// real netmask is the only reliable source, so it is read rather than
/// assumed.
async fn interfaces() -> Response {
    let mut found: Vec<Interface> = Vec::new();
    let Ok(addrs) = if_addrs::get_if_addrs() else {
        return Json(Vec::<Interface>::new()).into_response();
    };
    for iface in addrs {
        // Loopback has nothing to find; IPv6 is not swept.
        if iface.is_loopback() {
            continue;
        }
        let IpAddr::V4(addr) = iface.ip() else {
            continue;
        };
        let if_addrs::IfAddr::V4(v4) = &iface.addr else {
            continue;
        };
        let Some(cidr) = discovery::subnet_of(&addr.to_string(), &v4.netmask.to_string()) else {
            continue;
        };
        let hosts = discovery::expand_cidr(&cidr).map_or(0, |h| h.len() as u64);
        if found.iter().any(|f| f.cidr == cidr) {
            continue;
        }
        found.push(Interface {
            name: iface.name.clone(),
            address: addr.to_string(),
            cidr,
            hosts,
        });
    }
    // Scannable ranges first: a range too large to sweep is reported with
    // hosts 0 and is useless to offer as the default.
    found.sort_by(|a, b| (b.hosts > 0).cmp(&(a.hosts > 0)).then(a.name.cmp(&b.name)));
    Json(found).into_response()
}

/// Routes for finding and interrogating cameras.
pub fn router() -> Router {
    Router::new()
        .route("/api/cameras/interfaces", get(interfaces))
        .route("/api/cameras/scan", post(scan))
        .route("/api/cameras/onvif/confirm", post(confirm_onvif))
        .route("/api/cameras/onvif/inventory", post(onvif_inventory))
        .route("/api/cameras/reolink/probe", post(probe_reolink))
        .route("/api/cameras/reolink/snapshot", post(reolink_snapshot))
        .merge(crate::scan_jobs::router())
}

/// Ask one host whether it speaks ONVIF. Needs no credentials.
async fn confirm_onvif(Json(req): Json<HostRequest>) -> Response {
    let (host, port) = split_host_port(&req.host, req.port);
    if host.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "an address is required");
    }
    match crate::onvif_client::confirm_on(&host, port).await {
        Some(service) => Json(service).into_response(),
        None => fail(
            StatusCode::NOT_FOUND,
            &format!(
                "{host} did not answer ONVIF{}. If it is a camera, ONVIF may need enabling on it \
                 (often Settings -> Network -> Advanced -> ONVIF).",
                port.map_or_else(
                    || " on any known port".to_owned(),
                    |p| format!(" on port {p} or any known port")
                )
            ),
        ),
    }
}

/// A host to interrogate, optionally carrying its port.
#[derive(Debug, Deserialize)]
pub struct HostRequest {
    /// Address, which may be written `host:port`.
    pub host: String,
    /// Port, when given separately from the address.
    #[serde(default)]
    pub port: Option<u16>,
}

/// Accept `192.168.1.50:8000` as readily as a separate port field.
///
/// Typing the port into the address box is the natural thing to do when you
/// already know it, and rejecting that would be pedantry.
fn split_host_port(raw: &str, explicit: Option<u16>) -> (String, Option<u16>) {
    let trimmed = raw.trim();
    // Strip a scheme and any path, so pasting a service URL also works.
    let without_scheme = trimmed.split_once("://").map_or(trimmed, |(_, rest)| rest);
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);

    if let Some((host, port)) = authority.rsplit_once(':') {
        if let Ok(parsed) = port.parse::<u16>() {
            return (host.to_owned(), explicit.or(Some(parsed)));
        }
    }
    (authority.to_owned(), explicit)
}

/// Credentials for an authenticated ONVIF interrogation.
#[derive(Debug, Deserialize)]
pub struct OnvifInventoryRequest {
    /// Service URL from `/api/cameras/onvif/confirm`.
    pub service_url: String,
    /// Username.
    pub user: String,
    /// Password.
    pub password: String,
}

/// Log into an ONVIF device and list its cameras and stream URLs.
///
/// The device's own clock is read first and used to sign the request: ONVIF
/// digests cover a timestamp, so a recorder whose clock has drifted rejects
/// correct credentials unless its time is used.
async fn onvif_inventory(Json(req): Json<OnvifInventoryRequest>) -> Response {
    let host = camera::discovery::host_of(&req.service_url).unwrap_or_default();
    let created = crate::onvif_client::confirm(&host)
        .await
        .and_then(|s| s.device_time)
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string());
    let nonce = uuid::Uuid::new_v4();

    match crate::onvif_client::inventory(
        &req.service_url,
        &req.user,
        &req.password,
        &created,
        nonce.as_bytes(),
    )
    .await
    {
        Ok(inv) => Json(inv).into_response(),
        Err(err) => fail(StatusCode::BAD_GATEWAY, &err),
    }
}

/// An error the operator can act on, rather than a bare status code.
pub(crate) fn fail(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

/// Sweep a subnet for anything that looks like a camera.
///
/// Every candidate is then asked directly whether it speaks ONVIF. An open
/// port is only a hint; a valid ONVIF reply is proof, and it is what turns a
/// list of addresses into a list of cameras.
async fn scan(Json(req): Json<ScanRequest>) -> Response {
    match crate::scan_jobs::run(&req.cidr).await {
        Ok(candidates) => Json(ScanResponse {
            cidr: req.cidr,
            candidates,
        })
        .into_response(),
        Err(err) => fail(StatusCode::BAD_REQUEST, &err),
    }
}

/// Log into a Reolink device and report the cameras behind it.
async fn probe_reolink(Json(req): Json<ReolinkRequest>) -> Response {
    let client = match ReolinkClient::login(req.to_host(), &req.user, &req.password).await {
        Ok(c) => c,
        Err(err) => return fail(StatusCode::BAD_GATEWAY, &err.to_string()),
    };
    match client.probe(&req.user, &req.password).await {
        Ok(result) => Json(result).into_response(),
        Err(err) => fail(StatusCode::BAD_GATEWAY, &err.to_string()),
    }
}

/// Request one still from a Reolink channel.
#[derive(Debug, Deserialize)]
pub struct SnapshotRequest {
    /// Device and credentials.
    #[serde(flatten)]
    pub device: ReolinkRequest,
    /// 0-based channel.
    #[serde(default)]
    pub channel: u8,
    /// Which stream to grab. Defaults to the sub stream, which is what the
    /// detection path should use.
    #[serde(default)]
    pub main_stream: bool,
}

/// Fetch a JPEG still, returned as base64 so it drops straight into the
/// existing classify path.
async fn reolink_snapshot(Json(req): Json<SnapshotRequest>) -> Response {
    let client =
        match ReolinkClient::login(req.device.to_host(), &req.device.user, &req.device.password)
            .await
        {
            Ok(c) => c,
            Err(err) => return fail(StatusCode::BAD_GATEWAY, &err.to_string()),
        };
    let stream = if req.main_stream {
        Stream::Main
    } else {
        Stream::Sub
    };
    match client.snapshot(req.channel, stream).await {
        Ok(bytes) => {
            // A device that answers with JSON instead of JPEG is reporting an
            // error in the only way this endpoint can see; say so rather than
            // handing back a broken image.
            if bytes.starts_with(b"{") || bytes.starts_with(b"[") {
                return fail(
                    StatusCode::BAD_GATEWAY,
                    &format!(
                        "device returned an error instead of an image: {}",
                        String::from_utf8_lossy(&bytes[..bytes.len().min(200)])
                    ),
                );
            }
            Json(serde_json::json!({
                "channel": req.channel,
                "bytes": bytes.len(),
                "image": base64(&bytes),
            }))
            .into_response()
        }
        Err(err) => fail(StatusCode::BAD_GATEWAY, &err.to_string()),
    }
}

/// Standard base64, no line breaks.
pub(crate) fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            *chunk.first().unwrap_or(&0),
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let idx = [(n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63];
        for (i, slot) in idx.iter().enumerate() {
            if i <= chunk.len() {
                out.push(ALPHABET[*slot as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_canonical_encoding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_handles_bytes_above_ascii() {
        assert_eq!(base64(&[0xff, 0xd8, 0xff]), "/9j/");
    }

    #[test]
    fn a_request_defaults_to_port_80_and_443_for_tls() {
        let plain = ReolinkRequest {
            host: "h".into(),
            user: "u".into(),
            password: "p".into(),
            port: None,
            https: false,
        };
        assert_eq!(plain.to_host().port, 80);

        let tls = ReolinkRequest {
            https: true,
            ..plain
        };
        assert_eq!(tls.to_host().port, 443);
    }

    #[test]
    fn an_address_may_carry_its_own_port() {
        assert_eq!(
            split_host_port("192.168.1.50:8000", None),
            ("192.168.1.50".to_owned(), Some(8000))
        );
        assert_eq!(
            split_host_port("192.168.1.50", None),
            ("192.168.1.50".to_owned(), None)
        );
    }

    #[test]
    fn a_pasted_service_url_is_reduced_to_host_and_port() {
        assert_eq!(
            split_host_port("http://192.168.1.50:8000/onvif/device_service", None),
            ("192.168.1.50".to_owned(), Some(8000))
        );
    }

    #[test]
    fn an_explicit_port_wins_over_one_in_the_address() {
        assert_eq!(
            split_host_port("192.168.1.50:80", Some(8000)),
            ("192.168.1.50".to_owned(), Some(8000))
        );
    }

    #[test]
    fn a_nonsense_port_is_not_mistaken_for_one() {
        // Better to probe the defaults than to invent a port from junk.
        assert_eq!(
            split_host_port("camera:abc", None),
            ("camera:abc".to_owned(), None)
        );
    }

    #[test]
    fn surrounding_whitespace_is_forgiven() {
        assert_eq!(
            split_host_port("  10.0.0.5  ", None),
            ("10.0.0.5".to_owned(), None)
        );
    }

    #[tokio::test]
    async fn an_empty_address_is_refused_before_any_socket_is_opened() {
        let res = confirm_onvif(Json(HostRequest {
            host: "   ".into(),
            port: None,
        }))
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_bad_range_is_rejected_with_a_reason() {
        let res = scan(Json(ScanRequest {
            cidr: "10.0.0.0/8".into(),
        }))
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
