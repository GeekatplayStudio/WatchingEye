/**
 * Postgres + pgvector backend for the multimodal dataset.
 *
 * Gateway stays AI-free: it only persists and queries vectors produced by the
 * orchestrator embedder. When DATABASE_URL is unset or migrate fails, callers
 * fall back to the in-memory `DatasetStore`.
 */
import pg from "pg";
import {
  DATASET_EMBED_DIM,
  globalDatasetStore,
  type DatasetProvenance,
  type DatasetRecord,
  type DatasetStoreLike,
} from "./dataset.js";

/** Format a JS float array as a pgvector literal. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.map((v) => Number(v).toString()).join(",")}]`;
}

/** Parse a pgvector / array payload back into numbers. */
export function parseVector(raw: unknown): number[] | undefined {
  if (Array.isArray(raw)) {
    return raw.map((v) => Number(v));
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (trimmed === "") return [];
  return trimmed.split(",").map((p) => Number(p.trim()));
}

function rowToRecord(row: {
  id: string;
  object_id: string;
  camera_id: string;
  class: string;
  license_plate: string | null;
  breed_or_model: string | null;
  confidence: number;
  timestamp: string | Date;
  evidence: DatasetRecord["evidence"];
  descriptors: DatasetRecord["descriptors"] | null;
  snapshot_ref: string;
  embedding: unknown;
  embed_model: string | null;
  provenance: DatasetProvenance;
}): DatasetRecord {
  const record: DatasetRecord = {
    id: row.id,
    objectId: row.object_id,
    class: row.class,
    cameraId: row.camera_id,
    timestamp:
      typeof row.timestamp === "string" ? row.timestamp : row.timestamp.toISOString(),
    confidence: Number(row.confidence),
    evidence: row.evidence ?? [],
    snapshotRef: row.snapshot_ref,
    provenance: row.provenance,
  };
  if (row.license_plate) record.licensePlate = row.license_plate;
  if (row.breed_or_model) record.breedOrModel = row.breed_or_model;
  if (row.descriptors) record.descriptors = row.descriptors;
  if (row.embed_model) record.embedModel = row.embed_model;
  const embedding = parseVector(row.embedding);
  if (embedding !== undefined && embedding.length > 0) record.embedding = embedding;
  return record;
}

/** Postgres-backed dataset with optional `vector(384)` appearance column. */
export class PgDatasetStore implements DatasetStoreLike {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  /**
   * Enable pgvector and create the dataset table.
   *
   * @example
   * const store = new PgDatasetStore(process.env.DATABASE_URL!);
   * await store.migrate();
   */
  async migrate(): Promise<void> {
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS dataset_events (
        id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL,
        camera_id TEXT NOT NULL,
        class TEXT NOT NULL,
        license_plate TEXT,
        breed_or_model TEXT,
        confidence REAL NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        evidence JSONB NOT NULL DEFAULT '[]',
        descriptors JSONB,
        snapshot_ref TEXT NOT NULL,
        embedding vector(${DATASET_EMBED_DIM}),
        embed_model TEXT,
        provenance JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async insertRecord(record: DatasetRecord): Promise<void> {
    const provenance = record.provenance ?? {
      model_version: "unknown",
      prompt_version: "unknown",
      input_images: [record.snapshotRef],
      timestamp: record.timestamp,
    };
    if (record.embedModel !== undefined) {
      provenance.embed_model = record.embedModel;
    }
    const embedding =
      record.embedding !== undefined && record.embedding.length === DATASET_EMBED_DIM
        ? toVectorLiteral(record.embedding)
        : null;
    await this.pool.query(
      `INSERT INTO dataset_events (
        id, object_id, camera_id, class, license_plate, breed_or_model,
        confidence, timestamp, evidence, descriptors, snapshot_ref,
        embedding, embed_model, provenance
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,
        $12::vector,$13,$14::jsonb
      ) ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.objectId,
        record.cameraId,
        record.class,
        record.licensePlate ?? null,
        record.breedOrModel ?? null,
        record.confidence,
        record.timestamp,
        JSON.stringify(record.evidence),
        record.descriptors !== undefined ? JSON.stringify(record.descriptors) : null,
        record.snapshotRef,
        embedding,
        record.embedModel ?? null,
        JSON.stringify(provenance),
      ],
    );
  }

  async search(query: string, limit = 50): Promise<DatasetRecord[]> {
    const q = query.toLowerCase().trim();
    if (!q) return this.getAll(limit);
    const res = await this.pool.query(
      `SELECT id, object_id, camera_id, class, license_plate, breed_or_model,
              confidence, timestamp, evidence, descriptors, snapshot_ref,
              embedding::text AS embedding, embed_model, provenance
       FROM dataset_events
       WHERE lower(class) LIKE $1
          OR lower(coalesce(license_plate, '')) LIKE $1
          OR lower(coalesce(breed_or_model, '')) LIKE $1
          OR lower(object_id) LIKE $1
          OR lower(evidence::text) LIKE $1
          OR lower(coalesce(descriptors::text, '')) LIKE $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [`%${q}%`, limit],
    );
    return res.rows.map(rowToRecord);
  }

  async searchByEmbedding(embedding: number[], limit = 50): Promise<DatasetRecord[]> {
    if (embedding.length !== DATASET_EMBED_DIM) return [];
    const res = await this.pool.query(
      `SELECT id, object_id, camera_id, class, license_plate, breed_or_model,
              confidence, timestamp, evidence, descriptors, snapshot_ref,
              embedding::text AS embedding, embed_model, provenance
       FROM dataset_events
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(embedding), limit],
    );
    return res.rows.map(rowToRecord);
  }

  async getAll(limit = 50): Promise<DatasetRecord[]> {
    const res = await this.pool.query(
      `SELECT id, object_id, camera_id, class, license_plate, breed_or_model,
              confidence, timestamp, evidence, descriptors, snapshot_ref,
              embedding::text AS embedding, embed_model, provenance
       FROM dataset_events
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit],
    );
    return res.rows.map(rowToRecord);
  }

  async clear(): Promise<void> {
    await this.pool.query(`DELETE FROM dataset_events`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Prefer Postgres/pgvector when `DATABASE_URL` works; otherwise the shared
 * in-memory store (so tests that `clear()` the global still see enrollments).
 */
export async function createDatasetStore(
  databaseUrl: string | undefined,
): Promise<DatasetStoreLike> {
  if (databaseUrl === undefined || databaseUrl === "") {
    return globalDatasetStore;
  }
  const store = new PgDatasetStore(databaseUrl);
  try {
    await store.migrate();
    return store;
  } catch {
    await store.close().catch(() => undefined);
    return globalDatasetStore;
  }
}
