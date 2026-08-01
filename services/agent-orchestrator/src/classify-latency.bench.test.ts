/**
 * Opt-in GPU latency benchmark — ROADMAP Step 2.2.
 *
 * Measures gate-open → VLM decision (graph.invoke only — no identity /
 * YOLO / ANPR). Modes via `WATCHINGEYE_GPU_LATENCY`:
 * - `1` — assert warm p95 &lt; 300 ms (budget gate)
 * - `record` — measure + write results; no budget assert (honest miss OK)
 *
 * Default `npm test` / CI skips so we never claim the budget without a GPU.
 *
 * Run:
 *   ollama serve && ollama pull qwen2.5vl:7b
 *   WATCHINGEYE_GPU_LATENCY=record npm run test:gpu-latency
 *   WATCHINGEYE_GPU_LATENCY=1 npm run test:gpu-latency
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentGraph } from "./graph.js";
import { OllamaProvider } from "./llm.js";
import { makeVlmAnalyzer } from "./vlm.js";
import { resolveVlmModel } from "./vlm-model.js";
import type { TriggerEvent } from "./schema.js";

const MODE = (process.env.WATCHINGEYE_GPU_LATENCY ?? "").toLowerCase();
const ENABLED = MODE === "1" || MODE === "record";
const ASSERT_BUDGET = MODE === "1";
const BUDGET_MS = 300;
const SAMPLES = Math.max(1, Number(process.env.WATCHINGEYE_GPU_LATENCY_SAMPLES ?? 5) || 5);
const OLLAMA_TIMEOUT_MS = Number(process.env.WATCHINGEYE_OLLAMA_TIMEOUT_MS ?? 180_000) || 180_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "golden-scene.png");
const RESULTS_DIR = join(HERE, "..", "docs");
const RESULTS_JSON = join(RESULTS_DIR, "gpu-latency-results.json");
const RESULTS_MD = join(RESULTS_DIR, "gpu-latency-results.md");

const EVENT: TriggerEvent = {
  objectId: "6f1c1a34-aaaa-4bbb-8ccc-ddddeeeeffff",
  class: "moving_region",
  confidence: 0.98,
  frames: [10, 11, 12],
  cameraId: "driveway",
  snapshotRef: "fixtures/golden-scene.png",
};

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx] ?? 0;
}

function writeResults(payload: {
  recordedAt: string;
  model: string;
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  budgetMs: number;
  budgetMet: boolean;
  mode: string;
  notes: string;
}): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(RESULTS_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const md = `# GPU classify latency results (ROADMAP 2.2)

Recorded: \`${payload.recordedAt}\`
Mode: \`${payload.mode}\`
Model: \`${payload.model}\`

| Metric | Value |
|--------|------:|
| samples | ${payload.samplesMs.length} |
| p50 | ${payload.p50Ms} ms |
| p95 | ${payload.p95Ms} ms |
| budget | ${payload.budgetMs} ms |
| budget met | **${payload.budgetMet ? "yes" : "no"}** |

Raw samples (ms): ${payload.samplesMs.join(", ")}

${payload.notes}
`;
  writeFileSync(RESULTS_MD, md, "utf8");
}

describe.skipIf(!ENABLED)("GPU classify latency (opt-in)", () => {
  it(
    `gate-open → decision: ${SAMPLES} samples (budget ${BUDGET_MS} ms${ASSERT_BUDGET ? ", assert" : ", record-only"})`,
    async () => {
      const provider = new OllamaProvider(
        process.env.VLM_MODEL?.trim() || "qwen2.5vl:7b",
        process.env.OLLAMA_URL ?? "http://localhost:11434",
        OLLAMA_TIMEOUT_MS,
      );
      const installed = await provider.installedModels();
      const resolution = resolveVlmModel(installed, process.env.VLM_MODEL);
      expect(
        resolution.installed,
        resolution.hint ?? `vision model "${resolution.model}" not installed`,
      ).toBe(true);

      const imageBase64 = readFileSync(FIXTURE).toString("base64");
      const live = new OllamaProvider(
        resolution.model,
        process.env.OLLAMA_URL ?? "http://localhost:11434",
        OLLAMA_TIMEOUT_MS,
      );
      const graph = buildAgentGraph(makeVlmAnalyzer(live, imageBase64));

      // Warm-up — first call often includes model load; budget is steady-state.
      await graph.invoke({ rawEvent: EVENT });

      const samplesMs: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const started = Date.now();
        const result = await graph.invoke({ rawEvent: EVENT });
        samplesMs.push(Date.now() - started);
        expect(
          result.outcome === "action" || result.outcome === "safe_default",
          `unexpected outcome ${result.outcome}: ${result.rejectionReason}`,
        ).toBe(true);
      }

      const sorted = [...samplesMs].sort((a, b) => a - b);
      const p50Ms = percentile(sorted, 50);
      const p95Ms = percentile(sorted, 95);
      const budgetMet = p95Ms < BUDGET_MS;

      writeResults({
        recordedAt: new Date().toISOString(),
        model: resolution.model,
        samplesMs,
        p50Ms,
        p95Ms,
        budgetMs: BUDGET_MS,
        budgetMet,
        mode: MODE,
        notes: budgetMet
          ? "p95 under budget — ROADMAP 2.2 proven latency may be checked."
          : [
              "p95 over budget on this hardware/model.",
              "qwen2.5vl:7b (and similar 7B VLMs) typically need multiple seconds",
              "per warm classify even on RTX 3090-class GPUs.",
              "Keep the proven-&lt;300ms checkbox open until a faster VLM path exists.",
            ].join(" "),
      });

      // eslint-disable-next-line no-console -- operator-facing bench summary
      console.log(
        `[gpu-latency] model=${resolution.model} samples=${samplesMs.join(",")} p50=${p50Ms} p95=${p95Ms} budget=${BUDGET_MS} met=${budgetMet}`,
      );

      if (ASSERT_BUDGET) {
        expect(
          p95Ms,
          `p95 classify took ${p95Ms} ms (budget ${BUDGET_MS} ms); samples=[${samplesMs.join(",")}]`,
        ).toBeLessThan(BUDGET_MS);
      }
    },
    600_000,
  );
});

describe.skipIf(ENABLED)("GPU classify latency (skipped without env)", () => {
  it("documents the opt-in gate so CI stays honest", () => {
    expect(ENABLED).toBe(false);
  });
});
