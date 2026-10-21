import type { NextConfig } from "next";

// The browser only ever talks to this origin. /api/v1/* is proxied to the NestJS API,
// so session cookies stay first-party and the API URL is never exposed to client code.
const apiBase = process.env.API_BASE_URL ?? "http://localhost:4000";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Every page is per-user and authenticated, so prerendered static shells add no value here.
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  // Development only: lets the dev server serve assets when opened via 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiBase}/api/v1/:path*` }];
  },
  async headers() {
    // /api/v1 responses carry the API's own security headers (evidence previews must be frameable same-origin).
    return [{ source: "/((?!api/).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
