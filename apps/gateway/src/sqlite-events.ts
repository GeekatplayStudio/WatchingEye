/**
 * SQLite-backed pipeline event store (ROADMAP 1.5 remaining).
 *
 * Uses Node's built-in `node:sqlite` (no native addon). Soft-opens the file;
 * callers fall back to memory on failure. Gateway stays AI-free — payload is
 * opaque JSON with provenance already attached upstream.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DetectionEvent } from "./events.js";
import type { EventStore } from "./db.js";

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

type SqliteModule = {
  DatabaseSync: new (path: string) => DatabaseSync;
};

function loadSqlite(): SqliteModule {
  // Vite/vitest rewrites bare `node:sqlite` imports; load via createRequire.
  const require = createRequire(import.meta.url);
  return require("node:sqlite") as SqliteModule;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS events_created_at_idx ON events (created_at DESC);
`;

/**
 * File or `:memory:` event store.
 *
 * @example
 * const store = SqliteEventStore.open(":memory:");
 * await store.insertEvent(event);
 */
export class SqliteEventStore implements EventStore {
  private constructor(private readonly db: DatabaseSync) {}

  /**
   * Open (and migrate) a SQLite event database.
   *
   * @throws when the path cannot be opened
   */
  static open(dbPath: string): SqliteEventStore {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    const { DatabaseSync } = loadSqlite();
    const db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    return new SqliteEventStore(db);
  }

  async insertEvent(event: DetectionEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO events (id, payload, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(event.id, JSON.stringify(event), event.timestamp);
  }

  async recentEvents(limit: number): Promise<DetectionEvent[]> {
    const rows = this.db
      .prepare(
        `SELECT payload FROM events
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(0, limit)) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as DetectionEvent);
  }

  async getEvent(id: string): Promise<DetectionEvent | null> {
    const row = this.db
      .prepare(`SELECT payload FROM events WHERE id = ? LIMIT 1`)
      .get(id) as { payload: string } | undefined;
    if (row === undefined) return null;
    return JSON.parse(row.payload) as DetectionEvent;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** True when the path means "use the in-memory EventStore". */
export function isMemoryEventsPath(path: string | undefined): boolean {
  if (path === undefined || path === "") return false;
  const p = path.toLowerCase();
  return p === "memory" || p === "off" || p === "none";
}
