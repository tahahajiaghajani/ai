import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import type { Db } from "@server/db";
import { D } from "@shared/money";
import { calcInvoice, allocate } from "@server/modules/goods/calc";
import { verhoeff } from "@server/modules/goods/moadian";

interface VLine {
  key: string | null;
  debit: string;
  credit: string;
  detail_id: string | null;
}

describe("goods: invoices, stock, costing and reports", () => {
  let c: Client;
  let app: Awaited<ReturnType<typeof makeServer>>["app"];
  let db: Db;
  let org: string;
  let wh: string;
  let unit: string;
  let supplier: { id: string; detail_id: string };
  let customer: { id: string; detail_id: string };

  const o = (p: string) => `/o/${org}/goods${p}`;

  async function item(name: string, extra: Record<string, unknown> = {}) {
    const r = await c.post(`/o/${org}/data/item`, { name, kind: "goods", unit_id: unit, vat_pct: "0", ...extra });
    return r.row.id as string;
  }
  async function voucher(type: string, id: string): Promise<VLine[]> {
    return db.query<VLine>(
      `select a.system_key as key, l.debit, l.credit, l.detail_id from tz_voucher_lines l
       join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
       where v.source_type = $1 and v.source_id = $2 and v.deleted_at is null order by l.line_no`,
      [type, id],
    );
  }
  const dr = (lines: VLine[], key: string) => lines.filter((l) => l.key === key).reduce((a, l) => a.plus(D(l.debit)), D(0)).toString();
  const cr = (lines: VLine[], key: string) => lines.filter((l) => l.key === key).reduce((a, l) => a.plus(D(l.credit)), D(0)).toString();
  const balanced = (lines: VLine[]) => lines.reduce((a, l) => a.plus(D(l.debit)).minus(D(l.credit)), D(0)).isZero();
  async function stock(itemId: string) {
    return db.one<{ q: string; v: string }>(`select coalesce(sum(qty), 0) as q, coalesce(sum(value), 0) as v from tz_stock_moves where item_id = $1`, [itemId]);
  }
  async function cogsOf(invoiceId: string) {
    const r = await db.one<{ v: string }>(`select coalesce(-sum(value), 0) as v from tz_stock_moves where source_id = $1`, [invoiceId]);
    return D(r!.v).toString();
  }
  const sale = (date: string, itemId: string, qty: string, price: string, extra: Record<string, unknown> = {}) =>
    c.post(o("/invoices"), { kind: "sale", date, party_id: customer.id, lines: [{ item_id: itemId, qty, unit_price: price, vat_pct: "0" }], ...extra });
  const purchase = (date: string, itemId: string, qty: string, price: string, extra: Record<string, unknown> = {}) =>
    c.post(o("/invoices"), { kind: "purchase", date, party_id: supplier.id, lines: [{ item_id: itemId, qty, unit_price: price, vat_pct: "0" }], ...extra });

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    app = s.app;
    c = new Client(app);
    org = await signupWithOrg(c, ["goods"], "trading");
    wh = (await db.one<{ id: string }>(`select id from tz_warehouses where org_id = $1`, [org]))!.id;
    unit = (await db.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد'`, [org]))!.id;
    supplier = (await c.post(`/o/${org}/data/party`, { name: "پخش البرز", roles: ["supplier"] })).row;
    customer = (await c.post(`/o/${org}/data/party`, { name: "فروشگاه نیک", roles: ["customer"] })).row;
  });

  it("calculates lines, discounts and VAT exactly", () => {
    const r = calcInvoice({
      lines: [
        { qty: "3", unit_price: "1000", discount_pct: "10", vat_pct: "10" },
        { qty: "1", unit_price: "700", discount: "0", vat_pct: "0" },
      ],
      discount: "100",
      additions: "50",
      deductions: "20",
    });
    expect(r.subtotal).toBe("3700");
    expect(r.line_discount).toBe("300");
    // header discount 100 over 2700 and 700 → 79 + 21
    expect(r.lines.map((l) => l.header_discount)).toEqual(["79", "21"]);
    expect(r.lines[0].vat).toBe("262"); // (2700 − 79) × 10%
    expect(r.tax).toBe("262");
    expect(r.total).toBe(D(3700 - 300 - 100 + 262 + 50 - 20).toString());
    expect(allocate("10", ["1", "1", "1"])).toEqual(["4", "3", "3"]);
    expect(allocate("-7", ["2", "1"])).toEqual(["-5", "-2"]);
    expect(verhoeff("236")).toBe(3);
  });

  it("posts a purchase then a sale with the right vouchers and stock", async () => {
    const a = await item("گوشی آزمایشی", { vat_pct: "10" });
    const p = await c.post(o("/invoices"), {
      kind: "purchase",
      date: "2026-04-01",
      party_id: supplier.id,
      ref_no: "F-77",
      lines: [{ item_id: a, qty: "10", unit_price: "1000000" }],
    });
    expect(p.invoice.status).toBe("posted");
    expect(p.invoice.total).toBe("11000000");
    const pv = await voucher("invoice", p.invoice.id);
    expect(balanced(pv)).toBe(true);
    expect(dr(pv, "inventory")).toBe("10000000");
    expect(dr(pv, "vat_in")).toBe("1000000");
    expect(cr(pv, "ap")).toBe("11000000");
    expect(pv.find((l) => l.key === "ap")!.detail_id).toBe(supplier.detail_id);

    const s = await c.post(o("/invoices"), {
      kind: "sale",
      date: "2026-04-02",
      party_id: customer.id,
      lines: [{ item_id: a, qty: "4", unit_price: "1500000", discount_pct: "10" }],
    });
    expect(s.invoice.total).toBe("5940000");
    const sv = await voucher("invoice", s.invoice.id);
    expect(balanced(sv)).toBe(true);
    expect(dr(sv, "ar")).toBe("5940000");
    expect(sv.find((l) => l.key === "ar")!.detail_id).toBe(customer.detail_id);
    expect(dr(sv, "sales_discounts")).toBe("600000");
    expect(cr(sv, "sales")).toBe("6000000");
    expect(cr(sv, "vat_out")).toBe("540000");
    expect(dr(sv, "cogs")).toBe("4000000");
    expect(cr(sv, "inventory")).toBe("4000000");
    expect(await stock(a)).toEqual({ q: "6", v: "6000000" });

    const got = (await c.get(o(`/invoices/${s.invoice.id}`))).invoice;
    expect(got.lines[0].cost).toBe("4000000");
    expect(got.gross_profit).toBe("1400000");
    expect(got.remaining).toBe("5940000");
    expect(got.buyer.name).toBe("فروشگاه نیک");

    const list = await c.get(o("/invoices?kind=sale"));
    expect(list.total).toBe(1);
    expect(list.rows[0].party_name).toBe("فروشگاه نیک");

    // a sale without a party goes to the walk-in customer (code 1000)
    const noParty = await c.post(o("/invoices"), { kind: "sale", date: "2026-04-02", lines: [{ item_id: a, qty: "1", unit_price: "1600000", vat_pct: "0" }] });
    expect((await db.one<{ code: string }>(`select p.code from tz_invoices i join tz_parties p on p.id = i.party_id where i.id = $1`, [noParty.invoice.id]))!.code).toBe("1000");
    await c.del(o(`/invoices/${noParty.invoice.id}`));
    expect(await stock(a)).toEqual({ q: "6", v: "6000000" });
  });

  it("keeps a moving average and recomputes costs after a back-dated purchase", async () => {
    const b = await item("کالای میانگین");
    await purchase("2026-04-01", b, "10", "100");
    const s1 = await sale("2026-04-10", b, "5", "200");
    expect(await cogsOf(s1.invoice.id)).toBe("500");
    const p2 = await purchase("2026-04-20", b, "5", "160");
    const s2 = await sale("2026-04-25", b, "4", "200");
    expect(await cogsOf(s2.invoice.id)).toBe("520"); // (500 + 800) / 10 × 4
    expect(await stock(b)).toEqual({ q: "6", v: "780" });

    const revBefore = (await db.one<{ rev: number }>(`select rev from tz_invoices where id = $1`, [s2.invoice.id]))!.rev;
    // back-dated purchase between P1 and S1
    await purchase("2026-04-05", b, "10", "130");
    expect(await cogsOf(s1.invoice.id)).toBe("575"); // 2300 / 20 × 5
    expect(await cogsOf(s2.invoice.id)).toBe("505"); // (1725 + 800) / 20 × 4
    expect(await stock(b)).toEqual({ q: "16", v: "2020" });
    // the vouchers of both later sales were refreshed and their roots touched for sync
    expect(dr(await voucher("invoice", s1.invoice.id), "cogs")).toBe("575");
    expect(dr(await voucher("invoice", s2.invoice.id), "cogs")).toBe("505");
    const revAfter = (await db.one<{ rev: number }>(`select rev from tz_invoices where id = $1`, [s2.invoice.id]))!.rev;
    expect(revAfter).toBeGreaterThan(revBefore);

    // kardex: running quantity and value
    const k = await c.get(o(`/reports/kardex?item_id=${b}`));
    expect(k.rows.map((r: any) => r.balance_qty)).toEqual(["10", "20", "15", "20", "16"]);
    expect(k.totals.value).toBe("2020");
    expect(k.rows[2].out_value).toBe("575");

    // stock balance report
    const st = await c.get(o(`/reports/stock?q=${encodeURIComponent("کالای میانگین")}`));
    expect(st.rows[0].qty).toBe("16");
    expect(st.rows[0].avg_cost).toBe("126");
    expect(st.rows[0].value).toBe("2020");

    // a full rebuild finds nothing to change
    const re = await c.post(o("/costing/recompute"), { item_id: b });
    expect(re.documents).toBe(0);
    void p2;
  });

  it("handles sale and purchase returns", async () => {
    const r = await item("کالای برگشتی");
    const p = await purchase("2026-05-01", r, "10", "100");
    await purchase("2026-05-02", r, "10", "160"); // average 130
    const s = await sale("2026-05-03", r, "5", "300"); // cost 650
    expect(await cogsOf(s.invoice.id)).toBe("650");

    const ret = await c.get(o(`/invoices/${s.invoice.id}/returnable`));
    expect(ret.lines[0].remaining).toBe("5");

    // more than sold → refused
    const tooMuch = await c.post(o("/invoices"), { kind: "sale_return", date: "2026-05-04", ref_invoice_id: s.invoice.id, lines: [{ item_id: r, qty: "6" }] }, 400);
    expect(tooMuch.error.message).toContain("بیشتر از باقی‌مانده");

    // a later purchase changes the average, but the return comes back at the original cost (130)
    await purchase("2026-05-04", r, "5", "400");
    const sr = await c.post(o("/invoices"), { kind: "sale_return", date: "2026-05-05", ref_invoice_id: s.invoice.id, lines: [{ item_id: r, qty: "2" }] });
    const srv = await voucher("invoice", sr.invoice.id);
    expect(balanced(srv)).toBe(true);
    expect(dr(srv, "sales_returns")).toBe("600"); // original price 300 × 2
    expect(cr(srv, "ar")).toBe("600");
    expect(dr(srv, "inventory")).toBe("260");
    expect(cr(srv, "cogs")).toBe("260");
    expect((await c.get(o(`/invoices/${s.invoice.id}/returnable`))).lines[0].remaining).toBe("3");

    // purchase return at the original purchase price
    const pr = await c.post(o("/invoices"), { kind: "purchase_return", date: "2026-05-06", ref_invoice_id: p.invoice.id, lines: [{ item_id: r, qty: "3" }] });
    const prv = await voucher("invoice", pr.invoice.id);
    expect(balanced(prv)).toBe(true);
    expect(dr(prv, "ap")).toBe("300");
    expect(cr(prv, "inventory")).toBe("300");
    // 10×100 + 10×160 − 650 + 5×400 + 260 − 300 = 3910 for 19 units
    expect(await stock(r)).toEqual({ q: "19", v: "3910" });

    // the original invoice cannot be deleted while it has returns
    await c.del(o(`/invoices/${s.invoice.id}`), 409);
    // returns follow the original's cost when it changes
    await purchase("2026-04-28", r, "10", "70");
    // S: (700 + 1000 + 1600) / 30 × 5 = 550 → return 2 × 110 = 220
    expect(await cogsOf(s.invoice.id)).toBe("550");
    expect(dr(await voucher("invoice", sr.invoice.id), "inventory")).toBe("220");
  });

  it("posts stock counts and re-derives them after a back-dated change", async () => {
    const x = await item("کالای شمارشی");
    await purchase("2026-06-01", x, "10", "50");
    const sheet = await c.get(o(`/stock-docs/count-sheet?warehouse_id=${wh}&date=2026-06-10`));
    expect(sheet.rows.find((r: any) => r.item_id === x).system_qty).toBe("10");
    const count = await c.post(o("/stock-docs"), { kind: "count", date: "2026-06-10", warehouse_id: wh, lines: [{ item_id: x, counted_qty: "8" }] });
    let doc = (await c.get(o(`/stock-docs/${count.doc.id}`))).doc;
    expect(doc.lines[0].system_qty).toBe("10");
    expect(doc.lines[0].qty).toBe("-2");
    let v = await voucher("stock_doc", count.doc.id);
    expect(dr(v, "inventory_loss")).toBe("100");
    expect(cr(v, "inventory")).toBe("100");
    expect(await stock(x)).toEqual({ q: "8", v: "400" });

    // a sale dated before the count: the count now finds a surplus of 1
    await sale("2026-06-05", x, "3", "90");
    doc = (await c.get(o(`/stock-docs/${count.doc.id}`))).doc;
    expect(doc.lines[0].system_qty).toBe("7");
    expect(doc.lines[0].qty).toBe("1");
    v = await voucher("stock_doc", count.doc.id);
    expect(dr(v, "inventory")).toBe("50");
    expect(cr(v, "inventory_gain")).toBe("50");
    expect(await stock(x)).toEqual({ q: "8", v: "400" });

    // receipt (opening stock), transfer and issue
    const wh2 = (await c.post(`/o/${org}/data/warehouse`, { name: "انبار شعبه" })).row.id;
    const rc = await c.post(o("/stock-docs"), { kind: "receipt", date: "2026-06-11", warehouse_id: wh, lines: [{ item_id: x, qty: "2", unit_cost: "50" }] });
    v = await voucher("stock_doc", rc.doc.id);
    expect(dr(v, "inventory")).toBe("100");
    expect(cr(v, "opening_balance")).toBe("100");
    const tr = await c.post(o("/stock-docs"), { kind: "transfer", date: "2026-06-12", warehouse_id: wh, dest_warehouse_id: wh2, lines: [{ item_id: x, qty: "4" }] });
    expect(await voucher("stock_doc", tr.doc.id)).toEqual([]);
    const byWh = await c.get(o(`/reports/stock?by=warehouse&item_id=${x}`));
    expect(byWh.rows.map((r: any) => r.qty).sort()).toEqual(["4", "6"]);
    const is = await c.post(o("/stock-docs"), { kind: "issue", date: "2026-06-13", warehouse_id: wh2, lines: [{ item_id: x, qty: "1" }] });
    v = await voucher("stock_doc", is.doc.id);
    expect(dr(v, "misc_expense")).toBe("50");
    expect(cr(v, "inventory")).toBe("50");
    const tooMuch = await c.post(o("/stock-docs"), { kind: "issue", date: "2026-06-13", warehouse_id: wh2, lines: [{ item_id: x, qty: "4" }] }, 400);
    expect(tooMuch.error.message).toContain("کافی نیست");

    // kardex of one warehouse
    const kw = await c.get(o(`/reports/kardex?item_id=${x}&warehouse_id=${wh2}&from=2026-06-12`));
    expect(kw.opening.qty).toBe("0");
    expect(kw.rows.map((r: any) => r.balance_qty)).toEqual(["4", "3"]);

    // deleting the issue gives the stock back and removes its voucher
    await c.del(o(`/stock-docs/${is.doc.id}`));
    expect(await voucher("stock_doc", is.doc.id)).toEqual([]);
    expect((await stock(x))!.q).toBe("10");

    // a draft count keeps its figures but does not touch the stock
    const draft = await c.post(o("/stock-docs"), { kind: "count", status: "draft", date: "2026-06-20", warehouse_id: wh, lines: [{ item_id: x, counted_qty: "1" }] });
    const dd = (await c.get(o(`/stock-docs/${draft.doc.id}`))).doc;
    expect(dd.lines[0].system_qty).toBe("6");
    expect(dd.lines[0].qty).toBe("-5");
    expect((await stock(x))!.q).toBe("10");
    await c.del(o(`/stock-docs/${draft.doc.id}`));
  });

  it("refuses negative stock unless allowed", async () => {
    const n = await item("کالای کمیاب");
    await purchase("2026-07-01", n, "2", "100");
    const r = await sale("2026-07-02", n, "3", "150").catch(() => null);
    expect(r).toBeNull();
    const e = await c.post(o("/invoices"), { kind: "sale", date: "2026-07-02", party_id: customer.id, lines: [{ item_id: n, qty: "3", unit_price: "150", vat_pct: "0" }] }, 400);
    expect(e.error.message).toContain("کافی نیست");
    // deleting the purchase of goods already sold is refused too
    const p = await purchase("2026-07-03", n, "5", "100");
    await sale("2026-07-04", n, "6", "150");
    const del = await c.del(o(`/invoices/${p.invoice.id}`), 400);
    expect(del.error.message).toContain("کافی نیست");
    // an item that may go negative
    const free = await item("کالای پیش‌فروش", { allow_negative: true });
    const ok = await sale("2026-07-05", free, "2", "100");
    expect(ok.invoice.status).toBe("posted");
  });

  it("converts a quote into an invoice and never posts quotes", async () => {
    const q1 = await item("کالای پیش‌فاکتور", { sale_price: "250" });
    await purchase("2026-08-01", q1, "10", "100");
    await c.post(o("/invoices"), { kind: "quote", status: "posted", date: "2026-08-02", party_id: customer.id, lines: [{ item_id: q1, qty: "1" }] }, 400);
    const q = await c.post(o("/invoices"), { kind: "quote", date: "2026-08-02", due_date: "2026-08-12", party_id: customer.id, lines: [{ item_id: q1, qty: "3", vat_pct: "10" }] });
    expect(q.invoice.status).toBe("draft");
    expect(q.invoice.total).toBe("825"); // the item's sale price
    const conv = await c.post(o(`/invoices/${q.invoice.id}/convert`), { date: "2026-08-03" });
    expect(conv.invoice.kind).toBe("sale");
    expect(conv.invoice.total).toBe("825");
    const quote = (await c.get(o(`/invoices/${q.invoice.id}`))).invoice;
    expect(quote.converted_to.id).toBe(conv.invoice.id);
    await c.post(o(`/invoices/${q.invoice.id}/convert`), {}, 409);
    const posted = await c.post(o(`/invoices/${conv.invoice.id}/post`));
    expect(posted.invoice.status).toBe("posted");
    expect(await cogsOf(conv.invoice.id)).toBe("300");
    // back to draft removes stock moves and the voucher
    await c.post(o(`/invoices/${conv.invoice.id}/unpost`));
    expect(await cogsOf(conv.invoice.id)).toBe("0");
    expect(await voucher("invoice", conv.invoice.id)).toEqual([]);
    // deleting the invoice opens the quote again
    await c.del(o(`/invoices/${conv.invoice.id}`));
    expect((await c.get(o(`/invoices/${q.invoice.id}`))).invoice.converted_to).toBeNull();

    // cancelling (ابطال) a posted sale removes its effects and freezes it
    const s = await sale("2026-08-04", q1, "1", "250");
    await c.post(o(`/invoices/${s.invoice.id}/cancel`));
    expect((await c.get(o(`/invoices/${s.invoice.id}`))).invoice.status).toBe("cancelled");
    expect(await voucher("invoice", s.invoice.id)).toEqual([]);
    expect(await cogsOf(s.invoice.id)).toBe("0");
    await c.put(o(`/invoices/${s.invoice.id}`), { kind: "sale", date: "2026-08-04", party_id: customer.id, lines: [{ item_id: q1, qty: "1", unit_price: "250" }] }, 409);
  });

  it("checks permissions per area", async () => {
    await c.post(`/o/${org}/members`, { email: "seller@example.com", full_name: "فروشنده آزمایشی", role: "sales", password: "s3cret-pass-2" });
    const s = new Client(app);
    await s.post("/auth/login", { email: "seller@example.com", password: "s3cret-pass-2" });
    const it = await db.one<{ id: string }>(`select id from tz_items where org_id = $1 and name = 'کالای پیش‌فروش'`, [org]);
    const ok = await s.post(o("/invoices"), { kind: "quote", date: "2026-08-05", party_id: customer.id, lines: [{ item_id: it!.id, qty: "1", unit_price: "100" }] });
    expect(ok.invoice.kind).toBe("quote");
    await s.post(o("/invoices"), { kind: "purchase", date: "2026-08-05", party_id: supplier.id, lines: [{ item_id: it!.id, qty: "1", unit_price: "100" }] }, 403);
    await s.get(o("/invoices?kind=purchase"), 403);
    await s.post(o("/stock-docs"), { kind: "receipt", date: "2026-08-05", warehouse_id: wh, lines: [{ item_id: it!.id, qty: "1", unit_cost: "1" }] }, 403);
    // the sales role may look items up (with stock) for its invoices, but not delete invoices
    expect((await s.get(o(`/items/lookup?q=${encodeURIComponent("پیش‌فروش")}&invoice_kind=sale`))).rows).toHaveLength(1);
    await s.del(o(`/invoices/${ok.invoice.id}`), 403);
  });

  it("prices from price lists, header discounts, additions and the e-invoice payload", async () => {
    const pl = await item("کالای فهرست", { sale_price: "1000", vat_pct: "10", tax_goods_id: "2720000123456" });
    await purchase("2026-09-01", pl, "20", "500");
    const list = (await c.post(`/o/${org}/data/price_list`, { name: "عمده‌فروشی" })).row;
    await c.put(o(`/price-lists/${list.id}/items`), { items: [{ item_id: pl, price: "900" }, { item_id: pl, price: "850", min_qty: "10" }] });
    expect((await c.get(o(`/price-lists/${list.id}/items`))).rows).toHaveLength(2);
    const vip = (await c.post(`/o/${org}/data/party`, { name: "مشتری عمده", price_list_id: list.id, national_id: "0012345679", postal_code: "1234567890" })).row;
    const look = await c.get(o(`/items/lookup?q=${encodeURIComponent("کالای فهرست")}&invoice_kind=sale&party_id=${vip.id}`));
    expect(look.rows[0].price).toBe("900");
    expect(look.rows[0].stock).toBe("20");
    const prices = await c.get(o(`/prices?kind=sale&party_id=${vip.id}&items=${pl}&qty=12`));
    expect(prices.prices[pl].price).toBe("850");

    const inv = await c.post(o("/invoices"), {
      kind: "sale",
      date: "2026-09-02",
      party_id: vip.id,
      discount: "500",
      additions: "200",
      lines: [{ item_id: pl, qty: "5" }],
    });
    // 5 × 900 = 4500 − 500 = 4000 + 10% VAT + 200 freight
    expect(inv.invoice.total).toBe("4600");
    const v = await voucher("invoice", inv.invoice.id);
    expect(balanced(v)).toBe(true);
    expect(cr(v, "sales")).toBe("4500");
    expect(dr(v, "sales_discounts")).toBe("500");
    expect(cr(v, "vat_out")).toBe("400");
    expect(cr(v, "invoice_additions")).toBe("200");

    const m = await c.get(o(`/invoices/${inv.invoice.id}/moadian`));
    expect(m.header.inty).toBe(1);
    expect(m.header.bid).toBe("0012345679");
    expect(m.header.tprdis).toBe(4500);
    expect(m.header.tdis).toBe(500);
    expect(m.header.tvam).toBe(400);
    expect(m.header.tbill).toBe(4400);
    expect(m.body[0].sstid).toBe("2720000123456");
    expect(m.body[0].vra).toBe(10);

    // a full return reproduces the original net and VAT exactly (invoice discount spread over lines)
    const rl = await c.get(o(`/invoices/${inv.invoice.id}/returnable`));
    const back = await c.post(o("/invoices"), {
      kind: "sale_return",
      date: "2026-09-04",
      ref_invoice_id: inv.invoice.id,
      lines: rl.lines.map((l: any) => ({ item_id: l.item_id, qty: l.remaining, unit_id: l.unit_id, unit_price: l.unit_price, discount_pct: l.discount_pct, vat_pct: l.vat_pct })),
    });
    expect(back.invoice.total).toBe("4400");
    expect(cr(await voucher("invoice", back.invoice.id), "ar")).toBe("4400");

    // purchase additions go into the inventory cost
    const p = await c.post(o("/invoices"), { kind: "purchase", date: "2026-09-03", party_id: supplier.id, additions: "100", lines: [{ item_id: pl, qty: "2", unit_price: "500", vat_pct: "0" }] });
    expect(dr(await voucher("invoice", p.invoice.id), "inventory")).toBe("1100");
  });

  it("reports sales and the dashboard summary", async () => {
    const r = await c.get(o("/reports/sales?group=item&from=2026-04-01&to=2026-04-30"));
    const b = r.rows.find((x: any) => x.label === "کالای میانگین");
    expect(b.qty).toBe("9");
    expect(b.amount).toBe("1800");
    expect(b.cost).toBe("1080"); // 575 + 505
    expect(b.profit).toBe("720");
    const byMonth = await c.get(o("/reports/sales?group=month&from=2026-03-21&to=2027-03-20"));
    expect(byMonth.rows.length).toBeGreaterThan(1);
    const pur = await c.get(o("/reports/purchases?group=party"));
    expect(pur.rows[0].label).toBe("پخش البرز");
    const sum = await c.get(o("/summary"));
    expect(sum).toHaveProperty("month_sales");
    expect(Array.isArray(sum.top_items)).toBe(true);
    const docs = await c.get(o("/stock-docs?kind=count"));
    expect(docs.total).toBe(1);
  });
});

describe("goods: sync of documents changed by the costing run (desktop)", () => {
  it("queues the later sale and its voucher when a back-dated purchase changes their cost", async () => {
    const { app, db } = await makeServer({ mode: "desktop" });
    const c = new Client(app);
    const org = await signupWithOrg(c, ["goods"], "trading");
    const unit = (await db.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد'`, [org]))!.id;
    const item = (await c.post(`/o/${org}/data/item`, { name: "کالای همگام", kind: "goods", unit_id: unit, vat_pct: "0" })).row.id;
    const line = (qty: string, price: string) => [{ item_id: item, qty, unit_price: price }];
    await c.post(`/o/${org}/goods/invoices`, { kind: "purchase", date: "2026-05-10", lines: line("10", "100") });
    const sale = await c.post(`/o/${org}/goods/invoices`, { kind: "sale", date: "2026-05-20", lines: line("5", "300") });
    await db.query(`delete from tz_outbox`);
    const p0 = await c.post(`/o/${org}/goods/invoices`, { kind: "purchase", date: "2026-05-01", lines: line("10", "160") });
    const out = await db.query<{ entity: string; id: string }>(`select entity, id from tz_outbox`);
    const has = (entity: string, id: string) => out.some((o) => o.entity === entity && o.id === id);
    expect(has("invoice", p0.invoice.id)).toBe(true);
    expect(has("invoice", sale.invoice.id)).toBe(true); // its moves were revalued (avg 130)
    const v = await db.one<{ id: string }>(`select id from tz_vouchers where source_type = 'invoice' and source_id = $1 and deleted_at is null`, [sale.invoice.id]);
    expect(has("voucher", v!.id)).toBe(true);
    const cogs = await db.one<{ v: string }>(`select -sum(value) as v from tz_stock_moves where source_id = $1`, [sale.invoice.id]);
    expect(D(cogs!.v).toString()).toBe("650");
  });
});
