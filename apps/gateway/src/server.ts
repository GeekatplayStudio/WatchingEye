/**
 * Fastify server factory — REST + WebSocket. No AI logic lives here; the
 * gateway relays real events and proxies classification to the orchestrator.
 *
 * Routes:
 * - `GET  /health` — liveness probe
 * - `GET  /api/cameras` — cameras that have reported frames
 * - `GET  /api/events/recent?limit=50` — recent events, newest first
 * - `GET  /api/settings` / `PUT /api/settings` — tuning knobs
 * - `POST /api/classify` — classify a gated event (proxied to orchestrator)
 * - `GET  /ws` — live event stream
 */
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { createStore, type EventStore } from "./db.js";
import type { DetectionEvent, ObjectClass } from "./events.js";
import { classify, type ClassifyResult } from "./classify.js";
import { applyPatch, AVAILABLE_CLASSES, DEFAULT_SETTINGS, SettingsError, type Settings } from "./settings.js";
import { globalDatasetStore, type DatasetRecord } from "./dataset.js";
import { applyActiveIntent } from "./intent-apply.js";

/** Options for building the server. */
export interface ServerOptions {
  databaseUrl?: string | undefined;
  /** Injectable classifier so tests need no orchestrator or model. */
  classifier?: (event: unknown, image: string) => Promise<ClassifyResult>;
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

/** Build the gateway server with all routes registered. */
export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const store: EventStore = await createStore(opts.databaseUrl ?? process.env.DATABASE_URL);
  const classifier = opts.classifier ?? classify;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const sockets = new Set<{ send: (data: string) => void }>();
  /** Cameras become known when they send frames — nothing is pre-registered. */
  const cameras = new Map<string, { id: string; kind: string; location: string }>();

  async function broadcast(event: DetectionEvent): Promise<void> {
    await store.insertEvent(event);
    const payload = JSON.stringify({ type: "event", event });
    for (const socket of sockets) socket.send(payload);
  }

  app.get("/health", async () => ({
    status: "ok",
    service: "gateway",
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
    const records = await globalDatasetStore.search(q ?? "", n);
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

    const result = await classifier(body.event, body.image ?? "");
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
      const record: DatasetRecord = {
        id: `ds-${event.id}`,
        objectId: event.objectId,
        class: event.class,
        cameraId: event.cameraId,
        timestamp: event.timestamp,
        confidence: event.confidence,
        evidence: event.evidence,
        snapshotRef: body.event.snapshotRef ?? `snap-${event.id}`,
      };
      if (event.descriptors !== undefined) record.descriptors = event.descriptors;
      if (applied.licensePlate !== undefined) record.licensePlate = applied.licensePlate;
      if (applied.breedOrModel !== undefined) record.breedOrModel = applied.breedOrModel;
      await globalDatasetStore.insertRecord(record);
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
  });

  return app;
}
