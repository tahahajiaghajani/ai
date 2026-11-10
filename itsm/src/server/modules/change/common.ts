// Helpers of change enablement: a system context derived from a request's (same organisation and transaction rules),
// reads of live rows through the access rule (the system reads its whole organisation), the module's settings row and
// the per-transaction caches of models and questions. Every read of engine tables here goes through `readable`, so
// the same helpers are safe with a member's context.
import { grantIn } from "@shared/access";
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { CHANGE_CONFIG_DEFAULTS, type ChangeConfig } from "@shared/tables/change";
import type { ModelLike, RiskQuestion } from "@shared/change/logic";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { access } from "../../access/provider";
import { condEnv, fromDb, isSystemCtx, loadReadable, orgSchema, readable, selectRows, SYSTEM_USER, toSql } from "../../engine";

export type Row = Record<string, any>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
export const iso = (ms: number) => new Date(ms).toISOString();

const NIL = "00000000-0000-0000-0000-000000000000";
const systems = new WeakMap<Ctx, Map<string, Ctx>>();

/**
 * The system acting inside a request (hooks, services): same organisation, configuration and transaction rules as
 * `ctx`; `onBehalfOf` records a member as the author of what it writes (a transition done for the person who acted).
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

/** Roles that carry the change manager's authority (docs/spec/ACCESS.md §12: a transition limited to named roles). */
export const CHANGE_AUTHORITY = ["change_manager", "tenant_admin"];

/**
 * Does the acting person hold the change manager's authority — the change area's approve right as a change manager
 * (or a tenant administrator)? Manual authorization, the module's definitions (models, windows, CABs, the risk
 * questionnaire, lockdowns), models of another type or without authorization and leaving a change out of conflict
 * detection need it; team leads and service-desk managers approve in their groups but hold none of this. The system
 * and trusted server code always do.
 */
export async function managesChanges(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  const s = subjectOf(ctx);
  return grantIn(s.eff, "change").approve && CHANGE_AUTHORITY.some((k) => s.eff.roles.includes(k));
}

/** The member who acted (null: the system). */
export const actorOf = (ctx: Ctx): string | null => (ctx.actor === "system" && ctx.user.id === SYSTEM_USER.id ? null : ctx.user.id);

/** Live rows of `table` the context may read, filtered by `where` (a condition), in `order`, at most `limit`. */
export async function liveRows(q: Queryable, ctx: Ctx, table: string, where: Cond | null = null, opts: { order?: string; limit?: number; extra?: { sql: string; params: unknown[] } } = {}): Promise<Row[]> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup }));
  if (opts.extra) {
    let sql = opts.extra.sql;
    opts.extra.params.forEach((p, i) => {
      params.push(p);
      sql = sql.replaceAll(`$${i + 1}§`, `$${params.length}`);
    });
    parts.push(sql);
  }
  // all rows up to the limit (more than a page is read page by page; never cut silently)
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
 * May the context change this record as an update through the API would need it: read it, the provider's write right on
 * it and the table's write row rule. The system always may. Hooks use it before a person's write reaches into another
 * record (a deployment that drives its change, a row added to someone's project).
 */
export async function mayWriteRecord(q: Queryable, ctx: Ctx, table: string, id: unknown): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  if (!isUuid(id)) return false;
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return false;
  await prepareSubject(ctx, q);
  const row = await loadReadable(q, ctx, def, id, await condEnv(ctx));
  return !!row && row.$writable !== false && access().canWrite(ctx, def, row);
}

/**
 * Does the context work this record — change it in full, not only as its requester (the provider's `writeMode`
 * "requester": their own record's requester fields and transitions)? Routes and hooks that act for the desk on a
 * record (moving it to another department, spawning work elsewhere, giving tasks on it) ask this, not `mayWriteRecord`.
 */
export async function mayWorkRecord(q: Queryable, ctx: Ctx, table: string, id: unknown): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  if (!isUuid(id)) return false;
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return false;
  await prepareSubject(ctx, q);
  const row = await loadReadable(q, ctx, def, id, await condEnv(ctx));
  if (!row || row.$writable === false) return false;
  const prov = access();
  return (prov.writeMode ? prov.writeMode(ctx, def, row) : prov.canWrite(ctx, def, row) ? "full" : null) === "full";
}

/** How many live rows of `table` the context may read match `where`. */
export async function countRows(q: Queryable, ctx: Ctx, table: string, where: Cond | null): Promise<number> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table) ?? tableDef(table);
  if (!def || def.virtual) return 0;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup }));
  const r = await q.one<{ n: string | number }>(`select count(*) as n from ${def.table} t where ${parts.join(" and ")}`, params);
  return Number(r?.n ?? 0);
}

/** `{ and: [field = value …] }` */
export const eqAll = (pairs: Record<string, unknown>): Cond => ({ and: Object.entries(pairs).map(([f, v]) => ({ f, op: "eq" as const, v })) });

/** Does the organisation have this table (a module of a parallel branch may not be installed yet)? */
export const hasTable = (key: string): boolean => !!tableDef(key) && !tableDef(key)!.virtual;

/**
 * Does a «ناشی از» link from a record of `table` count as an incident the change caused (CHG-054)? Only incidents
 * where incident management is installed (a problem or a request caused by a change is a side effect, not an
 * incident); without it any record but another change stands in (a «کار»).
 */
export const countsAsIncident = (table: string): boolean => (hasTable("incident") ? table === "incident" : table !== "change_request");

/** The organisation's change settings (its row, else the defaults). */
export async function changeConfig(q: Queryable, ctx: Ctx): Promise<ChangeConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "change_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...CHANGE_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(CHANGE_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return { ...(out as ChangeConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** A change model as the logic needs it. */
export const modelLike = (m: Row | null | undefined): ModelLike | null =>
  m ? { states: m.states, docs_deferred: m.docs_deferred, requirements: m.requirements, locks: m.locks, lead_time_exempt: m.lead_time_exempt, cab_policy: m.cab_policy, pir_policy: m.pir_policy } : null;

/** The model of a change (its own, else the default model of its type), read as the system. */
export async function modelOf(q: Queryable, ctx: Ctx, row: Row): Promise<Row | null> {
  const sys = sysOf(ctx);
  if (row.model_id) {
    const m = await liveRow(q, sys, "change_model", row.model_id);
    if (m) return m;
  }
  return defaultModel(q, ctx, String(row.type ?? "normal"));
}

/** The default (else the first active) model of a type. */
export async function defaultModel(q: Queryable, ctx: Ctx, type: string): Promise<Row | null> {
  const rows = await liveRows(q, sysOf(ctx), "change_model", { and: [{ f: "type", op: "eq", v: type }, { f: "active", op: "eq", v: true }] }, { order: "t.is_default desc, t.sort_order, t.name" });
  return rows[0] ?? null;
}

/** The active risk questions as the logic needs them. */
export async function riskQuestions(q: Queryable, ctx: Ctx): Promise<RiskQuestion[]> {
  const rows = await liveRows(q, sysOf(ctx), "change_risk_question", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.question" });
  return rows.map((r) => ({
    id: String(r.id),
    question: String(r.question ?? ""),
    kind: r.kind === "yes_no" || r.kind === "number" ? r.kind : "choice",
    options: Array.isArray(r.options) ? r.options : [],
    weight: Number(r.weight ?? 1),
    mandatory: r.mandatory !== false,
    change_types: Array.isArray(r.change_types) ? r.change_types : null,
    condition: r.condition ?? null,
    active: true,
    sort_order: Number(r.sort_order ?? 100),
    help: typeof r.help === "string" && r.help ? r.help : null,
  }));
}

/** The transaction's clock: the instant every row written in it carries as `created_at` (DB `now()`). */
export async function dbNow(q: Queryable): Promise<string> {
  const r = await q.one<{ t: unknown }>("select now() as t");
  const t = r?.t instanceof Date ? r.t : new Date(String(r?.t ?? Date.now()));
  return Number.isFinite(t.getTime()) ? t.toISOString() : new Date().toISOString();
}

/** The Persian label of a field of a table (its name when unknown). */
export function fieldLabel(table: string, name: string): string {
  return tableDef(table)?.fields.find((f) => f.name === name)?.label ?? name;
}

/** Persian list «الف، ب و ج». */
export function faList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join("، ")} و ${xs[xs.length - 1]}`;
}
