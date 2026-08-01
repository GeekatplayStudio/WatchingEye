/**
 * Unit tests for appearance embedding math (no ONNX required).
 */
import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  cropRgba,
  l2Normalize,
  poolEmbedding,
  preprocessImageNet,
} from "./embed.js";

describe("l2Normalize", () => {
  it("produces a unit vector", () => {
    const out = l2Normalize([3, 4]);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(0.8);
  });

  it("leaves a zero vector as zeros", () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical directions", () => {
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns null on length mismatch", () => {
    expect(cosineSimilarity([1, 0], [1])).toBeNull();
  });
});

describe("cropRgba", () => {
  it("extracts the requested region", () => {
    // 2x2 image, unique colours per pixel
    const rgba = new Uint8Array([
      10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255,
    ]);
    const crop = cropRgba(rgba, 2, 2, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
    expect(crop.data[0]).toBe(40);
  });
});

describe("preprocessImageNet", () => {
  it("emits NCHW of the requested size", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(128);
    const t = preprocessImageNet(rgba, 4, 4, 8);
    expect(t.length).toBe(3 * 8 * 8);
  });
});

describe("poolEmbedding", () => {
  it("takes the CLS token from a 3D hidden state", () => {
    const data = new Float32Array([3, 4, 0, 0, 0, 0]);
    const out = poolEmbedding(data, [1, 2, 2]);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(0.8);
  });

  it("flattens an already-pooled 2D output", () => {
    const data = new Float32Array([0, 5]);
    const out = poolEmbedding(data, [1, 2]);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(1);
  });
});
