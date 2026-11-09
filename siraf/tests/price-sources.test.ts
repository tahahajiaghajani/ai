// Live prices that work from both runtimes. The tgju feed comes from its copy abroad on the web and
// its copy in Iran on the Windows app, falling back to the other copy. It feeds the gold board and,
// for rial and toman businesses, the exchange board: the free-market dollar and currencies in rial.
// Its tether row barely moves and sits under the exchanges, so crypto keeps its exchange prices ×
// the dollar. Nobitex is asked on its current host.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { D } from "@shared/money";
import { SYNC_PROTOCOL } from "@shared/constants";
import { TGJU_FEED_ABROAD, TGJU_FEED_IRAN, tgjuFeedAnswered, tgjuFeedUrls, tgjuKeyOf, tgjuPrice } from "@server/modules/fx/tgju";
import { cleanSourceKey, cleanSourceLabel, cleanSourceLink, headerNameProblem, keyedUrlProblem, needsKey, sourceKeyProblem, sourceOrigin } from "@shared/price-source";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
/** «ts» of a tgju row: Tehran time, `ago` milliseconds back. */
const tehran = (ago = 0) => new Date(Date.now() - ago + 3.5 * 3600_000).toISOString().replace("T", " ").slice(0, 19);

function feed() {
  const now = tehran();
  return {
    current: {
      price_dollar_rl: { p: "2,745,000", ts: now },
      price_eur: { p: "3,081,600", ts: now },
      price_aed: { p: "751,340", ts: tehran(5 * 24 * 3600_000) }, // five days old: not used
      price_jpy: { p: "1,742,030", ts: now }, // per 100 yen
      "crypto-tether-irr": { p: "2,693,980", ts: now },
      "crypto-bitcoin-irr": { p: "206,205,676,000", ts: now },
      geram18: { p: "256,641,000", ts: now },
      mesghal: { p: "1,111,740,000", ts: now },
      geram24: { p: "342,185,000", ts: now },
      sekee: { p: "2,622,400,000", ts: now },
      ons: { p: "3,898.05", ts: now },
    },
  };
}

function market(url: string): Response | null {
  if (url.startsWith("https://open.er-api.com/")) return json({ result: "success", rates: { USD: 1, EUR: 0.86, AED: 3.6725, JPY: 157.6 } });
  if (url.startsWith("https://api.kucoin.com/")) return json({ code: "200000", data: { ticker: [{ symbol: "ETH-USDT", last: "2300", changeRate: "0.01" }, { symbol: "BTC-USDT", last: "76548.25", changeRate: "0" }] } });
  return null;
}

const eq = (a: unknown, b: string | number) => expect(D(a as string).toFixed()).toBe(D(b).toFixed());

describe("tgju feed: which copy, which key", () => {
  it("asks the copy abroad first on the web and the copy in Iran first on Windows, then the one that answered", () => {
    const f = (async () => new Response("")) as unknown as typeof fetch;
    expect(tgjuFeedUrls(f, false)).toEqual([TGJU_FEED_ABROAD, TGJU_FEED_IRAN]);
    expect(tgjuFeedUrls(f, true)).toEqual([TGJU_FEED_IRAN, TGJU_FEED_ABROAD]);
    tgjuFeedAnswered(f, TGJU_FEED_IRAN);
    expect(tgjuFeedUrls(f, false)).toEqual([TGJU_FEED_IRAN, TGJU_FEED_ABROAD]);
  });

  it("maps currencies to tgju keys and reads its prices", () => {
    expect(tgjuKeyOf("USD", "fiat")).toEqual({ key: "price_dollar_rl", units: 1 });
    expect(tgjuKeyOf("eur", "fiat")).toEqual({ key: "price_eur", units: 1 });
    expect(tgjuKeyOf("JPY", "fiat")).toEqual({ key: "price_jpy", units: 100 });
    // the feed's tether and crypto rows are derived and lag the exchanges: never used on their own
    expect(tgjuKeyOf("USDT", "crypto")).toBeNull();
    expect(tgjuKeyOf("BTC", "crypto")).toBeNull();
    expect(tgjuKeyOf("USDT", "crypto", "crypto-tether-irr")).toEqual({ key: "crypto-tether-irr", units: 1 });
    expect(tgjuKeyOf("XAU", "metal")).toBeNull();
    expect(tgjuKeyOf("IRT", "fiat")).toBeNull();
    expect(tgjuKeyOf("USD", "fiat", "price_dollar_dt")).toEqual({ key: "price_dollar_dt", units: 1 });
    expect(tgjuPrice({ p: "2,745,000" })).toBe("2745000");
    expect(tgjuPrice({ p: "۲٬۷۴۵٬۰۰۰" })).toBe("2745000");
    expect(tgjuPrice({ p: "3,898.05" })).toBe("3898.05");
    expect(tgjuPrice({ p: "-" })).toBeNull();
    expect(tgjuPrice({ p: "0" })).toBeNull();
  });
});

describe("prices on the web version (rial business)", () => {
  let c: Client;
  let org: string;
  const urls: string[] = [];
  const cloudFetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    if (url === TGJU_FEED_ABROAD) return json(feed());
    if (url === TGJU_FEED_IRAN) throw new TypeError("fetch failed"); // resets connections from abroad
    return market(url) ?? new Response("not stubbed", { status: 404 });
  }) as typeof fetch;

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: cloudFetch } });
    c = new Client(s.app);
    org = await signupWithOrg(c);
  });

  it("fills the exchange board from tgju without any setup: the dollar and currencies in rial", async () => {
    const r = await c.post(`/o/${org}/fx/rates/refresh`, {});
    expect(r.usd_source).toBe("tgju");
    eq(r.usd_rate, 2_745_000);
    const board = await c.get(`/o/${org}/fx/rates`);
    const rate = (code: string) => board.currencies.find((x: { code: string }) => x.code === code).rate;
    eq(rate("USD").mid, 2_745_000);
    expect(rate("USD").source).toBe("tgju");
    eq(rate("EUR").mid, 3_081_600);
    expect(rate("EUR").source).toBe("tgju");
    eq(rate("JPY").mid, 17_420); // 1,742,030 per 100 yen
    // crypto: the exchange's dollar price × the free-market dollar, not tgju's lagging tether row
    expect(rate("USDT").source).not.toBe("tgju");
    expect(rate("BTC").source).toBe("kucoin");
    eq(rate("BTC").mid, D("76548.25").times(2_745_000).toDecimalPlaces(0).toFixed());
    // a row five days old is skipped: the official cross with the free-market dollar instead
    expect(rate("AED").source).toBe("open_er");
    eq(rate("AED").mid, D(2_745_000).div(3.6725).toDecimalPlaces(0).toFixed());
    // not in tgju: the dollar price of the exchange × the free-market dollar
    expect(rate("ETH").source).toBe("kucoin");
    eq(rate("ETH").mid, 2300 * 2_745_000);
    expect(urls.filter((u) => u === TGJU_FEED_ABROAD)).toHaveLength(1);
    expect(urls).not.toContain(TGJU_FEED_IRAN);
  });

  it("fetches the gold board from tgju's copy abroad", async () => {
    const r = await c.post(`/o/${org}/gold/rates/fetch`, { provider: "tgju", save: false });
    expect(r.rate.source).toBe("tgju");
    expect(r.rate.gram18).toBe("256641000");
    expect(r.rate.mazaneh).toBe("1111740000");
    expect(r.rate.coins.emami).toBe("2622400000");
    expect(r.rate.ounce_usd).toBe("3898.05");
    expect(r.rate.usd).toBe("2745000");
    expect(urls).not.toContain(TGJU_FEED_IRAN);
  });
});

describe("prices when one copy of tgju does not answer", () => {
  it("uses the other copy and asks it first the next time", async () => {
    const urls: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      if (url === TGJU_FEED_ABROAD) return new Response("bad gateway", { status: 502 });
      if (url === TGJU_FEED_IRAN) return json(feed());
      return new Response("not stubbed", { status: 404 });
    }) as typeof fetch;
    const s = await makeServer({ config: { fetch: f } });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    const first = await c.post(`/o/${org}/gold/rates/fetch`, { provider: "tgju", save: false });
    expect(first.rate.gram18).toBe("256641000");
    expect(urls).toEqual([TGJU_FEED_ABROAD, TGJU_FEED_IRAN]);
    urls.length = 0;
    await c.post(`/o/${org}/gold/rates/fetch`, { provider: "tgju", save: false });
    expect(urls).toEqual([TGJU_FEED_IRAN]);
  });

  it("names both copies when neither answers", async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("tgju.org")) throw new TypeError("fetch failed");
      return new Response("not stubbed", { status: 404 });
    }) as typeof fetch;
    const s = await makeServer({ config: { fetch: f } });
    const c = new Client(s.app);
    await c.post("/auth/signup", { email: "both@example.com", password: "s3cret-pass", full_name: "طلافروش" });
    const org = (await c.post<{ id: string }>("/orgs", { name: "طلافروشی", business_kind: "gold", modules: ["gold"], base_currency: "IRR", fiscal_year: 1405 })).id;
    const err = await c.post(`/o/${org}/gold/rates/fetch`, { provider: "tgju", save: false }, 400);
    expect(err.error.message).toContain("call.tgju.org");
    expect(err.error.message).toContain("call1.tgju.org");
  });
});

describe("prices on the Windows app (toman business)", () => {
  let c: Client;
  let org: string;
  const urls: string[] = [];
  const iranFetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    if (url === TGJU_FEED_IRAN) return json(feed());
    if (url === TGJU_FEED_ABROAD) throw new TypeError("fetch failed"); // filtered
    if (url.startsWith("https://apiv2.nobitex.ir/market/stats")) {
      return json({ status: "ok", stats: { "btc-rls": { isClosed: false, latest: "206000000000" }, "usdt-rls": { isClosed: false, latest: "2690000" } } });
    }
    return market(url) ?? new Response("not stubbed", { status: 404 });
  }) as typeof fetch;

  beforeAll(async () => {
    const s = await makeServer({ mode: "desktop", config: { fetch: iranFetch } });
    c = new Client(s.app);
    await c.post("/auth/signup", { email: "desk@example.com", password: "s3cret-pass", full_name: "صراف" });
    org = (await c.post<{ id: string }>("/orgs", { name: "صرافی", business_kind: "exchange", modules: ["fx", "gold"], base_currency: "IRT", fiscal_year: 1405 })).id;
  });

  it("asks the copy in Iran, converts rial to toman and follows the order of the sources", async () => {
    // Nobitex before tgju: crypto from Nobitex, currencies and the dollar from tgju
    await c.put(`/o/${org}/fx/settings`, { providers: ["nobitex", "tgju", "kucoin", "open_er"] });
    const r = await c.post(`/o/${org}/fx/rates/refresh`, {});
    expect(r.usd_source).toBe("tgju");
    eq(r.usd_rate, 274_500);
    const board = await c.get(`/o/${org}/fx/rates`);
    const rate = (code: string) => board.currencies.find((x: { code: string }) => x.code === code).rate;
    eq(rate("EUR").mid, 308_160);
    eq(rate("JPY").mid, 1742); // 1,742,030 rial per 100 yen → 1,742.03 toman per yen
    expect(rate("BTC").source).toBe("nobitex");
    eq(rate("BTC").mid, 20_600_000_000);
    expect(rate("USDT").source).toBe("nobitex");
    expect(urls[0]).toBe(TGJU_FEED_IRAN);
    expect(urls).not.toContain(TGJU_FEED_ABROAD);
    const gold = await c.post(`/o/${org}/gold/rates/fetch`, { provider: "tgju", save: false });
    expect(gold.rate.gram18).toBe("25664100");
  });
});

// ---------------------------------------------------------------- a source that takes its key in a header (EZRate)

describe("where a custom source's key may go", () => {
  it("rides only in a header that is a plain token and does not frame or route the request", () => {
    for (const ok of ["X-API-Key", "Authorization", "apikey", "X_Key"]) expect(headerNameProblem(ok)).toBeNull();
    for (const no of ["Host", "cookie", "Content-Type", "content-length", "Transfer-Encoding", "Connection", "Proxy-Authorization", "TE", "Upgrade"]) {
      expect(headerNameProblem(no)).toContain("مجاز نیست");
    }
    expect(headerNameProblem("X-API-Key\r\nX-Injected: 1")).toContain("شکست خط");
    expect(headerNameProblem("X-Key\n")).toContain("شکست خط");
    expect(headerNameProblem("X API Key")).toContain("معتبر نیست");
    expect(headerNameProblem("کلید")).toContain("معتبر نیست");
  });

  it("takes {key} only in the path or the query of an https address, and belongs to that address's origin", () => {
    expect(keyedUrlProblem("https://api.navasan.tech/latest/?api_key={key}")).toBeNull();
    expect(keyedUrlProblem("https://api.example.com/{key}/rates")).toBeNull();
    for (const no of ["https://{key}.example.com/x", "https://api{key}.com/x", "https://{key}@example.com/x", "https://example.com:{key}/x", "https://example.com/x#{key}"]) {
      expect(keyedUrlProblem(no), no).not.toBeNull();
    }
    expect(keyedUrlProblem("http://api.example.com/?k={key}")).toContain("https");
    expect(sourceOrigin("https://API.EZRate.me:443/v1/rates?symbols=usd&k={key}")).toBe("https://api.ezrate.me");
    expect(needsKey({ url: "https://api.ezrate.me/v1", header: "X-API-Key" })).toBe(true);
    expect(needsKey({ url: "https://api.navasan.tech/latest/?api_key={key}" })).toBe(true);
    expect(needsKey({ url: "https://api.exir.io/v2/ticker", header: " " })).toBe(false);
  });

  it("cleans a pasted key and the name and link a source shows", () => {
    expect(cleanSourceKey(" Bearer\u200f ezr_live_abcd1234\r\n")).toBe("Bearer ezr_live_abcd1234");
    expect(sourceKeyProblem("short")).toContain("کوتاه");
    expect(sourceKeyProblem("کلید فارسی بلندتر از هشت")).toContain("لاتین");
    expect(cleanSourceLabel("  EZ\u202eRate\n ")).toBe("EZ Rate");
    expect(cleanSourceLink("https://ezrate.me/fa")).toBe("https://ezrate.me/fa");
    for (const no of ["javascript:alert(1)", "http://ezrate.me", "https://user:pass@ezrate.me", "ezrate.me"]) expect(cleanSourceLink(no), no).toBeNull();
  });
});

// EZRate (ezrate.me): free plan, key only in the X-API-Key header (or Authorization: Bearer); query keys are refused.
const EZ_KEY = "ezr_live_9fK2mQ7xVt4LpZ8aWcN3abcd";
const EZ_URL = "https://api.ezrate.me/v1/rates?symbols=usd,eur,aed,g18,g24,mesghal,ounce,emami,nim&quote=IRR";
const EZ_ORIGIN = "https://api.ezrate.me";
const EZ_LINK = "https://ezrate.me/fa";

function ezrate() {
  const row = (symbol: string, buy: number, sell: number, usd: number | null = null) => ({ symbol, buy, sell, usd, change: 0, updated_at: new Date().toISOString() });
  return {
    data: [
      row("usd", 2_740_000, 2_745_000),
      row("eur", 3_075_000, 3_081_600, 1.1226),
      row("aed", 746_000, 751_340, 0.2737),
      row("g18", 255_900_000, 256_641_000),
      row("g24", 341_200_000, 342_185_000),
      row("mesghal", 1_108_500_000, 1_111_740_000),
      row("ounce", 10_680_000_000, 10_700_000_000, 3898.05),
      row("emami", 2_600_000_000, 2_622_400_000),
      row("nim", 1_400_000_000, 1_420_000_000),
    ],
    meta: { quote: "IRR", plan: "free", freshness_minutes: 30 },
  };
}

/** The EZRate stub: answers only with the key in a header, and records every request to it. */
function ezrateServer() {
  const asked: { url: string; key: string | null }[] = [];
  const handle = (url: string, init?: RequestInit): Response | null => {
    if (!url.startsWith(`${EZ_ORIGIN}/`)) return null;
    const h = new Headers(init?.headers);
    const key = h.get("x-api-key") ?? h.get("authorization")?.replace(/^Bearer /, "") ?? null;
    asked.push({ url, key });
    if ([...new URL(url).searchParams.keys()].some((k) => /key/i.test(k))) return json({ error: "API keys in query parameters are refused" }, 400);
    if (key !== EZ_KEY) return json({ error: "invalid API key" }, 401);
    return json(ezrate());
  };
  return { asked, handle };
}

/** A client that keeps every answer it reads, to show that a key never comes back. */
class Recorder extends Client {
  seen: string[] = [];
  override async req<T = any>(method: string, path: string, body?: unknown, expect = 200): Promise<T> {
    const r = await super.req<T>(method, path, body, expect);
    this.seen.push(JSON.stringify(r));
    return r;
  }
}

const GOLD_PATHS = {
  gram18: "data[symbol=g18].sell",
  buy_gram18: "data[symbol=g18].buy",
  gram24: "data[symbol=g24].sell",
  mazaneh: "data[symbol=mesghal].sell",
  ounce_usd: "data[symbol=ounce].usd",
  usd: "data[symbol=usd].sell",
  emami: "data[symbol=emami].sell",
  "buy:emami": "data[symbol=emami].buy",
  nim: "data[symbol=nim].sell",
};

describe("custom sources with a key in a header (EZRate) on the web version", () => {
  let c: Recorder;
  let org: string;
  let db: import("@server/db").Db;
  const ez = ezrateServer();
  const other: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = ez.handle(url, init);
    if (r) return r;
    other.push(url);
    return new Response("not stubbed", { status: 404 });
  }) as typeof fetch;

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: f, secretSource: "env" } });
    db = s.db;
    c = new Recorder(s.app);
    org = await signupWithOrg(c);
  });

  it("feeds the gold board through the header key, and names the source next to its prices", async () => {
    const saved = await c.put(`/o/${org}/gold/settings`, {
      provider: "custom",
      price_source: { url: EZ_URL, unit: "rial", header: "X-API-Key", key: EZ_KEY, label: "EZRate", link: EZ_LINK, paths: GOLD_PATHS },
    });
    expect(saved.settings.price_source).toMatchObject({ url: EZ_URL, header: "X-API-Key", label: "EZRate", link: EZ_LINK });
    expect(saved.price_key).toEqual({ origin: EZ_ORIGIN, hint: "…abcd", unreadable: false });

    const r = await c.post(`/o/${org}/gold/rates/fetch`, { provider: "custom" });
    expect(r.saved).toBe(true);
    expect(r.rate.source).toBe("custom");
    expect(r.rate.gram18).toBe("256641000");
    expect(r.rate.buy_gram18).toBe("255900000");
    expect(r.rate.gram24).toBe("342185000");
    expect(r.rate.mazaneh).toBe("1111740000");
    expect(r.rate.ounce_usd).toBe("3898.05");
    expect(r.rate.usd).toBe("2745000");
    expect(r.rate.coins.emami).toBe("2622400000");
    expect(r.rate.coins_buy.emami).toBe("2600000000");
    expect(r.rate.coins.nim).toBe("1420000000");
    expect(r.rate.meta).toMatchObject({ source_label: "EZRate", source_link: EZ_LINK });
    // the history and the latest rate keep the attribution of the rate
    const latest = await c.get(`/o/${org}/gold/rates/latest`);
    expect(latest.rate.meta.source_label).toBe("EZRate");
    // asked once, with the key in its header and nothing in the URL
    expect(ez.asked).toEqual([{ url: EZ_URL, key: EZ_KEY }]);
  });

  it("feeds the exchange board through the same kind of key: one key and one request for every row of the service", async () => {
    const custom = [
      { code: "USD", path: "data[symbol=usd].sell" },
      { code: "EUR", path: "data[symbol=eur].sell" },
      { code: "AED", path: "data[symbol=aed].sell" },
    ].map((x) => ({ ...x, url: EZ_URL, unit: "base", header: "X-API-Key", label: "EZRate", link: EZ_LINK }));
    const saved = await c.put(`/o/${org}/fx/settings`, { providers: ["custom"], margin_pct: "0", custom, keys: [{ origin: EZ_ORIGIN, key: EZ_KEY }] });
    expect(saved.keys).toEqual([{ origin: EZ_ORIGIN, hint: "…abcd", unreadable: false }]);
    expect(saved.settings.custom[0]).toMatchObject({ code: "USD", url: EZ_URL, header: "X-API-Key", label: "EZRate", link: EZ_LINK });

    ez.asked.length = 0;
    const r = await c.post(`/o/${org}/fx/rates/refresh`, {});
    expect(r.usd_source).toBe("custom");
    eq(r.usd_rate, 2_745_000);
    expect(r.usd_label).toEqual({ source_label: "EZRate", source_link: EZ_LINK });
    const board = await c.get(`/o/${org}/fx/rates`);
    const rate = (code: string) => board.currencies.find((x: { code: string }) => x.code === code).rate;
    eq(rate("USD").mid, 2_745_000);
    eq(rate("EUR").mid, 3_081_600);
    eq(rate("AED").mid, 751_340);
    for (const code of ["USD", "EUR", "AED"]) expect(rate(code)).toMatchObject({ source: "custom", source_label: "EZRate", source_link: EZ_LINK });
    // the rows share one answer: same address, same header, same key
    expect(ez.asked).toEqual([{ url: EZ_URL, key: EZ_KEY }]);
  });

  it("never returns the key, and never puts it in the settings that sync", async () => {
    await c.get(`/o/${org}/gold/settings`);
    await c.get(`/o/${org}/fx/settings`);
    await c.get(`/o/${org}`); // the business with its settings (the owner sees the sources' URLs)
    const pull = await c.get(`/sync/pull?org_id=${org}&cursor=0&user_cursor=0`);
    // the synced settings carry the header's name, not the key
    expect(JSON.stringify(pull)).toContain("X-API-Key");
    for (const answer of c.seen) expect(answer).not.toContain(EZ_KEY);
    const settings = await db.one<{ s: string }>(`select settings::text as s from tz_orgs where id = $1`, [org]);
    expect(settings!.s).toContain("X-API-Key");
    expect(settings!.s).not.toContain(EZ_KEY);
    // the key itself: one row per board for the service's origin, sealed with this runtime's secret
    const keys = await db.query<{ board: string; origin: string; secret_enc: string; key_hint: string }>(`select board, origin, secret_enc, key_hint from tz_price_keys where org_id = $1 order by board`, [org]);
    expect(keys.map((k) => [k.board, k.origin, k.key_hint])).toEqual([["fx", EZ_ORIGIN, "…abcd"], ["gold", EZ_ORIGIN, "…abcd"]]);
    for (const k of keys) {
      expect(k.secret_enc.startsWith("v2.")).toBe(true);
      expect(k.secret_enc).not.toContain(EZ_KEY);
    }
    const events = await db.query<{ data: { origin: string; action: string; key_hint: string } }>(`select data from tz_security_events where kind = 'price_key' and org_id = $1`, [org]);
    expect(events.map((e) => [e.data.origin, e.data.action, e.data.key_hint])).toEqual([[EZ_ORIGIN, "added", "…abcd"], [EZ_ORIGIN, "added", "…abcd"]]);
    expect(JSON.stringify(events)).not.toContain(EZ_KEY);
  });

  it("sends the key to its own origin only: a source moved elsewhere is not asked with it", async () => {
    // settings written around the dialog (a sync from the other runtime, unchecked) point the source elsewhere
    const moved = "https://collector.example.com/v1/rates?symbols=g18";
    const row = (await db.one<Record<string, any>>(`select * from tz_orgs where id = $1`, [org]))!;
    const settings = { ...row.settings, gold: { ...row.settings.gold, price_source: { url: moved, unit: "rial", header: "X-API-Key", paths: { gram18: "data[symbol=g18].sell" } } } };
    const pushed = await c.post(`/sync/push`, {
      org_id: org, device_id: "00000000-0000-7000-8000-0000000000e1", protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "org", id: org, base_rev: Number(row.rev), row: { ...row, settings, updated_at: new Date().toISOString() }, children: {} }],
    });
    expect(pushed.results[0]).toMatchObject({ status: "ok" });
    const err = await c.post(`/o/${org}/gold/rates/fetch`, { provider: "custom" }, 400);
    expect(err.error.message).toContain("collector.example.com");
    expect(err.error.message).toContain("ذخیره نشده");
    expect(other.filter((u) => u.includes("collector.example.com"))).toEqual([]);
    // saved through the dialog, the move drops the old key: it is never kept for an address no source uses
    const r = await c.put(`/o/${org}/gold/settings`, { price_source: { url: moved, unit: "rial", header: "X-API-Key", paths: { gram18: "data[symbol=g18].sell" } } });
    expect(r.price_key).toBeNull();
    expect(await db.one(`select 1 from tz_price_keys where org_id = $1 and board = 'gold'`, [org])).toBeNull();
    const ev = await db.query<{ data: { action: string; reason?: string } }>(`select data from tz_security_events where kind = 'price_key' and org_id = $1 and data->>'board' = 'gold' order by at`, [org]);
    expect(ev.at(-1)!.data).toMatchObject({ action: "removed", reason: "destination_changed" });
  });

  it("refuses a header that may not carry a key, and {key} outside the path and query", async () => {
    const put = (header: string, url = EZ_URL) => c.put(`/o/${org}/gold/settings`, { price_source: { url, unit: "rial", header, key: EZ_KEY, paths: GOLD_PATHS } }, 400);
    expect((await put("Host")).error.message).toContain("مجاز نیست");
    expect((await put("Cookie")).error.message).toContain("مجاز نیست");
    expect((await put("Content-Type")).error.message).toContain("مجاز نیست");
    expect((await put("Transfer-Encoding")).error.message).toContain("مجاز نیست");
    expect((await put("X-API-Key\r\nX-Injected: 1")).error.message).toContain("شکست خط");
    expect((await put("X API Key")).error.message).toContain("معتبر نیست");
    const host = await c.put(`/o/${org}/gold/settings`, { price_source: { url: "https://{key}.ezrate.me/v1/rates", unit: "rial", key: EZ_KEY, paths: GOLD_PATHS } }, 400);
    expect(host.error.message).toContain("{key}");
    const fx = await c.put(`/o/${org}/fx/settings`, { custom: [{ code: "USD", url: EZ_URL, path: "data[symbol=usd].sell", unit: "base", header: "Cookie" }] }, 400);
    expect(fx.error.message).toContain("مجاز نیست");
    // a key with nowhere to go is not kept
    const nowhere = await c.put(`/o/${org}/gold/settings`, { price_source: { url: EZ_URL, unit: "rial", key: EZ_KEY, paths: GOLD_PATHS } }, 400);
    expect(nowhere.error.message).toContain("سرآیند");
    for (const answer of c.seen) expect(answer).not.toContain(EZ_KEY);
  });

  it("removes a key on request; the source is then not asked", async () => {
    await c.put(`/o/${org}/fx/settings`, { keys: [{ origin: EZ_ORIGIN, remove: true }] });
    expect((await c.get(`/o/${org}/fx/settings`)).keys).toEqual([]);
    ez.asked.length = 0;
    const r = await c.post(`/o/${org}/fx/rates/refresh`, {});
    expect(r.errors.join(" ")).toContain("کلید api.ezrate.me در نسخهٔ وب ذخیره نشده است");
    expect(ez.asked).toEqual([]);
  });
});

describe("custom sources with a key on the Windows app", () => {
  it("each runtime has its own key: without one here the source is not asked, and «خودکار» goes on to tgju", async () => {
    const ez = ezrateServer();
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === TGJU_FEED_IRAN) return json(feed());
      return ez.handle(url, init) ?? new Response("not stubbed", { status: 404 });
    }) as typeof fetch;
    const s = await makeServer({ mode: "desktop", config: { fetch: f } });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold", "fx"], "gold");
    // the settings as they arrive from the web version: the header's name, no key
    await c.put(`/o/${org}/gold/settings`, { provider: "auto", price_source: { url: EZ_URL, unit: "rial", header: "X-API-Key", label: "EZRate", link: EZ_LINK, paths: GOLD_PATHS } });
    expect((await c.get(`/o/${org}/gold/settings`)).price_key).toBeNull();
    const r = await c.post(`/o/${org}/gold/rates/fetch`, { save: false });
    expect(r.rate.source).toBe("tgju");
    expect(r.errors.join(" ")).toContain("کلید api.ezrate.me در نسخهٔ ویندوز ذخیره نشده است");
    expect(ez.asked).toEqual([]);
    // a key saved here is this runtime's own (the desktop needs no APP_SECRET)
    const saved = await c.put(`/o/${org}/gold/settings`, { price_source: { url: EZ_URL, unit: "rial", header: "X-API-Key", key: EZ_KEY, label: "EZRate", link: EZ_LINK, paths: GOLD_PATHS } });
    expect(saved.price_key.hint).toBe("…abcd");
    const again = await c.post(`/o/${org}/gold/rates/fetch`, { save: false });
    expect(again.rate.source).toBe("custom");
    expect(again.rate.gram18).toBe("256641000");
    expect(ez.asked).toEqual([{ url: EZ_URL, key: EZ_KEY }]);
  });
});

describe("custom source keys on the web version without APP_SECRET", () => {
  it("are refused, like AI keys: the secret derived from the database URL would lose them", async () => {
    const prev = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    try {
      const s = await makeServer();
      const c = new Client(s.app);
      const org = await signupWithOrg(c);
      const err = await c.put(`/o/${org}/gold/settings`, { price_source: { url: EZ_URL, unit: "rial", header: "X-API-Key", key: EZ_KEY, paths: GOLD_PATHS } }, 400);
      expect(err.error.message).toContain("APP_SECRET");
      expect(await s.db.one(`select 1 from tz_price_keys`)).toBeNull();
    } finally {
      if (prev !== undefined) process.env.APP_SECRET = prev;
    }
  });
});
