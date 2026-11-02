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
import { consoleLogger, type Logger } from "@server/context";
import { loadConfig, saveConfig, type LocalConfig } from "./config";
import { createBridge } from "./bridge";
import { takePendingRestore } from "./backup";

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

export async function startLocal(opts: LocalOptions): Promise<LocalServer> {
  const log = opts.log ?? consoleLogger;
  mkdirSync(opts.dataDir, { recursive: true });
  const config = loadConfig(opts.dataDir);
  const dbDir = join(opts.dataDir, "db");
  const restore = opts.memory ? null : takePendingRestore(opts.dataDir);
  if (restore) log.info("restoring database from backup");
  const db = await createPgliteDb({ dataDir: opts.memory ? undefined : dbDir, desktop: true, loadDataDir: restore ? new Blob([new Uint8Array(restore)]) : undefined });
  await migrate(db, (m) => log.info(m));

  const staticDir = resolve(opts.staticDir);
  const indexFile = join(staticDir, "index.html");
  const indexHtml = () => (existsSync(indexFile) ? readFileSync(indexFile, "utf8") : "<!doctype html><meta charset=utf-8><title>تراز</title><p>رابط کاربری ساخته نشده است (npm run build:ui)</p>");

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
