// Skills of knowledge management and their implementation of `registerKnowledgeAi` (src/server/modules/knowledge/ai.ts;
// catalogue KB-055/066/070/071/073, AI-027): the KCS draft of an article from a resolved record (the module's scrubbed
// capture — people removed — read with the caller's access), quality pre-scoring against the content standard with
// quoted evidence, a judge of two articles (duplicate, overlapping, distinct or contradicting), metadata suggestions and
// a validation of a draft. The editor's writing assistant goes through the generic writing skills (./generic.ts).
import { z } from "zod";
import type { Ctx } from "../../../../context";
import { DEFAULT_AQI_ITEMS } from "@shared/tables/knowledge";
import { get } from "../../../../engine";
import { registerKnowledgeAi } from "../../../knowledge/ai";
import { draftOfRecord } from "../../../knowledge/capture";
import { defineSkill } from "../registry";
import { runSkill } from "../runtime";
import type { SkillDef } from "../types";

const KCS_TABLES = ["incident", "problem", "known_error", "request_item", "change_request"];

async function articleFacts(ctx: Ctx, id: string) {
  // the other article as the caller reads it: its public text only
  const { row } = await get(ctx, "kb_article", id);
  return { عنوان: row.title ?? null, خلاصه: row.summary ?? null, متن: typeof row.body === "string" ? row.body.slice(0, 12_000) : null };
}

export const knowledgeSkills: SkillDef[] = [
  defineSkill({
    key: "kb.kcs_draft",
    name: "مقالهٔ دانش از این رکورد",
    description: "پیش‌نویس مقاله به روش KCS از رکورد حل‌شده: مسئله، محیط، راه‌حل گام‌به‌گام و علت — بی نام افراد",
    module: "knowledge",
    catalog: ["KB-066", "INC-038"],
    target: "record",
    tables: KCS_TABLES,
    output: "json",
    schema: z.object({ title: z.string().max(250), summary: z.string().max(600).optional(), body: z.string().max(40_000), keywords: z.array(z.string().max(60)).max(15).optional() }),
    tier: "standard",
    // the module's capture is the input: people scrubbed, only what the caller reads
    inputs: { fields: ["short_description"], journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["module"],
    system: "کار تو: نوشتن مقالهٔ دانش به روش KCS از یک رکورد حل‌شده، با بخش‌های «## مسئله»، «## محیط»، «## راه‌حل» (گام‌های شماره‌دار) و «## علت». فقط آنچه رکورد می‌گوید؛ بخشی را که داده ندارد خالی بگذار. هیچ نام، اطلاعات تماس یا دادهٔ ویژهٔ این رکورد را ننویس. عنوان مسئله را با واژه‌های کاربر بگوید.",
    template: "رکورد حل‌شده (افراد حذف شده‌اند):\n{{capture}}",
    factKeys: ["capture"],
    facts: async (ctx, input) => {
      if (!input.table || !input.id) return { capture: null };
      const { draft } = await draftOfRecord(ctx, input.table, input.id);
      return { capture: draft };
    },
  }),
  defineSkill({
    key: "kb.quality",
    name: "سنجش کیفیت مقاله",
    description: "پیش‌نمرهٔ معیارهای استاندارد محتوا (یکتا، کامل، روشن، عنوان، محیط، فراداده، پیوندها، قالب) با شاهد",
    module: "knowledge",
    catalog: ["KB-055", "AI-170"],
    target: "record",
    tables: ["kb_article"],
    output: "json",
    schema: z.object({
      criteria: z.array(z.object({ key: z.string().max(40), met: z.boolean(), evidence: z.string().max(400).optional() })).max(20),
      score: z.number().min(0).max(100),
      suggestions: z.array(z.string().max(300)).max(8).optional(),
    }),
    tier: "standard",
    grounding: { kind: "similar", k: 3 },
    inputs: { journal: "none", links: true },
    roles: ["agent"],
    surfaces: ["panel"],
    order: 30,
    system: "کار تو: سنجش یک مقالهٔ دانش با معیارهای استاندارد محتوا (بلوک items). برای هر معیار met و شاهدی کوتاه که از متن نقل شود؛ برای «یکتا» مقاله‌های مشابه (منابع) را ببین. score مجموع وزن معیارهای برآورده است (از ۱۰۰). چند پیشنهاد کوتاه برای بهتر شدن.",
    template: "مقاله:\n{{record}}\n\nمعیارها:\n{{items}}",
    factKeys: ["items"],
    facts: async () => ({ items: DEFAULT_AQI_ITEMS.map((i) => ({ key: i.key, label: i.label, weight: i.weight })) }),
  }),
  defineSkill({
    key: "kb.duplicate",
    name: "داوری دو مقاله",
    description: "این مقاله و مقالهٔ دیگری که می‌بینید: تکراری، هم‌پوشان، متمایز یا متناقض — با دلیل و پیشنهاد ادغام",
    module: "knowledge",
    catalog: ["KB-073"],
    target: "record",
    tables: ["kb_article"],
    output: "json",
    schema: z.object({ verdict: z.enum(["duplicate", "overlapping", "distinct", "contradicting"]), reason: z.string().max(800), merged: z.string().max(20_000).optional() }),
    tier: "reasoning",
    inputs: { fields: ["title", "summary", "body"], journal: "none", links: false },
    params: [{ name: "other", label: "مقالهٔ دیگر (شناسه)", type: "string", required: true, max: 36 }],
    roles: ["agent"],
    surfaces: ["module"],
    system: "کار تو: داوری دو مقالهٔ دانش. verdict: duplicate (یک مسئله و یک راه‌حل)، overlapping (بخشی مشترک)، distinct یا contradicting (راه‌حل‌های ناسازگار برای یک مسئله). دلیل را با اشاره به متن‌ها بنویس؛ برای duplicate یا overlapping پیش‌نویس ادغام‌شده (Markdown) بده.",
    template: "مقالهٔ نخست:\n{{record}}\n\nمقالهٔ دوم:\n{{other}}",
    factKeys: ["other"],
    facts: async (ctx, input) => ({ other: typeof input.params.other === "string" ? await articleFacts(ctx, input.params.other) : null }),
  }),
  defineSkill({
    key: "kb.metadata",
    name: "پیشنهاد فراداده",
    description: "عنوان جست‌وجوپذیر، خلاصه، واژه‌های کلیدی و برچسب‌ها برای پیش‌نویس مقاله",
    module: "knowledge",
    catalog: ["KB-070"],
    target: "record",
    tables: ["kb_version"],
    output: "fields",
    outputFields: ["title", "summary", "keywords", "tags"],
    tier: "fast",
    inputs: { fields: ["title", "summary", "body", "keywords", "tags"], journal: "none", links: false },
    surfaces: ["panel"],
    system: "کار تو: پیشنهاد فرادادهٔ یک پیش‌نویس مقاله: عنوانی با واژه‌های کاربر (حداکثر ۱۲ واژه)، خلاصهٔ یک‌دوجمله‌ای، واژه‌های کلیدی و برچسب‌ها (هر کدام فهرستی کوتاه). فقط وقتی پیشنهاد بهتر از مقدار کنونی است.",
    template: "پیش‌نویس:\n{{record}}",
  }),
  defineSkill({
    key: "kb.validate",
    name: "وارسی پیش‌نویس",
    description: "بازبینی دوم پیش‌نویس: گام‌های مبهم، بخش‌های جاافتاده، دستورهای پرخطر و ناسازگاری با مقاله‌های منتشرشده",
    module: "knowledge",
    catalog: ["KB-071"],
    target: "record",
    tables: ["kb_version"],
    output: "json",
    schema: z.object({ score: z.number().min(0).max(1), issues: z.array(z.string().max(400)).max(15) }),
    tier: "reasoning",
    grounding: { kind: "knowledge", k: 4 },
    inputs: { fields: ["title", "summary", "body"], journal: "none", links: false },
    roles: ["agent"],
    surfaces: ["panel"],
    system: "کار تو: بازبین دوم یک پیش‌نویس مقاله. ایرادها را فهرست کن: گام مبهم یا وارسی‌ناپذیر، بخش جاافتاده (مسئله، محیط، راه‌حل، علت)، دستور پرخطر بی‌هشدار، ناسازگاری با مقاله‌های منتشرشده (منابع، با ارجاع). score از ۰ تا ۱ برای آمادگی انتشار.",
    template: "پیش‌نویس:\n{{record}}",
  }),
];

export function installKnowledgeAiSkills(): (() => void)[] {
  return [
    registerKnowledgeAi({
      async draftFromRecord(ctx, table, id) {
        const r = await runSkill(ctx, "kb.kcs_draft", { table, id });
        const j = (r.json ?? {}) as { title?: string; summary?: string; body?: string; keywords?: string[] };
        return { title: String(j.title ?? ""), summary: j.summary, body: String(j.body ?? ""), keywords: j.keywords, model: r.model ?? undefined };
      },
      async prescoreAqi(ctx, reviewId) {
        const review = (await get(ctx, "kb_quality_review", reviewId)).row;
        const r = await runSkill(ctx, "kb.quality", { table: "kb_article", id: String(review.article_id) });
        const keys = new Set(DEFAULT_AQI_ITEMS.map((i) => i.key));
        const criteria = ((r.json as { criteria?: { key: string; met: boolean; evidence?: string }[] } | null)?.criteria ?? []).filter((c) => keys.has(c.key));
        return Object.fromEntries(criteria.map((c) => [c.key, { met: !!c.met, evidence: c.evidence }]));
      },
      async judgeDuplicate(ctx, a, b) {
        const r = await runSkill(ctx, "kb.duplicate", { table: "kb_article", id: a, params: { other: b } });
        const j = (r.json ?? {}) as { verdict?: "duplicate" | "overlapping" | "distinct" | "contradicting"; merged?: string };
        return { verdict: j.verdict ?? "distinct", merged: j.merged };
      },
      async suggestMetadata(ctx, versionId) {
        const r = await runSkill(ctx, "kb.metadata", { table: "kb_version", id: versionId });
        return r.suggestions.map((s) => ({ field: s.field, value: s.value, confidence: s.confidence ?? 0.5 }));
      },
      async validate(ctx, versionId) {
        const r = await runSkill(ctx, "kb.validate", { table: "kb_version", id: versionId });
        const j = (r.json ?? {}) as { score?: number; issues?: string[] };
        return { issues: j.issues ?? [], score: typeof j.score === "number" ? j.score : 0 };
      },
    }),
  ];
}
