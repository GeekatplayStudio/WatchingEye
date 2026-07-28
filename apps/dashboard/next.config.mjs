import { readFileSync } from "node:fs";

/**
 * Find the vision engine.
 *
 * The engine moves to a free port when its preferred one is busy and records
 * where it landed, so read that rather than assuming. Rewrites are resolved
 * when the dev server starts — if the engine moves while the dashboard is
 * running, restart the dashboard.
 */
function engineUrl() {
  if (process.env.ENGINE_URL) return process.env.ENGINE_URL;
  try {
    const port = readFileSync(new URL("../../.runtime/engine.port", import.meta.url), "utf8").trim();
    if (/^\d+$/.test(port)) return `http://localhost:${port}`;
  } catch {
    // No port file yet: fall through to the default.
  }
  return "http://localhost:8090";
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Proxy REST calls to the gateway; WebSocket connects directly to :8080.
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.GATEWAY_URL ?? "http://localhost:8080"}/api/:path*`,
      },
      {
        source: "/engine/:path*",
        destination: `${engineUrl()}/:path*`,
      },
    ];
  },
};

export default nextConfig;
