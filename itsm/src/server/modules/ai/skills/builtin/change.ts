// Skills of change enablement and their implementation of `registerChangeAi` (src/server/modules/change/ai.ts;
// catalogue CHG-024/039/053/068/069, AI-032): the risk narrative over the factors the risk engine computed (numbers
// come from code — the deterministic explanation is the fallback), drafts of the implementation, back-out, test and
// communication plans, the CAB pack of a meeting, the post-implementation review draft, an explanation of the change's
// conflicts and its summary. AI never authorizes a change, records a CAB decision or passes a gate.
import { z } from "zod";
import type { Ctx } from "../../../../context";
import type { PirSection, PlanField } from "../../../change/ai";
import { registerChangeAi } from "../../../change/ai";
import { riskView } from "../../../change/actions";
import { timelineOf, workbench } from "../../../change";
import { get, list, listLinks } from "../../../../engine";
import { formatJalaliDateTime } from "@shared/jalali";
import { orgTimeZone } from "../../usage";
import { defineSkill } from "../registry";
import { assertCanRun, runForModule, runResolved } from "../runtime";
import { resolveSkill } from "../config";
import { AiUnavailableError } from "../../errors";
import { AppError } from "../../../../http/errors";
import type { SkillDef } from "../types";

/**
 * A module run whose button has a deterministic answer of its own (the CAB pack, the PIR draft): a person who may not
 * use the skill (no AI for them, the skill switched off, not their role) gets that answer, so the refusal is «no AI».
 */
async function runOrNoAi(ctx: Ctx, key: string, req: { table: string; id: string }) {
  const rs = await resolveSkill(ctx, key);
  try {
    await assertCanRun(ctx, rs, {});
  } catch (e) {
    if (e instanceof AppError && e.status === 403) throw new AiUnavailableError("disabled", e.message);
    throw e;
  }
  return runResolved(ctx, rs, req, { noFallback: true });
}

/** The PIR sections the `change.pir` skill drafts (merged over the module's deterministic draft). */
const PIR_SECTIONS: PirSection[] = ["side_effects", "went_well", "went_wrong", "lessons", "follow_up"];
import { ruleSummary } from "./generic";

type Row = Record<string, unknown>;

async function riskFacts(ctx: Ctx, id: string) {
  const v = await riskView(ctx, id);
  return { risk: { level: v.risk, source: v.risk_source, override_reason: v.risk_override_reason, result: v.result, team_score: v.team_score, lead: v.lead }, explanation: v.explanation };
}

async function conflictFacts(ctx: Ctx, id: string) {
  const r = await list(ctx, "change_conflict", { filter: { and: [{ f: "change_id", op: "eq", v: id }, { f: "active", op: "eq", v: true }] }, size: 40, fields: ["kind", "status", "summary", "other_change_id", "window_id", "ci_id", "service_id", "overlap_start", "overlap_end", "justification"], total: false }).catch(() => null);
  const tz = orgTimeZone(ctx);
  return (r?.rows ?? []).map((c) => ({
    نوع: c.kind,
    وضعیت: c.status,
    شرح: c.summary,
    تغییر_دیگر: c.other_change_id ? (r!.display[String(c.other_change_id)] ?? "(محدود)") : null,
    پیکربندی: c.ci_id ? (r!.display[String(c.ci_id)] ?? "(محدود)") : null,
    خدمت: c.service_id ? (r!.display[String(c.service_id)] ?? "(محدود)") : null,
    از: c.overlap_start ? formatJalaliDateTime(String(c.overlap_start), tz) : null,
    تا: c.overlap_end ? formatJalaliDateTime(String(c.overlap_end), tz) : null,
    توجیه: c.justification ?? null,
  }));
}

async function pirFacts(ctx: Ctx, id: string) {
  const { row: c } = await get(ctx, "change_request", id);
  const tz = orgTimeZone(ctx);
  const tasks = await list(ctx, "change_task", { filter: { f: "change_id", op: "eq", v: id }, size: 100, fields: ["number", "short_description", "state", "close_notes"], total: false }).catch(() => null);
  const links = (await listLinks(ctx, "change_request", id).catch(() => ({ links: [] }))).links;
  return {
    timeline: timelineOf(c as Row, tz),
    tasks: (tasks?.rows ?? []).map((t) => ({ شماره: t.number, عنوان: t.short_description, وضعیت: t.state, یادداشت: t.close_notes ?? null })),
    caused: links.filter((l) => l.kind === "caused_by" && l.direction === "in").map((l) => `${l.other.number ?? ""} ${l.other.display}`.trim()),
  };
}

async function cabFacts(ctx: Ctx, meetingId: string) {
  const w = await workbench(ctx, meetingId);
  const m = w.meeting as Row | null;
  const tz = orgTimeZone(ctx);
  const byId = new Map(((w.changes as Row[]) ?? []).map((c) => [String(c.id), c]));
  return {
    meeting: m ? { عنوان: m.title, زمان: m.starts_at ? formatJalaliDateTime(String(m.starts_at), tz) : null } : null,
    agenda: ((w.items as Row[]) ?? []).map((it, i) => {
      const c = byId.get(String(it.change_id));
      if (!c) return { ردیف: i + 1, تغییر: "(تغییری که دسترسی دیدنش را ندارید)" };
      return {
        ردیف: i + 1,
        شماره: c.number,
        عنوان: c.short_description,
        نوع: c.type,
        ریسک: c.risk,
        اثر: c.impact,
        شروع: c.planned_start ? formatJalaliDateTime(String(c.planned_start), tz) : null,
        پایان: c.planned_end ? formatJalaliDateTime(String(c.planned_end), tz) : null,
        برنامهٔ_بازگشت: c.backout_plan ? "دارد" : "ندارد",
        بازگشت_آزموده: c.backout_tested ? "بله" : "خیر",
        تداخل: c.conflict_state ?? null,
        وضعیت: c.state,
      };
    }),
  };
}

const PLAN_FIELDS: PlanField[] = ["implementation_plan", "backout_plan", "test_plan", "communication_plan", "justification"];

export const changeSkills: SkillDef[] = [
  defineSkill({
    key: "change.risk_narrative",
    name: "روایت ریسک تغییر",
    description: "چرا این تغییر این ریسک را دارد — فقط از عامل‌هایی که موتور ریسک محاسبه کرده است",
    module: "change",
    catalog: ["CHG-024", "AI-032"],
    target: "record",
    tables: ["change_request"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["short_description", "type", "risk", "impact", "category", "ci_id", "service_id", "planned_start", "planned_end", "backout_plan"], journal: "none", links: false },
    surfaces: ["panel", "module"],
    order: 10,
    system: "کار تو: روایت کوتاه و روشن ریسک یک درخواست تغییر برای کارشناس و هیئت تغییر. فقط عامل‌ها و عددهای بلوک risk را به کار ببر (موتور ریسک آن‌ها را محاسبه کرده است)؛ هیچ عامل یا عددی نساز. بگو کدام عامل‌ها ریسک را بالا برده‌اند و چه کاری آن را پایین می‌آورد.",
    template: "تغییر:\n{{record}}\n\nعامل‌های ریسک:\n{{risk}}\n\nتوضیح قاعده‌محور:\n{{explanation}}",
    factKeys: ["risk", "explanation"],
    facts: async (ctx, input) => (input.id ? riskFacts(ctx, input.id) : {}),
    fallback: async (ctx, input) => ({ text: input.id ? (await riskFacts(ctx, input.id)).explanation : "" }),
  }),
  defineSkill({
    key: "change.plans",
    name: "پیش‌نویس برنامه‌های تغییر",
    description: "برنامهٔ اجرا، بازگشت، آزمون و اطلاع‌رسانی (و توجیه) از شرح تغییر و پیکربندی‌های آن",
    module: "change",
    catalog: ["CHG-069"],
    target: "record",
    tables: ["change_request"],
    output: "fields",
    outputFields: ["implementation_plan", "backout_plan", "test_plan", "communication_plan", "justification"],
    tier: "standard",
    grounding: { kind: "similar", k: 3 },
    inputs: { journal: "all", journalLimit: 20 },
    roles: ["agent"],
    fieldGroups: ["internal"], // it reads the work notes (the «internal» group)
    surfaces: ["panel", "module"],
    order: 20,
    system: "کار تو: پیش‌نویس برنامه‌های یک درخواست تغییر: برنامهٔ اجرا (گام‌های شماره‌دار با پیش‌نیاز و وارسی)، برنامهٔ بازگشت (کی و چگونه)، برنامهٔ آزمون (چه چیزی نشان می‌دهد تغییر موفق بوده) و برنامهٔ اطلاع‌رسانی. از تغییرهای مشابه (منابع) الگو بگیر اما جزئیات این تغییر را بنویس. فیلدی را که داده‌اش نیست پیشنهاد نده.",
    template: "تغییر:\n{{record}}\n\nیادداشت‌ها:\n{{journal}}",
  }),
  defineSkill({
    key: "change.cab_pack",
    name: "بستهٔ جلسهٔ هیئت تغییر",
    description: "یک صفحه برای هر تغییر دستور جلسه: هدف، ریسک، اثر، پنجره، آمادگی و پرسش‌های پیشنهادی",
    module: "change",
    catalog: ["CHG-039", "AI-032"],
    target: "record",
    tables: ["cab_meeting"],
    output: "text",
    tier: "standard",
    inputs: { journal: "none", links: false },
    surfaces: ["panel", "module"],
    system: "کار تو: بستهٔ جلسهٔ هیئت تغییر. برای هر ردیف دستور جلسه یک بخش «## n. شماره — عنوان» با هدف، ریسک و اثر، پنجرهٔ اجرا، آمادگی (برنامهٔ بازگشت، آزمون، تداخل) و دو پرسش پیشنهادی برای هیئت. ردیفی که دیده نمی‌شود را همان‌طور بنویس. تصمیمی پیشنهاد نکن.",
    template: "جلسه:\n{{meeting}}\n\nدستور جلسه:\n{{agenda}}",
    factKeys: ["meeting", "agenda"],
    facts: async (ctx, input) => (input.id ? cabFacts(ctx, input.id) : {}),
    fallback: async (ctx, input) => {
      if (!input.id) return { text: "" };
      const f = await cabFacts(ctx, input.id);
      const lines = [`# بستهٔ جلسهٔ ${String((f.meeting as Row | null)?.["عنوان"] ?? "")}`, ""];
      for (const a of f.agenda as Row[]) {
        if (!a["شماره"]) {
          lines.push(`## ${a["ردیف"]}. ${a["تغییر"]}`, "");
          continue;
        }
        lines.push(`## ${a["ردیف"]}. ${a["شماره"]} — ${a["عنوان"]}`, "", `- ریسک: ${a["ریسک"] ?? "—"} · اثر: ${a["اثر"] ?? "—"}`, `- پنجره: ${a["شروع"] ?? "—"} تا ${a["پایان"] ?? "—"}`, `- برنامهٔ بازگشت: ${a["برنامهٔ_بازگشت"]} (آزموده: ${a["بازگشت_آزموده"]})`, "");
      }
      return { text: lines.join("\n") };
    },
  }),
  defineSkill({
    key: "change.pir",
    name: "پیش‌نویس بازبینی پس از اجرا",
    description: "آنچه خوب پیش رفت، آنچه نه، اثرهای جانبی، درس‌ها و کارهای پیگیری — برای ادغام در پیش‌نویس قاعده‌محور",
    module: "change",
    catalog: ["CHG-053", "AI-029"],
    target: "record",
    tables: ["change_request"],
    output: "json",
    schema: z.object({ side_effects: z.string().max(6000).optional(), went_well: z.string().max(6000).optional(), went_wrong: z.string().max(6000).optional(), lessons: z.string().max(6000).optional(), follow_up: z.string().max(6000).optional() }),
    tier: "standard",
    inputs: { journal: "all", journalLimit: 30 },
    roles: ["agent"],
    fieldGroups: ["internal"], // it reads the work notes (the «internal» group)
    surfaces: ["module"],
    system: "کار تو: پیش‌نویس بازبینی پس از اجرای یک تغییر با زبانی بدون سرزنش: اثرهای جانبی، آنچه خوب پیش رفت، آنچه خوب پیش نرفت، درس‌ها و کارهای پیگیری (فهرست‌وار). فقط از داده‌ها، زمان‌بندی، کارها و رکوردهای ناشی از تغییر.",
    template: "تغییر:\n{{record}}\n\nزمان‌بندی:\n{{timeline}}\n\nکارها:\n{{tasks}}\n\nرکوردهای ناشی از این تغییر:\n{{caused}}\n\nیادداشت‌ها:\n{{journal}}",
    factKeys: ["timeline", "tasks", "caused"],
    facts: async (ctx, input) => (input.id ? pirFacts(ctx, input.id) : {}),
  }),
  defineSkill({
    key: "change.conflicts",
    name: "توضیح تداخل‌ها",
    description: "تداخل‌های باز این تغییر با تغییرهای دیگر، پنجره‌ها و قفل‌ها، به زبان ساده با پیشنهاد رفع",
    module: "change",
    catalog: ["CHG-049"],
    target: "record",
    tables: ["change_request"],
    output: "text",
    tier: "fast",
    inputs: { fields: ["short_description", "planned_start", "planned_end", "ci_id", "service_id", "risk"], journal: "none", links: false },
    surfaces: ["panel"],
    order: 30,
    system: "کار تو: توضیح تداخل‌های باز یک تغییر برای کارشناس: هر تداخل چیست، چرا مهم است و چه راهی دارد (جابه‌جایی زمان، هماهنگی با مالک تغییر دیگر، ثبت توجیه). فقط از فهرست تداخل‌ها.",
    template: "تغییر:\n{{record}}\n\nتداخل‌ها:\n{{conflicts}}",
    factKeys: ["conflicts"],
    facts: async (ctx, input) => ({ conflicts: input.id ? await conflictFacts(ctx, input.id) : [] }),
    fallback: async (ctx, input) => {
      const c = input.id ? await conflictFacts(ctx, input.id) : [];
      if (!c.length) return { text: "تداخل بازی برای این تغییر ثبت نشده است." };
      return { text: c.map((x) => `- ${x["شرح"] ?? x["نوع"]}${x["از"] ? ` (${x["از"]} تا ${x["تا"]})` : ""}`).join("\n") };
    },
  }),
  defineSkill({
    key: "change.summary",
    name: "خلاصهٔ تغییر",
    description: "خلاصهٔ وضعیت‌محور: هدف، برنامه، ریسک، پیکربندی‌ها و خدمت‌های متأثر، نتیجه",
    module: "change",
    catalog: ["CHG-068", "AI-032"],
    target: "record",
    tables: ["change_request"],
    output: "text",
    tier: "fast",
    inputs: { journal: "all", journalLimit: 30, related: [{ table: "change_task", field: "change_id", label: "کارهای تغییر", fields: ["number", "short_description", "state"], limit: 20 }] },
    fieldGroups: ["internal"], // it reads the work notes (the «internal» group)
    surfaces: ["panel", "module"],
    order: 5,
    system: "کار تو: خلاصهٔ یک درخواست تغییر با بخش‌های «هدف»، «برنامه»، «ریسک و اثر»، «وضعیت و گام بعدی»؛ اگر اجرا شده «نتیجه».",
    template: "تغییر:\n{{record}}\n\nکارها:\n{{related}}\n\nیادداشت‌ها:\n{{journal}}\n\nپیوندها:\n{{links}}",
    fallback: async (_ctx, input) => ruleSummary(input),
  }),
];

// `cabPack` and `draftPir` run as module integrations (no rule-based fallback): when no model can answer, the
// module catches the «no AI» error and returns its own deterministic pack / draft with `ai: false`, so a draft is
// never presented as AI-written unless a model wrote it. Both skills also run from the record's «هوش مصنوعی» panel.
export function installChangeAi(): (() => void)[] {
  return [
    registerChangeAi({
      async riskNarrative(ctx, changeId) {
        const r = await runForModule(ctx, "change.risk_narrative", { table: "change_request", id: changeId });
        return { text: r.text ?? "" };
      },
      async draftPlans(ctx, changeId, fields) {
        const r = await runForModule(ctx, "change.plans", { table: "change_request", id: changeId });
        const want = new Set(fields.filter((f) => PLAN_FIELDS.includes(f)));
        return Object.fromEntries(r.suggestions.filter((s) => want.has(s.field as PlanField)).map((s) => [s.field, String(s.value ?? "")])) as Partial<Record<PlanField, string>>;
      },
      async summarize(ctx, changeId) {
        const r = await runForModule(ctx, "change.summary", { table: "change_request", id: changeId });
        return { text: r.text ?? "" };
      },
      async cabPack(ctx, meetingId) {
        const r = await runOrNoAi(ctx, "change.cab_pack", { table: "cab_meeting", id: meetingId });
        return { text: r.text ?? "" };
      },
      async draftPir(ctx, changeId) {
        const r = await runOrNoAi(ctx, "change.pir", { table: "change_request", id: changeId });
        const j = (r.json ?? {}) as Record<string, unknown>;
        const out: Partial<Record<PirSection, string>> = {};
        for (const k of PIR_SECTIONS) if (typeof j[k] === "string" && (j[k] as string).trim()) out[k] = j[k] as string;
        return out;
      },
    }),
  ];
}
