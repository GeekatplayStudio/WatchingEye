#!/usr/bin/env node
/**
 * Combined WatchingEye MCP server (stdio) — ROADMAP 3.4 baseline + all domains.
 *
 * Prefer dedicated bins when a client should only see one surface:
 * `watchingeye-mcp-camera` / `-timeline` / `-alert`.
 *
 * Usage: `GATEWAY_URL=http://localhost:8080 npx watchingeye-mcp`
 */
import { buildMcpServer, serveStdio } from "./build.js";

const server = buildMcpServer({
  name: "watchingeye",
  domains: ["camera", "timeline", "alert", "settings"],
});
await serveStdio(server);
