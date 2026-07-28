import { describe, expect, it } from "vitest";
import { buildAgentGraph } from "./graph.js";
import type { TriggerEvent } from "./schema.js";

const VALID_EVENT: TriggerEvent = {
  objectId: "obj-1",
  class: "person",
  confidence: 0.98,
  frames: [45, 46, 47],
  cameraId: "driveway",
  snapshotRef: "frame-47.jpg",
};

function validDecision(): string {
  return JSON.stringify({
    id: "6f1c1a34-1111-4222-8333-444455556666",
    object_id: "6f1c1a34-7777-4888-9999-aaaabbbbcccc",
    risk: 0.3,
    evidence: [{ label: "walking", description: "Person walking toward door" }],
    confidence: 0.97,
    proposed_action: "notify",
    provenance: {
      model_version: "test-vlm",
      prompt_version: "test-v1",
      input_images: ["frame-47.jpg"],
      timestamp: new Date().toISOString(),
    },
  });
}

describe("super agent graph", () => {
  it("runs the happy path to an action", async () => {
    const graph = buildAgentGraph(async () => validDecision());
    const result = await graph.invoke({ rawEvent: VALID_EVENT });
    expect(result.outcome).toBe("action");
    expect(result.decision).not.toBeNull();
  });

  it("falls back safely on prose output (hallucination)", async () => {
    const graph = buildAgentGraph(async () => "Looks suspicious.");
    const result = await graph.invoke({ rawEvent: VALID_EVENT });
    expect(result.outcome).toBe("safe_default");
    expect(result.rejectionReason).toBe("not valid JSON");
  });

  it("falls back safely on schema-violating JSON", async () => {
    const graph = buildAgentGraph(async () => JSON.stringify({ risk: 2.0 }));
    const result = await graph.invoke({ rawEvent: VALID_EVENT });
    expect(result.outcome).toBe("safe_default");
    expect(result.rejectionReason).toContain("id");
  });

  it("rejects an invalid trigger event without calling the analyzer", async () => {
    let called = false;
    const graph = buildAgentGraph(async () => {
      called = true;
      return validDecision();
    });
    const result = await graph.invoke({ rawEvent: { bogus: true } });
    expect(result.outcome).toBe("safe_default");
    expect(called).toBe(false);
  });
});
