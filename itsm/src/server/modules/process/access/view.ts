// What a reader sees of a case (design F §6.3, package F4b). A case's values live in one system field, `data`, keyed
// by library field name and read through the pinned version's form snapshot; who may read which key is decided here,
// once, for every path that hands a case out — the record API, lists, exports and Windows pulls (`redactRows`), the
// attachments of the case (`filterSide`), and the process API of F4c (`caseViews`):
//   · managers of the case, and readers by a grant in `process` (an area scope that reaches the case — never for a
//     confidential case, which the row rule closes to area grants), see every value their field groups allow;
//   · everyone else sees the union of the fields readable (`effectiveRights` ≠ hidden: the form's flags, the step's
//     rights, their field groups) in the steps where they have an open task or acted, plus — for the requester — the
//     start step's readable fields and the version's `requester_view`;
//   · a key the version's snapshot does not define is shown to nobody;
//   · an attachment of the case shows only when a readable «پیوست» field holds it (files come with submissions only;
//     a replaced file stays with its submission, not on the case).
// The same `effectiveRights` (@shared/forms/layout) drives the designer's preview, the step form and the apply on the
// authority, so what a person may enter and what they may read agree. The system reads everything.
import { FIELD_GROUPS, type FieldDef, type FieldGroup, type TableDef } from "@shared/model/types";
import { canRead, effectiveRights } from "@shared/forms/layout";
import { readSnapshot, type FormsSnapshot } from "@shared/forms/snapshot";
import { attachmentIds } from "@shared/forms/validators";
import { formStepOf, startOf, type ProcessGraph, type ProcessNode } from "@shared/process/graph";
import { grantIn, restrictedOk, scopeColumns, scopeMatch, workspaceOk } from "@shared/access";
import { PROCESS_AREA } from "@shared/tables/process";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../../context";
import { pgArray, type Queryable } from "../../../db";
import { subjectOf } from "../../../access";
import { access } from "../../../access/provider";
import { condEnv, isSystemCtx, type SideFilterArgs } from "../../../engine";
import type { Row } from "../../../engine/hooks";
import { myGroupsSql } from "./sources";

const ALL_GROUPS = Object.keys(FIELD_GROUPS) as FieldGroup[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How one reader reads one case. */
export interface CaseView {
  /** every value their field groups allow (a manager, or a reader by an area grant of a case that is not confidential) */
  full: boolean;
  /** the keys of `data` they may read */
  keys: ReadonlySet<string>;
  /** the case's values as stored (the caller filters them with `keys`) */
  data: Record<string, unknown>;
  /** the version snapshot's field definitions, by name */
  defs: ReadonlyMap<string, FieldDef>;
}

interface CaseFacts {
  id: string;
  version_id: string | null;
  requested_by: string | null;
  requested_for: string | null;
  unit_id: string | null;
  domain_id: string | null;
  workspace_id: string | null;
  confidential: boolean | null;
  data: unknown;
  manager: boolean;
}

interface VersionFacts {
  graph: ProcessGraph;
  forms: FormsSnapshot | null;
  defs: Map<string, FieldDef>;
  requester_view: string[];
}

const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") {
    try {
      return obj(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

async function versionsOf(q: Queryable, orgId: string, ids: string[]): Promise<Map<string, VersionFacts>> {
  if (!ids.length) return new Map();
  const rows = await q.query<{ id: string; graph: unknown; forms: unknown; requester_view: unknown }>(
    `select id, graph, forms, requester_view from sm_process_versions where org_id = $1 and id = any($2::uuid[])`,
    [orgId, pgArray(ids)],
  );
  return new Map(
    rows.map((r) => {
      const g = obj(r.graph);
      const graph: ProcessGraph = { nodes: Array.isArray(g.nodes) ? (g.nodes as ProcessNode[]) : [], edges: Array.isArray(g.edges) ? (g.edges as ProcessGraph["edges"]) : [] };
      const forms = readSnapshot(r.forms);
      const view = Array.isArray(r.requester_view) ? r.requester_view.filter((x): x is string => typeof x === "string") : [];
      return [String(r.id), { graph, forms, defs: new Map(Object.entries(forms?.fields ?? {})), requester_view: view }] as const;
    }),
  );
}

/** The keys a reader with `groups` may read at form step `node` of a version (its form, its rights, their groups). */
function stepKeys(v: VersionFacts, node: ProcessNode | null | undefined, groups: readonly FieldGroup[]): string[] {
  if (!node || node.type !== "form_step" || !v.forms) return [];
  const step = formStepOf(node.config);
  const form = step.form ? v.forms.forms[step.form] : undefined;
  if (!form) return [];
  const rights = effectiveRights(form.layout, step.rights, v.defs, { groups });
  return Object.keys(rights).filter((k) => canRead(rights[k]));
}

const groupOk = (f: FieldDef | undefined, groups: readonly FieldGroup[]) => !!f && (!f.group || groups.includes(f.group));

/**
 * How the caller reads each of `caseIds` (live or not; ids the organisation does not hold are left out). One query for
 * the cases, one for their versions and one for the caller's tasks on them.
 */
export async function caseViews(q: Queryable, ctx: Ctx, caseIds: readonly string[]): Promise<Map<string, CaseView>> {
  const ids = [...new Set(caseIds.filter((x) => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];
  const out = new Map<string, CaseView>();
  if (!ids.length) return out;
  const me = ctx.user.id;
  const system = isSystemCtx(ctx);
  const cases = await q.query<CaseFacts>(
    `select c.id, c.version_id, c.requested_by, c.requested_for, c.unit_id, c.domain_id, c.workspace_id, c.confidential, c.data,
       coalesce(c.managers ? $3::text or c.manager_groups ?| ${myGroupsSql("$2::uuid")}, false) as manager
     from sm_process_cases c where c.org_id = $1 and c.id = any($4::uuid[])`,
    [ctx.org.id, me, me, pgArray(ids)],
  );
  if (!cases.length) return out;
  const versions = await versionsOf(q, ctx.org.id, [...new Set(cases.map((c) => c.version_id).filter((x): x is string => !!x))]);
  if (system) {
    for (const c of cases) {
      const data = obj(c.data);
      out.set(String(c.id), { full: true, keys: new Set(Object.keys(data)), data, defs: versions.get(String(c.version_id))?.defs ?? new Map() });
    }
    return out;
  }
  await condEnv(ctx);
  const groups = ALL_GROUPS.filter((g) => access().hasFieldGroup(ctx, g));
  // a grant in `process` that reaches the case by its scope (the row rule keeps confidential cases from it)
  let areaReads = (_row: Row) => false;
  try {
    const s = subjectOf(ctx);
    const g = grantIn(s.eff, PROCESS_AREA);
    const def = tableDef("process_case") as TableDef;
    const c = scopeColumns(def);
    if (s.kind === "user" && g.read !== "none" && g.read !== "own") areaReads = (row) => scopeMatch(s, c, row, g.read) && workspaceOk(s, c, row) && restrictedOk(s, c, row);
  } catch {
    // no subject (another access provider): no area reading, the narrower view
  }
  const mine = await q.query<{ case_id: string; step_key: string }>(
    `select case_id, step_key from sm_process_tasks
     where org_id = $1 and case_id = any($2::uuid[]) and deleted_at is null
       and ((status = 'open' and (assigned_to = $3::uuid or delegated_from = $3::uuid)) or (status = 'done' and (acted_by = $3::uuid or acted_for = $3::uuid)))`,
    [ctx.org.id, pgArray(cases.map((c) => String(c.id))), me],
  );
  const steps = new Map<string, Set<string>>();
  for (const t of mine) (steps.get(String(t.case_id)) ?? steps.set(String(t.case_id), new Set()).get(String(t.case_id))!).add(String(t.step_key));
  for (const c of cases) {
    const id = String(c.id);
    const data = obj(c.data);
    const v = c.version_id ? versions.get(String(c.version_id)) : undefined;
    const defs = v?.defs ?? new Map<string, FieldDef>();
    const full = c.manager || (c.confidential !== true && areaReads(c as unknown as Row));
    const keys = new Set<string>();
    if (v && full) {
      for (const [k, f] of defs) if (groupOk(f, groups)) keys.add(k);
    } else if (v) {
      const node = (key: string) => v.graph.nodes.find((n) => n.id === key);
      for (const step of steps.get(id) ?? []) for (const k of stepKeys(v, node(step), groups)) keys.add(k);
      if (c.requested_by === me || c.requested_for === me) {
        for (const k of stepKeys(v, startOf(v.graph).start, groups)) keys.add(k);
        for (const k of v.requester_view) if (groupOk(defs.get(k), groups)) keys.add(k);
      }
    }
    out.set(id, { full, keys, data, defs });
  }
  return out;
}

/** The values of `data` a view lets its reader see. */
export function visibleData(view: CaseView | undefined, data: unknown): Record<string, unknown> | null {
  if (!view) return null;
  const all = obj(data);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) if (view.keys.has(k)) out[k] = v;
  return out;
}

/** `redactRows` of `process_case`: each readable row keeps the keys of `data` its reader may read. */
export async function redactCases(q: Queryable, ctx: Ctx, _def: TableDef, rows: Row[]): Promise<void> {
  const withData = rows.filter((r) => "data" in r);
  if (!withData.length) return;
  const views = await caseViews(q, ctx, withData.map((r) => String(r.id ?? "")));
  for (const r of withData) r.data = visibleData(views.get(String(r.id ?? "").toLowerCase()), r.data);
}

/** The attachment ids the readable «پیوست» fields of a case hold for a reader. */
export function visibleFiles(view: CaseView | undefined): Set<string> {
  const out = new Set<string>();
  if (!view) return out;
  for (const k of view.keys) {
    const f = view.defs.get(k);
    if (f?.check !== "attachments") continue;
    for (const id of attachmentIds(f, view.data[k]).ids ?? []) out.add(id);
  }
  return out;
}

/** `filterSide` of `process_case`: attachments only through a readable «پیوست» field; journal entries as they are. */
export async function filterCaseSide(s: SideFilterArgs): Promise<Row[]> {
  if (s.kind !== "attachment") return s.rows;
  const id = String(s.record.id ?? "").toLowerCase();
  const shown = visibleFiles((await caseViews(s.q, s.ctx, [id])).get(id));
  return s.rows.filter((r) => shown.has(String(r.id ?? "").toLowerCase()));
}
