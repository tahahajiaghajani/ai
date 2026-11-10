// Every built-in skill and the modules' AI extension points they implement (installed once by `installAiSkills`).
import { registerSkill } from "../registry";
import { genericSkills, writingSkills } from "./generic";
import { incidentSkills, installIncidentAi, problemSkills } from "./incident";
import { changeSkills, installChangeAi } from "./change";
import { installRequestAi, requestSkills } from "./request";
import { installKnowledgeAiSkills, knowledgeSkills } from "./knowledge";
import { cmdbSkills, installCmdbAiSkills } from "./cmdb";
import { installSkillTools } from "./tools";

export const BUILTIN_SKILLS = [...genericSkills, ...writingSkills, ...incidentSkills, ...problemSkills, ...changeSkills, ...requestSkills, ...knowledgeSkills, ...cmdbSkills];

let installed = false;
export function installBuiltinSkills(): void {
  if (installed) return;
  installed = true;
  for (const s of BUILTIN_SKILLS) registerSkill(s);
  installIncidentAi();
  installChangeAi();
  installRequestAi();
  installKnowledgeAiSkills();
  installCmdbAiSkills();
  installSkillTools();
}
