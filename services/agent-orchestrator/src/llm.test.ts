import { describe, expect, it, vi } from "vitest";
import { LlmError, OllamaProvider, StubProvider } from "./llm.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("OllamaProvider", () => {
  it("returns model text with provenance", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: '{"risk":0.1}' }));
    const provider = new OllamaProvider("qwen2.5vl:7b", "http://x", 1000, fetchImpl as never);
    const res = await provider.complete({ promptVersion: "risk-v1", prompt: "hi" });
    expect(res.text).toBe('{"risk":0.1}');
    expect(res.modelVersion).toBe("qwen2.5vl:7b");
    expect(res.promptVersion).toBe("risk-v1");
  });

  it("requests deterministic sampling", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: "{}" }));
    const provider = new OllamaProvider("m", "http://x", 1000, fetchImpl as never);
    await provider.complete({ promptVersion: "v1", prompt: "p", jsonMode: true });
    const body = JSON.parse((fetchImpl.mock.calls[0] as never[])[1]["body"] as string) as {
      options: { temperature: number };
      format: string;
    };
    expect(body.options.temperature).toBe(0);
    expect(body.format).toBe("json");
  });

  it("throws a typed error on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const provider = new OllamaProvider("m", "http://x", 1000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      LlmError,
    );
  });

  it("throws when the response shape is wrong", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ unexpected: true }));
    const provider = new OllamaProvider("m", "http://x", 1000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      /missing 'response'/,
    );
  });

  it("wraps transport failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const provider = new OllamaProvider("m", "http://x", 1000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      LlmError,
    );
  });
});

describe("StubProvider", () => {
  it("returns canned output for offline tests", async () => {
    const res = await new StubProvider("canned").complete({ promptVersion: "v", prompt: "p" });
    expect(res.text).toBe("canned");
  });
});
