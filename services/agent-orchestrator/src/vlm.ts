/**
 * Vision-language classification of a gated event.
 *
 * This runs only after the deterministic pipeline has already decided
 * something is there — never per frame. The model's job is narrow: name what
 * it sees and justify it. Everything it returns is untrusted until the
 * guardrail node validates it.
 */
import { randomUUID } from "node:crypto";
import type { LlmProvider } from "./llm.js";
import type { TriggerEvent } from "./schema.js";

/** Prompt version — recorded in provenance on every decision. */
export const PROMPT_VERSION = "classify-v1";

/** Classes the model is allowed to choose from. Anything else is rejected
 *  downstream, so the list is the contract, not a suggestion. */
export const ALLOWED_CLASSES = [
  "person",
  "dog",
  "cat",
  "bird",
  "car",
  "truck",
  "bicycle",
  "package",
  "unknown",
] as const;

/**
 * Build the prompt. Deliberately rigid: the model is told the exact JSON
 * shape, the closed class list, and that it must not invent an action.
 */
export function buildPrompt(event: TriggerEvent): string {
  return [
    "You are a surveillance scene classifier. Look at the image and identify",
    "the most prominent moving subject.",
    "",
    `The motion tracker already detected an object at region ${event.snapshotRef}`,
    `on camera "${event.cameraId}".`,
    "",
    "Reply with ONLY a JSON object, no prose, no markdown fence.",
    "",
    "Here is a correctly-formed example for a different scene — copy its",
    "shape, never its contents:",
    JSON.stringify(
      {
        object_class: "person",
        confidence: 0.96,
        risk: 0.2,
        evidence: [
          { label: "blue_jacket", description: "Subject wearing a blue jacket" },
          { label: "walking_left", description: "Moving left across the frame" },
        ],
        proposed_action: "notify",
      },
      null,
      2,
    ),
    "",
    `Rules, all enforced after you reply:`,
    `- object_class must be one of ${JSON.stringify(ALLOWED_CLASSES)}.`,
    "- Every evidence label must describe something you actually see, in",
    "  snake_case. Labels are rejected if repeated or if they restate these",
    "  instructions.",
    "- risk above 0.7 requires at least two distinct evidence items.",
    "- confidence must be at least 0.95 or the reply is discarded, so answer",
    '  "unknown" with genuine low confidence rather than guessing high.',
    '- proposed_action must be "notify" or "log_only".',
  ].join("\n");
}

/** What the model is asked to return, before validation. */
interface RawClassification {
  object_class?: unknown;
  confidence?: unknown;
  risk?: unknown;
  evidence?: unknown;
  proposed_action?: unknown;
}

/**
 * Convert the model's reply into the `AgentDecision` shape the guardrails
 * expect, attaching provenance. Malformed input is passed through as-is so
 * the guardrail node — not this function — makes the reject decision.
 */
export function toDecisionJson(
  raw: string,
  event: TriggerEvent,
  modelVersion: string,
): string {
  let parsed: RawClassification;
  try {
    // Models sometimes wrap JSON in a markdown fence despite instructions.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
    parsed = JSON.parse(cleaned) as RawClassification;
  } catch {
    return raw; // let the guardrail reject it, with the original text logged
  }

  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  return JSON.stringify({
    id: randomUUID(),
    object_id: toUuid(event.objectId),
    risk: parsed.risk,
    evidence: [
      ...evidence,
      // The model's own class claim is recorded as evidence so the
      // classification-lock guardrail can check it against the pipeline.
      ...(typeof parsed.object_class === "string"
        ? [
            {
              label: `class:${parsed.object_class}`,
              description: `Model classified the tracked object as ${parsed.object_class}`,
            },
          ]
        : []),
    ],
    confidence: parsed.confidence,
    proposed_action: parsed.proposed_action,
    provenance: {
      model_version: modelVersion,
      prompt_version: PROMPT_VERSION,
      input_images: [event.snapshotRef],
      timestamp: new Date().toISOString(),
    },
  });
}

/** Tracker ids are opaque strings; the decision schema wants a UUID. */
function toUuid(id: string): string {
  return /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
}

/**
 * Build an analyzer for the agent graph, bound to a provider and an image.
 *
 * @param provider the LLM/VLM backend (injected, so tests need no network)
 * @param imageBase64 the snapshot, base64 without a data: prefix
 */
export function makeVlmAnalyzer(provider: LlmProvider, imageBase64: string) {
  return async (event: TriggerEvent): Promise<string> => {
    const res = await provider.complete({
      promptVersion: PROMPT_VERSION,
      prompt: buildPrompt(event),
      images: imageBase64 === "" ? [] : [imageBase64],
      jsonMode: true,
    });
    return toDecisionJson(res.text, event, res.modelVersion);
  };
}
