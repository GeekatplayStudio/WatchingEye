//! Offline `SQLite` buffer for gate-open outcomes (ROADMAP 3.2).
//!
//! Survives process restart. Hub drain lives in [`crate::sync`]. No frames,
//! identity, or AI — only trigger metadata.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS pending_events (
    id          TEXT PRIMARY KEY,
    camera_id   TEXT NOT NULL,
    frame       INTEGER NOT NULL,
    track_id    INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'gate_open',
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    synced_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_unsynced
  ON pending_events (synced_at, created_at);
";

const MAX_PENDING: usize = 10_000;

/// Cache IO / `SQLite` failures.
#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    /// Underlying `SQLite` error.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Directory or file IO failed.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// One buffered gate-open event awaiting hub ACK.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingEvent {
    /// Idempotent id (`{node}-{frame}-{track}`).
    pub id: String,
    /// Operator-facing camera / node id.
    pub camera_id: String,
    /// Pipeline frame counter.
    pub frame: u64,
    /// Local track id at trigger.
    pub track_id: u32,
    /// Event kind (`gate_open`).
    pub kind: String,
    /// JSON payload (bbox, motion, …).
    pub payload: String,
    /// UTC ISO create time.
    pub created_at: String,
}

/// `SQLite`-backed pending-event store.
pub struct EventCache {
    conn: Mutex<Connection>,
}

impl EventCache {
    /// `$EDGE_CACHE_DB`, or `data/edge-cache.sqlite`.
    #[must_use]
    pub fn default_path() -> PathBuf {
        std::env::var("EDGE_CACHE_DB")
            .map_or_else(|_| PathBuf::from("data/edge-cache.sqlite"), PathBuf::from)
    }

    /// Open (creating parent dirs) and migrate.
    ///
    /// # Errors
    /// IO or `SQLite` failures.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CacheError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        Self::from_connection(Connection::open(path)?)
    }

    /// In-memory DB for tests / fatal disk fallback.
    ///
    /// # Errors
    /// `SQLite` allocation failure.
    pub fn open_in_memory() -> Result<Self, CacheError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self, CacheError> {
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.conn.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        }
    }

    fn migrate(&self) -> Result<(), CacheError> {
        let conn = self.lock();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.execute_batch("PRAGMA user_version = 1")?;
        }
        Ok(())
    }

    /// Append one pending event (idempotent on `id`).
    ///
    /// # Errors
    /// `SQLite` write failure.
    pub fn append(&self, event: &PendingEvent) -> Result<(), CacheError> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO pending_events
               (id, camera_id, frame, track_id, kind, payload, created_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
             ON CONFLICT(id) DO NOTHING",
            params![
                event.id,
                event.camera_id,
                i64::try_from(event.frame).unwrap_or(i64::MAX),
                i64::from(event.track_id),
                event.kind,
                event.payload,
                event.created_at,
            ],
        )?;
        Self::trim_locked(&conn)?;
        Ok(())
    }

    fn trim_locked(conn: &Connection) -> Result<(), CacheError> {
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM pending_events WHERE synced_at IS NULL", [], |r| {
                r.get(0)
            })?;
        let max = i64::try_from(MAX_PENDING).unwrap_or(i64::MAX);
        if count > max {
            let drop_n = count - max;
            conn.execute(
                "DELETE FROM pending_events WHERE id IN (
                   SELECT id FROM pending_events
                   WHERE synced_at IS NULL
                   ORDER BY created_at ASC
                   LIMIT ?1
                 )",
                params![drop_n],
            )?;
        }
        Ok(())
    }

    /// Unsynced events, oldest first.
    ///
    /// # Errors
    /// `SQLite` read failure.
    pub fn list_pending(&self, limit: usize) -> Result<Vec<PendingEvent>, CacheError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, camera_id, frame, track_id, kind, payload, created_at
             FROM pending_events
             WHERE synced_at IS NULL
             ORDER BY created_at ASC
             LIMIT ?1",
        )?;
        let lim = i64::try_from(limit).unwrap_or(i64::MAX);
        let rows = stmt.query_map(params![lim], |row| {
            Ok(PendingEvent {
                id: row.get(0)?,
                camera_id: row.get(1)?,
                frame: u64::try_from(row.get::<_, i64>(2)?).unwrap_or(0),
                track_id: u32::try_from(row.get::<_, i64>(3)?).unwrap_or(0),
                kind: row.get(4)?,
                payload: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Mark ids as synced (or delete them).
    ///
    /// # Errors
    /// `SQLite` write failure.
    pub fn mark_synced(&self, ids: &[String], synced_at: &str) -> Result<(), CacheError> {
        let conn = self.lock();
        for id in ids {
            conn.execute(
                "UPDATE pending_events SET synced_at = ?1 WHERE id = ?2",
                params![synced_at, id],
            )?;
            // Drop ACK'd rows to keep the Pi disk small.
            conn.execute("DELETE FROM pending_events WHERE id = ?1", params![id])?;
        }
        Ok(())
    }

    /// Count of unsynced rows.
    ///
    /// # Errors
    /// `SQLite` read failure.
    pub fn pending_count(&self) -> Result<usize, CacheError> {
        let conn = self.lock();
        let n: i64 =
            conn.query_row("SELECT COUNT(*) FROM pending_events WHERE synced_at IS NULL", [], |r| {
                r.get(0)
            })?;
        Ok(usize::try_from(n).unwrap_or(0))
    }

    /// Look up one row by id (tests / debugging).
    ///
    /// # Errors
    /// `SQLite` read failure.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn get(&self, id: &str) -> Result<Option<PendingEvent>, CacheError> {
        let conn = self.lock();
        let row = conn
            .query_row(
                "SELECT id, camera_id, frame, track_id, kind, payload, created_at
                 FROM pending_events WHERE id = ?1",
                params![id],
                |row| {
                    Ok(PendingEvent {
                        id: row.get(0)?,
                        camera_id: row.get(1)?,
                        frame: u64::try_from(row.get::<_, i64>(2)?).unwrap_or(0),
                        track_id: u32::try_from(row.get::<_, i64>(3)?).unwrap_or(0),
                        kind: row.get(4)?,
                        payload: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    fn sample(id: &str) -> PendingEvent {
        PendingEvent {
            id: id.into(),
            camera_id: "edge-1".into(),
            frame: 10,
            track_id: 3,
            kind: "gate_open".into(),
            payload: r#"{"seen_frames":3}"#.into(),
            created_at: "2026-08-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn append_list_mark_round_trip() {
        let cache = EventCache::open_in_memory().unwrap();
        cache.append(&sample("a")).unwrap();
        cache.append(&sample("a")).unwrap(); // idempotent
        assert_eq!(cache.pending_count().unwrap(), 1);
        let pending = cache.list_pending(10).unwrap();
        assert_eq!(pending[0].id, "a");
        cache.mark_synced(&["a".into()], "2026-08-01T00:01:00Z").unwrap();
        assert_eq!(cache.pending_count().unwrap(), 0);
        assert!(cache.get("a").unwrap().is_none());
    }

    #[test]
    fn survives_reopen_on_disk() {
        let dir = std::env::temp_dir().join(format!("edge-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cache.sqlite");
        {
            let cache = EventCache::open(&path).unwrap();
            cache.append(&sample("persist-1")).unwrap();
        }
        let cache = EventCache::open(&path).unwrap();
        assert_eq!(cache.pending_count().unwrap(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
