import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { applyPatch, DEFAULT_SETTINGS, SettingsError } from "./settings.js";
import type { ClassifyResult } from "./classify.js";
import { globalDatasetStore } from "./dataset.js";

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
  it("proxies voice commands without interpreting them", async () => {
    const app = await buildServer({
      voiceCommand: async (body) => ({
        outcome: "command",
        transcript: body.transcript,
        command: { intent: "status" },
        stt: { model: "stub" },
        latencyMs: 1,
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/voice/command",
      payload: { transcript: "system status" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().command.intent).toBe("status");
    const missing = await app.inject({
      method: "POST",
      url: "/api/voice/command",
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    await app.close();
  });

  it("runs text-path voice ask through recall then speak", async () => {
    globalDatasetStore.clear();
    await globalDatasetStore.insertRecord({
      id: "ask-1",
      objectId: "obj-ask-1",
      class: "person",
      cameraId: "driveway",
      timestamp: new Date().toISOString(),
      confidence: 0.99,
      evidence: [{ label: "class:person", description: "Walker" }],
      snapshotRef: "snap-ask-1",
    });
    const app = await buildServer({
      voiceCommand: async (body) => ({
        outcome: "command",
        transcript: body.transcript ?? "",
        command: { intent: "query_events", window: "today" },
        stt: { model: "stub" },
      }),
      voiceSpeak: async ({ facts }) => ({
        outcome: "spoken",
        speechText: `Detected ${(facts as Array<{ objectClass: string }>)[0]?.objectClass ?? "nothing"}.`,
        audioBase64: "UkZGRg==",
        mimeType: "audio/wav",
        tts: { model: "stub" },
      }),
    });
    const empty = await app.inject({
      method: "POST",
      url: "/api/voice/ask",
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const res = await app.inject({
      method: "POST",
      url: "/api/voice/ask",
      payload: { transcript: "what happened today" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe("answered");
    expect(res.json().recall.citations).toContain("ask-1");
    expect(res.json().speak.tts.model).toBe("stub");

    const mic = await app.inject({
      method: "POST",
      url: "/api/voice/ask",
      payload: { audioBase64: "ZmFrZS1hdWRpbw==", mimeType: "audio/webm" },
    });
    expect(mic.statusCode).toBe(200);
    expect(mic.json().outcome).toBe("answered");

    globalDatasetStore.clear();
    await app.close();
  });

  it("proxies voice speak from facts and rejects free-form text", async () => {
    const app = await buildServer({
      voiceSpeak: async ({ facts }) => ({
        outcome: "spoken",
        speechText: "Detected person at the driveway.",
        audioBase64: "UkZGRg==",
        mimeType: "audio/wav",
        tts: { model: "stub" },
        factsLen: Array.isArray(facts) ? facts.length : 0,
        latencyMs: 1,
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/voice/speak",
      payload: {
        facts: [
          {
            objectClass: "person",
            cameraId: "driveway",
            timestamp: "2026-07-27T15:14:00Z",
            confidence: 0.9,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tts.model).toBe("stub");
    const banned = await app.inject({
      method: "POST",
      url: "/api/voice/speak",
      payload: { text: "say anything", facts: [] },
    });
    expect(banned.statusCode).toBe(400);
    await app.close();
  });

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
    expect(body.event.provenance).toMatchObject({
      model_version: "qwen2.5vl:7b",
      prompt_version: "classify-v1",
      input_images: ["frame-47"],
    });
    expect(body.event.source).toBe("engine");

    const byId = await app.inject({ method: "GET", url: `/api/events/${body.event.id}` });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().event.id).toBe(body.event.id);
    expect(byId.json().event.provenance.prompt_version).toBe("classify-v1");

    const missing = await app.inject({ method: "GET", url: "/api/events/does-not-exist" });
    expect(missing.statusCode).toBe(404);

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

  it("accepts a valid set of tracked classes", () => {
    const next = applyPatch(DEFAULT_SETTINGS, { trackedClasses: ["person", "drone"] });
    expect(next.trackedClasses).toEqual(["person", "drone"]);
  });

  it("allows watching nothing at all", () => {
    expect(applyPatch(DEFAULT_SETTINGS, { trackedClasses: [] }).trackedClasses).toEqual([]);
  });

  it("rejects a class the system cannot detect", () => {
    expect(() => applyPatch(DEFAULT_SETTINGS, { trackedClasses: ["dragon"] })).toThrow(
      /unknown class/,
    );
  });
});

describe("class filtering", () => {
  it("marks a sighting outside the tracked classes as filtered", async () => {
    const app = await buildServer({ classifier: async () => decisionResult("bird") });
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { trackedClasses: ["person"] },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    expect(res.json().event.filtered).toBe(true);
    await app.close();
  });

  it("does not mark a tracked class as filtered", async () => {
    const app = await buildServer({ classifier: async () => decisionResult("person") });
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { trackedClasses: ["person"] },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    expect(res.json().event.filtered).toBeUndefined();
    await app.close();
  });

  it("still records a filtered sighting rather than discarding it", async () => {
    const app = await buildServer({ classifier: async () => decisionResult("bird") });
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { trackedClasses: ["person"] },
    });
    await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    const recent = await app.inject({ method: "GET", url: "/api/events/recent" });
    expect(recent.json().events).toHaveLength(1);
    expect(recent.json().events[0].filtered).toBe(true);
    await app.close();
  });
});

describe("activeIntent pipeline gating", () => {
  it("enrolls into the dataset by default", async () => {
    globalDatasetStore.clear();
    const unit = new Array<number>(384).fill(0);
    unit[0] = 1;
    const textUnit = new Array<number>(768).fill(0);
    textUnit[3] = 1;
    const attrUnit = new Array<number>(512).fill(0);
    attrUnit[5] = 1;
    const app = await buildServer({
      classifier: async () => ({
        ...decisionResult("dog"),
        descriptors: [{ key: "breed", value: "labrador" }],
      }),
      embedder: async () => ({ values: unit, model: "dinov2-vits14-onnx" }),
      textEmbedder: async () => ({ values: textUnit, model: "stub-text-1" }),
      attrEmbedder: async () => ({ values: attrUnit, model: "clip-vit-b32-onnx-bank" }),
    });
    await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "dGVzdA==" },
    });
    const search = await app.inject({ method: "GET", url: "/api/dataset/search?q=dog" });
    expect(search.json().records.length).toBeGreaterThan(0);
    expect(search.json().records[0].embedModel).toBe("dinov2-vits14-onnx");
    expect(search.json().records[0].embedding).toHaveLength(384);
    expect(search.json().records[0].provenance.embed_model).toBe("dinov2-vits14-onnx");
    expect(search.json().records[0].textEmbedModel).toBe("stub-text-1");
    expect(search.json().records[0].textEmbedding).toHaveLength(768);
    expect(search.json().records[0].attrEmbedModel).toBe("clip-vit-b32-onnx-bank");
    expect(search.json().records[0].attrEmbedding).toHaveLength(512);
    expect(search.json().records[0].provenance.attr_embed_model).toBe("clip-vit-b32-onnx-bank");

    const stats = await app.inject({ method: "GET", url: "/api/dataset/stats" });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().total).toBeGreaterThan(0);

    const similar = await app.inject({
      method: "POST",
      url: "/api/dataset/similar",
      payload: { embedding: unit, limit: 5 },
    });
    expect(similar.statusCode).toBe(200);
    expect(similar.json().records[0].id).toBe(search.json().records[0].id);

    const recall = await app.inject({
      method: "GET",
      url: "/api/dataset/recall?q=person&limit=10",
    });
    expect(recall.statusCode).toBe(200);
    expect(recall.json().citations.length).toBeGreaterThan(0);
    expect(recall.json().answer).toContain("record");
    expect(recall.json().evidenceQuotes.length).toBeGreaterThan(0);

    await app.close();
  });

  it("skips dataset enroll when activeIntent monitors without enroll", async () => {
    globalDatasetStore.clear();
    const app = await buildServer({ classifier: async () => decisionResult("dog") });
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        activeIntent: {
          rawPrompt: "track dogs",
          targetClasses: ["dog"],
          attributes: ["breed"],
          actionPolicy: "monitor",
          datasetEnroll: false,
          anprEnabled: false,
          appliedAt: new Date().toISOString(),
        },
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    expect(res.json().enrolled).toBe(false);
    const search = await app.inject({ method: "GET", url: "/api/dataset/search?q=dog" });
    expect(search.json().records).toEqual([]);
    await app.close();
  });

  it("runs ANPR and enrolls when anprEnabled is set", async () => {
    globalDatasetStore.clear();
    const app = await buildServer({
      classifier: async () => ({
        ...decisionResult("car"),
        rawAnalysis: "vehicle showing plate XYZ-9876",
        descriptors: [{ key: "color", value: "black" }],
      }),
    });
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        activeIntent: {
          rawPrompt: "track cars and plates",
          targetClasses: ["car"],
          attributes: ["license_plate", "color"],
          actionPolicy: "anpr_ocr",
          datasetEnroll: false,
          anprEnabled: true,
          appliedAt: new Date().toISOString(),
        },
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/classify",
      payload: { event: GATED_EVENT, image: "" },
    });
    expect(res.json().enrolled).toBe(true);
    expect(
      res.json().event.evidence.some((e: { label: string }) => e.label === "plate:XYZ-9876"),
    ).toBe(true);
    const search = await app.inject({ method: "GET", url: "/api/dataset/search?q=XYZ-9876" });
    expect(search.json().records[0].licensePlate).toBe("XYZ-9876");
    await app.close();
  });
});
