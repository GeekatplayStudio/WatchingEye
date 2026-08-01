/**
 * Opt-in GPU latency benchmark — ROADMAP Step 2.2.
 *
 * Measures gate-open → VLM decision (graph.invoke only — no identity /
 * YOLO / ANPR). Modes via `WATCHINGEYE_GPU_LATENCY`:
 * - `1` — assert warm p95 &lt; 300 ms (budget gate; every model in the run)
 * - `record` — measure + write results; no budget assert (honest miss OK)
 *
 * Comparative matrix via `WATCHINGEYE_GPU_LATENCY_MODELS`:
 * - unset / `single` — one model (`VLM_MODEL` or resolved default)
 * - `known` — every installed tag from `KNOWN_VISION_MODELS`
 * - `a,b,c` — explicit comma list (skips missing tags with a warning)
 *
 * Default `npm test` / CI skips so we never claim the budget without a GPU.
 *
 * Run:
 *   ollama serve && ollama pull qwen2.5vl:7b
 *   WATCHINGEYE_GPU_LATENCY=record npm run test:gpu-latency
 *   WATCHINGEYE_GPU_LATENCY=record WATCHINGEYE_GPU_LATENCY_MODELS=known npm run test:gpu-latency
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentGraph } from "./graph.js";
import {
  bestModel,
  formatLatencyMarkdown,
  parseLatencyModels,
  percentile,
  type GpuLatencyModelResult,
  type GpuLatencyReport,
} from "./gpu-latency-report.js";
import { OllamaProvider } from "./llm.js";
import { makeVlmAnalyzer } from "./vlm.js";
import { KNOWN_VISION_MODELS, resolveVlmModel } from "./vlm-model.js";
import type { TriggerEvent } from "./schema.js";

const MODE = (process.env.WATCHINGEYE_GPU_LATENCY ?? "").toLowerCase();
const ENABLED = MODE === "1" || MODE === "record";
const ASSERT_BUDGET = MODE === "1";
const BUDGET_MS = 300;
const SAMPLES = Math.max(1, Number(process.env.WATCHINGEYE_GPU_LATENCY_SAMPLES ?? 5) || 5);
const OLLAMA_TIMEOUT_MS = Number(process.env.WATCHINGEYE_OLLAMA_TIMEOUT_MS ?? 180_000) || 180_000;
const HARDWARE = process.env.WATCHINGEYE_GPU_HARDWARE?.trim() || undefined;

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

function sameModel(a: string, b: string): boolean {
  const strip = (s: string) => (s.endsWith(":latest") ? s.slice(0, -":latest".length) : s);
  return strip(a) === strip(b);
}

function writeReport(report: GpuLatencyReport): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(RESULTS_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(RESULTS_MD, formatLatencyMarkdown(report), "utf8");
}

async function resolveModelsToBench(installed: readonly string[]): Promise<string[]> {
  const parsed = parseLatencyModels(process.env.WATCHINGEYE_GPU_LATENCY_MODELS);
  if (parsed.kind === "single") {
    const resolution = resolveVlmModel(installed, process.env.VLM_MODEL);
    expect(
      resolution.installed,
      resolution.hint ?? `vision model "${resolution.model}" not installed`,
    ).toBe(true);
    return [resolution.model];
  }
  if (parsed.kind === "known") {
    const found = KNOWN_VISION_MODELS.map((known) => {
      const tag = installed.find((t) => sameModel(t, known));
      return tag;
    }).filter((t): t is string => t !== undefined);
    expect(found.length, "no known vision models installed").toBeGreaterThan(0);
    return found;
  }
  const found: string[] = [];
  for (const want of parsed.models) {
    const tag = installed.find((t) => sameModel(t, want));
    if (tag === undefined) {
      // eslint-disable-next-line no-console -- operator-facing bench skip
      console.warn(`[gpu-latency] skip missing model: ${want}`);
      continue;
    }
    found.push(tag);
  }
  expect(found.length, "none of the requested models are installed").toBeGreaterThan(0);
  return found;
}

async function timeModel(
  model: string,
  imageBase64: string,
): Promise<GpuLatencyModelResult> {
  const live = new OllamaProvider(
    model,
    process.env.OLLAMA_URL ?? "http://localhost:11434",
    OLLAMA_TIMEOUT_MS,
  );
  const graph = buildAgentGraph(makeVlmAnalyzer(live, imageBase64));

  try {
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
    return {
      model,
      samplesMs,
      p50Ms,
      p95Ms,
      budgetMet: p95Ms < BUDGET_MS,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      model,
      samplesMs: [],
      p50Ms: 0,
      p95Ms: 0,
      budgetMet: false,
      error: message.slice(0, 240),
    };
  }
}

describe.skipIf(!ENABLED)("GPU classify latency (opt-in)", () => {
  it(
    `gate-open → decision: ${SAMPLES} samples (budget ${BUDGET_MS} ms${ASSERT_BUDGET ? ", assert" : ", record-only"})`,
    async () => {
      const probe = new OllamaProvider(
        "unused",
        process.env.OLLAMA_URL ?? "http://localhost:11434",
        OLLAMA_TIMEOUT_MS,
      );
      const installed = await probe.installedModels();
      const models = await resolveModelsToBench(installed);
      const imageBase64 = readFileSync(FIXTURE).toString("base64");

      const results: GpuLatencyModelResult[] = [];
      for (const model of models) {
        // eslint-disable-next-line no-console -- operator-facing bench progress
        console.log(`[gpu-latency] timing ${model}…`);
        const row = await timeModel(model, imageBase64);
        results.push(row);
        // eslint-disable-next-line no-console -- operator-facing bench summary
        console.log(
          `[gpu-latency] model=${row.model} samples=${row.samplesMs.join(",")} p50=${row.p50Ms} p95=${row.p95Ms} met=${row.budgetMet}`,
        );
      }

      const timed = results.filter((r) => r.error === undefined);
      expect(timed.length, "every requested model failed to run").toBeGreaterThan(0);

      const winner = bestModel(results);
      const anyMet = timed.some((r) => r.budgetMet);
      const errors = results.filter((r) => r.error !== undefined);
      const notes = [
        anyMet
          ? `At least one model met p95 &lt; ${BUDGET_MS} ms — ROADMAP 2.2 proven latency may be checked for that path.`
          : [
              `No model in this run met p95 &lt; ${BUDGET_MS} ms.`,
              winner
                ? `Fastest warm p95 was \`${winner.model}\` at ${winner.p95Ms} ms.`
                : "",
              "Keep the proven-&lt;300ms checkbox open until a faster VLM path exists.",
              "Fixture is 1×1 PNG — cost is model/runtime, not pixels.",
            ]
              .filter((s) => s.length > 0)
              .join(" "),
        errors.length > 0
          ? `Skipped ${errors.length} model(s) that failed to load/run: ${errors.map((e) => `\`${e.model}\``).join(", ")}.`
          : "",
      ]
        .filter((s) => s.length > 0)
        .join(" ");

      writeReport({
        recordedAt: new Date().toISOString(),
        mode: MODE,
        budgetMs: BUDGET_MS,
        ...(HARDWARE ? { hardware: HARDWARE } : {}),
        models: results,
        notes,
      });

      if (ASSERT_BUDGET) {
        for (const row of timed) {
          expect(
            row.p95Ms,
            `p95 classify for ${row.model} took ${row.p95Ms} ms (budget ${BUDGET_MS} ms); samples=[${row.samplesMs.join(",")}]`,
          ).toBeLessThan(BUDGET_MS);
        }
      }
    },
    1_800_000,
  );
});

describe.skipIf(ENABLED)("GPU classify latency (skipped without env)", () => {
  it("documents the opt-in gate so CI stays honest", () => {
    expect(ENABLED).toBe(false);
  });
});
