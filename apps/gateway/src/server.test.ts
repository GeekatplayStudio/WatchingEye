import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("gateway server", () => {
  it("reports healthy", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "gateway" });
    await app.close();
  });

  it("returns an empty camera list before the engine connects", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/cameras" });
    expect(res.json()).toEqual({ cameras: [] });
    await app.close();
  });
});
