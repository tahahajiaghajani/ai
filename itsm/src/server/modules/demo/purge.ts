// The demo pack's zero-trace purge (docs/DEMO_FA.md). What the pack made is known exactly: every row a demo transaction
// inserted is in `sm_demo_rows` (src/server/db/scope.ts, the capture triggers of migration 0098_demo), and so are the
// pack's accounts. The purge finds what derives from those rows although demo work did not write it, removes all of it,
// clears what real rows say about it, and puts back what the organisation's own computations changed meanwhile:
//
// 1. expand — rows that exist only because of a demo row join the set (to a fixed point): side rows of a demo record
//    (journal, history, attachments, links, approvals, SLA timers, bells, notification log, RAG documents, chunks and
//    vectors, predictions, survey answers… — any table with a `record_id`/`ref_id` naming one), parent-scoped children
//    (`TableDef.parent`), a person's own rows (`user_id` of a demo account), and every platform row (jobs, audit, AI
//    threads and usage, sessions, devices, security events, search and portal events…) that names a demo row anywhere.
// 2. report — counts per table, and the real rows that refer to demo rows (a reference field, an anchor, a stamp).
// 3. clear — references of real rows: optional reference fields are emptied (one-to-many lists lose the demo ids);
//    required ones, access anchors and authorship stamps are only reported (a real row is never deleted).
// 4. remove — the rows themselves, their archive copies (`_arc`) and their tables without ids (extracted pages, flow
//    timers, scope epochs…). Synchronised rows of an organisation with Windows apps become content-free tombstones
//    first (the apps drop their copies on their next pull) and go for good once every app has passed them
//    (`finalizeDemo`); without apps they go at once. Files no remaining attachment uses leave the blob store.
// 5. accounts — the pack's people leave with their memberships, sessions and devices; an account that also belongs to
//    another organisation is kept there (only its demo mark goes).
// 6. restore — numbering counters, and the computed tables (KPI scores, trained models, insights…) as they were
//    before the load (`sm_demo_saved`): what the platform computed while demo data was there is recomputed from real
//    data on its next run.
// Left behind: one content-free audit line per load and purge (counts only).
import type { TableDef } from "@shared/model/types";
import { physicalTables } from "@shared/tables";
import type { Queryable } from "../../db";
import { archivable, archiveTableOf } from "../../engine/ddl";
import { blobStore, type BlobStore } from "../../blobs";

export interface ColInfo {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  generated: boolean;
}

export interface TableInfo {
  name: string;
  cols: Map<string, ColInfo>;
  /** the engine table this physical table stores (its archive too) */
  def: TableDef | null;
  arc: boolean;
  /** rows carry a sync revision (Windows apps may hold copies) */
  synced: boolean;
}

/** The purge's own bookkeeping and platform-wide tables: never swept. */
const SKIP = new Set([
  "sm_demo_rows",
  "sm_demo_packs",
  "sm_demo_saved",
  "sm_orgs",
  "sm_users",
  "sm_migrations",
  "sm_meta",
  "sm_plans",
  "sm_platform_flags",
  "sm_platform_announcements",
  "sm_kv",
  "sm_org_sync",
  "sm_access_state",
  "sm_numbers",
]);

/**
 * Computed tables: the platform derives their rows from the organisation's records (KPI scores and collections, trained
 * models, insights, clusters, health and compliance facts…). Their rows as they were before the load are saved with
 * the pack and put back by the purge; rows computed meanwhile go (the next scheduled run recomputes them from real
 * data). A computed table added later belongs here.
 */
export const COMPUTED_TABLES = [
  "sm_analytics_scores",
  "sm_analytics_indicators",
  "sm_ai_models",
  "sm_ai_insights",
  "sm_ai_clusters",
  "sm_ai_digests",
  "sm_slm_compliance",
  "sm_slm_xla_scores",
  "sm_service_score_facts",
  "sm_cmdb_health_facts",
  "sm_change_success_scores",
  "sm_account_health",
  "sm_incident_period_reviews",
  "sm_kb_gaps",
  "sm_kb_duplicates",
  "sm_problem_candidates",
  "sm_license_positions",
  "sm_supplier_scorecards",
  "sm_capacity_records",
  "sm_wfm_capacity",
  "sm_wfm_coverage",
];

/** Columns a tombstone keeps (identity, sync, and what a pull needs to judge a side row). */
const TOMBSTONE_KEEP = new Set(["id", "org_id", "rev", "deleted_at", "created_at", "updated_at", "version", "table_key", "record_id", "from_table", "from_id", "to_table", "to_id", "field", "visibility", "kind"]);

/** Columns that name who wrote a platform row, not what it is about (a real setting a demo person touched stays). */
const STAMPS = new Set(["id", "org_id", "created_by", "updated_by"]);

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const infoCache = new WeakMap<object, Promise<TableInfo[]>>();

/** The physical tables of the database with their columns (cached per database: the schema changes with migrations only). */
export function tablesInfo(q: Queryable, cacheKey?: object): Promise<TableInfo[]> {
  const key = cacheKey ?? q;
  let p = infoCache.get(key);
  if (!p) {
    p = loadInfo(q);
    infoCache.set(key, p);
    p.catch(() => infoCache.delete(key));
  }
  return p;
}

async function loadInfo(q: Queryable): Promise<TableInfo[]> {
  const rows = await q.query<{ t: string; c: string; dt: string; nul: string; def: boolean; gen: string | null }>(
    `select c.table_name as t, c.column_name as c, c.data_type as dt, c.is_nullable as nul, c.column_default is not null as def, c.is_generated as gen
       from information_schema.columns c
       join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%'
      order by c.table_name, c.ordinal_position`,
  );
  const defs = new Map<string, { def: TableDef; arc: boolean }>();
  for (const def of physicalTables()) {
    defs.set(def.table, { def, arc: false });
    if (archivable(def)) defs.set(archiveTableOf(def), { def, arc: true });
  }
  const out = new Map<string, TableInfo>();
  for (const r of rows) {
    let t = out.get(r.t);
    if (!t) {
      const d = defs.get(r.t);
      t = { name: r.t, cols: new Map(), def: d?.def ?? null, arc: d?.arc ?? r.t.endsWith("_arc"), synced: false };
      out.set(r.t, t);
    }
    t.cols.set(r.c, { name: r.c, type: r.dt, nullable: r.nul === "YES", hasDefault: !!r.def, generated: r.gen === "ALWAYS" });
  }
  for (const t of out.values()) t.synced = !t.arc && t.cols.has("rev") && t.cols.has("deleted_at");
  return [...out.values()];
}

const isUuid = (c: ColInfo | undefined) => !!c && c.type === "uuid";
const hasIdOrg = (t: TableInfo) => isUuid(t.cols.get("id")) && isUuid(t.cols.get("org_id"));

/** Is the uuid expression `e` a demo id of the organisation ($1)? An index probe of sm_demo_rows' primary key. */
const isDemo = (e: string) => `exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = ${e})`;
/** The same for a text expression (a uuid only when it looks like one: the cast never sees anything else). */
const isDemoText = (e: string) => `(case when ${e} ~* '^${UUID_RE}$' then ${isDemo(`(${e})::uuid`)} else false end)`;

/** A condition on alias `x` naming a demo row through column `col` (uuid, text or uuid array). */
function names(t: TableInfo, col: string): string | null {
  const c = t.cols.get(col);
  if (!c) return null;
  const x = `x.${ident(col)}`;
  if (c.type === "uuid") return `(${x} is not null and ${isDemo(x)})`;
  if (c.type === "text" || c.type === "character varying") return `(${x} is not null and ${isDemoText(x)})`;
  if (c.type === "ARRAY") return `(${x} is not null and exists (select 1 from unnest(${x}::text[]) u(v) where ${isDemoText("u.v")}))`;
  return null;
}

/** Does the organisation have rows in the table at all? (most tables of a young organisation are empty) */
async function hasRows(q: Queryable, t: TableInfo, orgId: string): Promise<boolean> {
  return !!(await q.one(`select 1 from ${ident(t.name)} where org_id = $1 limit 1`, [orgId]));
}

/**
 * The conditions that make a row of `t` derived from demo data (removed with it). Platform tables (no engine table):
 * any id column naming a demo row. Engine tables: a side row of a demo record, a parent-scoped child of one, a demo
 * person's own row.
 */
export function derivedConds(t: TableInfo): string[] {
  const out: string[] = [];
  const add = (c: string | null) => c && out.push(c);
  if (t.name === "sm_jobs") {
    // a job about demo data: its payload names a demo row
    out.push(`exists (select 1 from regexp_matches(x.payload::text, ${lit(`(${UUID_RE})`)}, 'g') m where ${isDemo("m[1]::uuid")})`);
    return out;
  }
  for (const col of ["record_id", "ref_id", "entity_id", "doc_id", "from_id", "to_id"]) add(names(t, col));
  if (!t.def) {
    for (const c of t.cols.values()) if (c.type === "uuid" && !STAMPS.has(c.name)) add(names(t, c.name));
    return [...new Set(out)];
  }
  if (t.def.scope?.parent) add(names(t, t.def.scope.parent));
  add(names(t, "user_id"));
  // a row that is not a record of its own (no number) and cannot exist without the row it names: a line, a
  // relationship, a membership, an assignment, an answer
  if (!t.def.numbered) for (const f of t.def.fields) if (!f.base && f.required && (f.type === "ref" || f.type === "user" || f.type === "group")) add(names(t, f.name));
  return [...new Set(out)];
}

/**
 * Add the rows derived from demo rows to the registry, to a fixed point (a journal entry's attachment, a parent's
 * child's side rows…). Returns how many rows joined.
 */
export async function expandDerived(q: Queryable, orgId: string, info: TableInfo[]): Promise<number> {
  let total = 0;
  for (let round = 0; round < 6; round++) {
    let added = 0;
    for (const t of info) {
      if (SKIP.has(t.name) || !hasIdOrg(t)) continue;
      const conds = derivedConds(t);
      if (!conds.length || !(await hasRows(q, t, orgId))) continue;
      const rows = await q.query<{ id: string }>(
        `insert into sm_demo_rows (org_id, row_id, tbl)
         select $1, x.id, ${lit(t.arc && t.def ? t.def.table : t.name)} from ${ident(t.name)} x
          where x.org_id = $1 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) and (${conds.join(" or ")})
         on conflict do nothing returning row_id as id`,
        [orgId],
      );
      added += rows.length;
    }
    total += added;
    if (!added) break;
  }
  return total;
}

export interface RefReport {
  table: string;
  field: string;
  rows: number;
  /** emptied (optional reference) or only reported (required reference, access anchor, stamp) */
  action: "cleared" | "reported";
}

export interface PurgeReport {
  /** demo rows per table */
  tables: Record<string, number>;
  rows: number;
  /** of which derived (written outside demo work: side rows, logs…) */
  derived: number;
  accounts: { removed: number; kept: number };
  references: RefReport[];
  files: number;
  /** synchronised rows left as tombstones until every Windows app has pulled them */
  tombstones: number;
  restored: Record<string, number>;
}

/** Reference fields of an engine table (the columns a real row may point at a demo row with). */
function refFields(def: TableDef): { name: string; array: boolean; required: boolean; custom: boolean }[] {
  return def.fields
    .filter((f) => !f.base && (f.type === "ref" || f.type === "user" || f.type === "group" || f.type === "refs" || f.type === "users"))
    .map((f) => ({ name: f.name, array: f.type === "refs" || f.type === "users", required: !!f.required, custom: !!f.custom }));
}

/** Real rows that refer to demo rows: per table and field, with what the purge does about them. Read-only. */
export async function referenceReport(q: Queryable, orgId: string, info: TableInfo[]): Promise<RefReport[]> {
  return sweepReferences(q, orgId, info, false);
}

async function sweepReferences(q: Queryable, orgId: string, info: TableInfo[], apply: boolean): Promise<RefReport[]> {
  const out: RefReport[] = [];
  const real = `x.org_id = $1 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id)`;
  for (const t of info) {
    if (SKIP.has(t.name) || !t.def || !hasIdOrg(t) || !(await hasRows(q, t, orgId))) continue;
    for (const f of refFields(t.def)) {
      const col = f.custom ? null : t.cols.get(f.name);
      if (!f.custom && !col) continue;
      let cond: string;
      let clear: string;
      if (f.custom) {
        if (f.array || !t.cols.has("custom")) continue;
        cond = isDemoText(`x.custom ->> ${lit(f.name)}`);
        clear = `custom = custom - ${lit(f.name)}`;
      } else if (f.array) {
        if (col!.type !== "jsonb") continue;
        cond = `exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(x.${ident(f.name)}) = 'array' then x.${ident(f.name)} else '[]'::jsonb end) e(v) where ${isDemoText("e.v")})`;
        clear = `${ident(f.name)} = (select coalesce(jsonb_agg(e.v), '[]'::jsonb) from jsonb_array_elements(${ident(f.name)}) e(v) where not coalesce(${isDemoText("(e.v #>> '{}')")}, false))`;
      } else {
        const c = names(t, f.name);
        if (!c) continue;
        cond = c;
        clear = `${ident(f.name)} = null`;
      }
      const n = await q.one<{ n: number }>(`select count(*)::int as n from ${ident(t.name)} x where ${real} and ${cond}`, [orgId]);
      if (!n?.n) continue;
      const clearable = f.array || f.custom || !f.required;
      if (apply && clearable) await q.query(`update ${ident(t.name)} x set ${clear} where ${real} and ${cond}`, [orgId]);
      out.push({ table: t.name, field: f.name, rows: n.n, action: clearable ? "cleared" : "reported" });
    }
    // access anchors and authorship of real rows: reported, never moved (moving an anchor could widen who reads the row)
    for (const col of ["unit_id", "domain_id", "workspace_id", "created_by", "updated_by"]) {
      const c = t.cols.get(col);
      if (!isUuid(c)) continue;
      const n = await q.one<{ n: number }>(`select count(*)::int as n from ${ident(t.name)} x where ${real} and x.${ident(col)} is not null and ${isDemo(`x.${ident(col)}`)}`, [orgId]);
      if (n?.n) out.push({ table: t.name, field: col, rows: n.n, action: "reported" });
    }
  }
  return out;
}

/** Demo rows per table (the registry, derived rows included). */
export async function registryCounts(q: Queryable, orgId: string): Promise<Record<string, number>> {
  const rows = await q.query<{ tbl: string; n: number }>(`select tbl, count(*)::int as n from sm_demo_rows where org_id = $1 group by tbl order by tbl`, [orgId]);
  return Object.fromEntries(rows.map((r) => [r.tbl, r.n]));
}

/** Content-free tombstone: every column a pull does not need is emptied, the row marked deleted (a new revision). */
function tombstoneSet(t: TableInfo): string {
  const sets = ["deleted_at = coalesce(deleted_at, now())"];
  for (const c of t.cols.values()) {
    if (TOMBSTONE_KEEP.has(c.name) || c.generated) continue;
    if (c.nullable) sets.push(`${ident(c.name)} = null`);
    else if (c.hasDefault) sets.push(`${ident(c.name)} = default`);
    else if (c.type === "text" || c.type === "character varying") sets.push(`${ident(c.name)} = ''`);
  }
  return sets.join(", ");
}

/** Remove (or tombstone) the registry's rows of every table. Returns rows removed and tombstones left. */
export async function removeRows(q: Queryable, orgId: string, info: TableInfo[], opts: { tombstones: boolean }): Promise<{ removed: number; tombstones: number }> {
  let removed = 0;
  let tombstones = 0;
  const byName = new Map(info.map((t) => [t.name, t]));
  const tables = (await q.query<{ tbl: string }>(`select distinct tbl from sm_demo_rows where org_id = $1`, [orgId])).map((r) => r.tbl);
  for (const name of tables) {
    const t = byName.get(name);
    if (!t || name === "sm_users") continue;
    const mine = `(select row_id from sm_demo_rows where org_id = $1 and tbl = ${lit(name)})`;
    // archive copies go at once: Windows apps never hold them (the hot table's tombstone told them)
    if (t.def && archivable(t.def) && byName.has(archiveTableOf(t.def))) {
      removed += (await q.query(`delete from ${ident(archiveTableOf(t.def))} where org_id = $1 and id in ${mine} returning id`, [orgId])).length;
    }
    if (opts.tombstones && t.synced) {
      // already tombstoned rows (a second run) keep their revision
      const n = await q.query(`update ${ident(name)} set ${tombstoneSet(t)} where org_id = $1 and id in ${mine} and deleted_at is null returning id`, [orgId]);
      tombstones += n.length;
      continue;
    }
    removed += (await q.query(`delete from ${ident(name)} where org_id = $1 and id in ${mine} returning id`, [orgId])).length;
  }
  // tables without row ids: what names a demo row goes (extracted pages, flow timers, scope epochs, links of directory
  // accounts, API usage windows…); a Windows app's outbox entries of demo rows
  for (const t of info) {
    if (SKIP.has(t.name)) continue;
    if (t.name === "sm_outbox") {
      removed += (await q.query(`delete from sm_outbox x where ${isDemo("x.id")} returning id`, [orgId])).length;
      continue;
    }
    if (hasIdOrg(t) || !isUuid(t.cols.get("org_id"))) continue;
    const conds: string[] = [];
    for (const c of t.cols.values()) if (c.type === "uuid" && !STAMPS.has(c.name)) conds.push(`(x.${ident(c.name)} is not null and ${isDemo(`x.${ident(c.name)}`)})`);
    if (!conds.length) continue;
    removed += (await q.query(`delete from ${ident(t.name)} x where x.org_id = $1 and (${conds.join(" or ")}) returning 1 as k`, [orgId])).length;
  }
  return { removed, tombstones };
}

/** The pack's accounts: removed unless they belong to another organisation too (then only the demo mark goes). */
export async function removeAccounts(q: Queryable, orgId: string): Promise<{ removed: number; kept: number }> {
  const users = await q.query<{ id: string; elsewhere: boolean }>(
    `select d.row_id as id,
            exists (select 1 from sm_org_members m where m.user_id = d.row_id and m.org_id <> $1 and m.deleted_at is null) as elsewhere
       from sm_demo_rows d where d.org_id = $1 and d.tbl = 'sm_users'`,
    [orgId],
  );
  let removed = 0;
  let kept = 0;
  for (const u of users) {
    // a membership, a session or a sign-in record the capture did not see (outside any organisation's scope)
    await q.query(`delete from sm_org_members where org_id = $1 and user_id = $2`, [orgId, u.id]);
    await q.query(`delete from sm_sessions where user_id = $1 and (org_id = $2 or org_id is null or $3::boolean = false)`, [u.id, orgId, u.elsewhere]);
    await q.query(`delete from sm_security_events where user_id = $1 and (org_id = $2 or org_id is null or $3::boolean = false)`, [u.id, orgId, u.elsewhere]);
    await q.query(`delete from sm_scope_epochs where user_id = $1 and org_id = $2`, [u.id, orgId]);
    if (u.elsewhere) {
      await q.query(`update sm_users set prefs = prefs - 'demo_org' where id = $1 and prefs ->> 'demo_org' = $2`, [u.id, orgId]);
      kept++;
      continue;
    }
    const email = await q.one<{ email: string }>(`select email from sm_users where id = $1`, [u.id]);
    if (email) await q.query(`delete from sm_auth_throttle where lower(subject) = lower($1) or key like $2`, [email.email, `%${email.email.toLowerCase()}%`]);
    await q.query(`delete from sm_users where id = $1`, [u.id]);
    removed++;
  }
  return { removed, kept };
}

/** Files of demo attachments no remaining attachment of the organisation uses. */
export async function demoFiles(q: Queryable, orgId: string): Promise<string[]> {
  const rows = await q.query<{ sha256: string }>(
    `select distinct a.sha256 from sm_attachments a where a.org_id = $1 and ${isDemo("a.id")} and a.sha256 is not null`,
    [orgId],
  );
  return rows.map((r) => r.sha256);
}

/** Remove the files no attachment refers to any more. Returns how many went. */
export async function removeFiles(q: Queryable, orgId: string, shas: string[], store: BlobStore = blobStore()): Promise<number> {
  let n = 0;
  for (const sha of shas) {
    const used = await q.one(`select 1 from sm_attachments where org_id = $1 and sha256 = $2 limit 1`, [orgId, sha]);
    if (used) continue;
    if (store.remove) await store.remove(q, orgId, sha);
    else await q.query(`delete from sm_blobs where org_id = $1 and sha256 = $2`, [orgId, sha]);
    n++;
  }
  return n;
}

/** Save the computed tables' rows before the load (the purge puts them back). */
export async function saveComputed(q: Queryable, orgId: string, info: TableInfo[]): Promise<number> {
  let n = 0;
  const names = new Set(info.map((t) => t.name));
  for (const table of COMPUTED_TABLES) {
    if (!names.has(table)) continue;
    const rows = await q.query(
      `insert into sm_demo_saved (org_id, tbl, row_id, data) select $1, ${lit(table)}, x.id, to_jsonb(x) from ${ident(table)} x where x.org_id = $1
       on conflict (org_id, tbl, row_id) do nothing returning row_id`,
      [orgId],
    );
    n += rows.length;
  }
  return n;
}

/** Put the computed tables back as they were before the load. Returns rows restored per table. */
export async function restoreComputed(q: Queryable, orgId: string, info: TableInfo[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byName = new Map(info.map((t) => [t.name, t]));
  for (const table of COMPUTED_TABLES) {
    const t = byName.get(table);
    if (!t || !hasIdOrg(t)) continue;
    // computed while demo data was there: recomputed from real data by the next run
    await q.query(`delete from ${ident(table)} x where x.org_id = $1 and not exists (select 1 from sm_demo_saved s where s.org_id = $1 and s.tbl = ${lit(table)} and s.row_id = x.id)`, [orgId]);
    const cols = [...t.cols.values()].filter((c) => !c.generated && c.name !== "rev").map((c) => c.name);
    const list = cols.map(ident).join(", ");
    const sets = cols.filter((c) => c !== "id").map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
    // rows still as saved are left alone (no new revision); changed or missing ones are written back
    const rows = await q.query(
      `insert into ${ident(table)} (${list})
       select ${cols.map((c) => `r.${ident(c)}`).join(", ")} from sm_demo_saved s, jsonb_populate_record(null::${ident(table)}, s.data) r
        where s.org_id = $1 and s.tbl = ${lit(table)}
          and not exists (select 1 from ${ident(table)} x where x.id = s.row_id and (to_jsonb(x) - 'rev' - 'updated_at') = (s.data - 'rev' - 'updated_at'))
       on conflict (id) do update set ${sets} returning id`,
      [orgId],
    );
    if (rows.length) out[table] = rows.length;
  }
  return out;
}

/** Put the numbering counters back: as before the load, or past the highest number real rows took meanwhile. */
export async function restoreCounters(q: Queryable, orgId: string, saved: Record<string, number>): Promise<void> {
  const now = await q.query<{ table_key: string; last: number }>(`select table_key, last from sm_numbers where org_id = $1`, [orgId]);
  for (const r of now) {
    const def = physicalTables().find((d) => d.key === r.table_key);
    let floor = 0;
    if (def?.numbered) {
      const m = await q.one<{ n: number | null }>(`select max(no)::int as n from ${ident(def.table)} where org_id = $1`, [orgId]);
      floor = m?.n ?? 0;
      if (archivable(def)) {
        const a = await q.one<{ n: number | null }>(`select max(no)::int as n from ${ident(archiveTableOf(def))} where org_id = $1`, [orgId]).catch(() => null);
        floor = Math.max(floor, a?.n ?? 0);
      }
    }
    const before = saved[r.table_key];
    if (before === undefined && !floor) await q.query(`delete from sm_numbers where org_id = $1 and table_key = $2`, [orgId, r.table_key]);
    else {
      const last = Math.max(before ?? 0, floor);
      if (last !== r.last) await q.query(`update sm_numbers set last = $3 where org_id = $1 and table_key = $2`, [orgId, r.table_key, last]);
    }
  }
}

/** The clearing step (real rows' references to demo rows). */
export function clearReferences(q: Queryable, orgId: string, info: TableInfo[]): Promise<RefReport[]> {
  return sweepReferences(q, orgId, info, true);
}
