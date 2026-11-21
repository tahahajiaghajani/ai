// What a Windows app pushes after a demo purge (docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته»; POST /sync/push). An app that
// was away — offline, or behind the purge's tombstones — still holds the pack's rows and may have worked on them, or
// made new rows that name them. The purged-id ledger (./ledger.ts) tells the server which ids a purge removed:
//   · a row whose own id was purged is never brought back: answered «skipped», the app drops it with its outbox entry;
//   · a row that belongs to purged data — a side row of a purged record (journal, history, attachment, link), a
//     membership of a purged account, a row whose required reference, parent, requester (whose record it is), author
//     (`created_by`, `user_id`) or a workflow row's process, version, task or case names purged data — was recorded on
//     demo data: a new one is answered «skipped» like the purge would have removed it; a stored one keeps the server's
//     copy (answered «conflict» with it, as for any stale push);
//   · a pointer that only routes or relates (an assignee, a group, a CI, a custom reference, an access anchor) is
//     emptied on a new row and left as the server has it on a stored one (the purge already decided it); a list loses
//     the purged ids.
// Every 1.1 Windows app already drops an outbox entry answered «skipped» or «conflict», so the answer needs no new sync
// protocol: the outbox drains and nothing stays failed. A purge answer also carries `purged: true`, by which a 1.1.5 app
// drops its local copy at once (an older one keeps it until its next full read, which the purge brings about).
// Not judged here: ids inside JSON (conditions, workflow graphs, form values) — the purge's sanitising and the
// designers' checks see to those.
import type { FieldDef, TableDef } from "@shared/model/types";
import type { Queryable } from "../../db";
import type { AggregateDef, WireAggregate } from "../../sync/registry";
import { hasLedger, purgedAmong } from "./ledger";

/** The answer to a push of a row a purge removed. */
export const PURGED_ROW = "این مورد دادهٔ نمایشیِ حذف‌شده است و به سرور برنمی‌گردد";
/** The answer to a push of a row that belongs to purged demo data. */
export const PURGED_REF = "این مورد به دادهٔ نمایشیِ حذف‌شده اشاره می‌کند";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * The workflow engine's rows that mean something only with what they name (design F): a submission's process, version
 * and task (its case is a text column, judged as one), a task's case. A workflow row naming a purged process or case is
 * the purged case's.
 */
const BELONGS_TO: Record<string, readonly string[]> = {
  process_submission: ["process_id", "version_id", "task_id"],
  process_task: ["case_id", "process_id", "version_id"],
  process_case: ["process_id", "version_id"],
};

/** Base columns that place or stamp a row (access anchors, the last writer): emptied, never a reason to refuse it. */
const ANCHORS = new Set(["unit_id", "domain_id", "workspace_id", "updated_by"]);

/** Columns of the engine's side rows and of the platform's aggregates that say whose or what a row is. */
const SIDE_OWNERS: Record<string, readonly string[]> = {
  journal: ["record_id", "author"],
  history: ["record_id", "actor"],
  attachment: ["record_id", "uploaded_by"],
  link: ["from_id", "to_id"],
  member: ["user_id"],
};

/** Requester fields of a table (whose record it is): the access model's (`scope.requester`, else `own` minus the assignee). */
function requesterFields(def: TableDef): string[] {
  return def.scope?.requester ?? (def.scope?.own ?? []).filter((f) => f !== "assigned_to");
}

/** Every id-like string a pushed aggregate carries (its own id, top-level values and lists, custom values, children). */
function idsOf(agg: WireAggregate, into: Set<string>): void {
  const take = (v: unknown) => {
    if (isId(v)) into.add(v.toLowerCase());
    else if (Array.isArray(v)) for (const x of v) if (isId(x)) into.add(x.toLowerCase());
  };
  take(agg.id);
  const scan = (row: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(row)) {
      if (k === "org_id" || k === "origin") continue;
      if (k === "custom" && v && typeof v === "object" && !Array.isArray(v)) for (const c of Object.values(v as Record<string, unknown>)) take(c);
      else take(v);
    }
  };
  scan(agg.row);
  for (const rows of Object.values(agg.children ?? {})) for (const r of rows) scan(r);
}

/** The purged ids a push names: one query for the whole push, none at all when the organisation never purged a pack. */
export async function purgedInPush(q: Queryable, orgId: string, aggs: WireAggregate[]): Promise<Set<string>> {
  if (!aggs.length || !(await hasLedger(q, orgId))) return new Set();
  const ids = new Set<string>();
  for (const a of aggs) idsOf(a, ids);
  return purgedAmong(q, orgId, ids);
}

export type PurgedVerdict =
  /** nothing of it was purged (pointers to purged rows may have been emptied in place) */
  | { kind: "write" }
  /** the row was purged, or a new row belongs to purged data: answered «skipped», the app drops it */
  | { kind: "drop"; message: string }
  /** a stored row's push belongs to purged data: the server's copy wins */
  | { kind: "stored"; message: string };

const WRITE: PurgedVerdict = { kind: "write" };

/**
 * Judge one pushed aggregate against the purged ids of its push (`purgedInPush`). `def`: the organisation's table
 * definition of an engine record (custom fields included), null for anything else. `exists`: the server has the row.
 * Pointers to purged rows are emptied in `wire.row` (on a stored row: left out, so the stored value stays).
 */
export function judgePurged(agg: AggregateDef, def: TableDef | null, wire: WireAggregate, exists: boolean, purged: Set<string>): PurgedVerdict {
  if (!purged.size) return WRITE;
  const is = (v: unknown) => isId(v) && purged.has(v.toLowerCase());
  if (is(wire.id)) return { kind: "drop", message: PURGED_ROW };
  const row = wire.row;
  const belongs = (): PurgedVerdict => (exists && !agg.engine?.match(/^(journal|history|attachment|link)$/) && agg.entity !== "member" ? { kind: "stored", message: PURGED_REF } : { kind: "drop", message: PURGED_REF });
  if (!def) {
    const owners = SIDE_OWNERS[agg.entity] ?? (agg.engine && agg.engine !== "record" ? SIDE_OWNERS[agg.engine] : undefined);
    if (owners) return owners.some((c) => is(row[c])) ? belongs() : WRITE;
    if (agg.entity === "org") return WRITE;
    // another platform aggregate: a row naming purged data at all belongs to it
    for (const [k, v] of Object.entries(row)) {
      if (k === "id" || k === "org_id" || k === "origin") continue;
      if (is(v) || (Array.isArray(v) && v.some(is))) return belongs();
    }
    return WRITE;
  }
  const requester = new Set(requesterFields(def));
  const parents = new Set(BELONGS_TO[def.key] ?? []);
  const essential = (f: FieldDef) =>
    f.name === "created_by" || f.name === "user_id" || !!f.required || f.name === def.scope?.parent || requester.has(f.name) || parents.has(f.name);
  const custom = row.custom && typeof row.custom === "object" && !Array.isArray(row.custom) ? (row.custom as Record<string, unknown>) : null;
  for (const f of def.fields) {
    const holder: Record<string, unknown> | null = f.custom ? custom : row;
    if (!holder || !(f.name in holder)) continue;
    const v = holder[f.name];
    if (v === null || v === undefined) continue;
    const single = f.type === "ref" || f.type === "user" || f.type === "group";
    const list = f.type === "refs" || f.type === "users";
    if (list) {
      if (Array.isArray(v) && v.some(is)) holder[f.name] = v.filter((x) => !is(x));
      continue;
    }
    if (!is(v)) continue;
    if (!single) {
      // an id kept as text (a workflow submission's case) names what the row belongs to
      if (f.type === "string" || f.type === "text") return belongs();
      continue;
    }
    if (essential(f) && !(f.base && ANCHORS.has(f.name))) return belongs();
    // a pointer: a new row has it emptied; a stored one keeps the server's value (custom values are emptied: the purge
    // never puts another value there)
    if (exists && !f.custom) delete holder[f.name];
    else holder[f.name] = null;
  }
  return WRITE;
}
