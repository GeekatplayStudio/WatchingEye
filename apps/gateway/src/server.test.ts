import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { applyPatch, DEFAULT_SETTINGS, SettingsError } from "./settings.js";
import type { ClassifyResult } from "./classify.js";

const GATED_EVENT = {
  objectId: "8f2a1c34-1111-4222-8333-444455556666",
  class: "moving_region",
  confidence: 0.98,
  frames: [45, 46, 47],
  cameraId: "webcam",
  snapshotRef: "frame-47",
};

function decisionResult(objectClass: string): ClassifyResult {
  return {
    outcome: "action",
    latencyMs: 42,
    decision: {
      id: "6f1c1a34-1111-4222-8333-444455556666",
      object_id: GATED_EVENT.objectId,
      risk: 0.2,
      confidence: 0.96,
      proposed_action: "notify",
      evidence: [
        { label: "walking", description: "Subject walking" },
        { label: `class:${objectClass}`, description: `Classified as ${objectClass}` },
      ],
      provenance: {
        model_version: "qwen2.5vl:7b",
        prompt_version: "classify-v1",
        input_images: ["frame-47"],
        timestamp: new Date().toISOString(),
      },
    },
  };
}

describe("gateway server", () => {
  it("reports healthy", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({ status: "ok", service: "gateway" });
    await app.close();
  });

  it("starts with no cameras — none are pre-registered", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/cameras" });
    expect(res.json().cameras).toEqual([]);
    await app.close();
  });

  it("has an empty feed until something real happens", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/events/recent" });
    expect(res.json().events).toEqual([]);
    await app.close();
  });

  it("turns a classified event into a labeled feed entry", async () => {
    const app = await buildServer({ classifier: async () => decisionResult("person") });
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.event.class).toBe("person");
    expect(body.event.model).toBe("qwen2.5vl:7b");
    expect(body.event.promptVersion).toBe("classify-v1");
    expect(body.event.source).toBe("engine");
    await app.close();
  });

  it("registers the camera that reported the event", async () => {
    const app = await buildServer({ classifier: async () => decisionResult("dog") });
    await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    const res = await app.inject({ method: "GET", url: "/api/cameras" });
    expect(res.json().cameras[0].id).toBe("webcam");
    await app.close();
  });

  it("records an unclassified event when the guardrails refuse", async () => {
    const app = await buildServer({
      classifier: async () => ({
        outcome: "safe_default" as const,
        rejectionReason: "not valid JSON",
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    const body = res.json();
    expect(body.event.class).toBe("unknown");
    expect(body.event.model).toBe("unclassified");
    expect(body.event.rejectedReason).toBe("not valid JSON");
    await app.close();
  });

  it("rejects a malformed classify request", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: {} },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns default settings and accepts a valid patch", async () => {
    const app = await buildServer();
    expect((await app.inject({ method: "GET", url: "/api/settings" })).json()).toEqual(
      DEFAULT_SETTINGS,
    );
    const put = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { gateMinConfidence: 0.9 },
    });
    expect(put.json().gateMinConfidence).toBe(0.9);
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
});

describe("settings validation", () => {
  it("merges valid patches", () => {
    expect(applyPatch(DEFAULT_SETTINGS, { policyMinConfidence: 0.8 }).policyMinConfidence).toBe(
      0.8,
    );
  });

  it("throws on empty allowedActions", () => {
    expect(() => applyPatch(DEFAULT_SETTINGS, { allowedActions: [] })).toThrow(SettingsError);
  });
});
