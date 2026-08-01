//! Drain the offline cache to the hub (ROADMAP 3.2).
//!
//! AI-free: JSON POST only. Soft-fails when `EDGE_HUB_URL` is unset or the
//! hub is unreachable — pending rows stay for the next attempt.

use crate::cache::{EventCache, PendingEvent};
use chrono::Utc;
use serde::Deserialize;
use std::time::Duration;

/// Default batch size per flush.
const BATCH: usize = 32;

/// Hub ACK shape.
#[derive(Debug, Deserialize)]
struct SyncResponse {
    accepted: Vec<String>,
}

/// Sync / transport failures (never panic).
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// HTTP or IO failure talking to the hub.
    #[error("hub transport: {0}")]
    Transport(String),
    /// Hub returned a non-success status.
    #[error("hub status {0}")]
    Status(u16),
    /// Response JSON was unusable.
    #[error("hub response: {0}")]
    Response(String),
    /// Local cache error while marking synced.
    #[error(transparent)]
    Cache(#[from] crate::cache::CacheError),
}

/// POST pending rows to `{hub}/api/edge/sync`.
///
/// # Errors
/// Transport / status / cache mark failures. Empty pending is success.
pub fn flush(cache: &EventCache, hub_base: &str) -> Result<usize, SyncError> {
    let pending = cache.list_pending(BATCH)?;
    if pending.is_empty() {
        return Ok(0);
    }
    let url = format!("{}/api/edge/sync", hub_base.trim_end_matches('/'));
    let node_id = pending
        .first()
        .map_or("edge", |p| p.camera_id.as_str());
    let body = serde_json::json!({
        "nodeId": node_id,
        "events": pending.iter().map(event_json).collect::<Vec<_>>(),
    });
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(2))
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| SyncError::Transport(e.to_string()))?;
    let status = resp.status();
    if !(200..300).contains(&status) {
        return Err(SyncError::Status(status));
    }
    let parsed: SyncResponse = resp
        .into_json()
        .map_err(|e| SyncError::Response(e.to_string()))?;
    let now = Utc::now().to_rfc3339();
    cache.mark_synced(&parsed.accepted, &now)?;
    Ok(parsed.accepted.len())
}

fn event_json(p: &PendingEvent) -> serde_json::Value {
    let payload: serde_json::Value = match serde_json::from_str(&p.payload) {
        Ok(v) => v,
        Err(_) => serde_json::json!({}),
    };
    serde_json::json!({
        "id": p.id,
        "cameraId": p.camera_id,
        "frame": p.frame,
        "trackId": p.track_id,
        "kind": p.kind,
        "createdAt": p.created_at,
        "payload": payload,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::cache::PendingEvent;

    #[test]
    fn event_json_embeds_payload_object() {
        let p = PendingEvent {
            id: "e-1-2".into(),
            camera_id: "edge-1".into(),
            frame: 1,
            track_id: 2,
            kind: "gate_open".into(),
            payload: r#"{"seen_frames":3}"#.into(),
            created_at: "t".into(),
        };
        let v = event_json(&p);
        assert_eq!(v["payload"]["seen_frames"], 3);
        assert_eq!(v["trackId"], 2);
    }
}
