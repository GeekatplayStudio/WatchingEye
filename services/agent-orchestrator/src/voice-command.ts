/**
 * STT → rule-based parse for spoken commands (ROADMAP V.1).
 *
 * Never trusts the transcript: only {@link parseTranscript}'s closed set
 * becomes a command. No LLM intent.
 */

import {
  parseTranscript,
  VoiceParseError,
  type SpeechRecognizer,
  type VoiceCommand,
} from "./voice.js";

/** Result of one voice-command attempt. */
export interface VoiceCommandResult {
  outcome: "command" | "rejected";
  transcript: string;
  command: VoiceCommand | null;
  rejectedReason?: string;
  stt: { model: string };
  latencyMs: number;
}

/**
 * Resolve a voice command from a transcript and/or audio bytes.
 *
 * Prefer `transcript` when the UI already has text (no STT). Otherwise run
 * the recognizer on `audioBase64`.
 *
 * @example
 * ```ts
 * const r = await resolveVoiceCommand({
 *   transcript: "system status",
 *   recognizer: new StubSpeechRecognizer(),
 * });
 * ```
 */
export async function resolveVoiceCommand(opts: {
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
  recognizer: SpeechRecognizer;
}): Promise<VoiceCommandResult> {
  const started = Date.now();
  const stt = { model: opts.recognizer.name };
  let transcript = opts.transcript?.trim() ?? "";

  if (transcript === "" && typeof opts.audioBase64 === "string" && opts.audioBase64.length > 0) {
    const bytes = Uint8Array.from(Buffer.from(opts.audioBase64, "base64"));
    transcript = (await opts.recognizer.transcribeFile(bytes, opts.mimeType)).trim();
  }

  if (transcript === "") {
    return {
      outcome: "rejected",
      transcript: "",
      command: null,
      rejectedReason: "transcript or audioBase64 is required",
      stt,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const command = parseTranscript(transcript);
    return {
      outcome: "command",
      transcript,
      command,
      stt,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const reason = err instanceof VoiceParseError ? err.message : "unrecognized voice command";
    return {
      outcome: "rejected",
      transcript,
      command: null,
      rejectedReason: reason,
      stt,
      latencyMs: Date.now() - started,
    };
  }
}
