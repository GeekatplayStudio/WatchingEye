import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayClient } from "./gateway.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGatewayClient", () => {
  it("GETs JSON and strips trailing slash on base", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("http://hub:8080/api/cameras");
        return {
          ok: true,
          json: async () => ({ cameras: [] }),
        };
      }),
    );
    const get = createGatewayClient("http://hub:8080/");
    await expect(get("/api/cameras")).resolves.toEqual({ cameras: [] });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const get = createGatewayClient("http://hub:8080");
    await expect(get("/api/cameras")).rejects.toThrow(/503/);
  });
});
