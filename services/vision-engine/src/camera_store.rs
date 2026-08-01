//! Durable per-camera RTSP config (ROADMAP Step 3.3).
//!
//! Matching stays in the live [`crate::rtsp`] task map; this store only
//! remembers which cameras were connected so a restart can re-spawn them.
//! Full RTSP URLs (including credentials) are stored on disk — protect
//! `data/cameras.sqlite` like any other secret file.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS cameras (
    camera_id    TEXT PRIMARY KEY,
    url          TEXT NOT NULL,
    url_redacted TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL
);
";

/// Persistence / IO failures for the camera store.
#[derive(Debug, thiserror::Error)]
pub enum CameraStoreError {
    /// Underlying SQLite error.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Directory or file IO failed.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// A stored column could not be parsed.
    #[error("corrupt row: {0}")]
    Corrupt(String),
}

/// One saved RTSP camera row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CameraRecord {
    /// Stable operator-facing id (also the engine `camera_id`).
    pub camera_id: String,
    /// Full RTSP URL used by ffmpeg (may include credentials).
    pub url: String,
    /// Credential-stripped URL safe for logs / status UI.
    pub url_redacted: String,
    /// When false, restore-on-boot skips this camera.
    pub enabled: bool,
    /// Last upsert time (UTC).
    pub updated_at: DateTime<Utc>,
}

/// SQLite-backed camera config store.
pub struct CameraStore {
    conn: Mutex<Connection>,
}

impl CameraStore {
    /// `$WATCHINGEYE_CAMERA_DB`, or `data/cameras.sqlite`.
    #[must_use]
    pub fn default_path() -> PathBuf {
        std::env::var("WATCHINGEYE_CAMERA_DB")
            .map_or_else(|_| PathBuf::from("data/cameras.sqlite"), PathBuf::from)
    }

    /// Open (creating parent dirs) and migrate.
    ///
    /// # Errors
    /// IO or SQLite failures.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CameraStoreError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        Self::from_connection(Connection::open(path)?)
    }

    /// Private in-memory DB for tests.
    ///
    /// # Errors
    /// SQLite allocation failure.
    pub fn open_in_memory() -> Result<Self, CameraStoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self, CameraStoreError> {
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

    fn migrate(&self) -> Result<(), CameraStoreError> {
        let conn = self.lock();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.execute_batch("PRAGMA user_version = 1")?;
        }
        Ok(())
    }

    /// Insert or replace a camera row.
    ///
    /// # Errors
    /// SQLite write failure.
    pub fn upsert(&self, record: &CameraRecord) -> Result<(), CameraStoreError> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO cameras (camera_id, url, url_redacted, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(camera_id) DO UPDATE SET
               url = excluded.url,
               url_redacted = excluded.url_redacted,
               enabled = excluded.enabled,
               updated_at = excluded.updated_at",
            params![
                record.camera_id,
                record.url,
                record.url_redacted,
                i64::from(record.enabled),
                record.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Remove a camera (disconnect).
    ///
    /// # Errors
    /// SQLite write failure.
    pub fn remove(&self, camera_id: &str) -> Result<(), CameraStoreError> {
        let conn = self.lock();
        conn.execute("DELETE FROM cameras WHERE camera_id = ?1", params![camera_id])?;
        Ok(())
    }

    /// Enabled cameras for restore-on-boot, newest first.
    ///
    /// # Errors
    /// SQLite read / corrupt row.
    pub fn list_enabled(&self) -> Result<Vec<CameraRecord>, CameraStoreError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT camera_id, url, url_redacted, enabled, updated_at
             FROM cameras WHERE enabled = 1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (camera_id, url, url_redacted, enabled, updated_at) = row?;
            let updated_at = DateTime::parse_from_rfc3339(&updated_at)
                .map_err(|e| CameraStoreError::Corrupt(e.to_string()))?
                .with_timezone(&Utc);
            out.push(CameraRecord {
                camera_id,
                url,
                url_redacted,
                enabled: enabled != 0,
                updated_at,
            });
        }
        Ok(out)
    }

    /// Look up one camera by id.
    ///
    /// # Errors
    /// SQLite / corrupt row.
    pub fn get(&self, camera_id: &str) -> Result<Option<CameraRecord>, CameraStoreError> {
        let conn = self.lock();
        let row = conn
            .query_row(
                "SELECT camera_id, url, url_redacted, enabled, updated_at
                 FROM cameras WHERE camera_id = ?1",
                params![camera_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        match row {
            None => Ok(None),
            Some((camera_id, url, url_redacted, enabled, updated_at)) => {
                let updated_at = DateTime::parse_from_rfc3339(&updated_at)
                    .map_err(|e| CameraStoreError::Corrupt(e.to_string()))?
                    .with_timezone(&Utc);
                Ok(Some(CameraRecord {
                    camera_id,
                    url,
                    url_redacted,
                    enabled: enabled != 0,
                    updated_at,
                }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    fn sample(id: &str, octet: u8) -> CameraRecord {
        CameraRecord {
            camera_id: id.into(),
            url: format!("rtsp://admin:secret@192.168.1.{octet}/h264"),
            url_redacted: format!("rtsp://192.168.1.{octet}/h264"),
            enabled: true,
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn upsert_get_remove_round_trip() {
        let store = CameraStore::open_in_memory().unwrap();
        let rec = sample("cam-1", 50);
        store.upsert(&rec).unwrap();
        let got = store.get("cam-1").unwrap().unwrap();
        assert_eq!(got.url, rec.url);
        assert_eq!(got.url_redacted, rec.url_redacted);
        store.remove("cam-1").unwrap();
        assert!(store.get("cam-1").unwrap().is_none());
    }

    #[test]
    fn list_enabled_skips_disabled() {
        let store = CameraStore::open_in_memory().unwrap();
        let mut a = sample("a", 1);
        let mut b = sample("b", 2);
        b.enabled = false;
        store.upsert(&a).unwrap();
        store.upsert(&b).unwrap();
        let enabled = store.list_enabled().unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].camera_id, "a");
        a.enabled = false;
        store.upsert(&a).unwrap();
        assert!(store.list_enabled().unwrap().is_empty());
    }
}
