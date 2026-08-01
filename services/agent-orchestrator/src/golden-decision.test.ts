/**
 * Fixture-image golden decision — CI gate for Step 2.2.
 *
 * Uses a committed snapshot + StubProvider (no Ollama) so the graph path
 * validate → analyze → guardrail → action is deterministic in GitHub Actions.
 * Latency &lt; 300 ms remains a separate GPU benchmark and is not asserted here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentGraph } from "./graph.js";
import { StubProvider, type LlmRequest } from "./llm.js";
import { makeVlmAnalyzer, PROMPT_VERSION } from "./vlm.js";
import type { AgentDecision, TriggerEvent } from "./schema.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "golden-scene.png",
);

/** Stable trigger matching what the gated classify path sends. */
const GOLDEN_EVENT: TriggerEvent = {
  objectId: "6f1c1a34-aaaa-4bbb-8ccc-ddddeeeeffff",
  class: "moving_region",
  confidence: 0.98,
  frames: [10, 11, 12],
  cameraId: "driveway",
  snapshotRef: "fixtures/golden-scene.png",
};

/** Canned VLM JSON — shape the real model must produce for guardrails. */
const CANNED_VLM = JSON.stringify({
  object_class: "person",
  confidence: 0.97,
  risk: 0.25,
  evidence: [
    { label: "blue_jacket", description: "Subject wearing a blue jacket" },
    { label: "walking_left", description: "Moving left across the frame" },
  ],
  descriptors: [
    { key: "upper_clothing", value: "blue_jacket" },
    { key: "hair_color", value: "dark" },
  ],
  proposed_action: "notify",
});

describe("fixture-image golden decision (CI)", () => {
  it("loads the committed snapshot bytes", () => {
    const bytes = readFileSync(FIXTURE);
    expect(bytes.length).toBeGreaterThan(20);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50); // PNG magic
  });

  it("runs snapshot → stub VLM → guardrails → action with fixed fields", async () => {
    const imageBase64 = readFileSync(FIXTURE).toString("base64");
    let sawImage = false;
    const provider = {
      name: "stub-golden",
      async complete(req: LlmRequest) {
        sawImage = (req.images?.length ?? 0) === 1 && (req.images?.[0]?.length ?? 0) > 0;
        expect(req.promptVersion).toBe(PROMPT_VERSION);
        expect(req.jsonMode).toBe(true);
        return new StubProvider(CANNED_VLM).complete(req);
      },
    };

    const graph = buildAgentGraph(makeVlmAnalyzer(provider, imageBase64));
    const result = await graph.invoke({ rawEvent: GOLDEN_EVENT });

    expect(sawImage).toBe(true);
    expect(result.outcome).toBe("action");
    expect(result.rejectionReason).toBe("");

    const decision = result.decision as AgentDecision;
    expect(decision).not.toBeNull();
    expect(decision.proposed_action).toBe("notify");
    expect(decision.confidence).toBe(0.97);
    expect(decision.risk).toBe(0.25);
    expect(decision.provenance.model_version).toBe("stub-1");
    expect(decision.provenance.prompt_version).toBe(PROMPT_VERSION);
    expect(decision.provenance.input_images).toEqual(["fixtures/golden-scene.png"]);
    expect(decision.evidence.map((e) => e.label)).toEqual(
      expect.arrayContaining(["blue_jacket", "walking_left", "class:person"]),
    );
  });

  it("falls back safely when the stub returns prose instead of JSON", async () => {
    const imageBase64 = readFileSync(FIXTURE).toString("base64");
    const graph = buildAgentGraph(
      makeVlmAnalyzer(new StubProvider("Looks like a person to me."), imageBase64),
    );
    const result = await graph.invoke({ rawEvent: GOLDEN_EVENT });
    expect(result.outcome).toBe("safe_default");
    expect(result.rejectionReason).toBe("not valid JSON");
  });
});
