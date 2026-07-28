/**
 * Gateway entry point.
 *
 * The gateway is a thin relay between the Rust vision engine, the agent
 * orchestrator, and the dashboard. It hosts no AI logic and makes no
 * decisions — it forwards gated events for classification, relays validated
 * results, stores them (Postgres when available), and serves tuning
 * settings. There is no synthetic event source: an empty feed means nothing
 * has happened.
 */
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);

const server = await buildServer();
server
  .listen({ port, host: "0.0.0.0" })
  .then(() => server.log.info(`gateway listening on :${port}`))
  .catch((err: unknown) => {
    server.log.error(err);
    process.exit(1);
  });
