/**
 * Gateway entry point.
 *
 * The gateway is a thin proxy between the Rust vision engine and the React
 * dashboard. It hosts no AI logic and makes no decisions — it forwards
 * already-validated events and serves configuration.
 */
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);

const server = buildServer();
server
  .listen({ port, host: "0.0.0.0" })
  .then(() => server.log.info(`gateway listening on :${port}`))
  .catch((err: unknown) => {
    server.log.error(err);
    process.exit(1);
  });
