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
import { applyPatch, DEFAULT_SETTINGS, SettingsError, type Settings } from "./settings.js";

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

    await broadcast(event);
    return { outcome: result.outcome, event, latencyMs: result.latencyMs };
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
