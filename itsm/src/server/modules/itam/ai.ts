// AI skills of IT asset management (docs/spec/AI.md §11; catalogue ITAM-062/066/073/074): the licence optimisation
// narrative over the computed compliance position and an asset's analysis summary over its 360 facts. Numbers always
// come from code (`licenceFacts`, `asset360`); the model narrates and ranks. Both have a rule-based fallback, so the
// screens answer without a model too («بدون مدل هوش مصنوعی و با قاعده ساخته شد»), and the module's routes treat «no AI»
// as no AI (`ai: false`), never as an error.
import { formatRial } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { LICENSE_METRICS } from "@shared/tables/itam";
import type { AiText } from "@shared/itam/api";
import type { Ctx } from "../../context";
import { registerSkill, defineSkill, runSkill, isAiUnavailable } from "../ai/skills";
import type { SkillRuntimeInput } from "../ai/skills";
import { asset360 } from "./assets";
import { licenceFacts } from "./sam";
import { deviceRisk, riskText } from "./bank";

type Facts = Record<string, any>;
const metricLabel = (m: unknown) => LICENSE_METRICS.find((x) => x.value === m)?.label ?? String(m ?? "");
const money = (v: unknown) => (v === null || v === undefined || v === "" ? null : formatRial(String(v)));

/** The licence optimisation narrative from the facts (the rule-based answer). */
export function licenceNarrative(f: Facts): string {
  const lines: string[] = [];
  const t = f.totals ?? {};
  lines.push(`**وضعیت کلی:** ${faDigits(t.products ?? 0)} نرم‌افزار بررسی شد؛ ${faDigits(t.compliant ?? 0)} منطبق، ${faDigits(t.under_licensed ?? 0)} با کمبود مجوز و ${faDigits(t.over_licensed ?? 0)} با مجوز مازاد.`);
  if (f.financial && t.exposure && Number(t.exposure) > 0) lines.push(`ریسک ریالی کمبود مجوز: ${money(t.exposure)}.`);
  if (f.financial && t.savings && Number(t.savings) > 0) lines.push(`صرفه‌جویی ممکن (مجوز مازاد و نصب‌های بی‌استفاده): ${money(t.savings)}.`);
  const short = (f.shortfalls ?? []) as Facts[];
  if (short.length) {
    lines.push("", "**اولویت ۱ — رفع کمبود مجوز:**");
    for (const s of short) lines.push(`- ${s.product}: ${faDigits(s.consumed)} مصرف در برابر ${faDigits(s.entitled)} مجوز (${metricLabel(s.metric)})؛ کمبود ${faDigits(s.shortfall)}${s.exposure ? ` — ${money(s.exposure)}` : ""}.`);
  }
  const unused = (f.unused ?? []) as Facts[];
  if (unused.length) {
    lines.push("", "**اولویت ۲ — بازپس‌گیری نصب‌های بی‌استفاده:**");
    for (const u of unused) lines.push(`- ${u.product}: ${faDigits(u.unused_installs)} نصب بی‌استفاده؛ پیش از خرید تازه آن‌ها را بازپس بگیرید.`);
  }
  const surplus = (f.surplus ?? []) as Facts[];
  if (surplus.length) {
    lines.push("", "**اولویت ۳ — کاهش مجوز مازاد در تمدید بعدی:**");
    for (const s of surplus) lines.push(`- ${s.product}: ${faDigits(s.surplus)} مجوز بیش از نیاز${s.savings ? ` (${money(s.savings)})` : ""}.`);
  }
  const trueups = (f.trueups ?? []) as Facts[];
  if (trueups.length) {
    lines.push("", "**تعدیل‌ها و تمدیدهای پیش رو:**");
    for (const u of trueups) lines.push(`- ${u.name} تا ${u.due}: کمبود پیش‌بینی‌شده ${faDigits(u.projected_shortfall ?? 0)}${u.cost ? ` (${money(u.cost)})` : ""}.`);
  }
  if ((f.restricted ?? []).length) lines.push("", `**نرم‌افزار ممنوع یا محدود نصب‌شده:** ${(f.restricted as Facts[]).map((r) => `${r.model} (${faDigits(r.installs)})`).join("، ")} — حذف یا استثنای مصوب لازم است.`);
  if (!short.length && !unused.length && !surplus.length) lines.push("", "اقدام فوری لازم نیست؛ تطبیق بعدی را پس از کشف تازه بررسی کنید.");
  return lines.join("\n");
}

/** An asset's analysis summary from its 360 facts (the rule-based answer). */
export function assetSummaryText(f: Facts): string {
  const a = f.asset ?? {};
  const lines = [`**${a.name ?? ""}** (${a.number ?? ""}) — ${a.state_label ?? ""}.`];
  const w = f.warranty ?? {};
  if (w.status === "expired") lines.push(`ضمانت در ${w.end} پایان یافته است.`);
  else if (w.status === "expiring") lines.push(`ضمانت ${faDigits(w.days_left ?? 0)} روز دیگر (${w.end}) پایان می‌یابد؛ تمدید یا پوشش پشتیبانی را بررسی کنید.`);
  else if (w.status === "active") lines.push(`ضمانت تا ${w.end} برقرار است.`);
  if ((f.assignments ?? []).length) {
    const cur = (f.assignments as Facts[]).find((x) => !x.to_at);
    lines.push(cur ? `اکنون در دست ${cur.name ?? "کاربر"} است؛ ${faDigits((f.assignments as Facts[]).length)} تحویل ثبت شده است.` : `${faDigits((f.assignments as Facts[]).length)} تحویل در تاریخچه است و اکنون در دست کسی نیست.`);
  }
  if (f.costs) {
    const c = f.costs as Facts;
    lines.push(`هزینهٔ کل مالکیت: ${money(c.total)}${c.book_value ? `؛ ارزش دفتری ${money(c.book_value)}` : ""}.`);
    if (c.recommendation === "replace") lines.push(`پیشنهاد: جایگزینی — ${(c.reasons ?? []).join("؛ ")}.`);
    else if (c.recommendation === "watch") lines.push(`زیر نظر: ${(c.reasons ?? []).join("؛ ")}.`);
  }
  if (f.ci) lines.push(`پیکربندی پیوسته: ${f.ci.number ?? ""} (${f.ci.operational_status ?? "—"}${f.ci.health_score !== null && f.ci.health_score !== undefined ? `، سلامت داده ${faDigits(f.ci.health_score)}` : ""}).`);
  if ((f.contracts ?? []).length) lines.push(`قراردادها: ${(f.contracts as Facts[]).map((c) => `${c.number ?? ""} ${c.name} (${c.end_date ?? "بی‌پایان"})`).join("، ")}.`);
  if ((f.software ?? []).length) lines.push(`${faDigits((f.software as Facts[]).length)} نرم‌افزار روی این دستگاه نصب است.`);
  return lines.join("\n");
}

export const ITAM_SKILLS = [
  defineSkill({
    key: "itam.license_optimization",
    name: "روایت بهینه‌سازی مجوزها",
    description: "کمبودها، مجوزهای مازاد، نصب‌های بی‌استفاده و تعدیل‌های پیش رو، به ترتیب اولویت — از وضعیت محاسبه‌شدهٔ مجوزها",
    module: "itam",
    catalog: ["ITAM-062", "ITAM-066"],
    target: "none",
    tables: ["license_position"],
    output: "text",
    tier: "standard",
    roles: ["asset_manager"],
    fieldGroups: ["financial"],
    surfaces: ["module"],
    system: "کار تو: روایت کوتاه و اولویت‌دار وضعیت مجوزهای نرم‌افزار برای مدیر دارایی: کمبودها (ریسک ممیزی)، نصب‌های بی‌استفاده برای بازپس‌گیری، مجوز مازاد برای کاهش در تمدید و تعدیل‌های پیش رو. همهٔ عددها و مبلغ‌ها فقط از بلوک facts است؛ هیچ عددی نساز و حساب نکن.",
    template: "وضعیت مجوزها (محاسبه‌شده):\n{{facts}}",
    factKeys: ["licence"],
    facts: async (ctx: Ctx) => ({ licence: await licenceFacts(ctx) }),
    fallback: async (ctx: Ctx) => ({ text: licenceNarrative(await licenceFacts(ctx)) }),
  }),
  defineSkill({
    key: "itam.asset_summary",
    name: "خلاصهٔ تحلیلی دارایی",
    description: "وضعیت، ضمانت، تحویل‌ها، هزینهٔ کل مالکیت، پیشنهاد تعمیر یا جایگزینی، قراردادها و پیکربندی پیوسته",
    module: "itam",
    catalog: ["ITAM-073", "ITAM-074", "ITAM-043"],
    target: "record",
    tables: ["asset"],
    output: "text",
    tier: "fast",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 10,
    system: "کار تو: خلاصهٔ تحلیلی یک دارایی فناوری اطلاعات برای کارشناس: وضعیت و دارنده، ضمانت و قراردادها، هزینهٔ کل مالکیت و پیشنهاد تعمیر یا جایگزینی، پیکربندی پیوسته. عددها فقط از بلوک facts.",
    template: "دارایی:\n{{record}}\n\nداده‌های محاسبه‌شده:\n{{facts}}",
    factKeys: ["asset360"],
    facts: async (ctx: Ctx, input: SkillRuntimeInput) => (input.id ? { asset360: await asset360(ctx, input.id) } : {}),
    fallback: async (ctx: Ctx, input: SkillRuntimeInput) => ({ text: input.id ? assetSummaryText(await asset360(ctx, input.id)) : "" }),
  }),
  defineSkill({
    key: "itam.atm_failure_risk",
    name: "پیش‌بینی خرابی خودپرداز",
    description: "ریسک خرابی یک خودپرداز، CRS یا کیوسک از رخدادهای ۹۰ روز، ازکارافتادگی ۳۰ روز، عمر دستگاه و پایان پشتیبانی سیستم‌عامل، با پیشنهاد اقدام",
    module: "itam",
    catalog: ["ITAM-074"],
    target: "record",
    tables: ["asset"],
    output: "text",
    tier: "fast",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 20,
    system: "کار تو: برای کارشناس نگهداری خودپردازها، ریسک خرابی دستگاه را از داده‌های محاسبه‌شده (امتیاز، دلیل‌ها) کوتاه و اولویت‌دار توضیح بده و یک اقدام پیشگیرانهٔ مشخص پیشنهاد کن. عددی نساز؛ فقط از داده‌ها.",
    template: "دستگاه:\n{{record}}\n\nداده‌های محاسبه‌شده:\n{{facts}}",
    factKeys: ["risk"],
    facts: async (ctx: Ctx, input: SkillRuntimeInput) => (input.id ? { risk: await deviceRisk(ctx, input.id) } : {}),
    fallback: async (ctx: Ctx, input: SkillRuntimeInput) => ({ text: input.id ? riskText(await deviceRisk(ctx, input.id)) : "" }),
  }),
];

/** Run a module skill as the person; «no AI» becomes the rule-based text (`ai: false`). */
export async function itamText(ctx: Ctx, key: string, req: { table?: string; id?: string }, fallback: () => Promise<string>): Promise<AiText> {
  try {
    const r = await runSkill(ctx, key, { table: req.table, id: req.id });
    return { text: r.text ?? "", ai: !r.fallback, model: r.model };
  } catch (e) {
    if (isAiUnavailable(e) || (e as { status?: number }).status === 403) return { text: await fallback(), ai: false, model: null };
    throw e;
  }
}

export function installItamAi(): (() => void)[] {
  return ITAM_SKILLS.map((s) => registerSkill(s));
}
