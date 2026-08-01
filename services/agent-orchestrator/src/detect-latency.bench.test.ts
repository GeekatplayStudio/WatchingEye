/**
 * Opt-in YOLO detect latency benchmark — ROADMAP Step 1.3.
 *
 * Modes via `WATCHINGEYE_DETECT_LATENCY`:
 * - `1` — assert warm p95 &lt; 100 ms
 * - `record` — measure + write results; no budget assert
 *
 * Default `npm test` skips so CI never claims the budget without weights/GPU.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { detect, modelAvailable } from "./detect.js";

const MODE = (process.env.WATCHINGEYE_DETECT_LATENCY ?? "").toLowerCase();
const ENABLED = MODE === "1" || MODE === "record";
const ASSERT_BUDGET = MODE === "1";
const BUDGET_MS = 100;
const SAMPLES = Math.max(1, Number(process.env.WATCHINGEYE_DETECT_LATENCY_SAMPLES ?? 5) || 5);

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "..", "docs");
const RESULTS_JSON = join(RESULTS_DIR, "detect-latency-results.json");
const RESULTS_MD = join(RESULTS_DIR, "detect-latency-results.md");

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx] ?? 0;
}

/** Synthetic 640×480 JPEG so jpeg-js can decode without PNG fixtures. */
function benchJpeg(): string {
  const width = 640;
  const height = 480;
  const data = Buffer.alloc(width * height * 4, 40);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  // Bright rectangle so YOLO has something to look at (optional).
  for (let y = 180; y < 300; y += 1) {
    for (let x = 240; x < 400; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = 220;
      data[i + 1] = 220;
      data[i + 2] = 220;
    }
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data).toString("base64");
}

function writeResults(payload: {
  recordedAt: string;
  model: string;
  ep: string;
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  budgetMs: number;
  budgetMet: boolean;
  mode: string;
}): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(RESULTS_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const md = `# YOLO detect latency results (ROADMAP 1.3)

Recorded: \`${payload.recordedAt}\`
Mode: \`${payload.mode}\`
Model: \`${payload.model}\`
ORT EP env: \`${payload.ep}\`

| Metric | Value |
|--------|------:|
| samples | ${payload.samplesMs.length} |
| p50 | ${payload.p50Ms} ms |
| p95 | ${payload.p95Ms} ms |
| budget | ${payload.budgetMs} ms |
| budget met | **${payload.budgetMet ? "yes" : "no"}** |

Raw samples (ms): ${payload.samplesMs.join(", ")}
`;
  writeFileSync(RESULTS_MD, md, "utf8");
}

describe.skipIf(!ENABLED)("YOLO detect latency (opt-in)", () => {
  it(
    `detect p95 under ${BUDGET_MS} ms (${SAMPLES} samples${ASSERT_BUDGET ? ", assert" : ", record-only"})`,
    async () => {
      expect(modelAvailable(), "yolo11n.onnx missing — run scripts/install-models").toBe(true);
      const image = benchJpeg();
      await detect(image); // warm

      const samplesMs: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const started = Date.now();
        await detect(image);
        samplesMs.push(Date.now() - started);
      }
      const sorted = [...samplesMs].sort((a, b) => a - b);
      const p50Ms = percentile(sorted, 50);
      const p95Ms = percentile(sorted, 95);
      const budgetMet = p95Ms < BUDGET_MS;
      writeResults({
        recordedAt: new Date().toISOString(),
        model: "yolo11n-onnx",
        ep: process.env.WATCHINGEYE_ORT_EP ?? "auto",
        samplesMs,
        p50Ms,
        p95Ms,
        budgetMs: BUDGET_MS,
        budgetMet,
        mode: MODE,
      });
      // eslint-disable-next-line no-console -- operator-facing bench summary
      console.log(
        `[detect-latency] samples=${samplesMs.join(",")} p50=${p50Ms} p95=${p95Ms} budget=${BUDGET_MS} met=${budgetMet}`,
      );
      if (ASSERT_BUDGET) {
        expect(p95Ms, `p95 detect ${p95Ms} ms ≥ ${BUDGET_MS}`).toBeLessThan(BUDGET_MS);
      }
    },
    120_000,
  );
});

describe.skipIf(ENABLED)("YOLO detect latency (skipped without env)", () => {
  it("documents the opt-in gate so CI stays honest", () => {
    expect(ENABLED).toBe(false);
  });
});
