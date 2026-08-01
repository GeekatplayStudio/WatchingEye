import { describe, expect, it } from "vitest";
import {
  CLIP_EMBED_DIM,
  StubClipEmbedder,
  clipTextSidecarAvailable,
  clipVisionAvailable,
  createDefaultClipEmbedder,
} from "./clip-embed.js";

describe("StubClipEmbedder", () => {
  it("embeds text into a unit 512-d vector", async () => {
    const v = await new StubClipEmbedder().embedText("golden retriever");
    expect(v).not.toBeNull();
    expect(v!.dim).toBe(CLIP_EMBED_DIM);
    expect(v!.values).toHaveLength(CLIP_EMBED_DIM);
    const norm = Math.sqrt(v!.values.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("returns null for empty text", async () => {
    expect(await new StubClipEmbedder().embedText("  ")).toBeNull();
  });

  it("is stable for the same seed", async () => {
    const a = await new StubClipEmbedder().embedText("red car");
    const b = await new StubClipEmbedder().embedText("red car");
    expect(a!.values).toEqual(b!.values);
  });
});

describe("createDefaultClipEmbedder", () => {
  it("reports asset helpers without throwing", () => {
    expect(typeof clipVisionAvailable()).toBe("boolean");
    expect(typeof clipTextSidecarAvailable()).toBe("boolean");
  });

  it("honours stub mode", () => {
    const prev = process.env.WATCHINGEYE_CLIP_EMBED;
    process.env.WATCHINGEYE_CLIP_EMBED = "stub";
    try {
      expect(createDefaultClipEmbedder().name).toBe("stub-clip");
    } finally {
      if (prev === undefined) delete process.env.WATCHINGEYE_CLIP_EMBED;
      else process.env.WATCHINGEYE_CLIP_EMBED = prev;
    }
  });
});
