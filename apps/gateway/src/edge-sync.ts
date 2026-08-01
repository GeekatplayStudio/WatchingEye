/**
 * AI-free ingest for edge-node offline cache drain (ROADMAP 3.2).
 *
 * Maps gate-open metadata into {@link DetectionEvent} rows. No VLM, no
 * orchestrator call — provenance is `edge-cache` so replay stays honest.
 */

import type { DetectionEvent } from "./events.js";
import type { EventStore } from "./db.js";

/** One buffered event from `{EDGE_HUB_URL}/api/edge/sync`. */
export interface EdgeSyncEvent {
  id: string;
  cameraId: string;
  frame: number;
  trackId: number;
  kind: string;
  createdAt: string;
  payload?: {
    seen_frames?: number;
    bbox?: { x?: number; y?: number; width?: number; height?: number };
    motion?: { direction?: string; speed?: number };
  };
}

/** POST body from edge-node. */
export interface EdgeSyncBody {
  nodeId?: string;
  events: EdgeSyncEvent[];
}

/**
 * Turn a gate-open cache row into a feed event.
 *
 * @example
 * ```ts
 * const ev = toDetectionEvent({
 *   id: "edge-1-10-3",
 *   cameraId: "edge-1",
 *   frame: 10,
 *   trackId: 3,
 *   kind: "gate_open",
 *   createdAt: "2026-08-01T00:00:00Z",
 *   payload: { seen_frames: 3 },
 * });
 * ```
 */
export function toDetectionEvent(ev: EdgeSyncEvent): DetectionEvent {
  const seen = ev.payload?.seen_frames;
  const bbox = ev.payload?.bbox;
  const evidence: DetectionEvent["evidence"] = [
    {
      label: "edge:gate_open",
      description: `Track ${ev.trackId} opened the trigger gate on frame ${ev.frame}`,
    },
  ];
  if (typeof seen === "number") {
    evidence.push({
      label: "edge:seen_frames",
      description: `Seen for ${seen} consecutive frames`,
    });
  }
  if (bbox !== undefined) {
    evidence.push({
      label: "edge:bbox",
      description: `bbox x=${bbox.x ?? "?"} y=${bbox.y ?? "?"} w=${bbox.width ?? "?"} h=${bbox.height ?? "?"}`,
    });
  }
  const ts = ev.createdAt || new Date().toISOString();
  return {
    id: ev.id,
    objectId: `edge-track-${ev.trackId}`,
    class: "unknown",
    kind: "detected",
    confidence: 1,
    frames: [ev.frame],
    cameraId: ev.cameraId,
    timestamp: ts,
    evidence,
    model: "edge-cache",
    promptVersion: "edge-sync-v1",
    provenance: {
      model_version: "edge-cache",
      prompt_version: "edge-sync-v1",
      input_images: [],
      timestamp: ts,
    },
    source: "engine",
  };
}

/**
 * Idempotently insert edge sync events; always ACK accepted ids so the
 * node can drop pending rows even on replay. `inserted` is only new rows
 * (for WebSocket fan-out without duplicates).
 *
 * @example
 * ```ts
 * const { accepted } = await ingestEdgeSync(store, { events: [ev] });
 * ```
 */
export async function ingestEdgeSync(
  store: EventStore,
  body: EdgeSyncBody,
): Promise<{ accepted: string[]; inserted: DetectionEvent[] }> {
  const accepted: string[] = [];
  const inserted: DetectionEvent[] = [];
  for (const raw of body.events ?? []) {
    if (typeof raw?.id !== "string" || raw.id.length === 0) continue;
    if (typeof raw.cameraId !== "string" || typeof raw.frame !== "number") continue;
    const event = toDetectionEvent(raw);
    const existing = await store.getEvent(event.id);
    if (existing === null) {
      await store.insertEvent(event);
      inserted.push(event);
    }
    accepted.push(event.id);
  }
  return { accepted, inserted };
}
