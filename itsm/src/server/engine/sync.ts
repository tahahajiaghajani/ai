// The record engine and desktop ↔ cloud synchronisation (src/server/sync, src/desktop/sync-client.ts).
//
// - Every TableDef with `features.sync !== false` is a synchronised root (entity = its key), registered from the
//   table registry (src/server/sync/registry.ts), plus the engine's own roots: journal, history, attachment, link.
// - Push (the cloud applying a Windows app's changes): `checkEnginePush` holds each row to the same rules as the
//   API — the access provider (create / write / delete, writable and visible fields, the table's row rules), the
//   engine's value validation (types, lengths, choices), the state model (a change of state is a transition the
//   account may take, with its required fields, guard and checks), a requester's own record changing only in its
//   requester fields (system and readonly fields keep the cloud's values; the engine's effects of their transition are
//   the cloud's own), journal entries and history in the pushing account's name only, and immutability of the journal
//   and the history — and `afterEnginePush` emits the record events of the change (`via: "sync"`). History rows are not written again
//   (the desktop's own travel with the push); references are not re-checked (the desktop checked them, and a
//   referenced row may arrive later in the same push). Numbered records that clash take the next free number.
// - Pull: `pullEngine` sends only rows the linked account may read (the provider's readWhere, the table's row
//   rules, the record of a journal/history/attachment/link row, internal journal visibility, visible history
//   fields); a row that changed but is no longer readable goes out as a tombstone, so the Windows app deletes it
//   (with its journal, history, attachments and links). Fields the account may not see are left out. A push that
//   lost to a newer cloud copy gets that copy back through the same projection (`replicaRows`), never more.
// - Secrets never travel: each runtime seals its own with its own key.
// - Scope epochs (sm_scope_epochs): bumped for a member when what they may read changes (their role or access by
//   the platform's trigger; groups, units and roles of the ITSM access model through `bumpScopeEpoch`). A Windows
//   app whose epoch is behind is told to pull everything again — which also tombstones what it may no longer read.
import type { FieldDef, TableDef } from "@shared/model/types";
import { evaluate, type CondEnv } from "@shared/model/conditions";
import type { Ctx } from "../context";
import type { Queryable, Tx } from "../db";
import { pgArray } from "../db";
import type { AggregateDef, WireAggregate } from "../sync/registry";
import { readAggregates } from "../sync/apply";
import { access } from "../access/provider";
import { condEnv, isSystemCtx } from "./env";
import { orgSchema, type OrgSchema } from "./schema";
import { readable, SEARCH_COLUMN, writableRule } from "./sql";
import { coerceValue, FieldError, KEEP } from "./values";
import { canOpenRecords, fromDb, type Row } from "./read";
import { archivable, archiveTableOf } from "./ddl";
import { recordEvents, sameValue, stateEffects } from "./write";
import { emitEvent } from "./events";
import { emitLinkEvents } from "./links";
import { filterSide, filtersSide, guardFor, hooksFor, redactRows, redacts } from "./hooks";
import { transitionsFrom } from "@shared/model/task";

/**
 * Base columns a module's `derivePush` may set: the access anchors it copies (an alert's unit and domain from its CI)
 * or forces (the security module's records live in its secure workspace, whatever a Windows app pushed).
 */
const DERIVED_ANCHORS = ["unit_id", "domain_id", "workspace_id"];

/** Engine-maintained columns a push may not move on an existing row. */
const PINNED = ["id", "org_id", "no", "created_at", "created_by"];

/** Remove what never travels from a wire row: secret columns (each runtime seals its own). */
export function stripSecrets(def: TableDef, row: Record<string, unknown>): void {
  for (const f of def.fields) if (f.type === "secret" && !f.custom) delete row[f.name];
}

/** Fields of `def` kept out of Windows-app replicas (`FieldDef.noSync`). */
export const localOnlyFields = (def: TableDef): FieldDef[] => def.fields.filter((f) => f.noSync && !f.custom && !f.base);

/** Remove what never goes down to a Windows app: secrets and the fields kept out of replicas. */
export function stripForReplica(def: TableDef, row: Record<string, unknown>): void {
  stripSecrets(def, row);
  for (const f of localOnlyFields(def)) delete row[f.name];
}

/** Bump a member's scope epoch: their Windows app re-reads everything (and drops what they may no longer read). */
export async function bumpScopeEpoch(q: Queryable, orgId: string, userId: string): Promise<void> {
  await q.query(
    `insert into sm_scope_epochs (org_id, user_id, epoch) values ($1, $2, 1)
     on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now()`,
    [orgId, userId],
  );
}

export async function scopeEpoch(q: Queryable, orgId: string, userId: string): Promise<number> {
  const r = await q.one<{ epoch: number }>(`select epoch from sm_scope_epochs where org_id = $1 and user_id = $2`, [orgId, userId]);
  return Number(r?.epoch ?? 0);
}

/** Ids of `def` among `ids` the caller may read (deleted rows included). */
async function readableIds(q: Queryable, ctx: Ctx, def: TableDef | undefined, ids: string[], env: CondEnv): Promise<Set<string>> {
  // participants with a grant of their own (approvers) get the records they take part in on their Windows app too
  if (!def || def.virtual || !ids.length || !(await canOpenRecords(ctx, def, q))) return new Set();
  const params: unknown[] = [pgArray(ids)];
  const where = readable(ctx, def, "t", params, env, { deleted: "any" });
  const rows = await q.query<{ id: string }>(`select t.id from ${def.table} t where t.id = any($1::uuid[]) and ${where}`, params);
  return new Set(rows.map((r) => r.id));
}

async function canWriteRow(q: Queryable, ctx: Ctx, def: TableDef, row: Row, env: CondEnv, op: "write" | "delete"): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  const ok = op === "delete" ? access().canDelete(ctx, def, row) : access().canWrite(ctx, def, row);
  if (!ok) return false;
  if (!def.rowAccess?.write) return true;
  const params: unknown[] = [row.id];
  const rule = writableRule(ctx, def, "t", params, env);
  return !!(await q.one(`select 1 from ${def.table} t where t.id = $1 and ${rule}`, params));
}

function coerceProblem(f: FieldDef, v: unknown, prev: unknown, schema: OrgSchema, env: CondEnv): { value?: unknown; error?: string } {
  try {
    const out = coerceValue(f, v, { schema, tz: env.tz || "Asia/Tehran" }, prev);
    return { value: out === KEEP ? prev : out };
  } catch (e) {
    if (e instanceof FieldError) return { error: e.message };
    throw e;
  }
}

/**
 * Rules for an engine row pushed by a Windows app. Returns a Persian refusal, or null (the row in `agg` may have
 * been normalised: secrets and pinned columns restored, values coerced). `state.prev` keeps the stored copy for
 * `afterEnginePush`.
 */
export async function checkEnginePush(tx: Tx, ctx: Ctx, agg: AggregateDef, wire: WireAggregate, state: { prev?: Row | null }): Promise<string | null> {
  const schema = await orgSchema(ctx, tx);
  const env = await condEnv(ctx);
  if (agg.engine === "record") {
    const def = schema.def(agg.entity);
    if (!def) return "جدول ناشناخته";
    return checkRecord(tx, ctx, def, schema, env, wire, state);
  }
  return checkSide(tx, ctx, agg, schema, env, wire, state);
}

async function checkRecord(tx: Tx, ctx: Ctx, def: TableDef, schema: OrgSchema, env: CondEnv, wire: WireAggregate, state: { prev?: Row | null }): Promise<string | null> {
  const row = wire.row;
  stripSecrets(def, row);
  const stored = await tx.one<Row>(`select * from ${def.table} where id = $1`, [wire.id]);
  const prev = stored ? fromDb(def, stored) : null;
  state.prev = prev;
  if (!access().canReadTable(ctx, def)) return `به «${def.plural}» دسترسی ندارید`;
  if (prev) {
    const visibleNow = await readableIds(tx, ctx, def, [wire.id], env);
    if (!visibleNow.has(wire.id)) return `این ${def.label} در دسترس شما نیست`;
    const deleting = !!row.deleted_at && !prev.deleted_at;
    if (!(await canWriteRow(tx, ctx, def, prev, env, deleting ? "delete" : "write"))) return deleting ? `اجازهٔ حذف این ${def.label} را ندارید` : `اجازهٔ تغییر این ${def.label} را ندارید`;
    // a deletion asks the modules' delete rules (their beforeWrite refusals) of the stored row
    if (deleting && !isSystemCtx(ctx)) {
      for (const h of hooksFor(def.key)) {
        if (!h.validatePushDelete) continue;
        const refusal = await h.validatePushDelete({ tx, ctx, def, prev, next: { ...prev }, changed: new Set(), env });
        if (refusal) return refusal;
      }
    }
    for (const c of PINNED) if (c in row || c === "no") row[c] = prev[c];
  } else if (!isSystemCtx(ctx) && !access().canCreate(ctx, def, row)) {
    return `اجازهٔ ایجاد ${def.label} را ندارید`;
  }
  // copies the pull sent redacted (redactRows) that come back unchanged keep the stored values
  if (prev && !isSystemCtx(ctx) && redacts(def.key)) {
    const seen: Row = { ...prev };
    await redactRows(tx, ctx, def, [seen]);
    for (const f of def.fields) if (!f.base && !f.custom && f.name in row && !sameValue(f, seen[f.name], prev[f.name]) && sameValue(f, row[f.name], seen[f.name])) row[f.name] = prev[f.name];
  }
  // fields: hidden ones and ones the account may not write keep the stored values; the rest is validated like an
  // API write (the desktop's engine applied the same rules, so a difference there is a stale copy, not a change)
  const visible = access().visibleFields(ctx, def);
  const writable = isSystemCtx(ctx) ? null : access().writableFields(ctx, def, prev);
  const pushedCustom = row.custom && typeof row.custom === "object" ? (row.custom as Row) : {};
  // custom values: start from the stored ones (hidden and retired fields keep theirs), then the visible ones as pushed
  const custom: Row = prev && prev.custom && typeof prev.custom === "object" ? { ...(prev.custom as Row) } : {};
  for (const f of def.fields) {
    if (f.base || f.type === "secret") continue;
    const hidden = !!visible && !visible.has(f.name);
    if (f.custom) {
      if (hidden) continue;
      if (!(f.name in pushedCustom) || pushedCustom[f.name] === null) {
        delete custom[f.name];
        continue;
      }
    } else if (!(f.name in row)) continue;
    else if (hidden) {
      delete row[f.name];
      continue;
    }
    const raw = f.custom ? pushedCustom[f.name] : row[f.name];
    if (f.noSync && prev && (raw === null || raw === undefined || raw === "")) {
      delete row[f.name];
      continue;
    }
    const before = prev ? prev[f.name] : undefined;
    const r = coerceProblem(f, raw, before, schema, env);
    if (r.error) return r.error;
    let value = f.type === "bool" ? !!r.value : r.value;
    if (prev && !sameValue(f, before, value) && !f.system && !f.readonly && f.name !== def.states?.field && writable && !writable.has(f.name)) value = before ?? null;
    if (f.custom) {
      if (value === null || value === undefined) delete custom[f.name];
      else custom[f.name] = value;
    } else row[f.name] = value;
  }
  if ("custom" in row || prev) row.custom = custom;
  if (prev && !isSystemCtx(ctx)) {
    const refusal = await checkPushedChange(tx, ctx, def, env, prev, row);
    if (refusal) return refusal;
  }
  // fields a module derives from other data (compiled audiences, access flags): the cloud's computation, never the push's
  const derives = isSystemCtx(ctx) ? [] : hooksFor(def.key).filter((h) => h.derivePush);
  if (derives.length && !(row.deleted_at && !prev?.deleted_at)) {
    const next = fromDb(def, { ...(prev ?? {}), ...row });
    const changed = new Set<string>();
    for (const f of def.fields) if (!f.base && (prev ? !sameValue(f, prev[f.name], next[f.name]) : !isEmptyValue(next[f.name]))) changed.add(f.name);
    for (const h of derives) {
      const values = await h.derivePush!({ tx, ctx, def, prev, next, changed, env });
      // module fields, and the access anchors (unit_id, domain_id) a module copies from what the row names
      if (values) for (const [k, v] of Object.entries(values)) if (DERIVED_ANCHORS.includes(k) || def.fields.some((f) => f.name === k && !f.base)) row[k] = v;
    }
  }
  if (!prev && def.rowAccess?.write && !isSystemCtx(ctx) && !evaluate(def.rowAccess.write, fromDb(def, { ...row }), env, def, schema.lookup)) {
    return `اجازهٔ ایجاد این ${def.label} را ندارید`;
  }
  // module rules that only validate (the ones with side effects ran on the Windows app where the person acted)
  const checks = hooksFor(def.key).filter((h) => h.validatePush);
  if (checks.length && !(row.deleted_at && !prev?.deleted_at)) {
    const next = fromDb(def, { ...(prev ?? {}), ...row });
    const changed = new Set<string>();
    for (const f of def.fields) {
      if (f.base) continue;
      if (prev ? !sameValue(f, prev[f.name], next[f.name]) : !(next[f.name] === null || next[f.name] === undefined || next[f.name] === false)) changed.add(f.name);
    }
    for (const h of checks) {
      const refusal = await h.validatePush!({ tx, ctx, def, prev, next, changed, env });
      if (refusal) return refusal;
    }
  }
  return null;
}

const isEmptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

/**
 * A pushed change of an existing record by a member (not the system), held to what the API lets that member do:
 *   · a change of the state field is a transition of the table's model from the stored state that the member may take
 *     (`canTransition`), with its required fields, its guard and the modules' transition checks — never a jump;
 *   · on a record the member reaches only as its requester (`writeMode` "requester"), system and readonly fields keep
 *     the cloud's values (only module code sets them, and it ran where the person acted only for the person's own
 *     changes), and the engine's own effects of the transition (resolved/closed stamps, `active`…) are the cloud's.
 * Normalises `row` in place; returns a Persian refusal or null.
 */
async function checkPushedChange(tx: Tx, ctx: Ctx, def: TableDef, env: CondEnv, prev: Row, row: Row): Promise<string | null> {
  const prov = access();
  const requester = prov.writeMode?.(ctx, def, prev) === "requester";
  if (requester) {
    for (const f of def.fields) {
      if (f.base || f.custom || f.name === def.states?.field || !(f.system || f.readonly) || !(f.name in row)) continue;
      row[f.name] = prev[f.name] ?? null;
    }
  }
  const model = def.states;
  if (!model || !(model.field in row)) return null;
  const field = def.fields.find((f) => f.name === model.field);
  if (!field || sameValue(field, prev[model.field], row[model.field])) return null;
  const t = transitionsFrom(model, prev[model.field]).find((x) => x.to === row[model.field]);
  const name = (v: unknown) => model.states.find((s) => s.value === v)?.label ?? String(v ?? "");
  if (!t) return `«${def.label}» از «${name(prev[model.field])}» به «${name(row[model.field])}» نمی‌رود`;
  if (!prov.canTransition(ctx, def, prev, t)) return `اجازهٔ «${t.label}» را ندارید`;
  const next: Row = { ...prev, ...row };
  for (const r of t.requires ?? []) {
    if (isEmptyValue(next[r])) return `برای «${t.label}»، «${def.fields.find((f) => f.name === r)?.label ?? r}» را وارد کنید`;
  }
  const changed = new Set<string>();
  for (const f of def.fields) if (!f.base && f.name in row && !sameValue(f, prev[f.name], row[f.name])) changed.add(f.name);
  const w = { tx, ctx, def, op: "update" as const, next, prev, changed, transition: t, env, input: new Set(Object.keys(row)), via: "sync" as const, trusted: false };
  if (t.guard) {
    const guard = guardFor(def.key, t.guard);
    const refusal = guard ? await guard(w) : `شرط «${t.guard}» برای «${t.label}» تعریف نشده است`;
    if (refusal) return refusal;
  }
  for (const h of hooksFor(def.key)) {
    const refusal = await h.validateTransition?.(w);
    if (refusal) return refusal;
  }
  if (requester) {
    // the engine's effects of the transition, as the cloud stamps them
    const effects = new Set<string>();
    stateEffects(def, prev, next, ctx.user.id, new Date().toISOString(), effects);
    for (const k of effects) row[k] = next[k];
  }
  return null;
}

/** The record (table, id) a side row belongs to must be readable — and writable for some changes. */
async function checkSide(tx: Tx, ctx: Ctx, agg: AggregateDef, schema: OrgSchema, env: CondEnv, wire: WireAggregate, state: { prev?: Row | null }): Promise<string | null> {
  const row = wire.row;
  const prev = await tx.one<Row>(`select * from ${agg.table} where id = $1`, [wire.id]);
  state.prev = prev;
  const pairs: [string, string][] = agg.engine === "link" ? [[String(row.from_table), String(row.from_id)], [String(row.to_table), String(row.to_id)]] : [[String(row.table_key), String(row.record_id)]];
  if (prev) {
    // only removal changes a stored side row; everything else about it is immutable
    const keys = agg.engine === "link" ? ["kind", "from_table", "from_id", "to_table", "to_id"] : agg.engine === "history" ? ["table_key", "record_id", "field", "old", "new", "actor", "at"] : agg.engine === "journal" ? ["table_key", "record_id", "kind", "visibility", "body", "author"] : ["table_key", "record_id", "sha256", "size", "uploaded_by"];
    for (const k of keys) if (k in row && JSON.stringify(row[k] ?? null) !== JSON.stringify(prev[k] ?? null)) return "این مورد پس از ثبت تغییر نمی‌کند";
  }
  for (const [table, id] of pairs) {
    const def = schema.def(table);
    if (!def || def.virtual) return "جدول ناشناخته";
    const ok = await readableIds(tx, ctx, def, [id], env);
    if (!ok.has(id)) {
      // a record created in the same push arrives first (records apply before their side rows)
      return `${def.label} این مورد در دسترس شما نیست`;
    }
    if (agg.engine === "link" && table === pairs[0][0] && id === pairs[0][1]) {
      const rec = await tx.one<Row>(`select * from ${def.table} where id = $1`, [id]);
      if (rec && !(await canWriteRow(tx, ctx, def, fromDb(def, rec), env, "write"))) return `اجازهٔ تغییر این ${def.label} را ندارید`;
    }
  }
  if (agg.engine === "journal" && (row.visibility === "internal" || prev?.visibility === "internal") && !isSystemCtx(ctx) && !access().hasFieldGroup(ctx, "internal")) {
    return "اجازهٔ ثبت یادداشت داخلی را ندارید";
  }
  // a new journal entry or history row comes in the pushing account's name, or with no author (the system's note of
  // something module code did while they acted) — never in someone else's; anything but their own comment or work note
  // (approvals, the system's notes, history) only on a record they may change (where they acted)
  if (!prev && !isSystemCtx(ctx) && (agg.engine === "journal" || agg.engine === "history")) {
    const who = agg.engine === "journal" ? row.author : row.actor;
    const own = who !== null && who !== undefined && String(who) === ctx.user.id;
    if (who !== null && who !== undefined && !own) return "این مورد به نام کس دیگری است و از برنامهٔ ویندوز پذیرفته نمی‌شود";
    const kind = String(row.kind ?? "comment");
    if (!(agg.engine === "journal" && own && (kind === "comment" || kind === "work_note"))) {
      const def = schema.def(String(row.table_key));
      const rec = def ? await tx.one<Row>(`select * from ${def.table} where id = $1`, [row.record_id]) : null;
      if (!def || !rec || !(await canWriteRow(tx, ctx, def, fromDb(def, rec), env, "write"))) return `اجازهٔ تغییر این ${def?.label ?? "رکورد"} را ندارید`;
    }
  }
  return null;
}

/** After a pushed engine row is written: the events of the change (records) or of the comment (journal). */
export async function afterEnginePush(tx: Tx, ctx: Ctx, agg: AggregateDef, wire: WireAggregate, state: { prev?: Row | null }): Promise<void> {
  const prev = state.prev ?? null;
  if (agg.engine === "journal") {
    if (!prev) {
      const r = wire.row;
      await emitEvent(tx, ctx, { kind: "record.commented", table: String(r.table_key), id: String(r.record_id), entry: { id: wire.id, kind: String(r.kind), visibility: String(r.visibility) }, actor: (r.author as string | null) ?? null, via: "sync" });
    }
    return;
  }
  if (agg.engine === "link") {
    const r = wire.row as Record<string, unknown>;
    const link = { id: wire.id, kind: String(r.kind), from_table: String(r.from_table), from_id: String(r.from_id), to_table: String(r.to_table), to_id: String(r.to_id) };
    if (!prev && !r.deleted_at) await emitLinkEvents(tx, ctx, "record.linked", link, "sync");
    else if (prev && !prev.deleted_at && r.deleted_at) await emitLinkEvents(tx, ctx, "record.unlinked", link, "sync");
    return;
  }
  if (agg.engine !== "record") return;
  const schema = await orgSchema(ctx, tx);
  const def = schema.def(agg.entity);
  if (!def) return;
  const stored = await tx.one<Row>(`select * from ${def.table} where id = $1`, [wire.id]);
  if (!stored) return;
  const row = fromDb(def, stored);
  // a record moved to the archive (engine/archive.ts) that a Windows app's newer copy brought back is live again: its
  // archived copy goes, so it is listed once (the nightly run moves it again once it is old enough)
  if (!row.deleted_at && (!prev || prev.deleted_at) && archivable(def)) await tx.query(`delete from ${archiveTableOf(def)} where id = $1 and org_id = $2`, [wire.id, ctx.org.id]);
  if (row.deleted_at && (!prev || !prev.deleted_at)) {
    await recordEvents(tx, ctx, def, "delete", prev, row, new Set(), { via: "sync" });
    return;
  }
  const changed = new Set<string>();
  for (const f of def.fields) {
    if (f.base) continue;
    if (!prev ? !(row[f.name] === null || row[f.name] === undefined || row[f.name] === false) : !sameValue(f, prev[f.name], row[f.name])) changed.add(f.name);
  }
  if (prev && !changed.size) return;
  await recordEvents(tx, ctx, def, prev ? "update" : "create", prev, row, changed, { via: "sync" });
}

export interface EnginePull {
  aggregates: WireAggregate[];
  tombstones: { entity: string; id: string }[];
}

/**
 * Engine rows with a revision in (cursor, upto] as the linked account may see them — for a quiet database (tests,
 * tools): revisions are transaction ids, not in commit order, so the pull route reads snapshot deltas instead
 * (routes/sync.ts, src/server/sync/snapshot.ts) and hands the rows to `replicaRows`.
 */
export async function pullEngine(ctx: Ctx, agg: AggregateDef, cursor: number, upto: number): Promise<EnginePull> {
  const rows = await ctx.db.query<Row>(`select * from ${agg.table} where org_id = $1 and rev > $2 and rev <= $3 order by rev`, [ctx.org.id, cursor, upto]);
  return replicaRows(ctx.db, ctx, agg, rows);
}

/**
 * Stored engine rows as the linked account may have them on its Windows app: rows it may not read become tombstones;
 * the others leave out what never goes down — secrets and fields kept out of replicas, fields it may not see, values a
 * module redacts, side rows a module narrows or internal entries it may not read. The pull and the answer to a push
 * that lost to a newer cloud copy (POST /sync/push) share it. `q`: the caller's transaction, when there is one.
 */
export async function replicaRows(q: Queryable, ctx: Ctx, agg: AggregateDef, rows: Row[]): Promise<EnginePull> {
  const out: EnginePull = { aggregates: [], tombstones: [] };
  if (!rows.length) return out;
  // the stored search document holds every search field's text (hidden ones too): it never goes down
  for (const r of rows) for (const k of Object.keys(r)) if (SEARCH_COLUMN.test(k)) delete r[k];
  const schema = await orgSchema(ctx, q);
  const env = await condEnv(ctx);
  let ok: Set<string>;
  if (agg.engine === "record") {
    const def = schema.def(agg.entity);
    ok = await readableIds(q, ctx, def, rows.map((r) => String(r.id)), env);
  } else {
    // side rows follow their record(s)
    const byTable = new Map<string, Set<string>>();
    const need = (t: unknown, id: unknown) => byTable.set(String(t), (byTable.get(String(t)) ?? new Set()).add(String(id)));
    for (const r of rows) {
      if (agg.engine === "link") {
        need(r.from_table, r.from_id);
        need(r.to_table, r.to_id);
      } else need(r.table_key, r.record_id);
    }
    const readableRecords = new Set<string>();
    for (const [t, ids] of byTable) for (const id of await readableIds(q, ctx, schema.def(t), [...ids], env)) readableRecords.add(`${t}:${id}`);
    const internal = isSystemCtx(ctx) || access().hasFieldGroup(ctx, "internal");
    ok = new Set(
      rows
        .filter((r) => {
          if (agg.engine === "link") return readableRecords.has(`${r.from_table}:${r.from_id}`) && readableRecords.has(`${r.to_table}:${r.to_id}`);
          if (!readableRecords.has(`${r.table_key}:${r.record_id}`)) return false;
          if (agg.engine === "journal" && r.visibility === "internal" && !internal) return false;
          if (agg.engine === "history") {
            const def = schema.def(String(r.table_key));
            const visible = def ? access().visibleFields(ctx, def) : null;
            if (visible && !visible.has(String(r.field))) return false;
            if (def?.fields.some((f) => f.name === r.field && f.noSync)) return false;
          }
          return true;
        })
        .map((r) => String(r.id)),
    );
    // attachments and journal entries a module narrows per record (e.g. a knowledge article's draft images)
    if ((agg.engine === "attachment" || agg.engine === "journal") && !isSystemCtx(ctx)) {
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        if (!ok.has(String(r.id)) || !filtersSide(String(r.table_key))) continue;
        const key = `${r.table_key}:${r.record_id}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      for (const list of groups.values()) {
        const def = schema.def(String(list[0].table_key));
        const record = def ? await q.one<Row>(`select * from ${def.table} where id = $1 and org_id = $2`, [list[0].record_id, ctx.org.id]) : null;
        const shown = def && record ? new Set((await filterSide({ q, ctx, def, record, kind: agg.engine, rows: list })).map((r) => String(r.id))) : new Set<string>();
        for (const r of list) if (!shown.has(String(r.id))) ok.delete(String(r.id));
      }
    }
  }
  const okIds = rows.filter((r) => ok.has(String(r.id))).map((r) => String(r.id));
  for (const r of rows) if (!ok.has(String(r.id))) out.tombstones.push({ entity: agg.entity, id: String(r.id) });
  out.aggregates = await readAggregates(q, agg, okIds);
  if (agg.engine === "record") {
    const def = schema.def(agg.entity)!;
    const visible = access().visibleFields(ctx, def);
    for (const a of out.aggregates) {
      stripForReplica(def, a.row);
      if (!visible) continue;
      const custom = a.row.custom && typeof a.row.custom === "object" ? (a.row.custom as Row) : null;
      for (const f of def.fields) {
        if (f.base || visible.has(f.name)) continue;
        if (f.custom && custom) delete custom[f.name];
        else delete a.row[f.name];
      }
    }
    await redactRows(q, ctx, def, out.aggregates.map((a) => a.row));
  }
  return out;
}
