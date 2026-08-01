import { describe, expect, it } from "vitest";
import {
  buildTextBlob,
  StubTextEmbedder,
  TEXT_EMBED_DIM,
} from "./text-embed.js";

describe("StubTextEmbedder", () => {
  it("returns a unit vector of the configured dim", async () => {
    const emb = await new StubTextEmbedder().embed("golden retriever");
    expect(emb).not.toBeNull();
    expect(emb!.dim).toBe(TEXT_EMBED_DIM);
    expect(emb!.values).toHaveLength(TEXT_EMBED_DIM);
    const norm = Math.sqrt(emb!.values.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic for the same text", async () => {
    const stub = new StubTextEmbedder(64);
    const a = await stub.embed("ABC-1234");
    const b = await stub.embed("ABC-1234");
    expect(a!.values).toEqual(b!.values);
  });

  it("returns null for empty text", async () => {
    expect(await new StubTextEmbedder().embed("   ")).toBeNull();
  });
});

describe("buildTextBlob", () => {
  it("joins class, breed, plate, and evidence", () => {
    const blob = buildTextBlob({
      class: "dog",
      breedOrModel: "golden_retriever",
      licensePlate: undefined,
      evidence: [{ label: "fur_color", description: "Golden coat" }],
    });
    expect(blob).toContain("dog");
    expect(blob).toContain("golden retriever");
    expect(blob).toContain("Golden coat");
  });
});
