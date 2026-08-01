#!/usr/bin/env node
/**
 * Camera MCP server — list cameras + gateway health (read-only).
 *
 * Usage: `GATEWAY_URL=http://localhost:8080 npx watchingeye-mcp-camera`
 */
import { buildMcpServer, serveStdio } from "./build.js";

await serveStdio(buildMcpServer({ name: "watchingeye-camera", domains: ["camera"] }));
