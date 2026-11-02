import type { NextConfig } from "next";
import path from "node:path";

// This app lives in a sub-folder of a repository that has its own lockfile: pin the root.
const root = path.resolve(process.cwd());

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

// Next.js only hosts the API (/api/* → Hono, see app/api/[[...route]]/route.ts) and the
// single-page app that `vite build` writes into public/ (every other path falls back to it).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  turbopack: { root },
  outputFileTracingRoot: root,
  // typechecked by `npm run typecheck` (the SPA and desktop sources share this tsconfig)
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["@electric-sql/pglite"],
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/:path*", destination: "/index.html" }] };
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
