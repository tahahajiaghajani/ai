// The installed Windows app used by people (docs/qa/PERFORMANCE_E2E_FA.md): the CI job `desktop-e2e` installs
// Kariz-Setup silently on a Windows runner and runs this script against the installed Kariz.exe through Playwright's
// Electron support (the app's own flags and security settings untouched: Playwright attaches the way it attaches to
// any Electron app). It goes through the first start as a person does — the administrator's account and the
// organisation in the setup wizard —, loads the bank demo pack «کوچک» from «داده‌های نمایشی», adds a regular member in
// «کاربران و دسترسی‌ها», then opens the main pages as the administrator and, after «خروج» and a sign-in, as the member:
// home, the incident list and a record, the catalogue and an order, knowledge, the CMDB, IT assets; the settings for the
// administrator and the requester portal for the member. It closes the window the way people do and starts the app a
// second time.
//
// Measured: the cold start (launch to the first interactive screen) and a second start, every route change (to content
// visible and to the last API answer), the API calls the page made (count and time), the memory (working set) and CPU
// of the app's processes — main, renderer, the local server with its database (PGlite) — every second, the database's
// folder and its write-ahead log at the end. Gate: no console error or uncaught exception, no error screen, and the
// budgets below. Output: report.json, report.md (also the job summary), screenshots, the app's log.
//
//   node scripts/desktop-e2e.mjs --exe "%LOCALAPPDATA%\Programs\Kariz\Kariz.exe" --out <dir>
//   (local: --exe node_modules/electron/dist/electron --app <unpacked app folder> --data <data folder> --no-sandbox)
import { createRequire } from "node:module";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Checks, parseArgs, log, sleep } from "./bank-sim/lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const a = parseArgs();
const require = createRequire(a.playwright ? join(resolve(String(a.playwright)), "noop.js") : join(ROOT, "package.json"));
const { _electron: electron } = require("playwright");

const OUT = resolve(String(a.out ?? join(ROOT, ".local-data", "desktop-e2e")));
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const EXE = String(a.exe ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "Kariz", "Kariz.exe"));
/** The app's data folder: ITSM_DATA_DIR when given, else the installed app's own (%APPDATA%\ITSM\data). */
const DATA = a.data ? resolve(String(a.data)) : join(process.env.APPDATA ?? "", "ITSM", "data");
const SIZE = String(a.size ?? "small");
const C = new Checks("desktop-e2e", join(OUT, "checks.json"));

/**
 * Budgets, set from the runs on GitHub's windows-latest (docs/qa/PERFORMANCE_E2E_FA.md §budgets): a check fails past
 * them. Starts are measured from the launch of Kariz.exe; a navigation from the click to the page's content without a
 * loader; API times as the renderer saw them.
 */
const BUDGETS = {
  // first launch after the installation: PGlite's initdb and every migration (19.2 s on the runner, run 43104019774;
  // 24.6 s in run 43088978809)
  cold_start_ms: 60_000,
  // a later launch to the first screen (2.7 s)
  warm_start_ms: 8_000,
  // a route change to content and the API as the renderer saw them, 95th percentile: 1.36 / 1.63 s (administrator) and
  // 1.48 / 0.82 s (member) in run 43104019774 — 10.0 / 8.5 s before the database let the event loop turn during
  // background work (run 43088978809)
  nav_visible_p95_ms: 4_000,
  nav_visible_max_ms: 8_000,
  api_p95_ms: 3_000,
  // «ثبت درخواست» to the request's page (0.93 / 0.98 s)
  order_ms: 5_000,
  // the bank demo pack «کوچک» (292 s; 236 s before)
  demo_load_s: 600,
  // closing the window to the app's exit (0.24 s; 7.2 s before; the app kills its local server after 10 s)
  close_ms: 3_000,
  // peak working sets: the local server with PGlite 1.18 GB, all the app's processes 1.52 GB
  backend_peak_mb: 2_000,
  total_peak_mb: 3_000,
  // the local server while the app sits idle after the demo pack (its indexing and jobs): 21% of a core
  idle_backend_cpu_pct: 30,
  // the database's write-ahead log after the run (64 MB: src/server/db/wal.ts)
  pg_wal_mb: 160,
};

const ADMIN = { full_name: "مدیر فناوری اطلاعات", email: "it.admin@kariz-e2e.example", password: "Kariz-Desk-Pass-1405!" };
const MEMBER = { full_name: "کارمند شعبهٔ مرکزی", email: "member@kariz-e2e.example", password: "Kariz-Member-Pass-1405!" };
const ORG_NAME = "بانک آزمایشی برنامهٔ ویندوز";
const LOADERS = "#root > .boot, .sh-boot, .sh-wait, .ds-loader, .ant-skeleton, .ant-spin-spinning, .sh-loader";
/**
 * The page's content area, in order: the portal's (inside the app it sits next to an empty #main of the shell), the app
 * shell's, any <main> (the sign-in pages). Each is looked up on its own: a selector list would return the first in the
 * document.
 */
const MAIN = ["#portal-main", "#main", "main"];
const ERROR_SCREEN = /این صفحه پیدا نشد|خطای غیرمنتظره|این صفحه با خطا روبه‌رو شد/;

const T0 = Date.now();
const report = { started: new Date(T0).toISOString(), exe: EXE, data: DATA, size: SIZE, budgets: BUDGETS, starts: {}, pages: [], api: {}, processes: {}, database: {}, demo: {}, console_errors: [], close: {} };
const consoleErrors = [];
const known4xx = [];
let phase = "launch";

// ------------------------------------------------------------------------------------------------- the app

let app = null;
let page = null;
/** Requests of the main window in flight; API requests finished (with the time the renderer saw); the page's own files. */
const inflight = new Set();
const apiLog = [];
const staticLog = [];

function watchPage(p, label) {
  p.on("console", (m) => {
    if (m.type() !== "error") return;
    // an API answer of 4xx is the app's own business (401 before sign-in, 403 for a role), reported with the requests
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) {
      known4xx.push(`${phase}: ${m.text().slice(0, 200)}`);
      return;
    }
    consoleErrors.push(`${label} ${phase}: ${m.text().slice(0, 400)}`);
  });
  p.on("pageerror", (e) => consoleErrors.push(`${label} ${phase}: uncaught ${String(e?.message ?? e).slice(0, 400)}`));
  // every request of the page (API calls and the code chunks of a route) counts for «settled»; API calls are logged
  p.on("request", (r) => {
    if (/^https?:/.test(r.url())) inflight.add(r);
  });
  const done = (r, failed) => {
    if (!inflight.delete(r)) return;
    const t = r.timing();
    const u = new URL(r.url());
    const ms = Math.max(0, Math.round(t.responseEnd > 0 ? t.responseEnd : -1));
    // the app's code, styles and fonts: from the window's cache or from the local server (which may be busy with jobs)
    if (!u.pathname.startsWith("/api/")) staticLog.push({ phase, path: u.pathname, ms, failed });
    else apiLog.push({ phase, method: r.method(), path: u.pathname, ms, failed });
  };
  p.on("requestfinished", (r) => done(r, false));
  p.on("requestfailed", (r) => done(r, true));
}

async function launch(label) {
  const t = Date.now();
  const args = [...(a.app ? [resolve(String(a.app))] : []), ...(a["no-sandbox"] ? ["--no-sandbox"] : [])];
  const env = { ...process.env, ...(a.data ? { ITSM_DATA_DIR: DATA } : {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: EXE, args, env, timeout: 180_000 });
  const launched = Date.now() - t;
  startSampler();
  let splashAt = null;
  app.on("window", (w) => {
    if (w.url().startsWith("file:") && splashAt === null) splashAt = Date.now() - t;
    watchPage(w, w.url().startsWith("file:") ? "splash" : "window");
  });
  for (const w of app.windows()) {
    if (w.url().startsWith("file:") && splashAt === null) splashAt = Date.now() - t;
    watchPage(w, w.url().startsWith("file:") ? "splash" : "window");
  }
  // the main window shows the local server's pages (the splash is a file: page)
  const until = Date.now() + 240_000;
  page = null;
  while (!page && Date.now() < until) {
    page = app.windows().find((w) => /^http:\/\/127\.0\.0\.1:\d+/.test(w.url())) ?? null;
    if (!page) await sleep(100);
  }
  if (!page) throw new Error(`${label}: the main window did not open within 240 s`);
  const windowAt = Date.now() - t;
  return { t, launched, splashAt, windowAt };
}

/**
 * When the main window is first on screen (ms from the launch): the splash hands over to it once the app has painted
 * and its own «آماده است» has played, so this is what a person waits for — `interactive` is the page ready behind it.
 */
async function shownAt(t, ms = 240_000) {
  const until = Date.now() + ms;
  while (Date.now() < until && app) {
    const on = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible() && /^http:\/\/127\.0\.0\.1:\d+/.test(w.webContents.getURL()))).catch(() => false);
    if (on) return Date.now() - t;
    await sleep(50);
  }
  return null;
}

/** Waits until the window shows the app (no boot screen, no loader, text) — `expect` names what must be on screen. */
async function interactive(expect, ms = 240_000) {
  await page.waitForFunction(
    ({ loaders }) => {
      const root = document.getElementById("root");
      const onScreen = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      };
      return !!root && ![...document.querySelectorAll(loaders)].some(onScreen) && (root.innerText || "").trim().length > 20 && document.fonts.status === "loaded";
    },
    { loaders: LOADERS },
    { timeout: ms, polling: 50 },
  );
  if (expect) await expect.waitFor({ state: "visible", timeout: ms });
}

/** Closes the window the way people do and waits for the app (and its local server) to exit. */
async function closeApp(label) {
  phase = `${label}:close`;
  stopSampler();
  const proc = app.process();
  const exited = new Promise((r) => (proc.exitCode !== null ? r() : proc.once("exit", () => r())));
  const t = Date.now();
  // the window's own close (what its × button does): the app then stops its local server and exits
  await page.evaluate(() => window.close()).catch(() => {});
  const ok = await Promise.race([exited.then(() => true), sleep(30_000).then(() => false)]);
  const ms = Date.now() - t;
  if (!ok) {
    await app.close().catch(() => {});
    proc.kill();
  }
  report.close[label] = { ms, clean: ok };
  C.check(ok, `${label}: closing the window ends the app and its local server (${ms} ms)`);
  app = null;
  page = null;
}

// ------------------------------------------------------------------------------------------------- processes

let sampler = null;
let sampling = false;
const samples = [];

function startSampler() {
  stopSampler();
  sampler = setInterval(async () => {
    if (!app || sampling) return;
    sampling = true;
    try {
      const procs = await app.evaluate(({ app: e }) =>
        e.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.name ?? "", cpu: m.cpu.percentCPUUsage, ws: m.memory.workingSetSize, peak: m.memory.peakWorkingSetSize, priv: m.memory.privateBytes ?? null })),
      );
      samples.push({ t: Date.now() - T0, phase, procs });
    } catch {
      /* the app is closing */
    } finally {
      sampling = false;
    }
  }, 1000);
}
function stopSampler() {
  if (sampler) clearInterval(sampler);
  sampler = null;
}

/** main (Browser), renderer (Tab), gpu, server (the local server and its database: the «Kariz Server» utility process), other */
function group(p) {
  if (p.type === "Browser") return "main";
  if (p.type === "Tab") return "renderer";
  if (p.type === "GPU") return "gpu";
  if (p.type === "Utility" && /Kariz|Server/i.test(p.name) && !/Network|Storage|Audio/i.test(p.name)) return "server";
  return "other";
}

function processSummary() {
  const groups = ["main", "renderer", "server", "gpu", "other"];
  const out = { samples: samples.length, peak_mb: {}, total_peak_mb: 0, cpu_avg_pct: {}, cpu_max_pct: {}, by_phase: {} };
  for (const g of groups) {
    out.peak_mb[g] = 0;
    out.cpu_max_pct[g] = 0;
  }
  const cpuSum = Object.fromEntries(groups.map((g) => [g, 0]));
  for (const s of samples) {
    const mem = Object.fromEntries(groups.map((g) => [g, 0]));
    const cpu = Object.fromEntries(groups.map((g) => [g, 0]));
    for (const p of s.procs) {
      const g = group(p);
      mem[g] += p.ws / 1024;
      cpu[g] += p.cpu;
    }
    let total = 0;
    for (const g of groups) {
      out.peak_mb[g] = Math.max(out.peak_mb[g], Math.round(mem[g]));
      out.cpu_max_pct[g] = Math.max(out.cpu_max_pct[g], Math.round(cpu[g]));
      cpuSum[g] += cpu[g];
      total += mem[g];
    }
    out.total_peak_mb = Math.max(out.total_peak_mb, Math.round(total));
    const ph = s.phase.split(":")[0];
    const b = (out.by_phase[ph] ??= { samples: 0, cpu: Object.fromEntries(groups.map((g) => [g, 0])), mem_peak_mb: Object.fromEntries(groups.map((g) => [g, 0])) });
    b.samples++;
    for (const g of groups) {
      b.cpu[g] += cpu[g];
      b.mem_peak_mb[g] = Math.max(b.mem_peak_mb[g], Math.round(mem[g]));
    }
  }
  for (const g of groups) out.cpu_avg_pct[g] = samples.length ? Math.round(cpuSum[g] / samples.length) : 0;
  for (const b of Object.values(out.by_phase)) for (const g of groups) b.cpu[g] = Math.round(b.cpu[g] / Math.max(1, b.samples));
  return out;
}

// ------------------------------------------------------------------------------------------------- navigation

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function settled(ms = 20_000) {
  const until = Date.now() + ms;
  let quietSince = Date.now();
  while (Date.now() < until) {
    if (inflight.size) quietSince = Date.now();
    else if (Date.now() - quietSince >= 400) return true;
    await sleep(50);
  }
  return false;
}

let shot = 0;
/**
 * A route change the way the app makes one: the sidebar's link when it is on screen, else the router's own history
 * navigation (pushState and popstate, as a link does). Measured to the content without a loader and to the last API answer.
 */
async function go(persona, name, path, { click } = {}) {
  phase = `${persona}:${name}`;
  const errorsBefore = consoleErrors.length;
  const apiBefore = apiLog.length;
  const staticBefore = staticLog.length;
  const from = new URL(page.url()).pathname;
  const before = await page.evaluate((sels) => (sels.map((x) => document.querySelector(x)).find(Boolean)?.innerText ?? "").slice(0, 4000), MAIN).catch(() => "");
  const t = Date.now();
  let how = "link";
  if (click) await click();
  else {
    const link = page.locator(`a[href="${path}"]`).filter({ visible: true }).first();
    if (await link.count().catch(() => 0)) await link.click();
    else {
      how = "history";
      await page.evaluate((p) => {
        window.history.pushState({}, "", p);
        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      }, path);
    }
  }
  let visible = null;
  let note = "";
  try {
    // two frames: the new route has replaced the old one (with its own loader when it has to wait)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    await page.waitForFunction(
      ({ loaders, main, before, from, path, moves }) => {
        const root = document.getElementById("root");
        // a loader on screen (one below the fold, or hidden, waits for the person to scroll there)
        const onScreen = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
        };
        if (!root || [...document.querySelectorAll(loaders)].some(onScreen)) return false;
        // a click on a record, a service or «ثبت درخواست» always leads to another page
        if (moves && location.pathname === from) return false;
        if (path && location.pathname === from && from !== path.split("?")[0]) return false;
        // the router keeps the old page on screen while the new route's code and data load (a transition): the
        // content area must have changed
        const text = ((main.map((x) => document.querySelector(x)).find(Boolean) ?? root).innerText || "").slice(0, 4000);
        if (location.pathname !== from && text === before) return false;
        return text.trim().length > 20;
      },
      { loaders: LOADERS, main: MAIN, before, from, path: click ? null : path, moves: !!click },
      { timeout: 30_000, polling: 25 },
    );
    visible = Date.now() - t;
  } catch (e) {
    // what held it back: the loaders on the page (with their place) and whether the content area changed at all
    const why = await page
      .evaluate(
        ({ loaders, main, before }) => ({
          loaders: [...document.querySelectorAll(loaders)].slice(0, 6).map((el) => {
            const r = el.getBoundingClientRect();
            return `${String(el.className).slice(0, 60)} @${Math.round(r.top)},${Math.round(r.left)} ${Math.round(r.width)}x${Math.round(r.height)}`;
          }),
          changed: ((main.map((x) => document.querySelector(x)).find(Boolean) ?? document.body).innerText || "").slice(0, 4000) !== before,
          path: location.pathname,
        }),
        { loaders: LOADERS, main: MAIN, before },
      )
      .catch(() => null);
    note = `content not visible within 30 s (${String(e.message).split("\n")[0].slice(0, 80)}); ${JSON.stringify(why)}`;
  }
  const quiet = await settled();
  const settledMs = Date.now() - t;
  const text = (await page.locator("#root").innerText({ timeout: 5000 }).catch(() => "")) ?? "";
  const file = join(SHOTS, `${String(++shot).padStart(2, "0")}-${persona}-${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  const calls = apiLog.slice(apiBefore).filter((r) => r.phase === phase);
  const files = staticLog.slice(staticBefore).filter((r) => r.phase === phase);
  const entry = {
    persona,
    name,
    path: new URL(page.url()).pathname,
    how,
    visible_ms: visible,
    settled_ms: quiet ? settledMs : null,
    api_calls: calls.length,
    api_ms_total: calls.reduce((n, r) => n + r.ms, 0),
    api_ms_max: calls.reduce((n, r) => Math.max(n, r.ms), 0),
    api_4xx: known4xx.filter((x) => x.startsWith(phase)).length,
    files: files.length,
    files_ms_max: files.reduce((n, r) => Math.max(n, r.ms), 0),
    shot: file.slice(OUT.length + 1),
  };
  report.pages.push(entry);
  const errs = consoleErrors.slice(errorsBefore);
  C.check(visible !== null && !ERROR_SCREEN.test(text) && !errs.length, `${persona}: ${name} (${entry.path}) shows its content in ${visible ?? "—"} ms (${calls.length} API calls)`, note || (ERROR_SCREEN.test(text) ? "error screen" : errs.join(" | ")));
  return entry;
}

// ------------------------------------------------------------------------------------------------- the people's steps

async function setup() {
  phase = "setup";
  const t = Date.now();
  await page.getByRole("radio", { name: /شروع روی همین رایانه/ }).click();
  await page.getByRole("button", { name: "ادامه", exact: true }).click();
  await page.locator("#full_name").fill(ADMIN.full_name);
  await page.locator("#email").fill(ADMIN.email);
  await page.locator("#password").fill(ADMIN.password);
  await page.screenshot({ path: join(SHOTS, "00-setup-admin.png") }).catch(() => {});
  await page.getByRole("button", { name: "ساخت حساب مدیر" }).click();
  // the recovery code: kept, then the organisation
  await page.getByText("کد را جای امنی نگه داشتم.").click({ timeout: 60_000 });
  await page.screenshot({ path: join(SHOTS, "00-setup-recovery-code.png") }).catch(() => {});
  await page.getByRole("button", { name: "ادامه", exact: true }).click();
  await page.locator("#name").fill(ORG_NAME, { timeout: 60_000 });
  await page.getByRole("button", { name: "ساخت سازمان" }).click();
  await page.getByRole("button", { name: "رفتن به خانه" }).click({ timeout: 60_000 });
  await page.waitForURL((u) => /^\/[0-9a-f-]{36}(\/|$)/.test(u.pathname), { timeout: 60_000 });
  await interactive(null, 60_000);
  const org = new URL(page.url()).pathname.split("/")[1];
  report.setup_ms = Date.now() - t;
  C.check(true, `the first-run setup: the administrator's account and the organisation (${report.setup_ms} ms)`);
  await page.screenshot({ path: join(SHOTS, "00-setup-home.png") }).catch(() => {});
  return org;
}

/** GET from the renderer with its own session (what the page itself would ask). */
const apiGet = (path) => page.evaluate(async (p) => (await fetch(`/api${p}`, { credentials: "same-origin" })).json(), path);

async function demoLoad(org) {
  await go("admin", "demo-console", `/${org}/settings/demo`);
  phase = "demo-load";
  const t = Date.now();
  await page.getByText(/^کوچک/).first().click();
  await page.getByRole("button", { name: "بارگذاری دادهٔ نمایشی" }).click();
  let st = null;
  let lastLabel = "";
  while (Date.now() - t < BUDGETS.demo_load_s * 1000 + 600_000) {
    await sleep(5000);
    st = await apiGet(`/o/${org}/demo`).catch(() => null);
    const label = st?.progress?.label ?? "";
    if (label && label !== lastLabel) {
      log(`demo: ${st.state} ${st.progress.done}/${st.progress.total} ${label}`);
      lastLabel = label;
    }
    if (st && st.state !== "loading") break;
  }
  const seconds = Math.round((Date.now() - t) / 1000);
  report.demo = { state: st?.state ?? null, seconds, counts: st?.counts ?? null, error: st?.error ?? null };
  await page.screenshot({ path: join(SHOTS, "00-demo-loaded.png") }).catch(() => {});
  C.check(st?.state === "loaded", `the bank demo pack «کوچک» loads from «داده‌های نمایشی» (${seconds} s)`, JSON.stringify(st ?? {}).slice(0, 400));
  C.check(seconds <= BUDGETS.demo_load_s, `the demo pack loads within ${BUDGETS.demo_load_s} s`, `${seconds} s`);
  // the pages refresh when the load ends (the banner, the lists)
  await settled(10_000);
}

async function addMember(org) {
  await go("admin", "users", `/${org}/settings/users`);
  phase = "add-member";
  await page.getByRole("button", { name: "افزودن کاربر" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#full_name").fill(MEMBER.full_name);
  await dialog.locator("#email").fill(MEMBER.email);
  await dialog.locator("#password").fill(MEMBER.password);
  // «پیش‌تنظیم دسترسی»: a support agent, the regular member of an IT department (works incidents, orders services)
  const preset = dialog.locator("#access_preset");
  if (await preset.count()) {
    await preset.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "کارشناس پشتیبانی" }).first().click();
  }
  const t = Date.now();
  await dialog.getByRole("button", { name: "افزودن", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  await page.getByText(MEMBER.email).first().waitFor({ timeout: 30_000 });
  C.check(true, `the administrator adds a regular member in «کاربران و دسترسی‌ها» (${Date.now() - t} ms)`);
}

/** «خروج» from the account menu, then the sign-in form as `who`. */
async function switchAccount(who) {
  phase = `switch:${who.email}`;
  await page.locator(".sh-avatar").click();
  await page.getByRole("menuitem", { name: "خروج" }).click();
  await page.locator('input[autocomplete="username"]').waitFor({ timeout: 30_000 });
  const t = Date.now();
  await page.locator('input[autocomplete="username"]').fill(who.email);
  await page.locator('input[autocomplete="current-password"]').fill(who.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await interactive(null, 60_000);
  const ms = Date.now() - t;
  C.check(true, `«خروج» and a sign-in as ${who.email} (${ms} ms to the first page)`);
  return ms;
}

/** The first incident of the list (its record page). */
async function openFirstIncident(persona, org) {
  const link = page.locator(`a[href^="/${org}/incidents/"]`).filter({ hasNotText: /^$/ });
  const hrefs = await link.evaluateAll((els) => els.map((e) => e.getAttribute("href")).filter((h) => /\/incidents\/[0-9a-f-]{36}$/.test(h ?? "")));
  if (!hrefs.length) {
    C.check(false, `${persona}: the incident list shows records to open`);
    return;
  }
  await go(persona, "incident-record", hrefs[0], { click: () => page.locator(`a[href="${hrefs[0]}"]`).first().click() });
}

/** The portal's catalogue, a service and its order (the mailbox: no question without a default). */
async function order(persona, org) {
  await go(persona, "catalogue", `/${org}/portal/catalog`);
  const item = page.getByText("صندوق پست الکترونیک", { exact: true }).first();
  if (!(await item.count())) {
    C.check(false, `${persona}: the catalogue offers «صندوق پست الکترونیک»`);
    return;
  }
  await go(persona, "catalogue-item", "", { click: () => item.click() });
  const button = page.getByRole("button", { name: /ثبت درخواست/ }).first();
  // «ثبت درخواست» to the new request's page with its content
  const entry = await go(persona, "order", "", { click: () => button.click() });
  const ms = entry.visible_ms;
  report.orders = [...(report.orders ?? []), { persona, ms, path: entry.path }];
  C.check(/\/portal\/t\//.test(entry.path) && ms !== null && ms <= BUDGETS.order_ms, `${persona}: an order is placed and its request opens (${ms} ms)`, entry.path);
}

async function pages(persona, org) {
  await go(persona, "home", `/${org}`);
  await go(persona, "incidents", `/${org}/incidents`);
  await openFirstIncident(persona, org);
  await order(persona, org);
  await go(persona, "knowledge", `/${org}/kb`);
  await go(persona, "cmdb", `/${org}/cmdb`);
  await go(persona, "itam", `/${org}/assets`);
  if (persona === "admin") {
    await go(persona, "settings", `/${org}/settings/org`);
    await go(persona, "settings-users", `/${org}/settings/users`);
  } else await go(persona, "portal", `/${org}/portal`);
}

// ------------------------------------------------------------------------------------------------- the run

function walOf(dir) {
  const wal = join(dir, "pg_wal");
  const segs = existsSync(wal) ? readdirSync(wal).filter((f) => /^[0-9A-F]{24}$/.test(f)) : [];
  const size = (p) => {
    if (!existsSync(p)) return 0;
    const st = statSync(p);
    return st.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : st.size;
  };
  return { folder_mb: Math.round(size(dir) / 1048576), pg_wal_mb: Math.round(segs.reduce((n, f) => n + statSync(join(wal, f)).size, 0) / 1048576), pg_wal_segments: segs.length };
}

function markdown() {
  const p = report.processes;
  const L = [];
  L.push(`# برنامهٔ ویندوز «کاریز» — آزمون نصب‌شده (desktop-e2e)`, "");
  L.push(`- اجرا: ${report.started} · ${report.failures ? `**${report.failures} بررسی ناموفق**` : "همهٔ بررسی‌ها موفق"}`);
  const srv = (x) => (x ? ` · سرور محلی: پایگاه داده ${x.database_ms} ms${x.template ? " (از پایگاه دادهٔ آماده)" : ""}، مهاجرت‌ها ${x.migrations_ms} ms، آماده ${x.ready_ms} ms، فرایند ${x.process_ms} ms` : "");
  L.push(`- شروع سرد (نخستین اجرا پس از نصب تا صفحهٔ راه‌اندازی): **${report.starts.cold?.interactive_ms ?? "—"} ms** (پنجرهٔ اصلی ${report.starts.cold?.window_ms ?? "—"} ms، روی صفحه ${report.starts.cold?.shown_ms ?? "—"} ms)${srv(report.starts.cold?.server)}`);
  L.push(`- شروع دوم (تا نخستین صفحه): **${report.starts.warm?.interactive_ms ?? "—"} ms** (روی صفحه ${report.starts.warm?.shown_ms ?? "—"} ms)${srv(report.starts.warm?.server)}`);
  L.push(`- بستهٔ نمایشی «کوچک»: ${report.demo.state ?? "—"} در ${report.demo.seconds ?? "—"} s`);
  L.push(`- پایگاه داده پس از اجرا: پوشه ${report.database.folder_mb ?? "—"} MB، pg_wal ${report.database.pg_wal_mb ?? "—"} MB (${report.database.pg_wal_segments ?? "—"} قطعه)`);
  L.push(`- حافظه (اوج working set): سرور محلی و PGlite ${p.peak_mb?.server} MB، رندرر ${p.peak_mb?.renderer} MB، اصلی ${p.peak_mb?.main} MB، GPU ${p.peak_mb?.gpu} MB، جمع ${p.total_peak_mb} MB`);
  L.push(`- CPU (میانگین / بیشینه، درصد یک هسته): سرور ${p.cpu_avg_pct?.server}/${p.cpu_max_pct?.server}، رندرر ${p.cpu_avg_pct?.renderer}/${p.cpu_max_pct?.renderer}، اصلی ${p.cpu_avg_pct?.main}/${p.cpu_max_pct?.main}; در بیکاری: سرور ${p.by_phase?.idle?.cpu?.server ?? "—"}`, "");
  for (const persona of ["admin", "member"]) {
    const rows = report.pages.filter((r) => r.persona === persona);
    if (!rows.length) continue;
    const s = report.api[persona] ?? {};
    L.push(`## ${persona === "admin" ? "مدیر" : "عضو"}`, "", `ناوبری: p50 ${s.nav_p50_ms} ms · p95 ${s.nav_p95_ms} ms · بیشینه ${s.nav_max_ms} ms — API: ${s.calls} فراخوانی، p50 ${s.api_p50_ms} ms · p95 ${s.api_p95_ms} ms`, "");
    L.push(`| صفحه | مسیر | محتوا (ms) | آرام (ms) | API | زمان API (ms) | فایل‌ها (بیشینه ms) |`, `|---|---|---:|---:|---:|---:|---:|`);
    for (const r of rows) L.push(`| ${r.name} | \`${r.path}\` | ${r.visible_ms ?? "—"} | ${r.settled_ms ?? "—"} | ${r.api_calls} | ${r.api_ms_total} | ${r.files} (${r.files_ms_max}) |`);
    L.push("");
  }
  L.push(`## بودجه‌ها`, "", "| معیار | بودجه | اندازه |", "|---|---:|---:|");
  for (const [k, v] of Object.entries(report.budget_results ?? {})) L.push(`| ${k} | ${v.budget} | ${v.value} ${v.ok ? "" : "✗"} |`);
  const failed = C.items.filter((x) => !x.ok);
  if (failed.length) L.push("", "## ناموفق", "", ...failed.map((f) => `- ${f.what}${f.detail ? ` — ${f.detail.slice(0, 300)}` : ""}`));
  return L.join("\n");
}

/** Summaries, the budgets as checks, the report files (the job summary too), the app's log. */
function finish() {
  stopSampler();
  report.processes = processSummary();
  for (const persona of ["admin", "member"]) {
    const nav = report.pages.filter((r) => r.persona === persona && r.visible_ms !== null).map((r) => r.visible_ms);
    const api = apiLog.filter((r) => r.phase.startsWith(`${persona}:`) && !r.failed).map((r) => r.ms);
    const slow = {};
    for (const r of apiLog.filter((x) => x.phase.startsWith(`${persona}:`))) {
      const key = `${r.method} ${r.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id")}`;
      const e = (slow[key] ??= { n: 0, max: 0, total: 0 });
      e.n++;
      e.max = Math.max(e.max, r.ms);
      e.total += r.ms;
    }
    report.api[persona] = {
      pages: nav.length,
      nav_p50_ms: pct(nav, 50),
      nav_p95_ms: pct(nav, 95),
      nav_max_ms: nav.length ? Math.max(...nav) : 0,
      calls: api.length,
      api_p50_ms: pct(api, 50),
      api_p95_ms: pct(api, 95),
      api_max_ms: api.length ? Math.max(...api) : 0,
      slowest: Object.entries(slow).sort((x, y) => y[1].max - x[1].max).slice(0, 8).map(([k, v]) => ({ endpoint: k, ...v })),
    };
  }
  report.database = { ...report.database, ...walOf(join(DATA, "db")) };
  report.known_4xx = known4xx.slice(0, 50);
  report.console_errors = consoleErrors.slice(0, 50);
  C.check(consoleErrors.length === 0, "no console error or uncaught exception in the app's windows during the whole run", consoleErrors.slice(0, 20).join(" | "));
  const logFile = join(DATA, "logs", "app.log");
  if (existsSync(logFile)) {
    copyFileSync(logFile, join(OUT, "app.log"));
    const text = readFileSync(logFile, "utf8");
    report.database.checkpoints_logged = (text.match(/database checkpoint\b/g) ?? []).length;
    // src/desktop/server.ts: «local server on … (database N ms[ from the template], migrations N ms, ready N ms, process N ms)»
    const starts = [...text.matchAll(/local server on \S+ \(database (\d+) ms( from the template)?, migrations (\d+) ms, ready (\d+) ms, process (\d+) ms\)/g)].map((m) => ({
      database_ms: Number(m[1]),
      template: !!m[2],
      migrations_ms: Number(m[3]),
      ready_ms: Number(m[4]),
      process_ms: Number(m[5]),
    }));
    if (starts.length && report.starts.cold) report.starts.cold.server = starts[0];
    // desktop/src/main.ts: «[cache] N/M files of the build in the window's cache (N ms)», once per version
    const warm = /\[cache\] (\d+)\/(\d+) files of the build in the window's cache \((\d+) ms\)/.exec(text);
    if (warm) report.cache_warmup = { read: Number(warm[1]), files: Number(warm[2]), ms: Number(warm[3]) };
    if (starts.length > 1 && report.starts.warm) report.starts.warm.server = starts.at(-1);
    // the installer's database made at build time (src/desktop/db-template.ts): a first start that fell back to initdb
    // and every migration still works, slowly — this says so
    if (report.starts.cold) C.check(report.starts.cold.server?.template === true, "the first start opens the database made at build time (app.log)", JSON.stringify(report.starts.cold.server ?? null));
    report.database.log_prepared = (text.match(/database log prepared.*/g) ?? []).slice(-2);
  }
  // budgets
  const results = {};
  const budget = (key, value, limit, what) => {
    const ok = value !== null && value !== undefined && value <= limit;
    results[key] = { budget: limit, value, ok };
    C.check(ok, `${what}: ${value} (budget ${limit})`);
  };
  for (const persona of ["admin", "member"]) {
    const s = report.api[persona];
    if (!s.pages) continue;
    budget(`${persona}.nav_p95_ms`, s.nav_p95_ms, BUDGETS.nav_visible_p95_ms, `${persona}: route change to content, 95th percentile (ms)`);
    budget(`${persona}.nav_max_ms`, s.nav_max_ms, BUDGETS.nav_visible_max_ms, `${persona}: slowest route change (ms)`);
    budget(`${persona}.api_p95_ms`, s.api_p95_ms, BUDGETS.api_p95_ms, `${persona}: API as the renderer saw it, 95th percentile (ms)`);
  }
  const p = report.processes;
  if (p.samples) {
    budget("server_peak_mb", p.peak_mb.server, BUDGETS.backend_peak_mb, "peak working set of the local server and its database (MB)");
    budget("total_peak_mb", p.total_peak_mb, BUDGETS.total_peak_mb, "peak working set of all the app's processes (MB)");
    if (p.by_phase.idle) budget("idle_server_cpu_pct", p.by_phase.idle.cpu.server, BUDGETS.idle_backend_cpu_pct, "CPU of the local server while the app sits idle (% of a core)");
  }
  if (report.database.pg_wal_mb !== undefined) budget("pg_wal_mb", report.database.pg_wal_mb, BUDGETS.pg_wal_mb, "the database's write-ahead log after the run (MB)");
  if (report.close.first) budget("close_ms", report.close.first.ms, BUDGETS.close_ms, "closing the window to the app's exit after the run (ms)");
  report.budget_results = results;
  report.finished = new Date().toISOString();
  report.seconds = Math.round((Date.now() - T0) / 1000);
  report.failures = C.failures;
  report.checks = C.items;
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ ...report, api_log: apiLog, static_log: staticLog, samples }, null, 2));
  const md = markdown();
  writeFileSync(join(OUT, "report.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

await C.run(async () => {
  try {
    await scenario();
  } catch (e) {
    // what the window showed when a step failed, and where it was
    if (page) {
      log(`failed in ${phase} at ${page.url()}`);
      await page.screenshot({ path: join(SHOTS, `zz-failed-${String(phase).replace(/[^A-Za-z0-9.-]+/g, "-")}.png`) }).catch(() => {});
    }
    throw e;
  } finally {
    if (app) {
      const proc = app.process();
      await app.close().catch(() => {});
      proc.kill();
    }
    finish();
  }
});

async function scenario() {
  // 1. the first start after the installation
  phase = "cold-start";
  const cold = await launch("cold");
  const coldShown = shownAt(cold.t);
  await interactive(page.getByRole("button", { name: "ادامه", exact: true }));
  report.starts.cold = { launch_ms: cold.launched, splash_ms: cold.splashAt, window_ms: cold.windowAt, interactive_ms: Date.now() - cold.t, url: new URL(page.url()).pathname };
  report.starts.cold.shown_ms = await coldShown;
  await page.screenshot({ path: join(SHOTS, "00-first-start.png") }).catch(() => {});
  C.check(report.starts.cold.url === "/setup", "the first start opens the setup wizard", report.starts.cold.url);
  C.check(report.starts.cold.interactive_ms <= BUDGETS.cold_start_ms, `cold start to the first interactive screen ${report.starts.cold.interactive_ms} ms (budget ${BUDGETS.cold_start_ms})`);

  // 2. setup, demo pack, a member
  const org = await setup();
  report.org = org;
  await demoLoad(org);
  await addMember(org);

  // 3. the administrator's pages, then the member's
  phase = "admin";
  await pages("admin", org);
  phase = "idle";
  // a minute of the app left open on the home page: the job queue, the log's checkpoints, nothing else
  await go("admin", "home-idle", `/${org}`);
  phase = "idle";
  await sleep(60_000);
  report.switch_ms = await switchAccount(MEMBER);
  await pages("member", org);

  // 4. closed the way people close it, then a second start
  await closeApp("first");
  report.database.after_first = walOf(join(DATA, "db"));
  phase = "warm-start";
  const warm = await launch("warm");
  const warmShown = shownAt(warm.t);
  await interactive(null);
  report.starts.warm = { launch_ms: warm.launched, splash_ms: warm.splashAt, window_ms: warm.windowAt, interactive_ms: Date.now() - warm.t, url: new URL(page.url()).pathname };
  report.starts.warm.shown_ms = await warmShown;
  await page.screenshot({ path: join(SHOTS, "99-second-start.png") }).catch(() => {});
  C.check(report.starts.warm.interactive_ms <= BUDGETS.warm_start_ms, `a second start to the first screen ${report.starts.warm.interactive_ms} ms (budget ${BUDGETS.warm_start_ms})`, report.starts.warm.url);
  await closeApp("second");
}
