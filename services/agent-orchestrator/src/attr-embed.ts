/**
 * Open-vocab attribute embeddings for dataset enroll (ROADMAP 6.3).
 *
 * Distinct from CLIP *image* search (`clip-embed.ts` / `clip_embedding`):
 * this mean-pools winning bank *text* vectors (`breed:…`, `fur_color:…`)
 * so attribute space is stored alongside appearance.
 *
 * Soft-null when the JSON bank is missing or no descriptor keys match —
 * never blocks classify/enroll. CI: `WATCHINGEYE_ATTR_EMBED=stub`.
 */
import {
  CLIP_EMBED_DIM,
  loadOpenVocabTextBank,
  type OpenVocabTextBank,
} from "./open-vocab-clip.js";

export const ATTR_EMBED_DIM = CLIP_EMBED_DIM;
/** Provenance tag for bank-derived attr vectors. */
export const ATTR_EMBED_MODEL = "clip-vit-b32-onnx-bank";
/** Stub model id for CI. */
export const ATTR_EMBED_STUB_MODEL = "attr-embed-stub-1";

const ATTR_DESCRIPTOR_KEYS = new Set(["breed", "fur_color", "vehicle_color"]);

/** One attr embedding with provenance. */
export interface AttrEmbedding {
  model: string;
  values: number[];
  dim: number;
}

/** Injectable attr embedder. */
export interface AttrEmbedder {
  readonly name: string;
  embed(
    descriptors: ReadonlyArray<{ key: string; value: string }>,
  ): Promise<AttrEmbedding | null>;
}

/**
 * Map a descriptor to a bank key (`breed:golden_retriever`).
 *
 * @example
 * descriptorToBankKey("breed", "golden_retriever"); // "breed:golden_retriever"
 */
export function descriptorToBankKey(key: string, value: string): string | null {
  if (!ATTR_DESCRIPTOR_KEYS.has(key)) return null;
  const v = value.trim();
  if (v === "") return null;
  return `${key}:${v}`;
}

/**
 * Mean-pool equal-length vectors and L2-normalize.
 *
 * @example
 * meanPoolL2([[1, 0], [0, 1]]); // ≈ [0.707, 0.707]
 */
export function meanPoolL2(vectors: readonly number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0]?.length ?? 0;
  if (dim === 0 || vectors.some((v) => v.length !== dim)) return null;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i]! += v[i] ?? 0;
  }
  const n = vectors.length;
  for (let i = 0; i < dim; i += 1) sum[i]! /= n;
  let norm = 0;
  for (const x of sum) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return null;
  return sum.map((x) => x / norm);
}

/**
 * Lookup bank vectors for open-vocab descriptors and mean-pool.
 *
 * @example
 * new BankAttrEmbedder({ "breed:labrador": unit }).embed([{ key: "breed", value: "labrador" }]);
 */
export class BankAttrEmbedder implements AttrEmbedder {
  readonly name = "bank-attr";

  constructor(private readonly bankOverride?: OpenVocabTextBank | null) {}

  async embed(
    descriptors: ReadonlyArray<{ key: string; value: string }>,
  ): Promise<AttrEmbedding | null> {
    const bank =
      this.bankOverride !== undefined ? this.bankOverride : loadOpenVocabTextBank();
    if (bank === null) return null;
    const vectors: number[][] = [];
    for (const d of descriptors) {
      const key = descriptorToBankKey(d.key, d.value);
      if (key === null) continue;
      const vec = bank[key];
      if (!Array.isArray(vec) || vec.length !== ATTR_EMBED_DIM) continue;
      vectors.push(vec);
    }
    const values = meanPoolL2(vectors);
    if (values === null) return null;
    return { model: ATTR_EMBED_MODEL, values, dim: ATTR_EMBED_DIM };
  }
}

/**
 * Deterministic stub for CI (no JSON bank required).
 *
 * @example
 * await new StubAttrEmbedder().embed([{ key: "breed", value: "labrador" }]);
 */
export class StubAttrEmbedder implements AttrEmbedder {
  readonly name = "stub-attr";

  async embed(
    descriptors: ReadonlyArray<{ key: string; value: string }>,
  ): Promise<AttrEmbedding | null> {
    const keys = descriptors
      .map((d) => descriptorToBankKey(d.key, d.value))
      .filter((k): k is string => k !== null);
    if (keys.length === 0) return null;
    const values = new Array<number>(ATTR_EMBED_DIM).fill(0);
    for (const key of keys) {
      let h = 2166136261;
      for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      values[(h >>> 0) % ATTR_EMBED_DIM]! += 1;
    }
    const pooled = meanPoolL2([values]);
    if (pooled === null) return null;
    return { model: ATTR_EMBED_STUB_MODEL, values: pooled, dim: ATTR_EMBED_DIM };
  }
}

/** Default: stub when env asks, else JSON bank (soft-null if missing). */
export function createDefaultAttrEmbedder(): AttrEmbedder {
  if ((process.env.WATCHINGEYE_ATTR_EMBED ?? "").toLowerCase() === "stub") {
    return new StubAttrEmbedder();
  }
  return new BankAttrEmbedder();
}
