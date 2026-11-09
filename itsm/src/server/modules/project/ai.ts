// The AI skill of project management (docs/spec/AI.md §11; catalogue PRJ-046/050): `project.status_summary` writes
// the narrative of a status report from facts code computed with the caller's access (progress, health and its
// reasons, what was done and what is next, open risks and issues); its rule-based fallback is the draft's own
// summary, so the button answers without a model too. AI never publishes a report or changes the plan.
import type { Ctx } from "../../context";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import type { SkillDef } from "../ai/skills/types";
import { statusFacts } from "./actions";

export const projectSkills: SkillDef[] = [
  defineSkill({
    key: "project.status_summary",
    name: "خلاصهٔ وضعیت پروژه",
    description: "روایت کوتاه وضعیت پروژه برای گزارش دوره‌ای و حامی: سلامت و دلیل آن، پیشرفت، کارهای انجام‌شده و پیش رو، ریسک‌ها و تصمیم‌های لازم",
    module: "project",
    catalog: ["PRJ-046", "PRJ-050"],
    target: "record",
    tables: ["project"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["number", "name", "state", "health", "pct_complete", "planned_start", "planned_end", "projected_end", "schedule_variance_days", "objectives"], journal: "all", journalLimit: 15, links: false },
    surfaces: ["panel", "module"],
    order: 10,
    system: "کار تو: خلاصهٔ وضعیت یک پروژه برای گزارش دوره‌ای، در چهار بند کوتاه: «وضعیت کلی»، «پیشرفت این دوره»، «پیش رو»، «ریسک‌ها و تصمیم‌های لازم». فقط از بلوک status و یادداشت‌ها استفاده کن؛ عدد یا رویدادی نساز. لحن رسمی و صریح؛ اگر سلامت زرد یا قرمز است دلیلش را روشن بگو.",
    template: "پروژه:\n{{record}}\n\nوضعیت محاسبه‌شده:\n{{status}}\n\nیادداشت‌ها:\n{{journal}}",
    factKeys: ["status"],
    facts: async (ctx, input) => (input.id ? { status: (await statusFacts(ctx, input.id)).facts } : {}),
    fallback: async (ctx: Ctx, input) => ({ text: input.id ? String((await statusFacts(ctx, input.id)).draft.summary ?? "") : "" }),
  }),
];

let installed = false;
export function installProjectSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return projectSkills.map((s) => registerSkill(s));
}
