import type { NextConfig } from "next";
import path from "node:path";

// This app lives in a sub-folder of a repository that has its own lockfile: pin the root.
const root = path.resolve(__dirname);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  // Admin → Connections offers the SQL of missing migrations for copy/paste
  outputFileTracingIncludes: { "/admin/connections": ["./supabase/migrations/*.sql"] },
  reactStrictMode: true,
  images: { formats: ["image/avif", "image/webp"] },
  experimental: {
    globalNotFound: true,
    serverActions: { bodySizeLimit: "1mb" },
  },
  // the old parspmi.ir pages live on as sections of the new home page
  async redirects() {
    return [
      { source: "/about", destination: "/#about", permanent: true },
      { source: "/ceo", destination: "/#ceo", permanent: true },
      { source: "/services", destination: "/#services", permanent: true },
      { source: "/training", destination: "/#services", permanent: true },
      { source: "/contact", destination: "/#contact", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // admin pages are never indexed or cached by shared caches
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
