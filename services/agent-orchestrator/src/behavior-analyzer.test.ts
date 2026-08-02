import { describe, expect, it } from "vitest";
import {
  analyzeBehavior,
  extractBehaviorFromDescriptors,
} from "./behavior-analyzer.js";

describe("behavior-analyzer", () => {
  it("extracts behavior from descriptors", () => {
    const res = extractBehaviorFromDescriptors([
      { key: "upper_clothing", value: "red_shirt" },
      { key: "behavior", value: "waving_hand" },
    ]);
    expect(res).not.toBeNull();
    expect(res?.behavior).toBe("waving");
  });

  it("extracts fighting behavior from descriptors", () => {
    const res = extractBehaviorFromDescriptors([
      { key: "posture", value: "fighting_brawl" },
    ]);
    expect(res).not.toBeNull();
    expect(res?.behavior).toBe("fighting");
  });

  it("analyzes behavior with full provenance", () => {
    const obs = analyzeBehavior({
      objectId: "12345678-1234-4234-8234-123456789012",
      evidence: [
        { label: "raised_arm", description: "Subject raised right arm" },
        { label: "waving_motion", description: "Waving hand gesture" },
      ],
      descriptors: [{ key: "gesture", value: "waving" }],
      snapshotRef: "snap-101.jpg",
      modelVersion: "qwen2.5-vl:7b",
    });

    expect(obs.targetObjectId).toBe("12345678-1234-4234-8234-123456789012");
    expect(obs.behavior).toBe("waving");
    expect(obs.confidence).toBeGreaterThanOrEqual(0.9);
    expect(obs.intensity).toBeGreaterThan(0.5);
    expect(obs.provenance.inputImages).toEqual(["snap-101.jpg"]);
    expect(obs.provenance.modelVersion).toBe("qwen2.5-vl:7b");
  });

  it("falls back to evidence label check if descriptors miss behavior", () => {
    const obs = analyzeBehavior({
      objectId: "87654321-4321-4321-8321-210987654321",
      evidence: [
        { label: "punching_motion", description: "Subject threw a punch" },
      ],
      descriptors: [{ key: "clothing_color", value: "black" }],
      snapshotRef: "snap-102.jpg",
    });

    expect(obs.behavior).toBe("fighting");
    expect(obs.intensity).toBe(0.95);
  });
});
