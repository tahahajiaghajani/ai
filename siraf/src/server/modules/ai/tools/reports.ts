// run_report: the business's own report services with the permissions of their routes. The output
// is the service's own numbers, compacted for the model: the main list is cut to `limit` rows (the
// whole list is stored for the table in the answer), totals are kept, dates get a Jalali twin.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { Area, Level } from "@shared/permissions";
import type { AiRef } from "@shared/ai/types";
import { D } from "@shared/money";
import { bad, forbidden } from "../../../http/errors";
import * as acc from "../../accounting/reports";
import * as tre from "../../treasury/reports";
import { analysis, kardex, stockReport as goodsStock } from "../../goods/reports";
import { partyBalances as goldParties, salesReport as goldSales, stockReport as goldStock } from "../../gold/reports";
import { catalogue } from "../../gold/catalogue";
import { goldPosition } from "../../gold/position";
import { cashReport, correspondentBalances, dealsReport, positions } from "../../fx/reports";
import { listRemittances } from "../../fx/remittances";
import { defineTool, type ToolRuntime } from "./registry";
import { jd, moneyInfo, partyName, period, periodInput, reportRef, resolveAccount, resolveItem, resolveMoneyBox, resolveParty, type MoneyInfo } from "./common";
import { parseDateInput, type ResolvedPeriod } from "../analytics/period";
import { AI_REPORT_KEYS } from "@shared/ai/api";

export const REPORT_KEYS = AI_REPORT_KEYS;
export type ReportKey = (typeof REPORT_KEYS)[number];

type Col = { key: string; title: string; numeric?: boolean };

interface ReportDef {
  title_fa: string;
  needs: [Area, Level][];
  module?: "goods" | "gold" | "fx";
  path: string;
  /** default period preset when the report has a range */
  period?: "this_month" | "fiscal_year" | "year_to_date" | "next" | "none" | "asof";
  /** where the main list is in the output, and its columns for the table */
  main?: string;
  columns?: Col[];
  run(ctx: Ctx, a: ReportArgs): Promise<Record<string, any>>;
}

export interface ReportArgs {
  period: ResolvedPeriod | null;
  /** as-of date for balance-type reports */
  to: string;
  params: ReportParams;
  rt: ToolRuntime;
}

const money = (key: string, title: string): Col => ({ key, title, numeric: true });

export const reportParams = z
  .object({
    account: z.string().max(120).nullish().describe("ledger/detail_balances: account id, code or exact name"),
    party: z.string().max(120).nullish().describe("party_statement/sales/purchases: party id or exact name, code, national id or mobile"),
    detail_id: z.string().uuid().nullish().describe("ledger: id of a detail (تفصیلی) account, instead of party"),
    item: z.string().max(120).nullish().describe("kardex/sales/purchases: item id, code or exact name"),
    cash_box: z.string().max(120).nullish().describe("cash_bank_book: cash box id/code/name (or give bank_account)"),
    bank_account: z.string().max(120).nullish().describe("cash_bank_book: bank account id/code/name"),
    direction: z.enum(["received", "issued", "both"]).nullish().describe("cheques_due: received (receivable) or issued (payable)"),
    group: z.enum(["item", "party", "category", "month", "day", "doc"]).nullish().describe("sales_report/purchases_report: item|party|category|month|day; gold_sales: day|month|doc|category|party"),
    level: z.number().int().min(1).max(3).nullish().describe("trial_balance: 1 group, 2 general, 3 subsidiary (default 3)"),
    low_only: z.boolean().nullish().describe("stock: only items at or below their reorder point"),
    scope: z.enum(["parties", "workshop", "consignment"]).nullish().describe("gold_parties: whose gold balances"),
    include_drafts: z.boolean().nullish().describe("accounting reports: include draft vouchers"),
  })
  .partial();
export type ReportParams = z.infer<typeof reportParams>;

const accRange = (a: ReportArgs) => ({ from: a.period?.from ?? null, to: a.period?.to ?? a.to, includeDrafts: !!a.params.include_drafts });

async function detailOfParty(ctx: Ctx, query: string) {
  const p = await resolveParty(ctx.db, ctx, query);
  if (!p.detail_id) throw bad(`برای «${p.name}» هنوز حساب تفصیلی ساخته نشده است`);
  return p;
}

const REPORTS: Record<ReportKey, ReportDef> = {
  trial_balance: {
    title_fa: "تراز آزمایشی", needs: [["reports", "view"]], path: "reports/trial-balance", period: "fiscal_year", main: "rows",
    columns: [{ key: "code", title: "کد" }, { key: "name", title: "حساب" }, money("opening", "مانده ابتدا"), money("debit", "بدهکار"), money("credit", "بستانکار"), money("balance", "مانده")],
    run: (ctx, a) => acc.trialBalance(ctx.db, ctx.org.id, { ...accRange(a), level: a.params.level ?? 3, nonZero: true }),
  },
  income_statement: {
    title_fa: "صورت سود و زیان", needs: [["reports", "view"]], path: "reports/income-statement", period: "fiscal_year",
    run: (ctx, a) => acc.incomeStatement(ctx.db, ctx.org.id, accRange(a)),
  },
  balance_sheet: {
    title_fa: "ترازنامه", needs: [["reports", "view"]], path: "reports/balance-sheet", period: "asof",
    run: (ctx, a) => acc.balanceSheet(ctx.db, ctx.org.id, { to: a.to, includeDrafts: !!a.params.include_drafts }),
  },
  ledger: {
    title_fa: "دفتر حساب", needs: [["reports", "view"]], path: "reports/ledger", period: "fiscal_year", main: "rows",
    columns: [{ key: "date_fa", title: "تاریخ" }, { key: "voucher_no", title: "سند" }, { key: "description", title: "شرح" }, money("debit", "بدهکار"), money("credit", "بستانکار"), money("balance", "مانده")],
    async run(ctx, a) {
      if (!a.params.account && !a.params.party && !a.params.detail_id) throw bad("برای دفتر حساب، حساب یا شخص را بدهید");
      const account = a.params.account ? await resolveAccount(ctx.db, ctx, a.params.account) : null;
      const party = a.params.party ? await detailOfParty(ctx, a.params.party) : null;
      const detail = !party && a.params.detail_id
        ? await ctx.db.one<{ id: string; name: string }>(`select id, name from tz_details where id = $1 and org_id = $2 and deleted_at is null`, [a.params.detail_id, ctx.org.id])
        : null;
      if (a.params.detail_id && !party && !detail) throw bad("حساب تفصیلی پیدا نشد");
      const r = await acc.ledger(ctx.db, ctx.org.id, { ...accRange(a), accountId: account?.id ?? null, detailId: party?.detail_id ?? detail?.id ?? null });
      return { account: account ? `${account.code} ${account.name}` : null, party: party?.name ?? detail?.name ?? null, ...r };
    },
  },
  party_statement: {
    title_fa: "صورت‌حساب شخص", needs: [["reports", "view"]], path: "reports/ledger", period: "fiscal_year", main: "rows",
    columns: [{ key: "date_fa", title: "تاریخ" }, { key: "voucher_no", title: "سند" }, { key: "description", title: "شرح" }, money("debit", "بدهکار"), money("credit", "بستانکار"), money("balance", "مانده")],
    async run(ctx, a) {
      if (!a.params.party) throw bad("شخص را بدهید");
      const party = await detailOfParty(ctx, a.params.party);
      return { party: party.name, ...(await acc.partyStatement(ctx.db, ctx.org.id, party.detail_id!, accRange(a))) };
    },
  },
  journal: {
    title_fa: "دفتر روزنامه", needs: [["reports", "view"]], path: "reports/journal", period: "this_month", main: "rows",
    columns: [{ key: "date_fa", title: "تاریخ" }, { key: "no", title: "سند" }, { key: "account_name", title: "حساب" }, { key: "description", title: "شرح" }, money("debit", "بدهکار"), money("credit", "بستانکار")],
    run: async (ctx, a) => ({ rows: await acc.journal(ctx.db, ctx.org.id, accRange(a)) }),
  },
  detail_balances: {
    title_fa: "ماندهٔ حساب‌های تفصیلی", needs: [["reports", "view"]], path: "reports/detail-balances", period: "asof", main: "rows",
    columns: [{ key: "code", title: "کد" }, { key: "name", title: "تفصیلی" }, money("debit", "بدهکار"), money("credit", "بستانکار"), money("balance", "مانده")],
    async run(ctx, a) {
      const account = a.params.account ? await resolveAccount(ctx.db, ctx, a.params.account) : null;
      const rows = await acc.detailBalances(ctx.db, ctx.org.id, { to: a.to, includeDrafts: !!a.params.include_drafts, accountId: account?.id ?? null });
      return { account: account ? `${account.code} ${account.name}` : null, rows: (rows as Record<string, any>[]).filter((r) => !D(r.balance).isZero()).sort((x, y) => D(y.balance).abs().cmp(D(x.balance).abs())) };
    },
  },
  cash_bank_book: {
    title_fa: "دفتر صندوق و بانک", needs: [["treasury", "view"]], path: "treasury/book", period: "this_month", main: "rows",
    columns: [{ key: "date_fa", title: "تاریخ" }, { key: "description", title: "شرح" }, money("debit", "واریز"), money("credit", "برداشت"), money("balance", "مانده")],
    async run(ctx, a) {
      const kind = a.params.bank_account ? "bank" : "cash";
      const box = await resolveMoneyBox(ctx.db, ctx, kind, kind === "bank" ? a.params.bank_account : a.params.cash_box);
      return tre.cashBankBook(ctx.db, ctx, { kind, id: box.id, from: a.period?.from, to: a.period?.to });
    },
  },
  treasury_balances: {
    title_fa: "موجودی صندوق‌ها و بانک‌ها", needs: [["treasury", "view"]], path: "treasury/balances", period: "none",
    run: (ctx) => tre.balances(ctx.db, ctx),
  },
  cheques_due: {
    title_fa: "سررسید چک‌ها", needs: [["treasury", "view"]], path: "treasury/cheques-due", period: "next", main: "rows",
    columns: [{ key: "due_date_fa", title: "سررسید" }, { key: "direction", title: "نوع" }, { key: "serial_no", title: "سریال" }, { key: "party_name", title: "شخص" }, money("amount", "مبلغ"), { key: "status", title: "وضعیت" }],
    run: (ctx, a) => tre.chequesDue(ctx.db, ctx, { direction: a.params.direction === "both" ? null : a.params.direction, from: a.period?.from, to: a.period?.to }),
  },
  sales_report: {
    title_fa: "گزارش فروش کالا", needs: [["reports", "view"]], module: "goods", path: "reports/sales", period: "this_month", main: "rows",
    columns: [{ key: "label", title: "عنوان" }, money("qty", "تعداد"), money("amount", "مبلغ"), money("cost", "بهای تمام‌شده"), money("profit", "سود"), money("margin_pct", "حاشیه٪")],
    run: (ctx, a) => goodsAnalysis(ctx, "sales", a),
  },
  purchases_report: {
    title_fa: "گزارش خرید کالا", needs: [["reports", "view"]], module: "goods", path: "reports/purchases", period: "this_month", main: "rows",
    columns: [{ key: "label", title: "عنوان" }, money("qty", "تعداد"), money("amount", "مبلغ"), { key: "invoices", title: "فاکتور", numeric: true }],
    run: (ctx, a) => goodsAnalysis(ctx, "purchases", a),
  },
  stock: {
    title_fa: "موجودی کالا", needs: [["inventory", "view"]], module: "goods", path: "inventory/stock", period: "asof", main: "rows",
    columns: [{ key: "code", title: "کد" }, { key: "name", title: "کالا" }, money("qty", "موجودی"), money("avg_cost", "میانگین بها"), money("value", "ارزش"), money("reorder_point", "نقطهٔ سفارش")],
    run: (ctx, a) => goodsStock(ctx, { date: a.to, low: a.params.low_only ? "1" : undefined }),
  },
  kardex: {
    title_fa: "کاردکس کالا", needs: [["inventory", "view"]], module: "goods", path: "inventory/kardex", period: "fiscal_year", main: "rows",
    columns: [{ key: "date_fa", title: "تاریخ" }, { key: "doc_title", title: "سند" }, money("in_qty", "ورود"), money("out_qty", "خروج"), money("balance_qty", "مانده"), money("balance_value", "ارزش مانده")],
    async run(ctx, a) {
      if (!a.params.item) throw bad("کالا را بدهید");
      const item = await resolveItem(ctx.db, ctx, a.params.item, ["goods"]);
      return kardex(ctx, { item_id: item.id, from: a.period?.from, to: a.period?.to });
    },
  },
  gold_stock: {
    title_fa: "موجودی طلا", needs: [["gold", "view"]], module: "gold", path: "gold/reports/stock", period: "asof", main: "categories",
    columns: [{ key: "name", title: "دسته" }, { key: "pieces", title: "تعداد", numeric: true }, money("net_weight", "وزن خالص"), money("weight750", "معادل ۷۵۰")],
    run: (ctx, a) => goldStock(ctx, { to: a.to }),
  },
  gold_sales: {
    title_fa: "گزارش فروش طلا", needs: [["gold", "view"]], module: "gold", path: "gold/reports/sales", period: "this_month", main: "rows",
    columns: [{ key: "label", title: "عنوان" }, money("weight750", "وزن ۷۵۰"), money("gold_value", "ارزش طلا"), money("wage", "اجرت"), money("profit", "سود"), money("total", "جمع"), money("margin", "حاشیه")],
    run: (ctx, a) => goldSales(ctx, { from: a.period?.from, to: a.period?.to, group: a.params.group && ["day", "month", "doc", "category", "party"].includes(a.params.group) ? a.params.group : "month" }),
  },
  gold_parties: {
    title_fa: "ماندهٔ طلای اشخاص", needs: [["gold", "view"]], module: "gold", path: "gold/reports/parties", period: "asof", main: "rows",
    run: (ctx, a) => goldParties(ctx, { to: a.to, scope: a.params.scope ?? "parties" }),
  },
  gold_position: {
    title_fa: "موقعیت طلا", needs: [["gold", "view"]], module: "gold", path: "gold/reports/position", period: "asof", main: "rows",
    columns: [{ key: "title", title: "ردیف" }, money("weight750", "معادل ۷۵۰ (گرم)"), money("pure", "طلای خالص (گرم)"), money("book", "ارزش دفتری"), money("value", "ارزش به نرخ خرید")],
    run: async (ctx, a) => goldPosition(ctx, a.to) as unknown as Record<string, any>,
  },
  gold_coins: {
    title_fa: "موجودی سکه", needs: [["gold", "view"]], module: "gold", path: "gold/coins", period: "asof", main: "rows",
    columns: [{ key: "name", title: "سکه" }, money("qty", "تعداد"), money("avg_cost", "میانگین بها"), money("value", "ارزش دفتری"), money("sell", "نرخ فروش"), money("buy_value", "ارزش به نرخ خرید")],
    async run(ctx, a) {
      ctx.need("gold", "view");
      const r = await catalogue(ctx.db, ctx, { kind: "coin", to: a.to });
      return { rows: r.rows.filter((x) => !D(x.qty).isZero() || x.is_active) };
    },
  },
  gold_bars: {
    title_fa: "موجودی شمش", needs: [["gold", "view"]], module: "gold", path: "gold/bars", period: "asof", main: "rows",
    columns: [{ key: "name", title: "مدل" }, money("qty", "تعداد"), money("weight", "وزن (گرم)"), money("pure", "طلای خالص"), money("value", "بهای دفتری"), money("buy", "نرخ خرید هر شمش")],
    async run(ctx, a) {
      ctx.need("gold", "view");
      const r = await catalogue(ctx.db, ctx, { kind: "bar", to: a.to });
      const rows = r.rows.filter((x) => !D(x.qty).isZero());
      const t = rows.reduce((s, x) => ({ bars: s.bars.plus(D(x.qty)), weight: s.weight.plus(D(x.weight)), pure: s.pure.plus(D(x.pure)), w750: s.w750.plus(D(x.weight750)), value: s.value.plus(D(x.value)) }), { bars: D(0), weight: D(0), pure: D(0), w750: D(0), value: D(0) });
      return { rows, totals: { bars: t.bars.toString(), weight: t.weight.toString(), pure: t.pure.toString(), weight750: t.w750.toString(), value: t.value.toString() } };
    },
  },
  fx_positions: {
    title_fa: "موقعیت ارزی", needs: [["fx", "view"], ["reports", "view"]], module: "fx", path: "fx/reports/positions", period: "asof", main: "rows",
    columns: [{ key: "code", title: "ارز" }, money("holdings", "موجودی"), money("book_value", "ارزش دفتری"), money("market_value", "ارزش روز"), money("unrealized", "سود/زیان تحقق‌نیافته")],
    run: (ctx, a) => positions(ctx, { date: a.to }),
  },
  fx_cash: {
    title_fa: "گزارش صندوق ارزی", needs: [["fx", "view"]], module: "fx", path: "fx/reports/cash", period: "asof", main: "rows",
    run: (ctx, a) => cashReport(ctx, { date: a.to }),
  },
  fx_deals: {
    title_fa: "گزارش معاملات ارز", needs: [["fx", "view"], ["reports", "view"]], module: "fx", path: "fx/reports/deals", period: "this_month", main: "by_currency",
    run: (ctx, a) => dealsReport(ctx, { from: a.period?.from, to: a.period?.to }),
  },
  fx_correspondents: {
    title_fa: "ماندهٔ کارگزاران", needs: [["fx", "view"]], module: "fx", path: "fx/reports/correspondents", period: "asof", main: "rows",
    run: (ctx, a) => correspondentBalances(ctx, { date: a.to }),
  },
  fx_remittances: {
    title_fa: "حواله‌ها", needs: [["fx", "view"]], module: "fx", path: "fx/remittances", period: "this_month", main: "rows",
    columns: [{ key: "date_fa", title: "تاریخ" }, { key: "no", title: "شماره" }, { key: "party_name", title: "شخص" }, { key: "currency_code", title: "ارز" }, money("amount", "مبلغ"), { key: "status", title: "وضعیت" }],
    run: (ctx, a) => listRemittances(ctx, { from: a.period?.from, to: a.period?.to, size: 500 }),
  },
};

async function goodsAnalysis(ctx: Ctx, side: "sales" | "purchases", a: ReportArgs) {
  const q: Record<string, string | undefined> = { group: a.params.group && ["item", "party", "category", "month", "day"].includes(a.params.group) ? a.params.group : "item", from: a.period?.from, to: a.period?.to };
  if (a.params.party) q.party_id = (await resolveParty(ctx.db, ctx, a.params.party)).id;
  if (a.params.item) q.item_id = (await resolveItem(ctx.db, ctx, a.params.item, ["goods", "service"])).id;
  return analysis(ctx, side, q);
}

export function reportDef(key: ReportKey): ReportDef {
  return REPORTS[key];
}

export function reportAllowed(ctx: Ctx, key: ReportKey): boolean {
  const r = REPORTS[key];
  return (!r.module || ctx.hasModule(r.module)) && r.needs.every(([a, l]) => ctx.can(a, l));
}

function needReport(ctx: Ctx, key: ReportKey) {
  const r = REPORTS[key];
  if (r.module && !ctx.hasModule(r.module)) throw forbidden(`«${r.title_fa}» در بخش‌های فعال این کسب‌وکار نیست`);
  for (const [a, l] of r.needs) ctx.need(a, l);
}

// ---------------------------------------------------------------- compaction

const DROP = /^(org_id|rev|origin|created_at|updated_at|deleted_at|.*_detail_kinds|.*_detail_mode|history|extra|settle|buyer|moadian|walkin)$/;

/** Bounded copy of a report output: arrays cut to `limit`, ids kept, dates with Jalali twins. */
export function compact(v: unknown, limit: number, depth = 0): unknown {
  if (Array.isArray(v)) {
    const out = v.slice(0, limit).map((x) => compact(x, limit, depth + 1));
    return v.length > limit ? { rows: out, total_rows: v.length, truncated: true } : out;
  }
  if (v && typeof v === "object") {
    if (depth > 5) return null;
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (DROP.test(k) || x === null || x === undefined || x === "") continue;
      o[k] = compact(x, limit, depth + 1);
      if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) && /(date|^to$|^from$|as_of|_at$|^at$|^key$)/.test(k)) o[`${k}_fa`] = jd(x);
    }
    return o;
  }
  return v;
}

function mainRows(out: Record<string, any>, main?: string): Record<string, unknown>[] | null {
  if (!main) return null;
  const rows = out[main];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
}

/** Run a report as the caller (permissions of its route) — shared with the explain feature. */
export async function runReport(ctx: Ctx, key: ReportKey, input: { period?: z.infer<typeof periodInput> | null; params?: ReportParams | null }, rt: ToolRuntime) {
  needReport(ctx, key);
  const def = REPORTS[key];
  const params = input.params ?? {};
  let per: ResolvedPeriod | null = null;
  let to = rt.today;
  if (def.period === "asof") {
    const raw = input.period?.to ?? null;
    if (raw) {
      const parsed = parseDateInput(raw, rt.today);
      if (!parsed) throw bad(`تاریخ «${raw}» معتبر نیست`);
      to = parsed;
    } else if (input.period?.preset) to = (await period(ctx, input.period, rt.today, "this_month")).to;
  } else if (def.period === "next") {
    per = input.period && (input.period.preset || input.period.from || input.period.to) ? await period(ctx, input.period, rt.today, "this_month") : null;
  } else if (def.period && def.period !== "none") {
    per = await period(ctx, input.period ?? null, rt.today, def.period === "fiscal_year" ? "fiscal_year" : def.period === "year_to_date" ? "year_to_date" : "this_month");
    to = per.to;
  }
  const out = await def.run(ctx, { period: per, to, params, rt });
  return { def, out, period: per, to, params };
}

/**
 * What the model sees of a report output. Under "aggregates", rows grouped by party carry the
 * party's name as their label: the model gets the party's code, or a ranked placeholder when the
 * row has none («شخص 1», «شخص 2»…, as analyze_metric does). The person's own table and texts keep
 * the names — `out` itself is never changed.
 */
export function reportForModel(out: Record<string, any>, def: { main?: string }, params: ReportParams | null | undefined, rt: Pick<ToolRuntime, "dataPolicy">): Record<string, any> {
  if (!(rt.dataPolicy === "aggregates" && params?.group === "party" && def.main && Array.isArray(out[def.main]))) return out;
  const rows = (out[def.main] as Record<string, unknown>[]).map((r, i) => {
    const code = (r.code as string | number | null | undefined) ?? null;
    const label = r.key === "walkin" ? r.label : code ? partyName(null, code, rt) : `شخص ${i + 1}`;
    return { ...r, label, name: undefined, party_name: undefined };
  });
  return { ...out, [def.main]: rows };
}

export const runReportTool = defineTool({
  name: "run_report",
  title_fa: "اجرای گزارش",
  description:
    "Runs one of the business's standard reports exactly as its page does and returns its numbers (money in the base currency unit, weights in grams, gold weights also as 750-equivalent). Reports: trial_balance, income_statement, balance_sheet (as of period.to), ledger (account or party), party_statement (party), journal, detail_balances, cash_bank_book (cash_box or bank_account), treasury_balances, cheques_due (direction), sales_report / purchases_report (goods; group item|party|category|month|day), stock (goods; low_only), kardex (goods; item), gold_stock, gold_position (all gold held and owed in 750-equivalent and pure grams), gold_sales (group day|month|doc|category|party), gold_parties (scope), gold_coins, gold_bars, fx_positions, fx_cash, fx_deals, fx_correspondents, fx_remittances. Lists are cut to `limit` rows (total_rows tells the full size, the full list is shown to the person as a table); totals always cover everything. Accounting reports count posted vouchers unless include_drafts. Default periods: the current fiscal year for accounting, this Jalali month for sales.",
  input: z.object({
    report: z.enum(REPORT_KEYS),
    period: periodInput.nullish(),
    params: reportParams.nullish(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input, rt) {
    const m: MoneyInfo = await moneyInfo(ctx);
    const { def, out, period: per, to, params } = await runReport(ctx, input.report, input, rt);
    const rows = mainRows(out, def.main);
    let data_ref: string | undefined;
    let table: { title?: string; columns: Col[]; total_rows: number } | undefined;
    if (rows && rows.length && def.columns) {
      const withFa = rows.slice(0, 2000).map((r) => {
        const o: Record<string, unknown> = { ...r };
        for (const c of def.columns!) if (c.key.endsWith("_fa") && !(c.key in o)) o[c.key] = jd(String(r[c.key.slice(0, -3)] ?? "") || null);
        return o;
      });
      data_ref = await rt.putData(withFa, { title: def.title_fa });
      table = { title: def.title_fa, columns: def.columns, total_rows: rows.length };
    }
    const refs: AiRef[] = [reportRef(input.report, def.title_fa, def.path)];
    const periodOut = per ? { from: per.from, to: per.to, from_fa: per.from_fa, to_fa: per.to_fa, label_fa: per.label_fa } : { as_of: to, as_of_fa: jd(to) };
    return {
      data: { report: input.report, title_fa: def.title_fa, period: periodOut, currency_unit: m.unit, weight_unit: "گرم", result: compact(reportForModel(out, def, params, rt), input.limit), data_ref: data_ref ?? null },
      refs,
      data_ref,
      table,
      summary_fa: `${def.title_fa} — ${per ? per.label_fa : `تا ${jd(to)}`}`,
    };
  },
});
