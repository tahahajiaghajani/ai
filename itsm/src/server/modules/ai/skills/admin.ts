// «تنظیمات ← هوش مصنوعی ← مهارت‌ها» (ai:full): the organisation's skills — enable or switch off, roles, field groups,
// triggers and their condition, limits, auto-apply — the prompt editor with versions (draft → publish, roll back to an
// earlier version or to the built-in default, diff in the UI), copies of a built-in under a key of the organisation's
// own, a test run against a record with the administrator's OWN access, offline evaluation sets with their scores, and
// usage per skill. Built-in rows are seeded idempotently the first time the page is opened (configuration only: the
// prompts stay in code until the organisation publishes its own).
// Also the members' side: their own runs (an AI administrator may list everyone's) and feedback on a run.
import type { Ctx } from "../../../context";
import type {
  SkillAdminItem, SkillAdminView, SkillConfigPatch, SkillEvalCase, SkillEvalView, SkillRunRequest, SkillRunResult, SkillRunView, SkillUsageRow, SkillVersionView,
} from "@shared/ai/skills";
import { SKILL_EVENTS, SKILL_FIELD_GROUPS, SKILL_GROUNDINGS, SKILL_TIERS, SKILL_TRIGGERS, schemaShapeProblem, scoreOutput, templateProblem } from "@shared/ai/skills";
import { AI_SKILL, AI_SKILL_EVAL, AI_SKILL_VERSION } from "@shared/tables/ai";
import { tableDef } from "@shared/tables";
import { builtinRoles } from "@shared/access/builtins";
import { createIn, updateIn } from "../../../engine";
import { bad, conflict, forbidden, notFound } from "../../../http/errors";
import { liveRows, sysOf } from "../../incident/common";
import { listRoles } from "../../../access/service";
import { aiStatus } from "../engine";
import { clearedItems } from "../actions";
import { orgTimeZone } from "../usage";
import { allSkills, resolveSkill, skillRow, versionOf, versionRow, defaultVersion, type ResolvedSkill } from "./config";
import { builtinSkills, isSkillKey, skillDef } from "./registry";
import type { SkillDef } from "./types";
import { runResolved, runSkill } from "./runtime";
import { principalOf, setPrincipal } from "./principal";

type Row = Record<string, unknown>;

function needAdmin(ctx: Ctx) {
  ctx.need("ai", "full");
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** The organisation's row of a built-in skill as first stored: its whole default configuration. */
function seedRowOf(d: SkillDef): Record<string, unknown> {
  return {
    key: d.key,
    name: d.name,
    description: d.description,
    module: d.module,
    base_key: d.key,
    builtin: true,
    enabled: true,
    target: d.target,
    output: d.output,
    tables: d.tables === "*" ? ["*"] : d.tables,
    tier: d.tier,
    grounding: d.grounding?.kind ?? "none",
    grounding_k: d.grounding?.k ?? 5,
    triggers: d.triggers?.length ? d.triggers : ["manual"],
    events: d.events ?? [],
    roles: d.roles ?? [],
    field_groups: d.fieldGroups ?? [],
  };
}

/** Rows for the built-ins the organisation has none of yet (idempotent; configuration only). */
export async function seedSkillRows(ctx: Ctx): Promise<number> {
  const sys = sysOf(ctx);
  const have = new Set((await liveRows(ctx.db, sys, AI_SKILL, null, { limit: 5000 })).map((r) => String(r.key)));
  const missing = builtinSkills().filter((d) => !have.has(d.key));
  if (!missing.length) return 0;
  await sys.write(async (tx) => {
    for (const d of missing) {
      const exists = await tx.one(`select 1 from sm_ai_skills where org_id = $1 and key = $2 and deleted_at is null`, [ctx.org.id, d.key]);
      if (exists) continue;
      await createIn(tx, sys, AI_SKILL, seedRowOf(d), { trusted: true });
    }
  }, { internal: true });
  return missing.length;
}

function versionView(r: Row): SkillVersionView {
  const v = versionOf(r);
  return {
    id: v.id,
    version: v.version,
    state: v.state,
    system: v.system,
    template: v.template,
    output_schema: v.output_schema,
    temperature: v.temperature,
    max_tokens: v.max_tokens,
    note: v.note,
    created_at: (r.created_at as string) ?? null,
    created_by: (r.created_by as string) ?? null,
    published_at: (r.published_at as string) ?? null,
  };
}

function evalView(r: Row): SkillEvalView {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    skill: String(r.skill_key ?? ""),
    cases: Array.isArray(r.cases) ? (r.cases as SkillEvalCase[]) : [],
    last_score: r.last_score === null || r.last_score === undefined ? null : Number(r.last_score),
    last_run_at: (r.last_run_at as string) ?? null,
    last_model: (r.last_model as string) ?? null,
    last_results: Array.isArray(r.last_results) ? (r.last_results as SkillEvalView["last_results"]) : [],
  };
}

/** The admin page: every skill with its configuration, versions, eval sets and 30-day usage. */
export async function adminView(ctx: Ctx): Promise<SkillAdminView> {
  needAdmin(ctx);
  await seedSkillRows(ctx);
  const sys = sysOf(ctx);
  const [skills, versions, evals, usage, principal, roles, model] = await Promise.all([
    allSkills(ctx),
    liveRows(ctx.db, sys, AI_SKILL_VERSION, null, { order: "t.revision desc", limit: 5000 }),
    liveRows(ctx.db, sys, AI_SKILL_EVAL, null, { order: "t.name", limit: 2000 }),
    ctx.db.query<{ skill_key: string; runs: number; up: number; down: number; cost: string }>(
      `select skill_key, count(*)::int as runs, count(*) filter (where feedback = 1)::int as up, count(*) filter (where feedback = -1)::int as down,
              coalesce(sum(case when cost_usd ~ '^[0-9.]+$' then cost_usd::numeric else 0 end), 0)::text as cost
       from sm_ai_skill_runs where org_id = $1 and deleted_at is null and created_at > now() - interval '30 days' group by skill_key`,
      [ctx.org.id],
    ),
    principalOf(ctx.db, ctx.org.id),
    listRoles(ctx).then((r) => r.roles.map((x) => ({ key: x.key, name: x.name }))).catch(() => builtinRoles().map((r) => ({ key: r.key, name: r.name }))),
    aiStatus(ctx, "assistant"),
  ]);
  const byUsage = new Map(usage.map((u) => [u.skill_key, u]));
  const items: SkillAdminItem[] = skills.map((s) => {
    const own = s.row ? versions.filter((v) => v.skill_id === s.row!.id).map(versionView) : [];
    const u = byUsage.get(s.cfg.key);
    return {
      ...s.cfg,
      versions: [...own, { ...versionView({ id: null, revision: 0, state: "default", system: s.def.system, template: s.def.template }), id: null, state: "default", note: "پیش‌فرض داخلی" }],
      evals: evals.filter((e) => e.skill_key === s.cfg.key).map(evalView),
      usage: u ? { runs: u.runs, up: u.up, down: u.down, cost_usd: u.cost } : null,
    };
  });
  items.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name, "fa"));
  return { skills: items, principal, roles, model: { ok: model.ok, message_fa: model.message_fa ?? null } };
}

const PATCHABLE = new Set([
  "name", "description", "enabled", "tables", "tier", "grounding", "grounding_k", "collections", "triggers", "events", "condition", "schedule_minutes", "schedule_filter",
  "roles", "field_groups", "auto_apply", "daily_limit", "user_daily_limit",
]);

/**
 * Change a skill's configuration. A built-in's row is created first with its whole default configuration (roles, field
 * groups, grounding, tier…): a patch of one setting never resets the others to the table's empty defaults.
 */
export async function patchSkill(ctx: Ctx, key: string, patch: SkillConfigPatch): Promise<SkillAdminItem> {
  needAdmin(ctx);
  await seedSkillRows(ctx);
  const rs = await resolveSkill(ctx, key);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!PATCHABLE.has(k)) throw bad(`«${k}» از تنظیمات مهارت نیست`);
    data[k] = v;
  }
  if (data.tier !== undefined && !(String(data.tier) in SKILL_TIERS)) throw bad("ردهٔ مدل معتبر نیست");
  if (data.grounding !== undefined && !(String(data.grounding) in SKILL_GROUNDINGS)) throw bad("منبع پاسخ معتبر نیست");
  if (Array.isArray(data.triggers) && data.triggers.some((t) => !(String(t) in SKILL_TRIGGERS))) throw bad("نوع اجرا معتبر نیست");
  if (Array.isArray(data.events) && data.events.some((t) => !(String(t) in SKILL_EVENTS))) throw bad("رویداد معتبر نیست");
  if (Array.isArray(data.field_groups) && data.field_groups.some((g) => !(SKILL_FIELD_GROUPS as readonly string[]).includes(String(g)))) throw bad("گروه فیلد معتبر نیست؛ «ai_private» هرگز به مدل نمی‌رسد");
  if (Array.isArray(data.auto_apply) && data.auto_apply.length && rs.def.output !== "fields" && rs.def.output !== "journal") throw bad("اعمال خودکار فقط برای پیشنهاد فیلد یا یادداشت داخلی است");
  if (Array.isArray(data.auto_apply) && data.auto_apply.includes("comment")) throw bad("پاسخ به درخواست‌کننده هرگز خودکار فرستاده نمی‌شود");
  // written as the platform on the administrator's behalf (their ai:full was checked above; the history names them):
  // an AI administrator need not also hold an ITSM grant in «ai»
  const sys = sysOf(ctx, ctx.user.id);
  if (rs.row) {
    await sys.write((tx) => updateIn(tx, sys, AI_SKILL, String(rs.row!.id), data, { trusted: true }));
  } else {
    await sys.write((tx) => createIn(tx, sys, AI_SKILL, { ...seedRowOf(rs.def), ...data }, { trusted: true }));
  }
  return (await adminView(ctx)).skills.find((s) => s.key === key)!;
}

/** A new draft version of a skill's prompts (checked: placeholders, output schema). */
export async function saveVersion(ctx: Ctx, key: string, input: { system: string; template: string; output_schema?: unknown; temperature?: number | null; max_tokens?: number | null; note: string }): Promise<SkillVersionView> {
  needAdmin(ctx);
  await seedSkillRows(ctx);
  const rs = await resolveSkill(ctx, key);
  if (!rs.row) throw notFound("مهارت پیدا نشد");
  const firstTable = rs.cfg.tables.find((t) => t !== "*");
  const tdef = firstTable ? tableDef(firstTable) : null;
  const problem = templateProblem(input.template, {
    fields: tdef ? tdef.fields.map((f) => f.name) : undefined,
    facts: rs.def.factKeys ?? [],
    params: (rs.def.params ?? []).map((p) => p.name),
    target: rs.def.target,
  });
  if (problem) throw bad(problem);
  if (!input.system.trim()) throw bad("دستور سامانه را بنویسید");
  if (!input.note.trim()) throw bad("یادداشت تغییر را بنویسید (چه چیزی و چرا)");
  if (input.output_schema !== null && input.output_schema !== undefined) {
    if (rs.def.output === "text" || rs.def.output === "journal") throw bad("خروجی این مهارت متن است و طرح JSON ندارد");
    const sp = schemaShapeProblem(input.output_schema);
    if (sp) throw bad(sp);
  }
  const sys = sysOf(ctx, ctx.user.id);
  const max = await ctx.db.one<{ v: number | null }>(`select max(revision)::int as v from sm_ai_skill_versions where org_id = $1 and skill_id = $2 and deleted_at is null`, [ctx.org.id, rs.row.id]);
  const next = (max?.v ?? 0) + 1;
  const row = await sys.write((tx) =>
    createIn(
      tx,
      sys,
      AI_SKILL_VERSION,
      {
        skill_id: rs.row!.id,
        revision: next,
        label: `${rs.cfg.name} — نسخهٔ ${next}`,
        state: "draft",
        system: input.system.slice(0, 20_000),
        template: input.template.slice(0, 20_000),
        output_schema: input.output_schema ?? null,
        temperature: typeof input.temperature === "number" ? input.temperature : null,
        max_tokens: typeof input.max_tokens === "number" ? input.max_tokens : null,
        note: input.note.trim().slice(0, 300),
      },
      { trusted: true },
    ),
  );
  return versionView(row);
}

/** Publish a version (the earlier published one retires) — or `null`: back to the built-in default prompts. */
export async function publishVersion(ctx: Ctx, key: string, versionId: string | null): Promise<SkillAdminItem> {
  needAdmin(ctx);
  const rs = await resolveSkill(ctx, key);
  if (!rs.row) throw notFound("مهارت پیدا نشد");
  if (versionId) {
    const v = await versionRow(ctx, versionId);
    if (!v || v.skill_id !== rs.row.id) throw notFound("نسخهٔ مهارت پیدا نشد");
  }
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write(async (tx) => {
    const prev = rs.cfg.active_version_id;
    if (prev && prev !== versionId) await updateIn(tx, sys, AI_SKILL_VERSION, prev, { state: "retired" }, { trusted: true });
    if (versionId) await updateIn(tx, sys, AI_SKILL_VERSION, versionId, { state: "published", published_at: new Date().toISOString(), published_by: ctx.user.id }, { trusted: true });
    await updateIn(tx, sys, AI_SKILL, String(rs.row!.id), { active_version_id: versionId }, { trusted: true });
  });
  return (await adminView(ctx)).skills.find((s) => s.key === key)!;
}

/** A copy of a skill under a key of the organisation's own: its configuration and its current prompts as version 1. */
export async function copySkill(ctx: Ctx, key: string, input: { key: string; name: string }): Promise<SkillAdminItem> {
  needAdmin(ctx);
  const rs = await resolveSkill(ctx, key);
  const k = input.key.trim().toLowerCase();
  if (!isSkillKey(k) || !k.includes(".")) throw bad("کلید رونوشت مانند «org.summary» است: حرف لاتین کوچک، رقم، نقطه و _، با دست‌کم یک نقطه");
  if (skillDef(k) || (await skillRow(ctx, k))) throw conflict("مهارتی با این کلید هست");
  if (!input.name.trim()) throw bad("نام مهارت را بنویسید");
  const { key: _k, name: _n, builtin: _b, base_key: _bk, active_version_id: _a, has_fallback: _h, catalog: _c, surfaces: _s, output_fields: _o, module: _m, target: _t, output: _out, ...config } = rs.cfg;
  void _k, _n, _b, _bk, _a, _h, _c, _s, _o, _m, _t, _out;
  const v = rs.version;
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write(async (tx) => {
    const row = await createIn(tx, sys, AI_SKILL, { ...config, key: k, name: input.name.trim(), base_key: rs.def.key, builtin: false, enabled: false }, { trusted: true });
    const ver = await createIn(
      tx,
      sys,
      AI_SKILL_VERSION,
      { skill_id: row.id, revision: 1, label: `${input.name.trim()} — نسخهٔ ۱`, state: "published", system: v.system, template: v.template, output_schema: v.output_schema, temperature: v.temperature, max_tokens: v.max_tokens, note: `رونوشت از «${rs.cfg.name}»`, published_at: new Date().toISOString(), published_by: ctx.user.id },
      { trusted: true },
    );
    await updateIn(tx, sys, AI_SKILL, String(row.id), { active_version_id: ver.id }, { trusted: true });
  });
  return (await adminView(ctx)).skills.find((s) => s.key === k)!;
}

/** A test run with the administrator's own access (a draft version too; a disabled skill too; nothing proposed). */
export async function testRun(ctx: Ctx, key: string, input: SkillRunRequest & { version_id?: string | null }): Promise<SkillRunResult> {
  needAdmin(ctx);
  return runSkill(ctx, key, input, { versionId: input.version_id ?? null, ignoreEnabled: true, propose: false });
}

/** Run a skill's evaluation sets with the organisation's own model and keep the scores (the administrator's access). */
export async function runEvals(ctx: Ctx, key: string, evalId?: string | null): Promise<SkillEvalView[]> {
  needAdmin(ctx);
  const rs = await resolveSkill(ctx, key);
  const sys = sysOf(ctx, ctx.user.id);
  const rows = (await liveRows(ctx.db, sys, AI_SKILL_EVAL, { f: "skill_key", op: "eq", v: key }, { limit: 50 })).filter((r) => !evalId || r.id === evalId);
  if (!rows.length) throw notFound("مجموعهٔ ارزیابی‌ای برای این مهارت نیست");
  const out: SkillEvalView[] = [];
  for (const r of rows) {
    const cases = (Array.isArray(r.cases) ? (r.cases as SkillEvalCase[]) : []).slice(0, 30);
    const results: SkillEvalView["last_results"] = [];
    let model: string | null = null;
    for (const c of cases) {
      try {
        const res = await runResolved(ctx, rs, { table: c.table ?? null, id: c.id ?? null, text: c.text ?? null, params: c.params ?? {} }, { noFallback: true, ephemeral: true, ignoreEnabled: true });
        model = res.model ?? model;
        const { score, checks } = scoreOutput(c.expect ?? {}, { text: res.text ?? res.journal?.body ?? null, json: res.json ?? (res.suggestions.length ? { suggestions: res.suggestions } : null), citations: res.citations.length });
        results.push({ case: c.name, score, checks });
      } catch (e) {
        results.push({ case: c.name, score: 0, checks: [], error: (e as Error).message?.slice(0, 300) ?? "ناموفق" });
      }
    }
    const score = results.length ? Math.round((results.reduce((a, x) => a + x.score, 0) / results.length) * 1000) / 1000 : 0;
    const saved = await sys.write((tx) => updateIn(tx, sys, AI_SKILL_EVAL, String(r.id), { last_score: String(score), last_run_at: new Date().toISOString(), last_model: model, last_results: results }, { trusted: true }), { internal: true });
    out.push(evalView(saved));
  }
  return out;
}

/** Save an evaluation set of a skill (new or changed). */
export async function saveEval(ctx: Ctx, key: string, input: { id?: string | null; name: string; cases: SkillEvalCase[] }): Promise<SkillEvalView> {
  needAdmin(ctx);
  await resolveSkill(ctx, key);
  if (!input.name.trim()) throw bad("نام مجموعهٔ ارزیابی را بنویسید");
  if (!input.cases.length) throw bad("دست‌کم یک نمونه بنویسید");
  const sys = sysOf(ctx, ctx.user.id);
  const row = await sys.write((tx) =>
    input.id
      ? updateIn(tx, sys, AI_SKILL_EVAL, input.id, { name: input.name.trim(), cases: input.cases }, { trusted: true })
      : createIn(tx, sys, AI_SKILL_EVAL, { skill_key: key, name: input.name.trim(), cases: input.cases }, { trusted: true }),
  );
  return evalView(row);
}

/** Usage per skill between two days (runs of this runtime: runs, errors, rule-based answers, feedback, tokens, cost). */
export async function usageRows(ctx: Ctx, from: string, to: string): Promise<SkillUsageRow[]> {
  needAdmin(ctx);
  const tz = orgTimeZone(ctx);
  const rows = await ctx.db.query<Row>(
    `select skill_key, count(*)::int as runs, count(*) filter (where status = 'error')::int as errors, count(*) filter (where status = 'fallback')::int as fallbacks,
            count(*) filter (where feedback = 1)::int as up, count(*) filter (where feedback = -1)::int as down,
            coalesce(sum(tokens_in), 0)::int as tokens_in, coalesce(sum(tokens_out), 0)::int as tokens_out,
            coalesce(sum(case when cost_usd ~ '^[0-9.]+$' then cost_usd::numeric else 0 end), 0)::text as cost_usd,
            coalesce(avg(latency_ms), 0)::int as avg_ms
     from sm_ai_skill_runs
     where org_id = $1 and deleted_at is null and created_at >= ($2::date)::timestamp at time zone $4 and created_at < (($3::date) + 1)::timestamp at time zone $4
     group by skill_key order by count(*) desc`,
    [ctx.org.id, from, to, tz],
  );
  const names = new Map((await allSkills(ctx)).map((s) => [s.cfg.key, s.cfg.name]));
  return rows.map((r) => ({
    skill: String(r.skill_key),
    name: names.get(String(r.skill_key)) ?? String(r.skill_key),
    runs: num(r.runs),
    errors: num(r.errors),
    fallbacks: num(r.fallbacks),
    up: num(r.up),
    down: num(r.down),
    tokens_in: num(r.tokens_in),
    tokens_out: num(r.tokens_out),
    cost_usd: String(r.cost_usd ?? "0"),
    avg_ms: num(r.avg_ms),
  }));
}

// ---------------------------------------------------------------- runs (their authors; AI administrators)

const RUN_COLS = `r.id, r.skill_key, r.table_key, r.record_id, r.record_number, r.status, r.output_kind, r.output_text, r.output_json, r.citations, r.clearance, r.model,
  r.tokens_in, r.tokens_out, r.cost_usd, r.latency_ms, r.error, r.principal, r.invoker_id, r.feedback, r.feedback_comment, r.created_at, u.full_name as invoker_name`;

/**
 * Runs as their author sees them: one's own (of a record, or all); an AI administrator may ask for everyone's (the
 * governance view). Nobody else ever reads a run — the generic record API holds the same rule. A run's output (its
 * text, structured answer, sources, record and the feedback's comment) is shown only while the caller may read its
 * record and everything it read (`clearance`, checked like a proposal's) — otherwise only its metadata (skill, status,
 * model, tokens, cost, time, the rating), `restricted`. A run stored before runs kept what they read shows its output
 * only to its author.
 */
export async function listRuns(ctx: Ctx, opts: { table?: string | null; id?: string | null; all?: boolean; limit?: number }): Promise<SkillRunView[]> {
  ctx.need("ai", "view");
  const params: unknown[] = [ctx.org.id];
  let where = `r.org_id = $1 and r.deleted_at is null`;
  if (!(opts.all && ctx.can("ai", "full"))) {
    params.push(ctx.user.id);
    where += ` and r.invoker_id = $${params.length}`;
  }
  if (opts.table) {
    params.push(opts.table);
    where += ` and r.table_key = $${params.length}`;
  }
  if (opts.id) {
    params.push(opts.id);
    where += ` and r.record_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(opts.limit ?? 30, 1), 200));
  const rows = await ctx.db.query<Row>(`select ${RUN_COLS} from sm_ai_skill_runs r left join sm_users u on u.id = r.invoker_id where ${where} order by r.created_at desc limit $${params.length}`, params);
  const names = new Map((await allSkills(ctx)).map((s) => [s.cfg.key, s.cfg.name]));
  const mine = new Set(rows.filter((r) => String(r.invoker_id) === ctx.user.id).map((r) => String(r.id)));
  const cleared = await clearedItems(
    ctx,
    rows.map((r) => ({
      key: String(r.id),
      table: r.record_id ? String(r.table_key ?? "") : null,
      id: r.record_id ? String(r.record_id) : null,
      tokens: Array.isArray(r.clearance) ? (r.clearance as unknown[]).filter((x): x is string => typeof x === "string") : null,
    })),
    (it) => mine.has(it.key),
  );
  return rows.map((r) => {
    const shown = cleared.has(String(r.id));
    return {
      id: String(r.id),
      skill: String(r.skill_key),
      name: names.get(String(r.skill_key)) ?? String(r.skill_key),
      table: (r.table_key as string) ?? null,
      record_id: shown ? ((r.record_id as string) ?? null) : null,
      number: shown ? ((r.record_number as string) ?? null) : null,
      status: (r.status as SkillRunView["status"]) ?? "ok",
      output: (r.output_kind as SkillRunView["output"]) ?? "text",
      text: shown ? ((r.output_text as string) ?? null) : null,
      json: shown ? (r.output_json ?? null) : null,
      citations: shown && Array.isArray(r.citations) ? (r.citations as SkillRunView["citations"]) : [],
      model: (r.model as string) ?? null,
      tokens_in: num(r.tokens_in),
      tokens_out: num(r.tokens_out),
      cost_usd: (r.cost_usd as string) ?? null,
      latency_ms: num(r.latency_ms),
      error: (r.error as string) ?? null,
      principal: r.principal === "service" ? "service" : "person",
      invoker: { id: String(r.invoker_id), name: (r.invoker_name as string) ?? null },
      feedback: r.feedback === 1 || r.feedback === -1 ? (r.feedback as 1 | -1) : null,
      feedback_comment: shown ? ((r.feedback_comment as string) ?? null) : null,
      created_at: String(r.created_at),
      restricted: !shown,
    };
  });
}

/** 👍/👎 and a comment on a run (its author only). */
export async function rateRun(ctx: Ctx, runId: string, rating: 1 | -1 | null, comment?: string | null): Promise<{ ok: true }> {
  ctx.need("ai", "view");
  const r = await ctx.db.one<{ id: string; invoker_id: string }>(`select id, invoker_id from sm_ai_skill_runs where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, runId]);
  if (!r || r.invoker_id !== ctx.user.id) throw notFound("اجرای مهارت پیدا نشد");
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write((tx) => updateIn(tx, sys, "ai_skill_run", runId, { feedback: rating, feedback_comment: comment?.trim().slice(0, 1000) || null }, { trusted: true }), { internal: true });
  return { ok: true };
}

/** The service member's roles (an owner sets them: nobody grants roles above their own). */
export async function savePrincipal(ctx: Ctx, input: { roles: string[]; active?: boolean }) {
  needAdmin(ctx);
  if (ctx.member.role !== "owner") throw forbidden("نقش‌های حساب دستیار هوش مصنوعی را مالک سازمان تعیین می‌کند");
  return setPrincipal(ctx, input);
}

export { defaultVersion, type ResolvedSkill };
