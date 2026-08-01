import { describe, expect, it } from "vitest";
import { createSpeechSynthesizer, StubSpeechSynthesizer } from "./piper.js";

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
});
