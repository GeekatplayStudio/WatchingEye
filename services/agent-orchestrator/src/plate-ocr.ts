/**
 * Plate OCR path for ANPR (ROADMAP 6.2).
 *
 * Gateway stays AI-free: OCR runs here. Providers are injectable so CI uses a
 * stub; production may enable tesseract.js (`WATCHINGEYE_OCR=tesseract`),
 * PaddleOCR sidecar (`paddle`), or cascade (`auto`). Regex over OCR text is
 * preferred; VLM/raw text is the deterministic fallback.
 */
import jpeg from "jpeg-js";
import { cropRgba, type NormBBox } from "./embed.js";
import { extractLicensePlate, type LicensePlateResult } from "./anpr.js";
import { CascadeOcrProvider, PaddleLprProvider } from "./plate-lpr.js";

/** How a plate was recovered — recorded in evidence / provenance. */
export type PlateSource = "ocr" | "regex_vlm";

/** One OCR read of a crop (untrusted until regex confirms a plate). */
export interface OcrRead {
  text: string;
  confidence: number;
  modelVersion: string;
}

/** Injectable OCR backend. */
export interface OcrProvider {
  readonly name: string;
  readText(rgba: Uint8Array, width: number, height: number): Promise<OcrRead>;
}

/** Fixed reply for unit tests — never touches a model. */
export class StubOcrProvider implements OcrProvider {
  readonly name = "stub-ocr";

  constructor(
    private readonly canned: string,
    private readonly confidence = 0.95,
  ) {}

  async readText(): Promise<OcrRead> {
    return {
      text: this.canned,
      confidence: this.confidence,
      modelVersion: "stub-ocr-1",
    };
  }
}

/** Always-empty OCR — forces regex_vlm fallback. Soft default when tesseract is off. */
export class NoopOcrProvider implements OcrProvider {
  readonly name = "noop-ocr";

  async readText(): Promise<OcrRead> {
    return { text: "", confidence: 0, modelVersion: "noop" };
  }
}

/**
 * Optional tesseract.js backend. Dynamic import so CI installs stay light when
 * the package is unused; soft-fails to empty text if load/run fails.
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract";

  async readText(rgba: Uint8Array, width: number, height: number): Promise<OcrRead> {
    try {
      const mod = (await import("tesseract.js")) as {
        recognize: (
          image: Buffer,
          lang: string,
          opts?: { logger?: (m: unknown) => void },
        ) => Promise<{ data: { text: string; confidence: number } }>;
      };
      const jpegBytes = Buffer.from(
        jpeg.encode({ data: rgba as unknown as Buffer, width, height }, 90).data,
      );
      const result = await mod.recognize(jpegBytes, "eng");
      const text = result.data.text ?? "";
      const confidence = Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100));
      return { text, confidence, modelVersion: "tesseract.js-eng" };
    } catch {
      return { text: "", confidence: 0, modelVersion: "tesseract-unavailable" };
    }
  }
}

/**
 * Lower band of a vehicle bbox where plates usually sit.
 *
 * @example
 * vehiclePlateBand({ x: 0.1, y: 0.1, width: 0.5, height: 0.6 })
 * // → { x: 0.1, y: ≈0.46, width: 0.5, height: ≈0.24 }
 */
export function vehiclePlateBand(vehicle: NormBBox, bandFraction = 0.35): NormBBox {
  const frac = Math.min(0.6, Math.max(0.15, bandFraction));
  const height = vehicle.height * frac;
  const y = vehicle.y + vehicle.height - height;
  return {
    x: clamp01(vehicle.x),
    y: clamp01(y),
    width: clamp01(vehicle.width),
    height: clamp01(height),
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Resolved plate with provenance of which stage found it. */
export interface PlateRecognition extends LicensePlateResult {
  source: PlateSource;
  ocrModel?: string;
  ocrConfidence?: number;
}

export interface RecognizePlateInput {
  /** JPEG base64 without data: prefix. */
  imageBase64: string;
  /** Optional vehicle box from YOLO (car/truck). */
  vehicleBbox?: NormBBox;
  /** VLM / descriptor haystack for regex fallback. */
  vlmText: string;
  ocr: OcrProvider;
}

/**
 * OCR the plate band (or full frame), regex-confirm, then fall back to VLM text.
 *
 * @example
 * const hit = await recognizePlate({
 *   imageBase64: "...",
 *   vlmText: "car ABC-1234",
 *   ocr: new StubOcrProvider("plate ABC-1234"),
 * });
 */
export async function recognizePlate(
  input: RecognizePlateInput,
): Promise<PlateRecognition | null> {
  const fromOcr = await readPlateFromImage(input);
  if (fromOcr !== null) return fromOcr;

  const fromVlm = extractLicensePlate(input.vlmText);
  if (fromVlm === null) return null;
  return { ...fromVlm, source: "regex_vlm" };
}

async function readPlateFromImage(
  input: RecognizePlateInput,
): Promise<PlateRecognition | null> {
  if (input.imageBase64 === "") return null;
  let decoded: { data: Uint8Array; width: number; height: number };
  try {
    const buf = Buffer.from(input.imageBase64, "base64");
    const jpegDecoded = jpeg.decode(buf, { useTArray: true });
    decoded = {
      data: jpegDecoded.data,
      width: jpegDecoded.width,
      height: jpegDecoded.height,
    };
  } catch {
    return null;
  }

  const band =
    input.vehicleBbox !== undefined
      ? vehiclePlateBand(input.vehicleBbox)
      : { x: 0, y: 0.55, width: 1, height: 0.35 };
  const crop = cropRgba(decoded.data, decoded.width, decoded.height, band);
  const read = await input.ocr.readText(crop.data, crop.width, crop.height);
  const hit = extractLicensePlate(read.text);
  if (hit === null) return null;
  return {
    ...hit,
    source: "ocr",
    ocrModel: read.modelVersion,
    ocrConfidence: read.confidence,
  };
}

/**
 * Default provider from `WATCHINGEYE_OCR`:
 * - `tesseract` — tesseract.js (soft-fail)
 * - `paddle` — Python PaddleOCR sidecar (soft-fail)
 * - `auto` — paddle then tesseract cascade
 * - otherwise — noop (regex_vlm still works)
 */
export function createDefaultOcrProvider(): OcrProvider {
  const mode = (process.env.WATCHINGEYE_OCR ?? "").toLowerCase();
  if (mode === "tesseract") return new TesseractOcrProvider();
  if (mode === "paddle") return new PaddleLprProvider();
  if (mode === "auto") {
    return new CascadeOcrProvider([
      new PaddleLprProvider(),
      new TesseractOcrProvider(),
    ]);
  }
  return new NoopOcrProvider();
}
