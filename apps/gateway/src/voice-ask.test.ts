import { describe, expect, it } from "vitest";
import type { DatasetRecord } from "./dataset.js";
import {
  recordsToSpokenFacts,
  runVoiceAsk,
  voiceWindowBounds,
} from "./voice-ask.js";

function record(partial: Partial<DatasetRecord> & Pick<DatasetRecord, "id">): DatasetRecord {
  return {
    objectId: `obj-${partial.id}`,
    class: "dog",
    cameraId: "yard",
    timestamp: "2026-08-01T10:00:00.000Z",
    confidence: 0.97,
    evidence: [{ label: "class:dog", description: "Dog" }],
    snapshotRef: `snap-${partial.id}`,
    ...partial,
  };
}

describe("voiceWindowBounds", () => {
  const now = new Date("2026-08-01T15:30:00.000Z");

  it("maps today to UTC day bounds", () => {
    const w = voiceWindowBounds("today", now);
    expect(w.since).toBe("2026-08-01T00:00:00.000Z");
    expect(w.until).toBe("2026-08-01T23:59:59.999Z");
  });

  it("maps hour to the trailing 60 minutes", () => {
    const w = voiceWindowBounds("hour", now);
    expect(w.since).toBe("2026-08-01T14:30:00.000Z");
    expect(w.until).toBe(now.toISOString());
  });
});

describe("recordsToSpokenFacts", () => {
  it("caps and maps fields for TTS", () => {
    const facts = recordsToSpokenFacts(
      [record({ id: "a" }), record({ id: "b", class: "person" }), record({ id: "c" }), record({ id: "d" })],
      3,
    );
    expect(facts).toHaveLength(3);
    expect(facts[0]).toEqual({
      objectClass: "dog",
      cameraId: "yard",
      timestamp: "2026-08-01T10:00:00.000Z",
      confidence: 0.97,
    });
  });
});

describe("runVoiceAsk", () => {
  it("answers a query_events transcript with citations and spoken facts", async () => {
    const r = await runVoiceAsk({
      transcript: "what happened today",
      now: new Date("2026-08-01T15:00:00.000Z"),
      parse: async (transcript) => ({
        outcome: "command",
        transcript,
        command: { intent: "query_events", window: "today" },
        stt: { model: "stub" },
      }),
      getRecords: async () => [
        record({ id: "in", timestamp: "2026-08-01T12:00:00.000Z", class: "person", cameraId: "driveway" }),
        record({ id: "out", timestamp: "2026-07-30T12:00:00.000Z" }),
      ],
      speak: async (facts) => ({
        outcome: "spoken",
        speechText: `Detected ${facts[0]?.objectClass ?? "nothing"}.`,
        audioBase64: "UkZGRg==",
        mimeType: "audio/wav",
        tts: { model: "stub" },
      }),
    });
    expect(r.outcome).toBe("answered");
    expect(r.recall?.citations).toEqual(["in"]);
    expect(r.speak?.speechText).toContain("person");
    expect(r.speak?.tts?.model).toBe("stub");
  });

  it("rejects non-history intents", async () => {
    const r = await runVoiceAsk({
      transcript: "arm the system",
      parse: async (transcript) => ({
        outcome: "command",
        transcript,
        command: { intent: "set_mode", mode: "armed" },
      }),
      getRecords: async () => [],
      speak: async () => ({ outcome: "spoken", speechText: "nope" }),
    });
    expect(r.outcome).toBe("rejected");
    expect(r.rejectedReason).toMatch(/query_events/);
  });
});
