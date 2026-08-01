import { describe, expect, it } from "vitest";
import {
  clipOpenVocabAvailable,
  CLIP_EMBED_DIM,
  OnnxClipOpenVocabScorer,
} from "./open-vocab-clip.js";

describe("OnnxClipOpenVocabScorer soft-fail", () => {
  it("reports availability without throwing", () => {
    expect(typeof clipOpenVocabAvailable()).toBe("boolean");
  });

  it("returns [] when weights are missing", async () => {
    if (clipOpenVocabAvailable()) return; // skip assert when operator exported weights
    const hits = await new OnnxClipOpenVocabScorer().score("not-jpeg", "dog");
    expect(hits).toEqual([]);
  });

  it("documents CLIP embed dim", () => {
    expect(CLIP_EMBED_DIM).toBe(512);
  });
});
