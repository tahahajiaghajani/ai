// Daily price board (تابلوی قیمت): manual entry (mazaneh ↔ gram18), history, the latest rate
// and live prices from the internet:
//   tgju      — unofficial JSON of tgju.org (Iranian market, prices in rial)
//   goldapi   — world ounce in USD (api.gold-api.com) × the free-market dollar → gram18
//   custom    — any JSON URL with JSON paths of the fields (settings.gold.price_source)
// From abroad Iranian sites may be blocked and vice versa, so "auto" tries them in turn.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { insertRow } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { D, isNumeric, normalizeDigits, type Num } from "@shared/money";
import { gram18FromOunce, mazanehFromGram18, gram18FromMazaneh, TROY_OUNCE_GRAMS } from "@shared/gold";
import { uuidv7 } from "@shared/id";
import { goldSettings, type CustomSource, type LiveProvider, type RateField } from "./settings";

export interface RateRow {
  id: string;
  at: string;
  mazaneh: string | null;
  gram18: string | null;
  gram24: string | null;
  ounce_usd: string | null;
  usd: string | null;
  buy_gram18: string | null;
  coins: Record<string, string>;
  source: string;
  note: string | null;
}

const COLS = "id, at, mazaneh, gram18, gram24, ounce_usd, usd, buy_gram18, coins, source, note";
export const COIN_KEYS = ["emami", "bahar", "nim", "rob", "gerami"] as const;

export async function latestRate(q: Queryable, orgId: string, before?: string | null): Promise<RateRow | null> {
  return q.one<RateRow>(
    `select ${COLS} from tz_gold_rates where org_id = $1 and deleted_at is null ${before ? "and at < $2" : ""} order by at desc limit 1`,
    before ? [orgId, before] : [orgId],
  );
}

/** Latest rate with its change against the rate before it. */
export async function latestWithChange(q: Queryable, orgId: string) {
  const rate = await latestRate(q, orgId);
  if (!rate) return { rate: null, previous: null, change: null, change_pct: null };
  const previous = await latestRate(q, orgId, rate.at);
  let change: string | null = null;
  let pct: string | null = null;
  if (previous?.gram18 && rate.gram18) {
    const d = D(rate.gram18).minus(D(previous.gram18));
    change = d.toString();
    pct = D(previous.gram18).isZero() ? null : d.div(D(previous.gram18)).times(100).toDecimalPlaces(2).toString();
  }
  return { rate, previous, change, change_pct: pct };
}

export async function listRates(ctx: Ctx, p: { page?: number; size?: number; from?: string | null; to?: string | null }) {
  ctx.need("gold", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["org_id = $1", "deleted_at is null"];
  if (p.from) {
    params.push(p.from);
    cond.push(`at >= $${params.length}::date`);
  }
  if (p.to) {
    params.push(p.to);
    cond.push(`at < ($${params.length}::date + 1)`);
  }
  const size = Math.min(Math.max(p.size ?? 50, 1), 500);
  const page = Math.max(p.page ?? 1, 1);
  const total = await ctx.db.one<{ n: number }>(`select count(*)::int as n from tz_gold_rates where ${cond.join(" and ")}`, params);
  const rows = await ctx.db.query<RateRow>(
    `select ${COLS}, created_at from tz_gold_rates where ${cond.join(" and ")} order by at desc limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { rows, total: total?.n ?? 0, page, size };
}

export interface RateInput {
  at?: string | null;
  mazaneh?: Num;
  gram18?: Num;
  gram24?: Num;
  ounce_usd?: Num;
  usd?: Num;
  buy_gram18?: Num;
  coins?: Record<string, Num> | null;
  note?: string | null;
  source?: string;
}

const pos = (v: Num) => (v !== null && v !== undefined && v !== "" && isNumeric(v) && D(v).gt(0) ? D(v) : null);

/** Normalise a rate: the missing one of gram18/mazaneh is derived from the other. */
export function normalizeRate(input: RateInput, moneyDp = 0) {
  let gram18 = pos(input.gram18);
  let mazaneh = pos(input.mazaneh);
  if (!gram18 && !mazaneh) throw bad("قیمت گرم ۱۸ عیار یا مظنه را وارد کنید");
  if (!gram18) gram18 = D(gram18FromMazaneh(mazaneh!));
  if (!mazaneh) mazaneh = D(mazanehFromGram18(gram18));
  const gram24 = pos(input.gram24) ?? gram18.times(1000).div(750).toDecimalPlaces(moneyDp);
  const coins: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.coins ?? {})) {
    const d = pos(v);
    if (d && /^[a-z_]{2,20}$/.test(k)) coins[k] = d.toDecimalPlaces(moneyDp).toString();
  }
  return {
    mazaneh: mazaneh.toDecimalPlaces(moneyDp).toString(),
    gram18: gram18.toDecimalPlaces(moneyDp).toString(),
    gram24: gram24.toDecimalPlaces(moneyDp).toString(),
    ounce_usd: pos(input.ounce_usd)?.toString() ?? null,
    usd: pos(input.usd)?.toString() ?? null,
    buy_gram18: pos(input.buy_gram18)?.toDecimalPlaces(moneyDp).toString() ?? null,
    coins,
  };
}

export async function addRate(ctx: Ctx, input: RateInput): Promise<RateRow> {
  ctx.need("gold", "edit");
  const r = normalizeRate(input, ctx.org.money_decimals);
  const at = input.at && !Number.isNaN(new Date(input.at).getTime()) ? new Date(input.at).toISOString() : new Date().toISOString();
  return ctx.write((tx) =>
    insertRow<RateRow>(tx, "tz_gold_rates", {
      id: uuidv7(), org_id: ctx.org.id, at, ...r, source: input.source ?? "manual", note: input.note?.trim() || null, origin: ctx.cfg.origin,
    }, COLS),
  );
}

export async function deleteRate(ctx: Ctx, id: string) {
  ctx.need("gold", "full");
  await ctx.write(async (tx) => {
    const r = await tx.one(`select id from tz_gold_rates where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!r) throw notFound("قیمت پیدا نشد");
    await tx.query(`update tz_gold_rates set deleted_at = now(), origin = $2 where id = $1`, [id, ctx.cfg.origin]);
  });
  return { ok: true };
}

// ---------------------------------------------------------------- live prices

class SourceError extends Error {}

/** Only public http(s) addresses (no loopback/private networks) unless running on the desktop. */
export function checkUrl(raw: string, desktop: boolean): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad("نشانی منبع قیمت معتبر نیست");
  }
  if (u.protocol !== "https:" && !(desktop && u.protocol === "http:")) throw bad("نشانی منبع قیمت باید با https شروع شود");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h === "0.0.0.0" || h === "::1" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^(fc|fd|fe80)/.test(h);
  if (privateHost && !desktop) throw bad("منبع قیمت باید نشانی عمومی اینترنتی باشد");
  return u;
}

async function getJson(ctx: Ctx, url: string, timeoutMs = 10_000): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await ctx.cfg.fetch(url, { signal: ac.signal, headers: { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 (Taraz accounting)" } });
    if (!res.ok) throw new SourceError(`پاسخ ${res.status}`);
    const text = await res.text();
    if (text.length > 3_000_000) throw new SourceError("پاسخ بیش از حد بزرگ است");
    try {
      return JSON.parse(text);
    } catch {
      throw new SourceError("پاسخ JSON نیست");
    }
  } catch (e) {
    if (e instanceof SourceError) throw e;
    if ((e as Error)?.name === "AbortError") throw new SourceError("در ۱۰ ثانیه پاسخ نداد");
    throw new SourceError("در دسترس نیست");
  } finally {
    clearTimeout(timer);
  }
}

/** Read `a.b[0].c` from a JSON value. */
export function pickPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** A price out of a value like 1234567, "1,234,567", "۱٬۲۳۴٬۵۶۷" or {p: "…"}. */
function priceOf(v: unknown): ReturnType<typeof D> | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    v = o.p ?? o.price ?? o.value ?? o.last ?? null;
  }
  if (v === null || v === undefined) return null;
  const s = normalizeDigits(String(v)).replace(/[,٬\s]/g, "");
  if (!isNumeric(s)) return null;
  const d = D(s);
  return d.gt(0) ? d : null;
}

/** Rial (or toman) prices of a source in the organisation's base currency. */
function toBase(ctx: Ctx, v: ReturnType<typeof D> | null, unit: "rial" | "toman") {
  if (!v) return null;
  const base = ctx.org.base_currency;
  if (base === "IRT" && unit === "rial") return v.div(10);
  if (base === "IRR" && unit === "toman") return v.times(10);
  return v;
}

export interface LiveResult {
  source: string;
  input: RateInput;
  warnings: string[];
}

async function fromTgju(ctx: Ctx): Promise<LiveResult> {
  const data = (await getJson(ctx, "https://call1.tgju.org/ajax.json")) as Record<string, unknown>;
  const cur = (data && typeof data === "object" && data.current && typeof data.current === "object" ? data.current : data) as Record<string, unknown>;
  const get = (k: string) => toBase(ctx, priceOf(cur?.[k]), "rial");
  const gram18 = get("geram18");
  const mazaneh = get("mesghal");
  if (!gram18 && !mazaneh) throw new SourceError("قیمت گرم ۱۸ در پاسخ نبود");
  const ons = priceOf(cur?.ons);
  return {
    source: "tgju",
    warnings: [],
    input: {
      gram18: gram18?.toString(), mazaneh: mazaneh?.toString(), gram24: get("geram24")?.toString(),
      ounce_usd: ons?.toString(), usd: get("price_dollar_rl")?.toString(),
      coins: { emami: get("sekee")?.toString(), bahar: get("sekeb")?.toString(), nim: get("nim")?.toString(), rob: get("rob")?.toString(), gerami: get("gerami")?.toString() },
    },
  };
}

/** Free-market USD rate: the request, the FX module's latest USD rate, or settings.gold.usd. */
async function usdRate(ctx: Ctx, given?: Num): Promise<{ usd: ReturnType<typeof D>; from: string } | null> {
  const g = pos(given);
  if (g) return { usd: g, from: "ورودی" };
  const fx = await ctx.db.one<{ mid: string | null; sell: string | null; buy: string | null }>(
    `select r.mid, r.sell, r.buy from tz_fx_rates r join tz_currencies c on c.id = r.currency_id
     where r.org_id = $1 and r.deleted_at is null and c.deleted_at is null and upper(c.code) = 'USD'
       and (r.quote_currency_id is null or r.quote_currency_id = (select id from tz_currencies where org_id = $1 and is_base and deleted_at is null limit 1))
     order by r.at desc limit 1`,
    [ctx.org.id],
  );
  const fxv = pos(fx?.mid) ?? pos(fx?.sell) ?? pos(fx?.buy);
  if (fxv) return { usd: fxv, from: "نرخ ارز صرافی" };
  const s = goldSettings(ctx.org).usd;
  if (s) return { usd: D(s), from: "تنظیمات" };
  return null;
}

async function fromGoldApi(ctx: Ctx, usdGiven?: Num): Promise<LiveResult> {
  const usd = await usdRate(ctx, usdGiven);
  if (!usd) throw new SourceError("نرخ دلار بازار آزاد ثبت نشده است (تنظیمات قیمت زنده)");
  const data = (await getJson(ctx, "https://api.gold-api.com/price/XAU")) as Record<string, unknown>;
  const ounce = priceOf(data?.price ?? data?.value);
  if (!ounce) throw new SourceError("قیمت انس در پاسخ نبود");
  const gram18 = D(gram18FromOunce(ounce, usd.usd));
  const gram24 = ounce.div(TROY_OUNCE_GRAMS).times(usd.usd).toDecimalPlaces(0);
  return {
    source: "goldapi",
    warnings: [`قیمت از انس جهانی و دلار ${usd.from} محاسبه شد؛ حباب بازار داخل در آن نیست`],
    input: { gram18: gram18.toString(), gram24: gram24.toString(), ounce_usd: ounce.toString(), usd: usd.usd.toString() },
  };
}

async function fromCustom(ctx: Ctx, src: CustomSource): Promise<LiveResult> {
  const url = checkUrl(src.url, ctx.cfg.mode === "desktop");
  const data = await getJson(ctx, url.toString());
  const unit = src.unit ?? "rial";
  const get = (f: RateField) => (src.paths[f] ? priceOf(pickPath(data, src.paths[f]!)) : null);
  const money = (f: RateField) => toBase(ctx, get(f), unit);
  const gram18 = money("gram18");
  const mazaneh = money("mazaneh");
  if (!gram18 && !mazaneh) throw new SourceError("در مسیرهای تعیین‌شده قیمتی پیدا نشد");
  return {
    source: "custom",
    warnings: [],
    input: {
      gram18: gram18?.toString(), mazaneh: mazaneh?.toString(), gram24: money("gram24")?.toString(), buy_gram18: money("buy_gram18")?.toString(),
      ounce_usd: get("ounce_usd")?.toString(), usd: money("usd")?.toString(),
      coins: { emami: money("emami")?.toString(), bahar: money("bahar")?.toString(), nim: money("nim")?.toString(), rob: money("rob")?.toString(), gerami: money("gerami")?.toString() },
    },
  };
}

const PROVIDER_TITLE: Record<string, string> = { tgju: "tgju.org", goldapi: "انس جهانی (gold-api.com)", custom: "منبع دلخواه" };

/** Fetch live prices and (by default) store them as a new rate. */
export async function fetchLive(ctx: Ctx, opts: { provider?: LiveProvider; usd?: Num; save?: boolean }) {
  ctx.need("gold", opts.save === false ? "view" : "edit");
  const s = goldSettings(ctx.org);
  const provider = opts.provider ?? s.provider;
  const order: Exclude<LiveProvider, "auto">[] =
    provider === "auto" ? [...(s.price_source ? (["custom"] as const) : []), "tgju", "goldapi"] : [provider];
  const errors: string[] = [];
  let result: LiveResult | null = null;
  for (const p of order) {
    try {
      if (p === "custom") {
        if (!s.price_source) throw new SourceError("منبع دلخواه تنظیم نشده است");
        result = await fromCustom(ctx, s.price_source);
      } else if (p === "tgju") result = await fromTgju(ctx);
      else result = await fromGoldApi(ctx, opts.usd);
      break;
    } catch (e) {
      if (!(e instanceof SourceError)) throw e;
      errors.push(`${PROVIDER_TITLE[p]}: ${e.message}`);
    }
  }
  if (!result) {
    throw bad(
      `دریافت قیمت زنده ممکن نشد — ${errors.join(" · ")}. ` +
        "اگر خارج از ایران هستید سایت‌های ایرانی ممکن است در دسترس نباشند (و برعکس)؛ منبع دیگری را امتحان کنید یا قیمت را دستی وارد کنید.",
    );
  }
  // the world-ounce provider has no coin prices: keep the last known ones
  const prev = await latestRate(ctx.db, ctx.org.id);
  const coins = Object.fromEntries(Object.entries(result.input.coins ?? {}).filter(([, v]) => pos(v)));
  if (!Object.keys(coins).length && prev && Object.keys(prev.coins ?? {}).length) {
    result.input.coins = prev.coins;
    result.warnings.push("قیمت سکه‌ها از آخرین نرخ ثبت‌شده برداشته شد");
  }
  const normalized = normalizeRate(result.input, ctx.org.money_decimals);
  if (opts.save === false) return { rate: { ...normalized, source: result.source, at: new Date().toISOString() }, saved: false, warnings: result.warnings, errors };
  const rate = await addRate(ctx, { ...result.input, source: result.source, note: errors.length ? `پس از خطای ${errors.length} منبع دیگر` : null });
  return { rate, saved: true, warnings: result.warnings, errors };
}
