/**
 * Text embeddings for semantic RAG (ROADMAP 2.1c).
 *
 * Separate from DINOv2 appearance vectors — those are image descriptors.
 * Production uses Ollama `/api/embeddings` (default `nomic-embed-text`);
 * CI uses `StubTextEmbedder` (deterministic, no network). Soft-fail when
 * the model is missing — keyword recall remains required-path.
 */
export const TEXT_EMBED_DIM = 768;
export const TEXT_EMBED_MODEL = "nomic-embed-text";

/** One text vector with model provenance. */
export interface TextEmbedding {
  model: string;
  values: number[];
  dim: number;
}

/** Injectable text embedder. */
export interface TextEmbedder {
  readonly name: string;
  embed(text: string): Promise<TextEmbedding | null>;
}

/**
 * Deterministic stub for CI: hashes characters into a fixed-dim unit vector.
 *
 * @example
 * const v = await new StubTextEmbedder().embed("golden retriever");
 */
export class StubTextEmbedder implements TextEmbedder {
  readonly name = "stub-text";

  constructor(private readonly dim = TEXT_EMBED_DIM) {}

  async embed(text: string): Promise<TextEmbedding | null> {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const values = new Array<number>(this.dim).fill(0);
    for (let i = 0; i < trimmed.length; i += 1) {
      const idx = (trimmed.charCodeAt(i) * (i + 1)) % this.dim;
      values[idx] = (values[idx] ?? 0) + 1;
    }
    let norm = 0;
    for (const v of values) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm < 1e-12) return null;
    return {
      model: "stub-text-1",
      values: values.map((v) => v / norm),
      dim: this.dim,
    };
  }
}

/** Ollama `/api/embeddings` client. Returns null on transport / model miss. */
export class OllamaTextEmbedder implements TextEmbedder {
  readonly name = "ollama-text";

  constructor(
    private readonly model: string = process.env.WATCHINGEYE_TEXT_EMBED_MODEL ?? TEXT_EMBED_MODEL,
    private readonly baseUrl: string = process.env.OLLAMA_URL ?? "http://localhost:11434",
    private readonly timeoutMs = 30_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(text: string): Promise<TextEmbedding | null> {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: trimmed }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { embedding?: unknown };
      if (!Array.isArray(body.embedding)) return null;
      const values = body.embedding.map((v) => Number(v));
      if (values.some((n) => Number.isNaN(n)) || values.length === 0) return null;
      return { model: this.model, values, dim: values.length };
    } catch {
      return null;
    }
  }
}

/**
 * Default embedder: stub when `WATCHINGEYE_TEXT_EMBED=stub`, else Ollama.
 */
export function createDefaultTextEmbedder(): TextEmbedder {
  if ((process.env.WATCHINGEYE_TEXT_EMBED ?? "").toLowerCase() === "stub") {
    return new StubTextEmbedder();
  }
  return new OllamaTextEmbedder();
}

/**
 * Flatten dataset-like fields into a single embeddable summary.
 *
 * @example
 * buildTextBlob({ class: "dog", breedOrModel: "golden_retriever" })
 */
export function buildTextBlob(parts: {
  class?: string;
  licensePlate?: string;
  breedOrModel?: string;
  cameraId?: string;
  descriptors?: Array<{ key: string; value: string }>;
  evidence?: Array<{ label: string; description: string }>;
}): string {
  const bits: string[] = [];
  if (parts.class) bits.push(parts.class);
  if (parts.breedOrModel) bits.push(parts.breedOrModel.replaceAll("_", " "));
  if (parts.licensePlate) bits.push(`plate ${parts.licensePlate}`);
  if (parts.cameraId) bits.push(`camera ${parts.cameraId}`);
  for (const d of parts.descriptors ?? []) {
    bits.push(`${d.key} ${d.value}`);
  }
  for (const e of parts.evidence ?? []) {
    bits.push(`${e.label} ${e.description}`);
  }
  return bits.join(". ").trim();
}
