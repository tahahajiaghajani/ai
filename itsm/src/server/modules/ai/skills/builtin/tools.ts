// Skills the assistant can use as tools (catalogue AI-006: a skill deployed as an agent tool). Read-only: the tool runs
// the skill as the person asking (their access, their roles, the skill's own rules) and returns its text; writes stay
// proposals made elsewhere. Today: the shift handover summary («خلاصهٔ تحویل شیفت»).
import { z } from "zod";
import { registerTool } from "../../tools";
import { defineTool } from "../../tools/registry";
import { runSkill } from "../runtime";

const handover = defineTool({
  name: "shift_handover_summary",
  title_fa: "خلاصهٔ تحویل شیفت",
  description:
    "Runs the organisation's «خلاصهٔ تحویل شیفت» skill as the caller: a handover summary of the open incidents of the caller's groups and their own (urgent, waiting with reasons, to follow up next shift), written by the skill from records the caller may read. Use it when the user asks for a shift handover, a catch-up on their queue or what the next shift must know. Returns Persian Markdown and the model that wrote it.",
  input: z.object({}),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx) {
    const r = await runSkill(ctx, "incident.handover", {});
    return { data: { text: r.text ?? "", model: r.model, rule_based: r.fallback, label: r.label }, summary_fa: r.fallback ? "خلاصهٔ قاعده‌محور آماده شد" : "خلاصهٔ تحویل شیفت آماده شد" };
  },
});

export function installSkillTools(): (() => void)[] {
  return [registerTool(handover as never)];
}
