// Visual QA of the platform's pages. Builds the UI and starts the local (Windows-flavour) server on a fresh data dir —
// or uses a server that is already running (--base) — makes sure there is an owner, an organisation and a second
// member (through the API: first-run sign-up, or sign-in), signs in through the login form with Playwright and
// screenshots every page in light and dark (1440 × 900) plus a phone (375 × 812). Writes PNGs and report.json (console
// errors, page errors, failed API calls, horizontal scroll per page) into the output folder and exits with 1 when any
// page has a problem.
//
//   node scripts/ui-shots.mjs [--base http://127.0.0.1:3939] [--email … --password …] [--port 4102] [--out <dir>]
//        [--paths a,b,c] [--themes light,dark] [--mobile a,b | --no-mobile] [--no-build] [--keep-server]
//
// Paths are relative to the organisation (`settings/users`, `` for the home page) unless they start with `/`
// (`/login`, `/orgs`, `/admin`). `{org}` is replaced by the organisation's id, `{todo}` by a demo «کار» record. A path
// ending in `@ai` opens the assistant (Ctrl J) before the screenshot. Default: every route of
// src/ui/modules/*/index.tsx without parameters, the AI settings tabs, the assistant, the record UI's generic pages
// on the demo `todo` table (list, board, calendar, timeline, a record, a new record, the generic `r/:table` routes and
// the designers), /login, /orgs, the organisation wizard and the /admin console. Demo records are created once
// through the API (states, priorities, due dates, tags, a reply, a work note, a link, a saved view).
//
// Internal: `tsx scripts/ui-shots.mjs --serve-internal <dataDir> <port> <staticDir>` runs the server.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

// ---------------------------------------------------------------- internal server mode
if (process.argv[2] === "--serve-internal") {
  const [dataDir, port, staticDir] = process.argv.slice(3);
  const { startLocal } = await import(pathToFileURL(join(ROOT, "src/desktop/server.ts")).href);
  const server = await startLocal({ dataDir, staticDir, port: Number(port) });
  console.log(`ready ${server.url}`);
  const stop = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const list = (v) => (v === undefined ? undefined : v.split(",").map((x) => x.trim()).filter((x, i, a) => a.indexOf(x) === i));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const BASE = opt("base") ? opt("base").replace(/\/+$/, "") : null;
const PORT = Number(opt("port", "4102"));
const OUT = resolve(opt("out", join(tmpdir(), "itsm-ui-shots", stamp)));
const THEMES = list(opt("themes", "light,dark"));
const NO_BUILD = flag("no-build");
const OWNER = { email: opt("email", "owner@example.com"), password: opt("password", "Owner-pass-1405"), full_name: "سارا محمدی" };
const MEMBER = { email: "member@example.com", full_name: "علی رضایی", role: "member", password: "Member-pass-1405" };
const ORG = { name: "واحد فناوری اطلاعات نمونه", timezone: "Asia/Tehran" };
const MOBILE_DEFAULT = ["/login", "/orgs", "", "settings/users", "settings/ai", "help", "/admin", "@ai", "todo", "todo?mode=board", "todo?mode=calendar", "todo/{todo}", "todo/new", "settings/forms?table=todo"];
const MOBILE = flag("no-mobile") ? [] : list(opt("mobile")) ?? MOBILE_DEFAULT;
const THEME_KEY = "itsm.theme";

for (const t of THEMES) if (!["light", "dark"].includes(t)) throw new Error(`unknown theme ${t}`);

const t0 = Date.now();
const log = (...a) => console.log(`[ui-shots ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

function run(cmd, args, { env = {}, cwd = ROOT, logFile } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const sink = logFile ? createWriteStream(logFile) : null;
    p.stdout.on("data", (d) => ((out += d), sink?.write(d)));
    p.stderr.on("data", (d) => ((out += d), sink?.write(d)));
    p.on("error", fail);
    p.on("close", (code) => {
      sink?.end();
      code === 0 ? ok(out) : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}\n${out.slice(-3000)}`));
    });
  });
}

// ---------------------------------------------------------------- default paths
function defaultPaths(desktop) {
  const mod = join(ROOT, "src/ui/modules");
  const paths = new Set([""]);
  for (const dir of readdirSync(mod)) {
    const f = join(mod, dir, "index.tsx");
    if (!existsSync(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/\bpath:\s*"([^"]*)"/g)) if (!m[1].includes(":") && !m[1].includes("?")) paths.add(m[1]);
  }
  if (!desktop) paths.delete("settings/desktop");
  const tabs = ["settings/ai?tab=jobs", "settings/ai?tab=features", "settings/ai?tab=usage", "settings/ai?tab=activity"];
  const records = [
    "todo?mode=board", "todo?mode=calendar", "todo?mode=timeline", "todo?group=state", "todo/{todo}", "todo/new",
    "r/todo", "r/view", "r/custom_field", "r/todo/{todo}", "settings/fields?table=todo", "settings/forms?table=todo", "settings/choices?list=todo.category",
  ];
  const admin = ["/admin", "/admin/orgs", "/admin/orgs/{org}", "/admin/users", "/admin/ai", "/admin/security", "/admin/health"];
  return [...[...paths].sort((a, b) => a.localeCompare(b)), ...tabs, ...records, "@ai", "/login", "/orgs", "/orgs/new", ...admin];
}

// ---------------------------------------------------------------- server
let server = null;
let dataDir = null;
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (flag("keep-server")) {
    log(`server left running (pid ${server.pid})`);
    return;
  }
  await new Promise((ok) => {
    const timer = setTimeout(() => (server.kill("SIGKILL"), ok()), 15000);
    server.once("exit", () => (clearTimeout(timer), ok()));
    server.kill("SIGTERM");
  });
  log("server stopped");
}

async function startServer() {
  let staticDir = join(tmpdir(), "itsm-ui-shots-build");
  if (!NO_BUILD) {
    log(`building UI into ${staticDir}`);
    await run(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], { env: { ITSM_UI_OUT: staticDir }, logFile: join(OUT, "build.log") });
  } else if (!existsSync(join(staticDir, "index.html"))) {
    staticDir = join(ROOT, "public");
  }
  if (!existsSync(join(staticDir, "index.html"))) throw new Error(`no index.html in ${staticDir}`);
  dataDir = mkdtempSync(join(tmpdir(), "itsm-ui-shots-data-"));
  log(`starting server on port ${PORT} (data ${dataDir})`);
  const serverLog = createWriteStream(join(OUT, "server.log"));
  server = spawn(TSX, [fileURLToPath(import.meta.url), "--serve-internal", dataDir, String(PORT), staticDir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("server did not start within 90 s (see server.log)")), 90000);
    let buf = "";
    server.stdout.on("data", (d) => {
      serverLog.write(d);
      buf += d;
      const m = buf.match(/ready (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    });
    server.stderr.on("data", (d) => serverLog.write(d));
    server.on("exit", (code) => fail(new Error(`server exited with ${code} (see server.log)`)));
  });
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(OUT, { recursive: true });
  log(`output ${OUT}`);
  const url = BASE ?? (await startServer());
  log(`server ${url}`);

  // owner (first run: sign-up makes the platform admin), organisation and a second member
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${url}/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const meta = await call("GET", "/meta");
  if (meta.first_run) await call("POST", "/auth/signup", { ...OWNER });
  else await call("POST", "/auth/login", { email: OWNER.email, password: OWNER.password });
  const orgs = (await call("GET", "/orgs")).orgs;
  const orgId = orgs.find((o) => o.name === ORG.name)?.id ?? (await call("POST", "/orgs", ORG)).id;
  const members = (await call("GET", `/o/${orgId}/members`)).members;
  if (!members.some((m) => m.email === MEMBER.email)) await call("POST", `/o/${orgId}/members`, MEMBER);
  log(`owner ${OWNER.email}, organisation ${orgId}, ${meta.mode} mode`);
  const todoId = await seedTodos(call, orgId);
  log(`demo «کار» records ready (${todoId})`);
  const fill = (p) => p.replace(/\{org\}/g, orgId).replace(/\{todo\}/g, todoId);

  const requested = (list(opt("paths")) ?? defaultPaths(meta.mode === "desktop")).map(fill);
  const target = (p) => {
    const [page, ai] = p.endsWith("@ai") ? [p.slice(0, -3), true] : [p, false];
    return { href: page.startsWith("/") ? page : `/${orgId}${page ? `/${page}` : ""}`, auth: !/^\/(login|setup|recover|signup)\b/.test(page), ai };
  };

  const require = createRequire(join(ROOT, "package.json"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const report = { started: new Date(t0).toISOString(), url, org_id: orgId, owner: OWNER.email, mode: meta.mode, out: OUT, pages: [] };

  // sign in once through the login form, keep the session for every context
  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR", timezoneId: "Asia/Tehran" });
  const lp = await loginCtx.newPage();
  await lp.goto(`${url}/login`);
  await lp.locator('input[autocomplete="username"]').fill(OWNER.email, { timeout: 20000 });
  await lp.locator('input[autocomplete="current-password"]').fill(OWNER.password);
  await lp.locator('button[type="submit"]').click();
  await lp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  log(`signed in through the login form → ${new URL(lp.url()).pathname}`);
  const storageState = await loginCtx.storageState();
  await loginCtx.close();

  const jobs = [];
  for (const theme of THEMES) for (const p of requested) jobs.push({ path: p, ...target(p), variant: "desktop", theme, viewport: { width: 1440, height: 900 } });
  for (const theme of THEMES) for (const p of MOBILE.map(fill)) jobs.push({ path: p, ...target(p), variant: "mobile", theme, viewport: { width: 375, height: 812 } });
  log(`${jobs.length} screenshots to take`);

  const contexts = new Map();
  async function contextFor(job) {
    const key = `${job.variant}|${job.theme}|${job.auth}`;
    if (!contexts.has(key)) {
      const ctx = await browser.newContext({
        viewport: job.viewport,
        deviceScaleFactor: 1,
        isMobile: job.variant === "mobile",
        hasTouch: job.variant === "mobile",
        locale: "fa-IR",
        timezoneId: "Asia/Tehran",
        colorScheme: job.theme,
        storageState: job.auth ? storageState : undefined,
      });
      await ctx.addInitScript(({ key: k, theme, org }) => {
        try {
          localStorage.setItem(k, theme);
          localStorage.setItem("itsm.lastOrg", org);
        } catch {}
      }, { key: THEME_KEY, theme: job.theme, org: orgId });
      contexts.set(key, ctx);
    }
    return contexts.get(key);
  }

  let n = 0;
  for (const job of jobs) {
    n++;
    const entry = { path: job.path, href: job.href, variant: job.variant, theme: job.theme, file: null, final_url: null, console_errors: [], page_errors: [], failed_requests: [], flags: [] };
    const ctx = await contextFor(job);
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") entry.console_errors.push(m.text().slice(0, 800));
    });
    page.on("pageerror", (e) => entry.page_errors.push(String(e?.stack ?? e).slice(0, 1500)));
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/") || r.status() < 400) return;
      // signed-out pages ask who is signed in (401 is the answer)
      if (!job.auth && r.status() === 401) return;
      entry.failed_requests.push({ status: r.status(), method: r.request().method(), url: u.pathname + u.search });
    });
    try {
      await page.goto(`${url}${job.href}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForFunction(() => !document.querySelector("#root > .boot") && !document.querySelector(".ant-skeleton"), null, { timeout: 15000 }).catch(() => entry.flags.push("still loading"));
      if (job.ai) {
        await page.keyboard.press("Control+KeyJ");
        await page.waitForTimeout(900);
      }
      await page.waitForTimeout(350);
      entry.final_url = new URL(page.url()).pathname + new URL(page.url()).search;
      const facts = await page.evaluate(() => ({ hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, text: (document.getElementById("root")?.innerText ?? "").trim().length }));
      if (facts.hscroll) entry.flags.push("horizontal scroll");
      if (!facts.text) entry.flags.push("empty page");
      const slug = `${job.variant}-${job.theme}-${(job.path || "home").replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "root"}`;
      entry.file = `${slug}.png`;
      await page.screenshot({ path: join(OUT, entry.file) });
    } catch (e) {
      entry.page_errors.push(`navigation: ${String(e?.message ?? e).split("\n")[0]}`);
    }
    // a 401 logged by the browser for the signed-out pages' «who am I» is expected
    if (!job.auth) entry.console_errors = entry.console_errors.filter((m) => !/status of 401/.test(m));
    entry.ok = !entry.console_errors.length && !entry.page_errors.length && !entry.failed_requests.length && !entry.flags.length;
    report.pages.push(entry);
    log(`${String(n).padStart(3)}/${jobs.length} ${entry.ok ? "ok " : "ERR"} ${job.variant}/${job.theme} ${job.href}${job.ai ? " @ai" : ""}${entry.ok ? "" : ` ${JSON.stringify({ console: entry.console_errors, page: entry.page_errors, failed: entry.failed_requests.map((r) => `${r.status} ${r.method} ${r.url}`), flags: entry.flags })}`}`);
    await page.close();
  }
  await browser.close();

  const bad = report.pages.filter((p) => !p.ok);
  report.summary = { pages: report.pages.length, ok: report.pages.length - bad.length, problems: bad.map((p) => ({ variant: p.variant, theme: p.theme, href: p.href, console_errors: p.console_errors, page_errors: p.page_errors, failed: p.failed_requests, flags: p.flags })) };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  log(`${report.summary.ok}/${report.summary.pages} pages without problems; report.json in ${OUT}`);
  return bad.length ? 1 : 0;
}

/**
 * Demo records of the engine's `todo` table for the record UI's pages: created once (the first run of a data dir),
 * then reused. Returns the id of the record the record-page screenshots open.
 */
async function seedTodos(call, orgId) {
  const base = `/o/${orgId}/r/todo`;
  const have = await call("POST", `${base}/query`, { q: "چاپگر طبقهٔ سوم", size: 1, total: false });
  if (have.rows.length) return have.rows[0].id;
  const me = (await call("GET", "/auth/me")).user.id;
  const other = (await call("GET", `/o/${orgId}/members`)).members.find((m) => m.email === MEMBER.email)?.user_id ?? null;
  const day = (d, h = 9) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) + `T${String(h - 3).padStart(2, "0")}:30:00.000Z`;
  const rows = [
    { short_description: "چاپگر طبقهٔ سوم کاغذ گیر می‌کند", priority: "2", assigned_to: me, due_at: day(1, 10), tags: ["سخت‌افزار", "چاپگر"], estimate: "2.5", description: "از صبح **سه بار** کاغذ گیر کرده است.\n\n- مدل: HP M404\n- محل: اتاق ۳۱۲" },
    { short_description: "تمدید گواهی SSL درگاه", priority: "1", assigned_to: me, due_at: day(-1, 11), tags: ["امنیت"], estimate: "1" },
    { short_description: "نصب نرم‌افزار حسابداری برای واحد مالی", priority: "3", assigned_to: other, due_at: day(3, 14), estimate: "4" },
    { short_description: "پشتیبان‌گیری هفتگی سرور پرونده‌ها", priority: "4", due_at: day(5, 9), tags: ["نگهداری"] },
    { short_description: "جلسهٔ هماهنگی با تأمین‌کنندهٔ اینترنت", priority: "3", assigned_to: me, due_at: day(0, 15), category: "meeting" },
    { short_description: "گزارش ماهانهٔ رخدادها", priority: "4", due_at: day(9, 12), category: "report" },
  ];
  const ids = [];
  for (const r of rows) ids.push((await call("POST", base, { ...r, watch_list: [me] })).row.id);
  const tr = async (id, to, data = {}) => call("POST", `${base}/${id}/transition`, { to, data });
  await tr(ids[0], "in_progress");
  await tr(ids[2], "on_hold");
  await tr(ids[3], "resolved", { close_code: "solved", close_notes: "پشتیبان کامل شد." });
  await tr(ids[4], "in_progress");
  await call("POST", `${base}/${ids[0]}/journal`, { kind: "comment", body: "سلام؛ کارشناس فنی امروز سر می‌زند و غلتک را بررسی می‌کند." });
  await call("POST", `${base}/${ids[0]}/journal`, { kind: "work_note", body: "غلتک ورودی ساییده شده؛ قطعهٔ یدکی در انبار هست." });
  await call("PATCH", `${base}/${ids[0]}`, { priority: "1" });
  await call("POST", `${base}/${ids[0]}/links`, { kind: "related", table: "todo", id: ids[1] });
  await call("POST", `/o/${orgId}/r/view`, { table_key: "todo", name: "فوری‌های باز", shared: true, filter: { and: [{ f: "priority", op: "in", v: ["1", "2"] }, { f: "active", op: "eq", v: true }] }, sort: "-priority", columns: ["number", "short_description", "state", "priority", "assigned_to", "due_at"] });
  return ids[0];
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(e?.stack ?? e);
} finally {
  await stopServer();
  if (dataDir && !flag("keep-server")) rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
