// The owner's path of release 1.1.5, clicked through the real screens (the «کسی پیدا نشد» report): on a fresh database the
// owner loads the bank demo pack from «داده‌های نمایشی», builds library fields («فیلدها»), a process form with two tabs
// («فرم‌ها»), two organisational roles with two holders each («نقش‌های سازمانی») and a workflow in the designer
// (start form → «مرحلهٔ فرم» by «مدیر گروه» with the designer's default scope → an approval by «کارشناس ارشد» → end),
// publishes it, and the people run it from «گردش‌کارها» — twice:
//   A  the owner's exact case: the holders are the demo pack's people and the requester a demo persona (the pack's
//      shared sign-in, read from the demo page);
//   B  the same with real members the owner adds on «کاربران و دسترسی‌ها»;
//   C  the owner (a real person) starts A's workflow: the case page shows the waiting panel with its reason, the owner
//      adds a real holder to «مدیر گروه», «دوباره پیدا کردن انجام‌دهنده» gives the step to that holder, who completes it.
// Then «حذف کامل داده‌های نمایشی» (the preview's lists, the typed confirmation, the progress) and the checks after it:
// B's workflow and finished case intact, A's workflow per the 1.1.5 rule, every workflow, form, field, roles, members
// and demo page without a console error, a 4xx/5xx other than a 403 or a crash screen, and B started and finished again.
// Everything is done through the screens; the HTTP API is only read (with the person's own session) to assert state.
//
// How to run (from itsm/, after `npm run build:ui` — the script serves public/ and never builds):
//   node scripts/e2e-owner-path.mjs --edition desktop --out /tmp/e2e/desktop
//        the Windows flavour: the local server (src/desktop/server.ts through scripts/ui-shots.mjs --serve-internal)
//        on a fresh PGlite data folder
//   node scripts/e2e-owner-path.mjs --edition server --out /tmp/e2e/server [--pg-dir /home/user/pgtmp-e2e]
//        [--pg-port 55550] [--pg-bin /usr/lib/postgresql/16/bin] [--pg-user nobody]
//        the server edition (src/server-edition: karizctl init/db-init/pg-start/db-bootstrap/migrate, then main.ts
//        --standalone over HTTPS with its generated certificate) on a throwaway PostgreSQL cluster owned by --pg-user,
//        first-run setup through /setup?token=… (karizctl setup-token); the cluster is stopped and deleted at the end
//   node scripts/e2e-owner-path.mjs --edition web --out /tmp/e2e/web [--pg-dir …] [--pg-port …] [--rebuild]
//        the web version: `next build` (once; --rebuild builds again) and `next start` with DATABASE_URL through the
//        Supavisor emulator (tests/web-db-pooler.ts) in front of a throwaway PostgreSQL cluster (initdb as --pg-user,
//        schema by scripts/migrate-db.mts); jobs run from the app's own traffic and GET /api/cron/tick once a minute
//        (Supabase pg_cron's heartbeat); the owner signs up on /signup and makes the organisation on /orgs/new
// Options: --port N (default 4471 desktop / 4472 server / 4473 web), --keep (leave the server and data), --size small|medium,
//          --base URL (a server already running: setup and data are whatever it has; for re-runs of the later steps),
//          --from <step> / --until <step> (with --base and the state file of an earlier run in --out).
// Output in --out: NN-*.png (deviceScaleFactor 2, 1440 wide), REPORT.md (step, edition, pass/fail, what was seen,
// findings with evidence), summary.json, server.log. Exit 1 when a step failed or a product finding was recorded.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, readdirSync, statSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import net from "node:net";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const require = createRequire(join(ROOT, "package.json"));

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const EDITION = opt("edition", "desktop");
if (!["desktop", "server", "web"].includes(EDITION)) throw new Error(`--edition desktop|server|web (got ${EDITION})`);
const OUT = resolve(opt("out", join(tmpdir(), "e2e-owner-path", EDITION)));
const PORT = Number(opt("port", { desktop: "4471", server: "4472", web: "4473" }[EDITION]));
const SIZE = opt("size", "small");
const KEEP = flag("keep");
const BASE_GIVEN = opt("base") ? opt("base").replace(/\/+$/, "") : null;
const PG = { dir: resolve(opt("pg-dir", "/home/user/pgtmp-e2e")), port: Number(opt("pg-port", "55550")), bin: opt("pg-bin", "/usr/lib/postgresql/16/bin"), user: opt("pg-user", "nobody") };
const STATIC = resolve(ROOT, opt("static", "public"));
const FROM = opt("from");
const UNTIL = opt("until");
/** how long one UI wait may take (the Windows flavour runs every job on the request's one database connection) */
const T = Number(opt("timeout", "90000"));

const OWNER = { name: "سارا محمدی", email: "owner@example.com", password: "Owner-pass-1405" };
const ORG_NAME = "بانک آزمون مسیر مالک";
const MEMBER_PASSWORD = "Member-pass-1405";
/** the real members variant B and C use (added on «کاربران و دسترسی‌ها») */
const MEMBERS = {
  req: { name: "مینا درخواستی", email: "mina.requester@example.com", preset: "درخواست‌دهنده" },
  head1: { name: "علی مدیرزاده", email: "ali.head@example.com", preset: "کارشناس پشتیبانی" },
  head2: { name: "زهرا مدیرپور", email: "zahra.head@example.com", preset: "کارشناس پشتیبانی" },
  senior1: { name: "حسن ارشدیان", email: "hasan.senior@example.com", preset: "کارشناس پشتیبانی" },
  senior2: { name: "لیلا کارشناس‌نیا", email: "leila.senior@example.com", preset: "کارشناس پشتیبانی" },
  extra: { name: "رضا دارنده", email: "reza.holder@example.com", preset: "کارشناس پشتیبانی" },
};
/** the demo personas variant A uses (their labels in the demo page's «حساب‌های نمایش» table) */
const PERSONAS = { req: "درخواست‌دهنده", head1: "کارشناس", head2: "مدیر", senior1: "مدیر تغییر", senior2: "مدیر دارایی" };

const FIELD_TYPES = { title: "متن کوتاه", kind: "فهرست کشویی", due: "تاریخ", unit: "واحد سازمانی", desc: "متن چندخطی", note: "متن چندخطی" };
/** the two variants' definitions; A carries the owner's names («مدیر گروه»، «کارشناس ارشد») */
const VARIANTS = {
  A: {
    tag: "الف", prefix: "a",
    fields: { title: "عنوان پروژه", kind: "نوع درخواست", due: "تاریخ تحویل", unit: "واحد مجری", desc: "شرح درخواست", note: "نظر مدیر گروه" },
    form: "فرم درخواست پروژه",
    roles: { head: { name: "مدیر گروه", key: "group_head" }, senior: { name: "کارشناس ارشد", key: "senior_expert" } },
    wf: { name: "گردش کار پروژه", key: "project_wf" },
  },
  B: {
    tag: "ب", prefix: "b",
    fields: { title: "عنوان پروژه (ب)", kind: "نوع درخواست (ب)", due: "تاریخ تحویل (ب)", unit: "واحد مجری (ب)", desc: "شرح درخواست (ب)", note: "نظر مدیر گروه (ب)" },
    form: "فرم درخواست پروژه (ب)",
    roles: { head: { name: "مدیر گروه (ب)", key: "group_head_b" }, senior: { name: "کارشناس ارشد (ب)", key: "senior_expert_b" } },
    wf: { name: "گردش کار پروژه (ب)", key: "project_wf_b" },
  },
};
const KIND_OPTIONS = [["hw", "سخت‌افزار"], ["sw", "نرم‌افزار"], ["access", "دسترسی"]];
const STEP2 = "مرحلهٔ فرم";
const STEP3 = "تأیید کارشناس ارشد";
const NOBODY = /کسی پیدا نشد/;

const t0 = Date.now();
const log = (...a) => console.log(`[e2e ${EDITION} ${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- report
const R = { edition: EDITION, started: new Date(t0).toISOString(), out: OUT, base: null, org: null, steps: [], findings: [], limits: [], notes: [] };
let cur = null;
let shotNo = 0;
const statePath = () => join(OUT, "state.json");
/** what later steps (and a re-run with --from) need */
let S = {};
const saveState = () => writeFileSync(statePath(), JSON.stringify(S, null, 2));

function check(ok, what, detail = "") {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  cur?.checks.push({ ok: !!ok, what, detail: d.slice(0, 600) });
  log(`${ok ? "  ok  " : "  FAIL"} ${what}${!ok && d ? ` — ${d.slice(0, 300)}` : ""}`);
  return !!ok;
}
const seen = (s) => {
  cur?.seen.push(String(s).replace(/\s+/g, " ").trim().slice(0, 300));
};

/**
 * A product finding: what was expected and seen, the screenshot, the server log lines of the step and where in the
 * code it comes from when known. `known` names an issue the fix agents already own (NB1–NB4).
 */
function finding(f) {
  const lines = serverLogSince(cur?.logFrom ?? 0).filter((l) => /error|warn|fail|exception|refus|\b5\d\d\b/i.test(l)).slice(-12);
  const entry = { title: f.title, edition: EDITION, step: cur?.id ?? "", expected: f.expected, seen: f.seen, evidence: [f.shot ? `screenshot ${f.shot}` : null, f.evidence, lines.length ? `server log:\n${lines.join("\n")}` : null].filter(Boolean).join("\n"), where: f.where ?? "", known: f.known ?? "" };
  R.findings.push(entry);
  log(`  FINDING ${f.title}`);
  return entry;
}

/** --from: the steps before it are skipped (their state comes from state.json); --until: nothing after it runs */
let running = !FROM;
let passedUntil = false;
async function step(id, title, fn) {
  if (!running && id === FROM) running = true;
  if (!running || passedUntil) return true;
  const s ={ id, title, edition: EDITION, ok: false, seen: [], checks: [], issues: [], shots: [], seconds: 0, logFrom: serverLogSize() };
  R.steps.push(s);
  cur = s;
  const started = Date.now();
  log(`— ${id}: ${title}`);
  try {
    await fn(s);
    s.ok = s.checks.every((c) => c.ok);
  } catch (e) {
    s.ok = false;
    s.error = String(e?.stack ?? e).split("\n").slice(0, 6).join("\n");
    log(`  ERROR ${s.error.split("\n")[0]}`);
    for (const p of Object.values(PEOPLE)) {
      if (p.page && !p.page.isClosed()) await p.shot(`${id}-error-${p.key}`).catch(() => {});
    }
  }
  // what the browser saw meanwhile: console errors, uncaught exceptions, failed API calls (a 403 is listed apart)
  for (const p of Object.values(PEOPLE)) {
    const got = p.probe?.take();
    if (!got) continue;
    for (const x of got.exceptions) s.issues.push(`${p.key}: uncaught ${x.split("\n")[0].slice(0, 200)}`);
    for (const x of got.console) s.issues.push(`${p.key}: console ${x.slice(0, 200)}`);
    for (const x of got.failed) s.issues.push(`${p.key}: ${x}`);
    for (const x of got.forbidden) s.issues.push(`${p.key}: (403) ${x}`);
    for (const x of got.reauth) s.seen.push(`${p.key}: the server asked «تأیید دوبارهٔ هویت» (${x}); answered with the password`);
  }
  s.seconds = Math.round((Date.now() - started) / 1000);
  log(`${s.ok ? "PASS" : "FAIL"} ${id} (${s.seconds} s)${s.issues.length ? `; ${s.issues.length} browser issue(s)` : ""}`);
  saveState();
  if (UNTIL && id === UNTIL) passedUntil = true;
  cur = null;
  return s.ok;
}

// ---------------------------------------------------------------- server
let server = null;
/** the server's output goes straight to OUT/server.log (a kept server outlives this script) */
const LOG = () => join(OUT, "server.log");
const serverLogSize = () => (existsSync(LOG()) ? statSync(LOG()).size : 0);
function serverLogSince(n) {
  if (!existsSync(LOG())) return [];
  const buf = readFileSync(LOG());
  return buf.subarray(Math.min(n, buf.length)).toString("utf8").split(/\r?\n/).filter((l) => l.trim());
}
/** every long-lived process this script started (stopped in reverse order at the end unless --keep) */
const procs = [];
/** Starts a long-lived process with its output in server.log; resolves when `ready` matches a new line of the log. */
function startLogged(cmd, args, env, ready, what, { ms = 240_000 } = {}) {
  const from = serverLogSize();
  const fd = openSync(LOG(), "a");
  const proc = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], detached: KEEP });
  closeSync(fd);
  if (KEEP) proc.unref();
  proc.what = what;
  procs.push(proc);
  server = proc;
  return new Promise((ok, fail) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const lines = serverLogSince(from).join("\n");
      const m = lines.match(ready);
      if (m) {
        clearInterval(timer);
        ok(m);
      } else if (proc.exitCode !== null) {
        clearInterval(timer);
        fail(new Error(`${what} exited with ${proc.exitCode}: ${lines.slice(-1500)}`));
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        fail(new Error(`${what} did not start within ${ms / 1000} s`));
      }
    }, 300);
  });
}

function portFree(port) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(false));
    s.once("listening", () => s.close(() => ok(true)));
    s.listen(port, "127.0.0.1");
  });
}

function run(cmd, args, { env = {}, cwd = ROOT, input } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => ((out += d), appendFileSync(LOG(), d)));
    p.stderr.on("data", (d) => ((out += d), appendFileSync(LOG(), d)));
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}\n${out.slice(-2500)}`))));
    p.stdin.end(input ?? undefined);
  });
}

let dataDir = null;
async function startDesktop() {
  if (!existsSync(join(STATIC, "index.html"))) throw new Error(`no UI build in ${STATIC}: run npm run build:ui first`);
  if (!(await portFree(PORT))) throw new Error(`port ${PORT} is taken`);
  dataDir = mkdtempSync(join(tmpdir(), "e2e-owner-path-pglite-"));
  S.dataDir = dataDir;
  log(`desktop: the local server on port ${PORT}, PGlite data ${dataDir}`);
  const m = await startLogged(TSX, [join(ROOT, "scripts", "ui-shots.mjs"), "--serve-internal", dataDir, String(PORT), STATIC], {}, /ready (http:\/\/\S+)/, "the local server");
  return m[1];
}

const CTL_ENV = () => ({ ITSM_PG_BIN: PG.bin, ITSM_PG_RUNAS: PG.user, ITSM_SERVER_CONFIG: join(PG.dir, "kariz.json") });
const ctl = (...args) => run(TSX, [join(ROOT, "src/server-edition/ctl-main.ts"), ...args, "--config", join(PG.dir, "kariz.json")], { env: CTL_ENV() });
let pgStarted = false;

const MARK = ".e2e-owner-path";
/** The throwaway cluster's folder, made afresh: an existing one is removed only when it is this script's own. */
function freshPgDir() {
  const dir = PG.dir;
  if (!dir || dir.length < 8 || dir === "/" || dir === ROOT || ROOT.startsWith(`${dir}/`)) throw new Error(`refusing --pg-dir ${dir}`);
  if (existsSync(dir)) {
    const names = readdirSync(dir);
    if (names.length && !names.includes(MARK) && !names.includes("kariz.json")) throw new Error(`${dir} holds something else (${names.slice(0, 5).join(", ")}): not removed`);
    rmSync(`${dir}`, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MARK), `scripts/e2e-owner-path.mjs ${EDITION} ${new Date().toISOString()}\n`);
}
function removePgDir() {
  const dir = PG.dir;
  if (dir && dir.length >= 8 && existsSync(join(dir, MARK))) rmSync(`${dir}`, { recursive: true, force: true });
}

async function startServerEdition() {
  if (!existsSync(join(STATIC, "index.html"))) throw new Error(`no UI build in ${STATIC}: run npm run build:ui first`);
  if (!(await portFree(PORT))) throw new Error(`port ${PORT} is taken`);
  if (!(await portFree(PG.port))) throw new Error(`port ${PG.port} is taken (another PostgreSQL?)`);
  if (!existsSync(join(PG.bin, "initdb"))) throw new Error(`no PostgreSQL in ${PG.bin}`);
  // a throwaway cluster: the folder must not hold anything of another run
  freshPgDir();
  const publicUrl = `https://localhost:${PORT}`;
  log(`server edition: karizctl init (data ${PG.dir}, PostgreSQL ${PG.port} as ${PG.user}, ${publicUrl})`);
  await ctl("init", "--data-dir", PG.dir, "--public-url", publicUrl, "--https-port", String(PORT), "--http-port", "0", "--pg-port", String(PG.port), "--pg-bin", PG.bin, "--workers", "1");
  await ctl("db-init");
  // a small footprint on a shared machine (the tests' own settings)
  writeFileSync(join(PG.dir, "db", "kariz-local.conf"), "shared_buffers = 128MB\nmax_connections = 80\nmax_worker_processes = 8\n");
  try {
    execFileSync("chown", [PG.user, join(PG.dir, "db", "kariz-local.conf")]);
  } catch {
    /* not root: the file is the user's own */
  }
  const cfgFile = join(PG.dir, "kariz.json");
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  cfg.db.max_connections = 80;
  cfg.pool_per_worker = 8;
  cfg.backup.enabled = false;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctl("pg-start");
  pgStarted = true;
  await ctl("db-bootstrap");
  log("server edition: migrations");
  await ctl("migrate");
  const out = await ctl("setup-token");
  const url = (out.match(/https:\/\/\S+\/setup\?token=\S+/) ?? [])[0] ?? readFileSync(join(PG.dir, "setup-url.txt"), "utf8").trim();
  S.setupUrl = url.replace(/^https:\/\/[^/]+/, "");
  log(`server edition: setup token issued; starting main.ts --standalone`);
  await startLogged(TSX, [join(ROOT, "src/server-edition/main.ts"), "--standalone"], { ...CTL_ENV(), ITSM_STATIC_DIR: STATIC, ITSM_STANDALONE: "1" }, /server edition running: https?:\/\/\S+/, "the server edition");
  return publicUrl;
}

// ---- the web version: PostgreSQL → the Supavisor emulator → next start
/** PostgreSQL's programs refuse to run as root: as --pg-user (runuser) when this script is root. */
const asPgUser = (cmd, args) => (process.getuid?.() === 0 ? ["runuser", ["-u", PG.user, "--", cmd, ...args]] : [cmd, args]);
const NEXT = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
let cronTimer = null;
const POOLER_WRAPPER = (root) => `// written by scripts/e2e-owner-path.mjs: tests/web-db-pooler.ts (Supavisor v2.9.13's transaction mode) as a process
import { startPooler, backendOf } from ${JSON.stringify(join(root, "tests", "web-db-pooler.ts"))};
const p = await startPooler({ backend: backendOf(process.env.E2E_BACKEND_URL), poolSize: Number(process.env.E2E_POOL_SIZE || 15) });
console.log(\`[pooler] ready \${p.port}\`);
const show = () => console.log(\`[pooler] stats \${JSON.stringify(p.stats)}\`);
setInterval(show, 300_000);
process.on("SIGTERM", () => { show(); process.exit(0); });
`;

async function startWebEdition() {
  if (!existsSync(join(STATIC, "index.html"))) throw new Error(`no UI build in ${STATIC}: run npm run build:ui first`);
  if (!(await portFree(PORT))) throw new Error(`port ${PORT} is taken`);
  if (!(await portFree(PG.port))) throw new Error(`port ${PG.port} is taken (another PostgreSQL?)`);
  if (!existsSync(join(PG.bin, "initdb"))) throw new Error(`no PostgreSQL in ${PG.bin}`);
  freshPgDir();
  const data = join(PG.dir, "data");
  if (process.getuid?.() === 0) execFileSync("chown", ["-R", PG.user, PG.dir]);
  log(`web: initdb ${data} (PostgreSQL ${PG.port} as ${PG.user})`);
  await run(...asPgUser(join(PG.bin, "initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-instructions"]), { cwd: PG.dir });
  await run(...asPgUser(join(PG.bin, "pg_ctl"), ["-D", data, "-l", join(PG.dir, "postgres.log"), "-w", "-t", "120", "-o", `-p ${PG.port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${PG.dir} -c shared_buffers=128MB -c max_connections=60`, "start"]), { cwd: PG.dir });
  pgStarted = true;
  const direct = `postgres://postgres@127.0.0.1:${PG.port}/postgres`;
  log("web: scripts/migrate-db.mts (the schema before the first request: the docs' preferred path)");
  await run(TSX, [join(ROOT, "scripts", "migrate-db.mts")], { env: { DATABASE_URL: direct, DATABASE_SSL: "disable" } });
  const wrapper = join(OUT, "pooler.mts");
  writeFileSync(wrapper, POOLER_WRAPPER(ROOT));
  const pm = await startLogged(TSX, [wrapper], { E2E_BACKEND_URL: direct, E2E_POOL_SIZE: "15" }, /\[pooler\] ready (\d+)/, "the pooler emulator", { ms: 60_000 });
  const poolerPort = Number(pm[1]);
  log(`web: the Supavisor emulator on 127.0.0.1:${poolerPort} (pool 15) in front of PostgreSQL ${PG.port}`);
  if (flag("rebuild") || !existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    log("web: next build");
    const tb = Date.now();
    await run(NEXT, ["build"], { env: { NEXT_TELEMETRY_DISABLED: "1" } }).catch((e) => {
      // a build that wrote its BUILD_ID is done, whatever the CLI says after it (it may exit 1 over a notice of its own)
      const id = join(ROOT, ".next", "BUILD_ID");
      if (!existsSync(id) || statSync(id).mtimeMs < tb) throw e;
      R.notes.push(`next build wrote its build but exited non-zero: ${String(e.message).split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300)}`);
    });
    R.notes.push(`next build: ${Math.round((Date.now() - tb) / 1000)} s`);
  } else R.notes.push("next build: reused the .next build of an earlier run (--rebuild builds again)");
  const publicUrl = `http://localhost:${PORT}`;
  const env = {
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `postgres://postgres:pooled@127.0.0.1:${poolerPort}/postgres`, DATABASE_SSL: "disable",
    APP_SECRET: randomBytes(32).toString("hex"), ALLOW_SIGNUP: "true", PLATFORM_ADMIN_EMAILS: OWNER.email, PUBLIC_URL: publicUrl, AUTO_MIGRATE: "false",
  };
  await startLogged(NEXT, ["start", "-p", String(PORT)], env, /Ready in|started server on/i, "next start");
  // Supabase pg_cron + pg_net's heartbeat (docs/SETUP_FA.md): the only web tick that also cleans up finished jobs
  cronTimer = setInterval(() => void fetch(`${publicUrl}/api/cron/tick`).then((r) => r.text()).catch(() => undefined), 60_000);
  return publicUrl;
}

async function stopAll() {
  if (cronTimer) clearInterval(cronTimer);
  if (!KEEP) {
    for (const proc of [...procs].reverse()) {
      if (proc.exitCode !== null || proc.signalCode) continue;
      await new Promise((ok) => {
        const timer = setTimeout(() => (proc.kill("SIGKILL"), ok()), 20_000);
        proc.once("exit", () => (clearTimeout(timer), ok()));
        proc.kill("SIGTERM");
      });
      log(`${proc.what} stopped`);
    }
  }
  if (EDITION === "server" && pgStarted && !KEEP) {
    await ctl("pg-stop").catch((e) => log(`pg-stop: ${String(e.message).split("\n")[0]}`));
    removePgDir();
    log(`PostgreSQL stopped, ${PG.dir} removed`);
  }
  if (EDITION === "web" && pgStarted && !KEEP) {
    const data = join(PG.dir, "data");
    await run(...asPgUser(join(PG.bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "-t", "60", "stop"]), { cwd: PG.dir }).catch((e) => log(`pg_ctl stop: ${String(e.message).split("\n")[0]}`));
    try {
      writeFileSync(join(OUT, "postgres.log"), readFileSync(join(PG.dir, "postgres.log")));
    } catch {
      /* no log */
    }
    removePgDir();
    log(`PostgreSQL stopped, ${PG.dir} removed`);
  }
  if (dataDir && !KEEP) rmSync(`${dataDir}`, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the browser
const { chromium, request: pwRequest } = require("playwright");
let browser = null;
let BASE = null;
const PEOPLE = {};
const SESSIONS = () => join(OUT, "sessions");

/** Signed-out pages ask «who am I» (401), the API's answers a person may not get (403 apart), live requests stay open. */
class Probe {
  constructor(page, person) {
    this.page = page;
    this.person = person;
    /** the API calls open now (request → when it started); a new document starts with none */
    this.inflight = new Map();
    this.reset();
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) this.inflight.clear();
    });
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/^Failed to load resource: the server responded with a status of \d+/.test(t)) return;
      this.cur.console.push(t.slice(0, 500));
    });
    page.on("pageerror", (e) => this.cur.exceptions.push(String(e?.stack ?? e).slice(0, 1000)));
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && !/\/(pulse|live|stream)(\?|$)/.test(u.pathname)) this.inflight.set(r, Date.now());
    });
    const done = (r) => this.inflight.delete(r);
    page.on("requestfinished", done);
    page.on("requestfailed", (r) => {
      done(r);
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && !/aborted|cancel/i.test(r.failure()?.errorText ?? "")) this.cur.failed.push(`failed ${r.method()} ${u.pathname} ${r.failure()?.errorText ?? ""}`);
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/") || r.status() < 400) return;
      const what = `${r.status()} ${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`;
      if (r.status() === 401 && /\/api\/auth\/me$/.test(u.pathname) && !this.person.signedIn) return;
      if (r.status() === 403) this.cur.forbidden.push(what);
      else if (r.status() === 401) {
        // «تأیید دوبارهٔ هویت» before a sensitive change (needRecentAuth) is the product asking, not a failure
        const cur = this.cur;
        void r.json().then(
          (j) => (j?.code === "reauth_required" || j?.error?.code === "reauth_required" ? cur.reauth.push(what) : cur.failed.push(what)),
          () => cur.failed.push(what),
        );
      } else this.cur.failed.push(what);
    });
  }
  reset() {
    this.cur = { console: [], exceptions: [], failed: [], forbidden: [], reauth: [] };
  }
  take() {
    const c = this.cur;
    this.reset();
    return c;
  }
  peek() {
    return this.cur;
  }
  /** no API call open for 400 ms and no loader on screen (or `ms` passed) */
  async settle(ms = 20_000) {
    const until = Date.now() + ms;
    let quiet = 0;
    while (Date.now() < until) {
      await this.page.waitForTimeout(120);
      // a call open for more than 15 s is not one the page waits for (a lost event, a long poll)
      let busy = [...this.inflight.values()].some((t) => Date.now() - t < 15_000);
      if (!busy) busy = await this.page.locator(".sh-boot, .sh-wait, .ds-loader, .ant-skeleton, .ant-spin-spinning, .sh-loader").first().isVisible().catch(() => false);
      if (busy) quiet = 0;
      else if (!quiet) quiet = Date.now();
      else if (Date.now() - quiet >= 400) return true;
    }
    return false;
  }
}

class Person {
  constructor(key, who) {
    this.key = key;
    this.name = who.name;
    this.email = who.email;
    this.password = who.password;
    this.signedIn = false;
    PEOPLE[key] = this;
  }
  async open() {
    if (this.page && !this.page.isClosed()) return this;
    const file = join(SESSIONS(), `${this.key}.json`);
    this.ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "fa-IR",
      timezoneId: "Asia/Tehran",
      ignoreHTTPSErrors: true,
      storageState: existsSync(file) ? file : undefined,
    });
    // the first-visit tour of a new browser is not part of the path
    await this.ctx.addInitScript((org) => {
      try {
        localStorage.setItem("itsm.tour.done", "1");
        if (org) localStorage.setItem("itsm.lastOrg", org);
      } catch {}
    }, S.org ?? null);
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(T);
    this.probe = new Probe(this.page, this);
    return this;
  }
  async close() {
    await this.ctx?.close().catch(() => {});
    this.page = null;
    this.ctx = null;
  }
  async saveSession() {
    mkdirSync(SESSIONS(), { recursive: true });
    await this.ctx.storageState({ path: join(SESSIONS(), `${this.key}.json`) });
  }
  /** The sign-in form, as a person types it (once per person: the browser keeps the session). */
  async signIn() {
    await this.open();
    await this.page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await this.page.locator('input[autocomplete="username"]').fill(this.email);
    await this.page.locator('input[autocomplete="current-password"]').fill(this.password);
    await this.page.locator('button[type="submit"]').click();
    await this.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: T });
    this.signedIn = true;
    await this.settle();
    await this.saveSession();
    return new URL(this.page.url()).pathname;
  }
  /** Signed in already (a kept session), else through the form. */
  async ensure() {
    await this.open();
    if (this.signedIn) return;
    if (existsSync(join(SESSIONS(), `${this.key}.json`))) {
      const r = await this.api("GET", "/auth/me").catch(() => null);
      if (r?.status === 200) {
        this.signedIn = true;
        return;
      }
    }
    await this.signIn();
  }
  /** Opens a page by its address (a fresh load: every step starts from a clean page). */
  async go(path) {
    await this.ensure();
    const href = path.startsWith("/") ? path : `/${S.org}/${path}`;
    await this.page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
    await this.settle();
    return this.page;
  }
  /** Quiet network, no loader — and «تأیید دوبارهٔ هویت» answered when the server asked for it meanwhile. */
  async settle(ms) {
    const r = await this.probe.settle(ms);
    if (await this.reauth()) await this.probe.settle(ms);
    return r;
  }
  /** Waits for `cond` (async, true when done), answering «تأیید دوبارهٔ هویت» whenever it shows. */
  async until(cond, what, ms = T) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond().catch(() => false)) return true;
      await this.reauth();
      await this.page.waitForTimeout(250);
    }
    throw new Error(`timed out (${Math.round(ms / 1000)} s): ${what}`);
  }
  async shot(name) {
    const file = `${String(++shotNo).padStart(2, "0")}-${name.replace(/[^a-z0-9._-]+/gi, "-")}.png`;
    await this.page.screenshot({ path: join(OUT, file) });
    cur?.shots.push(file);
    return file;
  }
  async text(sel = "main, #root") {
    return ((await this.page.locator(sel).first().innerText({ timeout: 10_000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
  }
  /** Reads state with the person's own session (assertions only; nothing is written through it). */
  async api(method, path, body) {
    await this.open();
    if (!this.page.url().startsWith(BASE)) await this.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    for (let i = 0; ; i++) {
      try {
        return await this.page.evaluate(
          async ([m, p, b]) => {
            const r = await fetch(`/api${p}`, { method: m, credentials: "same-origin", headers: { "content-type": "application/json", "x-itsm-background": "1" }, body: b ? JSON.stringify(b) : undefined });
            return { status: r.status, json: await r.json().catch(() => null) };
          },
          [method, path, body],
        );
      } catch (e) {
        // the page was navigating: ask again once it settled
        if (i >= 4) throw e;
        await this.page.waitForTimeout(500);
      }
    }
  }
  /** «تأیید دوبارهٔ هویت» when the server asks for it (publish, demo sign-in, the purge) */
  async reauth() {
    const d = this.page.getByRole("dialog").filter({ hasText: "تأیید دوبارهٔ هویت" });
    if (!(await d.isVisible().catch(() => false))) return false;
    await d.locator('input[autocomplete="current-password"]').fill(this.password);
    await d.getByRole("button", { name: "تأیید", exact: true }).click();
    await d.waitFor({ state: "hidden", timeout: T }).catch(() => {});
    seen(`${this.name}: «تأیید دوبارهٔ هویت» asked and answered`);
    return true;
  }
}

/** Picks an option of the open AntD dropdown by its text (first match). */
async function pickOption(page, text, { exact = false } = {}) {
  const opts = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
  const o = exact ? opts.filter({ hasText: new RegExp(`^\\s*${esc(text)}\\s*$`) }) : opts.filter({ hasText: text });
  await o.first().waitFor({ timeout: T });
  await o.first().click();
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uuidIn = (s, re) => (String(s).match(re) ?? [])[1] ?? null;
/**
 * The form designer's palette entries of a label: «افزودن <label> به فرم», or «افزودن <label> (<technical name>) به
 * فرم» when another library field carries the same label (forms/ProcessDesigner.tsx); `tech` pins one field.
 */
const paletteItems = (palette, label, tech = "u_[a-z0-9_]+") => palette.getByRole("button", { name: new RegExp(`^افزودن ${esc(label)}(?: \\(${tech}\\))? به فرم$`) });

// ---------------------------------------------------------------- the path
async function setupOwner() {
  const setup = new Person("setup", OWNER);
  await setup.open();
  const p = setup.page;
  if (EDITION === "desktop") {
    await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await p.waitForURL(/\/setup/, { timeout: T });
    await setup.shot("setup-first-run");
    await p.getByRole("radio", { name: /شروع روی همین رایانه/ }).click();
    await p.getByRole("button", { name: "ادامه", exact: true }).click();
    await p.locator("#full_name").fill(OWNER.name);
    await p.locator("#email").fill(OWNER.email);
    await p.locator("#password").fill(OWNER.password);
    await p.getByRole("button", { name: "ساخت حساب مدیر" }).click();
    await p.getByText("کد را جای امنی نگه داشتم.").click({ timeout: T });
    await p.getByRole("button", { name: "ادامه", exact: true }).click();
    await p.locator("#name").fill(ORG_NAME, { timeout: T });
    await p.getByRole("button", { name: "ساخت سازمان" }).click();
    await p.getByRole("button", { name: "رفتن به خانه" }).click({ timeout: T });
    await p.waitForURL((u) => /^\/[0-9a-f-]{36}(\/|$)/.test(u.pathname), { timeout: T });
    S.org = new URL(p.url()).pathname.split("/")[1];
    check(true, `the first-run setup made the owner's account and «${ORG_NAME}»`);
  } else if (EDITION === "web") {
    // the web version: «ساخت حساب» from the sign-in page, the recovery code, then «سازمان تازه»
    await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await p.waitForURL(/\/(login|signup)/, { timeout: T });
    await setup.settle();
    await setup.shot("setup-web-signin-page");
    if (!/\/signup/.test(p.url())) await p.getByRole("link", { name: "ساخت حساب", exact: true }).click();
    await p.waitForURL(/\/signup/, { timeout: T });
    await p.locator("#full_name").fill(OWNER.name);
    await p.locator("#email").fill(OWNER.email);
    await p.locator("#password").fill(OWNER.password);
    await setup.shot("setup-web-signup");
    await p.getByRole("button", { name: "ساخت حساب", exact: true }).click();
    await p.getByText("کد را جای امنی نگه داشتم.").click({ timeout: T });
    await p.getByRole("button", { name: "ادامه", exact: true }).click();
    await p.waitForURL(/\/orgs\/new/, { timeout: T });
    await p.locator("#name").fill(ORG_NAME, { timeout: T });
    await setup.shot("setup-web-org");
    // «ادامه» to the modules when the build has a modules step, then «ساخت سازمان»
    const next = p.getByRole("button", { name: "ادامه", exact: true });
    if (await next.isVisible().catch(() => false)) await next.click();
    await p.getByRole("button", { name: "ساخت سازمان" }).click({ timeout: T });
    await p.getByRole("button", { name: "رفتن به خانه" }).click({ timeout: T * 2 });
    await p.waitForURL((u) => /^\/[0-9a-f-]{36}(\/|$)/.test(u.pathname), { timeout: T });
    S.org = new URL(p.url()).pathname.split("/")[1];
    check(!!S.org, `«ساخت حساب» and «سازمان تازه» made the owner's account and «${ORG_NAME}»`);
  } else {
    await p.goto(`${BASE}${S.setupUrl}`, { waitUntil: "domcontentloaded" });
    await p.locator("#org_name").waitFor({ timeout: T });
    await setup.shot("setup-server-first-run");
    await p.locator("#org_name").fill(ORG_NAME);
    await p.locator("#full_name").fill(OWNER.name);
    await p.locator("#email").fill(OWNER.email);
    await p.locator("#password").fill(OWNER.password);
    for (let i = 0; i < 3; i++) {
      await p.getByRole("button", { name: "ادامه", exact: true }).click();
      await p.waitForTimeout(400);
    }
    await p.getByRole("button", { name: "پایان راه‌اندازی" }).click();
    await p.getByText("کد را جای امنی نگه داشتم.").click({ timeout: T * 2 });
    await setup.shot("setup-server-done");
    await p.getByRole("button", { name: "ادامه", exact: true }).click();
    await p.getByRole("button", { name: /^ورود به/ }).click({ timeout: T });
    await p.waitForURL((u) => /^\/[0-9a-f-]{36}(\/|$)/.test(u.pathname) || u.pathname.startsWith("/login"), { timeout: T });
    const meta = await setup.api("GET", "/orgs");
    S.org = meta.json?.orgs?.find((o) => o.name === ORG_NAME)?.id ?? (new URL(p.url()).pathname.split("/")[1] || null);
    check(!!S.org, `the server's first-run setup made the organisation «${ORG_NAME}» and its owner`, JSON.stringify(meta.json ?? {}).slice(0, 200));
  }
  await setup.close();
  delete PEOPLE.setup;
  R.org = S.org;
}

async function ownerSignIn() {
  const o = new Person("owner", OWNER);
  const landed = await o.signIn();
  check(landed.startsWith(`/${S.org}`), "the owner signs in through the sign-in form and lands in the organisation", landed);
  await o.shot("owner-home");
  // the sidebar's footer names where the data lives (its word, and the detail on hover)
  const foot = o.page.locator(".sh-foot .sh-sync").first();
  const word = ((await foot.innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  await foot.hover().catch(() => {});
  const tip = ((await o.page.locator(".ant-tooltip:visible").last().innerText({ timeout: 3000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  seen(`sidebar footer: «${word}»${tip ? ` — «${tip}»` : ""}`);
  // each edition names itself (src/ui/lib/edition.ts installationState): «نسخهٔ سرور», «نسخهٔ وب»; the Windows app on
  // its own, not linked, «روی همین رایانه» (src/ui/components/shell/sync.tsx syncStateOf)
  const footer = { server: /نسخهٔ سرور/, web: /نسخهٔ وب/, desktop: /روی همین رایانه/ }[EDITION];
  check(footer.test(word), `the sidebar footer names the edition («${word}»)`, `${word}${tip ? ` — ${tip}` : ""}`);
  if (EDITION === "server" && /نسخهٔ وب|فضای ابری/.test(`${word} ${tip}`)) {
    const file = await o.shot("server-footer");
    finding({
      title: "the server edition's sidebar says «نسخهٔ وب» — «داده‌ها مستقیم در فضای ابری ذخیره می‌شوند.»",
      expected: "on the organisation's own (air-gapped) server the footer names the server edition and says the data stays on the organisation's server (as its setup page says: «داده‌ها روی سرور سازمان می‌مانند»)",
      seen: `footer «${word}», on hover «${tip}»`,
      shot: file,
      where: "src/ui/components/shell/sync.tsx syncStateOf and src/ui/lib/edition.ts editionOf/installationState: the edition comes from /api/meta's «edition» («server» on the server edition)",
    });
  }
  await o.page.mouse.move(5, 5).catch(() => {});
}

async function demoLoad() {
  const o = PEOPLE.owner;
  const p = await o.go("settings/demo");
  await p.getByText(SIZE === "small" ? /^کوچک/ : /^متوسط/).first().click();
  await o.shot("demo-page-before-load");
  await p.getByRole("button", { name: "بارگذاری دادهٔ نمایشی" }).click();
  const t = Date.now();
  let st = null;
  let last = "";
  while (Date.now() - t < 45 * 60_000) {
    await sleep(5000);
    st = (await o.api("GET", `/o/${S.org}/demo`).catch(() => null))?.json;
    const label = `${st?.state} ${st?.progress?.done ?? ""}/${st?.progress?.total ?? ""} ${st?.progress?.label ?? ""}`;
    if (label !== last) log(`  demo: ${label}`);
    last = label;
    if (st && st.state !== "loading") break;
  }
  await o.settle();
  await p.reload({ waitUntil: "domcontentloaded" });
  await o.settle();
  const chip = await o.text("main");
  await o.shot("demo-loaded");
  R.demoLoadSeconds = Math.round((Date.now() - t) / 1000);
  seen(`demo page after ${R.demoLoadSeconds} s: ${chip.slice(0, 160)}`);
  check(st?.state === "loaded" && /بارگذاری‌شده/.test(chip), `«بارگذاری دادهٔ نمایشی» (${SIZE}) ends «بارگذاری‌شده» (${R.demoLoadSeconds} s)`, JSON.stringify(st ?? {}).slice(0, 300));
}

async function demoSignin() {
  const o = PEOPLE.owner;
  const p = await o.go("settings/demo");
  const sw = p.getByRole("switch").first();
  if ((await sw.getAttribute("aria-checked")) !== "true") {
    await sw.click();
    await o.until(async () => (await sw.getAttribute("aria-checked")) === "true", "«ورود با حساب‌های نمایشی» turns on");
    await o.settle();
  }
  const code = p.locator(".ant-typography code").first();
  await code.waitFor({ timeout: T });
  S.demoPassword = (await code.innerText()).trim();
  const rows = await p.locator("table tbody tr.ant-table-row").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim())));
  S.personas = {};
  for (const [persona, name, title, email] of rows) S.personas[persona] = { name, title, email };
  await o.shot("demo-signin-on");
  check(!!S.demoPassword && Object.keys(S.personas).length >= 5, "«ورود با حساب‌های نمایشی» is on; the page shows the shared password and the personas", `${Object.keys(S.personas).length} personas`);
  for (const [k, label] of Object.entries(PERSONAS)) {
    const x = S.personas[label];
    check(!!x, `persona «${label}» is listed`, JSON.stringify(Object.keys(S.personas)));
    if (x) seen(`${k}: ${x.name} (${x.email})`);
  }
}

async function addMembers() {
  const o = PEOPLE.owner;
  const p = await o.go("settings/users");
  for (const [k, m] of Object.entries(MEMBERS)) {
    if ((await o.text("main")).includes(m.email)) continue;
    await p.getByRole("button", { name: "افزودن کاربر" }).first().click();
    const d = p.getByRole("dialog").filter({ hasText: "افزودن کاربر" });
    await d.locator("#full_name").fill(m.name);
    await d.locator("#email").fill(m.email);
    await d.locator("#password").fill(MEMBER_PASSWORD);
    if (await d.locator("#access_preset").count()) {
      await d.locator("#access_preset").click();
      await pickOption(p, m.preset, { exact: true });
    }
    await d.getByRole("button", { name: "افزودن", exact: true }).click();
    // the access preset is a sensitive change: the server may ask the owner to confirm the password first
    await o.until(async () => !(await d.isVisible()), `the «افزودن کاربر» dialog of ${m.name} closes`);
    await o.settle();
    await p.getByText(m.email).first().waitFor({ timeout: T });
    seen(`${k}: ${m.name} <${m.email}> (${m.preset})`);
  }
  await o.settle();
  await o.shot("members-added");
  const text = await o.text("main");
  for (const m of Object.values(MEMBERS)) check(text.includes(m.email), `«کاربران و دسترسی‌ها» lists ${m.name}`);
}

// ---- «فیلدها»
/** The library list searched (its search box takes a label or a technical name; the table shows 50 rows a page). */
async function searchFields(o, q) {
  const p = await o.go("settings/fields");
  await p.getByRole("textbox", { name: "جست‌وجوی فیلدها" }).fill(q);
  await p.waitForTimeout(500);
  return p;
}
async function makeFields(v) {
  const V = VARIANTS[v];
  const o = PEOPLE.owner;
  let p;
  for (const [k, label] of Object.entries(V.fields)) {
    // each field from the list page as it is after the last save (the saved field's sheet stays open otherwise);
    // a field of an earlier run of these steps (its technical name) is kept
    const tech = `u_${V.prefix}_${k}`;
    p = await searchFields(o, tech);
    if (await p.locator("main table tbody tr").filter({ hasText: tech }).first().isVisible().catch(() => false)) continue;
    await p.locator(".ds-ph-actions").getByRole("button", { name: "فیلد تازه", exact: true }).click();
    const d = p.getByRole("dialog", { name: "فیلد تازه" });
    await d.locator('[id$="-label"]').fill(label);
    // a label the pack's fields carry too («واحد مجری», «نظر مدیر گروه»): the sheet says so under «برچسب», naming
    // them by their technical names, and saves all the same (fields/FieldSheet.tsx SameLabel, fields/labels.ts)
    if (v === "A" && (k === "unit" || k === "note")) {
      const said = ((await d.getByRole("status").filter({ hasText: "همین برچسب" }).first().innerText({ timeout: 5000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
      seen(`«${label}» in «فیلد تازه»: ${said || "no word about the label"}`);
      check(/همین برچسب/.test(said) && /u_[a-z0-9_]+/.test(said), `«فیلد تازه» says which library field already carries «${label}»`, said);
    }
    await d.locator('[id$="-name"]').fill(`${V.prefix}_${k}`);
    await d.locator('[id$="-type"]').click();
    await p.keyboard.type(FIELD_TYPES[k]);
    await pickOption(p, FIELD_TYPES[k], { exact: true });
    if (k === "kind") {
      for (let i = 0; i < KIND_OPTIONS.length; i++) {
        await d.getByRole("button", { name: "گزینه", exact: true }).click();
        await d.getByLabel(`مقدار گزینهٔ ${i + 1}`).fill(KIND_OPTIONS[i][0]);
        await d.getByLabel(`برچسب گزینهٔ ${i + 1}`).fill(KIND_OPTIONS[i][1]);
      }
    }
    if (k === "title" && v === "A") await o.shot(`fields-${v}-new-field-sheet`);
    await d.getByRole("button", { name: "ذخیره", exact: true }).click();
    await p.locator(".ant-notification-notice, .ant-message-notice").filter({ hasText: label }).first().waitFor({ timeout: T });
    await p.waitForURL(/[?&]field=[0-9a-f-]{36}/, { timeout: T });
    await o.settle();
    seen(`${label}: ${tech}, ${FIELD_TYPES[k]}`);
  }
  // the variant's six, found by their technical names' common start
  p = await searchFields(o, `u_${V.prefix}_`);
  await o.settle();
  const text = await o.text("main");
  await o.shot(`fields-${v}`);
  for (const [k, label] of Object.entries(V.fields)) check(text.includes(label) && text.includes(`u_${V.prefix}_${k}`), `«فیلدها» lists «${label}» (u_${V.prefix}_${k})`);
  // the same label as one of the pack's fields (the pack has «واحد مجری» and «نظر مدیر گروه»): what the list shows
  if (v === "A") {
    for (const label of [V.fields.unit, V.fields.note]) {
      p = await searchFields(o, label);
      const rows = (await p.locator("main table tbody tr.ant-table-row").allInnerTexts().catch(() => [])).map((r) => r.replace(/\s+/g, " "));
      if (rows.length > 1) seen(`«${label}» in the library: ${rows.join(" | ")}`);
    }
  }
}

// ---- «فرم‌ها»
async function makeForm(v) {
  const V = VARIANTS[v];
  const o = PEOPLE.owner;
  const p = await o.go("settings/forms");
  await p.locator(".ds-ph-actions").getByRole("button", { name: "فرم تازه" }).click();
  await p.locator("#wfm-new-name").fill(V.form);
  await p.getByRole("button", { name: "ساخت و طراحی" }).click();
  await p.waitForURL(/settings\/forms\/[0-9a-f-]{36}/, { timeout: T });
  S[`form${v}`] = uuidIn(p.url(), /settings\/forms\/([0-9a-f-]{36})/);
  await o.settle();
  const canvas = p.getByRole("region", { name: "بوم فرم" });
  const palette = p.locator('aside[aria-label="فیلدهای کتابخانه"]');
  const search = palette.getByRole("textbox", { name: "جست‌وجوی فیلد" });
  // the pack has fields with two of these labels («واحد مجری», «نظر مدیر گروه»): the palette tells them apart — an entry
  // whose label another library field carries shows its technical name (and says it), the pack's its «نمایشی» tag
  if (v === "A") {
    for (const k of ["unit", "note"]) {
      await search.fill(V.fields[k]);
      await p.waitForTimeout(400);
      const same = paletteItems(palette, V.fields[k]);
      const n = await same.count();
      const texts = (await same.allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
      seen(`palette «${V.fields[k]}»: ${n} entries ${JSON.stringify(texts)}`);
      if (n < 2) continue;
      const apart = new Set(texts).size === n && texts.every((t) => /u_[a-z0-9_]+/.test(t));
      if (apart) check(texts.some((t) => t.includes(`u_${V.prefix}_${k}`)), `the palette tells the owner's «${V.fields[k]}» (u_${V.prefix}_${k}) from the pack's`, JSON.stringify(texts));
      else {
        const file = await o.shot(`form-${v}-palette-same-label-${k}`);
        finding({
          title: `the form designer's palette lists ${n} «${V.fields[k]}» fields that look the same (the pack's and the owner's)`,
          expected: "a library field the owner makes with the same label as one of the demo pack's is told apart where it is picked (its technical name, or the pack's marked «نمایشی»), or «فیلد تازه» warns about the label",
          seen: `«جست‌وجوی فیلد» «${V.fields[k]}» offers ${n} entries ${JSON.stringify(texts)}: not every entry shows its technical name; picking the pack's ties the real form to a field the purge removes`,
          shot: file,
          where: "src/ui/modules/workflows/admin/forms/ProcessDesigner.tsx palette (a shared label's entry: <small class=\"ds-id\"> and its aria-label name the field; src/ui/modules/workflows/admin/fields/labels.ts sharedLabels); src/server/modules/demo/workflow-samples.ts WF_FIELDS (the pack's «واحد مجری», «نظر مدیر گروه»)",
        });
      }
    }
    await search.fill("");
  }
  // each field by its technical name in «جست‌وجوی فیلد» (the label alone may be the pack's too)
  const addField = async (k) => {
    await search.fill(`u_${V.prefix}_${k}`);
    await p.waitForTimeout(300);
    await paletteItems(palette, V.fields[k], `u_${V.prefix}_${k}`).click();
    await search.fill("");
    await p.waitForTimeout(250);
  };
  // tab 1 › section «اطلاعات پایه»: the title, the kind, the description
  await p.getByRole("button", { name: "زبانهٔ نخست" }).click();
  await p.locator("#wfm-tab-label").fill("مشخصات درخواست");
  await canvas.locator(".wfm-sec-h").nth(0).click();
  await p.locator("#wfm-sec-label").fill("اطلاعات پایه");
  for (const k of ["title", "kind", "desc"]) await addField(k);
  // tab 2 › section «اجرا»: the due date, the unit, the group manager's note
  await canvas.getByRole("button", { name: "زبانه", exact: true }).click();
  await p.locator("#wfm-tab-label").fill("زمان‌بندی و اجرا");
  await canvas.locator(".wfm-sec-h").nth(1).click();
  await p.locator("#wfm-sec-label").fill("اجرا");
  for (const k of ["due", "unit", "note"]) await addField(k);
  // the draft saves itself
  await p.locator(".ds-ph").getByText(/ذخیره شد/).waitFor({ timeout: T });
  await o.settle();
  await o.shot(`form-${v}-designer`);
  const tabs = await canvas.locator(".wfm-tab-h").allInnerTexts();
  const secs = await canvas.locator(".wfm-sec-h").allInnerTexts();
  const items = await canvas.locator(".wfm-item").count();
  seen(`tabs ${JSON.stringify(tabs.map((x) => x.replace(/\s+/g, " ")))}, sections ${JSON.stringify(secs.map((x) => x.replace(/\s+/g, " ")))}, ${items} fields`);
  check(tabs.length === 2 && secs.length === 2 && items === 6, `«${V.form}»: two tabs, a section in each, six fields, saved`);
  // what the server holds
  const f = await o.api("GET", `/o/${S.org}/forms/${S[`form${v}`]}`);
  const layout = f.json?.form?.layout;
  check(layout?.tabs?.length === 2 && layout.tabs.every((t) => t.sections?.length >= 1 && t.sections[0].items?.length === 3), "the saved form has the two tabs with their sections and fields", JSON.stringify(layout ?? f.json ?? {}).slice(0, 300));
}

// ---- «نقش‌های سازمانی»
async function addHolder(p, o, who, { demo }) {
  await p.getByRole("button", { name: "دارندهٔ تازه" }).click();
  const box = p.getByRole("combobox", { name: "دارنده" });
  await box.click();
  await p.keyboard.type(who.email.split("@")[0]);
  await pickOption(p, who.email);
  await p.getByRole("group", { name: "دارندهٔ تازه" }).getByRole("button", { name: "افزودن", exact: true }).click();
  await p.waitForTimeout(700);
  // FINAL-1: making one of the pack's people a holder asks first
  const q = p.locator(".ant-modal").filter({ hasText: "حساب نمایشی است" }).last();
  if (await q.isVisible().catch(() => false)) {
    seen(`FINAL-1 question for ${who.name}: ${(await q.innerText()).split("\n")[0]}`);
    await q.getByRole("button", { name: "افزودن", exact: true }).click();
    if (!demo) check(false, `no FINAL-1 question for a real member (${who.name})`);
  } else if (demo) seen(`no FINAL-1 question for ${who.name}`);
  await p.locator(".ant-notification-notice, .ant-message-notice").filter({ hasText: "دارندهٔ تازه افزوده شد" }).first().waitFor({ timeout: T });
  await o.settle();
}

async function makeRoles(v, holders) {
  const V = VARIANTS[v];
  const o = PEOPLE.owner;
  S[`roles${v}`] = {};
  for (const [rk, role] of Object.entries(V.roles)) {
    const p = await o.go("settings/positions");
    await p.locator(".ds-ph-actions").getByRole("button", { name: "نقش تازه" }).click();
    const d = p.getByRole("dialog", { name: "نقش سازمانی تازه" });
    await d.locator('[id$="-name"]').fill(role.name);
    await d.locator('[id$="-key"]').fill(role.key);
    await d.getByRole("button", { name: "ساخت نقش" }).click();
    await p.waitForURL(/position=[0-9a-f-]{36}/, { timeout: T });
    S[`roles${v}`][rk] = uuidIn(p.url(), /position=([0-9a-f-]{36})/);
    await o.settle();
    for (const who of holders[rk]) await addHolder(p, o, who, { demo: v === "A" });
    const rows = (await p.getByRole("dialog").locator("table tbody tr.ant-table-row").allInnerTexts()).map((r) => r.replace(/\s+/g, " "));
    await o.shot(`roles-${v}-${rk}-holders`);
    seen(`«${role.name}» (${role.key}) holders: ${rows.join(" | ")}`);
    for (const who of holders[rk]) check(rows.some((r) => r.includes(who.name)), `«${role.name}» is held by ${who.name}${v === "A" ? " (نمایشی)" : ""}`);
    if (v === "A") check(rows.every((r) => r.includes("نمایشی")), `«${role.name}»'s holders are marked «نمایشی»`);
  }
}

// ---- the designer
async function selectNode(p, label) {
  await p.locator(`button[aria-label^="${label.startsWith("پایان") ? "پایان" : "مرحلهٔ فرم"}: ${label}"]`).first().click();
  await p.waitForTimeout(300);
}
async function inspectorTab(p, name) {
  await p.getByRole("tab", { name: new RegExp(`^${name}`) }).last().click();
  await p.waitForTimeout(250);
}
async function chooseForm(p, form) {
  await inspectorTab(p, "فرم");
  await p.getByRole("combobox", { name: "فرم این مرحله" }).click();
  await pickOption(p, form, { exact: true });
  await p.waitForTimeout(400);
}
async function choosePosition(p, role) {
  await inspectorTab(p, "انجام‌دهنده");
  const rule = p.getByRole("group", { name: /^قاعدهٔ ۱/ });
  if (!(await rule.isVisible().catch(() => false))) {
    await p.getByRole("button", { name: "افزودن انجام‌دهنده" }).click();
    await p.locator(".ant-dropdown:visible .ant-dropdown-menu-item").filter({ hasText: "نقش سازمانی" }).first().click();
  }
  await p.getByRole("group", { name: /^قاعدهٔ ۱/ }).locator('[id$="-pos"]').click();
  await pickOption(p, role);
  await p.waitForTimeout(700);
  // the designer's default scope is kept; say which it is
  const where = (await p.getByRole("group", { name: /^قاعدهٔ ۱/ }).locator('[id$="-where"]').locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").innerText().catch(() => "")).trim();
  return where;
}
async function waitDesignerSaved(p) {
  await p.waitForTimeout(1200);
  await p.locator(".ds-ph").getByText(/ذخیره شد/).waitFor({ timeout: T });
}

async function makeWorkflow(v) {
  const V = VARIANTS[v];
  const o = PEOPLE.owner;
  let p = await o.go("settings/workflows");
  await p.locator(".ds-ph-actions").getByRole("button", { name: "گردش‌کار تازه" }).first().click();
  await p.locator("#wfh-new-name").fill(V.wf.name);
  await p.locator("#wfh-new-key").fill(V.wf.key);
  await p.getByRole("button", { name: "ساخت و طراحی" }).click();
  await p.waitForURL(/settings\/workflows\/p\/[0-9a-f-]{36}/, { timeout: T });
  S[`wf${v}`] = uuidIn(p.url(), /workflows\/p\/([0-9a-f-]{36})/);
  await o.settle();
  // «ثبت درخواست»: the tabbed form
  await selectNode(p, "ثبت درخواست");
  await chooseForm(p, V.form);
  // «مرحلهٔ فرم» after it: «مدیر گروه», the designer's default scope, the same form
  await p.getByRole("button", { name: "افزودن «مرحلهٔ فرم» پس از گام برگزیده" }).click();
  await p.waitForTimeout(700);
  await p.locator('input[id$="-label"]').first().fill(STEP2);
  const where2 = await choosePosition(p, V.roles.head.name);
  seen(`«${STEP2}»: «${V.roles.head.name}», scope «${where2}» (the designer's default, kept)`);
  check(/همه‌جا/.test(where2), `the designer starts «${V.roles.head.name}» at «همه‌جا» (1.1.5's default for a role without a unit kind)`, where2);
  await chooseForm(p, V.form);
  await o.shot(`workflow-${v}-step2`);
  // the approval after it: «کارشناس ارشد»
  await selectNode(p, STEP2);
  await p.getByRole("button", { name: "افزودن «تأیید» پس از گام برگزیده" }).click();
  await p.waitForTimeout(700);
  await p.locator('input[id$="-label"]').first().fill(STEP3);
  const where3 = await choosePosition(p, V.roles.senior.name);
  seen(`«${STEP3}»: «${V.roles.senior.name}», scope «${where3}»`);
  await chooseForm(p, V.form);
  // its ways out: «تأیید شد» → «پایان (انجام‌شده)», «رد شد» → «پایان (ردشده)»
  await inspectorTab(p, "مسیرها");
  for (const [port, end] of [["تأیید شد", "پایان (انجام‌شده)"], ["رد شد", "پایان (ردشده)"]]) {
    await p.locator(".wfp-port").filter({ hasText: port }).locator(".ant-select").first().click();
    await pickOption(p, end, { exact: true });
    await p.waitForTimeout(600);
    await selectNode(p, STEP3);
    await inspectorTab(p, "مسیرها");
  }
  await waitDesignerSaved(p);
  const head = await o.text(".ds-ph");
  await o.shot(`workflow-${v}-designed`);
  seen(`designer header: ${head}`);
  // «۲ ایراد، ۱ هشدار» while something is missing; warnings alone do not stop a publish
  check(!/ایراد/.test(head), `«${V.wf.name}» has no problems left`, head);
  // publish
  await p.locator(".ds-ph-actions").getByRole("button", { name: "انتشار" }).click();
  const dlg = p.getByRole("dialog").filter({ hasText: "انتشار" }).last();
  await dlg.getByRole("button", { name: "انتشار", exact: true }).waitFor({ timeout: T });
  await p.waitForTimeout(800);
  seen(`publish dialog: ${(await dlg.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  await o.shot(`workflow-${v}-publish-dialog`);
  await dlg.locator("#wfh-pub-note").fill(`نسخهٔ نخست (${V.tag})`).catch(() => {});
  await dlg.getByRole("button", { name: "انتشار", exact: true }).click();
  await o.until(async () => /منتشرشده/.test(await p.locator(".ds-ph").innerText()), `«${V.wf.name}» shows «منتشرشده»`);
  await o.settle();
  await o.shot(`workflow-${v}-published`);
  const def = await o.api("GET", `/o/${S.org}/process/defs/${V.wf.key}`);
  const proc = def.json?.process ?? {};
  check(proc.status === "published", `«${V.wf.name}» is published (version 1)`, JSON.stringify({ status: proc.status, version: proc.current_version_id ? "set" : null }));
  // the steps' people as the published draft keeps them
  const nodes = (proc.draft?.graph?.nodes ?? def.json?.draft?.graph?.nodes ?? []).filter((n) => n.type === "form_step");
  seen(`saved steps: ${JSON.stringify(nodes.map((n) => ({ label: n.label, action: n.config?.action, form: n.config?.form === S[`form${v}`] ? "the variant's form" : n.config?.form, assignees: n.config?.assignees })))}`.slice(0, 600));
}

// ---- running a case
/** «شروع» on «گردش‌کارها»: the only workflow's button, else «شروع گردش‌کار» and the workflow in its menu. */
async function startCase(person, v, values) {
  const V = VARIANTS[v];
  const p = await person.go("workflows");
  const only = p.getByRole("button", { name: `شروع «${V.wf.name}»` });
  if (await only.isVisible().catch(() => false)) await only.click();
  else {
    await p.getByRole("button", { name: "شروع گردش‌کار" }).first().click();
    await p.getByRole("menuitem", { name: V.wf.name, exact: true }).click();
  }
  await p.waitForURL(/\/workflows\/start\//, { timeout: T });
  await person.settle();
  // tab 1
  await p.locator(`#wfu-start-u_${V.prefix}_title`).fill(values.title);
  await chooseIn(p, `wfu-start-u_${V.prefix}_kind`, values.kind);
  await p.locator(`#wfu-start-u_${V.prefix}_desc`).fill(values.desc);
  await person.shot(`run-${v}${values.tag ?? ""}-start-tab1`);
  // tab 2
  await p.getByRole("tab", { name: "زمان‌بندی و اجرا" }).click();
  await p.waitForTimeout(300);
  // the Jalali date is typed (the field takes «۱۴۰۵/۱۰/۲۰» or Latin digits) and taken when the field is left
  const due = p.locator(`#wfu-start-u_${V.prefix}_due`);
  await due.click();
  await due.fill(values.due);
  await due.press("Tab");
  await p.keyboard.press("Escape").catch(() => {});
  const unit = await chooseRecord(p, `wfu-start-u_${V.prefix}_unit`, values.unit);
  seen(unit ? `«${V.fields.unit}»: ${unit}` : `«${V.fields.unit}»: no unit to choose (left empty)`);
  await person.shot(`run-${v}${values.tag ?? ""}-start-tab2`);
  const send = p.getByRole("button", { name: `ارسال برای «${STEP2}»` });
  await send.click();
  await p.waitForURL(/\/workflows\/c\/[0-9a-f-]{36}$/, { timeout: T });
  const caseId = uuidIn(p.url(), /\/workflows\/c\/([0-9a-f-]{36})/);
  await person.settle();
  return caseId;
}
/** A choice field: a select (open it, pick) or the segmented buttons of a short list. */
async function chooseIn(p, id, label) {
  const el = p.locator(`#${id}`);
  const role = await el.getAttribute("role").catch(() => null);
  if (role === "combobox") {
    await el.click();
    await pickOption(p, label, { exact: true });
  } else {
    const box = p.locator(".rk-f").filter({ has: p.locator(`label[for="${id}"]`) });
    await box.getByText(label, { exact: true }).click();
  }
}
/** A record field (a unit): type a part of its name, pick the first match. */
async function chooseRecord(p, id, text) {
  const el = p.locator(`#${id}`);
  await el.click();
  await p.keyboard.type(text);
  await p.waitForTimeout(900);
  const opt = p.locator(".ant-select-dropdown:visible .ant-select-item-option").first();
  if (!(await opt.waitFor({ timeout: 20_000 }).then(() => true, () => false))) {
    // none matches (after the purge the pack's units are gone): any unit the organisation has, else none
    await p.keyboard.press("Control+A").catch(() => {});
    await p.keyboard.press("Backspace").catch(() => {});
    if (!(await opt.waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
      await p.keyboard.press("Escape").catch(() => {});
      return null;
    }
  }
  const picked = (await opt.innerText()).replace(/\s+/g, " ");
  await opt.click();
  return picked;
}

/** Waits until the case (read with the person's own session) satisfies `ok`. */
async function waitCase(person, caseId, ok, ms = 120_000) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = (await person.api("GET", `/o/${S.org}/process/cases/${caseId}`))?.json;
    if (last && ok(last)) return last;
    await sleep(1500);
  }
  return last;
}
const openTasks = (d, label) => (d?.history?.tasks ?? []).filter((t) => t.status === "open" && (!label || t.step_label === label));
const nameOf = (d, id) => d?.display?.[id] ?? id;
const ended = (d) => !!d?.case?.ended_at || ["completed", "rejected", "canceled"].includes(d?.case?.state);

/** The case page as `person` sees it: the step channel and the «مرحلهٔ کنونی» line, no «کسی پیدا نشد». */
async function casePage(person, caseId, name) {
  const p = await person.go(`workflows/c/${caseId}`);
  await person.settle();
  const text = await person.text("main");
  const file = await person.shot(name);
  return { p, text, file };
}

/** The step in «کارتابل»: the row of the case (its number) with a link to the step form. */
async function inboxRow(person, caseNo, caseId) {
  const p = await person.go("workflows");
  await p.getByRole("tab", { name: /^کارتابل/ }).click().catch(() => {});
  await person.settle();
  const link = p.locator(`main a[href*="/workflows/c/${caseId}/s/"]`).first();
  const visible = await link.isVisible().catch(() => false);
  return { p, link, visible };
}

async function fillAndSubmitStep(person, v, caseId, text, file) {
  const V = VARIANTS[v];
  const p = person.page;
  // the note is on the form's second tab (a tab's fields are drawn when it is opened)
  const tab = p.locator(".wfu-stepform").getByRole("tab", { name: "زمان‌بندی و اجرا" });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await p.waitForTimeout(300);
  const note = p.locator(`.wfu-stepform [id$="-u_${V.prefix}_note"]`).first();
  const noteOk = await note.isVisible().catch(() => false);
  if (noteOk) await note.fill(text);
  await p.locator(".wfu-stepform textarea").last().fill(`${text} (توضیح)`).catch(() => {});
  await person.shot(file);
  await p.getByRole("button", { name: `ارسال برای «${STEP3}»` }).click();
  await p.waitForURL((u) => new RegExp(`/workflows/c/${caseId}$`).test(u.pathname), { timeout: T }).catch(() => {});
  await person.settle();
  return noteOk;
}

/**
 * One variant's run: the requester starts the case, «مرحلهٔ فرم» reaches both holders of «مدیر گروه» (each finds it in
 * «کارتابل»; the second fills and sends it), the approval reaches both holders of «کارشناس ارشد» (the second approves),
 * and the case ends «انجام‌شده» with its journal.
 */
async function runVariant(v, req, heads, seniors, tag = "") {
  const V = VARIANTS[v];
  const values = { title: `پروژهٔ نوسازی شبکهٔ شعبه (${V.tag}${tag})`, kind: "سخت‌افزار", desc: "خرید و نصب سوییچ‌های تازه برای شعبه", due: "1405/10/20", unit: "شعب", tag };
  const caseId = await startCase(req, v, values);
  S[`case${v}${tag}`] = caseId;
  check(!!caseId, `${req.name} starts «${V.wf.name}» from «گردش‌کارها» and lands on the case page`, req.page.url());
  // «مرحلهٔ فرم» reaches the holders
  const d1 = await waitCase(req, caseId, (d) => openTasks(d, STEP2).length > 0 || Object.keys(d.waiting ?? {}).length > 0);
  const { text: t1, file: f1 } = await casePage(req, caseId, `run-${v}${tag}-case-step2`);
  const caseNo = d1?.case?.number ?? "";
  seen(`case ${caseNo}: ${t1.slice(0, 260)}`);
  const step2People = openTasks(d1, STEP2).map((t) => nameOf(d1, t.assigned_to));
  seen(`«${STEP2}» open tasks: ${JSON.stringify(step2People)}; waiting ${JSON.stringify(d1?.waiting ?? {})}`);
  const nobody1 = NOBODY.test(t1) || Object.keys(d1?.waiting ?? {}).length > 0;
  if (!check(!nobody1, `«کسی پیدا نشد» does not appear: «${STEP2}» reached the holders of «${V.roles.head.name}»`, t1.match(/[^.]{0,80}کسی پیدا نشد[^.]{0,120}/)?.[0] ?? JSON.stringify(d1?.waiting ?? {})))
    finding({ title: `«کسی پیدا نشد» on «${STEP2}» (variant ${v}${tag})`, expected: `«${STEP2}» goes to ${heads.map((h) => h.name).join(" and ")}`, seen: t1.match(/[^.]{0,80}کسی پیدا نشد[^.]{0,200}/)?.[0] ?? JSON.stringify(d1?.waiting), shot: f1, evidence: `case ${caseId}: ${JSON.stringify({ waiting: d1?.waiting, journal: (d1?.history?.journal ?? []).map((j) => j.body).slice(-4) })}` });
  for (const h of heads) check(step2People.some((n) => String(n).includes(h.name)) || t1.includes(h.name), `«${STEP2}» is assigned to ${h.name}`, JSON.stringify(step2People));
  // each holder of «مدیر گروه» finds it in «کارتابل»; the second opens, fills and sends it
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    await h.ensure();
    const { link, visible } = await inboxRow(h, caseNo, caseId);
    const file = await h.shot(`run-${v}${tag}-inbox-${i + 1}`);
    if (!check(visible, `${h.name} finds the case at «${STEP2}» in «کارتابل»`, await h.text("main")))
      finding({ title: `the step is not in the holder's «کارتابل» (variant ${v}${tag})`, expected: `${h.name}'s «کارتابل» lists ${caseNo} at «${STEP2}»`, seen: (await h.text("main")).slice(0, 300), shot: file });
    if (!visible) continue;
    await link.click();
    await h.page.waitForURL(/\/workflows\/c\/[0-9a-f-]{36}\/s\/[0-9a-f-]{36}/, { timeout: T });
    await h.settle();
    const st = await h.text("main");
    check(st.includes(STEP2) && /ارسال برای/.test(st), `${h.name} opens «${STEP2}»'s form`, st.slice(0, 200));
    if (i < heads.length - 1) {
      await h.shot(`run-${v}${tag}-step2-open-${i + 1}`);
      // a co-holder looks and leaves it to the other (whose submission closes this task: by design a candidate whose
      // task closed «دیگر لازم نیست» stops reading the case, src/server/modules/process/access/sources.ts)
      await h.go("workflows");
      continue;
    }
    const filled = await fillAndSubmitStep(h, v, caseId, `تأیید مدیر گروه برای ${V.tag}${tag}`, `run-${v}${tag}-step2-filled`);
    check(filled, `${h.name} fills «${V.fields.note}» in «${STEP2}»`);
    seen(`${h.name} sent «${STEP2}»`);
  }
  // the approval reaches «کارشناس ارشد»
  const d2 = await waitCase(PEOPLE.owner, caseId, (d) => openTasks(d, STEP3).length > 0 || Object.keys(d.waiting ?? {}).length > 0 || ended(d));
  const { text: t2, file: f2 } = await casePage(PEOPLE.owner, caseId, `run-${v}${tag}-case-step3`);
  const step3People = openTasks(d2, STEP3).map((t) => nameOf(d2, t.assigned_to));
  for (const h of seniors) check(step3People.some((n) => String(n).includes(h.name)), `«${STEP3}» is assigned to ${h.name}`, JSON.stringify(step3People));
  seen(`«${STEP3}» open tasks: ${JSON.stringify(step3People)}; waiting ${JSON.stringify(d2?.waiting ?? {})}`);
  const nobody2 = NOBODY.test(t2) || Object.keys(d2?.waiting ?? {}).length > 0;
  if (!check(!nobody2, `«کسی پیدا نشد» does not appear on «${STEP3}»`, t2.match(/[^.]{0,80}کسی پیدا نشد[^.]{0,120}/)?.[0] ?? ""))
    finding({ title: `«کسی پیدا نشد» on «${STEP3}» (variant ${v}${tag})`, expected: `«${STEP3}» goes to ${seniors.map((h) => h.name).join(" and ")}`, seen: t2.match(/[^.]{0,80}کسی پیدا نشد[^.]{0,200}/)?.[0] ?? JSON.stringify(d2?.waiting), shot: f2 });
  for (let i = 0; i < seniors.length; i++) {
    const h = seniors[i];
    await h.ensure();
    const { link, visible } = await inboxRow(h, caseNo, caseId);
    const file = await h.shot(`run-${v}${tag}-approver-inbox-${i + 1}`);
    if (!check(visible, `${h.name} finds the case at «${STEP3}» in «کارتابل»`, (await h.text("main")).slice(0, 300)))
      finding({ title: `the approval is not in the approver's «کارتابل» (variant ${v}${tag})`, expected: `${h.name}'s «کارتابل» lists ${caseNo} at «${STEP3}»`, seen: (await h.text("main")).slice(0, 300), shot: file });
    if (!visible) continue;
    await link.click();
    await h.page.waitForURL(/\/workflows\/c\/[0-9a-f-]{36}\/s\/[0-9a-f-]{36}/, { timeout: T });
    await h.settle();
    const st = await h.text("main");
    check(st.includes(STEP3), `${h.name} opens «${STEP3}»`, st.slice(0, 200));
    if (i < seniors.length - 1) {
      await h.shot(`run-${v}${tag}-step3-open-${i + 1}`);
      await h.go("workflows");
      continue;
    }
    await h.page.locator(".wfu-stepform textarea").last().fill("موافقت می‌شود").catch(() => {});
    await h.shot(`run-${v}${tag}-step3-approve`);
    await h.page.getByRole("group", { name: "تصمیم‌های مرحله" }).getByRole("button", { name: "تأیید", exact: true }).click();
    await h.page.waitForURL((u) => new RegExp(`/workflows/c/${caseId}$`).test(u.pathname), { timeout: T }).catch(() => {});
    await h.settle();
    seen(`${h.name} approved`);
  }
  // the end: «انجام‌شده», with its journal
  const d3 = await waitCase(req, caseId, ended);
  const { p: rp, text: t3 } = await casePage(req, caseId, `run-${v}${tag}-case-done`);
  await rp.getByRole("tab", { name: "تاریخچه" }).click().catch(() => {});
  await req.settle();
  const hist = await req.text("main");
  const fh = await req.shot(`run-${v}${tag}-case-history`);
  const journal = (d3?.history?.journal ?? []).map((j) => String(j.body ?? "").replace(/\s+/g, " "));
  seen(`state ${d3?.case?.state}/${d3?.case?.outcome ?? ""}; journal: ${journal.slice(0, 8).join(" ‖ ")}`);
  check(d3?.case?.state === "completed" && /انجام‌شده/.test(t3), `the case reaches its end «انجام‌شده»`, `${d3?.case?.state}; ${t3.slice(0, 160)}`);
  check(!journal.some((b) => NOBODY.test(b)) && !NOBODY.test(hist), "the journal has no «کسی پیدا نشد»", journal.join(" ‖ ").slice(0, 500));
  const tasks = (d3?.history?.tasks ?? []).map((t) => `${t.step_label ?? t.step_key}: ${t.status}/${t.outcome ?? ""} ${nameOf(d3, t.acted_by ?? t.assigned_to)}`);
  seen(`tasks: ${tasks.join(" ‖ ")}`);
  check(tasks.some((x) => x.startsWith(STEP2) && /submitted/.test(x)) && tasks.some((x) => x.startsWith(STEP3) && /approved/.test(x)), "the history has «مرحلهٔ فرم» sent and the approval approved", tasks.join(" ‖ "));
  // the requester's «انجام‌شده‌ها» / case list shows it ended
  return { caseId, caseNo, journal, history: fh };
}

// ---------------------------------------------------------------- variant C
async function variantC() {
  const o = PEOPLE.owner;
  const V = VARIANTS.A;
  const values = { title: "پروژهٔ مالک (ج)", kind: "نرم‌افزار", desc: "پروندهٔ واقعی مالک روی گردش‌کار الف", due: "1405/11/05", unit: "شعب", tag: "C" };
  const caseId = await startCase(o, "A", values);
  S.caseC = caseId;
  check(!!caseId, `the owner starts «${V.wf.name}» (A) and lands on the case page`);
  const d = await waitCase(o, caseId, (x) => Object.keys(x.waiting ?? {}).length > 0 || openTasks(x).length > 0);
  const { p, text, file } = await casePage(o, caseId, "run-C-waiting-panel");
  const panel = ((await p.locator(".wfu-waiting").first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
  seen(`waiting: ${JSON.stringify(d?.waiting ?? {})}`);
  seen(`panel: ${panel}`);
  const w = Object.values(d?.waiting ?? {})[0];
  check(!!panel && NOBODY.test(panel), "the case page shows the waiting panel («کسی پیدا نشد» with what the managers were told)", panel || text.slice(0, 200));
  check(/حساب نمایشی/.test(panel) && (w?.notes ?? []).some((n) => /حساب نمایشی/.test(n)), "its reason names the pack's people («… حساب نمایشی‌اند …»)", JSON.stringify(w ?? {}));
  const reresolveButton = p.locator(".wfu-waiting").getByRole("button", { name: "دوباره پیدا کردن انجام‌دهنده" });
  check(await reresolveButton.isVisible().catch(() => false), "the panel offers «دوباره پیدا کردن انجام‌دهنده» to the owner (the cases' manager)");
  if (!panel) finding({ title: "no waiting panel on the owner's case of a pack-held role", expected: "«کسی پیدا نشد» with the reason and «دوباره پیدا کردن انجام‌دهنده»", seen: text.slice(0, 300), shot: file });
  // the owner adds a real holder to «مدیر گروه»
  const pos = await o.go(`settings/positions?position=${S.rolesA.head}`);
  const real = PEOPLE.extra;
  await addHolder(pos, o, real, { demo: false });
  await o.shot("run-C-real-holder-added");
  // «دوباره پیدا کردن انجام‌دهنده»
  const again = await waitCase(o, caseId, () => true, 1000);
  let given = openTasks(again).some((t) => t.assigned_to && (again.display?.[t.assigned_to] ?? "").includes(real.name));
  if (given) seen("the holder change gave the step to the new holder before the manager acted (the re-resolve job)");
  else {
    const cp = await o.go(`workflows/c/${caseId}`);
    const btn = cp.locator(".wfu-waiting").getByRole("button", { name: "دوباره پیدا کردن انجام‌دهنده" });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    else {
      await cp.getByRole("button", { name: "اقدام‌ها" }).click();
      await cp.getByRole("menuitem", { name: "دوباره پیدا کردن انجام‌دهنده" }).click();
    }
    const dlg = cp.getByRole("dialog").filter({ hasText: "دوباره پیدا کردن انجام‌دهنده" });
    await dlg.waitFor({ timeout: T });
    await o.shot("run-C-reresolve-dialog");
    const before = ((await dlg.innerText()) ?? "").replace(/\s+/g, " ");
    seen(`re-resolve dialog: ${before.slice(0, 300)}`);
    await dlg.getByRole("button", { name: "پیدا کردن" }).click();
    // what came of it replaces the question (the footer's button turns «بستن»; the corner's × is «بستن» too)
    const result = dlg.locator(".wfu-result");
    await result.waitFor({ timeout: T });
    const res = ((await result.innerText()) ?? "").replace(/\s+/g, " ");
    await o.shot("run-C-reresolve-result");
    seen(`re-resolve: ${res.slice(0, 300)}`);
    check(res.includes(real.name), `«دوباره پیدا کردن انجام‌دهنده» gives «${STEP2}» to ${real.name}`, res.slice(0, 300));
    await dlg.locator(".ant-modal-footer").getByRole("button", { name: "بستن" }).click();
    await o.settle();
  }
  const d2 = await waitCase(o, caseId, (x) => openTasks(x).length > 0);
  given = openTasks(d2).some((t) => (d2.display?.[t.assigned_to] ?? "").includes(real.name));
  check(given, `«${STEP2}» is ${real.name}'s now`, JSON.stringify(openTasks(d2).map((t) => d2.display?.[t.assigned_to])));
  // the holder completes it
  await real.ensure();
  const { link, visible } = await inboxRow(real, d2?.case?.number, caseId);
  await real.shot("run-C-holder-inbox");
  check(visible, `${real.name} finds the owner's case in «کارتابل»`);
  if (visible) {
    await link.click();
    await real.page.waitForURL(/\/s\/[0-9a-f-]{36}/, { timeout: T });
    await real.settle();
    await fillAndSubmitStep(real, "A", caseId, "تکمیل به دست دارندهٔ واقعی", "run-C-holder-step2");
  }
  const d3 = await waitCase(o, caseId, (x) => !openTasks(x).some((t) => (d2.display?.[t.assigned_to] ?? "").includes(real.name)) && (Object.keys(x.waiting ?? {}).length > 0 || openTasks(x).length > 0 || !!x.case?.ended_at));
  const done = (d3?.history?.tasks ?? []).find((t) => (d3.display?.[t.assigned_to] ?? "").includes(real.name) && t.status !== "open");
  check(!!done, `${real.name} completed «${STEP2}»`, JSON.stringify((d3?.history?.tasks ?? []).map((t) => [t.step_label ?? t.label, t.status, d3.display?.[t.assigned_to]])));
  const { text: t4 } = await casePage(o, caseId, "run-C-after-holder");
  seen(`after the holder: waiting ${JSON.stringify(d3?.waiting ?? {})}; ${t4.slice(0, 200)}`);
  // the approval's «کارشناس ارشد» is held by the pack's people only: the owner's real case waits there, with its reason
  if (Object.keys(d3?.waiting ?? {}).length) seen("as expected, «تأیید کارشناس ارشد» now waits on the owner's real case (its holders are the pack's people only)");
}

// ---------------------------------------------------------------- the purge
async function purge() {
  const o = PEOPLE.owner;
  // the pack's people are done: their accounts go with the pack (an open page of theirs would only poll into 401s)
  for (const k of Object.keys(PERSONAS)) await PEOPLE[`a_${k}`]?.close();
  const p = await o.go("settings/demo");
  await p.locator(".ds-ph-actions").getByRole("button", { name: "حذف کامل داده‌های نمایشی" }).click();
  const dlg = p.getByRole("dialog").filter({ hasText: "حذف کامل داده‌های نمایشی" });
  await dlg.getByLabel("عبارت تأیید").waitFor({ timeout: T * 3 });
  await o.settle();
  const text = ((await dlg.innerText()) ?? "").replace(/\s+/g, " ");
  const tables = await dlg.locator("table").evaluateAll((ts) => ts.map((t) => [...t.querySelectorAll("tbody tr.ant-table-row")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()).join(" · "))));
  const previewShot = await o.shot("purge-preview");
  await dlg.evaluate((d) => d.querySelector(".ant-modal-body")?.scrollTo(0, 10_000)).catch(() => {});
  await o.shot("purge-preview-lists");
  S.purgePreview = { text: text.slice(0, 2000), tables };
  seen(`preview: ${text.slice(0, 400)}`);
  for (const t of tables) seen(`list: ${t.slice(0, 12).join(" | ")}`);
  const cleaned = tables.flat().filter((r) => r.includes("گردش‌کار"));
  seen(`workflows in «تعریف‌هایی که پاک‌سازی می‌شوند»: ${JSON.stringify(cleaned)}`);
  check(/ردیف در/.test(text), "the preview counts the pack's rows and tables");
  check(cleaned.some((r) => r.includes(VARIANTS.A.wf.name)), `the preview lists A's workflow «${VARIANTS.A.wf.name}» among the definitions it cleans, retires or reviews`, JSON.stringify(cleaned));
  check(!cleaned.some((r) => r.includes(VARIANTS.B.wf.name)), `the preview leaves B's workflow «${VARIANTS.B.wf.name}» alone`, JSON.stringify(cleaned));
  // what the lists name: a person reads names, not ids
  const rawIds = tables.flat().filter((r) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(r));
  if (rawIds.length)
    finding({
      title: "the purge preview names rows it removes by raw ids («دارندگان نقش‌های سازمانی» → 01a2…-…)",
      expected: "«ثبت‌شده روی دادهٔ نمایشی؛ با آن حذف می‌شود» names what goes in words (the holder and the role), as it does for notices",
      seen: rawIds.join(" | ").slice(0, 400),
      shot: previewShot,
      where: "src/server/modules/demo/samples.ts sampleWords/rowWords (index.ts planReport's buckets, clean.ts labelOf): a row in words — its number and display, a reference by the referenced row's own display, a holder «… در «…»»",
    });
  await dlg.getByLabel("عبارت تأیید").fill("حذف کامل");
  await dlg.getByRole("button", { name: "حذف کامل", exact: true }).click();
  await o.until(async () => !(await dlg.isVisible()), "the purge dialog closes (the purge has started)");
  const t = Date.now();
  let st = null;
  let last = "";
  while (Date.now() - t < 45 * 60_000) {
    await sleep(5000);
    st = (await o.api("GET", `/o/${S.org}/demo`).catch(() => null))?.json;
    const label = `${st?.state} ${st?.progress?.done ?? ""}/${st?.progress?.total ?? ""} ${st?.progress?.label ?? ""}`;
    if (label !== last) log(`  purge: ${label}`);
    last = label;
    if (st && !["purging", "loaded"].includes(st.state)) break;
  }
  R.purgeSeconds = Math.round((Date.now() - t) / 1000);
  await p.reload({ waitUntil: "domcontentloaded" });
  await o.settle();
  const after = await o.text("main");
  await o.shot("purge-done");
  seen(`after ${R.purgeSeconds} s: ${after.slice(0, 200)}`);
  check(st?.state === "none" && /داده‌های نمایشی حذف شد/.test(after), `the purge ends; the page says «داده‌های نمایشی حذف شد» (${R.purgeSeconds} s)`, JSON.stringify(st ?? {}).slice(0, 300));
}

/** A page after the purge: no console error, no failed API call other than a 403, no crash screen, not empty. */
async function cleanPage(person, path, what, name) {
  person.probe.take();
  const p = await person.go(path, { full: true });
  await person.settle(30_000);
  const f = await p.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const texts = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.textContent ?? "").trim()).filter(Boolean);
    return {
      root: (document.getElementById("root")?.innerText ?? "").trim().length,
      crash: texts("[data-crash], .ant-result-error .ant-result-title, .ant-alert-error .ant-alert-title").slice(0, 3),
      failedState: texts("h1, .ds-empty-title, .ant-result-title").filter((t) => /بارگذاری انجام نشد|بارگذاری نشد|با خطا روبه‌رو شد|خطای غیرمنتظره|پیدا نشد$/.test(t)).slice(0, 3),
    };
  });
  const got = person.probe.take();
  const file = await person.shot(name);
  const bad = [...got.exceptions.map((x) => `uncaught ${x.split("\n")[0]}`), ...got.console.map((x) => `console ${x}`), ...got.failed, ...f.crash.map((x) => `crash ${x}`), ...f.failedState.map((x) => `state «${x}»`), ...(f.root ? [] : ["blank page"])];
  check(!bad.length, `${what} opens cleanly${got.forbidden.length ? ` (403: ${got.forbidden.join(", ")})` : ""}`, bad.join("; "));
  if (bad.length) finding({ title: `${what} after the purge: ${bad[0].slice(0, 100)}`, expected: "the page opens with no console error, no 4xx/5xx other than a 403, no crash screen", seen: bad.join("; ").slice(0, 600), shot: file, evidence: `page ${path}` });
  return { p, bad, file };
}

async function afterPurge() {
  const o = PEOPLE.owner;
  // the hub: B published, A per the 1.1.5 rule
  const { p: hub } = await cleanPage(o, "settings/workflows", "«گردش‌کارها» (the hub)", "after-purge-hub");
  const hubText = await o.text("main");
  const rowOf = async (name) => ((await hub.locator("tr").filter({ hasText: name }).first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
  const rowA = await rowOf(VARIANTS.A.wf.name);
  const rowB = await rowOf(VARIANTS.B.wf.name);
  seen(`hub A: ${rowA}`);
  seen(`hub B: ${rowB}`);
  const defA = (await o.api("GET", `/o/${S.org}/process/defs/${VARIANTS.A.wf.key}`)).json?.process ?? {};
  const defB = (await o.api("GET", `/o/${S.org}/process/defs/${VARIANTS.B.wf.key}`)).json?.process ?? {};
  seen(`A: ${defA.status}; B: ${defB.status}`);
  check(defB.status === "published" && hubText.includes(VARIANTS.B.wf.name), `B's workflow «${VARIANTS.B.wf.name}» is intact and published`, JSON.stringify(defB).slice(0, 200));
  check(["published", "retired"].includes(defA.status), `A's workflow follows the 1.1.5 rule (published and listed for review, or retired): ${defA.status}`, JSON.stringify(defA).slice(0, 200));
  // every workflow's designer, every form, the fields, the roles, the members, the demo page
  const procs = (await o.api("GET", `/o/${S.org}/process/hub`)).json;
  const ids = new Set([S.wfA, S.wfB]);
  for (const r of procs?.rows ?? []) if (r?.kind === "process" && r.id) ids.add(r.id);
  seen(`workflows left in the hub: ${(procs?.rows ?? []).filter((r) => r.kind === "process").map((r) => `${r.name} (${r.status})`).join("، ")}`);
  for (const id of ids) if (id) await cleanPage(o, `settings/workflows/p/${id}`, `the designer of workflow ${id === S.wfA ? "A" : id === S.wfB ? "B" : id}`, `after-purge-designer-${id === S.wfA ? "A" : id === S.wfB ? "B" : id.slice(0, 8)}`);
  await cleanPage(o, "settings/forms", "«فرم‌ها»", "after-purge-forms");
  for (const v of ["A", "B"]) if (S[`form${v}`]) await cleanPage(o, `settings/forms/${S[`form${v}`]}`, `form ${v}'s designer`, `after-purge-form-${v}`);
  await cleanPage(o, "settings/fields", "«فیلدها»", "after-purge-fields");
  await cleanPage(o, "settings/positions", "«نقش‌های سازمانی»", "after-purge-roles");
  for (const [v, rk] of [["A", "head"], ["A", "senior"], ["B", "head"], ["B", "senior"]]) {
    const id = S[`roles${v}`]?.[rk];
    if (!id) continue;
    const { p } = await cleanPage(o, `settings/positions?position=${id}`, `role ${VARIANTS[v].roles[rk].name}`, `after-purge-role-${v}-${rk}`);
    const rows = (await p.getByRole("dialog").locator("table tbody tr.ant-table-row").allInnerTexts().catch(() => [])).map((r) => r.replace(/\s+/g, " "));
    seen(`«${VARIANTS[v].roles[rk].name}» holders now: ${rows.join(" | ") || "none"}`);
    if (v === "A") check(!rows.some((r) => r.includes("نمایشی")), `«${VARIANTS[v].roles[rk].name}» keeps no pack holder`, rows.join(" | "));
    else check(rows.length === 2, `«${VARIANTS[v].roles[rk].name}» keeps its two real holders`, rows.join(" | "));
  }
  await cleanPage(o, "settings/users", "«کاربران و دسترسی‌ها»", "after-purge-members");
  await cleanPage(o, "settings/demo", "«داده‌های نمایشی»", "after-purge-demo-page");
  await cleanPage(o, "workflows", "the owner's «گردش‌کارها»", "after-purge-workflows");
  // B's finished case, intact and open
  if (S.caseB) {
    const { text } = await cleanPage(o, `workflows/c/${S.caseB}`, "B's finished case", "after-purge-case-B").then(async (r) => ({ ...r, text: await o.text("main") }));
    const d = (await o.api("GET", `/o/${S.org}/process/cases/${S.caseB}`)).json;
    seen(`B's case: ${d?.case?.state}; values ${JSON.stringify(d?.data ?? {}).slice(0, 200)}`);
    check(d?.case?.state === "completed" && /انجام‌شده/.test(text), "B's finished case is intact («انجام‌شده»)", d?.case?.state);
    check(String(JSON.stringify(d?.data ?? {})).includes("پروژهٔ نوسازی شبکهٔ شعبه"), "B's case keeps its values", JSON.stringify(d?.data ?? {}).slice(0, 200));
  }
  if (S.caseC) {
    const { p: cp, file } = await cleanPage(o, `workflows/c/${S.caseC}`, "the owner's case of A (C)", "after-purge-case-C");
    const d = (await o.api("GET", `/o/${S.org}/process/cases/${S.caseC}`)).json;
    seen(`C's case after the purge: ${d?.case?.state}; waiting ${JSON.stringify(d?.waiting ?? {})}; journal tail ${(d?.history?.journal ?? []).slice(-3).map((j) => j.body).join(" ‖ ")}`);
    // a real case that waits for people: what its panel says now that the pack's accounts and holders are gone
    const said = Object.values(d?.waiting ?? {}).flatMap((w) => [w?.message, ...(w?.notes ?? [])]).filter(Boolean).join(" ");
    const panel = ((await cp.locator(".wfu-waiting").first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
    if (/حساب نمایشی/.test(`${said} ${panel}`))
      finding({
        title: "after the purge, the owner's real case still waits with the pre-purge reason «… حساب نمایشی‌اند …»",
        expected: "with the pack's accounts and their holder rows gone, the waiting step of a real case says why now (the role has no holder) — no advice to start the case with a demo account, which no longer exists",
        seen: (panel || said).slice(0, 500),
        shot: file,
        evidence: `case ${S.caseC}: waiting ${JSON.stringify(d?.waiting ?? {}).slice(0, 600)}`,
        where: "src/server/modules/demo/clean.ts waitingStep: the purge looks again for kept cases' waiting rounds whose reasons or line name the pack's people, or whose rules reach removed rows (src/server/modules/process/reresolve reresolveRoundIn, as the organisation's re-resolution)",
      });
  }
  if (S.caseA) {
    const r = await o.api("GET", `/o/${S.org}/process/cases/${S.caseA}`);
    seen(`A's pack case after the purge: ${r.status}`);
    check(r.status === 404, "A's pack case went with the pack", String(r.status));
    o.probe.take(); // that 404 was the point
  }
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!FROM) {
    for (const f of readdirSync(OUT)) if (/^\d\d+-.*\.png$|^server\.log$|^REPORT\.md$|^summary\.json$|^state\.json$/.test(f)) rmSync(join(OUT, f), { force: true });
    rmSync(SESSIONS(), { recursive: true, force: true });
  } else if (existsSync(statePath())) {
    S = JSON.parse(readFileSync(statePath(), "utf8"));
    shotNo = readdirSync(OUT).filter((f) => /^\d\d+-.*\.png$/.test(f)).length;
  }
  browser = await chromium.launch();
  try {
    if (BASE_GIVEN) {
      BASE = BASE_GIVEN;
      R.limits.push(`server given (--base ${BASE}): started and set up elsewhere`);
    } else BASE = EDITION === "server" ? await startServerEdition() : EDITION === "web" ? await startWebEdition() : await startDesktop();
    R.base = BASE;
    S.base = BASE;
    // (the server edition's certificate is its own: read through Playwright, which is told to accept it)
    const rq = await pwRequest.newContext({ ignoreHTTPSErrors: true });
    const meta = await rq.get(`${BASE}/api/meta`).then((r) => r.json()).catch(() => null);
    await rq.dispose().catch(() => {});
    R.meta = meta ? { mode: meta.mode, edition: meta.edition, version: meta.version } : null;
    log(`server ${BASE} (${JSON.stringify(R.meta)})`);

    const owner = () => PEOPLE.owner ?? new Person("owner", OWNER);
    const persona = (k) => PEOPLE[`a_${k}`] ?? new Person(`a_${k}`, { name: S.personas[PERSONAS[k]].name, email: S.personas[PERSONAS[k]].email, password: S.demoPassword });
    const member = (k) => PEOPLE[k] ?? new Person(k, { ...MEMBERS[k], password: MEMBER_PASSWORD });

    await step("setup", "first run: the owner's account and the organisation (the edition's own setup screens)", async () => {
      if (!FROM) await setupOwner();
    });
    await step("owner-signin", "the owner signs in through the sign-in form", async () => {
      owner();
      await ownerSignIn();
    });
    owner();
    await step("demo-load", "«داده‌های نمایشی» → «بارگذاری دادهٔ نمایشی», waiting until it is loaded", demoLoad);
    await step("demo-signin", "«ورود با حساب‌های نمایشی» on; the personas and the shared password from the demo page", demoSignin);
    await step("members", "real members added on «کاربران و دسترسی‌ها» (variant B's requester and holders, C's later holder)", addMembers);
    for (const v of ["A", "B"]) {
      await step(`fields-${v}`, `«فیلدها»: library fields (text, choice, date, unit, long text) — variant ${v}`, () => makeFields(v));
      await step(`form-${v}`, `«فرم‌ها»: a process form with two tabs and a section in each — variant ${v}`, () => makeForm(v));
      const holders = v === "A" ? { head: [persona("head1"), persona("head2")], senior: [persona("senior1"), persona("senior2")] } : { head: [member("head1"), member("head2")], senior: [member("senior1"), member("senior2")] };
      await step(`roles-${v}`, `«نقش‌های سازمانی»: «${VARIANTS[v].roles.head.name}» and «${VARIANTS[v].roles.senior.name}» with two holders each — variant ${v}`, () => makeRoles(v, holders));
      await step(`workflow-${v}`, `the designer: start form, «${STEP2}» by «${VARIANTS[v].roles.head.name}» (default scope), «${STEP3}» by «${VARIANTS[v].roles.senior.name}», end; publish — variant ${v}`, () => makeWorkflow(v));
    }
    await step("run-A", "variant A (the owner's case): a demo persona requests, the pack's holders act; no «کسی پیدا نشد»", async () => {
      await runVariant("A", persona("req"), [persona("head1"), persona("head2")], [persona("senior1"), persona("senior2")]);
    });
    await step("run-B", "variant B: a real member requests, real holders act; no «کسی پیدا نشد»", async () => {
      await runVariant("B", member("req"), [member("head1"), member("head2")], [member("senior1"), member("senior2")]);
    });
    await step("run-C", "variant C: the owner starts A's workflow; the waiting panel's reason; a real holder added; «دوباره پیدا کردن انجام‌دهنده»; the holder completes the step", async () => {
      member("extra");
      await variantC();
    });
    await step("purge", "«حذف کامل داده‌های نمایشی»: the preview's lists, the typed confirmation, waiting until done", purge);
    await step("after-purge", "after the purge: B intact, A per the 1.1.5 rule, every workflow/form/field/roles/members/demo page clean", afterPurge);
    await step("after-purge-run-B", "after the purge: the owner starts B's workflow and its real holders finish it", async () => {
      await runVariant("B", owner(), [member("head1"), member("head2")], [member("senior1"), member("senior2")], "-owner");
    });
  } catch (e) {
    R.fatal = String(e?.stack ?? e).slice(0, 2000);
    log(`stopped: ${R.fatal.split("\n")[0]}`);
  } finally {
    for (const p of Object.values(PEOPLE)) await p.close();
    await browser?.close().catch(() => {});
    await stopAll().catch((e) => log(`stop: ${e.message}`));
    writeReport();
  }
  const failed = R.steps.filter((s) => !s.ok).length + (R.fatal ? 1 : 0);
  return failed || R.findings.length ? 1 : 0;
}

function writeReport() {
  R.finished = new Date().toISOString();
  R.seconds = Math.round((Date.now() - t0) / 1000);
  const summary = {
    edition: EDITION, base: R.base, meta: R.meta, org: R.org, started: R.started, finished: R.finished, seconds: R.seconds,
    demo_load_s: R.demoLoadSeconds ?? null, purge_s: R.purgeSeconds ?? null, fatal: R.fatal ?? null,
    steps: R.steps.map((s) => ({ id: s.id, title: s.title, ok: s.ok, seconds: s.seconds, seen: s.seen, checks: s.checks, issues: s.issues, shots: s.shots, error: s.error ?? null })),
    findings: R.findings, limits: R.limits, notes: R.notes,
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const L = [
    `# The owner's path, clicked through — ${EDITION}`,
    "",
    `- ${R.started} → ${R.finished} (${R.seconds} s); ${R.meta ? `${R.meta.mode} mode, ${R.meta.edition} edition, version ${R.meta.version}` : "no meta"}; ${R.base ?? "no server"}.`,
    `- Demo pack «${SIZE === "small" ? "کوچک" : SIZE}» loaded in ${R.demoLoadSeconds ?? "—"} s; purged in ${R.purgeSeconds ?? "—"} s.`,
    `- Steps: ${R.steps.filter((s) => s.ok).length}/${R.steps.length} passed${R.fatal ? `; **stopped early:** ${esc(R.fatal.split("\n")[0])}` : ""}. Findings: ${R.findings.length}.`,
    "",
    "## Steps",
    "",
    "| Step | Edition | Result | What was seen | Screenshots |",
    "|---|---|---|---|---|",
    ...R.steps.map((s) => `| ${s.id}: ${esc(s.title)} | ${EDITION} | ${s.ok ? "pass" : "**FAIL**"} (${s.seconds} s) | ${esc([...s.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.what}${!c.ok && c.detail ? ` — ${c.detail}` : ""}`), ...s.seen.map((x) => `· ${x}`), ...(s.error ? [`error: ${s.error.split("\n")[0]}`] : [])].join("\n"))} | ${s.shots.map((f) => `[${f}](${f})`).join("<br>")} |`),
    "",
    "## Browser issues per step",
    "",
    ...R.steps.filter((s) => s.issues.length).map((s) => `- ${s.id}: ${esc(s.issues.slice(0, 12).join("; "))}`),
    ...(R.steps.some((s) => s.issues.length) ? [] : ["None."]),
    "",
    "## Findings",
    "",
    ...(R.findings.length ? R.findings.flatMap((f, i) => [`### ${i + 1}. ${f.title}`, "", `- Edition: ${f.edition}; step: ${f.step}${f.known ? `; known: ${f.known}` : ""}`, `- Expected: ${f.expected}`, `- Seen: ${f.seen}`, ...(f.where ? [`- Where: ${f.where}`] : []), "", "```", f.evidence, "```", ""]) : ["None."]),
    "",
    ...(R.limits.length ? ["## Limits", "", ...R.limits.map((x) => `- ${x}`), ""] : []),
  ];
  writeFileSync(join(OUT, "REPORT.md"), L.join("\n"));
  log(`report ${join(OUT, "REPORT.md")}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let code = 1;
  try {
    code = await main();
  } catch (e) {
    console.error(e?.stack ?? e);
  }
  process.exit(code);
}
