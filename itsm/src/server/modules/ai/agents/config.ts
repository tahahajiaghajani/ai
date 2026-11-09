// An organisation's agents (docs/spec/AI.md §11.8): the `ai_agent` rows, read as `AgentConfig`. Built-in agents are
// seeded from their code definitions switched off (idempotent); a row is the whole configuration from then on. Reads go
// through the system context of the organisation (the studio checks ai:full; triggers and runs check the agent and its
// principal themselves).
import type { Ctx, ServerConfig } from "../../../context";
import type { AgentAutonomy, AgentConfig, AgentTrigger } from "@shared/ai/agents";
import { AGENT_BUDGET_DEFAULTS } from "@shared/ai/agents";
import type { SkillEventKind, SkillTier } from "@shared/ai/skills";
import { AI_AGENT } from "@shared/tables/ai-agents";
import { createIn, systemCtx, updateIn } from "../../../engine";
import { liveRows, sysOf } from "../../incident/common";
import { agentDef, builtinAgents, type AgentDef } from "./registry";

type Row = Record<string, unknown>;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : d);
const cond = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** A row as the agent's configuration (defaults for what an older row lacks). */
export function configOf(row: Row): AgentConfig {
  return {
    id: typeof row.id === "string" ? row.id : null,
    key: String(row.key ?? ""),
    name: String(row.name ?? row.key ?? ""),
    description: String(row.description ?? ""),
    module: String(row.module ?? "ai"),
    builtin: row.builtin === true,
    base_key: typeof row.base_key === "string" ? row.base_key : null,
    enabled: row.enabled === true,
    goal: String(row.goal ?? ""),
    tables: strings(row.tables),
    triggers: strings(row.triggers) as AgentTrigger[],
    events: strings(row.events) as SkillEventKind[],
    condition: cond(row.condition),
    schedule_minutes: row.schedule_minutes === null || row.schedule_minutes === undefined ? null : int(row.schedule_minutes, 60),
    schedule_filter: cond(row.schedule_filter),
    tools: strings(row.tools),
    autonomy: (["suggest", "approve", "auto"].includes(String(row.autonomy)) ? row.autonomy : "suggest") as AgentAutonomy,
    auto_actions: strings(row.auto_actions),
    approvers: strings(row.approvers),
    approver_group_id: typeof row.approver_group_id === "string" ? row.approver_group_id : null,
    tier: (["fast", "standard", "reasoning"].includes(String(row.tier)) ? row.tier : "standard") as SkillTier,
    max_steps: int(row.max_steps, AGENT_BUDGET_DEFAULTS.max_steps),
    max_tokens: int(row.max_tokens, AGENT_BUDGET_DEFAULTS.max_tokens),
    max_actions: int(row.max_actions, AGENT_BUDGET_DEFAULTS.max_actions),
    daily_runs: int(row.daily_runs, AGENT_BUDGET_DEFAULTS.daily_runs),
    forbidden_tables: strings(row.forbidden_tables),
    forbidden_fields: strings(row.forbidden_fields),
    forbidden_states: strings(row.forbidden_states),
    roles: strings(row.roles),
    field_groups: strings(row.field_groups),
    principal_id: typeof row.principal_id === "string" ? row.principal_id : null,
  };
}

/** The row values of a code definition (seeding, «بازگشت به پیش‌فرض»). */
export function defRow(d: AgentDef): Row {
  return {
    name: d.name,
    description: d.description,
    module: d.module,
    goal: d.goal,
    tables: d.tables,
    triggers: d.triggers,
    events: d.events ?? [],
    condition: d.condition ?? null,
    schedule_minutes: d.schedule_minutes ?? null,
    schedule_filter: d.schedule_filter ?? null,
    tools: d.tools,
    autonomy: d.autonomy,
    auto_actions: d.auto_actions ?? [],
    tier: d.tier ?? "standard",
    max_steps: d.budgets?.max_steps ?? AGENT_BUDGET_DEFAULTS.max_steps,
    max_tokens: d.budgets?.max_tokens ?? AGENT_BUDGET_DEFAULTS.max_tokens,
    max_actions: d.budgets?.max_actions ?? AGENT_BUDGET_DEFAULTS.max_actions,
    daily_runs: d.budgets?.daily_runs ?? AGENT_BUDGET_DEFAULTS.daily_runs,
    forbidden_tables: d.forbidden_tables ?? [],
    forbidden_fields: d.forbidden_fields ?? [],
    forbidden_states: d.forbidden_states ?? [],
    roles: d.roles ?? [],
    field_groups: d.field_groups ?? [],
  };
}

/** Every agent row of the organisation (system read). */
export async function agentRows(cfg: Pick<ServerConfig, "db"> & Partial<ServerConfig>, orgId: string): Promise<Row[]> {
  const sys = await systemCtx(cfg as ServerConfig, orgId);
  return liveRows(cfg.db, sys, AI_AGENT, null, { order: "t.module, t.name", limit: 2000 });
}

export async function agentRow(ctx: Ctx, key: string): Promise<Row | null> {
  const rows = await liveRows(ctx.db, sysOf(ctx), AI_AGENT, { f: "key", op: "eq", v: key }, { limit: 1 });
  return rows[0] ?? null;
}

export async function agentRowById(cfg: ServerConfig, orgId: string, id: string): Promise<Row | null> {
  const sys = await systemCtx(cfg, orgId);
  const rows = await liveRows(cfg.db, sys, AI_AGENT, { f: "id", op: "eq", v: id }, { limit: 1 });
  return rows[0] ?? null;
}

/** Rows for the code-defined agents the organisation has none of yet, switched off (idempotent). */
export async function seedAgentRows(ctx: Ctx): Promise<number> {
  const sys = sysOf(ctx);
  const have = new Set((await liveRows(ctx.db, sys, AI_AGENT, null, { limit: 5000 })).map((r) => String(r.key)));
  const missing = builtinAgents().filter((d) => !have.has(d.key));
  if (!missing.length) return 0;
  await sys.write(async (tx) => {
    for (const d of missing) {
      const exists = await tx.one(`select 1 from sm_ai_agents where org_id = $1 and key = $2 and deleted_at is null`, [ctx.org.id, d.key]);
      if (exists) continue;
      await createIn(tx, sys, AI_AGENT, { key: d.key, base_key: d.key, builtin: true, enabled: false, ...defRow(d) }, { trusted: true });
    }
  }, { internal: true });
  return missing.length;
}

/** «بازگشت به پیش‌فرض»: a built-in agent's goal, tools, triggers, autonomy, budgets and guardrails from its code. */
export async function resetAgentRow(ctx: Ctx, row: Row): Promise<void> {
  const d = agentDef(String(row.base_key ?? row.key));
  if (!d) return;
  const sys = sysOf(ctx, ctx.user.id);
  await sys.write((tx) => updateIn(tx, sys, AI_AGENT, String(row.id), defRow(d), { trusted: true }));
}
