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
  /** Demo event interval in ms (0 disables the demo generator). */
  demoIntervalMs: number;
}

/** PRD defaults. */
export const DEFAULT_SETTINGS: Settings = {
  minDetectionConfidence: 0.5,
  gateMinConfidence: 0.95,
  gateConsecutiveFrames: 3,
  policyMinConfidence: 0.95,
  allowedActions: ["notify", "log_only"],
  demoIntervalMs: 3000,
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
  assertRange("demoIntervalMs", next.demoIntervalMs, 0, 60000);
  if (!Array.isArray(next.allowedActions) || next.allowedActions.length === 0) {
    throw new SettingsError("allowedActions must be a non-empty array");
  }
  return next;
}
