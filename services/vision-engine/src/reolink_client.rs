//! HTTP transport for the Reolink protocol in [`camera::reolink`].
//!
//! Everything about *what* to send and *how to read the reply* lives in the
//! camera crate; this file only moves bytes. Keeping the split means the
//! protocol is tested without hardware and this stays small enough to audit.

use camera::reolink::{self, ChannelInfo, DeviceInfo, ReolinkError, ReolinkHost, Stream, Token};
use camera::CameraInfo;
use serde::Serialize;
use std::time::Duration;

/// Anything that can go wrong reaching a Reolink device.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The device could not be reached.
    #[error("cannot reach {host}: {source}")]
    Transport {
        /// Address that was tried.
        host: String,
        /// Underlying transport failure.
        source: reqwest::Error,
    },
    /// The device answered but the protocol layer refused the reply.
    #[error(transparent)]
    Protocol(#[from] ReolinkError),
}

/// What one device turned out to be, and the cameras behind it.
#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    /// Device model, name, firmware, channel count.
    pub device: DeviceInfo,
    /// Channels reported by the device. One entry for a standalone camera.
    pub channels: Vec<ChannelInfo>,
    /// Pipeline camera records, one per channel.
    pub cameras: Vec<CameraInfo>,
    /// RTSP sub-stream URL per channel, ready for a decoder.
    pub rtsp_urls: Vec<String>,
}

/// A logged-in session against one device.
pub struct ReolinkClient {
    host: ReolinkHost,
    http: reqwest::Client,
    token: Token,
}

impl ReolinkClient {
    /// Log in and hold the session token.
    ///
    /// # Errors
    /// [`ClientError`] when the device is unreachable or refuses the
    /// credentials.
    pub async fn login(host: ReolinkHost, user: &str, password: &str) -> Result<Self, ClientError> {
        // These are LAN devices that ship self-signed certificates; refusing
        // them would make HTTPS-only cameras unusable. The credential still
        // authenticates the device, and the traffic never leaves the subnet.
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|source| ClientError::Transport {
                host: host.host.clone(),
                source,
            })?;

        let body = reolink::login_body(user, password);
        let text = post(&http, &host.api_url("Login", None), body, &host.host).await?;
        let token = reolink::parse_login(&text)?;
        Ok(Self { host, http, token })
    }

    /// Ask the device what it is and which cameras it fronts.
    ///
    /// An NVR is asked for its channel list; a standalone camera reports a
    /// single synthetic channel, so callers see one shape either way.
    ///
    /// # Errors
    /// [`ClientError`] when a command fails.
    pub async fn probe(&self, user: &str, password: &str) -> Result<ProbeResult, ClientError> {
        let text = self.command("GetDevInfo").await?;
        let device = reolink::parse_dev_info(&text)?;

        let channels = if device.channels > 1 {
            let text = self.command("GetChannelstatus").await?;
            reolink::parse_channel_status(&text)?
        } else {
            vec![ChannelInfo {
                channel: 0,
                name: device.name.clone(),
                online: true,
                model: device.model.clone(),
            }]
        };

        let cameras = reolink::as_cameras(&self.host, &device, &channels);
        // The sub stream is the detection path's default: full resolution is
        // wasted on a motion grid and costs bandwidth per camera.
        let rtsp_urls = channels
            .iter()
            .map(|c| self.rtsp_url(user, password, c.channel, Stream::Sub))
            .collect();
        Ok(ProbeResult {
            device,
            channels,
            cameras,
            rtsp_urls,
        })
    }

    /// Fetch a JPEG still from one channel.
    ///
    /// # Errors
    /// [`ClientError::Transport`] when the still cannot be fetched.
    pub async fn snapshot(&self, channel: u8, stream: Stream) -> Result<Vec<u8>, ClientError> {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let url = self
            .host
            .snapshot_url(channel, &self.token.name, &nonce, stream);
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|source| self.transport(source))?;
        let bytes = res.bytes().await.map_err(|source| self.transport(source))?;
        Ok(bytes.to_vec())
    }

    /// The RTSP URL for a channel, for a decoder to consume.
    #[must_use]
    pub fn rtsp_url(&self, user: &str, password: &str, channel: u8, stream: Stream) -> String {
        self.host.rtsp_url(user, password, channel, stream)
    }

    /// Send a parameterless command with the held token.
    async fn command(&self, cmd: &str) -> Result<String, ClientError> {
        let url = self.host.api_url(cmd, Some(&self.token.name));
        post(&self.http, &url, reolink::simple_body(cmd), &self.host.host).await
    }

    fn transport(&self, source: reqwest::Error) -> ClientError {
        ClientError::Transport {
            host: self.host.host.clone(),
            source,
        }
    }
}

/// POST a JSON body and return the response text.
async fn post(
    http: &reqwest::Client,
    url: &str,
    body: String,
    host: &str,
) -> Result<String, ClientError> {
    let res = http
        .post(url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|source| ClientError::Transport {
            host: host.to_owned(),
            source,
        })?;
    res.text().await.map_err(|source| ClientError::Transport {
        host: host.to_owned(),
        source,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_unreachable_host_is_a_transport_error_not_a_protocol_one() {
        // 203.0.113.0/24 is reserved for documentation: nothing answers.
        let host = ReolinkHost {
            host: "203.0.113.7".into(),
            port: 9,
            rtsp_port: 554,
            https: false,
        };
        let result = ReolinkClient::login(host, "admin", "pw").await;
        let Err(err) = result else {
            panic!("a reserved-range address must not answer");
        };
        assert!(matches!(err, ClientError::Transport { .. }), "got {err:?}");
    }
}
