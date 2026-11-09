// AI agents — public API (docs/spec/AI.md §11.8, catalogue AI-074…077):
//   registerAgent(def)                         an agent defined in code (built-ins: ./builtin.ts), seeded switched off
//   agentsAdminView / patchAgent / …           the studio (ai:full; the principal's roles by an owner)
//   queueAgentRun / advanceRun                 runs as jobs, one model turn per step, resumable
//   startAgent / agentsForRecord               members start agents by hand or from a conversation
// `installAiAgents()` (src/server/routes/modules.ts, after the skills it uses as tools) registers the tables' guards, the
// run job, the triggers, the built-in agents and the assistant's `start_agent` tool.
import { z } from "zod";
import { registerAiFeaturePrefix } from "../settings";
import { defineTool, type AiToolDef } from "../tools/registry";
import { registerTool } from "../tools";
import { installModuleTools } from "../tools/modules";
import { installAgentHooks } from "./hooks";
import { installAgentRuns } from "./runtime";
import { installAgentTriggers } from "./triggers";
import { installBuiltinAgents } from "./builtin";
import { agentsForRecord, startAgent } from "./admin";

export { registerAgent, agentDef, builtinAgents, type AgentDef } from "./registry";
export { queueAgentRun, advanceRun, runInline, stopRun, AGENT_RUN_LIMITS, AGENT_SYSTEM } from "./runtime";
export { agentTools } from "./tools";
export { agentsOn, ensureAgentSchedule, invalidateAgentTriggers } from "./triggers";
export { configOf, seedAgentRows } from "./config";
export * from "./admin";

/** The assistant starts an agent the member may start from a conversation (it runs in the background as its principal). */
const startAgentTool = defineTool({
  name: "start_agent",
  title_fa: "آغاز عامل هوش مصنوعی",
  description:
    "Starts one of the organisation's AI agents that the person may start from a conversation, optionally on one record (table + id). The agent works in the background with its own service account; its proposals reach the record's people. Call it without `agent` to list the agents the person may start.",
  input: z.object({ agent: z.string().max(80).optional(), table: z.string().max(60).optional(), id: z.string().max(40).optional() }),
  kind: "meta",
  area: "ai",
  level: "view",
  async run(ctx, p) {
    if (!p.agent) {
      const cards = await agentsForRecord(ctx, p.table ?? null, "conversation");
      return { data: { agents: cards.map((c) => ({ key: c.key, name: c.name, description: c.description })) }, summary_fa: `${cards.length} عامل در دسترس` };
    }
    const r = await startAgent(ctx, p.agent, { table: p.table ?? null, id: p.id && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id.toLowerCase() : null, how: "conversation" });
    return { data: { status: r.status, run_id: r.run_id, message: r.message_fa }, summary_fa: r.message_fa };
  },
}) as AiToolDef;

let installed = false;

/** The agents framework and the built-in agents (idempotent; called once when the app is created). */
export function installAiAgents(): void {
  if (installed) return;
  installed = true;
  registerAiFeaturePrefix("agent:", "agents");
  installAgentHooks();
  installAgentRuns();
  installAgentTriggers();
  installBuiltinAgents();
  registerTool(startAgentTool);
  // tools over the modules' services (change risk, CMDB impact, ordering for someone) — the agents and the assistant
  installModuleTools();
}
