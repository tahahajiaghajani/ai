// Click-through QA of every screen (docs/qa/CLICKTHROUGH.md). Builds the UI and starts the Windows-flavour local server
// on PGlite with a fresh data dir — the same runtime the owner uses, started through `scripts/ui-shots.mjs
// --serve-internal` — or uses a server that is already running (--base). Makes sure there is an owner (the platform
// administrator), an organisation (seeded like every new organisation) and two members — an IT agent (access preset
// «کارشناس پشتیبانی») and a requester («درخواست‌دهنده») — then signs in through the login form as each of them.
//
// The routes come from the UI registry itself (src/ui/modules/registry.tsx, bundled with esbuild for Node): every
// route every module registers, the record lists' «… تازه» forms and record pages, the requester portal's nested
// pages (src/ui/modules/portal/Shell.tsx), the platform owner's console (src/ui/pages/admin/Admin.tsx), the
// sign-in-free pages and the account pages. As the administrator the crawler visits every route; as the agent and the
// requester it visits what their sidebar shows them (the registry's nav filtered by their own access, the way the
// shell filters it), their home page and the portal.
//
// On each page it records console errors, uncaught exceptions, crash screens, failed API calls (4xx/5xx; a 403 is
// expected only for a role that does not own the page), «صفحه پیدا نشد» / not-found and load-failed states, loaders
// still spinning after 15 s and, at phone width (390 px), horizontal overflow of the main pages. On record lists it
// clicks «… تازه» (the new-record form must render) and opens the first record (the record page, every tab and the
// side panels must render). On other pages it clicks the primary header action and the first link of the page.
//
// Writes docs/qa/CLICKTHROUGH.md (route, role, result, issue) and docs/qa/clickthrough.json, and exits with 1 when a
// page has a problem.
//
//   node scripts/ui-crawl.mjs [--base http://127.0.0.1:3939] [--port 4103] [--out docs/qa] [--roles admin,agent,requester]
//        [--only <regex>] [--skip <regex>] [--no-build] [--no-records] [--no-actions] [--mobile main|all|none]
//        [--keep-server] [--quick] [--merge] [--from <route>] [--before <route>]
//
// --quick: the administrator's main pages of every space, the portal, the consoles and the sign-in pages, without
// record pages, header actions and phone widths, and the other roles' home pages (the CI smoke run, ~5 minutes). --merge: re-check some pages (--only) and keep the previous report's results for the others.
// --from / --before: only the administrator's pages from one route on / before one (a long run split in parts).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
// the UI build of this checkout, shared with scripts/ui-shots.mjs (one directory per project path)
const BUILD_DIR = join(tmpdir(), `itsm-ui-shots-build-${createHash("sha256").update(ROOT).digest("hex").slice(0, 12)}`);
const require = createRequire(join(ROOT, "package.json"));

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const QUICK = flag("quick");
const BASE = opt("base") ? opt("base").replace(/\/+$/, "") : null;
const PORT = Number(opt("port", "4103"));
const OUT = resolve(ROOT, opt("out", "docs/qa"));
const ROLES = (opt("roles", "admin,agent,requester") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = opt("only") ? new RegExp(opt("only")) : null;
const SKIP = opt("skip") ? new RegExp(opt("skip")) : null;
const RECORDS = !flag("no-records") && !QUICK;
const ACTIONS = !flag("no-actions") && !QUICK;
const MOBILE = opt("mobile", QUICK ? "none" : "main");
/** a loader still on screen after this long is «endless» */
const SPIN_MS = 15000;
const PASSWORD = "Crawl-pass-1405";
const USERS = {
  admin: { email: opt("email", "owner@example.com"), password: opt("password", "Owner-pass-1405"), full_name: "سارا محمدی" },
  agent: { email: "agent@example.com", password: PASSWORD, full_name: "رضا کارشناس", preset: "agent" },
  requester: { email: "requester@example.com", password: PASSWORD, full_name: "مریم درخواست‌دهنده", preset: "requester" },
};
const ORG = { name: "واحد فناوری اطلاعات نمونه", timezone: "Asia/Tehran" };
const ROLE_TITLE = { admin: "مدیر سامانه", agent: "کارشناس فناوری اطلاعات", requester: "درخواست‌دهنده", anonymous: "بی‌ورود" };

const t0 = Date.now();
const log = (...a) => console.log(`[ui-crawl ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

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

// ---------------------------------------------------------------- the routes, from the UI registry
/**
 * Bundles the registry (and the access helpers the shell filters the nav with) for Node and loads it: CSS and
 * images are empty modules, packages stay external (resolved from this checkout's node_modules).
 */
export async function loadRegistry() {
  const { build } = require("esbuild");
  // inside the checkout, so the bundle's packages resolve from its node_modules; one file per process
  const outfile = join(ROOT, "node_modules", ".cache", "ui-crawl", `registry-${process.pid}.cjs`);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    stdin: {
      contents: [
        `export { ROUTES, NAV, PUBLIC_ROUTES, SPACES } from "./src/ui/modules/registry";`,
        `export { gateAllows } from "./src/shared/access";`,
        `export { LEVEL_ORDER } from "./src/shared/permissions";`,
        `export { recordPath, newRecordPath, tablePath } from "./src/ui/records/extensions";`,
        `export { TABLES, tableDef } from "./src/shared/tables";`,
        `export { enterableOnCreate } from "./src/ui/records/model/policies";`,
      ].join("\n"),
      resolveDir: ROOT,
      loader: "ts",
      sourcefile: "ui-crawl-registry.ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".jpg": "empty", ".woff2": "empty", ".woff": "empty", ".ttf": "empty" },
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"' },
    logLevel: "error",
  });
  delete require.cache[outfile];
  const reg = require(outfile);
  rmSync(outfile, { force: true });
  const routes = reg.ROUTES.map((r) => r.path);
  const nav = reg.NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.key, groupModule: g.module, space: g.space })));
  // the requester portal's own pages (nested routes of `portal/*`)
  const shell = readFileSync(join(ROOT, "src/ui/modules/portal/Shell.tsx"), "utf8");
  const portal = [...new Set([...shell.matchAll(/<Route\s+path="([^"]*)"/g)].map((m) => m[1].replace(/\/?\*$/, "")))];
  // the platform owner's console (sections of src/ui/pages/admin/Admin.tsx)
  const adminSrc = readFileSync(join(ROOT, "src/ui/pages/admin/Admin.tsx"), "utf8");
  const admin = [...adminSrc.matchAll(/\{\s*key:\s*"([^"]*)",\s*title:\s*"[^"]*",\s*icon:\s*\w+(?:,\s*edition:\s*"(\w+)")?/g)].map((m) => ({ key: m[1], edition: m[2] ?? null }));
  return {
    routes, nav, publicRoutes: reg.PUBLIC_ROUTES.map((r) => r.path), portal, admin, gateAllows: reg.gateAllows, LEVEL_ORDER: reg.LEVEL_ORDER,
    tables: [...reg.TABLES.keys()], tableDef: reg.tableDef, enterableOnCreate: reg.enterableOnCreate, recordPath: reg.recordPath, newRecordPath: reg.newRecordPath, tablePath: reg.tablePath,
  };
}

/** Classifies the registered routes: record lists (they have `/new` and `/:id`), plain pages and parameterised ones. */
export function classify(routes) {
  const set = new Set(routes);
  const out = [];
  for (const p of routes) {
    if (p === "") continue;
    const kind = p.endsWith("/*") ? "nested" : /(^|\/):/.test(p) ? "param" : p.endsWith("/new") && set.has(p.slice(0, -4) + "/:id") ? "new" : set.has(`${p}/new`) && set.has(`${p}/:id`) ? "list" : "page";
    out.push({ path: p, kind });
  }
  return out;
}

// ---------------------------------------------------------------- server
let server = null;
let dataDir = null;
let workDir = null;
/** build and server logs of this run */
const work = () => (workDir ??= mkdtempSync(join(tmpdir(), "itsm-ui-crawl-")));
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
  let staticDir = BUILD_DIR;
  if (!flag("no-build")) {
    log(`building UI into ${staticDir}`);
    await run(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], { env: { ITSM_UI_OUT: staticDir }, logFile: join(work(), "build.log") });
  } else if (!existsSync(join(staticDir, "index.html"))) {
    staticDir = join(ROOT, "public");
  }
  if (!existsSync(join(staticDir, "index.html"))) throw new Error(`no index.html in ${staticDir}`);
  dataDir = mkdtempSync(join(tmpdir(), "itsm-ui-crawl-data-"));
  log(`starting the local server on port ${PORT} (PGlite, data ${dataDir})`);
  const serverLog = createWriteStream(join(work(), "server.log"));
  server = spawn(TSX, [join(ROOT, "scripts", "ui-shots.mjs"), "--serve-internal", dataDir, String(PORT), staticDir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`server did not start within 120 s (see ${join(work(), "server.log")})`)), 120000);
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
    server.on("exit", (code) => fail(new Error(`server exited with ${code} (see ${join(work(), "server.log")})`)));
  });
}

// ---------------------------------------------------------------- API set-up
function client(url, state = null) {
  // a browser session's cookie (storageState) or the one the first sign-in sets
  let cookie = (state?.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  return async function call(method, path, body) {
    const res = await fetch(`${url}/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)?.slice(0, 300)}`), { status: res.status });
    return data;
  };
}

/** A few records in the main operational tables, so «open the first record» has something to open (best effort). */
const SEED = [
  ["incident", { short_description: "قطع اینترنت شعبهٔ مرکزی", impact: "2", urgency: "2" }],
  ["problem", { short_description: "قطعی‌های تکراری سوییچ طبقهٔ دوم" }],
  ["change_request", { short_description: "ارتقای سیستم‌عامل سوییچ هسته", type: "normal" }],
  // planned dates inside the roadmap's default range, so its bar can be clicked
  ["release", { short_description: "انتشار نسخهٔ ۲.۴ سامانهٔ بانکداری اینترنتی", version_name: "2.4.0", planned_start: new Date(Date.now() + 2 * 86400000).toISOString(), planned_end: new Date(Date.now() + 9 * 86400000).toISOString() }],
  ["todo", { short_description: "تمدید گواهی SSL درگاه", priority: "2" }],
  ["kb_article", { title: "راهنمای اتصال به VPN", base_id: "{kb_base}" }],
  ["ci", { name: "SRV-CORE-01", class: "server" }],
];

async function seed(call, orgId, me) {
  const made = {};
  for (const [table, row] of SEED) {
    try {
      const have = await call("POST", `/o/${orgId}/r/${table}/query`, { size: 1, total: false });
      if (have.rows?.length) {
        made[table] = have.rows[0].id;
        continue;
      }
      // «{table}» stands for the first record of that table (an article's knowledge base)
      const filled = {};
      for (const [k, v] of Object.entries(row)) {
        const ref = typeof v === "string" && v.match(/^\{(\w+)\}$/);
        filled[k] = ref ? (await call("POST", `/o/${orgId}/r/${ref[1]}/query`, { size: 1, total: false })).rows[0]?.id ?? null : v;
      }
      made[table] = (await call("POST", `/o/${orgId}/r/${table}`, { ...filled, ...(table === "incident" ? { caller_id: me } : {}) })).row.id;
    } catch (e) {
      made[table] = `(${String(e.message).slice(0, 120)})`;
    }
  }
  return made;
}

async function ensureMember(call, orgId, u) {
  const members = (await call("GET", `/o/${orgId}/members`)).members;
  let m = members.find((x) => x.email === u.email);
  if (!m) {
    await call("POST", `/o/${orgId}/members`, { email: u.email, full_name: u.full_name, role: "member", password: u.password });
    m = (await call("GET", `/o/${orgId}/members`)).members.find((x) => x.email === u.email);
  }
  if (u.preset) await call("POST", `/o/${orgId}/access/members/${m.user_id}/preset`, { preset: u.preset });
  return m.user_id;
}

// ---------------------------------------------------------------- the browser side
const LOADERS = ".sh-boot, .sh-wait, .ds-loader, .ant-skeleton, .ant-spin-spinning, .sh-loader";
// page-level «not found» states (the org's 404, a record or table that is not there, a detail page's own); an empty
// search result («چیزی پیدا نشد», «داشبوردی پیدا نشد»: an indefinite noun) is not one
const NOT_FOUND = /^(?:(?!چیزی )(?![^ ]*ی پیدا نشد$)(?:این صفحه پیدا نشد|فهرست پیدا نشد|رکورد پیدا نشد|پیدا نشد|این جدول در دسترس نیست|این فهرست در دسترس نیست|دسترسی به این سازمان ممکن نیست|این [^ ]+ پیدا نشد|[^ ]+ پیدا نشد)|بازبینی پیدا نشد)$/;
const LOAD_FAILED = /بارگذاری انجام نشد|بارگذاری نشد|این بخش با خطا روبه‌رو شد|این صفحه با خطا روبه‌رو شد|خطای غیرمنتظره/;
// requests that stay open by design (live updates)
const LONG_LIVED = /\/(pulse|live|events\/stream|stream)(\?|$)/;

/** What the page shows now: crash, not-found and load-failed states, loaders, overflow. */
async function facts(page) {
  return page.evaluate(
    ({ loaders }) => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const texts = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.textContent ?? "").trim()).filter(Boolean);
      const root = document.getElementById("root");
      return {
        rootText: (root?.innerText ?? "").trim().length,
        headings: texts("h1, .sh-empty-t, .ds-empty-title, .ant-result-title").slice(0, 8),
        alerts: texts(".ant-alert-error .ant-alert-message, .ant-alert-error .ant-alert-title, .ant-result-error .ant-result-title, .ant-result-warning .ant-result-title, [data-crash]").slice(0, 5),
        loaders: [...document.querySelectorAll(loaders)].filter(vis).length,
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        width: document.documentElement.scrollWidth,
        path: location.pathname + location.search,
      };
    },
    { loaders: LOADERS },
  );
}

class Probe {
  constructor(page, role) {
    this.page = page;
    this.role = role;
    this.inflight = new Set();
    this.reset();
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      // a failed request is reported once, as a failed API call
      if (/^Failed to load resource: the server responded with a status of \d+/.test(t)) return;
      this.cur.console.push(t.slice(0, 600));
    });
    page.on("pageerror", (e) => this.cur.exceptions.push(String(e?.stack ?? e).slice(0, 1200)));
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && !LONG_LIVED.test(u.pathname + u.search)) this.inflight.add(r);
    });
    const done = (r) => this.inflight.delete(r);
    page.on("requestfinished", done);
    page.on("requestfailed", (r) => {
      done(r);
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && !LONG_LIVED.test(u.pathname) && !/aborted|cancel/i.test(r.failure()?.errorText ?? "")) this.cur.failed.push({ status: 0, method: r.method(), url: u.pathname + u.search, error: r.failure()?.errorText });
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/") || r.status() < 400) return;
      const entry = { status: r.status(), method: r.request().method(), url: u.pathname + u.search };
      // «who is signed in» on the signed-out pages answers 401
      if (r.status() === 401 && /\/api\/auth\/me$/.test(u.pathname) && this.role === "anonymous") return;
      if (r.status() === 403 && this.role !== "admin") this.cur.forbidden.push(entry);
      else this.cur.failed.push(entry);
    });
  }
  reset() {
    this.cur = { console: [], exceptions: [], failed: [], forbidden: [] };
  }
  take() {
    const c = this.cur;
    this.reset();
    return c;
  }
  /** Waits until no API call is open for 300 ms and no loader is on screen; false after SPIN_MS. */
  async settle(ms = SPIN_MS) {
    const until = Date.now() + ms;
    let quietSince = 0;
    while (Date.now() < until) {
      await this.page.waitForTimeout(100);
      let busy = this.inflight.size > 0;
      if (!busy) busy = await this.page.locator(LOADERS).first().isVisible().catch(() => false);
      if (busy) quietSince = 0;
      else if (!quietSince) quietSince = Date.now();
      else if (Date.now() - quietSince >= 300) return true;
    }
    return false;
  }
}

/** Client-side navigation (what a click on a link does); a full load when the app is not running. */
async function go(page, href, { full = false } = {}) {
  const alive = !full && (await page.evaluate(() => !!document.querySelector("#root > *") && !!window.history).catch(() => false));
  if (!alive) {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45000 });
    return;
  }
  await page.evaluate((h) => {
    window.history.pushState({}, "", h);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, new URL(href).pathname + new URL(href).search);
}

// ---------------------------------------------------------------- the crawl
const results = [];
/** the page a check belongs to (its visit), for --merge */
let target = "";
const norm = (s) => String(s ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id");
function record(entry) {
  entry.target = norm(target);
  const issues = [];
  const e = entry;
  if (e.exceptions?.length) issues.push(`uncaught exception: ${e.exceptions[0].split("\n")[0]}`);
  if (e.crash) issues.push(`crash screen: ${e.crash}`);
  if (e.notFound) issues.push(`not found: «${e.notFound}»`);
  if (e.loadFailed) issues.push(`load failed: «${e.loadFailed}»`);
  if (e.failed?.length) issues.push(`failed API: ${[...new Set(e.failed.map((f) => `${f.status} ${f.method} ${f.url.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/g, ":id")}`))].slice(0, 4).join("; ")}`);
  if (e.console?.length) issues.push(`console error: ${e.console[0].split("\n")[0].slice(0, 200)}`);
  if (e.spinning) issues.push("still loading after 15 s");
  if (e.blank) issues.push("blank page");
  if (e.overflow) issues.push(`horizontal overflow at 390 px (${e.overflow}px wide)`);
  if (e.extra?.length) issues.push(...e.extra);
  entry.issues = issues;
  entry.ok = !issues.length;
  results.push(entry);
  log(`${entry.ok ? "ok " : "ERR"} ${entry.role.padEnd(9)} ${entry.step.padEnd(7)} ${entry.route}${entry.ok ? "" : `  → ${issues.join(" | ")}`}`);
  return entry;
}

async function check(page, probe, base) {
  const settled = await probe.settle();
  const f = await facts(page);
  const c = probe.take();
  const heading = f.headings.find((h) => NOT_FOUND.test(h));
  const failedState = [...f.headings, ...f.alerts].find((h) => LOAD_FAILED.test(h));
  return {
    ...c,
    final: f.path,
    notFound: heading ?? null,
    loadFailed: failedState ?? null,
    crash: f.alerts.find((a) => /خطا/.test(a) && !LOAD_FAILED.test(a)) ?? null,
    spinning: !settled && f.loaders > 0,
    blank: f.rootText === 0,
    headings: f.headings,
    width: f.width,
    hscroll: f.hscroll,
    ...base,
  };
}

/** Clicks «… تازه» of a record list: the new-record form must render. */
async function clickNew(page, probe, url, role, route) {
  const btn = page.locator(".ds-ph-actions button").filter({ hasText: /تازه\s*$/ }).first();
  if (!(await btn.isVisible().catch(() => false))) return null;
  const label = ((await btn.textContent()) ?? "").trim();
  await btn.click({ timeout: 5000 }).catch(() => {});
  const r = await check(page, probe, { role, route: `${route} → «${label}»`, step: "new" });
  // a form: any field to fill in (record forms, the custom editors, a form in a dialog)
  const form = await page
    .locator("main form, main .ant-form, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main textarea, main [contenteditable=true], .ant-modal-content input, .ant-drawer-content input")
    .first()
    .isVisible()
    .catch(() => false);
  if (!form && !r.notFound) r.extra = ["the new-record form did not render"];
  return record(r);
}

/** Opens the first record of a list: the record page, each tab and the side panels must render. */
/** list href → the id of its first record (the parameterised pages under the list open it) */
const firstIds = new Map();
async function openFirst(page, probe, url, role, route) {
  const link = page.locator("main a.rk-open").first();
  if (!(await link.isVisible().catch(() => false))) return null;
  const id = ((await link.getAttribute("href").catch(() => null)) ?? "").split("?")[0].split("/").pop();
  if (id && !firstIds.has(route)) firstIds.set(route, id);
  await link.click({ timeout: 5000 }).catch(() => {});
  const r = await check(page, probe, { role, route: `${route} → first record`, step: "record" });
  const recPath = r.final;
  record(r);
  const tabs = page.locator("main .rk-tabs > .ant-tabs-nav .ant-tabs-tab");
  const n = await tabs.count().catch(() => 0);
  for (let i = 1; i < n; i++) {
    const tab = tabs.nth(i);
    const name = ((await tab.textContent().catch(() => "")) ?? "").trim();
    await tab.click({ timeout: 4000 }).catch(() => {});
    record(await check(page, probe, { role, route: `${recPath} → tab «${name}»`, step: "tab" }));
  }
  const panels = await page.locator("main .rk-side-card").count().catch(() => 0);
  return { recPath, tabs: n, panels };
}

/** Pages that are not record lists: the primary header action, then the first link of the page. */
async function clickActions(page, probe, url, role, route, href) {
  const primary = page.locator("main .ds-ph-actions .ant-btn-primary, #portal-main .ant-btn-primary").first();
  if (await primary.isVisible().catch(() => false)) {
    const label = ((await primary.textContent()) ?? "").trim().slice(0, 40);
    await primary.click({ timeout: 4000 }).catch(() => {});
    const r = await check(page, probe, { role, route: `${route} → «${label}»`, step: "action" });
    record(r);
    await page.keyboard.press("Escape").catch(() => {});
    await go(page, href);
    await probe.settle();
    probe.take();
  }
  // the first item of the page: a timeline bar, a board card or a calendar entry opens its record
  const item = page.locator("main .rk-tg-bar, main .rk-kcard, main .rk-cal-row").first();
  if (await item.isVisible().catch(() => false)) {
    const name = ((await item.getAttribute("aria-label").catch(() => null)) ?? (await item.textContent().catch(() => "")) ?? "").trim().slice(0, 40);
    await item.click({ timeout: 4000 }).catch(() => {});
    const r = await check(page, probe, { role, route: `${route} → item «${name}»`, step: "item" });
    if (r.final === new URL(href).pathname + new URL(href).search && !r.notFound) r.extra = ["clicking the item opened nothing"];
    record(r);
    await go(page, href);
    await probe.settle();
    probe.take();
  }
  // the first link into the app from the page's own content (not the shell's nav)
  // (not a file download from the API)
  const link = page.locator("main a[href^='/']:not(.rk-open):not([href^='/api/']):not([download]), #portal-main a[href^='/']:not([href^='/api/']):not([download])").first();
  if (await link.isVisible().catch(() => false)) {
    const target = await link.getAttribute("href");
    await link.click({ timeout: 4000 }).catch(() => {});
    record(await check(page, probe, { role, route: `${route} → link ${target}`, step: "link" }));
  }
}

async function signIn(url, u) {
  if (!B.browser?.isConnected()) await launch();
  const ctx = await B.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR", timezoneId: "Asia/Tehran" });
  const p = await ctx.newPage();
  await p.goto(`${url}/login`);
  await p.locator('input[autocomplete="username"]').fill(u.email, { timeout: 30000 });
  await p.locator('input[autocomplete="current-password"]').fill(u.password);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL((x) => !x.pathname.startsWith("/login"), { timeout: 30000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** The browser, relaunched when it dies (a busy machine's out-of-memory killer takes the biggest process). */
const B = { browser: null };
async function launch() {
  const { chromium } = require("playwright");
  B.browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"] });
  return B.browser;
}

/**
 * A tab of one role at one size that survives crashes: a dead tab is replaced, a dead context recreated, a dead
 * browser relaunched. A fresh tab every 40 pages keeps the renderer's memory down.
 */
function tabs(url, orgId, role, state, size) {
  let ctx = null;
  const tab = { page: null, probe: null, uses: 0 };
  tab.open = async () => {
    await tab.page?.close().catch(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!B.browser?.isConnected()) {
          ctx = null;
          await launch();
        }
        if (!ctx) {
          ctx = await B.browser.newContext({ ...size, locale: "fa-IR", timezoneId: "Asia/Tehran", storageState: state ?? undefined });
          await ctx.addInitScript((org) => {
            try {
              localStorage.setItem("itsm.lastOrg", org);
              localStorage.setItem("itsm.tour.done", "1");
            } catch {}
          }, orgId);
        }
        tab.page = await ctx.newPage();
        tab.probe = new Probe(tab.page, role);
        tab.uses = 0;
        return tab;
      } catch {
        await ctx?.close().catch(() => {});
        ctx = null;
      }
    }
    throw new Error("could not open a browser tab three times");
  };
  tab.next = async () => {
    if (!tab.page || tab.page.isClosed() || ++tab.uses >= 40) await tab.open();
    return tab;
  };
  tab.close = async () => {
    await ctx?.close().catch(() => {});
    ctx = null;
  };
  return tab;
}

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function crawlRole(url, orgId, role, state, targets, extra = {}) {
  const tab = tabs(url, orgId, role, state, DESKTOP);
  for (const t of targets) {
    const href = `${url}${t.href}`;
    target = t.href;
    let tries = 0;
    for (;;) {
      try {
        await tab.next();
        await visitOne(tab, t, href, role, url);
        break;
      } catch (e) {
        const msg = String(e?.message ?? e).split("\n")[0];
        // a renderer that died (out of memory on a busy machine) gets one more chance on a fresh tab
        await tab.open().catch(() => {});
        if (/crash|closed|disconnected/i.test(msg) && ++tries < 2) continue;
        record({ role, route: t.href, step: "visit", console: [], exceptions: [], failed: [], forbidden: [], extra: [`${tries ? "renderer crashed twice" : "crawler"}: ${msg}`] });
        break;
      }
    }
  }
  await tab.close();
  // phone width: horizontal overflow of the main pages (the desktop visit reports the page's own problems)
  if (extra.mobile?.length) {
    const ph = tabs(url, orgId, role, state, PHONE);
    for (const t of extra.mobile) {
      target = `390px ${t.href}`;
      try {
        await ph.next();
        await go(ph.page, `${url}${t.href}`);
        const r = await check(ph.page, ph.probe, { role, route: t.href, step: "390px" });
        record({ role, route: t.href, step: "390px", console: [], exceptions: r.exceptions, failed: [], forbidden: [], overflow: r.hscroll ? r.width : 0, blank: r.blank });
        if (r.blank) await ph.open();
      } catch (e) {
        await ph.open().catch(() => {});
        record({ role, route: t.href, step: "390px", console: [], exceptions: [], failed: [], forbidden: [], extra: [`crawler: ${String(e?.message ?? e).split("\n")[0]}`] });
      }
    }
    await ph.close();
  }
}

/** One page: visit it, then its «… تازه» and first record (lists) or its header action and first item (pages). */
async function visitOne(tab, t, href, role, url) {
  await go(tab.page, href, { full: t.full });
  const r = await check(tab.page, tab.probe, { role, route: t.href, step: "visit" });
  if (t.expectNotFound) {
    // the page's job is to say «not found»
    r.extra = r.notFound ? [] : ["expected the «not found» page"];
    r.notFound = null;
    record(r);
    return;
  }
  record(r);
  // a page that crashed leaves the app unmounted: the next one starts on a fresh tab
  if (r.blank || r.exceptions.length) return void (await tab.open());
  if (r.notFound) return;
  const { page, probe } = tab;
  if (t.kind === "list" && RECORDS) {
    if (await clickNew(page, probe, url, role, t.href)) {
      await go(page, href);
      await probe.settle();
      probe.take();
    }
    await openFirst(page, probe, url, role, t.href);
  } else if (t.kind === "page" && ACTIONS) {
    await clickActions(page, probe, url, role, t.href, href);
  }
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(OUT, { recursive: true });
  const reg = await loadRegistry();
  const classified = classify(reg.routes);
  log(`registry: ${reg.routes.length} routes (${classified.filter((r) => r.kind === "list").length} record lists), ${reg.nav.length} nav items, ${reg.publicRoutes.length} public pages, ${reg.portal.length} portal pages, ${reg.admin.length} console sections`);

  const url = BASE ?? (await startServer());
  const call = client(url);
  const meta = await call("GET", "/meta");
  if (meta.first_run) await call("POST", "/auth/signup", { ...USERS.admin });
  else await call("POST", "/auth/login", { email: USERS.admin.email, password: USERS.admin.password });
  const me = (await call("GET", "/auth/me")).user.id;
  const orgs = (await call("GET", "/orgs")).orgs;
  const orgId = orgs.find((o) => o.name === ORG.name)?.id ?? (await call("POST", "/orgs", ORG)).id;
  const ids = {};
  for (const role of ["agent", "requester"]) if (ROLES.includes(role)) ids[role] = await ensureMember(call, orgId, USERS[role]);
  const seeded = await seed(call, orgId, me);
  log(`${meta.mode} mode (${meta.edition}); organisation ${orgId}; seeded ${JSON.stringify(seeded)}`);

  const desktop = meta.mode === "desktop";
  const navOf = new Map(reg.nav.map((i) => [i.path, i]));
  const allowedHere = (p) => {
    const i = navOf.get(p);
    return !i || ((!i.desktopOnly || desktop) && (!i.cloudOnly || meta.mode === "cloud"));
  };
  const pick = (p) => (!ONLY || ONLY.test(p)) && (!SKIP || !SKIP.test(p));
  const orgHref = (p) => `/${orgId}${p ? `/${p}` : ""}`;

  await launch();
  const report = { started: new Date(t0).toISOString(), url, mode: meta.mode, edition: meta.edition, version: meta.version, org_id: orgId, seeded, roles: ROLES, routes: reg.routes.length };

  // whatever happens, the report gets what was checked
  try {
    // ------------------------------------------------ the administrator: every route
    if (ROLES.includes("admin")) {
      const state = await signIn(url, USERS.admin);
      log("signed in as the administrator through the login form");
      const targets = [{ href: orgHref(""), kind: "page", full: true }];
      // --quick: the main pages of every space (the sidebar's rows outside its «تعریف‌ها»/«گزارش‌ها» sections)
      const navPaths = new Set(reg.nav.filter((i) => !i.section && (!i.action || i.workspace)).map((i) => i.path));
      for (const r of classified) {
        if (!allowedHere(r.path) || !pick(r.path) || (QUICK && !navPaths.has(r.path))) continue;
        if (r.kind === "list" || r.kind === "page") targets.push({ href: orgHref(r.path), kind: r.kind });
        else if (r.kind === "nested") targets.push({ href: orgHref(r.path.slice(0, -2)), kind: "page" });
        else if (r.kind === "param" && r.path.startsWith("r/:table")) targets.push({ href: orgHref(r.path.replace(":table", "todo").replace("/:id", `/${seeded.todo}`)), kind: r.path === "r/:table" ? "list" : "page" });
      }
      for (const p of reg.portal) if (p && !p.includes(":") && pick(`portal/${p}`)) targets.push({ href: orgHref(`portal/${p}`), kind: "page" });
      for (const s of reg.admin) if (!s.edition || s.edition === meta.edition) if (pick(`/admin/${s.key}`)) targets.push({ href: s.key ? `/admin/${s.key}` : "/admin", kind: "page", full: true });
      targets.push({ href: `/admin/orgs/${orgId}`, kind: "page", full: true });
      for (const p of ["/orgs", "/orgs/new"]) if (pick(p)) targets.push({ href: p, kind: "page", full: true });
      // --from / --before: a slice of the administrator's pages in registry order (a run split in parts)
      const at = (k) => (opt(k) ? targets.findIndex((t) => t.href.endsWith(`/${opt(k)}`)) : -1);
      if (at("before") >= 0) targets.splice(at("before"));
      if (at("from") > 0) targets.splice(0, at("from"));
      log(`administrator: ${targets.length} pages`);
      const mobile = MOBILE === "none" ? [] : reg.nav.filter((i) => (MOBILE === "all" || !i.section) && (!i.action || i.workspace) && !i.path.includes(":") && allowedHere(i.path) && pick(i.path)).map((i) => ({ href: orgHref(i.path) }));
      await crawlRole(url, orgId, "admin", state, targets, { mobile: [{ href: "/login" }, ...mobile] });
      // parameterised pages under a record list (`incidents/:id/war-room`, `flows/:id/design`): the list's first record
      const params = classified.filter((r) => r.kind === "param" && !r.path.startsWith("r/:table") && !/\/:id$/.test(r.path) && pick(r.path));
      const deep = [];
      report.unreached = [];
      for (const r of params) {
        const m = r.path.match(/^(.*?)\/:id(\/.+)?$/);
        const id = m ? firstIds.get(orgHref(m[1])) : null;
        if (id) deep.push({ href: orgHref(`${m[1]}/${id}${m[2] ?? ""}`), kind: "page" });
        else report.unreached.push(r.path);
      }
      if (deep.length && RECORDS) {
        log(`administrator: ${deep.length} pages under records`);
        await crawlRole(url, orgId, "admin", state, deep);
      }
    }

    // ------------------------------------------------ the agent and the requester: what their sidebar shows them
    for (const role of ["agent", "requester"]) {
      if (!ROLES.includes(role)) continue;
      const state = await signIn(url, USERS[role]);
      const rc = client(url, state);
      const info = await rc("GET", `/o/${orgId}`);
      const perms = info.member?.permissions ?? {};
      const can = (area, level = "view") => reg.LEVEL_ORDER.indexOf(perms[area] ?? "none") >= reg.LEVEL_ORDER.indexOf(level);
      const has = (m) => (info.org?.modules ?? []).includes(m);
      const visible = reg.nav.filter(
        (i) => (!i.groupModule || has(i.groupModule)) && (!i.module || has(i.module)) && (!i.area || can(i.area, i.level ?? "view")) && (!i.access || reg.gateAllows(info.access?.grants, i.access)) && allowedHere(i.path) && !i.path.includes(":"),
      );
      log(`${role}: persona ${info.access?.persona}, ${visible.length} nav items visible`);
      const lists = new Set(classified.filter((r) => r.kind === "list").map((r) => r.path));
      const targets = [{ href: orgHref(""), kind: "page", full: true }];
      if (!QUICK) {
        for (const i of visible) if (pick(i.path)) targets.push({ href: orgHref(i.path), kind: lists.has(i.path) ? "list" : "page" });
        for (const p of reg.portal) if (p && !p.includes(":") && pick(`portal/${p}`)) targets.push({ href: orgHref(`portal/${p}`), kind: "page" });
      }
      const mobile = MOBILE === "none" || QUICK ? [] : [{ href: orgHref("") }, { href: orgHref("portal") }, ...visible.filter((i) => !i.section && (!i.action || i.workspace)).slice(0, 12).map((i) => ({ href: orgHref(i.path) }))];
      await crawlRole(url, orgId, role, state, targets, { mobile });
    }

    // ------------------------------------------------ signed out: the sign-in pages and the published pages
    if (ROLES.includes("admin")) {
      // an unknown published link must answer with the public «not found» page
      const anon = ["/login", "/signup", "/recover", "/setup", "/p/unknown-page"].filter(pick).map((h) => ({ href: h, kind: "page", full: true, ...(h.startsWith("/p/") ? { expectNotFound: true } : {}) }));
      await crawlRole(url, orgId, "anonymous", null, anon);
    }

  } catch (e) {
    report.fatal = String(e?.stack ?? e).slice(0, 2000);
    log(`crawl stopped: ${report.fatal}`);
  }
  await B.browser?.close().catch(() => {});
  report.finished = new Date().toISOString();
  report.duration_s = Math.round((Date.now() - t0) / 1000);
  report.results = results.map(({ role, route, step, final, issues, ok, forbidden, target: tg }) => ({ role, route: norm(route), step, final: norm(final), ok, issues: issues.map(norm), target: tg, ...(forbidden?.length ? { forbidden: forbidden.map((f) => norm(`${f.status} ${f.method} ${f.url}`)) } : {}) }));
  const prevFile = join(OUT, "clickthrough.json");
  if (flag("merge") && existsSync(prevFile)) {
    // the pages this run checked replace their previous results; the others are kept
    const prev = JSON.parse(readFileSync(prevFile, "utf8"));
    const redone = new Set(report.results.map((r) => `${r.role}|${r.target}`));
    const kept = (prev.results ?? []).filter((r) => !redone.has(`${r.role}|${r.target}`));
    report.merged = { kept: kept.length, from: prev.started };
    report.results = [...kept, ...report.results];
  }
  report.summary = { checks: report.results.length, ok: report.results.filter((r) => r.ok).length, problems: report.results.filter((r) => !r.ok).length + (report.fatal ? 1 : 0) };
  writeFileSync(join(OUT, "clickthrough.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(OUT, "CLICKTHROUGH.md"), markdown(report));
  log(`${report.summary.ok}/${report.summary.checks} checks passed in ${report.duration_s} s; ${join(OUT, "CLICKTHROUGH.md")}`);
  return report.summary.problems ? 1 : 0;
}

/** The report: what was crawled, the problems first, then every check; the hand-written part is kept. */
function markdown(report) {
  const file = join(OUT, "CLICKTHROUGH.md");
  const prev = existsSync(file) ? readFileSync(file, "utf8") : "";
  const manual = prev.match(/<!-- manual:start -->[\s\S]*?<!-- manual:end -->/)?.[0] ?? "<!-- manual:start -->\n<!-- manual:end -->";
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = report.results;
  const bad = rows.filter((r) => !r.ok);
  const byRole = {};
  for (const r of rows) {
    byRole[r.role] ??= { checks: 0, ok: 0 };
    byRole[r.role].checks++;
    if (r.ok) byRole[r.role].ok++;
  }
  const lines = [
    "# Click-through QA — every screen",
    "",
    "Generated by `npm run qa:crawl` (`scripts/ui-crawl.mjs`); the section between the `manual` markers is kept across runs.",
    "",
    manual,
    "",
    "## Last run",
    "",
    `- Started ${report.started}, ${report.duration_s} s; version ${report.version}, ${report.mode} mode (${report.edition} edition) on PGlite.`,
    `- ${report.routes} registered routes; ${report.summary.checks} checks, ${report.summary.ok} passed, ${report.summary.problems} with a problem.`,
    ...(report.fatal ? [`- **The crawl stopped early:** ${report.fatal.split("\n")[0]}`] : []),
    ...(report.merged ? [`- Re-checked pages merged into the run of ${report.merged.from} (${report.merged.kept} earlier checks kept).`] : []),
    ...Object.entries(byRole).map(([k, v]) => `- ${ROLE_TITLE[k] ?? k} (\`${k}\`): ${v.ok}/${v.checks} checks passed.`),
    "",
    "## Problems",
    "",
    bad.length ? "| Route | Role | Step | Issue |\n|---|---|---|---|" : "None.",
    ...bad.map((r) => `| \`${esc(r.route)}\` | ${r.role} | ${r.step} | ${esc(r.issues.join("; "))} |`),
    "",
    ...(report.unreached?.length
      ? ["## Not reached", "", "Parameterised pages without a record to open in this data (no first record in their list, or a parameter that is not a record id):", "", report.unreached.map((p) => `\`${p}\``).join(", "), ""]
      : []),
    "## Every check",
    "",
    "| Route | Role | Step | Result |",
    "|---|---|---|---|",
    ...rows.map((r) => `| \`${esc(r.route)}\` | ${r.role} | ${r.step} | ${r.ok ? (r.forbidden?.length ? `ok (expected 403: ${esc(r.forbidden.length)})` : "ok") : `**${esc(r.issues.join("; "))}**`} |`),
    "",
  ];
  return lines.join("\n").replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "/:id");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
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
}
