// Skills of configuration management and the service portfolio, and their implementation of `registerCmdbAi` /
// `registerPortfolioAi` (catalogue CMDB-029/039/041/044, SPF-022/040/042, AI-126…): relationship suggestions for a CI
// (proposals for its owners: CIs the caller may read, with evidence), an explanation of a de-duplication task, a
// governance narrative over the health facts the server computed (numbers come from code), a CI's summary; for
// services a consumer-language description, a translation and a health narrative over the scorecard.
import { z } from "zod";
import type { Ctx } from "../../../../context";
import { get, list } from "../../../../engine";
import { registerCmdbAi } from "../../../cmdb/ai";
import { ciSummaryFacts } from "../../../cmdb/facts";
import { registerPortfolioAi } from "../../../service_portfolio/ai";
import { serviceScorecard } from "../../../service_portfolio/insights";
import { defineSkill } from "../registry";
import { runForModule } from "../runtime";
import type { SkillDef } from "../types";

type Row = Record<string, unknown>;

async function candidates(ctx: Ctx, ci: Row): Promise<Row[]> {
  const words = String(ci.name ?? "").split(/[\s\-_.]+/).filter((w) => w.length > 2).slice(0, 3);
  const seen = new Map<string, Row>();
  for (const w of words.length ? words : [String(ci.name ?? "")]) {
    const r = await list(ctx, "ci", { q: w, size: 15, fields: ["number", "name", "class", "environment"], total: false }).catch(() => null);
    for (const x of r?.rows ?? []) if (x.id !== ci.id) seen.set(String(x.id), { id: x.id, number: x.number, name: x.name, class: x.class });
  }
  return [...seen.values()].slice(0, 30);
}

export const cmdbSkills: SkillDef[] = [
  defineSkill({
    key: "cmdb.summary",
    name: "خلاصهٔ پیکربندی",
    description: "این پیکربندی چیست، به چه وابسته است، چه چیزهایی به آن وابسته‌اند، سلامت داده و رخدادهای باز",
    module: "cmdb",
    catalog: ["CMDB-044", "AI-023"],
    target: "record",
    tables: ["ci"],
    output: "text",
    tier: "fast",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 5,
    system: "کار تو: خلاصهٔ یک پیکربندی (CI) برای کارشناس: چیست و کجاست، مالک و گروه پشتیبانی، وابستگی‌ها و وابسته‌ها، خدمت‌هایی که پشتیبانی می‌کند، سلامت داده و رخدادها یا مشکل‌های باز. عددها فقط از بلوک facts.",
    template: "پیکربندی:\n{{record}}\n\nداده‌های محاسبه‌شده:\n{{facts}}",
    factKeys: ["ci_facts"],
    facts: async (ctx, input) => (input.id ? { ci_facts: await ciSummaryFacts(ctx, input.id).catch(() => null) } : {}),
  }),
  defineSkill({
    key: "cmdb.relationships",
    name: "پیشنهاد رابطه‌های پیکربندی",
    description: "رابطه‌هایی که شاهدها نشان می‌دهند (نام‌ها، شرح، محیط)، با نوع رابطه و امتیاز — برای تأیید مالک",
    module: "cmdb",
    catalog: ["CMDB-041", "AI-127"],
    target: "record",
    tables: ["ci"],
    output: "json",
    schema: z.object({
      suggestions: z.array(z.object({ other: z.string().max(120), direction: z.enum(["parent", "child"]), type: z.string().max(80), score: z.number().min(0).max(1), evidence: z.string().max(400) })).max(10),
    }),
    tier: "standard",
    inputs: { journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["module"],
    system: "کار تو: پیشنهاد رابطه‌های تازه برای یک پیکربندی از میان نامزدها (فقط همان‌ها؛ با شماره یا نام دقیق). direction: parent یعنی نامزد به این پیکربندی وابسته است (والد رابطه)، child یعنی این پیکربندی به نامزد وابسته است. type فقط از گونه‌های رابطه. شاهد را از داده بنویس؛ بی‌شاهد پیشنهاد نده.",
    template: "پیکربندی:\n{{record}}\n\nرابطه‌های کنونی و داده‌ها:\n{{ci_facts}}\n\nنامزدها:\n{{candidates}}\n\nگونه‌های رابطه:\n{{types}}",
    factKeys: ["ci_facts", "candidates", "types"],
    facts: async (ctx, input) => {
      if (!input.record) return {};
      const types = await list(ctx, "ci_rel_type", { size: 60, fields: ["name", "parent_label", "child_label"], total: false }).catch(() => null);
      return { ci_facts: await ciSummaryFacts(ctx, input.record.id).catch(() => null), candidates: await candidates(ctx, input.record.row), types: (types?.rows ?? []).map((t) => ({ id: t.id, name: t.name, parent_label: t.parent_label, child_label: t.child_label })) };
    },
  }),
  defineSkill({
    key: "cmdb.duplicate",
    name: "توضیح پیکربندی‌های تکراری",
    description: "چرا این پیکربندی‌ها تکراری به نظر می‌رسند، کدام باید بماند و علت تکرار",
    module: "cmdb",
    catalog: ["CMDB-029", "AI-129"],
    target: "record",
    tables: ["cmdb_dedup_task"],
    output: "json",
    schema: z.object({ text: z.string().max(4000), survivor: z.string().max(120).optional(), root_cause: z.string().max(600).optional() }),
    tier: "standard",
    inputs: { journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["panel"],
    system: "کار تو: توضیح یک کار حذف تکرار در پایگاه پیکربندی: چه ویژگی‌هایی نامزدها را یکی نشان می‌دهد و چه تفاوت‌هایی دارند، کدام باید بماند (با شماره) و احتمالاً چرا تکرار رخ داده (منبع داده، قاعدهٔ شناسایی). فقط از داده‌ها.",
    template: "کار:\n{{record}}\n\nنامزدها:\n{{cis}}",
    factKeys: ["cis"],
    facts: async (ctx, input) => {
      const ids = Array.isArray(input.record?.row.candidates) ? (input.record!.row.candidates as string[]).slice(0, 8) : [];
      if (!ids.length) return { cis: [] };
      const r = await list(ctx, "ci", { ids, size: ids.length, total: false }).catch(() => null);
      return { cis: (r?.rows ?? []).map((x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => v !== null && v !== "" && !["custom", "version"].includes(k)).slice(0, 40))) };
    },
  }),
  defineSkill({
    key: "cmdb.quality",
    name: "روایت کیفیت دادهٔ پیکربندی",
    description: "روایت مدیریتی سلامت داده‌های پایگاه پیکربندی از عددهای محاسبه‌شده، با کارهای پیشنهادی به ترتیب اثر",
    module: "cmdb",
    catalog: ["CMDB-039", "AI-131"],
    target: "none",
    tables: ["ci"],
    output: "json",
    schema: z.object({ text: z.string().max(6000), recommendations: z.array(z.object({ title: z.string().max(200), path: z.string().max(200).optional() })).max(8).optional() }),
    tier: "standard",
    roles: ["agent"],
    surfaces: ["module"],
    system: "کار تو: روایت کوتاه کیفیت دادهٔ پایگاه پیکربندی برای مدیر پیکربندی: وضع کلی، بدترین شکاف‌ها (کامل‌بودن، درستی، تازگی، تکرار، رابطه‌ها) و کارهای پیشنهادی به ترتیب اثر. همهٔ عددها از بلوک health است؛ هیچ عددی نساز.",
    template: "داده‌های سلامت (محاسبه‌شده):\n{{health}}",
    factKeys: ["health"],
  }),
  defineSkill({
    key: "service.describe",
    name: "شرح خدمت به زبان مشتری",
    description: "شرح، ارزش پیشنهادی، نتیجه‌های مورد انتظار و پرسش‌های رایج، به زبان کاربر",
    module: "service",
    catalog: ["SPF-022"],
    target: "record",
    tables: ["service"],
    output: "json",
    schema: z.object({ description: z.string().max(6000), value_proposition: z.string().max(2000).optional(), outcomes: z.string().max(2000).optional(), faq: z.array(z.object({ q: z.string().max(300), a: z.string().max(1500) })).max(8).optional() }),
    tier: "standard",
    inputs: { journal: "none", links: true },
    params: [{ name: "tone", label: "لحن", type: "choice", default: "plain", choices: [{ value: "plain", label: "ساده" }, { value: "formal", label: "رسمی" }] }],
    roles: ["agent"],
    surfaces: ["panel", "module"],
    system: "کار تو: شرح یک خدمت فناوری اطلاعات به زبان مشتری (نه اصطلاح فنی): این خدمت چه کاری برای کاربر می‌کند، ارزش آن، نتیجه‌های مورد انتظار و چند پرسش رایج با پاسخ. فقط از داده‌های خدمت و گزینه‌هایش.",
    template: "لحن: {{params.tone}}\n\nخدمت:\n{{record}}\n\nپیوندها:\n{{links}}",
  }),
  defineSkill({
    key: "service.translate",
    name: "ترجمهٔ نام و شرح خدمت",
    description: "نام و شرح خدمت به فارسی یا انگلیسی برای بازبینی",
    module: "service",
    catalog: ["SPF-040", "AI-028"],
    target: "record",
    tables: ["service"],
    output: "json",
    schema: z.object({ name: z.string().max(200), description: z.string().max(8000) }),
    tier: "fast",
    inputs: { fields: ["name", "description", "value_proposition"], journal: "none", links: false },
    params: [{ name: "language", label: "به زبان", type: "choice", default: "en", choices: [{ value: "en", label: "انگلیسی" }, { value: "fa", label: "فارسی" }] }],
    surfaces: ["module"],
    system: "کار تو: ترجمهٔ نام و شرح یک خدمت به زبان مقصد، روان و دقیق؛ نام‌های محصول و اصطلاح‌های فنی رایج را درست برگردان.",
    template: "زبان مقصد: {{language}}\n\nخدمت:\n{{record}}",
  }),
  defineSkill({
    key: "service.narrative",
    name: "روایت سلامت خدمت",
    description: "روایت کوتاه وضعیت، دسترس‌پذیری، رخدادها، نقض توافق‌ها و رضایت خدمت از کارنامهٔ محاسبه‌شده",
    module: "service",
    catalog: ["SPF-042", "AI-113"],
    target: "record",
    tables: ["service"],
    output: "text",
    tier: "fast",
    inputs: { fields: ["name", "status", "status_reason", "tier"], journal: "none", links: false },
    surfaces: ["panel", "module"],
    order: 20,
    system: "کار تو: روایت کوتاه سلامت یک خدمت برای مالک آن: وضعیت، دسترس‌پذیری در برابر هدف، رخدادها و نقض توافق‌های ۳۰ روز، مشکل‌های باز و رضایت، و یک کار پیشنهادی. همهٔ عددها فقط از بلوک scorecard (محاسبه‌شده).",
    template: "خدمت:\n{{record}}\n\nکارنامه (محاسبه‌شده):\n{{scorecard}}",
    factKeys: ["scorecard"],
    facts: async (ctx, input) => (input.id ? { scorecard: await serviceScorecard(ctx, input.id).catch(() => null) } : {}),
  }),
];

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export function installCmdbAiSkills(): (() => void)[] {
  return [
    registerCmdbAi({
      async summarize(ctx, ciId, facts) {
        const r = await runForModule(ctx, "cmdb.summary", { table: "ci", id: ciId }, { facts: facts ? { facts } : undefined });
        return { text: r.text ?? "" };
      },
      async suggestRelationships(ctx, ciId) {
        const r = await runForModule(ctx, "cmdb.relationships", { table: "ci", id: ciId });
        const list0 = ((r.json as { suggestions?: { other: string; direction: "parent" | "child"; type: string; score: number; evidence: string }[] } | null)?.suggestions ?? []);
        if (!list0.length) return [];
        const ci = (await get(ctx, "ci", ciId)).row;
        const pool = await candidates(ctx, ci);
        const types = await list(ctx, "ci_rel_type", { size: 60, fields: ["name"], total: false }).catch(() => null);
        const typeId = (t: string) => types?.rows.find((x) => x.name === t || x.id === t)?.id as string | undefined;
        const out: { parent_id: string; child_id: string; type: string; score: number; evidence: unknown }[] = [];
        for (const s of list0) {
          const other = pool.find((c) => c.number === s.other || c.name === s.other || c.id === s.other);
          const type = typeId(s.type);
          if (!other || !isUuid(other.id) || !type) continue;
          out.push({ parent_id: s.direction === "parent" ? String(other.id) : ciId, child_id: s.direction === "parent" ? ciId : String(other.id), type, score: Math.max(0, Math.min(1, s.score)), evidence: { text: s.evidence, ai: true } });
        }
        return out;
      },
      async explainDuplicate(ctx, taskId) {
        const r = await runForModule(ctx, "cmdb.duplicate", { table: "cmdb_dedup_task", id: taskId });
        const j = (r.json ?? {}) as { text?: string; survivor?: string; root_cause?: string };
        let survivor: string | undefined;
        if (j.survivor) {
          const hit = await list(ctx, "ci", { q: j.survivor, size: 1, fields: ["number"], total: false }).catch(() => null);
          survivor = hit?.rows[0]?.id ? String(hit.rows[0].id) : undefined;
        }
        return { text: String(j.text ?? ""), survivor_id: survivor, root_cause: j.root_cause };
      },
      async qualityNarrative(ctx, facts) {
        const r = await runForModule(ctx, "cmdb.quality", {}, { facts: { health: facts } });
        const j = (r.json ?? {}) as { text?: string; recommendations?: { title: string; path?: string }[] };
        return { text: String(j.text ?? ""), recommendations: j.recommendations };
      },
    }),
    registerPortfolioAi({
      async describe(ctx, serviceId, opts) {
        const r = await runForModule(ctx, "service.describe", { table: "service", id: serviceId, params: { tone: opts.tone ?? "plain" } });
        const j = (r.json ?? {}) as { description?: string; value_proposition?: string; outcomes?: string; faq?: { q: string; a: string }[] };
        return { description: String(j.description ?? ""), value_proposition: j.value_proposition, outcomes: j.outcomes, faq: j.faq };
      },
      async translate(ctx, serviceId, to) {
        const r = await runForModule(ctx, "service.translate", { table: "service", id: serviceId, params: { language: to } });
        const j = (r.json ?? {}) as { name?: string; description?: string };
        return { name: String(j.name ?? ""), description: String(j.description ?? "") };
      },
      async narrative(ctx, serviceId, facts) {
        const r = await runForModule(ctx, "service.narrative", { table: "service", id: serviceId }, { facts: facts ? { scorecard: facts } : undefined });
        return { text: r.text ?? "" };
      },
    }),
  ];
}
