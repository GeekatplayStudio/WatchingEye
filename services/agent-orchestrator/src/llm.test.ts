import { describe, expect, it, vi } from "vitest";
import { LlmError, OllamaProvider, StubProvider } from "./llm.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
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
    const call = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body) as {
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

  it("names the pull command when the model is not installed", async () => {
    // Ollama answers 404 for an unknown model; the fix is never guessable
    // from the status code alone.
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 404));
    const provider = new OllamaProvider("qwen2.5vl:7b", "http://x", 1000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      /ollama pull qwen2\.5vl:7b/,
    );
  });

  it("includes the response body on other HTTP failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "runner crashed" }, false, 500));
    const provider = new OllamaProvider("m", "http://x", 1000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      /500.*runner crashed/,
    );
  });

  it("tells the operator to start the daemon when the connection is refused", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    const provider = new OllamaProvider("m", "http://host:11434", 1000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      /not reachable at http:\/\/host:11434 — start it with: ollama serve/,
    );
  });

  it("reports a timeout as a timeout, not as a dead daemon", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const provider = new OllamaProvider("m", "http://x", 30_000, fetchImpl as never);
    await expect(provider.complete({ promptVersion: "v1", prompt: "p" })).rejects.toThrow(
      /did not respond within 30s/,
    );
  });

  it("lists installed models and degrades to empty when unreachable", async () => {
    const ok = vi.fn(async () => jsonResponse({ models: [{ name: "gemma3:4b" }, {}] }));
    expect(
      await new OllamaProvider("m", "http://x", 1000, ok as never).installedModels(),
    ).toEqual(["gemma3:4b"]);

    const dead = vi.fn(async () => {
      throw new Error("nope");
    });
    expect(
      await new OllamaProvider("m", "http://x", 1000, dead as never).installedModels(),
    ).toEqual([]);
  });
});

describe("StubProvider", () => {
  it("returns canned output for offline tests", async () => {
    const res = await new StubProvider("canned").complete({ promptVersion: "v", prompt: "p" });
    expect(res.text).toBe("canned");
  });
});
