#!/usr/bin/env node
// Load test (docs/PERFORMANCE_FA.md §۴): virtual users against the Postgres-mode server (scripts/serve-pg.mjs) on the
// bank seed (scripts/seed-bank.mjs, .perf/bank.json). A closed model — every virtual user acts, waits a think time
// (exponential, mean --think) and acts again — ramping to --vus users, then holding them for --duration seconds.
// While a screen is open the shell polls the live pulse (every 12 s, as src/ui/lib/live.ts does).
//
// Agents (queues with filters/sorts/pages, open a record with its journal, history, SLA and related lists, add a work
// note, change state or assignment, global search over every module, dashboard aggregates), requesters (portal home,
// «درخواست‌های من» and a ticket, order a catalogue item, knowledge search, a virtual-agent message without a model)
// and department heads (their units' records). Reports p50/p95/p99 per action and per request, throughput, errors,
// the database's time and top statements (pg_stat_statements), CPU of the server and of PostgreSQL, and load averages.
//
// «زنده» as the staff shell does it (src/ui/lib/live.ts; the portal's light shell does not poll): every 12 s a staff
// user asks the pulse about the tables and records of the screen they are on and of the shell (the bell, the nav
// counts); what it reports changed is fetched again — the screen's lists or the record with its activity, the bell's
// count, the nav count. A server without scoped answers (only a token) makes every token change refetch everything.
// Refetches per active user and minute are reported. «ارجاع به گروه» (assign_group) moves an open incident to a large
// group without an assignee (the central service desk, 450 people, or the Tehran province group) — the built-in
// notification «ارجاع به گروه» then fans out. --lock-stats reads the write-lock probe of scripts/serve-pg.mjs
// --lock-stats: acquisitions, wait and hold time per route and job kind.
//
//   node scripts/loadtest.mjs --vus 200 --ramp 60 --duration 120 [--think 4000] [--label before] [--url http://127.0.0.1:3940/api]
//        [--mix agents=0.7,requesters=0.25,heads=0.05] [--db postgres://postgres@127.0.0.1:55432/itsm] [--no-pulse] [--lock-stats]
//        [--assign-weight 2] [--agent-weights note=40,state=20,assign=20] [--legacy-pulse]
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
const opts = args(process.argv.slice(2));
const BASE = opts.url ?? "http://127.0.0.1:3940/api";
const VUS = Number(opts.vus ?? 100);
const RAMP = Number(opts.ramp ?? 30) * 1000;
const DURATION = Number(opts.duration ?? 60) * 1000;
const THINK = Number(opts.think ?? 4000);
const LABEL = String(opts.label ?? "run");
const PULSE = !opts["no-pulse"];
const LOCK_STATS = !!opts["lock-stats"];
// --legacy-pulse: ask the pulse without a scope (the token only), as the shell did before scoped answers
const LEGACY_PULSE = !!opts["legacy-pulse"];
const ASSIGN_WEIGHT = Number(opts["assign-weight"] ?? 2);
// what agents do, by weight; --agent-weights note=40,state=20,assign=20,open=10,queue=10 overrides any of them (a
// write-heavy run measures one organisation's write throughput: PERFORMANCE_FA.md «دور سوم»)
const AGENT_WEIGHTS = { queue: 30, open: 25, note: 10, state: 5, assign: ASSIGN_WEIGHT, search: 15, dashboard: 10, page_deep: 5 };
for (const part of String(opts["agent-weights"] ?? "").split(",").filter(Boolean)) {
  const [k, v] = part.split("=");
  if (k in AGENT_WEIGHTS && Number.isFinite(Number(v))) AGENT_WEIGHTS[k] = Number(v);
}
const DB_URL = opts.db ?? "postgres://postgres@127.0.0.1:55432/itsm";
const MIX = Object.fromEntries(String(opts.mix ?? "agents=0.7,requesters=0.25,heads=0.05").split(",").map((p) => p.split("=")).map(([k, v]) => [k, Number(v)]));
const bank = JSON.parse(readFileSync(join(ROOT, ".perf", "bank.json"), "utf8"));
const O = `/o/${bank.org}`;

// ----- metrics ----------------------------------------------------------------------------------------------------
const actions = new Map();
const requests = new Map();
let errors = [];
const put = (m, k, ms, ok) => {
  let x = m.get(k);
  if (!x) m.set(k, (x = { n: 0, err: 0, ms: [] }));
  x.n++;
  if (!ok) x.err++;
  x.ms.push(ms);
};
const q = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
let measuring = false;

async function call(vu, method, path, body, route, opts = {}) {
  const t = performance.now();
  let ok = false;
  let status = 0;
  let data = null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${vu.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
    ok = res.status < 400 || (res.status === 409 && method !== "GET") || (res.status === 404 && !!opts.expect404);
    if (!ok && errors.length < 50) errors.push({ route, status, message: String(data?.error?.message ?? text).slice(0, 200) });
  } catch (e) {
    if (errors.length < 50) errors.push({ route, status: 0, message: String(e?.message ?? e).slice(0, 200) });
  }
  const ms = performance.now() - t;
  if (measuring) put(requests, `${method} ${route}`, ms, ok);
  return { ok, status, data, ms };
}

async function action(name, fn) {
  const t = performance.now();
  let ok = true;
  try {
    ok = (await fn()) !== false;
  } catch (e) {
    ok = false;
    if (errors.length < 50) errors.push({ route: name, status: -1, message: String(e?.message ?? e).slice(0, 200) });
  }
  if (measuring) put(actions, name, performance.now() - t, ok);
}

// ----- the virtual users ------------------------------------------------------------------------------------------
const enc = (c) => encodeURIComponent(JSON.stringify(c));
const ACTIVE = { f: "active", op: "eq", v: true };
const QUEUES = [
  { name: "my_groups_open", table: "incident", filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, ACTIVE] }, sort: "-updated_at" },
  { name: "my_groups_priority", table: "incident", filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, ACTIVE] }, sort: "priority,-updated_at" },
  { name: "assigned_to_me", table: "incident", filter: { and: [{ f: "assigned_to", op: "is_me" }, ACTIVE] }, sort: "-updated_at" },
  { name: "unassigned", table: "incident", filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, { f: "assigned_to", op: "empty" }, ACTIVE] }, sort: "-created_at" },
  { name: "all_recent", table: "incident", filter: null, sort: "-updated_at" },
  { name: "tasks_my_groups", table: "request_task", filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, ACTIVE] }, sort: "-updated_at" },
  { name: "items_my_groups", table: "request_item", filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, ACTIVE] }, sort: "-updated_at" },
];
const TERMS = ["کربنکینگ", "چاپگر", "خودپرداز", "وی‌پی‌ان", "ایمیل", "کارت‌خوان", "شبکه", "گذرواژه", "پایانه", "ساتنا", "INC0001234", "شعبهٔ"];
const SEARCH_TABLES = ["incident", "request", "request_item", "problem", "change_request", "kb_article", "ci"];
const DISPLAY = { incident: "short_description", request: "short_description", request_item: "short_description", problem: "short_description", change_request: "short_description", kb_article: "title", ci: "name" };
const VA_TEXT = ["چاپگر شعبه کار نمی‌کند", "گذرواژه‌ام را فراموش کرده‌ام", "چطور به وی‌پی‌ان وصل شوم؟", "کارت‌خوان خطا می‌دهد"];

const pickW = (weights) => {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) if ((r -= w) <= 0) return k;
  return Object.keys(weights)[0];
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(Math.max(300, -Math.log(1 - Math.random()) * THINK));

let catalog = null;
const badItems = new Set();
// «ارجاع به گروه»: the central service desk (450 people) and the largest province group (bank.json)
const BIG_GROUPS = [bank.groups.find((g) => g.kind === "l1")?.id, bank.groups.find((g) => g.kind === "prov")?.id].filter(Boolean);
let assigned = 0;

async function agentAct(vu) {
  const kind = pickW(AGENT_WEIGHTS);
  if (kind === "queue" || (kind !== "search" && kind !== "dashboard" && !vu.rows?.length)) {
    const qd = pick(QUEUES.filter((x) => vu.kinds.some((k) => ["l1", "prov", "spec", "cab"].includes(k)) || !x.table.startsWith("incident") || x.filter === null || true));
    const url = `${O}/r/${qd.table}?size=50&sort=${encodeURIComponent(qd.sort)}${qd.filter ? `&filter=${enc(qd.filter)}` : ""}`;
    vu.page = { tables: [qd.table], ids: [], refetch: (changed) => (changed.has(qd.table) ? [call(vu, "GET", url, null, `/r/${qd.table}?queue (refetch)`)] : []) };
    return action(`queue:${qd.name}`, async () => {
      const r = await call(vu, "GET", url, null, `/r/${qd.table}?queue`);
      if (r.ok && qd.table === "incident") vu.rows = r.data.rows;
      return r.ok;
    });
  }
  if (kind === "page_deep") {
    const url = `${O}/r/incident?size=50&sort=-updated_at&page=${5 + Math.floor(Math.random() * 40)}`;
    vu.page = { tables: ["incident"], ids: [], refetch: (changed) => (changed.has("incident") ? [call(vu, "GET", url, null, "/r/incident?page (refetch)")] : []) };
    return action("queue:deep_page", async () => (await call(vu, "GET", url, null, "/r/incident?page")).ok);
  }
  if (kind === "open") {
    const row = pick(vu.rows);
    recordPage(vu, row.id);
    return action("open_record", async () => {
      const id = row.id;
      const rs = await Promise.all([
        call(vu, "GET", `${O}/r/incident/${id}`, null, "/r/incident/:id"),
        call(vu, "GET", `${O}/r/incident/${id}/journal?limit=50`, null, "/r/incident/:id/journal"),
        call(vu, "GET", `${O}/r/incident/${id}/history?limit=50`, null, "/r/incident/:id/history"),
        call(vu, "GET", `${O}/r/incident/${id}/attachments`, null, "/r/incident/:id/attachments"),
        call(vu, "GET", `${O}/r/incident/${id}/links`, null, "/r/incident/:id/links"),
        call(vu, "GET", `${O}/sla/records/incident/${id}`, null, "/sla/records/incident/:id"),
        call(vu, "GET", `${O}/r/incident_task?size=20&filter=${enc({ f: "parent_id", op: "eq", v: id })}`, null, "/r/incident_task?related"),
      ]);
      if (rs[0].ok) row.version = rs[0].data.row.version;
      return rs.every((x) => x.ok || x.status === 404);
    });
  }
  if (kind === "note") {
    const row = pick(vu.rows);
    recordPage(vu, row.id);
    return action("add_work_note", async () => (await call(vu, "POST", `${O}/r/incident/${row.id}/journal`, { kind: "work_note", body: `پیگیری شد؛ ${pick(TERMS)} بررسی شد.` }, "/r/incident/:id/journal POST")).ok);
  }
  if (kind === "assign") {
    const row = pick(vu.rows);
    recordPage(vu, row.id);
    return action("assign_group", async () => {
      const cur = await call(vu, "GET", `${O}/r/incident/${row.id}`, null, "/r/incident/:id");
      if (!cur.ok) return cur.status === 404;
      const rec = cur.data.row;
      if (!cur.data.meta.canWrite || !rec.active) return true;
      const to = rec.assignment_group_id === BIG_GROUPS[0] ? BIG_GROUPS[1] : BIG_GROUPS[0];
      const r = await call(vu, "PATCH", `${O}/r/incident/${row.id}`, { assignment_group_id: to, assigned_to: null, version: rec.version }, "/r/incident/:id PATCH (group)", { expect404: true });
      // the record left the agent's groups: the write committed and the answer is «not found» (need to know)
      if (r.ok || r.status === 404) {
        assigned++;
        vu.rows = vu.rows.filter((x) => x.id !== row.id);
      }
      return r.ok || r.status === 404 || r.status === 403;
    });
  }
  if (kind === "state") {
    const row = pick(vu.rows);
    recordPage(vu, row.id);
    return action("change_state", async () => {
      const cur = await call(vu, "GET", `${O}/r/incident/${row.id}`, null, "/r/incident/:id");
      if (!cur.ok) return false;
      const rec = cur.data.row;
      const t = (cur.data.meta.transitions ?? []).map((x) => x.to);
      if (!rec.assigned_to && cur.data.meta.canWrite) {
        return (await call(vu, "PATCH", `${O}/r/incident/${row.id}`, { assigned_to: vu.id, version: rec.version }, "/r/incident/:id PATCH")).ok;
      }
      const to = t.includes("in_progress") && rec.state !== "in_progress" ? "in_progress" : null;
      if (!to) return true;
      return (await call(vu, "POST", `${O}/r/incident/${row.id}/transition`, { to, version: rec.version }, "/r/incident/:id/transition")).ok;
    });
  }
  if (kind === "search") {
    const term = pick(TERMS);
    // the palette's results are not a live screen: the shell's own queries stay
    vu.page = null;
    return action("global_search", async () => {
      const rs = await Promise.all(SEARCH_TABLES.map((t) => call(vu, "GET", `${O}/r/${t}?q=${encodeURIComponent(term)}&size=5&total=false&fields=number,${DISPLAY[t]}`, null, `/r/${t}?q`)));
      return rs.every((x) => x.ok || x.status === 403);
    });
  }
  const filter = { and: [{ f: "assignment_group_id", op: "is_my_group" }, ACTIVE] };
  const aggs = (suffix = "") => [
    call(vu, "POST", `${O}/r/incident/agg`, { filter, groupBy: ["priority"], metrics: [{ fn: "count" }] }, `/r/incident/agg${suffix}`),
    call(vu, "POST", `${O}/r/incident/agg`, { filter: ACTIVE, groupBy: ["state"], metrics: [{ fn: "count" }] }, `/r/incident/agg${suffix}`),
    call(vu, "POST", `${O}/r/incident/agg`, { filter: { f: "opened_at", op: "relative", v: { unit: "month", n: 6, dir: "past" } }, groupBy: [{ field: "opened_at", bucket: "month" }], metrics: [{ fn: "count" }] }, `/r/incident/agg${suffix}`),
  ];
  vu.page = { tables: ["incident"], ids: [], refetch: (changed) => (changed.has("incident") ? aggs(" (refetch)") : []) };
  return action("dashboard", async () => (await Promise.all(aggs())).every((x) => x.ok));
}

/** The record page of an incident: the record with its activity, attachments and links, and its related tasks. */
function recordPage(vu, id) {
  const ref = `incident:${id}`;
  vu.page = {
    tables: ["incident_task"],
    ids: [ref],
    refetch: (changed) => [
      ...(changed.has(ref)
        ? [
            call(vu, "GET", `${O}/r/incident/${id}`, null, "/r/incident/:id (refetch)"),
            call(vu, "GET", `${O}/r/incident/${id}/journal?limit=50`, null, "/r/incident/:id/journal (refetch)"),
            call(vu, "GET", `${O}/r/incident/${id}/history?limit=50`, null, "/r/incident/:id/history (refetch)"),
            call(vu, "GET", `${O}/r/incident/${id}/attachments`, null, "/r/incident/:id/attachments (refetch)"),
            call(vu, "GET", `${O}/r/incident/${id}/links`, null, "/r/incident/:id/links (refetch)"),
          ]
        : []),
      ...(changed.has("incident_task") ? [call(vu, "GET", `${O}/r/incident_task?size=20&filter=${enc({ f: "parent_id", op: "eq", v: id })}`, null, "/r/incident_task?related (refetch)")] : []),
    ],
  };
}

// ----- «زنده» ------------------------------------------------------------------------------------------------------
/** What the staff shell keeps on screen everywhere: the bell's count and the nav count of «رخدادهای من». */
const SHELL = ["notification", "incident"];
const MINE = { and: [{ f: "assigned_to", op: "is_me" }, ACTIVE] };
const pulseStats = { polls: 0, rounds: 0, requests: 0, scoped: 0 };

/** One look at the pulse, and the refetches it causes (a token-only answer: everything on screen). */
async function pulse(vu) {
  const page = vu.page ?? null;
  const tables = [...new Set([...(page?.tables ?? []), ...SHELL])];
  const ids = page?.ids ?? [];
  const qs = new URLSearchParams();
  if (!LEGACY_PULSE) {
    if (vu.pulse) qs.set("since", vu.pulse);
    qs.set("t", tables.join(","));
    if (ids.length) qs.set("r", ids.join(","));
  }
  const r = await call(vu, "GET", `${O}/pulse?${qs}`, null, "/pulse");
  if (!r.ok) return false;
  const prev = vu.pulse ?? null;
  vu.pulse = r.data.pulse;
  if (measuring) pulseStats.polls++;
  if (prev === null) return true;
  let changed;
  if (Array.isArray(r.data.changed)) {
    if (measuring) pulseStats.scoped++;
    changed = new Set(r.data.changed);
  } else changed = prev !== r.data.pulse ? new Set([...tables, ...ids]) : new Set();
  if (!changed.size) return true;
  const work = [
    ...(page ? page.refetch(changed) : []),
    ...(changed.has("notification") ? [call(vu, "GET", `${O}/notify/inbox/count`, null, "/notify/inbox/count (refetch)")] : []),
    ...(changed.has("incident") ? [call(vu, "GET", `${O}/r/incident?size=1&total=true&fields=number&filter=${enc(MINE)}`, null, "/r/incident?mine-count (refetch)")] : []),
  ];
  if (!work.length) return true;
  if (measuring) {
    pulseStats.rounds++;
    pulseStats.requests += work.length;
  }
  await action("refetch", async () => (await Promise.all(work)).every((x) => x.ok || x.status === 404));
  return true;
}

async function requesterAct(vu) {
  const kind = pickW({ home: 25, mine: 30, order: 10, kb: 20, va: 15 });
  if (kind === "home") return action("portal_home", async () => (await call(vu, "GET", `${O}/portal/home`, null, "/portal/home")).ok);
  if (kind === "mine") {
    return action("my_requests", async () => {
      const r = await call(vu, "GET", `${O}/portal/items?tab=mine&state=all`, null, "/portal/items");
      if (!r.ok) return false;
      const items = r.data.items ?? r.data.rows ?? [];
      const it = items.length ? pick(items) : null;
      if (it && it.table && it.id) return (await call(vu, "GET", `${O}/portal/tickets/${it.table}/${it.id}`, null, "/portal/tickets/:table/:id")).ok;
      return true;
    });
  }
  if (kind === "order") {
    return action("order_item", async () => {
      if (!catalog) {
        const c = await call(vu, "GET", `${O}/request/catalog`, null, "/request/catalog");
        const items = c.data?.items ?? c.data?.rows ?? [];
        catalog = items.filter((i) => i.id).map((i) => i.id);
      }
      const ids = catalog.filter((x) => !badItems.has(x));
      if (!ids.length) return true;
      const item = pick(ids);
      const r = await call(vu, "POST", `${O}/request/order`, { lines: [{ item_id: item, answers: {} }], channel: "portal" }, "/request/order");
      if (!r.ok && r.status === 400) {
        badItems.add(item);
        return true;
      }
      return r.ok;
    });
  }
  if (kind === "kb") return action("knowledge_search", async () => (await call(vu, "GET", `${O}/portal/search?q=${encodeURIComponent(pick(TERMS))}&log=0`, null, "/portal/search")).ok);
  return action("virtual_agent", async () => (await call(vu, "POST", `${O}/ai/va/conversations`, { channel: "portal", text: pick(VA_TEXT) }, "/ai/va/conversations")).ok);
}

async function headAct(vu) {
  const kind = pickW({ incidents: 50, requests: 30, agg: 20 });
  const listPage = (table, route) => {
    const url = `${O}/r/${table}?size=50&sort=-updated_at`;
    vu.page = { tables: [table], ids: [], refetch: (changed) => (changed.has(table) ? [call(vu, "GET", url, null, `${route} (refetch)`)] : []) };
    return url;
  };
  if (kind === "incidents") {
    const url = listPage("incident", "/r/incident?head");
    return action("head_unit_incidents", async () => (await call(vu, "GET", url, null, "/r/incident?head")).ok);
  }
  if (kind === "requests") {
    const url = listPage("request", "/r/request?head");
    return action("head_unit_requests", async () => (await call(vu, "GET", url, null, "/r/request?head")).ok);
  }
  const agg = (suffix = "") => call(vu, "POST", `${O}/r/incident/agg`, { filter: ACTIVE, groupBy: ["priority"], metrics: [{ fn: "count" }] }, `/r/incident/agg${suffix}`);
  vu.page = { tables: ["incident"], ids: [], refetch: (changed) => (changed.has("incident") ? [agg(" (refetch)")] : []) };
  return action("head_dashboard", async () => (await agg()).ok);
}

let stopAt = Infinity;
let activeMs = 0;
async function runVu(vu) {
  let nextPulse = Date.now() + Math.random() * 12_000;
  const started = Date.now();
  // the portal's light shell does not poll «زنده»; the staff shell does
  const polls = PULSE && vu.persona !== "requester";
  try {
    await loop(vu, polls, () => nextPulse, (t) => (nextPulse = t));
  } finally {
    if (polls) activeMs += Date.now() - started;
  }
}

async function loop(vu, polls, next, setNext) {
  while (Date.now() < stopAt) {
    if (polls && Date.now() >= next()) {
      setNext(Date.now() + 12_000);
      await action("live_pulse", () => pulse(vu));
    }
    if (vu.persona === "agent") await agentAct(vu);
    else if (vu.persona === "requester") await requesterAct(vu);
    else await headAct(vu);
    await think();
  }
}

// ----- resources: CPU of the server and of PostgreSQL, database statistics ----------------------------------------
function cpuTicks(match) {
  let total = 0;
  for (const pid of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!match(cmd)) continue;
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      total += Number(f[11]) + Number(f[12]);
    } catch {
      // gone
    }
  }
  return total;
}
const isServer = (cmd) => cmd.includes("serve-pg.mjs");

/** serve-pg processes (the primary of a cluster too: it ignores the signal). */
function serverPids() {
  const out = [];
  for (const pid of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try {
      if (isServer(readFileSync(`/proc/${pid}/cmdline`, "utf8"))) out.push(Number(pid));
    } catch {
      // gone
    }
  }
  return out;
}

/** Ask every server for its write-lock samples since the last ask (scripts/serve-pg.mjs --lock-stats). */
async function lockSamples() {
  const pids = serverPids();
  for (const pid of pids) {
    try {
      rmSync(join(ROOT, ".perf", `lockstats-${pid}.json`), { force: true });
      process.kill(pid, "SIGUSR2");
    } catch {
      // gone
    }
  }
  const samples = [];
  const until = Date.now() + 5000;
  const pending = new Set(pids);
  while (pending.size && Date.now() < until) {
    await sleep(200);
    for (const pid of [...pending]) {
      const f = join(ROOT, ".perf", `lockstats-${pid}.json`);
      if (!existsSync(f)) continue;
      try {
        samples.push(...JSON.parse(readFileSync(f, "utf8")).samples);
        pending.delete(pid);
        rmSync(f, { force: true });
      } catch {
        // still being written
      }
    }
  }
  return samples;
}

function lockReport(samples, wallS) {
  const by = new Map();
  for (const x of samples) {
    let e = by.get(x.label);
    if (!e) by.set(x.label, (e = { label: x.label, n: 0, wait: [], hold: [] }));
    e.n++;
    e.wait.push(x.waitMs);
    e.hold.push(x.holdMs);
  }
  const sum = (a) => a.reduce((p, v) => p + v, 0);
  const row = (label, n, wait, hold) => ({
    label, n, perS: +(n / wallS).toFixed(1), waitMean: +(sum(wait) / Math.max(1, n)).toFixed(1), waitP95: +q(wait, 0.95).toFixed(1),
    holdMean: +(sum(hold) / Math.max(1, n)).toFixed(1), holdP95: +q(hold, 0.95).toFixed(1), holdMax: +(hold.length ? Math.max(...hold) : 0).toFixed(1), holdTotalS: +(sum(hold) / 1000).toFixed(1),
  });
  const all = row("(all)", samples.length, samples.map((x) => x.waitMs), samples.map((x) => x.holdMs));
  return { all: { ...all, busyPct: +((100 * all.holdTotalS) / wallS).toFixed(1) }, byLabel: [...by.values()].map((e) => row(e.label, e.n, e.wait, e.hold)).sort((a, b) => b.holdTotalS - a.holdTotalS) };
}
const isPg = (cmd) => cmd.startsWith("postgres:") || cmd.includes("/postgres\0") || cmd.includes("bin/postgres");

async function main() {
  mkdirSync(join(ROOT, ".perf"), { recursive: true });
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  const n = { agents: Math.round(VUS * (MIX.agents ?? 0)), requesters: Math.round(VUS * (MIX.requesters ?? 0)) };
  n.heads = Math.max(0, VUS - n.agents - n.requesters);
  const agents = bank.sample.agents.filter((a) => a.kinds.some((k) => ["l1", "prov", "spec"].includes(k)));
  const vus = [];
  for (let i = 0; i < n.agents; i++) vus.push({ persona: "agent", ...agents[i % agents.length], rows: [] });
  for (let i = 0; i < n.requesters; i++) vus.push({ persona: "requester", ...bank.sample.requesters[i % bank.sample.requesters.length] });
  for (let i = 0; i < n.heads; i++) vus.push({ persona: "head", ...bank.sample.heads[i % bank.sample.heads.length] });
  // warm-up: every user signs in once (subject and schema caches), outside the measurement
  console.log(`warm-up of ${vus.length} users…`);
  for (let i = 0; i < vus.length; i += 20) await Promise.all(vus.slice(i, i + 20).map((vu) => call(vu, "GET", `${O}/r/incident?size=1&total=false`, null, "warmup")));
  errors = [];
  const before = {
    load: loadavg(),
    server: cpuTicks(isServer),
    pg: cpuTicks(isPg),
    db: (await sql`select xact_commit::bigint, blks_hit::bigint, blks_read::bigint, tup_returned::bigint, tup_fetched::bigint from pg_stat_database where datname = current_database()`)[0],
    at: Date.now(),
  };
  await sql`select pg_stat_statements_reset()`.catch(() => null);
  if (LOCK_STATS) await lockSamples();
  const jobsFrom = new Date().toISOString();
  measuring = true;
  const t0 = Date.now();
  stopAt = t0 + RAMP + DURATION;
  const running = [];
  for (let i = 0; i < vus.length; i++) {
    const at = t0 + (RAMP * i) / Math.max(1, vus.length);
    const wait = at - Date.now();
    if (wait > 0) await sleep(wait);
    running.push(runVu(vus[i]));
  }
  const progress = setInterval(() => {
    const total = [...actions.values()].reduce((a, x) => a + x.n, 0);
    process.stdout.write(`\r  ${((Date.now() - t0) / 1000).toFixed(0)} s · ${total} actions · load ${loadavg()[0].toFixed(1)}   `);
  }, 2000);
  await Promise.all(running);
  clearInterval(progress);
  measuring = false;
  const wall = (Date.now() - t0) / 1000;
  const steady = DURATION / 1000;
  const locks = LOCK_STATS ? lockReport(await lockSamples(), wall) : null;
  const jobs = await sql`select kind, count(*)::int as n from sm_jobs where org_id = ${bank.org} and done_at >= ${jobsFrom} group by kind order by 2 desc limit 15`.catch(() => []);
  const backlog = (await sql`select count(*)::int as n from sm_jobs where org_id = ${bank.org} and status = 'queued' and run_at <= now()`.catch(() => [{ n: -1 }]))[0].n;
  const bells = (await sql`select count(*)::int as n from sm_notifications where org_id = ${bank.org} and created_at >= ${jobsFrom}`.catch(() => [{ n: -1 }]))[0].n;
  const after = {
    load: loadavg(),
    server: cpuTicks(isServer),
    pg: cpuTicks(isPg),
    db: (await sql`select xact_commit::bigint, blks_hit::bigint, blks_read::bigint, tup_returned::bigint, tup_fetched::bigint from pg_stat_database where datname = current_database()`)[0],
  };
  const top = await sql`
    select calls::bigint, round(total_exec_time::numeric, 1) as total_ms, round(mean_exec_time::numeric, 2) as mean_ms, round(max_exec_time::numeric, 1) as max_ms,
           rows::bigint, shared_blks_hit::bigint as hit, shared_blks_read::bigint as read, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) as query
    from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())
    order by total_exec_time desc limit 20`.catch(() => []);
  const dbTotal = (await sql`select coalesce(sum(total_exec_time), 0)::float8 as ms, coalesce(sum(calls), 0)::bigint as calls from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())`.catch(() => [{ ms: 0, calls: 0 }]))[0];
  await sql.end();

  const summarize = (m) =>
    [...m.entries()]
      .map(([k, x]) => ({ name: k, n: x.n, errPct: +((100 * x.err) / x.n).toFixed(2), p50: +q(x.ms, 0.5).toFixed(1), p95: +q(x.ms, 0.95).toFixed(1), p99: +q(x.ms, 0.99).toFixed(1), max: +Math.max(...x.ms).toFixed(1) }))
      .sort((a, b) => b.n - a.n);
  const acts = summarize(actions);
  const reqs = summarize(requests);
  const totalReq = reqs.reduce((a, x) => a + x.n, 0);
  const totalErr = [...requests.values()].reduce((a, x) => a + x.err, 0);
  const all = [...requests.values()].flatMap((x) => x.ms);
  const hz = 100;
  const report = {
    label: LABEL,
    at: new Date().toISOString(),
    config: { vus: VUS, rampS: RAMP / 1000, durationS: steady, thinkMs: THINK, mix: MIX, pulse: PULSE, base: BASE },
    load: { before: before.load.map((x) => +x.toFixed(2)), after: after.load.map((x) => +x.toFixed(2)) },
    wallS: +wall.toFixed(1),
    requests: { total: totalReq, rps: +(totalReq / wall).toFixed(1), errors: totalErr, errPct: +((100 * totalErr) / Math.max(1, totalReq)).toFixed(2), p50: +q(all, 0.5).toFixed(1), p95: +q(all, 0.95).toFixed(1), p99: +q(all, 0.99).toFixed(1) },
    cpu: { serverCores: +((after.server - before.server) / hz / wall).toFixed(2), postgresCores: +((after.pg - before.pg) / hz / wall).toFixed(2) },
    db: {
      statementMs: Math.round(dbTotal.ms),
      statements: Number(dbTotal.calls),
      msPerRequest: +(dbTotal.ms / Math.max(1, totalReq)).toFixed(2),
      commits: Number(after.db.xact_commit) - Number(before.db.xact_commit),
      hitRatio: +((Number(after.db.blks_hit) - Number(before.db.blks_hit)) / Math.max(1, Number(after.db.blks_hit) - Number(before.db.blks_hit) + Number(after.db.blks_read) - Number(before.db.blks_read))).toFixed(4),
      top: top.map((r) => ({ ...r, calls: Number(r.calls), rows: Number(r.rows), hit: Number(r.hit), read: Number(r.read), total_ms: Number(r.total_ms), mean_ms: Number(r.mean_ms), max_ms: Number(r.max_ms) })),
    },
    live: {
      activeUserMin: +(activeMs / 60_000).toFixed(1),
      polls: pulseStats.polls,
      scopedAnswers: pulseStats.scoped,
      refetchRounds: pulseStats.rounds,
      refetchRequests: pulseStats.requests,
      roundsPerUserMin: +(pulseStats.rounds / Math.max(1e-9, activeMs / 60_000)).toFixed(2),
      requestsPerUserMin: +(pulseStats.requests / Math.max(1e-9, activeMs / 60_000)).toFixed(2),
    },
    fanout: { assignedToGroup: assigned, bellRows: bells, jobsDone: jobs.map((j) => ({ kind: j.kind, n: Number(j.n) })), dueBacklog: Number(backlog) },
    locks,
    actions: acts,
    routes: reqs,
    errors: errors.slice(0, 20),
  };
  const file = join(ROOT, ".perf", `loadtest-${LABEL}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 1));
  console.log(`\n\n## ${LABEL}: ${VUS} users (ramp ${RAMP / 1000}s + ${steady}s), think ${THINK} ms, load ${report.load.before.join("/")} → ${report.load.after.join("/")}`);
  console.log(`requests ${totalReq} · ${report.requests.rps} req/s · errors ${report.requests.errPct}% · p50 ${report.requests.p50} · p95 ${report.requests.p95} · p99 ${report.requests.p99} ms`);
  console.log(`CPU: server ${report.cpu.serverCores} cores, PostgreSQL ${report.cpu.postgresCores} cores · DB ${report.db.msPerRequest} ms/request, ${report.db.statements} statements, hit ratio ${report.db.hitRatio}`);
  const lv = report.live;
  console.log(`live: ${lv.polls} polls (${lv.scopedAnswers} scoped), ${lv.refetchRounds} refetch rounds / ${lv.refetchRequests} requests over ${lv.activeUserMin} user-minutes → ${lv.roundsPerUserMin} rounds and ${lv.requestsPerUserMin} refetch requests per user per minute`);
  console.log(`fan-out: ${assigned} assignments to a large group, ${bells} bell rows, due backlog ${backlog}; jobs done: ${jobs.map((j) => `${j.kind} ${j.n}`).join(", ")}`);
  if (locks) {
    const a = locks.all;
    console.log(`write lock: ${a.n} acquisitions (${a.perS}/s), wait mean ${a.waitMean} p95 ${a.waitP95} ms, hold mean ${a.holdMean} p95 ${a.holdP95} max ${a.holdMax} ms, held ${a.holdTotalS} s = ${a.busyPct}% of the run`);
    console.log("\n| transaction | n | /s | wait mean | wait p95 | hold mean | hold p95 | hold max | held s |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const r of locks.byLabel.slice(0, 25)) console.log(`| ${r.label} | ${r.n} | ${r.perS} | ${r.waitMean} | ${r.waitP95} | ${r.holdMean} | ${r.holdP95} | ${r.holdMax} | ${r.holdTotalS} |`);
  }
  console.log("\n| action | n | err% | p50 | p95 | p99 | max |\n|---|---:|---:|---:|---:|---:|---:|");
  for (const a of acts) console.log(`| ${a.name} | ${a.n} | ${a.errPct} | ${a.p50} | ${a.p95} | ${a.p99} | ${a.max} |`);
  console.log("\n| route | n | err% | p50 | p95 | p99 |\n|---|---:|---:|---:|---:|---:|");
  for (const a of reqs) console.log(`| ${a.name} | ${a.n} | ${a.errPct} | ${a.p50} | ${a.p95} | ${a.p99} |`);
  console.log("\ntop statements (total ms · calls · mean ms · rows · blocks hit/read):");
  for (const t of report.db.top.slice(0, 12)) console.log(`  ${String(t.total_ms).padStart(9)} ${String(t.calls).padStart(7)} ${String(t.mean_ms).padStart(8)} ${String(t.rows).padStart(8)} ${t.hit}/${t.read}  ${t.query.slice(0, 150)}`);
  if (report.errors.length) console.log("\nerrors:", JSON.stringify(report.errors.slice(0, 8), null, 1));
  console.log(`\nreport: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
