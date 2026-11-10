#!/usr/bin/env node
// Plan-level evidence on the bank seed (docs/PERFORMANCE_FA.md §۶): runs the engine's own reads — list (queues, pages,
// search, counts), aggregate, get, journal, history — as real people of the seeded bank (an agent of the central desk,
// an agent of a small specialised group, a requester, the head of a province and of a region, the service-desk
// manager), captures every statement the engine sends, and runs EXPLAIN (ANALYZE, BUFFERS) on the ones that read the
// record table. Prints per case: time, planning time, rows, shared buffers hit/read, sequential scans, indexes used.
//
//   node scripts/explain-bank.mjs [--label before] [--case queue] [--url postgres://…] [--verbose]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loavg } from "./perf-util.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []),
);
const LABEL = String(args.label ?? "run");
const URL_ = args.url ?? "postgres://postgres@127.0.0.1:55432/itsm";
const ONLY = args.case ? String(args.case) : null;
const VERBOSE = !!args.verbose;

process.chdir(ROOT);
(await import("tsx/esm/api")).register();
(await import("tsx/cjs/api")).register();
const mod = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const [{ createPostgresDb }, engine, context, access] = await Promise.all([
  mod("src/server/db/postgres.ts"),
  mod("src/server/engine/index.ts"),
  mod("src/server/context.ts"),
  mod("src/server/access/index.ts"),
]);
await mod("src/server/routes/modules.ts"); // installs the access model, modules, hooks (as the server does)

const bank = JSON.parse(readFileSync(join(ROOT, ".perf", "bank.json"), "utf8"));
const db = createPostgresDb({ url: URL_, max: 2, ssl: false });
const cfg = { mode: "cloud", db, secret: "itsm-perf-secret", allowSignup: false, platformAdmins: [], origin: "cloud", log: { info() {}, warn() {}, error: console.error }, fetch: globalThis.fetch };

const seen = [];
function spyDb(real) {
  const wrap = (fn) => async (sql, params) => {
    seen.push({ sql, params: params ?? [] });
    return fn(sql, params);
  };
  return { ...real, query: wrap(real.query.bind(real)), one: wrap(real.one.bind(real)) };
}

async function ctxOf(userId) {
  const user = await db.one(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [userId]);
  const org = await db.one(`select * from sm_orgs where id = $1`, [bank.org]);
  const member = await db.one(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [bank.org, userId]);
  const ctx = context.makeCtx(cfg, user, org, member);
  return { ...ctx, db: spyDb(ctx.db) };
}

/** People of the bank by what the cases need. */
async function people() {
  const pickAgent = async (kind, small) =>
    db.one(
      `select m.user_id as id from sm_group_members m join perf_grp g on g.id = m.group_id
       where g.kind = $1 and m.deleted_at is null order by cardinality(g.members) ${small ? "asc" : "desc"}, m.user_id limit 1`,
      [kind],
    );
  const requester = await db.one(`select caller_id as id, count(*) from sm_incidents where org_id = $1 group by 1 order by 2 desc limit 1 offset 200`, [bank.org]);
  const province = await db.one(`select u.manager_id as id, u.name from sm_org_units u where u.org_id = $1 and u.kind = 'division' and u.name like 'مدیریت شعب استان تهران' limit 1`, [bank.org]);
  const region = await db.one(`select u.manager_id as id, u.name from sm_org_units u where u.org_id = $1 and u.kind = 'department' and u.name like 'منطقهٔ%' order by u.code limit 1`, [bank.org]);
  const sdm = await db.one(`select p.user_id as id from sm_member_profiles p where p.org_id = $1 and p.roles ? 'service_desk_manager' limit 1`, [bank.org]);
  return {
    "agent:l1": (await pickAgent("l1", false))?.id,
    "agent:spec": (await pickAgent("spec", true))?.id,
    "agent:prov": (await pickAgent("prov", false))?.id,
    requester: requester?.id,
    "head:province": province?.id,
    "head:region": region?.id,
    "manager:desk": sdm?.id,
  };
}

const ACTIVE = { f: "active", op: "eq", v: true };
// lists as the HTTP API asks for them (routes/records.ts: counts stop at COUNT_LIMIT)
const list = (c, table, p) => engine.list(c, table, { countLimit: engine.COUNT_LIMIT ?? undefined, ...p });
const MINE = { f: "assignment_group_id", op: "is_my_group" };
const CASES = [
  ["agent:l1", "queue:my_groups_open", (c) => list(c, "incident", { filter: { and: [MINE, ACTIVE] }, sort: "-updated_at", size: 50 })],
  ["agent:l1", "queue:my_groups_priority", (c) => list(c, "incident", { filter: { and: [MINE, ACTIVE] }, sort: "priority,-updated_at", size: 50 })],
  ["agent:l1", "queue:assigned_to_me", (c) => list(c, "incident", { filter: { and: [{ f: "assigned_to", op: "is_me" }, ACTIVE] }, size: 50 })],
  ["agent:l1", "queue:unassigned", (c) => list(c, "incident", { filter: { and: [MINE, { f: "assigned_to", op: "empty" }, ACTIVE] }, sort: "-created_at", size: 50 })],
  ["agent:l1", "list:all_recent", (c) => list(c, "incident", { sort: "-updated_at", size: 50 })],
  ["agent:l1", "list:page_40", (c) => list(c, "incident", { sort: "-updated_at", size: 50, page: 40 })],
  ["agent:spec", "list:all_recent", (c) => list(c, "incident", { sort: "-updated_at", size: 50 })],
  ["agent:spec", "queue:my_groups_open", (c) => list(c, "incident", { filter: { and: [MINE, ACTIVE] }, sort: "-updated_at", size: 50 })],
  ["agent:prov", "queue:tasks_my_groups", (c) => list(c, "request_task", { filter: { and: [MINE, ACTIVE] }, sort: "-updated_at", size: 50 })],
  ["agent:l1", "search:incident", (c) => list(c, "incident", { q: "کربنکینگ", size: 5, total: false, fields: ["number", "short_description"] })],
  ["agent:l1", "search:kb", (c) => list(c, "kb_article", { q: "چاپگر", size: 5, total: false, fields: ["number", "title"] })],
  ["agent:l1", "search:number", (c) => list(c, "incident", { q: "INC0012345", size: 5, total: false })],
  ["agent:l1", "agg:priority", (c) => engine.aggregate(c, "incident", { filter: { and: [MINE, ACTIVE] }, groupBy: ["priority"], metrics: [{ fn: "count" }] })],
  ["agent:l1", "agg:months", (c) => engine.aggregate(c, "incident", { filter: { f: "opened_at", op: "relative", v: { unit: "month", n: 6, dir: "past" } }, groupBy: [{ field: "opened_at", bucket: "month" }], metrics: [{ fn: "count" }] })],
  ["requester", "list:mine", (c) => list(c, "incident", { sort: "-updated_at", size: 50 })],
  ["requester", "list:mine_requests", (c) => list(c, "request", { sort: "-updated_at", size: 50 })],
  ["head:province", "list:unit_tree", (c) => list(c, "incident", { sort: "-updated_at", size: 50 })],
  ["head:region", "list:unit_tree", (c) => list(c, "incident", { sort: "-updated_at", size: 50 })],
  ["manager:desk", "list:all_recent", (c) => list(c, "incident", { sort: "-updated_at", size: 50 })],
  ["manager:desk", "agg:state_all", (c) => engine.aggregate(c, "incident", { groupBy: ["state"], metrics: [{ fn: "count" }] })],
  ["agent:l1", "record:get+journal+history", async (c) => {
    const r = await engine.list(c, "incident", { filter: { and: [MINE, ACTIVE] }, size: 1, total: false });
    const id = r.rows[0]?.id;
    if (!id) return;
    seen.length = 0;
    await engine.get(c, "incident", id);
    await engine.listJournal(c, "incident", id, { limit: 50 });
    await engine.listHistory(c, "incident", id, { limit: 50 });
  }],
];

function walk(node, out) {
  out.nodes.push(node["Node Type"] + (node["Index Name"] ? ` ${node["Index Name"]}` : node["Relation Name"] ? ` ${node["Relation Name"]}` : ""));
  if (node["Node Type"] === "Seq Scan") out.seq.push(`${node["Relation Name"]} (${node["Actual Rows"]} rows, removed ${node["Rows Removed by Filter"] ?? 0})`);
  if (node["Index Name"]) out.indexes.add(node["Index Name"]);
  for (const c of node.Plans ?? []) walk(c, out);
}

const results = [];
const who = await people();
console.log(`load ${loavg()} · people ${JSON.stringify(who)}`);
for (const [persona, name, fn] of CASES) {
  if (ONLY && !name.includes(ONLY) && !persona.includes(ONLY)) continue;
  if (!who[persona]) {
    console.log(`skip ${persona} ${name}: nobody`);
    continue;
  }
  const c = await ctxOf(who[persona]);
  await fn(c).catch(() => undefined); // warm the caches (subject, schema)
  seen.length = 0;
  const t = performance.now();
  try {
    await fn(c);
  } catch (e) {
    console.log(`${persona} ${name}: ${e.message}`);
    continue;
  }
  const wall = performance.now() - t;
  const reads = seen.filter((s) => /from sm_(incidents|requests|request_tasks|request_items|kb_articles|journal|history)\b/.test(s.sql) && !/^\s*select (version|epoch)/.test(s.sql));
  const plans = [];
  for (const s of reads) {
    const [{ "QUERY PLAN": p }] = await db.query(`explain (analyze, buffers, format json) ${s.sql}`, s.params);
    const root = p[0];
    const out = { nodes: [], seq: [], indexes: new Set() };
    walk(root.Plan, out);
    plans.push({
      ms: +root["Execution Time"].toFixed(2),
      planMs: +root["Planning Time"].toFixed(2),
      rows: root.Plan["Actual Rows"],
      hit: root.Plan["Shared Hit Blocks"] ?? 0,
      read: root.Plan["Shared Read Blocks"] ?? 0,
      seq: out.seq,
      indexes: [...out.indexes],
      top: out.nodes.slice(0, 6).join(" → "),
      sql: s.sql.replace(/\s+/g, " ").slice(0, VERBOSE ? 4000 : 300),
      plan: VERBOSE ? p : undefined,
    });
  }
  const r = { persona, name, wallMs: +wall.toFixed(1), statements: seen.length, plans };
  results.push(r);
  console.log(`\n${persona.padEnd(14)} ${name.padEnd(28)} wall ${wall.toFixed(1)} ms · ${seen.length} statements`);
  for (const p of plans) console.log(`   ${String(p.ms).padStart(9)} ms (plan ${p.planMs}) rows ${p.rows} buf ${p.hit}/${p.read}${p.seq.length ? ` SEQ ${p.seq.join(", ")}` : ""} · ${p.top}`);
}
mkdirSync(join(ROOT, ".perf"), { recursive: true });
const file = join(ROOT, ".perf", `explain-${LABEL}.json`);
writeFileSync(file, JSON.stringify({ label: LABEL, at: new Date().toISOString(), load: loavg(), people: who, results }, null, 1));
console.log(`\nload ${loavg()} · ${file}`);
await db.close();
process.exit(0);
