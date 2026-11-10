// One worker process of the server edition (or the whole server in a standalone run: development, tests). It builds
// the shared API in its PostgreSQL ("cloud") mode — same accounts and sessions, same live pulse through sm_org_sync,
// same modules — with the server edition's own parts: the air-gap policy around every outbound call, attachments on
// disk, the scheduler candidate, metrics, the first-run setup and «سلامت سرور»; then serves it over HTTPS with the
// bank's certificate (and redirects HTTP to HTTPS).
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "@server/app";
import { createPostgresDb } from "@server/db/postgres";
import { migrate, migrationStatus } from "@server/db/migrate";
import { tick } from "@server/jobs";
import { installBlobStore } from "@server/blobs";
import { networkFetch, type NetworkPolicy } from "@server/net";
import type { ServerConfig } from "@server/context";
import { APP_NAME } from "@shared/constants";
import { databaseUrl, loadServerConfig, poolFor, workerCount, type ServerEditionConfig } from "./config";
import { DIRECTORY_SETTINGS_PATH, EXIT_FATAL_CONFIG } from "./names";
import { createLogger, echo, RotatingFile, type Level, type ServerLogger } from "./log";
import { WorkerMetrics, type ClusterMetrics } from "./metrics";
import { installSocketGuard } from "./airgap";
import { createDiskBlobStore } from "./blobs-disk";
import { loadCredentials, serverTlsOptions, type CertInfo } from "./tls";
import { postgresLock, Scheduler } from "./scheduler";
import { createStaticSite } from "./static";
import { createFront } from "./front";
import { createUsersProbe, setupRoutes } from "./setup";
import { serverHealth } from "./health";
import { backupDue, backupNow } from "./backup";

export interface StartOptions {
  /** kariz.json */
  file: string;
  /** worker number (0: standalone) */
  workerId?: number;
  /** talk to the cluster supervisor over the IPC channel */
  ipc?: boolean;
  /** run the migrations here (standalone; the supervisor runs them before forking workers) */
  migrate?: boolean;
  staticDir?: string;
  log?: ServerLogger;
  /** override the configured ports (tests: 0 picks free ports) */
  ports?: { https?: number; http?: number };
  /** run the scheduler candidate (default true) */
  scheduler?: boolean;
}

export interface RunningServer {
  https: string | null;
  http: string | null;
  cfg: ServerConfig;
  metrics: WorkerMetrics;
  scheduler: Scheduler | null;
  config(): ServerEditionConfig;
  reload(): void;
  close(): Promise<void>;
}

export class FatalConfigError extends Error {
  exitCode = EXIT_FATAL_CONFIG;
}

type ToPrimary =
  | { t: "log"; line: string; level: Level }
  | { t: "metrics"; snap: ReturnType<WorkerMetrics["snapshot"]> }
  | { t: "ask"; id: number }
  | { t: "reload" }
  | { t: "restart"; reason: string }
  | { t: "ready"; worker: number };

const send = (m: ToPrimary) => {
  try {
    process.send?.(m);
  } catch {
    /* the supervisor is gone */
  }
};

/** Static files: next to the bundle (packaged), ITSM_STATIC_DIR, or ./public (development). */
export function defaultStaticDir(): string {
  if (process.env.ITSM_STATIC_DIR) return resolve(process.env.ITSM_STATIC_DIR);
  const beside = join(dirname(process.argv[1] ?? "."), "public");
  return existsSync(join(beside, "index.html")) ? beside : resolve("public");
}

/** Strip forwarding headers a client could forge and name the real client (rate limits, audit). */
export function prepareRequest(req: IncomingMessage, trustProxy: boolean) {
  if (trustProxy) return;
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded"]) delete req.headers[h];
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/i, "");
  if (ip) req.headers["x-real-ip"] = ip;
}

export async function startServerEdition(o: StartOptions): Promise<RunningServer> {
  const workerId = o.workerId ?? 0;
  const loaded = loadServerConfig(o.file);
  let current = loaded.config;
  const fileLog = o.log || o.ipc ? null : new RotatingFile(current.dirs.logs, "kariz-app.log", current.log.max_mb * 1048576, current.log.keep);
  const log: ServerLogger =
    o.log ??
    createLogger(
      (line, level) => {
        if (o.ipc) send({ t: "log", line, level });
        else {
          fileLog?.write(line);
          echo(line, level);
        }
      },
      { level: current.log.level, worker: workerId },
    );
  for (const w of loaded.warnings) log.warn(`config: ${w}`);
  if (!current.secret || current.secret.length < 32) throw new FatalConfigError("کلید رمزنگاری (secret) در پیکربندی نیست؛ «karizctl init» را اجرا کنید");
  if (!current.db.password) throw new FatalConfigError("گذرواژهٔ پایگاه داده در پیکربندی نیست؛ «karizctl init» را اجرا کنید");

  const pool = poolFor(current);
  if (pool.reduced) log.warn("config: pool_per_worker reduced to fit max_connections", { per_worker: pool.perWorker, workers: workerCount(current) });
  const metrics = new WorkerMetrics(workerId, pool.perWorker, current.log.slow_ms);

  // outbound policy: every fetch, plus a socket-level guard under it
  const network: NetworkPolicy = {
    lan: true,
    airGapped: current.network.air_gapped,
    allow: [...current.network.allow],
    onRefused: (host, label) => {
      metrics.refused(host, label || "fetch");
      log.warn("outbound call refused (air-gapped)", { host, via: label || "fetch" });
    },
  };
  installSocketGuard(network, {
    extraHosts: [current.db.host],
    onRefused: (host, port) => {
      metrics.refused(host, `socket:${port ?? ""}`);
      log.warn("outbound connection refused (air-gapped)", { host, port });
    },
  });

  const rawDb = createPostgresDb({ url: databaseUrl(current), max: pool.perWorker, ssl: current.db.ssl });
  const db = metrics.wrapDb(rawDb);
  if (o.migrate) await migrate(db, (m) => log.info(m));

  const blobs = createDiskBlobStore({
    root: current.dirs.blobs,
    quarantine: current.dirs.quarantine,
    maxBytes: current.uploads.max_mb * 1048576,
    antivirus: current.antivirus,
    onEvent: (e) => {
      if (e.kind === "infected") log.warn("antivirus: infected upload quarantined", e);
      else if (e.kind === "scan_failed") log.error("antivirus: scan failed", e);
      else log.debug(`blob ${e.kind}`, { org: e.org, size: e.size });
    },
  });
  installBlobStore(blobs);

  const platformAdmins = [...current.platform_admins];
  let scheduler: Scheduler | null = null;
  let certInfo: CertInfo | null = null;
  const started = new Date().toISOString();

  // cluster-wide metrics come from the supervisor; a standalone run has only its own
  let askId = 0;
  const pending = new Map<number, (m: ClusterMetrics) => void>();
  const cluster = (): Promise<ClusterMetrics> => {
    if (!o.ipc) return Promise.resolve({ workers: [metrics.snapshot()], expected_workers: 1, restarts: 0, started_at: started });
    const id = ++askId;
    return new Promise((ok) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        ok({ workers: [metrics.snapshot()], expected_workers: workerCount(current), restarts: 0, started_at: started });
      }, 2000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        ok(m);
      });
      send({ t: "ask", id });
    });
  };

  const cfg: ServerConfig = {
    mode: "cloud",
    db,
    secret: current.secret,
    secretSource: "installation",
    // accounts come from the first-run setup, the administrators and the directory (LDAP/SCIM), never self sign-up
    allowSignup: false,
    platformAdmins,
    origin: "cloud",
    publicUrl: current.public_url,
    log,
    fetch: networkFetch(network, globalThis.fetch.bind(globalThis)),
    // a write that queued jobs wakes the scheduler leader (this worker or another one, through NOTIFY)
    waitUntil: () => scheduler?.wake(),
    network,
    blobs,
    server: {
      health: () => serverHealth({ db, config: current, cluster, cert: () => certInfo }),
      info: () => ({ air_gapped: current.network.air_gapped, public_url: current.public_url, directory_path: DIRECTORY_SETTINGS_PATH }),
    },
  };
  const api = createApp(cfg);

  const reload = () => {
    try {
      const next = loadServerConfig(o.file).config;
      current = next;
      network.airGapped = next.network.air_gapped;
      network.allow = [...next.network.allow];
      platformAdmins.splice(0, platformAdmins.length, ...next.platform_admins);
      cfg.publicUrl = next.public_url;
      log.setLevel(next.log.level);
      log.info("config reloaded");
    } catch (e) {
      log.error("config reload failed", String((e as Error).message ?? e));
    }
  };

  if (o.scheduler !== false) {
    scheduler = new Scheduler({
      lock: postgresLock(databaseUrl(current), { ssl: current.db.ssl }),
      tick: () => tick(cfg, { budgetMs: 20_000, worker: `srv${workerId}-${process.pid}` }),
      log,
      intervalMs: current.scheduler.interval_s * 1000,
      onLeadership: (v) => (metrics.leader = v),
      // every tick is recorded: «سلامت سرور» shows the scheduler is alive even when the queue is empty
      onTick: (r, ms) => {
        metrics.lastTick = { at: new Date().toISOString(), ran: r.ran, failed: r.failed, ms };
      },
      chores: async () => {
        if (backupDue(current)) await backupNow({ config: current, label: "auto", log });
      },
    });
    scheduler.start();
  }

  const migrationsOk = { at: 0, ok: false };
  let closing = false;
  const ready = async () => {
    const checks: Record<string, boolean | string> = { accepting: !closing };
    try {
      await Promise.race([db.one("select 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
      checks.database = true;
    } catch (e) {
      checks.database = String((e as Error).message ?? e).slice(0, 200);
    }
    if (checks.database === true && Date.now() - migrationsOk.at > 10_000) {
      const st = await migrationStatus(db).catch(() => null);
      migrationsOk.ok = !!st && st.pending.length === 0;
      migrationsOk.at = Date.now();
    }
    checks.migrations = migrationsOk.ok;
    return { ok: checks.accepting === true && checks.database === true && checks.migrations === true, checks };
  };

  const hasUsers = createUsersProbe(db);
  const site = createStaticSite(o.staticDir ?? defaultStaticDir(), () => `<!doctype html><meta charset=utf-8><title>${APP_NAME}</title><p>رابط کاربری در بستهٔ سرور نیست</p>`);
  const front = createFront({
    api,
    config: () => current,
    site,
    metrics,
    log,
    ready,
    cluster,
    queue: async () => {
      const r = await db.one<{ due: number; running: number; failed: number }>(
        `select count(*) filter (where status = 'queued' and run_at <= now())::int as due, count(*) filter (where status = 'running')::int as running,
                count(*) filter (where status = 'failed' and done_at > now() - interval '24 hours')::int as failed from sm_jobs`,
      );
      return r ? { due: r.due, running: r.running, failed_24h: r.failed } : null;
    },
    setup: setupRoutes(
      {
        file: o.file,
        config: () => current,
        reload: () => {
          reload();
          if (o.ipc) send({ t: "reload" });
        },
        restart: (reason) => {
          if (o.ipc) send({ t: "restart", reason });
          else log.warn(`restart required (${reason}): restart the server to apply it`);
        },
        api,
        db,
        log,
      },
      hasUsers,
    ),
    setupRequired: async () => !(await hasUsers()),
    https: current.tls.enabled,
  });

  const listener = getRequestListener(front.fetch);
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    prepareRequest(req, current.trust_proxy);
    void listener(req, res);
  };
  const servers: Server[] = [];
  const listen = (server: Server, port: number) =>
    new Promise<number>((ok, fail) => {
      server.once("error", fail);
      server.listen({ port, host: current.listen.address, exclusive: false }, () => ok((server.address() as AddressInfo).port));
    });
  const tune = (s: Server) => {
    s.headersTimeout = 30_000;
    s.requestTimeout = 15 * 60_000;
    s.keepAliveTimeout = 65_000;
    servers.push(s);
    return s;
  };

  let httpsUrl: string | null = null;
  let httpUrl: string | null = null;
  const host = new URL(current.public_url).hostname;
  if (current.tls.enabled) {
    const creds = loadCredentials(current);
    certInfo = creds.info;
    if (creds.info.days_left < 30) log.warn("certificate expires soon", { days_left: creds.info.days_left, subject: creds.info.subject });
    const s = tune(createHttpsServer(serverTlsOptions(creds), handle) as unknown as Server);
    const port = await listen(s, o.ports?.https ?? current.listen.https_port);
    httpsUrl = `https://${host}${port === 443 ? "" : `:${port}`}`;
    const httpPort = o.ports?.http ?? current.listen.http_port;
    if (current.listen.redirect_http && httpPort !== undefined && (httpPort > 0 || o.ports?.http === 0)) {
      const r = tune(
        createHttpServer((req, res) => {
          const path = (req.url ?? "/").split("?")[0];
          // probes may stay on plain HTTP; everything else moves to HTTPS
          if (path === "/api/health" || path === "/api/ready") return handle(req, res);
          const wanted = String(req.headers.host ?? host).replace(/:\d+$/, "");
          const safeHost = /^[a-z0-9.-]+$/i.test(wanted) ? wanted : host;
          res.writeHead(301, { location: `https://${safeHost}${port === 443 ? "" : `:${port}`}${req.url ?? "/"}`, "cache-control": "no-cache" });
          res.end();
        }),
      );
      const hp = await listen(r, httpPort);
      httpUrl = `http://${host}:${hp}`;
    }
  } else {
    const s = tune(createHttpServer(handle));
    const port = await listen(s, o.ports?.http ?? current.listen.http_port);
    httpUrl = `http://${host}:${port}`;
  }
  log.info("server listening", { worker: workerId, https: httpsUrl, http: httpUrl, pool: pool.perWorker, air_gapped: current.network.air_gapped });

  const report = setInterval(() => {
    if (o.ipc) send({ t: "metrics", snap: metrics.snapshot() });
  }, 5000);
  report.unref?.();
  const onMessage = (m: { t?: string; id?: number; data?: ClusterMetrics }) => {
    if (m?.t === "answer" && typeof m.id === "number") pending.get(m.id)?.(m.data as ClusterMetrics);
    else if (m?.t === "reload") reload();
  };
  if (o.ipc) {
    process.on("message", onMessage);
    send({ t: "ready", worker: workerId });
    send({ t: "metrics", snap: metrics.snapshot() });
  }

  return {
    https: httpsUrl,
    http: httpUrl,
    cfg,
    metrics,
    scheduler,
    config: () => current,
    reload,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(report);
      process.off("message", onMessage);
      // stop accepting, let requests in flight finish (at most 20 s), then close what is left
      await Promise.race([
        Promise.all(
          servers.map(
            (s) =>
              new Promise<void>((r) => {
                s.close(() => r());
                (s as Server & { closeIdleConnections?: () => void }).closeIdleConnections?.();
              }),
          ),
        ),
        new Promise((r) => setTimeout(r, 20_000).unref?.()),
      ]);
      for (const s of servers) (s as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await scheduler?.stop().catch(() => undefined);
      await rawDb.close().catch(() => undefined);
      installBlobStore(null);
      fileLog?.close();
    },
  };
}
