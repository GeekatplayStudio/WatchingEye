import { describe, expect, it } from "vitest";
import { parseNaturalLanguageIntent } from "./nl-parser.js";

describe("parseNaturalLanguageIntent", () => {
  it("parses dog registration requests correctly", () => {
    const res = parseNaturalLanguageIntent("track and register all dogs");
    expect(res.targetClasses).toContain("dog");
    expect(res.attributes).toContain("breed");
    expect(res.actionPolicy).toBe("dataset_enroll");
  });

  it("parses vehicle license plate capture requests correctly", () => {
    const res = parseNaturalLanguageIntent("track all cars passing by my house and capture all license plates");
    expect(res.targetClasses).toContain("car");
    expect(res.attributes).toContain("license_plate");
    expect(res.actionPolicy).toBe("anpr_ocr");
  });

  it("parses person detection requests", () => {
    const res = parseNaturalLanguageIntent("notify me if any person approaches");
    expect(res.targetClasses).toContain("person");
    expect(res.actionPolicy).toBe("notify");
  });

  it("falls back to moving_region for generic prompts", () => {
    const res = parseNaturalLanguageIntent("monitor everything");
    expect(res.targetClasses).toContain("moving_region");
    expect(res.actionPolicy).toBe("monitor");
  });
});
