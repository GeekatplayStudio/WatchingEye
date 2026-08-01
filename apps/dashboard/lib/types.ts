/** Types mirrored from the gateway (which mirrors the Rust schemas). */

/** Object classes the VLM may assign. */
export type ObjectClass =
  | "person"
  | "dog"
  | "cat"
  | "bird"
  | "car"
  | "truck"
  | "bicycle"
  | "package"
  | "unknown";

/** Provenance attached when the Super Agent produced a decision. */
export interface EventProvenance {
  model_version: string;
  prompt_version: string;
  input_images: string[];
  timestamp: string;
}

/** Identity verdict when the registry recognised the subject. */
export interface EventIdentity {
  id: string;
  name: string | null;
  isNew: boolean;
  sightings: number;
  score?: number;
  matched?: string[];
  quality?: "strong" | "ambiguous" | "weak";
  status?: "tentative" | "confirmed";
  ambiguous?: boolean;
  cameraId?: string;
  crossedCamera?: boolean;
  camerasSeen?: string[];
}

export interface DetectionEvent {
  id: string;
  objectId: string;
  class: string;
  kind: string;
  zone?: string;
  confidence: number;
  frames: number[];
  cameraId: string;
  timestamp: string;
  evidence: Array<{ label: string; description: string }>;
  model: string;
  promptVersion?: string;
  risk?: number;
  rejectedReason?: string;
  /** True when class is outside the operator's tracked set — recorded, not alerted. */
  filtered?: boolean;
  /** Identifying attributes reported for this sighting. */
  descriptors?: Array<{ key: string; value: string }>;
  /** Who this is, when the identity registry recognised it. */
  identity?: EventIdentity;
  /** Full provenance when the gateway stores it (model + prompt versions). */
  provenance?: EventProvenance;
  source: "engine";
}

export interface Settings {
  minDetectionConfidence: number;
  gateMinConfidence: number;
  gateConsecutiveFrames: number;
  policyMinConfidence: number;
  allowedActions: string[];
  trackedClasses?: string[];
  activeIntent?: {
    rawPrompt: string;
    targetClasses: string[];
    attributes: string[];
    actionPolicy: string;
    datasetEnroll: boolean;
    anprEnabled: boolean;
    appliedAt: string;
  } | null;
}

export interface Camera {
  id: string;
  kind: string;
  location: string;
}