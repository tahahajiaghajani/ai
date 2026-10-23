import { webManifest } from "@/lib/seo";

/** Serves /en/manifest.webmanifest (English); siteMetadata("en") links it from every English page. */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(webManifest("en")), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
