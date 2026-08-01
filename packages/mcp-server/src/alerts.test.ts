import { describe, expect, it } from "vitest";
import { selectAlerts, toAlertPolicy } from "./alerts.js";

describe("selectAlerts", () => {
  it("drops presentation-filtered events only", () => {
    const out = selectAlerts([
      { id: "a", filtered: true },
      { id: "b", filtered: false },
      { id: "c" },
    ]);
    expect(out.map((e) => e.id)).toEqual(["b", "c"]);
  });
});

describe("toAlertPolicy", () => {
  it("projects settings into the alert view", () => {
    expect(
      toAlertPolicy({
        trackedClasses: ["dog"],
        allowedActions: ["notify"],
        policyMinConfidence: 0.9,
        activeIntent: null,
        gateMinConfidence: 0.95,
      }),
    ).toEqual({
      trackedClasses: ["dog"],
      allowedActions: ["notify"],
      policyMinConfidence: 0.9,
      activeIntent: null,
    });
  });
});
