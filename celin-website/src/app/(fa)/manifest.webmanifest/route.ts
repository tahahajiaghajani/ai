import { webManifest } from "@/lib/seo";

/** Serves /manifest.webmanifest (Persian, the site root); siteMetadata("fa") links it from every Persian page. */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(webManifest("fa")), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
