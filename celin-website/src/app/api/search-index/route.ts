import { unstable_cache } from "next/cache";
import { buildSearchIndex } from "@/lib/search-index";

/**
 * The public search index (no prices), a static response rebuilt with the catalogue: admin changes purge it
 * like the pages ("catalog" tag and the site layout path), so the search never offers an unpublished or
 * renamed product. The hour is only a safety net for edits made in SQL.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

const cached = unstable_cache(buildSearchIndex, ["celin-search-v1"], { tags: ["catalog"], revalidate: 3600 });

export async function GET() {
  const items = await cached();
  return Response.json({ items });
}
