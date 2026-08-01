import { describe, expect, it } from "vitest";
import {
  bestModel,
  formatLatencyMarkdown,
  parseLatencyModels,
  percentile,
  type GpuLatencyReport,
} from "./gpu-latency-report.js";

describe("percentile", () => {
  it("returns 0 for an empty list", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("picks nearest-rank values", () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30], 95)).toBe(30);
  });
});

describe("parseLatencyModels", () => {
  it("treats empty / single as single-model mode", () => {
    expect(parseLatencyModels(undefined)).toEqual({ kind: "single", models: [] });
    expect(parseLatencyModels("single")).toEqual({ kind: "single", models: [] });
  });

  it("parses known and comma lists", () => {
    expect(parseLatencyModels("known").kind).toBe("known");
    expect(parseLatencyModels("llava, qwen2.5vl:7b").models).toEqual([
      "llava",
      "qwen2.5vl:7b",
    ]);
  });
});

describe("bestModel / formatLatencyMarkdown", () => {
  const report: GpuLatencyReport = {
    recordedAt: "2026-08-01T00:00:00.000Z",
    mode: "record",
    budgetMs: 300,
    hardware: "RTX 3090",
    models: [
      {
        model: "slow",
        samplesMs: [4000, 4100],
        p50Ms: 4000,
        p95Ms: 4100,
        budgetMet: false,
      },
      {
        model: "faster",
        samplesMs: [2000, 2100],
        p50Ms: 2000,
        p95Ms: 2100,
        budgetMet: false,
      },
    ],
    notes: "neither met budget",
  };

  it("prefers the lowest p95 when none meet budget", () => {
    expect(bestModel(report.models)?.model).toBe("faster");
  });

  it("prefers a budget-met model over a faster miss", () => {
    expect(
      bestModel([
        { model: "miss", samplesMs: [90], p50Ms: 100, p95Ms: 100, budgetMet: false },
        { model: "hit", samplesMs: [200], p50Ms: 200, p95Ms: 250, budgetMet: true },
      ])?.model,
    ).toBe("hit");
  });

  it("ignores models that failed to load", () => {
    expect(
      bestModel([
        { model: "broken", samplesMs: [], p50Ms: 0, p95Ms: 0, budgetMet: false, error: "boom" },
        { model: "ok", samplesMs: [3000], p50Ms: 3000, p95Ms: 3000, budgetMet: false },
      ])?.model,
    ).toBe("ok");
  });

  it("renders a comparison table", () => {
    const md = formatLatencyMarkdown(report);
    expect(md).toContain("`faster`");
    expect(md).toContain("RTX 3090");
    expect(md).toContain("neither met budget");
  });
});
