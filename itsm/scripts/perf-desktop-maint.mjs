// The Windows app's database care, measured the way the app does it (docs/PERFORMANCE_FA.md): a backup and a restore,
// 1.1.4's streaming ones (src/desktop/backup.ts, src/desktop/backup-stream.ts) against 1.1.3's (PGlite's dumpDataDir,
// and loadDataDir of the backup read whole: the folder held in memory both times), and the compaction at the start
// (src/desktop/maintenance.ts) of a copy of what 1.1.0-beta's health loop left behind: hundreds of thousands of
// finished jobs and a CI table rewritten thousands of times.
//
//   node scripts/perf-desktop-maint.mjs backup --dir <scratch folder> [--mb 250,900] [--out report.json] [--keep]
//   node scripts/perf-desktop-maint.mjs compact --dir <scratch folder> [--rounds 14] [--asked] [--out report.json] [--keep]
//
// Every step runs in a fresh Node.js process with tsx as a loader (the app's own modules), so no step's memory carries
// into the next. Each reports its time, the growth of its memory (RSS sampled every 20 ms, against the step's start),
// its largest RSS, and the worst lateness of a 20 ms timer: how long the event loop, which also answers the window, was
// held. «backup» builds a database of about --mb megabytes (each size of the list in turn), backs it up both ways while a
// writer adds a row every 5 ms, and restores each backup into an empty folder; it needs about 2.5 times the size free
// on the disk. «compact» builds --rounds rounds of the loop (14: about 1.15 GB), starts it as the app does (--asked:
// after «فشرده‌سازی» in Settings, which also opens the look for a database too small for the gate), samples pg_wal
// every 100 ms, checks the rows that must stay, and times the start after. A restored copy and a backup file are
// deleted once measured; the database at the end, unless --keep.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MB = 1048576;
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const out = (o) => process.stdout.write(`@@ ${JSON.stringify(o)}\n`);

/** The bytes of a folder's files in megabytes (a file removed while it is walked is skipped). */
function folderMb(dir) {
  let n = 0;
  const walk = (p) => {
    let entries = [];
    try {
      entries = readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const q = join(p, e.name);
      if (e.isDirectory()) walk(q);
      else {
        try {
          n += statSync(q).size;
        } catch {
          // removed meanwhile (a recycled log segment)
        }
      }
    }
  };
  walk(dir);
  return Math.round(n / MB);
}

// What 1.1.0-beta's health loop left: the job queue's table as the migrations make it, a CI table whose rows the loop
// rewrote, and a table of live data that must come through untouched.
const BLOAT_SCHEMA = `
create table sm_kv (key text primary key, value jsonb, updated_at timestamptz not null default now());
create table sm_jobs (id uuid primary key, org_id uuid, kind text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'queued', run_at timestamptz not null default now(), attempts integer not null default 0, max_attempts integer not null default 8, locked_until timestamptz, locked_by text, dedupe_key text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), done_at timestamptz);
create index sm_jobs_due_idx on sm_jobs (run_at) where status = 'queued';
create index sm_jobs_running_idx on sm_jobs (locked_until) where status = 'running';
create index sm_jobs_finished_idx on sm_jobs (done_at) where status in ('done', 'failed');
create index sm_jobs_org_idx on sm_jobs (org_id, created_at desc);
create index sm_jobs_failed_idx on sm_jobs (org_id, done_at) where status = 'failed';
create table sm_cis (id uuid primary key, org_id uuid, name text, health text, health_at timestamptz, attrs jsonb, updated_at timestamptz default now());
create index sm_cis_a on sm_cis (org_id, name);
create index sm_cis_b on sm_cis (health);
create index sm_cis_c on sm_cis (health_at);
create index sm_cis_d on sm_cis (updated_at);
create index sm_cis_e on sm_cis ((attrs->>'k'));
create table t_live (id int primary key, v text);`;
const KEPT = { jobs: 5050, queued: 50, cis: 155, live: 150000 };

// ------------------------------------------------------------------------------------------------- child processes
if (process.argv[2] === "--child") {
  const [step, a, b, c] = process.argv.slice(3);
  const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
  const { createPgliteDb } = await imp("src/server/db/pglite.ts");
  const quiet = { info() {}, warn() {}, error() {} };

  /** The memory and the event loop's holds from now until the returned function is called. */
  const watch = () => {
    globalThis.gc?.();
    const base = process.memoryUsage();
    const w = { rss: base.rss, ab: base.arrayBuffers, late: 0 };
    let last = performance.now();
    const t = setInterval(() => {
      const m = process.memoryUsage();
      w.rss = Math.max(w.rss, m.rss);
      w.ab = Math.max(w.ab, m.arrayBuffers);
      const now = performance.now();
      w.late = Math.max(w.late, now - last - 20);
      last = now;
    }, 20);
    return () => {
      clearInterval(t);
      return {
        rss_before_mb: Math.round(base.rss / MB),
        rss_growth_mb: Math.round((w.rss - base.rss) / MB),
        max_rss_mb: Math.round((process.resourceUsage().maxRSS * 1024) / MB),
        array_buffers_peak_mb: Math.round(w.ab / MB),
        timer_late_max_ms: Math.round(w.late),
      };
    };
  };

  if (step === "data") {
    // a: database folder, b: megabytes. 200,000 rows of about 600 bytes at a time, half random and half repeated, so
    // gzip has about the work it has on real records
    mkdirSync(dirname(a), { recursive: true });
    const db = await createPgliteDb({ dataDir: a, vector: false, wal: false, log: quiet });
    await db.exec(`create table t_data (id bigint primary key, note text, body text); create table t_seq (id int primary key, at timestamptz not null default now())`);
    let rows = 0;
    while (folderMb(a) < Number(b)) {
      await db.exec(`insert into t_data select g, md5(random()::text) || md5(random()::text), repeat(md5((g % 1000)::text), 8) || md5(random()::text) || md5(random()::text) from generate_series(${rows + 1}, ${rows + 200000}) g`);
      rows += 200000;
      await db.exec("checkpoint");
    }
    await db.close();
    out({ step, folder_mb: folderMb(a), rows });
  } else if (step === "backup") {
    // a: database folder, b: backups folder, c: stream (1.1.4) | dump (1.1.3)
    const { backupNow } = await imp("src/desktop/backup.ts");
    const db = await createPgliteDb({ dataDir: a, vector: false, log: quiet });
    const first = Number((await db.one(`select coalesce(max(id), 0)::int as m from t_seq`)).m);
    let id = first;
    let writing = true;
    // a write every 5 ms, as the app makes them while somebody works in it
    const writer = (async () => {
      while (writing) {
        await db.query(`insert into t_seq (id) values ($1)`, [++id]);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    mkdirSync(b, { recursive: true });
    const stop = watch();
    const t0 = performance.now();
    let file;
    if (c === "stream") {
      file = (await backupNow(db, b, "measure")).file;
    } else {
      // exactly 1.1.3's backupNow: a checkpoint, the folder's tar built by PGlite in memory, gzip'd into the file
      await db.checkpoint("backup");
      const tar = await db.pg.dumpDataDir("none");
      file = join(b, `itsm-dump-${Date.now()}.tar.gz`);
      await pipeline(Readable.fromWeb(tar.stream()), createGzip(), createWriteStream(file));
    }
    const ms = performance.now() - t0;
    const mem = stop();
    writing = false;
    await writer;
    const rows = Number((await db.one(`select count(*)::int as n from t_data`)).n);
    await db.close();
    out({ step, way: c, folder_mb: folderMb(a), ms: Math.round(ms), backup_mb: +(statSync(file).size / MB).toFixed(1), rows, rows_written_during: id - first, ...mem, file });
  } else if (step === "restore") {
    // a: backup file, b: a folder that does not exist yet, c: extract (1.1.4) | load (1.1.3)
    const { extractBackup } = await imp("src/desktop/backup-stream.ts");
    const stop = watch();
    const t0 = performance.now();
    let extracted;
    let db;
    if (c === "extract") {
      await extractBackup(a, b);
      extracted = Math.round(performance.now() - t0);
      db = await createPgliteDb({ dataDir: b, vector: false, wal: false, log: quiet });
    } else {
      // exactly 1.1.3's restore: the file read whole, copied into a Blob, unpacked by PGlite's loadDataDir
      const data = readFileSync(a);
      db = await createPgliteDb({ dataDir: b, vector: false, wal: false, log: quiet, loadDataDir: new Blob([new Uint8Array(data)]) });
    }
    const ms = performance.now() - t0;
    const rows = Number((await db.one(`select count(*)::int as n from t_data`)).n);
    const mem = stop();
    await db.close();
    out({ step, way: c, ms: Math.round(ms), extract_ms: extracted, rows, folder_mb: folderMb(b), ...mem });
  } else if (step === "bloat") {
    // a: data folder, b: rounds. Every round of the loop finished 80,000 jobs (half of them cmdb.health_ci) and rewrote
    // each of 155 CIs 40 times, never in place (their indexed columns change)
    const dbDir = join(a, "db");
    mkdirSync(a, { recursive: true });
    const db = await createPgliteDb({ dataDir: dbDir, vector: false, wal: false, log: quiet });
    await db.exec(BLOAT_SCHEMA);
    await db.exec(`insert into t_live select g, md5(g::text) || repeat('l', 300) from generate_series(1, ${KEPT.live}) g`);
    await db.exec(`insert into sm_cis select gen_random_uuid(), null, 'ci-' || g, 'ok', now(), jsonb_build_object('k', g) from generate_series(1, ${KEPT.cis}) g`);
    for (let round = 0; round < Number(b); round++) {
      await db.exec(`insert into sm_jobs (id, kind, payload, status, done_at, created_at) select gen_random_uuid(), case when g % 2 = 0 then 'cmdb.health_ci' else 'record.updated' end, jsonb_build_object('ci', g % 155, 'pad', md5(g::text) || repeat('p', 640)), 'done', now() - interval '10 days', now() - interval '10 days' from generate_series(1, 80000) g`);
      for (let i = 0; i < 40; i++) await db.exec(`update sm_cis set health = case when health = 'ok' then 'warn' else 'ok' end, health_at = now(), updated_at = now()`);
      await db.exec("checkpoint");
    }
    // what must stay: finished a day ago (inside the queue's three days), and still to run
    await db.exec(`insert into sm_jobs (id, kind, status, done_at) select gen_random_uuid(), 'recent', 'done', now() - interval '1 day' from generate_series(1, ${KEPT.jobs - KEPT.queued})`);
    await db.exec(`insert into sm_jobs (id, kind, status) select gen_random_uuid(), 'queued', 'queued' from generate_series(1, ${KEPT.queued})`);
    const tables = await db.query(`select relname as table, round(pg_total_relation_size(oid) / 1048576.0)::int as mb from pg_class where relname in ('sm_jobs', 'sm_cis', 't_live') order by relname`);
    await db.close();
    out({ step, rounds: Number(b), folder_mb: folderMb(dbDir), tables });
  } else if (step === "compact" || step === "gate") {
    // a: data folder, b: "asked" for Settings' request. The start's maintenance as src/desktop/server.ts runs it, after
    // the migrations and before the server listens
    const { startupMaintenance, scheduleCompaction } = await imp("src/desktop/maintenance.ts");
    const dbDir = join(a, "db");
    if (b === "asked") scheduleCompaction(a);
    const lines = [];
    const at = () => new Date().toISOString().slice(11, 23);
    const line = (level) => (m, d) => lines.push(`${at()} ${level}${m}${d === undefined ? "" : ` ${JSON.stringify(d)}`}`);
    const log = { info: line(""), warn: line("WARN "), error: line("ERROR ") };
    const t0 = performance.now();
    const db = await createPgliteDb({ dataDir: dbDir, vector: false, log });
    const open = performance.now() - t0;
    const before = folderMb(dbDir);
    const stop = watch();
    const t1 = performance.now();
    const r = await startupMaintenance(db, { dataDir: a, dbDir, log, notify: () => lines.push(`${at()} (the splash tells the person)`) });
    const ms = performance.now() - t1;
    const mem = stop();
    const rows = await r.db.one(`select (select count(*)::int from sm_jobs) as jobs, (select count(*)::int from sm_jobs where status = 'queued') as queued, (select count(*)::int from sm_cis) as cis, (select count(*)::int from t_live) as live`);
    const tables = await r.db.query(`select relname as table, round(pg_total_relation_size(oid) / 1048576.0, 1)::float8 as mb from pg_class where relname in ('sm_jobs', 'sm_cis', 't_live') order by relname`);
    await r.db.close();
    const { gate, ...report } = r.report;
    out({ step, open_ms: Math.round(open), phase_ms: +ms.toFixed(1), gate_ms: gate?.ms, why: gate?.why, folder_before_mb: before, folder_after_mb: folderMb(dbDir), rows, tables, report, ...mem, lines });
  }
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------- the run
/** One step in a fresh process; its last report, with pg_wal's peak when `wal` names the folder to sample. */
function child(step, args, { wal } = {}) {
  return new Promise((ok, fail) => {
    // node with tsx as a loader in this one process (tsx's own command line forks a second Node.js)
    const p = spawn(process.execPath, ["--expose-gc", "--import", "tsx", fileURLToPath(import.meta.url), "--child", step, ...args.map(String)], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    let last = null;
    let peak = 0;
    const sampler = wal ? setInterval(() => (peak = Math.max(peak, folderMb(wal))), 100) : null;
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const text = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (text.startsWith("@@ ")) last = JSON.parse(text.slice(3));
        else if (text.trim()) process.stdout.write(`  ${text}\n`);
      }
    });
    p.on("exit", (code, sig) => {
      if (sampler) clearInterval(sampler);
      if (code === 0 && last) ok(wal ? { ...last, pg_wal_peak_mb: peak } : last);
      else fail(new Error(`${step} exited ${code ?? sig}`));
    });
  });
}

const what = process.argv[2];
if (what !== "backup" && what !== "compact") {
  console.error("node scripts/perf-desktop-maint.mjs backup|compact --dir <scratch folder> [...]");
  process.exit(2);
}
const dir = resolve(arg("dir", join(ROOT, ".local-data", "perf-maint")));
const report = { started: new Date().toISOString(), what, dir, steps: [] };
const note = (o) => {
  report.steps.push(o);
  const { lines, file, ...rest } = o;
  for (const l of lines ?? []) console.log(`  ${l}`);
  console.log(JSON.stringify(rest));
};
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
try {
  if (what === "backup") {
    for (const mb of String(arg("mb", "250")).split(",").map(Number)) {
      const base = join(dir, `db-${mb}`);
      const dbDir = join(base, "db");
      const built = await child("data", [dbDir, mb]);
      note({ target_mb: mb, ...built });
      for (const [way, back] of [
        ["stream", "extract"],
        ["dump", "load"],
      ]) {
        const b = await child("backup", [dbDir, join(base, "backups"), way]);
        note({ target_mb: mb, ...b });
        const to = join(base, `restored-${way}`);
        const r = await child("restore", [b.file, to, back]);
        note({ target_mb: mb, ...r, rows_kept: r.rows === built.rows });
        rmSync(to, { recursive: true, force: true });
        rmSync(b.file, { force: true });
      }
    }
  } else {
    const data = join(dir, "data");
    note(await child("bloat", [data, Number(arg("rounds", 14))]));
    const c = await child("compact", [data, flag("asked") ? "asked" : ""], { wal: join(data, "db", "pg_wal") });
    note({ ...c, rows_kept: Object.entries(KEPT).every(([k, n]) => c.rows[k] === n) });
    note(await child("gate", [data]));
  }
} finally {
  report.finished = new Date().toISOString();
  const file = arg("out", null);
  if (file) writeFileSync(file, JSON.stringify(report, null, 2));
  if (!flag("keep")) rmSync(dir, { recursive: true, force: true });
}
