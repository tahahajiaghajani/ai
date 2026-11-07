// The local server of the Windows app: embedded PostgreSQL (PGlite) + the shared API + the
// single-page app, on 127.0.0.1 (or on the office network in LAN mode). Also used by
// `npm run start:local` for development and by the end-to-end tests.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { registerCloudLink } from "@server/modules/ai/relay";
import { consoleLogger, type Logger } from "@server/context";
import { loadConfig, saveConfig, type LocalConfig } from "./config";
import { createBridge } from "./bridge";
import { takePendingRestore, undoRestore, restorePending } from "./backup";

export interface LocalOptions {
  dataDir: string;
  staticDir: string;
  port?: number;
  host?: string;
  log?: Logger;
  /** in-memory database (tests) */
  memory?: boolean;
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

export async function startLocal(opts: LocalOptions): Promise<LocalServer> {
  const log = opts.log ?? consoleLogger;
  mkdirSync(opts.dataDir, { recursive: true });
  const config = loadConfig(opts.dataDir);
  const dbDir = join(opts.dataDir, "db");
  const restore = opts.memory ? null : takePendingRestore(opts.dataDir);
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  if (restore) {
    log.info("restoring database from backup");
    try {
      db = await createPgliteDb({ dataDir: dbDir, desktop: true, loadDataDir: new Blob([new Uint8Array(restore.data)]) });
    } catch (e) {
      // a broken backup must not leave an empty database behind: keep working on the current one
      log.error("restore failed; the current database is kept", String((e as Error)?.message ?? e));
      undoRestore(opts.dataDir, restore.aside);
      db = await createPgliteDb({ dataDir: dbDir, desktop: true });
    }
  } else db = await createPgliteDb({ dataDir: opts.memory ? undefined : dbDir, desktop: true });
  await migrate(db, (m) => log.info(m));

  const staticDir = resolve(opts.staticDir);
  const indexFile = join(staticDir, "index.html");
  const indexHtml = () => (existsSync(indexFile) ? readFileSync(indexFile, "utf8") : "<!doctype html><meta charset=utf-8><title>سیراف</title><p>رابط کاربری ساخته نشده است (npm run build:ui)</p>");

  let server: ReturnType<typeof serve> | null = null;
  const bridge = createBridge({ dataDir: opts.dataDir, db, config, log, save: () => saveConfig(opts.dataDir, config) });
  const api = createApp({
    mode: "desktop",
    db,
    secret: config.secret,
    allowSignup: false,
    platformAdmins: [],
    origin: config.device_id,
    desktop: bridge,
    log,
    fetch: globalThis.fetch.bind(globalThis),
  });

  const app = new Hono();
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
  app.use("/*", serveStatic({ root: staticDir }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: { code: "not_found", message: "این مسیر وجود ندارد" } }, 404);
    return c.html(indexHtml());
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
  log.info(`local server on ${host}:${port}`);
  bridge.start(url);

  return {
    url,
    port,
    host,
    config,
    async close() {
      await bridge.stop();
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      await db.close();
    },
  };
}
