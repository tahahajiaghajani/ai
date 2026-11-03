// Live prices that work from both runtimes. The tgju feed comes from its copy abroad on the web and
// its copy in Iran on the Windows app, falling back to the other copy. It feeds the gold board and,
// for rial and toman businesses, the exchange board: the free-market dollar and currencies in rial.
// Its tether row barely moves and sits under the exchanges, so crypto keeps its exchange prices ×
// the dollar. Nobitex is asked on its current host.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { D } from "@shared/money";
import { TGJU_FEED_ABROAD, TGJU_FEED_IRAN, tgjuFeedAnswered, tgjuFeedUrls, tgjuKeyOf, tgjuPrice } from "@server/modules/fx/tgju";

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
