import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSpeechSynthesizer,
  piperModelAvailable,
  StubSpeechSynthesizer,
} from "./piper.js";

describe("StubSpeechSynthesizer", () => {
  it("returns a WAV beep", async () => {
    const tts = new StubSpeechSynthesizer();
    expect(tts.name).toBe("stub");
    const wav = await tts.speak("hello");
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe("RIFF");
  });
});

describe("createSpeechSynthesizer", () => {
  it("honours WATCHINGEYE_PIPER=stub", () => {
    const prev = process.env.WATCHINGEYE_PIPER;
    process.env.WATCHINGEYE_PIPER = "stub";
    try {
      expect(createSpeechSynthesizer().name).toBe("stub");
    } finally {
      if (prev === undefined) delete process.env.WATCHINGEYE_PIPER;
      else process.env.WATCHINGEYE_PIPER = prev;
    }
  });

  it("auto soft-falls to stub when ONNX+json are missing", () => {
    const prevMode = process.env.WATCHINGEYE_PIPER;
    const prevModel = process.env.PIPER_MODEL;
    process.env.WATCHINGEYE_PIPER = "auto";
    process.env.PIPER_MODEL = path.join(process.cwd(), "definitely-missing-piper.onnx");
    try {
      expect(piperModelAvailable(process.env.PIPER_MODEL)).toBe(false);
      expect(createSpeechSynthesizer().name).toBe("stub");
    } finally {
      if (prevMode === undefined) delete process.env.WATCHINGEYE_PIPER;
      else process.env.WATCHINGEYE_PIPER = prevMode;
      if (prevModel === undefined) delete process.env.PIPER_MODEL;
      else process.env.PIPER_MODEL = prevModel;
    }
  });
});
