/**
 * Validated facts → templated speech → TTS (ROADMAP V.2 partial).
 *
 * Free-form text is never accepted. Only {@link renderSpeech} output is spoken.
 */

import { z } from "zod";
import {
  renderSpeech,
  type SpeechSynthesizer,
  type SpokenFact,
} from "./voice.js";

const SpokenFactSchema = z.object({
  objectClass: z.string().min(1),
  cameraId: z.string().min(1),
  timestamp: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

/** Result of one speak attempt. */
export interface SpeakResult {
  outcome: "spoken" | "rejected";
  speechText: string;
  audioBase64?: string;
  mimeType?: string;
  tts: { model: string };
  latencyMs: number;
  rejectedReason?: string;
}

/**
 * Render facts with {@link renderSpeech}, then synthesize audio.
 *
 * @example
 * ```ts
 * const r = await speakFacts({
 *   facts: [{ objectClass: "dog", cameraId: "yard", timestamp: "2026-08-01T12:00:00Z", confidence: 0.9 }],
 *   synthesizer: new StubSpeechSynthesizer(),
 * });
 * ```
 */
export async function speakFacts(opts: {
  facts: unknown;
  synthesizer: SpeechSynthesizer;
}): Promise<SpeakResult> {
  const started = Date.now();
  const tts = { model: opts.synthesizer.name };
  const parsed = z.array(SpokenFactSchema).safeParse(opts.facts);
  if (!parsed.success) {
    return {
      outcome: "rejected",
      speechText: "",
      tts,
      latencyMs: Date.now() - started,
      rejectedReason: "facts must be an array of SpokenFact objects",
    };
  }
  const facts: SpokenFact[] = parsed.data;
  const speechText = renderSpeech(facts);
  const wav = await opts.synthesizer.speak(speechText);
  return {
    outcome: "spoken",
    speechText,
    audioBase64: Buffer.from(wav).toString("base64"),
    mimeType: "audio/wav",
    tts,
    latencyMs: Date.now() - started,
  };
}
