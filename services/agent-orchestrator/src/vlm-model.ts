/**
 * Which vision model the orchestrator will actually talk to.
 *
 * A model name that is not installed fails once per frame, deep in the
 * request path, as an opaque refusal. Resolving it up front turns that into
 * one legible startup fact: the name, whether it is present, and the exact
 * command that fixes it.
 */

/** Vision-capable models this project knows how to drive, best first. */
export const KNOWN_VISION_MODELS = [
  "qwen2.5vl:7b",
  "gemma3:4b",
  "llama3.2-vision",
  "llava",
] as const;

/** Outcome of resolving the model to use. */
export interface ModelResolution {
  /** The model that will be sent to the provider. */
  model: string;
  /** Whether the daemon reports it as installed. */
  installed: boolean;
  /** How it was chosen — `env` means the operator pinned it explicitly. */
  source: "env" | "detected" | "default";
  /** Operator-facing next step when something is wrong. */
  hint?: string;
}

/** Ollama tags carry an implicit `:latest`; compare without it. */
function sameModel(a: string, b: string): boolean {
  const strip = (s: string) => (s.endsWith(":latest") ? s.slice(0, -":latest".length) : s);
  return strip(a) === strip(b);
}

/**
 * Choose the vision model, preferring an explicit pin over detection.
 *
 * An explicit `VLM_MODEL` is always honoured, even when it is not
 * installed — silently substituting a different model would change what
 * the system decides without the operator ever asking for it.
 *
 * @param installed - model tags the daemon reports, e.g. from `/api/tags`
 * @param envModel - the `VLM_MODEL` override, if the operator set one
 * @example
 * resolveVlmModel(["gemma3:4b"], undefined).model; // "gemma3:4b"
 */
export function resolveVlmModel(
  installed: readonly string[],
  envModel: string | undefined,
): ModelResolution {
  if (envModel !== undefined && envModel.trim() !== "") {
    const model = envModel.trim();
    const present = installed.some((t) => sameModel(t, model));
    return {
      model,
      installed: present,
      source: "env",
      ...(present ? {} : { hint: `ollama pull ${model}` }),
    };
  }

  const detected = KNOWN_VISION_MODELS.find((known) =>
    installed.some((tag) => sameModel(tag, known)),
  );
  if (detected !== undefined) {
    const tag = installed.find((t) => sameModel(t, detected)) ?? detected;
    return { model: tag, installed: true, source: "detected" };
  }

  const fallback = KNOWN_VISION_MODELS[0];
  return {
    model: fallback,
    installed: false,
    source: "default",
    hint:
      installed.length === 0
        ? "ollama is not running or has no models — start it with: ollama serve"
        : `no vision model installed — run: ollama pull ${fallback}`,
  };
}
