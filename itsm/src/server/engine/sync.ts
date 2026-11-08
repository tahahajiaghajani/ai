// The record engine and desktop ↔ cloud synchronisation (src/server/sync, src/desktop/sync-client.ts).
//
// - Every TableDef with `features.sync !== false` is a synchronised root (entity = its key), registered from the
//   table registry (src/server/sync/registry.ts), plus the engine's own roots: journal, history, attachment, link.
// - Push (the cloud applying a Windows app's changes): `checkEnginePush` holds each row to the same rules as the
//   API — the access provider (create / write / delete, writable and visible fields, the table's row rules), the
//   engine's value validation (types, lengths, choices) and immutability of the journal and the history — and
//   `afterEnginePush` emits the record events of the change (`via: "sync"`). History rows are not written again
//   (the desktop's own travel with the push); references are not re-checked (the desktop checked them, and a
//   referenced row may arrive later in the same push). Numbered records that clash take the next free number.
// - Pull: `pullEngine` sends only rows the linked account may read (the provider's readWhere, the table's row
//   rules, the record of a journal/history/attachment/link row, internal journal visibility, visible history
//   fields); a row that changed but is no longer readable goes out as a tombstone, so the Windows app deletes it
//   (with its journal, history, attachments and links). Fields the account may not see are left out.
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
import { readable, writableRule } from "./sql";
import { coerceValue, FieldError, KEEP } from "./values";
import { fromDb, type Row } from "./read";
import { recordEvents, sameValue } from "./write";
import { emitEvent } from "./events";
import { hooksFor, redactRows, redacts } from "./hooks";

/** Engine-maintained columns a push may not move on an existing row. */
const PINNED = ["id", "org_id", "no", "created_at", "created_by"];

/** Remove what never travels from a wire row: secret columns (each runtime seals its own). */
export function stripSecrets(def: TableDef, row: Record<string, unknown>): void {
  for (const f of def.fields) if (f.type === "secret" && !f.custom) delete row[f.name];
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
  if (!def || def.virtual || !ids.length || !access().canReadTable(ctx, def)) return new Set();
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
  if (agg.engine !== "record") return;
  const schema = await orgSchema(ctx, tx);
  const def = schema.def(agg.entity);
  if (!def) return;
  const stored = await tx.one<Row>(`select * from ${def.table} where id = $1`, [wire.id]);
  if (!stored) return;
  const row = fromDb(def, stored);
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

/** Engine rows of a pull window (rev in (cursor, upto]) as the linked account may see them. */
export async function pullEngine(ctx: Ctx, agg: AggregateDef, cursor: number, upto: number): Promise<EnginePull> {
  const out: EnginePull = { aggregates: [], tombstones: [] };
  const rows = await ctx.db.query<Row>(`select * from ${agg.table} where org_id = $1 and rev > $2 and rev <= $3 order by rev`, [ctx.org.id, cursor, upto]);
  if (!rows.length) return out;
  const schema = await orgSchema(ctx);
  const env = await condEnv(ctx);
  let ok: Set<string>;
  if (agg.engine === "record") {
    const def = schema.def(agg.entity);
    ok = await readableIds(ctx.db, ctx, def, rows.map((r) => String(r.id)), env);
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
    for (const [t, ids] of byTable) for (const id of await readableIds(ctx.db, ctx, schema.def(t), [...ids], env)) readableRecords.add(`${t}:${id}`);
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
          }
          return true;
        })
        .map((r) => String(r.id)),
    );
  }
  const okIds = rows.filter((r) => ok.has(String(r.id))).map((r) => String(r.id));
  for (const r of rows) if (!ok.has(String(r.id))) out.tombstones.push({ entity: agg.entity, id: String(r.id) });
  out.aggregates = await readAggregates(ctx.db, agg, okIds);
  if (agg.engine === "record") {
    const def = schema.def(agg.entity)!;
    const visible = access().visibleFields(ctx, def);
    for (const a of out.aggregates) {
      stripSecrets(def, a.row);
      if (!visible) continue;
      const custom = a.row.custom && typeof a.row.custom === "object" ? (a.row.custom as Row) : null;
      for (const f of def.fields) {
        if (f.base || visible.has(f.name)) continue;
        if (f.custom && custom) delete custom[f.name];
        else delete a.row[f.name];
      }
    }
    await redactRows(ctx.db, ctx, def, out.aggregates.map((a) => a.row));
  }
  return out;
}
