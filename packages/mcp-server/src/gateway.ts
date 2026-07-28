/** Minimal gateway REST client used by the MCP tools. */

const BASE = process.env.GATEWAY_URL ?? "http://localhost:8080";

/** GET a gateway path and return parsed JSON. Throws on non-2xx. */
export async function gatewayGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`gateway ${res.status} for ${path}`);
  }
  return res.json();
}
