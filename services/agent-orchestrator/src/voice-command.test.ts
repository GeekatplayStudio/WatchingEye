import { describe, expect, it } from "vitest";
import { resolveVoiceCommand } from "./voice-command.js";
import { StubSpeechRecognizer } from "./whisper.js";

describe("resolveVoiceCommand", () => {
  it("parses a direct transcript without STT", async () => {
    const r = await resolveVoiceCommand({
      transcript: "arm the system",
      recognizer: new StubSpeechRecognizer("ignored"),
    });
    expect(r.outcome).toBe("command");
    expect(r.command).toEqual({ intent: "set_mode", mode: "armed" });
    expect(r.stt.model).toBe("stub");
  });

  it("rejects unknown speech instead of inventing intent", async () => {
    const r = await resolveVoiceCommand({
      transcript: "please order me a pizza",
      recognizer: new StubSpeechRecognizer(),
    });
    expect(r.outcome).toBe("rejected");
    expect(r.command).toBeNull();
    expect(r.rejectedReason).toMatch(/unrecognized/i);
  });

  it("runs stub STT on audio bytes then parses", async () => {
    const r = await resolveVoiceCommand({
      audioBase64: Buffer.from("fake-wav").toString("base64"),
      recognizer: new StubSpeechRecognizer("show me the driveway"),
    });
    expect(r.outcome).toBe("command");
    expect(r.transcript).toBe("show me the driveway");
    expect(r.command).toEqual({ intent: "show_camera", cameraId: "driveway" });
  });
});
