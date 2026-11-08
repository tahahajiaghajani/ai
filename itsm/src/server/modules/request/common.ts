// Helpers of the request module: a system context derived from a request's (same organisation and transaction
// rules), reads of live rows through the access rule (the system reads its whole organisation; a member only what
// the provider lets them), the module's settings row with its defaults, and small value helpers. Every read of
// engine tables here goes through `readable`, so the helpers are safe with a member's context.
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { condEnv, fromDb, optionsOf, orgSchema, readable, SYSTEM_USER, toSql } from "../../engine";
import { access } from "../../access/provider";

export type Row = Record<string, any>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const NIL = "00000000-0000-0000-0000-000000000000";
const systems = new WeakMap<Ctx, Map<string, Ctx>>();

/**
 * The system acting inside a request (hooks, services): same organisation, configuration and transaction rules as
 * `ctx`; `onBehalfOf` records a member as the author of what it writes (the requester whose order created it).
 */
export function sysOf(ctx: Ctx, onBehalfOf: string | null = null): Ctx {
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

/** Live rows of `table` the context may read, filtered by `where`, in `order`, at most `limit`. */
export async function liveRows(q: Queryable, ctx: Ctx, table: string, where: Cond | null = null, opts: { order?: string; limit?: number } = {}): Promise<Row[]> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup }));
  const limit = opts.limit ? ` limit ${Math.max(1, Math.min(10_000, Math.floor(opts.limit)))}` : "";
  const rows = await q.query<Row>(`select t.* from ${def.table} t where ${parts.join(" and ")} order by ${opts.order ?? "t.id"}${limit}`, params);
  return rows.map((r) => fromDb(def, r));
}

/** One live row by id through the access rule, or null. */
export async function liveRow(q: Queryable, ctx: Ctx, table: string, id: unknown): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return null;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, def, "t", params, env);
  params.push(id.toLowerCase());
  const row = await q.one<Row>(`select t.* from ${def.table} t where ${where} and t.id = $${params.length}::uuid`, params);
  return row ? fromDb(def, row) : null;
}

/** Live rows of `table` with these ids (through the access rule). */
export async function rowsByIds(q: Queryable, ctx: Ctx, table: string, ids: readonly unknown[]): Promise<Row[]> {
  const list = [...new Set(ids.filter(isUuid).map((x) => x.toLowerCase()))];
  if (!list.length) return [];
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, def, "t", params, env);
  params.push(`{${list.join(",")}}`);
  const rows = await q.query<Row>(`select t.* from ${def.table} t where ${where} and t.id = any($${params.length}::uuid[])`, params);
  return rows.map((r) => fromDb(def, r));
}

/** May the caller read / create records of `table`? (the access subject is loaded first) */
export async function allowed(ctx: Ctx, table: string, op: "read" | "create"): Promise<boolean> {
  await orgSchema(ctx);
  const def = tableDef(table);
  if (!def) return false;
  return op === "read" ? access().canReadTable(ctx, def) : access().canCreate(ctx, def);
}

/**
 * `value` when the organisation's options of the choice field `table`.`field` offer it (and it is active), else null.
 * An order's channel the record it makes does not know (an incident has no «دستیار هوشمند», «زمان‌بندی» or
 * «گردش‌کار») is left out, so that record's default applies instead of failing the order.
 */
export async function offeredChoice(q: Queryable, ctx: Ctx, table: string, field: string, value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value) return null;
  const schema = await orgSchema(ctx, q);
  const f = (schema.def(table) ?? tableDef(table))?.fields.find((x) => x.name === field);
  if (!f || f.type !== "choice") return null;
  return optionsOf(f, schema).some((o) => o.value === value && o.active !== false) ? value : null;
}

/** `{ and: [field = value …] }` */
export const eqAll = (pairs: Record<string, unknown>): Cond => ({ and: Object.entries(pairs).map(([f, v]) => ({ f, op: "eq" as const, v })) });

/** The module's settings with their defaults. */
export interface RequestConfig {
  id: string | null;
  confirm_days: number;
  info_reminder_days: number;
  info_cancel_days: number;
  sle_window_days: number;
  default_group_id: string | null;
  calendar_id: string | null;
  seeded: boolean;
  seed_version: number;
}

export const CONFIG_DEFAULTS: Omit<RequestConfig, "id"> = {
  confirm_days: 5,
  info_reminder_days: 2,
  info_cancel_days: 10,
  sle_window_days: 90,
  default_group_id: null,
  calendar_id: null,
  seeded: false,
  seed_version: 0,
};

/** The organisation's request settings (its row, else the defaults). */
export async function requestConfig(q: Queryable, ctx: Ctx): Promise<RequestConfig> {
  const [row] = await liveRows(q, sysOf(ctx), "request_config", null, { order: "t.created_at", limit: 1 });
  const out: Record<string, unknown> = { ...CONFIG_DEFAULTS, id: row?.id ?? null };
  if (row) for (const k of Object.keys(CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return out as unknown as RequestConfig;
}

/** Persian list «الف، ب و ج». */
export function faList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join("، ")} و ${xs[xs.length - 1]}`;
}

/** Seconds between two instants (null when either is missing or the end is earlier). */
export function secondsBetween(from: unknown, to: unknown): number | null {
  const a = Date.parse(String(from ?? ""));
  const b = Date.parse(String(to ?? ""));
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

/** A JSON value as a plain object (null and anything else → {}). */
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** A JSON value as an array (anything else → []). */
export const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const iso = (ms: number) => new Date(ms).toISOString();
