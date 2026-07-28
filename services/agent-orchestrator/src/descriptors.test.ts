import { describe, expect, it } from "vitest";
import { extractDescriptors, buildPrompt, DESCRIPTOR_KEYS } from "./vlm.js";
import type { TriggerEvent } from "./schema.js";

const EVENT: TriggerEvent = {
  objectId: "obj-1",
  class: "moving_region",
  confidence: 0.98,
  frames: [1, 2, 3],
  cameraId: "webcam",
  snapshotRef: "frame-3",
};

function reply(descriptors: unknown): string {
  return JSON.stringify({
    object_class: "person",
    confidence: 0.96,
    risk: 0.2,
    evidence: [{ label: "walking", description: "Walking" }],
    descriptors,
    proposed_action: "notify",
  });
}

describe("prompt asks for identifying features", () => {
  it("lists the preferred descriptor keys", () => {
    const p = buildPrompt(EVENT);
    for (const key of DESCRIPTOR_KEYS) expect(p).toContain(key);
    expect(p).toContain("recognise this same individual again");
  });

  it("tells the model to omit rather than guess", () => {
    expect(buildPrompt(EVENT)).toContain("Omit a key entirely rather than guessing");
  });
});

describe("descriptor extraction", () => {
  it("keeps well-formed attributes, normalised", () => {
    const out = extractDescriptors(
      reply([{ key: "Upper_Clothing", value: " Blue_Jacket " }]),
    );
    expect(out).toEqual([{ key: "upper_clothing", value: "blue_jacket" }]);
  });

  it("drops entries that are not key/value strings", () => {
    const out = extractDescriptors(
      reply([{ key: "fur_color", value: "brown" }, "nonsense", { key: 5, value: 6 }, null]),
    );
    expect(out).toEqual([{ key: "fur_color", value: "brown" }]);
  });

  it("drops placeholder values instead of storing them", () => {
    // "unknown" as an attribute value would match every other unknown and
    // silently merge unrelated individuals.
    const out = extractDescriptors(
      reply([
        { key: "license_plate", value: "unknown" },
        { key: "hair_color", value: "n/a" },
        { key: "fur_color", value: "" },
      ]),
    );
    expect(out).toEqual([]);
  });

  it("keeps only the first of a duplicated key", () => {
    const out = extractDescriptors(
      reply([
        { key: "fur_color", value: "brown" },
        { key: "fur_color", value: "black" },
      ]),
    );
    expect(out).toEqual([{ key: "fur_color", value: "brown" }]);
  });

  it("returns nothing for unparseable output", () => {
    expect(extractDescriptors("I saw a dog.")).toEqual([]);
  });

  it("returns nothing when the model omitted descriptors", () => {
    expect(extractDescriptors(reply(undefined))).toEqual([]);
  });

  it("handles a markdown-fenced reply", () => {
    const fenced = "```json\n" + reply([{ key: "breed", value: "shiba" }]) + "\n```";
    expect(extractDescriptors(fenced)).toEqual([{ key: "breed", value: "shiba" }]);
  });
});
