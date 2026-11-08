// Skills of service requests and the catalogue, and their implementation of `registerRequestAi`
// (src/server/modules/request/ai.ts; catalogue REQ-057/058/062, AI-140): a catalogue item drafted from a description
// (the builder saves it as a draft — nothing is published by a model), the answers of an order form pre-filled from
// free text (the server checks them like any answers; the person confirms), items that match a need (retrieval with the
// caller's access, no model) and the summary of a requested item. Questions classed sensitive or secret never reach a
// prompt: `promptSafe` strips them from forms, and the requested item's private and secret answers are kept from every
// model (`keepFromPrompts`).
import { z } from "zod";
import type { FormSchema } from "@shared/request/form";
import { VARIABLE_TYPES } from "@shared/request/vocab";
import { registerRequestAi, promptSafe, type ItemDraft } from "../../../request/ai";
import { retrieve } from "../../rag";
import { keepFromPrompts } from "../context";
import { defineSkill } from "../registry";
import { runForModule } from "../runtime";
import type { SkillDef } from "../types";
import { ruleSummary } from "./generic";

const TYPES = VARIABLE_TYPES.filter((t) => t.value !== "secret" && t.value !== "attachment").map((t) => t.value) as [string, ...string[]];

const itemSchema = z.object({
  name: z.string().max(120),
  short_description: z.string().max(300).optional(),
  description: z.string().max(8000).optional(),
  delivery_days: z.number().int().min(0).max(365).nullable().optional(),
  variables: z
    .array(
      z.object({
        name: z.string().max(60),
        label: z.string().max(120),
        type: z.enum(TYPES),
        required: z.boolean().optional(),
        choices: z.array(z.object({ value: z.string().max(60), label: z.string().max(120) })).max(30).optional(),
        help: z.string().max(300).optional(),
      }),
    )
    .max(30),
  tasks: z.array(z.object({ short_description: z.string().max(200), instructions: z.string().max(2000).optional() })).max(10).optional(),
});

/** The questions of a form as a model may read them (no sensitive or secret question, no answers). */
function formFacts(schema: FormSchema) {
  return {
    item: { name: schema.item.name, type: schema.item.type },
    questions: schema.variables
      .filter((v) => !v.hidden && !v.readonly && v.type !== "label")
      .map((v) => ({ name: v.name, label: v.label, type: v.type, required: !!v.required, choices: v.choices?.map((c) => ({ value: c.value, label: c.label })) ?? undefined, help: v.help ?? undefined })),
  };
}

export const requestSkills: SkillDef[] = [
  defineSkill({
    key: "request.item_generate",
    name: "ساخت قلم کاتالوگ از شرح",
    description: "شرح، پرسش‌ها با نوع و گزینه‌ها، زمان تحویل و کارهای انجام — پیش‌نویسی که سازندهٔ کاتالوگ بازبینی و ذخیره می‌کند",
    module: "request",
    catalog: ["REQ-058", "AI-140"],
    target: "text",
    tables: ["catalog_item"],
    output: "json",
    schema: itemSchema,
    tier: "standard",
    grounding: { kind: "similar", k: 3 },
    query: (input) => String(input.text ?? "").slice(0, 400),
    surfaces: ["module"],
    system: `کار تو: پیش‌نویس یک قلم کاتالوگ خدمت از شرحی که مدیر کاتالوگ نوشته است: نام کوتاه، خلاصه، شرح برای کاربر، پرسش‌های فرم (نام لاتین با حروف کوچک و _، برچسب فارسی، نوع از گونه‌های مجاز، گزینه‌ها برای پرسش‌های انتخابی)، زمان تحویل به روز و کارهای انجام. از قلم‌های مشابه (منابع) الگو بگیر. هیچ پرسشی برای رمز، گذرواژه یا داده‌ای حساس‌تر از نیاز طرح نکن.`,
    template: "شرح خدمت:\n{{text}}\n\nگونه‌های مجاز پرسش:\n{{types}}",
    factKeys: ["types"],
    facts: async () => ({ types: VARIABLE_TYPES.filter((t) => (TYPES as string[]).includes(t.value)).map((t) => ({ value: t.value, label: t.label })) }),
  }),
  defineSkill({
    key: "request.prefill",
    name: "پر کردن فرم سفارش از متن",
    description: "پاسخ پرسش‌های فرم از متنی که کاربر نوشته (یا ایمیل)، با اطمینان هر پاسخ؛ کاربر پیش از ثبت تأیید می‌کند",
    module: "request",
    catalog: ["REQ-057"],
    target: "text",
    tables: ["catalog_item"],
    output: "json",
    schema: z.object({ answers: z.array(z.object({ name: z.string().max(60), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]), confidence: z.number().min(0).max(1) })).max(60) }),
    tier: "fast",
    surfaces: ["module"],
    system: `کار تو: پاسخ دادن به پرسش‌های یک فرم سفارش از متنی که کاربر نوشته است. فقط پرسش‌هایی را پاسخ بده که متن صریحاً جوابشان را دارد؛ برای پرسش‌های انتخابی فقط value یکی از گزینه‌ها؛ تاریخ‌ها به شکل YYYY-MM-DD. برای هر پاسخ اطمینان واقعی بده. پاسخی را که در متن نیست حدس نزن.`,
    template: "فرم:\n{{form}}\n\nمتن کاربر:\n{{text}}",
    factKeys: ["form"],
  }),
  defineSkill({
    key: "request.summary",
    name: "خلاصهٔ قلم درخواست",
    description: "خلاصهٔ سفارش، وضعیت تأیید و انجام، کارها و گام بعدی — بی پاسخ‌های حساس",
    module: "request",
    catalog: ["REQ-062", "AI-023"],
    target: "record",
    tables: ["request_item"],
    output: "text",
    tier: "fast",
    inputs: { journal: "all", journalLimit: 30, related: [{ table: "request_task", field: "request_item_id", label: "کارهای انجام", fields: ["number", "short_description", "state", "assigned_to"], limit: 20 }] },
    surfaces: ["panel"],
    order: 5,
    system: "کار تو: خلاصهٔ یک قلم درخواست برای کارشناس انجام یا تأییدکننده: «چه سفارش داده شده»، «وضعیت تأیید و انجام»، «کارها»، «گام بعدی».",
    template: "قلم درخواست:\n{{record}}\n\nکارها:\n{{related}}\n\nیادداشت‌ها:\n{{journal}}",
    fallback: async (_ctx, input) => ruleSummary(input),
  }),
];

export function installRequestAi(): (() => void)[] {
  // what never reaches a prompt, whoever reads the record: sensitive and secret answers (REQ-041)
  const off = [
    keepFromPrompts("request_item", ["answers", "private_answers", "secret_answers"]),
    keepFromPrompts("request_answer", ["value_text", "value_num", "value_date"]),
    keepFromPrompts("request_cart_line", ["answers", "private_answers", "secret_answers"]),
  ];
  off.push(
    registerRequestAi({
      async generateItem(ctx, input): Promise<ItemDraft> {
        const r = await runForModule(ctx, "request.item_generate", { text: input.text });
        const j = itemSchema.parse(r.json ?? {});
        const vars = j.variables
          .map((v, i) => ({ ...v, name: (v.name.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "") || `q${i + 1}`).slice(0, 60) }))
          .filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i);
        const generated = ["name", "short_description", "description", "variables", ...(j.delivery_days !== undefined ? ["delivery_days"] : []), ...(j.tasks?.length ? ["tasks"] : [])];
        return { name: j.name, short_description: j.short_description, description: j.description, delivery_days: j.delivery_days ?? null, variables: vars, tasks: j.tasks, generated };
      },
      async prefill(ctx, input) {
        const safe = promptSafe(input.schema, {}).schema;
        const known = new Set(safe.variables.map((v) => v.name));
        const r = await runForModule(ctx, "request.prefill", { text: input.text }, { facts: { form: formFacts(safe) } });
        const list = ((r.json as { answers?: { name: string; value: unknown; confidence: number }[] } | null)?.answers ?? []).filter((a) => known.has(a.name) && a.value !== null && a.value !== "");
        return { answers: Object.fromEntries(list.map((a) => [a.name, a.value])), confidence: Object.fromEntries(list.map((a) => [a.name, Math.max(0, Math.min(1, a.confidence))])) };
      },
      async matchItems(ctx, input) {
        const r = await retrieve(ctx, input.text, { tables: ["catalog_item"], k: Math.min(input.limit, 20) });
        const best = Math.max(...r.passages.map((p) => p.score), 1e-9);
        const seen = new Set<string>();
        return r.passages.filter((p) => !seen.has(p.citation.id) && seen.add(p.citation.id)).map((p) => ({ id: p.citation.id, score: Math.max(0, Math.min(1, p.score / best)) }));
      },
      async summarize(ctx, input) {
        const r = await runForModule(ctx, "request.summary", { table: "request_item", id: input.requestItemId });
        return { text: r.text ?? "" };
      },
    }),
  );
  return off;
}
