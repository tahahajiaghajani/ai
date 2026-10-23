import { webManifest } from "@/lib/seo";

/** The web app manifest of /manifest.webmanifest (Persian, the site root); siteMetadata() links it from every page of that language. */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(webManifest("fa")), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
