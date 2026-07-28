/**
 * Gateway entry point.
 *
 * The gateway is a thin relay between the Rust vision engine and the
 * dashboard. It hosts no AI logic and makes no decisions — it forwards
 * already-validated events, stores them (Postgres when available), and
 * serves tuning settings. The demo event stream runs until a real engine
 * connects and is labeled `source: "demo"` on every event.
 */
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);

const server = await buildServer({ demo: process.env.DEMO !== "0" });
server
  .listen({ port, host: "0.0.0.0" })
  .then(() => server.log.info(`gateway listening on :${port}`))
  .catch((err: unknown) => {
    server.log.error(err);
    process.exit(1);
  });
