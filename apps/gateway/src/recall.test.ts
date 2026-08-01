/**
 * Unit tests for grounded dataset recall (no network / Postgres).
 */
import { describe, expect, it } from "vitest";
import type { DatasetRecord } from "./dataset.js";
import {
  buildGroundedRecall,
  parseTimeWindow,
  recallFromRecords,
  scoreRecord,
  verifyGrounded,
  GroundingError,
} from "./recall.js";

function record(partial: Partial<DatasetRecord> & Pick<DatasetRecord, "id">): DatasetRecord {
  return {
    objectId: `obj-${partial.id}`,
    class: "dog",
    cameraId: "yard",
    timestamp: "2026-07-31T18:00:00.000Z",
    confidence: 0.97,
    evidence: [{ label: "fur_color", description: "Golden coat" }],
    snapshotRef: `snap-${partial.id}`,
    ...partial,
  };
}

describe("parseTimeWindow", () => {
  it("extracts yesterday bounds in UTC", () => {
    const now = new Date("2026-08-01T15:30:00.000Z");
    const w = parseTimeWindow("golden retriever yesterday", now);
    expect(w.cleanedQuery).toBe("golden retriever");
    expect(w.since).toBe("2026-07-31T00:00:00.000Z");
    expect(w.until).toBe("2026-07-31T23:59:59.999Z");
  });
});

describe("scoreRecord", () => {
  it("counts distinct term hits", () => {
    const r = record({
      id: "a",
      breedOrModel: "golden_retriever",
      class: "dog",
    });
    expect(scoreRecord(r, ["golden", "retriever"])).toBe(2);
    expect(scoreRecord(r, ["cat"])).toBe(0);
  });
});

describe("grounded recall", () => {
  it("finds a plate lookup with citations and quotes", () => {
    const hits = recallFromRecords(
      [
        record({
          id: "ds-1",
          class: "car",
          licensePlate: "ABC-1234",
          evidence: [{ label: "class:car", description: "Sedan" }],
        }),
        record({ id: "ds-2", class: "dog", breedOrModel: "shiba" }),
      ],
      "ABC-1234",
      10,
    );
    expect(hits.records).toHaveLength(1);
    expect(hits.citations).toEqual(["ds-1"]);
    expect(hits.answer).toContain("ABC-1234");
    expect(hits.evidenceQuotes.some((q) => q.label.startsWith("plate:"))).toBe(true);
  });

  it("filters yesterday and matches breed keywords", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const hits = recallFromRecords(
      [
        record({
          id: "old",
          timestamp: "2026-07-30T12:00:00.000Z",
          breedOrModel: "golden_retriever",
        }),
        record({
          id: "yest",
          timestamp: "2026-07-31T12:00:00.000Z",
          breedOrModel: "golden_retriever",
        }),
      ],
      "golden retriever yesterday",
      10,
      now,
    );
    expect(hits.records.map((r) => r.id)).toEqual(["yest"]);
    expect(hits.since).toBeDefined();
  });

  it("unions CLIP hits that keywords miss", () => {
    const clipOnly = record({
      id: "clip-1",
      class: "dog",
      breedOrModel: "shiba",
      evidence: [{ label: "clip", description: "visually similar" }],
    });
    const hits = recallFromRecords(
      [record({ id: "kw", class: "car", licensePlate: "ABC-1234" })],
      "fluffy companion animal",
      10,
      new Date(),
      [],
      [clipOnly],
    );
    expect(hits.citations).toContain("clip-1");
  });

  it("rejects citations outside the retrieved set", () => {
    const retrieved = [record({ id: "ds-1" })];
    expect(() =>
      verifyGrounded({ answer: "x", citations: ["ds-1", "hallucinated"] }, retrieved),
    ).toThrow(GroundingError);
  });

  it("builds an empty grounded answer with no citations", () => {
    const out = buildGroundedRecall([], "nobody");
    expect(out.citations).toEqual([]);
    expect(out.answer).toContain("No matching");
  });
});
