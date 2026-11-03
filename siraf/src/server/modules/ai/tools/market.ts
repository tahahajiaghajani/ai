// Market tools: the rate boards (gold, coins, bars, currencies, crypto) with their age, price
// quotes with the business's own pricing rules (the shared formulas the counter posts with), the
// gold and currency positions with a historical VaR, and the coin bubble over time.
import { z } from "zod";
import type { Ctx } from "../../../context";
import { D, type Num } from "@shared/money";
import { faNorm } from "./common";
import { priceJewelry, quoteBullion, quoteParsian, priceOldGold, type WageType } from "@shared/gold";
import { productQuote, type BoardRate, type Product } from "@shared/gold-quote";
import type { GoldMeta } from "@shared/gold-catalogue";
import { bad, forbidden } from "../../../http/errors";
import { latestRate } from "../../gold/rates";
import { goldSettings, quoteEnv } from "../../gold/settings";
import { catalogue, products, type ProductRow } from "../../gold/catalogue";
import { coinBubbles, goldPosition } from "../../gold/position";
import { ratesBoard } from "../../fx/rates";
import { positions as fxPositions } from "../../fx/reports";
import { historicalVaR, mean, quantile, robustZ, stdev } from "../analytics/forecast";
import { defineTool } from "./registry";
import { fmtMoney, jd, moneyInfo, reportRef, type MoneyInfo } from "./common";
import { addDays, formatJalaliDateTime } from "@shared/jalali";

const has = (v: Num) => v !== null && v !== undefined && v !== "";

function boardOf(rate: Record<string, any> | null): BoardRate | null {
  if (!rate) return null;
  return { gram18: rate.gram18, buy_gram18: rate.buy_gram18, mazaneh: rate.mazaneh, ounce_usd: rate.ounce_usd, usd: rate.usd, coins: rate.coins ?? {}, coins_buy: rate.coins_buy ?? {} };
}

/** Age of a rate and whether it is older than the business's limit (minutes). */
export function staleness(at: string | null | undefined, limitMinutes: number, now = Date.now()) {
  if (!at) return { at: null, at_fa: null, age_minutes: null, stale: true };
  const age = Math.max(0, Math.round((now - new Date(at).getTime()) / 60000));
  return { at, at_fa: formatJalaliDateTime(at), age_minutes: age, stale: age > limitMinutes };
}

function matchProduct(list: ProductRow[], q: string, kind: "coin" | "bar"): ProductRow {
  const s = faNorm(q);
  const own = list.filter((p) => p.kind === kind);
  const exact = own.filter((p) => p.is_active && (p.id === q || p.rate_key === q || p.code === q || faNorm(p.name) === s));
  if (exact.length === 1) return exact[0];
  const near = own.filter((p) => faNorm(p.name).includes(s));
  if (near.length === 1) return near[0];
  const what = kind === "coin" ? "سکه" : "مدل شمش";
  throw bad(near.length ? `چند ${what} با «${q}» هست؛ دقیق‌تر بگویید` : `${what} «${q}» در فهرست نیست`, {
    candidates: (near.length ? near : own).slice(0, 10).map((p) => ({ id: p.id, label: p.name, key: p.rate_key })),
  });
}

function matchRow<T extends { key: string; name: string }>(rows: T[], q: string): T {
  const s = faNorm(q);
  const hit = rows.filter((r) => r.key === q || faNorm(r.name) === s);
  const near = hit.length ? hit : rows.filter((r) => faNorm(r.name).includes(s));
  if (near.length === 1) return near[0];
  throw bad(near.length ? `چند سکه با «${q}» هست؛ دقیق‌تر بگویید` : `سکهٔ «${q}» روی تابلو نیست`, { candidates: (near.length ? near : rows).slice(0, 10).map((r) => ({ key: r.key, label: r.name })) });
}

// ---------------------------------------------------------------- get_rates

export const getRates = defineTool({
  name: "get_rates",
  title_fa: "نرخ‌های روز",
  description:
    "Latest rates the business recorded, each with its time and age and a `stale` flag (older than the business's limit — say so in the answer). kind=gold: mazaneh (per mesghal), 18k/24k gram, buy price of an 18k gram, world ounce (USD) and USD rate. kind=coins: sell/buy price of every coin on the board with its bubble over the gold content (domestic = 18k gram parity, world = ounce × USD parity). kind=bars: bar models on the board and the 24k gram. kind=fx / crypto: buy, sell and mid of every currency against the base currency with the change from the previous rate. Prices are in the base currency unit. These are recorded prices, not live market data.",
  input: z.object({ kind: z.enum(["gold", "coins", "bars", "fx", "crypto"]) }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const m = await moneyInfo(ctx);
    if (input.kind === "fx" || input.kind === "crypto") {
      if (!ctx.hasModule("fx")) throw forbidden("بخش صرافی برای این کسب‌وکار فعال نیست");
      const board = await ratesBoard(ctx);
      const rows = board.currencies
        .filter((c: Record<string, any>) => !c.is_base && (input.kind === "crypto" ? c.kind === "crypto" : c.kind !== "crypto"))
        .map((c: Record<string, any>) => ({
          code: c.code, name: c.name,
          buy: c.rate?.buy ?? null, sell: c.rate?.sell ?? null, mid: c.rate?.mid ?? null, change_pct: c.change_pct,
          ...staleness(c.rate?.at, 24 * 60),
        }));
      return {
        data: { kind: input.kind, unit: `${m.unit} برای هر واحد ارز`, rows, note: "stale = older than 24 hours" },
        refs: [reportRef("fx_rates", "تابلوی نرخ ارز", "fx/rates")],
        summary_fa: `نرخ ${rows.length} ${input.kind === "crypto" ? "رمزارز" : "ارز"}`,
      };
    }
    if (!ctx.hasModule("gold")) throw forbidden("بخش طلا برای این کسب‌وکار فعال نیست");
    ctx.need("gold", "view");
    const s = goldSettings(ctx.org);
    const rate = (await latestRate(ctx.db, ctx.org.id)) as Record<string, any> | null;
    const age = staleness(rate?.at, s.stale_minutes);
    if (!rate) return { data: { kind: input.kind, rate: null, note: "No gold rate has been recorded yet." }, summary_fa: "نرخی ثبت نشده است" };
    if (input.kind === "gold") {
      const prev = (await latestRate(ctx.db, ctx.org.id, rate.at)) as Record<string, any> | null;
      return {
        data: {
          kind: "gold", unit: m.unit, ...age, stale_limit_minutes: s.stale_minutes,
          mazaneh: rate.mazaneh, gram18: rate.gram18, gram24: rate.gram24, buy_gram18: rate.buy_gram18, ounce_usd: rate.ounce_usd, usd: rate.usd, source: rate.source,
          previous: prev ? { gram18: prev.gram18, at_fa: formatJalaliDateTime(prev.at), change_pct: prev.gram18 && rate.gram18 && D(prev.gram18).gt(0) ? D(rate.gram18).minus(D(prev.gram18)).div(D(prev.gram18)).times(100).toDecimalPlaces(2).toString() : null } : null,
        },
        refs: [reportRef("gold_rates", "نرخ طلا", "gold/rates")],
        summary_fa: `گرم ۱۸: ${fmtMoney(rate.gram18 ?? 0, m)}`,
      };
    }
    const cat = await catalogue(ctx.db, ctx, { kind: input.kind === "coins" ? "coin" : "bar", active: true });
    const rows = cat.rows
      .filter((p) => p.sell || p.buy)
      .map((p) => ({
        key: p.rate_key, name: p.name, sell: p.sell, buy: p.buy, gold_weight_g: p.gold_weight, fineness: p.fineness, in_stock: p.qty,
        bubble_domestic_pct: p.bubble?.domestic ?? null, bubble_world_pct: p.bubble?.world ?? null,
      }));
    return {
      data: { kind: input.kind, unit: m.unit, ...age, stale_limit_minutes: s.stale_minutes, gram18: rate.gram18, gram24: rate.gram24, rows, not_priced: cat.rows.filter((p) => !p.sell && !p.buy).map((p) => p.name) },
      refs: [reportRef("gold_rates", "نرخ طلا", "gold/rates")],
      summary_fa: `نرخ ${rows.length} ${input.kind === "coins" ? "سکه" : "شمش"}`,
    };
  },
});

// ---------------------------------------------------------------- price_quote

export const priceQuote = defineTool({
  name: "price_quote",
  title_fa: "قیمت‌گذاری طلا",
  description:
    "Prices gold products with the business's own rules and today's recorded board (or a gram18 you pass): jewelry (weight g, fineness ‰ default 750, wage percent/per_gram/fixed, profit % default the business's, VAT on wage+profit), coin (a coin on the board by name/key; sell or buy; qty), bar (a bar model by name, or weight+fineness; sell = metal + premium + profit, buy = metal − fee, sealed or opened), parsian (sut size), melted (آب‌شده: sell by mazaneh, buy by the buy gram price minus deduction), buyback (used gold bought from a customer: 750-equivalent weight × buy gram price − deduction %). Returns the total, unit price, a breakdown and the rates used with their age. A quote only — it does not record anything.",
  input: z.object({
    kind: z.enum(["jewelry", "coin", "bar", "parsian", "melted", "buyback"]),
    side: z.enum(["sell", "buy"]).default("sell").describe("sell = the business sells to the customer, buy = the business buys"),
    product: z.string().max(120).nullish().describe("coin: board key or name (e.g. «تمام سکه امامی»); bar: bar model name"),
    qty: z.union([z.string(), z.number()]).nullish().describe("number of coins (default 1)"),
    weight: z.union([z.string(), z.number()]).nullish().describe("grams (jewelry, bar, melted, buyback)"),
    fineness: z.union([z.string(), z.number()]).nullish().describe("per mille, e.g. 750, 705, 900, 995, 999.9"),
    sut: z.number().int().min(10).max(5000).nullish().describe("parsian: size in sut (1 sut = 0.001 g)"),
    wage_type: z.enum(["percent", "per_gram", "fixed"]).nullish(),
    wage_value: z.union([z.string(), z.number()]).nullish(),
    profit_pct: z.union([z.string(), z.number()]).nullish(),
    deduction_pct: z.union([z.string(), z.number()]).nullish().describe("melted/buyback: deduction percent"),
    sealed: z.boolean().nullish().describe("bar buy-back: seal intact"),
    gram18: z.union([z.string(), z.number()]).nullish().describe("override the 18k gram price (base currency)"),
  }),
  kind: "read",
  area: "gold",
  level: "view",
  modules: ["gold"],
  async run(ctx, input, rt) {
    ctx.need("gold", "view");
    const m = await moneyInfo(ctx);
    const s = goldSettings(ctx.org);
    const env = quoteEnv(ctx.org, rt.today);
    const rate = (await latestRate(ctx.db, ctx.org.id)) as Record<string, any> | null;
    const board = boardOf(rate) ?? {};
    if (has(input.gram18)) {
      board.gram18 = String(input.gram18);
      board.buy_gram18 = board.buy_gram18 ?? String(input.gram18);
    }
    const age = staleness(rate?.at, s.stale_minutes);
    const g18 = (side: "sell" | "buy") => (side === "buy" && has(board.buy_gram18) ? board.buy_gram18 : board.gram18);
    const needG18 = (side: "sell" | "buy") => {
      const v = g18(side);
      if (!has(v) || !D(v as string).gt(0)) throw bad("نرخ گرم ۱۸ ثبت نشده است؛ نرخ را ثبت کنید یا gram18 را بدهید");
      return String(v);
    };
    const num = (v: unknown, label: string) => {
      if (!has(v as Num) || !D(v as string).gt(0)) throw bad(`«${label}» را بدهید`);
      return String(v);
    };
    let result: { total: string; unit?: string | null; breakdown: { label: string; amount: string }[]; weight?: string; weight750?: string; pure?: string; bubble?: unknown };
    let product: string | null = null;
    switch (input.kind) {
      case "jewelry": {
        const weight = num(input.weight, "وزن");
        if (!input.wage_type || !has(input.wage_value)) throw bad("نوع و مقدار اجرت را بدهید");
        const p = priceJewelry({
          weight, fineness: input.fineness ?? 750, gram18: needG18("sell"), wageType: input.wage_type as WageType, wageValue: String(input.wage_value),
          profitPct: input.profit_pct ?? s.profit_pct, taxPct: env.taxPct, roundStep: env.roundStep,
        });
        result = {
          total: p.total,
          breakdown: [
            { label: "ارزش طلا", amount: p.goldValue }, { label: "اجرت", amount: p.wage }, { label: "سود فروشنده", amount: p.profit }, { label: "مالیات بر ارزش افزوده", amount: p.tax },
          ],
          weight,
        };
        break;
      }
      case "coin":
      case "bar": {
        const list = await products(ctx.db, ctx.org.id, ["coin", "bar"]);
        let p: Product | null = null;
        if (input.product) {
          const hit = matchProduct(list, input.product, input.kind);
          p = hit;
          product = hit.name;
        } else if (input.kind === "bar") {
          p = { kind: "bar", gold_weight: num(input.weight, "وزن"), fineness: String(input.fineness ?? "995"), gold_meta: {} as GoldMeta };
          product = "شمش";
        } else throw bad("سکه را نام ببرید");
        const q = productQuote(p, board, env, { side: input.side, qty: input.qty ?? 1, weight: input.weight ?? undefined, fineness: input.fineness ?? undefined, seal_status: input.sealed === false ? "opened" : "sealed" });
        if (!q) throw bad("برای این محصول قیمتی روی تابلو نیست؛ نرخ آن را ثبت کنید");
        result = { total: q.total, unit: q.unit, breakdown: q.breakdown, weight: q.weight, weight750: q.weight750, pure: q.pure, bubble: q.bubble ?? null };
        break;
      }
      case "parsian": {
        if (!input.sut) throw bad("اندازهٔ سکهٔ پارسیان (سوت) را بدهید");
        const q = quoteParsian({
          sut: input.sut, qty: input.qty ?? 1, gram18: needG18("sell"), wageType: (input.wage_type ?? "percent") as WageType, wageValue: input.wage_value ?? 0,
          profitPct: input.profit_pct ?? s.profit_pct, taxPct: env.taxPct, roundStep: env.roundStep,
        });
        result = { total: q.total, breakdown: q.breakdown, weight: q.weight, weight750: q.weight750 };
        break;
      }
      case "melted": {
        const weight = num(input.weight, "وزن");
        const fineness = num(input.fineness, "عیار");
        const q = input.side === "buy"
          ? quoteBullion({ weight, fineness, buyGram18: needG18("buy"), deductionPct: input.deduction_pct ?? s.old_deduction_pct, roundStep: env.roundStep })
          : quoteBullion({ weight, fineness, mazaneh: num(board.mazaneh, "مظنه"), roundStep: env.roundStep });
        result = { total: q.total, breakdown: q.breakdown, weight: q.weight, weight750: q.weight750, pure: q.pure };
        break;
      }
      case "buyback": {
        const weight = num(input.weight, "وزن");
        const o = priceOldGold({ weight, fineness: input.fineness ?? 750, gram18: needG18("buy"), deductionPct: input.deduction_pct ?? s.old_deduction_pct, roundStep: env.roundStep });
        result = { total: o.total, breakdown: [{ label: "ارزش طلا", amount: o.gross }, { label: "کسر", amount: D(o.deduction).neg().toString() }], weight, weight750: o.weight750 };
        break;
      }
    }
    return {
      data: {
        kind: input.kind, side: input.side, product, unit: m.unit,
        total: result.total, total_fa: fmtMoney(result.total, m), unit_price: result.unit ?? null,
        breakdown: result.breakdown.map((b) => ({ label: b.label, amount: b.amount })),
        weight_g: result.weight ?? null, weight750_g: result.weight750 ?? null, pure_g: result.pure ?? null, bubble: result.bubble ?? null,
        rates_used: { gram18: g18(input.side) ?? null, mazaneh: board.mazaneh ?? null, vat_pct: String(env.taxPct), round_step: String(env.roundStep), overridden: has(input.gram18), ...age },
        note: "A quote with today's recorded rates; prices can change before the document is posted.",
      },
      summary_fa: `${fmtMoney(result.total, m)}`,
    };
  },
});

// ---------------------------------------------------------------- positions

async function fxVaR(ctx: Ctx, rows: { currency_id: string; code: string; market_value: string | null }[], today: string) {
  const held = rows.filter((r) => r.market_value && !D(r.market_value).isZero());
  if (!held.length) return null;
  const from = addDays(today, -400);
  const hist = await ctx.db.query<{ currency_id: string; d: string; mid: string }>(
    `select currency_id, d, mid from (
       select currency_id, (at at time zone 'UTC')::date::text as d, coalesce(mid, (buy + sell) / 2, sell, buy) as mid,
              row_number() over (partition by currency_id, (at at time zone 'UTC')::date order by at desc) as rn
       from tz_fx_rates where org_id = $1 and deleted_at is null and quote_currency_id is null and at >= $2::date and currency_id = any($3::uuid[])
     ) x where rn = 1 and mid is not null order by d`,
    [ctx.org.id, from, `{${held.map((r) => r.currency_id).join(",")}}`],
  );
  const days = [...new Set(hist.map((h) => h.d))].sort();
  if (days.length < 21) return { ok: false, reason_fa: `برای ارزش در معرض خطر دست‌کم ۲۱ روز نرخ لازم است و ${days.length} روز ثبت شده است` };
  const series = new Map<string, Map<string, number>>();
  for (const h of hist) {
    const s = series.get(h.currency_id) ?? new Map<string, number>();
    s.set(h.d, Number(h.mid));
    series.set(h.currency_id, s);
  }
  const pnl: number[] = [];
  const last = new Map<string, number>();
  for (const d of days) {
    let p = 0;
    let any = false;
    for (const r of held) {
      const v = series.get(r.currency_id)?.get(d);
      const prev = last.get(r.currency_id);
      if (v !== undefined) {
        if (prev && prev > 0) {
          p += Number(r.market_value) * (v / prev - 1);
          any = true;
        }
        last.set(r.currency_id, v);
      }
    }
    if (any) pnl.push(p);
  }
  const v = historicalVaR(pnl, 0.95);
  if (!v) return { ok: false, reason_fa: "دادهٔ کافی برای ارزش در معرض خطر نیست" };
  return { ok: true, level: "95%", horizon: "1 day", var: Math.round(v.var).toString(), expected_shortfall: Math.round(v.es).toString(), scenarios: pnl.length, method: "historical simulation on recorded daily mid rates" };
}

export const positions = defineTool({
  name: "positions",
  title_fa: "موقعیت طلا و ارز",
  description:
    "Open positions: kind=gold — own gold as 750-equivalent grams (pieces, melted gold, old gold, at the workshop) valued at today's recorded 18k gram, book value, coins at board prices, bars in stock, gold owed by/to parties, consigned gold; kind=fx — holdings per currency with book value, market value at the latest recorded rates, unrealized profit, customers' and correspondents' net and the exposure, realized profit of the fiscal year, plus a 1-day 95% historical VaR (historical simulation on recorded daily rates, refused when fewer than 21 days of rates exist); kind=all — both. Money in the base currency, weights in grams. VaR is a risk measure, not a prediction.",
  input: z.object({ kind: z.enum(["gold", "fx", "all"]).default("all") }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input, rt) {
    const m: MoneyInfo = await moneyInfo(ctx);
    const out: Record<string, unknown> = { unit: m.unit, weight_unit: "گرم", as_of: rt.today, as_of_fa: jd(rt.today) };
    const notes: string[] = [];
    const wantGold = input.kind !== "fx";
    const wantFx = input.kind !== "gold";
    if (wantGold) {
      if (!ctx.hasModule("gold")) notes.push("gold module is off");
      else if (!ctx.can("gold", "view")) notes.push("no access to gold");
      else {
        const g = await goldPosition(ctx, rt.today);
        out.gold = {
          rate: g.rate ? { gram18: g.rate.gram18, buy_gram18: g.rate.buy_gram18, at_fa: formatJalaliDateTime(g.rate.at) } : null,
          note: "weight750 = 750-equivalent grams (positive: ours or owed to us, negative: we owe); value = at today's buy price",
          rows: g.rows.map((r) => ({ key: r.key, title: r.title, weight750: r.weight750, pure: r.pure, count: r.count ?? null, book_value: r.book, value_at_buy_price: r.value, own: r.own })),
          totals: { weight750: g.totals.weight750, pure: g.totals.pure, book_value: g.totals.book, value_at_buy_price: g.totals.value },
        };
      }
    }
    if (wantFx) {
      if (!ctx.hasModule("fx")) notes.push("fx module is off");
      else if (!ctx.can("fx", "view") || !ctx.can("reports", "view")) notes.push("no access to fx positions (needs fx and reports view)");
      else {
        const p = (await fxPositions(ctx, { date: rt.today })) as Record<string, any>;
        out.fx = {
          rows: (p.rows as Record<string, any>[]).map((r) => ({
            code: r.code, name: r.name, holdings: r.holdings, avg_cost: r.avg_cost, market_rate: r.market_rate, rate_at_fa: r.rate_at ? formatJalaliDateTime(r.rate_at) : null,
            book_value: r.book_value, market_value: r.market_value, unrealized: r.unrealized, customers_net: r.customers_net, correspondents_net: r.correspondents_net, exposure: r.exposure,
          })),
          totals: p.totals,
          realized: p.realized,
          var: await fxVaR(ctx, p.rows, rt.today),
        };
      }
    }
    if (!out.gold && !out.fx) throw forbidden(notes.join("; ") || "دسترسی ندارید");
    out.notes = notes;
    return { data: out, refs: [reportRef("positions", "موقعیت‌ها", out.fx ? "fx/reports/positions" : "gold/reports/stock")], summary_fa: "موقعیت‌ها" };
  },
});

// ---------------------------------------------------------------- coin_bubble

export const coinBubbleTool = defineTool({
  name: "coin_bubble",
  title_fa: "حباب سکه",
  description:
    "Bubble (حباب) of board coins over their gold content: domestic basis = 750-equivalent grams × the recorded 18k gram; world basis = fine grams ÷ 31.1035 × ounce (USD) × USD rate. For each coin (or the one named by `key`): today's bubble in percent and amount, and over the last `days` its average, min, max, median and how unusual today is (robust z-score; |z| > 2 is unusual). Built from the business's recorded rates only. Never a buy/sell recommendation.",
  input: z.object({
    key: z.string().max(80).nullish().describe("board key or coin name; empty = every coin"),
    days: z.number().int().min(7).max(365).default(90),
  }),
  kind: "read",
  area: "gold",
  level: "view",
  modules: ["gold"],
  async run(ctx, input, rt) {
    const all = await coinBubbles(ctx, input.days);
    const pick = input.key ? [matchRow(all.rows, input.key)] : all.rows;
    const rows = pick.map((c) => {
      const xs = c.history.map((h) => Number(h.domestic)).filter((x) => Number.isFinite(x));
      const today = c.domestic !== null ? Number(c.domestic) : xs[xs.length - 1];
      return {
        key: c.key, name: c.name, price: c.price,
        bubble_today: { domestic_pct: c.domestic, world_pct: c.world, domestic_amount: c.domestic_amount, world_amount: c.world_amount },
        history: xs.length >= 5
          ? { points: xs.length, avg_pct: mean(xs).toFixed(2), median_pct: quantile(xs, 0.5).toFixed(2), min_pct: Math.min(...xs).toFixed(2), max_pct: Math.max(...xs).toFixed(2), stdev_pct: stdev(xs).toFixed(2), robust_z_today: Number.isFinite(today) ? robustZ(today, xs).toFixed(2) : null }
          : { points: xs.length, note: "fewer than 5 recorded prices in the window" },
      };
    });
    let data_ref: string | undefined;
    if (pick.length === 1 && pick[0].history.length > 1) {
      data_ref = await rt.putData(pick[0].history.map((h) => ({ label: formatJalaliDateTime(h.at), value: Number(h.domestic ?? 0) })), { title: `حباب ${pick[0].name}` });
    }
    return {
      data: { days: input.days, at_fa: all.at ? formatJalaliDateTime(all.at) : null, unit: "percent of intrinsic value", rows, data_ref: data_ref ?? null, note: "Bubble = price − gold value. Not advice." },
      data_ref,
      chart: data_ref ? { kind: "line", title: `حباب ${pick[0].name} (٪)`, x: "label", series: [{ field: "value", label: "حباب داخلی" }], unit: "٪" } : undefined,
      refs: [reportRef("gold_rates", "نرخ طلا و سکه", "gold/rates")],
      summary_fa: `حباب ${rows.length} سکه`,
    };
  },
});
