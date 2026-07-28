#!/usr/bin/env node
/**
 * WatchingEye MCP server (stdio transport).
 *
 * Exposes read-only tools backed by the gateway REST API so any MCP client
 * (Claude, editors, other agents) can inspect the system. Read-only by
 * design: MCP clients can observe, never actuate (PRD: AI safety).
 *
 * Usage: GATEWAY_URL=http://localhost:8080 npx watchingeye-mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gatewayGet } from "./gateway.js";

const server = new McpServer({ name: "watchingeye", version: "0.1.0" });

server.tool("list_cameras", "List all registered cameras", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify(await gatewayGet("/api/cameras")) }],
}));

server.tool(
  "recent_events",
  "Recent detection events, newest first, with full evidence and provenance",
  { limit: z.number().int().min(1).max(500).default(50) },
  async ({ limit }) => ({
    content: [
      { type: "text", text: JSON.stringify(await gatewayGet(`/api/events/recent?limit=${limit}`)) },
    ],
  }),
);

server.tool("get_settings", "Current deterministic gate and policy settings", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify(await gatewayGet("/api/settings")) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
