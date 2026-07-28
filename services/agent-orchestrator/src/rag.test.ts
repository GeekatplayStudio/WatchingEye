import { describe, expect, it } from "vitest";
import {
  buildContext,
  GroundingError,
  KeywordRetriever,
  verifyGrounded,
  type EventRecord,
} from "./rag.js";

const RECORDS: EventRecord[] = [
  {
    id: "e1",
    objectClass: "person",
    cameraId: "driveway",
    timestamp: "2026-07-27T15:14:00Z",
    summary: "Person walking toward front door",
  },
  {
    id: "e2",
    objectClass: "dog",
    cameraId: "backyard",
    timestamp: "2026-07-27T16:00:00Z",
    summary: "Dog crossing the yard",
  },
  {
    id: "e3",
    objectClass: "person",
    cameraId: "porch",
    timestamp: "2026-07-27T17:30:00Z",
    summary: "Person delivering a package",
  },
];

describe("keyword retriever", () => {
  it("returns matching records, most relevant first", async () => {
    const results = await new KeywordRetriever(RECORDS).retrieve("person driveway", 10);
    expect(results[0]?.id).toBe("e1");
  });

  it("breaks score ties by recency", async () => {
    const results = await new KeywordRetriever(RECORDS).retrieve("person", 10);
    expect(results.map((r) => r.id)).toEqual(["e3", "e1"]);
  });

  it("returns nothing when no term matches", async () => {
    expect(await new KeywordRetriever(RECORDS).retrieve("helicopter", 10)).toEqual([]);
  });

  it("respects the limit", async () => {
    expect(await new KeywordRetriever(RECORDS).retrieve("person", 1)).toHaveLength(1);
  });
});

describe("grounding verification", () => {
  it("accepts an answer citing retrieved records", () => {
    const answer = { answer: "A person arrived.", citations: ["e1"] };
    expect(verifyGrounded(answer, RECORDS)).toEqual(answer);
  });

  it("rejects a fabricated citation", () => {
    expect(() =>
      verifyGrounded({ answer: "A truck arrived.", citations: ["e9"] }, RECORDS),
    ).toThrow(GroundingError);
  });

  it("rejects when only some citations are real", () => {
    try {
      verifyGrounded({ answer: "Two events.", citations: ["e1", "e42"] }, RECORDS);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as GroundingError).unknownCitations).toEqual(["e42"]);
    }
  });
});

describe("context building", () => {
  it("includes ids so citations can be verified", () => {
    expect(buildContext([RECORDS[0]!])).toContain("[e1]");
  });

  it("handles the empty case", () => {
    expect(buildContext([])).toBe("No matching events.");
  });
});
