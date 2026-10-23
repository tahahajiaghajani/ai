import { env } from "@/lib/env";

/**
 * Uploaded pictures are served from the site's own address (/media/u/m/<id>/<width>.webp), not from
 * *.supabase.co: the visitor's browser talks to one origin only (better reachability from Iran, one TLS
 * connection), and every file is cached for a year on the CDN — an upload never changes, a new picture
 * gets a new folder.
 */
const PATH = /^m\/[0-9a-f-]{36}\/\d{2,4}\.(webp|jpg)$/;
const TYPES = { webp: "image/webp", jpg: "image/jpeg" } as const;

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const p = path.join("/");
  const m = PATH.exec(p);
  if (!m || !env.supabaseUrl) return new Response("not found", { status: 404 });
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/storage/v1/object/public/${env.bucket}/${p}`, { signal: AbortSignal.timeout(15000) });
  } catch {
    return new Response("unavailable", { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!res.ok || !res.body) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  return new Response(res.body, {
    headers: {
      "content-type": TYPES[m[1] as keyof typeof TYPES],
      "cache-control": "public, max-age=31536000, immutable",
      "cdn-cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
