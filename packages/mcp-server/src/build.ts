/**
 * Factory for WatchingEye MCP servers (one domain or the combined baseline).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { gatewayGet, type GatewayClient } from "./gateway.js";
import {
  registerAlertTools,
  registerCameraTools,
  registerSettingsTool,
  registerTimelineTools,
} from "./register.js";

/** MCP domain slices (ROADMAP 3.4). */
export type McpDomain = "camera" | "timeline" | "alert" | "settings";

/**
 * Build a read-only MCP server with the given domains.
 *
 * @example
 * ```ts
 * const server = buildMcpServer({ name: "watchingeye-camera", domains: ["camera"] });
 * ```
 */
export function buildMcpServer(opts: {
  name: string;
  domains: McpDomain[];
  get?: GatewayClient;
  version?: string;
}): McpServer {
  const get = opts.get ?? gatewayGet;
  const server = new McpServer({
    name: opts.name,
    version: opts.version ?? "0.1.0",
  });
  for (const domain of opts.domains) {
    switch (domain) {
      case "camera":
        registerCameraTools(server, get);
        break;
      case "timeline":
        registerTimelineTools(server, get);
        break;
      case "alert":
        registerAlertTools(server, get);
        break;
      case "settings":
        registerSettingsTool(server, get);
        break;
      default: {
        const _exhaustive: never = domain;
        void _exhaustive;
      }
    }
  }
  return server;
}

/** Connect `server` on stdio (process entrypoints). */
export async function serveStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
