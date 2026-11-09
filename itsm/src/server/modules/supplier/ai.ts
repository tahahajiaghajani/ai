// AI skills of supplier and contract management (docs/spec/AI.md §11; catalogue SUP-013): «استخراج بندهای قرارداد» reads
// the contract's text — its smart document (the «اسناد هوشمند» library reads and, for scans, OCRs the PDF) or its first
// readable attachment — and returns the terms with the quote and page each came from; nothing is saved until a person
// applies the suggestions through the record's own write path. Without a model the rule-based extraction answers
// (`extractContract`), and the route marks it `ai: false`.
import { z } from "zod";
import type { ExtractResult } from "@shared/financial/api";
import { extractContract, parseContractDate } from "@shared/supplier/extract";
import type { Ctx } from "../../context";
import { get } from "../../engine";
import { defineSkill, isAiUnavailable, registerSkill, runSkill, type SkillRuntimeInput } from "../ai/skills";
import { contractText, ruleExtraction, shapeExtraction } from "./service";

const MAX_CHARS = 30_000;

const schema = z.object({
  start_date: z.string().max(30).nullish(),
  end_date: z.string().max(30).nullish(),
  value_rial: z.string().max(40).nullish(),
  notice_period_days: z.number().int().min(0).max(3650).nullish(),
  renewal_type: z.enum(["manual", "auto", "none"]).nullish(),
  payment_frequency: z.enum(["one_off", "monthly", "quarterly", "semiannual", "annual"]).nullish(),
  uc_targets: z.string().max(3000).nullish(),
  summary: z.string().max(3000).nullish(),
  obligations: z.array(z.object({ title: z.string().max(300), party: z.enum(["supplier", "us"]), due_hint: z.string().max(120).nullish(), quote: z.string().max(400).nullish(), page: z.number().int().nullish() })).max(25).nullish(),
  evidence: z.array(z.object({ field: z.string().max(40), quote: z.string().max(400), page: z.number().int().nullish() })).max(20).nullish(),
});
type Extracted = z.infer<typeof schema>;

async function documentFacts(ctx: Ctx, input: SkillRuntimeInput): Promise<{ document: string; source: string | null }> {
  if (!input.record) return { document: "", source: null };
  const t = await contractText(ctx, input.record.row);
  let text = "";
  for (const p of t.pages) {
    if (text.length > MAX_CHARS) break;
    text += `\n[صفحهٔ ${p.page}]\n${p.text}`;
  }
  return { document: text.slice(0, MAX_CHARS), source: t.name };
}

/** The rule-based answer in the skill's shape. */
function ruleAnswer(pages: { page: number; text: string }[]): Extracted {
  const r = extractContract(pages);
  const get = (f: string) => r.fields.find((x) => x.field === f);
  return {
    start_date: (get("start_date")?.value as string) ?? null,
    end_date: (get("end_date")?.value as string) ?? null,
    value_rial: (get("value")?.value as string) ?? null,
    notice_period_days: (get("notice_period_days")?.value as number) ?? null,
    renewal_type: (get("renewal_type")?.value as "auto") ?? null,
    payment_frequency: (get("payment_frequency")?.value as Extracted["payment_frequency"]) ?? null,
    uc_targets: (get("uc_targets")?.value as string) ?? null,
    summary: null,
    obligations: r.obligations.map((o) => ({ title: o.title, party: o.party, due_hint: o.due_hint, quote: o.evidence, page: o.page })),
    evidence: r.fields.map((f) => ({ field: f.field === "value" ? "value_rial" : f.field, quote: f.evidence, page: f.page })),
  };
}

export const SUPPLIER_SKILLS = [
  defineSkill({
    key: "contract.extract",
    name: "استخراج بندهای قرارداد",
    description: "تاریخ‌ها، ارزش، مهلت اعلام، تمدید خودکار، دورهٔ پرداخت، تعهدهای سطح خدمت و تعهدهای طرفین — از متن قرارداد در اسناد هوشمند یا پیوست، با نقل‌قول و شمارهٔ صفحه",
    module: "supplier",
    catalog: ["SUP-013", "ITAM-064"],
    target: "record",
    tables: ["contract"],
    output: "json",
    schema,
    tier: "standard",
    inputs: { fields: ["name", "contract_type", "start_date", "end_date"], journal: "none", links: false },
    roles: ["asset_manager"],
    surfaces: ["module"],
    system: "کار تو: استخراج شرایط یک قرارداد از متن آن. فقط آنچه در متن آمده است؛ برای هر مقدار در evidence نقل‌قول دقیق و شمارهٔ صفحه بیاور. تاریخ‌ها به شکل YYYY/MM/DD همان‌گونه که در متن است (جلالی یا میلادی). مبلغ را به ریال بنویس (تومان × ۱۰). اگر چیزی نیست، آن را خالی بگذار؛ هیچ مقداری نساز.",
    template: "قرارداد:\n{{record}}\n\nمتن قرارداد:\n{{document}}",
    factKeys: ["document", "source"],
    facts: documentFacts,
    fallback: async (ctx: Ctx, input: SkillRuntimeInput) => {
      if (!input.record) return { json: ruleAnswer([]) };
      const t = await contractText(ctx, input.record.row);
      return { json: ruleAnswer(t.pages) };
    },
  }),
];

const normDate = (v: unknown): string | null => (typeof v === "string" && v.trim() ? parseContractDate(v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))) : null);

/** Clause extraction for a contract: the skill's answer (or the rules') shaped into reviewable suggestions. */
export async function extractClauses(ctx: Ctx, id: string): Promise<ExtractResult> {
  const { row, meta } = await get(ctx, "contract", id);
  const readonly = new Set((meta as { readonly?: string[] }).readonly ?? []);
  const writable = (f: string) => !!(meta as { canWrite?: boolean }).canWrite && !readonly.has(f);
  const text = await contractText(ctx, row);
  const source = { kind: text.kind, name: text.name, pages: text.pages.length };
  if (!text.pages.length) return { source, suggestions: [], obligations: [], summary: null, ai: false, model: null };
  let answer: Extracted | null = null;
  let ai = false;
  let model: string | null = null;
  try {
    const r = await runSkill(ctx, "contract.extract", { table: "contract", id, propose: false });
    answer = schema.safeParse(r.json).success ? (r.json as Extracted) : null;
    ai = !r.fallback && !!answer;
    model = r.model;
  } catch (e) {
    if (!isAiUnavailable(e) && (e as { status?: number }).status !== 403) throw e;
  }
  if (!answer) return { source, ...ruleExtraction(row, text.pages, writable), ai: false, model: null };
  const ev = new Map((answer.evidence ?? []).map((x) => [x.field, x]));
  const fields: { field: string; value: unknown; evidence: string | null; page: number | null }[] = [];
  const push = (field: string, value: unknown, key = field) => {
    if (value === null || value === undefined || value === "") return;
    fields.push({ field, value, evidence: ev.get(key)?.quote ?? null, page: ev.get(key)?.page ?? null });
  };
  push("start_date", normDate(answer.start_date));
  push("end_date", normDate(answer.end_date));
  const rial = String(answer.value_rial ?? "").replace(/[^\d]/g, "");
  push("value", rial || null, "value_rial");
  push("notice_period_days", answer.notice_period_days ?? null);
  push("renewal_type", answer.renewal_type ?? null);
  push("payment_frequency", answer.payment_frequency ?? null);
  push("uc_targets", answer.uc_targets ?? null);
  // what the model left out, the rules may still find
  const rules = extractContract(text.pages);
  for (const f of rules.fields) if (!fields.some((x) => x.field === f.field)) fields.push({ field: f.field, value: f.value, evidence: f.evidence, page: f.page });
  return {
    source,
    suggestions: shapeExtraction(row, fields, writable),
    obligations: (answer.obligations ?? []).map((o) => ({ title: o.title, party: o.party, due_hint: o.due_hint ?? null, evidence: o.quote ?? null })),
    summary: answer.summary ?? null,
    ai,
    model,
  };
}

export function installSupplierAi(): (() => void)[] {
  return SUPPLIER_SKILLS.map((s) => registerSkill(s));
}
