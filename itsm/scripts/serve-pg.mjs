#!/usr/bin/env node
// A minimal Postgres-mode API server for load tests (docs/PERFORMANCE_FA.md): the same Hono app the web version runs,
// on a local PostgreSQL (scripts/pg-local.mjs), as one process or a node:cluster of workers sharing one port. The
// server edition's runtime (src/server-edition) replaces it in production; this runner only has what a measurement
// needs: a pool per worker, one job-runner process (the "leader": worker 1 ticks the queue every --tick ms) and
// optional ticks after writes (--tick-on-write, the web version's behaviour).
//
//   node scripts/serve-pg.mjs [--port 3940] [--workers 1] [--pool 10] [--tick 1000] [--job-concurrency 4] [--tick-on-write] [--lock-stats] [--url postgres://…]
//
// Worker count 1 runs in this process; more fork workers (the primary migrates once, then forks).
// --lock-stats: the write-lock probe (src/server/db/lockprobe.ts) records every transaction that took an organisation's
// write lock — its route or job kind, wait and hold time; SIGUSR2 makes each worker write what it recorded since the
// last signal to .perf/lockstats-<pid>.json and start over (scripts/loadtest.mjs does both around a run).
import cluster from "node:cluster";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const opts = args(process.argv.slice(2));
const PORT = Number(opts.port ?? process.env.PORT ?? 3940);
const WORKERS = Math.max(1, Number(opts.workers ?? process.env.ITSM_WORKERS ?? 1));
const POOL = Math.max(1, Number(opts.pool ?? process.env.DATABASE_POOL_MAX ?? 10));
const TICK = Number(opts.tick ?? 1000);
const JOB_CONCURRENCY = Number(opts["job-concurrency"] ?? 4);
const URL_ = opts.url ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/itsm";

/** Load the server's TypeScript modules through tsx (tsconfig paths resolve from the project root). */
export async function loadServer() {
  process.chdir(ROOT);
  // both hooks: .ts files of a package without "type": "module" load as CommonJS
  (await import("tsx/esm/api")).register();
  (await import("tsx/cjs/api")).register();
  const mod = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
  const [app, pg, migrate, jobs, context, probe] = await Promise.all([
    mod("src/server/app.ts"),
    mod("src/server/db/postgres.ts"),
    mod("src/server/db/migrate.ts"),
    mod("src/server/jobs/index.ts"),
    mod("src/server/context.ts"),
    mod("src/server/db/lockprobe.ts"),
  ]);
  return { createApp: app.createApp, createPostgresDb: pg.createPostgresDb, migrate: migrate.migrate, tick: jobs.tick, consoleLogger: context.consoleLogger, probe };
}

const quiet = (log) => ({
  info: () => {},
  warn: (...a) => log.warn(...a),
  error: (...a) => log.error(...a),
});

async function serveOne(worker, { migrateFirst }) {
  const s = await loadServer();
  const db = s.createPostgresDb({ url: URL_, max: POOL, ssl: false });
  if (migrateFirst) await s.migrate(db, (m) => console.log(`[w${worker}] ${m}`));
  const cfg = {
    mode: "cloud",
    db,
    secret: process.env.APP_SECRET ?? "itsm-perf-secret",
    secretSource: "env",
    allowSignup: true,
    platformAdmins: [],
    origin: "cloud",
    log: quiet(s.consoleLogger),
    fetch: globalThis.fetch.bind(globalThis),
    waitUntil: opts["tick-on-write"] ? (work) => void work().catch(() => undefined) : undefined,
  };
  const app = s.createApp(cfg);
  const { serve } = await import("@hono/node-server");
  let fetch = app.fetch;
  if (opts["lock-stats"]) {
    const samples = [];
    s.probe.setLockProbe((x) => samples.push(x));
    // what a transaction belonged to: the route with ids folded ("PATCH /api/o/:org/r/incident/:id")
    const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const labelOf = (req) => {
      const u = new URL(req.url);
      return `${req.method} ${u.pathname.replace(/\/o\/[0-9a-f-]{36}/i, "/o/:org").replace(UUIDS, ":id")}`;
    };
    fetch = (req, ...rest) => s.probe.withLockLabel(labelOf(req), () => app.fetch(req, ...rest));
    process.on("SIGUSR2", () => {
      const out = samples.splice(0, samples.length);
      mkdirSync(resolve(ROOT, ".perf"), { recursive: true });
      writeFileSync(resolve(ROOT, ".perf", `lockstats-${process.pid}.json`), JSON.stringify({ pid: process.pid, worker, at: new Date().toISOString(), samples: out }));
    });
  }
  const server = serve({ fetch, port: PORT, hostname: "127.0.0.1" });
  // keep-alive connections of a load generator outlive Node's 5 s default
  server.keepAliveTimeout = 65_000;
  if (TICK > 0 && worker === 1) {
    let busy = false;
    setInterval(() => {
      if (busy) return;
      busy = true;
      s.tick(cfg, { budgetMs: 4000, concurrency: JOB_CONCURRENCY })
        .catch((e) => cfg.log.warn("job tick failed", String(e?.message ?? e)))
        .finally(() => (busy = false));
    }, TICK).unref();
  }
  const stop = async () => {
    server.close();
    await db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(`[w${worker}] ready http://127.0.0.1:${PORT}/api (pid ${process.pid}, pool ${POOL}${TICK > 0 && worker === 1 ? `, jobs every ${TICK} ms` : ""})`);
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) {
  // imported (scripts/seed-bank.mjs uses loadServer)
} else if (WORKERS > 1 && cluster.isPrimary) {
  const s = await loadServer();
  const db = s.createPostgresDb({ url: URL_, max: 2, ssl: false });
  await s.migrate(db, (m) => console.log(`[primary] ${m}`));
  await db.close();
  for (let i = 1; i <= WORKERS; i++) cluster.fork({ ITSM_WORKER: String(i) });
  // the load test signals every serve-pg process for lock statistics: the primary has none (and must not die of it)
  process.on("SIGUSR2", () => {});
  let stopping = false;
  cluster.on("exit", (w, code) => {
    if (stopping) return;
    console.log(`[primary] worker ${w.process.pid} exited (${code}); restarting`);
    cluster.fork({ ITSM_WORKER: String(w.id) });
  });
  const stop = () => {
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill("SIGTERM");
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} else {
  const worker = Number(process.env.ITSM_WORKER ?? 1);
  await serveOne(worker, { migrateFirst: WORKERS === 1 });
}
