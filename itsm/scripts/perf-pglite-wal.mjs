// The write-ahead log of the Windows app's database (PGlite data folder), measured the way the app opens it
// (docs/PERFORMANCE_FA.md §14): pg_wal during the bank demo pack «کوچک» and an hour of simulated work, start-up after a
// forced quit (crash recovery) and after a clean close, and a backup (size, time, peak memory).
//
//   node scripts/perf-pglite-wal.mjs --dir <scratch folder> [--rounds 40] [--cap-mb 600] [--size small] [--out report.json]
//
// Three child processes (Node.js with tsx, the app's own modules): «session» creates the data folder (src/desktop/server.ts opens it
// the same way: createPgliteDb + migrate + the shared API), signs up, makes an organisation, loads the demo pack with the
// job queue (back to back, as the app's 10-second timer does), works through --rounds rounds of record writes and jobs,
// takes a backup (src/desktop/backup.ts) and then waits to be killed; «recover» times the start-up after that kill and
// closes cleanly; «reopen» times a start-up after the clean close. A run stops writing once pg_wal reaches --cap-mb
// (the measurement reproduces the very growth it measures). The folder is deleted at the end unless --keep.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const MB = 1048576;
const SEGMENT = /^[0-9A-F]{24}$/;

/** pg_wal: segments and megabytes. */
function walSize(db) {
  const walDir = join(db, "pg_wal");
  const segs = existsSync(walDir) ? readdirSync(walDir).filter((f) => SEGMENT.test(f)) : [];
  const wal = segs.reduce((n, f) => n + statSync(join(walDir, f)).size, 0);
  return { wal_segments: segs.length, wal_mb: +(wal / MB).toFixed(1) };
}

/** pg_wal, base/ (the data itself) and the whole folder. */
function sizes(db) {
  const du = (p) => {
    if (!existsSync(p)) return 0;
    const st = statSync(p);
    if (!st.isDirectory()) return st.size;
    return readdirSync(p).reduce((n, f) => n + du(join(p, f)), 0);
  };
  return { ...walSize(db), base_mb: +(du(join(db, "base")) / MB).toFixed(1), total_mb: +(du(db) / MB).toFixed(1) };
}

const out = (o) => process.stdout.write(`@@ ${JSON.stringify(o)}\n`);

// ------------------------------------------------------------------------------------------------- child processes
if (process.argv[2] === "--child") {
  const phase = process.argv[3];
  const dataDir = process.argv[4];
  const dbDir = join(dataDir, "db");
  const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
  const { createPgliteDb } = await imp("src/server/db/pglite.ts");
  const { migrate } = await imp("src/server/db/migrate.ts");
  const checkpoints = [];
  const log = {
    info: (m, d) => {
      if (/checkpoint/i.test(String(m))) checkpoints.push({ m: String(m), d });
    },
    warn: (m, d) => process.stderr.write(`warn ${m} ${d ? JSON.stringify(d) : ""}\n`),
    error: (m, d) => process.stderr.write(`error ${m} ${d ? JSON.stringify(d) : ""}\n`),
  };
  const t0 = performance.now();
  const db = await createPgliteDb({ dataDir: dbDir, desktop: true, log });
  const opened = performance.now() - t0;
  await migrate(db);
  const ready = performance.now() - t0;
  const lsn = async () => Number((await db.one(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), '0/0')::bigint as n`)).n);
  const walSince = async () => Number((await db.one(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), (pg_control_checkpoint()).redo_lsn)::bigint as n`)).n);

  if (phase === "recover" || phase === "reopen") {
    out({ phase, open_ms: Math.round(opened), ready_ms: Math.round(ready), ...sizes(dbDir) });
    const t = performance.now();
    await db.close();
    out({ phase: `${phase}-close`, close_ms: Math.round(performance.now() - t), ...sizes(dbDir) });
    process.exit(0);
  }

  // phase «session»
  const cap = Number(process.argv[5] ?? 600);
  const rounds = Number(process.argv[6] ?? 40);
  const size = process.argv[7] ?? "small";
  const { createApp } = await imp("src/server/app.ts");
  const { tick } = await imp("src/server/jobs/index.ts");
  const { backupNow } = await imp("src/desktop/backup.ts");
  const cfg = {
    mode: "desktop",
    db,
    secret: "perf-pglite-wal",
    allowSignup: false,
    platformAdmins: [],
    origin: "00000000-0000-7000-8000-000000000001",
    log: { info() {}, warn() {}, error: (m, d) => process.stderr.write(`app error ${m} ${d ? JSON.stringify(d) : ""}\n`) },
    fetch: globalThis.fetch.bind(globalThis),
  };
  const app = createApp(cfg);
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await app.fetch(new Request(`http://127.0.0.1/api${path}`, { method, headers: { "content-type": "application/json", host: "127.0.0.1", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  out({ phase: "open-fresh", open_ms: Math.round(opened), ready_ms: Math.round(ready), wal_written_mb: +((await lsn()) / MB).toFixed(1), ...sizes(dbDir) });

  await call("POST", "/auth/signup", { email: "owner@wal.example", password: "Wal-Perf-Pass-1405!", full_name: "مالک سنجش" });
  const org = (await call("POST", "/orgs", { name: "سازمان سنجش پایگاه داده" })).id;
  const segmentPeak = { wal_mb: 0, wal_segments: 0 };
  const watch = () => {
    const s = walSize(dbDir);
    if (s.wal_mb > segmentPeak.wal_mb) Object.assign(segmentPeak, s);
    return s;
  };
  const capped = () => watch().wal_mb >= cap;
  // the app's job timer: a tick with an 8-second budget every 10 seconds (here back to back)
  const jobs = async () => {
    const r = await tick(cfg, { budgetMs: 8000 });
    watch();
    return r;
  };

  // the demo pack, loaded the way «داده‌های نمایشی ← بارگذاری» does: the job demo.load and what it causes
  let w0 = await lsn();
  let t = performance.now();
  await call("POST", `/o/${org}/demo/load`, { size });
  let stopped = false;
  for (;;) {
    await jobs();
    const st = await call("GET", `/o/${org}/demo`);
    if (st.state !== "loading") break;
    if (capped()) {
      stopped = true;
      break;
    }
  }
  // what the load caused (notifications, SLA timers, indexing), as the timer would run it in the next minutes
  for (let i = 0; i < 30 && !stopped; i++) {
    const r = await jobs();
    if (!r.ran && !r.more) break;
    if (capped()) stopped = true;
  }
  const demoState = (await call("GET", `/o/${org}/demo`)).state;
  out({ phase: "demo-load", size, state: demoState, capped: stopped, seconds: +((performance.now() - t) / 1000).toFixed(1), wal_written_mb: +(((await lsn()) - w0) / MB).toFixed(1), wal_since_checkpoint_mb: +((await walSince()) / MB).toFixed(1), peak_wal_mb: segmentPeak.wal_mb, peak_wal_segments: segmentPeak.wal_segments, checkpoints: checkpoints.length, ...sizes(dbDir) });

  // an hour of work on this computer, time-compressed: per round three new incidents, two updates, a reply and a work
  // note, and one tick of the job queue (the app runs one every 10 s: 360 an hour)
  w0 = await lsn();
  t = performance.now();
  const ck0 = checkpoints.length;
  let made = [];
  let done = 0;
  for (let i = 0; i < rounds && !stopped; i++) {
    for (let k = 0; k < 3; k++) made.push((await call("POST", `/o/${org}/r/incident`, { short_description: `کندی سامانهٔ شعبه ${i}-${k}`, description: "کاربران شعبه از کندی سامانه گزارش داده‌اند. ".repeat(8) })).row.id);
    for (const id of made.slice(-6, -4)) await call("PATCH", `/o/${org}/r/incident/${id}`, { priority: "2" }).catch(() => {});
    const last = made.at(-1);
    await call("POST", `/o/${org}/r/incident/${last}/journal`, { kind: "comment", body: "در حال بررسی هستیم؛ نتیجه را خبر می‌دهیم." });
    await call("POST", `/o/${org}/r/incident/${last}/journal`, { kind: "work_note", body: "لاگ سرور شعبه بررسی شد." });
    for (let j = 0; j < 6; j++) await jobs();
    done++;
    if (capped()) stopped = true;
  }
  out({ phase: "busy-hour", rounds: done, capped: stopped, seconds: +((performance.now() - t) / 1000).toFixed(1), wal_written_mb: +(((await lsn()) - w0) / MB).toFixed(1), wal_since_checkpoint_mb: +((await walSince()) / MB).toFixed(1), peak_wal_mb: segmentPeak.wal_mb, peak_wal_segments: segmentPeak.wal_segments, checkpoints: checkpoints.length - ck0, ...sizes(dbDir) });

  // a backup, as «پشتیبان‌گیری» and the 6-hourly timer take it (peak memory sampled every 20 ms)
  const backups = join(dataDir, "backups");
  mkdirSync(backups, { recursive: true });
  const rss0 = process.memoryUsage().rss;
  let peak = rss0;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
  t = performance.now();
  // the bounded version takes the database (it checkpoints first), the earlier one PGlite itself
  const b = await backupNow(typeof db.checkpoint === "function" ? db : db.pg, backups, "perf");
  const ms = performance.now() - t;
  clearInterval(sampler);
  peak = Math.max(peak, process.memoryUsage().rss);
  out({ phase: "backup", ms: Math.round(ms), size_mb: +(b.size / MB).toFixed(1), rss_before_mb: Math.round(rss0 / MB), rss_peak_mb: Math.round(peak / MB), rss_increase_mb: Math.round((peak - rss0) / MB), ...sizes(dbDir) });
  rmSync(b.file, { force: true });

  // one more round after the backup, then wait to be killed (a forced quit, a crash, a power cut of the process)
  for (let k = 0; k < 3; k++) await call("POST", `/o/${org}/r/incident`, { short_description: `پس از پشتیبان ${k}` });
  out({ phase: "before-kill", wal_since_checkpoint_mb: +((await walSince()) / MB).toFixed(1), checkpoints_total: checkpoints.length, checkpoint_log: checkpoints.slice(-12), ...sizes(dbDir) });
  process.stdout.write("@@ready-to-kill\n");
  await new Promise(() => {});
}

// ------------------------------------------------------------------------------------------------- orchestrator
const dir = resolve(arg("dir", join(ROOT, ".local-data", "perf-wal")));
const cap = Number(arg("cap-mb", 600));
const rounds = Number(arg("rounds", 40));
const size = String(arg("size", "small"));
const report = { started: new Date().toISOString(), dir, cap_mb: cap, rounds, size, variant: existsSync(join(ROOT, "src/server/db/wal.ts")) ? "bounded" : "unbounded", phases: [] };
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

function child(phase, extra = [], { killOn } = {}) {
  return new Promise((ok, fail) => {
    // node with tsx as a loader in this one process (tsx's own command line forks a second Node.js, which a SIGKILL
    // of the first would leave running)
    const p = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--child", phase, dir, ...extra], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith("@@ ")) {
          const o = JSON.parse(line.slice(3));
          report.phases.push(o);
          console.log(JSON.stringify(o));
        } else if (killOn && line.startsWith(killOn)) {
          // SIGKILL: no clean close, no shutdown checkpoint (what Task Manager, a crash or a power cut does)
          p.kill("SIGKILL");
        }
      }
    });
    p.stderr.on("data", (d) => process.stderr.write(d));
    p.on("exit", (code, sig) => (code === 0 || sig === "SIGKILL" ? ok() : fail(new Error(`${phase} exited ${code ?? sig}`))));
  });
}

try {
  await child("session", [String(cap), String(rounds), size], { killOn: "@@ready-to-kill" });
  report.phases.push({ phase: "killed", ...sizes(join(dir, "db")) });
  console.log(JSON.stringify(report.phases.at(-1)));
  await child("recover");
  await child("reopen");
} finally {
  report.finished = new Date().toISOString();
  const file = arg("out", null);
  if (file) writeFileSync(file, JSON.stringify(report, null, 2));
  if (!flag("keep")) rmSync(dir, { recursive: true, force: true });
}
