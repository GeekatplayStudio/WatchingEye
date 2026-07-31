//! Reolink camera and NVR support: URL construction and response parsing.
//!
//! Reolink devices speak a JSON CGI protocol at `/cgi-bin/api.cgi`. Every
//! request is a POST carrying an array of commands; every response is an
//! array of results, each with its own `code`. A `code` of 0 is success —
//! **an HTTP 200 with a non-zero code is still a failure**, which is the
//! usual way integrations get this wrong.
//!
//! There is deliberately no I/O here. Building a URL and reading a reply are
//! pure functions, so they are exhaustively testable without a camera on the
//! desk; the service layer owns the socket. That also keeps this crate free
//! of an HTTP stack.
//!
//! An NVR multiplexes several cameras behind one address, addressed by
//! channel. Channels are **0-based in the JSON API and 1-based in RTSP
//! URLs** — a mismatch that silently returns the wrong camera's video, so
//! [`ReolinkHost::rtsp_url`] does the conversion in one place.

use crate::CameraInfo;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Reolink protocol failures, separate from transport failures.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ReolinkError {
    /// The device answered, but rejected the command.
    #[error("reolink command '{cmd}' failed with code {code}: {detail}")]
    Api {
        /// The command that was refused.
        cmd: String,
        /// Reolink's own error code.
        code: i64,
        /// Human-readable detail, when the device supplied one.
        detail: String,
    },
    /// The reply was not the shape the protocol promises.
    #[error("malformed reolink response: {0}")]
    Malformed(String),
    /// Credentials were refused.
    #[error("reolink login refused: {0}")]
    Auth(String),
}

/// Which encoded stream to pull from a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stream {
    /// Full resolution. Heavy; use for recording and snapshots.
    Main,
    /// Reduced resolution. What the detection pipeline should normally read.
    Sub,
}

impl Stream {
    /// The token Reolink uses for this stream in RTSP paths.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Sub => "sub",
        }
    }
}

/// A Reolink device: a single camera, or an NVR fronting many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReolinkHost {
    /// IP address or hostname.
    pub host: String,
    /// HTTP(S) port for the CGI API.
    pub port: u16,
    /// RTSP port.
    pub rtsp_port: u16,
    /// Whether the API is served over TLS.
    pub https: bool,
}

impl ReolinkHost {
    /// A device on the default HTTP and RTSP ports.
    ///
    /// @example
    /// ```
    /// use camera::reolink::ReolinkHost;
    /// let h = ReolinkHost::new("192.168.1.20");
    /// assert_eq!(h.port, 80);
    /// ```
    #[must_use]
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port: 80,
            rtsp_port: 554,
            https: false,
        }
    }

    /// Scheme and authority, without a trailing slash.
    #[must_use]
    pub fn base_url(&self) -> String {
        let scheme = if self.https { "https" } else { "http" };
        format!("{scheme}://{}:{}", self.host, self.port)
    }

    /// URL for a JSON command, with the session token when one is held.
    #[must_use]
    pub fn api_url(&self, cmd: &str, token: Option<&str>) -> String {
        match token {
            Some(t) => format!("{}/cgi-bin/api.cgi?cmd={cmd}&token={t}", self.base_url()),
            None => format!("{}/cgi-bin/api.cgi?cmd={cmd}", self.base_url()),
        }
    }

    /// URL for a JPEG still from one channel.
    ///
    /// `nonce` defeats caching — repeated snapshots with an identical URL are
    /// served stale by some firmware, which looks exactly like a frozen camera.
    #[must_use]
    pub fn snapshot_url(&self, channel: u8, token: &str, nonce: &str, stream: Stream) -> String {
        format!(
            "{}/cgi-bin/api.cgi?cmd=Snap&channel={channel}&snapType={}&rs={nonce}&token={token}",
            self.base_url(),
            stream.as_str()
        )
    }

    /// RTSP URL for one channel.
    ///
    /// Takes the **0-based API channel** and emits the 1-based, zero-padded
    /// index RTSP expects, so callers can use one numbering throughout.
    ///
    /// @example
    /// ```
    /// use camera::reolink::{ReolinkHost, Stream};
    /// let h = ReolinkHost::new("10.0.0.5");
    /// let url = h.rtsp_url("admin", "pw", 0, Stream::Sub);
    /// assert!(url.ends_with("/h264Preview_01_sub"));
    /// ```
    #[must_use]
    pub fn rtsp_url(&self, user: &str, password: &str, channel: u8, stream: Stream) -> String {
        format!(
            "rtsp://{user}:{password}@{}:{}/h264Preview_{:02}_{}",
            self.host,
            self.rtsp_port,
            channel.saturating_add(1),
            stream.as_str()
        )
    }
}

/// Body for a `Login` command.
///
/// @example
/// ```
/// let body = camera::reolink::login_body("admin", "secret");
/// assert!(body.contains("\"cmd\":\"Login\""));
/// ```
#[must_use]
pub fn login_body(user: &str, password: &str) -> String {
    let user = escape(user);
    let password = escape(password);
    format!(
        r#"[{{"cmd":"Login","action":0,"param":{{"User":{{"userName":"{user}","password":"{password}"}}}}}}]"#
    )
}

/// Body for a parameterless command such as `GetDevInfo`.
#[must_use]
pub fn simple_body(cmd: &str) -> String {
    format!(r#"[{{"cmd":"{}","action":0,"param":{{}}}}]"#, escape(cmd))
}

/// Escape the few characters that would break out of a JSON string literal.
fn escape(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('"', "\\\"")
}

/// A session token and how long the device promised to honour it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    /// Opaque token string.
    pub name: String,
    /// Lease in seconds. Renew before this elapses.
    pub lease_secs: u64,
}

/// What the device says it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceInfo {
    /// Model string, e.g. `"RLN8-410"` or `"RLC-810A"`.
    pub model: String,
    /// Operator-assigned name.
    pub name: String,
    /// Firmware version.
    pub firmware: String,
    /// Number of channels; 1 for a standalone camera.
    pub channels: u8,
}

/// One camera behind a device — the NVR case has many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelInfo {
    /// 0-based channel index as used by the JSON API.
    pub channel: u8,
    /// Operator-assigned channel name.
    pub name: String,
    /// Whether a camera is currently attached and reachable.
    pub online: bool,
    /// Model of the attached camera, when reported.
    pub model: String,
}

/// Pull the first result out of a Reolink response array, enforcing `code`.
///
/// # Errors
/// [`ReolinkError::Malformed`] if the envelope is not as documented, or
/// [`ReolinkError::Api`] when the device reports a non-zero code.
fn first_value(json: &str, cmd: &str) -> Result<serde_json::Value, ReolinkError> {
    let parsed: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| ReolinkError::Malformed(format!("not JSON: {e}")))?;
    let entry = parsed
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| ReolinkError::Malformed("expected a non-empty array".into()))?;

    let code = entry.get("code").and_then(serde_json::Value::as_i64);
    // A missing code is not "probably fine": without it there is no evidence
    // the command succeeded, so it is treated as malformed.
    let Some(code) = code else {
        return Err(ReolinkError::Malformed("response has no 'code'".into()));
    };
    if code != 0 {
        let detail = entry
            .get("error")
            .and_then(|e| e.get("detail"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("no detail")
            .to_owned();
        return Err(ReolinkError::Api {
            cmd: cmd.to_owned(),
            code,
            detail,
        });
    }
    entry
        .get("value")
        .cloned()
        .ok_or_else(|| ReolinkError::Malformed("successful response has no 'value'".into()))
}

/// Read a `Login` reply.
///
/// # Errors
/// [`ReolinkError::Auth`] when the device refuses the credentials.
pub fn parse_login(json: &str) -> Result<Token, ReolinkError> {
    let value = match first_value(json, "Login") {
        Ok(v) => v,
        // Bad credentials arrive as an ordinary API error; surfacing them as
        // `Auth` lets callers stop retrying rather than hammering the device.
        Err(ReolinkError::Api { detail, .. }) => return Err(ReolinkError::Auth(detail)),
        Err(other) => return Err(other),
    };
    let token = value
        .get("Token")
        .ok_or_else(|| ReolinkError::Malformed("login reply has no 'Token'".into()))?;
    let name = token
        .get("name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ReolinkError::Malformed("token has no 'name'".into()))?
        .to_owned();
    let lease_secs = token
        .get("leaseTime")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(3600);
    Ok(Token { name, lease_secs })
}

/// Read a `GetDevInfo` reply.
///
/// # Errors
/// [`ReolinkError`] when the device refuses the command or the shape is wrong.
pub fn parse_dev_info(json: &str) -> Result<DeviceInfo, ReolinkError> {
    let value = first_value(json, "GetDevInfo")?;
    let info = value
        .get("DevInfo")
        .ok_or_else(|| ReolinkError::Malformed("no 'DevInfo'".into()))?;
    let text = |k: &str| {
        info.get(k)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_owned()
    };
    #[allow(clippy::cast_possible_truncation)]
    let channels = info
        .get("channelNum")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1)
        .clamp(1, u64::from(u8::MAX)) as u8;
    Ok(DeviceInfo {
        model: text("model"),
        name: text("name"),
        firmware: text("firmVer"),
        channels,
    })
}

/// Read a `GetChannelstatus` reply.
///
/// # Errors
/// [`ReolinkError`] when the device refuses the command or the shape is wrong.
pub fn parse_channel_status(json: &str) -> Result<Vec<ChannelInfo>, ReolinkError> {
    let value = first_value(json, "GetChannelstatus")?;
    let status = value
        .get("status")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| ReolinkError::Malformed("no 'status' array".into()))?;

    #[allow(clippy::cast_possible_truncation)]
    let channels = status
        .iter()
        .map(|c| ChannelInfo {
            channel: c
                .get("channel")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                .min(u64::from(u8::MAX)) as u8,
            name: c
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_owned(),
            online: c
                .get("online")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                != 0,
            model: c
                .get("typeInfo")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_owned(),
        })
        .collect();
    Ok(channels)
}

/// Turn a device and its channels into the pipeline's camera records.
///
/// Offline channels are kept: an NVR slot that is unplugged today is still a
/// camera the operator configured, and silently dropping it would look like
/// the discovery had missed it.
///
/// @example
/// ```
/// use camera::reolink::{as_cameras, ChannelInfo, DeviceInfo, ReolinkHost};
/// let dev = DeviceInfo { model: "RLN8-410".into(), name: "NVR".into(),
///                        firmware: "1".into(), channels: 1 };
/// let ch = vec![ChannelInfo { channel: 0, name: "Gate".into(),
///                             online: true, model: "RLC-810A".into() }];
/// let cams = as_cameras(&ReolinkHost::new("10.0.0.5"), &dev, &ch);
/// assert_eq!(cams[0].id, "reolink-10.0.0.5-0");
/// ```
#[must_use]
pub fn as_cameras(
    host: &ReolinkHost,
    device: &DeviceInfo,
    channels: &[ChannelInfo],
) -> Vec<CameraInfo> {
    channels
        .iter()
        .map(|c| {
            let location = if c.name.is_empty() {
                format!("{} ch{}", device.name, c.channel)
            } else {
                c.name.clone()
            };
            CameraInfo {
                id: format!("reolink-{}-{}", host.host, c.channel),
                kind: "reolink".to_owned(),
                location,
            }
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn builds_api_urls_with_and_without_a_token() {
        let h = ReolinkHost::new("192.168.1.20");
        assert_eq!(
            h.api_url("GetDevInfo", None),
            "http://192.168.1.20:80/cgi-bin/api.cgi?cmd=GetDevInfo"
        );
        assert_eq!(
            h.api_url("GetDevInfo", Some("abc")),
            "http://192.168.1.20:80/cgi-bin/api.cgi?cmd=GetDevInfo&token=abc"
        );
    }

    #[test]
    fn https_hosts_use_the_tls_scheme() {
        let h = ReolinkHost {
            host: "cam".into(),
            port: 443,
            rtsp_port: 554,
            https: true,
        };
        assert!(h.base_url().starts_with("https://cam:443"));
    }

    #[test]
    fn rtsp_channels_are_one_based_and_padded() {
        // The API calls the first channel 0 and RTSP calls it 01; getting this
        // wrong returns a different camera's video, silently.
        let h = ReolinkHost::new("10.0.0.5");
        assert!(h
            .rtsp_url("u", "p", 0, Stream::Main)
            .ends_with("/h264Preview_01_main"));
        assert!(h
            .rtsp_url("u", "p", 7, Stream::Sub)
            .ends_with("/h264Preview_08_sub"));
    }

    #[test]
    fn snapshot_urls_carry_a_nonce() {
        let h = ReolinkHost::new("10.0.0.5");
        let url = h.snapshot_url(2, "tok", "xyz123", Stream::Sub);
        assert!(url.contains("cmd=Snap"));
        assert!(url.contains("channel=2"));
        assert!(url.contains("rs=xyz123"));
        assert!(url.contains("snapType=sub"));
    }

    #[test]
    fn credentials_with_quotes_do_not_break_the_json_body() {
        let body = login_body("ad\"min", "p\\ss");
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed[0]["param"]["User"]["userName"], "ad\"min");
        assert_eq!(parsed[0]["param"]["User"]["password"], "p\\ss");
    }

    #[test]
    fn reads_a_login_token() {
        let json =
            r#"[{"cmd":"Login","code":0,"value":{"Token":{"leaseTime":3600,"name":"tok"}}}]"#;
        let t = parse_login(json).unwrap();
        assert_eq!(t.name, "tok");
        assert_eq!(t.lease_secs, 3600);
    }

    #[test]
    fn a_refused_login_is_an_auth_error_not_a_generic_one() {
        let json = r#"[{"cmd":"Login","code":1,"error":{"detail":"login failed","rspCode":-7}}]"#;
        assert_eq!(
            parse_login(json),
            Err(ReolinkError::Auth("login failed".into()))
        );
    }

    #[test]
    fn a_non_zero_code_fails_even_though_the_transport_succeeded() {
        // The trap this protocol sets: HTTP 200 carrying a failure.
        let json = r#"[{"cmd":"GetDevInfo","code":1,"error":{"detail":"not supported"}}]"#;
        let err = parse_dev_info(json).unwrap_err();
        assert!(matches!(err, ReolinkError::Api { code: 1, .. }));
    }

    #[test]
    fn a_response_without_a_code_is_malformed() {
        let json = r#"[{"cmd":"GetDevInfo","value":{"DevInfo":{}}}]"#;
        assert!(matches!(
            parse_dev_info(json),
            Err(ReolinkError::Malformed(_))
        ));
    }

    #[test]
    fn rejects_junk_and_empty_envelopes() {
        assert!(parse_login("not json").is_err());
        assert!(parse_login("[]").is_err());
    }

    #[test]
    fn reads_device_info() {
        let json = r#"[{"cmd":"GetDevInfo","code":0,"value":{"DevInfo":{
            "model":"RLN8-410","name":"Home NVR","firmVer":"3.2.0","channelNum":8}}}]"#;
        let d = parse_dev_info(json).unwrap();
        assert_eq!(d.model, "RLN8-410");
        assert_eq!(d.channels, 8);
    }

    #[test]
    fn a_standalone_camera_reports_one_channel() {
        let json = r#"[{"cmd":"GetDevInfo","code":0,"value":{"DevInfo":{"model":"RLC-810A"}}}]"#;
        assert_eq!(parse_dev_info(json).unwrap().channels, 1);
    }

    #[test]
    fn reads_nvr_channels_including_offline_slots() {
        let json = r#"[{"cmd":"GetChannelstatus","code":0,"value":{"count":2,"status":[
            {"channel":0,"name":"Driveway","online":1,"typeInfo":"RLC-810A"},
            {"channel":1,"name":"Shed","online":0,"typeInfo":""}]}}]"#;
        let ch = parse_channel_status(json).unwrap();
        assert_eq!(ch.len(), 2);
        assert!(ch[0].online);
        assert!(
            !ch[1].online,
            "an unplugged slot is still a configured camera"
        );
    }

    #[test]
    fn channels_become_cameras_with_stable_ids() {
        let host = ReolinkHost::new("192.168.1.20");
        let dev = DeviceInfo {
            model: "RLN8-410".into(),
            name: "NVR".into(),
            firmware: "1".into(),
            channels: 2,
        };
        let ch = vec![
            ChannelInfo {
                channel: 0,
                name: "Driveway".into(),
                online: true,
                model: "RLC-810A".into(),
            },
            ChannelInfo {
                channel: 1,
                name: String::new(),
                online: false,
                model: String::new(),
            },
        ];
        let cams = as_cameras(&host, &dev, &ch);
        assert_eq!(cams[0].id, "reolink-192.168.1.20-0");
        assert_eq!(cams[0].location, "Driveway");
        assert_eq!(
            cams[1].location, "NVR ch1",
            "unnamed channels still read sensibly"
        );
    }
}
