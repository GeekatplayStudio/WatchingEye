/**
 * Live openWakeWord ONNX wake detector (ROADMAP V.3 engine).
 *
 * Mel → embedding → classifier via `onnxruntime-node`. Scores are untrusted:
 * only allowlisted classifier basenames may map to {@link WakeKeyword};
 * low / missing scores return null. Soft-fails when assets are absent.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { decodeWavMono } from "./yamnet-audio-event.js";
import { WakeKeywordSchema, type WakeKeyword } from "./wake-schema.js";
import type { WakeWordDetector } from "./wake-word.js";

function unavailable(message: string): never {
  const err = new Error(message);
  err.name = "WakeUnavailableError";
  throw err;
}

const SAMPLE_RATE = 16_000;
const MEL_WINDOW = 76;
const MEL_STEP = 8;
const MEL_BINS = 32;
const EMBED_DIM = 96;
/** hey_jarvis_v0.1 classifier frames (model input dim 1). */
const CLS_FRAMES = 16;

/** Default feature + classifier directory from `scripts/install-models`. */
export function defaultOpenWakeWordDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/voice/openwakeword");
}

export function defaultMelPath(): string {
  return path.join(defaultOpenWakeWordDir(), "melspectrogram.onnx");
}

export function defaultEmbeddingPath(): string {
  return path.join(defaultOpenWakeWordDir(), "embedding_model.onnx");
}

/** Default downloadable classifier (honest keyword: hey_jarvis, not watchingeye). */
export function defaultWakeModelPath(): string {
  return (
    process.env.WAKE_MODEL ??
    path.join(defaultOpenWakeWordDir(), "hey_jarvis_v0.1.onnx")
  );
}

/**
 * Map classifier filename → closed keyword. Never invent: unknown stems → null.
 *
 * @example
 * ```ts
 * keywordFromModelPath("…/hey_jarvis_v0.1.onnx"); // "hey_jarvis"
 * ```
 */
export function keywordFromModelPath(modelPath: string): WakeKeyword | null {
  const stem = path.basename(modelPath, path.extname(modelPath)).toLowerCase();
  const normalized = stem.replace(/_v\d+(?:\.\d+)*$/, "");
  const parsed = WakeKeywordSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

/** Mel + embedding + allowlisted classifier all present. */
export function openWakeWordAssetsAvailable(
  classifierPath = defaultWakeModelPath(),
  melPath = process.env.WAKE_MEL_MODEL ?? defaultMelPath(),
  embeddingPath = process.env.WAKE_EMBED_MODEL ?? defaultEmbeddingPath(),
): boolean {
  return (
    existsSync(classifierPath) &&
    existsSync(melPath) &&
    existsSync(embeddingPath) &&
    keywordFromModelPath(classifierPath) !== null
  );
}

/**
 * openWakeWord ONNX detector. WAV @ 16 kHz mono only for the live path.
 *
 * @example
 * ```ts
 * const d = new OpenWakeWordDetector();
 * const hit = await d.detect(wavBytes, "audio/wav");
 * ```
 */
export class OpenWakeWordDetector implements WakeWordDetector {
  readonly name = "openwakeword";
  private readonly keyword: WakeKeyword | null;
  private sessions: Promise<{
    mel: ort.InferenceSession;
    emb: ort.InferenceSession;
    cls: ort.InferenceSession;
  }> | null = null;

  constructor(
    private readonly classifierPath = defaultWakeModelPath(),
    private readonly melPath = process.env.WAKE_MEL_MODEL ?? defaultMelPath(),
    private readonly embeddingPath =
      process.env.WAKE_EMBED_MODEL ?? defaultEmbeddingPath(),
  ) {
    this.keyword = keywordFromModelPath(classifierPath);
  }

  private load() {
    if (!openWakeWordAssetsAvailable(this.classifierPath, this.melPath, this.embeddingPath)) {
      try {
        unavailable(
          `openWakeWord assets missing under ${defaultOpenWakeWordDir()} (or WAKE_MODEL)`,
        );
      } catch (err) {
        return Promise.reject(err);
      }
    }
    this.sessions ??= Promise.all([
      ort.InferenceSession.create(this.melPath, { executionProviders: ["cpu"] }),
      ort.InferenceSession.create(this.embeddingPath, {
        executionProviders: ["cpu"],
      }),
      ort.InferenceSession.create(this.classifierPath, {
        executionProviders: ["cpu"],
      }),
    ]).then(([mel, emb, cls]) => ({ mel, emb, cls }));
    return this.sessions;
  }

  async detect(bytes: Uint8Array, mimeType?: string): Promise<{
    keyword: WakeKeyword;
    confidence: number;
  } | null> {
    if (this.keyword === null) {
      unavailable(
        `classifier basename not in closed WakeKeyword set: ${this.classifierPath}`,
      );
    }
    const wavOk =
      mimeType === undefined ||
      mimeType === "" ||
      mimeType.includes("wav") ||
      mimeType === "application/octet-stream";
    if (!wavOk) return null;
    const pcm = decodeWavMono(bytes, SAMPLE_RATE);
    // ~0.8 s minimum for one mel window; shorter clips → null (no guess).
    if (pcm === null || pcm.length < SAMPLE_RATE * 0.8) return null;

    const { mel, emb, cls } = await this.load();
    const score = await scoreClip(pcm, mel, emb, cls);
    if (!Number.isFinite(score) || score <= 0) return null;
    return {
      keyword: this.keyword,
      confidence: Math.min(1, Math.max(0, score)),
    };
  }
}

async function scoreClip(
  pcmFloat: Float32Array,
  mel: ort.InferenceSession,
  emb: ort.InferenceSession,
  cls: ort.InferenceSession,
): Promise<number> {
  // openWakeWord expects int16-scale float32 PCM, not [-1, 1].
  const pcm = new Float32Array(pcmFloat.length);
  for (let i = 0; i < pcmFloat.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcmFloat[i] ?? 0));
    pcm[i] = s * 32767;
  }

  const melName = mel.inputNames[0] ?? "input";
  const melOutName = mel.outputNames[0] ?? "output";
  const melOut = await mel.run({
    [melName]: new ort.Tensor("float32", pcm, [1, pcm.length]),
  });
  const melTensor = melOut[melOutName];
  if (melTensor === undefined) return 0;
  const dims = melTensor.dims;
  const tFrames = dims.length >= 3 ? (dims[dims.length - 2] ?? 0) : 0;
  const melData = melTensor.data as Float32Array;
  if (tFrames < MEL_WINDOW) return 0;

  const embeddings: Float32Array[] = [];
  for (let i = 0; i + MEL_WINDOW <= tFrames; i += MEL_STEP) {
    const window = new Float32Array(MEL_WINDOW * MEL_BINS);
    for (let t = 0; t < MEL_WINDOW; t += 1) {
      for (let m = 0; m < MEL_BINS; m += 1) {
        const raw = melData[(i + t) * MEL_BINS + m] ?? 0;
        window[t * MEL_BINS + m] = raw / 10 + 2;
      }
    }
    const embName = emb.inputNames[0] ?? "input_1";
    const embOutName = emb.outputNames[0] ?? "conv2d_19";
    const embOut = await emb.run({
      [embName]: new ort.Tensor("float32", window, [1, MEL_WINDOW, MEL_BINS, 1]),
    });
    const e = embOut[embOutName];
    if (e === undefined) continue;
    embeddings.push(Float32Array.from(e.data as Float32Array));
  }
  if (embeddings.length === 0) return 0;

  let best = 0;
  const starts =
    embeddings.length <= CLS_FRAMES
      ? [0]
      : Array.from({ length: embeddings.length - CLS_FRAMES + 1 }, (_, i) => i);
  for (const start of starts) {
    const feats = new Float32Array(CLS_FRAMES * EMBED_DIM);
    if (embeddings.length <= CLS_FRAMES) {
      const pad = CLS_FRAMES - embeddings.length;
      for (let i = 0; i < CLS_FRAMES; i += 1) {
        const srcIdx = i - pad;
        const src = srcIdx >= 0 ? embeddings[srcIdx] : undefined;
        if (src !== undefined) feats.set(src, i * EMBED_DIM);
      }
    } else {
      for (let i = 0; i < CLS_FRAMES; i += 1) {
        const src = embeddings[start + i];
        if (src !== undefined) feats.set(src, i * EMBED_DIM);
      }
    }
    const clsName = cls.inputNames[0] ?? "x.1";
    const clsOutName = cls.outputNames[0] ?? "53";
    const out = await cls.run({
      [clsName]: new ort.Tensor("float32", feats, [1, CLS_FRAMES, EMBED_DIM]),
    });
    const score = Number((out[clsOutName]?.data as Float32Array | undefined)?.[0] ?? 0);
    if (score > best) best = score;
  }
  return best;
}
