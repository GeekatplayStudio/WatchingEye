/**
 * Tool registration for the dedicated Camera / Timeline / Alert MCP servers.
 * All tools are read-only GETs against the gateway (ADR 0003).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GatewayClient } from "./gateway.js";
import { selectAlerts, toAlertPolicy, type AlertEvent } from "./alerts.js";

function text(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Camera MCP: inventory + liveness. */
export function registerCameraTools(server: McpServer, get: GatewayClient): void {
  server.tool("list_cameras", "List cameras that have reported frames", {}, async () =>
    text(await get("/api/cameras")),
  );
  server.tool("gateway_health", "Gateway liveness / event-store kind", {}, async () =>
    text(await get("/health")),
  );
}

/** Timeline MCP: event history + single-event replay lookup. */
export function registerTimelineTools(server: McpServer, get: GatewayClient): void {
  server.tool(
    "recent_events",
    "Recent detection events, newest first, with evidence and provenance",
    { limit: z.number().int().min(1).max(500).default(50) },
    async ({ limit }) => text(await get(`/api/events/recent?limit=${limit}`)),
  );
  server.tool(
    "get_event",
    "One stored event by id (replay / evidence drill-down)",
    { id: z.string().min(1) },
    async ({ id }) => text(await get(`/api/events/${encodeURIComponent(id)}`)),
  );
}

/**
 * Load recent events and keep the alert feed.
 *
 * @example
 * ```ts
 * const { count } = await fetchAlerts(get, 50);
 * ```
 */
export async function fetchAlerts(
  get: GatewayClient,
  limit: number,
): Promise<{ alerts: AlertEvent[]; count: number }> {
  const body = (await get(`/api/events/recent?limit=${limit}`)) as {
    events?: AlertEvent[];
  };
  const events = Array.isArray(body.events) ? body.events : [];
  const alerts = selectAlerts(events);
  return { alerts, count: alerts.length };
}

/** Alert MCP: unfiltered sightings + operator policy (no actuation). */
export function registerAlertTools(server: McpServer, get: GatewayClient): void {
  server.tool(
    "list_alerts",
    "Recent events that are not presentation-filtered (operator alert feed)",
    { limit: z.number().int().min(1).max(500).default(50) },
    async ({ limit }) => text(await fetchAlerts(get, limit)),
  );
  server.tool(
    "get_alert_policy",
    "Tracked classes, allowed actions, and active NL intent (read-only)",
    {},
    async () => {
      const settings = (await get("/api/settings")) as Record<string, unknown>;
      return text(toAlertPolicy(settings));
    },
  );
}

/** Legacy monolith helper: full settings blob. */
export function registerSettingsTool(server: McpServer, get: GatewayClient): void {
  server.tool("get_settings", "Current deterministic gate and policy settings", {}, async () =>
    text(await get("/api/settings")),
  );
}
