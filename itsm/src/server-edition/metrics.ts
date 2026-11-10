// Metrics of the server edition. Each worker measures its event-loop lag, requests (count, errors, latency
// percentiles, slow requests), database use (queries in flight ≈ busy pool connections, slow queries) and memory, and
// reports a snapshot to the supervisor every few seconds; the supervisor keeps the latest of each worker. They are
// served to the platform owner («سلامت سرور») and, as Prometheus text, to monitoring tools (GET /api/server/metrics
// with the metrics token). Metric names stay neutral (itsm_*).
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Db, Tx } from "@server/db";

export interface SlowRequest {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
}

export interface WorkerSnapshot {
  worker: number;
  pid: number;
  started_at: string;
  uptime_s: number;
  leader: boolean;
  rss_mb: number;
  heap_mb: number;
  loop_lag_ms: { p50: number; p99: number; max: number };
  requests: { total: number; errors: number; in_flight: number; per_min: number; p50_ms: number; p95_ms: number; p99_ms: number };
  db: { pool: number; busy: number; queries: number; slow: number; errors: number };
  slow: SlowRequest[];
  last_tick: { at: string; ran: number; failed: number; ms: number } | null;
  refused: { total: number; recent: { host: string; at: string; via: string }[] };
  at: string;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Path of a request with identifiers removed (no record ids or tokens in metrics and logs). */
export function routeOf(path: string): string {
  return (
    path
      .split("?")[0]
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
      .replace(/\/[0-9a-f]{32,}(?=\/|$)/gi, "/:hash")
      .replace(/\/\d+(?=\/|$)/g, "/:n")
      .slice(0, 160) || "/"
  );
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export class WorkerMetrics {
  private loop = monitorEventLoopDelay({ resolution: 20 });
  private started = Date.now();
  private total = 0;
  private errors = 0;
  private inFlight = 0;
  private window: number[] = [];
  private windowStart = Date.now();
  private perMin = 0;
  private slowList: SlowRequest[] = [];
  private dbBusy = 0;
  private dbQueries = 0;
  private dbSlow = 0;
  private dbErrors = 0;
  private refusedTotal = 0;
  private refusedRecent: { host: string; at: string; via: string }[] = [];
  leader = false;
  lastTick: WorkerSnapshot["last_tick"] = null;

  constructor(public worker: number, public pool: number, private slowMs: number) {
    this.loop.enable();
  }

  requestStarted() {
    this.inFlight++;
  }

  requestDone(method: string, path: string, status: number, ms: number) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.total++;
    if (status >= 500) this.errors++;
    if (this.window.length < 20000) this.window.push(ms);
    if (ms >= this.slowMs) {
      this.slowList.unshift({ at: new Date().toISOString(), method, path: routeOf(path), status, ms: Math.round(ms) });
      this.slowList.length = Math.min(this.slowList.length, 20);
    }
  }

  refused(host: string, via: string) {
    this.refusedTotal++;
    this.refusedRecent.unshift({ host, at: new Date().toISOString(), via });
    this.refusedRecent.length = Math.min(this.refusedRecent.length, 20);
  }

  /** Wrap the database so its use is measured (queries in flight ≈ busy pool connections). */
  wrapDb(db: Db): Db {
    const m = this;
    const timed = async <T>(fn: () => Promise<T>): Promise<T> => {
      m.dbBusy++;
      m.dbQueries++;
      const t0 = performance.now();
      try {
        return await fn();
      } catch (e) {
        m.dbErrors++;
        throw e;
      } finally {
        m.dbBusy--;
        if (performance.now() - t0 >= m.slowMs) m.dbSlow++;
      }
    };
    return {
      kind: db.kind,
      query: (text, params) => timed(() => db.query(text, params)),
      one: (text, params) => timed(() => db.one(text, params)),
      exec: (text) => timed(() => db.exec(text)),
      tx: <T>(fn: (tx: Tx) => Promise<T>) => timed(() => db.tx(fn)),
      close: () => db.close(),
    } as Db;
  }

  snapshot(): WorkerSnapshot {
    const now = Date.now();
    const sorted = [...this.window].sort((a, b) => a - b);
    const minutes = Math.max(1 / 60, (now - this.windowStart) / 60000);
    this.perMin = round(this.window.length / minutes);
    const s: WorkerSnapshot = {
      worker: this.worker,
      pid: process.pid,
      started_at: new Date(this.started).toISOString(),
      uptime_s: Math.round((now - this.started) / 1000),
      leader: this.leader,
      rss_mb: Math.round(process.memoryUsage().rss / 1048576),
      heap_mb: Math.round(process.memoryUsage().heapUsed / 1048576),
      loop_lag_ms: { p50: round(this.loop.percentile(50) / 1e6), p99: round(this.loop.percentile(99) / 1e6), max: round(this.loop.max / 1e6) },
      requests: { total: this.total, errors: this.errors, in_flight: this.inFlight, per_min: this.perMin, p50_ms: round(percentile(sorted, 50)), p95_ms: round(percentile(sorted, 95)), p99_ms: round(percentile(sorted, 99)) },
      db: { pool: this.pool, busy: Math.max(0, this.dbBusy), queries: this.dbQueries, slow: this.dbSlow, errors: this.dbErrors },
      slow: [...this.slowList],
      last_tick: this.lastTick,
      refused: { total: this.refusedTotal, recent: [...this.refusedRecent] },
      at: new Date(now).toISOString(),
    };
    // percentiles describe the last minute or so
    if (now - this.windowStart > 60_000) {
      this.window = [];
      this.windowStart = now;
      this.loop.reset();
    }
    return s;
  }
}

export interface ClusterMetrics {
  workers: WorkerSnapshot[];
  expected_workers: number;
  restarts: number;
  started_at: string;
}

/** Prometheus text exposition of the cluster's metrics (and the queue depth when known). */
export function prometheus(m: ClusterMetrics, extra: { queue?: { due: number; running: number; failed_24h: number } | null } = {}): string {
  const out: string[] = [];
  const metric = (name: string, help: string, type: "gauge" | "counter", rows: [Record<string, string | number>, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, v] of rows) {
      const l = Object.entries(labels)
        .map(([k, x]) => `${k}="${String(x).replace(/["\\\n]/g, "_")}"`)
        .join(",");
      out.push(`${name}${l ? `{${l}}` : ""} ${Number.isFinite(v) ? v : 0}`);
    }
  };
  const w = (s: WorkerSnapshot) => ({ worker: s.worker });
  metric("itsm_workers", "Worker processes running", "gauge", [[{}, m.workers.length]]);
  metric("itsm_workers_expected", "Worker processes configured", "gauge", [[{}, m.expected_workers]]);
  metric("itsm_worker_restarts_total", "Workers restarted by the supervisor", "counter", [[{}, m.restarts]]);
  metric("itsm_event_loop_lag_p99_ms", "Event loop delay, 99th percentile", "gauge", m.workers.map((s) => [w(s), s.loop_lag_ms.p99]));
  metric("itsm_memory_rss_mb", "Resident memory of the worker", "gauge", m.workers.map((s) => [w(s), s.rss_mb]));
  metric("itsm_http_requests_total", "HTTP requests served", "counter", m.workers.map((s) => [w(s), s.requests.total]));
  metric("itsm_http_errors_total", "HTTP responses with status 5xx", "counter", m.workers.map((s) => [w(s), s.requests.errors]));
  metric("itsm_http_in_flight", "HTTP requests in progress", "gauge", m.workers.map((s) => [w(s), s.requests.in_flight]));
  metric("itsm_http_latency_p95_ms", "Request latency, 95th percentile (last minute)", "gauge", m.workers.map((s) => [w(s), s.requests.p95_ms]));
  metric("itsm_db_pool_size", "Database connections per worker", "gauge", m.workers.map((s) => [w(s), s.db.pool]));
  metric("itsm_db_busy", "Database queries in flight", "gauge", m.workers.map((s) => [w(s), s.db.busy]));
  metric("itsm_db_slow_queries_total", "Database calls slower than the slow threshold", "counter", m.workers.map((s) => [w(s), s.db.slow]));
  metric("itsm_scheduler_leader", "1 on the worker that runs the job scheduler", "gauge", m.workers.map((s) => [w(s), s.leader ? 1 : 0]));
  metric("itsm_outbound_refused_total", "Outbound connections refused by the air-gap policy", "counter", m.workers.map((s) => [w(s), s.refused.total]));
  if (extra.queue) {
    metric("itsm_jobs_due", "Queued jobs that are due", "gauge", [[{}, extra.queue.due]]);
    metric("itsm_jobs_running", "Jobs being run", "gauge", [[{}, extra.queue.running]]);
    metric("itsm_jobs_failed_24h", "Jobs that failed in the last 24 hours", "gauge", [[{}, extra.queue.failed_24h]]);
  }
  return `${out.join("\n")}\n`;
}
