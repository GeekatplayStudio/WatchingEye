/**
 * Live YAMNet ONNX audio-event detector (ROADMAP V.1).
 *
 * Soft-fails when weights are missing. Scores are untrusted: only allowlisted
 * AudioSet indices may map to closed {@link AudioEventKind} values; anything
 * else returns null (no guessing).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import {
  AudioEventKindSchema,
  type AudioEventDetector,
  type AudioEventKind,
} from "./audio-event.js";

/** Default ONNX path from `scripts/install-models`. */
export function defaultYamnetModelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/voice/yamnet.onnx");
}

/** Committed allowlist (repo asset; not the full AudioSet CSV). */
export function defaultYamnetKindMapPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../assets/yamnet_kind_map.json");
}

/** Weights or map not usable. */
export class YamnetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamnetUnavailableError";
  }
}

interface KindMapFile {
  sampleRateHz: number;
  kinds: Record<string, number[]>;
}

/** Parse the committed kind map; rejects unknown kind keys. */
export function loadYamnetKindMap(mapPath: string): {
  sampleRateHz: number;
  indexToKind: Map<number, AudioEventKind>;
} {
  if (!existsSync(mapPath)) {
    throw new YamnetUnavailableError(`kind map missing: ${mapPath}`);
  }
  const raw = JSON.parse(readFileSync(mapPath, "utf8")) as KindMapFile;
  const indexToKind = new Map<number, AudioEventKind>();
  for (const [kind, indices] of Object.entries(raw.kinds ?? {})) {
    const parsed = AudioEventKindSchema.safeParse(kind);
    if (!parsed.success) continue;
    for (const idx of indices) {
      if (Number.isInteger(idx) && idx >= 0) indexToKind.set(idx, parsed.data);
    }
  }
  if (indexToKind.size === 0) {
    throw new YamnetUnavailableError("kind map has no allowlisted indices");
  }
  return {
    sampleRateHz: raw.sampleRateHz > 0 ? raw.sampleRateHz : 16_000,
    indexToKind,
  };
}

/** Whether ONNX weights + kind map are present (CI stays on stub without them). */
export function yamnetAssetsAvailable(
  modelPath = process.env.YAMNET_MODEL ?? defaultYamnetModelPath(),
  mapPath = process.env.YAMNET_KIND_MAP ?? defaultYamnetKindMapPath(),
): boolean {
  return existsSync(modelPath) && existsSync(mapPath);
}

/**
 * Map mean class scores → closed kind when the global argmax is allowlisted.
 *
 * @example
 * ```ts
 * const kind = mapYamnetScores([0, 0.9], new Map([[1, "bark"]]));
 * // → { kind: "bark", confidence: 0.9 }
 * ```
 */
export function mapYamnetScores(
  meanScores: Float32Array | number[],
  indexToKind: Map<number, AudioEventKind>,
): { kind: AudioEventKind; confidence: number } | null {
  if (meanScores.length === 0) return null;
  let bestIdx = 0;
  let best = meanScores[0] ?? 0;
  for (let i = 1; i < meanScores.length; i += 1) {
    const v = meanScores[i] ?? 0;
    if (v > best) {
      best = v;
      bestIdx = i;
    }
  }
  const kind = indexToKind.get(bestIdx);
  if (kind === undefined) return null;
  if (!Number.isFinite(best) || best <= 0) return null;
  return { kind, confidence: Math.min(1, Math.max(0, best)) };
}

/** Decode PCM WAV → mono float32 at target rate (linear resample). */
export function decodeWavMono(
  bytes: Uint8Array,
  targetRate: number,
): Float32Array | null {
  if (bytes.length < 44) return null;
  const buf = Buffer.from(bytes);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let offset = 12;
  let channels = 1;
  let sampleRate = 16_000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (dataOffset < 0 || channels < 1) return null;
  const pcm = readPcmFloat(buf, dataOffset, dataSize, channels, bitsPerSample);
  if (pcm === null || pcm.length === 0) return null;
  if (sampleRate === targetRate) return pcm;
  return resampleLinear(pcm, sampleRate, targetRate);
}

function readPcmFloat(
  buf: Buffer,
  offset: number,
  size: number,
  channels: number,
  bits: number,
): Float32Array | null {
  const end = Math.min(buf.length, offset + size);
  if (bits === 16) {
    const frames = Math.floor((end - offset) / (2 * channels));
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels; c += 1) {
        sum += buf.readInt16LE(offset + (i * channels + c) * 2) / 32768;
      }
      out[i] = sum / channels;
    }
    return out;
  }
  if (bits === 32) {
    const frames = Math.floor((end - offset) / (4 * channels));
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels; c += 1) {
        sum += buf.readFloatLE(offset + (i * channels + c) * 4);
      }
      out[i] = sum / channels;
    }
    return out;
  }
  return null;
}

function resampleLinear(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= 0 || toRate <= 0) return pcm;
  const n = Math.max(1, Math.round((pcm.length * toRate) / fromRate));
  const out = new Float32Array(n);
  const ratio = pcm.length / n;
  for (let i = 0; i < n; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = (pcm[i0] ?? 0) * (1 - t) + (pcm[i1] ?? 0) * t;
  }
  return out;
}

function meanFrameScores(scores: ort.Tensor): Float32Array {
  const data = scores.data as Float32Array;
  const dims = scores.dims;
  if (dims.length === 1) return Float32Array.from(data);
  if (dims.length === 2) {
    const frames = dims[0] ?? 1;
    const classes = dims[1] ?? data.length;
    const out = new Float32Array(classes);
    for (let f = 0; f < frames; f += 1) {
      for (let c = 0; c < classes; c += 1) {
        out[c] = (out[c] ?? 0) + (data[f * classes + c] ?? 0);
      }
    }
    for (let c = 0; c < classes; c += 1) out[c] = (out[c] ?? 0) / frames;
    return out;
  }
  // Flatten trailing class dim.
  const classes = dims[dims.length - 1] ?? data.length;
  const frames = Math.max(1, Math.floor(data.length / classes));
  const out = new Float32Array(classes);
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < classes; c += 1) {
      out[c] = (out[c] ?? 0) + (data[f * classes + c] ?? 0);
    }
  }
  for (let c = 0; c < classes; c += 1) out[c] = (out[c] ?? 0) / frames;
  return out;
}

/**
 * YAMNet ONNX detector. Expects float32 mono waveform @ 16 kHz.
 *
 * @example
 * ```ts
 * const d = new YamnetAudioEventDetector();
 * const hit = await d.detect(wavBytes, "audio/wav");
 * ```
 */
export class YamnetAudioEventDetector implements AudioEventDetector {
  readonly name = "yamnet-onnx";
  private sessionPromise: Promise<ort.InferenceSession> | null = null;
  private readonly indexToKind: Map<number, AudioEventKind>;
  private readonly sampleRateHz: number;

  constructor(
    private readonly modelPath = process.env.YAMNET_MODEL ?? defaultYamnetModelPath(),
    mapPath = process.env.YAMNET_KIND_MAP ?? defaultYamnetKindMapPath(),
  ) {
    const map = loadYamnetKindMap(mapPath);
    this.indexToKind = map.indexToKind;
    this.sampleRateHz = map.sampleRateHz;
  }

  private session(): Promise<ort.InferenceSession> {
    if (!existsSync(this.modelPath)) {
      return Promise.reject(new YamnetUnavailableError(`model missing: ${this.modelPath}`));
    }
    this.sessionPromise ??= ort.InferenceSession.create(this.modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    return this.sessionPromise;
  }

  async detect(bytes: Uint8Array, mimeType?: string): Promise<{
    kind: AudioEventKind;
    confidence: number;
  } | null> {
    const wavOk =
      mimeType === undefined ||
      mimeType === "" ||
      mimeType.includes("wav") ||
      mimeType === "application/octet-stream";
    if (!wavOk) return null;
    const pcm = decodeWavMono(bytes, this.sampleRateHz);
    // YAMNet patch ~0.96 s; reject tiny clips rather than invent a label.
    if (pcm === null || pcm.length < this.sampleRateHz * 0.5) return null;

    const session = await this.session();
    const inputName = session.inputNames[0];
    if (inputName === undefined) {
      throw new YamnetUnavailableError("yamnet onnx has no inputs");
    }
    const dims = inputDimensions(session, inputName);
    const shape = feedShape(dims, pcm.length);
    const tensor = new ort.Tensor("float32", pcm, shape);
    let out: ort.InferenceSession.OnnxValueMapType;
    try {
      out = await session.run({ [inputName]: tensor });
    } catch {
      // Some exports want [1, N] instead of [N].
      const retry = new ort.Tensor("float32", pcm, [1, pcm.length]);
      out = await session.run({ [inputName]: retry });
    }
    const first = session.outputNames[0];
    if (first === undefined || out[first] === undefined) return null;
    return mapYamnetScores(meanFrameScores(out[first]), this.indexToKind);
  }
}

function inputDimensions(
  session: ort.InferenceSession,
  inputName: string,
): readonly (number | string)[] | undefined {
  const meta = (
    session as ort.InferenceSession & {
      inputMetadata?: Record<string, { dimensions?: readonly (number | string)[] }>;
    }
  ).inputMetadata;
  return meta?.[inputName]?.dimensions;
}

function feedShape(dims: readonly (number | string)[] | undefined, n: number): number[] {
  if (dims === undefined || dims.length === 0) return [n];
  if (dims.length === 1) return [n];
  if (dims.length === 2) {
    const a = dims[0];
    const b = dims[1];
    if (a === 1 || a === "batch" || a === "N") return [1, n];
    if (b === 1) return [n, 1];
    return [1, n];
  }
  return [n];
}
