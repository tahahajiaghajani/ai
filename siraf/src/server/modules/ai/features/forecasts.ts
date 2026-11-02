// Forecasts of the business, built from its own books with the deterministic toolkit in
// ../analytics/forecast.ts: the 13-week cash flow, sales and demand by Jalali month or week, and
// ranges of gold, coin and currency prices. Always ranges with measured accuracy; refused when the
// data is thin. Used by the forecast tool, GET /ai/forecast/:series and the plans.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { AiForecastSeries, AiRef } from "@shared/ai/types";
import type { AiCashWeek, AiCashflowDetails, AiRateRange, AiStockAdvice } from "@shared/ai/api";
import { D } from "@shared/money";
import { addDays, diffDays, formatJalali, jalaliMonthRange, toJalali } from "@shared/jalali";
import { bad, forbidden } from "../../../http/errors";
import { ALLOCATED_SQL } from "../../goods/common";
import { bucketKey, bucketLabel, bucketRange, bucketsBetween, type TimeGrain } from "../analytics/period";
import { forecastSeries, rateRanges, CLASS_FA } from "../analytics/forecast";
import { metricAllowed, metricDef, runMetric } from "../analytics/metrics";
import { cashAndBank, deadStock, reorderAdvice, stockItems, weekStart } from "./ops";
import { moneyInfo, ref, faNorm, faSql, type MoneyInfo } from "../tools/common";
import { isUuid } from "@shared/id";
import { formatNumber } from "@shared/format";
import { SYSTEM_RULES, dataBlock, narrate } from "./narrative";

export const FORECAST_SERIES = ["cashflow", "sales", "demand", "rate"] as const;
export type ForecastKind = (typeof FORECAST_SERIES)[number];

/** Daily closes a rate range needs; under RATE_SOLID_CLOSES the range is shown as low-confidence. */
const RATE_MIN_CLOSES = 20;
const RATE_SOLID_CLOSES = 60;

export interface ForecastParams {
  /** sales/demand: month (default) or week */
  grain?: "month" | "week";
  /** periods ahead (months 1–12, weeks 1–26; cash flow is always 13 weeks) */
  horizon?: number;
  /** demand: item id/code/name; sales: optional item */
  item?: string | null;
  /** demand/sales: category id or name */
  category?: string | null;
  /** rate: gold18 | mazaneh | coin:<board key> | fx:<currency code> */
  rate?: string | null;
}

export interface ForecastOut {
  series: AiForecastSeries;
  /** extra tables: cash-flow weeks with components, demand classification … */
  details: Record<string, unknown>;
  refs: AiRef[];
}

const n2 = (x: number, dp: number) => (Number.isFinite(x) ? D(x.toFixed(Math.min(dp, 8))).toDecimalPlaces(dp).toString() : "0");

function lastCompleteEnd(today: string, grain: TimeGrain): string {
  return addDays(bucketRange(bucketKey(today, grain), grain).from, -1);
}

function historyWindow(today: string, grain: TimeGrain): { from: string; to: string } {
  const to = lastCompleteEnd(today, grain);
  if (grain === "month") {
    const j = toJalali(to);
    const back = j.jy * 12 + j.jm - 1 - 35;
    return { from: jalaliMonthRange(Math.floor(back / 12), (back % 12) + 1).start, to };
  }
  return { from: weekStart(addDays(to, -7 * 103)), to };
}

function futureBuckets(today: string, grain: TimeGrain, h: number): string[] {
  const out: string[] = [];
  let k = bucketKey(today, grain);
  for (let i = 0; i < h; i++) {
    out.push(k);
    k = bucketKey(addDays(bucketRange(k, grain).to, 1), grain);
  }
  return out;
}

/** Drop leading empty periods (before the business started recording). */
function trimLeading(keys: string[], ys: number[]) {
  const first = ys.findIndex((v) => v !== 0);
  if (first <= 0) return { keys, ys };
  return { keys: keys.slice(first), ys: ys.slice(first) };
}

async function resolveCategoryId(ctx: Ctx, q: string): Promise<{ id: string; name: string }> {
  const s = q.trim();
  const r = isUuid(s)
    ? await ctx.db.one<{ id: string; name: string }>(`select id, name from tz_item_categories where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id])
    : await ctx.db.one<{ id: string; name: string }>(`select id, name from tz_item_categories where org_id = $1 and deleted_at is null and ${faSql("name")} = $2 limit 1`, [ctx.org.id, faNorm(s)]);
  if (!r) throw bad(`گروه کالای «${s}» پیدا نشد`);
  return r;
}

async function resolveGoodsItem(ctx: Ctx, q: string): Promise<{ id: string; name: string }> {
  const s = q.trim();
  const r = isUuid(s)
    ? await ctx.db.one<{ id: string; name: string }>(`select id, name from tz_items where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id])
    : await ctx.db.one<{ id: string; name: string }>(
        `select id, name from tz_items where org_id = $1 and deleted_at is null and (code = $2 or ${faSql("name")} = $3) order by length(name) limit 1`,
        [ctx.org.id, s, faNorm(s)],
      );
  if (!r) throw bad(`کالای «${s}» پیدا نشد`);
  return r;
}

function seriesFrom(
  key: string, title: string, unit: string, keys: string[], ys: number[], grain: TimeGrain, h: number, today: string, dp: number,
): { series: AiForecastSeries; outcome: ReturnType<typeof forecastSeries> } {
  const outcome = forecastSeries(ys, h, { seasonPeriod: grain === "month" ? 12 : 52, minPeriods: grain === "month" ? 8 : 12 });
  const future = futureBuckets(addDays(lastCompleteEnd(today, grain), 1), grain, h);
  return {
    outcome,
    series: {
      key, title_fa: title, unit,
      history: keys.map((k, i) => ({ period: bucketLabel(k, grain), value: n2(ys[i], dp) })),
      forecast: outcome.ok ? outcome.points.map((p, i) => ({ period: bucketLabel(future[i], grain), p10: n2(p.p10, dp), p50: n2(p.p50, dp), p90: n2(p.p90, dp) })) : [],
      method: outcome.ok ? `${outcome.method_fa} — الگوی ${CLASS_FA[outcome.cls.cls]}` : "—",
      backtest: outcome.backtest ? { mase: outcome.backtest.mase === null ? null : outcome.backtest.mase.toFixed(2), coverage80: outcome.backtest.coverage80 === null ? null : outcome.backtest.coverage80.toFixed(2), n: outcome.backtest.n } : null,
      refused_reason_fa: outcome.refused_reason_fa,
    },
  };
}

// ---------------------------------------------------------------- sales and demand

async function salesForecast(ctx: Ctx, p: ForecastParams, today: string, m: MoneyInfo): Promise<ForecastOut> {
  const def = metricDef("sales_amount")!;
  if (!metricAllowed(ctx, def)) throw forbidden("دسترسی دیدن فروش را ندارید");
  const grain: TimeGrain = p.grain === "week" ? "week" : "month";
  const h = Math.min(Math.max(p.horizon ?? (grain === "month" ? 3 : 8), 1), grain === "month" ? 12 : 26);
  const w = historyWindow(today, grain);
  const filters: Record<string, string> = {};
  let title = "فروش خالص";
  if (p.item) {
    const it = await resolveGoodsItem(ctx, p.item);
    filters.item_id = it.id;
    title = `فروش «${it.name}»`;
  } else if (p.category) {
    const c = await resolveCategoryId(ctx, p.category);
    filters.category_id = c.id;
    title = `فروش گروه «${c.name}»`;
  }
  const res = await runMetric(ctx, def, { from: w.from, to: w.to, from_fa: "", to_fa: "", label_fa: "", days: 0, preset: null }, grain, filters);
  const t = trimLeading(res.rows.map((r) => r.key), res.rows.map((r) => Number(r.value)));
  const { series, outcome } = seriesFrom(`sales:${grain}`, title, m.unit, t.keys, t.ys, grain, h, today, m.dp);
  return { series, details: { grain, classification: outcome.cls, sources: res.sources, notes: res.notes }, refs: [] };
}

async function demandForecast(ctx: Ctx, p: ForecastParams, today: string): Promise<ForecastOut> {
  if (!ctx.hasModule("goods")) throw forbidden("بخش کالا برای این کسب‌وکار فعال نیست");
  if (!ctx.can("inventory", "view") && !ctx.can("sales", "view")) throw forbidden("دسترسی دیدن فروش یا انبار را ندارید");
  const grain: TimeGrain = p.grain === "week" ? "week" : "month";
  const h = Math.min(Math.max(p.horizon ?? (grain === "month" ? 3 : 8), 1), grain === "month" ? 12 : 26);
  const w = historyWindow(today, grain);
  const params: unknown[] = [ctx.org.id, w.from, w.to];
  let cond = "";
  let title = "تقاضای کل کالاها (تعداد)";
  const refs: AiRef[] = [];
  if (p.item) {
    const it = await resolveGoodsItem(ctx, p.item);
    params.push(it.id);
    cond = `and m.item_id = $${params.length}`;
    title = `تقاضای «${it.name}» (تعداد)`;
    refs.push(ref("item", it.id, it.name));
  } else if (p.category) {
    const c = await resolveCategoryId(ctx, p.category);
    params.push(c.id);
    cond = `and i.category_id = $${params.length}`;
    title = `تقاضای گروه «${c.name}» (تعداد)`;
  }
  const rows = await ctx.db.query<{ d: string; q: string }>(
    `select m.date as d, sum(-m.qty) as q from tz_stock_moves m join tz_invoices inv on inv.id = m.source_id join tz_items i on i.id = m.item_id
     where m.org_id = $1 and m.source_type = 'invoice' and inv.kind in ('sale', 'sale_return') and inv.status = 'posted' and inv.deleted_at is null
       and m.date >= $2 and m.date <= $3 ${cond} group by m.date`,
    params,
  );
  const acc = new Map<string, number>();
  for (const r of rows) acc.set(bucketKey(r.d, grain), (acc.get(bucketKey(r.d, grain)) ?? 0) + Number(r.q));
  const keys = bucketsBetween(w.from, w.to, grain);
  const t = trimLeading(keys, keys.map((k) => acc.get(k) ?? 0));
  const { series, outcome } = seriesFrom(`demand:${grain}`, title, "عدد", t.keys, t.ys, grain, h, today, 3);
  return {
    series,
    details: { grain, classification: { ...outcome.cls, class_fa: CLASS_FA[outcome.cls.cls], adi: Number.isFinite(outcome.cls.adi) ? outcome.cls.adi.toFixed(2) : null, cv2: outcome.cls.cv2.toFixed(2) } },
    refs,
  };
}

// ---------------------------------------------------------------- rates

/** Daily closes (last record of each day) of a rate, oldest first. */
async function rateCloses(ctx: Ctx, spec: string, today: string): Promise<{ title: string; unit: string; days: string[]; closes: number[]; at: string | null }> {
  const m = await moneyInfo(ctx);
  const from = addDays(today, -800);
  if (spec === "gold18" || spec === "mazaneh" || spec.startsWith("coin:")) {
    if (!ctx.hasModule("gold")) throw forbidden("بخش طلا برای این کسب‌وکار فعال نیست");
    ctx.need("gold", "view");
    const expr = spec === "gold18" ? "gram18" : spec === "mazaneh" ? "mazaneh" : "(coins->>$3)::numeric";
    const params: unknown[] = [ctx.org.id, from];
    if (spec.startsWith("coin:")) params.push(spec.slice(5));
    const rows = await ctx.db.query<{ d: string; v: string }>(
      `select d, v from (select (at at time zone 'UTC')::date::text as d, ${expr} as v, row_number() over (partition by (at at time zone 'UTC')::date order by at desc) as rn
       from tz_gold_rates where org_id = $1 and deleted_at is null and at >= $2::date) x where rn = 1 and v > 0 order by d`,
      params,
    );
    let title = spec === "gold18" ? "نرخ گرم طلای ۱۸ عیار" : spec === "mazaneh" ? "مظنهٔ آب‌شده" : `نرخ سکه (${spec.slice(5)})`;
    if (spec.startsWith("coin:")) {
      const c = await ctx.db.one<{ name: string }>(`select name from tz_items where org_id = $1 and rate_key = $2 and deleted_at is null limit 1`, [ctx.org.id, spec.slice(5)]);
      if (c) title = `نرخ ${c.name}`;
    }
    const last = await ctx.db.one<{ at: string | null }>(`select max(at) as at from tz_gold_rates where org_id = $1 and deleted_at is null`, [ctx.org.id]);
    return { title, unit: m.unit, days: rows.map((r) => r.d), closes: rows.map((r) => Number(r.v)), at: last?.at ? new Date(last.at).toISOString() : null };
  }
  if (spec.startsWith("fx:")) {
    if (!ctx.hasModule("fx")) throw forbidden("بخش صرافی برای این کسب‌وکار فعال نیست");
    ctx.need("fx", "view");
    const cur = await ctx.db.one<{ id: string; code: string; name: string }>(
      `select id, code, name from tz_currencies where org_id = $1 and upper(code) = upper($2) and deleted_at is null`,
      [ctx.org.id, spec.slice(3)],
    );
    if (!cur) throw bad(`ارز «${spec.slice(3)}» تعریف نشده است`);
    const rows = await ctx.db.query<{ d: string; v: string }>(
      `select d, v from (select (at at time zone 'UTC')::date::text as d, coalesce(mid, (buy + sell) / 2, sell, buy) as v,
              row_number() over (partition by (at at time zone 'UTC')::date order by at desc) as rn
       from tz_fx_rates where org_id = $1 and currency_id = $2 and quote_currency_id is null and deleted_at is null and at >= $3::date) x
       where rn = 1 and v > 0 order by d`,
      [ctx.org.id, cur.id, from],
    );
    const last = await ctx.db.one<{ at: string | null }>(
      `select max(at) as at from tz_fx_rates where org_id = $1 and currency_id = $2 and quote_currency_id is null and deleted_at is null`,
      [ctx.org.id, cur.id],
    );
    return { title: `نرخ ${cur.name} (${cur.code})`, unit: `${m.unit} برای هر ${cur.code}`, days: rows.map((r) => r.d), closes: rows.map((r) => Number(r.v)), at: last?.at ? new Date(last.at).toISOString() : null };
  }
  throw bad("نرخ را مشخص کنید: gold18، mazaneh، coin:<کلید سکه> یا fx:<کد ارز>");
}

async function rateForecast(ctx: Ctx, p: ForecastParams, today: string, m: MoneyInfo): Promise<ForecastOut> {
  const spec = (p.rate ?? "gold18").trim();
  const r = await rateCloses(ctx, spec, today);
  const horizons = [1, 7, 30];
  const out = rateRanges(r.closes, horizons, { minCloses: RATE_MIN_CLOSES });
  const dp = spec.startsWith("fx:") ? Math.max(m.dp, 2) : m.dp;
  const tail = r.days.slice(-120);
  return {
    series: {
      key: `rate:${spec}`, title_fa: r.title, unit: r.unit,
      history: tail.map((d, i) => ({ period: formatJalali(d), value: n2(r.closes[r.closes.length - tail.length + i], dp) })),
      forecast: out.ok ? out.points.map((pt) => ({ period: formatJalali(addDays(today, pt.h)), p10: n2(pt.p10, dp), p50: n2(pt.p50, dp), p90: n2(pt.p90, dp) })) : [],
      method: out.method_fa,
      backtest: out.backtest ? { mase: null, coverage80: out.backtest.coverage80 === null ? null : out.backtest.coverage80.toFixed(2), n: out.backtest.n } : null,
      refused_reason_fa: out.refused_reason_fa,
    },
    details: {
      horizons_days: horizons, daily_volatility_pct: out.ok ? (out.sigma_daily * 100).toFixed(2) : null, high_uncertainty: out.high_uncertainty || r.closes.length < RATE_SOLID_CLOSES, observations: r.closes.length,
      note: "The middle value is today's rate: the range shows how far the price may move, never which direction.",
    },
    refs: [],
  };
}

/** The rates this business records and the member may see: gold 18, mazaneh, the coins on its board, its currencies. */
async function rateSpecs(ctx: Ctx): Promise<string[]> {
  const out: string[] = [];
  if (ctx.hasModule("gold") && ctx.can("gold", "view")) {
    const g = await ctx.db.one<{ gram18: string | null; mazaneh: string | null; coins: Record<string, unknown> | null }>(
      `select gram18, mazaneh, coins from tz_gold_rates where org_id = $1 and deleted_at is null order by at desc limit 1`,
      [ctx.org.id],
    );
    if (g?.gram18) out.push("gold18");
    if (g?.mazaneh) out.push("mazaneh");
    for (const [k, v] of Object.entries(g?.coins ?? {}).slice(0, 6)) if (v !== null && v !== "" && Number(v) > 0) out.push(`coin:${k}`);
  }
  if (ctx.hasModule("fx") && ctx.can("fx", "view")) {
    const cur = await ctx.db.query<{ code: string }>(
      `select c.code from tz_currencies c join tz_fx_rates r on r.currency_id = c.id and r.quote_currency_id is null and r.deleted_at is null
       where c.org_id = $1 and c.deleted_at is null group by c.code order by count(*) desc, c.code limit 6`,
      [ctx.org.id],
    );
    for (const c of cur) out.push(`fx:${c.code}`);
  }
  return out;
}

const RATE_HORIZONS = [1, 7, 30];

/** One rate as a range card: the last close and its 1/7/30-day ranges (or why there is none). */
export async function rateRange(ctx: Ctx, spec: string, today: string): Promise<AiRateRange> {
  const m = await moneyInfo(ctx);
  const r = await rateCloses(ctx, spec, today);
  const out = rateRanges(r.closes, RATE_HORIZONS, { minCloses: RATE_MIN_CLOSES });
  const dp = spec.startsWith("fx:") ? Math.max(m.dp, 2) : m.dp;
  const tail = r.days.slice(-90);
  return {
    key: spec, title_fa: r.title, unit: r.unit,
    last: n2(r.closes[r.closes.length - 1] ?? 0, dp),
    at: r.at,
    stale: !r.at || Date.now() - Date.parse(r.at) > 2 * 86_400_000,
    horizons: out.ok ? out.points.map((p) => ({ days: p.h, p10: n2(p.p10, dp), p50: n2(p.p50, dp), p90: n2(p.p90, dp) })) : [],
    coverage80: out.backtest?.coverage80 === null || out.backtest?.coverage80 === undefined ? null : out.backtest.coverage80.toFixed(2),
    n: out.backtest?.n ?? null,
    refused_reason_fa: out.ok ? null : out.refused_reason_fa,
    observations: r.closes.length,
    thin: out.ok && r.closes.length < RATE_SOLID_CLOSES,
    history: tail.map((d, i) => ({ period: d, value: n2(r.closes[r.closes.length - tail.length + i], dp) })),
  };
}

/** Every rate of the business as range cards (GET /forecast/rates). */
export async function rateList(ctx: Ctx, today: string): Promise<AiRateRange[]> {
  const specs = await rateSpecs(ctx);
  const out: AiRateRange[] = [];
  for (const s of specs) out.push(await rateRange(ctx, s, today));
  return out;
}

// ---------------------------------------------------------------- reorder and dead stock

function needGoodsStock(ctx: Ctx) {
  if (!ctx.hasModule("goods")) throw forbidden("بخش کالا برای این کسب‌وکار فعال نیست");
  ctx.need("inventory", "view");
}

/** Items to reorder (GET /forecast/reorder). */
export async function reorderList(ctx: Ctx, today: string): Promise<AiStockAdvice[]> {
  needGoodsStock(ctx);
  return reorderAdvice(await stockItems(ctx, today)).slice(0, 200).map((x) => ({
    item_id: x.item.id, code: x.item.code, name: x.item.name, unit: x.item.unit, stock: x.item.qty, suggested_qty: x.order_qty,
    days_cover: x.cover_days, last_sale: x.item.last_sale, value: x.item.value, reason_fa: x.reason_fa,
  }));
}

/** Stock that did not sell for 90 days, by tied-up value (GET /forecast/dead_stock). */
export async function deadStockList(ctx: Ctx, today: string): Promise<AiStockAdvice[]> {
  needGoodsStock(ctx);
  return deadStock(await stockItems(ctx, today), today).slice(0, 200).map((x) => ({
    item_id: x.item.id, code: x.item.code, name: x.item.name, unit: x.item.unit, stock: x.item.qty, suggested_qty: null,
    days_cover: null, last_sale: x.item.last_sale, value: x.item.value,
    reason_fa: x.idle_days === null ? "از ابتدا فروشی نداشته است" : `${x.idle_days} روز بی‌فروش`,
  }));
}

// ---------------------------------------------------------------- 13-week cash flow

export type CashWeek = AiCashWeek;
type CashItem = AiCashWeek["items"][number];

const Dmax0 = (x: ReturnType<typeof D>) => (x.lt(0) ? D(0) : x);

/** Average payment delay (days after due) per customer from settled invoices. */
async function payDelays(ctx: Ctx, today: string): Promise<Map<string, number>> {
  const rows = await ctx.db.query<{ party_id: string; delay: string }>(
    `select party_id, avg(greatest(0, paid_on - due)) as delay from (
       select i.party_id, coalesce(i.due_date, i.date + 30) as due, max(td.date) as paid_on
       from tz_invoices i join tz_treasury_allocs a on a.invoice_id = i.id join tz_treasury_docs td on td.id = a.doc_id and td.deleted_at is null
       where i.org_id = $1 and i.deleted_at is null and i.status = 'posted' and i.kind = 'sale' and i.date >= $2 group by i.party_id, i.id, coalesce(i.due_date, i.date + 30)
     ) x where party_id is not null group by party_id having count(*) >= 2`,
    [ctx.org.id, addDays(today, -730)],
  );
  return new Map(rows.map((r) => [r.party_id, Math.round(Number(r.delay))]));
}

export async function cashflow13(ctx: Ctx, today: string, m: MoneyInfo): Promise<ForecastOut> {
  if (!ctx.can("treasury", "view") || !ctx.can("reports", "view")) throw forbidden("پیش‌بینی جریان نقد به دسترسی خزانه‌داری و گزارش‌ها نیاز دارد");
  const start = weekStart(today);
  const end = addDays(start, 13 * 7 - 1);
  const opening = await cashAndBank(ctx, today);
  const cheques = await ctx.db.query<{ id: string; direction: string; amount: string; due_date: string; party_id: string | null; party_name: string | null; serial_no: string | null }>(
    `select c.id, c.direction, c.amount, greatest(c.due_date, $2::date)::text as due_date, c.party_id, p.name as party_name, c.serial_no
     from tz_cheques c left join tz_parties p on p.id = c.party_id
     where c.org_id = $1 and c.deleted_at is null and c.due_date <= $3
       and ((c.direction = 'received' and c.status in ('in_hand', 'deposited')) or (c.direction = 'issued' and c.status = 'issued'))`,
    [ctx.org.id, today, end],
  );
  const bounced = await ctx.db.query<{ party_id: string }>(
    `select distinct party_id from tz_cheques where org_id = $1 and deleted_at is null and direction = 'received' and party_id is not null and (status = 'bounced' or history::text like '%"bounce"%')`,
    [ctx.org.id],
  );
  const risky = new Set(bounced.map((b) => b.party_id));
  const invoices = ctx.hasModule("goods")
    ? await ctx.db.query<{ id: string; no: string | null; kind: string; party_id: string | null; party_name: string | null; due: string; remaining: string }>(
        `select i.id, i.no::text as no, i.kind, i.party_id, p.name as party_name, coalesce(i.due_date, i.date + 30)::text as due, i.total - ${ALLOCATED_SQL} as remaining
         from tz_invoices i left join tz_parties p on p.id = i.party_id where i.org_id = $1 and i.deleted_at is null and i.status = 'posted' and i.kind in ('sale', 'purchase')`,
        [ctx.org.id],
      )
    : [];
  // An open invoice is counted only up to what its party still owes in the books: a receipt or
  // payment (cash, or a cheque counted above) that was not allocated to the invoice leaves the
  // invoice "open" but already settled the debt; returns lower it too. The party's balance is
  // given to its newest invoices (payments settle the oldest first).
  const partyIds = [...new Set(invoices.map((i) => i.party_id).filter((x): x is string => !!x))];
  if (partyIds.length) {
    const owed = await ctx.db.query<{ party_id: string; ar: string; ap: string }>(
      `select p.id as party_id,
              coalesce(sum(case when a.system_key in ('ar', 'customer_advances') then l.debit - l.credit end), 0) as ar,
              coalesce(sum(case when a.system_key = 'ap' then l.credit - l.debit end), 0) as ap
       from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
       join tz_parties p on p.detail_id = l.detail_id and p.org_id = l.org_id
       where l.org_id = $1 and v.deleted_at is null and v.status in ('posted', 'final') and a.system_key in ('ar', 'customer_advances', 'ap')
         and v.date <= $2 and p.id = any($3::uuid[])
       group by p.id`,
      [ctx.org.id, today, `{${partyIds.join(",")}}`],
    );
    const left = new Map<string, ReturnType<typeof D>>();
    for (const o of owed) {
      left.set(`sale:${o.party_id}`, Dmax0(D(o.ar)));
      left.set(`purchase:${o.party_id}`, Dmax0(D(o.ap)));
    }
    for (const inv of [...invoices].sort((x, y) => y.due.localeCompare(x.due))) {
      const k = `${inv.kind}:${inv.party_id}`;
      const cap = inv.party_id ? left.get(k) : undefined;
      if (cap === undefined) continue; // no ledger rows for the party: nothing to correct
      const rem = Dmax0(D(inv.remaining));
      const kept = rem.lt(cap) ? rem : cap;
      inv.remaining = kept.toString();
      left.set(k, cap.minus(kept));
    }
  }
  const delays = await payDelays(ctx, today);
  const recurring = await ctx.db.one<{ v: string }>(
    `select coalesce(sum(l.debit - l.credit), 0) as v from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and v.deleted_at is null and v.status in ('posted', 'final') and v.kind not in ('closing', 'temp_closing') and a.kind = 'expense'
       and coalesce(a.system_key, '') not in ('cogs', 'gold_cogs', 'coin_cogs', 'inventory_loss', 'gold_loss', 'fx_revaluation') and v.date > $2 and v.date <= $3`,
    [ctx.org.id, addDays(today, -91), today],
  );
  const weeklyCost = D(recurring?.v ?? 0).div(13);
  const weekOf = (d: string) => {
    const i = Math.floor(diffDays(d < start ? start : d, start) / 7);
    return Math.min(Math.max(i, 0), 12);
  };
  const z = () => Array.from({ length: 13 }, () => D(0));
  const chIn = z(), chOut = z(), chInRisky = z(), invIn = z(), invInLate = z(), invOut = z();
  const items: CashItem[][] = Array.from({ length: 13 }, () => []);
  const who = (name: string | null) => (name ? `«${name}»` : "بی‌نام");
  for (const c of cheques) {
    const w = weekOf(c.due_date);
    const inbound = c.direction === "received";
    items[w].push({
      kind: inbound ? "cheque_in" : "cheque_out",
      label: `${inbound ? "چک دریافتی از" : "چک پرداختی به"} ${who(c.party_name)}${c.serial_no ? ` (${c.serial_no})` : ""}${c.party_id && risky.has(c.party_id) && inbound ? "، سابقهٔ برگشت" : ""}`,
      amount: inbound ? D(c.amount).toString() : D(c.amount).neg().toString(),
      ref: ref("cheque", c.id, `چک ${c.serial_no ?? ""}`.trim(), { direction: c.direction }),
    });
    if (c.direction === "received") {
      chIn[w] = chIn[w].plus(D(c.amount));
      if (c.party_id && risky.has(c.party_id)) chInRisky[w] = chInRisky[w].plus(D(c.amount));
    } else chOut[w] = chOut[w].plus(D(c.amount));
  }
  for (const inv of invoices) {
    const rem = D(inv.remaining);
    if (rem.lte(0)) continue;
    if (inv.kind === "sale") {
      const delay = inv.party_id ? delays.get(inv.party_id) ?? 0 : 0;
      const expected = addDays(inv.due < today ? today : inv.due, inv.due < today ? Math.max(7, delay) : delay);
      if (expected <= end) {
        invIn[weekOf(expected)] = invIn[weekOf(expected)].plus(rem);
        items[weekOf(expected)].push({ kind: "invoice_in", label: `ماندهٔ فاکتور فروش ${inv.no ?? ""} ${who(inv.party_name)}`.replace(/\s+/g, " "), amount: rem.toString(), ref: ref("invoice", inv.id, `فاکتور ${inv.no ?? ""}`.trim(), { kind: "sale" }) });
      }
      const late = addDays(expected, 28);
      if (late <= end) invInLate[weekOf(late)] = invInLate[weekOf(late)].plus(rem);
    } else {
      const d = inv.due < today ? today : inv.due;
      if (d <= end) {
        invOut[weekOf(d)] = invOut[weekOf(d)].plus(rem);
        items[weekOf(d)].push({ kind: "invoice_out", label: `ماندهٔ فاکتور خرید ${inv.no ?? ""} ${who(inv.party_name)}`.replace(/\s+/g, " "), amount: rem.neg().toString(), ref: ref("invoice", inv.id, `فاکتور ${inv.no ?? ""}`.trim(), { kind: "purchase" }) });
      }
    }
  }
  const round = (x: ReturnType<typeof D>) => x.toDecimalPlaces(m.dp).toString();
  let p50 = D(opening.total);
  let p10 = D(opening.total);
  let p90 = D(opening.total);
  const weeks: CashWeek[] = [];
  for (let i = 0; i < 13; i++) {
    const ws = addDays(start, i * 7);
    const open = p50;
    const net = chIn[i].plus(invIn[i]).minus(chOut[i]).minus(invOut[i]).minus(weeklyCost);
    p50 = p50.plus(net);
    // pessimistic: cheques of parties with bounces fail, customers pay four weeks late, costs +15%
    p10 = p10.plus(chIn[i].minus(chInRisky[i]).plus(invInLate[i]).minus(chOut[i]).minus(invOut[i]).minus(weeklyCost.times(1.15)));
    // optimistic: customers pay on their due dates, costs −10%
    p90 = p90.plus(net.plus(weeklyCost.times(0.1)));
    const weekItems = items[i].sort((a, b) => D(b.amount).abs().cmp(D(a.amount).abs())).slice(0, 12).map((x) => ({ ...x, amount: round(D(x.amount)) }));
    if (weeklyCost.gt(0)) weekItems.push({ kind: "recurring", label: "هزینه‌های جاری (میانگین هفتگی)", amount: round(weeklyCost.neg()), ref: null });
    weeks.push({
      week_start: ws, week_end: addDays(ws, 6), label: `هفتهٔ ${formatJalali(ws)}`, opening: round(open), cheques_in: round(chIn[i]), cheques_out: round(chOut[i]), invoices_in: round(invIn[i]),
      invoices_out: round(invOut[i]), recurring_out: round(weeklyCost), inflow: round(chIn[i].plus(invIn[i])), outflow: round(chOut[i].plus(invOut[i]).plus(weeklyCost)), net: round(net), items: weekItems, closing_p50: round(p50), closing_p10: round(p10.lt(p50) ? p10 : p50), closing_p90: round(p90.gt(p50) ? p90 : p50),
      shortfall: p50.lt(0), risk: p10.lt(0),
    });
  }
  const history = await ctx.db.query<{ d: string; v: string }>(
    `select v.date as d, sum(l.debit - l.credit) as v from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and v.deleted_at is null and v.status in ('posted', 'final') and a.system_key in ('cash', 'bank', 'petty_cash') and v.date > $2 and v.date <= $3 group by v.date`,
    [ctx.org.id, addDays(start, -13 * 7), today],
  );
  const before = D(opening.total).minus(history.reduce((a, h) => a.plus(D(h.v)), D(0)));
  let bal = before;
  const hist: { period: string; value: string }[] = [];
  for (let i = 13; i >= 1; i--) {
    const ws = addDays(start, -7 * i);
    const we = addDays(ws, 6);
    bal = bal.plus(history.filter((h) => h.d >= ws && h.d <= we).reduce((a, h) => a.plus(D(h.v)), D(0)));
    hist.push({ period: `هفتهٔ ${formatJalali(ws)}`, value: round(bal) });
  }
  return {
    series: {
      key: "cashflow", title_fa: "جریان نقد ۱۳ هفتهٔ آینده (موجودی صندوق و بانک)", unit: m.unit, history: hist,
      forecast: weeks.map((w) => ({ period: w.label, p10: w.closing_p10, p50: w.closing_p50, p90: w.closing_p90 })),
      method: "جمع موجودی نقد و بانک، چک‌های سررسید دو طرف، فاکتورهای باز با تاریخ پرداخت پیش‌بینی‌شده و میانگین هزینه‌های جاری ۱۳ هفتهٔ گذشته",
      backtest: null, refused_reason_fa: null,
    },
    details: {
      opening: opening,
      weekly_recurring_costs: round(weeklyCost),
      weeks,
      shortfall_weeks: weeks.filter((w) => w.shortfall).map((w) => w.label),
      risk_weeks: weeks.filter((w) => w.risk && !w.shortfall).map((w) => w.label),
      assumptions_fa: [
        "چک‌ها در سررسید وصول یا پرداخت می‌شوند؛ در حالت بدبینانه چک‌های اشخاصی که سابقهٔ برگشت دارند وصول نمی‌شوند",
        "فاکتورهای فروش باز با میانگین تأخیر همان مشتری (یا در سررسید) وصول می‌شوند؛ در حالت بدبینانه چهار هفته دیرتر",
        "فاکتورهای خرید باز در سررسید (یا ۳۰ روز پس از تاریخ) پرداخت می‌شوند",
        "هزینه‌های جاری برابر میانگین هفتگی ۱۳ هفتهٔ گذشته است (بدون بهای کالای فروش‌رفته)",
      ],
    } satisfies AiCashflowDetails,
    refs: [],
  };
}

/** One forecast for the caller (permissions inside). */
export async function forecast(ctx: Ctx, kind: ForecastKind, p: ForecastParams, today: string): Promise<ForecastOut> {
  const m = await moneyInfo(ctx);
  switch (kind) {
    case "cashflow":
      return cashflow13(ctx, today, m);
    case "sales":
      return salesForecast(ctx, p, today, m);
    case "demand":
      return demandForecast(ctx, p, today);
    case "rate":
      return rateForecast(ctx, p, today, m);
    default:
      throw bad("نوع پیش‌بینی پشتیبانی نمی‌شود");
  }
}

// ---------------------------------------------------------------- narrative

const narrativeSchema = z.object({ markdown: z.string().min(20).max(4000) });

function forecastTemplate(f: ForecastOut): string {
  const s = f.series;
  if (s.refused_reason_fa) return `**${s.title_fa}**\n\n${s.refused_reason_fa}`;
  const lines = [`**${s.title_fa}** (${s.unit})`, "", ...s.forecast.map((p) => `- ${p.period}: بین ${formatNumber(p.p10)} و ${formatNumber(p.p90)}، میانه ${formatNumber(p.p50)}`), "", `روش: ${s.method}`];
  if (s.backtest?.coverage80) lines.push(`در آزمون گذشته، ${formatNumber(D(s.backtest.coverage80).times(100).toDecimalPlaces(0))}٪ مقادیر واقعی در بازهٔ ۸۰٪ افتاده‌اند.`);
  const d = f.details as { shortfall_weeks?: string[] };
  if (d.shortfall_weeks?.length) lines.push(`هفته‌های کسری: ${d.shortfall_weeks.join("، ")}`);
  return lines.join("\n");
}

/** A short Persian reading of a forecast (model when available, else the template). */
export async function forecastNarrative(ctx: Ctx, kind: ForecastKind, p: ForecastParams, today: string, signal?: AbortSignal) {
  const f = await forecast(ctx, kind, p, today);
  const data = { series: { ...f.series, history: f.series.history.slice(-24) }, details: f.details };
  const n = await narrate(
    ctx,
    {
      job: "analysis", feature: "forecast",
      system: `${SYSTEM_RULES}\nExplain a forecast to the business owner in at most 8 markdown lines: the likely range (p10–p90) and the middle, how reliable the method has been (backtest), the main drivers or assumptions, and what to prepare for. Ranges, never a single target; no buy/sell advice. Reply as JSON {"markdown": "..."}.`,
      prompt: `${dataBlock("forecast", data)}\nExplain this forecast.`,
      schema: narrativeSchema, facts: data, text: (o) => o.markdown, signal,
    },
    (o) => o.markdown,
    () => forecastTemplate(f),
  );
  return { forecast: f, markdown: n.value, source: n.source, model: n.model, note_fa: n.note_fa ?? null };
}
