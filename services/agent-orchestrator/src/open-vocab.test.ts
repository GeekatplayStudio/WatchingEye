import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import {
  ColorHistogramScorer,
  StubOpenVocabScorer,
  enrichDescriptorsFromOpenVocab,
  OPEN_VOCAB_FLOOR,
  OPEN_VOCAB_STUB_MODEL,
} from "./open-vocab.js";

function solidJpeg(r: number, g: number, b: number): string {
  const width = 16;
  const height = 16;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data).toString("base64");
}

describe("StubOpenVocabScorer", () => {
  it("returns breed and fur_color for dogs", async () => {
    const hits = await new StubOpenVocabScorer().score("", "dog");
    expect(hits.map((h) => h.key).sort()).toEqual(["breed", "fur_color"]);
    expect(hits[0]?.modelVersion).toBe(OPEN_VOCAB_STUB_MODEL);
  });
});

describe("ColorHistogramScorer", () => {
  it("labels a red patch as red/vehicle_color for cars", async () => {
    const hits = await new ColorHistogramScorer().score(solidJpeg(200, 30, 30), "car");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.key).toBe("vehicle_color");
    expect(hits[0]?.value).toBe("red");
    expect(hits[0]?.confidence).toBeGreaterThan(OPEN_VOCAB_FLOOR);
  });

  it("labels a near-black patch for dogs as fur_color", async () => {
    const hits = await new ColorHistogramScorer().score(solidJpeg(20, 20, 20), "dog");
    expect(hits[0]?.key).toBe("fur_color");
    expect(hits[0]?.value).toBe("black");
  });

  it("returns nothing for unsupported classes", async () => {
    expect(await new ColorHistogramScorer().score(solidJpeg(0, 0, 0), "package")).toEqual([]);
  });
});

describe("enrichDescriptorsFromOpenVocab", () => {
  it("merges hits above the floor without overwriting VLM keys", () => {
    const { descriptors, added } = enrichDescriptorsFromOpenVocab(
      [{ key: "fur_color", value: "cream" }],
      [
        {
          key: "fur_color",
          value: "golden",
          confidence: 0.9,
          modelVersion: "t",
        },
        {
          key: "breed",
          value: "shiba",
          confidence: 0.9,
          modelVersion: "t",
        },
        {
          key: "vehicle_color",
          value: "blue",
          confidence: 0.2,
          modelVersion: "t",
        },
      ],
    );
    expect(descriptors.map((d) => d.key).sort()).toEqual(["breed", "fur_color"]);
    expect(descriptors.find((d) => d.key === "fur_color")?.value).toBe("cream");
    expect(added.map((h) => h.key)).toEqual(["breed"]);
  });
});
