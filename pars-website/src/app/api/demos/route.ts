import { listDemos } from "@/lib/demos";

export const revalidate = 60;

export async function GET() {
  const demos = (await listDemos()).filter((d) => d.enabled);
  return Response.json(
    { demos: demos.map(({ id, title_fa, title_en, description_fa, description_en, url, tag }) => ({ id, title_fa, title_en, description_fa, description_en, url, tag })) },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=600" } },
  );
}
