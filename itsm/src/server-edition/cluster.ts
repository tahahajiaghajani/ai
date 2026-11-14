// The supervisor of the server edition (the KarizApp service's process): waits for PostgreSQL, applies migrations
// once, makes sure a certificate exists, forks one worker per core (configurable), restarts a crashed worker with
// backoff, restarts all workers one by one when asked (new certificate or host name: a worker asks; an administrator
// with `karizctl restart --rolling`, which drops <data>\restart.request), writes the log file for everyone, keeps the
// workers' metrics, and stops gracefully on Ctrl+C / SIGTERM / service stop.
import cluster, { type Worker } from "node:cluster";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import { databaseUrl, loadServerConfig, workerCount } from "./config";
import { EXIT_FATAL_CONFIG } from "./names";
import { createLogger, echo, RotatingFile, type Level } from "./log";
import { loadCredentials } from "./tls";
import { waitForDb } from "./pg";
import type { ClusterMetrics, WorkerSnapshot } from "./metrics";
import { ForegroundBoard } from "./foreground";

export const RESTART_REQUEST = "restart.request";
/** `karizctl allow …` changed the allowlist: the workers re-read the configuration (no restart). */
export const RELOAD_REQUEST = "reload.request";

interface Slot {
  id: number;
  worker: Worker | null;
  crashes: number[];
  snapshot: WorkerSnapshot | null;
}

export async function runPrimary(file: string): Promise<void> {
  const loaded = loadServerConfig(file);
  let c = loaded.config;
  const out = new RotatingFile(c.dirs.logs, "kariz-app.log", c.log.max_mb * 1048576, c.log.keep);
  const write = (line: string, level: Level) => {
    out.write(line);
    echo(line, level);
  };
  const log = createLogger(write, { level: c.log.level, worker: 0 });
  for (const w of loaded.warnings) log.warn(`config: ${w}`);
  const fatal = (msg: string) => {
    log.error(msg);
    out.close();
    process.exit(EXIT_FATAL_CONFIG);
  };
  if (!c.secret || c.secret.length < 32 || !c.db.password) return fatal("configuration incomplete (secret / database password): run «karizctl init»");

  log.info("supervisor starting", { pid: process.pid, node: process.version, config: file });
  try {
    await waitForDb(c, 10 * 60_000);
    const db = createPostgresDb({ url: databaseUrl(c), max: 2, ssl: c.db.ssl, prepare: true });
    try {
      const ran = await migrate(db, (m) => log.info(`migration: ${m}`));
      log.info("migrations applied", { count: ran.length });
    } finally {
      await db.close();
    }
  } catch (e) {
    log.error("database not ready", String((e as Error).message ?? e));
    out.close();
    // the service manager restarts us (WinSW onfailure) — PostgreSQL may still be recovering
    process.exit(1);
  }
  if (c.tls.enabled) {
    try {
      const creds = loadCredentials(c);
      log.info("certificate", { subject: creds.info.subject, valid_to: creds.info.valid_to, self_signed: creds.info.self_signed });
    } catch (e) {
      return fatal(`certificate unusable: ${(e as Error).message}`);
    }
  }

  const n = workerCount(c);
  const slots: Slot[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, worker: null, crashes: [], snapshot: null }));
  let stopping = false;
  let restarts = 0;
  let rolling = false;
  const startedAt = new Date().toISOString();
  const readyWaiters = new Map<number, () => void>();

  const metrics = (): ClusterMetrics => ({
    workers: slots.map((s) => s.snapshot).filter((x): x is WorkerSnapshot => !!x && slots.some((sl) => sl.worker && sl.id === x.worker)),
    expected_workers: n,
    restarts,
    started_at: startedAt,
  });

  // which workers have requests a person waits for; every worker hears when the cluster's state changes, and the
  // scheduler leader's job runner gives way while any has (foreground.ts)
  const foreground = new ForegroundBoard();
  const tell = (w: Worker, m: object) => {
    try {
      if (w.isConnected()) w.send(m);
    } catch {
      /* the worker is going */
    }
  };
  const foregroundChanged = (busy: boolean | null) => {
    if (busy === null) return;
    for (const s of slots) if (s.worker) tell(s.worker, { t: "fg", busy });
  };

  const fork = (slot: Slot): Worker => {
    const w = cluster.fork({ ITSM_WORKER_ID: String(slot.id), ITSM_SERVER_CONFIG: file });
    slot.worker = w;
    w.on("message", (m: { t?: string; line?: string; level?: Level; snap?: WorkerSnapshot; id?: number; reason?: string; worker?: number; on?: boolean }) => {
      if (!m || typeof m !== "object") return;
      if (m.t === "fg") foregroundChanged(foreground.set(w.id, m.on === true));
      else if (m.t === "log" && m.line) write(m.line, m.level ?? "info");
      else if (m.t === "metrics" && m.snap) slot.snapshot = m.snap;
      else if (m.t === "ask" && typeof m.id === "number") w.send({ t: "answer", id: m.id, data: metrics() });
      else if (m.t === "reload") {
        c = loadServerConfig(file).config;
        log.setLevel(c.log.level);
        for (const s of slots) if (s.worker && s.worker !== w) s.worker.send({ t: "reload" });
      } else if (m.t === "restart") {
        log.info("rolling restart requested", { by: slot.id, reason: m.reason });
        setTimeout(() => void rollingRestart(), 1500);
      } else if (m.t === "ready") {
        readyWaiters.get(w.id)?.();
        // a new worker learns whether others are busy now (it hears every later change)
        if (foreground.any) tell(w, { t: "fg", busy: true });
      }
    });
    w.on("exit", (code, signal) => {
      foregroundChanged(foreground.gone(w.id));
      if (slot.worker !== w) return; // replaced during a rolling restart
      slot.worker = null;
      slot.snapshot = null;
      if (stopping) return;
      if (code === EXIT_FATAL_CONFIG) {
        log.error("worker stopped: configuration error (not restarted)", { worker: slot.id });
        if (slots.every((s) => !s.worker)) fatal("every worker stopped with a configuration error");
        return;
      }
      const now = Date.now();
      slot.crashes = [...slot.crashes.filter((t) => now - t < 300_000), now];
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(6, slot.crashes.length - 1));
      restarts++;
      // every worker keeps crashing (a port taken, a broken disk…): give up, so the service manager restarts the
      // service and Windows records the failure instead of a «running» service that serves nothing
      if (slots.every((s) => s.crashes.filter((t) => now - t < 300_000).length >= 8)) {
        log.error("every worker keeps crashing; the supervisor stops (see the errors above)");
        out.close();
        process.exit(1);
      }
      log.error("worker exited; restarting", { worker: slot.id, code, signal, in_ms: delay, crashes_5min: slot.crashes.length });
      setTimeout(() => {
        if (!stopping && !slot.worker) fork(slot);
      }, delay).unref();
    });
    return w;
  };

  const waitReady = (w: Worker, ms: number) =>
    new Promise<boolean>((ok) => {
      const timer = setTimeout(() => {
        readyWaiters.delete(w.id);
        ok(false);
      }, ms);
      readyWaiters.set(w.id, () => {
        clearTimeout(timer);
        readyWaiters.delete(w.id);
        ok(true);
      });
    });

  const stopWorker = (w: Worker, ms = 30_000) =>
    new Promise<void>((ok) => {
      if (w.isDead()) return ok();
      const timer = setTimeout(() => {
        w.process.kill();
        ok();
      }, ms);
      w.once("exit", () => {
        clearTimeout(timer);
        ok();
      });
      try {
        w.send({ t: "shutdown" });
      } catch {
        w.process.kill();
      }
    });

  /** Replace the workers one at a time: the new one serves before the old one stops (no downtime). */
  const rollingRestart = async () => {
    if (rolling || stopping) return;
    rolling = true;
    try {
      c = loadServerConfig(file).config;
      if (c.tls.enabled) loadCredentials(c);
      for (const slot of slots) {
        if (stopping) break;
        const old = slot.worker;
        const fresh = fork(slot);
        const ok = await waitReady(fresh, 90_000);
        if (!ok) log.warn("new worker did not report ready in time", { worker: slot.id });
        if (old) await stopWorker(old);
      }
      log.info("rolling restart done", { workers: n });
    } catch (e) {
      log.error("rolling restart failed", String((e as Error).message ?? e));
    } finally {
      rolling = false;
    }
  };

  const shutdown = async (why: string) => {
    if (stopping) return;
    stopping = true;
    log.info("supervisor stopping", { why });
    await Promise.all(slots.map((s) => (s.worker ? stopWorker(s.worker) : Promise.resolve())));
    log.info("supervisor stopped");
    out.close();
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(sig, () => void shutdown(sig));
  if (process.platform !== "win32") process.on("SIGHUP", () => void rollingRestart());

  // karizctl restart --rolling: a request file in the data folder
  const requestFile = join(c.dirs.data, RESTART_REQUEST);
  const reloadFile = join(c.dirs.data, RELOAD_REQUEST);
  setInterval(() => {
    if (existsSync(reloadFile)) {
      rmSync(reloadFile, { force: true });
      c = loadServerConfig(file).config;
      log.setLevel(c.log.level);
      log.info("configuration reload requested by file");
      for (const s of slots) s.worker?.send({ t: "reload" });
    }
    if (!existsSync(requestFile)) return;
    rmSync(requestFile, { force: true });
    log.info("rolling restart requested by file");
    void rollingRestart();
  }, 2000).unref();

  for (const slot of slots) fork(slot);
  log.info("workers started", { workers: n });
}
