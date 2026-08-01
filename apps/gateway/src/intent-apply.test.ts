/**
 * Unit tests for active-intent application (no network).
 */
import { describe, expect, it } from "vitest";
import { applyActiveIntent } from "./intent-apply.js";
import type { ActiveTrackingIntent } from "./settings.js";

function intent(partial: Partial<ActiveTrackingIntent>): ActiveTrackingIntent {
  return {
    rawPrompt: "test",
    targetClasses: ["car"],
    attributes: [],
    actionPolicy: "monitor",
    datasetEnroll: false,
    anprEnabled: false,
    appliedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("applyActiveIntent", () => {
  it("enrolls by default when no intent is set", () => {
    const out = applyActiveIntent({
      objectClass: "dog",
      descriptors: [{ key: "breed", value: "shiba" }],
      evidence: [],
      intent: null,
    });
    expect(out.shouldEnroll).toBe(true);
    expect(out.descriptors).toHaveLength(1);
  });

  it("skips dataset enroll when intent monitors without enroll", () => {
    const out = applyActiveIntent({
      objectClass: "dog",
      descriptors: [{ key: "breed", value: "shiba" }],
      evidence: [],
      intent: intent({ datasetEnroll: false, anprEnabled: false, actionPolicy: "monitor" }),
    });
    expect(out.shouldEnroll).toBe(false);
  });

  it("enrolls when dataset_enroll is set", () => {
    const out = applyActiveIntent({
      objectClass: "dog",
      descriptors: [{ key: "breed", value: "shiba" }, { key: "size", value: "small" }],
      evidence: [],
      intent: intent({
        targetClasses: ["dog"],
        attributes: ["breed", "color"],
        datasetEnroll: true,
        actionPolicy: "dataset_enroll",
      }),
    });
    expect(out.shouldEnroll).toBe(true);
    expect(out.descriptors.map((d) => d.key)).toEqual(["breed"]);
    expect(out.breedOrModel).toBe("shiba");
  });

  it("runs regex ANPR and attaches plate evidence when enabled", () => {
    const out = applyActiveIntent({
      objectClass: "car",
      descriptors: [{ key: "color", value: "green" }],
      evidence: [{ label: "class:car", description: "a car" }],
      rawAnalysis: "green sedan with plate ABC-1234 in frame",
      intent: intent({
        anprEnabled: true,
        actionPolicy: "anpr_ocr",
        attributes: ["license_plate", "color"],
      }),
    });
    expect(out.shouldEnroll).toBe(true);
    expect(out.licensePlate).toBe("ABC-1234");
    expect(out.descriptors.some((d) => d.key === "license_plate")).toBe(true);
    expect(out.evidence.some((e) => e.label === "plate:ABC-1234")).toBe(true);
    expect(out.ocrUnconfirmed).toBe(false);
  });
});
