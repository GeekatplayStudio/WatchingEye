/**
 * Minimal gateway REST client used by MCP tools.
 *
 * Read-only by design — no POST/PUT helpers (ADR 0003).
 */

/** GET a gateway path and return parsed JSON. */
export type GatewayClient = (path: string) => Promise<unknown>;

/**
 * Build a client pointed at `base` (default `GATEWAY_URL` or localhost).
 *
 * @example
 * ```ts
 * const get = createGatewayClient("http://localhost:8080");
 * const cams = await get("/api/cameras");
 * ```
 */
export function createGatewayClient(
  base = process.env.GATEWAY_URL ?? "http://localhost:8080",
): GatewayClient {
  const root = base.replace(/\/$/, "");
  return async (path: string): Promise<unknown> => {
    const res = await fetch(`${root}${path}`);
    if (!res.ok) {
      throw new Error(`gateway ${res.status} for ${path}`);
    }
    return res.json();
  };
}

/** Default client for process entrypoints. */
export const gatewayGet: GatewayClient = createGatewayClient();
