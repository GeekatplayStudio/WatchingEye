/**
 * Pure alert selection over stored detection events.
 *
 * Presentation filter only — nothing is discarded from the store. An "alert"
 * here is an event the operator would see (not `filtered`).
 */

/** Minimal event shape needed for alert selection. */
export interface AlertEvent {
  id: string;
  class?: string;
  filtered?: boolean;
  rejectedReason?: string;
  risk?: number;
  cameraId?: string;
  timestamp?: string;
  model?: string;
}

/**
 * Keep events that should surface as alerts.
 *
 * @example
 * ```ts
 * selectAlerts([{ id: "a", filtered: true }, { id: "b" }]) // → [b]
 * ```
 */
export function selectAlerts(events: AlertEvent[]): AlertEvent[] {
  return events.filter((e) => e.filtered !== true);
}

/** Policy slice exposed by the Alert MCP server. */
export interface AlertPolicy {
  trackedClasses: string[];
  allowedActions: string[];
  policyMinConfidence: number;
  activeIntent: unknown;
}

/**
 * Project full gateway settings into the alert-policy view.
 *
 * @example
 * ```ts
 * const policy = toAlertPolicy({ trackedClasses: ["dog"], allowedActions: ["notify"], policyMinConfidence: 0.9, activeIntent: null });
 * ```
 */
export function toAlertPolicy(settings: Record<string, unknown>): AlertPolicy {
  const tracked = settings.trackedClasses;
  const actions = settings.allowedActions;
  return {
    trackedClasses: Array.isArray(tracked) ? (tracked as string[]) : [],
    allowedActions: Array.isArray(actions) ? (actions as string[]) : [],
    policyMinConfidence:
      typeof settings.policyMinConfidence === "number" ? settings.policyMinConfidence : 0,
    activeIntent: settings.activeIntent ?? null,
  };
}
