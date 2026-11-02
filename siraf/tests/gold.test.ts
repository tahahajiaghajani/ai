import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, accountId } from "./helpers";
import type { Db } from "@server/db";
import { priceJewelry, priceOldGold, priceBullion, gram18FromMazaneh, mazanehFromGram18 } from "@shared/gold";
import { D } from "@shared/money";
import { priceLine, docTotals } from "@server/modules/gold/pricing";

const G18 = "50000000"; // 18k gram price (rial) used by the purchases
const SALE_G18 = "52000000";

describe("gold pricing formulas", () => {
  it("prices jewellery: gold value + wage + profit + VAT on wage and profit only", () => {
    const p = priceJewelry({ weight: 10, fineness: 750, gram18: G18, wageType: "percent", wageValue: 18, profitPct: 7, taxPct: 10, roundStep: 1000 });
    expect(p.goldValue).toBe("500000000");
    expect(p.wage).toBe("90000000");
    expect(p.profit).toBe("41300000"); // 7% × (gold + wage)
    expect(p.tax).toBe("13130000"); // 10% × (wage + profit)
    expect(p.total).toBe("644430000");
    // a discount comes off the taxable wage + profit, never the gold value
    const d = priceJewelry({ weight: 10, gram18: G18, wageType: "percent", wageValue: 18, profitPct: 7, taxPct: 10, discount: 1300000, roundStep: 1000 });
    expect(d.taxBase).toBe("130000000");
    expect(d.tax).toBe("13000000");
    expect(d.total).toBe("643000000");
    // other finenesses are priced from the 18k gram: 900 → 50M × 900/750
    expect(priceJewelry({ weight: 10, fineness: 900, gram18: G18, wageType: "fixed", wageValue: 0, profitPct: 0, taxPct: 10 }).goldValue).toBe("600000000");
    // per-gram and fixed wages
    expect(priceJewelry({ weight: 4.5, gram18: G18, wageType: "per_gram", wageValue: 1000000, profitPct: 0, taxPct: 10 }).wage).toBe("4500000");
  });

  it("prices used gold with deduction, bullion by mazaneh and converts mazaneh ↔ gram18", () => {
    const o = priceOldGold({ weight: 5, fineness: 740, gram18: G18, deductionPct: 2, roundStep: 1000 });
    expect(o.weight750).toBe("4.933");
    expect(o.gross).toBe("246650000");
    expect(o.deduction).toBe("4933000");
    expect(o.total).toBe("241717000");
    expect(mazanehFromGram18(G18)).toBe("216590000");
    expect(gram18FromMazaneh("216590000")).toBe(G18);
    // bullion: weight × fineness / 705 / 4.6083 × mazaneh
    const expected = D(10).times(995).div(705).div("4.6083").times("216590000").div(1000).toDecimalPlaces(0).times(1000).toString();
    expect(priceBullion(10, 995, "216590000", 1000)).toBe(expected);
  });

  it("prices document lines and totals with the shared module", () => {
    const env = { gram18: SALE_G18, profitPct: 7, taxPct: 10, deductionPct: 0, roundStep: 1000 };
    const piece = priceLine("sale", { kind: "piece", direction: "out", weight: 10, fineness: 750, wage_type: "percent", wage_value: 18 }, env);
    const old = priceLine("sale", { kind: "old", direction: "in", weight: 3, fineness: 750 }, env);
    const t = docTotals("sale", [{ ...piece, kind: "piece", direction: "out" }, { ...old, kind: "old", direction: "in" }]);
    expect(piece.total).toBe("670207000");
    expect(old.total).toBe("156000000");
    expect(t.total).toBe("670207000");
    expect(t.net).toBe("514207000");
    expect(t.weight_out).toBe("10");
    expect(t.weight_in).toBe("3");
  });
});

describe("gold documents: posting, pieces, weights and reports", () => {
  let c: Client;
  let db: Db;
  let org: string;
  let base: string;
  const acc: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const detail: Record<string, string> = {};
  let fetchLog: string[] = [];
  let fetchMode: "ok" | "fail" = "ok";

  const stubFetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    fetchLog.push(url);
    if (fetchMode === "fail") throw new TypeError("fetch failed");
    if (url.startsWith("https://call1.tgju.org/")) {
      return new Response(JSON.stringify({ current: { geram18: { p: "51,000,000" }, mesghal: { p: "220,921,800" }, geram24: { p: "68,000,000" }, sekee: { p: "1,100,000,000" }, rob: { p: "160,000,000" }, price_dollar_rl: { p: "1,000,000" } } }), { status: 200 });
    }
    if (url.startsWith("https://api.gold-api.com/")) return new Response(JSON.stringify({ name: "Gold", price: 2000, symbol: "XAU" }), { status: 200 });
    if (url.startsWith("https://prices.example.com/")) return new Response(JSON.stringify({ data: { items: [{ g18: "5,050,000", coin: "15,500,000" }] } }), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  async function doc(id: string) {
    return (await c.get(`${base}/gold/docs/${id}`)).doc;
  }
  async function voucher(docId: string) {
    const d = await doc(docId);
    expect(d.voucher?.id).toBeTruthy();
    const v = (await c.get(`/o/${org}/accounting/vouchers/${d.voucher.id}`)).voucher;
    expect(v.total_debit).toBe(v.total_credit); // balanced in rial
    return v;
  }
  const lines = (v: any, key: string) => v.lines.filter((l: any) => l.account_id === acc[key]);
  const one = (v: any, key: string) => {
    const ls = lines(v, key);
    expect(ls, `account ${key}`).toHaveLength(1);
    return ls[0];
  };
  const sumOf = (ls: any[], f: string) => ls.reduce((a: any, l: any) => a.plus(D(l[f])), D(0)).toString();
  async function item(id: string) {
    return (await c.get(`${base}/data/gold_item/${id}`)).row;
  }

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: stubFetch } });
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    base = `/o/${org}`;
    for (const k of [
      "cash", "bank", "ar", "ap", "vat_out", "vat_in", "gold_inventory", "gold_old", "gold_bullion", "gold_parties", "gold_at_workshop", "gold_sales",
      "gold_wage_income", "gold_profit_income", "gold_cogs", "gold_loss", "gold_gain", "coin_inventory", "coin_sales", "coin_cogs",
      "gold_consign_memo", "gold_consign_contra", "opening_balance", "stone_sales",
    ]) acc[k] = await accountId(db, org, k);
    const box = (await c.get(`${base}/data/cash_box`)).rows[0];
    ids.box = box.id;
    detail.box = box.detail_id;
    const bank = (await c.post(`${base}/data/bank_account`, { name: "ملت جاری" })).row;
    ids.bank = bank.id;
    detail.bank = bank.detail_id;
    ids.pos = (await c.post(`${base}/data/pos_terminal`, { name: "کارتخوان ویترین", bank_account_id: bank.id })).row.id;
    for (const [k, name, roles] of [
      ["customer", "مریم احمدی", ["customer"]],
      ["wholesaler", "بنکداری زرین", ["wholesaler", "supplier"]],
      ["wholesaler2", "طلای همکار نوین", ["wholesaler"]],
      ["workshop", "کارگاه ساخت رضا", ["workshop"]],
      ["consignor", "گالری امانی آریا", ["wholesaler"]],
    ] as const) {
      const p = (await c.post(`${base}/data/party`, { name, roles })).row;
      ids[k] = p.id;
      detail[k] = p.detail_id;
    }
    const cats = (await c.get(`${base}/data/gold_category?size=100`)).rows;
    ids.ring = cats.find((x: any) => x.name === "انگشتر").id; // seeded: 18% wage
    ids.necklace = cats.find((x: any) => x.name === "گردنبند").id; // seeded: 15% wage
    const coins = (await c.get(`${base}/data/item?f.kind=coin&size=50`)).rows;
    ids.rob = coins.find((x: any) => x.name === "ربع سکه").id;
    // pricing defaults: profit 7%, VAT 10%, rounding to 1000 rials
    await c.put(`${base}/gold/settings`, { profit_pct: "7", tax_pct: "10", round_step: "1000", old_deduction_pct: "0" });
  });

  it("enters rates manually (mazaneh → gram18) and fetches live prices", async () => {
    const r = (await c.post(`${base}/gold/rates`, { mazaneh: "216590000", coins: { rob: "155000000" } })).rate;
    expect(r.gram18).toBe(G18);
    expect(r.gram24).toBe("66666667");
    const latest = await c.get(`${base}/gold/rates/latest`);
    expect(latest.rate.id).toBe(r.id);

    // tgju (Iranian market JSON, rial)
    const tg = await c.post(`${base}/gold/rates/fetch`, { provider: "tgju" });
    expect(tg.rate.source).toBe("tgju");
    expect(tg.rate.gram18).toBe("51000000");
    expect(tg.rate.mazaneh).toBe("220921800");
    expect(tg.rate.coins.emami).toBe("1100000000");
    // world ounce × free-market dollar from the settings (no FX rate recorded yet)
    await c.post(`${base}/gold/rates/fetch`, { provider: "goldapi" }, 400);
    await c.put(`${base}/gold/settings`, { usd: "1000000" });
    const ga = await c.post(`${base}/gold/rates/fetch`, { provider: "goldapi", save: false });
    expect(ga.saved).toBe(false);
    expect(ga.rate.gram18).toBe(D(2000).div("31.1034768").times(0.75).times(1000000).toDecimalPlaces(0).toString());
    expect(ga.rate.coins.emami).toBe("1100000000"); // kept from the last rate
    // custom JSON source (toman) through JSON paths
    await c.put(`${base}/gold/settings`, { price_source: { url: "https://prices.example.com/gold.json", unit: "toman", paths: { gram18: "data.items[0].g18", rob: "data.items[0].coin" } } });
    const cu = await c.post(`${base}/gold/rates/fetch`, { provider: "custom", save: false });
    expect(cu.rate.gram18).toBe("50500000");
    expect(cu.rate.coins.rob).toBe("155000000");
    // private addresses are refused on the cloud
    await c.put(`${base}/gold/settings`, { price_source: { url: "http://127.0.0.1/x", paths: { gram18: "a" } } });
    const priv = await c.post(`${base}/gold/rates/fetch`, { provider: "custom", save: false }, 400);
    expect(priv.error.message).toContain("https");
    await c.put(`${base}/gold/settings`, { price_source: null });
    // unreachable sources give one Persian message
    fetchMode = "fail";
    const err = await c.post(`${base}/gold/rates/fetch`, {}, 400);
    expect(err.error.message).toContain("دریافت قیمت زنده ممکن نشد");
    fetchMode = "ok";
    expect(fetchLog.some((u) => u.includes("tgju"))).toBe(true);
    // the board used by the documents below
    await c.post(`${base}/gold/rates`, { gram18: SALE_G18, coins: { rob: "170000000" } });
  });

  it("buys pieces from a wholesaler in rial: creates tags and posts inventory against the payable", async () => {
    const r = await c.post(`${base}/gold/docs`, {
      kind: "purchase",
      date: "2026-05-01",
      party_id: ids.wholesaler,
      gram18: G18,
      settle: { mode: "rial" },
      lines: [
        { kind: "piece", category_id: ids.ring, title: "انگشتر رینگ", weight: "10", fineness: "750", wage_type: "percent", wage_value: "5", extra: { sale_wage_type: "percent", sale_wage_value: "18" } },
        { kind: "piece", category_id: ids.necklace, weight: "4.5", stone_weight: "0.3", wage_type: "per_gram", wage_value: "1000000" },
      ],
    });
    const d = r.doc;
    ids.purchase1 = d.id;
    expect(d.no).toBe(1);
    expect(d.status).toBe("posted");
    expect(d.total).toBe("754500000");
    expect(d.weight_in).toBe("14.5");
    const [l1, l2] = d.lines;
    expect(l1.gold_value).toBe("500000000");
    expect(l1.wage).toBe("25000000");
    expect(l2.wage).toBe("4500000");
    expect(l1.tag_no).toBe("100001");
    expect(l2.tag_no).toBe("100002");
    ids.ring1 = l1.gold_item_id;
    ids.neck1 = l2.gold_item_id;
    const it1 = await item(ids.ring1);
    expect(it1.status).toBe("in_stock");
    expect(it1.ownership).toBe("own");
    expect(it1.cost).toBe("525000000");
    expect(it1.wage_value).toBe("18"); // the tag carries the sale wage
    expect(it1.supplier_id).toBe(ids.wholesaler);
    const it2 = await item(ids.neck1);
    expect(it2.gross_weight).toBe("4.8");
    expect(it2.net_weight).toBe("4.5");
    expect(it2.wage_value).toBe("15"); // category default
    const v = await voucher(d.id);
    const inv = one(v, "gold_inventory");
    expect(inv.debit).toBe("754500000");
    expect(inv.w_debit).toBe("14.5");
    const ap = one(v, "ap");
    expect(ap.credit).toBe("754500000");
    expect(ap.detail_id).toBe(detail.wholesaler);
    // scanning a tag prices it at the latest rate
    const scan = await c.get(`${base}/gold/items/by-tag/${encodeURIComponent("۱۰۰۰۰۱")}`);
    expect(scan.item.id).toBe(ids.ring1);
    expect(scan.available).toBe(true);
    expect(scan.line.wage_value).toBe("18");
    expect(scan.price.total).toBe("670207000");
    await c.get(`${base}/gold/items/by-tag/999999`, 404);
  });

  it("sells a tagged piece with a trade-in of old gold and a split payment", async () => {
    const r = await c.post(`${base}/gold/docs`, {
      kind: "sale",
      date: "2026-05-10",
      party_id: ids.customer,
      gram18: SALE_G18,
      lines: [
        { kind: "piece", gold_item_id: ids.ring1 },
        { kind: "old", weight: "3", fineness: "750" },
      ],
      settle: { cash: { cash_box_id: ids.box, amount: "200000000" }, pos: { pos_id: ids.pos, amount: "100000000" } },
    });
    const d = r.doc;
    ids.sale1 = d.id;
    expect(d.total).toBe("670207000");
    expect(d.old_value).toBe("156000000");
    expect(d.wage).toBe("93600000");
    expect(d.profit).toBe("42952000");
    expect(d.tax).toBe("13655000");
    expect(d.weight_out).toBe("10");
    expect(d.weight_in).toBe("3");
    expect(d.settle.remaining).toBe("214207000");
    const v = await voucher(d.id);
    expect(one(v, "cash")).toMatchObject({ debit: "200000000", detail_id: detail.box });
    expect(one(v, "bank")).toMatchObject({ debit: "100000000", detail_id: detail.bank });
    expect(one(v, "ar")).toMatchObject({ debit: "214207000", detail_id: detail.customer });
    expect(one(v, "gold_old")).toMatchObject({ debit: "156000000", w_debit: "3" });
    expect(one(v, "gold_sales").credit).toBe("520000000");
    expect(one(v, "gold_wage_income").credit).toBe("93600000");
    expect(one(v, "gold_profit_income").credit).toBe("42952000");
    expect(one(v, "vat_out").credit).toBe("13655000");
    expect(one(v, "gold_cogs").debit).toBe("525000000"); // the piece's own cost
    expect(one(v, "gold_inventory")).toMatchObject({ credit: "525000000", w_credit: "10" });
    expect(v.total_debit).toBe("1195207000");
    const it = await item(ids.ring1);
    expect(it.status).toBe("sold");
    expect(it.out_doc_id).toBe(d.id);
    // a sold tag cannot be sold again
    const again = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-05-10", gram18: SALE_G18, lines: [{ kind: "piece", gold_item_id: ids.ring1 }], settle: { cash: { cash_box_id: ids.box, amount: "670207000" } } }, 409);
    expect(again.error.message).toContain("فروخته");
    // a walk-in sale must be settled in full
    const credit = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-05-10", gram18: SALE_G18, lines: [{ kind: "piece", gold_item_id: ids.neck1 }] }, 400);
    expect(credit.error.message).toContain("تسویه نشده");
  });

  it("cancels and re-posts a sale with the piece going back to stock", async () => {
    const draft = (await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-05-11", status: "draft", gram18: SALE_G18,
      lines: [{ kind: "piece", gold_item_id: ids.neck1, discount: "1000000" }],
      settle: { cash: { cash_box_id: ids.box, amount: "1" } },
    }, 400)).error;
    expect(draft.message).toContain("تسویه نشده");
    const d = (await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-05-11", status: "draft", gram18: SALE_G18, party_id: ids.customer, lines: [{ kind: "piece", gold_item_id: ids.neck1 }] })).doc;
    expect(d.status).toBe("draft");
    expect(d.voucher).toBeNull();
    expect((await item(ids.neck1)).status).toBe("in_stock");
    const posted = (await c.post(`${base}/gold/docs/${d.id}/post`)).doc;
    expect(posted.status).toBe("posted");
    expect((await item(ids.neck1)).status).toBe("sold");
    const cancelled = (await c.post(`${base}/gold/docs/${d.id}/cancel`)).doc;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.voucher).toBeNull();
    const it = await item(ids.neck1);
    expect(it.status).toBe("in_stock");
    expect(it.out_doc_id).toBeNull();
    // the purchase cannot be cancelled while one of its tags is sold
    const blocked = await c.post(`${base}/gold/docs/${ids.purchase1}/cancel`, {}, 409);
    expect(blocked.error.message).toContain("100001".replace(/\d/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]));
    await c.del(`${base}/gold/docs/${d.id}`);
    await c.get(`${base}/gold/docs/${d.id}`, 404);
  });

  it("buys by weight (طلا به طلا): tags, bullion and the supplier's weight balance", async () => {
    const d = (await c.post(`${base}/gold/docs`, {
      kind: "purchase",
      date: "2026-05-12",
      party_id: ids.wholesaler2,
      gram18: G18,
      settle: { mode: "weight", cash: { cash_box_id: ids.box, amount: "2400000" } },
      lines: [
        { kind: "piece", category_id: ids.ring, weight: "8", wage_type: "per_gram", wage_value: "800000" },
        { kind: "bulk", form: "bullion", weight: "20", fineness: "995", assay_no: "ANG-77" },
      ],
    })).doc;
    ids.purchase2 = d.id;
    expect(d.lines[0].tag_no).toBe("100003");
    expect(d.lines[1].weight750).toBe("26.533");
    expect(d.lines[1].gold_value).toBe("1326667000");
    expect(d.settle.mode).toBe("weight");
    expect(d.settle.due).toBe("6400000"); // only the wage is owed in rial
    expect(d.settle.remaining).toBe("4000000");
    const v = await voucher(d.id);
    expect(one(v, "gold_parties")).toMatchObject({ credit: "1726667000", w_credit: "34.533", detail_id: detail.wholesaler2 });
    expect(one(v, "cash").credit).toBe("2400000");
    expect(one(v, "ap")).toMatchObject({ credit: "4000000", detail_id: detail.wholesaler2 });
    expect(one(v, "gold_inventory")).toMatchObject({ debit: "406400000", w_debit: "8" });
    expect(one(v, "gold_bullion")).toMatchObject({ debit: "1326667000", w_debit: "26.533" });
    const parties = await c.get(`${base}/gold/reports/parties`);
    const w2 = parties.rows.find((r: any) => r.party_id === ids.wholesaler2);
    expect(w2.gold_w).toBe("-34.533"); // we owe this much 750 gold
    expect(w2.ap).toBe("-4000000");
  });

  it("buys used gold from a customer with a deduction", async () => {
    const d = (await c.post(`${base}/gold/docs`, {
      kind: "buyback",
      date: "2026-05-13",
      gram18: G18,
      lines: [{ kind: "old", weight: "5", fineness: "740", deduction_pct: "2" }],
      settle: { cash: { cash_box_id: ids.box, amount: "241717000" } },
    })).doc;
    expect(d.total).toBe("241717000");
    expect(d.lines[0].discount).toBe("4933000"); // the deduction
    const v = await voucher(d.id);
    expect(one(v, "gold_old")).toMatchObject({ debit: "241717000", w_debit: "4.933" });
    expect(one(v, "cash")).toMatchObject({ credit: "241717000", detail_id: detail.box });
    // paying more than the value is refused
    await c.post(`${base}/gold/docs`, { kind: "buyback", date: "2026-05-13", gram18: G18, lines: [{ kind: "old", weight: "1" }], settle: { cash: { cash_box_id: ids.box, amount: "999999999" } } }, 400);
  });

  it("melts used gold into bullion with an assay and books the loss", async () => {
    // gold_old now holds the 3 g trade-in (156M) and the 4.933 g bought back (241.717M)
    const d = (await c.post(`${base}/gold/docs`, {
      kind: "melt",
      date: "2026-05-14",
      lines: [
        { kind: "bulk", direction: "out", form: "old", weight: "3", fineness: "750" },
        { kind: "bulk", direction: "out", form: "old", weight: "5", fineness: "740" },
        { kind: "bulk", direction: "in", form: "bullion", weight: "7.9", fineness: "745", assay_no: "A-123" },
      ],
    })).doc;
    expect(d.weight_out).toBe("7.933");
    expect(d.weight_in).toBe("7.847");
    const v = await voucher(d.id);
    const old = lines(v, "gold_old");
    expect(sumOf(old, "credit")).toBe("397717000");
    expect(sumOf(old, "w_credit")).toBe("7.933");
    const bullion = one(v, "gold_bullion");
    expect(bullion.w_debit).toBe("7.847");
    const loss = one(v, "gold_loss");
    expect(loss.w_debit).toBe("0.086");
    expect(D(bullion.debit).plus(D(loss.debit)).toString()).toBe("397717000");
    expect(D(loss.debit).gt(0)).toBe(true);
    expect(bullion.description).toContain("A-123");
    const stock = await c.get(`${base}/gold/reports/stock`);
    expect(stock.ledger.gold_old.w).toBe("0");
    expect(stock.ledger.gold_old.rial).toBe("0");
  });

  it("sends bullion to a workshop and receives made pieces with a making loss", async () => {
    const out = (await c.post(`${base}/gold/docs`, {
      kind: "workshop_out", date: "2026-05-15", party_id: ids.workshop,
      lines: [{ kind: "bulk", form: "bullion", weight: "10", fineness: "995" }],
    })).doc;
    const vo = await voucher(out.id);
    const sent = one(vo, "gold_at_workshop");
    expect(sent.w_debit).toBe("13.267");
    expect(sent.detail_id).toBe(detail.workshop);
    expect(one(vo, "gold_bullion").w_credit).toBe("13.267");
    const back = (await c.post(`${base}/gold/docs`, {
      kind: "workshop_in", date: "2026-05-20", party_id: ids.workshop,
      settle: { close_workshop: true },
      lines: [
        { kind: "piece", category_id: ids.ring, weight: "7", wage_type: "per_gram", wage_value: "2000000" },
        { kind: "piece", category_id: ids.necklace, weight: "5.9", wage_type: "per_gram", wage_value: "2000000" },
      ],
    })).doc;
    expect(back.lines.map((l: any) => l.tag_no)).toEqual(["100004", "100005"]);
    expect(back.total).toBe("25800000"); // wages owed to the workshop
    const vi = await voucher(back.id);
    expect(one(vi, "gold_at_workshop")).toMatchObject({ credit: sent.debit, w_credit: "13.267" });
    expect(one(vi, "gold_loss").w_debit).toBe("0.367");
    const inv = one(vi, "gold_inventory");
    expect(inv.w_debit).toBe("12.9");
    expect(one(vi, "ap")).toMatchObject({ credit: "25800000", detail_id: detail.workshop });
    // piece costs share the gold cost by weight plus their own wage
    const p1 = await item(back.lines[0].gold_item_id);
    const p2 = await item(back.lines[1].gold_item_id);
    expect(D(p1.cost).plus(D(p2.cost)).toString()).toBe(inv.debit);
    const w = (await c.get(`${base}/gold/reports/parties?scope=workshop`)).rows;
    expect(w.find((r: any) => r.party_id === ids.workshop)).toBeUndefined(); // settled to zero weight
  });

  it("handles consignment: memo weights in, sale owes the consignor by weight, return", async () => {
    const cin = (await c.post(`${base}/gold/docs`, {
      kind: "consign_in", date: "2026-06-01", party_id: ids.consignor, settle: { mode: "weight" },
      lines: [
        { kind: "piece", category_id: ids.ring, weight: "6", wage_type: "percent", wage_value: "4", extra: { sale_wage_type: "percent", sale_wage_value: "20" } },
        { kind: "piece", category_id: ids.ring, weight: "3" },
      ],
    })).doc;
    const [a, b] = cin.lines;
    const ia = await item(a.gold_item_id);
    expect(ia.ownership).toBe("consignment");
    expect(ia.status).toBe("in_stock");
    expect(ia.supplier_id).toBe(ids.consignor);
    expect(ia.cost).toBeNull();
    const vm = await voucher(cin.id);
    expect(vm.total_debit).toBe("0");
    expect(one(vm, "gold_consign_memo")).toMatchObject({ w_debit: "9", debit: "0", detail_id: detail.consignor });
    expect(one(vm, "gold_consign_contra")).toMatchObject({ w_credit: "9", credit: "0" });

    const sale = (await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-02", gram18: SALE_G18,
      lines: [{ kind: "piece", gold_item_id: a.gold_item_id }],
      settle: { cash: { cash_box_id: ids.box, amount: "999999999999" } },
    }, 400)).error;
    expect(sale.message).toContain("بیشتر");
    const priced = (await c.post(`${base}/gold/calc`, { type: "doc", doc: { kind: "sale", date: "2026-06-02", gram18: SALE_G18, lines: [{ kind: "piece", gold_item_id: a.gold_item_id }] } })).result;
    const total = priced.totals.total;
    const s = (await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-02", gram18: SALE_G18,
      lines: [{ kind: "piece", gold_item_id: a.gold_item_id }],
      settle: { cash: { cash_box_id: ids.box, amount: total } },
    })).doc;
    expect(s.total).toBe(total);
    expect(s.lines[0].wage).toBe("62400000"); // 20% sale wage on 312M
    const v = await voucher(s.id);
    expect(one(v, "gold_consign_contra")).toMatchObject({ w_debit: "6", detail_id: detail.consignor });
    expect(one(v, "gold_consign_memo")).toMatchObject({ w_credit: "6", detail_id: detail.consignor });
    expect(one(v, "gold_parties")).toMatchObject({ credit: "312000000", w_credit: "6", detail_id: detail.consignor });
    expect(one(v, "ap")).toMatchObject({ credit: "12480000", detail_id: detail.consignor }); // 4% supplier wage
    expect(one(v, "gold_cogs").debit).toBe("324480000");
    expect(lines(v, "gold_inventory")).toHaveLength(0);

    const ret = (await c.post(`${base}/gold/docs`, { kind: "consign_return", date: "2026-06-03", party_id: ids.consignor, lines: [{ kind: "piece", gold_item_id: b.gold_item_id }] })).doc;
    const vr = await voucher(ret.id);
    expect(one(vr, "gold_consign_contra").w_debit).toBe("3");
    expect(one(vr, "gold_consign_memo").w_credit).toBe("3");
    expect((await item(b.gold_item_id)).status).toBe("returned");
    const parties = await c.get(`${base}/gold/reports/parties`);
    const cons = parties.rows.find((r: any) => r.party_id === ids.consignor);
    expect(cons.consign_w).toBe("0");
    expect(cons.gold_w).toBe("-6");
    // a returned consigned tag cannot be returned again
    await c.post(`${base}/gold/docs`, { kind: "consign_return", date: "2026-06-03", party_id: ids.consignor, lines: [{ kind: "piece", gold_item_id: b.gold_item_id }] }, 409);
  });

  it("costs sold coins at their moving average and refuses selling more than in stock", async () => {
    for (const [date, price] of [["2026-06-05", "150000000"], ["2026-06-06", "160000000"]]) {
      await c.post(`${base}/gold/docs`, {
        kind: "purchase", date, party_id: ids.wholesaler, settle: { mode: "rial", bank: { bank_account_id: ids.bank, amount: D(price).times(10).toString() } },
        lines: [{ kind: "coin", item_id: ids.rob, qty: "10", gram_price: price }],
      });
    }
    const coins = (await c.get(`${base}/gold/coins`)).coins;
    const rob = coins.find((x: any) => x.id === ids.rob);
    expect(rob.qty).toBe("20");
    expect(rob.avg_cost).toBe("155000000");
    expect(rob.price).toBe("170000000"); // from the rate board
    const sale = (await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-07", party_id: ids.customer,
      lines: [{ kind: "coin", item_id: ids.rob, qty: "3" }], // price from the board
    })).doc;
    expect(sale.total).toBe("510000000");
    const v = await voucher(sale.id);
    expect(one(v, "coin_sales").credit).toBe("510000000");
    expect(one(v, "coin_cogs").debit).toBe("465000000");
    expect(one(v, "coin_inventory")).toMatchObject({ credit: "465000000", qty: "3", item_id: ids.rob });
    expect(one(v, "ar").debit).toBe("510000000");
    expect(lines(v, "vat_out")).toHaveLength(0); // coins carry no VAT
    const left = (await c.get(`${base}/gold/coins`)).coins.find((x: any) => x.id === ids.rob);
    expect(left.qty).toBe("17");
    const tooMany = await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-07", party_id: ids.customer, lines: [{ kind: "coin", item_id: ids.rob, qty: "18" }] }, 400);
    expect(tooMany.error.message).toContain("کافی نیست");
  });

  it("sells bullion to a wholesaler by mazaneh and settles by weight", async () => {
    // bullion left: 26.533 (bought) + 7.847 (melt) − 13.267 (workshop) = 21.113
    const d = (await c.post(`${base}/gold/docs`, {
      kind: "bullion_sale", date: "2026-06-08", party_id: ids.wholesaler2, mazaneh: "216590000", settle: { mode: "weight" },
      lines: [{ kind: "bulk", form: "bullion", weight: "10", fineness: "995", assay_no: "ANG-77" }],
    })).doc;
    expect(d.lines[0].total).toBe(priceBullion(10, 995, "216590000", 1000));
    const v = await voucher(d.id);
    expect(one(v, "gold_sales").credit).toBe(d.lines[0].total);
    expect(one(v, "gold_parties")).toMatchObject({ debit: d.lines[0].total, w_debit: "13.267", detail_id: detail.wholesaler2 });
    expect(one(v, "gold_bullion").w_credit).toBe("13.267");
    expect(D(one(v, "gold_cogs").debit).gt(0)).toBe(true);
    const parties = await c.get(`${base}/gold/reports/parties`);
    expect(parties.rows.find((r: any) => r.party_id === ids.wholesaler2).gold_w).toBe("-21.266");
  });

  it("edits a posted purchase in place: tags and voucher number are kept", async () => {
    const d = await doc(ids.purchase2);
    const vBefore = await voucher(ids.purchase2);
    const lines = d.lines.map((l: any) => ({ ...l, wage_value: l.kind === "piece" ? "900000" : l.wage_value }));
    // the bullion of this purchase was partly used: editing still works (no tag of it is sold)
    const u = (await c.put(`${base}/gold/docs/${ids.purchase2}`, { kind: "purchase", date: d.date, party_id: d.party_id, gram18: d.gram18, settle: { mode: "weight", cash: { cash_box_id: ids.box, amount: "2400000" } }, lines })).doc;
    expect(u.lines[0].tag_no).toBe("100003");
    expect(u.lines[0].gold_item_id).toBe(d.lines[0].gold_item_id);
    expect(u.lines[0].wage).toBe("7200000");
    const vAfter = await voucher(ids.purchase2);
    expect(vAfter.id).toBe(vBefore.id);
    expect(vAfter.no).toBe(vBefore.no);
    expect(one(vAfter, "ap").credit).toBe("4800000");
  });

  it("reports stock, sales and the dashboard summary", async () => {
    const stock = await c.get(`${base}/gold/reports/stock`);
    // in stock: necklace 4.5 (purchase 1), ring 8 (purchase 2), workshop pieces 7 + 5.9; consigned pieces are out
    expect(stock.totals.count).toBe(4);
    expect(stock.totals.w750).toBe("25.4");
    expect(stock.check.ledger_w).toBe("25.4");
    expect(stock.check.diff).toBe("0");
    expect(stock.rate.gram18).toBe(SALE_G18);
    expect(stock.coins.find((x: any) => x.id === ids.rob).qty).toBe("17");

    const sales = await c.get(`${base}/gold/reports/sales?from=2026-05-01&to=2026-06-30`);
    expect(sales.totals.docs).toBe(3); // ring sale, consigned sale, coins
    expect(sales.totals.weight750).toBe("16");
    expect(sales.totals.coin_qty).toBe("3");
    expect(sales.totals.old_weight750).toBe("3");
    const byDoc = await c.get(`${base}/gold/reports/sales?from=2026-05-01&to=2026-06-30&group=doc`);
    expect(byDoc.rows).toHaveLength(3);
    const first = byDoc.rows[0];
    expect(first.gold_value).toBe("520000000");
    expect(first.wage).toBe("93600000");
    expect(first.profit).toBe("42952000");
    expect(first.tax).toBe("13655000");
    expect(first.total).toBe("670207000");
    expect(first.cost).toBe("525000000");
    const byMonth = await c.get(`${base}/gold/reports/sales?from=2026-05-01&to=2026-06-30&group=month`);
    expect(byMonth.rows.length).toBeGreaterThanOrEqual(2);

    const sum = await c.get(`${base}/gold/summary`);
    expect(sum.rate.rate.gram18).toBe(SALE_G18);
    expect(sum.stock.pieces).toBe(4);
    expect(sum.sales_today).toBeTruthy();

    const list = await c.get(`${base}/gold/docs?kind=sale`);
    expect(list.rows.every((r: any) => r.kind === "sale")).toBe(true);
    const items = await c.get(`${base}/gold/items?status=in_stock&min_weight=5`);
    expect(items.rows.map((r: any) => r.net_weight).sort()).toEqual(["5.9", "7", "8"]);
    expect(items.sums.n).toBe(3);
  });

  it("creates tags in bulk and posts opening stock", async () => {
    const r = await c.post(`${base}/gold/items/bulk`, { defaults: { category_id: ids.ring, fineness: "750" }, items: [{ gross_weight: "2.1" }, { gross_weight: "3.4", stone_weight: "0.4" }] });
    expect(r.count).toBe(2);
    expect(r.tags).toEqual(["100008", "100009"]);
    const op = (await c.post(`${base}/gold/docs`, {
      kind: "opening", date: "2026-03-21", gram18: G18,
      lines: [
        { kind: "piece", category_id: ids.necklace, weight: "6", cost: "300000000" },
        { kind: "bulk", form: "old", weight: "2", cost: "90000000" },
      ],
    })).doc;
    const v = await voucher(op.id);
    expect(one(v, "gold_inventory")).toMatchObject({ debit: "300000000", w_debit: "6" });
    expect(one(v, "gold_old")).toMatchObject({ debit: "90000000", w_debit: "2" });
    expect(one(v, "opening_balance").credit).toBe("390000000");
  });

  it("pays the customer when the traded-in gold is worth more than the purchase", async () => {
    const tag = (await c.get(`${base}/gold/items/by-tag/100008`)).item; // 2.1 g, created without a voucher
    const d = (await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-20", gram18: SALE_G18, party_id: ids.customer,
      lines: [{ kind: "piece", gold_item_id: tag.id }, { kind: "old", weight: "10", fineness: "750" }],
      settle: { cash: { cash_box_id: ids.box, amount: "300000000" } },
    })).doc;
    const net = D(d.total).minus(D(d.old_value));
    expect(net.isNeg()).toBe(true);
    expect(d.settle.remaining).toBe(net.abs().minus(300000000).toString());
    const v = await voucher(d.id);
    expect(one(v, "cash").credit).toBe("300000000"); // money goes to the customer
    expect(one(v, "ar")).toMatchObject({ credit: d.settle.remaining, detail_id: detail.customer });
    expect(one(v, "gold_old")).toMatchObject({ debit: "520000000", w_debit: "10" });
    // no cost on the tag: the average of «موجودی مصنوعات» in the ledger is used
    expect(D(one(v, "gold_inventory").credit).gt(0)).toBe(true);
    // a card reader cannot pay the customer
    const card = await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-20", gram18: SALE_G18, party_id: ids.customer,
      lines: [{ kind: "piece", gold_item_id: (await c.get(`${base}/gold/items/by-tag/100009`)).item.id }, { kind: "old", weight: "20" }],
      settle: { pos: { pos_id: ids.pos, amount: "1000" } },
    }, 400);
    expect(card.error.message).toContain("کارتخوان");
  });

  it("deletes a posted sale and puts its piece back in stock", async () => {
    const it = (await c.get(`${base}/gold/items/by-tag/100009`)).item;
    const d = (await c.post(`${base}/gold/docs`, { kind: "sale", date: "2026-06-21", gram18: SALE_G18, party_id: ids.customer, lines: [{ kind: "piece", gold_item_id: it.id }] })).doc;
    const vid = d.voucher.id;
    expect((await item(it.id)).status).toBe("sold");
    await c.del(`${base}/gold/docs/${d.id}`);
    expect((await item(it.id)).status).toBe("in_stock");
    await c.get(`/o/${org}/accounting/vouchers/${vid}`, 404);
  });

  it("settles a consignment in rial: the consignor is owed gold value and wage", async () => {
    const cin = (await c.post(`${base}/gold/docs`, {
      kind: "consign_in", date: "2026-06-22", party_id: ids.consignor, settle: { mode: "rial" },
      lines: [{ kind: "piece", category_id: ids.necklace, weight: "5", wage_type: "per_gram", wage_value: "1000000" }],
    })).doc;
    const s = (await c.post(`${base}/gold/docs`, {
      kind: "sale", date: "2026-06-23", gram18: SALE_G18, party_id: ids.customer, lines: [{ kind: "piece", gold_item_id: cin.lines[0].gold_item_id }],
    })).doc;
    const v = await voucher(s.id);
    expect(one(v, "ap")).toMatchObject({ credit: "265000000", detail_id: detail.consignor }); // 5 × 52M + 5 × 1M
    expect(lines(v, "gold_parties")).toHaveLength(0);
    expect(one(v, "gold_cogs").debit).toBe("265000000");
  });

  it("melts a tagged piece together with used gold", async () => {
    const piece = (await c.get(`${base}/gold/items/by-tag/100004`)).item; // workshop ring, 7 g with cost
    const d = (await c.post(`${base}/gold/docs`, {
      kind: "melt", date: "2026-06-24",
      lines: [
        { kind: "piece", direction: "out", gold_item_id: piece.id },
        { kind: "bulk", direction: "in", form: "bullion", weight: "6.95", fineness: "750", assay_no: "M-9" },
      ],
    })).doc;
    expect((await item(piece.id)).status).toBe("melted");
    const v = await voucher(d.id);
    expect(one(v, "gold_inventory")).toMatchObject({ credit: piece.cost, w_credit: "7" });
    expect(one(v, "gold_loss").w_debit).toBe("0.05");
    expect(D(one(v, "gold_bullion").debit).plus(D(one(v, "gold_loss").debit)).toString()).toBe(piece.cost);
    // cancelling the melt puts the piece back
    await c.post(`${base}/gold/docs/${d.id}/cancel`);
    expect((await item(piece.id)).status).toBe("in_stock");
  });

  it("prices with the calculator, finds tags with leading zeros and reserves pieces", async () => {
    const calc = (await c.post(`${base}/gold/calc`, { type: "jewelry", weight: "10", gram18: G18, wage_type: "percent", wage_value: "18" })).result;
    expect(calc.total).toBe("644430000");
    const old = (await c.post(`${base}/gold/calc`, { type: "old", weight: "5", fineness: "740", gram18: G18, deduction_pct: "2" })).result;
    expect(old.total).toBe("241717000");
    const z = await c.get(`${base}/gold/items/by-tag/0100005`);
    expect(z.item.tag_no).toBe("100005");
    const r = (await c.post(`${base}/gold/items/${z.item.id}/reserve`, { note: "برای خانم احمدی" })).item;
    expect(r.status).toBe("reserved");
    await c.post(`${base}/gold/items/${z.item.id}/reserve`, {}, 409);
    expect((await c.post(`${base}/gold/items/${z.item.id}/release`)).item.status).toBe("in_stock");
    const parties = (await c.get(`${base}/gold/reports/parties`)).rows;
    expect(parties.find((p: any) => p.party_id === ids.wholesaler2).code).toBe("1003"); // the party's own code, not the detail's
  });

  it("refuses gold endpoints when the module is off and checks permissions", async () => {
    const s = await makeServer();
    const c2 = new Client(s.app);
    const o2 = await signupWithOrg(c2, ["goods"], "trading");
    const r = await c2.get(`/o/${o2}/gold/summary`, 403);
    expect(r.error.message).toContain("طلا");
  });
});
