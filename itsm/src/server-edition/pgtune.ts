// The PostgreSQL tuner — the ONE source of the settings, worker and pool formulas used by the server edition
// (`karizctl pg-conf` writes them into kariz-tuning.conf, included from postgresql.conf; an administrator's own
// overrides go into kariz-local.conf, included after it and never rewritten) and by the load-test tooling
// (scripts/pg-local.mjs loads this file through tsx). The numbers are the measured ones of docs/PERFORMANCE_FA.md
// §۷–۸ (and §۱۳-۷): change them here, and the tests in tests/server-edition-core.test.ts and
// tests/integration-scale-server.test.ts, only.

export type DiskKind = "ssd" | "hdd" | "san";
export type OsKind = "windows" | "linux";

export interface TuneInput {
  /** physical memory of the server in MB */
  ramMb: number;
  /** logical CPU cores */
  cpus: number;
  disk: DiskKind;
  os: OsKind;
  /** max_connections: connectionsFor(workers, pool) for this installation (at least 50) */
  connections: number;
  /** statements slower than this are logged (ms); default 1000 */
  slowMs?: number;
}

export interface TuneResult {
  /** setting → value, in postgresql.conf syntax (strings already quoted) */
  settings: Record<string, string>;
  /** the memory the calculation assumed (MB): the whole machine — shared_buffers is 25 % of it */
  dbMemMb: number;
  /** notes for the administrator (Persian), e.g. «حافظه کم است» */
  notes: string[];
}

export interface PoolPlanInput {
  /** application worker processes */
  workers: number;
  /** connections per worker the administrator asked for (0 = automatic) */
  requested?: number;
  /** the automatic pool (recommendedPool(cpus)); default 10 */
  auto?: number;
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

export const DEFAULT_RESERVE = 10;
/** Connections a worker keeps besides its pool: the scheduler's lock connection. */
const PER_WORKER_EXTRA = 1;
/** The leader's LISTEN connection. */
const LISTENERS = 1;
/** Connections above workers × pool: the job runner, backups, karizctl, monitoring and PostgreSQL's own slots. */
const HEADROOM = 30;

/**
 * Node API processes for a machine: a third of the vCPUs (measured: PostgreSQL spends ~2.4× the CPU of Node per
 * request — PERFORMANCE_FA.md §۸), at least 2 (a crash never stops the service), at most 12.
 */
export function recommendedWorkers(cpus: number): number {
  return Math.max(2, Math.min(12, Math.round(Math.max(1, cpus) / 3)));
}

/** postgres.js connections per Node process: a request holds one for a few milliseconds; 10 keeps p99 low. */
export function recommendedPool(cpus: number): number {
  return cpus >= 8 ? 10 : 8;
}

/** The job runner of the server edition (only on the scheduler leader): four jobs at once, batched claims. */
export const JOB_CONCURRENCY = 4;

/**
 * Pool size per worker so that workers × (pool + 1) + 1 ≤ max_connections − reserve. Automatic: `auto`
 * (recommendedPool) when it fits, else what fits.
 */
export function planPools(p: PoolPlanInput): PoolPlan {
  const workers = Math.max(1, Math.floor(p.workers));
  const reserve = Math.max(3, Math.floor(p.reserve ?? DEFAULT_RESERVE));
  const budget = Math.max(workers * (1 + PER_WORKER_EXTRA) + LISTENERS, Math.floor(p.maxConnections) - reserve);
  const fits = Math.max(1, Math.floor((budget - LISTENERS) / workers) - PER_WORKER_EXTRA);
  const auto = Math.max(1, Math.min(fits, Math.floor(p.auto ?? 10)));
  const requested = p.requested && p.requested > 0 ? Math.floor(p.requested) : 0;
  const perWorker = requested ? Math.min(requested, fits) : auto;
  return { perWorker, total: workers * (perWorker + PER_WORKER_EXTRA) + LISTENERS, reduced: requested > fits };
}

/**
 * max_connections for an installation: workers × pool + 30, at least 50 — and never less than what keeps S1's
 * invariant workers × (pool + 1) + 1 ≤ max_connections − reserve (only matters for many configured workers).
 */
export function connectionsFor(workers: number, perWorker = 10, reserve = DEFAULT_RESERVE): number {
  const w = Math.max(1, Math.floor(workers));
  const p = Math.max(1, Math.floor(perWorker));
  return Math.max(50, w * p + HEADROOM, w * (p + PER_WORKER_EXTRA) + LISTENERS + reserve);
}

export function tunePostgres(input: TuneInput): TuneResult {
  const notes: string[] = [];
  const ramMb = Math.max(512, Math.floor(input.ramMb));
  const cpus = clamp(Math.floor(input.cpus) || 1, 1, 256);
  if (ramMb < 8 * GB) notes.push("حافظهٔ سرور کمتر از ۸ گیگابایت است؛ برای کار روزانهٔ یک بانک دست‌کم ۱۶ گیگابایت توصیه می‌شود");
  const maxConnections = Math.max(50, Math.ceil(input.connections));

  // memory (PERFORMANCE_FA.md §۷): 25 % shared buffers up to 16 GB, 70 % effective cache
  const sharedBuffers = clamp(Math.round(ramMb * 0.25), 128 * MB, 16 * GB);
  const effectiveCache = Math.round(ramMb * 0.7);
  // a sort or hash node may take work_mem; a busy OLTP query has a few — keep the worst case well inside RAM
  const workMem = clamp(Math.floor((ramMb - sharedBuffers) / (maxConnections * 4)), 4 * MB, 64 * MB);
  const maintenance = clamp(Math.round(ramMb / 16), 256 * MB, 2 * GB);

  const s: Record<string, string> = {};
  // connections and authentication
  s.listen_addresses = "'127.0.0.1'";
  // TCP on loopback only: no Unix-domain socket (its default folder may not be writable by the service account)
  s.unix_socket_directories = "''";
  s.max_connections = String(maxConnections);
  s.superuser_reserved_connections = "3";
  s.password_encryption = "'scram-sha-256'";
  // the first migration creates ~400 tables and ~3 500 indexes in one transaction (one lock each)
  s.max_locks_per_transaction = "256";
  // memory
  s.shared_buffers = memUnit(sharedBuffers);
  s.effective_cache_size = memUnit(effectiveCache);
  s.work_mem = memUnit(workMem);
  s.maintenance_work_mem = memUnit(maintenance);
  s.autovacuum_work_mem = memUnit(Math.min(1 * GB, maintenance));
  // Windows needs the «Lock pages in memory» privilege for huge pages
  s.huge_pages = input.os === "windows" ? "off" : "try";
  // write-ahead log and checkpoints (sizes by RAM)
  s.wal_buffers = ramMb >= 4 * GB ? "64MB" : memUnit(clamp(Math.floor(sharedBuffers * 0.03), 1, 16 * MB));
  s.min_wal_size = ramMb >= 12 * GB ? "1GB" : "512MB";
  s.max_wal_size = ramMb >= 32 * GB ? "8GB" : ramMb >= 12 * GB ? "4GB" : "2GB";
  s.checkpoint_timeout = "15min";
  s.checkpoint_completion_target = "0.9";
  s.wal_compression = "on";
  // banking data: never off
  s.synchronous_commit = "on";
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
  // skewed distributions (groups, assignees)
  s.default_statistics_target = "200";
  // short OLTP queries: compiling them costs more than it saves
  s.jit = "off";
  // parallelism
  s.max_worker_processes = String(Math.max(8, cpus));
  s.max_parallel_workers = String(Math.max(2, Math.floor(cpus / 2)));
  s.max_parallel_workers_per_gather = String(cpus >= 8 ? 2 : 1);
  s.max_parallel_maintenance_workers = String(clamp(Math.floor(cpus / 4), 1, 4));
  // autovacuum tuned for large, busy tables (incidents, history, journal, jobs)
  s.autovacuum_max_workers = String(cpus >= 8 ? 5 : 3);
  s.autovacuum_naptime = "15s";
  s.autovacuum_vacuum_scale_factor = "0.05";
  s.autovacuum_vacuum_insert_scale_factor = "0.05";
  s.autovacuum_analyze_scale_factor = "0.02";
  s.autovacuum_vacuum_cost_limit = input.disk === "hdd" ? "400" : "2000";
  s.autovacuum_vacuum_cost_delay = "2ms";
  // safety: a transaction left open never holds locks (or an organisation's write lock) for long
  s.idle_in_transaction_session_timeout = "60s";
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
  // statements are logged without their values (people's data never lands in the PostgreSQL log)
  s.log_parameter_max_length = "0";
  s.log_parameter_max_length_on_error = "0";

  if (cpus < 4) notes.push("کمتر از ۴ هستهٔ پردازنده؛ کارهای پس‌زمینه و گزارش‌ها کند خواهند بود");
  if (input.disk === "hdd") notes.push("دیسک چرخان (HDD) برای پایگاه داده کند است؛ SSD یا SAN با تأخیر کم توصیه می‌شود");
  return { settings: s, dbMemMb: ramMb, notes };
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

const MARK = "# Kariz server edition";

/** postgresql.conf with the include lines present exactly once (at the end, so they win over initdb's defaults). */
export function withIncludes(conf: string): string {
  const lines = conf.split(/\r?\n/).filter((l) => !CONF_INCLUDES.includes(l.trim()) && l.trim() !== MARK);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return [...lines, "", MARK, ...CONF_INCLUDES, ""].join("\n");
}
