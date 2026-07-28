/**
 * Optional Postgres persistence (docker-compose provides pgvector-enabled
 * Postgres). The gateway works fully in-memory when DATABASE_URL is unset
 * or the database is unreachable — persistence is additive, never required.
 */
import pg from "pg";
import type { DetectionEvent } from "./events.js";

/** Thin wrapper so tests can run without a database. */
export interface EventStore {
  /** Persist one event (no-op when DB is absent). */
  insertEvent(event: DetectionEvent): Promise<void>;
  /** Most recent events, newest first. */
  recentEvents(limit: number): Promise<DetectionEvent[]>;
  /** Close connections. */
  close(): Promise<void>;
}

/** In-memory fallback store (also used in tests). */
export class MemoryEventStore implements EventStore {
  private events: DetectionEvent[] = [];

  async insertEvent(event: DetectionEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > 1000) {
      this.events.shift();
    }
  }

  async recentEvents(limit: number): Promise<DetectionEvent[]> {
    return [...this.events].reverse().slice(0, limit);
  }

  async close(): Promise<void> {
    this.events = [];
  }
}

/** Postgres-backed store. Table is created on first connect. */
export class PgEventStore implements EventStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  /** Create the events table if missing. */
  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async insertEvent(event: DetectionEvent): Promise<void> {
    await this.pool.query(
      "INSERT INTO events (id, payload) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [event.id, JSON.stringify(event)],
    );
  }

  async recentEvents(limit: number): Promise<DetectionEvent[]> {
    const res = await this.pool.query(
      "SELECT payload FROM events ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return res.rows.map((r: { payload: DetectionEvent }) => r.payload);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Build the store: Postgres when DATABASE_URL works, memory otherwise. */
export async function createStore(databaseUrl: string | undefined): Promise<EventStore> {
  if (databaseUrl === undefined || databaseUrl === "") {
    return new MemoryEventStore();
  }
  const store = new PgEventStore(databaseUrl);
  try {
    await store.migrate();
    return store;
  } catch {
    await store.close().catch(() => undefined);
    return new MemoryEventStore();
  }
}
