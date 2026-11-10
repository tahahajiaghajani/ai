// Shared server helpers of the administration consoles: an organisation's plan and limits, what it uses of them, the
// feature flags as they apply to it, and the console's settings row. Counting rows for limits and usage is platform
// accounting (how many tables, fields, members an organisation has), never a member's read of records: it reads counts
// only, as the platform, and returns no record data.
import type { Ctx, ServerConfig } from "../../context";
import type { Queryable, Tx } from "../../db";
import { forbidden } from "../../http/errors";
import { createIn, updateIn } from "../../engine";
import { liveRow, liveRows, sysOf, type Row } from "../incident/common";
import {
  ALL_PLANS, cleanLimits, effectiveLimits, flagState, limitProblem, LIMIT_KEYS, type FlagRow, type FlagState, type LimitKey, type Limits, type PlanRow,
} from "@shared/admin/plans";

export type { Row };
export { liveRow, liveRows, sysOf };

const SERVICE_EMAIL = `%@service.invalid`;

// ---------------------------------------------------------------- plans and limits

export async function planRows(q: Queryable): Promise<PlanRow[]> {
  const rows = await q.query<PlanRow>(`select key, name, description, limits, features, sort_order, is_default, active from sm_plans order by sort_order, key`);
  return rows.map((r) => ({ ...r, limits: cleanLimits(r.limits), features: r.features ?? [] }));
}

export interface OrgPlan {
  /** the plan's key (the default plan when the organisation has none); "*" on a self-hosted installation */
  key: string;
  plan: PlanRow | null;
  overrides: Limits;
  limits: Limits;
}

/** An organisation's plan and effective limits (a self-hosted Windows installation has no ceilings). */
export async function orgPlan(q: Queryable, orgId: string, mode: ServerConfig["mode"] | undefined): Promise<OrgPlan> {
  const r = await q.one<{ limits: Record<string, unknown> | null }>(`select limits from sm_org_admin where org_id = $1`, [orgId]);
  const raw = r?.limits ?? {};
  const overrides = cleanLimits(raw);
  if (mode === "desktop") return { key: ALL_PLANS, plan: null, overrides, limits: {} };
  const plans = await planRows(q);
  const chosen = typeof raw.plan === "string" ? plans.find((p) => p.key === raw.plan) : undefined;
  const plan = chosen ?? plans.find((p) => p.is_default) ?? null;
  return { key: plan?.key ?? "", plan, overrides, limits: effectiveLimits(plan, overrides) };
}

/** How much of each limit an organisation uses (counts only). */
export async function usageOf(q: Queryable, orgId: string): Promise<Record<LimitKey, number>> {
  const r = await q.one<Record<string, string | number>>(
    `select
       (select count(*) from sm_org_members m join sm_users u on u.id = m.user_id
         where m.org_id = $1 and m.deleted_at is null and m.is_active and lower(u.email) not like $2) as members,
       (select count(*) from sm_custom_tables where org_id = $1 and deleted_at is null) as custom_tables,
       (select count(*) from sm_custom_fields where org_id = $1 and deleted_at is null and active and name like 'u\\_%') as custom_fields,
       (select count(*) from sm_integration_users where org_id = $1 and deleted_at is null) as integration_users,
       (select count(*) from sm_webhook_subscriptions where org_id = $1 and deleted_at is null) as webhooks,
       (select coalesce(sum(size), 0) from sm_attachments where org_id = $1 and deleted_at is null) as bytes`,
    [orgId, SERVICE_EMAIL],
  );
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    members: n("members"),
    custom_tables: n("custom_tables"),
    custom_fields: n("custom_fields"),
    integration_users: n("integration_users"),
    webhooks: n("webhooks"),
    api_rate: 0,
    storage_mb: Math.round(n("bytes") / 1024 / 1024),
  };
}

/** Refuses when adding `adding` would pass the organisation's ceiling of `key` (HTTP 403 with the Persian reason). */
export async function needWithinLimit(q: Queryable, cfg: Pick<ServerConfig, "mode">, orgId: string, key: LimitKey, adding = 1): Promise<void> {
  const plan = await orgPlan(q, orgId, cfg.mode);
  if (plan.limits[key] === undefined) return;
  const used = (await usageOf(q, orgId))[key];
  const problem = limitProblem(key, used, adding, plan.limits);
  if (problem) throw forbidden(problem);
}

export const ALL_LIMIT_KEYS = LIMIT_KEYS;

// ---------------------------------------------------------------- feature flags

export async function flagRows(q: Queryable): Promise<FlagRow[]> {
  const rows = await q.query<FlagRow>(`select key, label, description, stage, percent, plans, orgs_on, orgs_off, tenant_toggle from sm_platform_flags order by key`);
  return rows.map((f) => ({ ...f, plans: f.plans ?? [], orgs_on: f.orgs_on ?? [], orgs_off: f.orgs_off ?? [] }));
}

/** The tenant administrator's switches (admin_config.flags). */
async function tenantSwitches(q: Queryable, orgId: string): Promise<Record<string, boolean>> {
  const r = await q.one<{ flags: Record<string, unknown> | null }>(`select flags from sm_admin_config where org_id = $1 and deleted_at is null order by created_at limit 1`, [orgId]);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(r?.flags ?? {})) if (typeof v === "boolean") out[k] = v;
  return out;
}

/** Every flag as it applies to an organisation, with the gate that decided and its Persian reason. */
export async function featureStates(q: Queryable, orgId: string, mode: ServerConfig["mode"] | undefined): Promise<FlagState[]> {
  const [flags, plan, switches] = await Promise.all([flagRows(q), orgPlan(q, orgId, mode), tenantSwitches(q, orgId)]);
  return flags.map((f) => flagState(f, { id: orgId, plan: plan.key || null, tenant: switches[f.key] ?? null }));
}

/** Is a feature on for the organisation? (An unknown flag is on: code may ask before a platform defines it.) */
export async function hasFeature(q: Queryable, orgId: string, key: string, mode: ServerConfig["mode"] | undefined): Promise<boolean> {
  const states = await featureStates(q, orgId, mode);
  const s = states.find((x) => x.key === key);
  return s ? s.on : true;
}

/** Refuses (403 with the reason) when a feature is off for the caller's organisation. */
export async function needFeature(ctx: Ctx, key: string): Promise<void> {
  const states = await featureStates(ctx.db, ctx.org.id, ctx.cfg.mode);
  const s = states.find((x) => x.key === key);
  if (s && !s.on) throw forbidden(`«${s.label}»: ${s.reason}`);
}

// ---------------------------------------------------------------- the console's settings row

/** The organisation's admin_config row (created on first use, as the system). */
export async function configRow(tx: Tx, ctx: Ctx): Promise<Row> {
  const sys = sysOf(ctx);
  const [found] = await liveRows(tx, sys, "admin_config", { f: "key", op: "eq", v: "main" }, { limit: 1 });
  if (found) return found;
  return createIn(tx, sys, "admin_config", { key: "main" }, { trusted: true });
}

export async function patchConfig(tx: Tx, ctx: Ctx, data: Record<string, unknown>): Promise<Row> {
  const row = await configRow(tx, ctx);
  return updateIn(tx, sysOf(ctx), "admin_config", String(row.id), data, { trusted: true });
}

/** A tenant console route: the settings area at `level` (membership role), never a support session that only views. */
export function needAdmin(ctx: Ctx, level: "view" | "edit" | "full" = "edit"): void {
  ctx.need("settings", level);
}
