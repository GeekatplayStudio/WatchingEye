/**
 * LLM/VLM provider abstraction.
 *
 * Every provider returns raw, untrusted text. Nothing here interprets it —
 * interpretation happens only in the guardrail node of the agent graph.
 * Providers are injectable so the whole pipeline is testable offline.
 */

/** One inference request. Prompts are versioned for provenance. */
export interface LlmRequest {
  /** Versioned prompt identifier, e.g. "risk-v1". Recorded in provenance. */
  promptVersion: string;
  /** The prompt text. */
  prompt: string;
  /** Base64 images for vision models. */
  images?: string[];
  /** Ask the provider for JSON-only output where supported. */
  jsonMode?: boolean;
}

/** Raw provider response plus the provenance needed downstream. */
export interface LlmResponse {
  /** Untrusted model output. */
  text: string;
  /** Resolved model identifier, e.g. "qwen2.5vl:7b". */
  modelVersion: string;
  /** Echoed prompt version. */
  promptVersion: string;
}

/** The one interface every provider implements. */
export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Provider failure with the context needed to debug it. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Ollama-backed provider (local, private — the PRD default). */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  constructor(
    private readonly model: string,
    private readonly baseUrl: string = process.env.OLLAMA_URL ?? "http://localhost:11434",
    private readonly timeoutMs: number = 30_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Run one completion. Deterministic settings (temperature 0) because the
   * PRD forbids nondeterministic decision paths.
   *
   * @throws {LlmError} on transport failure, timeout, or non-2xx response.
   */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          prompt: req.prompt,
          images: req.images ?? [],
          format: req.jsonMode === true ? "json" : undefined,
          stream: false,
          options: { temperature: 0, seed: 42 },
        }),
      });
      if (!res.ok) {
        throw new LlmError(await this.describeHttpFailure(res), this.name);
      }
      const body = (await res.json()) as { response?: unknown };
      if (typeof body.response !== "string") {
        throw new LlmError("ollama response missing 'response' field", this.name);
      }
      return {
        text: body.response,
        modelVersion: this.model,
        promptVersion: req.promptVersion,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(this.describeTransportFailure(err), this.name, err);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Turn a non-2xx response into a message that names the fix. A 404 from
   * `/api/generate` means the model is not pulled — by far the most common
   * cause, and unrecoverable without an explicit `ollama pull`.
   */
  private async describeHttpFailure(res: Response): Promise<string> {
    if (res.status === 404) {
      return `ollama has no model "${this.model}" — install it with: ollama pull ${this.model}`;
    }
    const body = await res.text().catch(() => "");
    const detail = body.slice(0, 200).trim();
    return `ollama returned ${res.status}${detail === "" ? "" : `: ${detail}`}`;
  }

  /**
   * Distinguish "the daemon is not running" from "it was too slow". Both
   * surface as a thrown fetch, and the two need opposite responses.
   */
  private describeTransportFailure(err: unknown): string {
    if (err instanceof Error && err.name === "AbortError") {
      return `ollama did not respond within ${this.timeoutMs / 1000}s at ${this.baseUrl} — the model may still be loading into memory`;
    }
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") {
      return `ollama is not reachable at ${this.baseUrl} — start it with: ollama serve`;
    }
    const reason = err instanceof Error ? err.message : String(err);
    return `ollama request to ${this.baseUrl} failed: ${reason}`;
  }

  /**
   * Models this ollama instance can serve right now.
   *
   * @returns tag names, e.g. `["llama3.2-vision:latest"]`; empty when the
   *   daemon is unreachable — callers treat that as "cannot verify".
   * @example
   * const tags = await new OllamaProvider("gemma3:4b").installedModels();
   */
  async installedModels(): Promise<string[]> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { models?: Array<{ name?: unknown }> };
      return (body.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === "string");
    } catch {
      return [];
    }
  }
}

/** Deterministic stub provider for tests and offline development. */
export class StubProvider implements LlmProvider {
  readonly name = "stub";
  constructor(private readonly canned: string) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    return { text: this.canned, modelVersion: "stub-1", promptVersion: req.promptVersion };
  }
}
