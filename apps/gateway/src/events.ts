/**
 * Event types mirrored from the Rust `schemas`/`events` crates.
 *
 * Every event in this system comes from a real camera passing the real
 * pipeline. There is no synthetic event source — if the feed is empty,
 * nothing has happened.
 */

/** Object classes the VLM may assign, mirroring `schemas::ObjectClass`. */
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

/** A detection event as shown in the dashboard live feed. */
export interface DetectionEvent {
  id: string;
  objectId: string;
  class: ObjectClass;
  kind: "detected" | "entered_zone" | "exited_zone" | "lost";
  zone?: string;
  confidence: number;
  frames: number[];
  cameraId: string;
  timestamp: string;
  /** Evidence chain — zero-black-box requirement. */
  evidence: Array<{ label: string; description: string }>;
  /** Model that produced the classification. */
  model: string;
  /** Prompt version used, for reproducibility. */
  promptVersion?: string;
  /** Risk score from the validated decision. */
  risk?: number;
  /** Set when classification was attempted and refused by the guardrails. */
  rejectedReason?: string;
  /** Who this is, when the identity registry recognised it. */
  identity?: {
    id: string;
    name: string | null;
    isNew: boolean;
    sightings: number;
    score?: number;
    matched?: string[];
  };
  /** Always "engine": events only originate from the real pipeline. */
  source: "engine";
}
