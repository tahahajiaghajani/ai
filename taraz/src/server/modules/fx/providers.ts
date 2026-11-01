// Live market prices. Every provider is fetched in bulk at most once per 45 seconds (per server
// instance and fetch function) and answers in US dollars; the rate board turns them into the
// base currency. Binance and Bybit block some regions, so the defaults are KuCoin and OKX.
// Nobitex answers in rial (only reachable from Iran); custom sources can answer in either.
import { D } from "@shared/money";
import type { CurrencyKind, CustomSource } from "./common";
import { fetchJson, NetError, pickPath, safeExternalUrl, type Fetch } from "./net";

export interface MarketQuote {
  code: string;
  price_usd: string;
  /** percent change over 24 hours (e.g. "-1.25"), when the source reports it */
  change_24h: string | null;
  source: string;
}

interface Ticker {
  last: string;
  change: string | null;
}

const TTL_MS = 45_000;
const caches = new WeakMap<Fetch, Map<string, { at: number; value: Promise<unknown> }>>();

/** Share one in-flight/recent answer per provider key; failures are not cached. */
function cached<T>(f: Fetch, key: string, fn: () => Promise<T>): Promise<T> {
  let m = caches.get(f);
  if (!m) {
    m = new Map();
    caches.set(f, m);
  }
  const hit = m.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = fn();
  m.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (m!.get(key)?.value === value) m!.delete(key);
  });
  return value;
}

const pctFromRate = (rate: unknown): string | null => (rate === null || rate === undefined || rate === "" ? null : D(rate as string).times(100).toDecimalPlaces(2).toFixed());

// ---------------------------------------------------------------- providers (raw)

export function kucoinTickers(f: Fetch): Promise<Map<string, Ticker>> {
  return cached(f, "kucoin", async () => {
    const { json } = await fetchJson(f, "https://api.kucoin.com/api/v1/market/allTickers", "KuCoin");
    const list = json?.data?.ticker;
    if (!Array.isArray(list)) throw new NetError("KuCoin: پاسخ معتبر نیست");
    const m = new Map<string, Ticker>();
    for (const t of list) if (t?.symbol && t.last) m.set(String(t.symbol).toUpperCase(), { last: String(t.last), change: pctFromRate(t.changeRate) });
    return m;
  });
}

export function okxTickers(f: Fetch): Promise<Map<string, Ticker>> {
  return cached(f, "okx", async () => {
    const { json } = await fetchJson(f, "https://www.okx.com/api/v5/market/tickers?instType=SPOT", "OKX");
    if (!Array.isArray(json?.data)) throw new NetError("OKX: پاسخ معتبر نیست");
    const m = new Map<string, Ticker>();
    for (const t of json.data) {
      if (!t?.instId || !t.last) continue;
      const open = D(t.open24h);
      m.set(String(t.instId).toUpperCase(), { last: String(t.last), change: open.gt(0) ? D(t.last).div(open).minus(1).times(100).toDecimalPlaces(2).toFixed() : null });
    }
    return m;
  });
}

export function coingeckoPrices(f: Fetch, ids: string[]): Promise<Map<string, Ticker>> {
  const sorted = Array.from(new Set(ids.filter(Boolean))).sort();
  return cached(f, `coingecko:${sorted.join(",")}`, async () => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(sorted.join(","))}&vs_currencies=usd&include_24hr_change=true`;
    const { json } = await fetchJson(f, url, "CoinGecko");
    const m = new Map<string, Ticker>();
    for (const id of sorted) {
      const x = json?.[id];
      if (x && x.usd !== undefined && x.usd !== null) m.set(id, { last: D(x.usd).toFixed(), change: x.usd_24h_change === undefined || x.usd_24h_change === null ? null : D(x.usd_24h_change).toDecimalPlaces(2).toFixed() });
    }
    return m;
  });
}

/** Bitcoin price in USD, EUR, GBP, CAD, CHF, AUD, JPY. */
export function mempoolPrices(f: Fetch): Promise<Record<string, string>> {
  return cached(f, "mempool", async () => {
    const { json } = await fetchJson(f, "https://mempool.space/api/v1/prices", "mempool.space");
    if (!json || typeof json !== "object" || !json.USD) throw new NetError("mempool.space: پاسخ معتبر نیست");
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) if (k !== "time" && typeof v === "number" && v > 0) out[k.toUpperCase()] = D(v).toFixed();
    return out;
  });
}

/** Official rates: units of each currency per one US dollar. */
export function openErRates(f: Fetch): Promise<Record<string, string>> {
  return cached(f, "open_er", async () => {
    const { json } = await fetchJson(f, "https://open.er-api.com/v6/latest/USD", "open.er-api");
    if (json?.result !== "success" || !json.rates) throw new NetError("open.er-api: پاسخ معتبر نیست");
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json.rates as Record<string, number>)) if (typeof v === "number" && v > 0) out[k.toUpperCase()] = D(v).toFixed();
    return out;
  });
}

export interface NobitexStat {
  latest: string;
  bestBuy: string | null;
  bestSell: string | null;
  dayChange: string | null;
}

/** Rial prices from Nobitex (`btc`, `usdt` …); reachable only from inside Iran. */
export function nobitexStats(f: Fetch, symbols: string[]): Promise<Map<string, NobitexStat>> {
  const sorted = Array.from(new Set(symbols.map((s) => s.toLowerCase()).filter(Boolean))).sort();
  return cached(f, `nobitex:${sorted.join(",")}`, async () => {
    const url = `https://api.nobitex.ir/market/stats?srcCurrency=${encodeURIComponent(sorted.join(","))}&dstCurrency=rls`;
    const { json } = await fetchJson(f, url, "نوبیتکس");
    if (json?.status !== "ok" || !json.stats) throw new NetError("نوبیتکس: پاسخ معتبر نیست");
    const m = new Map<string, NobitexStat>();
    for (const s of sorted) {
      const x = json.stats[`${s}-rls`];
      if (!x || x.isClosed || !x.latest || D(x.latest).lte(0)) continue;
      m.set(s, {
        latest: D(x.latest).toFixed(),
        bestBuy: x.bestBuy ? D(x.bestBuy).toFixed() : null,
        bestSell: x.bestSell ? D(x.bestSell).toFixed() : null,
        dayChange: x.dayChange !== undefined && x.dayChange !== null && x.dayChange !== "" ? D(x.dayChange).toDecimalPlaces(2).toFixed() : null,
      });
    }
    return m;
  });
}

/** Troy-ounce price in USD of XAU / XAG / XPT / XPD. */
export function goldApiPrice(f: Fetch, symbol: string): Promise<string> {
  const s = symbol.toUpperCase();
  return cached(f, `gold_api:${s}`, async () => {
    const { json } = await fetchJson(f, `https://api.gold-api.com/price/${encodeURIComponent(s)}`, "gold-api");
    if (!json || !(Number(json.price) > 0)) throw new NetError("gold-api: پاسخ معتبر نیست");
    return D(json.price).toFixed();
  });
}

/** Value of one custom source (any HTTPS JSON API with a dotted path to the number). */
export function customValue(f: Fetch, src: CustomSource): Promise<string> {
  return cached(f, `custom:${src.url}`, async () => {
    const problem = safeExternalUrl(src.url);
    if (problem) throw new NetError(`منبع سفارشی ${src.code}: ${problem}`);
    const { json } = await fetchJson(f, src.url, `منبع سفارشی ${src.code}`);
    return JSON.stringify(json);
  }).then((text) => {
    const v = pickPath(JSON.parse(text), src.path);
    const n = D(typeof v === "number" || typeof v === "string" ? v : null);
    if (n.lte(0)) throw new NetError(`منبع سفارشی ${src.code}: در مسیر «${src.path}» عددی پیدا نشد`);
    return n.times(D(src.factor || 1)).toFixed();
  });
}

// ---------------------------------------------------------------- quotes in USD

export interface QuoteItem {
  code: string;
  kind: CurrencyKind;
  price_ids?: Record<string, string> | null;
}

const STABLE = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDP", "BUSD"]);
const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);

function pairOn(tickers: Map<string, Ticker>, code: string, id: string): Ticker | null {
  if (code === "USDT") {
    const direct = tickers.get("USDT-USDC");
    if (direct) return direct;
    const inv = tickers.get("USDC-USDT");
    if (inv && D(inv.last).gt(0)) return { last: D(1).div(D(inv.last)).toDecimalPlaces(8).toFixed(), change: inv.change ? D(inv.change).neg().toFixed() : null };
    return null;
  }
  return tickers.get(`${id.toUpperCase()}-USDT`) ?? null;
}

/**
 * USD prices for the given currencies, trying the providers in the configured order. A failing
 * provider adds a message to `errors` and the next one is tried.
 */
export async function marketQuotes(f: Fetch, items: QuoteItem[], providers: string[]): Promise<{ quotes: Map<string, MarketQuote>; errors: string[] }> {
  const quotes = new Map<string, MarketQuote>();
  const errors: string[] = [];
  const want = new Map(items.map((i) => [i.code.toUpperCase(), i]));
  if (want.has("USD")) quotes.set("USD", { code: "USD", price_usd: "1", change_24h: "0", source: "USD" });
  const missing = (pred: (i: QuoteItem) => boolean) => [...want.values()].filter((i) => !quotes.has(i.code.toUpperCase()) && pred(i));
  const idOf = (i: QuoteItem, provider: string) => String(i.price_ids?.[provider] || i.code);

  for (const p of providers) {
    try {
      if (p === "kucoin" || p === "okx") {
        const need = missing((i) => i.kind === "crypto");
        if (!need.length) continue;
        const tickers = p === "kucoin" ? await kucoinTickers(f) : await okxTickers(f);
        for (const i of need) {
          const t = pairOn(tickers, i.code.toUpperCase(), idOf(i, p));
          if (t && D(t.last).gt(0)) quotes.set(i.code.toUpperCase(), { code: i.code.toUpperCase(), price_usd: D(t.last).toFixed(), change_24h: t.change, source: p });
        }
      } else if (p === "coingecko") {
        const need = missing((i) => i.kind === "crypto" && !!i.price_ids?.coingecko);
        if (!need.length) continue;
        const prices = await coingeckoPrices(f, need.map((i) => String(i.price_ids!.coingecko)));
        for (const i of need) {
          const t = prices.get(String(i.price_ids!.coingecko));
          if (t && D(t.last).gt(0)) quotes.set(i.code.toUpperCase(), { code: i.code.toUpperCase(), price_usd: t.last, change_24h: t.change, source: p });
        }
      } else if (p === "mempool") {
        const need = missing((i) => i.code.toUpperCase() === "BTC" || i.kind === "fiat");
        if (!need.length) continue;
        const btc = await mempoolPrices(f);
        for (const i of need) {
          const c = i.code.toUpperCase();
          if (c === "BTC") quotes.set(c, { code: c, price_usd: btc.USD, change_24h: null, source: p });
          else if (btc[c] && btc.USD) quotes.set(c, { code: c, price_usd: D(btc.USD).div(D(btc[c])).toDecimalPlaces(10).toFixed(), change_24h: null, source: p });
        }
      } else if (p === "open_er") {
        const need = missing((i) => i.kind === "fiat");
        if (!need.length) continue;
        const rates = await openErRates(f);
        for (const i of need) {
          const c = i.code.toUpperCase();
          const per = rates[idOf(i, "open_er").toUpperCase()];
          if (per) quotes.set(c, { code: c, price_usd: D(1).div(D(per)).toDecimalPlaces(10).toFixed(), change_24h: null, source: p });
        }
      } else if (p === "gold_api") {
        const need = missing((i) => i.kind === "metal" && METALS.has(idOf(i, "gold_api").toUpperCase()));
        for (const i of need) {
          const price = await goldApiPrice(f, idOf(i, "gold_api"));
          quotes.set(i.code.toUpperCase(), { code: i.code.toUpperCase(), price_usd: price, change_24h: null, source: p });
        }
      }
    } catch (e) {
      errors.push(e instanceof NetError ? e.message : `${p}: ${(e as Error)?.message ?? "خطا"}`);
    }
  }
  // stablecoins: one dollar when no market answered
  for (const i of missing((x) => STABLE.has(x.code.toUpperCase()))) {
    quotes.set(i.code.toUpperCase(), { code: i.code.toUpperCase(), price_usd: "1", change_24h: null, source: "stable" });
  }
  return { quotes, errors };
}
