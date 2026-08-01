/**
 * Opt-in GPU latency benchmark — ROADMAP Step 2.2.
 *
 * Measures gate-open → VLM decision (graph.invoke only — no identity /
 * YOLO / ANPR). Asserts latencyMs &lt; 300 only when
 * `WATCHINGEYE_GPU_LATENCY=1`. Default `npm test` / CI skips so we never
 * claim the budget without a GPU + Ollama vision model.
 *
 * Run:
 *   ollama serve
 *   ollama pull qwen2.5vl:7b   # or whatever VLM_MODEL you pin
 *   WATCHINGEYE_GPU_LATENCY=1 npm run test:gpu-latency
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentGraph } from "./graph.js";
import { OllamaProvider } from "./llm.js";
import { makeVlmAnalyzer } from "./vlm.js";
import { resolveVlmModel } from "./vlm-model.js";
import type { TriggerEvent } from "./schema.js";

const ENABLED = (process.env.WATCHINGEYE_GPU_LATENCY ?? "") === "1";
const BUDGET_MS = 300;

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "golden-scene.png",
);

const EVENT: TriggerEvent = {
  objectId: "6f1c1a34-aaaa-4bbb-8ccc-ddddeeeeffff",
  class: "moving_region",
  confidence: 0.98,
  frames: [10, 11, 12],
  cameraId: "driveway",
  snapshotRef: "fixtures/golden-scene.png",
};

describe.skipIf(!ENABLED)("GPU classify latency (opt-in)", () => {
  it(
    `gate-open → decision completes under ${BUDGET_MS} ms`,
    async () => {
      const provider = new OllamaProvider(
        process.env.VLM_MODEL?.trim() || "qwen2.5vl:7b",
      );
      const installed = await provider.installedModels();
      const resolution = resolveVlmModel(installed, process.env.VLM_MODEL);
      expect(
        resolution.installed,
        resolution.hint ?? `vision model "${resolution.model}" not installed`,
      ).toBe(true);

      const imageBase64 = readFileSync(FIXTURE).toString("base64");
      const live = new OllamaProvider(resolution.model);
      const graph = buildAgentGraph(makeVlmAnalyzer(live, imageBase64));

      // Warm-up — first call often includes model load; budget is steady-state.
      await graph.invoke({ rawEvent: EVENT });

      const started = Date.now();
      const result = await graph.invoke({ rawEvent: EVENT });
      const latencyMs = Date.now() - started;

      expect(
        result.outcome === "action" || result.outcome === "safe_default",
        `unexpected outcome ${result.outcome}: ${result.rejectionReason}`,
      ).toBe(true);
      expect(
        latencyMs,
        `classify took ${latencyMs} ms (budget ${BUDGET_MS} ms)`,
      ).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );
});

describe.skipIf(ENABLED)("GPU classify latency (skipped without env)", () => {
  it("documents the opt-in gate so CI stays honest", () => {
    expect(ENABLED).toBe(false);
  });
});
