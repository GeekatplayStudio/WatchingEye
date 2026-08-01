/**
 * Per-frame object detection with YOLO11 via ONNX Runtime.
 *
 * This is what lets the system name things that are *not moving* — the
 * motion pipeline is blind to a parked car or a seated person by
 * construction, because a stationary object becomes background. Detection
 * here runs on the full snapshot, independent of motion.
 *
 * ADR note: the PRD placed detection in Rust. The Rust `ort` binding needs
 * an MSVC toolchain this machine deliberately does not have, while
 * `onnxruntime-node` ships prebuilt binaries; the orchestrator is already
 * the AI service, so detection lives here until the Rust path is viable.
 * The `Detector` trait remains the target interface.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-node";
import { decode as decodeYolo, type YoloDetection } from "./yolo.js";
import { estimateDistance, type DistanceEstimate } from "./distance.js";

/** Square input size YOLO11n was exported at. */
const INPUT_SIZE = 640;
/** Anchor count for a 640×640 input. */
const ANCHORS = 8400;

/** A detection enriched with a distance estimate where one is possible. */
export interface LabelledObject extends YoloDetection {
  distance: DistanceEstimate | null;
}

/** Result of one detection pass. */
export interface DetectResult {
  objects: LabelledObject[];
  modelVersion: string;
  /** Original image dimensions the boxes are normalised against. */
  imageWidth: number;
  imageHeight: number;
}

/** Locate the model file relative to the repo root. */
function modelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/vision/yolo11n.onnx");
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

/** Resolve ORT execution providers: env override, else try CUDA → DML → CPU. */
function executionProviders(): string[] {
  const raw = (process.env.WATCHINGEYE_ORT_EP ?? "auto").toLowerCase();
  if (raw === "cpu") return ["cpu"];
  if (raw === "cuda") return ["cuda", "cpu"];
  if (raw === "dml" || raw === "directml") return ["dml", "cpu"];
  return ["cuda", "dml", "cpu"];
}

/** Load the ONNX session once and reuse it. */
function session(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(modelPath(), {
    executionProviders: executionProviders(),
    graphOptimizationLevel: "all",
  });
  return sessionPromise;
}

/** Whether the model file is present (install-models downloads it). */
export function modelAvailable(): boolean {
  return existsSync(modelPath());
}

/**
 * Letterbox a decoded RGBA image into the model's square input.
 *
 * Aspect ratio is preserved with grey padding; the returned scale/offsets
 * let box coordinates be mapped back to the original image.
 */
export function letterbox(
  rgba: Uint8Array,
  width: number,
  height: number,
): { tensor: Float32Array; scale: number; padX: number; padY: number } {
  const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);
  const padX = Math.floor((INPUT_SIZE - outW) / 2);
  const padY = Math.floor((INPUT_SIZE - outH) / 2);

  const plane = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * plane).fill(0.5); // grey padding
  for (let y = 0; y < outH; y += 1) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < outW; x += 1) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const src = (srcY * width + srcX) * 4;
      const dst = (y + padY) * INPUT_SIZE + (x + padX);
      tensor[dst] = (rgba[src] ?? 0) / 255;
      tensor[plane + dst] = (rgba[src + 1] ?? 0) / 255;
      tensor[2 * plane + dst] = (rgba[src + 2] ?? 0) / 255;
    }
  }
  return { tensor, scale, padX, padY };
}

/** Map letterboxed model-space boxes back onto the original image (0..1). */
export function unletterbox(
  detections: YoloDetection[],
  width: number,
  height: number,
  scale: number,
  padX: number,
  padY: number,
): YoloDetection[] {
  return detections.map((d) => {
    const px = d.bbox.x * INPUT_SIZE;
    const py = d.bbox.y * INPUT_SIZE;
    const pw = d.bbox.width * INPUT_SIZE;
    const ph = d.bbox.height * INPUT_SIZE;
    return {
      ...d,
      bbox: {
        x: Math.max(0, (px - padX) / scale / width),
        y: Math.max(0, (py - padY) / scale / height),
        width: Math.min(1, pw / scale / width),
        height: Math.min(1, ph / scale / height),
      },
    };
  });
}

/**
 * Run detection on a base64 JPEG.
 *
 * @throws when the model is missing, the JPEG is undecodable, or inference
 *   fails — callers surface the reason rather than guessing around it.
 */
export async function detect(
  imageBase64: string,
  minConfidence = 0.4,
): Promise<DetectResult> {
  if (!modelAvailable()) {
    throw new Error("yolo11n.onnx not found — run scripts/install-models first");
  }
  const raw = jpeg.decode(Buffer.from(imageBase64, "base64"), {
    useTArray: true,
    maxMemoryUsageInMB: 64,
  });
  const { tensor, scale, padX, padY } = letterbox(raw.data, raw.width, raw.height);

  const sess = await session();
  const inputName = sess.inputNames[0] ?? "images";
  const outputName = sess.outputNames[0] ?? "output0";
  const feeds = {
    [inputName]: new ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  };
  const results = await sess.run(feeds);
  const output = results[outputName];
  if (output === undefined) {
    throw new Error(`model returned no '${outputName}' tensor`);
  }

  const detections = unletterbox(
    decodeYolo(output.data as Float32Array, ANCHORS, INPUT_SIZE, minConfidence),
    raw.width,
    raw.height,
    scale,
    padX,
    padY,
  );

  const objects: LabelledObject[] = detections.map((d) => ({
    ...d,
    distance: estimateDistance(d.class, d.bbox.height * raw.height, raw.height),
  }));

  return {
    objects,
    modelVersion: "yolo11n-onnx",
    imageWidth: raw.width,
    imageHeight: raw.height,
  };
}
