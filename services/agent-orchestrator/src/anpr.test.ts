import { describe, expect, it } from "vitest";
import { extractLicensePlate } from "./anpr.js";

describe("extractLicensePlate", () => {
  it("extracts standard 7-character license plates cleanly", () => {
    const res = extractLicensePlate("Vehicle detected with license plate ABC1234 on front bumper");
    expect(res).not.toBeNull();
    expect(res?.plateText).toBe("ABC-1234");
    expect(res?.confirmed).toBe(true);
  });

  it("extracts hyphenated license plates", () => {
    const res = extractLicensePlate("License plate 7XYZ-890 identified");
    expect(res).not.toBeNull();
    expect(res?.plateText).toBe("7XYZ-890");
  });

  it("returns null when no valid license plate is found", () => {
    const res = extractLicensePlate("Just a red car parked on the street");
    expect(res).toBeNull();
  });
});
