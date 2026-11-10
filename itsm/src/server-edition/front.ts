// The HTTP front of the server edition, in front of the shared API (createApp in cloud mode) and the single-page app:
// security headers (CSP without external origins, HSTS on HTTPS, frame and referrer policy), request size limits,
// gzip/brotli for API answers (never for event streams), the static app with pre-compressed assets, readiness and
// metrics endpoints, the first-run setup and its gate, and the web version's cron routes made inert (the scheduler
// leader ticks the queue here).
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Readable } from "node:stream";
import { constants as zc, createBrotliCompress, createGzip } from "node:zlib";
import { timingSafeEqual } from "node:crypto";
import type { Logger } from "@server/context";
import type { WorkerMetrics, ClusterMetrics } from "./metrics";
import { prometheus } from "./metrics";
import type { StaticSite } from "./static";
import type { ServerEditionConfig } from "./config";

export interface FrontDeps {
  /** the shared API (createApp(cfg)); requests are handed over as they are */
  api: { fetch(req: Request, env?: unknown): Response | Promise<Response> };
  config(): ServerEditionConfig;
  site: StaticSite;
  metrics: WorkerMetrics;
  log: Logger;
  /** readiness: database reachable, migrations applied, not shutting down */
  ready(): Promise<{ ok: boolean; checks: Record<string, boolean | string> }>;
  cluster(): Promise<ClusterMetrics>;
  queue(): Promise<{ due: number; running: number; failed_24h: number } | null>;
  /** /api/setup/* (setup.ts) */
  setup: Hono;
  /** true until the first account exists */
  setupRequired(): Promise<boolean>;
  /** this server speaks HTTPS (HSTS, secure cookies) */
  https: boolean;
}

/** API paths that take uploads (attachments, the Windows app's contents, documents, imports, certificates). */
export function isUploadPath(path: string): boolean {
  return (
    /\/attachments$/.test(path) ||
    /^\/api\/o\/[^/]+\/blobs\//.test(path) ||
    /^\/api\/o\/[^/]+\/(ai\/rag|ai\/docs|rag|knowledge|admin\/imports?|data\/import|r\/[^/]+\/import)/.test(path) ||
    path.startsWith("/api/setup/certificate")
  );
}

/** The Content-Security-Policy of the app: our own origin only (no CDN, no external fonts). */
export function cspFor(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.length ? ` ${scriptHashes.join(" ")}` : ""}`,
    // Ant Design writes its styles at run time
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

const COMPRESSIBLE = /^(application\/(json|javascript|xml|manifest\+json)|text\/(?!event-stream)|image\/svg\+xml)/i;

/** Compress a response for the client (brotli preferred, then gzip); unchanged when not worth it. */
export function compressResponse(req: Request, res: Response): Response {
  if (!res.body || req.method === "HEAD" || res.status === 204 || res.status === 304 || res.status < 200) return res;
  if (res.headers.get("content-encoding")) return res;
  const type = res.headers.get("content-type") ?? "";
  if (!COMPRESSIBLE.test(type)) return res;
  const length = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(length) && length < 1024) return res;
  const accept = req.headers.get("accept-encoding") ?? "";
  const enc = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : null;
  if (!enc) return res;
  const z = enc === "br" ? createBrotliCompress({ params: { [zc.BROTLI_PARAM_QUALITY]: 4 } }) : createGzip({ level: 6 });
  const body = Readable.fromWeb(res.body as never).pipe(z);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("content-encoding", enc);
  headers.append("vary", "Accept-Encoding");
  return new Response(Readable.toWeb(body) as unknown as ReadableStream, { status: res.status, statusText: res.statusText, headers });
}

function bearerMatches(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (c: Context, status: number, code: string, message: string) => c.json({ error: { code, message } }, status as 400);

export function createFront(d: FrontDeps) {
  const app = new Hono();
  const csp = cspFor(d.site.scriptHashes);

  // timing, metrics and slow requests
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    d.metrics.requestStarted();
    let status = 500;
    try {
      await next();
      status = c.res.status;
    } finally {
      const ms = performance.now() - t0;
      d.metrics.requestDone(c.req.method, c.req.path, status, ms);
      if (ms >= d.config().log.slow_ms) d.log.warn("slow request", { method: c.req.method, path: c.req.path.replace(/[0-9a-f-]{36}/gi, ":id"), status, ms: Math.round(ms) });
    }
  });

  // security headers on every answer (a route's own CSP — attachment contents — is kept)
  app.use("*", async (c, next) => {
    await next();
    const h = c.res.headers;
    const set = (k: string, v: string) => {
      if (!h.has(k)) h.set(k, v);
    };
    set("content-security-policy", csp);
    set("x-content-type-options", "nosniff");
    set("x-frame-options", "SAMEORIGIN");
    set("referrer-policy", "strict-origin-when-cross-origin");
    set("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
    set("cross-origin-opener-policy", "same-origin");
    set("cross-origin-resource-policy", "same-origin");
    if (d.https && d.config().tls.hsts_max_age > 0) set("strict-transport-security", `max-age=${d.config().tls.hsts_max_age}`);
    if (c.req.path.startsWith("/api/")) {
      set("cache-control", "private, no-store");
      set("x-robots-tag", "noindex");
    }
  });

  // the web version's cron routes are inert: the scheduler leader runs the queue
  app.all("/api/cron/*", (c) => json(c, 404, "not_found", "این مسیر در نسخهٔ سرور به کار نمی‌رود؛ کارهای پس‌زمینه را خود سرور اجرا می‌کند"));

  app.get("/api/ready", async (c) => {
    const r = await d.ready();
    return c.json(r, r.ok ? 200 : 503);
  });

  app.get("/api/server/metrics", async (c) => {
    if (!bearerMatches(c.req.header("authorization"), d.config().metrics_token)) return json(c, 401, "unauthorized", "توکن سنجه‌ها نادرست است");
    const [m, queue] = await Promise.all([d.cluster(), d.queue().catch(() => null)]);
    return c.text(prometheus(m, { queue }), 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
  });

  // request size limits before anything reads a body
  app.use("/api/*", async (c, next) => {
    const cfg = d.config();
    const mb = isUploadPath(c.req.path) ? cfg.uploads.max_mb + 1 : cfg.uploads.request_max_mb;
    return bodyLimit({ maxSize: mb * 1024 * 1024, onError: (cc) => json(cc, 413, "too_large", `حجم درخواست بیش از ${mb.toLocaleString("fa-IR")} مگابایت است`) })(c, next);
  });

  app.route("/api/setup", d.setup);

  // until the first account exists only the setup may change anything
  // (/auth/me answers 401 without a session: the app's start-up asks it before showing the setup)
  const open = new Set(["/api/health", "/api/ready", "/api/meta", "/api/auth/me"]);
  app.use("/api/*", async (c, next) => {
    if (!open.has(c.req.path) && (await d.setupRequired())) {
      return json(c, 503, "setup_required", "راه‌اندازی نخست سرور هنوز انجام نشده است؛ نشانی راه‌اندازی را از پایان نصب (پوشهٔ داده، فایل setup-url.txt) یا با «karizctl setup-token» بردارید");
    }
    await next();
  });

  app.all("/api/*", async (c) => compressResponse(c.req.raw, await d.api.fetch(c.req.raw, c.env)));

  app.all("*", (c) => d.site.serve(c.req.raw) ?? json(c, 405, "method_not_allowed", "این روش پشتیبانی نمی‌شود"));

  app.onError((err, c) => {
    d.log.error("request failed", { path: c.req.path, error: String(err?.message ?? err) });
    return json(c, 500, "internal", "خطای داخلی سرور؛ گزارش آن در پوشهٔ logs ثبت شد");
  });
  return app;
}
