//! Webhook notification delivery for rule actions.
//!
//! [`rules::evaluate`] stays pure and only returns [`Action`]s. This module
//! turns `Notify` into an HTTP POST; `LogOnly` is a no-op. Delivery never
//! runs inside the motion/track hot path — callers should
//! [`Notifier::dispatch_spawn`] so the frame handler can return immediately.
//!
//! # Configuration
//!
//! - `WATCHINGEYE_NOTIFY_WEBHOOK_URL` — URL for the `"default"` channel
//! - `WATCHINGEYE_NOTIFY_CHANNELS` — JSON object mapping channel name → URL
//!   (merged on top of the default URL when both are set)
//!
//! # Example
//!
//! ```ignore
//! let notifier = Notifier::from_env()?;
//! // Prefer dispatch_spawn from the HTTP handler so the motion path stays free.
//! ```

use chrono::{DateTime, Utc};
use reqwest::Client;
use rules::Action;
use schemas::{Evidence, ObjectClass, Provenance};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tracing::{info, warn};
use uuid::Uuid;

/// How long a webhook POST may take before it is abandoned.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

/// Failures configuring or delivering a notification.
#[derive(Debug, Error)]
pub enum NotifyError {
    /// A channel was requested but no URL is configured for it.
    #[error("no webhook URL configured for channel `{0}`")]
    UnknownChannel(String),
    /// `WATCHINGEYE_NOTIFY_CHANNELS` was set but was not valid JSON object.
    #[error("invalid WATCHINGEYE_NOTIFY_CHANNELS JSON: {0}")]
    BadChannelsJson(String),
    /// Building or sending the HTTP request failed.
    #[error("webhook request failed: {0}")]
    Http(#[from] reqwest::Error),
    /// The remote returned a non-success status.
    #[error("webhook returned HTTP {status} for channel `{channel}`")]
    BadStatus {
        /// Channel that was targeted.
        channel: String,
        /// HTTP status code from the remote.
        status: u16,
    },
}

/// JSON body posted to a notify webhook.
///
/// Carries the identifiers needed to reconstruct why the alert fired
/// (zero-black-box): event id, camera, class, kind, channel, plus optional
/// provenance and evidence when the caller has them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyPayload {
    /// Pipeline event id.
    pub event_id: Uuid,
    /// Tracked object id.
    pub object_id: Uuid,
    /// Camera that observed the event.
    pub camera_id: String,
    /// Object class at event time.
    pub class: ObjectClass,
    /// Event kind tag (e.g. `"entered_zone"`).
    pub kind: String,
    /// Notification channel the rule requested.
    pub channel: String,
    /// Zone name when the kind is zone-related.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// Event timestamp (UTC).
    pub timestamp: DateTime<Utc>,
    /// Where the decision came from, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    /// Enumerated evidence supporting the notify, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<Evidence>>,
}

/// Result of attempting to deliver one action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchResult {
    /// `LogOnly` — nothing was sent.
    Logged,
    /// HTTP POST completed with a success status.
    Sent {
        /// Channel that was used.
        channel: String,
        /// HTTP status code.
        status: u16,
    },
}

/// Resolves channel names to webhook URLs and POSTs [`NotifyPayload`] JSON.
#[derive(Debug, Clone)]
pub struct Notifier {
    channels: HashMap<String, String>,
    client: Client,
}

impl Notifier {
    /// Build a notifier from the process environment.
    ///
    /// # Errors
    /// Returns [`NotifyError::BadChannelsJson`] when
    /// `WATCHINGEYE_NOTIFY_CHANNELS` is present but not a JSON object of
    /// string→string. Returns [`NotifyError::Http`] if the reqwest client
    /// cannot be built.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let notifier = Notifier::from_env()?;
    /// assert!(notifier.has_channel("default") || true);
    /// ```
    pub fn from_env() -> Result<Self, NotifyError> {
        let mut channels = HashMap::new();
        if let Ok(url) = std::env::var("WATCHINGEYE_NOTIFY_WEBHOOK_URL") {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                channels.insert("default".to_owned(), trimmed.to_owned());
            }
        }
        if let Ok(raw) = std::env::var("WATCHINGEYE_NOTIFY_CHANNELS") {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                merge_channels_json(&mut channels, trimmed)?;
            }
        }
        Self::from_channels(channels)
    }

    /// Construct from an explicit channel→URL map (tests and DI).
    ///
    /// # Errors
    /// Returns [`NotifyError::Http`] if the HTTP client cannot be built.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use std::collections::HashMap;
    /// let n = Notifier::from_channels(HashMap::from([(
    ///     "default".into(),
    ///     "http://127.0.0.1:9/hook".into(),
    /// )]))?;
    /// assert!(n.has_channel("default"));
    /// ```
    pub fn from_channels(channels: HashMap<String, String>) -> Result<Self, NotifyError> {
        let client = Client::builder().timeout(DEFAULT_TIMEOUT).build()?;
        Ok(Self { channels, client })
    }

    /// True when a URL is registered for `channel`.
    #[must_use]
    #[cfg(test)]
    pub fn has_channel(&self, channel: &str) -> bool {
        self.channels.contains_key(channel)
    }

    /// Deliver one rule action. `LogOnly` returns immediately; `Notify`
    /// POSTs [`NotifyPayload`] as JSON.
    ///
    /// # Errors
    /// - [`NotifyError::UnknownChannel`] when the channel has no URL
    /// - [`NotifyError::Http`] on transport failure
    /// - [`NotifyError::BadStatus`] when the remote responds outside 2xx
    pub async fn dispatch(
        &self,
        action: &Action,
        payload: &NotifyPayload,
    ) -> Result<DispatchResult, NotifyError> {
        match action {
            Action::LogOnly => {
                info!(
                    event_id = %payload.event_id,
                    camera = %payload.camera_id,
                    kind = %payload.kind,
                    "rules action: LogOnly (no webhook)"
                );
                Ok(DispatchResult::Logged)
            }
            Action::Notify { channel } => self.post_notify(channel, payload).await,
        }
    }

    /// Spawn delivery on the current Tokio runtime so the caller is not
    /// blocked. Errors are logged; this never panics. If no runtime is
    /// available (e.g. a sync unit test), the action is logged and skipped.
    pub fn dispatch_spawn(self: &Arc<Self>, action: Action, payload: NotifyPayload) {
        let this = Arc::clone(self);
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            warn!(
                event_id = %payload.event_id,
                "no tokio runtime; skipping webhook dispatch"
            );
            return;
        };
        handle.spawn(async move {
            match this.dispatch(&action, &payload).await {
                Ok(DispatchResult::Logged) => {}
                Ok(DispatchResult::Sent { channel, status }) => {
                    info!(%channel, status, event_id = %payload.event_id, "webhook delivered");
                }
                Err(err) => {
                    warn!(%err, event_id = %payload.event_id, "webhook delivery failed");
                }
            }
        });
    }

    async fn post_notify(
        &self,
        channel: &str,
        payload: &NotifyPayload,
    ) -> Result<DispatchResult, NotifyError> {
        let url = self
            .channels
            .get(channel)
            .ok_or_else(|| NotifyError::UnknownChannel(channel.to_owned()))?;
        let response = self.client.post(url).json(payload).send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(NotifyError::BadStatus {
                channel: channel.to_owned(),
                status: status.as_u16(),
            });
        }
        Ok(DispatchResult::Sent {
            channel: channel.to_owned(),
            status: status.as_u16(),
        })
    }
}

fn merge_channels_json(
    channels: &mut HashMap<String, String>,
    raw: &str,
) -> Result<(), NotifyError> {
    let value: Value =
        serde_json::from_str(raw).map_err(|e| NotifyError::BadChannelsJson(e.to_string()))?;
    let obj = value
        .as_object()
        .ok_or_else(|| NotifyError::BadChannelsJson("expected a JSON object".into()))?;
    for (key, val) in obj {
        let url = val.as_str().ok_or_else(|| {
            NotifyError::BadChannelsJson(format!("channel `{key}` value must be a string"))
        })?;
        if !url.is_empty() {
            channels.insert(key.clone(), url.to_owned());
        }
    }
    Ok(())
}

/// Build a payload from a pipeline [`events::Event`] plus the notify channel.
///
/// Attaches deterministic provenance/evidence for rule-engine notifies so the
/// webhook is never a black box.
#[must_use]
pub fn payload_from_event(
    event: &events::Event,
    channel: &str,
    evidence: Vec<Evidence>,
) -> NotifyPayload {
    let (kind, zone) = match &event.kind {
        events::EventKind::EnteredZone { zone } => ("entered_zone".to_owned(), Some(zone.clone())),
        events::EventKind::ExitedZone { zone } => ("exited_zone".to_owned(), Some(zone.clone())),
        events::EventKind::Detected => ("detected".to_owned(), None),
        events::EventKind::Lost => ("lost".to_owned(), None),
        events::EventKind::Stopped => ("stopped".to_owned(), None),
        events::EventKind::Running => ("running".to_owned(), None),
        events::EventKind::VehicleParked => ("vehicle_parked".to_owned(), None),
        events::EventKind::ObjectRemoved => ("object_removed".to_owned(), None),
        events::EventKind::AnimalAppeared => ("animal_appeared".to_owned(), None),
        events::EventKind::UnknownObject => ("unknown_object".to_owned(), None),
    };
    NotifyPayload {
        event_id: event.id,
        object_id: event.object_id,
        camera_id: event.camera_id.clone(),
        class: event.class.clone(),
        kind,
        channel: channel.to_owned(),
        zone,
        timestamp: event.timestamp,
        provenance: Some(Provenance {
            model_version: "rules-engine".into(),
            prompt_version: "n/a".into(),
            input_images: Vec::new(),
            timestamp: event.timestamp,
        }),
        evidence: if evidence.is_empty() {
            None
        } else {
            Some(evidence)
        },
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
    use super::*;
    use axum::{routing::post, Json, Router};
    use events::{Event, EventKind};
    use schemas::ObjectClass;
    use std::sync::Mutex;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    #[test]
    fn from_channels_registers_default() {
        let n = Notifier::from_channels(HashMap::from([(
            "default".into(),
            "http://example.test/hook".into(),
        )]))
        .unwrap();
        assert!(n.has_channel("default"));
        assert!(!n.has_channel("missing"));
    }

    #[test]
    fn merge_channels_json_rejects_non_object() {
        let mut map = HashMap::new();
        let err = merge_channels_json(&mut map, "[1,2]").unwrap_err();
        assert!(matches!(err, NotifyError::BadChannelsJson(_)));
    }

    #[test]
    fn merge_channels_json_accepts_map() {
        let mut map = HashMap::new();
        merge_channels_json(&mut map, r#"{"ops":"http://x/y"}"#).unwrap();
        assert_eq!(map.get("ops").map(String::as_str), Some("http://x/y"));
    }

    #[test]
    fn log_only_skips_http_without_channel() {
        let n = Notifier::from_channels(HashMap::new()).unwrap();
        let event = Event::new(
            Uuid::new_v4(),
            ObjectClass::Person,
            EventKind::Detected,
            "cam-1",
        );
        let payload = payload_from_event(&event, "default", Vec::new());
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(n.dispatch(&Action::LogOnly, &payload)).unwrap();
        assert_eq!(result, DispatchResult::Logged);
    }

    #[tokio::test]
    async fn dispatch_posts_json_body_and_status() {
        let received: Arc<Mutex<Option<NotifyPayload>>> = Arc::new(Mutex::new(None));
        let slot = Arc::clone(&received);
        let (ready_tx, ready_rx) = oneshot::channel::<()>();
        let ready = Arc::new(Mutex::new(Some(ready_tx)));

        let app = Router::new().route(
            "/hook",
            post(move |Json(body): Json<NotifyPayload>| {
                let slot = Arc::clone(&slot);
                let ready = Arc::clone(&ready);
                async move {
                    *slot.lock().unwrap() = Some(body);
                    if let Some(tx) = ready.lock().unwrap().take() {
                        let _ = tx.send(());
                    }
                    axum::http::StatusCode::NO_CONTENT
                }
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let url = format!("http://{addr}/hook");
        let notifier = Notifier::from_channels(HashMap::from([("default".into(), url)])).unwrap();

        let event = Event::new(
            Uuid::new_v4(),
            ObjectClass::Unknown,
            EventKind::EnteredZone {
                zone: "garage".into(),
            },
            "cam-test",
        );
        let payload = payload_from_event(
            &event,
            "default",
            vec![Evidence {
                label: "entered_zone".into(),
                description: "Track centroid entered zone garage".into(),
            }],
        );

        let result = notifier
            .dispatch(
                &Action::Notify {
                    channel: "default".into(),
                },
                &payload,
            )
            .await
            .unwrap();
        assert_eq!(
            result,
            DispatchResult::Sent {
                channel: "default".into(),
                status: 204
            }
        );

        tokio::time::timeout(Duration::from_secs(2), ready_rx)
            .await
            .expect("timed out waiting for webhook")
            .unwrap();

        let got = received.lock().unwrap().clone().expect("body captured");
        assert_eq!(got.event_id, payload.event_id);
        assert_eq!(got.camera_id, "cam-test");
        assert_eq!(got.class, ObjectClass::Unknown);
        assert_eq!(got.kind, "entered_zone");
        assert_eq!(got.channel, "default");
        assert_eq!(got.zone.as_deref(), Some("garage"));
        assert!(got.provenance.is_some());
        assert_eq!(got.evidence.as_ref().map(Vec::len), Some(1));
    }

    #[tokio::test]
    async fn unknown_channel_errors_without_panic() {
        let n = Notifier::from_channels(HashMap::new()).unwrap();
        let event = Event::new(
            Uuid::new_v4(),
            ObjectClass::Person,
            EventKind::Detected,
            "cam-1",
        );
        let payload = payload_from_event(&event, "missing", Vec::new());
        let err = n
            .dispatch(
                &Action::Notify {
                    channel: "missing".into(),
                },
                &payload,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, NotifyError::UnknownChannel(_)));
    }
}
