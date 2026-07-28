/** Orchestrator entry point. */
import { buildOrchestrator } from "./server.js";

const port = Number(process.env.ORCHESTRATOR_PORT ?? 8085);
const app = buildOrchestrator();

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`agent-orchestrator listening on :${port}`))
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
