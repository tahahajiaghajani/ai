// The demo pack's purge (docs/DEMO_FA.md). Its rule since 1.1.5: the pack goes, and so does everything that cannot stand
// without it, real or not — what was recorded on demo data is removed with it, what was built on top of it is kept and
// cleaned, nothing is left naming a removed row and nothing widens (`refs.ts` is the catalogue of every reference and
// its role, `clean.ts` the cleaning, `verify.ts` the proof). What the pack made is known exactly: every row a demo
// transaction inserted is in `sm_demo_rows` (src/server/db/scope.ts, the capture triggers of migration 0098_demo), and
// so are the pack's accounts; every real row demo work changed or deleted has its before and after images in
// `sm_demo_touched` (migration 0099_demo_touch).
//
// 1. expand — first the real rows demo work changed go back (`revertTouched`: only rows still as demo work left them,
//    each in its own savepoint — a row that would collide with a live one stays as it is and is reported). Then rows
//    that exist only because of a demo row join the set (to a fixed point), always through a reference, never by time
//    or authorship alone: side rows of a demo record (journal, history, attachments, links, approvals, SLA timers,
//    bells, notification log, RAG documents… — any table with a `record_id`/`ref_id` naming one), parent-scoped
//    children (`TableDef.parent`), rows that cannot exist without one — a required reference, a parent of `PARENTS`
//    (a workflow case of a demo process, its tasks, submissions and drafts; a holder in a pack unit; a pack library
//    field attached to a real table), numbered or not, whoever made them —, rows whose requester or beneficiary is a
//    pack person (`BENEFICIARY`), a demo person's own rows (`user_id`, `created_by`), and platform rows (jobs, runs, AI
//    threads, sessions…) naming a demo row — not the organisation's own passes still to run, whose payload names only
//    where they left off (`ORG_PASS`). What joins is marked derived (`#derived` in sm_demo_saved, the report's «ثبت‌شده
//    روی دادهٔ نمایشی»). The trail of real records (history, journal, audit, sign-ins) leaves the set (`keepRealTrail`).
// 2. clear — definitions built on top of the pack are cleaned (`clean.ts`, class C): conditions, rules, recipients,
//    levels, actions, flows, forms, workflow drafts, defaults; a definition left meaningless is deactivated, a published
//    workflow version that can no longer route is retired (versions are never rewritten).
// 3. remove — the rows themselves, their archive copies (`_arc`) and their tables without ids (extracted pages, flow
//    timers, scope epochs…); of the jobs demo work queued, the demo jobs and those that ended (an organisation-wide job
//    still to run, the organisation's timer among them, stays queued: `removeJobs`); a pass of the organisation's whose
//    payload names demo rows starts again over its rows (`restartPasses`). Synchronised rows of an organisation with
//    Windows apps become content-free tombstones first (the apps drop their copies on their next pull) and go for good
//    once every app has passed them (`finalizeDemo`); without apps they go at once. Files no remaining attachment uses
//    leave the blob store. Each table's delete runs in a savepoint (a row that cannot go is reported, never blocking).
// 4. reroute — references of kept real rows to removed rows are cleared through the engine as the system, so the
//    engine's hooks route the records again (assignment rules, default queues, the access anchors); open approvals are
//    planned again, open workflow tasks of removed people end (class D).
// 5. anchors — the access anchors (unit, domain) of kept rows that named a removed unit are derived again (class E).
// 6. accounts — the pack's people leave with their memberships and sessions (their sign-in records stay); an account
//    that also belongs to another organisation is kept there (only its demo mark goes).
// 7. restore — numbering counters, and the computed tables (KPI scores, trained models, insights…) as they were
//    before the load (`sm_demo_saved`): what the platform computed while demo data was there is recomputed from real
//    data on its next run.
// Left behind: one content-free audit line per load and purge (counts only), one audit line per definition the purge
// cleaned (what it took out, for its owner to review), and the trail of real records.
// Every phase runs in steps that fit the web version's limits (a statement 30 s, a request 50 s): it stops at its time
// budget and resumes from its cursor (`progress.cursor`).
//
// Windows apps (sync revisions are transaction ids, docs/spec/ENGINE.md §13): a row an app may hold never simply
// disappears. While the purge leaves tombstones (`tombstones`: apps were active when it removed the rows), every
// synchronised row it removes — the pack's rows, what the platform computed meanwhile, memberships — becomes one, and
// they go for good in `finalizeDemo`. Every hard delete of such rows (no app was active, the tombstones' own removal)
// raises the organisation's purge watermark in the same transaction (`notePurge`): an app that did not see the delete —
// one that was away, or one an administrator's forced finalisation left behind — reads everything again and drops
// what the server no longer has.
import type { TableDef } from "@shared/model/types";
import { physicalTables } from "@shared/tables";
import { pgArray, type Queryable } from "../../db";
import { archivable, archiveTableOf } from "../../engine/ddl";
import { blobStore, type BlobStore } from "../../blobs";
import { hashPassword, readableCode } from "../../auth/password";
import { BY_TABLE } from "../../sync/registry";
import { notePurged, notePurgedHere } from "../../sync/snapshot";
import { DEMO_JOB_SQL } from "../../jobs";
import { ABOUT_COLUMNS, fieldRefs, ID_TEXT, PLATFORM_JSON_DERIVE_WHEN, PLATFORM_JSON_DERIVES } from "./refs";
import { isPurgedSql, tombstoneAccount } from "./ledger";

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
  "sm_demo_touched",
  "sm_demo_purged",
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
  // the search and AI index (real records re-indexed while demo data was there; demo records' entries go by record)
  "sm_ai_rag_docs",
  "sm_ai_chunks",
  "sm_ai_rag_runs",
  // run logs of organisation-wide computations
  "sm_license_reconcile_runs",
  "sm_allocation_runs",
  "sm_allocation_results",
];

/**
 * Computed columns of the organisation's own rows: statistics an organisation-wide job writes onto real definitions
 * from the records — a catalogue item's fulfilment times and orders of the last 90 days (request.stats, from request
 * items: the pack's too while it is loaded). The job is not demo work, so nothing records what it changed; the columns
 * are saved with the computed tables before the load (`<table>#columns` in sm_demo_saved) and put back by the purge on
 * the rows that were there — the next scheduled run recomputes them from real data. Only the platform writes them
 * (read-only, without history). A computed column of real rows added later belongs here.
 */
export const COMPUTED_COLUMNS: Record<string, readonly string[]> = {
  sm_catalog_items: ["sle_p50", "sle_p85", "sle_p95", "sle_samples", "orders_90d"],
};
const COLUMNS = "#columns";

/** Above this many rows a table is not saved (a large organisation's records: see docs/DEMO_FA.md). */
const SAVE_LIMIT = 20_000;
/** Columns a tombstone keeps (identity, sync, and what a pull needs to judge a side row). */
const TOMBSTONE_KEEP = new Set(["id", "org_id", "rev", "deleted_at", "created_at", "updated_at", "version", "table_key", "record_id", "from_table", "from_id", "to_table", "to_id", "field", "visibility", "kind"]);

/** Columns that name who wrote a platform row, not what it is about (a real setting a demo person touched stays). */
const STAMPS = new Set(["id", "org_id", "created_by", "updated_by"]);

/**
 * References that name the definition a module's schedule generated a record from (set by the platform only). A demo
 * definition keeps generating while the pack is loaded — a demo maintenance plan's next visit a quarter later, made by
 * the field service's sweep outside the demo scope — and what it generates is demo data like the definition. A
 * generator of records from a definition the pack loads belongs here.
 */
const GENERATED_FROM: Record<string, readonly string[]> = {
  work_order: ["maintenance_plan_id"],
};

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

/**
 * Does a Windows app hold rows of this table (a sync root: the records with their journal, history, attachments and
 * links, the organisation's members)? Accounts (`sm_users`) come with the members but are not the organisation's: an
 * app keeps every account it received (no tombstone or full read takes one back); access in the organisation is the
 * membership, which is tombstoned or watermarked like any synchronised row.
 */
export const heldByApps = (table: string): boolean => BY_TABLE.has(table);

/** What a hard delete of a synchronised table removed: rows, the newest tombstone revision, and whether live rows went. */
interface Gone {
  n: number;
  stones: number | null;
  live: boolean;
}

/** `delete … returning rev, deleted_at` wrapped so that the database counts (no row list to this process). */
async function deleteHeld(q: Queryable, del: string, params: unknown[]): Promise<Gone> {
  const r = await q.one<{ n: number; stones: string | number | null; live: boolean | null }>(
    `with d as (${del} returning rev, deleted_at) select count(*)::int as n, max(rev) filter (where deleted_at is not null) as stones, bool_or(deleted_at is null) as live from d`,
    params,
  );
  return { n: r?.n ?? 0, stones: r?.stones == null ? null : Number(r.stones), live: !!r?.live };
}

/**
 * Raise the organisation's purge watermark for rows of synchronised tables deleted for good in this transaction
 * (docs/spec/ENGINE.md §13): a tombstone needs only its revision (an app that pulled it dropped its copy; one whose
 * cursor is older reads everything again), a live row this transaction's own id (no app saw it go). Called after the
 * deletes of a transaction, the live rows last (`notePurgedHere` replaces the watermark; `notePurged` keeps it then).
 */
export async function notePurge(q: Queryable, orgId: string, gone: Gone[]): Promise<void> {
  const stones = Math.max(0, ...gone.map((g) => g.stones ?? 0));
  if (stones > 0) await notePurged(q, orgId, stones);
  if (gone.some((g) => g.live)) await notePurgedHere(q, orgId);
}

/**
 * Is the uuid expression `e` a demo id of the organisation ($1)? An index probe of sm_demo_rows' primary key — or of the
 * purged-id ledger's: what an earlier purge left behind (a reference to a row it removed) is recognised as demo data.
 */
const isDemo = (e: string) => `(exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = ${e}) or ${isPurgedSql(e)})`;
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

/** Does the job aliased `j` name a demo row of the organisation ($1) anywhere in its payload? */
const payloadNamesDemo = (j: string) => `exists (select 1 from regexp_matches(${j}.payload::text, ${lit(`(${UUID_RE})`)}, 'g') m where ${isDemo("m[1]::uuid")})`;

/**
 * The organisation's own passes still to run: an organisation-wide job — its kind is its dedupe key, one per organisation
 * (the SLA recalculation a calendar edit queues, the nightly CMDB health pass, the SLM sweep…) — queued or running,
 * not the pack's own (`__demo`). Whoever queued it, it is the organisation's work, and the ids its payload names are
 * where its pass left off (`after`, `cursor`) or what it has added up so far — never what it is about: a demo row
 * there says only that demo rows sit among the rows the pass walks (ids are time-ordered). Never NULL (it is negated:
 * a job without a dedupe key is not one).
 */
const ORG_PASS = (j: string) =>
  `(${j}.dedupe_key is not distinct from ${j}.kind and ${j}.status in ('queued', 'running') and not coalesce(${j}.payload ? '__demo', false))`;

/** Does the organisation have rows in the table at all? (most tables of a young organisation are empty) */
async function hasRows(q: Queryable, t: TableInfo, orgId: string): Promise<boolean> {
  return !!(await q.one(`select 1 from ${ident(t.name)} where org_id = $1 limit 1`, [orgId]));
}

/** Does json column `col` of the row aliased `x` name a demo row of the organisation ($1) anywhere? */
const jsonNamesDemo = (col: string) =>
  `(x.${ident(col)} is not null and exists (select 1 from regexp_matches(x.${ident(col)}::text, ${lit(`(${UUID_RE})`)}, 'g') m where ${isDemo("m[1]::uuid")}))`;

/**
 * The conditions that make a row of `t` derived from demo data (removed with it). Platform tables (no engine table):
 * any id column naming a demo row, and the json of runs and logs (`PLATFORM_JSON_DERIVES`) — only rows written since
 * the load (`since`: nothing older can name a row the load made). Engine tables: a side row of a demo record, a
 * parent-scoped child of one, a row with a parent reference to one (`refs.ts` `fieldRefs`: a required reference,
 * `PARENTS`, a requester or beneficiary that is a pack person — numbered or not, whoever made it), a record in a removed
 * workspace, a demo person's own row.
 */
export function derivedConds(t: TableInfo, since: string | null = null): string[] {
  const out: string[] = [];
  const add = (c: string | null) => c && out.push(c);
  if (t.name === "sm_jobs") {
    // a job about demo data: its payload names a demo row — not one of the organisation's own passes still to run,
    // whose payload names where it left off (FL-2): it never joins the set (so the job runner never takes it for demo
    // work), and the remove step starts its pass again instead (`restartPasses`)
    out.push(`(${payloadNamesDemo("x")} and not ${ORG_PASS("x")})`);
    return out;
  }
  // the trail of a record (history, journal, audit, sign-ins): derived only from the record it is about, never from who
  // wrote it — a demo person's entry on a real record stays (keepRealTrail)
  const trail = TRAIL_TABLES[t.name];
  if (trail) {
    if (trail.record) add(names(t, trail.record));
    return out;
  }
  for (const col of ABOUT_COLUMNS) add(names(t, col));
  if (!t.def) {
    for (const c of t.cols.values()) if ((c.type === "uuid" || c.type === "ARRAY") && !STAMPS.has(c.name)) add(names(t, c.name));
    const json = (PLATFORM_JSON_DERIVES[t.name] ?? []).filter((c) => t.cols.get(c)?.type === "jsonb");
    if (json.length) {
      const recent = since && (t.cols.has("updated_at") || t.cols.has("created_at"))
        ? `(${[t.cols.has("updated_at") ? `x.updated_at >= ${lit(since)}::timestamptz` : null, t.cols.has("created_at") ? `x.created_at >= ${lit(since)}::timestamptz` : null].filter(Boolean).join(" or ")}) and `
        : "";
      const when = PLATFORM_JSON_DERIVE_WHEN[t.name] ? `(${PLATFORM_JSON_DERIVE_WHEN[t.name]}) and ` : "";
      add(`(${recent}${when}(${json.map(jsonNamesDemo).join(" or ")}))`);
    }
    return [...new Set(out)];
  }
  if (t.def.scope?.parent) add(names(t, t.def.scope.parent));
  add(names(t, "user_id"));
  // a row a demo person made (outside the demo scope's capture, e.g. pushed from a Windows app before the scope covered it)
  add(names(t, "created_by"));
  // a row that cannot stand without the row it names (a required reference, a parent the catalogue declares, a pack
  // person as its requester or beneficiary): recorded on demo data, whoever made it — a real task on a demo incident, a
  // real case of a demo workflow, a membership or a holding of a pack person, a real incident filed for a pack caller
  for (const f of fieldRefs(t.def)) if (f.role === "parent" && !f.custom && !f.array) add(names(t, f.name));
  // text columns that hold (or embed, like a generated posting's key) the id of the row they exist for — only rows
  // written since the load can name one
  for (const [col, role] of Object.entries(ID_TEXT[t.def.key] ?? {})) {
    if (role !== "parent" || !t.cols.has(col)) continue;
    const recent = since && t.cols.has("created_at") ? `x.created_at >= ${lit(since)}::timestamptz and ` : "";
    add(`(${recent}${jsonNamesDemo(col)})`);
  }
  // a record in a workspace that went with the pack (moving it out would make it public)
  add(names(t, "workspace_id"));
  // a record a module's schedule generated from a demo definition (GENERATED_FROM) by itself (no person made it, no real
  // person changed it) — e.g. a demo maintenance plan's next visit; one a real person made or changed stays
  if (t.def.numbered && t.cols.has("created_by") && t.cols.has("updated_by")) {
    for (const name of GENERATED_FROM[t.def.key] ?? []) {
      const f = t.def.fields.find((x) => x.name === name);
      if (!f || f.base || f.required || f.type !== "ref") continue;
      const c = names(t, f.name);
      if (c) add(`(${c} and x.created_by is null and (x.updated_by is null or ${isDemo("x.updated_by")}))`);
    }
  }
  return [...new Set(out)];
}

/** Where the fixed point of `expandStep` is: round, table index, rows added in this round and in all. */
export interface ExpandCursor {
  round: number;
  i: number;
  added: number;
  total: number;
}

export const newExpandCursor = (): ExpandCursor => ({ round: 0, i: 0, added: 0, total: 0 });

/** Rounds of the fixed point (a demo person → their case → its task → its submission → the submission's file…). */
const MAX_ROUNDS = 16;

/**
 * Add the rows derived from demo rows to the registry, to a fixed point (a journal entry's attachment, a parent's
 * child's side rows…), until `until` (ms since the epoch): returns whether the fixed point was reached (`cur` moves on,
 * so the next call resumes where this one stopped). Each derived row is marked (`#derived` in sm_demo_saved): the
 * report tells what was recorded on demo data from what the pack made.
 */
export async function expandStep(q: Queryable, orgId: string, info: TableInfo[], cur: ExpandCursor, until = Infinity, since: string | null = null): Promise<boolean> {
  const tables = info.filter((t) => !SKIP.has(t.name) && hasIdOrg(t)).map((t) => ({ t, conds: derivedConds(t, since) })).filter((x) => x.conds.length);
  while (cur.round < MAX_ROUNDS) {
    for (; cur.i < tables.length; cur.i++) {
      if (Date.now() > until) return false;
      const { t, conds } = tables[cur.i];
      if (!(await hasRows(q, t, orgId))) continue;
      const tbl = lit(t.arc && t.def ? t.def.table : t.name);
      const r = await q.one<{ n: number }>(
        `with ins as (
           insert into sm_demo_rows (org_id, row_id, tbl)
           select $1, x.id, ${tbl} from ${ident(t.name)} x
            where x.org_id = $1 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) and (${conds.join(" or ")})
           on conflict do nothing returning row_id),
         marked as (insert into sm_demo_saved (org_id, tbl, row_id, data) select $1, '${DERIVED}', row_id, jsonb_build_object('t', ${tbl}) from ins on conflict do nothing returning 1)
         select count(*)::int as n from ins`,
        [orgId],
      );
      cur.added += r?.n ?? 0;
      cur.total += r?.n ?? 0;
    }
    if (!cur.added) return true;
    cur.round++;
    cur.i = 0;
    cur.added = 0;
  }
  return true;
}

/** Add the rows derived from demo rows to the registry, to a fixed point, at once. Returns how many rows joined. */
export async function expandDerived(q: Queryable, orgId: string, info: TableInfo[], since: string | null = null): Promise<number> {
  const cur = newExpandCursor();
  await expandStep(q, orgId, info, cur, Infinity, since);
  return cur.total;
}

/** The mark of a derived row in sm_demo_saved (`tbl`); its `data.t` is the row's table. */
export const DERIVED = "#derived";
/** The mark of a real row the purge put back (`revertTouched`). */
export const REVERTED = "#reverted";

export interface RefReport {
  table: string;
  field: string;
  rows: number;
  /** emptied (optional reference) or only reported (required reference, access anchor, stamp) */
  action: "cleared" | "reported";
}

/** «ثبت‌شده روی دادهٔ نمایشی»: real rows of a table deleted with the pack, with a few of their names. */
export interface DeletedBucket {
  table: string;
  label: string;
  rows: number;
  samples: string[];
}

/** «تعریف‌های پاک‌سازی‌شده»: a definition built on top of the pack, kept and cleaned (or deactivated, or retired). */
export interface CleanedDefinition {
  table: string;
  label: string;
  id: string;
  name: string;
  /** what was taken out (Persian) */
  what: string;
  deactivated: boolean;
  retired?: boolean;
}

/** «رکوردهای دوباره ارجاع‌شده»: kept records whose references to the pack were cleared (and routed again). */
export interface ReroutedBucket {
  table: string;
  label: string;
  rows: number;
  /** of which routing (assignee, group, owner…) was cleared, so the engine's rules routed them again */
  routed: number;
  samples: string[];
}

export interface PurgeReport {
  /** demo rows per table */
  tables: Record<string, number>;
  rows: number;
  /** of which derived (written outside demo work: side rows, logs, real rows recorded on demo data…) */
  derived: number;
  accounts: { removed: number; kept: number };
  references: RefReport[];
  files: number;
  /** synchronised rows left as tombstones until every Windows app has pulled them */
  tombstones: number;
  restored: Record<string, number>;
  /** real rows demo work changed that were left as they are (something outside the demo scope changed them since) */
  left_real?: TouchReport[];
  /** trail rows (history, journal, audit, sign-ins) demo work wrote about real records: kept */
  kept_trail?: number;
  /** rows the platform made outside the demo scope since the load that refer to demo rows: kept, only reported */
  unattributed?: Unattributed[];
  /** the three buckets of 1.1.5: real rows recorded on demo data (deleted), definitions cleaned, records re-routed */
  deleted?: DeletedBucket[];
  cleaned?: CleanedDefinition[];
  rerouted?: ReroutedBucket[];
  /** rows the purge could not handle (it went on): what and why, content-free */
  skipped?: Skipped[];
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

/**
 * The organisation's own passes (`ORG_PASS`) whose payload names demo rows start again (FL-2): their payload is emptied,
 * as when they were queued, and the pass runs over the organisation's rows from the start — the job stays, queued once,
 * and names no demo row. Never deleted instead: such a pass is queued by the organisation's own work (a holiday edited
 * by an administrator queues the SLA recalculation, `sla.recalc`, and no schedule queues it again), and the rows after
 * its cursor would keep what the pass was there to change. Only a payload that names a demo row is emptied: other
 * passes keep theirs (`notify.cleanup` needs its organisation). Before any job goes (`removeRows`), whether demo work
 * queued the pass or not.
 */
async function restartPasses(q: Queryable, orgId: string): Promise<number> {
  const r = await q.query(`update sm_jobs x set payload = '{}'::jsonb, updated_at = now() where x.org_id = $1 and ${ORG_PASS("x")} and ${payloadNamesDemo("x")} returning x.id`, [orgId]);
  return r.length;
}

/**
 * The jobs demo work queued (`mine`: their registry rows). A demo job goes whatever its state — the pack's own
 * (`__demo`) and every job about demo rows, judged as the job runner judges them (`DEMO_JOB_SQL`) — and so does every
 * job that has ended. An organisation-wide job that demo work only happened to queue, still queued or running, is the
 * organisation's own work (it runs outside the demo scope): it stays as it is and leaves the registry. The
 * organisation's `process.timer` is one (FINAL-5): woken by a demo person's request while the timer ran, its twin
 * queued in that request took over when the timer ended (jobs/index.ts `finish`), and it serves every case, real ones too.
 * A pass of the organisation's whose payload named demo rows was started again first (`restartPasses`): it names none.
 */
async function removeJobs(q: Queryable, orgId: string, mine: string, params: unknown[] = [orgId]): Promise<number> {
  const gone = await q.query(`delete from sm_jobs where org_id = $1 and id in ${mine} and (status in ('done', 'failed') or ${DEMO_JOB_SQL}) returning id`, params);
  await q.query(`delete from sm_demo_rows d where d.org_id = $1 and d.tbl = 'sm_jobs' and exists (select 1 from sm_jobs j where j.id = d.row_id)`, [orgId]);
  return gone.length;
}

/** Where `removeStep` is: the table it reached (in the registry's table order), and whether the passes started again. */
export interface RemoveCursor {
  /** the last table done (the registry's tables in name order) */
  after: string | null;
  restarted?: boolean;
  removed: number;
  tombstones: number;
}

export const newRemoveCursor = (): RemoveCursor => ({ after: null, removed: 0, tombstones: 0 });

/**
 * Remove (or tombstone) the registry's rows, table by table until `until` (ms since the epoch): returns whether every
 * table is done (`cur` moves on; the next call resumes). Each table's statement runs in a savepoint; when it fails, the
 * table's rows go one by one, each in its own savepoint, and a row that cannot go is reported (`skipped`) — never
 * blocking the rest. A hard delete of rows Windows apps hold — without tombstones (no app was active), or the
 * tombstones themselves (`finalizeDemo`) — raises the purge watermark in the same transaction (`notePurge`).
 */
export async function removeStep(
  q: Queryable, orgId: string, info: TableInfo[], opts: { tombstones: boolean }, cur: RemoveCursor, until = Infinity, skipped: Skipped[] = [],
): Promise<boolean> {
  const held: Gone[] = [];
  const byName = new Map(info.map((t) => [t.name, t]));
  // before any job goes, and whether or not demo work queued one: the registry still names the demo rows
  if (!cur.restarted) {
    await restartPasses(q, orgId);
    cur.restarted = true;
  }
  const tables = (await q.query<{ tbl: string }>(`select distinct tbl from sm_demo_rows where org_id = $1 order by tbl`, [orgId])).map((r) => r.tbl);
  // the registry shrinks as tables are done (jobs leave it): walk it by name, not by position
  const todo = tables.filter((name) => cur.after === null || name > cur.after);
  for (const name of todo) {
    if (Date.now() > until) {
      await notePurge(q, orgId, held);
      return false;
    }
    const t = byName.get(name);
    cur.after = name;
    if (!t || name === "sm_users") continue;
    const mine = `(select row_id from sm_demo_rows where org_id = $1 and tbl = ${lit(name)})`;
    const one = async (where: string, params: unknown[]): Promise<void> => {
      if (name === "sm_jobs") {
        cur.removed += await removeJobs(q, orgId, where === "all" ? mine : `($2::uuid)`, params);
        return;
      }
      const ids = where === "all" ? mine : `($2::uuid)`;
      // archive copies go at once: Windows apps never hold them (the hot table's tombstone told them)
      if (t.def && archivable(t.def) && byName.has(archiveTableOf(t.def))) {
        cur.removed += (await q.query(`delete from ${ident(archiveTableOf(t.def))} where org_id = $1 and id in ${ids} returning id`, params)).length;
      }
      if (opts.tombstones && t.synced) {
        // already tombstoned rows (a second run) keep their revision
        const n = await q.query(`update ${ident(name)} set ${tombstoneSet(t)} where org_id = $1 and id in ${ids} and deleted_at is null returning id`, params);
        cur.tombstones += n.length;
        return;
      }
      if (heldByApps(name)) {
        const gone = await deleteHeld(q, `delete from ${ident(name)} where org_id = $1 and id in ${ids}`, params);
        cur.removed += gone.n;
        held.push(gone);
        return;
      }
      cur.removed += (await q.query(`delete from ${ident(name)} where org_id = $1 and id in ${ids} returning id`, params)).length;
    };
    const all = await inSavepoint(q, () => one("all", [orgId]));
    if (all.ok) continue;
    // one by one: a row that cannot go is reported, the rest go
    const rows = await q.query<{ row_id: string }>(`select row_id from sm_demo_rows where org_id = $1 and tbl = ${lit(name)}`, [orgId]);
    let failed = 0;
    let reason = failReason(all.error);
    for (const r of rows) {
      const x = await inSavepoint(q, () => one("row", [orgId, r.row_id]));
      if (!x.ok) {
        failed++;
        reason = failReason(x.error);
      }
    }
    if (failed) skipped.push({ phase: "remove", table: name, rows: failed, reason });
  }
  await notePurge(q, orgId, held);
  // tables without row ids: what names a demo row goes (extracted pages, flow timers, scope epochs, links of directory
  // accounts, API usage windows…); a Windows app's outbox entries of demo rows
  for (const t of info) {
    if (SKIP.has(t.name)) continue;
    if (t.name === "sm_outbox") {
      cur.removed += (await q.query(`delete from sm_outbox x where ${isDemo("x.id")} returning id`, [orgId])).length;
      continue;
    }
    if (hasIdOrg(t) || !isUuid(t.cols.get("org_id"))) continue;
    const conds: string[] = [];
    for (const c of t.cols.values()) if (c.type === "uuid" && !STAMPS.has(c.name)) conds.push(`(x.${ident(c.name)} is not null and ${isDemo(`x.${ident(c.name)}`)})`);
    if (!conds.length) continue;
    cur.removed += (await q.query(`delete from ${ident(t.name)} x where x.org_id = $1 and (${conds.join(" or ")}) returning 1 as k`, [orgId])).length;
  }
  return true;
}

/**
 * Remove (or tombstone) the registry's rows of every table at once. Returns rows removed and tombstones left (see
 * `removeStep`).
 */
export async function removeRows(q: Queryable, orgId: string, info: TableInfo[], opts: { tombstones: boolean }, skipped: Skipped[] = []): Promise<{ removed: number; tombstones: number }> {
  const cur = newRemoveCursor();
  await removeStep(q, orgId, info, opts, cur, Infinity, skipped);
  return { removed: cur.removed, tombstones: cur.tombstones };
}

/**
 * The pack's accounts: removed unless they belong to another organisation too (then only the demo mark goes). Their
 * memberships are synchronised rows: while the purge leaves tombstones (`tombstones`) a membership stays one — the
 * capture's tombstone from `removeRows`, or one made here for a membership the capture did not see — so that every
 * Windows app learns of it, and `finalizeDemo` removes it; otherwise it goes now and raises the purge watermark.
 */
export async function removeAccounts(q: Queryable, orgId: string, opts: { tombstones?: boolean } = {}): Promise<{ removed: number; kept: number }> {
  const users = await q.query<{ id: string; elsewhere: boolean }>(
    `select d.row_id as id,
            exists (select 1 from sm_org_members m where m.user_id = d.row_id and m.org_id <> $1 and m.deleted_at is null) as elsewhere
       from sm_demo_rows d where d.org_id = $1 and d.tbl = 'sm_users'`,
    [orgId],
  );
  let removed = 0;
  let kept = 0;
  const held: Gone[] = [];
  for (const u of users) {
    // a membership, a session or a sign-in record the capture did not see (outside any organisation's scope)
    if (opts.tombstones) await q.query(`update sm_org_members set deleted_at = now(), is_active = false where org_id = $1 and user_id = $2 and deleted_at is null`, [orgId, u.id]);
    else held.push(await deleteHeld(q, `delete from sm_org_members where org_id = $1 and user_id = $2`, [orgId, u.id]));
    await q.query(`delete from sm_sessions where user_id = $1 and (org_id = $2 or org_id is null or $3::boolean = false)`, [u.id, orgId, u.elsewhere]);
    // sign-in records stay (docs/DEMO_FA.md): who signed in as a demo account, and when, is never erased
    await q.query(`delete from sm_scope_epochs where user_id = $1 and org_id = $2`, [u.id, orgId]);
    if (u.elsewhere) {
      // kept for its other memberships, but no longer signs in with the demo's shared password, and signed out
      await q.query(`update sm_users set prefs = prefs - 'demo_org', password_hash = case when password_hash is null then null else $3 end where id = $1 and prefs ->> 'demo_org' = $2`, [u.id, orgId, await hashPassword(readableCode(6, 4))]);
      await q.query(`delete from sm_sessions where user_id = $1`, [u.id]);
      kept++;
      continue;
    }
    const email = await q.one<{ email: string }>(`select email from sm_users where id = $1`, [u.id]);
    if (email) await q.query(`delete from sm_auth_throttle where lower(subject) = lower($1) or key like $2`, [email.email, `%${email.email.toLowerCase()}%`]);
    // while Windows apps hold the members: a content-free account tombstone they delete the account by (ledger.ts),
    // removed for good with the memberships' tombstones (finalizeDemo)
    if (opts.tombstones) await tombstoneAccount(q, orgId, u.id);
    else await q.query(`delete from sm_users where id = $1`, [u.id]);
    removed++;
  }
  await notePurge(q, orgId, held);
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

/**
 * Save the computed tables' rows before the load (the purge puts them back). A table with more than SAVE_LIMIT rows is
 * left out (a large organisation's index: its demo entries still go by their record). Returns the tables saved.
 */
export async function saveComputed(q: Queryable, orgId: string, info: TableInfo[]): Promise<string[]> {
  const saved: string[] = [];
  const byName = new Map(info.map((t) => [t.name, t]));
  const tooMany = async (table: string) => {
    const c = await q.one<{ n: number }>(`select count(*)::int as n from (select 1 from ${ident(table)} where org_id = $1 limit ${SAVE_LIMIT + 1}) x`, [orgId]);
    return (c?.n ?? 0) > SAVE_LIMIT;
  };
  for (const table of COMPUTED_TABLES) {
    if (!byName.has(table) || (await tooMany(table))) continue;
    await q.query(`insert into sm_demo_saved (org_id, tbl, row_id, data) select $1, ${lit(table)}, x.id, to_jsonb(x) from ${ident(table)} x where x.org_id = $1 on conflict (org_id, tbl, row_id) do nothing`, [orgId]);
    saved.push(table);
  }
  // the computed columns of real rows: only those columns, per row (COMPUTED_COLUMNS)
  for (const [table, want] of Object.entries(COMPUTED_COLUMNS)) {
    const t = byName.get(table);
    const cols = t && hasIdOrg(t) ? want.filter((c) => t.cols.has(c) && !t.cols.get(c)!.generated) : [];
    if (!cols.length || (await tooMany(table))) continue;
    await q.query(
      `insert into sm_demo_saved (org_id, tbl, row_id, data)
       select $1, ${lit(table + COLUMNS)}, x.id, jsonb_build_object(${cols.map((c) => `${lit(c)}, x.${ident(c)}`).join(", ")}) from ${ident(table)} x where x.org_id = $1
       on conflict (org_id, tbl, row_id) do nothing`,
      [orgId],
    );
    saved.push(table + COLUMNS);
  }
  return saved;
}

/**
 * Rows of the saved computed tables that were computed while demo data was there (not in the saved copy) join the
 * registry: they go like demo rows, with everything that names them (record events, history, links). Returns how many.
 */
export async function computedSince(q: Queryable, orgId: string, info: TableInfo[], saved: string[]): Promise<number> {
  let n = 0;
  const byName = new Map(info.map((t) => [t.name, t]));
  for (const table of saved) {
    // (computed columns of real rows: a row their saved copy lacks is real data made meanwhile, never demo data)
    const t = table.endsWith(COLUMNS) ? null : byName.get(table);
    if (!t || !hasIdOrg(t)) continue;
    const rows = await q.query(
      `insert into sm_demo_rows (org_id, row_id, tbl)
       select $1, x.id, ${lit(table)} from ${ident(table)} x
        where x.org_id = $1 and not exists (select 1 from sm_demo_saved s where s.org_id = $1 and s.tbl = ${lit(table)} and s.row_id = x.id)
       on conflict do nothing returning row_id`,
      [orgId],
    );
    n += rows.length;
  }
  return n;
}

/**
 * The engine's trail of rows removed outside the registry: their history, journal, links and attachments — rows Windows
 * apps hold, so the deletes are returned for the purge watermark (`notePurge`).
 */
async function dropTrail(q: Queryable, orgId: string, ids: string[]): Promise<Gone[]> {
  const list = pgArray(ids);
  return [
    await deleteHeld(q, `delete from sm_history where org_id = $1 and record_id = any($2::uuid[])`, [orgId, list]),
    await deleteHeld(q, `delete from sm_journal where org_id = $1 and record_id = any($2::uuid[])`, [orgId, list]),
    await deleteHeld(q, `delete from sm_attachments where org_id = $1 and record_id = any($2::uuid[])`, [orgId, list]),
    await deleteHeld(q, `delete from sm_links where org_id = $1 and (from_id = any($2::uuid[]) or to_id = any($2::uuid[]))`, [orgId, list]),
  ];
}

/**
 * Put the computed columns of real rows back (COMPUTED_COLUMNS, saved as `tag`): on the rows that were there before the
 * load, the saved columns the table still has — only rows whose values differ (no new revision for the rest). A row
 * made meanwhile keeps its values (real data; the next scheduled run recomputes them). Returns the rows put back.
 */
async function restoreColumns(q: Queryable, orgId: string, t: TableInfo | undefined, tag: string): Promise<number> {
  if (!t || !hasIdOrg(t)) return 0;
  const sample = await q.one<{ data: Record<string, unknown> }>(`select data from sm_demo_saved where org_id = $1 and tbl = ${lit(tag)} limit 1`, [orgId]);
  const cols = sample ? Object.keys(sample.data).filter((c) => t.cols.has(c) && !t.cols.get(c)!.generated && c !== "id" && c !== "org_id") : [];
  if (!cols.length) return 0;
  const rows = await q.query(
    `update ${ident(t.name)} x set ${cols.map((c) => `${ident(c)} = r.${ident(c)}`).join(", ")}
       from sm_demo_saved s, jsonb_populate_record(null::${ident(t.name)}, s.data) r
      where s.org_id = $1 and s.tbl = ${lit(tag)} and x.id = s.row_id and x.org_id = $1
        and (${cols.map((c) => `x.${ident(c)} is distinct from r.${ident(c)}`).join(" or ")})
      returning x.id`,
    [orgId],
  );
  return rows.length;
}

/**
 * Put the computed tables saved before the load back as they were. Returns rows restored per table. Rows computed
 * meanwhile leave: while the purge leaves tombstones (`tombstones`), those of tables Windows apps hold become tombstones
 * (their trail follows through the registry in the finish phase); otherwise they and their trail are deleted, and the
 * purge watermark rises if apps held any of them.
 */
export async function restoreComputed(q: Queryable, orgId: string, info: TableInfo[], saved: string[], opts: { tombstones?: boolean } = {}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byName = new Map(info.map((t) => [t.name, t]));
  const held: Gone[] = [];
  for (const table of saved) {
    if (table.endsWith(COLUMNS)) {
      const name = table.slice(0, -COLUMNS.length);
      const n = await restoreColumns(q, orgId, byName.get(name), table);
      if (n) out[name] = (out[name] ?? 0) + n;
      continue;
    }
    const t = byName.get(table);
    if (!t || !hasIdOrg(t)) continue;
    // computed while demo data was there (the job queue runs on during the purge too): recomputed from real data by the
    // next run. Its trail goes with it now; it joins the registry so that everything else that names it — the record
    // events queued about it, its entries in the search and AI index — goes in the finish phase like what names a demo row
    const since = `x.org_id = $1 and not exists (select 1 from sm_demo_saved s where s.org_id = $1 and s.tbl = ${lit(table)} and s.row_id = x.id)
         and not ${isDemo("x.id")}`;
    let ids: string[];
    if (opts.tombstones && t.synced && heldByApps(table)) {
      // Windows apps hold copies: a tombstone each (removed for good by finalizeDemo); the registry carries it on, and
      // its journal, history, attachments and links join it by reference in the finish phase (expandDerived)
      ids = (await q.query<{ id: string }>(`update ${ident(table)} x set ${tombstoneSet(t)} where ${since} returning x.id`, [orgId])).map((r) => String(r.id));
    } else {
      const gone = await q.query<{ id: string; rev?: string | number | null; deleted_at?: string | null }>(
        `delete from ${ident(table)} x where ${since} returning x.id${heldByApps(table) ? ", x.rev, x.deleted_at" : ""}`,
        [orgId],
      );
      ids = gone.map((r) => String(r.id));
      if (heldByApps(table) && gone.length) {
        const stones = gone.filter((r) => r.deleted_at != null).map((r) => Number(r.rev) || 0);
        held.push({ n: gone.length, stones: stones.length ? Math.max(...stones) : null, live: gone.some((r) => r.deleted_at == null) });
      }
      if (ids.length) held.push(...(await dropTrail(q, orgId, ids)));
    }
    if (ids.length) await q.query(`insert into sm_demo_rows (org_id, row_id, tbl) select $1, unnest($2::uuid[]), ${lit(table)} on conflict do nothing`, [orgId, pgArray(ids)]);
    // only the columns the saved copy has (all of a table's rows were saved at once, with one shape) and the table
    // still has: a column an upgrade added keeps its default or its value, one it dropped is ignored
    const sample = await q.one<{ data: Record<string, unknown> }>(`select data from sm_demo_saved where org_id = $1 and tbl = ${lit(table)} limit 1`, [orgId]);
    if (!sample) continue;
    const cols = [...t.cols.values()].filter((c) => !c.generated && c.name !== "rev" && Object.prototype.hasOwnProperty.call(sample.data, c.name)).map((c) => c.name);
    if (!cols.includes("id")) continue;
    const list = cols.map(ident).join(", ");
    const sets = cols.filter((c) => c !== "id").map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
    const same = cols.filter((c) => c !== "updated_at").map((c) => `(to_jsonb(x) -> ${lit(c)}) is not distinct from (s.data -> ${lit(c)})`).join(" and ");
    // rows still as saved are left alone (no new revision); changed or missing ones are written back
    const rows = await q.query(
      `insert into ${ident(table)} (${list})
       select ${cols.map((c) => `r.${ident(c)}`).join(", ")} from sm_demo_saved s, jsonb_populate_record(null::${ident(table)}, s.data) r
        where s.org_id = $1 and s.tbl = ${lit(table)}
          and not exists (select 1 from ${ident(table)} x where x.id = s.row_id and ${same})
       on conflict (id) do update set ${sets || "id = excluded.id"} returning id`,
      [orgId],
    );
    if (rows.length) out[table] = rows.length;
  }
  await notePurge(q, orgId, held);
  return out;
}


/** The trail tables: what happened to a record and who did it. On REAL records they are kept, whoever wrote them. */
export const TRAIL_TABLES: Record<string, { record: string; actor: string | null }> = {
  sm_history: { record: "record_id", actor: "actor" },
  sm_journal: { record: "record_id", actor: "author" },
  sm_audit: { record: "entity_id", actor: "user_id" },
  sm_security_events: { record: "", actor: "user_id" },
};

export interface TouchReport {
  table: string;
  rows: number;
  /**
   * why the rows were left as they are: something outside the demo scope changed them since, they are gone, archived,
   * or putting them back would collide with a live row (a unique key a real person took meanwhile: the live row stays)
   */
  reason: "changed_since" | "row_gone" | "archived" | "conflict";
}

/** A row the purge could not handle (it went on): the phase, the table, how many rows and why (content-free). */
export interface Skipped {
  phase: string;
  table: string;
  rows: number;
  reason: string;
}

const TOUCH_SKIP = new Set(["rev", "updated_at"]);
/** Platform bookkeeping and trail tables: what demo work changed in them is never put back (a job's state, a session…). */
const TOUCH_NEVER = new Set(["sm_jobs", "sm_sessions", "sm_scope_epochs", "sm_access_state", "sm_devices", "sm_outbox", "sm_auth_throttle", "sm_kv", ...Object.keys(TRAIL_TABLES)]);

let spSeq = 0;
/**
 * Run `fn` in a savepoint of the caller's transaction: a failure (a unique key, a check, a hook's refusal) rolls back
 * only what `fn` did, and is returned instead of thrown — the purge never stops on one row.
 */
export async function inSavepoint<T>(q: Queryable, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const name = `sm_purge_${++spSeq}`;
  await q.query(`savepoint ${name}`);
  try {
    const value = await fn();
    await q.query(`release savepoint ${name}`);
    return { ok: true, value };
  } catch (error) {
    await q.query(`rollback to savepoint ${name}`);
    return { ok: false, error };
  }
}

/** A short, content-free reason of a failure (the database's code, or the error's class). */
export function failReason(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (code === "23505") return "unique";
  if (code === "23514") return "check";
  if (code === "23503") return "foreign_key";
  if (code === "23502") return "not_null";
  if (typeof code === "string" && code) return `db:${code}`;
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") return `refused:${status}`;
  return "error";
}

/**
 * Put back the real rows demo work changed or deleted (`sm_demo_touched`, captured inside the demo scope only): a row
 * goes back to its image before demo work first touched it, column by column for the columns that image has and the
 * table still has — but only when the row is still exactly as demo work left it. A row something outside the demo
 * scope changed since (a real person, the platform's own jobs, an upgrade) is left alone and reported. Every table's
 * rows go back in one statement inside a savepoint; when that fails (a row would collide with a live one: a real person
 * added the same membership again), row by row, each in its own savepoint — the colliding row stays as it is (the live
 * row is kept) and is reported as a conflict. The rows put back are marked (`#reverted`). Returns the rows put back per
 * table, their ids and the report of the rest.
 */
export async function revertTouched(q: Queryable, orgId: string, info: TableInfo[]): Promise<{ restored: Record<string, number>; ids: string[]; left: TouchReport[] }> {
  const restored: Record<string, number> = {};
  const ids: string[] = [];
  const left = new Map<string, TouchReport>();
  const note = (table: string, reason: TouchReport["reason"], n: number) => {
    if (!n) return;
    const k = `${table}:${reason}`;
    const r = left.get(k) ?? { table, rows: 0, reason };
    r.rows += n;
    left.set(k, r);
  };
  const byName = new Map(info.map((t) => [t.name, t]));
  const tables = (await q.query<{ tbl: string }>(`select distinct tbl from sm_demo_touched where org_id = $1`, [orgId])).map((r) => r.tbl);
  for (const table of tables) {
    const t = byName.get(table);
    if (!t || !hasIdOrg(t) || SKIP.has(table) || TOUCH_NEVER.has(table)) continue;
    const cols = [...t.cols.values()].filter((c) => !c.generated && c.name !== "id" && c.name !== "org_id" && !TOUCH_SKIP.has(c.name)).map((c) => c.name);
    if (!cols.length) continue;
    // still as demo work left it: every column of the after-image the table still has is unchanged
    const asLeft = `not exists (select 1 from jsonb_each(s.after) e(k, v) where not (e.k = any(array['rev','updated_at'])) and to_jsonb(x) ? e.k and (to_jsonb(x) -> e.k) is distinct from e.v)`;
    const tsel = `from sm_demo_touched s where s.org_id = $1 and s.tbl = ${lit(table)}`;
    // updated rows: all at once, or one by one when a row collides with a live one
    let done: { id: string }[] = [];
    const all = await inSavepoint(q, () =>
      q.query<{ id: string }>(
        `update ${ident(table)} x set ${cols.map((c) => `${ident(c)} = case when s.before ? ${lit(c)} then r.${ident(c)} else x.${ident(c)} end`).join(", ")}
           from sm_demo_touched s, jsonb_populate_record(null::${ident(table)}, s.before) r
          where s.org_id = $1 and s.tbl = ${lit(table)} and s.after is not null and not s.conflict and x.id = s.row_id and x.org_id = $1 and ${asLeft}
          returning x.id`,
        [orgId],
      ),
    );
    if (all.ok) done = all.value;
    else {
      const candidates = await q.query<{ row_id: string }>(
        `select s.row_id from sm_demo_touched s join ${ident(table)} x on x.id = s.row_id and x.org_id = $1 where s.org_id = $1 and s.tbl = ${lit(table)} and s.after is not null and not s.conflict and ${asLeft}`,
        [orgId],
      );
      for (const c of candidates) {
        const one = await inSavepoint(q, () =>
          q.query<{ id: string }>(
            `update ${ident(table)} x set ${cols.map((col) => `${ident(col)} = case when s.before ? ${lit(col)} then r.${ident(col)} else x.${ident(col)} end`).join(", ")}
               from sm_demo_touched s, jsonb_populate_record(null::${ident(table)}, s.before) r
              where s.org_id = $1 and s.row_id = $2 and x.id = s.row_id and x.org_id = $1 returning x.id`,
            [orgId, c.row_id],
          ),
        );
        if (one.ok) done.push(...one.value);
        else note(table, "conflict", 1);
      }
    }
    const conflicted = left.get(`${table}:conflict`)?.rows ?? 0;
    const changed = await q.one<{ n: number }>(
      `select count(*)::int as n ${tsel} and s.after is not null and exists (select 1 from ${ident(table)} x where x.id = s.row_id and x.org_id = $1)
          and not (s.row_id = any($2::uuid[]))`,
      [orgId, pgArray(done.map((r) => String(r.id)))],
    );
    note(table, "changed_since", Math.max(0, (changed?.n ?? 0) - conflicted));
    const goneSince = await q.one<{ n: number }>(`select count(*)::int as n ${tsel} and s.after is not null and not exists (select 1 from ${ident(table)} x where x.id = s.row_id)`, [orgId]);
    note(table, "row_gone", goneSince?.n ?? 0);
    // deleted rows: written back with the columns their image has (the rest take their defaults), unless they exist
    // again — or collide with a live row (the live row stays)
    const deleted = await q.query<{ row_id: string; before: Record<string, unknown> }>(`select s.row_id, s.before ${tsel} and s.after is null and not s.conflict`, [orgId]);
    const arc = t.def && archivable(t.def) && byName.has(archiveTableOf(t.def)) ? archiveTableOf(t.def) : null;
    const back: string[] = [];
    for (const d of deleted) {
      if (await q.one(`select 1 from ${ident(table)} where id = $1`, [d.row_id])) {
        note(table, "changed_since", 1);
        continue;
      }
      if (arc && (await q.one(`select 1 from ${ident(arc)} where id = $1`, [d.row_id]))) {
        note(table, "archived", 1);
        continue;
      }
      const use = [...t.cols.values()].filter((c) => !c.generated && c.name !== "rev" && Object.prototype.hasOwnProperty.call(d.before, c.name)).map((c) => c.name);
      const put = await inSavepoint(q, () =>
        q.query(
          `insert into ${ident(table)} (${use.map(ident).join(", ")}) select ${use.map((c) => `r.${ident(c)}`).join(", ")} from jsonb_populate_record(null::${ident(table)}, $1::jsonb) r`,
          [JSON.stringify(d.before)],
        ),
      );
      if (put.ok) back.push(d.row_id);
      else note(table, "conflict", 1);
    }
    const conflicts = await q.one<{ n: number }>(`select count(*)::int as n ${tsel} and s.conflict`, [orgId]);
    note(table, "changed_since", conflicts?.n ?? 0);
    const n = done.length + back.length;
    if (n) restored[table] = n;
    ids.push(...done.map((r) => String(r.id)), ...back);
  }
  if (ids.length) {
    await q.query(`insert into sm_demo_saved (org_id, tbl, row_id, data) select $1, '${REVERTED}', unnest($2::uuid[]), '{}'::jsonb on conflict do nothing`, [orgId, pgArray(ids)]);
  }
  return { restored, ids, left: [...left.values()] };
}

/**
 * Trail rows on REAL records stay (docs/DEMO_FA.md): history, journal and audit lines demo work wrote about a record
 * that is not demo data leave the registry, whoever wrote them — a demo person's entry keeps its actor, shown as a
 * removed demo account. The one exception: the platform's own history lines (no actor) written inside the demo scope
 * about a row the purge has just put back, which describe a change that no longer exists. Sign-in records of the
 * pack's people stay too. Returns how many rows were kept.
 */
export async function keepRealTrail(q: Queryable, orgId: string, info: TableInfo[], afterRevert: boolean): Promise<number> {
  let kept = 0;
  const names = new Set(info.map((t) => t.name));
  for (const [table, c] of Object.entries(TRAIL_TABLES)) {
    if (!names.has(table)) continue;
    let cond: string;
    if (!c.record) cond = "true";
    else {
      const rec = `x.${ident(c.record)}`;
      const real = `(${rec} is null or not ${isDemo(rec)})`;
      // (false: the rows put back were settled when they were put back — the platform's lines of demo work stay demo)
      const putBack = `exists (select 1 from sm_demo_saved s where s.org_id = $1 and s.tbl = '${REVERTED}' and s.row_id = ${rec})`;
      if (table === "sm_history") cond = afterRevert ? `${real} and not (x.actor is null and ${putBack})` : `${real} and x.actor is not null`;
      // an audit line about no record stays only when a person wrote it (the platform's own lines of demo work go)
      else if (table === "sm_audit") cond = `((${rec} is not null and not ${isDemo(rec)}) or (${rec} is null and x.user_id is not null))`;
      else cond = real;
    }
    const rows = await q.query(
      `delete from sm_demo_rows d using ${ident(table)} x
        where d.org_id = $1 and d.tbl = ${lit(table)} and x.id = d.row_id and ${cond}
        returning d.row_id`,
      [orgId],
    );
    kept += rows.length;
  }
  return kept;
}

export interface Unattributed {
  table: string;
  rows: number;
}

/**
 * Rows the platform created outside the demo scope since the load that refer to demo rows (a reference field names
 * one): perhaps made because of demo data, perhaps real work. They are never removed by time or authorship alone —
 * only reported (the purge's report lists them; their references to demo rows are cleared like any real row's).
 */
export async function unattributedReport(q: Queryable, orgId: string, info: TableInfo[], since: string): Promise<Unattributed[]> {
  const out: Unattributed[] = [];
  for (const t of info) {
    if (SKIP.has(t.name) || !t.def || t.arc || !hasIdOrg(t) || !t.cols.has("created_at") || !t.cols.has("created_by")) continue;
    const conds = fieldRefs(t.def).filter((f) => !f.array && !f.custom).map((f) => names(t, f.name)).filter((c): c is string => !!c);
    if (!conds.length || !(await hasRows(q, t, orgId))) continue;
    const n = await q.one<{ n: number }>(
      `select count(*)::int as n from ${ident(t.name)} x
        where x.org_id = $1 and x.created_at > $2::timestamptz and x.created_by is null and not ${isDemo("x.id")} and (${conds.join(" or ")})`,
      [orgId, since],
    );
    if (n?.n) out.push({ table: t.name, rows: n.n });
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
