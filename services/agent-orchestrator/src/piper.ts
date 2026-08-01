/**
 * Text-to-speech backends for the voice module (ROADMAP V.2 partial).
 *
 * Callers must pass text from {@link renderSpeech} only — never free-form
 * model output. CI uses stub (`WATCHINGEYE_PIPER=stub`); `auto` prefers the
 * Piper CLI when binary + ONNX voice are present.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeechSynthesizer } from "./voice.js";

/** Default Piper ONNX voice path (optional; not yet in install-models). */
export function defaultPiperModelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/voice/en_US-lessac-medium.onnx");
}

/** Deterministic beep WAV for CI / offline demos. */
export class StubSpeechSynthesizer implements SpeechSynthesizer {
  readonly name = "stub";

  async speak(text: string): Promise<Uint8Array> {
    // Short A4 beep; length scales slightly with text so demos feel alive.
    const ms = Math.min(800, 120 + text.length * 8);
    return toneWav(440, ms, 22_050);
  }
}

/**
 * Piper CLI adapter (`piper` / `PIPER_BIN`).
 *
 * Soft-fails with a typed error when the binary or model is missing.
 */
export class PiperCliSynthesizer implements SpeechSynthesizer {
  readonly name = "piper-cli";

  constructor(
    private readonly bin = process.env.PIPER_BIN ?? "piper",
    private readonly modelPath = process.env.PIPER_MODEL ?? defaultPiperModelPath(),
  ) {}

  async speak(text: string): Promise<Uint8Array> {
    if (!existsSync(this.modelPath)) {
      throw new PiperUnavailableError(`model missing: ${this.modelPath}`);
    }
    const dir = await mkdtemp(path.join(tmpdir(), "we-piper-"));
    const outPath = path.join(dir, "out.wav");
    try {
      await runPiperCli(this.bin, this.modelPath, text, outPath);
      return new Uint8Array(await readFile(outPath));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Binary or model not usable. */
export class PiperUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiperUnavailableError";
  }
}

function runPiperCli(bin: string, model: string, text: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["--model", model, "--output_file", outPath];
    const child = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new PiperUnavailableError("piper timed out"));
    }, 30_000);
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new PiperUnavailableError(`spawn failed: ${err.message}`));
    });
    child.stdin.write(text);
    child.stdin.end();
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new PiperUnavailableError(`exit ${code}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
}

function toneWav(freqHz: number, durationMs: number, sampleRate: number): Uint8Array {
  const n = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const env = Math.min(1, i / 200) * Math.min(1, (n - i) / 400);
    pcm[i] = Math.sin(2 * Math.PI * freqHz * t) * 0.25 * env;
  }
  return pcmFloat32ToWav(pcm, sampleRate);
}

function pcmFloat32ToWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.length * 2;
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
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return new Uint8Array(buf);
}

/**
 * Default synthesizer from env.
 *
 * @example
 * ```ts
 * process.env.WATCHINGEYE_PIPER = "stub";
 * const tts = createSpeechSynthesizer();
 * ```
 */
export function createSpeechSynthesizer(): SpeechSynthesizer {
  const mode = (process.env.WATCHINGEYE_PIPER ?? "auto").toLowerCase();
  if (mode === "stub") return new StubSpeechSynthesizer();
  const bin = process.env.PIPER_BIN ?? "piper";
  const model = process.env.PIPER_MODEL ?? defaultPiperModelPath();
  if (mode === "cli") return new PiperCliSynthesizer(bin, model);
  if (existsSync(model)) return new PiperCliSynthesizer(bin, model);
  return new StubSpeechSynthesizer();
}
