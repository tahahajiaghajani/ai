// The organisation's AI settings (sm_ai_settings, one JSON per organisation and runtime) and the platform's AI
// policy (sm_kv "ai.policy", web version only).
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

/**
 * AI features of modules, by the ledger label their generate() calls name (a summary, a classification…): the switch
 * of AiSettings.features that must be on for it. A module registers its label with `registerAiFeature`; the web
 * version relays only the assistant and registered labels for a Windows app.
 */
export const FEATURE_SWITCH: Record<string, keyof AiSettings["features"]> = {};

/** Registers a module's AI feature (its ledger label) under one of the switches («دستیار» unless told otherwise). */
export function registerAiFeature(label: string, sw: keyof AiSettings["features"] = "assistant"): void {
  FEATURE_SWITCH[label] = sw;
}

/** Ledger label prefixes of a family of features (the skills' «skill:<key>», one label per skill an organisation defines). */
const FEATURE_PREFIXES: [string, keyof AiSettings["features"]][] = [];

/** Registers every label starting with `prefix` under a switch (the skills framework: «skill:»). */
export function registerAiFeaturePrefix(prefix: string, sw: keyof AiSettings["features"] = "assistant"): void {
  if (!FEATURE_PREFIXES.some(([p]) => p === prefix)) FEATURE_PREFIXES.push([prefix, sw]);
}

/** The switch of a ledger label (exact registrations first, then prefixes), or undefined for an unknown label. */
export function featureSwitch(label: string): keyof AiSettings["features"] | undefined {
  if (Object.prototype.hasOwnProperty.call(FEATURE_SWITCH, label)) return FEATURE_SWITCH[label];
  return FEATURE_PREFIXES.find(([p]) => label.startsWith(p))?.[1];
}

export function defaultSettings(): AiSettings {
  return {
    enabled: true,
    routing: { assistant: [], analysis: [], fast: [], vision: [] },
    effort: { ...DEFAULT_EFFORT },
    features: { assistant: true, proposals: true, files: true, agents: true, virtual_agent: true },
    data_policy: "masked",
    budgets: { monthly_usd: null, user_daily_usd: null, alert_pct: 80 },
    instructions: "",
    retention_days: 90,
    use_cloud: false,
    cloud_first: [],
    rag: defaultRag(),
    insights: defaultInsights(),
  };
}

/** «بینش‌ها»: on, computed after 6 in the morning, a weekly digest to the desk's managers, anomalies notified. */
export function defaultInsights(): AiSettings["insights"] {
  return { enabled: true, hour: 6, digest: "weekly", roles: ["service_desk_manager", "team_lead", "tenant_admin"], notify_anomalies: true };
}

function normalizeInsights(raw: unknown): AiSettings["insights"] {
  const d = defaultInsights();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AiSettings["insights"]>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    hour: typeof r.hour === "number" && Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 ? r.hour : d.hour,
    digest: r.digest === "off" || r.digest === "daily" || r.digest === "weekly" ? r.digest : d.digest,
    roles: Array.isArray(r.roles) ? [...new Set(r.roles.filter((x): x is string => typeof x === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(x)))].slice(0, 20) : d.roles,
    notify_anomalies: typeof r.notify_anomalies === "boolean" ? r.notify_anomalies : d.notify_anomalies,
  };
}

/** «نمایه و بازیابی»: on, automatic embedding connection, no re-ranking, summaries of uploads, 8 passages. */
export function defaultRag(): AiSettings["rag"] {
  return { enabled: true, embed_connection_id: null, rerank: false, summaries: true, top_k: 8 };
}

function normalizeRag(raw: unknown): AiSettings["rag"] {
  const d = defaultRag();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AiSettings["rag"]>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    embed_connection_id: typeof r.embed_connection_id === "string" && /^[0-9a-f-]{36}$/i.test(r.embed_connection_id) ? r.embed_connection_id : null,
    rerank: typeof r.rerank === "boolean" ? r.rerank : d.rerank,
    summaries: typeof r.summaries === "boolean" ? r.summaries : d.summaries,
    top_k: typeof r.top_k === "number" && Number.isInteger(r.top_k) && r.top_k >= 2 && r.top_k <= 20 ? r.top_k : d.top_k,
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
    // known switches only (a stored row of an older build may carry others)
    features: {
      assistant: typeof r.features?.assistant === "boolean" ? r.features.assistant : d.features.assistant,
      proposals: typeof r.features?.proposals === "boolean" ? r.features.proposals : d.features.proposals,
      files: typeof r.features?.files === "boolean" ? r.features.files : d.features.files,
      agents: typeof r.features?.agents === "boolean" ? r.features.agents : d.features.agents,
      virtual_agent: typeof r.features?.virtual_agent === "boolean" ? r.features.virtual_agent : d.features.virtual_agent,
    },
    data_policy: r.data_policy === "full" || r.data_policy === "aggregates" || r.data_policy === "masked" ? r.data_policy : d.data_policy,
    budgets: { ...d.budgets, ...(r.budgets ?? {}) },
    instructions: typeof r.instructions === "string" ? r.instructions : "",
    retention_days: typeof r.retention_days === "number" ? r.retention_days : d.retention_days,
    use_cloud: typeof r.use_cloud === "boolean" ? r.use_cloud : d.use_cloud,
    // known jobs only, each once, in the jobs' own order
    cloud_first: Array.isArray(r.cloud_first) ? JOBS.filter((j) => (r.cloud_first as unknown[]).includes(j)) : d.cloud_first,
    rag: normalizeRag(r.rag),
    insights: normalizeInsights(r.insights),
  };
}

export async function loadSettings(q: Queryable, orgId: string): Promise<AiSettings> {
  const row = await q.one<{ settings: unknown }>(`select settings from sm_ai_settings where org_id = $1`, [orgId]);
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
const job = z.enum(["assistant", "analysis", "fast", "vision"]);

export const settingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    routing: z.object({ assistant: route, analysis: route, fast: route, vision: route }).partial(),
    effort: z.object({ assistant: effort, analysis: effort, fast: effort, vision: effort }).partial(),
    features: z.object({ assistant: z.boolean(), proposals: z.boolean(), files: z.boolean(), agents: z.boolean(), virtual_agent: z.boolean() }).partial(),
    data_policy: z.enum(["full", "masked", "aggregates"]),
    budgets: z.object({ monthly_usd: usd, user_daily_usd: usd, alert_pct: z.number().int().min(10).max(100) }).partial(),
    instructions: z.string().max(4000, "یادداشت سازمان حداکثر ۴۰۰۰ نویسه است"),
    retention_days: z.number().int().min(7).max(3650),
    use_cloud: z.boolean(),
    cloud_first: z.array(job).max(JOBS.length),
    rag: z
      .object({
        enabled: z.boolean(),
        embed_connection_id: z.string().uuid().nullable(),
        rerank: z.boolean(),
        summaries: z.boolean(),
        top_k: z.number().int().min(2, "دست‌کم ۲ بخش").max(20, "حداکثر ۲۰ بخش"),
      })
      .partial(),
    insights: z
      .object({
        enabled: z.boolean(),
        hour: z.number().int().min(0).max(23),
        digest: z.enum(["off", "daily", "weekly"]),
        roles: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/, "کلید نقش معتبر نیست")).max(20),
        notify_anomalies: z.boolean(),
      })
      .partial(),
  })
  .partial();

/** Apply a validated patch (routing entries must name this organisation's connections). */
export async function saveSettings(ctx: Ctx, patch: AiSettingsPatch): Promise<AiSettings> {
  ctx.need("ai", "full");
  const routed = [...Object.values(patch.routing ?? {}).flatMap((l) => (l ?? []).map((x) => x.connection_id)), ...(patch.rag?.embed_connection_id ? [patch.rag.embed_connection_id] : [])];
  if (routed.length) {
    const rows = await ctx.db.query<{ id: string }>(`select id from sm_ai_connections where org_id = $1 and deleted_at is null and id = any($2::uuid[])`, [ctx.org.id, pgArray([...new Set(routed)])]);
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
      rag: { ...cur.rag, ...(patch.rag ?? {}) },
      insights: { ...cur.insights, ...(patch.insights ?? {}) },
      // «اول نسخهٔ وب» belongs to the Windows app: the web version has no web version to ask first
      ...(ctx.cfg.mode === "cloud" ? { cloud_first: [] } : {}),
    });
    await tx.query(
      `insert into sm_ai_settings (org_id, settings, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
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
    cloud_first: [],
    budgets: { monthly_usd: null, user_daily_usd: null, alert_pct: s.budgets.alert_pct },
    instructions: "",
    rag: { ...s.rag, embed_connection_id: null },
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
  const row = await q.one<{ value: unknown; updated_at: string }>(`select value, updated_at from sm_kv where key = $1`, [POLICY_KEY]);
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
    `insert into sm_kv (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [POLICY_KEY, JSON.stringify(next)],
  );
  return loadPolicy(cfg);
}

/** The platform turned AI off for this organisation (or for everyone). */
export function disabledByPlatform(policy: AiPolicy, orgId: string): boolean {
  return policy.kill_switch || policy.disabled_orgs.includes(orgId);
}

/** The lower of the organisation's own monthly cap and the platform's ceiling. */
export function monthlyCap(settings: AiSettings, policy: AiPolicy): string | null {
  const a = settings.budgets.monthly_usd;
  const b = policy.default_monthly_cap_usd;
  if (a && b) return D(a).lt(b) ? a : b;
  return a ?? b ?? null;
}
