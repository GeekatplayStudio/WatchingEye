/**
 * Appearance embedding via frozen DINOv2 (ONNX).
 *
 * Inspired by REMIND's perception stage: a single vision-transformer
 * forward pass yields an L2-normalised global descriptor that can re-identify
 * an object after occlusion or re-entry. Runs in the orchestrator next to
 * YOLO (same onnxruntime-node pattern -- ADR 0004), never on the Rust motion
 * path, and never decides identity by itself -- the Rust registry still owns
 * the match.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-node";

/** Square input size the DINOv2-small ONNX export expects. */
export const EMBED_INPUT_SIZE = 224;
/** Embedding dimension for ViT-S/14. */
export const EMBED_DIM = 384;
/** Provenance tag stored with every vector. */
export const EMBED_MODEL_VERSION = "dinov2-vits14-onnx";

/** ImageNet mean / std used by DINOv2 training. */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** Normalised bounding box in image fraction coordinates. */
export interface NormBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One appearance vector with model provenance. */
export interface AppearanceEmbedding {
  model: string;
  values: number[];
  dim: number;
}

/** Result of one embed pass. */
export interface EmbedResult {
  embedding: AppearanceEmbedding;
  /** Whether a crop bbox was applied. */
  cropped: boolean;
  imageWidth: number;
  imageHeight: number;
}

/** Locate the model file relative to the repo root. */
function modelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/vision/dinov2_vits14.onnx");
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function session(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(modelPath(), {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  return sessionPromise;
}

/** Whether the DINOv2 ONNX file is present. */
export function embedModelAvailable(): boolean {
  return existsSync(modelPath());
}

/**
 * Crop an RGBA buffer to a normalised bbox (clamped to the image).
 *
 * @example
 * const { data, width, height } = cropRgba(rgba, 100, 100, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
 */
export function cropRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  bbox: NormBBox,
): { data: Uint8Array; width: number; height: number } {
  const x0 = Math.max(0, Math.floor(bbox.x * width));
  const y0 = Math.max(0, Math.floor(bbox.y * height));
  const x1 = Math.min(width, Math.ceil((bbox.x + bbox.width) * width));
  const y1 = Math.min(height, Math.ceil((bbox.y + bbox.height) * height));
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const src = ((y0 + y) * width + (x0 + x)) * 4;
      const dst = (y * cw + x) * 4;
      out[dst] = rgba[src] ?? 0;
      out[dst + 1] = rgba[src + 1] ?? 0;
      out[dst + 2] = rgba[src + 2] ?? 0;
      out[dst + 3] = 255;
    }
  }
  return { data: out, width: cw, height: ch };
}

/**
 * Resize + ImageNet-normalise an RGBA crop into NCHW float32.
 *
 * Bilinear sampling keeps the ViT patch grid coherent without OpenCV.
 */
export function preprocessImageNet(
  rgba: Uint8Array,
  width: number,
  height: number,
  size = EMBED_INPUT_SIZE,
): Float32Array {
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  for (let y = 0; y < size; y += 1) {
    const srcY = Math.min(height - 1, ((y + 0.5) * height) / size - 0.5);
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = srcY - y0;
    for (let x = 0; x < size; x += 1) {
      const srcX = Math.min(width - 1, ((x + 0.5) * width) / size - 0.5);
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = srcX - x0;
      for (let c = 0; c < 3; c += 1) {
        const i00 = (y0 * width + x0) * 4 + c;
        const i01 = (y0 * width + x1) * 4 + c;
        const i10 = (y1 * width + x0) * 4 + c;
        const i11 = (y1 * width + x1) * 4 + c;
        const top = (rgba[i00] ?? 0) * (1 - fx) + (rgba[i01] ?? 0) * fx;
        const bot = (rgba[i10] ?? 0) * (1 - fx) + (rgba[i11] ?? 0) * fx;
        const v = (top * (1 - fy) + bot * fy) / 255;
        const mean = MEAN[c as 0 | 1 | 2] ?? 0;
        const std = STD[c as 0 | 1 | 2] ?? 1;
        tensor[c * plane + y * size + x] = (v - mean) / std;
      }
    }
  }
  return tensor;
}

/** L2-normalise a vector; zero vectors stay zero. */
export function l2Normalize(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm < 1e-12) return values.map(() => 0);
  return values.map((v) => v / norm);
}

/**
 * Cosine similarity of two equal-length vectors.
 * @returns null when lengths differ or either is empty
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
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
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom < 1e-12) return 0;
  return dot / denom;
}

/**
 * Pool a raw ONNX output into a flat embedding.
 *
 * Accepts CLS-style `[1, tokens, dim]` (takes token 0) or already-pooled
 * `[1, dim]` / `[dim]`.
 */
export function poolEmbedding(data: Float32Array, dims: readonly number[]): number[] {
  if (dims.length === 3) {
    const dim = dims[2] ?? EMBED_DIM;
    const out = new Array<number>(dim);
    for (let i = 0; i < dim; i += 1) out[i] = data[i] ?? 0;
    return l2Normalize(out);
  }
  if (dims.length === 2) {
    const dim = dims[1] ?? data.length;
    const out = Array.from(data.slice(0, dim));
    return l2Normalize(out);
  }
  return l2Normalize(Array.from(data));
}

async function runEmbed(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<number[]> {
  const tensor = preprocessImageNet(rgba, width, height);
  const sess = await session();
  const inputName = sess.inputNames[0] ?? "pixel_values";
  const feeds = {
    [inputName]: new ort.Tensor("float32", tensor, [
      1,
      3,
      EMBED_INPUT_SIZE,
      EMBED_INPUT_SIZE,
    ]),
  };
  const results = await sess.run(feeds);
  const preferred =
    results["last_hidden_state"] ??
    results["pooler_output"] ??
    results[sess.outputNames[0] ?? ""];
  if (preferred === undefined) {
    throw new Error("DINOv2 model returned no embedding tensor");
  }
  return poolEmbedding(preferred.data as Float32Array, preferred.dims);
}

/**
 * Embed a base64 JPEG, optionally cropped to a normalised bbox.
 *
 * @throws when the model is missing or the JPEG cannot be decoded
 */
export async function embed(
  imageBase64: string,
  bbox?: NormBBox,
): Promise<EmbedResult> {
  if (!embedModelAvailable()) {
    throw new Error(
      "dinov2_vits14.onnx not found -- run scripts/install-models first",
    );
  }
  const raw = jpeg.decode(Buffer.from(imageBase64, "base64"), {
    useTArray: true,
    maxMemoryUsageInMB: 64,
  });
  let rgba = raw.data as Uint8Array;
  let width = raw.width;
  let height = raw.height;
  let cropped = false;
  if (bbox !== undefined && bbox.width > 0 && bbox.height > 0) {
    const crop = cropRgba(rgba, width, height, bbox);
    rgba = crop.data;
    width = crop.width;
    height = crop.height;
    cropped = true;
  }
  const values = await runEmbed(rgba, width, height);
  return {
    embedding: {
      model: EMBED_MODEL_VERSION,
      values,
      dim: values.length,
    },
    cropped,
    imageWidth: raw.width,
    imageHeight: raw.height,
  };
}
