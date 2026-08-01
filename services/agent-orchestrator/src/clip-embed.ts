/**
 * CLIP ViT-B/32 embeddings for multimodal dataset search (ROADMAP 6.4).
 *
 * Image: optional ONNX vision tower (same weights as open-vocab).
 * Text: optional Python sidecar (`scripts/clip-text-embed.py`) — CLIP BPE
 * lives in transformers; Node soft-fails without it.
 * CI: `WATCHINGEYE_CLIP_EMBED=stub` → deterministic 512-d hash.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-node";
import {
  CLIP_EMBED_DIM,
  CLIP_INPUT_SIZE,
  CLIP_OPEN_VOCAB_MODEL,
  clipVisionPath,
} from "./open-vocab-clip.js";

export { CLIP_EMBED_DIM };

export const CLIP_SEARCH_MODEL = CLIP_OPEN_VOCAB_MODEL;

/** One CLIP vector with provenance. */
export interface ClipEmbedding {
  model: string;
  values: number[];
  dim: number;
}

/** Injectable CLIP embedder (image and/or text). */
export interface ClipEmbedder {
  readonly name: string;
  embedImage(imageBase64: string): Promise<ClipEmbedding | null>;
  embedText(text: string): Promise<ClipEmbedding | null>;
}

const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711] as const;

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../..");
}

export function clipTextScriptPath(): string {
  return join(repoRoot(), "scripts", "clip-text-embed.py");
}

export function clipVisionAvailable(): boolean {
  return existsSync(clipVisionPath());
}

export function clipTextSidecarAvailable(): boolean {
  return existsSync(clipTextScriptPath());
}

function pythonBin(): string {
  return process.env.WATCHINGEYE_PYTHON ?? "python";
}

function preprocessClip(
  rgba: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const size = CLIP_INPUT_SIZE;
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  for (let y = 0; y < size; y += 1) {
    const srcY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size));
    for (let x = 0; x < size; x += 1) {
      const srcX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / size));
      const src = (srcY * width + srcX) * 4;
      for (let c = 0; c < 3; c += 1) {
        const v = (rgba[src + c] ?? 0) / 255;
        const mean = CLIP_MEAN[c as 0 | 1 | 2] ?? 0;
        const std = CLIP_STD[c as 0 | 1 | 2] ?? 1;
        tensor[c * plane + y * size + x] = (v - mean) / std;
      }
    }
  }
  return tensor;
}

function l2Normalize(values: number[]): number[] | null {
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return null;
  return values.map((v) => v / norm);
}

/**
 * Deterministic stub for CI (same contract as StubTextEmbedder, dim 512).
 *
 * @example
 * await new StubClipEmbedder().embedText("golden retriever");
 */
export class StubClipEmbedder implements ClipEmbedder {
  readonly name = "stub-clip";

  constructor(private readonly dim = CLIP_EMBED_DIM) {}

  async embedImage(imageBase64: string): Promise<ClipEmbedding | null> {
    if (imageBase64 === "") return null;
    return this.hash(`img:${imageBase64.slice(0, 64)}`);
  }

  async embedText(text: string): Promise<ClipEmbedding | null> {
    return this.hash(text.trim());
  }

  private hash(seed: string): ClipEmbedding | null {
    if (seed === "") return null;
    const values = new Array<number>(this.dim).fill(0);
    for (let i = 0; i < seed.length; i += 1) {
      const idx = (seed.charCodeAt(i) * (i + 1)) % this.dim;
      values[idx] = (values[idx] ?? 0) + 1;
    }
    const normalized = l2Normalize(values);
    if (normalized === null) return null;
    return { model: "stub-clip-1", values: normalized, dim: this.dim };
  }
}

let visionSession: Promise<ort.InferenceSession> | null = null;

function visionOrt(): Promise<ort.InferenceSession> {
  visionSession ??= ort.InferenceSession.create(clipVisionPath(), {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  return visionSession;
}

function runTextSidecar(text: string, timeoutMs: number): Promise<ClipEmbedding | null> {
  return new Promise((resolve) => {
    const script = clipTextScriptPath();
    if (!existsSync(script)) {
      resolve(null);
      return;
    }
    const child = spawn(pythonBin(), [script, "--text", text], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const finish = (v: ClipEmbedding | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
        const parsed = JSON.parse(line) as {
          values?: unknown;
          model?: string;
          dim?: number;
        };
        if (!Array.isArray(parsed.values) || parsed.values.length === 0) {
          finish(null);
          return;
        }
        const values = parsed.values.map((n) => Number(n));
        if (values.some((n) => Number.isNaN(n))) {
          finish(null);
          return;
        }
        finish({
          model: parsed.model ?? CLIP_SEARCH_MODEL,
          values,
          dim: values.length,
        });
      } catch {
        finish(null);
      }
    });
  });
}

/**
 * Production CLIP embedder: ONNX vision + Python text sidecar.
 *
 * @example
 * const e = new OnnxClipEmbedder();
 * await e.embedText("red car");
 */
export class OnnxClipEmbedder implements ClipEmbedder {
  readonly name = "clip-onnx";

  constructor(private readonly textTimeoutMs = 60_000) {}

  async embedImage(imageBase64: string): Promise<ClipEmbedding | null> {
    if (!clipVisionAvailable() || imageBase64 === "") return null;
    try {
      const jpegDecoded = jpeg.decode(Buffer.from(imageBase64, "base64"), {
        useTArray: true,
      });
      const tensor = preprocessClip(
        jpegDecoded.data,
        jpegDecoded.width,
        jpegDecoded.height,
      );
      const sess = await visionOrt();
      const inputName = sess.inputNames[0] ?? "pixel_values";
      const out = await sess.run({
        [inputName]: new ort.Tensor("float32", tensor, [
          1,
          3,
          CLIP_INPUT_SIZE,
          CLIP_INPUT_SIZE,
        ]),
      });
      const outName = sess.outputNames[0] ?? "image_embeds";
      const data = out[outName]?.data;
      if (data === undefined) return null;
      const values = Array.from(data as Float32Array);
      const normalized = l2Normalize(values) ?? values;
      return { model: CLIP_SEARCH_MODEL, values: normalized, dim: normalized.length };
    } catch {
      return null;
    }
  }

  async embedText(text: string): Promise<ClipEmbedding | null> {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    return runTextSidecar(trimmed, this.textTimeoutMs);
  }
}

/**
 * Default: stub when `WATCHINGEYE_CLIP_EMBED=stub`, else ONNX + sidecar.
 */
export function createDefaultClipEmbedder(): ClipEmbedder {
  if ((process.env.WATCHINGEYE_CLIP_EMBED ?? "").toLowerCase() === "stub") {
    return new StubClipEmbedder();
  }
  return new OnnxClipEmbedder();
}
