import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decodeWavMono,
  defaultYamnetKindMapPath,
  loadYamnetKindMap,
  mapYamnetScores,
  yamnetAssetsAvailable,
} from "./yamnet-audio-event.js";

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

describe("loadYamnetKindMap", () => {
  it("loads the committed allowlist", () => {
    const map = loadYamnetKindMap(defaultYamnetKindMapPath());
    expect(map.indexToKind.get(70)).toBe("bark");
    expect(map.indexToKind.get(437)).toBe("glass_break");
    expect(map.indexToKind.has(0)).toBe(false);
  });

  it("rejects an empty map file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "we-yam-"));
    const p = path.join(dir, "empty.json");
    writeFileSync(p, JSON.stringify({ kinds: {} }));
    expect(() => loadYamnetKindMap(p)).toThrow(/no allowlisted/);
  });
});

describe("mapYamnetScores", () => {
  const allow = new Map<number, "bark" | "glass_break">([
    [70, "bark"],
    [437, "glass_break"],
  ]);

  it("maps allowlisted global argmax", () => {
    const scores = new Float32Array(521);
    scores[70] = 0.91;
    const hit = mapYamnetScores(scores, allow);
    expect(hit?.kind).toBe("bark");
    expect(hit?.confidence).toBeCloseTo(0.91, 5);
  });

  it("returns null when argmax is outside the allowlist", () => {
    const scores = new Float32Array(521);
    scores[0] = 0.99; // Speech
    scores[70] = 0.4;
    expect(mapYamnetScores(scores, allow)).toBeNull();
  });
});

describe("decodeWavMono", () => {
  it("decodes 16-bit mono and resamples", () => {
    const src = new Float32Array(8_000).fill(0.5);
    const wav = pcmWav(src, 8_000);
    const pcm = decodeWavMono(wav, 16_000);
    expect(pcm).not.toBeNull();
    expect(pcm!.length).toBe(16_000);
  });

  it("rejects non-WAV bytes", () => {
    expect(decodeWavMono(Buffer.from("KIND:bark\n"), 16_000)).toBeNull();
  });
});

describe("yamnetAssetsAvailable", () => {
  it("is false when the ONNX file is absent (CI default)", () => {
    const missing = path.join(tmpdir(), "no-such-yamnet.onnx");
    expect(existsSync(missing)).toBe(false);
    expect(yamnetAssetsAvailable(missing, defaultYamnetKindMapPath())).toBe(false);
  });
});
