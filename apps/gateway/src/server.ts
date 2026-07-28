/**
 * Fastify server factory — separated from the entry point so tests can
 * build a server without binding a port.
 */
import Fastify, { type FastifyInstance } from "fastify";

/** Health payload returned by GET /health. */
export interface Health {
  status: "ok";
  service: "gateway";
  timestamp: string;
}

/**
 * Build the gateway server with all routes registered.
 *
 * Routes:
 * - `GET /health` — liveness probe.
 * - `GET /api/cameras` — camera list (stub until the vision engine connects).
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async (): Promise<Health> => ({
    status: "ok",
    service: "gateway",
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/cameras", async () => ({
    cameras: [] as Array<{ id: string; kind: string; location: string }>,
  }));

  return app;
}
