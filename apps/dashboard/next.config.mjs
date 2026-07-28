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
        destination: `${process.env.ENGINE_URL ?? "http://localhost:8090"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
