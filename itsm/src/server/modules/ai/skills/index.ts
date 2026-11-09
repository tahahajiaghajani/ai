// The AI skills framework — public API (docs/spec/AI.md §11):
//   runSkill(ctx, key, { table, id, text, params }, opts)  a run as the caller (never the system); proposals for writes
//   registerSkill(def) / defineSkill(def)                   built-in skills (code), configured per organisation
//   keepFromPrompts(table, fields)                          fields of a table that never reach a model
//   skillsForRecord / skillsForText                         what the record panel, the composer and field assists offer
//   setPrincipal / principalCtx                             the «دستیار هوش مصنوعی» service member of triggered skills
// `installAiSkills()` (src/server/routes/modules.ts, after the modules whose extension points it implements) registers
// the tables' guards, the proposal executors, the triggers and every built-in skill with the modules' AI interfaces.
import type { Ctx } from "../../../context";
import type { AiProposal } from "@shared/ai/types";
import type { SkillCard } from "@shared/ai/skills";
import { get, orgSchema, registerRecordMeta } from "../../../engine";
import { registerAiFeaturePrefix } from "../settings";
import { recordProposals } from "../actions";
import { allSkills, withVersion } from "./config";
import { appliesTo } from "./registry";
import { callerRoles, cardOf, rolesAllow, tierStatus } from "./runtime";
import { installSkillExecutors } from "./proposals";
import { installSkillTriggers } from "./triggers";
import { installSkillHooks } from "./hooks";
import { installBuiltinSkills } from "./builtin";

export { runSkill, runResolved, runCore, runForModule, isAiUnavailable, skillText, skillJson, SKILL_BASE_SYSTEM, zodFromJsonSchema, buildPrompt, assemble } from "./runtime";
export { registerSkill, defineSkill, skillDef, builtinSkills, appliesTo, outputFieldsOf } from "./registry";
export { keepFromPrompts, keptFromPrompts, promptable } from "./context";
export { resolveSkill, allSkills, configOf, defaultConfig } from "./config";
export { principalCtx, principalOf, setPrincipal, PRINCIPAL_NAME, SERVICE_DOMAIN } from "./principal";
export { runTriggered, queueSkillRun, ensureSkillSchedule, invalidateTriggers } from "./triggers";
export { proposeFromRun, clearanceOf } from "./proposals";
export * from "./admin";
export type { SkillDef, SkillRawOutput, SkillRuntimeInput, RecordData, RunOptions } from "./types";


/** What the record's «هوش مصنوعی» panel and composer offer, and the open proposals on the record the caller may see. */
export async function skillsForRecord(ctx: Ctx, table: string, id: string): Promise<{ skills: SkillCard[]; proposals: AiProposal[] }> {
  ctx.need("ai", "view");
  await get(ctx, table, id); // 404 unless the caller may read the record
  const tdef = (await orgSchema(ctx)).def(table);
  if (!tdef) return { skills: [], proposals: [] };
  const [skills, roles, status] = await Promise.all([allSkills(ctx), callerRoles(ctx), tierStatus(ctx)]);
  const cards = skills
    .filter((s) => s.cfg.enabled && rolesAllow(s.cfg, roles))
    .filter((s) => (s.def.target === "record" && appliesTo(s.def, s.cfg.tables, tdef)) || s.def.target === "text")
    .map((s) => cardOf(s, roles, status));
  return { skills: cards, proposals: await recordProposals(ctx, table, id) };
}

/** Skills of a piece of text (the composer of a new record, rich-text fields, the KB editor) and of free input. */
export async function skillsForText(ctx: Ctx): Promise<SkillCard[]> {
  ctx.need("ai", "view");
  const [skills, roles, status] = await Promise.all([allSkills(ctx), callerRoles(ctx), tierStatus(ctx)]);
  return skills
    .filter((s) => s.cfg.enabled && rolesAllow(s.cfg, roles) && (s.def.target === "text" || s.def.target === "none"))
    .map((s) => cardOf(s, roles, status));
}

export { withVersion };

let installed = false;

/** The skills framework and every built-in skill (idempotent; called once when the app is created). */
export function installAiSkills(): void {
  if (installed) return;
  installed = true;
  registerAiFeaturePrefix("skill:", "assistant");
  installSkillHooks();
  installSkillExecutors();
  installSkillTriggers();
  installBuiltinSkills();
  // the record page shows «هوش مصنوعی» to members who may use AI (skills, and their own access, decide the rest)
  registerRecordMeta("*", async ({ ctx }) => ({ ai_skills: ctx.actor !== "system" && ctx.can("ai", "view") }));
}
