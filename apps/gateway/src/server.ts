/**
 * Fastify server factory — REST + WebSocket. No AI logic lives here; the
 * gateway relays validated events and exposes tuning settings.
 *
 * Routes:
 * - `GET /health` — liveness probe
 * - `GET /api/cameras` — registered cameras
 * - `GET /api/events/recent?limit=50` — recent events, newest first
 * - `GET /api/settings` / `PUT /api/settings` — dashboard tuning knobs
 * - `GET /ws` (WebSocket) — live event stream
 */
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { createStore, type EventStore } from "./db.js";
import { nextDemoEvent, type DetectionEvent } from "./events.js";
import { applyPatch, DEFAULT_SETTINGS, SettingsError, type Settings } from "./settings.js";

/** Options for building the server (tests disable the demo stream). */
export interface ServerOptions {
  databaseUrl?: string | undefined;
  demo?: boolean;
}

/** Cameras known to the system (static until the engine registers them). */
const CAMERAS = [
  { id: "driveway", kind: "demo", location: "Driveway" },
  { id: "backyard", kind: "demo", location: "Backyard" },
  { id: "porch", kind: "demo", location: "Front Porch" },
];

/** Build the gateway server with all routes registered. */
export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const store: EventStore = await createStore(opts.databaseUrl ?? process.env.DATABASE_URL);
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const sockets = new Set<{ send: (data: string) => void }>();
  let demoTimer: NodeJS.Timeout | undefined;

  async function broadcast(event: DetectionEvent): Promise<void> {
    await store.insertEvent(event);
    const payload = JSON.stringify({ type: "event", event });
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  function scheduleDemo(): void {
    if (demoTimer !== undefined) {
      clearInterval(demoTimer);
      demoTimer = undefined;
    }
    if (opts.demo === true && settings.demoIntervalMs > 0) {
      demoTimer = setInterval(() => {
        void broadcast(nextDemoEvent());
      }, settings.demoIntervalMs);
    }
  }
  scheduleDemo();

  app.get("/health", async () => ({
    status: "ok",
    service: "gateway",
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/cameras", async () => ({ cameras: CAMERAS }));

  app.get("/api/events/recent", async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = Math.min(Number(limit ?? 50) || 50, 500);
    return { events: await store.recentEvents(n) };
  });

  app.get("/api/settings", async () => settings);

  app.put("/api/settings", async (req, reply) => {
    try {
      settings = applyPatch(settings, req.body as Partial<Settings>);
      scheduleDemo();
      const payload = JSON.stringify({ type: "settings", settings });
      for (const socket of sockets) {
        socket.send(payload);
      }
      return settings;
    } catch (err) {
      if (err instanceof SettingsError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "settings", settings }));
    socket.on("close", () => sockets.delete(socket));
  });

  app.addHook("onClose", async () => {
    if (demoTimer !== undefined) {
      clearInterval(demoTimer);
    }
    await store.close();
  });

  return app;
}
