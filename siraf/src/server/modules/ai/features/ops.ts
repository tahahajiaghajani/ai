// Operational analyses shared by the assistant's tools, the insights and the plans: who to collect
// from first, the cheque calendar, reorder / dead stock / repricing advice and rule-based
// anomalies. Deterministic SQL + decimal arithmetic; the model only explains the results.
import type { Ctx } from "../../../context";
import type { AiRef } from "@shared/ai/types";
import { D } from "@shared/money";
import { addDays, diffDays, weekday } from "@shared/jalali";
import { ALLOCATED_SQL } from "../../goods/common";
import { fxSettings } from "../../fx/common";
import { goldSettings } from "../../gold/settings";
import { ref, jd } from "../tools/common";
import { median } from "../analytics/forecast";

type Dec = ReturnType<typeof D>;
const POSTED = `v.deleted_at is null and v.status in ('posted', 'final')`;

// ---------------------------------------------------------------- receivables

export interface DebtorRow {
  party_id: string;
  code: string;
  name: string;
  balance: string;
  overdue: string;
  oldest_due: string | null;
  days_overdue: number;
  open_invoices: number;
  credit_limit: string | null;
  over_limit: boolean;
  bounced_cheques: number;
  history_invoices: number;
  avg_delay_days: number | null;
  late_share: number | null;
  /** 0–100 or null below the minimum data */
  score: number | null;
  band: "high" | "medium" | "low" | null;
  confidence: "high" | "medium" | "low";
  reasons_fa: string[];
  ref: AiRef;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Debtors ranked for collection: receivable balance (ledger), overdue open invoices, bounced
 * cheques, past payment delays (allocations against due dates; an invoice without a due date is due
 * 30 days after its date) and the credit limit. The score is
 * a transparent rule (weights in the code) and is withheld below two settled invoices of history.
 */
export async function receivables(ctx: Ctx, today: string, opts: { limit?: number } = {}): Promise<{ rows: DebtorRow[]; total_balance: string; total_overdue: string; debtors: number }> {
  const org = ctx.org.id;
  const bal = await ctx.db.query<{ party_id: string; code: string; name: string; credit_limit: string | null; balance: string }>(
    `select p.id as party_id, p.code, p.name, p.credit_limit, sum(l.debit - l.credit) as balance
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     join tz_parties p on p.detail_id = l.detail_id and p.org_id = l.org_id
     where l.org_id = $1 and ${POSTED} and a.system_key in ('ar', 'customer_advances') and v.date <= $2 and p.deleted_at is null
     group by p.id, p.code, p.name, p.credit_limit having sum(l.debit - l.credit) > 0`,
    [org, today],
  );
  if (!bal.length) return { rows: [], total_balance: "0", total_overdue: "0", debtors: 0 };
  const ids = `{${bal.map((b) => b.party_id).join(",")}}`;
  const open = ctx.hasModule("goods")
    ? await ctx.db.query<{ party_id: string; id: string; due: string; remaining: string }>(
        `select i.party_id, i.id, coalesce(i.due_date, i.date + 30) as due, i.total - ${ALLOCATED_SQL} as remaining
         from tz_invoices i where i.org_id = $1 and i.deleted_at is null and i.status = 'posted' and i.kind = 'sale' and i.party_id = any($2::uuid[])`,
        [org, ids],
      )
    : [];
  const history = ctx.hasModule("goods")
    ? await ctx.db.query<{ party_id: string; invoice_id: string; due: string; paid_on: string }>(
        `select i.party_id, i.id as invoice_id, coalesce(i.due_date, i.date + 30) as due, max(td.date) as paid_on
         from tz_invoices i join tz_treasury_allocs a on a.invoice_id = i.id join tz_treasury_docs td on td.id = a.doc_id and td.deleted_at is null
         where i.org_id = $1 and i.deleted_at is null and i.status = 'posted' and i.kind = 'sale' and i.party_id = any($2::uuid[]) and i.date >= $3
         group by i.party_id, i.id, coalesce(i.due_date, i.date + 30)`,
        [org, ids, addDays(today, -730)],
      )
    : [];
  const bounced = await ctx.db.query<{ party_id: string; n: number }>(
    `select party_id, count(*)::int as n from tz_cheques
     where org_id = $1 and deleted_at is null and direction = 'received' and party_id = any($2::uuid[])
       and (status = 'bounced' or history::text like '%"bounce"%') group by party_id`,
    [org, ids],
  );
  const bouncedBy = new Map(bounced.map((b) => [b.party_id, b.n]));
  const rows: DebtorRow[] = bal.map((b) => {
    const mine = open.filter((o) => o.party_id === b.party_id && D(o.remaining).gt(0));
    const overdueInv = mine.filter((o) => o.due < today);
    const overdueSum = overdueInv.reduce((a, o) => a.plus(D(o.remaining)), D(0));
    const overdue = Dmin(overdueSum, D(b.balance));
    const oldest = overdueInv.map((o) => o.due).sort()[0] ?? null;
    const days = oldest ? diffDays(today, oldest) : 0;
    const hist = history.filter((h) => h.party_id === b.party_id);
    const delays = hist.map((h) => Math.max(0, diffDays(h.paid_on, h.due)));
    const avgDelay = delays.length ? delays.reduce((a, x) => a + x, 0) / delays.length : null;
    const lateShare = delays.length ? delays.filter((x) => x > 7).length / delays.length : null;
    const bc = bouncedBy.get(b.party_id) ?? 0;
    const overLimit = !!b.credit_limit && D(b.credit_limit).gt(0) && D(b.balance).gt(D(b.credit_limit));
    const confidence: DebtorRow["confidence"] = hist.length >= 5 ? "high" : hist.length >= 2 ? "medium" : "low";
    const reasons: string[] = [];
    if (days > 0) reasons.push(`قدیمی‌ترین فاکتور معوق ${days} روز از سررسید گذشته است`);
    if (bc) reasons.push(`${bc} چک برگشتی در سابقه دارد`);
    if (avgDelay !== null && avgDelay > 7) reasons.push(`میانگین تأخیر پرداخت ${Math.round(avgDelay)} روز`);
    if (overLimit) reasons.push("مانده از سقف اعتبار بیشتر است");
    let score: number | null = null;
    if (hist.length >= 2 || bc > 0 || days > 0) {
      score = Math.round(
        100 * (0.35 * clamp01(days / 90) + 0.25 * clamp01((avgDelay ?? 0) / 60) + 0.2 * clamp01(bc / 2) + 0.1 * (lateShare ?? 0) + 0.1 * (overLimit ? 1 : 0)),
      );
      if (hist.length < 2 && !bc && days === 0) score = null;
    }
    const band = score === null ? null : score >= 60 ? "high" : score >= 30 ? "medium" : "low";
    return {
      party_id: b.party_id, code: b.code, name: b.name, balance: D(b.balance).toString(), overdue: overdue.toString(), oldest_due: oldest, days_overdue: days,
      open_invoices: mine.length, credit_limit: b.credit_limit, over_limit: overLimit, bounced_cheques: bc, history_invoices: hist.length,
      avg_delay_days: avgDelay === null ? null : Math.round(avgDelay), late_share: lateShare === null ? null : Math.round(lateShare * 100) / 100,
      score, band, confidence, reasons_fa: reasons, ref: ref("party", b.party_id, b.name),
    };
  });
  rows.sort((x, y) => D(y.overdue).cmp(D(x.overdue)) || (y.score ?? -1) - (x.score ?? -1) || D(y.balance).cmp(D(x.balance)));
  const total = rows.reduce((a, r) => a.plus(D(r.balance)), D(0));
  const totalOver = rows.reduce((a, r) => a.plus(D(r.overdue)), D(0));
  return { rows: rows.slice(0, opts.limit ?? rows.length), total_balance: total.toString(), total_overdue: totalOver.toString(), debtors: rows.length };
}

function Dmax(a: Dec, b: Dec): Dec {
  return a.gt(b) ? a : b;
}

function Dmin(a: Dec, b: Dec): Dec {
  return a.lt(b) ? a : b;
}

// ---------------------------------------------------------------- cheques calendar

export interface ChequeWeek {
  week_start: string;
  week_end: string;
  received: string;
  issued: string;
  net: string;
  received_count: number;
  issued_count: number;
  /** cash + bank at the start of the period plus the running net of cheques */
  projected_cash: string;
  shortfall: boolean;
}

export interface RiskyCheque {
  id: string;
  party: string | null;
  amount: string;
  due_date: string;
  prior_bounces: number;
  ref: AiRef;
}

/** Ledger balance of cash boxes and bank accounts (base currency) at a date. */
export async function cashAndBank(ctx: Ctx, date: string): Promise<{ cash: string; bank: string; total: string }> {
  const r = await ctx.db.query<{ k: string; v: string }>(
    `select a.system_key as k, coalesce(sum(l.debit - l.credit), 0) as v
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${POSTED} and a.system_key in ('cash', 'bank', 'petty_cash') and v.date <= $2 group by a.system_key`,
    [ctx.org.id, date],
  );
  const get = (k: string) => D(r.find((x) => x.k === k)?.v ?? 0);
  const cash = get("cash").plus(get("petty_cash"));
  const bank = get("bank");
  return { cash: cash.toString(), bank: bank.toString(), total: cash.plus(bank).toString() };
}

/** Saturday that starts the week of a date. */
export const weekStart = (iso: string) => addDays(iso, -weekday(iso));

export async function chequesCalendar(ctx: Ctx, from: string, to: string, today: string) {
  const rows = await ctx.db.query<{ id: string; direction: string; amount: string; due_date: string; party_id: string | null; party: string | null; serial_no: string | null }>(
    `select c.id, c.direction, c.amount, c.due_date, c.party_id, p.name as party, c.serial_no from tz_cheques c left join tz_parties p on p.id = c.party_id
     where c.org_id = $1 and c.deleted_at is null and c.due_date >= $2 and c.due_date <= $3
       and ((c.direction = 'received' and c.status in ('in_hand', 'deposited')) or (c.direction = 'issued' and c.status = 'issued'))
     order by c.due_date`,
    [ctx.org.id, from, to],
  );
  const overdue = await ctx.db.one<{ r: string; i: string; rn: number; inn: number }>(
    `select coalesce(sum(amount) filter (where direction = 'received'), 0) as r, coalesce(sum(amount) filter (where direction = 'issued'), 0) as i,
            count(*) filter (where direction = 'received')::int as rn, count(*) filter (where direction = 'issued')::int as inn
     from tz_cheques where org_id = $1 and deleted_at is null and due_date < $2
       and ((direction = 'received' and status in ('in_hand', 'deposited')) or (direction = 'issued' and status = 'issued'))`,
    [ctx.org.id, from],
  );
  const start = await cashAndBank(ctx, addDays(from, -1) < today ? today : addDays(from, -1));
  const weeks: ChequeWeek[] = [];
  let running = D(start.total);
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    const inWeek = rows.filter((r) => r.due_date >= w && r.due_date <= end);
    const rec = inWeek.filter((r) => r.direction === "received");
    const iss = inWeek.filter((r) => r.direction === "issued");
    const rs = rec.reduce((a, r) => a.plus(D(r.amount)), D(0));
    const is = iss.reduce((a, r) => a.plus(D(r.amount)), D(0));
    running = running.plus(rs).minus(is);
    weeks.push({
      week_start: w, week_end: end, received: rs.toString(), issued: is.toString(), net: rs.minus(is).toString(),
      received_count: rec.length, issued_count: iss.length, projected_cash: running.toString(), shortfall: running.lt(0),
    });
  }
  const partyIds = [...new Set(rows.filter((r) => r.direction === "received" && r.party_id).map((r) => r.party_id!))];
  const bounces = partyIds.length
    ? await ctx.db.query<{ party_id: string; n: number }>(
        `select party_id, count(*)::int as n from tz_cheques where org_id = $1 and deleted_at is null and direction = 'received'
           and party_id = any($2::uuid[]) and (status = 'bounced' or history::text like '%"bounce"%') group by party_id`,
        [ctx.org.id, `{${partyIds.join(",")}}`],
      )
    : [];
  const bounceBy = new Map(bounces.map((b) => [b.party_id, b.n]));
  const risky: RiskyCheque[] = rows
    .filter((r) => r.direction === "received" && r.party_id && (bounceBy.get(r.party_id) ?? 0) > 0)
    .map((r) => ({ id: r.id, party: r.party, amount: D(r.amount).toString(), due_date: r.due_date, prior_bounces: bounceBy.get(r.party_id!) ?? 0, ref: ref("cheque", r.id, `چک ${r.serial_no ?? ""}`.trim(), { direction: "received" }) }))
    .sort((a, b) => b.prior_bounces - a.prior_bounces || D(b.amount).cmp(D(a.amount)));
  const tot = (dir: string) => rows.filter((r) => r.direction === dir).reduce((a, r) => a.plus(D(r.amount)), D(0));
  return {
    from, to,
    opening_cash_bank: start,
    totals: { received: tot("received").toString(), issued: tot("issued").toString(), net: tot("received").minus(tot("issued")).toString(), received_count: rows.filter((r) => r.direction === "received").length, issued_count: rows.filter((r) => r.direction === "issued").length },
    overdue_before: { received: D(overdue?.r ?? 0).toString(), issued: D(overdue?.i ?? 0).toString(), received_count: overdue?.rn ?? 0, issued_count: overdue?.inn ?? 0 },
    weeks,
    shortfall_weeks: weeks.filter((w) => w.shortfall).map((w) => w.week_start),
    risky,
    cheques: rows,
  };
}

// ---------------------------------------------------------------- inventory

export interface StockItem {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  qty: string;
  value: string;
  avg_cost: string | null;
  sale_price: string | null;
  min_stock: string | null;
  reorder_point: string | null;
  max_stock: string | null;
  sold_90: string;
  last_sale: string | null;
  last_purchase_cost: string | null;
}

export async function stockItems(ctx: Ctx, today: string): Promise<StockItem[]> {
  const rows = await ctx.db.query<Record<string, any>>(
    `select i.id, i.code, i.name, un.name as unit, i.sale_price, i.min_stock, i.reorder_point, i.max_stock,
            coalesce(s.qty, 0) as qty, coalesce(s.value, 0) as value, coalesce(o.sold, 0) as sold_90, o.last_sale, pc.cost as last_purchase_cost
     from tz_items i
     left join tz_units un on un.id = i.unit_id
     left join (select item_id, sum(qty) as qty, sum(value) as value from tz_stock_moves where org_id = $1 and date <= $2 group by item_id) s on s.item_id = i.id
     left join (select m.item_id, sum(-m.qty) filter (where m.date > $3) as sold, max(m.date) as last_sale
                from tz_stock_moves m join tz_invoices inv on inv.id = m.source_id
                where m.org_id = $1 and m.source_type = 'invoice' and inv.kind = 'sale' and m.qty < 0 and m.date <= $2 group by m.item_id) o on o.item_id = i.id
     left join lateral (select m.unit_cost as cost from tz_stock_moves m join tz_invoices inv on inv.id = m.source_id
                        where m.org_id = $1 and m.item_id = i.id and m.source_type = 'invoice' and inv.kind = 'purchase' and m.qty > 0
                        order by m.date desc, m.seq desc limit 1) pc on true
     where i.org_id = $1 and i.kind = 'goods' and i.deleted_at is null and i.is_active`,
    [ctx.org.id, today, addDays(today, -90)],
  );
  return rows.map((r) => {
    const qty = D(r.qty);
    return {
      id: r.id, code: r.code, name: r.name, unit: r.unit ?? null, qty: qty.toString(), value: D(r.value).toString(),
      avg_cost: qty.gt(0) ? D(r.value).div(qty).toDecimalPlaces(2).toString() : null,
      sale_price: r.sale_price, min_stock: r.min_stock, reorder_point: r.reorder_point, max_stock: r.max_stock,
      sold_90: D(r.sold_90).toString(), last_sale: r.last_sale, last_purchase_cost: r.last_purchase_cost ? D(r.last_purchase_cost).toString() : null,
    };
  });
}

export interface ReorderRow {
  item: StockItem;
  daily: string;
  cover_days: number | null;
  order_qty: string;
  reason_fa: string;
  ref: AiRef;
}

/** Items to reorder: at/below their reorder point, or with less than `coverDays` of sales left. */
export function reorderAdvice(items: StockItem[], opts: { coverDays?: number; targetDays?: number } = {}): ReorderRow[] {
  const cover = opts.coverDays ?? 14;
  const target = opts.targetDays ?? 45;
  const out: ReorderRow[] = [];
  for (const it of items) {
    const qty = D(it.qty);
    const daily = D(it.sold_90).div(90);
    const threshold = it.reorder_point ?? it.min_stock;
    const below = threshold !== null && threshold !== undefined && qty.lte(D(threshold));
    const days = daily.gt(0) ? qty.div(daily).toNumber() : null;
    const short = days !== null && days < cover;
    if (!below && !short) continue;
    // order up to the maximum stock, else to `target` days of sales — and never below twice the reorder point
    const floor = threshold !== null && threshold !== undefined ? D(threshold).times(2) : D(0);
    const want = it.max_stock && D(it.max_stock).gt(0) ? D(it.max_stock) : Dmax(daily.times(target).ceil(), floor);
    const order = want.minus(qty);
    if (order.lte(0)) continue;
    out.push({
      item: it,
      daily: daily.toDecimalPlaces(3).toString(),
      cover_days: days === null ? null : Math.floor(days),
      order_qty: (order.gt(0) ? order : D(0)).ceil().toString(),
      reason_fa: below ? "موجودی به نقطهٔ سفارش رسیده است" : `فقط برای حدود ${Math.floor(days!)} روز فروش موجودی هست`,
      ref: ref("item", it.id, it.name),
    });
  }
  return out.sort((a, b) => (a.cover_days ?? 1e9) - (b.cover_days ?? 1e9));
}

export interface DeadRow {
  item: StockItem;
  idle_days: number | null;
  ref: AiRef;
}

/** Items holding stock that did not sell for `days` days. */
export function deadStock(items: StockItem[], today: string, days = 90): DeadRow[] {
  return items
    .filter((it) => D(it.qty).gt(0) && D(it.sold_90).isZero() && (!it.last_sale || diffDays(today, it.last_sale) >= days))
    .map((it) => ({ item: it, idle_days: it.last_sale ? diffDays(today, it.last_sale) : null, ref: ref("item", it.id, it.name) }))
    .sort((a, b) => D(b.item.value).cmp(D(a.item.value)));
}

export interface RepriceRow {
  item: StockItem;
  cost: string;
  margin_pct: string | null;
  suggested_price: string;
  reason_fa: string;
  ref: AiRef;
}

/**
 * Prices below cost or with a thin margin, and prices left behind by a dearer last purchase. The
 * suggestion keeps the median margin of the business's items (at least `minMargin` percent).
 */
export function repricingAdvice(items: StockItem[], dp: number, opts: { minMargin?: number } = {}): RepriceRow[] {
  const minMargin = opts.minMargin ?? 5;
  const margins = items
    .filter((it) => it.sale_price && D(it.sale_price).gt(0) && it.avg_cost && D(it.avg_cost).gt(0))
    .map((it) => D(it.sale_price!).minus(D(it.avg_cost!)).div(D(it.sale_price!)).times(100).toNumber())
    .filter((x) => x > 0 && x < 90);
  const target = Math.max(minMargin, margins.length >= 3 ? median(margins) : 20);
  const out: RepriceRow[] = [];
  for (const it of items) {
    if (!it.sale_price || !D(it.sale_price).gt(0)) continue;
    const costs = [it.avg_cost, it.last_purchase_cost].filter((c): c is string => !!c && D(c).gt(0)).map((c) => D(c));
    if (!costs.length) continue;
    const cost = costs.reduce((a, c) => (c.gt(a) ? c : a));
    const price = D(it.sale_price);
    const margin = price.minus(cost).div(price).times(100);
    if (margin.gte(minMargin)) continue;
    const suggested = cost.div(D(1).minus(D(target).div(100))).toDecimalPlaces(dp, 2);
    out.push({
      item: it, cost: cost.toString(), margin_pct: margin.toDecimalPlaces(2).toString(), suggested_price: suggested.toString(),
      reason_fa: margin.lt(0) ? "قیمت فروش کمتر از بهای تمام‌شده است" : `حاشیهٔ سود ${margin.toDecimalPlaces(1).toString()}٪ است`,
      ref: ref("item", it.id, it.name),
    });
  }
  return out.sort((a, b) => D(a.margin_pct ?? 0).cmp(D(b.margin_pct ?? 0)));
}

// ---------------------------------------------------------------- anomalies

export interface Anomaly {
  rule: string;
  severity: "info" | "notice" | "warning" | "critical";
  title_fa: string;
  detail_fa: string;
  facts: { label: string; value: string }[];
  refs: AiRef[];
  key: string;
}

export const ANOMALY_RULES_FA: Record<string, string> = {
  duplicate: "سند تکراری محتمل",
  cancelled_after_post: "ابطال پس از ثبت",
  deleted_after_post: "حذف سند ثبت‌شده",
  backdated: "ثبت با تاریخ گذشته",
  below_cost: "فروش زیر بهای تمام‌شده",
  rate_deviation: "نرخ دستی دور از نرخ روز",
  negative_stock: "موجودی منفی",
  cash_negative: "موجودی منفی صندوق",
  structuring: "معاملات خردشده زیر سقف احراز هویت",
  unusual_remittance: "حوالهٔ غیرعادی",
};

/** Rule-based anomalies of a period (each rule is cheap SQL; the model only explains them). */
export async function findAnomalies(ctx: Ctx, from: string, to: string, opts: { backdateDays?: number; rateDeviationPct?: number } = {}): Promise<Anomaly[]> {
  const org = ctx.org.id;
  const out: Anomaly[] = [];
  const backdate = opts.backdateDays ?? 7;
  const devPct = opts.rateDeviationPct ?? 3;
  const goods = ctx.hasModule("goods") && (ctx.can("sales", "view") || ctx.can("purchases", "view"));
  const gold = ctx.hasModule("gold") && ctx.can("gold", "view");
  const fx = ctx.hasModule("fx") && ctx.can("fx", "view");

  if (goods) {
    const dups = await ctx.db.query<{ a: string; b: string; kind: string; no_a: number; no_b: number; total: string; date: string; party: string | null }>(
      `select x.id as a, y.id as b, x.kind, x.no as no_a, y.no as no_b, x.total, x.date, p.name as party
       from tz_invoices x join tz_invoices y on y.org_id = x.org_id and y.kind = x.kind and y.party_id = x.party_id and y.total = x.total and y.id > x.id
         and y.date between x.date - 1 and x.date + 1 and y.deleted_at is null and y.status <> 'cancelled'
       left join tz_parties p on p.id = x.party_id
       where x.org_id = $1 and x.deleted_at is null and x.status <> 'cancelled' and x.kind in ('sale', 'purchase') and x.date >= $2 and x.date <= $3 and x.total > 0
       limit 20`,
      [org, from, to],
    );
    for (const d of dups) {
      out.push({
        rule: "duplicate", severity: "warning", key: `dup:inv:${d.a}:${d.b}`, title_fa: ANOMALY_RULES_FA.duplicate,
        detail_fa: `دو فاکتور ${d.kind === "sale" ? "فروش" : "خرید"} با مبلغ و شخص یکسان در یک یا دو روز (${d.no_a} و ${d.no_b})`,
        facts: [{ label: "مبلغ", value: D(d.total).toString() }, { label: "تاریخ", value: jd(d.date) ?? "" }, { label: "شخص", value: d.party ?? "—" }],
        refs: [ref("invoice", d.a, `فاکتور ${d.no_a}`, { kind: d.kind }), ref("invoice", d.b, `فاکتور ${d.no_b}`, { kind: d.kind })],
      });
    }
    if (ctx.can("reports", "view") && ctx.can("sales", "view")) {
      const below = await ctx.db.query<{ id: string; no: number; item: string; qty: string; net: string; cost: string; date: string }>(
        `select inv.id, inv.no, it.name as item, l.qty, (l.total - l.vat) as net, -coalesce(sum(m.value), 0) as cost, inv.date
         from tz_invoice_lines l join tz_invoices inv on inv.id = l.invoice_id join tz_items it on it.id = l.item_id
         join tz_stock_moves m on m.source_line_id = l.id and m.source_id = inv.id
         where inv.org_id = $1 and inv.deleted_at is null and inv.status = 'posted' and inv.kind = 'sale' and inv.date >= $2 and inv.date <= $3
         group by inv.id, inv.no, it.name, l.qty, l.total, l.vat, inv.date
         having (l.total - l.vat) < -coalesce(sum(m.value), 0) order by -coalesce(sum(m.value), 0) - (l.total - l.vat) desc limit 15`,
        [org, from, to],
      );
      for (const b of below) {
        out.push({
          rule: "below_cost", severity: "warning", key: `below:${b.id}:${b.item}`, title_fa: ANOMALY_RULES_FA.below_cost,
          detail_fa: `«${b.item}» در فاکتور ${b.no} زیر بهای تمام‌شده فروخته شده است`,
          facts: [{ label: "مبلغ فروش (بدون مالیات)", value: D(b.net).toString() }, { label: "بهای تمام‌شده", value: D(b.cost).toString() }, { label: "زیان", value: D(b.cost).minus(D(b.net)).toString() }],
          refs: [ref("invoice", b.id, `فاکتور ${b.no}`, { kind: "sale" })],
        });
      }
    }
    const neg = ctx.can("inventory", "view")
      ? await ctx.db.query<{ id: string; name: string; qty: string }>(
          `select i.id, i.name, sum(m.qty) as qty from tz_stock_moves m join tz_items i on i.id = m.item_id
           where m.org_id = $1 and i.kind = 'goods' and i.deleted_at is null and m.date <= $2 group by i.id, i.name having sum(m.qty) < 0 limit 15`,
          [org, to],
        )
      : [];
    for (const n of neg) {
      out.push({
        rule: "negative_stock", severity: "warning", key: `neg:${n.id}`, title_fa: ANOMALY_RULES_FA.negative_stock,
        detail_fa: `موجودی «${n.name}» منفی است؛ احتمالاً خرید یا رسیدی ثبت نشده است`, facts: [{ label: "موجودی", value: D(n.qty).toString() }], refs: [ref("item", n.id, n.name)],
      });
    }
  }

  if (ctx.can("treasury", "view")) {
    const dups = await ctx.db.query<{ a: string; b: string; kind: string; no_a: number; no_b: number; total: string; date: string }>(
      `select x.id as a, y.id as b, x.kind, x.no as no_a, y.no as no_b, x.total, x.date
       from tz_treasury_docs x join tz_treasury_docs y on y.org_id = x.org_id and y.kind = x.kind and y.party_id = x.party_id and y.total = x.total and y.id > x.id
         and y.date = x.date and y.deleted_at is null
       where x.org_id = $1 and x.deleted_at is null and x.party_id is not null and x.date >= $2 and x.date <= $3 and x.total > 0 limit 20`,
      [org, from, to],
    );
    for (const d of dups) {
      out.push({
        rule: "duplicate", severity: "warning", key: `dup:tr:${d.a}:${d.b}`, title_fa: ANOMALY_RULES_FA.duplicate,
        detail_fa: `دو سند ${d.kind === "receipt" ? "دریافت" : d.kind === "payment" ? "پرداخت" : "انتقال"} یکسان در یک روز (${d.no_a} و ${d.no_b})`,
        facts: [{ label: "مبلغ", value: D(d.total).toString() }, { label: "تاریخ", value: jd(d.date) ?? "" }],
        refs: [ref("treasury_doc", d.a, `سند ${d.no_a}`), ref("treasury_doc", d.b, `سند ${d.no_b}`)],
      });
    }
    const boxes = await ctx.db.query<{ id: string; name: string; v: string }>(
      `select b.id, b.name, sum(l.debit - l.credit) as v from tz_cash_boxes b
       join tz_voucher_lines l on l.detail_id = b.detail_id and l.org_id = b.org_id
       join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
       where b.org_id = $1 and b.deleted_at is null and ${POSTED} and a.system_key in ('cash', 'petty_cash') and v.date <= $2
       group by b.id, b.name having sum(l.debit - l.credit) < 0`,
      [org, to],
    );
    for (const b of boxes) {
      out.push({
        rule: "cash_negative", severity: "critical", key: `cashneg:${b.id}`, title_fa: ANOMALY_RULES_FA.cash_negative,
        detail_fa: `ماندهٔ صندوق «${b.name}» در دفتر منفی است؛ پرداختی بیش از موجودی ثبت شده یا دریافتی جا مانده است`,
        facts: [{ label: "مانده", value: D(b.v).toString() }], refs: [],
      });
    }
  }

  if (ctx.can("accounting", "view")) {
    const late = await ctx.db.query<{ id: string; no: number; date: string; created: string; source_type: string | null }>(
      `select v.id, v.no, v.date, (v.created_at at time zone 'UTC')::date::text as created, v.source_type from tz_vouchers v
       where v.org_id = $1 and v.deleted_at is null and v.status <> 'void' and v.kind in ('normal', 'auto')
         and (v.created_at at time zone 'UTC')::date >= $2::date and (v.created_at at time zone 'UTC')::date <= $3::date
         and (v.created_at at time zone 'UTC')::date - v.date > $4 order by (v.created_at at time zone 'UTC')::date - v.date desc limit 15`,
      [org, from, to, backdate],
    );
    for (const v of late) {
      out.push({
        rule: "backdated", severity: "notice", key: `back:${v.id}`, title_fa: ANOMALY_RULES_FA.backdated,
        detail_fa: `سند ${v.no} با تاریخ ${jd(v.date)} در ${jd(v.created)} ثبت شده است (${diffDays(v.created, v.date)} روز بعد)`,
        facts: [{ label: "تاریخ سند", value: jd(v.date) ?? "" }, { label: "تاریخ ثبت", value: jd(v.created) ?? "" }], refs: [ref("voucher", v.id, `سند ${v.no}`)],
      });
    }
  }

  // cancelled after posting (documents that had a voucher) and deletions in the audit log
  const cancelled = await ctx.db.query<{ t: string; id: string; no: number; kind: string; total: string; at: string }>(
    `${goods ? `select 'invoice' as t, id, no, kind, total, updated_at::text as at from tz_invoices
       where org_id = $1 and status = 'cancelled' and voucher_id is not null and deleted_at is null and (updated_at at time zone 'UTC')::date between $2::date and $3::date` : "select null::text as t, null::uuid as id, 0 as no, null::text as kind, 0::numeric as total, null::text as at where false"}
     ${gold ? `union all select 'gold_doc', id, no, kind, total, updated_at::text from tz_gold_docs
       where org_id = $1 and status = 'cancelled' and deleted_at is null and (updated_at at time zone 'UTC')::date between $2::date and $3::date` : ""}
     ${fx ? `union all select 'fx_deal', id, no, kind, base_value, cancelled_at::text from tz_fx_deals
       where org_id = $1 and status = 'cancelled' and deleted_at is null and cancelled_at is not null and (cancelled_at at time zone 'UTC')::date between $2::date and $3::date` : ""}
     limit 30`,
    [org, from, to],
  );
  for (const c of cancelled) {
    out.push({
      rule: "cancelled_after_post", severity: "notice", key: `cancel:${c.t}:${c.id}`, title_fa: ANOMALY_RULES_FA.cancelled_after_post,
      detail_fa: `سند ${c.no} پس از ثبت باطل شده است`, facts: [{ label: "مبلغ", value: D(c.total ?? 0).toString() }],
      refs: [ref(c.t, c.id, `سند ${c.no}`, { kind: c.kind })],
    });
  }
  if (ctx.can("reports", "view")) {
    const deleted = await ctx.db.query<{ entity: string; entity_id: string | null; summary: string | null; at: string }>(
      `select entity, entity_id::text, summary, at::text from tz_audit
       where org_id = $1 and action = 'delete' and entity in ('invoice', 'voucher', 'treasury_doc', 'gold_doc', 'fx_deal', 'remittance', 'cheque')
         and (at at time zone 'UTC')::date between $2::date and $3::date order by at desc limit 15`,
      [org, from, to],
    );
    for (const d of deleted) {
      out.push({
        rule: "deleted_after_post", severity: "notice", key: `del:${d.entity}:${d.entity_id}`, title_fa: ANOMALY_RULES_FA.deleted_after_post,
        detail_fa: `«${d.summary ?? d.entity}» حذف شده است`, facts: [{ label: "زمان", value: jd(d.at.slice(0, 10)) ?? "" }], refs: [],
      });
    }
  }

  if (fx) {
    const far = await ctx.db.query<{ id: string; no: number; rate: string; market_rate: string; code: string }>(
      `select f.id, f.no, f.rate, f.market_rate, c.code from tz_fx_deals f join tz_currencies c on c.id = case when f.kind = 'sell' then f.out_currency_id else f.in_currency_id end
       where f.org_id = $1 and f.deleted_at is null and f.status = 'posted' and f.date >= $2 and f.date <= $3 and f.market_rate > 0
         and abs(f.rate - f.market_rate) / f.market_rate * 100 > $4 limit 15`,
      [org, from, to, devPct],
    );
    for (const f of far) {
      const pct = D(f.rate).minus(D(f.market_rate)).div(D(f.market_rate)).times(100).toDecimalPlaces(2);
      out.push({
        rule: "rate_deviation", severity: "warning", key: `fxrate:${f.id}`, title_fa: ANOMALY_RULES_FA.rate_deviation,
        detail_fa: `نرخ معاملهٔ ${f.no} (${f.code}) ${pct.abs().toString()}٪ با نرخ روز فاصله دارد`,
        facts: [{ label: "نرخ معامله", value: D(f.rate).toString() }, { label: "نرخ روز", value: D(f.market_rate).toString() }], refs: [ref("fx_deal", f.id, `معامله ${f.no}`)],
      });
    }
    const threshold = fxSettings(ctx.org).kyc_threshold;
    if (threshold && D(threshold).gt(0)) {
      const split = await ctx.db.query<{ party_id: string; name: string; n: number; total: string; max: string; first: string; last: string }>(
        `select f.party_id, p.name, count(*)::int as n, sum(f.base_value) as total, max(f.base_value) as max, min(f.date) as first, max(f.date) as last
         from tz_fx_deals f join tz_parties p on p.id = f.party_id
         where f.org_id = $1 and f.deleted_at is null and f.status = 'posted' and f.date >= $2 and f.date <= $3 and f.base_value < $4 and f.base_value >= $4 * 0.7
         group by f.party_id, p.name having count(*) >= 3 and sum(f.base_value) >= $4`,
        [org, from, to, threshold],
      );
      for (const s of split) {
        out.push({
          rule: "structuring", severity: "warning", key: `struct:${s.party_id}:${from}`, title_fa: ANOMALY_RULES_FA.structuring,
          detail_fa: `${s.n} معاملهٔ «${s.name}» هر کدام کمی کمتر از سقف احراز هویت بوده و جمعشان از سقف گذشته است`,
          facts: [{ label: "جمع", value: D(s.total).toString() }, { label: "سقف احراز", value: D(threshold).toString() }, { label: "بازه", value: `${jd(s.first)} تا ${jd(s.last)}` }],
          refs: [ref("party", s.party_id, s.name)],
        });
      }
    }
    const rem = await ctx.db.query<{ id: string; no: number; base_amount: string; party_id: string | null }>(
      `select id, no, coalesce(base_amount, 0) as base_amount, party_id from tz_remittances where org_id = $1 and deleted_at is null and date >= $2 and date <= $3`,
      [org, from, to],
    );
    if (rem.length) {
      const hist = await ctx.db.query<{ v: string }>(`select coalesce(base_amount, 0) as v from tz_remittances where org_id = $1 and deleted_at is null and date < $2 and date >= $3`, [org, from, addDays(from, -365)]);
      const xs = hist.map((h) => Number(h.v)).filter((x) => x > 0);
      if (xs.length >= 20) {
        const med = median(xs);
        const mad = median(xs.map((x) => Math.abs(x - med))) * 1.4826;
        for (const r of rem) {
          const z = mad > 0 ? (Number(r.base_amount) - med) / mad : 0;
          if (z > 5) {
            out.push({
              rule: "unusual_remittance", severity: "notice", key: `rem:${r.id}`, title_fa: ANOMALY_RULES_FA.unusual_remittance,
              detail_fa: `مبلغ حوالهٔ ${r.no} بسیار بیشتر از حواله‌های معمول این کسب‌وکار است`,
              facts: [{ label: "مبلغ (ارزش پایه)", value: D(r.base_amount).toString() }, { label: "میانهٔ یک سال", value: Math.round(med).toString() }],
              refs: [ref("remittance", r.id, `حواله ${r.no}`)],
            });
          }
        }
      }
    }
  }

  if (gold) {
    const far = await ctx.db.query<{ id: string; no: number; kind: string; gram18: string; board: string }>(
      `select d.id, d.no, d.kind, d.gram18, r.gram18 as board from tz_gold_docs d
       join lateral (select gram18 from tz_gold_rates where org_id = d.org_id and deleted_at is null and (at at time zone 'UTC')::date <= d.date and gram18 > 0 order by at desc limit 1) r on true
       where d.org_id = $1 and d.deleted_at is null and d.status = 'posted' and d.kind in ('sale', 'purchase', 'buyback') and d.date >= $2 and d.date <= $3 and d.gram18 > 0
         and abs(d.gram18 - r.gram18) / r.gram18 * 100 > $4 limit 15`,
      [org, from, to, devPct],
    );
    for (const f of far) {
      const pct = D(f.gram18).minus(D(f.board)).div(D(f.board)).times(100).toDecimalPlaces(2);
      out.push({
        rule: "rate_deviation", severity: "notice", key: `goldrate:${f.id}`, title_fa: ANOMALY_RULES_FA.rate_deviation,
        detail_fa: `نرخ گرم ۱۸ سند طلای ${f.no} ${pct.abs().toString()}٪ با نرخ ثبت‌شدهٔ آن روز فاصله دارد`,
        facts: [{ label: "نرخ سند", value: D(f.gram18).toString() }, { label: "نرخ تابلو", value: D(f.board).toString() }], refs: [ref("gold_doc", f.id, `سند طلا ${f.no}`)],
      });
    }
  }
  const rank = { critical: 0, warning: 1, notice: 2, info: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------- KYC

export interface KycGap {
  type: "gold_doc" | "fx_deal";
  id: string;
  no: number;
  date: string;
  amount: string;
  party: string | null;
  why_fa: string;
  ref: AiRef;
}

/** Large gold and currency trades whose party is not identified (or a walk-in) above the KYC threshold. */
export async function kycGaps(ctx: Ctx, from: string, to: string): Promise<KycGap[]> {
  const out: KycGap[] = [];
  if (ctx.hasModule("gold") && ctx.can("gold", "view")) {
    const s = goldSettings(ctx.org);
    if (s.kyc.enabled && s.kyc.threshold) {
      const rows = await ctx.db.query<{ id: string; no: number; date: string; total: string; party: string | null; kyc: string | null; nid: string | null }>(
        `select d.id, d.no, d.date, d.total, p.name as party, p.kyc_status as kyc, coalesce(p.national_id, d.buyer->>'national_id') as nid from tz_gold_docs d left join tz_parties p on p.id = d.party_id
         where d.org_id = $1 and d.deleted_at is null and d.status = 'posted' and d.kind in ('sale', 'buyback', 'purchase') and d.date >= $2 and d.date <= $3 and d.total >= $4
           and (p.id is null or coalesce(p.kyc_status, 'none') <> 'verified') limit 30`,
        [ctx.org.id, from, to, s.kyc.threshold],
      );
      for (const r of rows) out.push({ type: "gold_doc", id: r.id, no: r.no, date: r.date, amount: D(r.total).toString(), party: r.party, why_fa: !r.party ? (r.nid ? "مشتری گذری؛ شخص تعریف‌شده ندارد" : "مشتری بدون کد ملی") : "هویت شخص تأیید نشده است", ref: ref("gold_doc", r.id, `سند طلا ${r.no}`) });
    }
  }
  if (ctx.hasModule("fx") && ctx.can("fx", "view")) {
    const t = fxSettings(ctx.org).kyc_threshold;
    if (t && D(t).gt(0)) {
      const rows = await ctx.db.query<{ id: string; no: number; date: string; base_value: string; party: string | null }>(
        `select f.id, f.no, f.date, f.base_value, p.name as party from tz_fx_deals f left join tz_parties p on p.id = f.party_id
         where f.org_id = $1 and f.deleted_at is null and f.status = 'posted' and f.date >= $2 and f.date <= $3 and f.base_value >= $4
           and (p.id is null or coalesce(p.kyc_status, 'none') <> 'verified') limit 30`,
        [ctx.org.id, from, to, t],
      );
      for (const r of rows) out.push({ type: "fx_deal", id: r.id, no: r.no, date: r.date, amount: D(r.base_value).toString(), party: r.party, why_fa: r.party ? "هویت شخص تأیید نشده است" : "مشتری گذری بالای سقف احراز هویت", ref: ref("fx_deal", r.id, `معامله ${r.no}`) });
    }
  }
  return out;
}
