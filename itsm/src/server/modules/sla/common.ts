// Plumbing shared by the SLA service's parts (calendars, SLAs, approvals, rules, policies):
// - `systemFrom(ctx)`: the platform acting inside a person's request (rules, timers, approvals bookkeeping) without a
//   database round trip — it reuses the request's organisation row, so it works inside the write transaction;
// - `liveRows`: the live rows of an engine table through the access rule (system reads are tenant-isolated), with an
//   optional condition, read through the queryable the caller holds (inside a hook: the write's transaction —
//   PGlite has one connection);
// - `config(q, ctx)`: the organisation's configuration of this service (rules, policies, matrices, categories,
//   SLA definitions, approval rules, calendars and holidays), cached per process and revalidated on every use with
//   one small query (counts and last changes of the tables), so a change on another cloud instance is seen at once;
// - `holds` / `withWalks`: rule conditions on a row that is being written (dot-walks filled from the database).
import { condPaths, evaluate, type Cond, type CondEnv, type Lookup } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, fromDb, orgSchema, pathExpr, readable, savepoint, SYSTEM_USER, toSql } from "../../engine";

export type Row = Record<string, any>;

const NIL = "00000000-0000-0000-0000-000000000000";
const systems = new WeakMap<Ctx, Map<string, Ctx>>();

/**
 * A system context derived from `ctx` (same organisation, configuration and transaction rules). `onBehalfOf` records a
 * member as the author of what it writes (a business rule acting for the person whose change triggered it).
 */
export function systemFrom(ctx: Ctx, onBehalfOf: string | null = null): Ctx {
  if (ctx.actor === "system" && !onBehalfOf) return ctx;
  const key = onBehalfOf ?? "";
  let m = systems.get(ctx);
  if (!m) systems.set(ctx, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const user = onBehalfOf && onBehalfOf === ctx.user.id ? ctx.user : onBehalfOf ? { ...SYSTEM_USER, id: onBehalfOf } : SYSTEM_USER;
  const sys: Ctx = {
    ...ctx,
    user,
    member: { id: NIL, org_id: ctx.org.id, user_id: user.id, role: "owner", overrides: {}, is_active: true },
    actor: "system",
    support: null,
    can: () => true,
    need: () => undefined,
  };
  m.set(key, sys);
  return sys;
}

/** Live rows of `table` the context reads (system: the whole organisation), optionally filtered, in `order`. */
export async function liveRows(q: Queryable, ctx: Ctx, table: string, where: Cond | null = null, order = "t.id"): Promise<Row[]> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
  const rows = await q.query<Row>(`select t.* from ${def.table} t where ${parts.join(" and ")} order by ${order}`, params);
  return rows.map((r) => fromDb(def, r));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One live row of `table` by id through the access rule (conditions have no `id` path), or null. */
export async function liveRow(q: Queryable, ctx: Ctx, table: string, id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return null;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, def, "t", params, env);
  params.push(id);
  const row = await q.one<Row>(`select t.* from ${def.table} t where ${where} and t.id = $${params.length}::uuid`, params);
  return row ? fromDb(def, row) : null;
}

/** `{ and: [field = value …] }` */
export const eqAll = (pairs: Record<string, unknown>): Cond => ({ and: Object.entries(pairs).map(([f, v]) => ({ f, op: "eq" as const, v })) });

// ---------------------------------------------------------------------------------------------------------------
// The organisation's configuration

/** Tables whose rows make up the cached configuration. */
export const CONFIG_TABLES = [
  "business_rule", "assignment_rule", "priority_matrix", "category", "ui_policy", "sla_definition", "approval_rule", "calendar", "holiday",
] as const;
export type ConfigTable = (typeof CONFIG_TABLES)[number];

export interface ServiceConfig {
  stamp: string;
  /** live rows by table, ordered by sort_order (rules) or date (holidays) */
  rows: Record<ConfigTable, Row[]>;
  /** derived data parts compute once per configuration (calendars, parsed policies…) */
  memo: Map<string, unknown>;
}

const cache = new Map<string, ServiceConfig>();

async function stampOf(q: Queryable, orgId: string): Promise<string> {
  const parts = CONFIG_TABLES.map((k) => {
    const t = tableDef(k)!.table;
    return `(select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from ${t} where org_id = $1)`;
  });
  const r = await q.one<{ s: string }>(`select concat_ws('|', ${parts.join(", ")}) as s`, [orgId]);
  return r?.s ?? "";
}

/** The organisation's rules, policies, SLA definitions, calendars… (live rows; cached and revalidated per use). */
export async function config(q: Queryable, ctx: Ctx): Promise<ServiceConfig> {
  const orgId = ctx.org.id;
  const stamp = await stampOf(q, orgId);
  const hit = cache.get(orgId);
  if (hit && hit.stamp === stamp) return hit;
  const sys = systemFrom(ctx);
  const rows = {} as Record<ConfigTable, Row[]>;
  for (const k of CONFIG_TABLES) {
    const order = k === "holiday" ? "t.date, t.id" : tableDef(k)!.fields.some((f) => f.name === "sort_order") ? "t.sort_order nulls last, t.created_at, t.id" : "t.created_at, t.id";
    rows[k] = await liveRows(q, sys, k, null, order);
  }
  const out: ServiceConfig = { stamp, rows, memo: new Map() };
  cache.set(orgId, out);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return out;
}

/** Forget an organisation's cached configuration (tests; writes are seen through the stamp anyway). */
export function forgetConfig(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/** A value derived from the configuration, computed once per configuration version. */
export function derived<T>(cfg: ServiceConfig, key: string, make: () => T): T {
  if (cfg.memo.has(key)) return cfg.memo.get(key) as T;
  const v = make();
  cfg.memo.set(key, v);
  return v;
}

/** Active rows of a rule table that apply to `table`, in order. */
export function rulesFor(cfg: ServiceConfig, kind: ConfigTable, table: string): Row[] {
  return derived(cfg, `${kind}:${table}`, () => cfg.rows[kind].filter((r) => r.table_key === table && r.active !== false));
}

/** Tables the engine writes for this service. */
export const INTERNAL_TABLES = new Set(["task_sla", "approval"]);

const OWN = new Set<string>([...CONFIG_TABLES, ...INTERNAL_TABLES, "delegation"]);
/** The service's own tables: rules, policies, SLAs and approvals never apply to them. */
export const ownTable = (key: string): boolean => OWN.has(key);

/** Persian label of a field of a table (for messages). */
export function fieldLabel(def: TableDef, name: string): string {
  return def.fields.find((f) => f.name === name)?.label ?? name;
}

/** A short text of a record for snapshots (its display value). */
export function recordTitle(row: Row, display: string): string {
  const v = row[display];
  return (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)).slice(0, 200);
}

// ---------------------------------------------------------------------------------------------------------------
// Conditions on a row being written

/** Is a stored condition empty (no condition)? */
export const noCond = (c: unknown): boolean => !c || (typeof c === "object" && !Array.isArray(c) && !Object.keys(c as object).length);

/** Evaluate a rule condition on `row` (an empty one is `whenEmpty`; one that cannot be evaluated is false). */
export function holds(cond: unknown, row: Row, env: CondEnv, def: TableDef, lookup: Lookup | undefined, whenEmpty: boolean): boolean {
  if (noCond(cond)) return whenEmpty;
  try {
    return evaluate(cond as Cond, row, env, def, lookup);
  } catch {
    return false;
  }
}

/**
 * Fill the dot-walked values the conditions name (`caller_id.title`, `parent_id.assigned_to.name`) as flat keys of a
 * copy of `row`, read as the system through `q` — so rules see them while the row is not stored yet.
 */
export async function withWalks(q: Queryable, def: TableDef, orgId: string, row: Row, conds: unknown[], env: CondEnv, lookup?: Lookup): Promise<Row> {
  const paths = new Set<string>();
  for (const c of conds) if (!noCond(c)) for (const p of condPaths(c as Cond)) if (p.includes(".")) paths.add(p);
  if (!paths.size) return row;
  const out: Row = { ...row };
  for (const path of paths) {
    const first = def.fields.find((f) => f.name === path.split(".")[0]);
    if (!first) continue;
    const params: unknown[] = [];
    let expr: string;
    try {
      expr = pathExpr(def, path, "t", params, env, { lookup }).expr;
    } catch {
      continue;
    }
    params.push(orgId);
    const orgP = params.length;
    let col: string;
    if (first.custom) {
      params.push(JSON.stringify({ [first.name]: row[first.name] ?? null }));
      col = `$${params.length}::jsonb as custom`;
    } else {
      const sql = FIELD_TYPES[first.type].sql;
      const v = row[first.name];
      params.push(sql === "jsonb" ? (v === undefined || v === null ? null : JSON.stringify(v)) : (v ?? null));
      col = `$${params.length}::${sql} as ${first.name}`;
    }
    const sql = `select ${expr} as v from (select $${orgP}::uuid as org_id, ${col}) t`;
    // inside a transaction a failed statement would abort it: run the look-up in a savepoint
    const run = () => q.one<{ v: unknown }>(sql, params);
    const r = await ((q as { inTx?: boolean }).inTx ? savepoint(q as Tx, run) : run()).catch(() => null);
    out[path] = r ? r.v : null;
  }
  return out;
}
