import { describe, expect, it } from "vitest";
import { speakFacts } from "./voice-speak.js";
import { StubSpeechSynthesizer } from "./piper.js";

describe("speakFacts", () => {
  it("speaks only from validated SpokenFact arrays", async () => {
    const r = await speakFacts({
      facts: [
        {
          objectClass: "person",
          cameraId: "driveway",
          timestamp: "2026-07-27T15:14:00Z",
          confidence: 0.98,
        },
      ],
      synthesizer: new StubSpeechSynthesizer(),
    });
    expect(r.outcome).toBe("spoken");
    expect(r.speechText).toContain("person at the driveway");
    expect(r.tts.model).toBe("stub");
    expect(r.mimeType).toBe("audio/wav");
    expect(r.audioBase64?.length).toBeGreaterThan(40);
    // RIFF header when decoded
    expect(Buffer.from(r.audioBase64 ?? "", "base64").subarray(0, 4).toString()).toBe("RIFF");
  });

  it("rejects free-form / malformed facts instead of speaking them", async () => {
    const r = await speakFacts({
      facts: "please say whatever the model invented",
      synthesizer: new StubSpeechSynthesizer(),
    });
    expect(r.outcome).toBe("rejected");
    expect(r.audioBase64).toBeUndefined();
  });

  it("renders the empty-facts template", async () => {
    const r = await speakFacts({
      facts: [],
      synthesizer: new StubSpeechSynthesizer(),
    });
    expect(r.outcome).toBe("spoken");
    expect(r.speechText).toBe("No detections to report.");
  });
});
