//! Network side of camera discovery: the sockets `camera::discovery` omits.
//!
//! A sweep is deliberately bounded — a fixed concurrency window and a short
//! per-connection timeout — so scanning a home subnet stays a few seconds of
//! background work rather than something that saturates a link or a NAT
//! table. Nothing here decides what a device *is*; it reports what answered
//! and leaves classification to the pure layer.

use camera::discovery::{self, Candidate, DiscoveryError, CAMERA_PORTS};
use std::time::Duration;
use tokio::net::{TcpStream, UdpSocket};
use tokio::task::JoinSet;
use tokio::time::timeout;

/// How many hosts are probed at once.
///
/// Each host opens one socket per entry in `CAMERA_PORTS` simultaneously, so
/// the real ceiling is this times that — kept to a few hundred, which a
/// consumer router's NAT table tolerates.
const HOST_CONCURRENCY: usize = 64;

/// How long to wait for a TCP handshake before calling the port closed.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(400);

/// Sweep a CIDR range for hosts listening on camera ports.
///
/// # Errors
/// Propagates [`DiscoveryError`] when the range is unusable.
pub async fn sweep(cidr: &str) -> Result<Vec<Candidate>, DiscoveryError> {
    let hosts = discovery::expand_cidr(cidr)?;
    let mut found: Vec<Candidate> = Vec::new();

    for window in hosts.chunks(HOST_CONCURRENCY) {
        let mut set = JoinSet::new();
        for host in window {
            let host = host.clone();
            set.spawn(async move {
                let open = open_ports(&host).await;
                (host, open)
            });
        }
        while let Some(joined) = set.join_next().await {
            let Ok((host, open)) = joined else { continue };
            if open.is_empty() {
                continue;
            }
            let hint = discovery::classify(&open);
            found.push(Candidate {
                address: host,
                open_ports: open,
                hint,
                onvif_url: None,
            });
        }
    }

    found.sort_by(|a, b| a.address.cmp(&b.address));
    Ok(found)
}

/// Which of the camera ports accept a connection on one host.
///
/// All ports are tried at once. Probing them in sequence costs the timeout
/// once per closed port, which on a quiet address is the whole list — the
/// difference between a sweep measured in seconds and one in minutes.
async fn open_ports(host: &str) -> Vec<u16> {
    let mut set = JoinSet::new();
    for (port, _) in CAMERA_PORTS {
        let addr = format!("{host}:{port}");
        let port = *port;
        set.spawn(async move {
            match timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr)).await {
                Ok(Ok(stream)) => {
                    drop(stream);
                    Some(port)
                }
                _ => None,
            }
        });
    }

    let mut open = Vec::new();
    while let Some(joined) = set.join_next().await {
        if let Ok(Some(port)) = joined {
            open.push(port);
        }
    }
    // Completion order is arbitrary once concurrent; sort so a host's ports
    // read the same way every scan.
    open.sort_unstable();
    open
}

/// Send one ONVIF WS-Discovery probe and collect the replies.
///
/// Returns the service URLs devices advertised. Errors from the socket are
/// reported as an empty list: a network that blocks multicast is a normal
/// condition, not a failure of the scan, and the port sweep still runs.
pub async fn onvif_discover(wait: Duration) -> Vec<String> {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0").await else {
        return Vec::new();
    };
    if socket.set_broadcast(true).is_err() {
        return Vec::new();
    }

    let probe = discovery::onvif_probe(&format!("urn:uuid:{}", uuid::Uuid::new_v4()));
    if socket
        .send_to(probe.as_bytes(), "239.255.255.250:3702")
        .await
        .is_err()
    {
        return Vec::new();
    }

    let mut urls = Vec::new();
    let mut buf = vec![0u8; 8192];
    let deadline = tokio::time::Instant::now() + wait;
    while let Ok(Ok((len, _))) = timeout(
        deadline.saturating_duration_since(tokio::time::Instant::now()),
        socket.recv_from(&mut buf),
    )
    .await
    {
        let xml = String::from_utf8_lossy(&buf[..len]);
        for url in discovery::parse_onvif_addresses(&xml) {
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
    }
    urls
}

/// Run both discovery methods and merge them by address.
///
/// ONVIF replies are folded into the swept candidates rather than listed
/// separately, so one physical camera appears once however it was found.
///
/// Multicast is not confined to the range being swept — every ONVIF device
/// on the link answers, including ones on other subnets. Replies from
/// outside the requested range are dropped: asking to scan one network and
/// being handed a device from another is a surprise, and it makes the same
/// scan return different things depending on what happened to be listening.
pub async fn discover(cidr: &str, onvif_wait: Duration) -> Result<Vec<Candidate>, DiscoveryError> {
    let in_range: std::collections::HashSet<String> =
        discovery::expand_cidr(cidr)?.into_iter().collect();
    let (swept, onvif) = tokio::join!(sweep(cidr), onvif_discover(onvif_wait));
    let mut candidates = swept?;

    for url in onvif {
        let Some(host) = discovery::host_of(&url) else {
            continue;
        };
        if !in_range.contains(&host) {
            continue;
        }
        match candidates.iter_mut().find(|c| c.address == host) {
            Some(existing) => {
                existing.onvif_url = Some(url);
                "onvif".clone_into(&mut existing.hint);
            }
            None => candidates.push(Candidate {
                address: host,
                open_ports: Vec::new(),
                hint: "onvif".to_owned(),
                onvif_url: Some(url),
            }),
        }
    }

    candidates.sort_by(|a, b| a.address.cmp(&b.address));
    Ok(candidates)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn a_bad_range_is_refused_before_any_socket_is_opened() {
        assert!(sweep("not-a-cidr").await.is_err());
        assert!(sweep("10.0.0.0/8").await.is_err());
    }

    #[tokio::test]
    async fn finds_a_listener_on_a_camera_port() {
        // 8080 is in CAMERA_PORTS, so a local listener must be discovered.
        let listener = TcpListener::bind("127.0.0.1:8080").await;
        let Ok(listener) = listener else {
            return; // port already busy on this machine; nothing to assert
        };
        let open = open_ports("127.0.0.1").await;
        drop(listener);
        assert!(open.contains(&8080), "expected 8080 in {open:?}");
    }

    #[tokio::test]
    async fn a_host_with_nothing_listening_yields_no_candidate() {
        // .0 of a /30 is the network address; nothing answers there.
        let found = sweep("203.0.113.0/30").await.unwrap();
        assert!(found.is_empty(), "unexpected {found:?}");
    }

    #[tokio::test]
    async fn a_scan_never_reports_a_device_outside_the_requested_range() {
        // Multicast reaches every ONVIF device on the link. Without a range
        // filter, scanning reserved documentation space returns whatever
        // camera happens to be on the developer's own LAN — which is how
        // this was found.
        let found = discover("203.0.113.0/30", Duration::from_millis(400))
            .await
            .unwrap();
        assert!(
            found.is_empty(),
            "nothing in 203.0.113.0/30 can answer, got {found:?}"
        );
    }

    #[tokio::test]
    async fn onvif_discovery_survives_a_network_without_multicast() {
        let urls = onvif_discover(Duration::from_millis(150)).await;
        // Either replies or silence — both are acceptable; it must not hang
        // or panic, which is what this asserts by returning at all.
        assert!(urls.len() < 1000);
    }
}
