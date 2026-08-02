import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIO_EVENT_MIN_CONFIDENCE,
  createAudioEventDetector,
  resolveAudioEvent,
  StubAudioEventDetector,
  type AudioEventDetector,
} from "./audio-event.js";

describe("StubAudioEventDetector", () => {
  it("returns a labeled kind from the KIND: header", async () => {
    const d = new StubAudioEventDetector();
    const hit = await d.detect(Buffer.from("KIND:bark\npayload"));
    expect(hit).toEqual({ kind: "bark", confidence: 0.95 });
  });

  it("returns null for unknown bytes (no false positive)", async () => {
    const d = new StubAudioEventDetector();
    await expect(d.detect(Buffer.from("RIFF....not-an-event"))).resolves.toBeNull();
  });
});

describe("resolveAudioEvent", () => {
  it("accepts a stub bark fixture", async () => {
    const r = await resolveAudioEvent({
      audioBase64: Buffer.from("KIND:glass_break\n").toString("base64"),
      detector: new StubAudioEventDetector(),
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(r.outcome).toBe("event");
    expect(r.event?.kind).toBe("glass_break");
    expect(r.event?.provenance.model_version).toBe("stub");
  });

  it("rejects empty audio and unknown clips", async () => {
    const d = new StubAudioEventDetector();
    const empty = await resolveAudioEvent({ detector: d });
    expect(empty.outcome).toBe("rejected");
    const unknown = await resolveAudioEvent({
      audioBase64: Buffer.from("silence").toString("base64"),
      detector: d,
    });
    expect(unknown.outcome).toBe("rejected");
    expect(unknown.rejectedReason).toMatch(/no audio event/i);
  });

  it("rejects low confidence instead of guessing", async () => {
    const weak: AudioEventDetector = {
      name: "weak",
      async detect() {
        return { kind: "other", confidence: AUDIO_EVENT_MIN_CONFIDENCE - 0.1 };
      },
    };
    const r = await resolveAudioEvent({
      audioBase64: Buffer.from("x").toString("base64"),
      detector: weak,
    });
    expect(r.outcome).toBe("rejected");
    expect(r.rejectedReason).toMatch(/below/);
  });
});

describe("createAudioEventDetector", () => {
  it("honours WATCHINGEYE_AUDIO_EVENT=stub", () => {
    const prev = process.env.WATCHINGEYE_AUDIO_EVENT;
    process.env.WATCHINGEYE_AUDIO_EVENT = "stub";
    try {
      expect(createAudioEventDetector().name).toBe("stub");
    } finally {
      if (prev === undefined) delete process.env.WATCHINGEYE_AUDIO_EVENT;
      else process.env.WATCHINGEYE_AUDIO_EVENT = prev;
    }
  });

  it("auto soft-falls to stub when ONNX weights are missing", () => {
    const prevMode = process.env.WATCHINGEYE_AUDIO_EVENT;
    const prevModel = process.env.YAMNET_MODEL;
    process.env.WATCHINGEYE_AUDIO_EVENT = "auto";
    process.env.YAMNET_MODEL = pathNoYamnet();
    try {
      expect(createAudioEventDetector().name).toBe("stub");
    } finally {
      if (prevMode === undefined) delete process.env.WATCHINGEYE_AUDIO_EVENT;
      else process.env.WATCHINGEYE_AUDIO_EVENT = prevMode;
      if (prevModel === undefined) delete process.env.YAMNET_MODEL;
      else process.env.YAMNET_MODEL = prevModel;
    }
  });
});

function pathNoYamnet(): string {
  return path.join(process.cwd(), "definitely-missing-yamnet.onnx");
}
