/**
 * Speech-to-text backends for the voice module (ROADMAP V.1).
 *
 * Transcripts are untrusted — callers must run {@link parseTranscript}.
 * Default is stub in CI (`WATCHINGEYE_WHISPER=stub`); `auto` uses whisper.cpp
 * CLI when the binary + ggml model are present, otherwise soft-falls to stub.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeechRecognizer } from "./voice.js";

/** Default ggml model from `scripts/install-models`. */
export function defaultWhisperModelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/voice/ggml-base.en.bin");
}

/** Deterministic STT for CI / offline demos. */
export class StubSpeechRecognizer implements SpeechRecognizer {
  readonly name = "stub";

  constructor(private readonly canned = "show me the driveway") {}

  async transcribe(_audio: Float32Array): Promise<string> {
    return this.canned;
  }

  async transcribeFile(_bytes: Uint8Array, _mimeType?: string): Promise<string> {
    return process.env.WATCHINGEYE_WHISPER_STUB_TEXT?.trim() || this.canned;
  }
}

/**
 * whisper.cpp CLI adapter (`whisper-cli` / `WHISPER_BIN`).
 *
 * Soft-fails with a typed error when the binary or model is missing.
 */
export class WhisperCliRecognizer implements SpeechRecognizer {
  readonly name = "whisper-cli";

  constructor(
    private readonly bin = process.env.WHISPER_BIN ?? "whisper-cli",
    private readonly modelPath = process.env.WHISPER_MODEL ?? defaultWhisperModelPath(),
  ) {}

  async transcribe(audio: Float32Array): Promise<string> {
    // PCM float32 LE → minimal WAV so the CLI has a file path.
    const wav = pcmFloat32ToWav(audio, 16_000);
    return this.transcribeFile(wav, "audio/wav");
  }

  async transcribeFile(bytes: Uint8Array, _mimeType?: string): Promise<string> {
    if (!existsSync(this.modelPath)) {
      throw new WhisperUnavailableError(`model missing: ${this.modelPath}`);
    }
    const dir = await mkdtemp(path.join(tmpdir(), "we-whisper-"));
    const audioPath = path.join(dir, "in.wav");
    try {
      await writeFile(audioPath, bytes);
      return await runWhisperCli(this.bin, this.modelPath, audioPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Binary or model not usable. */
export class WhisperUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhisperUnavailableError";
  }
}

function runWhisperCli(bin: string, model: string, audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-m", model, "-f", audioPath, "-nt", "-np"];
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new WhisperUnavailableError("whisper-cli timed out"));
    }, 30_000);
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new WhisperUnavailableError(`spawn failed: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new WhisperUnavailableError(`exit ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      const text = stdout.replace(/\s+/g, " ").trim();
      resolve(text);
    });
  });
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

function cliLooksAvailable(bin: string, modelPath: string): boolean {
  if (!existsSync(modelPath)) return false;
  // Absolute path or PATH lookup — we only gate on model presence here;
  // spawn errors become WhisperUnavailableError at call time.
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin);
  return true;
}

/**
 * Default recognizer from env.
 *
 * - `stub` — always canned text (CI)
 * - `cli` — whisper.cpp only (errors if missing)
 * - `auto` — cli when model exists, else stub
 *
 * @example
 * ```ts
 * process.env.WATCHINGEYE_WHISPER = "stub";
 * const stt = createSpeechRecognizer();
 * ```
 */
export function createSpeechRecognizer(): SpeechRecognizer {
  const mode = (process.env.WATCHINGEYE_WHISPER ?? "auto").toLowerCase();
  if (mode === "stub") return new StubSpeechRecognizer();
  const bin = process.env.WHISPER_BIN ?? "whisper-cli";
  const model = process.env.WHISPER_MODEL ?? defaultWhisperModelPath();
  if (mode === "cli") return new WhisperCliRecognizer(bin, model);
  if (cliLooksAvailable(bin, model)) return new WhisperCliRecognizer(bin, model);
  return new StubSpeechRecognizer();
}
