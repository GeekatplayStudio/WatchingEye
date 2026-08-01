/**
 * Fastify server factory — REST + WebSocket. No AI logic lives here; the
 * gateway relays real events and proxies classification to the orchestrator.
 *
 * Routes:
 * - `GET  /health` — liveness probe
 * - `GET  /api/cameras` — cameras that have reported frames
 * - `GET  /api/events/recent?limit=50` — recent events, newest first
 * - `GET  /api/events/:id` — one stored event for replay UI
 * - `GET  /api/settings` / `PUT /api/settings` — tuning knobs
 * - `POST /api/classify` — classify a gated event (proxied to orchestrator)
 * - `GET  /ws` — live event stream
 */
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { createStore, type EventStore, PgEventStore } from "./db.js";
import { SqliteEventStore } from "./sqlite-events.js";
import type { DetectionEvent, ObjectClass } from "./events.js";
import { classify, type ClassifyResult } from "./classify.js";
import { applyPatch, AVAILABLE_CLASSES, DEFAULT_SETTINGS, SettingsError, type Settings } from "./settings.js";
import {
  DATASET_CLIP_EMBED_MODEL,
  DATASET_EMBED_DIM,
  DATASET_EMBED_MODEL,
  DATASET_TEXT_EMBED_MODEL,
  globalDatasetStore,
  type DatasetProvenance,
  type DatasetRecord,
  type DatasetStoreLike,
} from "./dataset.js";
import { createDatasetStore } from "./vector-db.js";
import { applyActiveIntent } from "./intent-apply.js";
import { recallFromRecords } from "./recall.js";

/** Options for building the server. */
export interface ServerOptions {
  databaseUrl?: string | undefined;
  /** Injectable classifier so tests need no orchestrator or model. */
  classifier?: (
    event: unknown,
    image: string,
    opts?: { anpr?: boolean },
  ) => Promise<ClassifyResult>;
  /**
   * Injectable appearance embedder (orchestrator `/embed` proxy). Tests may
   * supply a fixed 384-d vector; production calls the orchestrator.
   */
  embedder?: (image: string) => Promise<{ values: number[]; model: string } | null>;
  /** Injectable text embedder (orchestrator `/text-embed` proxy). */
  textEmbedder?: (text: string) => Promise<{ values: number[]; model: string } | null>;
  /** Injectable CLIP embedder (orchestrator `/clip-embed` proxy). */
  clipEmbedder?: (input: {
    image?: string;
    text?: string;
  }) => Promise<{ values: number[]; model: string } | null>;
  /**
   * SQLite path for pipeline events when Postgres is unset.
   * Use `memory` in tests; default is `data/events.sqlite` (or Vitest → memory).
   */
  eventsDbPath?: string;
}

/** Body of a classification request from the dashboard. */
interface ClassifyBody {
  event: {
    objectId: string;
    class: string;
    confidence: number;
    frames: number[];
    cameraId: string;
    snapshotRef: string;
  };
  image?: string;
}

/** Orchestrator embed response shape (gateway relays, never interprets). */
interface EmbedResponse {
  embedding?: { values?: number[]; model?: string; dim?: number };
}

async function defaultEmbedder(image: string): Promise<{ values: number[]; model: string } | null> {
  if (image === "") return null;
  try {
    const res = await fetch(
      `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as EmbedResponse;
    const values = body.embedding?.values;
    if (!Array.isArray(values) || values.length !== DATASET_EMBED_DIM) return null;
    return {
      values,
      model: body.embedding?.model ?? DATASET_EMBED_MODEL,
    };
  } catch {
    return null;
  }
}

async function defaultTextEmbedder(
  text: string,
): Promise<{ values: number[]; model: string } | null> {
  if (text.trim() === "") return null;
  try {
    const res = await fetch(
      `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/text-embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as EmbedResponse;
    const values = body.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) return null;
    return {
      values,
      model: body.embedding?.model ?? DATASET_TEXT_EMBED_MODEL,
    };
  } catch {
    return null;
  }
}

async function defaultClipEmbedder(input: {
  image?: string;
  text?: string;
}): Promise<{ values: number[]; model: string } | null> {
  const hasImage = typeof input.image === "string" && input.image !== "";
  const hasText = typeof input.text === "string" && input.text.trim() !== "";
  if (!hasImage && !hasText) return null;
  try {
    const res = await fetch(
      `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/clip-embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasImage ? { image: input.image } : { text: input.text },
        ),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as EmbedResponse;
    const values = body.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) return null;
    return {
      values,
      model: body.embedding?.model ?? DATASET_CLIP_EMBED_MODEL,
    };
  } catch {
    return null;
  }
}

/** Flatten enroll fields into text for the semantic embedder. */
function enrollTextBlob(record: DatasetRecord): string {
  const bits = [
    record.class,
    record.breedOrModel?.replaceAll("_", " ") ?? "",
    record.licensePlate !== undefined ? `plate ${record.licensePlate}` : "",
    `camera ${record.cameraId}`,
    ...(record.descriptors ?? []).map((d) => `${d.key} ${d.value}`),
    ...record.evidence.map((e) => `${e.label} ${e.description}`),
  ];
  return bits.filter((b) => b !== "").join(". ");
}

/** Build the gateway server with all routes registered. */
export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  const store: EventStore = await createStore(databaseUrl, opts.eventsDbPath);
  const datasetStore: DatasetStoreLike = await createDatasetStore(databaseUrl);
  const classifier = opts.classifier ?? classify;
  const embedder = opts.embedder ?? defaultEmbedder;
  const textEmbedder = opts.textEmbedder ?? defaultTextEmbedder;
  const clipEmbedder = opts.clipEmbedder ?? defaultClipEmbedder;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const sockets = new Set<{ send: (data: string) => void }>();
  /** Cameras become known when they send frames — nothing is pre-registered. */
  const cameras = new Map<string, { id: string; kind: string; location: string }>();

  const eventStoreKind =
    store instanceof PgEventStore
      ? "postgres"
      : store instanceof SqliteEventStore
        ? "sqlite"
        : "memory";

  async function broadcast(event: DetectionEvent): Promise<void> {
    await store.insertEvent(event);
    const payload = JSON.stringify({ type: "event", event });
    for (const socket of sockets) socket.send(payload);
  }

  app.get("/health", async () => ({
    status: "ok",
    service: "gateway",
    eventStore: eventStoreKind,
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/health", async () => ({ status: "ok", service: "gateway" }));

  /** Relays the orchestrator's health so the UI can show one AI status icon. */
  app.get("/api/ai/health", async (_req, reply) => {
    try {
      const res = await fetch(
        `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/health`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) return reply.status(503).send({ status: "down" });
      return await res.json();
    } catch {
      return reply.status(503).send({ status: "down" });
    }
  });

  /**
   * Relay full-frame detection to the orchestrator. The gateway adds the
   * filtered flag per current settings but never alters the detections —
   * unchecked classes are dimmed by the UI, not removed.
   */
  app.post("/api/detect", async (req, reply) => {
    try {
      const res = await fetch(
        `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/detect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const body = (await res.json()) as {
        objects?: Array<{ class: string; filtered?: boolean }>;
      };
      if (!res.ok) return reply.status(res.status).send(body);
      for (const obj of body.objects ?? []) {
        if (!settings.trackedClasses.includes(obj.class)) obj.filtered = true;
      }
      return body;
    } catch (err) {
      return reply.status(503).send({
        error:
          err instanceof Error ? `detector unreachable: ${err.message}` : "detector unreachable",
      });
    }
  });

  /** Relay appearance embedding; gateway hosts no AI of its own. */
  app.post("/api/embed", async (req, reply) => {
    try {
      const res = await fetch(
        `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/embed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const body = await res.json();
      if (!res.ok) return reply.status(res.status).send(body);
      return body;
    } catch (err) {
      return reply.status(503).send({
        error:
          err instanceof Error ? `embedder unreachable: ${err.message}` : "embedder unreachable",
      });
    }
  });

  app.get("/api/cameras", async () => ({ cameras: [...cameras.values()] }));

  app.get("/api/events/recent", async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = Math.min(Number(limit ?? 50) || 50, 500);
    return { events: await store.recentEvents(n) };
  });

  app.get("/api/events/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await store.getEvent(id);
    if (event === null) {
      return reply.status(404).send({ error: "event not found" });
    }
    return { event };
  });

  app.get("/api/settings", async () => settings);

  app.put("/api/settings", async (req, reply) => {
    try {
      settings = applyPatch(settings, req.body as Partial<Settings>);
      const payload = JSON.stringify({ type: "settings", settings });
      for (const socket of sockets) socket.send(payload);
      return settings;
    } catch (err) {
      if (err instanceof SettingsError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/api/nlp/target", async (req, reply) => {
    const body = req.body as { prompt?: string };
    if (typeof body?.prompt !== "string" || body.prompt.trim() === "") {
      return reply.status(400).send({ error: "prompt string is required" });
    }
    const started = Date.now();
    try {
      const res = await fetch(
        `${process.env.ORCHESTRATOR_URL ?? "http://localhost:8085"}/parse-intent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: body.prompt }),
          signal: AbortSignal.timeout(5000),
        },
      );
      const parsed = (await res.json()) as {
        rawPrompt?: string;
        targetClasses?: string[];
        attributes?: string[];
        actionPolicy?: string;
        datasetEnroll?: boolean;
        anprEnabled?: boolean;
        confidenceThreshold?: number;
      };
      if (!res.ok || !Array.isArray(parsed.targetClasses)) {
        return reply.status(res.ok ? 502 : res.status).send({
          error: "intent parse failed",
          parsed,
        });
      }
      const allowed = new Set<string>([...AVAILABLE_CLASSES]);
      const classes = parsed.targetClasses.filter((c) => allowed.has(c));
      if (classes.length === 0) {
        return reply.status(400).send({ error: "no known target classes in prompt" });
      }
      const merged = Array.from(new Set([...settings.trackedClasses, ...classes]));
      const activeIntent = {
        rawPrompt: parsed.rawPrompt ?? body.prompt,
        targetClasses: classes,
        attributes: Array.isArray(parsed.attributes) ? parsed.attributes : [],
        actionPolicy: parsed.actionPolicy ?? "monitor",
        datasetEnroll: parsed.datasetEnroll === true,
        anprEnabled: parsed.anprEnabled === true,
        appliedAt: new Date().toISOString(),
      };
      settings = applyPatch(settings, { trackedClasses: merged, activeIntent });
      const payload = JSON.stringify({ type: "settings", settings });
      for (const socket of sockets) socket.send(payload);
      return {
        parsed: { ...parsed, targetClasses: classes },
        settings,
        broadcastMs: Date.now() - started,
      };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? `orchestrator unreachable: ${err.message}` : "orchestrator error",
      });
    }
  });

  app.get("/api/dataset/search", async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const n = Math.min(Number(limit ?? 50) || 50, 500);
    const records = await datasetStore.search(q ?? "", n);
    return { records };
  });

  /** Live store size for the Active Tracking monitor. */
  app.get("/api/dataset/stats", async () => {
    const total = await datasetStore.count();
    return { total };
  });

  /**
   * Grounded NL recall: keyword ∪ nomic text-NN ∪ CLIP multimodal NN.
   * GET is text-only; POST may include a JPEG `image` for CLIP image→dataset.
   */
  async function runDatasetRecall(input: {
    query: string;
    limit: number;
    image?: string;
  }) {
    const all = await datasetStore.getAll(500);
    let textHits: DatasetRecord[] = [];
    let clipHits: DatasetRecord[] = [];
    const queryVec = await textEmbedder(input.query);
    if (queryVec !== null) {
      textHits = await datasetStore.searchByTextEmbedding(queryVec.values, input.limit);
    }
    const clipQuery =
      typeof input.image === "string" && input.image !== ""
        ? await clipEmbedder({ image: input.image })
        : await clipEmbedder({ text: input.query });
    if (clipQuery !== null) {
      clipHits = await datasetStore.searchByClipEmbedding(clipQuery.values, input.limit);
    }
    const recall = recallFromRecords(
      all,
      input.query,
      input.limit,
      new Date(),
      textHits,
      clipHits,
    );
    return {
      ...recall,
      channels: {
        keyword: true,
        text: textHits.length > 0,
        clip: clipHits.length > 0,
      },
    };
  }

  app.get("/api/dataset/recall", async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const n = Math.min(Number(limit ?? 20) || 20, 100);
    return runDatasetRecall({ query: q ?? "", limit: n });
  });

  app.post("/api/dataset/recall", async (req) => {
    const body = req.body as { q?: string; image?: string; limit?: number };
    const n = Math.min(Number(body.limit ?? 20) || 20, 100);
    return runDatasetRecall({
      query: body.q ?? "",
      limit: n,
      image: typeof body.image === "string" ? body.image : undefined,
    });
  });

  /** Cosine nearest neighbours over enrolled appearance vectors. */
  app.post("/api/dataset/similar", async (req, reply) => {
    const body = req.body as { embedding?: number[]; limit?: number };
    if (!Array.isArray(body?.embedding) || body.embedding.length !== DATASET_EMBED_DIM) {
      return reply.status(400).send({
        error: `embedding must be a ${DATASET_EMBED_DIM}-float array`,
      });
    }
    const n = Math.min(Number(body.limit ?? 20) || 20, 100);
    const records = await datasetStore.searchByEmbedding(body.embedding, n);
    return { records };
  });

  app.post("/api/classify", async (req, reply) => {
    const body = req.body as ClassifyBody;
    if (typeof body?.event?.objectId !== "string") {
      return reply.status(400).send({ error: "event.objectId is required" });
    }
    cameras.set(body.event.cameraId, {
      id: body.event.cameraId,
      kind: "webcam",
      location: body.event.cameraId,
    });

    const anpr = settings.activeIntent?.anprEnabled === true;
    const result = await classifier(body.event, body.image ?? "", { anpr });
    const decision = result.decision;
    const claimed = decision?.evidence.find((e) => e.label.startsWith("class:"));

    const event: DetectionEvent = {
      id: `evt-${Date.now()}-${body.event.objectId.slice(0, 8)}`,
      objectId: body.event.objectId,
      class: (claimed?.label.replace("class:", "") ?? "unknown") as ObjectClass,
      kind: "detected",
      confidence: decision?.confidence ?? body.event.confidence,
      frames: body.event.frames,
      cameraId: body.event.cameraId,
      timestamp: new Date().toISOString(),
      evidence: decision?.evidence ?? [],
      model: decision?.provenance.model_version ?? "unclassified",
      source: "engine",
    };
    if (decision !== null && decision !== undefined) {
      event.promptVersion = decision.provenance.prompt_version;
      event.risk = decision.risk;
      event.provenance = {
        model_version: decision.provenance.model_version,
        prompt_version: decision.provenance.prompt_version,
        input_images: [...decision.provenance.input_images],
        timestamp: decision.provenance.timestamp,
      };
    }
    if (result.rejectionReason !== undefined && result.rejectionReason !== "") {
      event.rejectedReason = result.rejectionReason;
    }
    if (!settings.trackedClasses.includes(event.class)) {
      event.filtered = true;
    }
    const intent = settings.activeIntent;
    if (
      intent !== null &&
      intent.targetClasses.length > 0 &&
      !intent.targetClasses.includes(event.class)
    ) {
      event.filtered = true;
    }

    const applied = applyActiveIntent({
      objectClass: event.class,
      descriptors: result.descriptors ?? [],
      evidence: event.evidence,
      rawAnalysis: result.rawAnalysis,
      plate: result.plate,
      intent,
    });
    event.evidence = applied.evidence;
    if (applied.descriptors.length > 0) {
      event.descriptors = applied.descriptors;
    }
    const id = result.identity;
    if (id !== null && id !== undefined && id.identity_id !== "") {
      event.identity = {
        id: id.identity_id,
        name: id.name,
        isNew: id.is_new,
        sightings: id.sightings,
        quality: id.quality,
        status: id.status,
        ambiguous: id.ambiguous === true,
        cameraId: id.camera_id,
        crossedCamera: id.crossed_camera === true,
        camerasSeen: id.cameras_seen,
      };
      if (id.evidence !== null && id.evidence !== undefined) {
        event.identity.score = id.evidence.score;
        event.identity.matched = id.evidence.matched;
      }
    }

    await broadcast(event);

    if (applied.shouldEnroll) {
      const snapshotRef = body.event.snapshotRef ?? `snap-${event.id}`;
      const provenance: DatasetProvenance = event.provenance ?? {
        model_version: event.model,
        prompt_version: event.promptVersion ?? "unknown",
        input_images: [snapshotRef],
        timestamp: event.timestamp,
      };
      const record: DatasetRecord = {
        id: `ds-${event.id}`,
        objectId: event.objectId,
        class: event.class,
        cameraId: event.cameraId,
        timestamp: event.timestamp,
        confidence: event.confidence,
        evidence: event.evidence,
        snapshotRef,
        provenance,
      };
      if (event.descriptors !== undefined) record.descriptors = event.descriptors;
      if (applied.licensePlate !== undefined) record.licensePlate = applied.licensePlate;
      if (applied.breedOrModel !== undefined) record.breedOrModel = applied.breedOrModel;

      const image = typeof body.image === "string" ? body.image : "";
      const embedded = await embedder(image);
      if (embedded !== null) {
        record.embedding = embedded.values;
        record.embedModel = embedded.model;
        provenance.embed_model = embedded.model;
        record.provenance = provenance;
      }

      const textEmbedded = await textEmbedder(enrollTextBlob(record));
      if (textEmbedded !== null) {
        record.textEmbedding = textEmbedded.values;
        record.textEmbedModel = textEmbedded.model;
        provenance.text_embed_model = textEmbedded.model;
        record.provenance = provenance;
      }

      const clipEmbedded = await clipEmbedder({ image });
      if (clipEmbedded !== null) {
        record.clipEmbedding = clipEmbedded.values;
        record.clipEmbedModel = clipEmbedded.model;
        provenance.clip_embed_model = clipEmbedded.model;
        record.provenance = provenance;
      }

      await datasetStore.insertRecord(record);
      // Keep the global memory mirror in sync when Postgres is the primary
      // store so local tooling that imports `globalDatasetStore` still sees
      // the latest enrollment in-process.
      if (datasetStore !== globalDatasetStore) {
        await globalDatasetStore.insertRecord(record);
      }
    }

    return {
      outcome: result.outcome,
      event,
      latencyMs: result.latencyMs,
      enrolled: applied.shouldEnroll,
      ocrUnconfirmed: applied.ocrUnconfirmed,
    };
  });

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "settings", settings }));
    socket.on("close", () => sockets.delete(socket));
  });

  app.addHook("onClose", async () => {
    await store.close();
    if (datasetStore.close !== undefined) {
      await datasetStore.close();
    }
  });

  return app;
}
