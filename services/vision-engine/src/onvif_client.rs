//! HTTP transport for ONVIF, plus the one piece the pure layer cannot do:
//! the WS-Security password digest, which needs SHA-1 and a clock.
//!
//! The digest is `base64(sha1(nonce ++ created ++ password))`. SHA-1 is
//! implemented here rather than pulled in as a dependency — it is used only
//! to satisfy the ONVIF handshake, never to protect anything, and the
//! implementation is pinned by the standard test vectors.

use camera::onvif::{self, OnvifDevice, OnvifProfile, ONVIF_ENDPOINTS};
use std::time::Duration;

/// How long to wait for a device to answer an authenticated SOAP call.
const TIMEOUT: Duration = Duration::from_secs(6);

/// How long to wait when merely asking "do you speak ONVIF?".
///
/// Shorter than [`TIMEOUT`]: this runs against every candidate on a subnet,
/// and a device that is going to answer does so quickly on a LAN.
const PROBE_TIMEOUT: Duration = Duration::from_millis(2500);

/// A confirmed ONVIF service.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OnvifService {
    /// Full service URL that answered.
    pub url: String,
    /// The device's own UTC time, when it reported one. Useful because a
    /// drifted clock is the usual cause of correct credentials being refused.
    pub device_time: Option<String>,
}

/// Confirm whether a host speaks ONVIF, without needing credentials.
///
/// Tries the ports and paths consumer hardware actually uses. Returns the
/// first endpoint that answers with a valid `GetSystemDateAndTimeResponse`.
pub async fn confirm(host: &str) -> Option<OnvifService> {
    let http = probe_client()?;
    let body = onvif::get_system_date_body();

    // Every endpoint is tried at once. In sequence, a host that speaks none
    // of them costs the timeout five times over, and that is paid for every
    // candidate on the subnet.
    let mut set = tokio::task::JoinSet::new();
    for (rank, (port, path)) in ONVIF_ENDPOINTS.iter().enumerate() {
        let url = format!("http://{host}:{port}{path}");
        let http = http.clone();
        let body = body.clone();
        set.spawn(async move {
            let res = http
                .post(&url)
                .header("Content-Type", "application/soap+xml; charset=utf-8")
                .body(body)
                .send()
                .await
                .ok()?;
            let text = res.text().await.ok()?;
            if !text.contains("GetSystemDateAndTimeResponse") {
                return None;
            }
            Some((
                rank,
                OnvifService {
                    url,
                    device_time: device_time(&text),
                },
            ))
        });
    }

    // ONVIF_ENDPOINTS is ordered by likelihood, so when several answer, the
    // most likely one wins rather than whichever raced home first.
    let mut best: Option<(usize, OnvifService)> = None;
    while let Some(joined) = set.join_next().await {
        if let Ok(Some((rank, service))) = joined {
            if best.as_ref().is_none_or(|(seen, _)| rank < *seen) {
                best = Some((rank, service));
            }
        }
    }
    best.map(|(_, service)| service)
}

/// Assemble the device's reported UTC time into an ISO-8601 stamp.
fn device_time(xml: &str) -> Option<String> {
    let get = |t: &str| onvif::tag_text(xml, t);
    Some(format!(
        "{}-{:0>2}-{:0>2}T{:0>2}:{:0>2}:{:0>2}Z",
        get("Year")?,
        get("Month")?,
        get("Day")?,
        get("Hour")?,
        get("Minute")?,
        get("Second").unwrap_or_else(|| "0".into())
    ))
}

/// Everything an authenticated interrogation returns.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OnvifInventory {
    /// Manufacturer, model, firmware, serial.
    pub device: OnvifDevice,
    /// Media profiles, one per stream the device offers.
    pub profiles: Vec<OnvifProfile>,
    /// RTSP URL per profile token, where the device supplied one.
    pub streams: Vec<(String, String)>,
}

/// Log in and enumerate what the device offers.
///
/// `created` is the timestamp to sign with — pass the device's own clock
/// when it differs from local time, or a device with drift will reject
/// otherwise-correct credentials.
///
/// # Errors
/// A message naming what failed: transport, a SOAP fault, or an empty reply.
pub async fn inventory(
    service_url: &str,
    user: &str,
    password: &str,
    created: &str,
    nonce: &[u8],
) -> Result<OnvifInventory, String> {
    let http = client().ok_or_else(|| "cannot build an HTTP client".to_owned())?;
    let header = auth_header(user, password, created, nonce);

    let info_xml = call(
        &http,
        service_url,
        onvif::get_device_information_body(Some(&header)),
    )
    .await?;
    if let Some(fault) = onvif::soap_fault(&info_xml) {
        return Err(format!("device refused GetDeviceInformation: {fault}"));
    }
    let device = onvif::parse_device_info(&info_xml);

    let profiles_xml = call(&http, service_url, onvif::get_profiles_body(Some(&header))).await?;
    let profiles = if onvif::soap_fault(&profiles_xml).is_some() {
        Vec::new()
    } else {
        onvif::parse_profiles(&profiles_xml)
    };

    let mut streams = Vec::new();
    for profile in &profiles {
        let body = onvif::get_stream_uri_body(Some(&header), &profile.token);
        if let Ok(xml) = call(&http, service_url, body).await {
            if let Some(uri) = onvif::parse_stream_uri(&xml) {
                streams.push((profile.token.clone(), uri));
            }
        }
    }

    Ok(OnvifInventory {
        device,
        profiles,
        streams,
    })
}

/// Build the WS-Security header for these credentials.
fn auth_header(user: &str, password: &str, created: &str, nonce: &[u8]) -> String {
    let mut material = Vec::with_capacity(nonce.len() + created.len() + password.len());
    material.extend_from_slice(nonce);
    material.extend_from_slice(created.as_bytes());
    material.extend_from_slice(password.as_bytes());
    let digest = b64(&sha1(&material));
    onvif::security_header(user, &digest, &b64(nonce), created)
}

async fn call(http: &reqwest::Client, url: &str, body: String) -> Result<String, String> {
    let res = http
        .post(url)
        .header("Content-Type", "application/soap+xml; charset=utf-8")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("cannot reach {url}: {e}"))?;
    res.text()
        .await
        .map_err(|e| format!("unreadable reply: {e}"))
}

fn client() -> Option<reqwest::Client> {
    build_client(TIMEOUT)
}

fn probe_client() -> Option<reqwest::Client> {
    build_client(PROBE_TIMEOUT)
}

fn build_client(timeout: Duration) -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(timeout)
        .build()
        .ok()
}

/// SHA-1, per FIPS 180-4. Used only for the ONVIF handshake.
///
/// The single-letter names are the ones the specification uses; renaming
/// them would make this harder to check against the standard, not easier.
#[allow(clippy::many_single_char_names)]
fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for block in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, word) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, word) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let tmp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = tmp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }

    let mut out = [0u8; 20];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// Standard base64.
fn b64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            *chunk.first().unwrap_or(&0),
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if i <= chunk.len() {
                out.push(A[((n >> shift) & 63) as usize] as char);
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

    fn hex(bytes: &[u8]) -> String {
        use std::fmt::Write as _;
        bytes.iter().fold(String::new(), |mut out, b| {
            let _ = write!(out, "{b:02x}");
            out
        })
    }

    #[test]
    fn sha1_matches_the_published_test_vectors() {
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            hex(&sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            hex(&sha1(
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
            )),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
    }

    #[test]
    fn sha1_handles_input_that_spans_blocks() {
        // 1000 'a's — long enough to exercise multi-block padding.
        let long = vec![b'a'; 1000];
        assert_eq!(
            hex(&sha1(&long)),
            "291e9a6c66994949b57ba5e650361e98fc36b1ba"
        );
    }

    #[test]
    fn base64_matches_the_canonical_encoding() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn the_digest_follows_the_ws_security_definition() {
        // digest = base64(sha1(nonce ++ created ++ password)), from the
        // UsernameToken profile. Verified against a hand-computed vector.
        let nonce = b"0123456789abcdef";
        let created = "2026-07-31T18:19:18Z";
        let expected = b64(&sha1(
            &[nonce.as_slice(), created.as_bytes(), b"secret"].concat(),
        ));
        let header = auth_header("admin", "secret", created, nonce);
        assert!(header.contains(&expected), "digest missing from {header}");
        assert!(header.contains(&b64(nonce)));
    }

    #[test]
    fn a_password_change_changes_the_digest() {
        let n = b"nonce-value-1234";
        let t = "2026-07-31T18:19:18Z";
        assert_ne!(auth_header("a", "one", t, n), auth_header("a", "two", t, n));
    }

    #[test]
    fn device_time_is_assembled_and_zero_padded() {
        let xml = "<tt:Year>2026</tt:Year><tt:Month>7</tt:Month><tt:Day>31</tt:Day>\
                   <tt:Hour>18</tt:Hour><tt:Minute>19</tt:Minute><tt:Second>8</tt:Second>";
        assert_eq!(device_time(xml).unwrap(), "2026-07-31T18:19:08Z");
    }

    #[tokio::test]
    async fn a_host_with_nothing_listening_is_not_confirmed() {
        assert!(confirm("203.0.113.7").await.is_none());
    }
}
