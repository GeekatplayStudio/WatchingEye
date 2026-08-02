import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OpenWakeWordDetector,
  keywordFromModelPath,
  openWakeWordAssetsAvailable,
} from "./openwakeword-wake.js";

function pcmWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return new Uint8Array(buf);
}

describe("keywordFromModelPath", () => {
  it("maps allowlisted classifier basenames", () => {
    expect(keywordFromModelPath("/x/hey_jarvis_v0.1.onnx")).toBe("hey_jarvis");
    expect(keywordFromModelPath("watchingeye.onnx")).toBe("watchingeye");
  });

  it("refuses unknown stems (no foreign→watchingeye map)", () => {
    expect(keywordFromModelPath("alexa_v0.1.onnx")).toBeNull();
    expect(keywordFromModelPath("hey_mycroft_v0.1.onnx")).toBeNull();
  });
});

describe("openWakeWordAssetsAvailable", () => {
  it("is false when classifier path is missing", () => {
    expect(
      openWakeWordAssetsAvailable(
        path.join(process.cwd(), "definitely-missing-wake.onnx"),
      ),
    ).toBe(false);
  });
});

describe("OpenWakeWordDetector (optional weights)", () => {
  it("rejects silence / non-wake WAV when models are installed", async () => {
    if (!openWakeWordAssetsAvailable()) return;
    const d = new OpenWakeWordDetector();
    const silence = pcmWav(new Float32Array(32_000), 16_000);
    const hit = await d.detect(silence, "audio/wav");
    // Sine-free silence must not clear the 0.7 gate as a confident wake.
    expect(hit === null || hit.confidence < 0.7).toBe(true);
    if (hit !== null) expect(hit.keyword).toBe("hey_jarvis");
  });
});
