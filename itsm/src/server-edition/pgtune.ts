// The PostgreSQL tuner of the server edition: a pure function from the machine (RAM, CPU cores, disk kind) and the
// expected connections to postgresql.conf settings, written by `karizctl pg-conf` into kariz-tuning.conf (included
// from postgresql.conf; an administrator's own overrides go into kariz-local.conf, included after it and never
// rewritten). The application server runs on the same machine, so the database gets a share of the memory, not all
// of it. Final numbers are aligned with the load tests of docs/PERFORMANCE_FA.md by the integrator: change them here
// (and the tests in tests/server-edition-pgtune.test.ts) only.

export type DiskKind = "ssd" | "hdd" | "san";
export type OsKind = "windows" | "linux";

export interface TuneInput {
  /** physical memory of the server in MB */
  ramMb: number;
  /** logical CPU cores */
  cpus: number;
  disk: DiskKind;
  os: OsKind;
  /** connections the application will open at most (workers × (pool + 1) + scheduler + tools); see planPools */
  connections: number;
  /** share of the memory PostgreSQL may use (the application server runs on the same machine); default 0.6 */
  dbShare?: number;
  /** statements slower than this are logged (ms); default 1000 */
  slowMs?: number;
}

export interface TuneResult {
  /** setting → value, in postgresql.conf syntax (strings already quoted) */
  settings: Record<string, string>;
  /** the memory the calculation assumed for PostgreSQL (MB) */
  dbMemMb: number;
  /** notes for the administrator (Persian), e.g. «حافظه کم است» */
  notes: string[];
}

export interface PoolPlanInput {
  /** application worker processes */
  workers: number;
  /** connections per worker the administrator asked for (0 = automatic) */
  requested?: number;
  /** PostgreSQL max_connections */
  maxConnections: number;
  /** connections kept free for administrators, backups and karizctl */
  reserve?: number;
}

export interface PoolPlan {
  /** pool size of each worker */
  perWorker: number;
  /** everything the application opens: workers × (pool + 1 scheduler lock connection) + 1 listener */
  total: number;
  /** the requested pool had to be reduced to fit max_connections − reserve */
  reduced: boolean;
}

const MB = 1;
const GB = 1024 * MB;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** PostgreSQL memory units: whole MB below 1 GB, otherwise GB when exact, else MB. */
export function memUnit(mb: number): string {
  const m = Math.max(1, Math.floor(mb));
  if (m >= GB && m % GB === 0) return `${m / GB}GB`;
  return `${m}MB`;
}

const DEFAULT_RESERVE = 10;
/** Connections a worker keeps besides its pool: the scheduler's lock connection. */
const PER_WORKER_EXTRA = 1;
/** The leader's LISTEN connection. */
const LISTENERS = 1;

/**
 * Pool size per worker so that workers × (pool + 1) + 1 ≤ max_connections − reserve. Automatic: a third of what fits,
 * between 4 and 20 per worker (PostgreSQL is fastest with a few busy connections per core, not hundreds idle).
 */
export function planPools(p: PoolPlanInput): PoolPlan {
  const workers = Math.max(1, Math.floor(p.workers));
  const reserve = Math.max(3, Math.floor(p.reserve ?? DEFAULT_RESERVE));
  const budget = Math.max(workers * (1 + PER_WORKER_EXTRA) + LISTENERS, Math.floor(p.maxConnections) - reserve);
  const fits = Math.max(1, Math.floor((budget - LISTENERS) / workers) - PER_WORKER_EXTRA);
  const auto = clamp(Math.floor(fits / 3), Math.min(4, fits), 20);
  const requested = p.requested && p.requested > 0 ? Math.floor(p.requested) : 0;
  const perWorker = requested ? Math.min(requested, fits) : auto;
  return { perWorker, total: workers * (perWorker + PER_WORKER_EXTRA) + LISTENERS, reduced: requested > fits };
}

/**
 * max_connections for an installation: what the application opens (planned with the default pool), the reserve and
 * PostgreSQL's own superuser slots, rounded up to a multiple of 10, at least 50.
 */
export function connectionsFor(workers: number, perWorker = 10, reserve = DEFAULT_RESERVE): number {
  const app = Math.max(1, workers) * (perWorker + PER_WORKER_EXTRA) + LISTENERS;
  return Math.max(50, Math.ceil((app + reserve + 3) / 10) * 10);
}

export function tunePostgres(input: TuneInput): TuneResult {
  const notes: string[] = [];
  const ramMb = Math.max(512, Math.floor(input.ramMb));
  const cpus = clamp(Math.floor(input.cpus) || 1, 1, 256);
  const share = clamp(input.dbShare ?? 0.6, 0.2, 0.9);
  const dbMemMb = Math.floor(ramMb * share);
  if (ramMb < 8 * GB) notes.push("حافظهٔ سرور کمتر از ۸ گیگابایت است؛ برای کار روزانهٔ یک بانک دست‌کم ۱۶ گیگابایت توصیه می‌شود");
  const maxConnections = Math.max(20, Math.ceil(input.connections));

  // memory
  const sharedBuffers = clamp(Math.floor(dbMemMb / 4), 128 * MB, input.os === "windows" ? 8 * GB : 16 * GB);
  const effectiveCache = Math.max(sharedBuffers * 2, Math.floor((dbMemMb * 3) / 4));
  const maintenance = clamp(Math.floor(dbMemMb / 16), 64 * MB, 2 * GB);
  const parallelGather = clamp(Math.ceil(cpus / 2), 1, 4);
  // every connection may sort/hash a few times at once, and parallel workers each get their own work_mem
  const workMem = clamp(Math.floor((dbMemMb - sharedBuffers) / (maxConnections * 3) / parallelGather), 4 * MB, 64 * MB);
  const walBuffers = clamp(Math.floor(sharedBuffers * 0.03), 1, 16 * MB);

  const s: Record<string, string> = {};
  // connections and authentication
  s.listen_addresses = "'127.0.0.1'";
  s.max_connections = String(maxConnections);
  s.superuser_reserved_connections = "3";
  s.password_encryption = "'scram-sha-256'";
  // memory
  s.shared_buffers = memUnit(sharedBuffers);
  s.effective_cache_size = memUnit(effectiveCache);
  s.work_mem = memUnit(workMem);
  s.maintenance_work_mem = memUnit(maintenance);
  s.autovacuum_work_mem = memUnit(clamp(Math.floor(maintenance / 2), 64 * MB, 1 * GB));
  s.huge_pages = input.os === "windows" ? "off" : "try";
  // write-ahead log and checkpoints
  s.wal_buffers = memUnit(walBuffers);
  s.min_wal_size = input.disk === "hdd" ? "512MB" : "1GB";
  s.max_wal_size = input.disk === "hdd" ? "2GB" : "4GB";
  s.checkpoint_timeout = "15min";
  s.checkpoint_completion_target = "0.9";
  s.wal_compression = "on";
  // planner and disk
  s.random_page_cost = input.disk === "hdd" ? "4.0" : "1.1";
  s.seq_page_cost = "1.0";
  // Windows has no posix_fadvise: PostgreSQL refuses to start with a non-zero value there
  if (input.os === "windows") {
    s.effective_io_concurrency = "0";
    s.maintenance_io_concurrency = "0";
  } else {
    s.effective_io_concurrency = input.disk === "hdd" ? "2" : input.disk === "san" ? "300" : "200";
    s.maintenance_io_concurrency = input.disk === "hdd" ? "10" : "100";
  }
  s.default_statistics_target = "100";
  s.jit = "off";
  // parallelism
  s.max_worker_processes = String(Math.max(8, cpus));
  s.max_parallel_workers = String(cpus);
  s.max_parallel_workers_per_gather = String(parallelGather);
  s.max_parallel_maintenance_workers = String(clamp(Math.ceil(cpus / 2), 1, 4));
  // autovacuum tuned for large, busy tables (incidents, history, journal, jobs)
  s.autovacuum_max_workers = String(cpus >= 8 ? 5 : 3);
  s.autovacuum_naptime = "30s";
  s.autovacuum_vacuum_scale_factor = "0.05";
  s.autovacuum_analyze_scale_factor = "0.02";
  s.autovacuum_vacuum_insert_scale_factor = "0.05";
  s.autovacuum_vacuum_cost_limit = input.disk === "hdd" ? "400" : "2000";
  s.autovacuum_vacuum_cost_delay = "2ms";
  // safety
  s.idle_in_transaction_session_timeout = "10min";
  s.timezone = "'UTC'";
  s.log_timezone = "'UTC'";
  s.lc_messages = "'C'";
  // statistics and slow statements
  s.shared_preload_libraries = "'pg_stat_statements'";
  s["pg_stat_statements.max"] = "5000";
  s["pg_stat_statements.track"] = "top";
  s.track_io_timing = "on";
  s.logging_collector = "on";
  s.log_directory = "'log'";
  s.log_filename = "'postgresql-%a.log'";
  s.log_rotation_age = "1d";
  s.log_rotation_size = "0";
  s.log_truncate_on_rotation = "on";
  s.log_line_prefix = "'%m [%p] %q%u@%d '";
  s.log_min_duration_statement = String(Math.max(50, Math.floor(input.slowMs ?? 1000)));
  s.log_checkpoints = "on";
  s.log_lock_waits = "on";
  s.log_temp_files = "10240";
  s.log_autovacuum_min_duration = "10s";

  if (cpus < 4) notes.push("کمتر از ۴ هستهٔ پردازنده؛ کارهای پس‌زمینه و گزارش‌ها کند خواهند بود");
  if (input.disk === "hdd") notes.push("دیسک چرخان (HDD) برای پایگاه داده کند است؛ SSD یا SAN با تأخیر کم توصیه می‌شود");
  return { settings: s, dbMemMb, notes };
}

/** The include file kariz-tuning.conf: a header naming its source and one setting per line. */
export function renderTuning(result: TuneResult, input: TuneInput, generatedAt = new Date()): string {
  const head = [
    "# Generated by karizctl pg-conf — do not edit: it is rewritten on every upgrade.",
    "# Put your own settings into kariz-local.conf (included after this file).",
    `# machine: ${input.ramMb} MB RAM, ${input.cpus} cores, ${input.disk}, ${input.os}; database share ${result.dbMemMb} MB; connections ${input.connections}`,
    `# generated: ${generatedAt.toISOString()}`,
  ];
  const width = Math.max(...Object.keys(result.settings).map((k) => k.length));
  return [...head, "", ...Object.entries(result.settings).map(([k, v]) => `${k.padEnd(width)} = ${v}`), ""].join("\n");
}

/** The include lines appended once to postgresql.conf. */
export const CONF_INCLUDES = ["include_if_exists = 'kariz-tuning.conf'", "include_if_exists = 'kariz-local.conf'"];

/** postgresql.conf with the include lines present exactly once (at the end, so they win over initdb's defaults). */
export function withIncludes(conf: string): string {
  const lines = conf.split(/\r?\n/).filter((l) => !CONF_INCLUDES.includes(l.trim()));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return [...lines, "", "# Kariz server edition", ...CONF_INCLUDES, ""].join("\n");
}
