import { unstable_cache } from "next/cache";
import { buildSearchIndex } from "@/lib/search-index";

const cached = unstable_cache(buildSearchIndex, ["celin-search-v1"], { tags: ["catalog"], revalidate: 600 });

/** The public search index (no prices), cached with the catalogue. */
export async function GET() {
  const items = await cached();
  return Response.json({ items }, { headers: { "cache-control": "public, max-age=60, s-maxage=600, stale-while-revalidate=3600" } });
}
