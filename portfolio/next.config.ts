import type { NextConfig } from "next";
import path from "node:path";

// This app lives in a sub-folder of a repository that has its own lockfile: pin the root.
const root = path.resolve(__dirname);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  reactStrictMode: true,
  images: { formats: ["image/avif", "image/webp"], qualities: [70, 82, 90] },
  experimental: {
    globalNotFound: true,
    serverActions: { bodySizeLimit: "1mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // project media never change in place (a new picture gets a new name)
      { source: "/media/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
