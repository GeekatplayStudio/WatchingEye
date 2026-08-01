import { describe, it, expect } from "vitest";
import { resolveVlmModel, KNOWN_VISION_MODELS } from "./vlm-model.js";

describe("resolveVlmModel", () => {
  it("honours an explicit pin even when it is not installed", () => {
    const r = resolveVlmModel(["gemma3:4b"], "qwen2.5vl:7b");
    expect(r.model).toBe("qwen2.5vl:7b");
    expect(r.installed).toBe(false);
    expect(r.source).toBe("env");
    expect(r.hint).toContain("ollama pull qwen2.5vl:7b");
  });

  it("never silently substitutes a different model for a pinned one", () => {
    // Substituting would change what the system decides without anyone asking.
    const r = resolveVlmModel(["gemma3:4b", "llava:latest"], "llama3.2-vision");
    expect(r.model).toBe("llama3.2-vision");
  });

  it("marks a pinned model installed when present", () => {
    const r = resolveVlmModel(["gemma3:4b"], "gemma3:4b");
    expect(r.installed).toBe(true);
    expect(r.hint).toBeUndefined();
  });

  it("detects an installed vision model when nothing is pinned", () => {
    const r = resolveVlmModel(["llama3:latest", "gemma3:4b"], undefined);
    expect(r.model).toBe("gemma3:4b");
    expect(r.installed).toBe(true);
    expect(r.source).toBe("detected");
  });

  it("prefers the earlier entry in the known list (latency order)", () => {
    const r = resolveVlmModel(["llava", "gemma3:4b", "qwen2.5vl:7b"], undefined);
    expect(r.model).toBe("llava");
  });

  it("matches tags that carry an implicit :latest", () => {
    const r = resolveVlmModel(["llama3.2-vision:latest"], undefined);
    expect(r.installed).toBe(true);
    expect(r.model).toBe("llama3.2-vision:latest");
  });

  it("prefers llava over qwen when both are installed", () => {
    const r = resolveVlmModel(["qwen2.5vl:7b", "llava:latest"], undefined);
    expect(r.model).toBe("llava:latest");
  });

  it("treats an empty or blank pin as unset", () => {
    expect(resolveVlmModel(["gemma3:4b"], "").source).toBe("detected");
    expect(resolveVlmModel(["gemma3:4b"], "   ").source).toBe("detected");
  });

  it("reports the daemon being down distinctly from having no vision model", () => {
    const down = resolveVlmModel([], undefined);
    expect(down.installed).toBe(false);
    expect(down.hint).toContain("ollama serve");

    const noVision = resolveVlmModel(["llama3:latest"], undefined);
    expect(noVision.installed).toBe(false);
    expect(noVision.hint).toContain(`ollama pull ${KNOWN_VISION_MODELS[0]}`);
  });

  it("ignores non-vision models when detecting", () => {
    expect(resolveVlmModel(["llama3:latest", "mistral"], undefined).installed).toBe(false);
  });
});
