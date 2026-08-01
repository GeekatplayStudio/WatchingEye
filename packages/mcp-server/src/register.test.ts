import { describe, expect, it, vi } from "vitest";
import { fetchAlerts } from "./register.js";
import type { GatewayClient } from "./gateway.js";

describe("fetchAlerts", () => {
  it("filters via selectAlerts", async () => {
    const get: GatewayClient = vi.fn(async (path: string) => {
      if (path.startsWith("/api/events/recent")) {
        return {
          events: [
            { id: "keep", filtered: false },
            { id: "drop", filtered: true },
          ],
        };
      }
      return {};
    });
    const result = await fetchAlerts(get, 50);
    expect(result.count).toBe(1);
    expect(result.alerts[0]?.id).toBe("keep");
  });
});
