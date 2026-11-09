// AI skill of IT financial management (docs/spec/AI.md §11; catalogue FIN-013): the variance narrative — why actual
// costs differ from the budget, by cost centre and cost type — written from the decomposition the server computed
// (`budgetVsActualFor`, `varianceDrivers`); the model only narrates. The rule-based answer lists the same facts in
// sentences, so the budget page answers without a model too. Cost forecasts are left to the predictive brief.
import { formatRial, varianceDrivers, varianceSentence, type BvaCell, type MoneyUnit } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import type { AiText } from "@shared/itam/api";
import type { Ctx } from "../../context";
import { defineSkill, isAiUnavailable, registerSkill, runSkill, type SkillRuntimeInput } from "../ai/skills";
import { budgetVsActualFor } from "./service";

/** The facts of the narrative for a year (and optionally one cost centre). */
export async function varianceFacts(ctx: Ctx, year: number, costCenterId: string | null = null): Promise<Record<string, unknown>> {
  const bva = await budgetVsActualFor(ctx, year, { costCenterId });
  return {
    year,
    unit: bva.unit,
    total: bva.total,
    cost_centres: bva.rows.slice(0, 12).map((r) => ({
      name: r.name, budget: r.budget, actual: r.actual, variance: r.variance, used_pct: r.used_pct, status: r.status,
      drivers: varianceDrivers(r.by_type.map((t) => ({ key: t.cost_type_id, label: t.name, budget: t.budget, actual: t.actual })), 4),
    })),
  };
}

/** The rule-based narrative. */
export function varianceText(f: Record<string, any>): string {
  const unit = (f.unit as MoneyUnit) ?? "rial";
  const lines = [`**سال مالی ${faDigits(f.year)}** — ${varianceSentence("کل", f.total as BvaCell, unit)}`];
  for (const c of (f.cost_centres ?? []) as Record<string, any>[]) {
    lines.push("", `- ${varianceSentence(String(c.name), c as BvaCell, unit)}`);
    for (const d of c.drivers ?? []) {
      const over = Number(d.variance) < 0;
      lines.push(`  - ${d.label}: ${over ? "بیش از بودجه" : "کمتر از بودجه"} به اندازهٔ ${formatRial(String(Math.abs(Number(d.variance))), unit)} (${faDigits(d.share_pct)}٪ از انحراف)`);
    }
  }
  if (!(f.cost_centres ?? []).length) lines.push("", "بودجهٔ مصوب یا هزینهٔ ثبت‌شده‌ای برای این سال نیست.");
  return lines.join("\n");
}

export const FINANCIAL_SKILLS = [
  defineSkill({
    key: "financial.variance",
    name: "روایت انحراف بودجه",
    description: "چرا هزینهٔ واقعی با بودجه فرق دارد: مراکز هزینه و انواع هزینه‌ای که بیشترین انحراف را ساخته‌اند، از تجزیهٔ محاسبه‌شده",
    module: "financial",
    catalog: ["FIN-013"],
    target: "none",
    tables: ["budget"],
    output: "text",
    tier: "standard",
    fieldGroups: ["financial"],
    surfaces: ["module"],
    params: [{ name: "year", label: "سال مالی", type: "number" }],
    system: "کار تو: روایت کوتاه انحراف بودجهٔ فناوری اطلاعات برای مدیر مالی: کجا بیش از بودجه و کجا کمتر هزینه شده، بزرگ‌ترین عامل‌ها و یک پیشنهاد عملی. همهٔ عددها و درصدها فقط از بلوک facts است؛ هیچ عددی نساز و حساب نکن.",
    template: "تجزیهٔ انحراف (محاسبه‌شده):\n{{facts}}",
    factKeys: ["variance"],
    facts: async (ctx: Ctx, input: SkillRuntimeInput) => ({ variance: await varianceFacts(ctx, Number(input.params.year) || new Date().getFullYear() - 621) }),
    fallback: async (ctx: Ctx, input: SkillRuntimeInput) => ({ text: varianceText(await varianceFacts(ctx, Number(input.params.year) || new Date().getFullYear() - 621)) }),
  }),
];

/** The narrative for the budget page: the skill as the person, else the rule-based text (`ai: false`). */
export async function varianceNarrative(ctx: Ctx, year: number, costCenterId: string | null): Promise<AiText> {
  if (!costCenterId) {
    try {
      const r = await runSkill(ctx, "financial.variance", { params: { year } });
      return { text: r.text ?? "", ai: !r.fallback, model: r.model };
    } catch (e) {
      if (!isAiUnavailable(e) && (e as { status?: number }).status !== 403) throw e;
    }
  }
  return { text: varianceText(await varianceFacts(ctx, year, costCenterId)), ai: false, model: null };
}

export function installFinancialAi(): (() => void)[] {
  return FINANCIAL_SKILLS.map((s) => registerSkill(s));
}
