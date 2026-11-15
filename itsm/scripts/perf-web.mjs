// Performance of the web version (docs/PERFORMANCE_FA.md §«نسخهٔ وب»), against a running server — `next start` locally
// or the real Vercel deployment. Node 22+, no dependencies (the `ui` mode uses Playwright when it is installed).
//
//   node scripts/perf-web.mjs seed --base URL --email E --password P [--size small] [--cron-secret S]
//       an owner (signs up when the address is new), an organisation and the bank demo pack («کوچک» by default)
//   node scripts/perf-web.mjs api  --base URL --email E --password P [--runs 15] [--pg URL] [--json FILE]
//       warm latency (median / p95) of sign-in, home, the incident list, an incident, the catalogue and search; with
//       --pg (a PostgreSQL URL of the same database with pg_stat_statements: Supabase has it) the database round trips
//       of each request too
//   node scripts/perf-web.mjs cold --app DIR --port N --db URL --email E --password P [--runs 3]
//       starts `next start` in DIR afresh N times and times the first byte of /api/auth/me (a cold instance)
//   node scripts/perf-web.mjs ui   --base URL --email E --password P
//       the first screen in a real browser: bytes of JS/CSS/fonts, requests, cache headers, API calls in order
//
// The CPUs of a shared machine vary: every result carries the load average, and runs should be compared back to back.
import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : dflt;
};
const base = (opt("base", "http://127.0.0.1:3000") ?? "").replace(/\/$/, "");
const email = opt("email", "owner@example.com");
const password = opt("password", "Owner-pass-2026");
const load = () => loadavg().map((x) => x.toFixed(2)).join(", ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(origin) {
  let cookie = "";
  return async (method, path, body, extra = {}) => {
    const t = performance.now();
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    const ms = performance.now() - t;
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text.slice(0, 200);
    }
    return { status: res.status, ms, json, bytes: text.length, cookie };
  };
}

async function signIn(api) {
  const r = await api("POST", "/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`sign-in failed: ${r.status} ${JSON.stringify(r.json)}`);
  const me = await api("GET", "/auth/me");
  const org = opt("org") ?? me.json.orgs?.[0]?.id;
  return { org, me: me.json };
}

// ------------------------------------------------------------------------------------------------------------- seed
async function seed() {
  const api = client(base);
  const size = opt("size", "small");
  const cron = opt("cron-secret");
  let r = await api("POST", "/auth/login", { email, password });
  if (r.status !== 200) {
    r = await api("POST", "/auth/signup", { email, password, full_name: "مالک سامانه" });
    if (r.status !== 200) throw new Error(`sign-up failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  let me = (await api("GET", "/auth/me")).json;
  let org = me.orgs?.[0]?.id;
  if (!org) org = (await api("POST", "/orgs", { name: "بانک نمونه", timezone: "Asia/Tehran" })).json.id;
  let st = (await api("GET", `/o/${org}/demo`)).json;
  if (st.state === "none") {
    const l = await api("POST", `/o/${org}/demo/load`, { size, force: true });
    if (l.status !== 200) throw new Error(`demo load refused: ${l.status} ${JSON.stringify(l.json)}`);
  }
  const t0 = Date.now();
  for (;;) {
    st = (await api("GET", `/o/${org}/demo`)).json;
    if (st.state === "loaded" || st.state === "failed") break;
    // the job queue's heartbeat (Vercel cron calls the same with CRON_SECRET)
    await api("POST", "/cron/tick", {}, cron ? { authorization: `Bearer ${cron}` } : {});
    if (Date.now() - t0 > 120 * 60_000) throw new Error("the demo pack did not load in 2 hours");
    await sleep(cron ? 200 : 10_000);
  }
  console.log(`demo pack «${size}»: ${st.state} in ${Math.round((Date.now() - t0) / 1000)} s; organisation ${org}`);
  // drain what the load queued (indexes, SLA timers…)
  if (cron) for (let i = 0; i < 30; i++) {
    const t = await api("POST", "/cron/tick", {}, { authorization: `Bearer ${cron}` });
    if (!t.json?.ran) break;
  }
}

// -------------------------------------------------------------------------------------------------------------- api
/** pg_stat_statements of one database: total calls (round trips that ran a statement), reset between requests. */
async function statements(url) {
  if (!url) return null;
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ssl: url.includes("sslmode=disable") || /127\.0\.0\.1|localhost/.test(url) ? false : "require" });
  const db = (await sql`select current_database() as d`)[0].d;
  return {
    async reset() {
      await sql`select pg_stat_statements_reset()`;
    },
    async calls() {
      const r = await sql.unsafe(`select coalesce(sum(calls), 0)::int as n from pg_stat_statements s join pg_database d on d.oid = s.dbid where d.datname = $1 and s.query not ilike '%pg_stat_statements%'`, [db]);
      return r[0].n;
    },
    end: () => sql.end({ timeout: 2 }),
  };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function apiMode() {
  const runs = Number(opt("runs", 15));
  const api = client(base);
  const { org } = await signIn(api);
  // targets: the first incident and a search word taken from it
  const list = await api("POST", `/o/${org}/r/incident/query`, { size: 1, fields: ["number", "short_description"] });
  const incident = list.json?.rows?.[0]?.id;
  const word = String(list.json?.rows?.[0]?.short_description ?? "سرور").split(/\s+/)[0];
  const count = { filter: { and: [{ f: "assigned_to", op: "is_me" }, { f: "active", op: "eq", v: true }] }, size: 1, fields: ["number"], total: true };
  const cases = [
    ["sign-in", () => client(base)("POST", "/auth/login", { email, password })],
    ["me", () => api("GET", "/auth/me")],
    ["organisation", () => api("GET", `/o/${org}`)],
    ["badge count (one)", () => api("POST", `/o/${org}/r/incident/query`, count)],
    ["incident list (25)", () => api("POST", `/o/${org}/r/incident/query`, { size: 25 })],
    ["incident record", () => api("GET", `/o/${org}/r/incident/${incident}`)],
    ["catalogue (portal)", () => api("GET", `/o/${org}/portal/catalog`)],
    ["search (incidents)", () => api("POST", `/o/${org}/r/incident/query`, { q: word, size: 25 })],
  ];
  const pg = await statements(opt("pg"));
  const out = [];
  for (const [name, fn] of cases) {
    const first = await fn();
    if (first.status !== 200) {
      out.push({ name, status: first.status, error: JSON.stringify(first.json).slice(0, 160) });
      continue;
    }
    const ms = [];
    let trips = null;
    // sign-in is rate limited per address (8 in 15 minutes): a few runs only
    const n = name === "sign-in" ? Math.min(runs, 5) : runs;
    for (let i = 0; i < n; i++) {
      if (pg && i === 0) await pg.reset();
      const r = await fn();
      if (pg && i === 0) trips = await pg.calls();
      if (r.status !== 200) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.json).slice(0, 160)} (sign-in limits: restart the server)`);
      ms.push(r.ms);
    }
    out.push({ name, status: 200, median: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), bytes: first.bytes, db_round_trips: trips });
  }
  await pg?.end();
  const report = { at: new Date().toISOString(), base, load: load(), runs, results: out };
  console.table(out);
  console.log(`load average: ${report.load}`);
  if (opt("json")) writeFileSync(opt("json"), JSON.stringify(report, null, 2));
}

// ------------------------------------------------------------------------------------------------------------- cold
async function coldMode() {
  const app = opt("app");
  const port = Number(opt("port", 3990));
  const runs = Number(opt("runs", 3));
  const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: opt("db"), ...(opt("ssl") === "disable" ? { DATABASE_SSL: "disable" } : {}) };
  const start = async () => {
    const log = openSync(`/tmp/perf-web-cold-${port}.log`, "a");
    const p = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { cwd: app, env, stdio: ["ignore", log, log], detached: true });
    for (let i = 0; i < 300; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/favicon.ico`);
        break;
      } catch {
        await sleep(50);
      }
    }
    return () => {
      try {
        process.kill(-p.pid, "SIGKILL");
      } catch {}
    };
  };
  // a session cookie from a warm server first
  let stop = await start();
  const warm = client(`http://127.0.0.1:${port}`);
  for (let i = 0; i < 100; i++) {
    const h = await warm("GET", "/health");
    if (h.status === 200) break;
    await sleep(1000);
  }
  const login = await warm("POST", "/auth/login", { email, password });
  if (login.status !== 200) throw new Error(`sign-in failed: ${login.status}`);
  const cookie = login.cookie;
  stop();
  const times = [];
  for (let i = 0; i < runs; i++) {
    await sleep(500);
    stop = await start();
    const t = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } });
    await res.text();
    times.push(Math.round(performance.now() - t));
    // and the next request on the same (now warm) instance
    const t2 = performance.now();
    await (await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } })).text();
    console.log(`cold /api/auth/me: ${res.status} ${times[i]} ms (then warm: ${Math.round(performance.now() - t2)} ms)`);
    stop();
  }
  console.log(`cold start, first byte of /api/auth/me: median ${pct(times, 50)} ms over ${runs} (load ${load()})`);
}

// --------------------------------------------------------------------------------------------------------------- ui
async function uiMode() {
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = require(`${process.env.npm_config_prefix ?? "/opt/node22"}/lib/node_modules/playwright`));
  }
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ locale: "fa-IR" });
  const page = await ctx.newPage();
  const seen = [];
  const t0 = Date.now();
  page.on("response", async (res) => {
    const url = new URL(res.url());
    const req = res.request();
    let bytes = 0;
    try {
      bytes = (await res.body()).length;
    } catch {}
    seen.push({ at: Date.now() - t0, type: req.resourceType(), path: url.pathname + (url.search.length < 60 ? url.search : ""), status: res.status(), bytes, cache: res.headers()["cache-control"] ?? "", encoding: res.headers()["content-encoding"] ?? "" });
  });
  await page.goto(`${base}/login`, { waitUntil: "commit" });
  await page.waitForSelector("input[type=password]", { timeout: 60_000 });
  const formAt = Date.now() - t0;
  const beforeForm = seen.slice();
  await page.waitForLoadState("networkidle");
  const loginLoad = seen.length;
  await page.fill("input[type=email], input#email, input[name=email]", email).catch(() => {});
  await page.fill("input[type=password]", password);
  await page.keyboard.press("Enter");
  const submitted = Date.now();
  // the first screen: the organisation's home (or the organisation wizard for an account without one)
  await page.waitForURL((u) => /^\/([0-9a-f-]{36}|orgs)/.test(u.pathname), { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("sign-in did not go through (wrong password, or rate limited: restart the server)");
  const firstScreen = Date.now() - t0;
  const afterSubmit = Date.now() - submitted;
  if (process.env.PERF_DEBUG) console.log("after sign-in at", page.url());
  const sum = (xs, t) => xs.filter((x) => t.includes(x.type)).reduce((s, x) => s + x.bytes, 0);
  const login = seen.slice(0, loginLoad);
  const after = seen.slice(loginLoad);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`sign-in form visible after ${formAt} ms: ${beforeForm.length} requests before it, JS ${kb(sum(beforeForm, ["script"]))}, CSS ${kb(sum(beforeForm, ["stylesheet"]))}, fonts ${kb(sum(beforeForm, ["font"]))}`);
  console.log(`sign-in page until idle (with what it preloads): ${login.length} requests, JS ${kb(sum(login, ["script"]))}, CSS ${kb(sum(login, ["stylesheet"]))}, fonts ${kb(sum(login, ["font"]))} (uncompressed bytes)`);
  console.log(`after sign-in until idle: ${afterSubmit} ms from the click (${firstScreen} ms from the start): ${after.length} requests, JS ${kb(sum(after, ["script"]))}, CSS ${kb(sum(after, ["stylesheet"]))}, API ${after.filter((x) => x.path.startsWith("/api/")).length}`);
  console.log("API calls in order (ms since start):");
  for (const x of seen.filter((x) => x.path.startsWith("/api/"))) console.log(`  ${String(x.at).padStart(6)}  ${x.status}  ${x.path}`);
  const assets = seen.filter((x) => /^\/(assets|fonts)\//.test(x.path));
  const notImmutable = assets.filter((x) => !/immutable/.test(x.cache));
  console.log(`static assets: ${assets.length}, without an immutable cache header: ${notImmutable.length}${notImmutable.length ? ` (${notImmutable.slice(0, 3).map((x) => x.path).join(", ")})` : ""}`);
  // the brief's screens, each opened directly (a link or a reload: the whole first-screen fan-out every time)
  const org = new URL(page.url()).pathname.split("/")[1];
  if (/^[0-9a-f-]{36}$/.test(org)) {
    const api = await page.evaluate(async (o) => {
      const r = await fetch(`/api/o/${o}/r/incident/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size: 1, fields: ["number", "short_description"] }) });
      return r.json();
    }, org);
    const inc = api?.rows?.[0];
    const word = String(inc?.short_description ?? "").split(/\s+/)[0] || "سرور";
    const screens = [
      ["home", `/${org}`],
      ["incident list", `/${org}/incidents`],
      ["incident record", inc ? `/${org}/incidents/${inc.id}` : null],
      ["catalogue (portal)", `/${org}/portal`],
      ["search (list with a word)", `/${org}/incidents?q=${encodeURIComponent(word)}`],
    ];
    console.log("screens opened directly (until the network is idle):");
    for (const [name, path] of screens) {
      if (!path) continue;
      const from = seen.length;
      const t = Date.now();
      await page.goto(`${base}${path}`, { waitUntil: "commit" });
      await page.waitForLoadState("networkidle");
      const part = seen.slice(from);
      const apiCalls = part.filter((x) => x.path.startsWith("/api/"));
      console.log(`  ${name.padEnd(28)} ${String(Date.now() - t).padStart(6)} ms, ${String(apiCalls.length).padStart(3)} API calls, ${part.length} requests`);
    }
  }
  console.log(`load average: ${load()}`);
  await browser.close();
}

const modes = { seed, api: apiMode, cold: coldMode, ui: uiMode };
if (!modes[mode]) {
  console.error("usage: node scripts/perf-web.mjs seed|api|cold|ui --base URL --email E --password P …");
  process.exit(2);
}
await modes[mode]();
