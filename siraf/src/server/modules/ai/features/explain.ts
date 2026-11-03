// «تحلیل با هوش مصنوعی» on a report: the report runs exactly as on its page (its permissions), a
// bounded summary of its numbers goes to the model, and the explanation is accepted only when its
// numbers are the report's own; otherwise a template explanation from the same numbers is shown.
import { z } from "zod";
import type { Ctx } from "../../../context";
import { D, isNumeric } from "@shared/money";
import { formatNumber } from "@shared/format";
import { AI_REPORT_ALIASES, type AiExplanation } from "@shared/ai/api";
import { isUuid } from "@shared/id";
import { bad } from "../../../http/errors";
import { compact, reportForModel, runReport, reportParams, REPORT_KEYS, type ReportKey, type ReportParams } from "../tools/reports";
import { periodInput, moneyInfo, businessToday, jd, type MoneyInfo, type PeriodArg } from "../tools/common";
import { SYSTEM_RULES, dataBlock, narrate } from "./narrative";
import { loadSettings } from "../settings";

export const explainInput = z.object({
  report: z.string().max(60),
  /** the report page's own parameters (from, to, date, drafts, account_id …) */
  params: z.record(z.string(), z.unknown()).nullish(),
  period: periodInput.nullish(),
  fresh: z.boolean().optional(),
});

export type ExplainView = AiExplanation;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const id = (v: unknown): string | null => (typeof v === "string" && isUuid(v) ? v : null);
const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

/**
 * A report page's parameters → the report service's period and parameters. Unknown names are ignored, so a page
 * can send exactly what it sends to its own endpoint.
 */
export function pageParams(report: string, raw: Record<string, unknown> | null | undefined, period?: PeriodArg | null): { key: ReportKey; period: PeriodArg | null; params: ReportParams } {
  const key = (AI_REPORT_ALIASES[report] ?? report) as ReportKey;
  if (!(REPORT_KEYS as readonly string[]).includes(key)) throw bad("این گزارش را نمی‌توان تحلیل کرد");
  const p = raw ?? {};
  const from = str(p.from);
  // an as-of date ('date') wins over the end of a range
  const to = str(p.date) ?? str(p.to);
  const per: PeriodArg | null = period ?? (from || to ? { from, to } : null);
  const out: ReportParams = {};
  if (truthy(p.drafts) || truthy(p.include_drafts)) out.include_drafts = true;
  const level = Number(p.level);
  if (Number.isInteger(level) && level >= 1 && level <= 3) out.level = level;
  const account = id(p.account_id) ?? str(p.account);
  if (account) out.account = account;
  const party = id(p.party_id) ?? str(p.party);
  if (party) out.party = party;
  if (id(p.detail_id)) out.detail_id = id(p.detail_id);
  const item = id(p.item_id) ?? str(p.item);
  if (item) out.item = item;
  const box = id(p.cash_box_id) ?? str(p.cash_box);
  if (box) out.cash_box = box;
  const bank = id(p.bank_account_id) ?? str(p.bank_account);
  if (bank) out.bank_account = bank;
  if (p.direction === "received" || p.direction === "issued" || p.direction === "both") out.direction = p.direction;
  if (typeof p.group === "string" && ["item", "party", "category", "month", "day", "doc"].includes(p.group)) out.group = p.group as ReportParams["group"];
  if (truthy(p.low) || truthy(p.low_only)) out.low_only = true;
  if (p.scope === "parties" || p.scope === "workshop" || p.scope === "consignment") out.scope = p.scope;
  return { key, period: per, params: reportParams.parse(out) };
}

const LABELS: Record<string, string> = {
  total: "جمع", amount: "مبلغ", debit: "بدهکار", credit: "بستانکار", balance: "مانده", net: "خالص", profit: "سود", cost: "بهای تمام‌شده",
  total_income: "جمع درآمدها", total_expense: "جمع هزینه‌ها", total_assets: "جمع دارایی‌ها", total_liabilities: "جمع بدهی‌ها", total_equity: "جمع حقوق مالکانه",
  current_result: "سود (زیان) دوره", value: "ارزش", qty: "تعداد", tax: "مالیات", items: "تعداد اقلام", low: "کالاهای کم‌موجود", cash_total: "موجودی صندوق‌ها",
  bank_total: "موجودی بانک‌ها", book_value: "ارزش دفتری", market_value: "ارزش روز", unrealized: "سود تحقق‌نیافته", weight750: "وزن (معادل ۷۵۰)", margin: "حاشیهٔ سود",
  opening: "ماندهٔ ابتدای دوره", wage: "اجرت", gold_value: "ارزش طلا", invoices: "تعداد فاکتور", balance_dr: "ماندهٔ بدهکار", balance_cr: "ماندهٔ بستانکار",
};

const WEIGHT_KEYS = /weight|w750|_w$/;

function fmt(key: string, v: string, m: MoneyInfo): string {
  if (/count|items|invoices|docs|pieces|qty|bars|deals|low/.test(key)) return formatNumber(v, { dp: 3 });
  if (WEIGHT_KEYS.test(key)) return `${formatNumber(v, { dp: 3 })} گرم`;
  if (/pct/.test(key)) return `${formatNumber(v, { dp: 2 })}٪`;
  return `${formatNumber(v, { dp: m.dp })} ${m.unit}`;
}

/** Headline numbers of a report output: its totals block and top-level numbers. */
function headline(out: Record<string, any>): [string, string][] {
  const pairs: [string, string][] = [];
  const take = (o: Record<string, unknown> | null | undefined) => {
    if (!o) return;
    for (const [k, v] of Object.entries(o)) if ((typeof v === "string" || typeof v === "number") && isNumeric(v) && LABELS[k]) pairs.push([k, String(v)]);
  };
  take(out.totals);
  take(out);
  return pairs.slice(0, 8);
}

function mainList(out: Record<string, any>): Record<string, any>[] {
  for (const k of ["rows", "categories", "by_currency", "income", "assets"]) if (Array.isArray(out[k])) return out[k];
  return [];
}

function rowLabel(r: Record<string, any>): string {
  return String(r.label ?? r.name ?? r.code ?? r.account_name ?? r.party_name ?? r.key ?? "—");
}

function rowMeasure(r: Record<string, any>): [string, string] | null {
  for (const k of ["amount", "total", "balance", "value", "market_value", "profit", "weight750"]) if (r[k] !== undefined && r[k] !== null && isNumeric(r[k])) return [k, String(r[k])];
  return null;
}

const QUESTIONS: Partial<Record<ReportKey, string[]>> = {
  sales_report: ["کدام کالاها بیشترین سود را داشته‌اند؟", "فروش این دوره با دورهٔ قبل چه فرقی دارد؟", "کدام مشتریان بیشترین خرید را داشته‌اند؟"],
  income_statement: ["بزرگ‌ترین هزینه‌ها کدام‌اند؟", "حاشیهٔ سود نسبت به سال قبل چطور است؟", "سود ماه به ماه چگونه تغییر کرده است؟"],
  balance_sheet: ["نسبت جاری کسب‌وکار چقدر است؟", "مطالبات و بدهی‌ها چه سررسیدی دارند؟"],
  trial_balance: ["کدام حساب‌ها ماندهٔ غیرعادی دارند؟", "گردش حساب‌های اصلی در این دوره چقدر بوده است؟"],
  cheques_due: ["در کدام هفته کسری نقدینگی داریم؟", "کدام چک‌های دریافتی پرخطرند؟"],
  stock: ["کدام کالاها باید سفارش داده شوند؟", "کدام کالاها راکد مانده‌اند؟"],
  gold_sales: ["اجرت و سود فروش طلا در این دوره چقدر بوده است؟", "فروش کدام دسته بیشتر بوده است؟"],
  fx_positions: ["ریسک موقعیت ارزی چقدر است؟", "سود تحقق‌یافتهٔ معاملات ارز چقدر بوده است؟"],
};

function template(title: string, periodFa: string, out: Record<string, any>, m: MoneyInfo): { markdown: string; key_points: string[] } {
  const points = headline(out).map(([k, v]) => `${LABELS[k]}: ${fmt(k, v, m)}`);
  const list = mainList(out);
  // reports with a hierarchy (trial balance): the deepest level only, so a group and its account are not both listed
  const levels = list.map((r) => r.level).filter((l): l is number => typeof l === "number");
  const deepest = levels.length ? Math.max(...levels) : null;
  const rows = list
    .filter((r) => deepest === null || r.level === deepest)
    .map((r) => ({ r, mv: rowMeasure(r) }))
    .filter((x) => x.mv && !D(x.mv[1]).isZero())
    .sort((a, b) => D(b.mv![1]).abs().cmp(D(a.mv![1]).abs()))
    .slice(0, 5);
  const top = rows.map((x) => `- ${rowLabel(x.r)}: ${fmt(x.mv![0], x.mv![1], m)}`);
  // the key points are shown on their own: the text adds the largest rows (or the points when there are none)
  const md = [`**${title}** — ${periodFa}`, "", ...(top.length ? ["**بزرگ‌ترین ردیف‌ها**", ...top] : points.length ? points.map((p) => `- ${p}`) : ["این گزارش در این بازه ردیفی ندارد."])].join("\n");
  return { markdown: md, key_points: points.length ? points : top.map((t) => t.slice(2)) };
}

const explainSchema = z.object({
  markdown: z.string().min(20).max(6000),
  key_points: z.array(z.string().max(300)).min(1).max(6),
  questions: z.array(z.string().max(200)).max(4),
});

export async function explainReport(ctx: Ctx, input: z.infer<typeof explainInput>, opts: { signal?: AbortSignal } = {}): Promise<ExplainView> {
  const today = businessToday(ctx);
  const m = await moneyInfo(ctx);
  const rt = { today, dataPolicy: (await loadSettings(ctx.db, ctx.org.id)).data_policy, putData: async () => "" };
  const req = pageParams(input.report, input.params, input.period ?? null);
  const { def, out, period, to, params } = await runReport(ctx, req.key, { period: req.period, params: req.params }, rt);
  const periodFa = period ? period.label_fa : `تا ${jd(to)}`;
  // the data policy covers what goes to the model; the template shown to the person keeps the names
  const data = { report: def.title_fa, period: periodFa, currency_unit: m.unit, weight_unit: "گرم", result: compact(reportForModel(out, def, params, rt), 40) };
  const tpl = template(def.title_fa, periodFa, out, m);
  const questions = QUESTIONS[req.key] ?? ["مهم‌ترین تغییر نسبت به دورهٔ قبل چیست؟", "چه کاری برای بهبود این ارقام پیشنهاد می‌کنی؟"];
  const n = await narrate(
    ctx,
    {
      job: "analysis", feature: "explain",
      system: `${SYSTEM_RULES}\nExplain a business report to its owner: what the main numbers say, what stands out (largest items, unusual balances, risks), and what to look at next. Markdown, at most 12 lines. key_points: 3–5 one-line findings with their numbers. questions: 2–3 short follow-up questions the owner could ask the assistant. Reply as JSON {"markdown", "key_points", "questions"}.`,
      prompt: `${dataBlock("report", data)}\nExplain this report.`,
      schema: explainSchema, facts: data, text: (o) => [o.markdown, ...o.key_points].join("\n"), signal: opts.signal,
    },
    (o) => ({ markdown: o.markdown, key_points: o.key_points, questions: o.questions.length ? o.questions : questions }),
    () => ({ ...tpl, questions }),
  );
  return { report: req.key, title_fa: def.title_fa, period_fa: periodFa, ...n.value, source: n.source, model: n.model, note_fa: n.note_fa ?? null };
}
