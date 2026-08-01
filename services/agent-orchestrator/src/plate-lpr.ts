/**
 * Optional PaddleOCR / Fast-LPR plate reader (ROADMAP 6.2).
 *
 * Spawns `scripts/paddle-lpr.py` against a JPEG crop. Soft-fails to empty
 * text when Python or paddleocr is missing — tesseract / regex_vlm remain
 * the required-path fallbacks.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { extractLicensePlate } from "./anpr.js";
import type { OcrProvider, OcrRead } from "./plate-ocr.js";

export const PADDLE_LPR_MODEL = "paddle-lpr";

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../..");
}

/** Path to the soft-dependency Python sidecar. */
export function paddleLprScriptPath(): string {
  return join(repoRoot(), "scripts", "paddle-lpr.py");
}

export function paddleLprAvailable(): boolean {
  return existsSync(paddleLprScriptPath());
}

function pythonBin(): string {
  return process.env.WATCHINGEYE_PYTHON ?? "python";
}

interface PaddleJson {
  text?: string;
  confidence?: number;
  modelVersion?: string;
}

function emptyRead(version: string): OcrRead {
  return { text: "", confidence: 0, modelVersion: version };
}

/**
 * Run the Paddle sidecar with a wall-clock timeout.
 */
function runPaddleScript(imagePath: string, timeoutMs: number): Promise<OcrRead> {
  return new Promise((resolve) => {
    const script = paddleLprScriptPath();
    if (!existsSync(script)) {
      resolve(emptyRead("paddleocr-no-script"));
      return;
    }

    const child = spawn(pythonBin(), [script, "--image", imagePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;
    const finish = (read: OcrRead) => {
      if (settled) return;
      settled = true;
      resolve(read);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(emptyRead("paddleocr-timeout"));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(emptyRead("paddleocr-spawn-error"));
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
        const parsed = JSON.parse(line) as PaddleJson;
        finish({
          text: parsed.text ?? "",
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
          modelVersion: parsed.modelVersion ?? PADDLE_LPR_MODEL,
        });
      } catch {
        finish(emptyRead("paddleocr-bad-json"));
      }
    });
  });
}

/**
 * PaddleOCR via Python sidecar. Soft-empty without deps.
 *
 * @example
 * const read = await new PaddleLprProvider().readText(rgba, w, h);
 */
export class PaddleLprProvider implements OcrProvider {
  readonly name = "paddle-lpr";

  constructor(private readonly timeoutMs = 20_000) {}

  async readText(rgba: Uint8Array, width: number, height: number): Promise<OcrRead> {
    if (width <= 0 || height <= 0) return emptyRead("paddleocr-empty");
    let dir: string | undefined;
    try {
      const encoded = jpeg.encode(
        { data: rgba as unknown as Buffer, width, height },
        90,
      );
      dir = mkdtempSync(join(tmpdir(), "we-paddle-"));
      const imagePath = join(dir, "crop.jpg");
      writeFileSync(imagePath, Buffer.from(encoded.data));
      return await runPaddleScript(imagePath, this.timeoutMs);
    } catch {
      return emptyRead("paddleocr-error");
    } finally {
      if (dir !== undefined) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/**
 * Try providers in order until one yields a plate-shaped token.
 *
 * @example
 * new CascadeOcrProvider([new PaddleLprProvider(), new TesseractOcrProvider()])
 */
export class CascadeOcrProvider implements OcrProvider {
  readonly name: string;

  constructor(private readonly providers: OcrProvider[]) {
    this.name = `cascade(${providers.map((p) => p.name).join("+")})`;
  }

  async readText(rgba: Uint8Array, width: number, height: number): Promise<OcrRead> {
    let last = emptyRead("cascade-empty");
    for (const provider of this.providers) {
      const read = await provider.readText(rgba, width, height);
      last = read;
      if (extractLicensePlate(read.text) !== null) return read;
    }
    return last;
  }
}
