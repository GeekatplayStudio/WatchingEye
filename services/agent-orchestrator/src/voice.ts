/**
 * Voice module contracts: speech in, speech out — both validated.
 *
 * A transcript is untrusted input, exactly like model output. It is parsed
 * into a closed `VoiceCommand` set; anything unrecognized is rejected rather
 * than guessed at. Spoken responses are rendered from validated data, never
 * from free-form model text (PRD: zero black box).
 */
import { z } from "zod";

/** The closed set of spoken commands the system accepts. */
export const VoiceCommandSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("show_camera"), cameraId: z.string().min(1) }),
  z.object({ intent: z.literal("set_mode"), mode: z.enum(["armed", "disarmed", "night"]) }),
  z.object({ intent: z.literal("query_events"), window: z.enum(["today", "hour", "week"]) }),
  z.object({ intent: z.literal("status") }),
]);

export type VoiceCommand = z.infer<typeof VoiceCommandSchema>;

/** Why a transcript did not become a command. */
export class VoiceParseError extends Error {
  constructor(readonly transcript: string) {
    super(`unrecognized voice command: "${transcript}"`);
    this.name = "VoiceParseError";
  }
}

/** Speech-to-text backend (Whisper in production; stub in CI). */
export interface SpeechRecognizer {
  /** Backend id for provenance (`stub` / `whisper-cli`). */
  readonly name: string;
  /** Transcribe 16 kHz mono PCM audio. */
  transcribe(audio: Float32Array): Promise<string>;
  /** Transcribe uploaded file bytes (wav/webm). */
  transcribeFile(bytes: Uint8Array, mimeType?: string): Promise<string>;
}

/** Text-to-speech backend (Piper in production). */
export interface SpeechSynthesizer {
  /** Render text to audio bytes. */
  speak(text: string): Promise<Uint8Array>;
}

const CAMERA_WORDS: Record<string, string> = {
  driveway: "driveway",
  backyard: "backyard",
  "back yard": "backyard",
  porch: "porch",
  "front porch": "porch",
};

/**
 * Parse a transcript into a validated command.
 *
 * Intentionally rule-based, not model-based: an LLM must never decide what
 * the operator asked for, because that decision actuates the system.
 *
 * @throws {VoiceParseError} when the transcript matches no known command.
 */
export function parseTranscript(transcript: string): VoiceCommand {
  const text = transcript.toLowerCase().trim();

  if (/\b(show|display|open|pull up)\b/.test(text)) {
    for (const [phrase, cameraId] of Object.entries(CAMERA_WORDS)) {
      if (text.includes(phrase)) {
        return VoiceCommandSchema.parse({ intent: "show_camera", cameraId });
      }
    }
  }
  if (/\barm(ed)?\b/.test(text) && !/\bdisarm/.test(text)) {
    return VoiceCommandSchema.parse({ intent: "set_mode", mode: "armed" });
  }
  if (/\bdisarm(ed)?\b/.test(text)) {
    return VoiceCommandSchema.parse({ intent: "set_mode", mode: "disarmed" });
  }
  if (/\bnight mode\b/.test(text)) {
    return VoiceCommandSchema.parse({ intent: "set_mode", mode: "night" });
  }
  if (/\b(who|what|anything)\b/.test(text)) {
    const window = text.includes("week") ? "week" : text.includes("hour") ? "hour" : "today";
    return VoiceCommandSchema.parse({ intent: "query_events", window });
  }
  if (/\bstatus\b|\bsystem check\b/.test(text)) {
    return VoiceCommandSchema.parse({ intent: "status" });
  }
  throw new VoiceParseError(transcript);
}

/** A fact the system may speak, with the evidence that justifies it. */
export interface SpokenFact {
  objectClass: string;
  cameraId: string;
  timestamp: string;
  confidence: number;
}

/**
 * Render validated facts into speech text.
 *
 * Templated on purpose: every spoken sentence is traceable to specific
 * records, so the system can never "say something the data doesn't support".
 */
export function renderSpeech(facts: SpokenFact[]): string {
  if (facts.length === 0) {
    return "No detections to report.";
  }
  const parts = facts.slice(0, 3).map((f) => {
    const time = new Date(f.timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${f.objectClass} at the ${f.cameraId} at ${time}`;
  });
  const more = facts.length > 3 ? `, and ${facts.length - 3} more` : "";
  return `Detected ${parts.join(", ")}${more}.`;
}
