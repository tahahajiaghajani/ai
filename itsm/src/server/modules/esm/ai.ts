// AI skills of enterprise service management (docs/spec/AI.md §11; catalogue ESM-017/043):
//   · `esm.hr_case_summary` — a summary of an HR case for the HR agent working it. Bound by the secure workspace like
//     everything else: the runtime reads the case with the caller's own access (an IT agent's run is a 404), only the
//     fields the skill's field groups allow reach the model — «internal» for work notes, never «hr» or «financial»
//     (sensitive notes, medical data, disciplinary flags and pay stay out, ESM-020) — and the rule-based fallback is
//     built from the same trimmed fields
//   · `esm.onboarding_checklist` — a checklist draft for a journey (the new hire, the manager, HR) from its planned
//     activities, computed in code with the caller's access; the fallback is the checklist itself
// Both are drafts a person reads; neither writes anything.
import { formatJalali } from "@shared/jalali";
import { ACTIVITY_KINDS, JOURNEY_PHASES } from "@shared/tables/esm";
import type { Ctx } from "../../context";
import { list } from "../../engine";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import type { SkillDef, SkillRuntimeInput } from "../ai/skills/types";

const phaseLabel = (v: unknown) => JOURNEY_PHASES.find((p) => p.value === v)?.label ?? String(v ?? "");
const kindLabel = (v: unknown) => ACTIVITY_KINDS.find((p) => p.value === v)?.label ?? String(v ?? "");
const MARK: Record<string, string> = { done: "☑", skipped: "⊘", failed: "✗", in_progress: "◐", pending: "☐" };

/** The checklist of a journey's activities by phase (read with the caller's access). */
export async function journeyChecklist(ctx: Ctx, journeyId: string): Promise<{ text: string; facts: Record<string, unknown>[] }> {
  const acts = await list(ctx, "journey_activity", { filter: { f: "journey_id", op: "eq", v: journeyId }, sort: "sort_order", size: 300, fields: ["name", "phase", "kind", "state", "due_date", "assignee_id", "day_one", "record_number"] });
  const facts = acts.rows.map((a) => ({ name: a.name, phase: phaseLabel(a.phase), kind: kindLabel(a.kind), state: a.state, due: a.due_date ? formatJalali(String(a.due_date)) : null, who: acts.display[String(a.assignee_id)] ?? null, day_one: !!a.day_one, record: a.record_number ?? null }));
  const byPhase = new Map<string, typeof facts>();
  for (const f of facts) byPhase.set(f.phase, [...(byPhase.get(f.phase) ?? []), f]);
  const lines: string[] = [];
  for (const [phase, xs] of byPhase) {
    lines.push(`### ${phase}`);
    for (const x of xs) lines.push(`- ${MARK[String(x.state)] ?? "☐"} ${x.name}${x.due ? ` — تا ${x.due}` : ""}${x.who ? ` (${x.who})` : ""}${x.day_one ? " · روز نخست" : ""}`);
    lines.push("");
  }
  return { text: lines.join("\n").trim(), facts };
}

/** The rule-based summary of a case from the fields the skill may read (the same trimmed fields the model would get). */
function caseSummaryFallback(input: SkillRuntimeInput): string {
  const r = input.record;
  if (!r) return "";
  const pick = (n: string) => r.fields.find((f) => f.name === n);
  const val = (n: string) => {
    const f = pick(n);
    return f && f.value !== null && f.value !== undefined && f.value !== "" ? String(f.value) : null;
  };
  const lines = [
    `**${r.number ?? ""} — ${val("short_description") ?? r.title}**`,
    [val("state") && `وضعیت: ${val("state")}`, val("coe") && `مرکز تخصصی: ${val("coe")}`, val("priority") && `اولویت: ${val("priority")}`, val("confidentiality") && `محرمانگی: ${val("confidentiality")}`].filter(Boolean).join(" · "),
    val("description") ? `\n${val("description")!.slice(0, 600)}` : "",
  ];
  const lastPublic = [...input.journal].reverse().find((j) => j.visibility === "public");
  const lastNote = [...input.journal].reverse().find((j) => j.visibility === "internal");
  if (lastPublic) lines.push(`\nآخرین پاسخ (${lastPublic.at}): ${lastPublic.body.slice(0, 300)}`);
  if (lastNote) lines.push(`آخرین یادداشت داخلی (${lastNote.at}): ${lastNote.body.slice(0, 300)}`);
  const tasks = input.related["کارها"] ?? [];
  if (tasks.length) lines.push(`\nکارهای پرونده: ${tasks.map((t) => `${t["عنوان"] ?? ""} (${t["وضعیت"] ?? ""})`).join("، ")}`);
  return lines.filter(Boolean).join("\n");
}

export const esmSkills: SkillDef[] = [
  defineSkill({
    key: "esm.hr_case_summary",
    name: "خلاصهٔ پروندهٔ منابع انسانی",
    description: "خلاصهٔ کوتاه پرونده برای کارشناس منابع انسانی: موضوع، وضعیت، آنچه گذشت و قدم بعدی — بی یادداشت‌های حساس، اطلاعات پزشکی و حقوق",
    module: "esm",
    catalog: ["ESM-043"],
    target: "record",
    tables: ["hr_case"],
    output: "text",
    tier: "standard",
    // only fields every HR case reader may see reach the model; the «hr» and «financial» groups never do
    inputs: { journal: "all", journalLimit: 20, links: false, related: [{ table: "hr_task", field: "hr_case_id", label: "کارها", fields: ["short_description", "type", "state", "due_date"], limit: 10 }] },
    fieldGroups: ["internal"],
    roles: ["hr_agent"],
    surfaces: ["panel"],
    icon: "file-text",
    order: 10,
    system: "کار تو: خلاصهٔ یک پروندهٔ منابع انسانی برای کارشناسی که روی آن کار می‌کند، در سه بند کوتاه: «موضوع و درخواست»، «آنچه تاکنون انجام شد»، «قدم بعدی». داده‌های شخصی (نام، شماره، مبالغ) را تکرار نکن؛ چیزی نساز؛ اگر اطلاعات کافی نیست بگو.",
    template: "پرونده:\n{{record}}\n\nکارهای پرونده:\n{{related}}\n\nیادداشت‌ها:\n{{journal}}",
    fallback: async (_ctx, input) => ({ text: caseSummaryFallback(input) }),
  }),
  defineSkill({
    key: "esm.onboarding_checklist",
    name: "پیش‌نویس چک‌لیست سفر کارمند",
    description: "چک‌لیست کارهای کارمند تازه، مدیر و منابع انسانی از فعالیت‌های برنامه‌ریزی‌شدهٔ سفر، با مهلت‌ها و آمادگی روز نخست",
    module: "esm",
    catalog: ["ESM-013", "ESM-017"],
    target: "record",
    tables: ["journey"],
    output: "text",
    tier: "fast",
    inputs: { fields: ["number", "name", "type", "state", "anchor_date", "progress", "day_one_ready", "employment_type"], journal: "none", links: false },
    roles: ["hr_agent", "esm_agent"],
    surfaces: ["panel"],
    icon: "list-checks",
    order: 20,
    system: "کار تو: از فعالیت‌های برنامه‌ریزی‌شدهٔ یک سفر کارمند (بلوک checklist)، چک‌لیستی روشن و دوستانه به فارسی بنویس: برای هر مرحله، کارهای کارمند، مدیر و منابع انسانی با مهلت. فقط از همین فعالیت‌ها استفاده کن و کاری نساز. در پایان در یک جمله بگو آمادگی روز نخست کامل است یا چه چیزی مانده.",
    template: "سفر:\n{{record}}\n\nفعالیت‌ها:\n{{checklist}}",
    factKeys: ["checklist"],
    facts: async (ctx, input) => (input.id ? { checklist: (await journeyChecklist(ctx, input.id)).facts } : {}),
    fallback: async (ctx, input) => ({ text: input.id ? (await journeyChecklist(ctx, input.id)).text : "" }),
  }),
];

let installed = false;
export function installEsmSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return esmSkills.map((s) => registerSkill(s));
}
