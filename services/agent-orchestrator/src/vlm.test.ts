import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  makeVlmAnalyzer,
  toDecisionJson,
  ALLOWED_CLASSES,
  PROMPT_VERSION,
} from "./vlm.js";
import { StubProvider } from "./llm.js";
import type { TriggerEvent } from "./schema.js";

const EVENT: TriggerEvent = {
  objectId: "obj-1",
  class: "moving_region",
  confidence: 0.98,
  frames: [45, 46, 47],
  cameraId: "webcam",
  snapshotRef: "frame-47",
};

describe("prompt", () => {
  it("pins the model to the closed class list", () => {
    const p = buildPrompt(EVENT);
    for (const c of ALLOWED_CLASSES) expect(p).toContain(c);
    expect(p).toContain("ONLY a JSON object");
  });
});

describe("toDecisionJson", () => {
  it("attaches provenance and the model's class claim as evidence", () => {
    const raw = JSON.stringify({
      object_class: "person",
      confidence: 0.96,
      risk: 0.2,
      evidence: [{ label: "walking", description: "Subject walking" }],
      proposed_action: "notify",
    });
    const out = JSON.parse(toDecisionJson(raw, EVENT, "qwen2.5vl:7b")) as {
      evidence: Array<{ label: string }>;
      provenance: { model_version: string; prompt_version: string };
    };
    expect(out.provenance.model_version).toBe("qwen2.5vl:7b");
    expect(out.provenance.prompt_version).toBe(PROMPT_VERSION);
    expect(out.evidence.map((e) => e.label)).toContain("class:person");
  });

  it("strips a markdown fence the model added despite instructions", () => {
    const raw = '```json\n{"object_class":"dog","confidence":0.9,"risk":0.1,"evidence":[],"proposed_action":"log_only"}\n```';
    const out = JSON.parse(toDecisionJson(raw, EVENT, "m")) as { confidence: number };
    expect(out.confidence).toBe(0.9);
  });

  it("passes unparseable output through for the guardrail to reject", () => {
    expect(toDecisionJson("I think it is a person.", EVENT, "m")).toBe(
      "I think it is a person.",
    );
  });
});

describe("analyzer wiring", () => {
  it("produces guardrail-ready JSON from a provider reply", async () => {
    const provider = new StubProvider(
      JSON.stringify({
        object_class: "person",
        confidence: 0.97,
        risk: 0.3,
        evidence: [{ label: "walking", description: "Walking toward door" }],
        proposed_action: "notify",
      }),
    );
    const analyze = makeVlmAnalyzer(provider, "");
    const json = JSON.parse(await analyze(EVENT)) as { proposed_action: string };
    expect(json.proposed_action).toBe("notify");
  });
});
