// The agent studio («تنظیمات ← هوش مصنوعی ← عامل‌ها», docs/spec/AI.md §11.8): agents and their principals, the tool
// picker, the test console (a dry run on a chosen record, the record as the administrator and as the principal read
// it, side by side), runs with their steps, the organisation's kill switch — AI administrators only (`ai:full`); the
// principal's roles only by an owner (through the access service: nobody grants roles above their own). Members start
// agents by hand or from a conversation (`startAgent`) when the agent's roles allow them and they read the record.
import type { Ctx, ServerConfig } from "../../../context";
import type {
  AgentAccessView, AgentAdminItem, AgentAdminView, AgentCard, AgentConfig, AgentConfigPatch, AgentPrincipalView, AgentRunStatus, AgentRunView, AgentStartResult,
  AgentStep, AgentTestResult, AgentToolOption,
} from "@shared/ai/agents";
import { isAgentKey, skillToolName, toolAllowed } from "@shared/ai/agents";
import { AI_AGENT } from "@shared/tables/ai-agents";
import { builtinRoles } from "@shared/access/builtins";
import { createIn, get, orgSchema, removeIn, updateIn } from "../../../engine";
import { bad, forbidden, notFound } from "../../../http/errors";
import { sysOf } from "../../incident/common";
import { listRoles } from "../../../access/service";
import { aiStatus } from "../engine";
import { orgTimeZone } from "../usage";
import { loadSettings, saveSettings } from "../settings";
import { toolCatalog } from "../tools";
import { shapeRow, shownFields } from "../tools/fields";
import { allSkills } from "../skills";
import { callerRoles, rolesAllow } from "../skills/runtime";
import { principalCtx, principalOf, setPrincipal } from "../skills/principal";
import { agentRow, agentRows, configOf, resetAgentRow, seedAgentRows } from "./config";
import { agentDef } from "./registry";
import { queueAgentRun, runInline, runsToday, stopRun } from "./runtime";
import { toolNamesFor } from "./tools";
import { agentsOn, isServiceMember } from "./triggers";
import { tableDef } from "@shared/tables";
import { grantIn } from "@shared/access/model";
import { prepareSubject, subjectOf } from "../../../access";
import { access } from "../../../access/provider";
import { liveRow } from "../../incident/common";

type Row = Record<string, unknown>;

function needAdmin(ctx: Ctx) {
  ctx.need("ai", "full");
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

async function principalView(ctx: Ctx, key: string): Promise<AgentPrincipalView> {
  const p = await principalOf(ctx.db, ctx.org.id, key);
  return { user_id: p.user_id, name: p.name, roles: p.roles, active: p.active };
}

/** The studio's list: every agent (built-ins seeded switched off), its principal, today's runs, its last run, open proposals. */
export async function agentsAdminView(ctx: Ctx): Promise<AgentAdminView> {
  needAdmin(ctx);
  await seedAgentRows(ctx);
  const [rows, roles, model, settings, open, last] = await Promise.all([
    agentRows(ctx.cfg, ctx.org.id),
    listRoles(ctx).then((r) => r.roles.map((x) => ({ key: x.key, name: x.name }))).catch(() => builtinRoles().map((r) => ({ key: r.key, name: r.name }))),
    aiStatus(ctx, "assistant"),
    loadSettings(ctx.db, ctx.org.id),
    ctx.db.query<{ agent_id: string; n: number }>(`select agent_id, count(*)::int as n from sm_ai_actions where org_id = $1 and agent_id is not null and status = 'proposed' and expires_at > now() group by agent_id`, [ctx.org.id]),
    ctx.db.query<{ agent_key: string; id: string; status: AgentRunStatus; at: string | null }>(
      `select distinct on (agent_key) agent_key, id, status, coalesce(ended_at, started_at, created_at)::text as at from sm_ai_agent_runs where org_id = $1 and deleted_at is null order by agent_key, created_at desc`,
      [ctx.org.id],
    ),
  ]);
  const openBy = new Map(open.map((o) => [o.agent_id, o.n]));
  const lastBy = new Map(last.map((l) => [l.agent_key, l]));
  const agents: AgentAdminItem[] = [];
  for (const r of rows) {
    const c = configOf(r);
    const l = lastBy.get(c.key);
    agents.push({
      ...c,
      principal: await principalView(ctx, c.key),
      runs_today: await runsToday(ctx, c.key),
      last_run: l ? { id: l.id, status: l.status, at: l.at } : null,
      open_proposals: openBy.get(c.id ?? "") ?? 0,
    });
  }
  return { agents, agents_on: settings.enabled && settings.features.agents, roles, ai: { ok: model.ok, ...(model.message_fa ? { message_fa: model.message_fa } : {}) } };
}

async function needAgent(ctx: Ctx, key: string): Promise<Row> {
  const row = await agentRow(ctx, key);
  if (!row) throw notFound("عامل پیدا نشد");
  return row;
}

async function itemOf(ctx: Ctx, key: string): Promise<AgentAdminItem> {
  const item = (await agentsAdminView(ctx)).agents.find((a) => a.key === key);
  if (!item) throw notFound("عامل پیدا نشد");
  return item;
}

const PATCHABLE = new Set<keyof AgentConfigPatch>([
  "name", "description", "enabled", "goal", "tables", "triggers", "events", "condition", "schedule_minutes", "schedule_filter", "tools", "autonomy", "auto_actions",
  "approvers", "approver_group_id", "tier", "max_steps", "max_tokens", "max_actions", "daily_runs", "forbidden_tables", "forbidden_fields", "forbidden_states", "roles", "field_groups",
]);

/** Change an agent (the table's hook checks the whole configuration). An agent is switched on only with a principal. */
export async function patchAgent(ctx: Ctx, key: string, patch: AgentConfigPatch): Promise<AgentAdminItem> {
  needAdmin(ctx);
  const row = await needAgent(ctx, key);
  const data: Row = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!PATCHABLE.has(k as keyof AgentConfigPatch)) throw bad(`«${k}» از تنظیمات عامل نیست`);
    data[k] = v;
  }
  if (data.enabled === true) {
    const p = await principalOf(ctx.db, ctx.org.id, key);
    if (!p.user_id || !p.active) throw bad("پیش از روشن کردن عامل، مالک سازمان باید برایش هویت با نقش‌های لازم بسازد");
  }
  // written as the platform on the administrator's behalf (their ai:full was checked above; the history names them)
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write((tx) => updateIn(tx, sys, AI_AGENT, String(row.id), data, { trusted: true }));
  return itemOf(ctx, key);
}

/** A new agent of the organisation's own: blank, or a copy of another agent's configuration (switched off). */
export async function createAgent(ctx: Ctx, input: { key: string; name: string; from?: string | null }): Promise<AgentAdminItem> {
  needAdmin(ctx);
  if (!isAgentKey(input.key)) throw bad("کلید عامل باید با حرف لاتین کوچک شروع شود و فقط حرف، رقم، نقطه و _ داشته باشد");
  await seedAgentRows(ctx);
  if (await agentRow(ctx, input.key)) throw bad("عاملی با این کلید هست");
  const base = input.from ? await needAgent(ctx, input.from) : null;
  const cfg: Partial<AgentConfig> = base
    ? configOf(base)
    : { goal: "هدف و دستورالعمل عامل را اینجا بنویسید: چه بخواند، چه پیشنهاد کند و گزارش پایانی‌اش چه باشد.", tables: [], triggers: ["manual"], events: [], tools: ["search_knowledge"], autonomy: "suggest", auto_actions: [] };
  const { id: _id, principal_id: _p, builtin: _b, base_key: _bk, key: _k, ...rest } = cfg as AgentConfig;
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write((tx) => createIn(tx, sys, AI_AGENT, { ...rest, key: input.key, name: input.name.trim().slice(0, 120), base_key: base ? String(base.base_key ?? base.key) : null, builtin: false, enabled: false, module: rest.module ?? "ai" }, { trusted: true }));
  return itemOf(ctx, input.key);
}

/** Delete an agent of the organisation's own (a built-in is switched off instead). Its principal is switched off too. */
export async function deleteAgent(ctx: Ctx, key: string): Promise<{ ok: true }> {
  needAdmin(ctx);
  const row = await needAgent(ctx, key);
  if (row.builtin === true) throw bad("عامل داخلی حذف نمی‌شود؛ آن را خاموش کنید");
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write((tx) => removeIn(tx, sys, AI_AGENT, String(row.id)));
  const p = await principalOf(ctx.db, ctx.org.id, key);
  if (p.user_id && p.active && ctx.member.role === "owner") await setPrincipal(ctx, { roles: p.roles, active: false, name: `عامل: ${String(row.name)}` }, key).catch(() => undefined);
  return { ok: true };
}

/** «بازگشت به پیش‌فرض»: a built-in agent's goal, tools, triggers, autonomy, budgets and guardrails from its code. */
export async function resetAgent(ctx: Ctx, key: string): Promise<AgentAdminItem> {
  needAdmin(ctx);
  const row = await needAgent(ctx, key);
  if (!agentDef(String(row.base_key ?? row.key))) throw bad("این عامل پیش‌فرضی در برنامه ندارد");
  await resetAgentRow(ctx, row);
  return itemOf(ctx, key);
}

/**
 * The agent's principal: a service member of its own («عامل: <name>»), created on first use, its ITSM roles set through
 * the access service — only an owner, never above their own roles. `active: false` switches it off (a kill switch).
 */
export async function saveAgentPrincipal(ctx: Ctx, key: string, input: { roles: string[]; active?: boolean }): Promise<AgentAdminItem> {
  needAdmin(ctx);
  if (ctx.member.role !== "owner") throw forbidden("نقش‌های هویت عامل را مالک سازمان تعیین می‌کند");
  const row = await needAgent(ctx, key);
  const p = await setPrincipal(ctx, { roles: input.roles, active: input.active, name: `عامل: ${String(row.name)}` }, key);
  const sys = sysOf(ctx, ctx.user.id);
  if (p.user_id && p.user_id !== row.principal_id) await sys.write((tx) => updateIn(tx, sys, AI_AGENT, String(row.id), { principal_id: p.user_id }, { trusted: true }));
  return itemOf(ctx, key);
}

/** The organisation's kill switch for every agent (this runtime's AI settings «عامل‌ها»). */
export async function setAgentsSwitch(ctx: Ctx, on: boolean): Promise<{ agents_on: boolean }> {
  needAdmin(ctx);
  const s = await saveSettings(ctx, { features: { agents: on } });
  return { agents_on: s.enabled && s.features.agents };
}

/** The tool picker: every generated and registered tool, the skills, and whether the agent's principal may use each now. */
export async function agentToolOptions(ctx: Ctx, key: string): Promise<AgentToolOption[]> {
  needAdmin(ctx);
  await needAgent(ctx, key);
  const pctx = await principalCtx(ctx.cfg as ServerConfig, ctx.org.id, key);
  const { available, all } = await toolNamesFor(pctx, ctx);
  const out: AgentToolOption[] = all.map((t) => ({ name: t.name, title_fa: t.title_fa, kind: t.kind, table: t.table, available: available.has(t.name) }));
  for (const s of await allSkills(ctx)) {
    if (!s.cfg.enabled) continue;
    out.push({ name: `skill:${s.cfg.key}`, title_fa: `مهارت «${s.cfg.name}»`, kind: "meta", table: null, available: !!pctx });
  }
  return out.sort((a, b) => (a.table ?? "").localeCompare(b.table ?? "") || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- runs

async function names(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!uniq.length) return new Map();
  const rows = await ctx.db.query<{ id: string; full_name: string | null }>(`select id, full_name from sm_users where id = any($1::uuid[])`, [`{${uniq.join(",")}}`]);
  return new Map(rows.map((r) => [r.id, r.full_name ?? ""]));
}

function runView(r: Row, who: Map<string, string>, full: boolean): AgentRunView {
  const by = typeof r.started_by === "string" ? r.started_by : null;
  const pr = typeof r.principal_id === "string" ? r.principal_id : null;
  return {
    id: String(r.id),
    agent_id: typeof r.agent_id === "string" ? r.agent_id : null,
    agent_key: String(r.agent_key ?? ""),
    agent_name: String(r.agent_name ?? ""),
    trigger: String(r.trigger ?? "manual") as AgentRunView["trigger"],
    why: typeof r.why === "string" ? r.why : null,
    started_by: by ? { id: by, name: who.get(by) ?? null } : null,
    principal: pr ? { id: pr, name: who.get(pr) ?? null } : null,
    table: typeof r.table_key === "string" ? r.table_key : null,
    record_id: typeof r.record_id === "string" ? r.record_id : null,
    record_number: typeof r.record_number === "string" ? r.record_number : null,
    status: String(r.status ?? "queued") as AgentRunStatus,
    dry_run: r.dry_run === true,
    // the steps and the report hold what the principal read: AI administrators only
    steps: full && Array.isArray(r.steps) ? (r.steps as AgentStep[]) : [],
    step_count: num(r.step_count),
    tool_calls: num(r.tool_calls),
    actions: num(r.actions),
    applied: num(r.applied),
    proposals: Array.isArray(r.proposals) ? (r.proposals as string[]) : [],
    tokens_in: num(r.tokens_in),
    tokens_out: num(r.tokens_out),
    cost_usd: typeof r.cost_usd === "string" ? r.cost_usd : null,
    outcome: full && typeof r.outcome === "string" ? r.outcome : null,
    error: typeof r.error === "string" ? r.error : null,
    started_at: typeof r.started_at === "string" ? r.started_at : r.started_at instanceof Date ? r.started_at.toISOString() : null,
    ended_at: typeof r.ended_at === "string" ? r.ended_at : r.ended_at instanceof Date ? r.ended_at.toISOString() : null,
  };
}

const RUN_COLS = `id, agent_id, agent_key, agent_name, trigger, why, started_by, principal_id, table_key, record_id, record_number, status, dry_run, steps, step_count, tool_calls,
  actions, applied, proposals, tokens_in, tokens_out, cost_usd, outcome, error, started_at::text as started_at, ended_at::text as ended_at, created_at`;

/** Runs, newest first: an AI administrator's (every run, steps included) or a member's own starts (status only). */
export async function listAgentRuns(ctx: Ctx, opts: { agent?: string | null; status?: string | null; table?: string | null; id?: string | null; limit?: number }): Promise<AgentRunView[]> {
  ctx.need("ai", "view");
  const admin = ctx.can("ai", "full");
  const params: unknown[] = [ctx.org.id];
  let where = `org_id = $1 and deleted_at is null`;
  if (!admin) {
    params.push(ctx.user.id);
    where += ` and started_by = $${params.length}`;
  }
  for (const [col, v] of [["agent_key", opts.agent], ["status", opts.status], ["table_key", opts.table], ["record_id", opts.id]] as const) {
    if (!v) continue;
    params.push(v);
    where += ` and ${col} = $${params.length}`;
  }
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const rows = await ctx.db.query<Row>(`select ${RUN_COLS} from sm_ai_agent_runs where ${where} order by created_at desc limit $${params.length}`, params);
  const who = await names(ctx, rows.flatMap((r) => [r.started_by, r.principal_id].filter((x): x is string => typeof x === "string")));
  // the list never carries steps (one run's page does)
  return rows.map((r) => ({ ...runView(r, who, admin), steps: [] }));
}

/** One run: everything for an AI administrator, the status and its proposals for the member who started it. */
export async function agentRun(ctx: Ctx, id: string): Promise<AgentRunView> {
  ctx.need("ai", "view");
  const r = await ctx.db.one<Row>(`select ${RUN_COLS} from sm_ai_agent_runs where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, id]);
  const admin = ctx.can("ai", "full");
  if (!r || (!admin && r.started_by !== ctx.user.id)) throw notFound("اجرای عامل پیدا نشد");
  const who = await names(ctx, [r.started_by, r.principal_id].filter((x): x is string => typeof x === "string"));
  return runView(r, who, admin);
}

export async function stopAgentRun(ctx: Ctx, id: string): Promise<AgentRunView> {
  needAdmin(ctx);
  await stopRun(ctx.cfg as ServerConfig, ctx.org.id, id);
  return agentRun(ctx, id);
}

// ---------------------------------------------------------------- the test console

/** A record as one person reads it: labels → values (null when they cannot read it). */
async function readAs(ctx: Ctx, table: string, id: string): Promise<Record<string, string> | null> {
  const schema = await orgSchema(ctx);
  const def = schema.def(table);
  if (!def) return null;
  const r = await get(ctx, table, id).catch(() => null);
  if (!r) return null;
  const fields = shownFields(ctx, def);
  const shaped = shapeRow(schema, def, r.row, r.display, orgTimeZone(ctx), fields);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(shaped)) {
    if (k === "id") continue;
    const label = def.fields.find((f) => f.name === k)?.label ?? k;
    out[label] = v === null || v === undefined ? "—" : Array.isArray(v) ? v.join("، ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

async function accessView(ctx: Ctx, name: string, a: AgentConfig, record: { table: string; id: string } | null): Promise<AgentAccessView> {
  const { registered, generated } = await toolCatalog(ctx, { proposals: true });
  const allowed = [...registered.map((t) => ({ name: t.name, kind: t.kind })), ...generated.map((e) => ({ name: e.name, kind: e.kind }))].filter((t) => toolAllowed(a.tools, t.name));
  return {
    name,
    record: record ? await readAs(ctx, record.table, record.id) : null,
    tools: allowed.length + a.tools.filter((t) => t.startsWith("skill:")).length,
    writes: allowed.filter((t) => t.kind === "propose").length,
  };
}

/**
 * A dry run on a chosen record (or none): the agent runs as its principal exactly as it would — tools, guardrails,
 * budgets — but nothing is stored as a proposal and nothing is applied. Shows the record as the administrator and as
 * the principal read it, side by side.
 */
export async function testAgent(ctx: Ctx, key: string, input: { table?: string | null; id?: string | null }): Promise<AgentTestResult> {
  needAdmin(ctx);
  const row = await needAgent(ctx, key);
  const a = configOf(row);
  const record = input.table && input.id ? { table: input.table, id: input.id } : null;
  const admin = await accessView(ctx, ctx.user.full_name || "شما", a, record);
  const pctx = await principalCtx(ctx.cfg as ServerConfig, ctx.org.id, key);
  if (!pctx) return { admin, principal: null, run: null, problem: "این عامل هنوز هویت ندارد؛ مالک سازمان باید برایش نقش تعیین کند" };
  const principal = await accessView(pctx, pctx.user.full_name || a.name, a, record);
  // the console never shows the administrator what only the principal reads: values of fields the administrator does
  // not see are masked (the labels still show which fields the principal reads), and a record the administrator
  // cannot read is not tested
  if (record && !admin.record) return { admin, principal: { ...principal, record: principal.record ? {} : null }, run: null, problem: "این رکورد را خودتان نمی‌بینید؛ آزمون روی رکوردی انجام می‌شود که خودتان هم ببینید" };
  if (principal.record && admin.record) {
    for (const k of Object.keys(principal.record)) if (!(k in admin.record)) principal.record[k] = "••• (فقط هویت عامل می‌بیند)";
  }
  if (record && !principal.record) return { admin, principal, run: null, problem: "هویت عامل این رکورد را نمی‌بیند؛ اجرای واقعی روی آن انجام نمی‌شود" };
  if (!(await agentsOn(ctx.cfg as ServerConfig, ctx.org.id))) return { admin, principal, run: null, problem: "عامل‌های هوش مصنوعی در تنظیمات سازمان خاموش‌اند" };
  const q = await queueAgentRun(ctx.cfg as ServerConfig, ctx.org.id, a, { trigger: "test", why: "test", table: record?.table ?? null, id: record?.id ?? null, startedBy: ctx.user.id, dry: true, inline: true });
  if (!q.run_id) return { admin, principal, run: null, problem: q.message_fa };
  await runInline(ctx.cfg as ServerConfig, ctx.org.id, q.run_id);
  return { admin, principal, run: await agentRun(ctx, q.run_id), problem: null };
}

// ---------------------------------------------------------------- members start agents

/** Does the member work (write beyond their own records) one of these tables? */
async function worksTables(ctx: Ctx, tables: string[]): Promise<boolean> {
  await prepareSubject(ctx, ctx.db);
  const eff = subjectOf(ctx).eff;
  return tables.some((t) => {
    const def = tableDef(t);
    const w = def ? grantIn(eff, def.area).write : "none";
    return w === "group" || w === "all";
  });
}

/** Does the member work this record: full write on it (never a requester's own fields, never only reading it)? */
async function worksRecord(ctx: Ctx, table: string, id: string): Promise<boolean> {
  const def = tableDef(table);
  if (!def || def.virtual) return false;
  const row = await liveRow(ctx.db, ctx, table, id);
  if (!row) return false;
  await prepareSubject(ctx, ctx.db);
  const prov = access();
  return (prov.writeMode ? prov.writeMode(ctx, def, row) : prov.canWrite(ctx, def, row) ? "full" : null) === "full";
}

/**
 * May this member start the agent (by hand or from a conversation)? Never an AI service member (agents do not start
 * agents). AI administrators may; an agent naming roles, the members holding one; an agent naming none (the built-in
 * ones and their copies), only the members who work its record — full write on it — or, without a record, who write
 * one of its tables beyond their own records. A requester never starts one on their own ticket.
 */
async function mayStart(ctx: Ctx, a: ReturnType<typeof configOf>, record: { table: string; id: string } | null, roles?: string[]): Promise<boolean> {
  if (await isServiceMember(ctx.cfg as ServerConfig, ctx.user.id)) return false;
  if (ctx.can("ai", "full")) return true;
  const mine = roles ?? (await callerRoles(ctx));
  if (a.roles.length) return rolesAllow({ roles: a.roles }, mine);
  if (mine.includes("tenant_admin")) return true;
  if (record) return worksRecord(ctx, record.table, record.id);
  return worksTables(ctx, a.tables);
}

/** Agents a member may start on a record now (by hand / from a conversation): switched on, they may start them. */
export async function agentsForRecord(ctx: Ctx, table: string | null, how: "manual" | "conversation" = "manual"): Promise<AgentCard[]> {
  ctx.need("ai", "view");
  const roles = await callerRoles(ctx);
  const out: AgentCard[] = [];
  for (const a of (await agentRows(ctx.cfg, ctx.org.id)).map(configOf)) {
    if (!a.enabled || !a.triggers.includes(how) || (table ? !(a.tables.includes(table) || !a.tables.length) : false)) continue;
    // on a page of a table: who works that table; elsewhere: who works one of the agent's tables
    const ok = await mayStart(ctx, a.roles.length || !table ? a : { ...a, tables: [table] }, null, roles);
    if (ok) out.push({ key: a.key, name: a.name, description: a.description, autonomy: a.autonomy });
  }
  return out;
}

/** Start an agent by hand or from a conversation: it runs in the background as its principal; its proposals reach the record's people. */
export async function startAgent(ctx: Ctx, key: string, input: { table?: string | null; id?: string | null; how?: "manual" | "conversation" }): Promise<AgentStartResult> {
  ctx.need("ai", "view");
  const how = input.how ?? "manual";
  const row = await agentRow(ctx, key);
  const a = row ? configOf(row) : null;
  if (!a || !a.enabled || !a.triggers.includes(how)) throw notFound("این عامل پیدا نشد یا آغاز آن از اینجا ممکن نیست");
  if (!(await agentsOn(ctx.cfg as ServerConfig, ctx.org.id))) throw forbidden("عامل‌های هوش مصنوعی در تنظیمات سازمان خاموش‌اند");
  const record = input.table && input.id ? { table: input.table, id: input.id } : null;
  if (record) {
    if (a.tables.length && !a.tables.includes(record.table)) throw bad(`عامل «${a.name}» روی این جدول کار نمی‌کند`);
    await get(ctx, record.table, record.id); // 404 unless the member reads the record
  }
  if (!(await mayStart(ctx, a, record))) throw forbidden(`اجازهٔ آغاز عامل «${a.name}»${record ? " روی این رکورد" : ""} را ندارید`);
  return queueAgentRun(ctx.cfg as ServerConfig, ctx.org.id, a, { trigger: how, why: how, table: input.table ?? null, id: input.id ?? null, startedBy: ctx.user.id });
}

export { skillToolName };
