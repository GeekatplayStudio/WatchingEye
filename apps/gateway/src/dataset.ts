/**
 * Multimodal Dataset Store & Event Recall Engine.
 *
 * Persists Who/When/What evidence metadata (and optional appearance
 * embeddings). Keyword search stays available; cosine nearest-neighbour is
 * implemented by each backend. Gateway never computes embeddings — callers
 * supply vectors from the orchestrator embed relay.
 */

/** DINOv2-small output width — must match orchestrator `EMBED_DIM`. */
export const DATASET_EMBED_DIM = 384;

/** Text embedding width — match orchestrator `TEXT_EMBED_DIM` (nomic). */
export const DATASET_TEXT_EMBED_DIM = 768;

/** CLIP ViT-B/32 width — match orchestrator `CLIP_EMBED_DIM`. */
export const DATASET_CLIP_EMBED_DIM = 512;

/** Default embed model id recorded in provenance when DINOv2 succeeds. */
export const DATASET_EMBED_MODEL = "dinov2-vits14-onnx";

/** Default text embed model id. */
export const DATASET_TEXT_EMBED_MODEL = "nomic-embed-text";

/** Default CLIP embed model id. */
export const DATASET_CLIP_EMBED_MODEL = "clip-vit-b32-onnx";

/** Provenance attached when an enrollment was classified / embedded. */
export interface DatasetProvenance {
  model_version: string;
  prompt_version: string;
  input_images: string[];
  timestamp: string;
  /** Appearance model when a vector was stored. */
  embed_model?: string;
  /** Text embed model when a text vector was stored. */
  text_embed_model?: string;
  /** CLIP multimodal model when a CLIP vector was stored. */
  clip_embed_model?: string;
}

export interface DatasetRecord {
  id: string;
  objectId: string;
  class: string;
  cameraId: string;
  timestamp: string;
  descriptors?: Array<{ key: string; value: string }>;
  licensePlate?: string;
  breedOrModel?: string;
  confidence: number;
  evidence: Array<{ label: string; description: string }>;
  snapshotRef: string;
  /** L2-ready appearance vector (length `DATASET_EMBED_DIM`) when embedded. */
  embedding?: number[];
  embedModel?: string;
  /** Text embedding for semantic RAG (not DINOv2). */
  textEmbedding?: number[];
  textEmbedModel?: string;
  /** CLIP image embedding for multimodal NL/image recall. */
  clipEmbedding?: number[];
  clipEmbedModel?: string;
  provenance?: DatasetProvenance;
}

/** Backend contract — memory or Postgres/pgvector. */
export interface DatasetStoreLike {
  insertRecord(record: DatasetRecord): Promise<void>;
  search(query: string, limit?: number): Promise<DatasetRecord[]>;
  /** Cosine nearest neighbours; empty when no vectors are stored. */
  searchByEmbedding(embedding: number[], limit?: number): Promise<DatasetRecord[]>;
  /** Text-embedding NN for semantic RAG (separate from DINOv2 appearance). */
  searchByTextEmbedding(embedding: number[], limit?: number): Promise<DatasetRecord[]>;
  /** CLIP embedding NN for multimodal search (separate from DINOv2 / nomic). */
  searchByClipEmbedding(embedding: number[], limit?: number): Promise<DatasetRecord[]>;
  getAll(limit?: number): Promise<DatasetRecord[]>;
  /** Total enrolled records (for live monitor metrics). */
  count(): Promise<number>;
  clear(): Promise<void> | void;
  close?(): Promise<void>;
}

/**
 * Cosine similarity in [−1, 1]. Returns 0 when dimensions disagree or a
 * vector is zero-length.
 *
 * @example
 * cosineSimilarity([1, 0], [1, 0]); // 1
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function keywordMatch(r: DatasetRecord, q: string): boolean {
  if (r.class.toLowerCase().includes(q)) return true;
  if (r.licensePlate?.toLowerCase().includes(q)) return true;
  if (r.breedOrModel?.toLowerCase().includes(q)) return true;
  if (r.objectId.toLowerCase().includes(q)) return true;
  if (r.descriptors?.some((d) => d.value.toLowerCase().includes(q) || d.key.toLowerCase().includes(q))) {
    return true;
  }
  if (r.evidence?.some((e) => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))) {
    return true;
  }
  return false;
}

/** In-memory fallback (also used in tests). */
export class DatasetStore implements DatasetStoreLike {
  private records: DatasetRecord[] = [];

  public async insertRecord(record: DatasetRecord): Promise<void> {
    this.records.unshift(record);
    if (this.records.length > 2000) {
      this.records.pop();
    }
  }

  public async search(query: string, limit = 50): Promise<DatasetRecord[]> {
    const q = query.toLowerCase().trim();
    if (!q) return this.records.slice(0, limit);
    return this.records.filter((r) => keywordMatch(r, q)).slice(0, limit);
  }

  public async searchByEmbedding(embedding: number[], limit = 50): Promise<DatasetRecord[]> {
    const scored = this.records
      .filter((r) => r.embedding !== undefined && r.embedding.length === embedding.length)
      .map((r) => ({ r, score: cosineSimilarity(embedding, r.embedding!) }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.r);
  }

  public async searchByTextEmbedding(embedding: number[], limit = 50): Promise<DatasetRecord[]> {
    const scored = this.records
      .filter((r) => r.textEmbedding !== undefined && r.textEmbedding.length === embedding.length)
      .map((r) => ({ r, score: cosineSimilarity(embedding, r.textEmbedding!) }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.r);
  }

  public async searchByClipEmbedding(embedding: number[], limit = 50): Promise<DatasetRecord[]> {
    const scored = this.records
      .filter((r) => r.clipEmbedding !== undefined && r.clipEmbedding.length === embedding.length)
      .map((r) => ({ r, score: cosineSimilarity(embedding, r.clipEmbedding!) }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.r);
  }

  public async getAll(limit = 50): Promise<DatasetRecord[]> {
    return this.records.slice(0, limit);
  }

  public async count(): Promise<number> {
    return this.records.length;
  }

  /** Test helper — empty the in-memory store between cases. */
  public clear(): void {
    this.records = [];
  }
}

export const globalDatasetStore = new DatasetStore();
