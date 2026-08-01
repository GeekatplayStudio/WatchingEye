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
import { detect, modelAvailable } from "./detect.js";
import { identifyDetections } from "./identify-detections.js";
import {
  embed,
  embedModelAvailable,
  type AppearanceEmbedding,
  type NormBBox,
} from "./embed.js";
import { TriggerEventSchema } from "./schema.js";
import { parseNaturalLanguageIntent } from "./nl-parser.js";
import { resolveVlmModel, type ModelResolution } from "./vlm-model.js";
import {
  createDefaultOcrProvider,
  recognizePlate,
  type OcrProvider,
  type PlateRecognition,
} from "./plate-ocr.js";
import {
  createDefaultTextEmbedder,
  type TextEmbedder,
} from "./text-embed.js";
import {
  createDefaultOpenVocabScorer,
  enrichDescriptorsFromOpenVocab,
  type OpenVocabHit,
  type OpenVocabScorer,
} from "./open-vocab.js";

/** Request body for a classification. */
interface ClassifyBody {
  event: unknown;
  /** Base64 JPEG of the gated frame, without a data: prefix. */
  image?: string;
  /** When true, run the plate OCR → regex path after VLM. */
  anpr?: boolean;
}

/** Build the service. Providers are injectable for tests. */
export function buildOrchestrator(
  provider?: LlmProvider,
  ocrProvider?: OcrProvider,
  textEmbedder?: TextEmbedder,
  openVocabScorer?: OpenVocabScorer,
): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
  const ocr = ocrProvider ?? createDefaultOcrProvider();
  const textEmbed = textEmbedder ?? createDefaultTextEmbedder();
  const openVocab = openVocabScorer ?? createDefaultOpenVocabScorer();

  // Resolved once, on first use, then reused: asking the daemon which
  // models exist on every frame would add a round trip to the hot path.
  let resolution: Promise<ModelResolution> | undefined;
  const vlmModel = async (): Promise<ModelResolution> => {
    if (resolution === undefined) {
      resolution = new OllamaProvider("")
        .installedModels()
        .then((installed) => {
          const r = resolveVlmModel(installed, process.env.VLM_MODEL);
          if (!r.installed) {
            app.log.error({ model: r.model, hint: r.hint }, "vision model unavailable");
          } else {
            app.log.info({ model: r.model, source: r.source }, "vision model resolved");
          }
          return r;
        });
    }
    return resolution;
  };

  app.get("/health", async () => {
    const vlm = await vlmModel();
    return {
      status: "ok",
      service: "agent-orchestrator",
      model: vlm.model,
      vlm,
      provider: provider?.name ?? "ollama",
      detector: modelAvailable() ? "yolo11n-onnx" : "unavailable",
      embedder: embedModelAvailable() ? "dinov2-vits14-onnx" : "unavailable",
      openVocab: openVocab.name,
      ocr: ocr.name,
    };
  });

  /** Parse natural language tracking commands into target config. */
  app.post("/parse-intent", async (req, reply) => {
    const body = req.body as { prompt?: string };
    if (typeof body?.prompt !== "string" || body.prompt.trim() === "") {
      return reply.status(400).send({ error: "prompt string is required" });
    }
    return parseNaturalLanguageIntent(body.prompt);
  });

  /**
   * Full-frame object detection, independent of motion. This is the path
   * that names stationary things; a parked car never trips the motion
   * pipeline, but it is still there and this still sees it.
   *
   * Pass `identify: true` to embed each box and run Hungarian batch
   * assignment against the identity registry (opt-in — keeps the 1.2s
   * labelling cadence cheap by default).
   */
  app.post("/detect", async (req, reply) => {
    const body = req.body as {
      image?: string;
      identify?: boolean;
      cameraId?: string;
    };
    if (typeof body?.image !== "string" || body.image === "") {
      return reply.status(400).send({ error: "image (base64 JPEG) is required" });
    }
    const started = Date.now();
    try {
      const result = await detect(body.image);
      if (body.identify === true) {
        const objects = await identifyDetections(
          body.image,
          result.objects,
          typeof body.cameraId === "string" && body.cameraId !== ""
            ? body.cameraId
            : "detect",
        );
        return { ...result, objects, identified: true, latencyMs: Date.now() - started };
      }
      return { ...result, identified: false, latencyMs: Date.now() - started };
    } catch (err) {
      // Detection failing is a visible outcome, not a guess: the caller
      // shows "detector unavailable", never invented boxes.
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "detection failed",
        latencyMs: Date.now() - started,
      });
    }
  });

  /**
   * Appearance embedding (DINOv2). Optional `bbox` crops to the subject
   * before embedding — preferred when YOLO already named the object.
   */
  app.post("/embed", async (req, reply) => {
    const body = req.body as { image?: string; bbox?: NormBBox };
    if (typeof body?.image !== "string" || body.image === "") {
      return reply.status(400).send({ error: "image (base64 JPEG) is required" });
    }
    const started = Date.now();
    try {
      const result = await embed(body.image, body.bbox);
      return { ...result, latencyMs: Date.now() - started };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "embedding failed",
        latencyMs: Date.now() - started,
      });
    }
  });

  /** Text embedding for semantic RAG (not DINOv2 appearance). */
  app.post("/text-embed", async (req, reply) => {
    const body = req.body as { text?: string };
    if (typeof body?.text !== "string" || body.text.trim() === "") {
      return reply.status(400).send({ error: "text is required" });
    }
    const started = Date.now();
    const result = await textEmbed.embed(body.text);
    if (result === null) {
      return reply.status(503).send({
        error: "text embedder unavailable",
        latencyMs: Date.now() - started,
      });
    }
    return { embedding: result, latencyMs: Date.now() - started };
  });

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

    let backend = provider;
    if (backend === undefined) {
      const vlm = await vlmModel();
      // A model that is not installed cannot become one by being asked. Say
      // what to run instead of failing per-frame with a transport error.
      if (!vlm.installed) {
        return {
          outcome: "safe_default",
          decision: null,
          identity: null,
          rejectionReason: `vision model "${vlm.model}" unavailable — ${vlm.hint ?? "check ollama"}`,
          rawAnalysis: "",
          latencyMs: 0,
        };
      }
      backend = new OllamaProvider(vlm.model);
    }
    const graph = buildAgentGraph(makeVlmAnalyzer(backend, body.image ?? ""));

    const started = Date.now();
    try {
      const result = await graph.invoke({ rawEvent: parsed.data });

      // Identity is only attempted for decisions that survived the
      // guardrails — there is no point asking "who is this" about output
      // that was already refused.
      let identity: IdentificationOutcome | null = null;
      let descriptors = extractDescriptors(result.rawAnalysis);
      let openVocabHits: OpenVocabHit[] = [];
      if (result.outcome !== "action") {
        descriptors = []; // refused output describes nothing we can rely on
      }
      if (result.outcome === "action") {
        const decided = result.decision as { evidence?: Array<{ label: string }> } | null;
        const claimed = decided?.evidence
          ?.find((e) => e.label.startsWith("class:"))
          ?.label.slice("class:".length);
        if (claimed !== undefined) {
          openVocabHits = await openVocab.score(body.image ?? "", claimed);
          const enriched = enrichDescriptorsFromOpenVocab(descriptors, openVocabHits);
          descriptors = enriched.descriptors;
          openVocabHits = enriched.added;
        }
        if ((descriptors.length > 0 || embedModelAvailable()) && claimed !== undefined) {
          const appearance = await appearanceForClassify(body.image ?? "", claimed);
          identity = await identify(claimed, descriptors, parsed.data.cameraId, appearance);
        }
      }

      let plate: PlateRecognition | null = null;
      if (body.anpr === true) {
        const vehicleBbox = await vehicleBboxForAnpr(body.image ?? "");
        const haystack = [
          result.rawAnalysis,
          ...descriptors.map((d) => `${d.key} ${d.value}`),
        ].join(" ");
        plate = await recognizePlate({
          imageBase64: body.image ?? "",
          vehicleBbox,
          vlmText: haystack,
          ocr,
        });
        if (plate !== null) {
          if (!descriptors.some((d) => d.key === "license_plate")) {
            descriptors = [
              ...descriptors,
              { key: "license_plate", value: plate.plateText.toLowerCase() },
            ];
          }
        }
      }

      return {
        outcome: result.outcome,
        decision: result.decision,
        identity,
        descriptors,
        openVocab: openVocabHits,
        plate,
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

/**
 * Best-effort appearance vector for a classified subject.
 *
 * Prefers a YOLO crop of the claimed class so the embedding focuses on the
 * object (REMIND-style), then falls back to a full-frame embed. Failures
 * degrade to null — attribute matching still works alone.
 */
async function appearanceForClassify(
  imageBase64: string,
  objectClass: string,
): Promise<AppearanceEmbedding | null> {
  if (imageBase64 === "" || !embedModelAvailable()) return null;
  try {
    let bbox: NormBBox | undefined;
    if (modelAvailable()) {
      const det = await detect(imageBase64);
      const hit = det.objects
        .filter((o) => o.class === objectClass)
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (hit !== undefined) bbox = hit.bbox;
    }
    const result = await embed(imageBase64, bbox);
    return result.embedding;
  } catch {
    return null;
  }
}

/** Best vehicle box for the plate band (car/truck), if YOLO is available. */
async function vehicleBboxForAnpr(imageBase64: string): Promise<NormBBox | undefined> {
  if (imageBase64 === "" || !modelAvailable()) return undefined;
  try {
    const det = await detect(imageBase64);
    const hit = det.objects
      .filter((o) => o.class === "car" || o.class === "truck")
      .sort((a, b) => b.confidence - a.confidence)[0];
    return hit?.bbox;
  } catch {
    return undefined;
  }
}
