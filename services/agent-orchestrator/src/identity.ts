/**
 * Client for the engine's identity registry.
 *
 * The matching itself lives in Rust (`crates/identity`) so that "is this the
 * same individual" stays deterministic and replayable. This module only
 * carries observed attributes (and optional appearance embeddings) across
 * and relays the verdict; it makes no identity decision of its own, and a
 * failure here degrades to "not identified" rather than to a guess.
 */
import type { ObservedDescriptor } from "./vlm.js";
import type { AppearanceEmbedding } from "./embed.js";

/** How confidently a sighting matched (REMIND-style gating). */
export type MatchQuality = "strong" | "ambiguous" | "weak";

/** Lifecycle stage of an identity. */
export type IdentityStatus = "tentative" | "confirmed";

/** Which attributes agreed or conflicted for one candidate. */
export interface MatchReport {
  identity_id: string;
  score: number;
  matched: string[];
  conflicting: string[];
  refuted_by: string | null;
  appearance_score?: number | null;
  quality?: MatchQuality;
}

/** The registry's verdict on a sighting. */
export interface IdentificationOutcome {
  identity_id: string;
  name: string | null;
  class: string;
  is_new: boolean;
  sightings: number;
  evidence: MatchReport | null;
  rejected: MatchReport[];
  quality?: MatchQuality;
  status?: IdentityStatus;
  ambiguous?: boolean;
  camera_id?: string;
  crossed_camera?: boolean;
  cameras_seen?: string[];
  /** Set when the registry could not be reached. */
  unavailableReason?: string;
}

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8090";

/**
 * Attribute a sighting to a known identity.
 *
 * Never throws: if the engine is unreachable the caller gets an outcome
 * marked unavailable, so a missing registry can never be mistaken for
 * "this is a stranger".
 *
 * @example
 * const out = await identify("dog", [{ key: "breed", value: "shiba" }], "cam-1");
 */
export async function identify(
  objectClass: string,
  descriptors: ObservedDescriptor[],
  cameraId: string,
  appearance?: AppearanceEmbedding | null,
): Promise<IdentificationOutcome | null> {
  try {
    const body = sightingBody(objectClass, descriptors, cameraId, appearance);
    const res = await fetch(`${ENGINE_URL}/api/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return unavailable(objectClass, `identity registry returned ${res.status}`);
    }
    return (await res.json()) as IdentificationOutcome;
  } catch (err) {
    return unavailable(
      objectClass,
      err instanceof Error ? `identity registry unreachable: ${err.message}` : "registry error",
    );
  }
}

/** One sighting offered to the batch endpoint. */
export interface BatchSighting {
  class: string;
  descriptors?: ObservedDescriptor[];
  cameraId: string;
  appearance?: AppearanceEmbedding | null;
}

/**
 * Attribute many sightings in one Hungarian pass.
 *
 * Same-class detections cannot claim the same identity. Never throws —
 * unreachable registry yields unavailable outcomes aligned to input order.
 *
 * @example
 * const outs = await identifyBatch([
 *   { class: "person", cameraId: "cam-1", appearance: embA },
 *   { class: "person", cameraId: "cam-1", appearance: embB },
 * ]);
 */
export async function identifyBatch(
  sightings: BatchSighting[],
): Promise<IdentificationOutcome[]> {
  if (sightings.length === 0) return [];
  try {
    const res = await fetch(`${ENGINE_URL}/api/identify/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sightings: sightings.map((s) =>
          sightingBody(s.class, s.descriptors ?? [], s.cameraId, s.appearance),
        ),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return sightings.map((s) =>
        unavailable(s.class, `identity registry returned ${res.status}`),
      );
    }
    const body = (await res.json()) as { outcomes?: IdentificationOutcome[] };
    const outcomes = body.outcomes ?? [];
    if (outcomes.length !== sightings.length) {
      return sightings.map((s, i) => outcomes[i] ?? unavailable(s.class, "batch size mismatch"));
    }
    return outcomes;
  } catch (err) {
    const reason =
      err instanceof Error ? `identity registry unreachable: ${err.message}` : "registry error";
    return sightings.map((s) => unavailable(s.class, reason));
  }
}

function sightingBody(
  objectClass: string,
  descriptors: ObservedDescriptor[],
  cameraId: string,
  appearance?: AppearanceEmbedding | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    class: objectClass,
    descriptors,
    camera_id: cameraId,
  };
  if (appearance !== undefined && appearance !== null && appearance.values.length > 0) {
    body.appearance = {
      model: appearance.model,
      values: appearance.values,
    };
  }
  return body;
}

function unavailable(objectClass: string, reason: string): IdentificationOutcome {
  return {
    identity_id: "",
    name: null,
    class: objectClass,
    is_new: false,
    sightings: 0,
    evidence: null,
    rejected: [],
    quality: "weak",
    status: "tentative",
    ambiguous: false,
    camera_id: "",
    crossed_camera: false,
    cameras_seen: [],
    unavailableReason: reason,
  };
}
