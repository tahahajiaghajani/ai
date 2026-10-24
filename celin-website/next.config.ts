import type { NextConfig } from "next";
import path from "node:path";

// This app lives in a sub-folder of a repository that has its own lockfile: pin the root.
const root = path.resolve(__dirname);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HTTPS only from the first visit on (Vercel adds it too; a self-hosted mirror needs it from here)
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  // no plugins, no <base> tricks, not framed by other sites, forms post only here (scripts stay as they are:
  // the static pages carry small inline scripts)
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // also runnable as a plain Node server (an Iran-hosted mirror, e.g. on Liara or a VPS); Vercel ignores it
  output: "standalone",
  turbopack: { root },
  outputFileTracingRoot: root,
  // Admin → Connections offers the SQL of missing migrations for copy/paste
  outputFileTracingIncludes: { "/admin/connections": ["./supabase/migrations/*.sql"] },
  reactStrictMode: true,
  experimental: {
    globalNotFound: true,
    serverActions: { bodySizeLimit: "1mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // starter pictures never change (a changed picture gets a new folder)
      { source: "/media/seed/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // app icons and the share picture keep their names when redrawn: a day in the browser, then revalidated
      { source: "/:file(favicon.ico|icon-192.png|icon-512.png|icon-maskable-512.png|apple-touch-icon.png|og.png)", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      // admin and account pages are never indexed or cached by shared caches
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
      { source: "/account/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/en/account/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
