//! Durable identity persistence.
//!
//! Matching stays deterministic Rust in `crates/identity`; this module is a
//! thin SQLite-backed store so a restarted `vision-engine` can resume with
//! the identities it already knew about, instead of starting from a blank
//! [`identity::Registry`]. It never influences matching decisions — it only
//! saves and reloads what the registry already decided.

use chrono::{DateTime, Utc};
use identity::descriptor::Descriptor;
use identity::memory::AppearanceMemory;
use identity::{Identity, MemoryEntry};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

/// Schema for a brand new database. `user_version` doubles as the migration
/// marker `open` checks before deciding whether to run this.
const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS identities (
    id               TEXT PRIMARY KEY,
    name             TEXT,
    class            TEXT NOT NULL,
    descriptors_json TEXT NOT NULL,
    first_seen       TEXT NOT NULL,
    last_seen        TEXT NOT NULL,
    sightings        INTEGER NOT NULL,
    memory_json      TEXT NOT NULL,
    appearance_json  TEXT,
    status           TEXT NOT NULL
);
";

/// Everything that can go wrong persisting or reloading an identity.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The underlying `SQLite` call failed.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// A JSON column could not be encoded or decoded.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    /// Creating the database directory or file failed.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// A stored column did not parse back into its Rust type.
    #[error("corrupt row: {0}")]
    Corrupt(String),
}

/// SQLite-backed store for [`identity::Identity`] rows.
///
/// Holds one connection behind a mutex: `SQLite` serializes writes anyway, and
/// the identity registry itself is already behind its own lock, so there is
/// no concurrency to give up here.
pub struct IdentityStore {
    conn: Mutex<Connection>,
}

impl IdentityStore {
    /// Default database location: `$WATCHINGEYE_IDENTITY_DB`, or
    /// `data/identities.sqlite` under the current working directory.
    #[must_use]
    pub fn default_path() -> PathBuf {
        std::env::var("WATCHINGEYE_IDENTITY_DB")
            .map_or_else(|_| PathBuf::from("data/identities.sqlite"), PathBuf::from)
    }

    /// Open (creating if absent) the database file at `path`, migrating the
    /// schema to the current version.
    ///
    /// # Errors
    /// Returns [`StoreError::Io`] if the parent directory cannot be created,
    /// or [`StoreError::Sqlite`] if the database cannot be opened or migrated.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        Self::from_connection(Connection::open(path)?)
    }

    /// Open a private in-memory database, useful for tests that should never
    /// touch disk.
    ///
    /// # Errors
    /// Returns [`StoreError::Sqlite`] if `SQLite` cannot allocate the database.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self, StoreError> {
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    /// Take the connection lock, recovering rather than panicking if a prior
    /// holder panicked while holding it.
    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.conn.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Bring the schema from whatever version it is at up to current.
    ///
    /// `PRAGMA user_version` starts at `0` on a brand new database (`SQLite`'s
    /// default), which is exactly the "v0" this migrates from; today there is
    /// only one target, v1.
    fn migrate(&self) -> Result<(), StoreError> {
        let conn = self.lock();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.pragma_update(None, "user_version", 1)?;
        }
        Ok(())
    }

    /// Load every persisted identity, in no particular order.
    ///
    /// # Errors
    /// Returns [`StoreError::Sqlite`] on a query failure, or
    /// [`StoreError::Serde`]/[`StoreError::Corrupt`] if a row's JSON or
    /// timestamp columns are unreadable.
    pub fn load_all(&self) -> Result<Vec<Identity>, StoreError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, class, descriptors_json, first_seen, last_seen, \
             sightings, memory_json, appearance_json, status FROM identities",
        )?;
        let rows = stmt.query_map([], row_to_raw)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?.into_identity()?);
        }
        Ok(out)
    }

    /// Insert or update the persisted row for `identity`.
    ///
    /// # Errors
    /// Returns [`StoreError::Serde`] if a field fails to encode, or
    /// [`StoreError::Sqlite`] if the write fails.
    pub fn save_identity(&self, identity: &Identity) -> Result<(), StoreError> {
        let descriptors_json = serde_json::to_string(&identity.descriptors)?;
        let memory_json = serde_json::to_string(&identity.memory)?;
        let appearance_json = identity
            .appearance
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let status_json = serde_json::to_string(&identity.status)?;

        self.lock().execute(
            "INSERT INTO identities \
                (id, name, class, descriptors_json, first_seen, last_seen, sightings, memory_json, appearance_json, status) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
             ON CONFLICT(id) DO UPDATE SET \
                name = excluded.name, \
                class = excluded.class, \
                descriptors_json = excluded.descriptors_json, \
                first_seen = excluded.first_seen, \
                last_seen = excluded.last_seen, \
                sightings = excluded.sightings, \
                memory_json = excluded.memory_json, \
                appearance_json = excluded.appearance_json, \
                status = excluded.status",
            params![
                identity.id.to_string(),
                identity.name,
                identity.class,
                descriptors_json,
                identity.first_seen.to_rfc3339(),
                identity.last_seen.to_rfc3339(),
                identity.sightings,
                memory_json,
                appearance_json,
                status_json,
            ],
        )?;
        Ok(())
    }

    /// Remove every persisted identity. Intended for test cleanup, so it is
    /// only compiled into test builds.
    ///
    /// # Errors
    /// Returns [`StoreError::Sqlite`] if the delete fails.
    #[cfg(test)]
    pub fn delete_all(&self) -> Result<(), StoreError> {
        self.lock().execute("DELETE FROM identities", [])?;
        Ok(())
    }

    /// Read one identity's chronological history straight from its stored
    /// `memory_json` column, without reconstructing the rest of the row.
    ///
    /// Returns an empty timeline for an unknown id rather than an error, so
    /// callers do not need to special-case "never persisted".
    ///
    /// # Errors
    /// Returns [`StoreError::Sqlite`] on a query failure or
    /// [`StoreError::Serde`] if the stored JSON is unreadable.
    pub fn timeline(&self, id: Uuid) -> Result<Vec<MemoryEntry>, StoreError> {
        let memory_json: Option<String> = self
            .lock()
            .query_row(
                "SELECT memory_json FROM identities WHERE id = ?1",
                params![id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        match memory_json {
            Some(json) => Ok(serde_json::from_str(&json)?),
            None => Ok(Vec::new()),
        }
    }
}

/// Column values pulled straight off a row, before any parsing that can fail
/// with a `rusqlite::Error` that borrow-checks awkwardly inside `query_map`.
struct RawRow {
    id: String,
    name: Option<String>,
    class: String,
    descriptors_json: String,
    first_seen: String,
    last_seen: String,
    sightings: i64,
    memory_json: String,
    appearance_json: Option<String>,
    status: String,
}

fn row_to_raw(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRow> {
    Ok(RawRow {
        id: row.get(0)?,
        name: row.get(1)?,
        class: row.get(2)?,
        descriptors_json: row.get(3)?,
        first_seen: row.get(4)?,
        last_seen: row.get(5)?,
        sightings: row.get(6)?,
        memory_json: row.get(7)?,
        appearance_json: row.get(8)?,
        status: row.get(9)?,
    })
}

impl RawRow {
    fn into_identity(self) -> Result<Identity, StoreError> {
        let id = Uuid::parse_str(&self.id)
            .map_err(|e| StoreError::Corrupt(format!("bad id {}: {e}", self.id)))?;
        let first_seen = parse_timestamp(&self.first_seen)?;
        let last_seen = parse_timestamp(&self.last_seen)?;
        let descriptors: Vec<Descriptor> = serde_json::from_str(&self.descriptors_json)?;
        let memory: Vec<MemoryEntry> = serde_json::from_str(&self.memory_json)?;
        let appearance: Option<AppearanceMemory> = self
            .appearance_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?;
        let status = serde_json::from_str(&self.status)?;
        let sightings = u32::try_from(self.sightings)
            .map_err(|e| StoreError::Corrupt(format!("bad sightings count: {e}")))?;

        Ok(Identity {
            id,
            name: self.name,
            class: self.class,
            descriptors,
            first_seen,
            last_seen,
            sightings,
            memory,
            appearance,
            status,
        })
    }
}

fn parse_timestamp(raw: &str) -> Result<DateTime<Utc>, StoreError> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| StoreError::Corrupt(format!("bad timestamp {raw}: {e}")))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
mod tests {
    use super::*;
    use identity::appearance::AppearanceVec;
    use identity::memory::IdentityStatus;

    fn sample(name: Option<&str>) -> Identity {
        let now = Utc::now();
        Identity {
            id: Uuid::new_v4(),
            name: name.map(String::from),
            class: "dog".into(),
            descriptors: vec![Descriptor::new("breed", "shiba")],
            first_seen: now,
            last_seen: now,
            sightings: 3,
            memory: vec![MemoryEntry {
                at: now,
                camera_id: "driveway".into(),
                matched: vec!["breed".into()],
            }],
            appearance: Some(AppearanceMemory::from_observation(&AppearanceVec {
                model: "clip".into(),
                values: vec![1.0, 0.0, 0.0],
            })),
            status: IdentityStatus::Confirmed,
        }
    }

    #[test]
    fn opening_an_empty_database_creates_the_schema() {
        let store = IdentityStore::open_in_memory().unwrap();
        assert!(store.load_all().unwrap().is_empty());
        // Re-running migrate on an already-current database is a no-op.
        store.migrate().unwrap();
    }

    #[test]
    fn migrating_from_v0_creates_the_v1_schema_and_is_idempotent() {
        // A brand new SQLite database starts at `user_version = 0` (v0: no
        // schema at all) until something migrates it. Build one by hand,
        // confirm it has no table yet, then let `IdentityStore` migrate it.
        let conn = Connection::open_in_memory().unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 0, "a fresh connection must start at v0");
        assert!(
            conn.prepare("SELECT * FROM identities").is_err(),
            "the v1 table must not exist before migration"
        );

        let store = IdentityStore::from_connection(conn).unwrap();
        let version: i64 = store
            .lock()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1, "migration must advance user_version to 1");
        assert!(store.load_all().unwrap().is_empty());

        // Running migrate again against the now-current database changes
        // nothing and does not error.
        store.migrate().unwrap();
        let identity = sample(Some("Mochi"));
        store.save_identity(&identity).unwrap();
        assert_eq!(store.load_all().unwrap().len(), 1);
    }

    #[test]
    fn timeline_lookup_by_primary_key_is_fast() {
        let store = IdentityStore::open_in_memory().unwrap();
        for i in 0..200 {
            let mut identity = sample(None);
            identity.class = format!("class-{i}");
            store.save_identity(&identity).unwrap();
        }
        let target = sample(Some("Target"));
        store.save_identity(&target).unwrap();

        let started = std::time::Instant::now();
        let timeline = store.timeline(target.id).unwrap();
        let elapsed = started.elapsed();

        assert_eq!(timeline.len(), 1);
        assert!(
            elapsed < std::time::Duration::from_millis(10),
            "timeline lookup took {elapsed:?}, expected under 10ms"
        );
    }

    #[test]
    fn save_then_load_all_round_trips_an_identity() {
        let store = IdentityStore::open_in_memory().unwrap();
        let identity = sample(Some("Mochi"));
        store.save_identity(&identity).unwrap();

        let loaded = store.load_all().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, identity.id);
        assert_eq!(loaded[0].name.as_deref(), Some("Mochi"));
        assert_eq!(loaded[0].class, "dog");
        assert_eq!(loaded[0].sightings, 3);
        assert_eq!(loaded[0].memory.len(), 1);
        assert!(loaded[0].appearance.is_some());
    }

    #[test]
    fn saving_twice_upserts_rather_than_duplicating() {
        let store = IdentityStore::open_in_memory().unwrap();
        let mut identity = sample(None);
        store.save_identity(&identity).unwrap();
        identity.sightings = 9;
        identity.name = Some("Rex".into());
        store.save_identity(&identity).unwrap();

        let loaded = store.load_all().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].sightings, 9);
        assert_eq!(loaded[0].name.as_deref(), Some("Rex"));
    }

    #[test]
    fn reopening_a_file_backed_database_preserves_data() {
        let dir = std::env::temp_dir().join(format!("we-identity-test-{}", Uuid::new_v4()));
        let db_path = dir.join("identities.sqlite");

        let identity = sample(Some("Mochi"));
        {
            let store = IdentityStore::open(&db_path).unwrap();
            store.save_identity(&identity).unwrap();
        }
        {
            let reopened = IdentityStore::open(&db_path).unwrap();
            let loaded = reopened.load_all().unwrap();
            assert_eq!(loaded.len(), 1);
            assert_eq!(loaded[0].id, identity.id);
            assert_eq!(loaded[0].name.as_deref(), Some("Mochi"));
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn timeline_reads_memory_for_a_known_id_and_empty_for_unknown() {
        let store = IdentityStore::open_in_memory().unwrap();
        let identity = sample(None);
        store.save_identity(&identity).unwrap();

        let timeline = store.timeline(identity.id).unwrap();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].camera_id, "driveway");

        assert!(store.timeline(Uuid::new_v4()).unwrap().is_empty());
    }

    #[test]
    fn delete_all_clears_the_table() {
        let store = IdentityStore::open_in_memory().unwrap();
        store.save_identity(&sample(None)).unwrap();
        store.delete_all().unwrap();
        assert!(store.load_all().unwrap().is_empty());
    }

    #[test]
    fn default_path_honors_the_env_override() {
        // SAFETY: test-only, restores the previous value before returning.
        let previous = std::env::var("WATCHINGEYE_IDENTITY_DB").ok();
        unsafe {
            std::env::set_var("WATCHINGEYE_IDENTITY_DB", "custom/path.sqlite");
        }
        assert_eq!(
            IdentityStore::default_path(),
            PathBuf::from("custom/path.sqlite")
        );
        unsafe {
            match &previous {
                Some(v) => std::env::set_var("WATCHINGEYE_IDENTITY_DB", v),
                None => std::env::remove_var("WATCHINGEYE_IDENTITY_DB"),
            }
        }
    }
}
