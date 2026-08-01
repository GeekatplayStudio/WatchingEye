import { describe, expect, it } from "vitest";
import { parseNaturalLanguageIntent } from "./nl-parser.js";

describe("parseNaturalLanguageIntent", () => {
  it("parses dog registration into dog + dataset enrollment", () => {
    const res = parseNaturalLanguageIntent("track and register all dogs");
    expect(res.targetClasses).toEqual(["dog"]);
    expect(res.attributes).toEqual(expect.arrayContaining(["breed", "color"]));
    expect(res.actionPolicy).toBe("dataset_enroll");
    expect(res.datasetEnroll).toBe(true);
    expect(res.anprEnabled).toBe(false);
  });

  it("parses vehicle plate capture into cars + ANPR", () => {
    const res = parseNaturalLanguageIntent(
      "track all cars passing by my house and capture all license plates",
    );
    expect(res.targetClasses).toContain("car");
    expect(res.attributes).toContain("license_plate");
    expect(res.actionPolicy).toBe("anpr_ocr");
    expect(res.anprEnabled).toBe(true);
  });

  it("parses person notify requests", () => {
    const res = parseNaturalLanguageIntent("notify me if any person approaches");
    expect(res.targetClasses).toContain("person");
    expect(res.actionPolicy).toBe("notify");
  });

  it("defaults unknown prompts to person rather than inventing classes", () => {
    const res = parseNaturalLanguageIntent("monitor everything");
    expect(res.targetClasses).toEqual(["person"]);
    expect(res.actionPolicy).toBe("monitor");
  });

  it("never emits classes outside the gateway allow-list", () => {
    const res = parseNaturalLanguageIntent("track trucks and motorcycles");
    expect(res.targetClasses).toContain("truck");
    expect(res.targetClasses).not.toContain("motorcycle");
    expect(res.targetClasses).not.toContain("bus");
  });
});
