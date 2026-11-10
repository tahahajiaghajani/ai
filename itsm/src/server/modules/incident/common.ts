// Helpers of the incident and problem modules: a system context derived from a request's (same organisation and
// transaction rules), reads of live rows through the access rule (the system reads its whole organisation), and the
// modules' settings rows with their defaults. Every read of engine tables here goes through `readable`, so the same
// helpers are safe with a member's context.
import type { Cond } from "@shared/model/conditions";
import { grantIn } from "@shared/access/model";
import { tableDef } from "@shared/tables";
import { INCIDENT_CONFIG_DEFAULTS, type IncidentConfig } from "@shared/tables/incident";
import { PROBLEM_CONFIG_DEFAULTS, type ProblemConfig } from "@shared/tables/problem";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { condEnv, fromDb, orgSchema, readable, selectRows, SYSTEM_USER, toSql } from "../../engine";
import { subjectOf } from "../../access";

export type Row = Record<string, any>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const NIL = "00000000-0000-0000-0000-000000000000";
const systems = new WeakMap<Ctx, Map<string, Ctx>>();

/**
 * The system acting inside a request (hooks, services): same organisation, configuration and transaction rules as
 * `ctx`; `onBehalfOf` records a member as the author of what it writes (a cascade done for the person who acted).
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

/**
 * Live rows of `table` the context may read, filtered by `where` (a condition), in `order`, at most `limit` — all of
 * them up to `limit` (more than a page is read page by page: `selectRows`).
 */
export async function liveRows(q: Queryable, ctx: Ctx, table: string, where: Cond | null = null, opts: { order?: string; limit?: number } = {}): Promise<Row[]> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
  return selectRows(q, def, `select t.* from ${def.table} t where ${parts.join(" and ")}`, params, opts.order ?? "t.id", opts.limit ?? null);
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

/**
 * Is the caller only a requester in `area` — a write scope of none or own, the platform's create-on-behalf rule
 * (docs/spec/ACCESS.md §8)? Such a caller files records for themselves; the agent's fields are not theirs to set.
 */
export function requesterOnly(ctx: Ctx, area: string): boolean {
  if (ctx.actor === "system") return false;
  const g = grantIn(subjectOf(ctx).eff, area);
  return g.write === "none" || g.write === "own";
}

/** `{ and: [field = value …] }` */
export const eqAll = (pairs: Record<string, unknown>): Cond => ({ and: Object.entries(pairs).map(([f, v]) => ({ f, op: "eq" as const, v })) });

const pick = <T extends Record<string, unknown>>(defaults: T, row: Row | null): T => {
  const out = { ...defaults } as Record<string, unknown>;
  if (row) for (const k of Object.keys(defaults)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return out as T;
};

/** The organisation's incident settings (its row, else the defaults). */
export async function incidentConfig(q: Queryable, ctx: Ctx): Promise<IncidentConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "incident_config", null, { order: "t.created_at", limit: 1 });
  return { ...pick(INCIDENT_CONFIG_DEFAULTS, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** The organisation's problem settings (its row, else the defaults). */
export async function problemConfig(q: Queryable, ctx: Ctx): Promise<ProblemConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "problem_config", null, { order: "t.created_at", limit: 1 });
  return { ...pick(PROBLEM_CONFIG_DEFAULTS, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
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

/** How many live rows of `table` the context may read match `where`. */
export async function countRows(q: Queryable, ctx: Ctx, table: string, where: Cond | null): Promise<number> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return 0;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
  const r = await q.one<{ n: string | number }>(`select count(*) as n from ${def.table} t where ${parts.join(" and ")}`, params);
  return Number(r?.n ?? 0);
}
