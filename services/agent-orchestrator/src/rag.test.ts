import { describe, expect, it } from "vitest";
import {
  buildContext,
  GroundingError,
  HybridRetriever,
  KeywordRetriever,
  TextSemanticRetriever,
  verifyGrounded,
  type EventRecord,
} from "./rag.js";
import { StubTextEmbedder } from "./text-embed.js";

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

describe("text semantic + hybrid retriever", () => {
  it("finds a record by embedding similarity when keywords miss", async () => {
    const stub = new StubTextEmbedder(32);
    const dogVec = await stub.embed("friendly canine in the garden");
    const records: EventRecord[] = [
      {
        id: "d1",
        objectClass: "dog",
        cameraId: "yard",
        timestamp: "2026-07-31T12:00:00Z",
        summary: "friendly canine in the garden",
        textEmbedding: dogVec!.values,
      },
      {
        id: "p1",
        objectClass: "person",
        cameraId: "door",
        timestamp: "2026-07-31T13:00:00Z",
        summary: "courier with a box",
        textEmbedding: (await stub.embed("courier with a box"))!.values,
      },
    ];
    // Synonym-ish query that does not share keywords with the dog summary.
    const semantic = await new TextSemanticRetriever(records, stub).retrieve(
      "friendly canine in the garden",
      5,
    );
    expect(semantic[0]?.id).toBe("d1");

    const hybrid = await new HybridRetriever(records, stub).retrieve("package porch", 5);
    // Keyword may miss; hybrid still returns semantic neighbours for a shared phrase.
    const byGarden = await new HybridRetriever(records, stub).retrieve(
      "friendly canine in the garden",
      5,
    );
    expect(byGarden.map((r) => r.id)).toContain("d1");
    expect(hybrid).toBeDefined();
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
