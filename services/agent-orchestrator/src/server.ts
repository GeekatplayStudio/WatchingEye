/**
 * Orchestrator HTTP service.
 *
 * Exposes the LangGraph Super Agent so the gateway can hand it a gated
 * event and a snapshot. Runs on :8085 (override with `ORCHESTRATOR_PORT`).
 *
 * The graph, not this file, decides anything: this is transport plus the
 * choice of provider.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { buildAgentGraph } from "./graph.js";
import { OllamaProvider, type LlmProvider } from "./llm.js";
import { extractDescriptors, makeVlmAnalyzer } from "./vlm.js";
import { identify, type IdentificationOutcome } from "./identity.js";
import { TriggerEventSchema } from "./schema.js";

/** Request body for a classification. */
interface ClassifyBody {
  event: unknown;
  /** Base64 JPEG of the gated frame, without a data: prefix. */
  image?: string;
}

/** Build the service. `provider` is injectable for tests. */
export function buildOrchestrator(provider?: LlmProvider): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
  const model = process.env.VLM_MODEL ?? "qwen2.5vl:7b";

  app.get("/health", async () => ({
    status: "ok",
    service: "agent-orchestrator",
    model,
    provider: provider?.name ?? "ollama",
  }));

  app.post("/classify", async (req, reply) => {
    const body = req.body as ClassifyBody;
    const parsed = TriggerEventSchema.safeParse(body.event);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    // A vision model with no image will confabulate a plausible scene —
    // observed doing exactly that, echoing the prompt's own example. There
    // is no useful answer here, so refuse rather than invent one.
    if ((body.image ?? "") === "" && provider === undefined) {
      return {
        outcome: "safe_default",
        decision: null,
        identity: null,
        rejectionReason: "no snapshot supplied; refusing to classify without an image",
        rawAnalysis: "",
        latencyMs: 0,
      };
    }

    const backend = provider ?? new OllamaProvider(model);
    const graph = buildAgentGraph(makeVlmAnalyzer(backend, body.image ?? ""));

    const started = Date.now();
    try {
      const result = await graph.invoke({ rawEvent: parsed.data });

      // Identity is only attempted for decisions that survived the
      // guardrails — there is no point asking "who is this" about output
      // that was already refused.
      let identity: IdentificationOutcome | null = null;
      let descriptors = extractDescriptors(result.rawAnalysis);
      if (result.outcome !== "action") {
        descriptors = []; // refused output describes nothing we can rely on
      }
      if (result.outcome === "action") {
        const decided = result.decision as { evidence?: Array<{ label: string }> } | null;
        const claimed = decided?.evidence
          ?.find((e) => e.label.startsWith("class:"))
          ?.label.slice("class:".length);
        if (descriptors.length > 0 && claimed !== undefined) {
          identity = await identify(claimed, descriptors, parsed.data.cameraId);
        }
      }

      return {
        outcome: result.outcome,
        decision: result.decision,
        identity,
        descriptors,
        rejectionReason: result.rejectionReason,
        rawAnalysis: result.rawAnalysis,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      // A provider failure is a safe-default outcome, not a 500: the system
      // must degrade to "we could not classify", never to an unhandled state.
      return {
        outcome: "safe_default",
        decision: null,
        identity: null,
        rejectionReason: err instanceof Error ? err.message : "classification failed",
        rawAnalysis: "",
        latencyMs: Date.now() - started,
      };
    }
  });

  return app;
}
