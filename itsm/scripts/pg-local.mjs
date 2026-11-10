#!/usr/bin/env node
// A real PostgreSQL for performance work (docs/PERFORMANCE_FA.md): one scriptable local cluster with the settings the
// server edition's auto-tuner derives from the machine (`tune()` below is the formula; PERFORMANCE_FA.md §۵ is its table).
//
//   node scripts/pg-local.mjs init                 create the cluster (initdb) and its tuned settings
//   node scripts/pg-local.mjs start [--fast]       start it (--fast: bulk-load settings — no fsync, minimal WAL, no autovacuum)
//   node scripts/pg-local.mjs stop | restart [--fast] | status | url | settings
//   node scripts/pg-local.mjs psql [-c "sql"]      psql against the database
//   node scripts/pg-local.mjs reset                drop and recreate the database (empty)
//   node scripts/pg-local.mjs destroy              stop and delete the data directory
//
// Options / environment: --dir / ITSM_PG_DIR (default itsm/.pgdata, git-ignored), --port / ITSM_PG_PORT (55432),
// --bin / ITSM_PG_BIN (PostgreSQL's bin directory: auto-detected from /usr/lib/postgresql/<17|16>/bin, `pg_config`
// or the `embedded-postgres` npm package), --ram GB and --cpus N (what the tuning assumes; default: this machine,
// at most 6 GB here because the container is shared), --profile server (tune for --ram/--cpus as given).
// Run as root, the server runs as the `postgres` OS user (initdb refuses root).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, chownSync, statSync } from "node:fs";
import { cpus as osCpus, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * PostgreSQL settings for a machine (the server edition's auto-tuner follows this formula; see PERFORMANCE_FA.md).
 * `workers` Node processes × `pool` connections each, plus the job runner and maintenance, size max_connections.
 * Windows has no `effective_io_concurrency` (posix_fadvise) and needs a privilege for huge pages.
 */
export function tune({ ramGb, cpus, os = process.platform, storage = "nvme", workers, pool } = {}) {
  const ram = Math.max(1, ramGb) * 1024; // MB
  const w = workers ?? recommendedWorkers(cpus);
  const p = pool ?? recommendedPool(cpus);
  const maxConnections = Math.max(50, w * p + 30);
  const sharedBuffers = Math.min(Math.round(ram * 0.25), 16 * 1024);
  const effectiveCache = Math.round(ram * 0.7);
  // a sort or hash node may take work_mem; a busy OLTP query has a few — keep the worst case well inside RAM
  const workMem = Math.max(8, Math.min(64, Math.floor((ram - sharedBuffers) / (maxConnections * 4))));
  const maintenance = Math.min(2048, Math.max(256, Math.round(ram / 16)));
  const mb = (n) => `${n}MB`;
  const s = {
    max_connections: maxConnections,
    // the first migration creates ~400 tables and ~3 500 indexes in one transaction (one lock each)
    max_locks_per_transaction: 256,
    shared_buffers: mb(sharedBuffers),
    effective_cache_size: mb(effectiveCache),
    work_mem: mb(workMem),
    maintenance_work_mem: mb(maintenance),
    autovacuum_work_mem: mb(Math.min(1024, maintenance)),
    huge_pages: os === "win32" ? "off" : "try",
    wal_buffers: "64MB",
    min_wal_size: "1GB",
    max_wal_size: ram >= 32 * 1024 ? "8GB" : "4GB",
    checkpoint_timeout: "15min",
    checkpoint_completion_target: 0.9,
    wal_compression: "on",
    random_page_cost: storage === "hdd" ? 4 : 1.1,
    effective_io_concurrency: os === "win32" ? 0 : storage === "hdd" ? 2 : 200,
    max_worker_processes: Math.max(8, cpus),
    max_parallel_workers: Math.max(2, Math.floor(cpus / 2)),
    max_parallel_workers_per_gather: cpus >= 8 ? 2 : 1,
    max_parallel_maintenance_workers: Math.min(4, Math.max(1, Math.floor(cpus / 4))),
    // short OLTP queries: compiling them costs more than it saves
    jit: "off",
    default_statistics_target: 200,
    autovacuum_max_workers: cpus >= 8 ? 5 : 3,
    autovacuum_naptime: "15s",
    autovacuum_vacuum_cost_limit: 2000,
    autovacuum_vacuum_scale_factor: 0.05,
    autovacuum_vacuum_insert_scale_factor: 0.05,
    autovacuum_analyze_scale_factor: 0.02,
    idle_in_transaction_session_timeout: "60s",
    shared_preload_libraries: "pg_stat_statements",
    "pg_stat_statements.max": 5000,
    "pg_stat_statements.track": "top",
    track_io_timing: "on",
    log_min_duration_statement: "1000ms",
  };
  return { settings: s, workers: w, pool: p };
}

/** Node API processes for a machine: half the vCPUs (PostgreSQL gets the rest), at least 2, at most 12. */
export function recommendedWorkers(cpus) {
  return Math.max(2, Math.min(12, Math.floor(cpus / 2)));
}

/** postgres.js connections per Node process: a request holds one for a few milliseconds; 10 keeps p99 low. */
export function recommendedPool(cpus) {
  return cpus >= 8 ? 10 : 8;
}

/** Bulk-load settings (seeding only — never for measurements or production). */
const FAST = {
  fsync: "off",
  synchronous_commit: "off",
  full_page_writes: "off",
  wal_level: "minimal",
  max_wal_senders: 0,
  archive_mode: "off",
  autovacuum: "off",
  checkpoint_timeout: "30min",
  // the data directory has a disk budget: recycle WAL early
  max_wal_size: "1GB",
  min_wal_size: "256MB",
};

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--") && !["fast"].includes(k)) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function findBin(explicit) {
  const tries = [];
  if (explicit) tries.push(explicit);
  for (const v of ["17", "16"]) tries.push(`/usr/lib/postgresql/${v}/bin`);
  try {
    tries.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim());
  } catch {
    // no pg_config on PATH
  }
  for (const pkg of ["@embedded-postgres/linux-x64", "@embedded-postgres/windows-x64", "@embedded-postgres/darwin-arm64"]) tries.push(join(ROOT, "node_modules", pkg, "native", "bin"));
  const exe = process.platform === "win32" ? ".exe" : "";
  const bin = tries.find((d) => d && existsSync(join(d, `postgres${exe}`)) && existsSync(join(d, `initdb${exe}`)));
  if (!bin) throw new Error(`PostgreSQL binaries not found (tried ${tries.join(", ")}); set ITSM_PG_BIN or install postgresql-16 / the embedded-postgres package`);
  return bin;
}

const opts = args(process.argv.slice(2));
const DIR = resolve(opts.dir ?? process.env.ITSM_PG_DIR ?? join(ROOT, ".pgdata"));
const DATA = join(DIR, "data");
const LOG = join(DIR, "postgres.log");
const PORT = Number(opts.port ?? process.env.ITSM_PG_PORT ?? 55432);
const DB = "itsm";
const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
const OS_USER = process.env.ITSM_PG_USER ?? "postgres";

export const url = (port = PORT) => `postgres://postgres@127.0.0.1:${port}/${DB}`;

function run(bin, file, argv, { quiet = false, check = true } = {}) {
  const exe = join(bin, file);
  const cmd = asRoot ? "runuser" : exe;
  const full = asRoot ? ["-u", OS_USER, "--", exe, ...argv] : argv;
  const r = spawnSync(cmd, full, { encoding: "utf8", stdio: quiet ? "pipe" : "inherit", cwd: "/" });
  if (check && r.status !== 0) throw new Error(`${file} ${argv.join(" ")} failed (${r.status}): ${r.stderr ?? ""}`);
  return r;
}

function own(path) {
  if (!asRoot) return;
  const r = spawnSync("id", ["-u", OS_USER], { encoding: "utf8" });
  const g = spawnSync("id", ["-g", OS_USER], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`OS user "${OS_USER}" not found (set ITSM_PG_USER)`);
  chownSync(path, Number(r.stdout.trim()), Number(g.stdout.trim()));
}

function machine() {
  const cpus = Number(opts.cpus ?? osCpus().length);
  const ram = Number(opts.ram ?? Math.min(6, Math.floor(totalmem() / 1024 ** 3 / 2)));
  return { cpus, ram };
}

function writeConf(fast) {
  const { cpus, ram } = machine();
  const { settings } = tune({ ramGb: ram, cpus, os: "linux" });
  const lines = [
    `# written by scripts/pg-local.mjs — tune({ ramGb: ${ram}, cpus: ${cpus} }) (PERFORMANCE_FA.md)`,
    `listen_addresses = '127.0.0.1'`,
    `port = ${PORT}`,
    `unix_socket_directories = ''`,
    ...Object.entries(settings).map(([k, v]) => `${k} = ${typeof v === "number" ? v : `'${v}'`}`),
  ];
  writeFileSync(join(DATA, "itsm.conf"), `${lines.join("\n")}\n`);
  const fastFile = join(DATA, "itsm-fast.conf");
  if (fast) writeFileSync(fastFile, `# bulk load only (pg-local.mjs --fast)\n${Object.entries(FAST).map(([k, v]) => `${k} = ${typeof v === "number" ? v : `'${v}'`}`).join("\n")}\n`);
  else rmSync(fastFile, { force: true });
  for (const f of ["itsm.conf", "itsm-fast.conf"]) if (existsSync(join(DATA, f))) own(join(DATA, f));
  const main = join(DATA, "postgresql.conf");
  const text = readFileSync(main, "utf8");
  if (!text.includes("include_if_exists = 'itsm.conf'")) {
    writeFileSync(main, `${text}\ninclude_if_exists = 'itsm.conf'\ninclude_if_exists = 'itsm-fast.conf'\n`);
  }
}

function running(bin) {
  if (!existsSync(join(DATA, "PG_VERSION"))) return false;
  return run(bin, "pg_ctl", ["-D", DATA, "status"], { quiet: true, check: false }).status === 0;
}

function psql(bin, sql, { db = DB, quiet = true } = {}) {
  const r = run(bin, "psql", ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { quiet });
  return (r.stdout ?? "").trim();
}

function init(bin) {
  if (existsSync(join(DATA, "PG_VERSION"))) {
    console.log(`cluster exists: ${DATA}`);
    return;
  }
  mkdirSync(DATA, { recursive: true });
  own(DIR);
  own(DATA);
  run(bin, "initdb", ["-D", DATA, "-U", "postgres", "-E", "UTF8", "--locale=C.UTF-8", "--auth=trust"], { quiet: true });
  writeConf(false);
  console.log(`initialised ${DATA}`);
}

function start(bin, fast) {
  if (!existsSync(join(DATA, "PG_VERSION"))) init(bin);
  if (running(bin)) {
    console.log("already running");
    return;
  }
  writeConf(fast);
  if (!existsSync(LOG)) writeFileSync(LOG, "");
  own(LOG);
  run(bin, "pg_ctl", ["-D", DATA, "-l", LOG, "-w", "-t", "120", "start"], { quiet: true });
  if (!psql(bin, `select 1 from pg_database where datname = '${DB}'`, { db: "postgres" })) psql(bin, `create database ${DB}`, { db: "postgres" });
  psql(bin, "create extension if not exists pg_stat_statements; create extension if not exists pg_trgm;");
  console.log(`started${fast ? " (bulk-load settings)" : ""}: ${url()}`);
}

function stop(bin) {
  if (!running(bin)) {
    console.log("not running");
    return;
  }
  run(bin, "pg_ctl", ["-D", DATA, "-m", "fast", "-w", "stop"], { quiet: true });
  console.log("stopped");
}

function sizeOf(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else n += statSync(p).size;
    }
  };
  if (existsSync(dir)) walk(dir);
  return n;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = opts._[0] ?? "status";
  const bin = findBin(opts.bin ?? process.env.ITSM_PG_BIN);
  switch (cmd) {
    case "init":
      init(bin);
      break;
    case "start":
      start(bin, !!opts.fast);
      break;
    case "stop":
      stop(bin);
      break;
    case "restart":
      stop(bin);
      start(bin, !!opts.fast);
      break;
    case "status": {
      const up = running(bin);
      console.log(`${up ? "running" : "stopped"} · ${DATA} · ${(sizeOf(DATA) / 1024 ** 3).toFixed(2)} GB · ${url()}`);
      if (up) console.log(psql(bin, "select version()"));
      break;
    }
    case "url":
      console.log(url());
      break;
    case "settings": {
      const { cpus, ram } = machine();
      console.log(JSON.stringify(tune({ ramGb: ram, cpus }), null, 2));
      break;
    }
    case "psql": {
      const sql = opts.c ?? opts._.slice(1).filter((x) => x !== "-c").join(" ");
      if (sql) console.log(psql(bin, sql, { db: opts.db ?? DB }));
      else run(bin, "psql", ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", DB]);
      break;
    }
    case "reset":
      // an empty database (the seed and the server migrate it again)
      psql(bin, `drop database if exists ${DB} with (force)`, { db: "postgres" });
      psql(bin, `create database ${DB}`, { db: "postgres" });
      psql(bin, "create extension if not exists pg_stat_statements; create extension if not exists pg_trgm;");
      console.log(`database ${DB} recreated`);
      break;
    case "destroy":
      stop(bin);
      rmSync(DIR, { recursive: true, force: true });
      console.log(`deleted ${DIR}`);
      break;
    default:
      console.error(`unknown command "${cmd}"`);
      process.exit(2);
  }
}
