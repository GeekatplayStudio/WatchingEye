import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WAKE_MIN_CONFIDENCE,
  createWakeWordDetector,
  resolveWake,
  StubWakeWordDetector,
  type WakeWordDetector,
} from "./wake-word.js";

describe("StubWakeWordDetector", () => {
  it("returns a hit from the WAKE: header", async () => {
    const d = new StubWakeWordDetector();
    const hit = await d.detect(Buffer.from("WAKE:watchingeye\npayload"));
    expect(hit).toEqual({ keyword: "watchingeye", confidence: 0.95 });
  });

  it("returns null for unknown bytes (no false wake)", async () => {
    const d = new StubWakeWordDetector();
    await expect(d.detect(Buffer.from("RIFF....silence"))).resolves.toBeNull();
  });
});

describe("resolveWake", () => {
  it("accepts a stub wake fixture", async () => {
    const r = await resolveWake({
      audioBase64: Buffer.from("WAKE:watchingeye\n").toString("base64"),
      detector: new StubWakeWordDetector(),
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(r.outcome).toBe("wake");
    expect(r.detection?.keyword).toBe("watchingeye");
    expect(r.detection?.provenance.model_version).toBe("stub");
  });

  it("rejects empty audio and unknown clips", async () => {
    const d = new StubWakeWordDetector();
    const empty = await resolveWake({ detector: d });
    expect(empty.outcome).toBe("rejected");
    const unknown = await resolveWake({
      audioBase64: Buffer.from("silence").toString("base64"),
      detector: d,
    });
    expect(unknown.outcome).toBe("rejected");
    expect(unknown.rejectedReason).toMatch(/no wake/i);
  });

  it("rejects low confidence instead of guessing", async () => {
    const weak: WakeWordDetector = {
      name: "weak",
      async detect() {
        return { keyword: "watchingeye", confidence: WAKE_MIN_CONFIDENCE - 0.1 };
      },
    };
    const r = await resolveWake({
      audioBase64: Buffer.from("x").toString("base64"),
      detector: weak,
    });
    expect(r.outcome).toBe("rejected");
    expect(r.rejectedReason).toMatch(/below/);
  });
});

describe("createWakeWordDetector", () => {
  it("honours WATCHINGEYE_WAKE=stub", () => {
    const prev = process.env.WATCHINGEYE_WAKE;
    process.env.WATCHINGEYE_WAKE = "stub";
    try {
      expect(createWakeWordDetector().name).toBe("stub");
    } finally {
      if (prev === undefined) delete process.env.WATCHINGEYE_WAKE;
      else process.env.WATCHINGEYE_WAKE = prev;
    }
  });

  it("auto soft-falls to stub when engine weights are missing", () => {
    const prevMode = process.env.WATCHINGEYE_WAKE;
    const prevModel = process.env.WAKE_MODEL;
    process.env.WATCHINGEYE_WAKE = "auto";
    process.env.WAKE_MODEL = path.join(process.cwd(), "definitely-missing-wake.bin");
    try {
      expect(createWakeWordDetector().name).toBe("stub");
    } finally {
      if (prevMode === undefined) delete process.env.WATCHINGEYE_WAKE;
      else process.env.WATCHINGEYE_WAKE = prevMode;
      if (prevModel === undefined) delete process.env.WAKE_MODEL;
      else process.env.WAKE_MODEL = prevModel;
    }
  });
});
