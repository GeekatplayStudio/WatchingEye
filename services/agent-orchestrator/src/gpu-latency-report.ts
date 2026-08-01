/**
 * Pure helpers for the opt-in GPU classify latency harness (ROADMAP 2.2).
 *
 * Kept free of vitest / Ollama so unit tests can exercise formatting without
 * a GPU.
 */

/** One model's timed run (or a load/runtime skip). */
export interface GpuLatencyModelResult {
  model: string;
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  budgetMet: boolean;
  /** Set when the model could not be timed (missing arch, OOM, etc.). */
  error?: string;
}

/** Full comparative (or single-model) write payload. */
export interface GpuLatencyReport {
  recordedAt: string;
  mode: string;
  budgetMs: number;
  hardware?: string;
  models: GpuLatencyModelResult[];
  notes: string;
}

/**
 * Nearest-rank percentile on a pre-sorted ascending sample list.
 *
 * @example
 * percentile([10, 20, 30], 50); // 20
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx] ?? 0;
}

/**
 * Parse `WATCHINGEYE_GPU_LATENCY_MODELS` — comma list, or `known` / empty.
 *
 * @example
 * parseLatencyModels("llava, qwen2.5vl:7b"); // ["llava", "qwen2.5vl:7b"]
 * parseLatencyModels("known"); // []  (caller expands against known list)
 */
export function parseLatencyModels(raw: string | undefined): {
  kind: "explicit" | "known" | "single";
  models: string[];
} {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "" || trimmed.toLowerCase() === "single") {
    return { kind: "single", models: [] };
  }
  if (trimmed.toLowerCase() === "known") {
    return { kind: "known", models: [] };
  }
  const models = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { kind: "explicit", models };
}

/** Build markdown for a comparative (or single) latency report. */
export function formatLatencyMarkdown(report: GpuLatencyReport): string {
  const rows = report.models
    .map((m) => {
      if (m.error) {
        return `| \`${m.model}\` | — | — | — | **error** |`;
      }
      return `| \`${m.model}\` | ${m.samplesMs.length} | ${m.p50Ms} | ${m.p95Ms} | **${m.budgetMet ? "yes" : "no"}** |`;
    })
    .join("\n");
  const raw = report.models
    .map((m) =>
      m.error
        ? `- \`${m.model}\`: ERROR — ${m.error}`
        : `- \`${m.model}\`: ${m.samplesMs.join(", ")}`,
    )
    .join("\n");
  const hw = report.hardware ? `\nHardware: ${report.hardware}\n` : "\n";
  return `# GPU classify latency results (ROADMAP 2.2)

Recorded: \`${report.recordedAt}\`
Mode: \`${report.mode}\`${hw}
Budget: **${report.budgetMs} ms** (p95)

| Model | samples | p50 (ms) | p95 (ms) | budget met |
|-------|--------:|---------:|---------:|:----------:|
${rows}

Raw samples (ms):
${raw}

${report.notes}
`;
}

/**
 * Pick the lowest-p95 model that met the budget, else the fastest overall.
 *
 * @example
 * bestModel([{ model: "a", p95Ms: 100, budgetMet: true, samplesMs: [], p50Ms: 90 }])?.model; // "a"
 */
export function bestModel(
  models: readonly GpuLatencyModelResult[],
): GpuLatencyModelResult | undefined {
  const timed = models.filter((m) => m.error === undefined && m.samplesMs.length > 0);
  if (timed.length === 0) return undefined;
  const under = timed.filter((m) => m.budgetMet);
  const pool = under.length > 0 ? under : timed;
  return pool.reduce((a, b) => (a.p95Ms <= b.p95Ms ? a : b));
}
