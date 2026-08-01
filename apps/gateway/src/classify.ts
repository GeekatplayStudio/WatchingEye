/**
 * Thin proxy to the agent orchestrator.
 *
 * The gateway holds no AI logic: it forwards the gated event and snapshot,
 * and relays whatever validated result comes back. If the orchestrator is
 * unreachable, the result is a safe default with the reason attached — the
 * dashboard shows "unclassified", never a guess.
 */

/** A validated decision, as returned by the orchestrator's guardrails. */
export interface ValidatedDecision {
  id: string;
  object_id: string;
  risk: number;
  confidence: number;
  proposed_action: string;
  evidence: Array<{ label: string; description: string }>;
  provenance: {
    model_version: string;
    prompt_version: string;
    input_images: string[];
    timestamp: string;
  };
}

/** Who the registry decided this is. */
export interface IdentityOutcome {
  identity_id: string;
  name: string | null;
  class: string;
  is_new: boolean;
  sightings: number;
  evidence: {
    score: number;
    matched: string[];
    conflicting: string[];
    refuted_by: string | null;
    appearance_score?: number | null;
    quality?: "strong" | "ambiguous" | "weak";
  } | null;
  quality?: "strong" | "ambiguous" | "weak";
  status?: "tentative" | "confirmed";
  ambiguous?: boolean;
  camera_id?: string;
  crossed_camera?: boolean;
  cameras_seen?: string[];
  unavailableReason?: string;
}

/** Outcome of a classification attempt. */
export interface ClassifyResult {
  outcome: "action" | "safe_default";
  decision?: ValidatedDecision | null;
  identity?: IdentityOutcome | null;
  /** Identifying attributes the model reported. */
  descriptors?: Array<{ key: string; value: string }>;
  rejectionReason?: string;
  latencyMs?: number;
}

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:8085";

/** Send one gated event for classification. Never throws. */
export async function classify(event: unknown, image: string): Promise<ClassifyResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, image }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return {
        outcome: "safe_default",
        rejectionReason: `orchestrator returned ${res.status}`,
        latencyMs: Date.now() - started,
      };
    }
    return (await res.json()) as ClassifyResult;
  } catch (err) {
    return {
      outcome: "safe_default",
      rejectionReason:
        err instanceof Error
          ? `orchestrator unreachable: ${err.message}`
          : "orchestrator unreachable",
      latencyMs: Date.now() - started,
    };
  }
}
