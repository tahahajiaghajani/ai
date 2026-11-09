// AI skills of field service (docs/spec/AI.md §11; catalogue FSM-031/032/033):
//   · `field_service.briefing` — the technician's briefing for a visit: what is wrong, where and how to get in, what
//     happened at this place or asset before, the checklist, the parts and safety — facts read with the caller's own
//     access; the rule-based fallback is the same briefing as a list
//   · `field_service.wo_triage` — work type, skills and priority of a work order from its description (FSM-031), with
//     keyword rules as the fallback; the dispatcher applies what fits
import { formatJalali } from "@shared/jalali";
import { normalizeSearch } from "@shared/model/conditions";
import { parseChecklist } from "@shared/field_service/logic";
import type { Ctx } from "../../context";
import { get, list } from "../../engine";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import type { SkillDef, SkillRuntimeInput } from "../ai/skills/types";
import { isUuid, type Row } from "./common";

/** The briefing facts of a visit, read as the caller. */
export async function briefingFacts(ctx: Ctx, taskId: string): Promise<Row> {
  const { row: t, display } = await get(ctx, "wo_task", taskId);
  const wo = await get(ctx, "work_order", String(t.work_order_id)).then((r) => r.row).catch(() => null);
  const history: Row[] = [];
  if (wo && (isUuid(wo.ci_id) || isUuid(wo.location_id))) {
    const past = await list(ctx, "work_order", {
      filter: { and: [isUuid(wo.ci_id) ? { f: "ci_id", op: "eq", v: wo.ci_id } : { f: "location_id", op: "eq", v: wo.location_id }, { f: "id", op: "ne", v: wo.id }, { f: "resolved_at", op: "nempty" }] },
      sort: "-resolved_at", size: 5, fields: ["number", "short_description", "resolved_at", "close_notes", "first_time_fix"],
    }).catch(() => ({ rows: [] as Row[] }));
    for (const p of past.rows) history.push({ number: p.number, title: p.short_description, when: p.resolved_at ? formatJalali(String(p.resolved_at)) : null, result: p.close_notes ?? null });
  }
  const parts = await list(ctx, "parts_requirement", { filter: { f: "wo_task_id", op: "eq", v: taskId }, size: 30, fields: ["part_name", "quantity", "state", "stockroom"] }).then((r) => r.rows).catch(() => []);
  return {
    task: { number: t.number, title: t.short_description, window: t.window_start ? `${formatJalali(String(t.window_start))}` : null, skills: t.required_skills ?? [], instructions: t.instructions ?? null },
    site: wo ? { address: wo.site_address ?? null, access: wo.access_notes ?? null, location: display[String(wo.location_id)] ?? null, symptoms: wo.symptoms ?? wo.description ?? null, coverage: wo.coverage ?? null, parent: wo.parent_number ?? null } : null,
    checklist: parseChecklist(t.checklist).map((c) => c.label),
    parts: parts.map((p) => ({ name: p.part_name, quantity: p.quantity, state: p.state, from: p.stockroom ?? null })),
    history,
  };
}

function briefingText(f: Row): string {
  const lines: string[] = [];
  const task = f.task as Row;
  const site = (f.site as Row) ?? {};
  lines.push(`### ${task.number ?? ""} — ${task.title ?? ""}`);
  if (site.symptoms) lines.push(`**مشکل:** ${String(site.symptoms).slice(0, 500)}`);
  if (site.address || site.location) lines.push(`**محل:** ${[site.location, site.address].filter(Boolean).join(" — ")}`);
  if (site.access) lines.push(`**راه دسترسی:** ${site.access}`);
  if (task.window) lines.push(`**بازهٔ مشتری:** ${task.window}`);
  if ((task.skills as string[])?.length) lines.push(`**مهارت‌ها:** ${(task.skills as string[]).join("، ")}`);
  if ((f.parts as Row[]).length) lines.push(`**قطعه‌ها:** ${(f.parts as Row[]).map((p) => `${p.name} × ${p.quantity}`).join("، ")}`);
  if ((f.checklist as string[]).length) lines.push(`**چک‌لیست:**\n${(f.checklist as string[]).map((c) => `- ☐ ${c}`).join("\n")}`);
  if ((f.history as Row[]).length) lines.push(`**پیش‌تر در همین محل یا دارایی:**\n${(f.history as Row[]).map((h) => `- ${h.number} (${h.when ?? ""}): ${h.title}${h.result ? ` — ${String(h.result).slice(0, 160)}` : ""}`).join("\n")}`);
  if (task.instructions) lines.push(`**شرح کار و ایمنی:**\n${String(task.instructions).slice(0, 1200)}`);
  return lines.join("\n\n");
}

const RULES: { words: string[]; work_type: string; skill: string }[] = [
  { words: ["کولر", "سرمایش", "گرمایش", "چیلر", "تهویه", "موتورخانه"], work_type: "maintenance", skill: "تأسیسات مکانیکی" },
  { words: ["سوئیچ", "روتر", "شبکه", "کابل", "وای فای", "وای‌فای", "رک"], work_type: "repair", skill: "شبکه" },
  { words: ["برق", "تابلو", "فیوز", "سیم‌کشی", "روشنایی", "یو پی اس", "یوپی‌اس"], work_type: "repair", skill: "برق" },
  { words: ["چاپگر", "پرینتر", "لپ‌تاپ", "رایانه", "مانیتور", "اسکنر"], work_type: "repair", skill: "سخت‌افزار" },
  { words: ["نصب", "راه‌اندازی", "استقرار"], work_type: "install", skill: "" },
  { words: ["بازدید", "بازرسی", "دوره‌ای"], work_type: "inspection", skill: "" },
];

function triageFallback(input: SkillRuntimeInput): Row {
  const text = normalizeSearch(input.record?.fields.filter((f) => ["short_description", "description", "symptoms"].includes(f.name)).map((f) => String(f.value ?? "")).join(" ") ?? "").toLowerCase();
  const hits = RULES.filter((r) => r.words.some((w) => text.includes(normalizeSearch(w).toLowerCase())));
  const urgent = ["فوری", "اضطراری", "قطع کامل", "آتش", "دود", "نشت"].some((w) => text.includes(w));
  const suggestions: Row[] = [];
  if (hits[0]) suggestions.push({ field: "work_type", value: hits[0].work_type, confidence: 0.6, reason: `واژه‌های ${hits[0].words.filter((w) => text.includes(normalizeSearch(w).toLowerCase())).join("، ")}` });
  const skills = [...new Set(hits.map((h) => h.skill).filter(Boolean))];
  if (skills.length) suggestions.push({ field: "required_skills", value: skills, confidence: 0.5, reason: "مهارت‌های متناسب با واژه‌ها" });
  suggestions.push({ field: "priority", value: urgent ? "2" : "3", confidence: 0.4, reason: urgent ? "نشانهٔ فوریت در متن" : "بی نشانهٔ فوریت" });
  return { suggestions };
}

export const fieldSkills: SkillDef[] = [
  defineSkill({
    key: "field_service.briefing",
    name: "خلاصهٔ بازدید برای تکنسین",
    description: "آنچه تکنسین پیش از رفتن باید بداند: مشکل، محل و راه دسترسی، سابقهٔ همین محل یا دارایی، چک‌لیست، قطعه‌ها و ایمنی",
    module: "field_service",
    catalog: ["FSM-033", "FSM-032"],
    target: "record",
    tables: ["wo_task"],
    output: "text",
    tier: "fast",
    grounding: { kind: "knowledge", k: 2 },
    inputs: { journal: "all", journalLimit: 10, links: false, fields: ["number", "short_description", "state", "priority", "required_skills", "window_start", "instructions"] },
    fieldGroups: ["internal"],
    roles: ["field_technician", "dispatcher"],
    surfaces: ["panel"],
    icon: "clipboard-list",
    order: 10,
    system: "کار تو: خلاصهٔ کوتاه و کاربردی یک بازدید در محل برای تکنسین، به فارسی و در فهرست‌های کوتاه: «مشکل»، «محل و دسترسی»، «سابقه»، «پیش از رفتن» (قطعه‌ها، ابزار، ایمنی) و «چک‌لیست». فقط از بلوک briefing، یادداشت‌ها و منابع داده‌شده استفاده کن؛ اطلاعات تماس شخصی را تکرار نکن.",
    template: "بازدید:\n{{record}}\n\nاطلاعات بازدید:\n{{briefing}}\n\nیادداشت‌ها:\n{{journal}}\n\nمنابع دانش:\n{{passages}}",
    factKeys: ["briefing"],
    facts: async (ctx, input) => (input.id ? { briefing: await briefingFacts(ctx, input.id) } : {}),
    fallback: async (ctx, input) => ({ text: input.id ? briefingText(await briefingFacts(ctx, input.id)) : "" }),
  }),
  defineSkill({
    key: "field_service.wo_triage",
    name: "نوع کار، مهارت و اولویت دستور کار",
    description: "از شرح مشکل، نوع کار، مهارت‌های لازم و اولویت دستور کار را پیشنهاد می‌کند",
    module: "field_service",
    catalog: ["FSM-031"],
    target: "record",
    tables: ["work_order"],
    output: "fields",
    outputFields: ["work_type", "required_skills", "priority"],
    tier: "fast",
    inputs: { journal: "none", links: false, fields: ["short_description", "description", "symptoms", "work_type", "required_skills", "priority"] },
    roles: ["dispatcher"],
    surfaces: ["panel"],
    icon: "wand",
    order: 20,
    system: "کار تو: از شرح مشکل یک کار در محل، نوع کار، مهارت‌های لازم (از مهارت‌های رایج: برق، شبکه، سخت‌افزار، تأسیسات مکانیکی) و اولویت را پیشنهاد کن، هر کدام با دلیل کوتاه.",
    template: "دستور کار:\n{{record}}",
    fallback: async (_ctx, input) => triageFallback(input),
  }),
];

let installed = false;
export function installFieldSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return fieldSkills.map((s) => registerSkill(s));
}
