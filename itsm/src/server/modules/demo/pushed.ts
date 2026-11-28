// What a Windows app pushes after a demo purge (docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته»; POST /sync/push). An app that
// was away — offline, or behind the purge's tombstones — still holds the pack's rows and may have worked on them, or
// made new rows that name them. The purged-id ledger (./ledger.ts) tells the server which ids a purge removed:
//   · a row whose own id was purged is never brought back: answered «skipped», the app drops it with its outbox entry;
//   · a row that belongs to purged data — a side row of a purged record (journal, history, attachment, link), a
//     membership of a purged account, a new record the purge would have removed with it (the purge's own rule, refs.ts
//     `fieldRefs`: a required reference, a parent — `scope.parent`, `PARENTS` such as a holder's unit or a workflow
//     row's process, version, task or case, a pack person as requester or beneficiary —, its workspace, its author
//     `created_by` or `user_id`) — was recorded on demo data: answered «skipped» like the purge would have removed it;
//   · a new record's pointer that only routes or relates (an assignee, a group, a CI, a custom reference, an access
//     anchor) is emptied, as the purge clears it on a kept record; a list loses the purged ids;
//   · a record the server has keeps what the server holds wherever the push names purged data (the purge cleared that
//     pointer) and takes the push's other changes — never refused for it, so a person's offline edit of a real record
//     that named demo data is not lost. A real record the purge removed because it depended on the pack is purged data
//     itself: its push is answered like the pack's own rows;
//   · an allow-list, a scope, a «همه» audience criterion or a producer (refs.ts `judgeRestrictions`, the purge's own
//     rule) left naming nobody but purged data would make a definition reach everyone or every record: a new one is
//     stored ended — switched off, retired or left unpublished as the purge would end it (refs.ts `deadEnd`; one that
//     can be neither is not stored) — and a stored one keeps the server's copy whole, nothing of the push written (the
//     purge's own ending of it stands); either is handed back to the app as the server stores it, with a review line.
// Every 1.1 Windows app already drops an outbox entry answered «skipped», so the answer needs no new sync protocol: the
// outbox drains and nothing stays failed. A purge answer also carries `purged: true`, by which a 1.1.5 app drops its
// local copy at once (an older one keeps it until its next full read, which the purge brings about).
// Not judged here: ids inside JSON (conditions, workflow graphs, form values) — the purge's sanitising and the
// designers' checks see to those.
import type { FieldDef, TableDef } from "@shared/model/types";
import type { Queryable } from "../../db";
import type { AggregateDef, WireAggregate } from "../../sync/registry";
import { hasLedger, purgedAmong } from "./ledger";
import { BASE_REFS, deadEnd, fieldRefs, judgeRestrictions, type DeadEnd } from "./refs";
import { reviewLine } from "./review";
import { rowWords } from "./samples";

/** The answer to a push of a row a purge removed. */
export const PURGED_ROW = "این مورد دادهٔ نمایشیِ حذف‌شده است و به سرور برنمی‌گردد";
/** The answer to a push of a row that belongs to purged demo data. */
export const PURGED_REF = "این مورد به دادهٔ نمایشیِ حذف‌شده اشاره می‌کند";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * Base columns that place or stamp a row (access anchors, the last writer): emptied, never a reason to refuse it. Not
 * the workspace: a record of a purged workspace goes with it (emptied, it would be open to everyone).
 */
const ANCHORS = new Set(["unit_id", "domain_id", "updated_by"]);

/** Base columns a row cannot stand without (refs.ts `BASE_REFS`: the workspace). */
const BASE_PARENTS = Object.entries(BASE_REFS).filter(([, role]) => role === "parent").map(([name]) => name);

/** Columns of the engine's side rows and of the platform's aggregates that say whose or what a row is. */
const SIDE_OWNERS: Record<string, readonly string[]> = {
  journal: ["record_id", "author"],
  history: ["record_id", "actor"],
  attachment: ["record_id", "uploaded_by"],
  link: ["from_id", "to_id"],
  member: ["user_id"],
};

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

/** Does a pushed aggregate name any of `purged` (its id, values, custom values, children)? */
export function namesPurged(agg: WireAggregate, purged: Set<string>): boolean {
  if (!purged.size) return false;
  const ids = new Set<string>();
  idsOf(agg, ids);
  for (const id of ids) if (purged.has(id)) return true;
  return false;
}

/** The purged ids a push names: one query for the whole push, none at all when the organisation never purged a pack. */
export async function purgedInPush(q: Queryable, orgId: string, aggs: WireAggregate[]): Promise<Set<string>> {
  if (!aggs.length || !(await hasLedger(q, orgId))) return new Set();
  const ids = new Set<string>();
  for (const a of aggs) idsOf(a, ids);
  return purgedAmong(q, orgId, ids);
}

export type PurgedVerdict =
  /** nothing of it was purged (what names purged rows was dealt with in place) */
  | { kind: "write" }
  /** the row was purged, or a new row belongs to purged data: answered «skipped», the app drops it */
  | { kind: "drop"; message: string }
  /**
   * a stored definition whose allow-list, scope, audience or producer the push would leave naming only purged data:
   * nothing of the push is written — the server's copy stands (the purge's own ending of it) and goes back to the app
   */
  | { kind: "stored"; what: string }
  /**
   * a new such definition: `wire.row` now ends it (`end`: switched off, retired, or left unpublished) without the
   * purged ids; it is stored so and goes back to the app as the server stores it
   */
  | { kind: "ended"; what: string; end: DeadEnd };

/** What the server holds of a stored record (its custom values: a pushed `custom` replaces them whole). */
export interface StoredRecord {
  custom?: unknown;
}

const WRITE: PurgedVerdict = { kind: "write" };

/**
 * Judge one pushed aggregate against the purged ids of its push (`purgedInPush`). `def`: the organisation's table
 * definition of an engine record (custom fields included), null for anything else. `stored`: what the server holds of
 * that record (null: a new one). References to purged rows are dealt with in `wire.row`: emptied on a new record, the
 * server's value kept on a stored one (a column left out of the push keeps its stored value).
 */
export function judgePurged(agg: AggregateDef, def: TableDef | null, wire: WireAggregate, stored: StoredRecord | null, purged: Set<string>): PurgedVerdict {
  if (!purged.size) return WRITE;
  const is = (v: unknown) => isId(v) && purged.has(v.toLowerCase());
  if (is(wire.id)) return { kind: "drop", message: PURGED_ROW };
  const row = wire.row;
  const belongs: PurgedVerdict = { kind: "drop", message: PURGED_REF };
  if (!def) {
    const owners = SIDE_OWNERS[agg.entity] ?? (agg.engine && agg.engine !== "record" ? SIDE_OWNERS[agg.engine] : undefined);
    if (owners) return owners.some((c) => is(row[c])) ? belongs : WRITE;
    if (agg.entity === "org") return WRITE;
    // another platform aggregate: a row naming purged data at all belongs to it
    for (const [k, v] of Object.entries(row)) {
      if (k === "id" || k === "org_id" || k === "origin") continue;
      if (is(v) || (Array.isArray(v) && v.some(is))) return belongs;
    }
    return WRITE;
  }
  // an allow-list, a scope, a «همه» audience criterion or a producer that would name only purged data: never stored
  // widened (the purge's own rule, refs.ts `judgeRestrictions`)
  const defined = new Set(def.fields.map((f) => f.name));
  const restricted = judgeRestrictions(def.key, row, (id) => purged.has(id), (n) => defined.has(n));
  let ended: PurgedVerdict | null = null;
  if (restricted.dead) {
    const what = [...new Set(restricted.notes)].join("؛ ");
    if (stored) return { kind: "stored", what };
    const end = deadEnd(def, row);
    // one that can be neither switched off nor closed by its lifecycle would be removed by the purge: not stored
    if (end.how === "remove") return belongs;
    Object.assign(row, restricted.patch, end.patch);
    ended = { kind: "ended", what: [what, ...(end.note ? [end.note] : [])].filter(Boolean).join("؛ "), end };
  }
  // what a new record cannot stand without is what the purge removes a real row for (purge.ts `derivedConds`): a parent
  // reference (refs.ts `fieldRefs`), its workspace, its author — and a required custom value, which emptied would leave
  // the record invalid
  const parents = new Set([...fieldRefs(def).filter((r) => r.role === "parent" && !r.custom && !r.array).map((r) => r.name), ...BASE_PARENTS]);
  const essential = (f: FieldDef) => f.name === "created_by" || f.name === "user_id" || !!f.required || f.name === def.scope?.parent || parents.has(f.name);
  const custom = row.custom && typeof row.custom === "object" && !Array.isArray(row.custom) ? (row.custom as Record<string, unknown>) : null;
  const storedCustom = stored?.custom && typeof stored.custom === "object" && !Array.isArray(stored.custom) ? (stored.custom as Record<string, unknown>) : {};
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
    if (stored) {
      // a stored record keeps what the server holds there; the push's other changes are taken
      if (f.custom) holder[f.name] = storedCustom[f.name] ?? null;
      else delete holder[f.name];
      continue;
    }
    if (!single) {
      // an id kept as text (a workflow submission's case) names what the row belongs to
      if (f.type === "string" || f.type === "text") return belongs;
      continue;
    }
    if (essential(f) && !(f.base && ANCHORS.has(f.name))) return belongs;
    // a pointer of a new record: emptied
    holder[f.name] = null;
  }
  return ended ?? WRITE;
}

/**
 * The review line of a definition the push filter ended or kept as the server holds it (`judgePurged`): its owner is
 * told what came from a Windows app after the purge and why it is as it is now (./review.ts). After the write.
 */
export async function reviewPushed(q: Queryable, orgId: string, def: TableDef, id: string, v: Extract<PurgedVerdict, { kind: "stored" | "ended" }>): Promise<void> {
  const row = await q.one<Record<string, unknown>>(`select * from ${def.table} where id = $1 and org_id = $2`, [id, orgId]);
  const name = row ? await rowWords(q, def, row) : def.label;
  const how = v.kind === "ended" ? v.end.how : null;
  await reviewLine(
    q,
    orgId,
    {
      table: def.key, label: def.label, id, name, deactivated: how === "off", ...(how === "retire" ? { retired: true } : {}), ...(how === "state" && v.kind === "ended" ? { ended: v.end.state } : {}),
      what: (v.kind === "stored" ? `ویرایشی که برنامهٔ ویندوز پس از حذف فرستاد نوشته نشد؛ ${v.what}` : `برنامهٔ ویندوز آن را پس از حذف فرستاد؛ ${v.what}`).slice(0, 400),
    },
    v.kind === "stored" ? "همان‌گونه که بود ماند" : undefined,
  );
}
