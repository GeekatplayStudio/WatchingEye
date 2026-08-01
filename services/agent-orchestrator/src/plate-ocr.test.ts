import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { extractLicensePlate } from "./anpr.js";
import {
  recognizePlate,
  StubOcrProvider,
  NoopOcrProvider,
  vehiclePlateBand,
} from "./plate-ocr.js";

describe("vehiclePlateBand", () => {
  it("takes the lower fraction of the vehicle box", () => {
    const band = vehiclePlateBand({ x: 0.1, y: 0.2, width: 0.4, height: 0.5 }, 0.4);
    expect(band.x).toBeCloseTo(0.1);
    expect(band.width).toBeCloseTo(0.4);
    expect(band.height).toBeCloseTo(0.2);
    expect(band.y).toBeCloseTo(0.5);
  });
});

describe("recognizePlate", () => {
  it("prefers OCR text when the stub returns a plate", async () => {
    const hit = await recognizePlate({
      imageBase64: tinyJpeg(),
      vlmText: "no plate here",
      ocr: new StubOcrProvider("rear plate ABC-1234"),
    });
    expect(hit?.plateText).toBe("ABC-1234");
    expect(hit?.source).toBe("ocr");
    expect(hit?.confirmed).toBe(true);
    expect(hit?.ocrModel).toBe("stub-ocr-1");
  });

  it("falls back to regex over VLM text when OCR is empty", async () => {
    const hit = await recognizePlate({
      imageBase64: tinyJpeg(),
      vlmText: "white sedan XYZ-9876 in frame",
      ocr: new NoopOcrProvider(),
    });
    expect(hit?.plateText).toBe("XYZ-9876");
    expect(hit?.source).toBe("regex_vlm");
  });

  it("returns null when neither OCR nor VLM yields a plate", async () => {
    const hit = await recognizePlate({
      imageBase64: tinyJpeg(),
      vlmText: "empty driveway",
      ocr: new NoopOcrProvider(),
    });
    expect(hit).toBeNull();
  });

  it("rejects tokens that are not plate-shaped", () => {
    expect(extractLicensePlate("AB12")).toBeNull();
  });
});

/** 8×8 solid JPEG so jpeg-js can decode in CI. */
function tinyJpeg(): string {
  const width = 8;
  const height = 8;
  const data = Buffer.alloc(width * height * 4, 180);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const encoded = jpeg.encode({ data, width, height }, 90);
  return Buffer.from(encoded.data).toString("base64");
}
