import { describe, expect, it } from "vitest";
import {
  CascadeOcrProvider,
  PaddleLprProvider,
  paddleLprAvailable,
  paddleLprScriptPath,
} from "./plate-lpr.js";
import { NoopOcrProvider, StubOcrProvider } from "./plate-ocr.js";

describe("paddle LPR soft path", () => {
  it("resolves the sidecar script path in-repo", () => {
    expect(paddleLprAvailable()).toBe(true);
    expect(paddleLprScriptPath().replace(/\\/g, "/")).toMatch(/scripts\/paddle-lpr\.py$/);
  });

  it("soft-fails without hanging when paddleocr is absent", async () => {
    const provider = new PaddleLprProvider(8_000);
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 200;
      rgba[i + 1] = 200;
      rgba[i + 2] = 200;
      rgba[i + 3] = 255;
    }
    const read = await provider.readText(rgba, 8, 8);
    expect(read.modelVersion.length).toBeGreaterThan(0);
    // Without paddleocr installed, text is empty; with it, any string is fine.
    expect(typeof read.text).toBe("string");
    expect(read.confidence).toBeGreaterThanOrEqual(0);
    expect(read.confidence).toBeLessThanOrEqual(1);
  }, 15_000);

  it("cascade prefers the first plate-shaped OCR hit", async () => {
    const cascade = new CascadeOcrProvider([
      new NoopOcrProvider(),
      new StubOcrProvider("plate ABC-1234"),
    ]);
    const read = await cascade.readText(new Uint8Array(4), 1, 1);
    expect(read.text).toContain("ABC-1234");
    expect(cascade.name).toContain("stub-ocr");
  });
});
