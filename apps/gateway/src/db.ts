/**
 * Optional event persistence (Postgres or SQLite).
 *
 * Preference order:
 * 1. `DATABASE_URL` → Postgres JSONB (when migrate succeeds)
 * 2. `WATCHINGEYE_EVENTS_DB` / default `data/events.sqlite` → SQLite
 * 3. `memory` / Vitest → in-memory
 *
 * Persistence is additive — unreachable backends never block the gateway.
 */
import pg from "pg";
import type { DetectionEvent } from "./events.js";
import { isMemoryEventsPath, SqliteEventStore } from "./sqlite-events.js";

/** Thin wrapper so tests can run without a database. */
export interface EventStore {
  /** Persist one event. */
  insertEvent(event: DetectionEvent): Promise<void>;
  /** Most recent events, newest first. */
  recentEvents(limit: number): Promise<DetectionEvent[]>;
  /** Look up one event by id, or null when unknown. */
  getEvent(id: string): Promise<DetectionEvent | null>;
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

  async getEvent(id: string): Promise<DetectionEvent | null> {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event !== undefined && event.id === id) return event;
    }
    return null;
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
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
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

  async getEvent(id: string): Promise<DetectionEvent | null> {
    const res = await this.pool.query("SELECT payload FROM events WHERE id = $1 LIMIT 1", [id]);
    const row = res.rows[0] as { payload: DetectionEvent } | undefined;
    return row?.payload ?? null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Resolve the SQLite path when Postgres is not used. */
export function resolveEventsDbPath(explicit?: string): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  if (process.env.WATCHINGEYE_EVENTS_DB !== undefined && process.env.WATCHINGEYE_EVENTS_DB !== "") {
    return process.env.WATCHINGEYE_EVENTS_DB;
  }
  // Vitest must not share a durable file across suites.
  if (process.env.VITEST !== undefined) return "memory";
  return "data/events.sqlite";
}

/**
 * Build the store: Postgres → SQLite → memory.
 *
 * @example
 * const store = await createStore(undefined, ":memory:");
 */
export async function createStore(
  databaseUrl: string | undefined,
  eventsDbPath?: string,
): Promise<EventStore> {
  if (databaseUrl !== undefined && databaseUrl !== "") {
    const store = new PgEventStore(databaseUrl);
    try {
      await store.migrate();
      return store;
    } catch {
      await store.close().catch(() => undefined);
    }
  }

  const path = resolveEventsDbPath(eventsDbPath);
  if (isMemoryEventsPath(path)) {
    return new MemoryEventStore();
  }

  try {
    return SqliteEventStore.open(path === ":memory:" ? ":memory:" : path);
  } catch {
    return new MemoryEventStore();
  }
}
