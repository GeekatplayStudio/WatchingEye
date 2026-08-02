/**
 * Behavior & Action Analyzer for gated video events.
 *
 * Extracts and validates human and object behaviors (e.g. looking, waving,
 * fighting, loitering, running, crouching, falling, gesturing) from VLM descriptors,
 * evidence labels, and open-vocab CLIP score banks.
 */
import { randomUUID } from "node:crypto";
import type { ObservedDescriptor } from "./vlm.js";

export const BEHAVIOR_PROMPT_VERSION = "behavior-v1";

export type BehaviorType =
  | "looking"
  | "waving"
  | "fighting"
  | "loitering"
  | "running"
  | "crouching"
  | "falling"
  | "gesturing"
  | "unknown";

export interface BehaviorObservation {
  id: string;
  targetObjectId: string;
  behavior: BehaviorType;
  confidence: number;
  intensity: number;
  evidenceLabels: string[];
  timestamp: string;
  provenance: {
    modelVersion: string;
    promptVersion: string;
    inputImages: string[];
    timestamp: string;
  };
}

/** Standard zero-shot text prompts for CLIP behavior scoring. */
export const BEHAVIOR_CLIP_PROMPTS: Record<BehaviorType, string[]> = {
  looking: [
    "a person looking around carefully",
    "a person peering closely at a door or window",
    "someone inspecting the area",
  ],
  waving: [
    "a person waving their hand in the air",
    "someone waving to signal attention",
    "a person making a hand greeting gesture",
  ],
  fighting: [
    "two people in a physical fight or brawl",
    "a person punching, kicking, or attacking someone",
    "people wrestling and violently struggling",
  ],
  loitering: [
    "a person standing around idling for a long time",
    "someone pacing slowly in a restricted space",
    "a person waiting suspiciously",
  ],
  running: [
    "a person sprinting fast or running away",
    "someone running urgently across the camera",
  ],
  crouching: [
    "a person crouching low to the ground",
    "someone sneaking while bent over",
  ],
  falling: [
    "a person falling down onto the ground or floor",
    "someone collapsing or slipping backwards",
  ],
  gesturing: [
    "a person pointing with their finger or arm",
    "someone making active arm motions",
  ],
  unknown: ["a person standing normally with no specific behavior"],
};

/**
 * Extract behavior classification from extracted VLM descriptors.
 */
export function extractBehaviorFromDescriptors(
  descriptors: ObservedDescriptor[],
): { behavior: BehaviorType; rawValue: string } | null {
  for (const desc of descriptors) {
    const key = desc.key.toLowerCase();
    if (key === "behavior" || key === "posture" || key === "gesture") {
      const val = desc.value.toLowerCase();
      if (val.includes("fight") || val.includes("brawl") || val.includes("punch") || val.includes("attack")) {
        return { behavior: "fighting", rawValue: desc.value };
      }
      if (val.includes("wave") || val.includes("waving") || val.includes("hand_up")) {
        return { behavior: "waving", rawValue: desc.value };
      }
      if (val.includes("look") || val.includes("peer") || val.includes("inspect")) {
        return { behavior: "looking", rawValue: desc.value };
      }
      if (val.includes("loiter") || val.includes("linger") || val.includes("pace")) {
        return { behavior: "loitering", rawValue: desc.value };
      }
      if (val.includes("run") || val.includes("sprint") || val.includes("flee")) {
        return { behavior: "running", rawValue: desc.value };
      }
      if (val.includes("crouch") || val.includes("sneak") || val.includes("bend")) {
        return { behavior: "crouching", rawValue: desc.value };
      }
      if (val.includes("fall") || val.includes("collapse") || val.includes("slip")) {
        return { behavior: "falling", rawValue: desc.value };
      }
      if (val.includes("gesture") || val.includes("point") || val.includes("signal")) {
        return { behavior: "gesturing", rawValue: desc.value };
      }
    }
  }
  return null;
}

/**
 * Analyze behavior for a gated event given evidence items, descriptors, and model provenance.
 */
export function analyzeBehavior(params: {
  objectId: string;
  evidence: Array<{ label: string; description: string }>;
  descriptors: ObservedDescriptor[];
  snapshotRef: string;
  modelVersion?: string;
}): BehaviorObservation {
  const extracted = extractBehaviorFromDescriptors(params.descriptors);
  let behavior: BehaviorType = extracted ? extracted.behavior : "unknown";
  const evidenceLabels: string[] = params.evidence.map((e) => e.label.toLowerCase());

  // Also check evidence labels if descriptors didn't yield a direct match
  if (behavior === "unknown") {
    for (const label of evidenceLabels) {
      if (label.includes("fight") || label.includes("brawl") || label.includes("punch")) {
        behavior = "fighting";
        break;
      }
      if (label.includes("wave") || label.includes("waving")) {
        behavior = "waving";
        break;
      }
      if (label.includes("look") || label.includes("peer") || label.includes("gaze")) {
        behavior = "looking";
        break;
      }
      if (label.includes("loiter") || label.includes("pace")) {
        behavior = "loitering";
        break;
      }
      if (label.includes("run") || label.includes("sprint")) {
        behavior = "running";
        break;
      }
      if (label.includes("crouch") || label.includes("sneak")) {
        behavior = "crouching";
        break;
      }
      if (label.includes("fall") || label.includes("collapse")) {
        behavior = "falling";
        break;
      }
      if (label.includes("gesture") || label.includes("point")) {
        behavior = "gesturing";
        break;
      }
    }
  }

  // Calculate confidence and intensity scores based on evidence count and behavior risk profile
  let confidence = behavior === "unknown" ? 0.5 : 0.9;
  let intensity = 0.5;

  if (behavior === "fighting") {
    intensity = 0.95;
    confidence = Math.min(1.0, confidence + (evidenceLabels.length > 1 ? 0.05 : 0.0));
  } else if (behavior === "falling" || behavior === "running") {
    intensity = 0.85;
  } else if (behavior === "waving" || behavior === "gesturing") {
    intensity = 0.75;
  } else if (behavior === "looking" || behavior === "loitering") {
    intensity = 0.6;
  }

  const timestamp = new Date().toISOString();
  return {
    id: randomUUID(),
    targetObjectId: params.objectId,
    behavior,
    confidence,
    intensity,
    evidenceLabels: evidenceLabels.length > 0 ? evidenceLabels : ["behavior_analysis"],
    timestamp,
    provenance: {
      modelVersion: params.modelVersion ?? "behavior-analyzer-v1",
      promptVersion: BEHAVIOR_PROMPT_VERSION,
      inputImages: [params.snapshotRef],
      timestamp,
    },
  };
}
