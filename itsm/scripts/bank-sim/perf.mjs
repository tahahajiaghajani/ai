// The installed server edition's speed as people see it (docs/qa/PERFORMANCE_E2E_FA.md §2): the budgets of the bank
// simulation's measurements and the helpers its scripts share — every page's time to first byte, DOMContentLoaded,
// content visible and API calls as the browser saw them (browser.mjs), the load test's percentiles per endpoint
// (api.mjs), KarizApp's and KarizDB's memory and CPU at idle and under the load (sampled by resources.ps1) — and the
// report that brings them together (perf/server-perf.json, perf/server-perf.md, the job summary).
//
//   node --use-system-ca perf.mjs --phase perf-resources --idle <jsonl> --load <jsonl> --out x.json
//   node --use-system-ca perf.mjs --phase perf-report --dir <bank-sim output folder> --out x.json
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Budgets: a check fails past them. Set from the runs on GitHub's windows-latest (4 vCPU, 16 GB) with the bank's
 * certificate, the browser on the same machine (docs/qa/PERFORMANCE_E2E_FA.md §2-5 has the numbers they come from).
 * Page times are counted from the navigation's start (a full load of the page, as a link from e-mail or a refresh);
 * API times as the browser saw them; the load test's per endpoint as its client saw them.
 */
export const SERVER_BUDGETS = {
  // the HTML document's first byte (the app shell is a static file: no database work): 14-22 ms p95 (run 43122558365)
  page_ttfb_p95_ms: 300,
  // DOMContentLoaded: the shell parsed and its scripts run: 121-179 ms p95
  page_dcl_p95_ms: 1_000,
  // the page's own content on screen with no loader left, per persona: 95th percentile and the slowest page — 1.07-1.32 s
  // on the small data, 1.17 s (requester) and 1.74 s (administrator: the incident record) with the demo pack «متوسط»
  page_content_p95_ms: 4_000,
  page_content_max_ms: 5_000,
  // every API call the pages made, as the browser saw it (95th percentile per persona): 115-223 ms
  api_p95_ms: 1_000,
  // API calls one page makes on its own (a regression budget: a page that starts asking per row shows up here): 40 at
  // most (the incident record)
  api_calls_per_page_max: 60,
  // «ورود» on the sign-in form to the first screen's content, in a browser that had nothing of the app cached: 0.49-0.59 s
  signin_ms: 2_500,
  // the load test (40 virtual users, 31 operations/s): per endpoint, 95th and 99th percentile — 10-45 ms and 16-65 ms
  load_endpoint_p95_ms: 150,
  load_endpoint_p99_ms: 300,
  // KarizApp (the supervisor and its workers) and KarizDB (PostgreSQL: the postmaster and every backend), private
  // memory summed over their processes, the peak of idle and load: 437 MB and 413 MB under the load
  app_private_peak_mb: 1_200,
  db_private_peak_mb: 1_200,
  // both services together while nobody uses the server (the scheduler and background jobs), % of one core: 1%
  idle_cpu_pct: 30,
};

export const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

// ------------------------------------------------------------------------------------------------- pages

/** Loaders the app shows while it waits (the boot screen, skeletons, spinners): content is visible when none is on screen. */
export const LOADERS = "#root > .boot, .sh-boot, .sh-wait, .ds-loader, .ant-skeleton, .ant-spin-spinning, .sh-loader";
/** The page's content area, in order: the portal's, the app shell's, any <main> (sign-in, setup). */
export const MAIN = ["#portal-main", "#main", "main"];

/**
 * Milliseconds from the navigation's start until the page shows its content: no loader on screen and the content area
 * holds text. null when that does not happen within `ms`.
 */
export async function contentVisible(page, ms = 30_000) {
  try {
    const h = await page.waitForFunction(
      ({ loaders, main }) => {
        const root = document.getElementById("root");
        const onScreen = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
        };
        if (!root || [...document.querySelectorAll(loaders)].some(onScreen)) return false;
        const el = main.map((x) => document.querySelector(x)).find(Boolean) ?? root;
        return (el.innerText || "").trim().length > 20 ? Math.round(performance.now()) : false;
      },
      { loaders: LOADERS, main: MAIN },
      { timeout: ms, polling: "raf" },
    );
    return Number(await h.jsonValue());
  } catch {
    return null;
  }
}

/** The navigation's own timing (from its start) and what the page fetched besides the API (code, styles, fonts, images). */
export async function navTiming(page) {
  return page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource").filter((r) => !new URL(r.name).pathname.startsWith("/api/"));
    return {
      origin: performance.timeOrigin,
      ttfb: n ? Math.round(n.responseStart) : null,
      dcl: n ? Math.round(n.domContentLoadedEventEnd) : null,
      load: n ? Math.round(n.loadEventEnd) : null,
      doc_kb: n ? Math.round(n.transferSize / 102.4) / 10 : null,
      assets: res.length,
      // a resource served from the browser's cache has no transfer (immutable hashed assets on a second visit)
      assets_cached: res.filter((r) => r.transferSize === 0 && r.decodedBodySize > 0).length,
      assets_kb: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 102.4) / 10,
      // hashed code and styles that came over the network on this load
      fetched: res.filter((r) => r.transferSize > 0 && new URL(r.name).pathname.startsWith("/assets/")).map((r) => new URL(r.name).pathname),
    };
  });
}

/**
 * Records every same-origin response of a page while a visit runs: API calls with their time as the browser saw it
 * (Playwright's request timing), and the headers that tell whether the server compressed and cached what it sent.
 */
export class PageRecorder {
  constructor(origin) {
    this.origin = origin;
    this.pending = [];
    this.active = false;
  }
  attach(page) {
    const done = (r, failed) => {
      if (!this.active) return;
      let u;
      try {
        u = new URL(r.url());
      } catch {
        return;
      }
      if (u.origin !== this.origin) return;
      this.pending.push(
        (async () => {
          const t = r.timing();
          const res = failed ? null : await r.response().catch(() => null);
          const h = res ? await res.allHeaders().catch(() => ({})) : {};
          return {
            path: u.pathname,
            search: u.search,
            method: r.method(),
            status: res?.status() ?? 0,
            failed,
            api: u.pathname.startsWith("/api/"),
            start: t.startTime,
            ms: Math.max(0, Math.round(t.responseEnd > 0 ? t.responseEnd : 0)),
            encoding: h["content-encoding"] ?? null,
            cache: h["cache-control"] ?? null,
            type: (h["content-type"] ?? "").split(";")[0],
            length: Number(h["content-length"] ?? -1),
          };
        })(),
      );
    };
    page.on("requestfinished", (r) => done(r, false));
    page.on("requestfailed", (r) => done(r, true));
  }
  start() {
    this.pending = [];
    this.active = true;
  }
  async stop() {
    this.active = false;
    const out = await Promise.all(this.pending);
    this.pending = [];
    return out;
  }
}

/** Paths with their record and organisation ids replaced, for the report. */
export const route = (p) => String(p).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");

/** One visit's row: the page's times from the navigation's start and its API calls. */
export function pageRow({ persona, name, path, status, cold, nav, content, settled, responses }) {
  const api = responses.filter((r) => r.api);
  const times = api.map((r) => r.ms);
  const end = (r) => r.start + r.ms - nav.origin;
  return {
    persona,
    name,
    path,
    status,
    cold,
    ttfb_ms: nav.ttfb,
    dcl_ms: nav.dcl,
    content_ms: content,
    settled_ms: settled,
    doc_kb: nav.doc_kb,
    assets: nav.assets,
    assets_cached: nav.assets_cached,
    assets_kb: nav.assets_kb,
    fetched: nav.fetched ?? [],
    api: {
      count: api.length,
      failed: api.filter((r) => r.failed || r.status >= 500).length,
      sum_ms: times.reduce((s, x) => s + x, 0),
      p50_ms: pct(times, 50),
      max_ms: times.length ? Math.max(...times) : null,
      last_end_ms: api.length ? Math.round(Math.max(...api.map(end))) : null,
      slowest: [...api].sort((x, y) => y.ms - x.ms).slice(0, 3).map((r) => `${r.method} ${route(r.path)} ${r.ms}`),
      calls: api.map((r) => ({ m: r.method, p: route(r.path), ms: r.ms, at: Math.round(r.start - nav.origin), enc: r.encoding, len: r.length, s: r.status, type: r.type })),
    },
    headers: responses.filter((r) => !r.api).map((r) => ({ p: r.path, enc: r.encoding, cache: r.cache, type: r.type, len: r.length, s: r.status })),
  };
}

/** Per persona: percentiles of the page times and of every API call. */
export function summarizePages(rows) {
  const out = {};
  for (const persona of [...new Set(rows.map((r) => r.persona))]) {
    const rs = rows.filter((r) => r.persona === persona);
    const val = (k) => rs.map((r) => r[k]).filter((x) => typeof x === "number");
    const api = rs.flatMap((r) => r.api.calls.map((c) => c.ms));
    out[persona] = {
      pages: rs.length,
      ttfb_p50_ms: pct(val("ttfb_ms"), 50),
      ttfb_p95_ms: pct(val("ttfb_ms"), 95),
      dcl_p50_ms: pct(val("dcl_ms"), 50),
      dcl_p95_ms: pct(val("dcl_ms"), 95),
      content_p50_ms: pct(val("content_ms"), 50),
      content_p95_ms: pct(val("content_ms"), 95),
      content_max_ms: val("content_ms").length ? Math.max(...val("content_ms")) : null,
      not_shown: rs.filter((r) => r.content_ms === null).map((r) => r.name),
      api_calls: api.length,
      api_calls_max: rs.length ? Math.max(...rs.map((r) => r.api.count)) : 0,
      api_p50_ms: pct(api, 50),
      api_p95_ms: pct(api, 95),
      api_max_ms: api.length ? Math.max(...api) : null,
      signin_ms: rs.find((r) => "signin_ms" in r)?.signin_ms ?? null,
    };
  }
  return out;
}

/** The budgets of the pages and what the server must send (compressed API answers, hashed assets cached for good). */
export function checkPages(C, rows, label) {
  const B = SERVER_BUDGETS;
  const sum = summarizePages(rows);
  for (const [persona, s] of Object.entries(sum)) {
    C.check(!s.not_shown.length, `${label} ${persona}: every page shows its content within 30 s`, s.not_shown.join(", "));
    C.check((s.ttfb_p95_ms ?? 0) <= B.page_ttfb_p95_ms, `${label} ${persona}: time to first byte p95 ${s.ttfb_p95_ms} ms ≤ ${B.page_ttfb_p95_ms} ms`);
    C.check((s.dcl_p95_ms ?? 0) <= B.page_dcl_p95_ms, `${label} ${persona}: DOMContentLoaded p95 ${s.dcl_p95_ms} ms ≤ ${B.page_dcl_p95_ms} ms`);
    C.check((s.content_p95_ms ?? 0) <= B.page_content_p95_ms, `${label} ${persona}: content visible p95 ${s.content_p95_ms} ms ≤ ${B.page_content_p95_ms} ms`);
    C.check((s.content_max_ms ?? 0) <= B.page_content_max_ms, `${label} ${persona}: slowest page ${s.content_max_ms} ms ≤ ${B.page_content_max_ms} ms`, rows.filter((r) => r.persona === persona && (r.content_ms ?? Infinity) > B.page_content_max_ms).map((r) => r.name).join(", "));
    C.check((s.api_p95_ms ?? 0) <= B.api_p95_ms, `${label} ${persona}: API p95 ${s.api_p95_ms} ms over ${s.api_calls} calls ≤ ${B.api_p95_ms} ms`);
    const signins = rows.filter((r) => r.persona === persona && "signin_ms" in r);
    for (const r of signins) C.check(r.signin_ms !== null && r.signin_ms <= B.signin_ms, `${label} ${persona}: «ورود» to the first screen ${r.signin_ms} ms ≤ ${B.signin_ms} ms (nothing cached)`);
    C.check(s.api_calls_max <= B.api_calls_per_page_max, `${label} ${persona}: at most ${s.api_calls_max} API calls on one page ≤ ${B.api_calls_per_page_max}`, rows.filter((r) => r.persona === persona && r.api.count > B.api_calls_per_page_max).map((r) => `${r.name}: ${r.api.count}`).join(", "));
  }
  // what the server sends: JSON answers of a useful size compressed, hashed assets immutable, the shell revalidated
  const calls = rows.flatMap((r) => r.api.calls);
  // (JSON only: attachments and images are sent as they are; the server compresses an answer from 1 KB)
  const big = calls.filter((c) => c.s === 200 && /json/.test(c.type ?? "") && c.len !== 0 && (c.len > 2048 || c.len < 0));
  const plain = big.filter((c) => !c.enc);
  C.check(!plain.length, `${label}: API answers are compressed (${big.length - plain.length}/${big.length} of the larger ones br/gzip)`, plain.slice(0, 5).map((c) => `${c.m} ${c.p}`).join(", "));
  const assets = rows.flatMap((r) => r.headers).filter((h) => h.p.startsWith("/assets/") && h.s === 200);
  const notImmutable = assets.filter((h) => !/immutable/.test(h.cache ?? ""));
  C.check(!notImmutable.length, `${label}: hashed assets are cached for good (${assets.length} answers immutable)`, notImmutable.slice(0, 5).map((h) => `${h.p}: ${h.cache}`).join(", "));
  // a hashed file a persona's browser already has never comes over the network again (it is immutable)
  const again = [];
  let reused = 0;
  for (const persona of Object.keys(sum)) {
    const seen = new Set();
    for (const r of rows.filter((x) => x.persona === persona)) {
      for (const f of r.fetched ?? []) if (seen.has(f)) again.push(`${persona} ${r.name}: ${f}`);
      for (const f of r.fetched ?? []) seen.add(f);
      reused += r.assets_cached ?? 0;
    }
  }
  C.check(!again.length, `${label}: no page downloads code its browser already has (${reused} files from the cache)`, again.slice(0, 5).join(", "));
  return sum;
}

// ------------------------------------------------------------------------------------------------- resources

/** Samples of resources.ps1 (one JSON line each): processes of the installation folder with memory and processor time. */
export function readSamples(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** KarizDB: PostgreSQL's processes and the service's wrapper; KarizApp: everything else (node.exe and its wrapper). */
const serviceOf = (name) => (/^postgres|db\.exe$/i.test(String(name)) ? "db" : "app");

/** CPU (% of one core, from the processor time between samples) and memory (MB, summed per service) over a window. */
export function summarizeResources(samples) {
  const out = { samples: samples.length, seconds: 0 };
  if (samples.length < 2) return out;
  out.seconds = Math.round((samples[samples.length - 1].ms - samples[0].ms) / 1000);
  for (const svc of ["app", "db"]) {
    const cpu = [];
    let wsPeak = 0;
    let privPeak = 0;
    let procs = 0;
    for (let i = 0; i < samples.length; i++) {
      const cur = (samples[i].procs ?? []).filter((p) => serviceOf(p.name) === svc);
      wsPeak = Math.max(wsPeak, cur.reduce((s, p) => s + Number(p.ws || 0), 0));
      privPeak = Math.max(privPeak, cur.reduce((s, p) => s + Number(p.priv || 0), 0));
      procs = Math.max(procs, cur.length);
      if (!i) continue;
      const prev = new Map((samples[i - 1].procs ?? []).map((p) => [p.pid, p]));
      const dt = samples[i].ms - samples[i - 1].ms;
      if (dt <= 0) continue;
      // processor time in 100 ns units: a process that is new in this sample counts from its start (unknown: skipped)
      const used = cur.reduce((s, p) => (prev.has(p.pid) ? s + Math.max(0, Number(p.cpu100ns) - Number(prev.get(p.pid).cpu100ns)) : s), 0);
      cpu.push((used / 10_000 / dt) * 100);
    }
    out[svc] = {
      cpu_avg_pct: cpu.length ? Math.round(cpu.reduce((s, x) => s + x, 0) / cpu.length) : null,
      cpu_p95_pct: cpu.length ? Math.round(pct(cpu, 95)) : null,
      cpu_max_pct: cpu.length ? Math.round(Math.max(...cpu)) : null,
      ws_peak_mb: Math.round(wsPeak / 1048576),
      private_peak_mb: Math.round(privPeak / 1048576),
      processes: procs,
    };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- report

const fmt = (v, unit = "") => (v === null || v === undefined ? "—" : `${typeof v === "number" ? v.toLocaleString("en-US") : v}${unit}`);

export function reportMarkdown(r) {
  const md = ["# Server edition: pages, load and resources", "", `Budgets: ${Object.entries(r.budgets).map(([k, v]) => `${k} ${v}`).join(", ")}`, ""];
  for (const [label, p] of Object.entries(r.pages ?? {})) {
    md.push(`## Pages — ${label}`, "", "| persona | page | TTFB | DCL | content | settled | API calls | API max | slowest API | assets (cached) |", "|---|---|---:|---:|---:|---:|---:|---:|---|---:|");
    for (const x of p.rows) md.push(`| ${x.persona} | ${x.name}${x.cold ? " (cold)" : ""} | ${fmt(x.ttfb_ms)} | ${fmt(x.dcl_ms)} | ${fmt(x.content_ms)} | ${fmt(x.settled_ms)} | ${x.api.count} | ${fmt(x.api.max_ms)} | ${x.api.slowest[0] ?? ""} | ${x.assets} (${x.assets_cached}) |`);
    md.push("", "| persona | pages | sign-in to first screen | TTFB p50/p95 | DCL p50/p95 | content p50/p95/max | API calls (max/page) | API p50/p95/max |", "|---|---:|---:|---|---|---|---|---|");
    for (const [persona, s] of Object.entries(p.summary)) md.push(`| ${persona} | ${s.pages} | ${fmt(s.signin_ms)} | ${fmt(s.ttfb_p50_ms)} / ${fmt(s.ttfb_p95_ms)} | ${fmt(s.dcl_p50_ms)} / ${fmt(s.dcl_p95_ms)} | ${fmt(s.content_p50_ms)} / ${fmt(s.content_p95_ms)} / ${fmt(s.content_max_ms)} | ${s.api_calls} (${s.api_calls_max}) | ${fmt(s.api_p50_ms)} / ${fmt(s.api_p95_ms)} / ${fmt(s.api_max_ms)} |`);
    md.push("");
  }
  if (r.load) {
    md.push(`## Load test — ${r.load.users} virtual users, ${r.load.seconds} s, ${r.load.requests} operations, ${r.load.rps}/s, ${r.load.errors} errors`, "", "| endpoint | n | p50 | p95 | p99 |", "|---|---:|---:|---:|---:|");
    for (const [k, v] of Object.entries(r.load.per ?? {})) md.push(`| ${k} | ${v.n} | ${fmt(v.p50)} | ${fmt(v.p95)} | ${fmt(v.p99)} |`);
    md.push("");
  }
  if (r.resources) {
    md.push("## KarizApp and KarizDB", "", "| window | service | CPU avg / p95 / max (% of a core) | private peak (MB) | working set peak (MB) | processes |", "|---|---|---|---:|---:|---:|");
    for (const [w, s] of Object.entries(r.resources)) for (const svc of ["app", "db"]) if (s[svc]) md.push(`| ${w} (${s.seconds} s) | ${svc === "app" ? "KarizApp" : "KarizDB"} | ${fmt(s[svc].cpu_avg_pct)} / ${fmt(s[svc].cpu_p95_pct)} / ${fmt(s[svc].cpu_max_pct)} | ${fmt(s[svc].private_peak_mb)} | ${fmt(s[svc].ws_peak_mb)} | ${s[svc].processes} |`);
    md.push("");
  }
  if (r.failed?.length) md.push("## Over budget", "", ...r.failed.map((f) => `- ${f}`), "");
  return md.join("\n");
}

// ------------------------------------------------------------------------------------------------- CLI

const same = (x, y) => (process.platform === "win32" ? resolve(x).toLowerCase() === resolve(y).toLowerCase() : resolve(x) === resolve(y));
const isMain = !!process.argv[1] && same(fileURLToPath(import.meta.url), process.argv[1]);
if (isMain) {
  const { Checks, parseArgs } = await import("./lib.mjs");
  const a = parseArgs();
  const phase = String(a.phase ?? "").replace(/^perf-/, "");
  const C = new Checks(`perf-${phase}`, a.out ? String(a.out) : null);
  await C.run(async () => {
    if (phase === "resources") {
      const B = SERVER_BUDGETS;
      const idle = summarizeResources(readSamples(a.idle ? String(a.idle) : null));
      const load = summarizeResources(readSamples(a.load ? String(a.load) : null));
      C.metric("resources", { idle, load });
      C.check(idle.samples >= 10 && load.samples >= 10, `KarizApp and KarizDB were sampled at idle (${idle.samples}) and under the load (${load.samples})`);
      if (idle.app && idle.db) {
        const cpu = (idle.app.cpu_avg_pct ?? 0) + (idle.db.cpu_avg_pct ?? 0);
        C.check(cpu <= B.idle_cpu_pct, `idle: KarizApp + KarizDB use ${cpu}% of a core on average ≤ ${B.idle_cpu_pct}%`);
      }
      for (const [w, s] of [["idle", idle], ["load", load]]) {
        if (!s.app || !s.db) continue;
        C.check(s.app.processes >= 2 && s.db.processes >= 2, `${w}: the installation's processes were found (KarizApp ${s.app.processes}, KarizDB ${s.db.processes})`);
        C.check(s.app.private_peak_mb <= B.app_private_peak_mb, `${w}: KarizApp private memory peak ${s.app.private_peak_mb} MB ≤ ${B.app_private_peak_mb} MB`);
        C.check(s.db.private_peak_mb <= B.db_private_peak_mb, `${w}: KarizDB private memory peak ${s.db.private_peak_mb} MB ≤ ${B.db_private_peak_mb} MB`);
      }
      return;
    }
    if (phase === "report") {
      const dir = String(a.dir);
      const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : null);
      const r = { generated: new Date().toISOString(), budgets: SERVER_BUDGETS, pages: {}, load: null, resources: null, failed: [] };
      const perfDir = join(dir, "perf");
      for (const f of existsSync(perfDir) ? readdirSync(perfDir).filter((x) => /^pages-.*\.json$/.test(x)) : []) {
        const rows = read(join(perfDir, f)) ?? [];
        r.pages[f.replace(/^pages-|\.json$/g, "")] = { rows, summary: summarizePages(rows) };
      }
      const load = read(join(dir, "phases", "api-load.json"));
      if (load?.metrics?.load) r.load = load.metrics.load;
      const res = read(join(dir, "phases", "perf-resources.json"));
      if (res?.metrics?.resources) r.resources = res.metrics.resources;
      for (const f of existsSync(join(dir, "phases")) ? readdirSync(join(dir, "phases")).filter((x) => x.endsWith(".json")) : []) {
        const p = read(join(dir, "phases", f));
        for (const c of p?.checks ?? []) if (!c.ok && /≤|budget|compressed|cached|within 30 s/.test(c.what)) r.failed.push(`${p.phase}: ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
      }
      mkdirSync(perfDir, { recursive: true });
      writeFileSync(join(perfDir, "server-perf.json"), JSON.stringify(r, null, 2));
      const md = reportMarkdown(r);
      writeFileSync(join(perfDir, "server-perf.md"), md);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${md}\n`);
      C.metric("pages_measured", Object.values(r.pages).reduce((s, p) => s + p.rows.length, 0));
      C.check(true, `the performance report is in ${join(perfDir, "server-perf.md")}`);
      return;
    }
    C.check(false, `unknown phase ${a.phase}`);
  });
}

export const PERF_DIR = (out) => join(dirname(dirname(out)), "perf");
