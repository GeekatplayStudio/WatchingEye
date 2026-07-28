import { describe, expect, it } from "vitest";
import { COCO_CLASSES, decode, iou, mapClass, nms, type YoloDetection } from "./yolo.js";
import { letterbox, unletterbox } from "./detect.js";
import { estimateDistance } from "./distance.js";

/** Build a raw `[1, 84, anchors]` tensor with the given anchors filled in. */
function tensor(
  anchors: number,
  entries: Array<{ i: number; cx: number; cy: number; w: number; h: number; cls: number; score: number }>,
): Float32Array {
  const data = new Float32Array(84 * anchors);
  for (const e of entries) {
    data[e.i] = e.cx;
    data[anchors + e.i] = e.cy;
    data[2 * anchors + e.i] = e.w;
    data[3 * anchors + e.i] = e.h;
    data[(4 + e.cls) * anchors + e.i] = e.score;
  }
  return data;
}

const PERSON = COCO_CLASSES.indexOf("person");
const DOG = COCO_CLASSES.indexOf("dog");

describe("decode", () => {
  it("turns a confident anchor into a normalised box", () => {
    const data = tensor(100, [{ i: 3, cx: 320, cy: 320, w: 128, h: 320, cls: PERSON, score: 0.9 }]);
    const out = decode(data, 100, 640);
    expect(out).toHaveLength(1);
    const d = out[0]!;
    expect(d.class).toBe("person");
    expect(d.confidence).toBeCloseTo(0.9);
    expect(d.bbox.x).toBeCloseTo((320 - 64) / 640);
    expect(d.bbox.height).toBeCloseTo(0.5);
  });

  it("drops anchors below the confidence floor", () => {
    const data = tensor(100, [{ i: 0, cx: 320, cy: 320, w: 100, h: 100, cls: PERSON, score: 0.2 }]);
    expect(decode(data, 100, 640)).toHaveLength(0);
  });

  it("drops degenerate and non-finite boxes", () => {
    const data = tensor(100, [
      { i: 0, cx: 320, cy: 320, w: 0, h: 100, cls: PERSON, score: 0.9 },
      { i: 1, cx: Number.NaN, cy: 320, w: 100, h: 100, cls: PERSON, score: 0.9 },
    ]);
    expect(decode(data, 100, 640)).toHaveLength(0);
  });

  it("keeps two different classes even when they overlap", () => {
    const data = tensor(100, [
      { i: 0, cx: 320, cy: 320, w: 200, h: 200, cls: PERSON, score: 0.9 },
      { i: 1, cx: 320, cy: 320, w: 200, h: 200, cls: DOG, score: 0.8 },
    ]);
    expect(decode(data, 100, 640)).toHaveLength(2);
  });

  it("suppresses duplicate boxes of the same class", () => {
    const data = tensor(100, [
      { i: 0, cx: 320, cy: 320, w: 200, h: 200, cls: PERSON, score: 0.9 },
      { i: 1, cx: 322, cy: 318, w: 200, h: 200, cls: PERSON, score: 0.7 },
    ]);
    const out = decode(data, 100, 640);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBeCloseTo(0.9, 5);
  });
});

describe("nms and iou", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

  it("identical boxes have iou 1, disjoint have 0", () => {
    expect(iou(box(0, 0, 0.2, 0.2), box(0, 0, 0.2, 0.2))).toBeCloseTo(1);
    expect(iou(box(0, 0, 0.2, 0.2), box(0.5, 0.5, 0.2, 0.2))).toBe(0);
  });

  it("keeps the highest-confidence box among duplicates", () => {
    const mk = (confidence: number): YoloDetection => ({
      class: "person",
      cocoLabel: "person",
      confidence,
      bbox: box(0.1, 0.1, 0.3, 0.5),
    });
    const kept = nms([mk(0.5), mk(0.95), mk(0.7)]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.confidence).toBe(0.95);
  });
});

describe("class mapping", () => {
  it("maps COCO vocabulary into the system vocabulary", () => {
    expect(mapClass("bus")).toBe("truck");
    expect(mapClass("backpack")).toBe("package");
    expect(mapClass("person")).toBe("person");
  });

  it("passes unmapped labels through rather than hiding them", () => {
    expect(mapClass("giraffe")).toBe("giraffe");
  });
});

describe("letterboxing", () => {
  it("preserves aspect ratio and round-trips a box through unletterbox", () => {
    // A wide 320x240 image: scale = 2, padY = (640-480)/2 = 80.
    const rgba = new Uint8Array(320 * 240 * 4);
    const { scale, padX, padY } = letterbox(rgba, 320, 240);
    expect(scale).toBeCloseTo(2);
    expect(padX).toBe(0);
    expect(padY).toBe(80);

    // A detection covering the model-space area where the image sits.
    const inModel: YoloDetection = {
      class: "person",
      cocoLabel: "person",
      confidence: 0.9,
      bbox: { x: 0, y: 80 / 640, width: 1, height: 480 / 640 },
    };
    const [back] = unletterbox([inModel], 320, 240, scale, padX, padY);
    expect(back!.bbox.x).toBeCloseTo(0);
    expect(back!.bbox.y).toBeCloseTo(0);
    expect(back!.bbox.width).toBeCloseTo(1);
    expect(back!.bbox.height).toBeCloseTo(1);
  });
});

describe("distance mirror", () => {
  it("matches the Rust crate's behaviour on the shared cases", () => {
    // Same sanity case as the Rust test: 1.7m person, half of a 72px frame.
    const d = estimateDistance("person", 36, 72)!;
    expect(d.metres).toBeGreaterThan(2);
    expect(d.metres).toBeLessThan(6);
    expect(d.basis).toContain("standing adult");
  });

  it("refuses unknown classes and tiny boxes", () => {
    expect(estimateDistance("giraffe", 30, 72)).toBeNull();
    expect(estimateDistance("person", 1, 72)).toBeNull();
  });

  it("halving apparent size doubles distance", () => {
    const near = estimateDistance("person", 40, 480)!;
    const far = estimateDistance("person", 20, 480)!;
    expect(far.metres / near.metres).toBeCloseTo(2, 3);
  });
});
