// The business's AI settings (tz_ai_settings, one JSON per business and runtime) and the
// platform's AI policy (tz_kv "ai.policy", web version only).
import { z } from "zod";
import type { Ctx, ServerConfig } from "../../context";
import { pgArray, type Queryable } from "../../db";
import type { AiJob, AiProtocol, AiSettings } from "@shared/ai/types";
import type { AiPolicy, AiSettingsPatch } from "@shared/ai/api";
import { AI_JOBS, DEFAULT_EFFORT } from "@shared/ai/effort";
import { MODEL_ID_RE } from "@shared/ai/presets";
import { D } from "@shared/money";
import { bad } from "../../http/errors";

export const JOBS: AiJob[] = AI_JOBS.map((j) => j.key);

/** Features whose own switch must be on for a generate() call with that ledger label. */
export const FEATURE_SWITCH: Record<string, keyof AiSettings["features"]> = {
  explain: "explain",
  capture: "capture",
  plan: "forecast",
  forecast: "forecast",
  brief: "insights",
  digest: "insights",
  insights: "insights",
};

export function defaultSettings(): AiSettings {
  return {
    enabled: true,
    routing: { assistant: [], analysis: [], fast: [], vision: [] },
    effort: { ...DEFAULT_EFFORT },
    features: { assistant: true, proposals: true, insights: true, explain: true, capture: true, forecast: true },
    data_policy: "masked",
    budgets: { monthly_usd: null, user_daily_usd: null, alert_pct: 80 },
    instructions: "",
    retention_days: 90,
    use_cloud: false,
  };
}

/** Stored JSON merged over the defaults (old or partial rows never break the engine). */
export function normalizeSettings(raw: unknown): AiSettings {
  const d = defaultSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AiSettings>;
  const routing = { ...d.routing };
  for (const j of JOBS) {
    const list = (r.routing as Record<string, unknown> | undefined)?.[j];
    if (Array.isArray(list)) {
      routing[j] = list
        .filter((x): x is { connection_id: string; model: string } => !!x && typeof x === "object" && typeof (x as { connection_id?: unknown }).connection_id === "string" && typeof (x as { model?: unknown }).model === "string")
        .map((x) => ({ connection_id: x.connection_id, model: x.model }));
    }
  }
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    routing,
    effort: { ...d.effort, ...(r.effort ?? {}) },
    features: { ...d.features, ...(r.features ?? {}) },
    data_policy: r.data_policy === "full" || r.data_policy === "aggregates" || r.data_policy === "masked" ? r.data_policy : d.data_policy,
    budgets: { ...d.budgets, ...(r.budgets ?? {}) },
    instructions: typeof r.instructions === "string" ? r.instructions : "",
    retention_days: typeof r.retention_days === "number" ? r.retention_days : d.retention_days,
    use_cloud: typeof r.use_cloud === "boolean" ? r.use_cloud : d.use_cloud,
  };
}

export async function loadSettings(q: Queryable, orgId: string): Promise<AiSettings> {
  const row = await q.one<{ settings: unknown }>(`select settings from tz_ai_settings where org_id = $1`, [orgId]);
  return normalizeSettings(row?.settings);
}

const usd = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((v, c) => {
    if (v === null || v === "") return null;
    const s = String(v).trim();
    if (!/^\d+(\.\d{1,6})?$/.test(s)) {
      c.addIssue({ code: "custom", message: "مبلغ به دلار معتبر نیست" });
      return z.NEVER;
    }
    return D(s).toFixed();
  });

const route = z.array(z.object({ connection_id: z.string().uuid(), model: z.string().regex(MODEL_ID_RE, "شناسهٔ مدل معتبر نیست") })).max(8);
const effort = z.enum(["low", "medium", "high", "max"]);

export const settingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    routing: z.object({ assistant: route, analysis: route, fast: route, vision: route }).partial(),
    effort: z.object({ assistant: effort, analysis: effort, fast: effort, vision: effort }).partial(),
    features: z.object({ assistant: z.boolean(), proposals: z.boolean(), insights: z.boolean(), explain: z.boolean(), capture: z.boolean(), forecast: z.boolean() }).partial(),
    data_policy: z.enum(["full", "masked", "aggregates"]),
    budgets: z.object({ monthly_usd: usd, user_daily_usd: usd, alert_pct: z.number().int().min(10).max(100) }).partial(),
    instructions: z.string().max(4000, "یادداشت کسب‌وکار حداکثر ۴۰۰۰ نویسه است"),
    retention_days: z.number().int().min(7).max(3650),
    use_cloud: z.boolean(),
  })
  .partial();

/** Apply a validated patch (routing entries must name this business's connections). */
export async function saveSettings(ctx: Ctx, patch: AiSettingsPatch): Promise<AiSettings> {
  ctx.need("ai", "full");
  const routed = Object.values(patch.routing ?? {}).flatMap((l) => (l ?? []).map((x) => x.connection_id));
  if (routed.length) {
    const rows = await ctx.db.query<{ id: string }>(`select id from tz_ai_connections where org_id = $1 and deleted_at is null and id = any($2::uuid[])`, [ctx.org.id, pgArray([...new Set(routed)])]);
    const ok = new Set(rows.map((r) => r.id));
    if (routed.some((id) => !ok.has(id))) throw bad("یکی از اتصال‌های زنجیرهٔ مدل‌ها پیدا نشد");
  }
  return ctx.write(async (tx) => {
    const cur = await loadSettings(tx, ctx.org.id);
    const next: AiSettings = normalizeSettings({
      ...cur,
      ...patch,
      routing: { ...cur.routing, ...(patch.routing ?? {}) },
      effort: { ...cur.effort, ...(patch.effort ?? {}) },
      features: { ...cur.features, ...(patch.features ?? {}) },
      budgets: { ...cur.budgets, ...(patch.budgets ?? {}) },
    });
    await tx.query(
      `insert into tz_ai_settings (org_id, settings, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
       on conflict (org_id) do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now()`,
      [ctx.org.id, JSON.stringify(next), ctx.user.id],
    );
    return next;
  });
}

/** What a member without ai:full may see: the switches, not the routing, budgets or notes. */
export function visibleSettings(s: AiSettings, canManage: boolean): AiSettings {
  if (canManage) return s;
  return {
    ...s,
    routing: { assistant: [], analysis: [], fast: [], vision: [] },
    budgets: { monthly_usd: null, user_daily_usd: null, alert_pct: s.budgets.alert_pct },
    instructions: "",
  };
}

// ---------------------------------------------------------------- platform policy

export const POLICY_KEY = "ai.policy";

export function defaultPolicy(): AiPolicy {
  return { kill_switch: false, disabled_orgs: [], allowed_protocols: null, allowed_presets: null, default_monthly_cap_usd: null, updated_at: null };
}

/** The platform policy; the Windows app is its own platform and has none. */
export async function loadPolicy(cfg: ServerConfig, q: Queryable = cfg.db): Promise<AiPolicy> {
  if (cfg.mode !== "cloud") return defaultPolicy();
  const row = await q.one<{ value: unknown; updated_at: string }>(`select value, updated_at from tz_kv where key = $1`, [POLICY_KEY]);
  const v = (row?.value && typeof row.value === "object" ? row.value : {}) as Partial<AiPolicy>;
  const d = defaultPolicy();
  return {
    kill_switch: v.kill_switch === true,
    disabled_orgs: Array.isArray(v.disabled_orgs) ? v.disabled_orgs.filter((x) => typeof x === "string") : d.disabled_orgs,
    allowed_protocols: Array.isArray(v.allowed_protocols) ? (v.allowed_protocols as AiProtocol[]) : null,
    allowed_presets: Array.isArray(v.allowed_presets) ? v.allowed_presets.filter((x) => typeof x === "string") : null,
    default_monthly_cap_usd: typeof v.default_monthly_cap_usd === "string" ? v.default_monthly_cap_usd : null,
    updated_at: row?.updated_at ?? null,
  };
}

export const policyPatchSchema = z
  .object({
    kill_switch: z.boolean(),
    disabled_orgs: z.array(z.string().uuid()).max(10_000),
    allowed_protocols: z.array(z.enum(["anthropic", "openai-responses", "openai-chat", "gemini"])).nullable(),
    allowed_presets: z.array(z.string().max(40)).max(100).nullable(),
    default_monthly_cap_usd: usd,
  })
  .partial();

export async function savePolicy(cfg: ServerConfig, patch: z.infer<typeof policyPatchSchema>): Promise<AiPolicy> {
  const cur = await loadPolicy(cfg);
  const next = { ...cur, ...patch };
  delete (next as Partial<AiPolicy>).updated_at;
  await cfg.db.query(
    `insert into tz_kv (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [POLICY_KEY, JSON.stringify(next)],
  );
  return loadPolicy(cfg);
}

/** The platform turned AI off for this business (or for everyone). */
export function disabledByPlatform(policy: AiPolicy, orgId: string): boolean {
  return policy.kill_switch || policy.disabled_orgs.includes(orgId);
}

/** The lower of the business's own monthly cap and the platform's ceiling. */
export function monthlyCap(settings: AiSettings, policy: AiPolicy): string | null {
  const a = settings.budgets.monthly_usd;
  const b = policy.default_monthly_cap_usd;
  if (a && b) return D(a).lt(b) ? a : b;
  return a ?? b ?? null;
}
