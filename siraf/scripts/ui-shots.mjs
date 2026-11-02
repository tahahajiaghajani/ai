// Visual QA: builds the UI, starts the local (Windows-flavour) server on a fresh data dir, creates
// the owner and an organisation with all modules, fills it with demo data (scripts/demo-seed.mts),
// signs in with Playwright and screenshots pages in light and dark theme (1440×900) plus a few
// pages on a phone (390×844). Writes PNGs and report.json (console errors, page errors and failed
// API calls per page) into the output folder, then stops the server.
//
//   node scripts/ui-shots.mjs [--port 4102] [--out <dir>] [--paths a,b,c] [--themes light,dark]
//        [--mobile [a,b]] [--no-mobile] [--no-build] [--static <dir>] [--concurrency 3]
//        [--full-page] [--keep-data] [--keep-server]
//
// Paths are relative to the organisation (`sales/invoices`, `` for the dashboard) unless they
// start with `/` (`/login`, `/orgs`, `/admin`). `{key}` is replaced by an id from the seed
// (e.g. `parties/{party_customer}`, see seed.json in the output). Default: every route of
// src/ui/modules/*/index.tsx without parameters, the editors of seeded documents, /login, /orgs, /admin.
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
  // keep running until killed
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

const PORT = Number(opt("port", "4102"));
const OUT = resolve(opt("out", join(tmpdir(), "siraf-ui-shots", stamp)));
const THEMES = list(opt("themes", "light,dark"));
const CONCURRENCY = Math.max(1, Number(opt("concurrency", "3")));
const FULL_PAGE = flag("full-page");
const NO_BUILD = flag("no-build");
const STATIC = opt("static") ? resolve(opt("static")) : null;
const MOBILE_DEFAULT = ["", "sales/invoices", "sales/invoices/new", "parties", "treasury/receipts", "gold/sale", "fx/rates", "fx/deals/new", "reports/trial-balance", "/login"];
const MOBILE = flag("no-mobile") ? [] : list(opt("mobile")) ?? MOBILE_DEFAULT;
const OWNER = { email: "demo@example.com", password: "Demo-pass-1405", full_name: "سارا محمدی" };
const ORG = { name: "بازرگانی نیک‌آوران", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", city: "تهران" };
const THEME_KEYS = ["taraz.theme", "siraf.theme"];

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
function defaultPaths() {
  const mod = join(ROOT, "src/ui/modules");
  const paths = new Set([""]);
  const add = (p) => {
    if (!p.includes(":") && !p.includes("${")) paths.add(p);
  };
  for (const dir of readdirSync(mod)) {
    const f = join(mod, dir, "index.tsx");
    if (!existsSync(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/\bpath:\s*"([^"]*)"/g)) add(m[1]);
  }
  // commercial documents (goods/labels.ts) and gold document editors (gold/shared.tsx KIND_PATH)
  const labels = join(mod, "goods/labels.ts");
  if (existsSync(labels)) for (const m of readFileSync(labels, "utf8").matchAll(/\bpath:\s*"((?:sales|purchases)\/[^"]+)"/g)) add(m[1]);
  const gold = join(mod, "gold/shared.tsx");
  if (existsSync(gold)) {
    const src = readFileSync(gold, "utf8");
    const block = src.slice(src.indexOf("KIND_PATH"), src.indexOf("};", src.indexOf("KIND_PATH")));
    for (const m of block.matchAll(/:\s*"(gold\/[^"]+)"/g)) add(m[1]);
  }
  const detail = [
    "parties/{party_customer}", "parties/{party_company}", "sales/invoices/{sale_invoice}", "purchases/invoices/{purchase_invoice}",
    "sales/returns/{sale_return}", "sales/quotes/{quote}", "sales/orders/{sale_order}", "sales/price-lists/{price_list}", "inventory/docs/{stock_doc}",
    "accounting/vouchers/{voucher}", "treasury/docs/{receipt}", "treasury/docs/{payment}", "fx/deals/{fx_deal}", "fx/deals/{fx_deal_exchange}",
    "fx/remittances/{remittance}", "fx/remittances/{remittance_in}", "gold/docs/{gold_sale}", "gold/sale/{gold_sale}", "gold/docs/{gold_purchase}",
  ];
  return [...[...paths].sort((a, b) => a.localeCompare(b)), ...detail, "/login", "/orgs", "/admin"];
}

const slug = (p) => (p === "" ? "dashboard" : p.replace(/^\//, "").replace(/[{}]/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "id").replace(/[?&=]/g, "-").replace(/\//g, "__")) || "root";

// ---------------------------------------------------------------- main
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  log(`output ${OUT}`);

  // 1. build the UI into a directory of our own (never into public/ — another build may use it)
  let staticDir = STATIC ?? join(tmpdir(), "siraf-ui-shots-build");
  if (!NO_BUILD) {
    log(`building UI into ${staticDir}`);
    await run(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], { env: { TARAZ_UI_OUT: staticDir }, logFile: join(OUT, "build.log") });
  } else if (!existsSync(join(staticDir, "index.html"))) {
    staticDir = join(ROOT, "public");
    log(`--no-build: no build in the default dir, serving ${staticDir}`);
  }
  if (!existsSync(join(staticDir, "index.html"))) throw new Error(`no index.html in ${staticDir}`);

  // 2. start the server on a fresh data dir
  dataDir = mkdtempSync(join(tmpdir(), "siraf-ui-shots-data-"));
  log(`starting server on port ${PORT} (data ${dataDir})`);
  const serverLog = createWriteStream(join(OUT, "server.log"));
  server = spawn(TSX, [fileURLToPath(import.meta.url), "--serve-internal", dataDir, String(PORT), staticDir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("server did not start within 90 s (see server.log)")), 90000);
    let buf = "";
    const onData = (d) => {
      serverLog.write(d);
      buf += d;
      const m = buf.match(/ready (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", (d) => serverLog.write(d));
    server.on("exit", (code) => fail(new Error(`server exited with ${code} (see server.log)`)));
  });
  if (!url.endsWith(`:${PORT}`)) log(`warning: port ${PORT} was busy, the server took ${url}`);
  log(`server ready at ${url}`);

  // 3. owner + organisation with all modules
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
  if (meta.first_run) await call("POST", "/auth/signup", { ...OWNER, mobile: "09121112233" });
  else await call("POST", "/auth/login", { email: OWNER.email, password: OWNER.password });
  const orgs = (await call("GET", "/orgs")).orgs;
  const orgId = orgs.find((o) => o.name === ORG.name)?.id ?? (await call("POST", "/orgs", ORG)).id;
  log(`owner ${OWNER.email}, organisation ${orgId}`);

  // 4. demo data
  const seedFile = join(OUT, "seed.json");
  const seedStart = Date.now();
  const seedOut = await run(TSX, [join(ROOT, "scripts/demo-seed.mts"), "--base", url, "--org", orgId, "--email", OWNER.email, "--password", OWNER.password, "--ids-out", seedFile], { logFile: join(OUT, "seed.log") });
  const seed = JSON.parse(readFileSync(seedFile, "utf8"));
  log(`seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s (${seed.requests} requests) ${JSON.stringify(seed.counts)}`);
  void seedOut;

  // 5. screenshots
  const requested = list(opt("paths")) ?? defaultPaths();
  const resolvePath = (p) => {
    let missing = null;
    const filled = p.replace(/\{(\w+)\}/g, (_, k) => {
      if (!seed.ids[k]) missing = k;
      return seed.ids[k] ?? k;
    });
    if (missing) return { skip: `no seeded id «${missing}»` };
    return { href: filled.startsWith("/") ? filled : `/${orgId}${filled ? `/${filled}` : ""}`, auth: !/^\/(login|setup|recover|signup)\b/.test(filled) };
  };

  const require = createRequire(join(ROOT, "package.json"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const report = { started: new Date(t0).toISOString(), url, org_id: orgId, owner: OWNER.email, out: OUT, static_dir: staticDir, seed: { seconds: seed.seconds, requests: seed.requests, counts: seed.counts, ids: seed.ids }, pages: [], skipped: [] };

  // sign in once through the login form, keep the session for every context
  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR", timezoneId: "Asia/Tehran" });
  const lp = await loginCtx.newPage();
  await lp.goto(`${url}/login`);
  try {
    await lp.locator('input[autocomplete="username"]').fill(OWNER.email, { timeout: 15000 });
    await lp.locator('input[autocomplete="current-password"]').fill(OWNER.password);
    await lp.locator('button[type="submit"]').click();
    await lp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    log("signed in through the login form");
  } catch (e) {
    log(`login form failed (${e.message.split("\n")[0]}), signing in through the API`);
    report.login_form_error = e.message.split("\n")[0];
    const r = await loginCtx.request.post(`${url}/api/auth/login`, { data: { email: OWNER.email, password: OWNER.password } });
    if (!r.ok()) throw new Error(`login failed: ${r.status()}`);
  }
  const storageState = await loginCtx.storageState();
  await loginCtx.close();

  const jobs = [];
  const queue = (variant, theme, viewport, paths) => {
    for (const p of paths) {
      const r = resolvePath(p);
      if (r.skip) {
        report.skipped.push({ path: p, variant, theme, reason: r.skip });
        continue;
      }
      jobs.push({ path: p, ...r, variant, theme, viewport });
    }
  };
  for (const theme of THEMES) queue("desktop", theme, { width: 1440, height: 900 }, requested);
  for (const theme of THEMES) queue("mobile", theme, { width: 390, height: 844 }, MOBILE);
  log(`${jobs.length} screenshots to take (${requested.length} paths × ${THEMES.length} themes + ${MOBILE.length} mobile × ${THEMES.length})`);

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
      await ctx.addInitScript(({ keys, theme, org }) => {
        try {
          for (const k of keys) localStorage.setItem(k, theme);
          localStorage.setItem("taraz.lastOrg", org);
          localStorage.setItem("siraf.lastOrg", org);
        } catch {}
      }, { keys: THEME_KEYS, theme: job.theme, org: orgId });
      contexts.set(key, ctx);
    }
    return contexts.get(key);
  }

  async function shoot(job) {
    const ctx = await contextFor(job);
    const page = await ctx.newPage();
    const entry = { path: job.path, href: job.href, variant: job.variant, theme: job.theme, viewport: job.viewport, file: null, ms: 0, final_url: null, console_errors: [], console_warnings: 0, page_errors: [], failed_requests: [], flags: [] };
    const started = Date.now();
    let pending = 0;
    const isApi = (u) => u.startsWith(`${url}/api/`);
    page.on("console", (m) => {
      if (m.type() === "error") entry.console_errors.push(m.text().slice(0, 800));
      else if (m.type() === "warning") entry.console_warnings++;
    });
    page.on("pageerror", (e) => entry.page_errors.push(String(e?.stack ?? e).slice(0, 1500)));
    page.on("request", (r) => isApi(r.url()) && pending++);
    page.on("requestfinished", async (r) => {
      if (!isApi(r.url())) return;
      pending--;
      const res = await r.response().catch(() => null);
      if (res && res.status() >= 400) {
        let message = null;
        try {
          message = (await res.json())?.error?.message ?? null;
        } catch {}
        entry.failed_requests.push({ method: r.method(), url: r.url().slice(url.length), status: res.status(), message });
      }
    });
    page.on("requestfailed", (r) => {
      if (isApi(r.url())) pending--;
      const err = r.failure()?.errorText ?? "failed";
      if (err.includes("ERR_ABORTED")) return; // navigations / cancelled queries
      entry.failed_requests.push({ method: r.method(), url: r.url().startsWith(url) ? r.url().slice(url.length) : r.url(), status: 0, message: err });
    });
    try {
      await page.goto(`${url}${job.href}`, { waitUntil: "load", timeout: 30000 });
      // settled = no API request in flight, no spinner/skeleton and no boot screen for 500 ms
      const deadline = Date.now() + 20000;
      let quietSince = 0;
      while (Date.now() < deadline) {
        const busy = pending > 0 || (await page.locator(".boot, .ant-spin-spinning, .ant-skeleton-active").count().catch(() => 0)) > 0;
        if (busy) quietSince = 0;
        else if (!quietSince) quietSince = Date.now();
        else if (Date.now() - quietSince > 500) break;
        await page.waitForTimeout(100);
      }
      if (Date.now() >= deadline) entry.flags.push("not_settled_in_20s");
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme ?? null,
        notFound: document.body.innerText.includes("این صفحه پیدا نشد"),
        result: [...document.querySelectorAll(".ant-result-error .ant-result-title, .ant-result-warning .ant-result-title, .ant-result-403 .ant-result-title, .ant-result-500 .ant-result-title")].map((e) => e.textContent).join(" | "),
        alerts: [...document.querySelectorAll(".ant-alert-error")].map((e) => e.textContent?.slice(0, 200)),
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      if (state.theme !== job.theme && !(job.theme === "light" && !state.theme)) entry.flags.push(`theme_is_${state.theme}`);
      if (state.notFound) entry.flags.push("route_not_found");
      if (state.result) entry.flags.push(`result: ${state.result}`);
      for (const a of state.alerts) entry.flags.push(`error_alert: ${a}`);
      if (state.hscroll) entry.flags.push("horizontal_scroll");
      entry.final_url = page.url().slice(url.length);
      if (job.auth && entry.final_url.startsWith("/login")) entry.flags.push("redirected_to_login");
      const dir = join(OUT, job.variant === "mobile" ? `mobile-${job.theme}` : job.theme);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${slug(job.path)}.png`);
      await page.screenshot({ path: file, fullPage: FULL_PAGE, animations: "disabled", caret: "hide" });
      entry.file = file.slice(OUT.length + 1);
    } catch (e) {
      entry.flags.push(`exception: ${String(e.message ?? e).split("\n")[0]}`);
    } finally {
      entry.ms = Date.now() - started;
      await page.close().catch(() => {});
    }
    if (!job.auth) {
      // signed out: the app asks /api/auth/me once and gets 401 — that is how it learns it, not a fault
      const expected = (r) => r.status === 401 && r.url.startsWith("/api/auth/me");
      if (entry.failed_requests.some(expected)) {
        entry.expected = entry.failed_requests.filter(expected).map((r) => `${r.status} ${r.url}`);
        entry.failed_requests = entry.failed_requests.filter((r) => !expected(r));
        entry.console_errors = entry.console_errors.filter((m) => !/status of 401/.test(m));
      }
    }
    entry.ok = !entry.console_errors.length && !entry.page_errors.length && !entry.failed_requests.length && !entry.flags.length;
    report.pages.push(entry);
    const n = report.pages.length;
    if (!entry.ok || n % 20 === 0) log(`${String(n).padStart(3)}/${jobs.length} ${entry.ok ? "ok " : "ERR"} ${job.variant}/${job.theme} ${job.href}${entry.ok ? "" : ` ${JSON.stringify({ c: entry.console_errors.length, p: entry.page_errors.length, f: entry.failed_requests.map((r) => `${r.status} ${r.url}`), flags: entry.flags })}`}`);
  }

  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) await shoot(jobs[next++]);
  }));
  for (const ctx of contexts.values()) await ctx.close().catch(() => {});
  await browser.close();

  // 6. report
  const order = (e) => jobs.findIndex((j) => j.href === e.href && j.theme === e.theme && j.variant === e.variant);
  report.pages.sort((a, b) => order(a) - order(b));
  const bad = report.pages.filter((p) => !p.ok);
  report.finished = new Date().toISOString();
  report.seconds = (Date.now() - t0) / 1000;
  report.summary = {
    screenshots: report.pages.filter((p) => p.file).length,
    pages_with_problems: bad.length,
    console_errors: report.pages.reduce((a, p) => a + p.console_errors.length, 0),
    page_errors: report.pages.reduce((a, p) => a + p.page_errors.length, 0),
    failed_requests: report.pages.reduce((a, p) => a + p.failed_requests.length, 0),
    flagged: report.pages.filter((p) => p.flags.length).length,
    problems: bad.map((p) => ({ variant: p.variant, theme: p.theme, href: p.href, console_errors: p.console_errors.length, page_errors: p.page_errors.length, failed: p.failed_requests.map((r) => `${r.status} ${r.method} ${r.url}`), flags: p.flags })),
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  log(`${report.summary.screenshots} screenshots, ${bad.length} with problems → ${join(OUT, "report.json")}`);
  return bad.length;
}

let exitCode = 0;
try {
  const bad = await main();
  exitCode = bad && flag("strict") ? 1 : 0;
} catch (e) {
  console.error(e?.stack ?? e);
  exitCode = 1;
} finally {
  await stopServer();
  if (dataDir && !flag("keep-data") && !flag("keep-server")) rmSync(dataDir, { recursive: true, force: true });
  else if (dataDir) log(`data kept in ${dataDir}`);
}
process.exit(exitCode);
