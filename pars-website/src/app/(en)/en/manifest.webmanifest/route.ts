import { webManifest } from "@/lib/seo";

export const dynamic = "force-static";

/** The English manifest: Next's manifest.ts convention only exists at the app root. */
export function GET() {
  return new Response(JSON.stringify(webManifest("en")), { headers: { "content-type": "application/manifest+json" } });
}
