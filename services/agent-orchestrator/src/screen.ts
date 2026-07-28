/**
 * Policy and safety screening for the service layer.
 *
 * This is the TypeScript mirror of `crates/guardrails` (`Policy` plus
 * `safety::screen`). Schema validation alone is not enough: a model can
 * return perfectly-shaped JSON that is still unusable — low conviction,
 * fabricated evidence, echoed prompt scaffolding, or text aimed at the
 * system. Both implementations must stay in step; the checks below are
 * ordered exactly as the Rust ones.
 */
import type { AgentDecision } from "./schema.js";

/** Static policy applied to every decision. */
export interface Policy {
  /** Minimum acceptable decision confidence. */
  minConfidence: number;
  /** Actions the agent may propose; anything else is refused. */
  allowedActions: string[];
}

/** PRD defaults, matching `guardrails::Policy::default`. */
export const DEFAULT_POLICY: Policy = {
  minConfidence: 0.95,
  allowedActions: ["notify", "log_only"],
};

/** Instruction-like markers that must never appear in actionable output. */
const INJECTION_MARKERS = [
  "ignore previous",
  "ignore all previous",
  "disregard the",
  "system prompt",
  "you are now",
  "new instructions",
  "override policy",
  "developer mode",
  "sudo",
  "<script",
];

/** Placeholder tokens from the prompt template. A model echoing these is
 *  filling in scaffolding rather than describing the image. */
const PLACEHOLDER_LABELS = ["short_snake_case", "label", "string", "what you saw"];

const HIGH_RISK_THRESHOLD = 0.7;
const HIGH_RISK_MIN_EVIDENCE = 2;

/** Why a schema-valid decision was still refused. */
export class ScreenError extends Error {
  constructor(
    readonly gate: string,
    message: string,
  ) {
    super(message);
    this.name = "ScreenError";
  }
}

function scanText(field: string, text: string): void {
  const haystack = text.toLowerCase();
  for (const marker of INJECTION_MARKERS) {
    if (haystack.includes(marker)) {
      throw new ScreenError("safety", `possible prompt injection in ${field}: "${marker}"`);
    }
  }
}

/**
 * Apply every non-schema gate to a decision.
 *
 * @param decision a decision that has already passed schema validation
 * @param detectedClass what the deterministic pipeline established, which
 *   the model may describe but never overrule
 * @throws {ScreenError} naming the first gate that refused it
 */
export function screen(
  decision: AgentDecision,
  detectedClass: string,
  policy: Policy = DEFAULT_POLICY,
): AgentDecision {
  // Gate 3 — confidence floor.
  if (decision.confidence < policy.minConfidence) {
    throw new ScreenError(
      "confidence",
      `confidence ${decision.confidence} below required ${policy.minConfidence}`,
    );
  }

  // Gate 5 — action allowlist.
  if (!policy.allowedActions.includes(decision.proposed_action)) {
    throw new ScreenError(
      "action_allowlist",
      `action "${decision.proposed_action}" is not allowed`,
    );
  }

  // Gate 6 — safety screening.
  scanText("proposed_action", decision.proposed_action);
  const seen = new Set<string>();
  for (const item of decision.evidence) {
    scanText("evidence.label", item.label);
    scanText("evidence.description", item.description);
    if (seen.has(item.label)) {
      throw new ScreenError("safety", `duplicate evidence label "${item.label}"`);
    }
    seen.add(item.label);
    if (PLACEHOLDER_LABELS.includes(item.label.toLowerCase())) {
      throw new ScreenError(
        "safety",
        `evidence label "${item.label}" is prompt scaffolding, not an observation`,
      );
    }
  }
  if (decision.risk >= HIGH_RISK_THRESHOLD && decision.evidence.length < HIGH_RISK_MIN_EVIDENCE) {
    throw new ScreenError(
      "safety",
      `risk ${decision.risk} asserted with only ${decision.evidence.length} evidence item(s)`,
    );
  }

  // Gate 7 — classification lock.
  const claimed = decision.evidence
    .map((e) => e.label)
    .find((l) => l.startsWith("class:"))
    ?.slice("class:".length);
  if (
    claimed !== undefined &&
    detectedClass !== "" &&
    detectedClass !== "moving_region" &&
    claimed.toLowerCase() !== detectedClass.toLowerCase()
  ) {
    throw new ScreenError(
      "classification_lock",
      `model claims "${claimed}" but the pipeline detected "${detectedClass}"`,
    );
  }

  return decision;
}
