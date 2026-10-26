import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const API = process.env.API_ORIGIN ?? "http://localhost:4000";

/**
 * Production: static export served by the REC server (same origin as /api and /ws).
 * Development: `next dev` proxies /api to the backend.
 */
const config: NextConfig = {
  ...(isDev
    ? { async rewrites() { return [{ source: "/api/:path*", destination: `${API}/api/:path*` }]; } }
    : { output: "export" as const }),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
