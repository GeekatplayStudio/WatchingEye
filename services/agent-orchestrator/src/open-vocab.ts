/**
 * Open-vocab attribute scoring for breed / color (ROADMAP 6.2).
 *
 * Supplements VLM descriptors with scored labels from fixed banks — never
 * invents descriptor keys outside the closed identity list. Default path
 * uses a deterministic HSV colour histogram on the JPEG crop (no CLIP
 * weights required). Set `WATCHINGEYE_OPEN_VOCAB=stub` for CI breed hits;
 * `off` disables enrichment entirely.
 */
import jpeg from "jpeg-js";
import type { ObservedDescriptor } from "./vlm.js";
import {
  clipOpenVocabAvailable,
  OnnxClipOpenVocabScorer,
} from "./open-vocab-clip.js";

/** Provenance tag for histogram colour scoring. */
export const OPEN_VOCAB_COLOR_MODEL = "open-vocab-hsv-v1";
/** Provenance tag for the injectable stub. */
export const OPEN_VOCAB_STUB_MODEL = "open-vocab-stub-1";

/** Minimum confidence before a label is merged into descriptors. */
export const OPEN_VOCAB_FLOOR = 0.55;

/** One scored open-vocab attribute. */
export interface OpenVocabHit {
  key: "breed" | "fur_color" | "vehicle_color";
  value: string;
  confidence: number;
  modelVersion: string;
}

/** Injectable scorer — crop/JPEG in, ranked hits out. */
export interface OpenVocabScorer {
  readonly name: string;
  score(imageBase64: string, objectClass: string): Promise<OpenVocabHit[]>;
}

const DOG_BREEDS = [
  "golden_retriever",
  "labrador",
  "german_shepherd",
  "shiba",
  "poodle",
  "bulldog",
  "husky",
  "beagle",
] as const;

const FUR_COLORS = [
  "black",
  "white",
  "brown",
  "golden",
  "gray",
  "cream",
  "red",
] as const;

const VEHICLE_COLORS = [
  "black",
  "white",
  "silver",
  "gray",
  "red",
  "blue",
  "green",
  "yellow",
] as const;

/** Always-empty scorer (soft default when disabled). */
export class NoopOpenVocabScorer implements OpenVocabScorer {
  readonly name = "noop-open-vocab";
  async score(): Promise<OpenVocabHit[]> {
    return [];
  }
}

/**
 * Deterministic stub for CI — returns breed/color for dog/car with high
 * confidence so classify wiring can be tested without pixels.
 */
export class StubOpenVocabScorer implements OpenVocabScorer {
  readonly name = "stub-open-vocab";

  async score(_imageBase64: string, objectClass: string): Promise<OpenVocabHit[]> {
    if (objectClass === "dog" || objectClass === "cat") {
      return [
        {
          key: "breed",
          value: objectClass === "dog" ? "golden_retriever" : "tabby",
          confidence: 0.88,
          modelVersion: OPEN_VOCAB_STUB_MODEL,
        },
        {
          key: "fur_color",
          value: "golden",
          confidence: 0.82,
          modelVersion: OPEN_VOCAB_STUB_MODEL,
        },
      ];
    }
    if (objectClass === "car" || objectClass === "truck") {
      return [
        {
          key: "vehicle_color",
          value: "silver",
          confidence: 0.8,
          modelVersion: OPEN_VOCAB_STUB_MODEL,
        },
      ];
    }
    return [];
  }
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const COLOR_HSV: Record<string, Hsv> = {
  black: { h: 0, s: 0, v: 0.12 },
  white: { h: 0, s: 0, v: 0.95 },
  silver: { h: 0, s: 0.05, v: 0.75 },
  gray: { h: 0, s: 0.05, v: 0.45 },
  cream: { h: 40, s: 0.25, v: 0.9 },
  golden: { h: 42, s: 0.55, v: 0.75 },
  brown: { h: 25, s: 0.55, v: 0.4 },
  red: { h: 5, s: 0.75, v: 0.55 },
  blue: { h: 220, s: 0.65, v: 0.5 },
  green: { h: 120, s: 0.55, v: 0.45 },
  yellow: { h: 55, s: 0.7, v: 0.85 },
};

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max < 1e-6 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvDistance(a: Hsv, b: Hsv): number {
  const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 180;
  const ds = Math.abs(a.s - b.s);
  const dv = Math.abs(a.v - b.v);
  return Math.sqrt(dh * dh + ds * ds + dv * dv);
}

/**
 * Mean-HSV nearest colour from a fixed bank — confidence from distance.
 * Runs without ONNX; soft-returns [] on decode failure.
 */
export class ColorHistogramScorer implements OpenVocabScorer {
  readonly name = "hsv-open-vocab";

  async score(imageBase64: string, objectClass: string): Promise<OpenVocabHit[]> {
    const bank =
      objectClass === "dog" || objectClass === "cat"
        ? FUR_COLORS
        : objectClass === "car" || objectClass === "truck"
          ? VEHICLE_COLORS
          : null;
    if (bank === null || imageBase64 === "") return [];

    let mean: Hsv;
    try {
      mean = meanHsvFromJpeg(imageBase64);
    } catch {
      return [];
    }

    let best: string = bank[0]!;
    let bestDist = Infinity;
    for (const name of bank) {
      const target = COLOR_HSV[name];
      if (target === undefined) continue;
      const d = hsvDistance(mean, target);
      if (d < bestDist) {
        bestDist = d;
        best = name;
      }
    }
    // Distance ~0 → confidence 1; distance ≥1.2 → ~0.
    const confidence = Math.max(0, Math.min(1, 1 - bestDist / 1.2));
    const key = objectClass === "car" || objectClass === "truck" ? "vehicle_color" : "fur_color";
    return [
      {
        key,
        value: best,
        confidence,
        modelVersion: OPEN_VOCAB_COLOR_MODEL,
      },
    ];
  }
}

function meanHsvFromJpeg(imageBase64: string): Hsv {
  const buf = Buffer.from(imageBase64, "base64");
  const decoded = jpeg.decode(buf, { useTArray: true });
  const { data, width, height } = decoded;
  // Sample a centered 50% crop to avoid borders.
  const x0 = Math.floor(width * 0.25);
  const y0 = Math.floor(height * 0.25);
  const x1 = Math.ceil(width * 0.75);
  const y1 = Math.ceil(height * 0.75);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      sr += data[i] ?? 0;
      sg += data[i + 1] ?? 0;
      sb += data[i + 2] ?? 0;
      n += 1;
    }
  }
  if (n === 0) return { h: 0, s: 0, v: 0 };
  return rgbToHsv(sr / n, sg / n, sb / n);
}

/** Run several scorers and keep the best hit per key. */
export class CompositeOpenVocabScorer implements OpenVocabScorer {
  readonly name = "composite-open-vocab";

  constructor(private readonly scorers: OpenVocabScorer[]) {}

  async score(imageBase64: string, objectClass: string): Promise<OpenVocabHit[]> {
    const best = new Map<string, OpenVocabHit>();
    for (const scorer of this.scorers) {
      const hits = await scorer.score(imageBase64, objectClass);
      for (const hit of hits) {
        const prev = best.get(hit.key);
        if (prev === undefined || hit.confidence > prev.confidence) {
          best.set(hit.key, hit);
        }
      }
    }
    return [...best.values()];
  }
}

/**
 * Merge open-vocab hits into VLM descriptors without overwriting existing keys.
 *
 * @example
 * enrichDescriptorsFromOpenVocab([{ key: "size", value: "small" }], hits)
 */
export function enrichDescriptorsFromOpenVocab(
  existing: ObservedDescriptor[],
  hits: OpenVocabHit[],
  floor = OPEN_VOCAB_FLOOR,
): { descriptors: ObservedDescriptor[]; added: OpenVocabHit[] } {
  const seen = new Set(existing.map((d) => d.key));
  const descriptors = [...existing];
  const added: OpenVocabHit[] = [];
  for (const hit of hits) {
    if (hit.confidence < floor) continue;
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    descriptors.push({ key: hit.key, value: hit.value });
    added.push(hit);
  }
  return { descriptors, added };
}

/**
 * Default scorer: CLIP ONNX + HSV when assets exist; HSV alone otherwise;
 * stub/off via `WATCHINGEYE_OPEN_VOCAB`.
 */
export function createDefaultOpenVocabScorer(): OpenVocabScorer {
  const mode = (process.env.WATCHINGEYE_OPEN_VOCAB ?? "auto").toLowerCase();
  if (mode === "off") return new NoopOpenVocabScorer();
  if (mode === "stub") return new StubOpenVocabScorer();
  if (mode === "hsv") return new ColorHistogramScorer();
  if (clipOpenVocabAvailable()) {
    return new CompositeOpenVocabScorer([
      new OnnxClipOpenVocabScorer(),
      new ColorHistogramScorer(),
    ]);
  }
  return new ColorHistogramScorer();
}

/** Exported banks for tests / docs. */
export const OPEN_VOCAB_BANKS = {
  dogBreeds: DOG_BREEDS,
  furColors: FUR_COLORS,
  vehicleColors: VEHICLE_COLORS,
} as const;
