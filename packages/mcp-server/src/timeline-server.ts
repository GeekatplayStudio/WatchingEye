#!/usr/bin/env node
/**
 * Timeline MCP server — recent events + get-by-id (read-only).
 *
 * Usage: `GATEWAY_URL=http://localhost:8080 npx watchingeye-mcp-timeline`
 */
import { buildMcpServer, serveStdio } from "./build.js";

await serveStdio(buildMcpServer({ name: "watchingeye-timeline", domains: ["timeline"] }));
