// The AI governance console's read models (catalogue AI-153/165/166/168/169/172/175/179; docs/spec/AI.md §14). For AI
// administrators (ai:full) only. Everything here is configuration or an organisation-wide count: skill runs stay
// private to their authors (their feedback is counted, never quoted), predictions and insights are not listed, and the
// audit export carries settings, counts and the audit trail of AI changes — no record content.
import type { DataPolicyRow, GovernanceFeedback, GovernanceOverview, GovernanceQuality, GovernanceUsage, GuardEntry, ModelCard, OversightView } from "@shared/ai/governance";
import { AI_DATA_POLICY } from "@shared/tables/ai-governance";
import { TABLES, tableDef } from "@shared/tables";
import { D } from "@shared/money";
import type { Ctx } from "../../../context";
import { bad } from "../../../http/errors";
import { create, list, orgSchema, update } from "../../../engine";
import { connectionRows } from "../connections";
import { defaultDataUse, isLocalConnection } from "../datause";
import { loadEnv } from "../chain";
import { disabledByPlatform, FEATURE_SWITCH } from "../settings";
import { principalOf } from "../skills/principal";
import { builtinSkills } from "../skills/registry";
import { analyticsAiCapabilities } from "../../analytics/ai";
import { modelViews } from "../ml";
import { ML_KIND_LABELS } from "@shared/ai/ml";

const SWITCH_LABELS: Record<string, string> = { assistant: "دستیار و قابلیت‌های بخش‌ها", proposals: "پیشنهاد تغییر", files: "فرستادن فایل", agents: "عامل‌ها", virtual_agent: "دستیار مجازی" };
const DAY = 86_400_000;

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Inventory of what AI does in the organisation, with the last month's activity of each piece. */
export async function governanceOverview(ctx: Ctx): Promise<GovernanceOverview> {
  ctx.need("ai", "full");
  const env = await loadEnv(ctx);
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const labelsBySwitch = new Map<string, string[]>();
  for (const [label, sw] of Object.entries(FEATURE_SWITCH)) labelsBySwitch.set(sw, [...(labelsBySwitch.get(sw) ?? []), label]);
  const features = Object.entries(env.settings.features).map(([key, on]) => ({ key, label: SWITCH_LABELS[key] ?? key, on: !!on, labels: (labelsBySwitch.get(key) ?? []).sort() }));
  const conns = (await connectionRows(ctx.db, ctx.org.id)).map((r) => ({
    id: r.id,
    label: r.label,
    preset: r.preset,
    local: isLocalConnection(r),
    enabled: r.enabled,
    status: (r.status as string | null) ?? null,
    models: [...new Set([...(r.models?.smart ?? []), ...(r.models?.fast ?? []), ...(r.models?.vision ?? [])])],
  }));
  const skillRows = await ctx.db.query<{ key: string; name: string; module: string | null; enabled: boolean; tier: string; output: string; triggers: string[] | null; auto_apply: string[] | null }>(
    `select key, name, module, enabled, tier, output, triggers, auto_apply from sm_ai_skills where org_id = $1 and deleted_at is null order by module, name`,
    [ctx.org.id],
  );
  const runs = await ctx.db.query<{ skill_key: string; runs: number; errors: number; up: number; down: number }>(
    `select skill_key, count(*)::int as runs, count(*) filter (where status = 'error')::int as errors, count(*) filter (where feedback = 1)::int as up, count(*) filter (where feedback = -1)::int as down
     from sm_ai_skill_runs where org_id = $1 and created_at >= $2 group by 1`,
    [ctx.org.id, since],
  );
  const byKey = new Map(runs.map((r) => [r.skill_key, r]));
  // built-in skills an organisation has not opened yet still appear (switched on by default)
  const skills = [
    ...skillRows.map((s) => ({ key: s.key, name: s.name, module: s.module, enabled: s.enabled, tier: s.tier, output: s.output, triggers: s.triggers ?? [], auto_apply: s.auto_apply ?? [] })),
    ...builtinSkills()
      .filter((d) => !skillRows.some((s) => s.key === d.key))
      .map((d) => ({ key: d.key, name: d.name, module: d.module ?? null, enabled: true, tier: d.tier, output: d.output, triggers: ["manual"], auto_apply: [] as string[] })),
  ].map((s) => ({ ...s, runs_30d: n(byKey.get(s.key)?.runs), errors_30d: n(byKey.get(s.key)?.errors), up: n(byKey.get(s.key)?.up), down: n(byKey.get(s.key)?.down) }));
  const agentRows = await ctx.db.query<{ id: string; key: string; name: string; module: string | null; enabled: boolean; autonomy: string; auto_actions: string[] | null; principal_id: string | null }>(
    `select id, key, name, module, enabled, autonomy, auto_actions, principal_id from sm_ai_agents where org_id = $1 and deleted_at is null order by module, name`,
    [ctx.org.id],
  );
  const agentRuns = await ctx.db.query<{ agent_key: string; runs: number; failed: number }>(
    `select agent_key, count(*)::int as runs, count(*) filter (where status = 'failed')::int as failed from sm_ai_agent_runs where org_id = $1 and created_at >= $2 group by 1`,
    [ctx.org.id, since],
  );
  const models = (await modelViews(ctx)).map((m) => ({ key: m.key, name: m.name, kind: ML_KIND_LABELS[m.kind], table_label: m.table_label, status: m.status, enabled: m.enabled, version: m.version, beats_baseline: m.beats_baseline, threshold_apply: m.threshold_apply, trained_at: m.trained_at }));
  const p = await principalOf(ctx.db, ctx.org.id);
  return {
    enabled: env.settings.enabled,
    disabled_by_platform: disabledByPlatform(env.policy, ctx.org.id),
    data_policy: env.settings.data_policy,
    features,
    connections: conns,
    skills,
    agents: agentRows.map((a) => {
      const r = agentRuns.find((x) => x.agent_key === a.key);
      return { key: a.key, name: a.name, module: a.module, enabled: a.enabled, autonomy: a.autonomy, auto_actions: a.auto_actions ?? [], principal: !!a.principal_id, runs_30d: n(r?.runs), failed_30d: n(r?.failed) };
    }),
    models,
    principal: { set: !!p.user_id && p.active, roles: p.roles },
    capabilities: analyticsAiCapabilities(),
  };
}

/** Calls, tokens and cost per day and feature, per feature and per model, from the usage ledger. */
export async function usageReport(ctx: Ctx, days = 30): Promise<GovernanceUsage> {
  ctx.need("ai", "full");
  const span = Math.max(1, Math.min(366, Math.floor(days)));
  const from = new Date(Date.now() - span * DAY).toISOString();
  const to = new Date().toISOString();
  const rows = await ctx.db.query<{ day: string; feature: string; calls: number; errors: number; input: number; output: number; cost: string }>(
    `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, feature, count(*)::int as calls, count(*) filter (where not ok)::int as errors,
            coalesce(sum(input), 0)::int as input, coalesce(sum(output), 0)::int as output, coalesce(sum(cost_usd), 0)::text as cost
     from sm_ai_usage where org_id = $1 and created_at >= $2 group by 1, 2 order by 1, 2`,
    [ctx.org.id, from],
  );
  const feats = await ctx.db.query<{ feature: string; calls: number; errors: number; input: number; output: number; cost: string; ms: number | null }>(
    `select feature, count(*)::int as calls, count(*) filter (where not ok)::int as errors, coalesce(sum(input), 0)::int as input, coalesce(sum(output), 0)::int as output,
            coalesce(sum(cost_usd), 0)::text as cost, avg(ms)::int as ms
     from sm_ai_usage where org_id = $1 and created_at >= $2 group by 1 order by sum(cost_usd) desc, 1`,
    [ctx.org.id, from],
  );
  const models = await ctx.db.query<{ model: string | null; preset: string | null; calls: number; cost: string }>(
    `select model, preset, count(*)::int as calls, coalesce(sum(cost_usd), 0)::text as cost from sm_ai_usage where org_id = $1 and created_at >= $2 group by 1, 2 order by sum(cost_usd) desc`,
    [ctx.org.id, from],
  );
  const total = feats.reduce((a, f) => a.plus(f.cost || "0"), D(0));
  return {
    from,
    to,
    days: rows.map((r) => ({ day: r.day, feature: r.feature, calls: n(r.calls), errors: n(r.errors), input: n(r.input), output: n(r.output), cost_usd: D(r.cost || "0").toFixed(4) })),
    by_feature: feats.map((f) => ({ feature: f.feature, calls: n(f.calls), errors: n(f.errors), input: n(f.input), output: n(f.output), cost_usd: D(f.cost || "0").toFixed(4), avg_ms: f.ms === null ? null : n(f.ms) })),
    by_model: models.map((m) => ({ model: m.model ?? "—", preset: m.preset, calls: n(m.calls), cost_usd: D(m.cost || "0").toFixed(4) })),
    total_cost_usd: total.toFixed(4),
  };
}

/** Evaluation results of skills and the metrics history of the classical models. */
export async function qualityReport(ctx: Ctx): Promise<GovernanceQuality> {
  ctx.need("ai", "full");
  const evals = await ctx.db.query<{ skill_key: string; name: string; last_score: string | null; last_run_at: string | null; last_model: string | null }>(
    `select skill_key, name, last_score, last_run_at, last_model from sm_ai_skill_evals where org_id = $1 and deleted_at is null order by skill_key, name`,
    [ctx.org.id],
  );
  const models = (await modelViews(ctx)).map((m) => ({ key: m.key, name: m.name, kind: m.kind, status: m.status, version: m.version, history: m.history, metrics: m.metrics, baseline: m.baseline, beats_baseline: m.beats_baseline }));
  return { evals: evals.map((e) => ({ skill_key: e.skill_key, name: e.name, score: e.last_score === null ? null : Number(e.last_score), run_at: e.last_run_at, model: e.last_model })), models };
}

/** 👍/👎 per skill (counted, never quoted), what became of predictions and of proposals. */
export async function feedbackReport(ctx: Ctx, days = 90): Promise<GovernanceFeedback> {
  ctx.need("ai", "full");
  const since = new Date(Date.now() - Math.max(1, Math.min(366, days)) * DAY).toISOString();
  const skills = await ctx.db.query<{ skill_key: string; runs: number; up: number; down: number; with_comment: number }>(
    `select skill_key, count(*)::int as runs, count(*) filter (where feedback = 1)::int as up, count(*) filter (where feedback = -1)::int as down,
            count(*) filter (where coalesce(feedback_comment, '') <> '')::int as with_comment
     from sm_ai_skill_runs where org_id = $1 and created_at >= $2 group by 1 order by 1`,
    [ctx.org.id, since],
  );
  const preds = await ctx.db.query<{ model_key: string; name: string; applied: number; auto_applied: number; dismissed: number; agreed: number; outcomes: number }>(
    `select p.model_key, m.name, count(*) filter (where p.status = 'applied')::int as applied, count(*) filter (where p.status = 'auto_applied')::int as auto_applied,
            count(*) filter (where p.status = 'dismissed')::int as dismissed, count(*) filter (where p.actual is not null and p.actual = p.value)::int as agreed,
            count(*) filter (where p.actual is not null)::int as outcomes
     from sm_ai_predictions p join sm_ai_models m on m.id = p.model_id where p.org_id = $1 and p.created_at >= $2 group by 1, 2 order by 1`,
    [ctx.org.id, since],
  );
  const proposals = await ctx.db.query<{ status: string; n: number }>(`select status, count(*)::int as n from sm_ai_actions where org_id = $1 and created_at >= $2 group by 1 order by 1`, [ctx.org.id, since]);
  return { skills: skills.map((s) => ({ ...s, runs: n(s.runs), up: n(s.up), down: n(s.down), with_comment: n(s.with_comment) })), predictions: preds.map((p) => ({ ...p, applied: n(p.applied), auto_applied: n(p.auto_applied), dismissed: n(p.dismissed), agreed: n(p.agreed), outcomes: n(p.outcomes) })), proposals: proposals.map((p) => ({ status: p.status, n: n(p.n) })) };
}

/** What the AI layer refused or held back (data-use policy, guardrails, refusals), newest first. */
export async function guardLog(ctx: Ctx, opts: { kind?: string; limit?: number } = {}): Promise<GuardEntry[]> {
  ctx.need("ai", "full");
  const params: unknown[] = [ctx.org.id];
  const kind = opts.kind ? ` where x.kind = $${params.push(opts.kind)}` : "";
  // the log itself, and the answers a model refused (already in the usage ledger, not written twice)
  const rows = await ctx.db.query<{ id: string; at: string; kind: string; feature: string | null; tables: string[]; user: string | null; detail: string | null }>(
    `select x.id, x.at, x.kind, x.feature, x.tables, u.full_name as user, x.detail from (
       select g.id::text as id, g.at, g.kind, g.feature, g.tables, g.user_id, g.detail from sm_ai_guard_log g where g.org_id = $1
       union all
       select a.id::text, a.created_at, 'refusal', a.feature, '{}'::text[], a.user_id, 'مدل ' || coalesce(a.model, '') || ' از پاسخ امتناع کرد'
         from sm_ai_usage a where a.org_id = $1 and a.error_kind = 'refusal'
     ) x left join sm_users u on u.id = x.user_id${kind}
     order by x.at desc limit ${Math.max(1, Math.min(1000, opts.limit ?? 200))}`,
    params,
  );
  return rows.map((r) => ({ ...r, tables: r.tables ?? [] }));
}

/** Every table with its effective data-use policy (a row, or the default: cloud and the organisation's masking). */
export async function dataPolicies(ctx: Ctx): Promise<DataPolicyRow[]> {
  ctx.need("ai", "full");
  const schema = await orgSchema(ctx);
  const rows = (await list(ctx, AI_DATA_POLICY, { size: 500, total: false })).rows as Record<string, unknown>[];
  const byTable = new Map(rows.map((r) => [String(r.table_key), r]));
  const out: DataPolicyRow[] = [];
  for (const t of TABLES.values()) {
    const def = schema.def(t.key);
    if (!def || def.virtual) continue;
    const r = byTable.get(def.key);
    out.push({
      table: def.key,
      label: def.plural,
      module: def.module,
      // no row: the table's own default (security records are «فقط محلی» or «هرگز» until an AI administrator decides)
      use: (r?.use as DataPolicyRow["use"]) ?? defaultDataUse(def.key),
      pii: (r?.pii as DataPolicyRow["pii"]) ?? "inherit",
      note: (r?.note as string | null) ?? null,
      explicit: !!r,
      rag: !!(def.ai || def.features?.rag),
      id: r ? String(r.id) : null,
      version: r ? Number(r.version) : null,
    });
  }
  return out.sort((a, b) => a.module.localeCompare(b.module) || a.label.localeCompare(b.label, "fa"));
}

/** Set a table's policy (the engine record: history, sync, the admin-only hook). */
export async function saveDataPolicy(ctx: Ctx, input: { table: string; use: string; pii: string; note?: string | null }): Promise<void> {
  ctx.need("ai", "full");
  if (!tableDef(input.table)) throw bad("جدول پیدا نشد");
  const existing = (await list(ctx, AI_DATA_POLICY, { filter: { f: "table_key", op: "eq", v: input.table }, size: 1, total: false })).rows[0] as Record<string, unknown> | undefined;
  const data = { use: input.use, pii: input.pii, note: input.note ?? null };
  if (existing) await update(ctx, AI_DATA_POLICY, String(existing.id), data);
  else await create(ctx, AI_DATA_POLICY, { table_key: input.table, ...data });
}

/** Who stays in the loop: proposals, agents' autonomy and approvers, auto-applied skill fields and model thresholds. */
export async function oversightView(ctx: Ctx): Promise<OversightView> {
  ctx.need("ai", "full");
  const env = await loadEnv(ctx);
  const agents = await ctx.db.query<{ key: string; name: string; autonomy: string; approvers: string[] | null; approver_group_id: string | null; auto_actions: string[] | null }>(
    `select key, name, autonomy, approvers, approver_group_id, auto_actions from sm_ai_agents where org_id = $1 and deleted_at is null and enabled order by name`,
    [ctx.org.id],
  );
  const skills = await ctx.db.query<{ key: string; name: string; auto_apply: string[] | null }>(
    `select key, name, auto_apply from sm_ai_skills where org_id = $1 and deleted_at is null and enabled and jsonb_typeof(auto_apply) = 'array' and jsonb_array_length(auto_apply) > 0 order by name`,
    [ctx.org.id],
  );
  const models = await ctx.db.query<{ key: string; name: string; threshold_apply: number }>(
    `select key, name, threshold_apply::float8 as threshold_apply from sm_ai_models where org_id = $1 and enabled and threshold_apply is not null order by name`,
    [ctx.org.id],
  );
  return {
    proposals_on: env.settings.features.proposals,
    agents: agents.map((a) => ({ key: a.key, name: a.name, autonomy: a.autonomy, approvers: (a.approvers ?? []).length, approver_group: !!a.approver_group_id, auto_actions: a.auto_actions ?? [] })),
    skills_auto_apply: skills.map((s) => ({ key: s.key, name: s.name, fields: s.auto_apply ?? [] })),
    models_auto_apply: models.map((m) => ({ key: m.key, name: m.name, threshold: Number(m.threshold_apply) })),
  };
}

const KIND_LIMITS: Record<string, string[]> = {
  classifier: ["از متن و فیلدهای همان رکورد پیش‌بینی می‌کند و معنا را نمی‌فهمد؛ واژه‌های تازه را نمی‌شناسد", "دسته‌هایی که کمتر از پنج نمونه دارند یاد گرفته نمی‌شوند", "از رکوردهای محرمانه و فضاهای کاری امن یاد نمی‌گیرد"],
  risk: ["احتمال است نه حکم؛ برای تصمیم، عامل‌های «چرا؟» را ببینید", "از گذشتهٔ همین سازمان یاد می‌گیرد و تغییر ناگهانی روال‌ها را دیر می‌بیند"],
  duplicate: ["شباهت واژگانی است، نه معنایی؛ دو رکورد مشابه ممکن است دو مشکل جدا باشند"],
  cluster: ["خوشه‌ها پیشنهادند؛ هر خوشه را پیش از ساخت مسئله بخوانید"],
};

/** Model cards of the classical models and the skills (purpose, data, evaluation, limits, oversight). */
export async function modelCards(ctx: Ctx): Promise<ModelCard[]> {
  ctx.need("ai", "full");
  const out: ModelCard[] = [];
  for (const m of await modelViews(ctx)) {
    const x = (m.metrics ?? {}) as Record<string, unknown>;
    const evaluation =
      m.kind === "classifier"
        ? `دقت ${pct(x.accuracy)}، F1 میانگین ${pct(x.macro_f1)} روی نمونهٔ کنار گذاشته؛ خط پایه ${pct((m.baseline ?? {}).accuracy)}`
        : m.kind === "risk"
          ? `AUC ${num(x.auc)}، مهارت بریر ${num(x.skill)}؛ نرخ پایه ${pct(x.base_rate)}`
          : "بدون آموزش؛ آستانهٔ شباهت قابل تنظیم";
    out.push({
      key: m.key,
      kind: "model",
      name: m.name,
      purpose: m.kind === "classifier" ? `پیشنهاد «${m.target_label ?? m.target}» برای ${m.table_label}` : m.kind === "risk" ? `احتمال ${m.target_label ?? "پیشامد"} برای ${m.table_label}` : `${ML_KIND_LABELS[m.kind]} در ${m.table_label}`,
      data: [`${m.table_label} (${m.training_rows} نمونه در آخرین آموزش)`],
      inputs: m.inputs,
      outputs: m.kind === "classifier" ? "سه مقدار محتمل با اطمینان و واژه‌های اثرگذار" : m.kind === "risk" ? "احتمال و عامل‌های اثرگذار" : "رکوردهای مشابه یا خوشه‌ها",
      evaluation: m.beats_baseline ? evaluation : `${evaluation} — از خط پایه بهتر نیست و به کار نمی‌رود`,
      limitations:
        m.key === "duplicate:kb_article"
          ? ["با بردارهای مدل بردارسازی سازمان کار می‌کند؛ بی آن چیزی پیشنهاد نمی‌دهد", "هر جفت پیشنهاد است و کارشناسان دانش ادغامش را تصمیم می‌گیرند"]
          : (KIND_LIMITS[m.kind] ?? []),
      oversight: m.threshold_apply !== null ? `اعمال خودکار از اطمینان ${pct(m.threshold_apply)}؛ بقیه پیشنهاد است` : "فقط پیشنهاد؛ هر اعمال با دسترسی خود کاربر",
      version: m.version ? String(m.version) : null,
      updated_at: m.trained_at,
    });
  }
  for (const d of builtinSkills()) {
    out.push({
      key: d.key,
      kind: "skill",
      name: d.name,
      purpose: d.description ?? "",
      data: d.tables === "*" ? ["همهٔ جدول‌هایی که اجراکننده می‌خواند"] : (d.tables ?? []).map((t: string) => tableDef(t)?.plural ?? t),
      inputs: [d.target === "record" ? "یک رکورد" : d.target === "text" ? "یک متن" : "پارامترها"],
      outputs: d.output,
      evaluation: "مجموعهٔ ارزیابی در «مهارت‌ها»",
      limitations: ["خروجی پیش‌نویس است و پیش از استفاده باید بازبینی شود", "فقط داده‌ای را می‌بیند که اجراکننده می‌بیند و سیاست دادهٔ جدول اجازه می‌دهد"],
      oversight: "پیشنهاد؛ نوشتن فقط با تأیید یک نفر",
      version: null,
      updated_at: null,
    });
  }
  return out;
}

const pct = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 1000) / 10}٪` : "—");
const num = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 100) / 100) : "—");

/** The audit export: settings, inventory, policies, quality, feedback counts, the guard log and AI changes. */
export async function auditExport(ctx: Ctx, days = 90): Promise<Record<string, unknown>> {
  ctx.need("ai", "full");
  const since = new Date(Date.now() - Math.max(1, Math.min(730, days)) * DAY).toISOString();
  const audit = await ctx.db.query<{ at: string; action: string; entity: string; entity_id: string | null; summary: string; user: string | null }>(
    `select a.at, a.action, a.entity, a.entity_id, a.summary, u.full_name as user from sm_audit a left join sm_users u on u.id = a.user_id
     where a.org_id = $1 and a.at >= $2 and (a.action like 'ai.%' or a.entity like 'ai_%') order by a.at desc limit 5000`,
    [ctx.org.id, since],
  );
  return {
    generated_at: new Date().toISOString(),
    organisation: ctx.org.name,
    period: { from: since, to: new Date().toISOString() },
    overview: await governanceOverview(ctx),
    data_policies: (await dataPolicies(ctx)).filter((p) => p.explicit),
    oversight: await oversightView(ctx),
    quality: await qualityReport(ctx),
    feedback: await feedbackReport(ctx, days),
    usage: await usageReport(ctx, Math.min(days, 366)),
    guard_log: await guardLog(ctx, { limit: 1000 }),
    model_cards: await modelCards(ctx),
    audit,
  };
}
