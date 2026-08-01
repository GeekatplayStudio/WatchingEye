#!/usr/bin/env node
/**
 * Alert MCP server — unfiltered feed + alert policy (read-only, no actuation).
 *
 * Usage: `GATEWAY_URL=http://localhost:8080 npx watchingeye-mcp-alert`
 */
import { buildMcpServer, serveStdio } from "./build.js";

await serveStdio(buildMcpServer({ name: "watchingeye-alert", domains: ["alert"] }));
