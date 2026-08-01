/**
 * Audio-event contracts for ROADMAP V.1 (non-speech sounds).
 *
 * Model/stub output is untrusted: only the closed `AudioEventKind` set may
 * leave this module, and low confidence is rejected rather than guessed.
 */

import { z } from "zod";

/** Closed set of non-speech audio events the system may report. */
export const AudioEventKindSchema = z.enum(["glass_break", "bark", "other"]);
export type AudioEventKind = z.infer<typeof AudioEventKindSchema>;

/** Validated audio-event payload with provenance. */
export const AudioEventSchema = z.object({
  kind: AudioEventKindSchema,
  confidence: z.number().min(0).max(1),
  provenance: z.object({
    model_version: z.string().min(1),
    timestamp: z.string().min(1),
  }),
});
export type AudioEvent = z.infer<typeof AudioEventSchema>;

/** Why an audio clip did not become an event. */
export class AudioEventRejectError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AudioEventRejectError";
  }
}

/** Pluggable detector (stub today; YAMNet/similar later). */
export interface AudioEventDetector {
  readonly name: string;
  /**
   * Classify raw audio bytes. Must not invent kinds outside the closed set;
   * return null when unsure.
   */
  detect(bytes: Uint8Array, mimeType?: string): Promise<{
    kind: AudioEventKind;
    confidence: number;
  } | null>;
}

/** Minimum confidence to accept a detection (mirrors gate style). */
export const AUDIO_EVENT_MIN_CONFIDENCE = 0.7;

/**
 * Deterministic stub for CI / demos.
 *
 * - Prefix `KIND:` ASCII header selects a kind (e.g. `KIND:bark\n…`)
 * - Empty / unknown bytes → null (no false positive)
 */
export class StubAudioEventDetector implements AudioEventDetector {
  readonly name = "stub";

  async detect(bytes: Uint8Array, _mimeType?: string): Promise<{
    kind: AudioEventKind;
    confidence: number;
  } | null> {
    const head = Buffer.from(bytes.subarray(0, 64)).toString("utf8");
    const m = /^KIND:(glass_break|bark|other)\b/i.exec(head);
    if (m === null) return null;
    const kind = AudioEventKindSchema.parse(m[1]!.toLowerCase());
    return { kind, confidence: 0.95 };
  }
}

/**
 * Default detector from env (`WATCHINGEYE_AUDIO_EVENT=stub` or auto→stub).
 *
 * @example
 * ```ts
 * process.env.WATCHINGEYE_AUDIO_EVENT = "stub";
 * const d = createAudioEventDetector();
 * ```
 */
export function createAudioEventDetector(): AudioEventDetector {
  // Live YAMNet path is ROADMAP-open; always stub until then.
  void (process.env.WATCHINGEYE_AUDIO_EVENT ?? "stub");
  return new StubAudioEventDetector();
}

/** Result of one classify attempt. */
export interface AudioEventResult {
  outcome: "event" | "rejected";
  event: AudioEvent | null;
  rejectedReason?: string;
  detector: { model: string };
  latencyMs: number;
}

/**
 * Run detector → validate → accept or reject.
 *
 * @example
 * ```ts
 * const r = await resolveAudioEvent({
 *   audioBase64: Buffer.from("KIND:bark\\n").toString("base64"),
 *   detector: new StubAudioEventDetector(),
 * });
 * ```
 */
export async function resolveAudioEvent(opts: {
  audioBase64?: string;
  mimeType?: string;
  detector: AudioEventDetector;
  now?: Date;
}): Promise<AudioEventResult> {
  const started = Date.now();
  const detector = { model: opts.detector.name };
  if (typeof opts.audioBase64 !== "string" || opts.audioBase64.length === 0) {
    return {
      outcome: "rejected",
      event: null,
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
      event: null,
      rejectedReason: "no audio event detected",
      detector,
      latencyMs: Date.now() - started,
    };
  }
  if (raw.confidence < AUDIO_EVENT_MIN_CONFIDENCE) {
    return {
      outcome: "rejected",
      event: null,
      rejectedReason: `confidence ${raw.confidence} below ${AUDIO_EVENT_MIN_CONFIDENCE}`,
      detector,
      latencyMs: Date.now() - started,
    };
  }

  const parsed = AudioEventSchema.safeParse({
    kind: raw.kind,
    confidence: raw.confidence,
    provenance: {
      model_version: opts.detector.name,
      timestamp: (opts.now ?? new Date()).toISOString(),
    },
  });
  if (!parsed.success) {
    return {
      outcome: "rejected",
      event: null,
      rejectedReason: "detector output failed AudioEvent validation",
      detector,
      latencyMs: Date.now() - started,
    };
  }

  return {
    outcome: "event",
    event: parsed.data,
    detector,
    latencyMs: Date.now() - started,
  };
}
