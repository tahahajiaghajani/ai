// The local server of the Windows app: embedded PostgreSQL (PGlite) + the shared API + the
// single-page app, on 127.0.0.1 (or on the office network in LAN mode). Also used by
// `npm run start:local` for development and by the end-to-end tests.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { registerCloudLink } from "@server/modules/ai/relay";
import { consoleLogger, type Logger, type ServerConfig } from "@server/context";
import { isBackgroundRequest } from "@server/http/hono";
import { stopTicks, tick } from "@server/jobs";
import { loadConfig, saveConfig, type LocalConfig } from "./config";
import { createBridge } from "./bridge";
import { takePendingRestore, undoRestore, restorePending } from "./backup";
import { resetSyncCursor } from "./sync-client";
import { openFromTemplate, templateFor } from "./db-template";
import { createStaticSite } from "../server-edition/static";
import { APP_NAME } from "@shared/constants";

export interface LocalOptions {
  dataDir: string;
  staticDir: string;
  port?: number;
  host?: string;
  log?: Logger;
  /** in-memory database (tests) */
  memory?: boolean;
  /**
   * The database made at build time (desktop/app/db-template.tar.br, ./db-template.ts): a first start — no database
   * folder yet — loads it instead of running initdb and every migration. Absent in development and in the tests.
   */
  template?: string;
}

export interface LocalServer {
  url: string;
  port: number;
  host: string;
  config: LocalConfig;
  close(): Promise<void>;
}

function isLoopback(addr: string) {
  const a = addr.replace(/^::ffff:/i, "");
  return a === "::1" || /^127\./.test(a);
}

/** The Host header names this computer itself (an IP literal of the loopback or `localhost`). */
function isLoopbackHost(host: string | undefined) {
  if (!host) return true;
  const h = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\./.test(h);
}

/**
 * The site's cache policy inside the app: the build's hashed files (/assets/) are kept for good — a later start, and a
 * route opened again, takes them and their compiled code from the window's cache without asking this server, which may
 * be busy with the job queue —, everything else is revalidated (its ETag: an update of the app replaces the fonts and
 * index.html under the same names).
 */
export const desktopCacheControl = (urlPath: string): string => (urlPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");

export async function startLocal(opts: LocalOptions): Promise<LocalServer> {
  const log = opts.log ?? consoleLogger;
  const t0 = performance.now();
  mkdirSync(opts.dataDir, { recursive: true });
  const config = loadConfig(opts.dataDir);
  const dbDir = join(opts.dataDir, "db");
  const restore = opts.memory ? null : takePendingRestore(opts.dataDir);
  // a first start: the database made at build time, when the app carries one
  const template = !opts.memory && !restore && !existsSync(join(dbDir, "PG_VERSION")) ? templateFor(opts.template) : null;
  let fromTemplate = false;
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  if (template) {
    try {
      // what an earlier first start cut short left behind (no PG_VERSION: never a database)
      rmSync(dbDir, { recursive: true, force: true });
      db = await openFromTemplate(dbDir, template, log);
      fromTemplate = true;
    } catch (e) {
      // never a first start that fails for its head start: initdb and the migrations, as without a template
      log.warn("the database template did not load; preparing the database from scratch", String((e as Error)?.message ?? e));
      try {
        rmSync(dbDir, { recursive: true, force: true });
      } catch {
        renameSync(dbDir, `${dbDir}.template-failed-${Date.now()}`);
      }
      db = await createPgliteDb({ dataDir: dbDir, desktop: true, log });
    }
  } else if (restore) {
    log.info("restoring database from backup");
    try {
      db = await createPgliteDb({ dataDir: dbDir, desktop: true, log, loadDataDir: new Blob([new Uint8Array(restore.data)]) });
    } catch (e) {
      // a broken backup must not leave an empty database behind: keep working on the current one
      log.error("restore failed; the current database is kept", String((e as Error)?.message ?? e));
      undoRestore(opts.dataDir, restore.aside);
      db = await createPgliteDb({ dataDir: dbDir, desktop: true, log });
    }
  } else db = await createPgliteDb({ dataDir: opts.memory ? undefined : dbDir, desktop: true, log });
  const opened = performance.now();
  const applied = await migrate(db, (m) => log.info(m));
  // a restored local database: its sync cursor is the backup's — the next pull reads everything again from the web
  // version (and drops what it no longer has); changes waiting for upload stay queued. A standalone app's database has
  // no cursor and gains none (resetSyncCursor): it is not taken for a linked one afterwards.
  if (restore) await resetSyncCursor(db).catch((e) => log.warn("sync cursor reset failed", String((e as Error)?.message ?? e)));
  // a first start (or an update) wrote its migrations to the log: checkpoint while the splash is still up, not at the
  // person's first click (the first start's 54 MB of log took a 609 ms checkpoint on the setup page, desktop-e2e)
  if (applied.length) await db.checkpoint("migrations").catch((e) => log.warn("database checkpoint after migrations failed", String((e as Error)?.message ?? e)));
  const migrated = performance.now();

  // the single-page app's files (src/server-edition/static.ts: ETags, the SPA fallback, never outside the folder)
  const site = createStaticSite(opts.staticDir, () => `<!doctype html><meta charset=utf-8><title>${APP_NAME}</title><p>رابط کاربری ساخته نشده است (npm run build:ui)</p>`, { cacheControl: desktopCacheControl });

  let server: ReturnType<typeof serve> | null = null;
  const bridge = createBridge({ dataDir: opts.dataDir, db, config, log, save: () => saveConfig(opts.dataDir, config) });
  const cfg: ServerConfig = {
    mode: "desktop",
    db,
    secret: config.secret,
    allowSignup: false,
    platformAdmins: [],
    origin: config.device_id,
    desktop: bridge,
    log,
    fetch: globalThis.fetch.bind(globalThis),
  };
  const api = createApp(cfg);
  // requests of the window (and of the office network's browsers) in flight, its background polling aside: the job
  // queue waits for them before each job, so a page's burst of requests is not interleaved with job statements on the
  // database's one connection
  let foreground = 0;
  // the job queue (record events, notifications, SLA timers…) runs every 10 s on this computer
  const jobTimer = setInterval(() => {
    void tick(cfg, { budgetMs: 8000, busy: () => foreground > 0 }).catch((e) => log.warn("job tick failed", String((e as Error)?.message ?? e)));
  }, 10_000);
  jobTimer.unref?.();

  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    if (isBackgroundRequest(c)) return next();
    foreground++;
    try {
      await next();
    } finally {
      foreground--;
    }
  });
  // Who may reach the API. Before the first account exists every request is trusted as the
  // installation's administrator (setup, cloud link, LAN and backup settings), so only this
  // computer may make them: not the office network, and not a web page that points a host
  // name of its own at 127.0.0.1 (DNS rebinding).
  let hasUsers = false;
  const firstRun = async () => {
    if (hasUsers) return false;
    const r = await db.one<{ n: number }>(`select count(*)::int as n from sm_users`).catch(() => null);
    hasUsers = (r?.n ?? 0) > 0;
    return !hasUsers;
  };
  app.use("/api/*", async (c, next) => {
    const path = c.req.path;
    if (path === "/api/health" || path === "/api/meta") return next();
    const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
    const foreign = (remote !== undefined && !isLoopback(remote)) || !isLoopbackHost(c.req.header("host"));
    if (foreign && (await firstRun())) {
      return c.json({ error: { code: "forbidden", message: "راه‌اندازی نخست فقط روی خود این رایانه انجام می‌شود" } }, 403);
    }
    // a restore is waiting for the next start: whatever is saved now would be thrown away by it
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && restorePending(opts.dataDir) && !path.startsWith("/api/auth/") && path !== "/api/local/backups/restore") {
      return c.json({ error: { code: "restart_required", message: "بازگردانی نسخهٔ پشتیبان در انتظار اجرای دوبارهٔ برنامه است؛ تا آن زمان تغییری ذخیره نمی‌شود" } }, 503);
    }
    return next();
  });
  // AI model calls of a linked installation may go through the web version's connections
  registerCloudLink(db, () => config.cloud);
  app.route("/", api);
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: { code: "not_found", message: "این مسیر وجود ندارد" } }, 404);
    return site.serve(c.req.raw) ?? c.notFound();
  });

  const host = opts.host ?? (config.lan.enabled ? "0.0.0.0" : "127.0.0.1");
  const wanted = opts.port ?? (config.lan.enabled ? config.lan.port : config.port);
  const port: number = await new Promise((ok, fail) => {
    const tryPort = (p: number, attempt: number) => {
      const s = serve({ fetch: app.fetch, port: p, hostname: host }, (info: AddressInfo) => {
        server = s;
        ok(info.port);
      });
      s.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < 20) tryPort(p === 0 ? 0 : p + 1, attempt + 1);
        else fail(err);
      });
    };
    tryPort(wanted, 0);
  });
  const url = `http://127.0.0.1:${port}`;
  // one line with the start's parts (desktop-e2e reads it from app.log): the database opened (from the template on a
  // first start), its migrations, this server ready; and the process since its own start (the bundle's code included)
  const ms = (x: number) => Math.round(x);
  log.info(`local server on ${host}:${port} (database ${ms(opened - t0)} ms${fromTemplate ? " from the template" : ""}, migrations ${ms(migrated - opened)} ms, ready ${ms(performance.now() - t0)} ms, process ${ms(process.uptime() * 1000)} ms)`);
  bridge.start(url);

  return {
    url,
    port,
    host,
    config,
    async close() {
      clearInterval(jobTimer);
      // the job runner finishes the jobs it holds and claims no more (not the rest of its 8-second budget)
      await stopTicks(db);
      await bridge.stop();
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      // a checkpoint, then PGlite's own close (src/server/db/pglite.ts): the next start replays no log
      await db.close();
    },
  };
}
