// The gold position of a business (what it holds in gold and what it owes or is owed in gold,
// in pure and 750-equivalent grams, valued at today's buy price) and the bubble of its coins over
// time. Read-only services shared by the reports, the dashboard and the AI tools.
import type { Ctx } from "../../context";
import { D } from "@shared/money";
import { STANDARD_FINENESS } from "@shared/gold";
import { todayISO } from "@shared/jalali";
import { productBubble, productQuote, sideGram18, type Product } from "@shared/gold-quote";
import { ledgerByKey } from "./reports";
import { barInStockAt, catalogue } from "./catalogue";
import { latestRate } from "./rates";
import { quoteEnv } from "./settings";

export interface PositionRow {
  key: "bullion" | "jewelry" | "old" | "workshop" | "coins" | "bars" | "parties" | "consignment";
  title: string;
  /** 750-equivalent grams (positive: ours / owed to us; negative: we owe) */
  weight750: string;
  /** pure (1000‰) grams */
  pure: string;
  /** coins: count; bars: number of bars */
  count?: string;
  /** book value (rial) */
  book: string;
  /** value at today's buy price */
  value: string | null;
  /** part of what we own (consignment is held for others) */
  own: boolean;
}

export interface GoldPosition {
  as_of: string;
  rate: { at: string; gram18: string | null; buy_gram18: string | null } | null;
  rows: PositionRow[];
  totals: { weight750: string; pure: string; book: string; value: string | null };
}

const pureOf750 = (w: ReturnType<typeof D>) => w.times(STANDARD_FINENESS).div(1000).toDecimalPlaces(3);

/**
 * Gold position on a date: آب‌شده, jewellery, used gold, gold at workshops, coins (gold content of
 * the stock), bars, the weight balances of parties (طلای اشخاص) and consignment held for others.
 * Values are at today's buy price (the board's buy gram price, coins at their board buy price, bars
 * at their buy-back price).
 */
export async function goldPosition(ctx: Ctx, asOf?: string | null): Promise<GoldPosition> {
  ctx.need("gold", "view");
  const to = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : todayISO((ctx.org.settings?.timezone as string) || "Asia/Tehran");
  const [ledger, cat, rate] = await Promise.all([
    ledgerByKey(ctx.db, ctx.org.id, ["gold_bullion", "gold_inventory", "gold_old", "gold_at_workshop", "gold_bars", "coin_inventory", "gold_parties", "gold_consign_memo"], to),
    catalogue(ctx.db, ctx, { to }),
    latestRate(ctx.db, ctx.org.id),
  ]);
  const dp = ctx.org.money_decimals;
  const buyG18 = sideGram18(rate, "buy");
  const at = (w: string) => (buyG18 ? D(w).times(D(buyG18)).toDecimalPlaces(dp).toString() : null);
  const ledgerRow = (key: PositionRow["key"], sys: string, title: string, own = true): PositionRow => {
    const w = D(ledger[sys].w);
    return { key, title, weight750: w.toString(), pure: pureOf750(w).toString(), book: D(ledger[sys].rial).toString(), value: at(w.toString()), own };
  };
  const env = quoteEnv(ctx.org, to);
  const coins = cat.rows.filter((r) => r.kind === "coin");
  const coinW = coins.reduce((a, r) => a.plus(D(r.weight750)), D(0));
  const coinPure = coins.reduce((a, r) => a.plus(D(r.pure)), D(0));
  const coinValue = coins.reduce<ReturnType<typeof D> | null>((a, r) => {
    if (D(r.qty).isZero()) return a;
    const v = r.buy_value ?? (buyG18 ? D(r.weight750).times(D(buyG18)).toString() : null);
    return v === null ? a : (a ?? D(0)).plus(D(v));
  }, null);
  const bars = cat.rows.filter((r) => r.kind === "bar");
  const barW = D(ledger.gold_bars.w);
  const barPure = bars.reduce((a, r) => a.plus(D(r.pure)), D(0));
  // bars at their buy-back price, one by one (a board price is the price of one bar; weight,
  // fineness and seal are each bar's own)
  const models = new Map(bars.map((r) => [r.id, r]));
  const register = await ctx.db.query<{ item_id: string | null; weight: string; fineness: string; seal_status: string | null }>(
    `select b.item_id, b.weight, b.fineness, b.seal_status from tz_gold_bars b
     where b.org_id = $1 and b.deleted_at is null and b.ownership = 'own' and ${barInStockAt(to)}`,
    [ctx.org.id, to],
  );
  let barValue: ReturnType<typeof D> | null = null;
  for (const b of register) {
    const model: Product = (b.item_id ? models.get(b.item_id) : undefined) ?? { kind: "bar", gold_meta: {} };
    const q = productQuote(model, rate, env, { side: "buy", weight: b.weight, fineness: D(b.fineness).toString(), seal_status: b.seal_status });
    if (q) barValue = (barValue ?? D(0)).plus(D(q.total));
  }
  const parties = D(ledger.gold_parties.w);
  const rows: PositionRow[] = [
    ledgerRow("bullion", "gold_bullion", "آب‌شده"),
    ledgerRow("jewelry", "gold_inventory", "مصنوعات (اتیکت‌ها)"),
    ledgerRow("old", "gold_old", "طلای مستعمل و شکسته"),
    ledgerRow("workshop", "gold_at_workshop", "طلای ما نزد کارگاه‌ها"),
    {
      key: "coins", title: "سکه‌ها", weight750: coinW.toDecimalPlaces(3).toString(), pure: coinPure.toDecimalPlaces(3).toString(),
      count: coins.reduce((a, r) => a.plus(D(r.qty)), D(0)).toString(), book: D(ledger.coin_inventory.rial).toString(),
      value: coinValue ? coinValue.toDecimalPlaces(dp).toString() : null, own: true,
    },
    {
      key: "bars", title: "شمش‌ها", weight750: barW.toString(), pure: barPure.toDecimalPlaces(3).toString(),
      count: bars.reduce((a, r) => a.plus(D(r.qty)), D(0)).toString(), book: D(ledger.gold_bars.rial).toString(),
      value: barValue ? barValue.toDecimalPlaces(dp).toString() : null, own: true,
    },
    { key: "parties", title: "حساب وزنی اشخاص (طلب منهای بدهی)", weight750: parties.toString(), pure: pureOf750(parties).toString(), book: D(ledger.gold_parties.rial).toString(), value: at(parties.toString()), own: true },
    { ...ledgerRow("consignment", "gold_consign_memo", "طلای امانی نزد ما (متعلق به دیگران)", false), book: "0", value: null },
  ];
  const own = rows.filter((r) => r.own);
  const sum = (f: (r: PositionRow) => string | null) => own.reduce((a, r) => a.plus(D(f(r) ?? 0)), D(0)).toString();
  return {
    as_of: to,
    rate: rate ? { at: rate.at, gram18: rate.gram18, buy_gram18: rate.buy_gram18 } : null,
    rows,
    totals: { weight750: D(sum((r) => r.weight750)).toDecimalPlaces(3).toString(), pure: D(sum((r) => r.pure)).toDecimalPlaces(3).toString(), book: sum((r) => r.book), value: buyG18 ? sum((r) => r.value) : null },
  };
}

export interface CoinBubbleRow {
  key: string;
  name: string;
  price: string | null;
  domestic: string | null;
  world: string | null;
  domestic_amount: string | null;
  world_amount: string | null;
  /** bubble percent (domestic basis) at each board update of the period, oldest first */
  history: { at: string; domestic: string | null; world: string | null; price: string | null }[];
}

/** Bubble of every board coin today and over the last `days` days (from the stored board history). */
export async function coinBubbles(ctx: Ctx, days = 30): Promise<{ at: string | null; rows: CoinBubbleRow[] }> {
  ctx.need("gold", "view");
  const span = Math.min(Math.max(Math.floor(days) || 30, 1), 366);
  const [cat, rate, history] = await Promise.all([
    catalogue(ctx.db, ctx, { kind: "coin" }),
    latestRate(ctx.db, ctx.org.id),
    ctx.db.query<{ at: string; coins: Record<string, string>; bubbles: Record<string, { domestic: string | null; world: string | null }> }>(
      `select at, coins, bubbles from tz_gold_rates where org_id = $1 and deleted_at is null and at >= now() - ($2::int * interval '1 day') order by at`,
      [ctx.org.id, span],
    ),
  ]);
  const rows: CoinBubbleRow[] = [];
  for (const c of cat.rows) {
    if (!c.rate_key || c.gold_meta.pricing_mode !== "board") continue;
    const b = productBubble(c, rate);
    const hist = history
      .filter((h) => h.coins?.[c.rate_key!])
      .map((h) => ({ at: h.at, domestic: h.bubbles?.[c.rate_key!]?.domestic ?? null, world: h.bubbles?.[c.rate_key!]?.world ?? null, price: h.coins[c.rate_key!] ?? null }));
    if (!b && !hist.length) continue;
    rows.push({
      key: c.rate_key, name: c.name, price: c.sell, domestic: b?.domestic?.pct ?? null, world: b?.world?.pct ?? null,
      domestic_amount: b?.domestic?.amount ?? null, world_amount: b?.world?.amount ?? null, history: hist,
    });
  }
  return { at: rate?.at ?? null, rows };
}
