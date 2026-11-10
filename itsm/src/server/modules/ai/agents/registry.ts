// Agents defined in code (docs/spec/AI.md §11.8): the built-ins (./builtin.ts) and a module's own (`registerAgent`).
// The studio seeds one `ai_agent` row per definition, switched off; from then on the organisation's row is the agent —
// its goal, tools, autonomy, budgets and guardrails — and «بازگشت به پیش‌فرض» copies the definition back.
import type { Cond } from "@shared/model/conditions";
import type { AgentAutonomy, AgentTrigger } from "@shared/ai/agents";
import { AGENT_BUDGET_DEFAULTS, agentConfigProblems } from "@shared/ai/agents";
import type { SkillEventKind, SkillTier } from "@shared/ai/skills";

export interface AgentDef {
  key: string;
  name: string;
  description: string;
  module: string;
  goal: string;
  tables: string[];
  triggers: AgentTrigger[];
  events?: SkillEventKind[];
  condition?: Cond | null;
  schedule_minutes?: number | null;
  schedule_filter?: Cond | null;
  tools: string[];
  autonomy: AgentAutonomy;
  auto_actions?: string[];
  tier?: SkillTier;
  budgets?: Partial<Record<keyof typeof AGENT_BUDGET_DEFAULTS, number>>;
  forbidden_tables?: string[];
  forbidden_fields?: string[];
  forbidden_states?: string[];
  roles?: string[];
  field_groups?: string[];
  /** ITSM roles the studio suggests for its principal (the owner decides) */
  principal_roles?: string[];
}

const DEFS = new Map<string, AgentDef>();

/** Register an agent defined in code (a later one with the same key replaces it). Returns its removal. */
export function registerAgent(def: AgentDef): () => void {
  const problems = agentConfigProblems({ ...def, auto_actions: def.auto_actions ?? [] });
  if (problems.length) throw new Error(`agent ${def.key}: ${problems.join("; ")}`);
  DEFS.set(def.key, def);
  return () => {
    if (DEFS.get(def.key) === def) DEFS.delete(def.key);
  };
}

export const agentDef = (key: string): AgentDef | undefined => DEFS.get(key);
export const builtinAgents = (): AgentDef[] => [...DEFS.values()];
