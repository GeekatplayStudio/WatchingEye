/**
 * Wake-word gate for ROADMAP V.3 (armed / chunked listen).
 *
 * Detector output is untrusted: only a validated {@link WakeDetection} may
 * open a follow-up ask/command window. Low confidence and unknown clips
 * reject — never invent a wake. Not a claim of production always-on listen.
 */

import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

/** Closed wake keyword the system may report (extend only via schema). */
export const WakeKeywordSchema = z.enum(["watchingeye"]);
export type WakeKeyword = z.infer<typeof WakeKeywordSchema>;

/** Validated wake hit with provenance. */
export const WakeDetectionSchema = z.object({
  keyword: WakeKeywordSchema,
  confidence: z.number().min(0).max(1),
  provenance: z.object({
    model_version: z.string().min(1),
    timestamp: z.string().min(1),
  }),
});
export type WakeDetection = z.infer<typeof WakeDetectionSchema>;

/** Pluggable wake detector (stub today; optional engine soft-fails). */
export interface WakeWordDetector {
  readonly name: string;
  /**
   * Score a short audio chunk. Return null when no allowlisted wake is present.
   */
  detect(bytes: Uint8Array, mimeType?: string): Promise<{
    keyword: WakeKeyword;
    confidence: number;
  } | null>;
}

/** Minimum confidence to accept a wake (mirrors audio-event gate). */
export const WAKE_MIN_CONFIDENCE = 0.7;

/**
 * Deterministic stub for CI / demos.
 *
 * - Prefix `WAKE:watchingeye` ASCII header → hit
 * - Empty / unknown bytes → null (no false wake)
 */
export class StubWakeWordDetector implements WakeWordDetector {
  readonly name = "stub";

  async detect(bytes: Uint8Array, _mimeType?: string): Promise<{
    keyword: WakeKeyword;
    confidence: number;
  } | null> {
    const head = Buffer.from(bytes.subarray(0, 64)).toString("utf8");
    const m = /^WAKE:(watchingeye)\b/i.exec(head);
    if (m === null) return null;
    const keyword = WakeKeywordSchema.parse(m[1]!.toLowerCase());
    return { keyword, confidence: 0.95 };
  }
}

/** Engine assets missing or binding not wired. */
export class WakeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WakeUnavailableError";
  }
}

/** Whether optional wake-engine weights are present on disk. */
export function wakeEngineAvailable(
  modelPath = process.env.WAKE_MODEL ?? "",
): boolean {
  return modelPath !== "" && existsSync(modelPath);
}

/**
 * Reserved live-engine adapter. Soft-fails until Porcupine/openWakeWord
 * weights + binding land in install-models — refuses rather than guessing.
 */
export class EngineWakeWordDetector implements WakeWordDetector {
  readonly name = "wake-engine";

  constructor(
    private readonly modelPath = process.env.WAKE_MODEL ?? "",
  ) {}

  async detect(_bytes: Uint8Array, _mimeType?: string): Promise<{
    keyword: WakeKeyword;
    confidence: number;
  } | null> {
    if (!wakeEngineAvailable(this.modelPath)) {
      throw new WakeUnavailableError(
        `wake engine assets missing (WAKE_MODEL); use WATCHINGEYE_WAKE=stub`,
      );
    }
    throw new WakeUnavailableError(
      "wake engine binding not wired yet — use stub fixture (WAKE:watchingeye)",
    );
  }
}

/**
 * Default detector from env.
 *
 * - `stub` — WAKE: header fixture (CI)
 * - `engine` — reserved live path (503 until assets + binding land)
 * - `auto` — stub today; will prefer engine when binding is wired + weights present
 *
 * @example
 * ```ts
 * process.env.WATCHINGEYE_WAKE = "stub";
 * const d = createWakeWordDetector();
 * ```
 */
export function createWakeWordDetector(): WakeWordDetector {
  const mode = (process.env.WATCHINGEYE_WAKE ?? "auto").toLowerCase();
  if (mode === "stub") return new StubWakeWordDetector();
  if (mode === "engine") return new EngineWakeWordDetector();
  // Soft-fail: live Porcupine/openWakeWord binding not shipped yet.
  void wakeEngineAvailable();
  return new StubWakeWordDetector();
}

/** Result of one wake attempt. */
export interface WakeResult {
  outcome: "wake" | "rejected";
  detection: WakeDetection | null;
  rejectedReason?: string;
  detector: { model: string };
  latencyMs: number;
}

/**
 * Run detector → validate → accept or reject.
 *
 * @example
 * ```ts
 * const r = await resolveWake({
 *   audioBase64: Buffer.from("WAKE:watchingeye\\n").toString("base64"),
 *   detector: new StubWakeWordDetector(),
 * });
 * ```
 */
export async function resolveWake(opts: {
  audioBase64?: string;
  mimeType?: string;
  detector: WakeWordDetector;
  now?: Date;
}): Promise<WakeResult> {
  const started = Date.now();
  const detector = { model: opts.detector.name };
  if (typeof opts.audioBase64 !== "string" || opts.audioBase64.length === 0) {
    return {
      outcome: "rejected",
      detection: null,
      rejectedReason: "audioBase64 is required",
      detector,
      latencyMs: Date.now() - started,
    };
  }

  const bytes = Uint8Array.from(Buffer.from(opts.audioBase64, "base64"));
  const raw = await opts.detector.detect(bytes, opts.mimeType);
  if (raw === null) {
    return {
      outcome: "rejected",
      detection: null,
      rejectedReason: "no wake detected",
      detector,
      latencyMs: Date.now() - started,
    };
  }
  if (raw.confidence < WAKE_MIN_CONFIDENCE) {
    return {
      outcome: "rejected",
      detection: null,
      rejectedReason: `confidence ${raw.confidence} below ${WAKE_MIN_CONFIDENCE}`,
      detector,
      latencyMs: Date.now() - started,
    };
  }

  const parsed = WakeDetectionSchema.safeParse({
    keyword: raw.keyword,
    confidence: raw.confidence,
    provenance: {
      model_version: opts.detector.name,
      timestamp: (opts.now ?? new Date()).toISOString(),
    },
  });
  if (!parsed.success) {
    return {
      outcome: "rejected",
      detection: null,
      rejectedReason: "detector output failed WakeDetection validation",
      detector,
      latencyMs: Date.now() - started,
    };
  }

  return {
    outcome: "wake",
    detection: parsed.data,
    detector,
    latencyMs: Date.now() - started,
  };
}

/**
 * Register `POST /voice/wake` on the orchestrator (transport only).
 *
 * @example
 * ```ts
 * registerWakeRoute(app, createWakeWordDetector());
 * ```
 */
export function registerWakeRoute(
  app: FastifyInstance,
  detector: WakeWordDetector,
): void {
  app.post("/voice/wake", async (req, reply) => {
    const body = req.body as { audioBase64?: string; mimeType?: string };
    try {
      const result = await resolveWake({
        audioBase64: body.audioBase64,
        mimeType: body.mimeType,
        detector,
      });
      if (result.outcome === "rejected" && result.rejectedReason === "audioBase64 is required") {
        return reply.status(400).send(result);
      }
      return result;
    } catch (err) {
      if (err instanceof WakeUnavailableError) {
        return reply.status(503).send({
          error: "wake engine unavailable",
          detail: err.message,
          hint: "set WATCHINGEYE_WAKE=stub or use the WAKE:watchingeye fixture",
        });
      }
      throw err;
    }
  });
}
