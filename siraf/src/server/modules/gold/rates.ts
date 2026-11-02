// Daily price board (تابلوی قیمت): manual entry (mazaneh ↔ gram18), history, the latest rate
// and live prices from the internet:
//   tgju      — unofficial JSON of tgju.org (Iranian market, prices in rial)
//   goldapi   — world ounce in USD (api.gold-api.com) × the free-market dollar → gram18
//   custom    — any JSON URL with JSON paths of the fields (settings.gold.price_source)
// From abroad Iranian sites may be blocked and vice versa, so "auto" tries them in turn.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { insertRow } from "../../db/sql";
import { AppError, bad, notFound } from "../../http/errors";
import { D, isNumeric, normalizeDigits, type Num } from "@shared/money";
import { coinBubble, gram18FromOunce, mazanehFromGram18, gram18FromMazaneh, TROY_OUNCE_GRAMS } from "@shared/gold";
import { RATE_KEY_RE, TGJU_BUBBLE, TGJU_RETAIL, TGJU_SELL, parsianSut } from "@shared/gold-catalogue";
import { faDigits } from "@shared/format";
import { uuidv7 } from "@shared/id";
import { goldSettings, type CustomSource, type LiveProvider } from "./settings";

export interface RateRow {
  id: string;
  at: string;
  mazaneh: string | null;
  gram18: string | null;
  gram24: string | null;
  ounce_usd: string | null;
  usd: string | null;
  buy_gram18: string | null;
  /** sell prices per board key */
  coins: Record<string, string>;
  /** buy prices per board key */
  coins_buy: Record<string, string>;
  /** bubble of every board coin at the time of the rate, percent on both bases */
  bubbles: Record<string, RateBubble>;
  meta: RateMeta;
  source: string;
  note: string | null;
}

export interface RateBubble {
  domestic: string | null;
  world: string | null;
  domestic_amount: string | null;
  world_amount: string | null;
}

export interface RateMeta {
  /** retail (تک‌فروشی) sell prices of the source */
  retail?: Record<string, string>;
  /** the source's own bubble figures (percent) */
  provider_bubble?: Record<string, string>;
  /** keys whose price at the source was older than the staleness limit */
  stale?: string[];
  /** keys the source did not deliver, carried over from the previous rate */
  carried?: string[];
  /** fields further than the deviation limit from the previous rate (confirmed by the user) */
  deviations?: string[];
}

const COLS = "id, at, mazaneh, gram18, gram24, ounce_usd, usd, buy_gram18, coins, coins_buy, bubbles, meta, source, note";

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
  coins_buy?: Record<string, Num> | null;
  meta?: RateMeta | null;
  note?: string | null;
  source?: string;
  /** a manual price far from the previous one is saved only when confirmed */
  confirm?: boolean | null;
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
  const prices = (src: Record<string, Num> | null | undefined) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(src ?? {})) {
      const d = pos(v);
      if (d && RATE_KEY_RE.test(k)) out[k] = d.toDecimalPlaces(moneyDp).toString();
    }
    return out;
  };
  const coins = prices(input.coins);
  const coins_buy = prices(input.coins_buy);
  return {
    mazaneh: mazaneh.toDecimalPlaces(moneyDp).toString(),
    gram18: gram18.toDecimalPlaces(moneyDp).toString(),
    gram24: gram24.toDecimalPlaces(moneyDp).toString(),
    ounce_usd: pos(input.ounce_usd)?.toString() ?? null,
    usd: pos(input.usd)?.toString() ?? null,
    buy_gram18: pos(input.buy_gram18)?.toDecimalPlaces(moneyDp).toString() ?? null,
    coins,
    coins_buy,
  };
}

type NormalRate = ReturnType<typeof normalizeRate>;

/** Board coins of the catalogue (key, gold content) for bubbles. */
export async function boardCoins(q: Queryable, orgId: string) {
  return q.query<{ rate_key: string; name: string; gold_weight: string | null; fineness: string | null; kind: string }>(
    `select rate_key, name, gold_weight, fineness, kind from tz_items
     where org_id = $1 and kind in ('coin', 'bar') and rate_key is not null and deleted_at is null`,
    [orgId],
  );
}

/** Bubble of every coin with a price on the board, on both bases (percent and amount). */
export function bubblesOf(r: Pick<NormalRate, "gram18" | "ounce_usd" | "usd" | "coins">, coins: { rate_key: string; gold_weight: string | null; fineness: string | null; kind: string }[]) {
  const out: Record<string, RateBubble> = {};
  for (const c of coins) {
    const price = r.coins[c.rate_key];
    if (c.kind !== "coin" || !price || !pos(c.gold_weight)) continue;
    const b = coinBubble({ weight: c.gold_weight!, fineness: c.fineness ?? 900 }, price, { gram18: r.gram18, ounce_usd: r.ounce_usd, usd: r.usd });
    out[c.rate_key] = { domestic: b.domestic?.pct ?? null, world: b.world?.pct ?? null, domestic_amount: b.domestic?.amount ?? null, world_amount: b.world?.amount ?? null };
  }
  return out;
}

/** Fields of a new rate further than `pct` percent from the previous rate. */
export function deviations(r: Pick<NormalRate, "gram18" | "coins" | "coins_buy">, prev: RateRow | null, pct: Num): string[] {
  if (!prev) return [];
  const limit = D(pct || 0);
  if (limit.lte(0)) return [];
  const far = (a: Num, b: Num) => !!pos(a) && !!pos(b) && D(a).minus(D(b)).abs().div(D(b)).times(100).gt(limit);
  const out: string[] = [];
  if (far(r.gram18, prev.gram18)) out.push("gram18");
  for (const [k, v] of Object.entries(r.coins)) if (far(v, prev.coins?.[k])) out.push(k);
  for (const [k, v] of Object.entries(r.coins_buy)) if (far(v, prev.coins_buy?.[k])) out.push(`buy:${k}`);
  return out;
}

export async function addRate(ctx: Ctx, input: RateInput): Promise<RateRow> {
  ctx.need("gold", "edit");
  const r = normalizeRate(input, ctx.org.money_decimals);
  const at = input.at && !Number.isNaN(new Date(input.at).getTime()) ? new Date(input.at).toISOString() : new Date().toISOString();
  const source = input.source ?? "manual";
  const [prev, coins] = await Promise.all([latestRate(ctx.db, ctx.org.id), boardCoins(ctx.db, ctx.org.id)]);
  const meta: RateMeta = { ...(input.meta ?? {}) };
  if (source === "manual") {
    const far = deviations(r, prev, goldSettings(ctx.org).deviation_pct);
    if (far.length && !input.confirm) {
      const names = new Map(coins.map((c) => [c.rate_key, c.name]));
      const label = (k: string) => (k === "gram18" ? "گرم ۱۸ عیار" : k.startsWith("buy:") ? `خرید ${names.get(k.slice(4)) ?? k.slice(4)}` : names.get(k) ?? k);
      throw new AppError(
        409,
        "rate_deviation",
        `قیمت ${far.map(label).join("، ")} بیش از ${faDigits(goldSettings(ctx.org).deviation_pct)}٪ با قیمت قبلی فرق دارد؛ اگر درست است ثبت را تأیید کنید`,
        { fields: far },
      );
    }
    if (far.length) meta.deviations = far;
  }
  return ctx.write((tx) =>
    insertRow<RateRow>(tx, "tz_gold_rates", {
      id: uuidv7(), org_id: ctx.org.id, at, ...r, bubbles: bubblesOf(r, coins), meta, source, note: input.note?.trim() || null, origin: ctx.cfg.origin,
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

/** IPv4 dotted quad of an IPv4-mapped / -compatible / NAT64 IPv6 literal (::ffff:7f00:1 → 127.0.0.1). */
function embeddedIpv4(h: string): string | null {
  const m = /^(?:(?:0{1,4}:){0,5}(?:ffff:)?|64:ff9b::|::(?:ffff:)?)(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h);
  if (!m) return null;
  if (m[1]) return m[1];
  const a = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

function privateIpv4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h.includes(":")) {
    // IPv6 literal (the URL parser has already normalised it)
    if (h === "::" || h === "::1") return true;
    if (/^(fc|fd|fe[89ab])/.test(h)) return true;
    const v4 = embeddedIpv4(h);
    return v4 ? privateIpv4(v4) : false;
  }
  return privateIpv4(h);
}

/** Only public http(s) addresses (no loopback/private networks) unless running on the desktop. */
export function checkUrl(raw: string, desktop: boolean): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad("نشانی منبع قیمت معتبر نیست");
  }
  if (u.protocol !== "https:" && !(desktop && u.protocol === "http:")) throw bad("نشانی منبع قیمت باید با https شروع شود");
  if (!desktop && privateHost(u.hostname)) throw bad("منبع قیمت باید نشانی عمومی اینترنتی باشد");
  return u;
}

async function getJson(ctx: Ctx, url: string, timeoutMs = 10_000): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const desktop = ctx.cfg.mode === "desktop";
  try {
    // redirects are followed by hand so that every hop passes the same address check
    let target = url;
    let res: Response | null = null;
    for (let hop = 0; ; hop++) {
      res = await ctx.cfg.fetch(target, {
        signal: ac.signal, redirect: "manual", headers: { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 (Siraf accounting)" },
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      if (!loc || hop >= 3) throw new SourceError("تغییر مسیر بیش از حد یا نامعتبر");
      let next: URL;
      try {
        next = checkUrl(new URL(loc, target).toString(), desktop);
      } catch {
        throw new SourceError("به نشانی غیرمجاز تغییر مسیر داد");
      }
      target = next.toString();
    }
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

/** Time of a tgju row («ts»: Tehran local time) — null when the row has none. */
function tgjuTime(v: unknown): number | null {
  if (!v || typeof v !== "object") return null;
  const ts = (v as Record<string, unknown>).ts;
  if (typeof ts !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(ts)) return null;
  const t = Date.parse(`${ts.replace(" ", "T").slice(0, 19)}+03:30`);
  return Number.isNaN(t) ? null : t;
}

async function fromTgju(ctx: Ctx): Promise<LiveResult> {
  const data = (await getJson(ctx, "https://call1.tgju.org/ajax.json")) as Record<string, unknown>;
  const cur = (data && typeof data === "object" && data.current && typeof data.current === "object" ? data.current : data) as Record<string, unknown>;
  const get = (k: string) => toBase(ctx, priceOf(cur?.[k]), "rial");
  const gram18 = get("geram18");
  const mazaneh = get("mesghal");
  if (!gram18 && !mazaneh) throw new SourceError("قیمت گرم ۱۸ در پاسخ نبود");
  const ons = priceOf(cur?.ons);
  // every catalogue key the feed carries: the standard rows, Parsian rows and each coin's own tgju key
  const catalogue = await ctx.db.query<{ rate_key: string; tgju: string | null; sut: number | null }>(
    `select rate_key, gold_meta->>'tgju' as tgju, (gold_meta->>'sut')::int as sut from tz_items
     where org_id = $1 and kind = 'coin' and rate_key is not null and deleted_at is null`,
    [ctx.org.id],
  );
  const map: Record<string, string> = { ...TGJU_SELL };
  for (const c of catalogue) if (c.tgju) map[c.tgju] = c.rate_key;
  const bySut = new Map(catalogue.filter((c) => c.sut).map((c) => [c.sut!, c.rate_key]));
  for (const k of Object.keys(cur ?? {})) {
    const sut = parsianSut(k);
    if (sut && bySut.has(sut) && !map[k]) map[k] = bySut.get(sut)!;
  }
  const staleMs = goldSettings(ctx.org).stale_minutes * 60_000;
  const now = Date.now();
  const coins: Record<string, string> = {};
  const stale: string[] = [];
  for (const [src, key] of Object.entries(map)) {
    const v = get(src);
    if (!v) continue;
    coins[key] = v.toString();
    const t = tgjuTime(cur?.[src]);
    if (t !== null && now - t > staleMs) stale.push(key);
  }
  const retail: Record<string, string> = {};
  for (const [src, key] of Object.entries(TGJU_RETAIL)) {
    const v = get(src);
    if (v) retail[key] = v.toString();
  }
  const provider_bubble: Record<string, string> = {};
  for (const [src, key] of Object.entries(TGJU_BUBBLE)) {
    const v = priceOf(cur?.[src]);
    if (v) provider_bubble[key] = v.toString();
  }
  const t18 = tgjuTime(cur?.geram18);
  if (t18 !== null && now - t18 > staleMs) stale.push("gram18");
  return {
    source: "tgju",
    warnings: stale.length ? [`قیمت ${faDigits(stale.length)} مورد در منبع قدیمی است`] : [],
    input: {
      gram18: gram18?.toString(), mazaneh: mazaneh?.toString(), gram24: get("geram24")?.toString(),
      ounce_usd: ons?.toString(), usd: get("price_dollar_rl")?.toString(), coins,
      meta: { retail, provider_bubble, stale },
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
  const get = (f: string) => (src.paths[f] ? priceOf(pickPath(data, src.paths[f]!)) : null);
  const money = (f: string) => toBase(ctx, get(f), unit);
  const gram18 = money("gram18");
  const mazaneh = money("mazaneh");
  if (!gram18 && !mazaneh) throw new SourceError("در مسیرهای تعیین‌شده قیمتی پیدا نشد");
  return {
    source: "custom",
    warnings: [],
    input: {
      gram18: gram18?.toString(), mazaneh: mazaneh?.toString(), gram24: money("gram24")?.toString(), buy_gram18: money("buy_gram18")?.toString(),
      ounce_usd: get("ounce_usd")?.toString(), usd: money("usd")?.toString(),
      coins: Object.fromEntries(Object.keys(src.paths).filter((k) => RATE_KEY_RE.test(k) && !isMarketField(k)).map((k) => [k, money(k)?.toString()])),
      coins_buy: Object.fromEntries(Object.keys(src.paths).filter((k) => k.startsWith("buy:")).map((k) => [k.slice(4), money(k)?.toString()])),
    },
  };
}

const isMarketField = (k: string) => ["gram18", "mazaneh", "gram24", "ounce_usd", "usd", "buy_gram18"].includes(k);

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
  // keys the source did not deliver (the world-ounce provider has no coins) keep their last price, marked as carried
  const prev = await latestRate(ctx.db, ctx.org.id);
  const coins = Object.fromEntries(Object.entries(result.input.coins ?? {}).filter(([, v]) => pos(v)));
  const carried = Object.keys(prev?.coins ?? {}).filter((k) => !(k in coins));
  if (prev && carried.length) {
    result.input.coins = { ...Object.fromEntries(carried.map((k) => [k, prev.coins[k]])), ...coins };
    if (!Object.keys(coins).length) result.warnings.push("قیمت سکه‌ها از آخرین نرخ ثبت‌شده برداشته شد");
  }
  const buy = Object.fromEntries(Object.entries(result.input.coins_buy ?? {}).filter(([, v]) => pos(v)));
  const buyCarried = Object.keys(prev?.coins_buy ?? {}).filter((k) => !(k in buy));
  if (prev && buyCarried.length) result.input.coins_buy = { ...Object.fromEntries(buyCarried.map((k) => [k, prev.coins_buy[k]])), ...buy };
  const meta: RateMeta = { ...(result.input.meta ?? {}) };
  if (prev && carried.length) meta.carried = carried;
  meta.stale = [...new Set([...(meta.stale ?? []), ...carried])];
  result.input.meta = meta;
  const normalized = normalizeRate(result.input, ctx.org.money_decimals);
  if (opts.save === false) {
    const bubbles = bubblesOf(normalized, await boardCoins(ctx.db, ctx.org.id));
    return { rate: { ...normalized, bubbles, meta, source: result.source, at: new Date().toISOString() }, saved: false, warnings: result.warnings, errors };
  }
  const rate = await addRate(ctx, { ...result.input, source: result.source, note: errors.length ? `پس از خطای ${errors.length} منبع دیگر` : null });
  return { rate, saved: true, warnings: result.warnings, errors };
}
