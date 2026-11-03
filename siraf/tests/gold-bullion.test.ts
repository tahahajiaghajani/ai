import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import type { Db } from "@server/db";
import { D } from "@shared/money";
import {
  COIN_SPECS, buybackBar, coinBubble, intrinsicValue, priceBar, priceCoin, quoteBar, quoteCoin, quoteParsian, vatPctAt, outOfTolerance, bandPremium,
} from "@shared/gold";
import { STANDARD_CATALOGUE, legacyCoinKey, variantChips } from "@shared/gold-catalogue";
import { parseGoldMeta, normalizeRateKey } from "@shared/gold-meta";
import { barLineDefaults, boardUnit, coinLineDefaults, productQuote, DEFAULT_BAR_DEFAULTS } from "@shared/gold-quote";
import { docTotals, priceLine } from "@server/modules/gold/pricing";
import migration0013 from "@server/db/migrations/0013_gold_bullion";
import { catalogueLineIn, patchLine } from "@ui/modules/gold/shared";

const G18 = "50000000";
const NATIONAL_ID = "0010350829";

describe("coins and bars: pure pricing", () => {
  it("knows the official specs and links old coin names to board keys in the right order", () => {
    expect(COIN_SPECS.full.weight).toBe("8.13598");
    expect(D(COIN_SPECS.half.weight).times(2).toString()).toBe(COIN_SPECS.full.weight);
    expect(D(COIN_SPECS.quarter.weight).times(4).toString()).toBe(COIN_SPECS.full.weight);
    expect(legacyCoinKey({ name: "نیم سکه امامی" })).toBe("nim");
    expect(legacyCoinKey({ name: "ربع سکه بهار آزادی" })).toBe("rob");
    expect(legacyCoinKey({ name: "سکه پارسیان ۱ گرمی" })).toBeNull();
    expect(legacyCoinKey({ name: "سکه امامی زیر ۸۶" })).toBe("emami_pre86");
    expect(legacyCoinKey({ name: "هر چیزی", sku: "GERAMI" })).toBe("gerami");
    expect(outOfTolerance("8.10", { weight: COIN_SPECS.full.weight, tolerance: COIN_SPECS.full.tolerance })).toBe(true);
    expect(outOfTolerance("8.134", { weight: COIN_SPECS.full.weight, tolerance: COIN_SPECS.full.tolerance })).toBe(false);
    // catalogue keys are unique and valid
    const keys = STANDARD_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(normalizeRateKey(k)).toBe(k);
    expect(() => normalizeRateKey("Emami-1")).toThrow();
    expect(variantChips({ design: "emami", date_band: "pre86", packaging: "sealed" })).toEqual(["طرح امامی", "زیر ۸۶", "پلمپ"]);
    expect("error" in parseGoldMeta("coin", { family: "bar" })).toBe(true);
    const ok = parseGoldMeta("coin", { family: "parsian", wage_value: "۴" });
    expect("meta" in ok && ok.meta.pricing_mode).toBe("weight");
  });

  it("prices coins in board, weight and manual modes with VAT by mode", () => {
    // board: qty × unit, a discount comes off, exempt
    const b = priceCoin({ side: "sell", mode: "board", qty: 2, unitPrice: "600000000", coinWeight: "8.13598", fineness: 900, discount: "1000000", roundStep: 1000 });
    expect(b.total).toBe("1199000000");
    expect(b.tax).toBe("0");
    expect(b.weight).toBe("16.272");
    // margin VAT: rate × (price − cost)
    const m = priceCoin({ side: "sell", mode: "board", qty: 1, unitPrice: "600000000", unitCost: "580000000", coinWeight: "8.13598", fineness: 900, vatMode: "margin", taxPct: 10, roundStep: 1000 });
    expect(m.tax).toBe("2000000");
    // weight (Parsian 500 sut): gold + 4% wage + VAT on the wage
    const p = priceCoin({ side: "sell", mode: "weight", qty: 1, gram18: G18, coinWeight: "0.5", fineness: 750, wageType: "percent", wageValue: 4, vatMode: "wage_profit", taxPct: 10, roundStep: 1000 });
    expect([p.gold_value, p.wage, p.tax, p.total]).toEqual(["25000000", "1000000", "100000", "26100000"]);
    expect(quoteParsian({ sut: 500, gram18: G18, wageValue: 4, taxPct: 10, roundStep: 1000 }).total).toBe("26100000");
    // buying by weight: at the buy price, a deduction for the condition
    const buy = priceCoin({ side: "buy", mode: "weight", qty: 2, gram18: "49000000", coinWeight: "0.5", fineness: 750, discount: "500000", roundStep: 1000 });
    expect(buy.total).toBe("48500000");
    // quote with breakdown and the bubble of one coin
    const q = quoteCoin({ side: "sell", mode: "board", qty: 1, unitPrice: "600000000", coinWeight: "8.13598", fineness: 900, rate: { gram18: G18, ounce_usd: 2000, usd: "1000000" } });
    expect(q.breakdown[0].amount).toBe("600000000");
    expect(q.bubble?.domestic?.intrinsic).toBe("488158800");
  });

  it("computes the bubble on the domestic and world bases", () => {
    const v = intrinsicValue("8.13598", 900, { gram18: G18, ounce_usd: 2000, usd: "1000000" });
    expect(v.domestic).toBe("488158800");
    // 7.322382 fine grams / 31.1034768 × 2000 × 1,000,000
    expect(v.world).toBe(D("7.322382").div("31.1034768").times(2000).times(1000000).toDecimalPlaces(0).toString());
    const b = coinBubble({ weight: "8.13598", fineness: 900 }, "600000000", { gram18: G18 });
    expect(b.domestic?.amount).toBe("111841200");
    expect(b.domestic?.pct).toBe("22.91");
    expect(b.world).toBeNull();
  });

  it("prices bars with premium and buys them back with fees", () => {
    // 10 g of 999.9 at gram24 = 50M × 1000/750, premium 2% of the metal
    const s = priceBar({ weight: 10, fineness: "999.9", gram18: G18, premiumType: "pct", premiumValue: 2, roundStep: 1000 });
    expect(s.metal).toBe("666600000");
    expect(s.premium).toBe("13332000");
    expect(s.total).toBe("679932000");
    expect(priceBar({ weight: 10, fineness: "999.9", gram18: G18, basis: "nominal", roundStep: 1000 }).metal).toBe("666667000");
    const sealed = buybackBar({ weight: 10, fineness: "999.9", gram18: G18, sealed: true, feeSealedPct: "0.5", feeOpenedPct: "1.5", roundStep: 1000 });
    expect([sealed.metal, sealed.fee, sealed.total]).toEqual(["666600000", "3333000", "663267000"]);
    const opened = buybackBar({ weight: 10, fineness: "999.9", gram18: G18, sealed: false, feeSealedPct: "0.5", feeOpenedPct: "1.5", assayFee: "500000", openedFineness: "995", roundStep: 1000 });
    expect(opened.fineness).toBe("995");
    expect(opened.total).toBe(D("663333000").minus("9950000").minus("500000").toString());
    expect(quoteBar({ side: "buy", weight: 10, fineness: "999.9", gram18: G18, sealed: true, feeSealedPct: "0.5", roundStep: 1000 }).total).toBe("663267000");
    expect(bandPremium(5)).toBe("5");
    expect(bandPremium(1000)).toBe("1.25");
  });

  it("dates VAT: 9% before 1405, the business rate after, own dated rates first", () => {
    expect(vatPctAt("2026-01-10", 10)).toBe("9");
    expect(vatPctAt("2026-05-10", 10)).toBe("10");
    expect(vatPctAt("2026-05-10", 10, [{ from: "2026-05-01", pct: "12" }])).toBe("12");
  });

  it("derives line defaults and buy prices from the board, and totals coins and bars apart", () => {
    const emami = { kind: "coin", rate_key: "emami", gold_weight: "8.13598", fineness: "900", gold_meta: { family: "bank", pricing_mode: "board", buy_spread_pct: "2" } } as const;
    const rate = { gram18: G18, coins: { emami: "600000000" }, coins_buy: {} };
    expect(boardUnit(emami, rate, "sell")).toBe("600000000");
    expect(boardUnit(emami, rate, "buy")).toBe("588000000");
    expect(boardUnit(emami, { ...rate, coins_buy: { emami: "590000000" } }, "buy")).toBe("590000000");
    const parsian = { kind: "coin", rate_key: "parsian_500", gold_weight: "0.5", fineness: "750", gold_meta: { family: "parsian", pricing_mode: "weight", wage_type: "percent", wage_value: "4", vat_mode: "wage_profit" } } as const;
    expect(coinLineDefaults(parsian, { gram18: G18, buy_gram18: "49000000" }, "buy").gram_price).toBe("49000000");
    expect(coinLineDefaults(parsian, { gram18: G18 }, "sell").wage_value).toBe("4");
    const env = { taxPct: 10, roundStep: 1000, bars: DEFAULT_BAR_DEFAULTS };
    expect(productQuote(parsian, { gram18: G18 }, env, { side: "sell" })?.total).toBe("26100000");
    const bar = { kind: "bar", rate_key: "bar_10", gold_weight: "10", fineness: "999.9", gold_meta: { family: "bar" } } as const;
    // default band premium for 10 g: 5%
    expect(productQuote(bar, { gram18: G18 }, env, { side: "sell" })?.total).toBe(D("666600000").times("1.05").toString());
    const lineEnv = { gram18: G18, profitPct: 7, taxPct: 10, deductionPct: 0, roundStep: 1000 };
    const c = priceLine("sale", { kind: "coin", direction: "out", qty: 1, weight: "0.5", fineness: 750, gram_price: G18, pricing_mode: "weight", wage_type: "percent", wage_value: 4, vat_mode: "wage_profit" }, lineEnv);
    const tradeIn = priceLine("sale", { kind: "coin", direction: "in", qty: 1, weight: "8.13598", fineness: 900, gram_price: "590000000", pricing_mode: "board" }, lineEnv);
    const b = priceLine("sale", { kind: "bar", direction: "out", weight: 10, fineness: "999.9", wage_type: "percent", wage_value: 2 }, lineEnv);
    const t = docTotals("sale", [{ ...c, kind: "coin", direction: "out" }, { ...tradeIn, kind: "coin", direction: "in" }, { ...b, kind: "bar", direction: "out" }]);
    expect(t.coins).toBe("26100000");
    expect(t.bars).toBe("679932000");
    expect(t.old_value).toBe("590000000");
    expect(t.net).toBe(D("26100000").plus("679932000").minus("590000000").toString());
    expect(t.weight_out).toBe(D(b.weight750).toString());
    expect(t.coin_qty_in).toBe("1");
    expect(t.bar_count).toBe(1);
  });
});

describe("coins and bars: catalogue, board, documents and reports", () => {
  let c: Client;
  let db: Db;
  let org: string;
  let base: string;
  const ids: Record<string, string> = {};
  const keyOf: Record<string, string> = {};

  async function voucher(docId: string) {
    return db.query<{ key: string; debit: string; credit: string; w_debit: string; w_credit: string; qty: string | null }>(
      `select a.system_key as key, l.debit, l.credit, l.w_debit, l.w_credit, l.qty from tz_voucher_lines l
       join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
       where v.source_type = 'gold_doc' and v.source_id = $1 and v.deleted_at is null`,
      [docId],
    );
  }
  const sum = (rows: { key: string; debit: string; credit: string }[], key: string, side: "debit" | "credit") =>
    rows.filter((r) => r.key === key).reduce((a, r) => a.plus(D(r[side])), D(0)).toString();
  const wsum = (rows: { key: string; w_debit: string; w_credit: string }[], key: string, side: "w_debit" | "w_credit") =>
    rows.filter((r) => r.key === key).reduce((a, r) => a.plus(D(r[side])), D(0)).toString();
  const balanced = (rows: { debit: string; credit: string }[]) =>
    expect(rows.reduce((a, r) => a.plus(D(r.debit)), D(0)).toString()).toBe(rows.reduce((a, r) => a.plus(D(r.credit)), D(0)).toString());

  const tgjuNow = () => new Date(Date.now() + 3.5 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  const stubFetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://call1.tgju.org/")) {
      const now = tgjuNow();
      return new Response(
        JSON.stringify({
          current: {
            geram18: { p: "50,000,000", ts: now }, mesghal: { p: "216,590,000", ts: now },
            sekee: { p: "6,000,000,000", ts: now }, sekee_down: { p: "5,900,000,000", ts: now }, nim: { p: "3,100,000,000", ts: "2020-01-01 10:00:00" },
            retail_sekee: { p: "6,050,000,000" }, coin_blubber: { p: "22.5" }, "sekke-parsian-500": { p: "262,000,000", ts: now },
            price_dollar_rl: { p: "1,000,000" }, ons: { p: "2,000" },
          },
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: stubFetch } });
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c, ["gold"], "gold");
    base = `/o/${org}`;
    ids.box = (await c.get(`${base}/data/cash_box`)).rows[0].id;
    ids.wholesaler = (await c.post(`${base}/data/party`, { name: "بنکداری زرین", roles: ["wholesaler"] })).row.id;
    ids.customer = (await c.post(`${base}/data/party`, { name: "سارا کریمی", roles: ["customer"], national_id: NATIONAL_ID })).row.id;
    ids.anon = (await c.post(`${base}/data/party`, { name: "مشتری بی‌کد", roles: ["customer"] })).row.id;
    await c.put(`${base}/gold/settings`, { profit_pct: "7", tax_pct: "10", round_step: "1000", old_deduction_pct: "0" });
  });

  it("seeds the standard catalogue once, keeping the coins made before it", async () => {
    const first = await c.post(`${base}/gold/catalogue/seed`);
    expect(first.added).toBeGreaterThanOrEqual(0);
    const again = await c.post(`${base}/gold/catalogue/seed`);
    expect(again.added).toBe(0);
    const { rows } = await c.get(`${base}/gold/catalogue`);
    for (const e of STANDARD_CATALOGUE) expect(rows.filter((r: any) => r.rate_key === e.key)).toHaveLength(1);
    for (const r of rows) keyOf[r.rate_key] = r.id;
    const emami = rows.find((r: any) => r.rate_key === "emami");
    expect(emami.name).toBe("سکه امامی (طرح جدید)");
    expect(emami.gold_weight).toBe("8.13598");
    expect(rows.find((r: any) => r.rate_key === "parsian_500").gold_meta.pricing_mode).toBe("weight");
    expect(rows.find((r: any) => r.rate_key === "bar_kilo").kind).toBe("bar");
    // the old five coins were linked, not duplicated
    expect(rows.filter((r: any) => r.kind === "coin" && r.name === "ربع سکه")).toHaveLength(1);
  });

  it("migration 0013 links and completes the catalogue and adds the bar accounts for an existing business", async () => {
    const c2 = new Client((c as any).app);
    await c2.post("/auth/signup", { email: "old@example.com", password: "s3cret-pass", full_name: "طلافروش قدیمی" });
    const { id: o2 } = await c2.post<{ id: string }>("/orgs", { name: "طلافروشی قدیمی", business_kind: "gold", modules: ["gold"], base_currency: "IRR", fiscal_year: 1405 });
    // the state before 0013: no keys on coins, no catalogue rows, no bar accounts
    await db.query(`update tz_items set rate_key = null, gold_meta = '{}'::jsonb where org_id = $1 and code in ('C1','C2','C3','C4','C5')`, [o2]);
    await db.query(`delete from tz_items where org_id = $1 and kind in ('coin','bar') and code not in ('C1','C2','C3','C4','C5')`, [o2]);
    await db.query(`update tz_items set gold_weight = 8.133 where org_id = $1 and code = 'C1'`, [o2]);
    await db.query(`delete from tz_accounts where org_id = $1 and system_key in ('gold_bars', 'bar_sales', 'bar_cogs')`, [o2]);
    await db.exec(migration0013);
    await db.exec(migration0013); // idempotent
    const items = await db.query<{ rate_key: string; code: string; gold_weight: string }>(`select rate_key, code, gold_weight from tz_items where org_id = $1 and kind in ('coin','bar') and deleted_at is null`, [o2]);
    expect(items.length).toBe(STANDARD_CATALOGUE.length);
    expect(items.find((i) => i.code === "C1")!.rate_key).toBe("emami");
    expect(D(items.find((i) => i.code === "C1")!.gold_weight).toString()).toBe("8.13598");
    expect(items.find((i) => i.code === "C3")!.rate_key).toBe("nim");
    const acc = await db.query<{ system_key: string; code: string; weight_mode: string; parent_code: string }>(
      `select a.system_key, a.code, a.weight_mode, p.code as parent_code from tz_accounts a left join tz_accounts p on p.id = a.parent_id
       where a.org_id = $1 and a.system_key in ('gold_bars', 'bar_sales', 'bar_cogs')`,
      [o2],
    );
    expect(acc).toHaveLength(3);
    const bars = acc.find((a) => a.system_key === "gold_bars")!;
    expect([bars.code, bars.weight_mode, bars.parent_code]).toEqual(["1515", "required", "15"]);
    // the app's own seeding afterwards finds nothing to add
    expect((await c2.post(`/o/${o2}/gold/catalogue/seed`)).added).toBe(0);
  });

  it("stores buy and sell prices per key with the bubble, checks manual deviations and maps tgju rows", async () => {
    const r = await c.post(`${base}/gold/rates`, {
      gram18: G18, buy_gram18: "49000000", ounce_usd: "2000", usd: "1000000",
      coins: { emami: "600000000", nim: "310000000", parsian_500: "26500000" }, coins_buy: { emami: "590000000" },
    });
    expect(r.rate.coins.parsian_500).toBe("26500000");
    expect(r.rate.coins_buy.emami).toBe("590000000");
    expect(r.rate.bubbles.emami.domestic).toBe("22.91");
    expect(r.rate.bubbles.emami.world).not.toBeNull();
    // a manual price far from the previous one needs a confirmation
    const far = await c.post(`${base}/gold/rates`, { gram18: "80000000", coins: { emami: "600000000" } }, 409);
    expect(far.error.code).toBe("rate_deviation");
    expect(far.error.details.fields).toContain("gram18");
    // live: tgju rows of the catalogue, retail, bubble and Parsian rows; stale rows marked
    const live = await c.post(`${base}/gold/rates/fetch`, { provider: "tgju", save: false });
    expect(live.rate.coins.emami).toBe("6000000000");
    expect(live.rate.coins.emami_pre86).toBe("5900000000");
    expect(live.rate.coins.parsian_500).toBe("262000000");
    expect(live.rate.meta.retail.emami).toBe("6050000000");
    expect(live.rate.meta.provider_bubble.emami).toBe("22.5");
    expect(live.rate.meta.stale).toContain("nim");
    expect(live.rate.meta.stale).not.toContain("emami");
    // keys tgju did not deliver keep their last price, marked as carried
    expect(live.rate.coins_buy.emami).toBe("590000000");
    const bubbles = await c.get(`${base}/gold/reports/bubbles?days=7`);
    expect(bubbles.rows.find((x: any) => x.key === "emami").domestic).toBe("22.91");
  });

  it("sells board and Parsian coins with VAT on the Parsian wage and takes a coin in trade", async () => {
    // stock: 3 Emami and 4 Parsian 500 bought from a wholesaler
    const p = await c.post(`${base}/gold/docs`, {
      kind: "purchase", date: "2026-06-01", party_id: ids.wholesaler,
      lines: [
        { kind: "coin", item_id: keyOf.emami, qty: 3, gram_price: "580000000" },
        { kind: "coin", item_id: keyOf.parsian_500, qty: 4 },
      ],
    });
    // Parsian bought by weight at the buy gram price with the wholesaler's wage
    const parsianLine = p.doc.lines.find((l: any) => l.item_id === keyOf.parsian_500);
    expect(parsianLine.gold_value).toBe(D("2").times("49000000").toString());
    expect(parsianLine.wage).toBe("3920000");
    const sale = await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-02", party_id: ids.customer,
      settle: { cash: { cash_box_id: ids.box, amount: "1" } },
      lines: [
        { kind: "coin", item_id: keyOf.emami, qty: 1 },
        { kind: "coin", item_id: keyOf.parsian_500, qty: 1 },
        { kind: "coin", item_id: keyOf.nim, qty: 1, direction: "in" },
      ],
    }, 400);
    expect(sale.error.message).toContain("قیمت خرید");
    const s2 = await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-02", party_id: ids.customer,
      lines: [
        { kind: "coin", item_id: keyOf.emami, qty: 1 },
        { kind: "coin", item_id: keyOf.parsian_500, qty: 1 },
        { kind: "coin", item_id: keyOf.nim, qty: 1, direction: "in", gram_price: "300000000" },
      ],
    });
    const d = s2.doc;
    const parsian = d.lines.find((l: any) => l.item_id === keyOf.parsian_500 && l.direction === "out");
    expect([parsian.gold_value, parsian.wage, parsian.tax, parsian.total]).toEqual(["25000000", "1000000", "100000", "26100000"]);
    expect(d.lines.find((l: any) => l.item_id === keyOf.emami).total).toBe("600000000");
    expect(d.total).toBe("626100000");
    expect(d.old_value).toBe("300000000");
    const v = await voucher(d.id);
    balanced(v);
    expect(sum(v, "coin_sales", "credit")).toBe("625000000");
    expect(sum(v, "gold_wage_income", "credit")).toBe("1000000");
    expect(sum(v, "vat_out", "credit")).toBe("100000");
    expect(sum(v, "ar", "debit")).toBe("326100000");
    // cost of sales at the moving average; the traded-in coin enters the stock at its price
    expect(sum(v, "coin_cogs", "debit")).toBe(D("580000000").plus(D("101920000").div(4)).toString());
    expect(sum(v, "coin_inventory", "debit")).toBe("300000000");
    const coins = (await c.get(`${base}/gold/coins`)).coins;
    expect(coins.find((x: any) => x.id === keyOf.nim).qty).toBe("1");
    expect(coins.find((x: any) => x.id === keyOf.emami).qty).toBe("2");
    const kardex = await c.get(`${base}/gold/coins/${keyOf.emami}/kardex`);
    expect(kardex.rows.map((r: any) => r.balance_qty)).toEqual(["3", "2"]);
  });

  it("buys coins back from the public with a reasoned deduction and only with an identified seller", async () => {
    const lines = [{ kind: "coin", item_id: keyOf.emami, qty: 1, discount: "5000000" }];
    const noReason = await c.post(`${base}/gold/docs`, { kind: "buyback", date: "2026-06-03", party_id: ids.customer, lines }, 400);
    expect(noReason.error.message).toContain("دلیل کسر");
    const noId = await c.post(`${base}/gold/docs`, {
      kind: "buyback", date: "2026-06-03", party_id: ids.anon, lines: [{ ...lines[0], description: "خط و خش روی سکه" }],
    }, 400);
    expect(noId.error.message).toContain("کد ملی");
    // a draft is allowed; posting it is not
    const draft = await c.post(`${base}/gold/docs`, { kind: "buyback", date: "2026-06-03", party_id: ids.anon, status: "draft", lines: [{ ...lines[0], description: "خط و خش" }] });
    await c.post(`${base}/gold/docs/${draft.doc.id}/post`, {}, 400);
    const ok = await c.post(`${base}/gold/docs`, {
      kind: "buyback", date: "2026-06-03", buyer: { name: "رهگذر", national_id: NATIONAL_ID },
      settle: { cash: { cash_box_id: ids.box, amount: "585000000" } },
      lines: [{ ...lines[0], description: "خط و خش روی سکه" }],
    });
    expect(ok.doc.total).toBe("585000000"); // board buy price 590M − 5M
    const v = await voucher(ok.doc.id);
    balanced(v);
    expect(v.find((r) => r.key === "coin_inventory")!.qty).toBe("1");
    // a threshold lets small documents through
    await c.put(`${base}/gold/settings`, { kyc: { enabled: true, threshold: "1000000000" } });
    await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-03", party_id: ids.anon, lines: [{ kind: "coin", item_id: keyOf.emami, qty: 1 }] });
    await c.put(`${base}/gold/settings`, { kyc: { enabled: true, threshold: null } });
  });

  it("follows a bar from an ICE purchase to a sale by serial, a buy-back that reuses its row and its undo", async () => {
    const buy = await c.post(`${base}/gold/docs`, {
      kind: "purchase", date: "2026-06-05", party_id: ids.wholesaler, extra: { source: "ice", auction_ref: "۱۴۰۵-۰۰۷" },
      lines: [
        { kind: "bar", item_id: keyOf.bar_10, weight: "10", fineness: "999.9", wage_type: "percent", wage_value: "1", bar: { serial_no: "AB-1001", brand: "ذوب‌آهن طلا", certificate_no: "C-55" } },
        { kind: "bar", item_id: keyOf.bar_10, weight: "10.02", fineness: "999.9", bar: { serial_no: "AB-1002", brand: "ذوب‌آهن طلا" } },
      ],
    });
    const [l1, l2] = buy.doc.lines;
    expect(l1.bar_no).toBe("900001");
    expect(l2.bar_no).toBe("900002");
    expect(l1.gold_value).toBe("666600000");
    expect(l1.wage).toBe("6666000");
    const v = await voucher(buy.doc.id);
    balanced(v);
    expect(sum(v, "gold_bars", "debit")).toBe(D("673266000").plus(l2.total).toString());
    expect(wsum(v, "gold_bars", "w_debit")).toBe(D(l1.weight750).plus(l2.weight750).toString());
    const reg = await c.get(`${base}/gold/bars?q=AB-1001`);
    expect(reg.rows[0]).toMatchObject({ bar_no: "900001", source: "ice", source_ref: "1405-007", status: "in_stock", cost: "673266000" });
    // the same serial cannot be in stock twice
    const dup = await c.post(`${base}/gold/docs`, {
      kind: "purchase", date: "2026-06-05", party_id: ids.wholesaler,
      lines: [{ kind: "bar", item_id: keyOf.bar_10, weight: "10", fineness: "999.9", bar: { serial_no: "ab 1001", brand: "ذوب‌آهن طلا" } }],
    }, 409);
    expect(dup.error.message).toContain("در موجودی");

    // counter: scan by serial, sell
    const look = await c.get(`${base}/gold/bars/lookup/${encodeURIComponent("AB-1001")}`);
    expect(look.bar.bar_no).toBe("900001");
    expect(look.available).toBe(true);
    expect(look.price.total).toBe(D("666600000").times("1.05").toString()); // band premium 5% (10 g)
    expect((await c.get(`${base}/gold/bars/lookup/900002`)).bar.serial_no).toBe("AB-1002");
    const sale = await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-06", party_id: ids.customer, lines: [{ kind: "bar", gold_bar_id: look.bar.id }],
    });
    const sv = await voucher(sale.doc.id);
    balanced(sv);
    expect(sum(sv, "bar_sales", "credit")).toBe("699930000");
    expect(sum(sv, "bar_cogs", "debit")).toBe("673266000"); // its own cost, not an average
    expect(sum(sv, "gold_bars", "credit")).toBe("673266000");
    expect((await c.get(`${base}/gold/bars/${look.bar.id}`)).bar.status).toBe("sold");
    await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-06", party_id: ids.customer, lines: [{ kind: "bar", gold_bar_id: look.bar.id }] }, 409);

    // the customer brings it back, seal intact: the board's buy price of an 18k gram − 0.5% fee; its register row is reused
    const back = await c.post(`${base}/gold/docs`, {
      kind: "buyback", date: "2026-06-08", party_id: ids.customer,
      lines: [{ kind: "bar", weight: "10", fineness: "999.9", bar: { serial_no: "AB1001", brand: "ذوب‌آهن طلا", seal_status: "sealed" } }],
    });
    const backAt = buybackBar({ weight: 10, fineness: "999.9", gram18: "49000000", sealed: true, feeSealedPct: "0.5", roundStep: 1000 }).total;
    expect(back.doc.lines[0].gram_price).toBe("49000000");
    expect(back.doc.lines[0].total).toBe(backAt);
    expect(back.doc.lines[0].gold_bar_id).toBe(look.bar.id);
    expect(back.doc.lines[0].bar_no).toBe("900001");
    const again = await c.get(`${base}/gold/bars/${look.bar.id}`);
    expect(again.bar).toMatchObject({ status: "in_stock", source: "buyback", cost: backAt });
    expect(again.history).toHaveLength(3);
    // the sale cannot be cancelled while the bar is back in stock through a later document
    await c.post(`${base}/gold/docs/${sale.doc.id}/cancel`, {}, 409);
    // cancelling the buy-back restores the sold bar
    await c.post(`${base}/gold/docs/${back.doc.id}/cancel`);
    expect((await c.get(`${base}/gold/bars/${look.bar.id}`)).bar).toMatchObject({ status: "sold", cost: "673266000", source: "ice" });
    await c.post(`${base}/gold/docs/${back.doc.id}/post`);
    expect((await c.get(`${base}/gold/bars/${look.bar.id}`)).bar.status).toBe("in_stock");
    ids.bar1 = look.bar.id;
    ids.bar2 = (await c.get(`${base}/gold/bars/lookup/900002`)).bar.id;
    ids.saleDate = "2026-06-06";
  });

  it("melts coins and a bar into آب‌شده and keeps the stock right", async () => {
    const melt = await c.post(`${base}/gold/docs`, {
      kind: "melt", date: "2026-06-10",
      lines: [
        { kind: "coin", direction: "out", item_id: keyOf.nim, qty: 1 },
        { kind: "bar", direction: "out", gold_bar_id: ids.bar2 },
        { kind: "bulk", direction: "in", weight: "14.1", fineness: "995", assay_no: "AZ-9" },
      ],
    });
    const v = await voucher(melt.doc.id);
    expect(sum(v, "coin_inventory", "credit")).toBe("300000000");
    expect(wsum(v, "gold_bars", "w_credit")).toBe(melt.doc.lines[1].weight750);
    expect(wsum(v, "gold_bullion", "w_debit")).toBe("18.706");
    expect((await c.get(`${base}/gold/bars/${ids.bar2}`)).bar.status).toBe("melted");
    expect((await c.get(`${base}/gold/coins`)).coins.find((x: any) => x.id === keyOf.nim).qty).toBe("0");
  });

  it("reports coins by family, the bar register as of a date, sales by product and the gold position", async () => {
    const coins = await c.get(`${base}/gold/reports/coins`);
    const bank = coins.families.find((f: any) => f.family === "bank");
    expect(bank.qty).toBe("2"); // 3 − 1 sold − 1 sold under the threshold + 1 bought back
    const emami = coins.rows.find((r: any) => r.rate_key === "emami");
    expect(emami.pure).toBe(D("8.13598").times(2).times("0.9").toDecimalPlaces(4).toString());
    expect(emami.sell_value).toBe("1200000000");
    expect(emami.bubble.domestic).toBe("22.91");
    // the register: both bars before the sale, one after the melt
    const before = await c.get(`${base}/gold/reports/bars?to=2026-06-05`);
    expect(before.rows.map((r: any) => r.bar_no).sort()).toEqual(["900001", "900002"]);
    const between = await c.get(`${base}/gold/reports/bars?to=2026-06-07`);
    expect(between.rows.map((r: any) => r.bar_no)).toEqual(["900002"]);
    const now = await c.get(`${base}/gold/reports/bars`);
    expect(now.rows.map((r: any) => r.bar_no)).toEqual(["900001"]);
    const sales = await c.get(`${base}/gold/reports/sales?from=2026-06-01&to=2026-06-30&group=product`);
    const keys = sales.rows.map((r: any) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["bar", "coin:emami", "coin:parsian_500"]));
    expect(sales.rows.find((r: any) => r.key === "bar").bars).toBe("699930000");
    const pos = await c.get(`${base}/gold/reports/position`);
    const row = (k: string) => pos.rows.find((r: any) => r.key === k);
    expect(row("coins").count).toBe("5"); // 2 Emami + 3 Parsian
    expect(row("bars").count).toBe("1");
    expect(row("bars").weight750).toBe(D("10").times("999.9").div(750).toDecimalPlaces(3).toString());
    expect(row("bullion").weight750).toBe("18.706");
    expect(pos.totals.value).not.toBeNull();
    const stock = await c.get(`${base}/gold/reports/stock`);
    expect(stock.bars.diff).toBe("0");
    const summary = await c.get(`${base}/gold/summary`);
    expect(summary.coins.count).toBe("5");
    expect(summary.bars.count).toBe(1);
  });

  it("edits catalogue products with unique board keys and validated metadata", async () => {
    const p = await c.post(`${base}/gold/catalogue`, {
      kind: "coin", name: "مدال یادبود", rate_key: "medal_1", gold_weight: "5", fineness: "900", gold_meta: { family: "other", pricing_mode: "manual" },
    });
    expect(p.product.code).toMatch(/^C\d+$/);
    await c.post(`${base}/gold/catalogue`, { kind: "coin", name: "تکراری", rate_key: "medal_1", gold_weight: "5", gold_meta: {} }, 409);
    await c.post(`${base}/gold/catalogue`, { kind: "coin", name: "بد", rate_key: "Bad Key", gold_weight: "5", gold_meta: {} }, 400);
    await c.post(`${base}/gold/catalogue`, { kind: "coin", name: "بد", gold_weight: "5", gold_meta: { vat_mode: "nope" } }, 400);
    // a manual coin has no board price: the line needs one
    const e = await c.post(`${base}/gold/docs`, { kind: "opening", date: "2026-06-01", lines: [{ kind: "coin", item_id: p.product.id, qty: 1 }] }, 400);
    expect(e.error.message).toContain("مدال یادبود");
    await c.del(`${base}/gold/catalogue/${p.product.id}`);
    await c.del(`${base}/gold/catalogue/${keyOf.emami}`, 409);
  });
});

describe("coins and bars: review fixes (bar edits, buy prices, VAT modes, position, KYC, manual board)", () => {
  it("drops a saved board price when a bar row's seal changes, keeps a typed one, and prices a consigned bar's margin on the screen", () => {
    const saved = { key: "a", seal_status: "sealed", unit_price: "660000000", board_unit: true };
    expect(patchLine(saved, { seal_status: "opened" })).toMatchObject({ seal_status: "opened", unit_price: null, board_unit: false });
    expect(patchLine(saved, { seal_status: "sealed" }).unit_price).toBe("660000000");
    const typed = patchLine(saved, { unit_price: "650000000" });
    expect(patchLine(typed, { seal_status: "opened" }).unit_price).toBe("650000000");
    // the opened bar is then bought by its metal at the buy gram, with the opened fee
    const model = { id: "m", kind: "bar", rate_key: "bar_10", gold_weight: "10", fineness: "999.9", gold_meta: { family: "bar", vat_mode: "margin" } } as any;
    const rate = { gram18: G18, buy_gram18: "49000000", coins: { bar_10: "700000000" }, coins_buy: { bar_10: "660000000" } } as any;
    const env = { gram18: G18, profitPct: 0, taxPct: 10, deductionPct: 0, roundStep: 1000 };
    const opened = catalogueLineIn("buyback", { kind: "bar", direction: "in", weight: "10", fineness: "999.9", ...patchLine(saved, { seal_status: "opened" }) }, model, rate, undefined, G18, null);
    expect([opened.unit_price, opened.gram_price, opened.fee_pct]).toEqual([null, "49000000", "1.5"]);
    // a consigned bar: the margin is over what its owner is owed (the whole board price) — no VAT
    const sold = catalogueLineIn("sale", { kind: "bar", direction: "out", weight: "10", fineness: "999.9", ownership: "consignment" }, model, rate, undefined, G18, null, env);
    expect(priceLine("sale", sold, env).tax).toBe("0");
    const own = catalogueLineIn("sale", { kind: "bar", direction: "out", weight: "10", fineness: "999.9", unit_cost: "650000000" }, model, rate, undefined, G18, null, env);
    expect(priceLine("sale", own, env).tax).toBe("5000000");
  });

  it("prices fixed bar prices net, opened bars by metal at the buy gram, and VAT by mode", () => {
    // a board buy price is what we pay: no fee on top of it; an opened bar still pays the assay fee
    expect(buybackBar({ weight: 10, fineness: "999.9", gram18: G18, sealed: true, feeSealedPct: "0.5", unitPrice: "660000000", roundStep: 1000 }).total).toBe("660000000");
    const o = buybackBar({ weight: 10, fineness: "999.9", gram18: G18, sealed: false, feeOpenedPct: "1.5", assayFee: "500000", openedFineness: "995", unitPrice: "660000000", roundStep: 1000 });
    expect([o.fee, o.total]).toEqual(["0", "659500000"]);
    // the buy side of a bar model: the board's buy gram, and an opened bar has no board unit price
    const model = { kind: "bar", rate_key: "bar_10", gold_weight: "10", fineness: "999.9", gold_meta: { family: "bar" } } as const;
    const rate = { gram18: G18, buy_gram18: "49000000", coins: { bar_10: "700000000" }, coins_buy: { bar_10: "660000000" } };
    const sealed = barLineDefaults(model, { weight: 10, seal_status: "sealed" }, rate, DEFAULT_BAR_DEFAULTS, "buy");
    expect([sealed.gram_price, sealed.unit_price]).toEqual(["49000000", "660000000"]);
    const opened = barLineDefaults(model, { weight: 10, seal_status: "opened" }, rate, DEFAULT_BAR_DEFAULTS, "buy");
    expect([opened.gram_price, opened.unit_price]).toEqual(["49000000", null]);
    expect(barLineDefaults(model, { weight: 10 }, rate, DEFAULT_BAR_DEFAULTS, "sell").gram_price).toBe(G18);
    // a fixed sale price is taxed by the mode too: full, the part above the metal (wage_profit), or the margin
    const base = { weight: 10, fineness: "999.9", gram18: G18, unitPrice: "700000000", taxPct: 10, roundStep: 1000 };
    expect(priceBar({ ...base, vatMode: "full" }).tax).toBe("70000000");
    expect(priceBar({ ...base, vatMode: "wage_profit" }).tax).toBe(D("700000000").minus("666600000").times("0.1").toString());
    expect(priceBar({ ...base, vatMode: "margin", unitCost: "673266000" }).tax).toBe("2673000");
    expect(priceBar({ ...base, vatMode: "exempt" }).tax).toBe("0");
    // the formula price with margin VAT: on the price over the bar's cost
    const f = priceBar({ weight: 10, fineness: "999.9", gram18: G18, premiumType: "pct", premiumValue: 5, vatMode: "margin", unitCost: "673266000", taxPct: 10, roundStep: 1000 });
    expect(f.tax).toBe(D("699930000").minus("673266000").times("0.1").div(1000).toDecimalPlaces(0).times(1000).toString());
    // quotes of a margin-VAT coin: VAT on the price over the average cost
    const coin = { kind: "coin", rate_key: "m", gold_weight: "8.13598", fineness: "900", gold_meta: { family: "other", pricing_mode: "board", vat_mode: "margin" } } as const;
    const env = { taxPct: 10, roundStep: 1000, bars: DEFAULT_BAR_DEFAULTS };
    expect(productQuote({ ...coin, avg_cost: "580000000" }, { gram18: G18, coins: { m: "600000000" } }, env, { side: "sell" })?.total).toBe("602000000");
    expect(productQuote(coin, { gram18: G18, coins: { m: "600000000" } }, env, { side: "sell", unitCost: "590000000" })?.total).toBe("601000000");
  });

  let c: Client;
  let db: Db;
  let base: string;
  const ids: Record<string, string> = {};
  const keyOf: Record<string, string> = {};
  const product = async (key: string) => (await c.get(`${base}/gold/catalogue`)).rows.find((r: any) => r.rate_key === key);

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    base = `/o/${org}`;
    ids.box = (await c.get(`${base}/data/cash_box`)).rows[0].id;
    ids.wholesaler = (await c.post(`${base}/data/party`, { name: "بنکداری زرین", roles: ["wholesaler"] })).row.id;
    ids.customer = (await c.post(`${base}/data/party`, { name: "سارا کریمی", roles: ["customer"], national_id: NATIONAL_ID })).row.id;
    ids.anon = (await c.post(`${base}/data/party`, { name: "مشتری بی‌کد", roles: ["customer"] })).row.id;
    await c.put(`${base}/gold/settings`, { profit_pct: "7", tax_pct: "10", round_step: "1000", old_deduction_pct: "0" });
    await c.post(`${base}/gold/catalogue/seed`);
    for (const r of (await c.get(`${base}/gold/catalogue`)).rows) keyOf[r.rate_key] = r.id;
    const medal = await c.post(`${base}/gold/catalogue`, {
      kind: "coin", name: "سکه‌ی یادبود", rate_key: "medal_m", gold_weight: "8.13598", fineness: "900", gold_meta: { family: "other", pricing_mode: "board", vat_mode: "margin" },
    });
    keyOf.medal_m = medal.product.id;
    await c.post(`${base}/gold/rates`, {
      gram18: G18, buy_gram18: "49000000", coins: { bar_10: "700000000", medal_m: "600000000" }, coins_buy: { bar_10: "660000000" },
    });
  });

  it("edits a posted purchase that brought bars in, and re-posts it after a cancel, keeping each bar and its number", async () => {
    const lines = [
      { kind: "bar", item_id: keyOf.bar_10, weight: "10", fineness: "999.9", wage_type: "percent", wage_value: "1", bar: { serial_no: "ZX-1", brand: "برند الف" } },
      { kind: "bar", item_id: keyOf.bar_10, weight: "10", fineness: "999.9", wage_type: "percent", wage_value: "1", bar: { serial_no: "ZX-2", brand: "برند الف" } },
    ];
    const buy = await c.post(`${base}/gold/docs`, { kind: "purchase", date: "2026-06-05", party_id: ids.wholesaler, lines });
    const [b1, b2] = buy.doc.lines;
    expect([b1.bar_no, b2.bar_no]).toEqual(["900001", "900002"]);
    // the editor sends the lines back with their bars; the first bar's weight is corrected
    const edited = await c.put(`${base}/gold/docs/${buy.doc.id}`, {
      kind: "purchase", date: "2026-06-05", party_id: ids.wholesaler,
      lines: [{ ...lines[0], gold_bar_id: b1.gold_bar_id, weight: "10.01" }, { ...lines[1], gold_bar_id: b2.gold_bar_id }],
    });
    expect(edited.doc.lines.map((l: any) => [l.gold_bar_id, l.bar_no])).toEqual([[b1.gold_bar_id, "900001"], [b2.gold_bar_id, "900002"]]);
    expect((await c.get(`${base}/gold/bars/${b1.gold_bar_id}`)).bar).toMatchObject({ status: "in_stock", weight: "10.01" });
    const live = await db.query(`select id from tz_gold_bars where deleted_at is null`);
    expect(live).toHaveLength(2);
    // cancel and post again: the same rows come back with their numbers
    await c.post(`${base}/gold/docs/${buy.doc.id}/cancel`);
    expect((await db.query(`select id from tz_gold_bars where deleted_at is null`))).toHaveLength(0);
    const again = await c.post(`${base}/gold/docs/${buy.doc.id}/post`);
    expect(again.doc.lines.map((l: any) => [l.gold_bar_id, l.bar_no])).toEqual([[b1.gold_bar_id, "900001"], [b2.gold_bar_id, "900002"]]);
    expect(await db.query(`select id from tz_gold_bars`)).toHaveLength(2);
    ids.bar1 = b1.gold_bar_id;
    ids.bar2 = b2.gold_bar_id;
  });

  it("values every bar of a board-priced model in the gold position", async () => {
    const pos = await c.get(`${base}/gold/reports/position`);
    const bars = pos.rows.find((r: any) => r.key === "bars");
    expect(bars.count).toBe("2");
    // two sealed bar_10 at the board's buy price of one bar (net, no fee)
    expect(bars.value).toBe("1320000000");
  });

  it("buys bars back at the board's buy prices: net for a sealed board bar, the buy gram for an opened one", async () => {
    const back = await c.post(`${base}/gold/docs`, {
      kind: "buyback", date: "2026-06-06", party_id: ids.customer,
      lines: [
        { kind: "bar", item_id: keyOf.bar_10, weight: "10", fineness: "999.9", bar: { serial_no: "QQ-1", brand: "برند ب", seal_status: "sealed" } },
        { kind: "bar", item_id: keyOf.bar_10, weight: "10", fineness: "999.9", bar: { serial_no: "QQ-2", brand: "برند ب", seal_status: "opened" } },
      ],
    });
    const [s, o] = back.doc.lines;
    expect([s.total, s.deduction_pct]).toEqual(["660000000", "0"]);
    const opened = buybackBar({ weight: 10, fineness: "999.9", gram18: "49000000", sealed: false, feeOpenedPct: "1.5", openedFineness: "995", roundStep: 1000 });
    expect([o.gram_price, o.total]).toEqual(["49000000", opened.total]);
    expect(opened.fineness).toBe("995");
    await c.post(`${base}/gold/docs/${back.doc.id}/cancel`);
  });

  it("taxes margin-VAT coins and bars on the margin, the same in quotes and in posting", async () => {
    await c.post(`${base}/gold/docs`, { kind: "purchase", date: "2026-06-05", party_id: ids.wholesaler, lines: [{ kind: "coin", item_id: keyOf.medal_m, qty: 2, gram_price: "580000000" }] });
    const row = await product("medal_m");
    expect(row.avg_cost).toBe("580000000");
    expect(row.sell).toBe("602000000"); // 600M + 10% × (600M − 580M)
    const quote = await c.post(`${base}/gold/calc`, { type: "product", item_id: keyOf.medal_m, side: "sell" });
    expect(quote.result.total).toBe("602000000");
    const sale = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-07", party_id: ids.customer, lines: [{ kind: "coin", item_id: keyOf.medal_m, qty: 1 }] });
    expect([sale.doc.lines[0].tax, sale.doc.total]).toEqual(["2000000", "602000000"]);

    // a bar model on margin VAT: on the board price over the bar's own cost
    const m = await product("bar_10");
    await c.put(`${base}/gold/catalogue/${m.id}`, { kind: "bar", name: m.name, rate_key: m.rate_key, gold_weight: m.gold_weight, fineness: m.fineness, gold_meta: { ...m.gold_meta, vat_mode: "margin" } });
    const bar = (await c.get(`${base}/gold/bars/${ids.bar1}`)).bar;
    const look = await c.get(`${base}/gold/bars/lookup/${bar.bar_no}`);
    const tax = D("700000000").minus(D(bar.cost)).times("0.1").div(1000).toDecimalPlaces(0).times(1000).toString();
    expect(look.price.tax).toBe(tax);
    // the /calc quote of the model (and the AI's) takes the average cost of its bars in stock, not 0
    const b2 = (await c.get(`${base}/gold/bars/${ids.bar2}`)).bar;
    const avg = D(bar.cost).plus(D(b2.cost)).div(2).toDecimalPlaces(0);
    const modelQuote = await c.post(`${base}/gold/calc`, { type: "product", item_id: m.id, side: "sell" });
    expect(modelQuote.result.total).toBe(D("700000000").plus(D("700000000").minus(avg).times("0.1").div(1000).toDecimalPlaces(0).times(1000)).toString());
    const barSale = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-07", party_id: ids.customer, lines: [{ kind: "bar", gold_bar_id: ids.bar1 }] });
    expect([barSale.doc.lines[0].tax, barSale.doc.lines[0].total]).toEqual([tax, D("700000000").plus(tax).toString()]);
  });

  it("taxes a consigned margin-VAT bar on the margin over what its owner is owed", async () => {
    const m = await product("bar_100");
    await c.put(`${base}/gold/catalogue/${m.id}`, { kind: "bar", name: m.name, rate_key: m.rate_key, gold_weight: m.gold_weight, fineness: m.fineness, gold_meta: { ...m.gold_meta, vat_mode: "margin" } });
    const cin = await c.post(`${base}/gold/docs`, {
      kind: "consign_in", date: "2026-06-07", party_id: ids.wholesaler, settle: { mode: "rial" },
      lines: [{ kind: "bar", item_id: m.id, weight: "100", fineness: "995", bar: { serial_no: "CN-1", brand: "برند ج" } }],
    });
    const barId = cin.doc.lines[0].gold_bar_id;
    const look = await c.get(`${base}/gold/bars/${barId}`);
    expect(look.bar.ownership).toBe("consignment");
    // weight-priced: the owner is owed the metal, so only the premium is the margin
    const premium = D(look.price.wage);
    expect(premium.gt(0)).toBe(true);
    const tax = premium.times("0.1").div(1000).toDecimalPlaces(0).times(1000).toString();
    expect(look.price.tax).toBe(tax);
    const sale = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-07", gram18: G18, party_id: ids.customer, lines: [{ kind: "bar", gold_bar_id: barId }] });
    const l = sale.doc.lines[0];
    expect([l.wage, l.tax]).toEqual([premium.toString(), tax]);
    expect(l.cost).toBe(l.gold_value);
  });

  it("splits a client-sent bar price into metal and premium at the latest rate when the document has no gram price", async () => {
    const m = await product("bar_10");
    await c.put(`${base}/gold/catalogue/${m.id}`, { kind: "bar", name: m.name, rate_key: m.rate_key, gold_weight: m.gold_weight, fineness: m.fineness, gold_meta: { ...m.gold_meta, vat_mode: "wage_profit" } });
    const b2 = (await c.get(`${base}/gold/bars/${ids.bar2}`)).bar;
    const expected = priceBar({ weight: b2.weight, fineness: b2.fineness, gram18: G18, unitPrice: "700000000", vatMode: "wage_profit", taxPct: 10, roundStep: 1000 });
    expect(D(expected.tax).gt(0)).toBe(true);
    const sale = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-07", party_id: ids.customer, lines: [{ kind: "bar", gold_bar_id: ids.bar2, unit_price: "700000000" }] });
    expect(sale.doc.lines[0].tax).toBe(expected.tax);
    await c.post(`${base}/gold/docs/${sale.doc.id}/cancel`);
  });

  it("asks for the seller's id when آب‌شده is bought back or gold is bought from the public", async () => {
    const old = { kind: "old", weight: "10", fineness: "750" };
    const e = await c.post(`${base}/gold/docs`, { kind: "buyback", date: "2026-06-08", party_id: ids.anon, lines: [{ ...old, form: "bullion" }] }, 400);
    expect(e.error.message).toContain("کد ملی");
    const ok = await c.post(`${base}/gold/docs`, { kind: "buyback", date: "2026-06-08", party_id: ids.customer, lines: [{ ...old, form: "bullion" }] });
    expect([ok.doc.lines[0].form, ok.doc.lines[0].title]).toEqual(["bullion", "آب‌شده"]);
    // used jewellery stays as before
    await c.post(`${base}/gold/docs`, { kind: "buyback", date: "2026-06-08", party_id: ids.anon, lines: [old] });
    const pub = await c.post(`${base}/gold/docs`, {
      kind: "purchase", date: "2026-06-08", party_id: ids.anon, extra: { source: "public" }, lines: [{ kind: "coin", item_id: keyOf.medal_m, qty: 1, gram_price: "590000000" }],
    }, 400);
    expect(pub.error.message).toContain("فروشنده");
  });

  it("reports آب‌شده bought back apart from used gold", async () => {
    const r = await c.get(`${base}/gold/reports/sales?kinds=buyback&group=category&from=2026-06-08&to=2026-06-08`);
    const labels = r.rows.map((x: any) => x.label);
    expect(labels).toContain("آب‌شده");
    expect(labels).toContain("طلای مستعمل");
  });

  it("keeps the board prices a manual entry does not mention, and clears the ones sent empty", async () => {
    await c.post(`${base}/gold/rates`, { gram18: G18, buy_gram18: "49000000", coins: { medal_m: "600000000" }, coins_buy: {} });
    let r = (await c.get(`${base}/gold/rates/latest`)).rate;
    expect([r.coins.bar_10, r.coins_buy.bar_10, r.coins.medal_m]).toEqual(["700000000", "660000000", "600000000"]);
    expect(r.meta.carried).toContain("bar_10");
    await c.post(`${base}/gold/rates`, { gram18: G18, coins: { bar_10: null, medal_m: "600000000" } });
    r = (await c.get(`${base}/gold/rates/latest`)).rate;
    expect(r.coins.bar_10).toBeUndefined();
    expect(r.coins_buy.bar_10).toBe("660000000");
  });
});
