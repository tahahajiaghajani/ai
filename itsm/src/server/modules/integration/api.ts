// The record REST API for other programs (catalogue INT-001/003/004): `/api/v1/r/:table…` and `/api/v1/meta/…` are the
// engine's own generic routes, run with the member context of the key's integration user — the same access predicate,
// field masks, rules and validation as the app — narrowed by the key's scopes (tables × operations). Every call is
// rate limited per key (one-minute windows counted in the database, so several cloud instances share the count),
// limited to the integration user's IP allow-list, logged (sm_int_log) and counted on the key. `/api/v1/openapi.json`
// describes exactly what the key may do.
import type { MiddlewareHandler } from "hono";
import type { Env } from "../../http/hono";
import type { Ctx } from "../../context";
import { AppError, forbidden, unauthorized } from "../../http/errors";
import { clientIp } from "../../http/ratelimit";
import { APP_NAME_EN, APP_VERSION } from "@shared/constants";
import { grantIn } from "@shared/access";
import { ipAllowed, requestScope, scopeAllows, scopeOps, type ApiOp, type TableScope } from "@shared/integration/scopes";
import { buildOpenApi, type ApiTable } from "@shared/integration/openapi";
import { tablesMeta, updateIn } from "../../engine";
import { subjectOf } from "../../access/subject";
import { orgPlan, hasFeature } from "../admin/common";
import { orgStatus, statusError } from "../platform/org-admin";
import { resolveKey, type ResolvedKey } from "./users";
import { intLog, principalCtx, sysOf } from "./common";

export interface ApiCaller {
  key: ResolvedKey;
  ctx: Ctx;
  user: Record<string, unknown>;
}

declare module "hono" {
  interface ContextVariableMap {
    apiCaller: ApiCaller;
  }
}

const lastTouch = new Map<string, number>();

/** Count a request in the key's current minute; the seconds to wait when it is over `limit`, else 0. */
async function countRequest(ctx: Ctx, keyId: string, limit: number): Promise<number> {
  const r = await ctx.db.one<{ count: number; window_start: string | Date }>(
    `insert into sm_api_usage (org_id, key_id, window_start, count) values ($1, $2, date_trunc('minute', now()), 1)
     on conflict (key_id, window_start) do update set count = sm_api_usage.count + 1 returning count, window_start`,
    [ctx.org.id, keyId],
  );
  if ((r?.count ?? 0) <= limit) return 0;
  const start = r ? new Date(r.window_start).getTime() : Date.now();
  return Math.max(1, Math.ceil((start + 60_000 - Date.now()) / 1000));
}

/** Authenticate a request with an integration user's key and set its member context (`c.get("ctx")`). */
export const apiAuth: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const started = Date.now();
  const auth = c.req.header("authorization");
  const raw = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key");
  const key = await resolveKey(cfg.db, raw);
  if (!key) throw unauthorized("کلید API معتبر نیست، باطل شده یا منقضی شده است");
  if (!key.integration_user_id) throw forbidden("این کلید به کاربر یکپارچه‌سازی وابسته نیست؛ برای API رکوردها در «کاربران یکپارچه‌سازی» کلید تازه بسازید");
  if (!(await hasFeature(cfg.db, key.org_id, "public_api", cfg.mode))) throw forbidden("API رکوردها برای این سازمان روشن نیست");
  const { ctx, user } = await principalCtx(cfg, key.org_id, key.integration_user_id);
  // what the API answers leaves the system: nothing of the demo pack is listed, counted, read or changed through it
  // (docs/DEMO_FA.md) — a demo row is unknown here (404), as in the hub's scheduled exports
  ctx.withoutDemo = true;
  // a suspended organisation is closed to its keys as to its members (read-only refuses writes in ctx.write)
  const orgState = await orgStatus(cfg.db, key.org_id);
  if (orgState.status === "suspended") throw statusError(orgState);
  const ip = clientIp(c);
  const allow = [...String(user.ip_allowlist ?? "").split(/[\s,]+/).filter(Boolean), ...(key.ip_allowlist ?? [])];
  if (!ipAllowed(ip === "local" ? "127.0.0.1" : ip, allow)) throw forbidden("درخواست از نشانی‌ای آمده که برای این کاربر یکپارچه‌سازی مجاز نیست");
  const plan = await orgPlan(cfg.db, key.org_id, cfg.mode);
  if (plan.limits.api_rate === 0) throw forbidden("API در طرح فعلی سازمان نیست");
  const limit = Math.min(key.rate_limit ?? Number(user.rate_limit ?? 120), plan.limits.api_rate ?? Number.MAX_SAFE_INTEGER);
  const wait = await countRequest(ctx, key.id, limit);
  if (wait) {
    c.header("Retry-After", String(wait));
    await intLog(cfg.db, { org_id: key.org_id, kind: "api", ref_id: key.id, actor: ctx.user.id, method: c.req.method, target: c.req.path, status: 429, ok: false, summary: "سقف درخواست" });
    throw new AppError(429, "rate_limited", `سقف ${limit.toLocaleString("fa-IR")} درخواست در دقیقه برای این کلید پر شده است؛ ${wait.toLocaleString("fa-IR")} ثانیهٔ دیگر دوباره بفرستید`);
  }
  c.set("ctx", ctx);
  c.set("apiCaller", { key, ctx, user });
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } catch (e) {
    status = e instanceof AppError ? e.status : 500;
    throw e;
  } finally {
    await cfg.db.query(`update sm_api_keys set last_used_at = now(), calls = calls + 1 where id = $1`, [key.id]).catch(() => undefined);
    await intLog(cfg.db, { org_id: key.org_id, kind: "api", ref_id: key.id, actor: ctx.user.id, method: c.req.method, target: c.req.path.replace(/^\/api/, ""), status, ok: status < 400, latency_ms: Date.now() - started });
    // the integration user's «last used» moves at most every five minutes (it is a record: no churn per request)
    const uid = String(user.id);
    if (Date.now() - (lastTouch.get(uid) ?? 0) > 300_000) {
      lastTouch.set(uid, Date.now());
      const sys = sysOf(ctx);
      await sys.write((tx) => updateIn(tx, sys, "integration_user", uid, { last_used_at: new Date().toISOString() }, { trusted: true, keepVersion: true })).catch(() => undefined);
    }
  }
};

/** The key's scopes for the record API: a request outside them is refused before the engine sees it. */
export const apiScopes: MiddlewareHandler<Env> = async (c, next) => {
  const caller = c.get("apiCaller");
  const path = c.req.path.replace(/^\/api\/v1/, "");
  if (path.startsWith("/blobs")) throw forbidden("این مسیر فقط برای همگام‌سازی برنامهٔ ویندوز است");
  let body: unknown = undefined;
  // what bulk changes and imports do depends on their body (a deletion; an import with a match key updates rows)
  if (/\/(bulk|import)\/?$/.test(path)) body = await c.req.json().catch(() => undefined);
  const s = requestScope(c.req.method, path, body);
  if (s) {
    for (const op of [s.op, ...(s.also ?? [])]) {
      if (!scopeAllows(caller.key.table_scopes, s.table, op)) throw forbidden(`این کلید اجازهٔ «${OP_FA[op]}» در «${s.table}» را ندارد`);
    }
  }
  await next();
};

const OP_FA: Record<ApiOp, string> = { read: "خواندن", create: "ثبت", update: "تغییر", delete: "حذف" };

/** The tables a member may use through the API, with the operations its roles and the scopes allow. */
export async function apiTables(ctx: Ctx, scopes: TableScope[] | null): Promise<{ tables: ApiTable[]; choices: Record<string, import("@shared/model/types").Option[]> }> {
  const meta = await tablesMeta(ctx);
  const s = subjectOf(ctx);
  const tables: ApiTable[] = [];
  for (const t of meta.tables) {
    if (t.can.participant) continue;
    const g = s.kind === "system" ? null : grantIn(s.eff, String(t.area));
    const roleOps: ApiOp[] = t.virtual ? ["read"] : ["read", ...(t.can.create ? (["create"] as const) : []), ...(!g || g.write !== "none" ? (["update"] as const) : []), ...(!g || g.delete !== "none" ? (["delete"] as const) : [])];
    const ops = scopes ? roleOps.filter((o) => scopeOps(scopes, t.key).includes(o)) : roleOps;
    if (!ops.includes("read")) continue;
    tables.push({
      key: t.key,
      label: t.label,
      plural: t.plural,
      description: t.description ?? null,
      numbered: !!t.numbered,
      fields: t.fields,
      states: t.states ? { field: t.states.field, options: t.states.states.map((x) => ({ value: x.value, label: x.label })) } : null,
      ops,
    });
  }
  return { tables, choices: meta.choices };
}

/** The OpenAPI document of what `ctx` (an integration user, narrowed by `scopes`) may do. */
export async function openApiFor(ctx: Ctx, scopes: TableScope[] | null, server: string): Promise<Record<string, unknown>> {
  const { tables, choices } = await apiTables(ctx, scopes);
  return buildOpenApi({ title: `${APP_NAME_EN} — ${ctx.org.name}`, version: APP_VERSION, server, tables, choices });
}

/** `/meta/tables` for a key: only the tables its scopes name. */
export async function metaForKey(ctx: Ctx, scopes: TableScope[]) {
  const meta = await tablesMeta(ctx);
  return { ...meta, tables: meta.tables.filter((t) => scopeAllows(scopes, t.key, "read")) };
}
