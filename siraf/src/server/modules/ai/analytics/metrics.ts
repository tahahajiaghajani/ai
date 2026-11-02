// The metrics catalogue behind `analyze_metric` (and the insights, brief and forecasts): every
// metric is defined once in TypeScript and compiled to parameterised SQL. The organisation,
// posted/live status, deleted rows and closing vouchers are filtered by this code — never by the
// model — and each metric reads only what its report counterpart reads, so its totals equal the
// report services':
//   sales_amount   = goods sales report «فروش خالص» (after discounts and deductions, without VAT)
//                    + gold sale and bullion-sale documents (lines out, without VAT)
//   gross_profit   = the same minus cost of goods (stock moves) / the gold lines' cost
//   purchases      = goods purchase report (landed cost) + gold purchase documents (without VAT)
//   income/expenses= income statement accounts (closing vouchers excluded)
//   *_balance, receivables, payables = ledger balances of the account roles
//   stock_value    = goods stock report value; gold/coin/fx metrics = their module reports.
import type { Ctx } from "../../../context";
import type { Area, Level } from "@shared/permissions";
import type { ModuleKey } from "@shared/constants";
import { D } from "@shared/money";
import { bucketKey, bucketLabel, bucketsBetween, type ResolvedPeriod, type TimeGrain } from "./period";

type Dec = ReturnType<typeof D>;

export const DIMENSIONS = ["none", "day", "week", "month", "party", "item", "category", "user", "payment_method", "product_type", "account", "currency"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_FA: Record<Dimension, string> = {
  none: "کل",
  day: "روز",
  week: "هفته",
  month: "ماه",
  party: "شخص",
  item: "کالا / قلم",
  category: "گروه",
  user: "کاربر ثبت‌کننده",
  payment_method: "روش تسویه",
  product_type: "نوع محصول",
  account: "حساب",
  currency: "ارز",
};

export const PRODUCT_TYPE_FA: Record<string, string> = {
  goods: "کالا",
  service: "خدمات",
  jewelry: "مصنوعات طلا",
  coin: "سکه",
  bar: "شمش",
  melted: "آب‌شده / طلای وزنی",
};

const METHOD_FA: Record<string, string> = {
  cash: "نقدی",
  credit: "نسیه",
  mixed: "نقد و نسیه",
  rial: "ریالی",
  weight: "وزنی (طلا به طلا)",
  bank: "بانکی",
  wallet: "کیف‌پول",
  party: "حساب مشتری",
};

export type MetricUnit = "money" | "count" | "grams750";

interface Source {
  module?: ModuleKey;
  /** every one is needed to include this source */
  needs: [Area, Level][];
  /** SELECT producing the fact columns; $1 org, $2 from, $3 to */
  sql: string;
  dims: Dimension[];
  label_fa: string;
}

interface FlowMetric {
  kind: "flow";
  key: string;
  title_fa: string;
  about: string;
  unit: MetricUnit;
  sources: Source[];
  /** final value of a group from its sums (a = amount, c = cost, n = documents) */
  value(a: Dec, c: Dec, n: number, dp: number): Dec;
  /** extra permission over the sources (profit needs reports:view) */
  needs?: [Area, Level][];
}

interface BalanceMetric {
  kind: "balance";
  key: string;
  title_fa: string;
  about: string;
  unit: MetricUnit;
  needs: [Area, Level][];
  module?: ModuleKey;
  /** account roles (system_key) whose balance is measured */
  keys?: string[];
  /** +1 debit balance is positive (assets), −1 credit balance is positive (liabilities) */
  sign?: 1 | -1;
  /** stock value instead of an account balance */
  stock?: boolean;
  dims: Dimension[];
}

export type MetricDef = FlowMetric | BalanceMetric;

// ---------------------------------------------------------------- fact sources
// Fact columns: d, doc_id, party_id, user_id, method, item_key, item_label, cat_key, cat_label,
// product_type, account_key, account_label, currency_key, amount, cost.

const RETURN_SIGN = `(case when inv.kind in ('sale_return','purchase_return') then -1 else 1 end)`;
const INV_NET = `(inv.subtotal - inv.line_discount - inv.discount)`;

const GOODS_SALES: Source = {
  module: "goods",
  needs: [["sales", "view"], ["reports", "view"]],
  label_fa: "فاکتورهای فروش کالا",
  dims: ["day", "week", "month", "party", "item", "category", "user", "payment_method", "product_type"],
  sql: `select inv.date as d, inv.id::text as doc_id, inv.party_id::text as party_id, inv.created_by::text as user_id,
          coalesce(inv.settlement, 'credit') as method,
          coalesce(l.item_id::text, '-') as item_key, coalesce(it.name, l.description, '—') as item_label,
          'g:' || coalesce(it.category_id::text, '-') as cat_key, coalesce(c.name, 'بدون گروه') as cat_label,
          case when it.kind = 'service' then 'service' else 'goods' end as product_type,
          null::text as account_key, null::text as account_label, null::text as currency_key,
          ${RETURN_SIGN} * ((l.total - l.vat) - case when ${INV_NET} = 0 then 0 else inv.deductions * (l.total - l.vat) / ${INV_NET} end) as amount,
          -coalesce(mv.v, 0) as cost
        from tz_invoice_lines l
        join tz_invoices inv on inv.id = l.invoice_id
        left join tz_items it on it.id = l.item_id
        left join tz_item_categories c on c.id = it.category_id
        left join (select source_line_id, sum(value) as v from tz_stock_moves
                   where org_id = $1 and source_type = 'invoice' and date >= $2 and date <= $3 group by source_line_id) mv on mv.source_line_id = l.id
        where inv.org_id = $1 and inv.deleted_at is null and inv.status = 'posted' and inv.kind in ('sale', 'sale_return')
          and inv.date >= $2 and inv.date <= $3`,
};

const GOLD_LINE_TYPE = `case l.kind when 'piece' then 'jewelry' when 'coin' then 'coin' when 'bar' then 'bar' else 'melted' end`;
const GOLD_LINE_CAT = `coalesce(gc.name, case l.kind when 'coin' then 'سکه' when 'bar' then 'شمش' when 'bulk' then 'طلای وزنی' else 'بدون دسته' end)`;

const goldDocs = (kinds: string, direction: "out" | "in", label: string): Source => ({
  module: "gold",
  needs: [["gold", "view"]],
  label_fa: label,
  dims: ["day", "week", "month", "party", "item", "category", "user", "payment_method", "product_type"],
  sql: `select d.date as d, d.id::text as doc_id, d.party_id::text as party_id, d.created_by::text as user_id,
          coalesce(d.settle->>'mode', 'rial') as method,
          coalesce(l.item_id::text, l.category_id::text, l.kind) as item_key, coalesce(ci.name, gc.name, l.title, '—') as item_label,
          'au:' || coalesce(l.category_id::text, l.kind) as cat_key, ${GOLD_LINE_CAT} as cat_label,
          ${GOLD_LINE_TYPE} as product_type,
          null::text as account_key, null::text as account_label, null::text as currency_key,
          l.total - l.tax as amount, coalesce(l.cost, 0) as cost
        from tz_gold_docs d
        join tz_gold_lines l on l.doc_id = d.id
        left join tz_items ci on ci.id = l.item_id
        left join tz_gold_categories gc on gc.id = l.category_id
        where d.org_id = $1 and d.deleted_at is null and d.status = 'posted' and d.kind in (${kinds}) and l.direction = '${direction}'
          and l.kind <> 'old' and d.date >= $2 and d.date <= $3`,
});

const GOLD_SALES = goldDocs(`'sale', 'bullion_sale'`, "out", "اسناد فروش طلا");
const GOLD_PURCHASES = goldDocs(`'purchase'`, "in", "اسناد خرید طلا");

const GOODS_PURCHASES: Source = {
  module: "goods",
  needs: [["purchases", "view"], ["reports", "view"]],
  label_fa: "فاکتورهای خرید کالا",
  dims: ["day", "week", "month", "party", "item", "category", "user", "payment_method", "product_type"],
  sql: `select inv.date as d, inv.id::text as doc_id, inv.party_id::text as party_id, inv.created_by::text as user_id,
          coalesce(inv.settlement, 'credit') as method,
          coalesce(l.item_id::text, '-') as item_key, coalesce(it.name, l.description, '—') as item_label,
          'g:' || coalesce(it.category_id::text, '-') as cat_key, coalesce(c.name, 'بدون گروه') as cat_label,
          case when it.kind = 'service' then 'service' else 'goods' end as product_type,
          null::text as account_key, null::text as account_label, null::text as currency_key,
          ${RETURN_SIGN} * coalesce(l.cost, l.total - l.vat) as amount, 0 as cost
        from tz_invoice_lines l
        join tz_invoices inv on inv.id = l.invoice_id
        left join tz_items it on it.id = l.item_id
        left join tz_item_categories c on c.id = it.category_id
        where inv.org_id = $1 and inv.deleted_at is null and inv.status = 'posted' and inv.kind in ('purchase', 'purchase_return')
          and inv.date >= $2 and inv.date <= $3`,
};

const plAccounts = (kind: "income" | "expense"): Source => ({
  needs: [["reports", "view"]],
  label_fa: kind === "income" ? "حساب‌های درآمد" : "حساب‌های هزینه",
  dims: ["day", "week", "month", "account"],
  sql: `select v.date as d, v.id::text as doc_id, null::text as party_id, v.created_by::text as user_id, null::text as method,
          null::text as item_key, null::text as item_label, null::text as cat_key, null::text as cat_label, null::text as product_type,
          a.id::text as account_key, a.code || ' ' || a.name as account_label, null::text as currency_key,
          ${kind === "income" ? "l.credit - l.debit" : "l.debit - l.credit"} as amount, 0 as cost
        from tz_voucher_lines l
        join tz_vouchers v on v.id = l.voucher_id
        join tz_accounts a on a.id = l.account_id
        where l.org_id = $1 and v.deleted_at is null and v.status in ('posted', 'final') and v.kind not in ('closing', 'temp_closing')
          and a.kind = '${kind}' and v.date >= $2 and v.date <= $3`,
});

const chequesDueSource = (direction: "received" | "issued"): Source => ({
  needs: [["treasury", "view"]],
  label_fa: direction === "received" ? "چک‌های دریافتی باز" : "چک‌های پرداختی باز",
  dims: ["day", "week", "month", "party"],
  sql: `select c.due_date as d, c.id::text as doc_id, c.party_id::text as party_id, null::text as user_id, null::text as method,
          null::text as item_key, null::text as item_label, null::text as cat_key, null::text as cat_label, null::text as product_type,
          null::text as account_key, null::text as account_label, null::text as currency_key,
          c.amount as amount, 0 as cost
        from tz_cheques c
        where c.org_id = $1 and c.deleted_at is null and c.direction = '${direction}'
          and c.status in (${direction === "received" ? "'in_hand', 'deposited'" : "'issued'"})
          and c.due_date >= $2 and c.due_date <= $3`,
});

const FX_DEALS = (value: "base_value" | "profit"): Source => ({
  module: "fx",
  needs: [["fx", "view"], ["reports", "view"]],
  label_fa: "معاملات ارز",
  dims: ["day", "week", "month", "party", "currency", "user", "payment_method"],
  sql: `select f.date as d, f.id::text as doc_id, f.party_id::text as party_id, f.created_by::text as user_id, f.in_method as method,
          null::text as item_key, null::text as item_label, null::text as cat_key, null::text as cat_label, null::text as product_type,
          null::text as account_key, null::text as account_label,
          (case when f.kind = 'sell' ${value === "profit" ? "or f.kind = 'exchange'" : ""} then f.out_currency_id else f.in_currency_id end)::text as currency_key,
          f.${value} as amount, 0 as cost
        from tz_fx_deals f
        where f.org_id = $1 and f.deleted_at is null and f.status = 'posted' and f.date >= $2 and f.date <= $3`,
});

const goldWeightSold = (pick: "weight750" | "coins" | "wage"): Source => ({
  module: "gold",
  needs: [["gold", "view"]],
  label_fa: "اسناد فروش طلا",
  dims: ["day", "week", "month", "party", "item", "category", "user", "product_type"],
  sql: `select d.date as d, d.id::text as doc_id, d.party_id::text as party_id, d.created_by::text as user_id, null::text as method,
          coalesce(l.item_id::text, l.category_id::text, l.kind) as item_key, coalesce(ci.name, gc.name, l.title, '—') as item_label,
          'au:' || coalesce(l.category_id::text, l.kind) as cat_key, ${GOLD_LINE_CAT} as cat_label,
          ${GOLD_LINE_TYPE} as product_type,
          null::text as account_key, null::text as account_label, null::text as currency_key,
          ${pick === "weight750" ? "coalesce(l.weight750, 0)" : pick === "coins" ? "coalesce(l.qty, 0)" : "coalesce(l.wage, 0) + coalesce(l.profit, 0)"} as amount, 0 as cost
        from tz_gold_docs d
        join tz_gold_lines l on l.doc_id = d.id
        left join tz_items ci on ci.id = l.item_id
        left join tz_gold_categories gc on gc.id = l.category_id
        where d.org_id = $1 and d.deleted_at is null and d.status = 'posted' and d.kind in ('sale', 'bullion_sale') and l.direction = 'out'
          and ${pick === "weight750" ? "l.kind in ('piece', 'bulk', 'bar')" : pick === "coins" ? "l.kind = 'coin'" : "l.kind <> 'old'"}
          and d.date >= $2 and d.date <= $3`,
});

const amountOnly = (a: Dec, _c: Dec, _n: number, dp: number) => a.toDecimalPlaces(dp);

// ---------------------------------------------------------------- catalogue

export const METRICS: MetricDef[] = [
  {
    kind: "flow", key: "sales_amount", title_fa: "فروش خالص (بدون مالیات)", unit: "money",
    about: "Net sales without VAT of posted documents: goods sales invoices minus sales returns after line/invoice discounts and deductions, plus gold sale and bullion-sale documents (lines sold, without VAT).",
    sources: [GOODS_SALES, GOLD_SALES], value: amountOnly,
  },
  {
    kind: "flow", key: "sales_count", title_fa: "تعداد اسناد فروش", unit: "count",
    about: "Number of posted sales documents (goods sales invoices and returns, gold sale and bullion-sale documents).",
    sources: [GOODS_SALES, GOLD_SALES], value: (_a, _c, n) => D(n),
  },
  {
    kind: "flow", key: "gross_profit", title_fa: "سود ناخالص فروش", unit: "money",
    about: "Gross profit of posted sales: net sales without VAT minus cost of goods sold (goods: stock moves at moving-average cost; gold: the lines' cost).",
    sources: [GOODS_SALES, GOLD_SALES], needs: [["reports", "view"]], value: (a, c, _n, dp) => a.toDecimalPlaces(dp).minus(c),
  },
  {
    kind: "flow", key: "purchases", title_fa: "خرید (بدون مالیات)", unit: "money",
    about: "Posted purchases without VAT: goods purchase invoices at landed cost minus purchase returns, plus gold purchase documents.",
    sources: [GOODS_PURCHASES, GOLD_PURCHASES], value: amountOnly,
  },
  {
    kind: "flow", key: "income", title_fa: "درآمدها", unit: "money",
    about: "Credit minus debit of income accounts in posted vouchers (closing vouchers excluded) — the income statement's total income.",
    sources: [plAccounts("income")], value: amountOnly,
  },
  {
    kind: "flow", key: "expenses", title_fa: "هزینه‌ها", unit: "money",
    about: "Debit minus credit of expense accounts (including cost of goods sold) in posted vouchers (closing vouchers excluded) — the income statement's total expense.",
    sources: [plAccounts("expense")], value: amountOnly,
  },
  {
    kind: "flow", key: "cheques_receivable_due", title_fa: "چک‌های دریافتی سررسید", unit: "money",
    about: "Open received cheques (in hand or in collection) by due date.",
    sources: [chequesDueSource("received")], value: amountOnly,
  },
  {
    kind: "flow", key: "cheques_payable_due", title_fa: "چک‌های پرداختی سررسید", unit: "money",
    about: "Open issued cheques (not yet cleared) by due date.",
    sources: [chequesDueSource("issued")], value: amountOnly,
  },
  {
    kind: "flow", key: "gold_weight_sold", title_fa: "وزن طلای فروخته‌شده (معادل ۷۵۰)", unit: "grams750",
    about: "Grams of gold sold in posted gold sale and bullion-sale documents (jewellery pieces, weighed gold and bars), as 750-equivalent weight.",
    sources: [goldWeightSold("weight750")], value: (a) => a.toDecimalPlaces(3),
  },
  {
    kind: "flow", key: "coins_sold", title_fa: "تعداد سکهٔ فروخته‌شده", unit: "count",
    about: "Number of coins sold in posted gold sale documents.",
    sources: [goldWeightSold("coins")], value: (a) => a,
  },
  {
    kind: "flow", key: "gold_wage_profit", title_fa: "اجرت و سود فروش طلا", unit: "money",
    about: "Wage (اجرت) plus seller profit (سود) of the lines sold in posted gold sale documents, without VAT.",
    sources: [goldWeightSold("wage")], value: amountOnly,
  },
  {
    kind: "flow", key: "fx_volume", title_fa: "حجم معاملات ارز (ارزش پایه)", unit: "money",
    about: "Base-currency value of posted currency deals (buy, sell and exchange).",
    sources: [FX_DEALS("base_value")], value: amountOnly,
  },
  {
    kind: "flow", key: "fx_deal_count", title_fa: "تعداد معاملات ارز", unit: "count",
    about: "Number of posted currency deals.",
    sources: [FX_DEALS("base_value")], value: (_a, _c, n) => D(n),
  },
  {
    kind: "flow", key: "fx_profit", title_fa: "سود تحقق‌یافتهٔ معاملات ارز", unit: "money",
    about: "Realized profit of posted currency deals (sale price minus average cost), fees not included.",
    sources: [FX_DEALS("profit")], value: amountOnly,
  },
  {
    kind: "balance", key: "cash_balance", title_fa: "موجودی صندوق‌ها", unit: "money", keys: ["cash"], sign: 1,
    about: "Ledger balance of the cash-box account (all fiscal years, posted) at the end of the period or of each bucket.",
    needs: [["treasury", "view"]], dims: ["none", "day", "week", "month", "account"],
  },
  {
    kind: "balance", key: "bank_balance", title_fa: "موجودی حساب‌های بانکی", unit: "money", keys: ["bank"], sign: 1,
    about: "Ledger balance of the bank-accounts account (all fiscal years, posted) at the end of the period or of each bucket.",
    needs: [["treasury", "view"]], dims: ["none", "day", "week", "month", "account"],
  },
  {
    kind: "balance", key: "receivables", title_fa: "مطالبات از اشخاص (حساب‌های دریافتنی)", unit: "money", keys: ["ar"], sign: 1,
    about: "Balance of accounts receivable (debit minus credit; negative = customers paid in advance) at the end of the period, optionally per party.",
    needs: [["reports", "view"]], dims: ["none", "day", "week", "month", "party"],
  },
  {
    kind: "balance", key: "payables", title_fa: "بدهی به اشخاص (حساب‌های پرداختنی)", unit: "money", keys: ["ap"], sign: -1,
    about: "Balance of accounts payable (credit minus debit) at the end of the period, optionally per party.",
    needs: [["reports", "view"]], dims: ["none", "day", "week", "month", "party"],
  },
  {
    kind: "balance", key: "stock_value", title_fa: "ارزش موجودی کالا", unit: "money", stock: true, module: "goods",
    about: "Value of goods in stock at moving-average cost at the end of the period, optionally per item or item group.",
    needs: [["inventory", "view"]], dims: ["none", "day", "week", "month", "item", "category"],
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key) as [string, ...string[]];

export function metricDef(key: string): MetricDef | undefined {
  return METRICS.find((m) => m.key === key);
}

export interface MetricFilters {
  party_id?: string | null;
  item_id?: string | null;
  category_id?: string | null;
  currency_id?: string | null;
  account_id?: string | null;
  product_type?: string | null;
}

export interface MetricRow {
  key: string;
  label: string;
  value: string;
}

export interface MetricResult {
  metric: string;
  title_fa: string;
  unit: MetricUnit;
  dimension: Dimension;
  rows: MetricRow[];
  total: string;
  documents: number | null;
  sources: string[];
  /** Persian notes about parts left out (module off, no permission) */
  notes: string[];
}

const canAll = (ctx: Ctx, needs: [Area, Level][]) => needs.every(([a, l]) => ctx.can(a, l));

/** Is the metric usable by this member in this business (some source allowed)? */
export function metricAllowed(ctx: Ctx, m: MetricDef): boolean {
  if (m.kind === "balance") return (!m.module || ctx.hasModule(m.module)) && canAll(ctx, m.needs);
  if (m.needs && !canAll(ctx, m.needs)) return false;
  return m.sources.some((s) => (!s.module || ctx.hasModule(s.module)) && canAll(ctx, s.needs));
}

export function metricDims(m: MetricDef): Dimension[] {
  if (m.kind === "balance") return m.dims;
  const set = new Set<Dimension>(["none"]);
  for (const s of m.sources) for (const d of s.dims) set.add(d);
  return [...set];
}

const DIM_COL: Partial<Record<Dimension, { key: string; label?: string }>> = {
  party: { key: "party_id" },
  item: { key: "item_key", label: "item_label" },
  category: { key: "cat_key", label: "cat_label" },
  user: { key: "user_id" },
  payment_method: { key: "method" },
  product_type: { key: "product_type" },
  account: { key: "account_key", label: "account_label" },
  currency: { key: "currency_key" },
};

function filterSql(f: MetricFilters, params: unknown[]): string {
  const cond: string[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (f.party_id) add("f.party_id = ?", f.party_id);
  if (f.item_id) add("f.item_key = ?", f.item_id);
  if (f.category_id) add("(f.cat_key = 'g:' || ? or f.cat_key = 'au:' || ?)", f.category_id);
  if (f.currency_id) add("f.currency_key = ?", f.currency_id);
  if (f.account_id) add("f.account_key = ?", f.account_id);
  if (f.product_type) add("f.product_type = ?", f.product_type);
  return cond.length ? `where ${cond.join(" and ")}` : "";
}

async function labelsFor(ctx: Ctx, dim: Dimension, keys: string[]): Promise<Map<string, string>> {
  const ids = keys.filter((k) => /^[0-9a-f-]{36}$/i.test(k));
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const arr = `{${ids.join(",")}}`;
  const rows =
    dim === "party"
      ? await ctx.db.query<{ id: string; label: string }>(`select id::text, name as label from tz_parties where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, arr])
      : dim === "user"
        ? await ctx.db.query<{ id: string; label: string }>(`select id::text, full_name as label from tz_users where id = any($1::uuid[])`, [arr])
        : dim === "currency"
          ? await ctx.db.query<{ id: string; label: string }>(`select id::text, code || ' — ' || name as label from tz_currencies where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, arr])
          : [];
  for (const r of rows) out.set(r.id, r.label);
  return out;
}

function staticLabel(dim: Dimension, key: string): string | null {
  if (dim === "product_type") return PRODUCT_TYPE_FA[key] ?? key;
  if (dim === "payment_method") return METHOD_FA[key] ?? key;
  if (key === "-" || key === "") return "—";
  return null;
}

function timeGrain(dim: Dimension): TimeGrain | null {
  return dim === "day" || dim === "week" || dim === "month" ? dim : null;
}

/**
 * Run a metric for a resolved period. Sources the member may not see, or whose module is off, are
 * left out and named in `notes`. Rows are sorted by time (time dimensions) or by value.
 */
export async function runMetric(ctx: Ctx, m: MetricDef, period: ResolvedPeriod, dim: Dimension, filters: MetricFilters = {}): Promise<MetricResult> {
  const dp = Number(ctx.org.money_decimals ?? 0) || 0;
  if (m.kind === "balance") return runBalance(ctx, m, period, dim, filters, dp);
  const notes: string[] = [];
  const used = m.sources.filter((s) => {
    if (s.module && !ctx.hasModule(s.module)) return false;
    if (!canAll(ctx, s.needs)) {
      notes.push(`«${s.label_fa}» به دلیل نداشتن دسترسی در این عدد نیامده است`);
      return false;
    }
    if (dim !== "none" && !s.dims.includes(dim)) {
      notes.push(`«${s.label_fa}» تفکیک «${DIMENSION_FA[dim]}» ندارد و کنار گذاشته شد`);
      return false;
    }
    return true;
  });
  if (!used.length) return { metric: m.key, title_fa: m.title_fa, unit: m.unit, dimension: dim, rows: [], total: "0", documents: 0, sources: [], notes };
  const params: unknown[] = [ctx.org.id, period.from, period.to];
  const where = filterSql(filters, params);
  const grain = timeGrain(dim);
  const col = DIM_COL[dim];
  const keyExpr = grain ? "f.d::text" : col ? `coalesce(f.${col.key}, '-')` : `'all'`;
  const labelExpr = col?.label ? `max(f.${col.label})` : "null";
  const rows = await ctx.db.query<{ k: string; label: string | null; a: string; c: string; n: number }>(
    `with f as (${used.map((s) => s.sql).join("\nunion all\n")})
     select ${keyExpr} as k, ${labelExpr} as label, coalesce(sum(f.amount), 0) as a, coalesce(sum(f.cost), 0) as c, count(distinct f.doc_id)::int as n
     from f ${where} group by 1`,
    params,
  );
  const total = await ctx.db.one<{ a: string; c: string; n: number }>(
    `with f as (${used.map((s) => s.sql).join("\nunion all\n")})
     select coalesce(sum(f.amount), 0) as a, coalesce(sum(f.cost), 0) as c, count(distinct f.doc_id)::int as n from f ${where}`,
    params,
  );
  let out: MetricRow[];
  if (grain) {
    const acc = new Map<string, { a: Dec; c: Dec; n: number }>();
    for (const r of rows) {
      const b = bucketKey(r.k, grain);
      const e = acc.get(b) ?? { a: D(0), c: D(0), n: 0 };
      e.a = e.a.plus(D(r.a));
      e.c = e.c.plus(D(r.c));
      e.n += r.n;
      acc.set(b, e);
    }
    out = bucketsBetween(period.from, period.to, grain).map((b) => {
      const e = acc.get(b);
      return { key: b, label: bucketLabel(b, grain), value: e ? m.value(e.a, e.c, e.n, dp).toString() : "0" };
    });
  } else {
    const labels = await labelsFor(ctx, dim, rows.map((r) => r.k));
    out = rows
      .map((r) => ({ key: r.k, label: r.label ?? labels.get(r.k) ?? staticLabel(dim, r.k) ?? r.k, value: m.value(D(r.a), D(r.c), r.n, dp).toString() }))
      .sort((x, y) => D(y.value).cmp(D(x.value)));
  }
  return {
    metric: m.key,
    title_fa: m.title_fa,
    unit: m.unit,
    dimension: dim,
    rows: out,
    total: m.value(D(total?.a ?? 0), D(total?.c ?? 0), total?.n ?? 0, dp).toString(),
    documents: total?.n ?? 0,
    sources: used.map((s) => s.label_fa),
    notes,
  };
}

async function runBalance(ctx: Ctx, m: BalanceMetric, period: ResolvedPeriod, dim: Dimension, filters: MetricFilters, dp: number): Promise<MetricResult> {
  const sign = D(m.sign ?? 1);
  const grain = timeGrain(dim);
  const base = { metric: m.key, title_fa: m.title_fa, unit: m.unit, dimension: dim, documents: null, notes: [] as string[] };
  if (m.stock) {
    const params: unknown[] = [ctx.org.id, period.to];
    const cond = ["m.org_id = $1", "i.org_id = $1", "i.kind = 'goods'", "i.deleted_at is null"];
    if (filters.item_id) {
      params.push(filters.item_id);
      cond.push(`i.id::text = $${params.length}`);
    }
    if (filters.category_id) {
      params.push(filters.category_id);
      cond.push(`i.category_id::text = $${params.length}`);
    }
    const from = `from tz_stock_moves m join tz_items i on i.id = m.item_id left join tz_item_categories c on c.id = i.category_id where ${cond.join(" and ")}`;
    if (grain) {
      params.push(period.from);
      const fromIdx = params.length;
      const before = await ctx.db.one<{ v: string }>(`select coalesce(sum(m.value), 0) as v ${from} and m.date < $${fromIdx}`, params);
      const daily = await ctx.db.query<{ d: string; v: string }>(`select m.date as d, sum(m.value) as v ${from} and m.date >= $${fromIdx} and m.date <= $2 group by m.date`, params);
      return { ...base, sources: ["گردش انبار"], ...cumulative(D(before?.v ?? 0), daily, period, grain, D(1), dp) };
    }
    const groupKey = dim === "item" ? "i.id::text" : dim === "category" ? "coalesce(i.category_id::text, '-')" : "'all'";
    const labelExpr = dim === "item" ? "max(i.code || ' ' || i.name)" : dim === "category" ? "coalesce(max(c.name), 'بدون گروه')" : "null";
    const rows = await ctx.db.query<{ k: string; label: string | null; v: string }>(`select ${groupKey} as k, ${labelExpr} as label, sum(m.value) as v ${from} and m.date <= $2 group by 1`, params);
    const total = rows.reduce((a, r) => a.plus(D(r.v)), D(0));
    return {
      ...base,
      rows: rows.filter((r) => !D(r.v).isZero()).map((r) => ({ key: r.k, label: r.label ?? "—", value: D(r.v).toDecimalPlaces(dp).toString() })).sort((a, b) => D(b.value).cmp(D(a.value))),
      total: total.toDecimalPlaces(dp).toString(),
      sources: ["گردش انبار"],
    };
  }
  const params: unknown[] = [ctx.org.id, period.to, `{${(m.keys ?? []).join(",")}}`];
  const cond = ["l.org_id = $1", "v.deleted_at is null", "v.status in ('posted', 'final')", "a.system_key = any($3::text[])"];
  if (filters.party_id) {
    params.push(filters.party_id);
    cond.push(`l.detail_id = (select detail_id from tz_parties where id::text = $${params.length} and org_id = $1)`);
  }
  if (filters.account_id) {
    params.push(filters.account_id);
    cond.push(`l.detail_id::text = $${params.length}`);
  }
  const from = `from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id where ${cond.join(" and ")}`;
  if (grain) {
    params.push(period.from);
    const before = await ctx.db.one<{ v: string }>(`select coalesce(sum(l.debit - l.credit), 0) as v ${from} and v.date < $${params.length}`, params);
    const daily = await ctx.db.query<{ d: string; v: string }>(`select v.date as d, sum(l.debit - l.credit) as v ${from} and v.date >= $${params.length} and v.date <= $2 group by v.date`, params);
    return { ...base, sources: ["دفتر کل"], ...cumulative(D(before?.v ?? 0), daily, period, grain, sign, dp) };
  }
  const byDetail = dim === "party" || dim === "account";
  const rows = await ctx.db.query<{ k: string; label: string | null; v: string }>(
    `select ${byDetail ? "coalesce(l.detail_id::text, '-')" : "'all'"} as k,
            ${byDetail ? "(select coalesce(p.name, d.name) from tz_details d left join tz_parties p on p.id = d.ref_id and d.kind = 'person' where d.id = l.detail_id)" : "null"} as label,
            sum(l.debit - l.credit) as v
     ${from} and v.date <= $2 group by ${byDetail ? "l.detail_id" : "1"}`,
    params,
  );
  const total = rows.reduce((a, r) => a.plus(D(r.v)), D(0)).times(sign);
  return {
    ...base,
    rows: rows
      .filter((r) => !D(r.v).isZero())
      .map((r) => ({ key: r.k, label: r.label ?? (r.k === "all" ? m.title_fa : "بدون تفصیلی"), value: D(r.v).times(sign).toDecimalPlaces(dp).toString() }))
      .sort((a, b) => D(b.value).cmp(D(a.value))),
    total: total.toDecimalPlaces(dp).toString(),
    sources: ["دفتر کل"],
  };
}

/** Balance at the end of every bucket from the balance before the period and the daily changes. */
function cumulative(opening: Dec, daily: { d: string; v: string }[], period: ResolvedPeriod, grain: TimeGrain, sign: Dec, dp: number) {
  const change = new Map<string, Dec>();
  for (const r of daily) {
    const b = bucketKey(r.d, grain);
    change.set(b, (change.get(b) ?? D(0)).plus(D(r.v)));
  }
  let bal = opening;
  const rows: MetricRow[] = bucketsBetween(period.from, period.to, grain).map((b) => {
    bal = bal.plus(change.get(b) ?? D(0));
    return { key: b, label: bucketLabel(b, grain), value: bal.times(sign).toDecimalPlaces(dp).toString() };
  });
  return { rows, total: bal.times(sign).toDecimalPlaces(dp).toString() };
}
