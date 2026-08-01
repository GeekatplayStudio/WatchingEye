import { describe, expect, it } from "vitest";
import { createSpeechRecognizer, StubSpeechRecognizer } from "./whisper.js";

describe("StubSpeechRecognizer", () => {
  it("returns canned text for file and pcm paths", async () => {
    const stt = new StubSpeechRecognizer("system status");
    expect(stt.name).toBe("stub");
    await expect(stt.transcribe(new Float32Array(8))).resolves.toBe("system status");
    await expect(stt.transcribeFile(new Uint8Array([1, 2, 3]))).resolves.toBe("system status");
  });
});

describe("createSpeechRecognizer", () => {
  it("honours WATCHINGEYE_WHISPER=stub", () => {
    const prev = process.env.WATCHINGEYE_WHISPER;
    process.env.WATCHINGEYE_WHISPER = "stub";
    try {
      expect(createSpeechRecognizer().name).toBe("stub");
    } finally {
      if (prev === undefined) delete process.env.WATCHINGEYE_WHISPER;
      else process.env.WATCHINGEYE_WHISPER = prev;
    }
  });
});
