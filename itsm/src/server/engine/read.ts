// Reading rows: loading a readable row, the shape a row has inside the engine (custom fields flattened as u_* keys)
// and the shape callers get (only visible fields, secrets as `{ secret: true, hint }`, arrays never null).
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { resolvePath, type CondEnv } from "@shared/model/conditions";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { notFound } from "../http/errors";
import { access } from "../access/provider";
import type { OrgSchema } from "./schema";
import { readable, writableRule } from "./sql";
import { openSecret, secretView } from "./values";

export type Row = Record<string, any>;

/** Engine shape of a stored row: the custom fields' values as top-level u_* keys (the `custom` object is kept). */
export function fromDb(def: TableDef, r: Row): Row {
  const custom = (r.custom && typeof r.custom === "object" ? r.custom : {}) as Row;
  for (const f of def.fields) if (f.custom) r[f.name] = custom[f.name] ?? null;
  return r;
}

/** What a caller sees of a row: id, version, number and the visible fields. */
export function toOutput(def: TableDef, row: Row, visible: ReadonlySet<string> | null): Row {
  const out: Row = { id: row.id, version: row.version ?? 1 };
  if (def.numbered) out.number = row.number ?? null;
  for (const f of def.fields) {
    if (visible && !visible.has(f.name) && f.name !== "number") continue;
    if (f.name === "number") continue;
    let v = row[f.name];
    if (v === undefined) continue;
    if (f.type === "secret") v = secretView(v, { hint: f.hint });
    else if (FIELD_TYPES[f.type].array && v === null) v = [];
    out[f.name] = v;
  }
  return out;
}

/** May the caller see every step of a field path (each hop's table and field)? */
export function pathVisible(ctx: Ctx, def: TableDef, path: string, schema: OrgSchema): boolean {
  const r = resolvePath(def, path, schema.lookup);
  if (!r) return false;
  const steps: { def: TableDef; field: FieldDef }[] = [...r.hops, { def: r.def, field: r.field }];
  for (const s of steps) {
    if (s.def.key !== def.key && !access().canReadTable(ctx, s.def)) return false;
    const visible = access().visibleFields(ctx, s.def);
    // the record id (a base column) is visible wherever its row is
    if (visible && !visible.has(s.field.name) && !(s.field.base && s.field.name === "id")) return false;
    if (s.field.type === "secret" && steps.length > 1) return false;
  }
  return true;
}

export interface LoadOptions {
  /** lock the row for this transaction (`for update`) */
  lock?: boolean;
  /** also deleted rows */
  deleted?: boolean;
}

/**
 * The row `id` of `def` if the caller may read it (null otherwise), with `$writable` = the table's write row rule
 * holds for it (the access provider's canWrite is asked separately, in JS).
 */
export async function loadReadable(q: Queryable, ctx: Ctx, def: TableDef, id: string, env: CondEnv, opts: LoadOptions = {}): Promise<Row | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const params: unknown[] = [id.toLowerCase()];
  const where = readable(ctx, def, "t", params, env, { deleted: opts.deleted ? "any" : "live" });
  const w = writableRule(ctx, def, "t", params, env);
  const sql = `select t.*, (${w}) as "$writable" from ${def.table} t where t.id = $1 and ${where}${opts.lock ? " for update of t" : ""}`;
  const r = await q.one<Row>(sql, params);
  return r ? fromDb(def, r) : null;
}

/**
 * May the caller open single records of `def`: their roles read the table's area, or they take part in some of its
 * rows through a participant grant (an approver of a change without any role in the change area). Lists, aggregates
 * and exports ask `canReadTable` only.
 */
export async function canOpenRecords(ctx: Ctx, def: TableDef, q: Queryable = ctx.db): Promise<boolean> {
  if (access().canReadTable(ctx, def)) return true;
  const p = access().participations;
  return !!p && !def.virtual && (await p.call(access(), ctx, q)).has(def.key);
}

/**
 * The plain value of a secret field of record `id` — for trusted server code that checked the caller's access to the
 * record (and their right to see the secret) itself: a fulfiller revealing a sealed answer, a connection's key used
 * by a job. Records only ever carry a secret's hint; this reads the stored value (deleted rows never) and opens it with
 * the organisation's key. Null when empty, or sealed by another runtime's key (each runtime seals its own).
 */
export async function readSecret(q: Queryable, ctx: Ctx, def: TableDef, id: string, field: string): Promise<string | null> {
  const f = def.fields.find((x) => x.name === field);
  if (!f || f.type !== "secret" || def.virtual) throw new Error(`«${field}» is not a secret field of ${def.key}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const col = f.custom ? `t.custom->>'${f.name}'` : `t.${f.name}`;
  const r = await q.one<{ v: string | null }>(`select ${col} as v from ${def.table} t where t.org_id = $1 and t.id = $2 and t.deleted_at is null`, [ctx.org.id, id.toLowerCase()]);
  if (!r?.v) return null;
  try {
    return openSecret(ctx.cfg.secret, ctx.org.id, def.key, f.name, id.toLowerCase(), r.v);
  } catch {
    return null;
  }
}

/** The readable row or 404 «رکورد پیدا نشد» (a row the caller may not read does not exist for them). */
export async function requireReadable(ctx: Ctx, def: TableDef, id: string, env: CondEnv, q: Queryable = ctx.db, opts: LoadOptions = {}): Promise<Row> {
  if (!(await canOpenRecords(ctx, def, q))) throw notFound(`${def.label} پیدا نشد`);
  const row = await loadReadable(q, ctx, def, id, env, opts);
  if (!row) throw notFound(`${def.label} پیدا نشد`);
  return row;
}
