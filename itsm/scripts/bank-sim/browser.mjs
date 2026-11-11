// The bank simulation's LAN client (docs/qa/BANK_SIM_FA.md): Playwright's Chromium on the runner opens
// https://kariz.bank.local the way a branch PC would. The certificate must be trusted through the Windows store (the
// bank's root CA in LocalMachine\Root): no option anywhere ignores a certificate error. Every request the pages make is
// recorded: one to any origin other than the bank's address (fonts, CDNs, maps, analytics, update checks, telemetry)
// fails the run, so does any console error or uncaught exception. Screenshots of every page go to --shots.
//
//   node browser.mjs --phase setup|pages|demo|perf|purged --base https://kariz.bank.local --state state.json --out x.json --shots dir
//     setup   the first-run setup through the setup address, as docs/SERVER_FA.md §8 describes
//     pages   the administrator's, an agent's and a requester's main pages (the requester: the portal only)
//     demo    the demo pack's pages (ATM fleet, a major incident) and its banner
//     perf    with the demo pack «متوسط» loaded: the administrator's and the requester's main pages again
//     purged  after the purge: no banner
// Every page of `pages` and `perf` is measured (docs/qa/PERFORMANCE_E2E_FA.md §2): time to first byte, DOMContentLoaded,
// content visible (no loader on screen), settled, and the API calls it made (count, time as the browser saw it), with
// the budgets of perf.mjs; the rows go to <out>/../../perf/pages-<phase>.json for the report.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Checks, State, parseArgs, sleep, log, ADMIN, PEOPLE, PASSWORD } from "./lib.mjs";
import { PageRecorder, contentVisible, navTiming, pageRow, checkPages, PERF_DIR, LOADERS as PAGE_LOADERS } from "./perf.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const a = parseArgs();
// --playwright <folder>: a Playwright installed elsewhere (a local run); CI installs it into the project
const require = createRequire(a.playwright ? join(resolve(String(a.playwright)), "noop.js") : join(ROOT, "package.json"));
const { chromium } = require("playwright");

const BASE = String(a.base ?? "https://kariz.bank.local").replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
const state = new State(a.state ? String(a.state) : null);
const C = new Checks(`browser-${a.phase}`, a.out ? String(a.out) : null);
const SHOTS = String(a.shots ?? "shots");
mkdirSync(SHOTS, { recursive: true });

const ALLOW = a["allow-console"] ? new RegExp(String(a["allow-console"])) : null;
const known = [];
const foreign = [];
const consoleErrors = [];
const serverErrors = [];
const visited = [];
/** measured visits (pages and perf phases) */
const measured = [];
const recorder = new PageRecorder(ORIGIN);
/** the persona of each browser context's pages, and whether it has loaded a page yet (its first load is cold) */
const personaOf = new WeakMap();
const warm = new Set();
let browser;

async function context() {
  browser ??= await chromium.launch({ headless: true, args: ["--disable-gpu", "--disable-extensions"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR", timezoneId: "Asia/Tehran" });
  ctx.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:") || u === "about:blank") return;
    let o = "";
    try {
      o = new URL(u).origin;
    } catch {
      o = u;
    }
    if (o !== ORIGIN) foreign.push({ url: u.slice(0, 300), type: r.resourceType(), page: r.frame()?.url?.() ?? "" });
  });
  ctx.on("response", (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(ORIGIN, "")}`);
  });
  return ctx;
}

function watch(page, label) {
  recorder.attach(page);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // an API answer of 4xx is the app's own business (a 401 before sign-in, a 403 for a role): reported through the
    // response listener (5xx fails the run), as scripts/ui-crawl.mjs does; any other console error fails it
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    // --allow-console <regex>: an error the run already knows of (an older version's bug, fixed in this build), kept
    // as a note and a metric for the report instead of failing the phase
    if (ALLOW && ALLOW.test(m.text())) {
      known.push(`${label}: ${m.text().slice(0, 300)}`);
      return;
    }
    consoleErrors.push(`${label}: ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${label}: uncaught ${String(e.message ?? e).slice(0, 400)}`));
}

const LOADERS = PAGE_LOADERS;
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const until = Date.now() + 20_000;
  while (Date.now() < until && (await page.locator(LOADERS).count().catch(() => 0))) await sleep(300);
}

let shot = 0;
/**
 * A full load of a page (a link from an e-mail, a bookmark, a refresh), measured from the navigation's start: first
 * byte, DOMContentLoaded, the content on screen without a loader, settled (no request left), and the API calls.
 */
async function visit(page, path, name) {
  const t = Date.now();
  const before = consoleErrors.length;
  const persona = personaOf.get(page.context()) ?? name.split("-")[0];
  const cold = !warm.has(page.context());
  let status = 0;
  let content = null;
  recorder.start();
  try {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    status = r?.status() ?? 0;
    content = await contentVisible(page);
    await settle(page);
  } catch (e) {
    await recorder.stop();
    C.check(false, `${name}: ${path} opens`, e.message);
    return false;
  }
  warm.add(page.context());
  const nav = await navTiming(page).catch(() => null);
  const responses = await recorder.stop();
  const text = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")) ?? "";
  const notFound = /این صفحه پیدا نشد|رکورد پیدا نشد|خطای غیرمنتظره|این صفحه با خطا روبه‌رو شد/.test(text);
  const file = join(SHOTS, `${String(++shot).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-")}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  const ms = Date.now() - t;
  visited.push({ name, path, status, ms, shot: file });
  if (nav) {
    const row = pageRow({ persona, name, path, status, cold, nav, content, settled: Math.round(t + ms - nav.origin), responses });
    measured.push(row);
    log(`page ${persona} ${name}: ttfb ${row.ttfb_ms} dcl ${row.dcl_ms} content ${row.content_ms} settled ${row.settled_ms} ms; ${row.api.count} API calls (max ${row.api.max_ms} ms)${cold ? " (cold)" : ""}`);
  }
  C.check(status < 400 && !notFound && consoleErrors.length === before, `${name} (${path}) renders without errors in ${ms} ms`, notFound ? "not found / crash screen" : consoleErrors.slice(before).join(" | "));
  return true;
}

/** Sign in through the login form (as people do); `persona` names the account in the measurements. */
async function signIn(email, password, persona = null) {
  const ctx = await context();
  if (persona) personaOf.set(ctx, persona);
  const page = await ctx.newPage();
  watch(page, email);
  // measured: the sign-in page in a browser that has nothing cached yet, then the form to the first screen
  const t = Date.now();
  let status = 0;
  if (persona) recorder.start();
  try {
    status = (await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 }))?.status() ?? 0;
  } catch (e) {
    if (persona) await recorder.stop();
    C.check(false, `the sign-in page opens over HTTPS for ${email} (certificate trusted through the Windows store)`, e.message);
    throw e;
  }
  C.check(true, `the sign-in page opens over HTTPS for ${email} (certificate trusted through the Windows store)`);
  let loginRow = null;
  if (persona) {
    const content = await contentVisible(page);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    const nav = await navTiming(page).catch(() => null);
    const responses = await recorder.stop();
    if (nav) {
      loginRow = pageRow({ persona, name: `${persona}-sign-in-page`, path: "/login", status, cold: true, nav, content, settled: Math.round(Date.now() - nav.origin), responses });
      measured.push(loginRow);
      warm.add(ctx);
    }
  }
  // with Active Directory sign-in on, the page opens on «حساب سازمانی»; a local account (the administrator's
  // break-glass account, a member made by hand) picks «ایمیل و رمز عبور», as people do
  const local = page.getByText("ایمیل و رمز عبور", { exact: true });
  await page.locator('input[autocomplete="username"]').waitFor({ timeout: 30_000 });
  if (await local.count()) {
    if (!signIn.sawDirectory) {
      const first = await page.locator('input[autocomplete="username"]').getAttribute("placeholder");
      C.check(/\\/.test(first ?? ""), "with AD sign-in on, the sign-in page opens on the organisation's account (DOMAIN\\user)", first ?? "");
      signIn.sawDirectory = true;
    }
    await local.click();
  }
  await page.locator('input[autocomplete="username"]').fill(email, { timeout: 30_000 });
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const submitAt = await page.evaluate(() => performance.now());
  await page.locator('button[type="submit"]').click();
  try {
    await page.waitForURL((x) => !x.pathname.startsWith("/login"), { timeout: 60_000 });
  } catch (e) {
    await page.screenshot({ path: join(SHOTS, `signin-failed-${email.replace(/[^a-z0-9]+/gi, "-")}.png`) }).catch(() => {});
    const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
    C.check(false, `${email} signs in through the form`, text);
    throw e;
  }
  // «ورود» to the first screen's content (the app's code for the signed-in pages comes over the network now)
  if (loginRow) {
    const shown = await contentVisible(page);
    loginRow.signin_ms = shown === null ? null : Math.round(shown - submitAt);
    log(`sign-in ${persona}: the sign-in page ${loginRow.content_ms} ms (nothing cached), «ورود» to the first screen ${loginRow.signin_ms} ms`);
  }
  await settle(page);
  return { ctx, page };
}

// ------------------------------------------------------------------------------------------------- phases

async function setup() {
  const url = state.get("setup_url");
  const ctx = await context();
  const page = await ctx.newPage();
  watch(page, "setup");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page);
  C.check(true, "the setup address opens in the browser over HTTPS without a certificate warning");
  await page.screenshot({ path: join(SHOTS, "00-setup-start.png") }).catch(() => {});
  const fill = async (id, v) => {
    await page.locator(`#${id}`).fill(String(v), { timeout: 20_000 });
    await page.locator(`#${id}`).blur();
  };
  // step 1: the organisation and its administrator
  await fill("org_name", "بانک آزمایشی شبیه‌سازی");
  await fill("full_name", ADMIN.full_name);
  await fill("email", ADMIN.email);
  await fill("password", ADMIN.password);
  await page.getByRole("button", { name: "ادامه" }).click();
  // step 2: the address (already https://kariz.bank.local) and the certificate (installed with CERTPATH)
  await page.locator("#public_url").waitFor({ state: "visible", timeout: 20_000 });
  const pub = await page.locator("#public_url").inputValue();
  C.check(pub.replace(/\/+$/, "") === BASE, "the setup proposes the bank's address", pub);
  const certText = await page.locator("text=گواهی کنونی").first().innerText({ timeout: 5000 }).catch(() => "");
  C.check(certText.includes("kariz.bank.local"), "the setup shows the bank's certificate as the current one", certText);
  await page.screenshot({ path: join(SHOTS, "00-setup-address.png") }).catch(() => {});
  await page.getByRole("button", { name: "ادامه" }).click();
  // step 3: the bank's mail relay (STARTTLS on 587) and the domain controller on the allow-list
  await page.locator("#smtp_host").waitFor({ state: "visible", timeout: 20_000 });
  await fill("smtp_host", "smtp.bank.local");
  await page.locator("#smtp_port").fill("587");
  await fill("smtp_from", "kariz@bank.local");
  await fill("allow", "dc1.bank.local");
  await page.screenshot({ path: join(SHOTS, "00-setup-mail.png") }).catch(() => {});
  await page.getByRole("button", { name: "ادامه" }).click();
  // step 4: backups (the default folder) and finish
  await page.locator("#backup_dir").waitFor({ state: "visible", timeout: 20_000 });
  C.metric("backup_dir", await page.locator("#backup_dir").inputValue());
  await page.getByRole("button", { name: "پایان راه‌اندازی" }).click();
  await page.getByText("سرور آماده است").first().waitFor({ timeout: 120_000 });
  const body = await page.locator("body").innerText();
  C.check(true, "the setup finishes: «سرور آماده است» with the recovery code");
  C.check(!/کانال ایمیل ساخته نشد|ثبت نشد/.test(body), "the setup reports no warning", body.slice(0, 500));
  await page.screenshot({ path: join(SHOTS, "00-setup-done.png") }).catch(() => {});
}

/** The requester's pages: the app sends a requester-only member to the portal; their own ticket, the catalogue and an item. */
async function requesterPages(org, label, ticket) {
  const who = PEOPLE.find((p) => p.preset === "requester");
  const req = await signIn(who.email, PASSWORD, "requester");
  await visit(req.page, `/${org}`, `${label}requester-home`);
  for (const [name, path] of [
    ["portal", `/${org}/portal`],
    ["catalogue", `/${org}/portal/catalog`],
  ])
    await visit(req.page, path, `${label}requester-${name}`);
  const item = await req.page.locator(`a[href*="/portal/items/"]`).first().getAttribute("href").catch(() => null);
  if (item) await visit(req.page, new URL(item, BASE).pathname, `${label}requester-catalogue-item`);
  else C.check(false, `${label}requester: the catalogue offers an item`);
  for (const [name, path] of [
    ["report", `/${org}/portal/report`],
    ["requests", `/${org}/portal/requests`],
    ["knowledge", `/${org}/portal/kb`],
    ...(ticket ? [["ticket", `/${org}/portal/t/incident/${ticket}`]] : []),
  ])
    await visit(req.page, path, `${label}requester-${name}`);
  await req.ctx.close();
}

async function pages() {
  const org = state.get("org");
  const inc = state.get("incident");
  const admin = await signIn(ADMIN.email, ADMIN.password, "admin");
  const list = [
    ["admin-home", `/${org}`],
    ["admin-incidents", `/${org}/incidents`],
    ["admin-incident-record", `/${org}/incidents/${inc.id}`],
    ["admin-change-calendar", `/${org}/changes/calendar`],
    ["admin-portal", `/${org}/portal`],
    ["admin-knowledge", `/${org}/kb`],
    ["admin-cmdb", `/${org}/cmdb`],
    ["admin-itam-branches", `/${org}/itam/branches`],
    ["admin-tenant-console", `/${org}/settings/admin`],
    ["admin-server-health", "/admin/server"],
  ];
  for (const [name, path] of list) await visit(admin.page, path, name);
  const health = await admin.page.locator("body").innerText().catch(() => "");
  C.check(/kariz\.bank\.local|گواهی/.test(health), "«سلامت سرور» shows the certificate and the server's checks", health.slice(0, 300));
  await admin.ctx.close();
  const agent = await signIn(PEOPLE[0].email, PASSWORD, "agent");
  for (const [name, path] of [
    ["agent-home", `/${org}`],
    ["agent-incidents", `/${org}/incidents`],
    ["agent-incident-record", `/${org}/incidents/${inc.id}`],
    ["agent-knowledge", `/${org}/kb`],
    ["agent-portal", `/${org}/portal`],
  ])
    await visit(agent.page, path, name);
  await agent.ctx.close();
  // a requester-only member (the branch employee, preset «درخواست‌دهنده»): the portal, their incident of the populate phase
  await requesterPages(org, "", inc.id);
}

/** With the demo pack «متوسط» loaded: the administrator's main pages on a bank's volume of records, and the requester's. */
async function perf() {
  const org = state.get("org");
  const inc = state.get("incident");
  const admin = await signIn(ADMIN.email, ADMIN.password, "admin");
  await visit(admin.page, `/${org}`, "demo-admin-home");
  await visit(admin.page, `/${org}/incidents`, "demo-admin-incidents");
  // a demo incident from the list (the pack's own records, with their journal, SLA and links)
  const first = await admin.page.locator(`a[href*="/incidents/"]`).evaluateAll((as) => as.map((x) => x.getAttribute("href")).filter((h) => /\/incidents\/[0-9a-f-]{36}$/.test(h ?? ""))).catch(() => []);
  if (first[0]) await visit(admin.page, new URL(first[0], BASE).pathname, "demo-admin-incident-record");
  else C.check(false, "demo-admin: the incident list links to a record");
  for (const [name, path] of [
    ["major-incidents", `/${org}/incidents/major`],
    ["change-calendar", `/${org}/changes/calendar`],
    ["catalogue", `/${org}/portal/catalog`],
    ["knowledge", `/${org}/kb`],
    ["cmdb", `/${org}/cmdb`],
    ["itam-fleet", `/${org}/itam/fleet`],
    ["itam-branches", `/${org}/itam/branches`],
    ["tenant-console", `/${org}/settings/admin`],
  ])
    await visit(admin.page, path, `demo-admin-${name}`);
  await admin.ctx.close();
  await requesterPages(org, "demo-", inc.id);
}

async function demo() {
  const org = state.get("org");
  const admin = await signIn(ADMIN.email, ADMIN.password);
  await visit(admin.page, `/${org}`, "demo-home");
  const text = await admin.page.locator("body").innerText();
  C.check(/دادهٔ نمایشی/.test(text), "the demo banner is shown", text.slice(0, 200));
  await visit(admin.page, `/${org}/itam/fleet`, "demo-atm-fleet");
  await visit(admin.page, `/${org}/incidents/major`, "demo-major-incidents");
  const first = admin.page.locator("table tbody tr a, .ant-table-row a").first();
  if (await first.isVisible().catch(() => false)) {
    const href = await first.getAttribute("href");
    if (href) await visit(admin.page, href, "demo-major-incident-record");
  } else C.note("no major incident row link found on the list");
  await admin.ctx.close();
}

async function purged() {
  const org = state.get("org");
  const admin = await signIn(ADMIN.email, ADMIN.password);
  await visit(admin.page, `/${org}`, "purged-home");
  const text = await admin.page.locator("body").innerText();
  C.check(!/این سازمان دادهٔ نمایشی دارد/.test(text), "the demo banner is gone after the purge");
  await admin.ctx.close();
}

const PHASES = { setup, pages, demo, perf, purged };
await C.run(async () => {
  try {
    await PHASES[String(a.phase)]();
  } finally {
    await browser?.close().catch(() => {});
    C.check(foreign.length === 0, `no request left the bank's origin (${ORIGIN})`, JSON.stringify(foreign.slice(0, 20)));
    C.check(consoleErrors.length === 0, "no console error or uncaught exception", consoleErrors.slice(0, 20).join(" | "));
    C.check(serverErrors.length === 0, "no server error (5xx) answered a page", serverErrors.slice(0, 20).join(" | "));
    if (known.length) {
      C.metric("known_console", known.length);
      C.note(`known console error(s) of this version: ${known[0]}`);
    }
    if (measured.length) {
      // the pages' speed per persona against the budgets of perf.mjs; the rows for the report
      const dir = a.out ? PERF_DIR(String(a.out)) : join(SHOTS, "..", "perf");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `pages-${a.phase}.json`), JSON.stringify(measured, null, 2));
      C.metric("pages", checkPages(C, measured, String(a.phase)));
    }
    writeFileSync(join(SHOTS, `requests-${a.phase}.json`), JSON.stringify({ foreign, consoleErrors, serverErrors, visited }, null, 2));
    log(`${visited.length} pages, ${foreign.length} foreign requests, ${consoleErrors.length} console errors`);
  }
});
