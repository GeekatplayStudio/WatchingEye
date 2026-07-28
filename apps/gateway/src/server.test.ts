import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { applyPatch, DEFAULT_SETTINGS, SettingsError } from "./settings.js";
import { nextDemoEvent } from "./events.js";

describe("gateway server", () => {
  it("reports healthy", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "gateway" });
    await app.close();
  });

  it("lists demo cameras", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/cameras" });
    expect(res.json().cameras).toHaveLength(3);
    await app.close();
  });

  it("returns default settings and accepts a valid patch", async () => {
    const app = await buildServer();
    const get = await app.inject({ method: "GET", url: "/api/settings" });
    expect(get.json()).toEqual(DEFAULT_SETTINGS);

    const put = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { gateMinConfidence: 0.9, gateConsecutiveFrames: 5 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().gateMinConfidence).toBe(0.9);
    expect(put.json().gateConsecutiveFrames).toBe(5);
    await app.close();
  });

  it("rejects an out-of-range settings patch", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { gateMinConfidence: 1.5 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("serves recent events after ingest", async () => {
    const app = await buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/events/recent" });
    expect(Array.isArray(res.json().events)).toBe(true);
    await app.close();
  });
});

describe("settings validation", () => {
  it("merges valid patches", () => {
    const next = applyPatch(DEFAULT_SETTINGS, { policyMinConfidence: 0.8 });
    expect(next.policyMinConfidence).toBe(0.8);
    expect(next.gateConsecutiveFrames).toBe(3);
  });

  it("throws on empty allowedActions", () => {
    expect(() => applyPatch(DEFAULT_SETTINGS, { allowedActions: [] })).toThrow(SettingsError);
  });
});

describe("demo generator", () => {
  it("produces labeled demo events with evidence", () => {
    const e = nextDemoEvent();
    expect(e.source).toBe("demo");
    expect(e.evidence.length).toBeGreaterThan(0);
    expect(e.frames).toHaveLength(3);
  });
});
