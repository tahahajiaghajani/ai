// What the purge does to what was built on top of the demo pack (docs/DEMO_FA.md «حذف کامل», release 1.1.5), by the
// catalogue of `refs.ts`:
//   clear (class C)   definitions that name the pack are kept and cleaned: conditions pruned by meaning, recipients,
//                     levels, actions, flow steps, forms, workflow drafts, defaults, filters; a definition left
//                     meaningless ends — switched off by its «فعال» flag or its own switch, retired or closed by its
//                     lifecycle (a published catalogue item is retired), else removed (refs.ts `deadEnd`) —, an
//                     allow-list, scope or «همه» audience criterion that would empty ends its row (never «everyone»,
//                     refs.ts `judgeRestrictions`); a published workflow whose current version can no longer route
//                     is retired when none of its managers is left — otherwise its steps wait for the managers and it
//                     is listed for review (versions are never rewritten). Each definition gets an audit line saying
//                     what went and how it ended (./review.ts).
//   reroute (class D) kept real records lose their references to removed rows through the engine, as the system: the
//                     engine's hooks route them again (assignment rules, default queues); open approvals asked of
//                     removed people are planned again; open workflow tasks of removed people end and their rounds
//                     look for people again (nobody found: journaled, the managers told); rounds of kept cases that
//                     already waited with reasons naming the pack's people, or with rules reaching removed rows, look
//                     for people again too (`waitingStep`); values stored under a removed field leave the records.
//   anchors (class E) the access anchors of kept rows that named a removed unit are derived again from their person's
//                     profile (the engine's derivation), else emptied — a domain moves up to the nearest kept domain.
// Every row is written in its own savepoint: one that cannot be written is reported and never stops the purge. Every
// step stops at its time budget and resumes from its cursor. With `dry`, nothing is written: the pre-purge preview runs
// the same plan.
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { pgArray } from "../../db";
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { formStepOf } from "@shared/process/graph";
import { ifNobodyOf } from "@shared/process/assignees";
import { loadSchema } from "../../engine/schema";
import { removeIn, updateIn } from "../../engine";
import { snapshotFor } from "../../access/subject";
import { anchorsFor } from "../../access/hooks";
import { rerunApprovalRulesIn } from "../sla/approvals";
import { reresolveRoundIn } from "../process/reresolve";
import { loadVersionInfo, lockCase, stepWaitKey, type CaseRow, type VersionInfo } from "../process/engine/store";
import {
  BENEFICIARY, ID_TEXT, PLATFORM_JSON_PRUNES, SNAPSHOT_TABLES,
  deadEnd, fieldRefs, judgeRestrictions, jsonHandler, pruneIds, pruneRules, restrictionColumns, routingFields, uuidsIn, type Gone, type FieldRef,
} from "./refs";
import { failReason, inSavepoint, type CleanedDefinition, type ReroutedBucket, type Skipped, type TableInfo } from "./purge";
import { isPurgedSql } from "./ledger";
import { reviewLine } from "./review";
import { rowWords } from "./samples";

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// a removed row: the registry's, or one an earlier purge removed (the purged-id ledger, ledger.ts): what that purge
// left naming it is cleaned and routed again like what names this pack (purge.ts `isDemo`)
const isDemo = (e: string) => `(exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = ${e}) or ${isPurgedSql(e)})`;
const isDemoText = (e: string) => `(case when ${e} ~* '^${UUID_RE}$' then ${isDemo(`(${e})::uuid`)} else false end)`;
const jsonNamesDemo = (expr: string) => `(${expr} is not null and exists (select 1 from regexp_matches(${expr}::text, ${lit(`(${UUID_RE})`)}, 'g') m where ${isDemo("m[1]::uuid")}))`;
const arrayNamesDemo = (expr: string) =>
  `exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(${expr}) = 'array' then ${expr} else '[]'::jsonb end) e(v) where ${isDemoText("e.v")})`;

/** Rows per statement of a step (a chunk of a table). */
const CHUNK = 200;

// ---------------------------------------------------------------------------------------------------------------
// What goes, by name (gathered while the removed rows still exist: the end of the expand phase)

export interface GoneNames {
  /** removed positions: keys and ids (lower case) */
  positions: string[];
  /** removed library fields (`field_def` names) */
  libraryFields: string[];
  /** fields removed from tables: the custom_field rows that go (a pack library field attached to a real table) */
  tableFields: { table: string; name: string }[];
  /** real positions the purge leaves without a holder (keys and ids): a workflow step on one can no longer route */
  emptiedPositions: string[];
  /** removed units → the nearest kept unit above them that is a domain (a kept row's domain moves up to it), or null */
  domainOf: Record<string, string | null>;
}

export const noNames = (): GoneNames => ({ positions: [], libraryFields: [], tableFields: [], emptiedPositions: [], domainOf: {} });

/** The names of what goes, read while the removed rows are still there. */
export async function planNames(q: Queryable, orgId: string): Promise<GoneNames> {
  const has = async (t: string) => !!(await q.one(`select 1 from information_schema.tables where table_schema = current_schema() and table_name = $1`, [t]));
  const out = noNames();
  if (await has("sm_positions")) {
    const pos = await q.query<{ id: string; key: string | null }>(`select x.id::text as id, x.key from sm_positions x where x.org_id = $1 and ${isDemo("x.id")}`, [orgId]);
    for (const p of pos) out.positions.push(p.id.toLowerCase(), ...(p.key ? [p.key] : []));
    if (await has("sm_position_holders")) {
      const emptied = await q.query<{ id: string; key: string | null }>(
        `select p.id::text as id, p.key from sm_positions p
          where p.org_id = $1 and p.deleted_at is null and not ${isDemo("p.id")}
            and exists (select 1 from sm_position_holders h where h.org_id = $1 and h.position_id = p.id and h.deleted_at is null and ${isDemo("h.id")})
            and not exists (select 1 from sm_position_holders h where h.org_id = $1 and h.position_id = p.id and h.deleted_at is null and not ${isDemo("h.id")})`,
        [orgId],
      );
      for (const p of emptied) out.emptiedPositions.push(p.id.toLowerCase(), ...(p.key ? [p.key] : []));
    }
  }
  if (await has("sm_field_defs")) out.libraryFields = (await q.query<{ name: string }>(`select x.name from sm_field_defs x where x.org_id = $1 and ${isDemo("x.id")}`, [orgId])).map((r) => r.name);
  if (await has("sm_custom_fields")) {
    out.tableFields = (await q.query<{ table_key: string; name: string }>(`select x.table_key, x.name from sm_custom_fields x where x.org_id = $1 and x.name like 'u\\_%' and ${isDemo("x.id")}`, [orgId])).map((r) => ({
      table: r.table_key,
      name: r.name,
    }));
  }
  if (await has("sm_org_units")) {
    const rows = await q.query<{ id: string; domain: string | null }>(
      `with recursive up as (
         select u.id as start, u.parent_id as at, 1 as n from sm_org_units u where u.org_id = $1 and ${isDemo("u.id")}
         union all
         select up.start, p.parent_id, up.n + 1 from up join sm_org_units p on p.id = up.at and p.org_id = $1
          where up.n < 60 and (${isDemo("p.id")} or not coalesce(p.is_domain, false))
       )
       select up.start::text as id, (select k.id::text from up u2 join sm_org_units k on k.id = u2.at where u2.start = up.start and not ${isDemo("k.id")} and coalesce(k.is_domain, false) order by u2.n limit 1) as domain
         from up group by up.start`,
      [orgId],
    );
    for (const r of rows) out.domainOf[r.id.toLowerCase()] = r.domain ? r.domain.toLowerCase() : null;
  }
  return out;
}

/** The oracle the handlers ask, for the rows of one chunk (one registry query for every id they name). */
export async function goneOracle(q: Queryable, orgId: string, values: unknown[], names: GoneNames, opts: { emptiedAsGone?: boolean } = {}): Promise<Gone> {
  const ids = new Set<string>();
  for (const v of values) for (const id of uuidsIn(v)) ids.add(id);
  const found = new Set<string>();
  const list = [...ids];
  for (let i = 0; i < list.length; i += 5000) {
    // the registry's rows, and the ids an earlier purge removed (the purged-id ledger)
    const rows = await q.query<{ id: string }>(
      `select row_id::text as id from sm_demo_rows where org_id = $1 and row_id = any($2::uuid[])
       union select row_id::text as id from sm_demo_purged where org_id = $1 and row_id = any($2::uuid[])`,
      [orgId, pgArray(list.slice(i, i + 5000))],
    );
    for (const r of rows) found.add(r.id.toLowerCase());
  }
  const positions = new Set([...names.positions, ...(opts.emptiedAsGone ? names.emptiedPositions : [])]);
  const library = new Set(names.libraryFields);
  const fields = new Set(names.tableFields.map((f) => `${f.table}.${f.name}`));
  return {
    id: (x) => found.has(x.toLowerCase()),
    position: (k) => positions.has(k) || positions.has(k.toLowerCase()),
    libraryField: (n) => library.has(n),
    tableField: (t, n) => fields.has(`${t}.${n}`),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers

/** The organisation's effective tables (custom and library fields included), by physical table. */
export async function effectiveDefs(q: Queryable, orgId: string, info: TableInfo[]): Promise<Map<string, TableDef>> {
  const schema = await loadSchema(q, orgId);
  const out = new Map<string, TableDef>();
  for (const t of info) {
    if (!t.def || t.arc) continue;
    const def = schema.def(t.def.key);
    if (def && !def.virtual) out.set(t.name, def);
  }
  return out;
}

const hasField = (def: TableDef, name: string) => def.fields.some((f) => f.name === name && !f.base);
const isJsonCol = (t: TableInfo, name: string) => t.cols.get(name)?.type === "jsonb";

/** The display of a row for the report: its number and display in words, never an id (./samples.ts). */
const labelOf = (q: Queryable, def: TableDef, row: Record<string, unknown>): Promise<string> => rowWords(q, def, row);

/** A soft «since» bound: a row that names a demo row was written after the demo row existed (a week for clock skew). */
const sinceCond = (t: TableInfo, since: string | null) => (since && t.cols.has("updated_at") ? ` and x.updated_at >= ${lit(since)}::timestamptz - interval '7 days'` : "");

/** Write `patch` to a row: through the engine as the system (its hooks run), else straight (a hook refused it). */
async function writeRow(
  tx: Tx, sys: Ctx, t: TableInfo, def: TableDef, id: string, patch: Record<string, unknown>, raw: Record<string, unknown>, skipped: Skipped[], phase: string,
): Promise<"engine" | "raw" | "skipped"> {
  const viaEngine = await inSavepoint(tx, () => updateIn(tx, sys, def.key, id, patch, { trusted: true, allowLocked: true }));
  if (viaEngine.ok) return "engine";
  const sets: string[] = [];
  const params: unknown[] = [id, sys.org.id];
  for (const [k, v] of Object.entries(raw)) {
    const col = t.cols.get(k);
    if (!col) continue;
    params.push(col.type === "jsonb" ? (v === null || v === undefined ? null : JSON.stringify(v)) : v);
    sets.push(`${ident(k)} = $${params.length}${col.type === "jsonb" ? "::jsonb" : col.type === "uuid" ? "::uuid" : ""}`);
  }
  if (!sets.length) {
    skipped.push({ phase, table: t.name, rows: 1, reason: failReason(viaEngine.error) });
    return "skipped";
  }
  const direct = await inSavepoint(tx, () => tx.query(`update ${ident(t.name)} set ${sets.join(", ")}, updated_at = now() where id = $1 and org_id = $2`, params));
  if (direct.ok) return "raw";
  skipped.push({ phase, table: t.name, rows: 1, reason: failReason(direct.error) });
  return "skipped";
}

// ---------------------------------------------------------------------------------------------------------------
// clear (class C): definitions

export interface TableCursor {
  /** the table being worked on (index into the step's table list) */
  i: number;
  /** the last row id done in it */
  after: string | null;
}

export const newTableCursor = (): TableCursor => ({ i: 0, after: null });

interface Work {
  t: TableInfo;
  def: TableDef;
}

/**
 * The json fields of a definition with a handler, and its restriction, audience and producer references (the lists and
 * the single references `judgeRestrictions` reads).
 */
function cWork(t: TableInfo, def: TableDef) {
  const json = def.fields.filter((f) => !f.base && (f.type === "json" || f.type === "conditions") && isJsonCol(t, f.name)).map((f) => ({ f, h: jsonHandler(def.key, f) })).filter((x) => !!x.h) as { f: FieldDef; h: NonNullable<ReturnType<typeof jsonHandler>> }[];
  const rc = restrictionColumns(def.key);
  const lists = rc.lists.filter((n) => t.cols.has(n));
  const scalars = rc.scalars.filter((n) => t.cols.get(n)?.type === "uuid");
  const idText = def.key === "field_def" && t.cols.has("default_value") ? ["default_value"] : [];
  return { json, lists, scalars, idText };
}

/** Name-based references (library fields, position keys): a definition that may name them by name, not by id. */
const NAMED = new Set(["process", "form", "custom_field"]);

/**
 * Records (not definitions) whose json the clear phase may prune: a case's data, an incident's timeline, a request's
 * answers, a run's log. They lose the removed ids like any kept record — counted with the records routed again, no
 * review line, never switched off.
 */
const RECORD_TABLES = new Set([
  "process_case", "process_submission", "process_draft", "process_task", "survey_response", "incident_period_review", "customer_notice", "change_gate",
  "exercise", "status_report", "slm_review", "account_review", "branch_attestation", "bia", "asset", "ci", "ci_baseline", "alert_group", "cmdb_import_run",
  "import_set", "kb_article", "kb_gap", "kb_version", "project", "service_design_package", "va_conversation", "va_message", "ai_agent_run", "ai_skill_run",
  "dev_event", "event", "sec_observable", "discovery_state", "slm_xla_score", "service_score_fact", "analytics_score", "license_position", "ci_rel_suggestion",
  "ci_impact_sim", "request_cart_line", "grc_csf_profile",
]);
export const isRecordTable = (def: TableDef): boolean => def.extends === "task" || RECORD_TABLES.has(def.key);

/** Remove a definition that lost its meaning and can be neither switched off nor closed by its lifecycle (`deadEnd`). */
async function removeRow(tx: Tx, sys: Ctx, t: TableInfo, def: TableDef, id: string, skipped: Skipped[]): Promise<boolean> {
  const viaEngine = await inSavepoint(tx, () => removeIn(tx, sys, def.key, id, { trusted: true, allowLocked: true }));
  if (viaEngine.ok) return true;
  const direct = await inSavepoint(tx, () => tx.query(`update ${ident(t.name)} set deleted_at = now(), updated_at = now() where id = $1 and org_id = $2`, [id, sys.org.id]));
  if (!direct.ok) skipped.push({ phase: "clear", table: t.name, rows: 1, reason: failReason(direct.error) });
  return direct.ok;
}

export interface StepState {
  until: number;
  since: string | null;
  dry: boolean;
  cleaned: CleanedDefinition[];
  rerouted: Map<string, ReroutedBucket>;
  skipped: Skipped[];
}

/**
 * Clean the definitions of the organisation that name removed rows (see the header), table by table until the budget:
 * returns whether every table is done (`cur` moves on).
 */
export async function clearStep(tx: Tx, sys: Ctx, orgId: string, info: TableInfo[], names: GoneNames, cur: TableCursor, st: StepState): Promise<boolean> {
  const defs = await effectiveDefs(tx, orgId, info);
  const work: (Work & ReturnType<typeof cWork>)[] = [];
  for (const t of info) {
    const def = defs.get(t.name);
    if (!def || SNAPSHOT_TABLES.has(def.key) || !t.cols.has("deleted_at")) continue;
    const w = cWork(t, def);
    if (w.json.length || w.lists.length || w.scalars.length || w.idText.length) work.push({ t, def, ...w });
  }
  const namePatterns = [...names.libraryFields, ...names.positions.filter((p) => !/^[0-9a-f-]{36}$/i.test(p)), ...names.tableFields.map((f) => f.name)].map((n) => `%"${n.replace(/[%_\\]/g, (c) => `\\${c}`)}"%`);
  for (; cur.i < work.length; cur.i++, cur.after = null) {
    const { t, def, json, lists, scalars, idText } = work[cur.i];
    for (;;) {
      if (Date.now() > st.until) return false;
      const conds: string[] = [];
      const params: unknown[] = [orgId];
      for (const { f } of json) conds.push(jsonNamesDemo(`x.${ident(f.name)}`));
      for (const n of scalars) conds.push(`(x.${ident(n)} is not null and ${isDemo(`x.${ident(n)}`)})`);
      for (const n of lists) conds.push(t.cols.get(n)?.type === "jsonb" ? arrayNamesDemo(`x.${ident(n)}`) : `(x.${ident(n)} is not null and ${isDemo(`x.${ident(n)}`)})`);
      for (const n of idText) conds.push(`(x.${ident(n)} is not null and ${isDemoText(`trim(x.${ident(n)})`)})`);
      if (NAMED.has(def.key) && namePatterns.length) {
        params.push(pgArray(namePatterns));
        for (const { f } of json) conds.push(`x.${ident(f.name)}::text like any($${params.length}::text[])`);
      }
      if (!conds.length) break;
      let after = "";
      if (cur.after) {
        params.push(cur.after);
        after = ` and x.id > $${params.length}::uuid`;
      }
      const rows = await tx.query<Record<string, any>>(
        `select x.* from ${ident(t.name)} x where x.org_id = $1 and x.deleted_at is null and not ${isDemo("x.id")}${after}${sinceCond(t, st.since)} and (${conds.join(" or ")}) order by x.id limit ${CHUNK}`,
        params,
      );
      if (!rows.length) break;
      const gone = await goneOracle(tx, orgId, rows, names);
      for (const row of rows) {
        cur.after = String(row.id);
        const patch: Record<string, unknown> = {};
        const notes: string[] = [];
        let dead = false;
        for (const { f, h } of json) {
          const r = h(row[f.name], { gone, row, table: def.key });
          if (!r.changed) continue;
          patch[f.name] = r.value;
          if (r.dead) dead = true;
          if (r.note) notes.push(r.note);
        }
        // allow-lists, scopes, audience criteria and producers: never widened (an audience's condition as just pruned)
        const restricted = judgeRestrictions(def.key, { ...row, ...patch }, (x) => gone.id(x), (n) => t.cols.has(n));
        Object.assign(patch, restricted.patch);
        if (restricted.dead) dead = true;
        notes.push(...restricted.notes);
        for (const n of idText) {
          if (typeof row[n] === "string" && uuidsIn(row[n]).some((x) => gone.id(x))) {
            patch[n] = null;
            notes.push("مقدار پیش‌فرض نمایشی پاک شد");
          }
        }
        if (!Object.keys(patch).length && !dead) continue;
        if (isRecordTable(def)) {
          // a record's own values lose the ids: counted with the records routed again (no review line, never off)
          if (!Object.keys(patch).length) continue;
          const bucket = st.rerouted.get(def.key) ?? { table: def.key, label: def.plural, rows: 0, routed: 0, samples: [] };
          bucket.rows++;
          if (bucket.samples.length < 3) bucket.samples.push(await labelOf(tx, def, row));
          st.rerouted.set(def.key, bucket);
          if (!st.dry) await writeRow(tx, sys, t, def, String(row.id), patch, patch, st.skipped, "clear");
          continue;
        }
        // a flow whose graph changed has an unpublished draft now
        if (def.key === "flow" && "graph" in patch && hasField(def, "dirty") && row.version_id) patch.dirty = true;
        // how a definition left meaningless ends: its flag, its lifecycle (a transition through the engine), or removal
        const end = dead ? deadEnd(def, row) : null;
        if (end) Object.assign(patch, end.patch);
        if (end?.note) notes.push(end.note);
        const entry: CleanedDefinition = {
          table: def.key, label: def.label, id: String(row.id), name: await labelOf(tx, def, row), what: [...new Set(notes)].join("؛ ").slice(0, 400),
          deactivated: end?.how === "off",
          ...(end?.how === "retire" ? { retired: true } : {}),
          ...(end?.how === "state" ? { ended: end.state } : {}),
          ...(end?.how === "remove" ? { removed: true } : {}),
        };
        st.cleaned.push(entry);
        if (st.dry) continue;
        const how = await writeRow(tx, sys, t, def, String(row.id), patch, patch, st.skipped, "clear");
        if (how === "skipped") continue;
        if (end?.how === "remove") await removeRow(tx, sys, t, def, String(row.id), st.skipped);
        await reviewLine(tx, orgId, entry);
      }
      if (rows.length < CHUNK) break;
    }
  }
  return true;
}

/**
 * Published workflows whose current version can no longer route: a step (not the start) whose rules and fallbacks all
 * name removed rows or positions the purge leaves without a holder. The version itself is never rewritten.
 *   · a step that waits while a live manager can act on it keeps the workflow published, listed for review: the 1.1.5
 *     waiting machinery covers it — a new case's journal says why, its managers are told and can give the step to
 *     someone or find its people again, and a holder added later gets it (../process/reresolve);
 *   · a step nobody could ever act on — it waits, or goes to the managers, and none of its managers is left — retires
 *     the workflow (no new case stalls; open cases finish on their version).
 */
export async function retireStuck(tx: Tx, sys: Ctx, orgId: string, names: GoneNames, st: StepState): Promise<void> {
  const rows = await tx.query<{ id: string; name: string; key: string; graph: unknown; managers: unknown; manager_groups: unknown }>(
    `select p.id::text as id, p.name, p.key, v.graph, v.managers, v.manager_groups from sm_processes p join sm_process_versions v on v.id = p.current_version_id and v.org_id = p.org_id
      where p.org_id = $1 and p.deleted_at is null and p.status = 'published' and not ${isDemo("p.id")} and not ${isDemo("v.id")}`,
    [orgId],
  );
  for (const p of rows) {
    const gone = await goneOracle(tx, orgId, [p.graph, p.managers, p.manager_groups], names, { emptiedAsGone: true });
    const managersLive = [...(Array.isArray(p.managers) ? p.managers : []), ...(Array.isArray(p.manager_groups) ? p.manager_groups : [])];
    const managersOk = !managersLive.length || managersLive.some((x) => typeof x === "string" && !gone.id(x));
    const stuck: string[] = [];
    const waits: string[] = [];
    const nodes = Array.isArray((p.graph as { nodes?: unknown[] })?.nodes) ? ((p.graph as { nodes: { id: string; type: string; label?: string; config?: unknown }[] }).nodes) : [];
    for (const n of nodes) {
      if (n.type !== "form_step") continue;
      const step = formStepOf(n.config);
      if (step.start) continue;
      const dead = (rules: unknown[] | undefined) => !!rules?.length && !pruneRules(rules, gone).rules.length;
      const noRules = !step.assignees.length;
      const rulesDead = noRules || dead(step.assignees);
      const fallbackDead = !step.fallback?.length || dead(step.fallback);
      const nobody = ifNobodyOf(step);
      if (noRules || !rulesDead || !fallbackDead) continue;
      if ((nobody === "wait" || nobody === "managers") && !managersOk) stuck.push(String(n.label || n.id));
      else if (nobody === "wait") waits.push(String(n.label || n.id));
    }
    if (!stuck.length && !waits.length) continue;
    const retire = stuck.length > 0;
    const steps = (xs: string[]) => `مرحله‌های «${xs.join("»، «")}» دیگر انجام‌دهنده‌ای ندارند (قاعده‌هایشان فقط به دادهٔ نمایشی می‌رسید)`;
    const entry: CleanedDefinition = {
      table: "process", label: "گردش‌کار", id: p.id, name: p.name, deactivated: false, ...(retire ? { retired: true } : {}),
      what: (retire
        ? `${steps(stuck)} و هیچ‌یک از مسئولانش هم نمانده است`
        : `${steps(waits)}؛ گردش‌کار منتشر می‌ماند: پرونده‌های تازه آن‌جا منتظر می‌مانند و مسئولان گردش‌کار باخبر می‌شوند تا کسی را برگزینند یا دارنده‌ای بیفزایند`
      ).slice(0, 400),
    };
    st.cleaned.push(entry);
    if (st.dry) continue;
    if (!retire) {
      await reviewLine(tx, orgId, entry);
      continue;
    }
    const r = await inSavepoint(tx, () => updateIn(tx, sys, "process", p.id, { status: "retired" }, { trusted: true, keepVersion: true }));
    if (!r.ok) {
      const direct = await inSavepoint(tx, () => tx.query(`update sm_processes set status = 'retired', updated_at = now() where id = $1 and org_id = $2`, [p.id, orgId]));
      if (!direct.ok) {
        st.skipped.push({ phase: "clear", table: "sm_processes", rows: 1, reason: failReason(direct.error) });
        continue;
      }
    }
    await reviewLine(tx, orgId, entry);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// reroute (class D): kept records

/** The pointer references of a table the reroute clears (custom fields included), and how to find them in SQL. */
function pointerRefs(t: TableInfo, def: TableDef): (FieldRef & { cond: string })[] {
  const out: (FieldRef & { cond: string })[] = [];
  for (const r of fieldRefs(def)) {
    if (r.role !== "pointer" && r.role !== "approval") continue;
    let cond: string | null = null;
    if (r.custom) {
      if (!t.cols.has("custom")) continue;
      cond = r.array ? arrayNamesDemo(`(x.custom -> ${lit(r.name)})`) : isDemoText(`(x.custom ->> ${lit(r.name)})`);
    } else {
      const c = t.cols.get(r.name);
      if (!c) continue;
      if (r.array && c.type === "jsonb") cond = arrayNamesDemo(`x.${ident(r.name)}`);
      else if (!r.array && c.type === "uuid") cond = `(x.${ident(r.name)} is not null and ${isDemo(`x.${ident(r.name)}`)})`;
    }
    if (cond) out.push({ ...r, cond });
  }
  // text columns that hold the id of what a kept record came from, made or shows (`ID_TEXT` pointers)
  for (const [name, role] of Object.entries(ID_TEXT[def.key] ?? {})) {
    const c = t.cols.get(name);
    if (role !== "pointer" || !c || (c.type !== "text" && c.type !== "character varying")) continue;
    out.push({ name, custom: false, array: false, target: null, role, type: "string", cond: `(x.${ident(name)} is not null and ${isDemoText(`trim(x.${ident(name)})`)})` });
  }
  return out;
}

const OPEN_APPROVAL = new Set(["requested", "waiting"]);

/**
 * The rounds of kept workflow cases whose open task of a removed person just ended: each runs its rules again as the
 * organisation's re-resolution does (../process/reresolve), outside the demo scope — whoever is found gets the step,
 * journaled; nobody found, the journal says why, the case waits and its managers are told, as at an opening without
 * people (the round has a task now, so the organisation's later re-resolution would leave it to the managers).
 */
async function rerouteRounds(tx: Tx, sys: Ctx, orgId: string, rounds: Map<string, Set<string>>, st: StepState): Promise<void> {
  for (const [caseId, steps] of rounds) {
    const r = await inSavepoint(tx, async () => {
      let kase = await lockCase(tx, orgId, caseId);
      const version = kase ? await loadVersionInfo(tx, orgId, kase.version_id) : null;
      if (!kase || !version) return;
      for (const step of steps) {
        const done = await reresolveRoundIn(tx, sys, kase, version, step, { by: null, lost: true });
        if (done) kase = (await lockCase(tx, orgId, caseId)) ?? kase;
      }
    });
    if (!r.ok) st.skipped.push({ phase: "reroute", table: "sm_process_cases", rows: 1, reason: failReason(r.error) });
  }
}

/**
 * What names the pack's people in a waiting round: a resolver's reason («۲ نفر از دارندگان «…» حساب نمایشی‌اند…»,
 * ../positions/resolve.ts) or the opening's line on whom the managers' notice could not reach («… حساب نمایشی است؛
 * اعلان به او نرسید», ../process/engine/readers.ts).
 */
const DEMO_REASON = "حساب نمایشی";

/**
 * Kept workflow cases that already waited for people (e2e of 1.1.5, the owner's case C): a round with nobody to act —
 * no task ever opened in it, the case not paused — whose reasons or line name the pack's people («۲ نفر از دارندگان
 * «…» حساب نمایشی‌اند…؛ … با یک حساب نمایشی آغاز کنید»; a pack manager the opening's notice could not reach) or whose
 * rules reach a removed row (a pack position, group, unit or person, a position the purge leaves without a holder).
 * Those reasons stop being true with the pack: the round runs its rules again as the organisation's re-resolution does
 * (../process/reresolve, as the system, outside the demo scope) — whoever is found now gets the step, journaled; else
 * the round keeps the reasons as they are now and, telling nobody, its opening's line (whom the notice reached then),
 * unless that line names the pack's people: then the line of a re-resolution that tells nobody. After every table (the
 * pack's holders, members and profiles are gone), case by case from `cur.after`, until the budget; counted with the
 * records routed again. Returns whether every case is done.
 */
async function waitingStep(tx: Tx, sys: Ctx, orgId: string, names: GoneNames, def: TableDef | undefined, cur: TableCursor, st: StepState): Promise<boolean> {
  const versions = new Map<string, VersionInfo | null>();
  const versionOf = async (id: string | null) => {
    if (!id) return null;
    if (!versions.has(id)) versions.set(id, await loadVersionInfo(tx, orgId, id));
    return versions.get(id) ?? null;
  };
  for (;;) {
    if (Date.now() > st.until) return false;
    const cases = await tx.query<CaseRow>(
      `select c.* from sm_process_cases c
        where c.org_id = $1 and c.deleted_at is null and c.state = 'waiting' and c.paused_at is null and not ${isDemo("c.id")}${cur.after ? " and c.id > $2::uuid" : ""}
        order by c.id limit ${CHUNK}`,
      cur.after ? [orgId, cur.after] : [orgId],
    );
    if (!cases.length) return true;
    // the rounds without any task (a round a manager handled is theirs), and their waits
    const had = new Set(
      (await tx.query<{ c: string; s: string; r: number }>(`select case_id::text as c, step_key as s, round as r from sm_process_tasks where org_id = $1 and case_id = any($2::uuid[]) and deleted_at is null`, [orgId, pgArray(cases.map((c) => c.id))]))
        .map((t) => `${t.c}:${t.s}:${Number(t.r)}`),
    );
    const rounds = cases.flatMap((c) => Object.entries(c.open_rounds ?? {}).map(([node, n]) => ({ c, node, key: stepWaitKey(c.id, node, Number(n)) })).filter((x) => !had.has(x.key.slice("pstep:".length))));
    const waits = new Map<string, Record<string, unknown>>();
    if (rounds.length) {
      const rows = await tx.query<{ key: string; data: Record<string, unknown> | null }>(`select key, data from sm_flow_waits where org_id = $1 and key = any($2::text[]) and result is null`, [orgId, pgArray(rounds.map((x) => x.key))]);
      for (const w of rows) waits.set(w.key, w.data ?? {});
    }
    // the step's rules, fallbacks and (when it goes to them) the case's managers: one registry query for the chunk
    const steps = new Map<string, { rules: unknown[]; fallback: unknown[]; managers: unknown[] }>();
    for (const x of rounds) {
      const node = (await versionOf(x.c.version_id))?.graph.nodes.find((n) => n.id === x.node && n.type === "form_step");
      if (!node || !waits.has(x.key)) continue;
      const step = formStepOf(node.config);
      steps.set(x.key, { rules: step.assignees, fallback: step.fallback ?? [], managers: ifNobodyOf(step) === "managers" ? [...(x.c.managers ?? []), ...(x.c.manager_groups ?? [])] : [] });
    }
    const gone = await goneOracle(tx, orgId, [...steps.values()], names, { emptiedAsGone: true });
    const due = new Map<string, string[]>();
    for (const x of rounds) {
      const s = steps.get(x.key);
      const was = waits.get(x.key);
      if (!s || !was || was.reason === "too_many" || (was.reason !== "nobody" && Array.isArray(was.candidates))) continue;
      const named = JSON.stringify([was.notes ?? [], was.message ?? ""]).includes(DEMO_REASON);
      const reach = pruneRules(s.rules, gone).changed || pruneRules(s.fallback, gone).changed || s.managers.some((m) => typeof m === "string" && gone.id(m));
      if (named || reach) due.set(x.c.id, [...(due.get(x.c.id) ?? []), x.node]);
    }
    for (const c of cases) {
      if (Date.now() > st.until) return false;
      cur.after = c.id;
      const nodes = due.get(c.id);
      if (!nodes) continue;
      const bucket = st.rerouted.get("process_case") ?? { table: "process_case", label: def?.plural ?? "پرونده‌های گردش‌کار", rows: 0, routed: 0, samples: [] };
      bucket.rows++;
      bucket.routed++;
      if (bucket.samples.length < 3 && def) bucket.samples.push(await labelOf(tx, def, c as unknown as Record<string, unknown>));
      st.rerouted.set("process_case", bucket);
      if (st.dry) continue;
      const r = await inSavepoint(tx, async () => {
        let kase = await lockCase(tx, orgId, c.id);
        const version = kase ? await versionOf(kase.version_id) : null;
        if (!kase || !version) return;
        for (const node of nodes) {
          const done = await reresolveRoundIn(tx, sys, kase, version, node, { by: null, onlyNobody: true });
          if (done?.people.length) kase = (await lockCase(tx, orgId, c.id)) ?? kase;
          // nobody now: the round kept its opening's line, the managers told nothing new — one naming the pack's
          // people the notice could not reach (gone now) gives way to the line it returned («… مرحله منتظر مسئولان
          // گردش‌کار می‌ماند.»)
          else if (done?.status === "nobody" && done.message) {
            await tx.query(
              `update sm_flow_waits set data = data || jsonb_build_object('message', $3::text)
                where org_id = $1 and key = $2 and result is null and strpos(coalesce(data ->> 'message', ''), $4::text) > 0`,
              [orgId, stepWaitKey(c.id, node, done.round), done.message, DEMO_REASON],
            );
          }
        }
      });
      if (!r.ok) st.skipped.push({ phase: "reroute", table: "sm_process_cases", rows: 1, reason: failReason(r.error) });
    }
    if (cases.length < CHUNK) return true;
  }
}

/**
 * Clear the references of kept rows to removed rows, through the engine (see the header), table by table until the
 * budget: returns whether every table is done (`cur` moves on). Archive copies, values of removed fields and the
 * platform's settings are cleaned straight.
 */
export async function rerouteStep(tx: Tx, sys: Ctx, orgId: string, info: TableInfo[], names: GoneNames, cur: TableCursor, st: StepState): Promise<boolean> {
  const defs = await effectiveDefs(tx, orgId, info);
  const byKey = new Map([...defs.entries()].map(([, d]) => [d.key, d]));
  const work: { t: TableInfo; def: TableDef; refs: (FieldRef & { cond: string })[] }[] = [];
  for (const t of info) {
    const def = defs.get(t.name);
    if (!def || SNAPSHOT_TABLES.has(def.key)) continue;
    const refs = pointerRefs(t, def);
    if (refs.length) work.push({ t, def, refs });
  }
  for (; cur.i < work.length; cur.i++, cur.after = null) {
    const { t, def, refs } = work[cur.i];
    const routing = routingFields(def);
    for (;;) {
      if (Date.now() > st.until) return false;
      const params: unknown[] = [orgId];
      let after = "";
      if (cur.after) {
        params.push(cur.after);
        after = ` and x.id > $2::uuid`;
      }
      const live = t.cols.has("deleted_at") ? " and x.deleted_at is null" : "";
      const rows = await tx.query<Record<string, any>>(
        `select x.* from ${ident(t.name)} x where x.org_id = $1${live} and not ${isDemo("x.id")}${after}${sinceCond(t, st.since)} and (${refs.map((r) => r.cond).join(" or ")}) order by x.id limit ${CHUNK}`,
        params,
      );
      if (!rows.length) break;
      const gone = await goneOracle(tx, orgId, rows.map((r) => [refs.map((f) => (f.custom ? r.custom?.[f.name] : r[f.name]))]), names);
      const replan = new Map<string, { table: string; id: string }>();
      // the workflow rounds whose open task of a removed person ended, by case
      const rounds = new Map<string, Set<string>>();
      for (const row of rows) {
        cur.after = String(row.id);
        const patch: Record<string, unknown> = {};
        const raw: Record<string, unknown> = {};
        let custom: Record<string, unknown> | null = null;
        for (const r of refs) {
          const v = r.custom ? row.custom?.[r.name] : row[r.name];
          let next: unknown = v;
          if (r.array) {
            const list = Array.isArray(v) ? v : [];
            const kept = list.filter((x) => !(typeof x === "string" && gone.id(x)));
            if (kept.length === list.length) continue;
            next = kept;
          } else {
            if (!(typeof v === "string" && gone.id(v.trim().toLowerCase()))) continue;
            next = null;
          }
          patch[r.name] = next;
          if (r.custom) {
            const c: Record<string, unknown> = custom ?? { ...(row.custom ?? {}) };
            if (next === null) delete c[r.name];
            else c[r.name] = next;
            custom = c;
          } else raw[r.name] = next;
        }
        if (!Object.keys(patch).length) continue;
        if (custom) raw.custom = custom;
        // an open workflow task of a removed person ends (nobody can act on it); its round looks for people again below
        if (def.key === "process_task" && row.status === "open" && ("assigned_to" in patch || "delegated_from" in patch)) {
          patch.status = raw.status = "not_needed";
          patch.closed_at = raw.closed_at = new Date().toISOString();
          if (row.case_id && row.step_key) rounds.set(String(row.case_id), (rounds.get(String(row.case_id)) ?? new Set()).add(String(row.step_key)));
        }
        // an open approval asked of a removed person: its record's rounds are planned again
        if (def.key === "approval" && OPEN_APPROVAL.has(String(row.state)) && ("approver_id" in patch || "group_id" in patch || "delegated_from" in patch)) {
          replan.set(`${row.table_key}:${row.record_id}`, { table: String(row.table_key), id: String(row.record_id) });
        }
        const bucket = st.rerouted.get(def.key) ?? { table: def.key, label: def.plural, rows: 0, routed: 0, samples: [] };
        bucket.rows++;
        if (Object.keys(patch).some((k) => routing.has(k))) bucket.routed++;
        if (bucket.samples.length < 3) bucket.samples.push(await labelOf(tx, def, row));
        st.rerouted.set(def.key, bucket);
        if (st.dry) continue;
        if (def.key === "approval" && replan.has(`${row.table_key}:${row.record_id}`)) continue;
        await writeRow(tx, sys, t, def, String(row.id), patch, raw, st.skipped, "reroute");
      }
      if (!st.dry)
        for (const rec of replan.values()) {
          if (!byKey.has(rec.table)) continue;
          const r = await inSavepoint(tx, () => rerunApprovalRulesIn(tx, sys, rec.table, rec.id, { comment: "تأییدکنندهٔ پیشین از سامانه حذف شد (دادهٔ نمایشی)؛ تأیید دوباره خواسته شد" }));
          if (!r.ok) st.skipped.push({ phase: "reroute", table: "sm_approvals", rows: 1, reason: failReason(r.error) });
          // the withdrawn rows keep no reference to the removed person
          await tx.query(
            `update sm_approvals x set approver_id = case when ${isDemo("x.approver_id")} then null else x.approver_id end,
                    group_id = case when ${isDemo("x.group_id")} then null else x.group_id end,
                    delegated_from = case when ${isDemo("x.delegated_from")} then null else x.delegated_from end, updated_at = now()
              where x.org_id = $1 and x.table_key = $2 and x.record_id = $3
                and ((x.approver_id is not null and ${isDemo("x.approver_id")}) or (x.group_id is not null and ${isDemo("x.group_id")}) or (x.delegated_from is not null and ${isDemo("x.delegated_from")}))`,
            [orgId, rec.table, rec.id],
          );
        }
      if (!st.dry) await rerouteRounds(tx, sys, orgId, rounds, st);
      if (rows.length < CHUNK) break;
    }
  }
  // after every table: the rounds of kept cases that already waited for the pack's people (the cursor's next slot)
  if (cur.i === work.length) {
    if (!(await waitingStep(tx, sys, orgId, names, byKey.get("process_case"), cur, st))) return false;
    cur.i++;
    cur.after = null;
  }
  if (st.dry) return true;
  // values kept under a field that left its table (a pack library field attached to a real table)
  for (const f of names.tableFields) {
    const def = byKey.get(f.table);
    if (!def) continue;
    await tx.query(`update ${ident(def.table)} x set custom = x.custom - $2, updated_at = now() where x.org_id = $1 and x.custom ? $2 and not ${isDemo("x.id")}`, [orgId, f.name]);
  }
  // archive copies of closed records: their references go too (nobody routes an archived record)
  for (const t of info) {
    if (!t.arc || !t.def || !t.cols.has("org_id")) continue;
    const def = byKey.get(t.def.key) ?? t.def;
    for (const r of fieldRefs(def)) {
      if (r.custom || (r.role !== "pointer" && r.role !== "approval")) continue;
      const c = t.cols.get(r.name);
      if (!c) continue;
      if (c.type === "uuid") await tx.query(`update ${ident(t.name)} x set ${ident(r.name)} = null where x.org_id = $1 and x.${ident(r.name)} is not null and ${isDemo(`x.${ident(r.name)}`)}`, [orgId]);
      else if (c.type === "jsonb" && r.array)
        await tx.query(
          `update ${ident(t.name)} x set ${ident(r.name)} = (select coalesce(jsonb_agg(e.v), '[]'::jsonb) from jsonb_array_elements(x.${ident(r.name)}) e(v) where not coalesce(${isDemoText("(e.v #>> '{}')")}, false))
            where x.org_id = $1 and jsonb_typeof(x.${ident(r.name)}) = 'array' and ${arrayNamesDemo(`x.${ident(r.name)}`)}`,
          [orgId],
        );
    }
  }
  // the platform's settings that name a removed row lose the ids (the organisation's own row is keyed by its id)
  for (const [table, cols] of Object.entries(PLATFORM_JSON_PRUNES)) {
    const t = info.find((x) => x.name === table);
    const own = table === "sm_orgs" ? "id" : "org_id";
    if (!t || !t.cols.has(own)) continue;
    for (const col of cols) {
      if (!isJsonCol(t, col)) continue;
      const key = t.cols.has("id") ? "id" : null;
      const rows = await tx.query<Record<string, any>>(`select ${key ? "x.id, " : "ctid::text as k, "}x.${ident(col)} as v from ${ident(table)} x where x.${own} = $1 and ${jsonNamesDemo(`x.${ident(col)}`)}`, [orgId]);
      if (!rows.length) continue;
      const gone = await goneOracle(tx, orgId, rows.map((r) => r.v), names);
      for (const r of rows) {
        const p = pruneIds(r.v, gone);
        if (!p.changed) continue;
        const res = await inSavepoint(tx, () =>
          key
            ? tx.query(`update ${ident(table)} set ${ident(col)} = $3::jsonb where ${own} = $1 and id = $2`, [orgId, r.id, JSON.stringify(p.value)])
            : tx.query(`update ${ident(table)} set ${ident(col)} = $3::jsonb where ${own} = $1 and ctid = $2::tid`, [orgId, r.k, JSON.stringify(p.value)]),
        );
        if (!res.ok) st.skipped.push({ phase: "reroute", table, rows: 1, reason: failReason(res.error) });
      }
    }
  }
  // the organisation's real people's own settings (saved filters, pinned records, recent items) lose the ids
  const people = await tx.query<{ id: string; v: unknown }>(
    `select u.id::text as id, u.prefs as v from sm_users u join sm_org_members m on m.user_id = u.id and m.org_id = $1
      where not ${isDemo("u.id")} and ${jsonNamesDemo("u.prefs")}`,
    [orgId],
  );
  if (people.length) {
    const gone = await goneOracle(tx, orgId, people.map((r) => r.v), names);
    for (const r of people) {
      const p = pruneIds(r.v, gone);
      if (!p.changed) continue;
      const res = await inSavepoint(tx, () => tx.query(`update sm_users set prefs = $2::jsonb where id = $1`, [r.id, JSON.stringify(p.value ?? {})]));
      if (!res.ok) st.skipped.push({ phase: "reroute", table: "sm_users", rows: 1, reason: failReason(res.error) });
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// anchors (class E)

/**
 * Kept rows whose access anchors (unit, domain) name a removed unit: derived again from their person's profile (the
 * engine's derivation, `anchorsFor`) — the profile lost its pack unit in the reroute — else emptied; a domain that went
 * moves up to the nearest kept domain above it (`GoneNames.domainOf`), so a row never becomes visible to more domains.
 * Returns whether every table is done.
 */
export async function anchorStep(tx: Tx, sys: Ctx, orgId: string, info: TableInfo[], names: GoneNames, cur: TableCursor, st: StepState): Promise<boolean> {
  const defs = await effectiveDefs(tx, orgId, info);
  const work = info.filter((t) => defs.has(t.name) && (t.cols.get("unit_id")?.type === "uuid" || t.cols.get("domain_id")?.type === "uuid"));
  const snap = await snapshotFor(sys, tx, true);
  for (; cur.i < work.length; cur.i++, cur.after = null) {
    const t = work[cur.i];
    const def = defs.get(t.name)!;
    const cols = ["unit_id", "domain_id"].filter((c) => t.cols.get(c)?.type === "uuid");
    for (;;) {
      if (Date.now() > st.until) return false;
      const params: unknown[] = [orgId];
      let after = "";
      if (cur.after) {
        params.push(cur.after);
        after = ` and x.id > $2::uuid`;
      }
      const live = t.cols.has("deleted_at") ? " and x.deleted_at is null" : "";
      const rows = await tx.query<Record<string, any>>(
        `select x.* from ${ident(t.name)} x where x.org_id = $1${live} and not ${isDemo("x.id")}${after} and (${cols.map((c) => `(x.${ident(c)} is not null and ${isDemo(`x.${ident(c)}`)})`).join(" or ")}) order by x.id limit ${CHUNK}`,
        params,
      );
      if (!rows.length) break;
      for (const row of rows) {
        cur.after = String(row.id);
        const derived = anchorsFor(def, row, snap);
        const set: Record<string, string | null> = {};
        for (const c of cols) {
          const was = typeof row[c] === "string" ? row[c].toLowerCase() : null;
          if (!was || !(await isRemoved(tx, orgId, was))) continue;
          let next = (derived as Record<string, string | null | undefined>)[c] ?? null;
          if (next && (await isRemoved(tx, orgId, next))) next = null;
          if (c === "domain_id" && !next) next = names.domainOf[was] ?? null;
          set[c] = next;
        }
        if (!Object.keys(set).length) continue;
        const bucket = st.rerouted.get(def.key) ?? { table: def.key, label: def.plural, rows: 0, routed: 0, samples: [] };
        bucket.rows++;
        if (bucket.samples.length < 3) bucket.samples.push(await labelOf(tx, def, row));
        st.rerouted.set(def.key, bucket);
        if (st.dry) continue;
        const keys = Object.keys(set);
        const r = await inSavepoint(tx, () =>
          tx.query(`update ${ident(t.name)} set ${keys.map((k, i) => `${ident(k)} = $${i + 3}::uuid`).join(", ")}${t.cols.has("updated_at") ? ", updated_at = now()" : ""} where id = $1 and org_id = $2`, [
            row.id, orgId, ...keys.map((k) => set[k]),
          ]),
        );
        if (!r.ok) st.skipped.push({ phase: "anchors", table: t.name, rows: 1, reason: failReason(r.error) });
      }
      if (rows.length < CHUNK) break;
    }
  }
  return true;
}

async function isRemoved(q: Queryable, orgId: string, id: string): Promise<boolean> {
  return !!(await q.one(`select 1 as x where ${isDemo("$2::uuid")}`, [orgId, id]));
}

/** The rows of the registry that are users (the pack's people): a beneficiary field naming one makes a row the pack's. */
export const beneficiaryFields = (def: TableDef): string[] => def.fields.filter((f) => !f.base && (f.type === "user") && BENEFICIARY.has(f.name)).map((f) => f.name);

/** Is the field a reference of any kind (for the catalogue's tests). */
export const refFamily = (f: FieldDef): boolean => FIELD_TYPES[f.type]?.family === "ref";
