import { describe, expect, it, vi } from "vitest";
import { buildMcpServer } from "./build.js";
import type { GatewayClient } from "./gateway.js";

describe("buildMcpServer", () => {
  it("registers only the requested domain tools", () => {
    const get: GatewayClient = vi.fn();
    const camera = buildMcpServer({ name: "c", domains: ["camera"], get });
    const timeline = buildMcpServer({ name: "t", domains: ["timeline"], get });
    const alert = buildMcpServer({ name: "a", domains: ["alert"], get });
    // McpServer keeps tools on _registeredTools in the SDK — assert via private map if present.
    const toolNames = (s: ReturnType<typeof buildMcpServer>): string[] => {
      const reg = (s as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
      return reg ? Object.keys(reg).sort() : [];
    };
    expect(toolNames(camera)).toEqual(["gateway_health", "list_cameras"]);
    expect(toolNames(timeline)).toEqual(["get_event", "recent_events"]);
    expect(toolNames(alert)).toEqual(["get_alert_policy", "list_alerts"]);
  });

  it("combined baseline includes settings plus all domains", () => {
    const get: GatewayClient = vi.fn();
    const all = buildMcpServer({
      name: "watchingeye",
      domains: ["camera", "timeline", "alert", "settings"],
      get,
    });
    const reg = (all as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
    const names = Object.keys(reg ?? {}).sort();
    expect(names).toEqual([
      "gateway_health",
      "get_alert_policy",
      "get_event",
      "get_settings",
      "list_alerts",
      "list_cameras",
      "recent_events",
    ]);
  });
});
