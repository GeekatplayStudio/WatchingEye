/**
 * CLIP ViT-B/32 open-vocab scorer (optional ONNX weights).
 *
 * Soft-fails when `clip_vit_b32_vision.onnx` or text-embed JSON is missing —
 * HSV colour scoring in `open-vocab.ts` remains the required-path fallback.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-node";
import type { OpenVocabHit, OpenVocabScorer } from "./open-vocab.js";

export const CLIP_OPEN_VOCAB_MODEL = "clip-vit-b32-onnx";
export const CLIP_EMBED_DIM = 512;
export const CLIP_INPUT_SIZE = 224;

/** CLIP normalisation (differs from ImageNet). */
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711] as const;

function visionDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../../models/vision");
}

export function clipVisionPath(): string {
  return join(visionDir(), "clip_vit_b32_vision.onnx");
}

export function clipTextEmbedsPath(): string {
  return join(visionDir(), "open_vocab_text_embeds.json");
}

/** Whether CLIP open-vocab assets are on disk. */
export function clipOpenVocabAvailable(): boolean {
  return existsSync(clipVisionPath()) && existsSync(clipTextEmbedsPath());
}

type TextBank = Record<string, number[]>;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let textBank: TextBank | null = null;

function loadTextBank(): TextBank | null {
  if (textBank !== null) return textBank;
  try {
    textBank = JSON.parse(readFileSync(clipTextEmbedsPath(), "utf8")) as TextBank;
    return textBank;
  } catch {
    return null;
  }
}

function session(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(clipVisionPath(), {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  return sessionPromise;
}

function cosine(a: number[], b: number[]): number {
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

function keysForClass(objectClass: string): string[] {
  if (objectClass === "dog" || objectClass === "cat") {
    return ["breed:", "fur_color:"];
  }
  if (objectClass === "car" || objectClass === "truck") {
    return ["vehicle_color:"];
  }
  return [];
}

/**
 * Zero-shot CLIP scorer over precomputed bank prompts.
 *
 * @example
 * if (clipOpenVocabAvailable()) await new OnnxClipOpenVocabScorer().score(b64, "dog");
 */
export class OnnxClipOpenVocabScorer implements OpenVocabScorer {
  readonly name = "clip-open-vocab";

  async score(imageBase64: string, objectClass: string): Promise<OpenVocabHit[]> {
    if (!clipOpenVocabAvailable() || imageBase64 === "") return [];
    const prefixes = keysForClass(objectClass);
    if (prefixes.length === 0) return [];

    const bank = loadTextBank();
    if (bank === null) return [];

    let decoded: { data: Uint8Array; width: number; height: number };
    try {
      const jpegDecoded = jpeg.decode(Buffer.from(imageBase64, "base64"), {
        useTArray: true,
      });
      decoded = {
        data: jpegDecoded.data,
        width: jpegDecoded.width,
        height: jpegDecoded.height,
      };
    } catch {
      return [];
    }

    let imageVec: number[];
    try {
      const tensor = preprocessClip(decoded.data, decoded.width, decoded.height);
      const sess = await session();
      const inputName = sess.inputNames[0] ?? "pixel_values";
      const feeds: Record<string, ort.Tensor> = {
        [inputName]: new ort.Tensor("float32", tensor, [1, 3, CLIP_INPUT_SIZE, CLIP_INPUT_SIZE]),
      };
      const out = await sess.run(feeds);
      const outName = sess.outputNames[0] ?? "image_embeds";
      const data = out[outName]?.data;
      if (data === undefined) return [];
      imageVec = Array.from(data as Float32Array);
    } catch {
      return [];
    }

    const bestByKey = new Map<string, OpenVocabHit>();
    for (const [label, textVec] of Object.entries(bank)) {
      const prefix = prefixes.find((p) => label.startsWith(p));
      if (prefix === undefined) continue;
      const key = prefix.slice(0, -1) as OpenVocabHit["key"];
      const value = label.slice(prefix.length);
      const score = cosine(imageVec, textVec);
      // CLIP cosine is often ~0.2–0.35 for matches; map into [0,1] softly.
      const confidence = Math.max(0, Math.min(1, (score + 0.1) / 0.5));
      const prev = bestByKey.get(key);
      if (prev === undefined || confidence > prev.confidence) {
        bestByKey.set(key, {
          key,
          value,
          confidence,
          modelVersion: CLIP_OPEN_VOCAB_MODEL,
        });
      }
    }
    return [...bestByKey.values()];
  }
}
