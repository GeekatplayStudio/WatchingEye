/**
 * Client for the engine's identity registry.
 *
 * The matching itself lives in Rust (`crates/identity`) so that "is this the
 * same individual" stays deterministic and replayable. This module only
 * carries observed attributes across and relays the verdict; it makes no
 * identity decision of its own, and a failure here degrades to "not
 * identified" rather than to a guess.
 */
import type { ObservedDescriptor } from "./vlm.js";

/** Which attributes agreed or conflicted for one candidate. */
export interface MatchReport {
  identity_id: string;
  score: number;
  matched: string[];
  conflicting: string[];
  refuted_by: string | null;
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
 */
export async function identify(
  objectClass: string,
  descriptors: ObservedDescriptor[],
  cameraId: string,
): Promise<IdentificationOutcome | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class: objectClass, descriptors, camera_id: cameraId }),
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

function unavailable(objectClass: string, reason: string): IdentificationOutcome {
  return {
    identity_id: "",
    name: null,
    class: objectClass,
    is_new: false,
    sightings: 0,
    evidence: null,
    rejected: [],
    unavailableReason: reason,
  };
}
