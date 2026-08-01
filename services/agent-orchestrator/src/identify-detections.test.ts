/**
 * Unit tests for detect→batch-identify wiring (mocked embed/registry).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./embed.js", () => ({
  embedModelAvailable: vi.fn(() => true),
  embed: vi.fn(async (_img: string, bbox: { x: number }) => ({
    embedding: {
      model: "dinov2-vits14-onnx",
      values: [bbox.x, 1 - bbox.x, 0],
      dim: 3,
    },
  })),
}));

vi.mock("./identity.js", () => ({
  identifyBatch: vi.fn(async (sightings: Array<{ class: string }>) =>
    sightings.map((s, i) => ({
      identity_id: `id-${i}`,
      name: null,
      class: s.class,
      is_new: true,
      sightings: 1,
      evidence: null,
      rejected: [],
      quality: "weak",
      status: "tentative",
      ambiguous: false,
    })),
  ),
}));

import { identifyDetections } from "./identify-detections.js";
import { identifyBatch } from "./identity.js";
import { embedModelAvailable } from "./embed.js";

describe("identifyDetections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embedModelAvailable).mockReturnValue(true);
  });

  it("returns empty when there are no objects", async () => {
    expect(await identifyDetections("jpeg", [], "cam")).toEqual([]);
    expect(identifyBatch).not.toHaveBeenCalled();
  });

  it("skips embedding when the model is missing", async () => {
    vi.mocked(embedModelAvailable).mockReturnValue(false);
    const out = await identifyDetections(
      "jpeg",
      [
        {
          class: "person",
          cocoLabel: "person",
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.4 },
          distance: null,
        },
      ],
      "cam",
    );
    expect(out[0]?.identity).toBeNull();
    expect(identifyBatch).not.toHaveBeenCalled();
  });

  it("embeds each crop and batch-assigns identities", async () => {
    const out = await identifyDetections(
      "jpeg",
      [
        {
          class: "person",
          cocoLabel: "person",
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.4 },
          distance: null,
        },
        {
          class: "person",
          cocoLabel: "person",
          confidence: 0.8,
          bbox: { x: 0.6, y: 0.1, width: 0.2, height: 0.4 },
          distance: null,
        },
      ],
      "webcam",
    );
    expect(identifyBatch).toHaveBeenCalledOnce();
    expect(out).toHaveLength(2);
    expect(out[0]?.identity?.identity_id).toBe("id-0");
    expect(out[1]?.identity?.identity_id).toBe("id-1");
  });
});
