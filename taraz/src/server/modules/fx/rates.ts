// The rate board (تابلوی نرخ): latest buy/sell/mid of every currency against the base currency,
// manual rates, history, and "update from the market" which turns live USD quotes into base
// prices using the business's dollar rate and applies the board margin.
import type { Ctx } from "../../context";
import { insertMany } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { D, isNumeric } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { currencyBook, fxSettings, latestRates, orgTz, rateMid, type CurrencyBook, type FxSettings, type StoredRate } from "./common";
import { customValue, marketQuotes, nobitexStats, openErRates } from "./providers";
import { NetError, type Fetch } from "./net";

const RIAL = new Set(["IRR", "IRT"]);
type Decimal = ReturnType<typeof D>;

/** Board precision: whole base units for large prices, six significant digits for small ones. */
export function roundRate(x: Decimal, baseDp: number): string {
  if (x.abs().gte(100)) return x.toDecimalPlaces(baseDp).toFixed();
  return x.toSignificantDigits(6).toDecimalPlaces(Math.max(baseDp, 10)).toFixed();
}

const errText = (e: unknown, label: string) => (e instanceof NetError ? e.message : `${label}: ${(e as Error)?.message ?? "خطا"}`);

/**
 * Base-currency price of one US dollar. Order: a custom USD source, the manual board rate,
 * official rates (bases other than rial/toman), any stored USD rate, and — rial bases only —
 * Nobitex's tether price as a stand-in.
 */
export async function usdToBase(f: Fetch, cur: CurrencyBook, s: FxSettings, stored: Map<string, StoredRate>, errors: string[]): Promise<{ rate: string | null; source: string | null; fresh: boolean }> {
  const base = cur.base;
  if (base.code === "USD") return { rate: "1", source: "base", fresh: false };
  const usd = cur.byCode.get("USD");
  const custom = s.providers.includes("custom") ? s.custom.find((c) => c.code.toUpperCase() === "USD" && c.unit === "base") : undefined;
  if (custom) {
    try {
      return { rate: await customValue(f, custom), source: "custom", fresh: true };
    } catch (e) {
      errors.push(errText(e, "منبع سفارشی"));
    }
  }
  const storedUsd = usd ? stored.get(usd.id) : undefined;
  if (storedUsd?.source === "manual" && rateMid(storedUsd)) return { rate: rateMid(storedUsd), source: "manual", fresh: false };
  const rial = RIAL.has(base.code);
  if (!rial && s.providers.includes("open_er")) {
    try {
      const rates = await openErRates(f);
      if (rates[base.code]) return { rate: rates[base.code], source: "open_er", fresh: true };
    } catch (e) {
      errors.push(errText(e, "open.er-api"));
    }
  }
  if (storedUsd && rateMid(storedUsd)) return { rate: rateMid(storedUsd), source: storedUsd.source, fresh: false };
  if (rial && s.providers.includes("nobitex")) {
    try {
      const u = (await nobitexStats(f, ["usdt"])).get("usdt");
      if (u) return { rate: base.code === "IRT" ? D(u.latest).div(10).toFixed() : u.latest, source: "nobitex_usdt", fresh: false };
    } catch (e) {
      errors.push(errText(e, "نوبیتکس"));
    }
  }
  return { rate: null, source: null, fresh: false };
}

// ---------------------------------------------------------------- board

export async function ratesBoard(ctx: Ctx) {
  ctx.need("fx", "view");
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const rows = await ctx.db.query<StoredRate & { rn: number }>(
    `select * from (
       select r.id, r.currency_id, r.buy, r.sell, r.mid, r.at, r.source,
              row_number() over (partition by r.currency_id order by r.at desc, r.created_at desc) as rn
       from tz_fx_rates r where r.org_id = $1 and r.deleted_at is null and r.quote_currency_id is null
     ) x where rn <= 2`,
    [ctx.org.id],
  );
  const latest = new Map<string, StoredRate>();
  const prev = new Map<string, StoredRate>();
  for (const r of rows) (Number(r.rn) === 1 ? latest : prev).set(r.currency_id, r);
  const s = fxSettings(ctx.org);
  return {
    base: cur.base,
    settings: { providers: s.providers, margin_pct: s.margin_pct, refresh_seconds: s.refresh_seconds, kyc_threshold: s.kyc_threshold },
    currencies: cur.list.map((c) => {
      const l = latest.get(c.id) ?? null;
      const p = prev.get(c.id) ?? null;
      const lm = rateMid(l);
      const pm = rateMid(p);
      return {
        ...c,
        rate: l ? { id: l.id, buy: l.buy, sell: l.sell, mid: lm, at: l.at, source: l.source } : null,
        change_pct: lm && pm && D(pm).gt(0) ? D(lm).div(D(pm)).minus(1).times(100).toDecimalPlaces(2).toFixed() : null,
      };
    }),
  };
}

export async function rateHistory(ctx: Ctx, currencyId: string, p: { from?: string | null; to?: string | null; limit?: number }) {
  ctx.need("fx", "view");
  if (!isUuid(currencyId)) throw bad("ارز را انتخاب کنید");
  const params: unknown[] = [ctx.org.id, currencyId];
  let cond = "";
  if (p.from || p.to) params.push(orgTz(ctx.org));
  if (p.from) {
    params.push(p.from);
    cond += ` and (at at time zone $3)::date >= $${params.length}::date`;
  }
  if (p.to) {
    params.push(p.to);
    cond += ` and (at at time zone $3)::date <= $${params.length}::date`;
  }
  const limit = Math.min(Math.max(Number(p.limit) || 300, 1), 2000);
  const rows = await ctx.db.query(
    `select id, buy, sell, mid, at, source from tz_fx_rates
     where org_id = $1 and currency_id = $2 and quote_currency_id is null and deleted_at is null ${cond}
     order by at desc, created_at desc limit ${limit}`,
    params,
  );
  return { rows };
}

export interface RateInput {
  currency_id: string;
  buy?: string | null;
  sell?: string | null;
  mid?: string | null;
  quote_currency_id?: string | null;
}

const num = (v: unknown, label: string): Decimal | null => {
  if (v === null || v === undefined || v === "") return null;
  if (!isNumeric(v)) throw bad(`${label} باید عدد باشد`);
  const d = D(v as string);
  if (d.isNeg()) throw bad(`${label} نمی‌تواند منفی باشد`);
  return d.isZero() ? null : d;
};

/** Manual rates (one row per currency); the newest row is the board's rate. */
export async function setRates(ctx: Ctx, input: { at?: string | null; rates: RateInput[] }) {
  ctx.need("fx", "edit");
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const at = input.at ? new Date(input.at) : new Date();
  if (Number.isNaN(at.getTime())) throw bad("زمان نرخ معتبر نیست");
  const rows = input.rates.map((r) => {
    const c = cur.get(r.currency_id);
    if (c.is_base) throw bad("نرخ ارز پایه همیشه یک است");
    if (r.quote_currency_id && !cur.byId.has(r.quote_currency_id)) throw bad("ارز مقابل پیدا نشد");
    const buy = num(r.buy, `نرخ خرید ${c.code}`);
    const sell = num(r.sell, `نرخ فروش ${c.code}`);
    let mid = num(r.mid, `نرخ میانگین ${c.code}`);
    if (!buy && !sell && !mid) throw bad(`برای ${c.code} دست‌کم یکی از نرخ‌ها را وارد کنید`);
    if (buy && sell && buy.gt(sell)) throw bad(`نرخ خرید ${c.code} نباید از نرخ فروش آن بیشتر باشد`);
    if (!mid) mid = buy && sell ? buy.plus(sell).div(2) : (buy ?? sell);
    return {
      id: uuidv7(),
      org_id: ctx.org.id,
      currency_id: c.id,
      quote_currency_id: r.quote_currency_id && r.quote_currency_id !== cur.base.id ? r.quote_currency_id : null,
      buy: buy?.toFixed() ?? null,
      sell: sell?.toFixed() ?? null,
      mid: mid!.toDecimalPlaces(12).toFixed(),
      at: at.toISOString(),
      source: "manual",
      origin: ctx.cfg.origin,
    };
  });
  if (!rows.length) throw bad("نرخی برای ثبت نیست");
  await ctx.write((tx) => insertMany(tx, "tz_fx_rates", rows));
  return { saved: rows.length };
}

export async function deleteRate(ctx: Ctx, id: string) {
  ctx.need("fx", "full");
  return ctx.write(async (tx) => {
    const r = await tx.one(`select id from tz_fx_rates where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!r) throw notFound("نرخ پیدا نشد");
    await tx.query(`update tz_fx_rates set deleted_at = now(), origin = $3 where id = $1 and org_id = $2`, [id, ctx.org.id, ctx.cfg.origin]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- market

/** Raw market quotes for the ticker (USD price, 24h change, source) plus the base price. */
export async function liveQuotes(ctx: Ctx, symbols: string[]) {
  ctx.need("fx", "view");
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const s = fxSettings(ctx.org);
  const wanted = symbols.length
    ? symbols.map((code) => code.toUpperCase()).filter((code, i, a) => code && a.indexOf(code) === i).slice(0, 60)
    : cur.list.filter((c) => !c.is_base && c.is_active).map((c) => c.code.toUpperCase());
  const items = wanted.map((code) => {
    const c = cur.byCode.get(code);
    return { code, kind: c?.kind ?? (["XAU", "XAG", "XPT", "XPD"].includes(code) ? ("metal" as const) : ("crypto" as const)), price_ids: c?.price_ids ?? null, name: c?.name ?? code };
  });
  const errors: string[] = [];
  const { quotes, errors: qe } = await marketQuotes(ctx.cfg.fetch, items, s.providers);
  errors.push(...qe);
  const stored = await latestRates(ctx.db, ctx.org.id);
  const usd = await usdToBase(ctx.cfg.fetch, cur, s, stored, errors);
  return {
    at: new Date().toISOString(),
    base: { code: cur.base.code, decimals: cur.base.decimals },
    usd_rate: usd.rate,
    usd_source: usd.source,
    quotes: items.map((i) => {
      const q = quotes.get(i.code);
      return {
        code: i.code,
        name: i.name,
        kind: i.kind,
        price_usd: q?.price_usd ?? null,
        change_24h: q?.change_24h ?? null,
        source: q?.source ?? null,
        price_base: q && usd.rate ? roundRate(D(q.price_usd).times(D(usd.rate)), cur.base.decimals) : null,
      };
    }),
    errors: Array.from(new Set(errors)),
  };
}

/** «به‌روزرسانی از بازار»: store fresh board rows for the active currencies whose price moved. */
export async function refreshRates(ctx: Ctx, currencyIds: string[] = [], kinds: string[] = []) {
  ctx.need("fx", "edit");
  const f = ctx.cfg.fetch;
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const s = fxSettings(ctx.org);
  const stored = await latestRates(ctx.db, ctx.org.id);
  const errors: string[] = [];
  const targets = cur.list.filter((c) => !c.is_base && c.is_active && (!currencyIds.length || currencyIds.includes(c.id)) && (!kinds.length || kinds.includes(c.kind)));
  const usd = await usdToBase(f, cur, s, stored, errors);
  const rial = RIAL.has(cur.base.code);
  const toBase = cur.base.code === "IRT" ? D("0.1") : D(1);

  // 1) prices already in the base currency: custom sources, then Nobitex for rial bases
  const direct = new Map<string, { price: string; source: string }>();
  if (s.providers.includes("custom")) {
    for (const c of targets) {
      const src = s.custom.find((x) => x.code.toUpperCase() === c.code.toUpperCase());
      if (!src || c.code === "USD") continue;
      try {
        const v = await customValue(f, src);
        if (src.unit === "base") direct.set(c.id, { price: v, source: "custom" });
        else if (usd.rate) direct.set(c.id, { price: D(v).times(D(usd.rate)).toFixed(), source: "custom" });
      } catch (e) {
        errors.push(errText(e, "منبع سفارشی"));
      }
    }
  }
  if (rial && s.providers.includes("nobitex")) {
    const crypto = targets.filter((c) => c.kind === "crypto" && !direct.has(c.id));
    const symOf = (c: (typeof crypto)[number]) => String(c.price_ids?.nobitex || c.code).toLowerCase();
    if (crypto.length) {
      try {
        const st = await nobitexStats(f, crypto.map(symOf));
        for (const c of crypto) {
          const x = st.get(symOf(c));
          if (x) direct.set(c.id, { price: D(x.latest).times(toBase).toFixed(), source: "nobitex" });
        }
      } catch (e) {
        errors.push(errText(e, "نوبیتکس"));
      }
    }
  }

  // 2) USD quotes for the rest
  const rest = targets.filter((c) => !direct.has(c.id) && c.code !== "USD");
  const { quotes, errors: qe } = rest.length ? await marketQuotes(f, rest.map((c) => ({ code: c.code, kind: c.kind, price_ids: c.price_ids })), s.providers) : { quotes: new Map(), errors: [] };
  errors.push(...qe);
  if (!usd.rate && rest.length) errors.unshift("نرخ دلار به ارز پایه معلوم نیست؛ ابتدا نرخ دلار را در تابلو دستی ثبت کنید");

  // 3) board rows with the margin
  const margin = D(s.margin_pct).div(100);
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let unchanged = 0;
  const missing: string[] = [];
  for (const c of targets) {
    let mid: Decimal | null = null;
    let source = "";
    const d = direct.get(c.id);
    if (d) {
      mid = D(d.price);
      source = d.source;
    } else if (c.code === "USD") {
      if (usd.rate && usd.fresh) {
        mid = D(usd.rate);
        source = usd.source ?? "";
      }
    } else {
      const q = quotes.get(c.code.toUpperCase());
      if (q && usd.rate) {
        mid = D(q.price_usd).times(D(usd.rate));
        source = q.source;
      }
    }
    if (!mid || mid.lte(0)) {
      if (c.code !== "USD" || usd.fresh) missing.push(c.code);
      continue;
    }
    const m = roundRate(mid, cur.base.decimals);
    const buy = roundRate(mid.times(D(1).minus(margin)), cur.base.decimals);
    const sell = roundRate(mid.times(D(1).plus(margin)), cur.base.decimals);
    const prev = stored.get(c.id);
    if (prev && D(prev.buy).eq(buy) && D(prev.sell).eq(sell) && D(prev.mid).eq(m)) {
      unchanged += 1;
      continue;
    }
    rows.push({ id: uuidv7(), org_id: ctx.org.id, currency_id: c.id, quote_currency_id: null, buy, sell, mid: m, at: now, source, origin: ctx.cfg.origin });
  }
  if (rows.length) await ctx.write((tx) => insertMany(tx, "tz_fx_rates", rows));
  const codes = new Map(cur.list.map((c) => [c.id, c.code]));
  return {
    updated: rows.length,
    unchanged,
    missing,
    usd_rate: usd.rate,
    usd_source: usd.source,
    rows: rows.map((r) => ({ code: codes.get(String(r.currency_id)), buy: r.buy, sell: r.sell, mid: r.mid, source: r.source })),
    errors: Array.from(new Set(errors)),
  };
}
