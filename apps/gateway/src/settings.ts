/**
 * Tunable system settings, editable from the dashboard.
 * Mirrors `tracker::TriggerGate` and `guardrails::Policy` in Rust.
 * Persisted to Postgres when available; in-memory otherwise.
 */

/** All dashboard-tunable knobs. */
export interface Settings {
  /** Minimum detection confidence to pass the confidence validator. */
  minDetectionConfidence: number;
  /** TriggerGate: minimum confidence before the super agent may run. */
  gateMinConfidence: number;
  /** TriggerGate: required consecutive frames. */
  gateConsecutiveFrames: number;
  /** Guardrails: minimum decision confidence. */
  policyMinConfidence: number;
  /** Guardrails: allowed actions. */
  allowedActions: string[];
  /**
   * Classes the operator cares about. A sighting classified as something not
   * on this list is still recorded — it happened — but is marked filtered so
   * it does not alert or clutter the feed. Filtering is presentation, never
   * suppression: nothing is silently discarded.
   */
  trackedClasses: string[];
}

/** Every class the system can be asked to watch for. */
export const AVAILABLE_CLASSES = [
  "person",
  "dog",
  "cat",
  "bird",
  "car",
  "truck",
  "bicycle",
  "drone",
  "package",
  "unknown",
] as const;

/** PRD defaults. */
export const DEFAULT_SETTINGS: Settings = {
  minDetectionConfidence: 0.5,
  gateMinConfidence: 0.95,
  gateConsecutiveFrames: 3,
  policyMinConfidence: 0.95,
  allowedActions: ["notify", "log_only"],
  trackedClasses: ["person", "dog", "cat", "car", "truck", "package"],
};

/** Validation error for a bad settings patch. */
export class SettingsError extends Error {}

function assertRange(name: string, value: number, min: number, max: number): void {
  if (typeof value !== "number" || Number.isNaN(value) || value < min || value > max) {
    throw new SettingsError(`${name} must be a number in [${min}, ${max}], got ${value}`);
  }
}

/** Validate and merge a partial settings patch onto current settings. */
export function applyPatch(current: Settings, patch: Partial<Settings>): Settings {
  const next = { ...current, ...patch };
  assertRange("minDetectionConfidence", next.minDetectionConfidence, 0, 1);
  assertRange("gateMinConfidence", next.gateMinConfidence, 0, 1);
  assertRange("gateConsecutiveFrames", next.gateConsecutiveFrames, 1, 30);
  assertRange("policyMinConfidence", next.policyMinConfidence, 0, 1);
  if (!Array.isArray(next.allowedActions) || next.allowedActions.length === 0) {
    throw new SettingsError("allowedActions must be a non-empty array");
  }
  if (!Array.isArray(next.trackedClasses)) {
    throw new SettingsError("trackedClasses must be an array");
  }
  const unknown = next.trackedClasses.filter(
    (c) => !(AVAILABLE_CLASSES as readonly string[]).includes(c),
  );
  if (unknown.length > 0) {
    throw new SettingsError(`unknown class(es): ${unknown.join(", ")}`);
  }
  return next;
}
