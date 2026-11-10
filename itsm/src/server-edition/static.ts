// The single-page app's files, served by the server edition itself: pre-compressed variants (.br/.gz written by
// scripts/build-server.mjs) chosen by Accept-Encoding, immutable caching for hashed assets and fonts, no-cache for
// index.html, ETags, HEAD, and the SPA fallback (every other path that is not a file gets index.html). Paths never
// leave the static folder.
import { createReadStream, existsSync, readFileSync, statSync, type Stats } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

export const typeOf = (file: string) => TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

/** Cache policy: content-hashed assets and fonts forever, the app shell never, the rest for an hour. */
export function cacheControl(urlPath: string): string {
  if (urlPath === "/" || urlPath.endsWith(".html")) return "no-cache";
  if (urlPath.startsWith("/assets/") || urlPath.startsWith("/fonts/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

/** Inline scripts of index.html as CSP hashes (the theme script runs before the app). */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (/\ssrc\s*=/.test(m[1] ?? "")) continue;
    out.push(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
  }
  return out;
}

export interface StaticSite {
  /** a Response for this GET/HEAD path, or null when the path is not served here */
  serve(req: Request): Response | null;
  /** CSP hashes of index.html's inline scripts */
  scriptHashes: string[];
}

function accepts(req: Request, enc: string): boolean {
  const h = req.headers.get("accept-encoding") ?? "";
  return h.split(",").some((p) => {
    const [name, q] = p.trim().split(";q=");
    return name.trim().toLowerCase() === enc && (q === undefined || Number(q) > 0);
  });
}

export function createStaticSite(dir: string, fallbackHtml: () => string): StaticSite {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : fallbackHtml();
  const scriptHashes = inlineScriptHashes(indexHtml);

  const fileFor = (urlPath: string): { path: string; st: Stats } | null => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const p = normalize(join(root, decoded));
    if (p !== root && !p.startsWith(root + sep)) return null;
    try {
      const st = statSync(p);
      return st.isFile() ? { path: p, st } : null;
    } catch {
      return null;
    }
  };

  const respond = (req: Request, urlPath: string, path: string, st: Stats): Response => {
    let file = path;
    let size = st.size;
    let encoding: string | null = null;
    for (const [enc, ext] of [["br", ".br"], ["gzip", ".gz"]] as const) {
      if (!accepts(req, enc)) continue;
      try {
        const v = statSync(path + ext);
        if (v.isFile()) {
          file = path + ext;
          size = v.size;
          encoding = enc;
          break;
        }
      } catch {
        /* no variant */
      }
    }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ""}"`;
    const headers: Record<string, string> = {
      "content-type": typeOf(path),
      "cache-control": cacheControl(urlPath),
      etag,
      vary: "Accept-Encoding",
      "x-content-type-options": "nosniff",
    };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    if (encoding) headers["content-encoding"] = encoding;
    headers["content-length"] = String(size);
    if (req.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, { status: 200, headers });
  };

  return {
    scriptHashes,
    serve(req) {
      if (req.method !== "GET" && req.method !== "HEAD") return null;
      const urlPath = new URL(req.url).pathname;
      if (urlPath.startsWith("/api/") || urlPath === "/api") return null;
      const hit = urlPath !== "/" ? fileFor(urlPath) : null;
      if (hit && !hit.path.endsWith(".br") && !hit.path.endsWith(".gz")) return respond(req, urlPath, hit.path, hit.st);
      // a missing asset is a 404 (a stale tab asking for an old chunk must not get the HTML)
      if (/\.[a-z0-9]{1,8}$/i.test(urlPath) && !urlPath.endsWith(".html")) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
      const index = fileFor("/index.html");
      if (index) return respond(req, "/index.html", index.path, index.st);
      return new Response(req.method === "HEAD" ? null : indexHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    },
  };
}
