import { env } from "@/lib/env";
import { contentRange, formatRange, parseContentRange, parseRange, resolveRange, sliceStream } from "@/lib/http-range";
import { VIDEO_MIME, VIDEO_PATH, type VideoExt } from "@/lib/video";

/**
 * Uploaded pictures are served from the site's own address (/media/u/m/<id>/<width>.webp), not from
 * *.supabase.co: the visitor's browser talks to one origin only (better reachability from Iran, one TLS
 * connection), and every file is cached for a year on the CDN — an upload never changes, a new picture
 * gets a new folder. Slot videos (/media/u/v/<id>.mp4|webm) are streamed the same way with byte ranges
 * (206 Partial Content), which Safari and iOS need to play a <video> at all.
 */
const PATH = /^m\/[0-9a-f-]{36}\/\d{2,4}\.(webp|jpg)$/;
const TYPES = { webp: "image/webp", jpg: "image/jpeg" } as const;
const YEAR = "public, max-age=31536000, immutable";

const upstreamUrl = (p: string) => `${env.supabaseUrl}/storage/v1/object/public/${env.bucket}/${p}`;

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const p = path.join("/");
  if (!env.supabaseUrl) return new Response("not found", { status: 404 });
  const video = VIDEO_PATH.exec(p);
  if (video) return streamVideo(req, p, video[1] as VideoExt);
  const m = PATH.exec(p);
  if (!m) return new Response("not found", { status: 404 });
  let res: Response;
  try {
    res = await fetch(upstreamUrl(p), { signal: AbortSignal.timeout(15000) });
  } catch {
    return new Response("unavailable", { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!res.ok || !res.body) return upstreamFailure(res);
  return new Response(res.body, {
    headers: {
      "content-type": TYPES[m[1] as keyof typeof TYPES],
      "cache-control": YEAR,
      "cdn-cache-control": YEAR,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * The store did not deliver the file: a real "not there" (400/404) may be cached for a minute; an outage
 * (5xx, 429, anything else) must not be remembered as a missing picture by browsers or the CDN.
 */
async function upstreamFailure(res: Response): Promise<Response> {
  await res.body?.cancel().catch(() => undefined);
  if (res.ok || res.status === 400 || res.status === 404) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  return new Response("unavailable", { status: 503, headers: { "cache-control": "no-store", "retry-after": "30" } });
}

/**
 * One video file, whole (200) or one byte range of it (206). The Range header is forwarded to the store;
 * a store that ignores it still gets a correct 206 (the stream is cut here). `Vary: Range` keeps the CDN
 * from answering a range request with a cached response for another range.
 */
async function streamVideo(req: Request, p: string, ext: VideoExt): Promise<Response> {
  const spec = parseRange(req.headers.get("range"));
  // the timeout covers the wait for the store's answer only, not the (long) body stream
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(upstreamUrl(p), {
      headers: spec ? { range: formatRange(spec) } : {},
      signal: AbortSignal.any([timeout.signal, req.signal]),
    });
  } catch {
    return new Response("unavailable", { status: 502, headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
  const base: Record<string, string> = {
    "content-type": VIDEO_MIME[ext],
    "accept-ranges": "bytes",
    "cache-control": YEAR,
    "cdn-cache-control": YEAR,
    vary: "Range",
    "x-content-type-options": "nosniff",
  };
  const unsatisfiable = (size: number | null) =>
    new Response(null, { status: 416, headers: { ...base, "cache-control": "no-store", "cdn-cache-control": "no-store", ...(size !== null ? { "content-range": `bytes */${size}` } : {}) } });

  if (res.status === 416) {
    await res.body?.cancel().catch(() => undefined);
    return unsatisfiable(parseContentRange(res.headers.get("content-range"))?.size ?? null);
  }
  if (!res.body || (res.status !== 200 && res.status !== 206)) return upstreamFailure(res);

  if (res.status === 206) {
    const cr = parseContentRange(res.headers.get("content-range"));
    if (!cr || cr.start === undefined || cr.end === undefined || cr.size === null) {
      await res.body.cancel().catch(() => undefined);
      return new Response("bad gateway", { status: 502, headers: { "cache-control": "no-store" } });
    }
    return new Response(res.body, {
      status: 206,
      headers: { ...base, "content-range": contentRange({ start: cr.start, end: cr.end }, cr.size), "content-length": String(cr.end - cr.start + 1) },
    });
  }

  // 200: the whole file
  const size = Number(res.headers.get("content-length") ?? NaN);
  if (!spec) return new Response(res.body, { headers: { ...base, ...(Number.isFinite(size) ? { "content-length": String(size) } : {}) } });
  if (!Number.isFinite(size)) {
    // unknown length: a range cannot be answered precisely, send the whole file
    return new Response(res.body, { headers: base });
  }
  const r = resolveRange(spec, size);
  if (!r) {
    await res.body.cancel().catch(() => undefined);
    return unsatisfiable(size);
  }
  return new Response(sliceStream(res.body, r.start, r.end), {
    status: 206,
    headers: { ...base, "content-range": contentRange(r, size), "content-length": String(r.end - r.start + 1) },
  });
}
