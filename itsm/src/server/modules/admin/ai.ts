// AI skills of the administration console (docs/spec/AI.md §11; catalogue ADM-004, ADM-003, ACC-089), each with a
// rule-based answer when no model can answer:
//   · admin.studio_draft    — a Persian description → a custom table's draft (name and fields with types); a draft only,
//                             the administrator reviews it in the studio and nothing is created until they save
//   · admin.import_mapping  — spreadsheet columns → the target table's fields (the import page shows the suggestions)
//   · admin.access_explain  — the access checker's facts → why a member can or cannot see a record, in plain Persian
// The facts every skill sees were computed by code with the administrator's own access; a model never decides access.
import { z } from "zod";
import type { Ctx } from "../../context";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import type { SkillDef } from "../ai/skills/types";
import { draftFromText, fieldNameFor, STUDIO_TYPES, type StudioField } from "@shared/admin/studio";
import { suggestMapping, type FieldHint } from "@shared/admin/mapping";
import { explainAccessText, type ExplainInput } from "@shared/admin/explain";
import type { FieldType } from "@shared/model/types";
import { orgSchema } from "../../engine";
import { access } from "../../access/provider";

const draftSchema = z.object({
  label: z.string().max(60),
  plural: z.string().max(70).nullish(),
  description: z.string().max(500).nullish(),
  fields: z
    .array(
      z.object({
        label: z.string().max(80),
        type: z.string().max(20),
        options: z.array(z.string().max(60)).max(30).nullish(),
        required: z.boolean().nullish(),
      }),
    )
    .max(40),
});

const mappingSchema = z.object({
  mapping: z.array(z.object({ header: z.string().max(200), field: z.string().max(64).nullable(), confidence: z.number().min(0).max(1).nullish(), reason: z.string().max(200).nullish() })).max(200),
});

/** The writable fields of a table for the caller (what an import may set). */
export async function importFields(ctx: Ctx, table: string): Promise<FieldHint[]> {
  const schema = await orgSchema(ctx);
  const def = schema.def(table);
  if (!def || def.virtual) return [];
  const visible = access().visibleFields(ctx, def);
  return def.fields
    .filter((f) => !f.system && !f.readonly && !f.base && f.type !== "secret" && (!visible || visible.has(f.name)))
    .map((f) => ({ name: f.name, label: f.label, type: f.type }));
}

/** A model's draft (or the rule-based one) as studio fields with real names and types. */
export function draftFields(draft: z.infer<typeof draftSchema>): StudioField[] {
  const taken = new Set<string>();
  return draft.fields.map((f, i) => {
    const name = fieldNameFor(f.label, taken);
    taken.add(name);
    const type = (STUDIO_TYPES as string[]).includes(f.type) ? (f.type as FieldType) : "string";
    const out: StudioField = { name, label: f.label.trim(), type, required: !!f.required, list: i < 4, filter: ["choice", "user", "group", "date", "bool"].includes(type), search: type === "string" || type === "text" };
    if (type === "choice" || type === "multichoice") out.options = (f.options ?? []).map((label, j) => ({ value: `o${j + 1}`, label }));
    return out;
  });
}

export const ADMIN_SKILLS: SkillDef[] = [
  defineSkill({
    key: "admin.studio_draft",
    name: "پیش‌نویس جدول از شرح فارسی",
    description: "از یک شرح فارسی («جدول ملاقات‌ها با نام مهمان، تاریخ، میزبان و وضعیت») پیش‌نویس جدول سفارشی و فیلدهای آن را می‌سازد؛ هیچ چیز تا ذخیرهٔ مدیر ساخته نمی‌شود",
    module: "admin",
    catalog: ["ADM-004"],
    target: "none",
    tables: [],
    output: "json",
    schema: draftSchema,
    tier: "fast",
    params: [{ name: "description", label: "شرح جدول", type: "text", required: true, max: 2000 }],
    roles: ["tenant_admin"],
    surfaces: ["module"],
    order: 1,
    system: `کار تو: پیش‌نویس یک جدول سفارشی برای سامانهٔ مدیریت خدمات از روی شرح فارسی. نام جدول (مفرد)، نام جمع، شرح کوتاه و فیلدها را بده. نوع هر فیلد یکی از این‌هاست: ${STUDIO_TYPES.join(", ")}. برای وضعیت، نوع و دسته از choice با چند گزینهٔ فارسی استفاده کن؛ برای افراد user؛ برای تاریخ date. عنوان رکورد را جدا نساز (جدول خودش «عنوان» دارد). چیزی جز آنچه شرح می‌خواهد نساز.`,
    template: "شرح:\n{{params.description}}",
    fallback: async (_ctx, input) => {
      const d = draftFromText(String(input.params.description ?? ""));
      return { json: { label: d.label, plural: d.plural, description: d.description, fields: d.fields.map((f) => ({ label: f.label, type: f.type, options: (f.options ?? []).map((o) => o.label), required: !!f.required })) } };
    },
  }),
  defineSkill({
    key: "admin.import_mapping",
    name: "پیشنهاد نگاشت ستون‌ها",
    description: "ستون‌های یک فایل اکسل یا CSV را با فیلدهای جدول مقصد جور می‌کند (با شرح و اطمینان هر پیشنهاد)",
    module: "admin",
    catalog: ["ADM-003", "INT-011"],
    target: "none",
    tables: [],
    output: "json",
    schema: mappingSchema,
    tier: "fast",
    params: [
      { name: "table", label: "جدول مقصد", type: "string", required: true, max: 64 },
      { name: "headers", label: "ستون‌ها (JSON)", type: "text", required: true, max: 8000 },
      { name: "sample", label: "نمونهٔ ردیف‌ها (JSON)", type: "text", max: 12000 },
    ],
    roles: ["tenant_admin"],
    surfaces: ["module"],
    order: 2,
    system: "کار تو: برای هر ستون فایل، فیلد مناسب جدول مقصد را از بلوک fields پیدا کن (فقط نام‌های همان بلوک؛ اگر فیلد مناسبی نیست field را null بگذار). هر فیلد را فقط به یک ستون بده. confidence بین ۰ و ۱ و reason کوتاه و فارسی باشد. داده‌های نمونه فقط برای فهم معناست.",
    template: "جدول: {{params.table}}\n\nفیلدها:\n{{fields}}\n\nستون‌ها:\n{{params.headers}}\n\nنمونه:\n{{params.sample}}",
    factKeys: ["fields"],
    facts: async (ctx, input) => ({ fields: await importFields(ctx, String(input.params.table ?? "")) }),
    fallback: async (ctx, input) => {
      let headers: string[] = [];
      try {
        headers = (JSON.parse(String(input.params.headers ?? "[]")) as unknown[]).map(String);
      } catch {
        headers = [];
      }
      return { json: { mapping: suggestMapping(headers, await importFields(ctx, String(input.params.table ?? ""))) } };
    },
    post: async (ctx, out, input) => {
      // only fields the caller may set; every field once
      const fields = new Set((await importFields(ctx, String(input.params.table ?? ""))).map((f) => f.name));
      const json = (out.json ?? {}) as z.infer<typeof mappingSchema>;
      const used = new Set<string>();
      const mapping = (json.mapping ?? []).map((m) => {
        if (!m.field || !fields.has(m.field) || used.has(m.field)) return { ...m, field: null };
        used.add(m.field);
        return m;
      });
      return { ...out, json: { mapping } };
    },
  }),
  defineSkill({
    key: "admin.access_explain",
    name: "توضیح دسترسی به زبان ساده",
    description: "چرا یک عضو رکوردی را می‌بیند یا نمی‌بیند، از لایه‌هایی که بررسی دسترسی محاسبه کرده است",
    module: "admin",
    catalog: ["ACC-089"],
    target: "none",
    tables: [],
    output: "text",
    tier: "fast",
    params: [{ name: "facts", label: "یافته‌های بررسی دسترسی (JSON)", type: "text", required: true, max: 20000 }],
    roles: ["tenant_admin"],
    surfaces: ["module"],
    order: 3,
    system: "کار تو: توضیح تصمیم دسترسی برای مدیر سامانه، در دو تا چهار جملهٔ کوتاه و ساده. فقط از یافته‌های بلوک داده استفاده کن: چه لایه‌ای اجازه داد یا جلو را گرفت، با چه نقش‌هایی، و چه فیلدهایی پنهان است. اگر دیدن ممکن نیست بگو با چه تغییری ممکن می‌شود (مثلاً عضویت در گروه یا نقش)، بدون اینکه چیزی بسازی.",
    template: "یافته‌ها:\n{{params.facts}}",
    fallback: async (_ctx, input) => {
      try {
        return { text: explainAccessText(JSON.parse(String(input.params.facts ?? "{}")) as ExplainInput) };
      } catch {
        return { text: "یافته‌های بررسی دسترسی خوانده نشد." };
      }
    },
  }),
];

let installed = false;
export function installAdminSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return ADMIN_SKILLS.map((s) => registerSkill(s));
}
