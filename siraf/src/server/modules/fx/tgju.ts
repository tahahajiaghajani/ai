// The live feed of tgju.org: unofficial and keyless. About 1,050 rows of the Tehran market, in rial,
// each under its tgju key: {current: {price_dollar_rl: {p: "2,745,000", ts: "2026-11-03 12:24:11"}, …}}
// («ts» is Tehran time; ons and silver are in US dollars).
// The same feed is served from two copies:
//   call1.tgju.org — hosted in Iran: the Windows app reaches it, but it resets connections from abroad;
//   call.tgju.org  — hosted abroad: the web version on Vercel reaches it, but Iran's filtering can block it.
// Each runtime asks its likely copy first and then remembers the copy that answered.
// The gold board (gold/rates.ts) and the exchange board (fx/providers.ts) both read it.
import { D } from "@shared/money";
import type { Fetch } from "./net";

export const TGJU_FEED_IRAN = "https://call1.tgju.org/ajax.json";
export const TGJU_FEED_ABROAD = "https://call.tgju.org/ajax.json";

const answered = new WeakMap<Fetch, string>();

/** The copies of the feed to try, in order: the one that answered last time first. */
export function tgjuFeedUrls(f: Fetch, desktop: boolean): string[] {
  const order = desktop ? [TGJU_FEED_IRAN, TGJU_FEED_ABROAD] : [TGJU_FEED_ABROAD, TGJU_FEED_IRAN];
  const last = answered.get(f);
  return last ? [last, ...order.filter((u) => u !== last)] : order;
}

export function tgjuFeedAnswered(f: Fetch, url: string) {
  answered.set(f, url);
}

/** The rows of a feed answer (the answer itself when it has no «current»). */
export function tgjuRows(data: unknown): Record<string, unknown> {
  const o = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const cur = o.current && typeof o.current === "object" ? o.current : o;
  return cur as Record<string, unknown>;
}

/** Time of a row («ts»: Tehran local time) — null when the row has none. */
export function tgjuTime(v: unknown): number | null {
  if (!v || typeof v !== "object") return null;
  const ts = (v as Record<string, unknown>).ts;
  if (typeof ts !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(ts)) return null;
  const t = Date.parse(`${ts.replace(" ", "T").slice(0, 19)}+03:30`);
  return Number.isNaN(t) ? null : t;
}

/** The price of a row («p»: "2,745,000", digits possibly Persian) as a plain decimal string. */
export function tgjuPrice(v: unknown): string | null {
  const p = v && typeof v === "object" ? (v as Record<string, unknown>).p : v;
  if (p === null || p === undefined) return null;
  const s = String(p)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[,٬\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return D(s).gt(0) ? D(s).toFixed() : null;
}

// ---------------------------------------------------------------- the exchange board

/** Rows older than this are skipped (some rarely traded currencies stand still for years). */
export const TGJU_FX_MAX_AGE_MS = 72 * 3600_000;

/** Currencies the feed quotes per 100 units (all others per one unit). */
const PER_100 = new Set(["JPY"]);

/**
 * Where a currency's rial price sits in the feed and how many units that price is for: fiat currencies only.
 * The feed's tether row (crypto-tether-irr) barely moves and sits about 1.5% under the exchanges, and its
 * crypto-*-irr rows are the world price times that row, so crypto keeps its exchange prices × the dollar.
 * A currency's own `price_ids.tgju` wins (for example "price_dollar_dt" or the exchange centre's
 * "ice_transfer_usd_sell"); it is then taken as the price of one unit.
 */
export function tgjuKeyOf(code: string, kind: string, own?: string | null): { key: string; units: number } | null {
  if (own) return { key: own, units: 1 };
  const c = code.toUpperCase();
  if (kind !== "fiat" || !/^[A-Z]{3}$/.test(c) || c === "IRR" || c === "IRT") return null;
  if (c === "USD") return { key: "price_dollar_rl", units: 1 };
  return { key: `price_${c.toLowerCase()}`, units: PER_100.has(c) ? 100 : 1 };
}
