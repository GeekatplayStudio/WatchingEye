/**
 * Text-path voice ask: query_events → grounded recall → SpokenFacts (ROADMAP V.2).
 *
 * Gateway stays AI-free. Speech must come from facts via orchestrator
 * `/voice/speak` (renderSpeech), never from free-form recall prose as TTS input.
 */

import type { DatasetRecord } from "./dataset.js";
import { buildGroundedRecall, rankRecords } from "./recall.js";

/** Voice command window from orchestrator parse. */
export type VoiceQueryWindow = "today" | "hour" | "week";

/** Fact shape accepted by orchestrator `/voice/speak`. */
export interface SpokenFact {
  objectClass: string;
  cameraId: string;
  timestamp: string;
  confidence: number;
}

/** ISO bounds for a voice history window. */
export interface VoiceWindowBounds {
  since: string;
  until: string;
  label: string;
}

/**
 * Map a closed voice window to UTC bounds.
 *
 * @example
 * voiceWindowBounds("hour", new Date("2026-08-01T12:00:00Z"))
 */
export function voiceWindowBounds(
  window: VoiceQueryWindow,
  now = new Date(),
): VoiceWindowBounds {
  const until = now.toISOString();
  if (window === "hour") {
    return {
      since: new Date(now.getTime() - 3_600_000).toISOString(),
      until,
      label: "hour",
    };
  }
  if (window === "week") {
    return {
      since: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      until,
      label: "week",
    };
  }
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return { since: start.toISOString(), until: end.toISOString(), label: "today" };
}

/**
 * Dataset rows → speakable facts (capped for renderSpeech).
 *
 * @example
 * recordsToSpokenFacts(records, 3)
 */
export function recordsToSpokenFacts(records: DatasetRecord[], limit = 3): SpokenFact[] {
  return records.slice(0, Math.max(0, limit)).map((r) => ({
    objectClass: r.class,
    cameraId: r.cameraId,
    timestamp: r.timestamp,
    confidence: r.confidence,
  }));
}

/** Parse result from orchestrator `/voice/command`. */
export interface VoiceParseResult {
  outcome: "command" | "rejected";
  transcript: string;
  command: { intent: string; window?: VoiceQueryWindow; [k: string]: unknown } | null;
  rejectedReason?: string;
  stt?: { model: string };
}

/** Speak result from orchestrator `/voice/speak`. */
export interface VoiceSpeakResult {
  outcome: "spoken" | "rejected";
  speechText: string;
  audioBase64?: string;
  mimeType?: string;
  tts?: { model: string };
  rejectedReason?: string;
  latencyMs?: number;
}

/** Full ask loop result. */
export interface VoiceAskResult {
  outcome: "answered" | "rejected";
  transcript: string;
  command: VoiceParseResult["command"];
  rejectedReason?: string;
  recall?: {
    citations: string[];
    answer: string;
    since?: string;
    until?: string;
    count: number;
  };
  speak?: VoiceSpeakResult;
  latencyMs: number;
}

/**
 * Parse → recall in window → speak facts only.
 *
 * @example
 * ```ts
 * const r = await runVoiceAsk({
 *   transcript: "what happened today",
 *   parse: async (t) => voiceCommand({ transcript: t }),
 *   getRecords: () => datasetStore.getAll(500),
 *   speak: async (facts) => voiceSpeak({ facts }),
 * });
 * ```
 */
export async function runVoiceAsk(opts: {
  transcript: string;
  parse: (transcript: string) => Promise<VoiceParseResult>;
  getRecords: () => Promise<DatasetRecord[]>;
  speak: (facts: SpokenFact[]) => Promise<VoiceSpeakResult>;
  now?: Date;
  recallLimit?: number;
}): Promise<VoiceAskResult> {
  const started = Date.now();
  const transcript = opts.transcript.trim();
  if (transcript === "") {
    return {
      outcome: "rejected",
      transcript: "",
      command: null,
      rejectedReason: "transcript is required",
      latencyMs: Date.now() - started,
    };
  }

  const parsed = await opts.parse(transcript);
  if (parsed.outcome === "rejected" || parsed.command === null) {
    return {
      outcome: "rejected",
      transcript: parsed.transcript || transcript,
      command: parsed.command,
      rejectedReason: parsed.rejectedReason ?? "unrecognized voice command",
      latencyMs: Date.now() - started,
    };
  }

  if (parsed.command.intent !== "query_events") {
    return {
      outcome: "rejected",
      transcript: parsed.transcript,
      command: parsed.command,
      rejectedReason: "voice ask only supports history queries (query_events)",
      latencyMs: Date.now() - started,
    };
  }

  const window = parsed.command.window ?? "today";
  const bounds = voiceWindowBounds(window, opts.now ?? new Date());
  const all = await opts.getRecords();
  const limit = opts.recallLimit ?? 20;
  const ranked = rankRecords(all, "", limit, bounds.since, bounds.until);
  const grounded = buildGroundedRecall(ranked, bounds.label, bounds.since, bounds.until);
  const facts = recordsToSpokenFacts(grounded.records, 3);
  const speak = await opts.speak(facts);

  const recall: NonNullable<VoiceAskResult["recall"]> = {
    citations: grounded.citations,
    answer: grounded.answer,
    count: grounded.records.length,
  };
  if (grounded.since !== undefined) recall.since = grounded.since;
  if (grounded.until !== undefined) recall.until = grounded.until;

  const out: VoiceAskResult = {
    outcome: speak.outcome === "spoken" ? "answered" : "rejected",
    transcript: parsed.transcript,
    command: parsed.command,
    recall,
    speak,
    latencyMs: Date.now() - started,
  };
  if (speak.outcome === "rejected" && speak.rejectedReason !== undefined) {
    out.rejectedReason = speak.rejectedReason;
  }
  return out;
}
