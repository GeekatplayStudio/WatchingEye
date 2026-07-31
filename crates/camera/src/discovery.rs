//! Finding cameras on a local network.
//!
//! Two complementary methods, because neither alone is enough:
//!
//! - **WS-Discovery** (ONVIF): one multicast probe, devices answer with
//!   their service address. Fast and vendor-neutral, but many consumer
//!   cameras ship with ONVIF disabled.
//! - **Port sweep**: connect to the handful of ports cameras listen on
//!   across a subnet. Finds devices that WS-Discovery misses, at the cost of
//!   touching every address.
//!
//! As in [`crate::reolink`], everything here is pure: address enumeration,
//! probe construction, and response parsing. Sockets belong to the service
//! layer, so this stays testable and this crate stays dependency-light.

use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use thiserror::Error;

/// Why a subnet could not be enumerated.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum DiscoveryError {
    /// The CIDR string was not `a.b.c.d/len`.
    #[error("'{0}' is not a CIDR range like 192.168.1.0/24")]
    BadCidr(String),
    /// The range would expand to more addresses than we will sweep.
    #[error("/{prefix} covers {hosts} addresses; {max} is the limit")]
    TooLarge {
        /// The prefix length that was asked for.
        prefix: u8,
        /// How many host addresses that implies.
        hosts: u64,
        /// The configured ceiling.
        max: u64,
    },
}

/// Most hosts one sweep will enumerate.
///
/// A /22 home network is ~1000 addresses, which is a reasonable sweep. A /8
/// is 16 million and is certainly a typo, so it is refused rather than
/// quietly started.
pub const MAX_SWEEP_HOSTS: u64 = 4096;

/// Ports worth knocking on, with what a hit suggests.
///
/// Ordered by how strongly the port implies a camera, so a device answering
/// on several is labelled by the most specific one.
pub const CAMERA_PORTS: &[(u16, &str)] = &[
    (554, "rtsp"),
    (8000, "reolink-media"),
    (2020, "onvif"),
    (8899, "onvif"),
    (80, "http"),
    (443, "https"),
    (8080, "http-alt"),
];

/// A device found on the network, before it is confirmed to be a camera.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candidate {
    /// Address that answered.
    pub address: String,
    /// Ports that accepted a connection.
    pub open_ports: Vec<u16>,
    /// Best guess at what it is, from ports and any ONVIF reply.
    pub hint: String,
    /// ONVIF service URL, when WS-Discovery supplied one.
    pub onvif_url: Option<String>,
}

/// Expand a CIDR range into the host addresses a sweep should probe.
///
/// Network and broadcast addresses are excluded — nothing listens there, and
/// probing the broadcast address is a good way to annoy a network.
///
/// # Errors
/// [`DiscoveryError`] when the range is unparseable or larger than
/// [`MAX_SWEEP_HOSTS`].
///
/// @example
/// ```
/// let hosts = camera::discovery::expand_cidr("192.168.1.0/30").unwrap();
/// assert_eq!(hosts, vec!["192.168.1.1", "192.168.1.2"]);
/// ```
pub fn expand_cidr(cidr: &str) -> Result<Vec<String>, DiscoveryError> {
    let bad = || DiscoveryError::BadCidr(cidr.to_owned());
    let (addr, prefix) = cidr.split_once('/').ok_or_else(bad)?;
    let base: Ipv4Addr = addr.parse().map_err(|_| bad())?;
    let prefix: u8 = prefix.parse().map_err(|_| bad())?;
    if prefix > 32 {
        return Err(bad());
    }

    let host_bits = 32 - u32::from(prefix);
    let total = 1u64 << host_bits;
    // /31 and /32 have no usable host range in this model; treat the single
    // address as the target rather than returning nothing.
    if total <= 2 {
        return Ok(vec![base.to_string()]);
    }
    let usable = total - 2;
    if usable > MAX_SWEEP_HOSTS {
        return Err(DiscoveryError::TooLarge {
            prefix,
            hosts: usable,
            max: MAX_SWEEP_HOSTS,
        });
    }

    let mask = u32::MAX.checked_shl(host_bits).unwrap_or(0);
    let network = u32::from(base) & mask;
    Ok((1..=usable)
        .map(|i| {
            #[allow(clippy::cast_possible_truncation)]
            Ipv4Addr::from(network + i as u32).to_string()
        })
        .collect())
}

/// The CIDR range an interface address and mask describe.
///
/// @example
/// ```
/// let net = camera::discovery::subnet_of("10.20.6.54", "255.255.252.0").unwrap();
/// assert_eq!(net, "10.20.4.0/22");
/// ```
#[must_use]
pub fn subnet_of(address: &str, netmask: &str) -> Option<String> {
    let addr: Ipv4Addr = address.parse().ok()?;
    let mask: Ipv4Addr = netmask.parse().ok()?;
    let prefix = u32::from(mask).count_ones();
    // A mask must be contiguous ones followed by zeros; anything else is not
    // a netmask and would give a nonsense network address.
    if u32::from(mask).leading_ones() != prefix {
        return None;
    }
    let network = Ipv4Addr::from(u32::from(addr) & u32::from(mask));
    Some(format!("{network}/{prefix}"))
}

/// A WS-Discovery `Probe` for ONVIF devices, to be sent to 239.255.255.250:3702.
///
/// `message_id` must be a fresh UUID per probe; it is echoed in replies so
/// they can be matched to the request. It is a parameter rather than
/// generated here so the output stays deterministic and testable.
///
/// @example
/// ```
/// let xml = camera::discovery::onvif_probe("urn:uuid:1234");
/// assert!(xml.contains("urn:uuid:1234"));
/// ```
#[must_use]
pub fn onvif_probe(message_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
 xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header>
<w:MessageID>{message_id}</w:MessageID>
<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
</e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
</e:Envelope>"#
    )
}

/// Pull the service addresses out of a WS-Discovery `ProbeMatches` reply.
///
/// Devices list one or more space-separated URLs in `XAddrs`. Only HTTP(S)
/// ones are useful to us; some devices also advertise `uuid:` entries.
///
/// @example
/// ```
/// let xml = "<d:XAddrs>http://192.168.1.9/onvif/device_service</d:XAddrs>";
/// let urls = camera::discovery::parse_onvif_addresses(xml);
/// assert_eq!(urls, vec!["http://192.168.1.9/onvif/device_service"]);
/// ```
#[must_use]
pub fn parse_onvif_addresses(xml: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = xml;
    // Namespace prefixes vary by vendor, so match on the local name.
    while let Some(open) = rest.find("XAddrs>") {
        let after = &rest[open + "XAddrs>".len()..];
        let Some(close) = after.find("</") else { break };
        for url in after[..close].split_whitespace() {
            if url.starts_with("http://") || url.starts_with("https://") {
                found.push(url.to_owned());
            }
        }
        rest = &after[close..];
    }
    found
}

/// The host part of an ONVIF service URL.
#[must_use]
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split('/').next()?;
    let host = authority.rsplit_once(':').map_or(authority, |(h, _)| h);
    if host.is_empty() {
        None
    } else {
        Some(host.to_owned())
    }
}

/// Describe a device from the ports that answered.
///
/// This is a hint for the operator, not a claim: only a successful protocol
/// handshake proves what a device is, which is why the result is a label and
/// never a decision.
///
/// @example
/// ```
/// assert_eq!(camera::discovery::classify(&[554, 80]), "rtsp");
/// ```
#[must_use]
pub fn classify(open_ports: &[u16]) -> String {
    for (port, label) in CAMERA_PORTS {
        if open_ports.contains(port) {
            return (*label).to_owned();
        }
    }
    "unknown".to_owned()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn expands_a_small_range_without_network_or_broadcast() {
        let hosts = expand_cidr("192.168.1.0/29").unwrap();
        assert_eq!(hosts.len(), 6);
        assert_eq!(hosts.first().unwrap(), "192.168.1.1");
        assert_eq!(hosts.last().unwrap(), "192.168.1.6");
    }

    #[test]
    fn normalises_a_host_address_to_its_network() {
        // Operators type their own address, not the network address.
        let hosts = expand_cidr("192.168.1.54/24").unwrap();
        assert_eq!(hosts.first().unwrap(), "192.168.1.1");
    }

    #[test]
    fn a_single_address_is_probed_as_itself() {
        assert_eq!(expand_cidr("10.0.0.7/32").unwrap(), vec!["10.0.0.7"]);
    }

    #[test]
    fn refuses_a_range_too_large_to_sweep() {
        // A /8 is 16 million addresses — always a typo, never an intent.
        assert!(matches!(
            expand_cidr("10.0.0.0/8"),
            Err(DiscoveryError::TooLarge { .. })
        ));
    }

    #[test]
    fn a_slash_22_home_network_is_allowed() {
        assert_eq!(expand_cidr("10.20.4.0/22").unwrap().len(), 1022);
    }

    #[test]
    fn rejects_malformed_ranges() {
        for bad in ["192.168.1.0", "not/an/ip", "192.168.1.0/33", "999.1.1.1/24"] {
            assert!(expand_cidr(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn derives_the_subnet_from_an_interface_address() {
        assert_eq!(
            subnet_of("10.20.6.54", "255.255.252.0").unwrap(),
            "10.20.4.0/22"
        );
        assert_eq!(
            subnet_of("10.1.2.3", "255.255.255.0").unwrap(),
            "10.1.2.0/24"
        );
    }

    #[test]
    fn rejects_a_non_contiguous_mask() {
        assert!(subnet_of("10.0.0.1", "255.0.255.0").is_none());
    }

    #[test]
    fn the_probe_carries_the_message_id_and_asks_for_video_transmitters() {
        let xml = onvif_probe("urn:uuid:abc");
        assert!(xml.contains("urn:uuid:abc"));
        assert!(xml.contains("NetworkVideoTransmitter"));
    }

    #[test]
    fn reads_service_urls_from_a_probe_match() {
        let xml = r"<e:Envelope><e:Body><d:ProbeMatches><d:ProbeMatch>
            <d:XAddrs>http://192.168.1.9/onvif/device_service http://10.0.0.9/onvif</d:XAddrs>
            </d:ProbeMatch></d:ProbeMatches></e:Body></e:Envelope>";
        let urls = parse_onvif_addresses(xml);
        assert_eq!(urls.len(), 2);
        assert!(urls[0].contains("192.168.1.9"));
    }

    #[test]
    fn ignores_non_http_advertisements() {
        let xml = "<XAddrs>uuid:1234-5678 http://10.0.0.2/onvif</XAddrs>";
        assert_eq!(parse_onvif_addresses(xml), vec!["http://10.0.0.2/onvif"]);
    }

    #[test]
    fn survives_a_truncated_reply() {
        assert!(parse_onvif_addresses("<XAddrs>http://10.0.0.2/onvif").is_empty());
        assert!(parse_onvif_addresses("").is_empty());
    }

    #[test]
    fn extracts_hosts_from_service_urls() {
        assert_eq!(host_of("http://192.168.1.9/onvif").unwrap(), "192.168.1.9");
        assert_eq!(
            host_of("http://192.168.1.9:8000/onvif").unwrap(),
            "192.168.1.9"
        );
        assert_eq!(host_of("192.168.1.9").unwrap(), "192.168.1.9");
    }

    #[test]
    fn classifies_by_the_most_specific_port() {
        assert_eq!(classify(&[80, 554]), "rtsp");
        assert_eq!(classify(&[80, 8000]), "reolink-media");
        assert_eq!(classify(&[80]), "http");
        assert_eq!(classify(&[]), "unknown");
    }
}
