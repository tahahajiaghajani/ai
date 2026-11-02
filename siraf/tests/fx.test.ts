// Exchange module: deals (buy/sell/exchange) with average cost and realized profit, fees, KYC,
// remittances out/in with their status machine, revaluation, market rates, wallet balances on
// TRON/EVM/BTC (network stubbed) and reports.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, accountId } from "./helpers";
import type { Db } from "@server/db";
import { D } from "@shared/money";

// ---------------------------------------------------------------- network stub
const TRON_ADDR = "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G";
const ETH_ADDR = "0x28C6c06298d514Db089934071355E5743bf21d60";
const BTC_ADDR = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const calls: string[] = [];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

async function stubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  if (url.startsWith("https://api.kucoin.com/api/v1/market/allTickers")) {
    return json({ code: "200000", data: { time: 1, ticker: [
      { symbol: "BTC-USDT", last: "78000", buy: "77999", sell: "78001", changeRate: "0.0125" },
      { symbol: "ETH-USDT", last: "2300", changeRate: "-0.02" },
      { symbol: "USDT-USDC", last: "1", changeRate: "0" },
    ] } });
  }
  if (url.startsWith("https://www.okx.com/")) return json({ code: "0", data: [{ instId: "TRX-USDT", last: "0.3", open24h: "0.3" }] });
  if (url.startsWith("https://api.coingecko.com/")) return json({}, 429);
  if (url.startsWith("https://open.er-api.com/")) return json({ result: "success", rates: { USD: 1, EUR: 0.8, AED: 3.6725, IRR: 42000 } });
  if (url.startsWith("https://api.gold-api.com/")) return json({ price: 3900, symbol: "XAU" });
  if (url.startsWith("https://api.nobitex.ir/")) return new Response("blocked", { status: 502 });
  if (url === `https://api.trongrid.io/v1/accounts/${TRON_ADDR}`) {
    return json({ success: true, data: [{ address: "41...", balance: 143000652, trc20: [{ TVoLHooTu9uthsczLDpkBhz5ES8ueoqX11: "99" }, { [USDT_TRC20]: "556601745" }] }] });
  }
  if (url.startsWith(`https://api.trongrid.io/v1/accounts/${TRON_ADDR}/transactions/trc20`)) {
    return json({ success: true, data: [
      { transaction_id: "aa11", token_info: { symbol: "USDT", address: USDT_TRC20, decimals: 6 }, block_timestamp: 1793347521000, from: TRON_ADDR, to: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb", type: "Transfer", value: "14990000" },
      { transaction_id: "bb22", token_info: { symbol: "USDT", address: USDT_TRC20, decimals: 6 }, block_timestamp: 1793347467000, from: "TYsQqVyppXjpB9HxFLp9PY3GwLkAHDgH7R", to: TRON_ADDR, type: "Transfer", value: "20000000" },
    ] });
  }
  if (url.startsWith("https://ethereum-rpc.publicnode.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "eth_getBalance") return json({ jsonrpc: "2.0", id: 1, result: "0x1bc16d674ec80000" }); // 2 ETH
    if (body.method === "eth_call" && String(body.params?.[0]?.data).startsWith("0x70a08231")) {
      expect(body.params[0].to).toBe(USDT_ERC20);
      expect(body.params[0].data).toBe(`0x70a08231${ETH_ADDR.slice(2).toLowerCase().padStart(64, "0")}`);
      return json({ jsonrpc: "2.0", id: 1, result: `0x${(1234560000n).toString(16).padStart(64, "0")}` }); // 1234.56 USDT
    }
    return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } });
  }
  if (url === `https://mempool.space/api/address/${BTC_ADDR}`) {
    return json({ address: BTC_ADDR, chain_stats: { funded_txo_count: 3, funded_txo_sum: 150000000, spent_txo_count: 1, spent_txo_sum: 50000000, tx_count: 4 }, mempool_stats: { funded_txo_count: 1, funded_txo_sum: 1000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 } });
  }
  if (url === `https://mempool.space/api/address/${BTC_ADDR}/txs`) {
    return json([{ txid: "tx1", status: { confirmed: true, block_time: 1793000000 }, vin: [{ prevout: { scriptpubkey_address: "bc1other", value: 70000000 } }], vout: [{ scriptpubkey_address: BTC_ADDR, value: 60000000 }, { scriptpubkey_address: "bc1other", value: 9990000 }] }]);
  }
  if (url.startsWith("https://mempool.space/api/v1/prices")) return json({ time: 1, USD: 78000, EUR: 62400 });
  if (url.startsWith("https://litecoinspace.org/")) return json({ error: "down" }, 500);
  return new Response("not stubbed", { status: 404 });
}

// ---------------------------------------------------------------- helpers
let c: Client;
let db: Db;
let org: string;
const cur: Record<string, string> = {};
let box: { id: string; detail_id: string };

const o = (p: string) => `/o/${org}/fx${p}`;
const eq = (a: unknown, b: string | number) => expect(D(a as string).toFixed()).toBe(D(b).toFixed());

async function lines(voucherId: string) {
  return db.query<{ key: string; detail_id: string | null; debit: string; credit: string; currency_id: string | null; fx_debit: string; fx_credit: string }>(
    `select a.system_key as key, l.detail_id, l.debit, l.credit, l.currency_id, l.fx_debit, l.fx_credit
     from tz_voucher_lines l join tz_accounts a on a.id = l.account_id where l.voucher_id = $1 order by l.line_no`,
    [voucherId],
  );
}
function balanced(ls: { debit: string; credit: string }[]) {
  const dr = ls.reduce((a, l) => a.plus(D(l.debit)), D(0));
  const cr = ls.reduce((a, l) => a.plus(D(l.credit)), D(0));
  expect(dr.toFixed()).toBe(cr.toFixed());
}
const line = (ls: Awaited<ReturnType<typeof lines>>, key: string, side: "debit" | "credit", currency?: string | null) =>
  ls.find((l) => l.key === key && !D(l[side]).isZero() && (currency === undefined || l.currency_id === currency));

const deal = (b: Record<string, unknown>, expect = 200) => c.post(o("/deals"), { date: "2026-04-01", in_method: "cash", out_method: "cash", ...b }, expect);

/** a valid Iranian national id (check digit computed) */
function nationalId(nine: string) {
  const d = nine.split("").map(Number);
  const r = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  return `${nine}${r < 2 ? r : 11 - r}`;
}

describe("fx: exchange deals, remittances, wallets and reports", () => {
  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: stubFetch as typeof fetch } });
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    const board = await c.get(o("/rates"));
    for (const x of board.currencies) cur[x.code] = x.id;
    box = (await db.one<{ id: string; detail_id: string }>(`select id, detail_id from tz_cash_boxes where org_id = $1`, [org]))!;
    await c.post(o("/rates"), { at: "2026-03-25T08:00:00Z", rates: [
      { currency_id: cur.USD, buy: "1000000", sell: "1020000" },
      { currency_id: cur.EUR, buy: "1150000", sell: "1170000" },
    ] });
  });

  it("buys twice, then sells at the average cost with realized profit", async () => {
    const b1 = await deal({ in_currency_id: cur.USD, in_amount: "1000", out_currency_id: cur.IRR, rate: "1000000", in_ref_id: box.id, out_ref_id: box.id });
    expect(b1.deal.kind).toBe("buy");
    expect(b1.deal.no).toBe(1);
    eq(b1.deal.out_amount, 1_000_000_000);
    const l1 = await lines(b1.deal.voucher_id);
    balanced(l1);
    const fxIn = line(l1, "fx_cash", "debit", cur.USD)!;
    eq(fxIn.debit, 1_000_000_000);
    eq(fxIn.fx_debit, 1000);
    expect(fxIn.detail_id).toBe(box.detail_id);
    eq(line(l1, "cash", "credit")!.credit, 1_000_000_000);

    const b2 = await deal({ date: "2026-04-02", in_currency_id: cur.USD, in_amount: "1000", out_currency_id: cur.IRR, rate: "1100000" });
    expect(b2.deal.no).toBe(2);

    // the counter screen sees the average before saving
    const pv = await c.post(o("/deals/preview"), { date: "2026-04-03", in_currency_id: cur.IRR, in_method: "cash", out_currency_id: cur.USD, out_amount: "500", out_method: "cash", rate: "1200000" });
    expect(pv.kind).toBe("sell");
    eq(pv.avg_cost, 1_050_000);
    eq(pv.profit, 75_000_000);
    eq(pv.position.fx, 2000);

    const s1 = await deal({ date: "2026-04-03", in_currency_id: cur.IRR, out_currency_id: cur.USD, out_amount: "500", rate: "1200000", fee: "100000" });
    expect(s1.deal.kind).toBe("sell");
    eq(s1.deal.in_amount, 600_000_000);
    eq(s1.deal.cost_value, 525_000_000);
    eq(s1.deal.avg_cost, 1_050_000);
    eq(s1.deal.profit, 75_000_000);
    eq(s1.deal.fee_base, 100_000);
    const l3 = await lines(s1.deal.voucher_id);
    balanced(l3);
    const out = line(l3, "fx_cash", "credit", cur.USD)!;
    eq(out.credit, 525_000_000);
    eq(out.fx_credit, 500);
    eq(line(l3, "fx_trading_gain", "credit")!.credit, 75_000_000);
    eq(line(l3, "fx_commission", "credit")!.credit, 100_000);
    eq(l3.filter((l) => l.key === "cash").reduce((a, l) => a.plus(D(l.debit)), D(0)).toFixed(), 600_100_000);

    // cannot give more than the till holds
    const over = await deal({ date: "2026-04-03", in_currency_id: cur.IRR, out_currency_id: cur.USD, out_amount: "5000", rate: "1200000" }, 400);
    expect(over.error.message).toContain("کافی نیست");
  });

  it("edits, cancels and re-posts a deal (voucher follows the deal)", async () => {
    const d = await deal({ date: "2026-04-04", in_currency_id: cur.USD, in_amount: "10", out_currency_id: cur.IRR, rate: "1000000", status: "draft" });
    expect(d.deal.status).toBe("draft");
    expect(d.deal.voucher_id).toBeNull();
    const posted = await c.post(o(`/deals/${d.deal.id}/post`));
    expect(posted.deal.status).toBe("posted");
    const vid = posted.deal.voucher_id;
    const edited = await c.put(o(`/deals/${d.deal.id}`), { date: "2026-04-04", in_currency_id: cur.USD, in_amount: "20", in_method: "cash", out_currency_id: cur.IRR, out_method: "cash", rate: "1000000" });
    expect(edited.deal.voucher_id).toBe(vid);
    eq((await lines(vid)).find((l) => l.key === "fx_cash")!.fx_debit, 20);
    const cancelled = await c.post(o(`/deals/${d.deal.id}/cancel`), { reason: "اشتباه" });
    expect(cancelled.deal.status).toBe("cancelled");
    expect(cancelled.deal.voucher_id).toBeNull();
    expect(await db.one(`select 1 from tz_vouchers where id = $1 and deleted_at is null`, [vid])).toBeNull();
    await c.put(o(`/deals/${d.deal.id}`), { date: "2026-04-04", in_currency_id: cur.USD, in_amount: "20", in_method: "cash", out_currency_id: cur.IRR, out_method: "cash", rate: "1000000" }, 409);
    await c.del(o(`/deals/${d.deal.id}`));
    const list = await c.get(o("/deals?kind=buy"));
    expect(list.rows.every((r: { id: string }) => r.id !== d.deal.id)).toBe(true);
  });

  it("exchanges two foreign currencies: out at average cost, in at the board's mid rate", async () => {
    await deal({ date: "2026-04-05", in_currency_id: cur.EUR, in_amount: "1000", out_currency_id: cur.IRR, rate: "1150000" });
    const x = await deal({ date: "2026-04-06", in_currency_id: cur.USD, in_amount: "1100", out_currency_id: cur.EUR, out_amount: "900" });
    expect(x.deal.kind).toBe("exchange");
    eq(x.deal.cost_value, 1_035_000_000); // 900 × 1,150,000 (EUR average)
    eq(x.deal.base_value, 1_111_000_000); // 1100 × 1,010,000 (USD mid)
    eq(x.deal.profit, 76_000_000);
    eq(D(x.deal.rate).toDecimalPlaces(6).toFixed(), "0.818182");
    const ls = await lines(x.deal.voucher_id);
    balanced(ls);
    const usdIn = line(ls, "fx_cash", "debit", cur.USD)!;
    eq(usdIn.debit, 1_111_000_000);
    eq(usdIn.fx_debit, 1100);
    const eurOut = line(ls, "fx_cash", "credit", cur.EUR)!;
    eq(eurOut.credit, 1_035_000_000);
    eq(eurOut.fx_credit, 900);
    eq(line(ls, "fx_trading_gain", "credit")!.credit, 76_000_000);
  });

  it("requires identity of a walk-in customer above the KYC threshold", async () => {
    await c.put(o("/settings"), { kyc_threshold: "500000000" });
    const r = await deal({ date: "2026-04-07", in_currency_id: cur.USD, in_amount: "600", out_currency_id: cur.IRR, rate: "1000000" }, 400);
    expect(r.error.message).toContain("کد ملی");
    const bad = await deal({ date: "2026-04-07", in_currency_id: cur.USD, in_amount: "600", out_currency_id: cur.IRR, rate: "1000000", walkin: { name: "رضا", national_id: "1234567890" } }, 400);
    expect(bad.error.message).toContain("کد ملی");
    const ok = await deal({ date: "2026-04-07", in_currency_id: cur.USD, in_amount: "600", out_currency_id: cur.IRR, rate: "1000000", walkin: { name: "رضا محمدی", national_id: nationalId("001234567"), mobile: "09121234567" } });
    expect(ok.deal.walkin.name).toBe("رضا محمدی");
    const small = await deal({ date: "2026-04-07", in_currency_id: cur.USD, in_amount: "10", out_currency_id: cur.IRR, rate: "1000000" });
    expect(small.deal.status).toBe("posted");
    // undo both so later figures stay simple
    await c.del(o(`/deals/${ok.deal.id}`));
    await c.del(o(`/deals/${small.deal.id}`));
    await c.put(o("/settings"), { kyc_threshold: null });
    const s = await c.get(o("/settings"));
    expect(s.settings.kyc_threshold).toBeNull();
    expect(s.settings.providers.length).toBeGreaterThan(0);
  });

  it("runs an outgoing remittance through pending → sent → paid with the right vouchers", async () => {
    const corr = (await c.post(`/o/${org}/data/party`, { name: "صرافی دبی (همکار)", roles: ["correspondent"] })).row;
    const plain = (await c.post(`/o/${org}/data/party`, { name: "مشتری ساده" })).row;
    await c.post(o("/remittances"), { date: "2026-04-08", direction: "out", correspondent_id: plain.id, currency_id: cur.USD, amount: "10", pay_method: "cash", beneficiary: { name: "x" } }, 400);
    const r = (await c.post(o("/remittances"), {
      date: "2026-04-08", direction: "out", correspondent_id: corr.id, currency_id: cur.USD, amount: "1000", rate: "1020000", fee: "5000000",
      correspondent_fee: "10", pay_method: "cash", sender: { name: "علی رضایی" }, beneficiary: { name: "Ahmad K.", country: "UAE" },
    })).remittance;
    expect(r.status).toBe("pending");
    expect(r.tracking_code).toMatch(/^\d{10}$/);
    eq(r.base_amount, 1_020_000_000);
    eq(r.pay_amount, 1_025_000_000);
    const v1 = await lines(r.voucher_id);
    balanced(v1);
    eq(line(v1, "cash", "debit")!.debit, 1_025_000_000);
    const payable = line(v1, "remittances_payable", "credit", cur.USD)!;
    eq(payable.credit, 1_020_000_000);
    eq(payable.fx_credit, 1000);
    expect(payable.detail_id).toBe(corr.detail_id);
    eq(line(v1, "fx_commission", "credit")!.credit, 5_000_000);

    const sent = (await c.post(o(`/remittances/${r.id}/status`), { status: "sent", note: "ارسال به همکار" })).remittance;
    expect(sent.status).toBe("sent");
    expect(sent.paid_voucher_id).toBeNull();
    const paid = (await c.post(o(`/remittances/${r.id}/status`), { status: "paid", date: "2026-04-09" })).remittance;
    expect(paid.status).toBe("paid");
    expect(paid.paid_date).toBe("2026-04-09");
    expect(paid.history.map((h: { status: string }) => h.status)).toEqual(["pending", "sent", "paid"]);
    const v2 = await lines(paid.paid_voucher_id);
    balanced(v2);
    eq(line(v2, "remittances_payable", "debit", cur.USD)!.fx_debit, 1000);
    const corrLines = v2.filter((l) => l.key === "correspondents");
    eq(corrLines.reduce((a, l) => a.plus(D(l.fx_credit)), D(0)).toFixed(), 1010);
    eq(line(v2, "correspondent_fees", "debit")!.debit, 10_200_000);
    expect((await db.one<{ date: string }>(`select date from tz_vouchers where id = $1`, [paid.paid_voucher_id]))!.date).toBe("2026-04-09");

    const bal = await c.get(o("/reports/correspondents"));
    const row = bal.rows.find((x: { party_id: string }) => x.party_id === corr.id);
    const usd = row.currencies.find((x: { code: string }) => x.code === "USD");
    eq(usd.balance, -1010); // we owe the correspondent 1010 USD
    eq(usd.in_transit, 0);

    await c.post(o(`/remittances/${r.id}/status`), { status: "cancelled" }, 400);
    const undone = (await c.post(o(`/remittances/${r.id}/status`), { status: "sent" })).remittance;
    expect(undone.paid_voucher_id).toBeNull();
    expect(await db.one(`select 1 from tz_vouchers where id = $1 and deleted_at is null`, [paid.paid_voucher_id])).toBeNull();
    const back = (await c.post(o(`/remittances/${r.id}/status`), { status: "paid", date: "2026-04-09" })).remittance;
    expect(back.paid_voucher_id).toBeTruthy();

    // a second one, cancelled before sending: its voucher disappears
    const r2 = (await c.post(o("/remittances"), { date: "2026-04-08", direction: "out", correspondent_id: corr.id, currency_id: cur.USD, amount: "100", rate: "1020000", pay_method: "cash", sender: { name: "x" }, beneficiary: { name: "y" } })).remittance;
    const cancelled = (await c.post(o(`/remittances/${r2.id}/status`), { status: "cancelled", note: "انصراف مشتری" })).remittance;
    expect(cancelled.voucher_id).toBeNull();
    expect(await db.one(`select 1 from tz_vouchers where id = $1 and deleted_at is null`, [r2.voucher_id])).toBeNull();

    const list = await c.get(o(`/remittances?status=paid&direction=out&correspondent_id=${corr.id}`));
    expect(list.total).toBe(1);
    const byCode = await c.get(o(`/remittances?q=${r.tracking_code}`));
    expect(byCode.rows[0].id).toBe(r.id);
  });

  it("pays an incoming remittance and charges the correspondent with our commission", async () => {
    const corr = (await c.post(`/o/${org}/data/party`, { name: "همکار استانبول", roles: ["correspondent"] })).row;
    const r = (await c.post(o("/remittances"), {
      date: "2026-04-10", direction: "in", correspondent_id: corr.id, currency_id: cur.USD, amount: "500", rate: "1000000", fee: "5",
      pay_method: "cash", beneficiary: { name: "مریم احمدی", national_id: nationalId("001234567") },
    })).remittance;
    expect(r.voucher_id).toBeNull();
    eq(r.pay_amount, 500_000_000);
    const paid = (await c.post(o(`/remittances/${r.id}/status`), { status: "paid", date: "2026-04-10" })).remittance;
    const ls = await lines(paid.paid_voucher_id);
    balanced(ls);
    const corrLine = line(ls, "correspondents", "debit", cur.USD)!;
    eq(corrLine.debit, 505_000_000);
    eq(corrLine.fx_debit, 505);
    eq(line(ls, "cash", "credit")!.credit, 500_000_000);
    eq(line(ls, "fx_commission", "credit")!.credit, 5_000_000);
    const undone = (await c.post(o(`/remittances/${r.id}/status`), { status: "pending" })).remittance;
    expect(undone.paid_voucher_id).toBeNull();
    await c.post(o(`/remittances/${r.id}/status`), { status: "paid", date: "2026-04-10" });
  });

  it("reports positions with average cost, market value and unrealized profit", async () => {
    const p = await c.get(o("/reports/positions?date=2026-04-30"));
    const usd = p.rows.find((r: { code: string }) => r.code === "USD");
    // 1000 + 1000 − 500 + 1100 (exchange) = 2600 USD, book 1e9 + 1.1e9 − 525e6 + 1.111e9
    eq(usd.holdings, 2600);
    eq(usd.book_value, 2_686_000_000);
    eq(usd.market_rate, 1_010_000);
    eq(usd.market_value, 2_626_000_000);
    eq(usd.unrealized, -60_000_000);
    expect(usd.legs[0].detail_id).toBe(box.detail_id);
    const eur = p.rows.find((r: { code: string }) => r.code === "EUR");
    eq(eur.holdings, 100);
    eq(eur.avg_cost, 1_150_000);
    eq(p.realized.profit, 151_000_000); // 75M (sell) + 76M (exchange)
    eq(p.realized.deals, 5);

    const rep = await c.get(o("/reports/deals?from=2026-04-01&to=2026-04-30"));
    const ru = rep.by_currency.find((r: { code: string }) => r.code === "USD");
    expect(ru.buy_count).toBe(2);
    eq(ru.sold, 500);
    eq(ru.profit, 75_000_000);
    eq(rep.totals.profit, 151_000_000);

    const cash = await c.get(o(`/reports/cash?date=2026-04-03&cash_box_id=${box.id}`));
    const cu = cash.rows.find((r: { code: string }) => r.code === "USD");
    eq(cu.opening, 2000);
    eq(cu.outflow, 500);
    eq(cu.closing, 1500);
    const ci = cash.rows.find((r: { code: string }) => r.code === "IRR");
    eq(ci.opening, -2_100_000_000);
    eq(ci.inflow, 600_100_000);
    expect(cash.moves.length).toBeGreaterThan(0);

    const sum = await c.get(o("/summary"));
    expect(sum.board.find((b: { code: string }) => b.code === "USD").buy).toBe("1000000");
    expect(sum.remittances.out_open).toBe(0);
  });

  it("revalues foreign balances to the market rate and replaces the run of the same date", async () => {
    await c.post(o("/rates"), { at: "2026-04-30T08:00:00Z", rates: [{ currency_id: cur.USD, buy: "1090000", sell: "1110000" }, { currency_id: cur.EUR, buy: "1150000", sell: "1170000" }] });
    const pv = await c.post(o("/revaluation/preview"), { date: "2026-04-30" });
    const usd = pv.rows.find((r: { code: string }) => r.code === "USD");
    eq(usd.target, 2_860_000_000);
    eq(usd.diff, 174_000_000);
    eq(pv.total, 175_000_000); // USD 174M + EUR (100 × 1,160,000 − 115M) 1M
    const posted = await c.post(o("/revaluation"), { date: "2026-04-30" });
    eq(posted.total, 175_000_000);
    const ls = await lines(posted.voucher_id);
    balanced(ls);
    const usdLine = line(ls, "fx_cash", "debit", cur.USD)!;
    eq(usdLine.debit, 174_000_000);
    eq(usdLine.fx_debit, 0);
    eq(line(ls, "fx_revaluation", "credit")!.credit, 175_000_000);
    const again = await c.post(o("/revaluation"), { date: "2026-04-30" });
    expect(again.voucher_id).toBe(posted.voucher_id);
    eq(again.total, 175_000_000);
    expect((await c.get(o("/revaluations"))).rows).toHaveLength(1);
    // after revaluation the average cost is the revalued rate
    const pv2 = await c.post(o("/deals/preview"), { date: "2026-05-01", in_currency_id: cur.IRR, in_method: "cash", out_currency_id: cur.USD, out_amount: "100", out_method: "cash", rate: "1110000" });
    eq(pv2.avg_cost, 1_100_000);
    const after = await c.get(o("/reports/positions?date=2026-04-30"));
    eq(after.rows.find((r: { code: string }) => r.code === "USD").unrealized, 0);
    eq(after.realized.revaluation, 175_000_000);
  });

  it("refreshes board rates from the market with the margin and serves live quotes", async () => {
    const live = await c.get(o("/prices/live?symbols=BTC,ETH,USDT,USD"));
    const btc = live.quotes.find((q: { code: string }) => q.code === "BTC");
    eq(btc.price_usd, 78000);
    eq(btc.change_24h, 1.25);
    expect(btc.source).toBe("kucoin");
    eq(live.usd_rate, 1_100_000); // the latest manual dollar rate (mid)
    eq(btc.price_base, 85_800_000_000);
    const r = await c.post(o("/rates/refresh"), {});
    expect(r.updated).toBeGreaterThan(2);
    const board = await c.get(o("/rates"));
    const b = board.currencies.find((x: { code: string }) => x.code === "BTC");
    eq(b.rate.mid, 85_800_000_000);
    eq(b.rate.buy, 85_371_000_000); // − 0.5 %
    eq(b.rate.sell, 86_229_000_000); // + 0.5 %
    expect(b.rate.source).toBe("kucoin");
    const eur = board.currencies.find((x: { code: string }) => x.code === "EUR");
    eq(eur.rate.mid, 1_375_000); // 1 / 0.8 USD × 1,100,000
    expect(eur.rate.source).toBe("open_er");
    // the manual dollar rate stays
    expect(board.currencies.find((x: { code: string }) => x.code === "USD").rate.source).toBe("manual");
    const again = await c.post(o("/rates/refresh"), {});
    expect(again.updated).toBe(0);
    const hist = await c.get(o(`/rates/history?currency_id=${cur.USD}`));
    expect(hist.rows.length).toBe(2);
  });

  it("reads live wallet balances on TRON, Ethereum and Bitcoin next to the book balance", async () => {
    const tronW = (await c.post(`/o/${org}/data/wallet`, { name: "تتر ترون", currency_id: cur.USDT, chain: "TRON", address: TRON_ADDR })).row;
    const ethW = (await c.post(`/o/${org}/data/wallet`, { name: "تتر اتریوم", currency_id: cur.USDT, chain: "ETH", address: ETH_ADDR })).row;
    const ethNative = (await c.post(`/o/${org}/data/wallet`, { name: "اتر", currency_id: cur.ETH, chain: "ETH", address: ETH_ADDR })).row;
    const btcW = (await c.post(`/o/${org}/data/wallet`, { name: "بیت‌کوین", currency_id: cur.BTC, chain: "BTC", address: BTC_ADDR })).row;
    const ltcW = (await c.post(`/o/${org}/data/wallet`, { name: "لایت‌کوین", currency_id: cur.LTC, chain: "LTC", address: "ltc1qr07zu594qf63xm7l7x6pu3a2v39m2z6hh5pp4t" })).row;
    // buy 500 USDT into the TRON wallet so it has a book balance
    const buy = await deal({ date: "2026-04-11", in_currency_id: cur.USDT, in_amount: "500", in_method: "wallet", in_ref_id: tronW.id, out_currency_id: cur.IRR, rate: "1050000", tx_hash: "bb22", network: "TRON" });
    const bl = await lines(buy.deal.voucher_id);
    expect(line(bl, "crypto_wallets", "debit", cur.USDT)!.detail_id).toBe(tronW.detail_id);
    // crypto cannot go through a cash box
    await deal({ date: "2026-04-11", in_currency_id: cur.USDT, in_amount: "5", out_currency_id: cur.IRR, rate: "1050000" }, 400);

    const t = await c.post(o(`/wallets/${tronW.id}/refresh`));
    eq(t.live, "556.601745");
    eq(t.native.balance, "143.000652");
    eq(t.wallet.book_balance, 500);
    eq(t.wallet.difference, "56.601745");
    expect(t.txs).toHaveLength(2);
    eq(t.txs[0].amount, "-14.99");
    eq(t.txs[1].amount, 20);

    const e = await c.post(o(`/wallets/${ethW.id}/refresh`));
    eq(e.live, "1234.56");
    eq(e.native.balance, 2);
    const en = await c.post(o(`/wallets/${ethNative.id}/refresh`));
    eq(en.live, 2);
    const b = await c.post(o(`/wallets/${btcW.id}/refresh`));
    eq(b.live, "1.00001");
    eq(b.txs[0].amount, "0.6");
    const l = await c.post(o(`/wallets/${ltcW.id}/refresh`));
    expect(l.live).toBeNull();
    expect(l.error).toContain("500");
    expect(l.wallet.last_error).toContain("500");

    const all = await c.post(o("/wallets/refresh-all"));
    expect(all.checked).toBe(5);
    expect(all.failed).toBe(1);
    const row = all.rows.find((w: { id: string }) => w.id === tronW.id);
    eq(row.last_balance, "556.601745");
    expect(row.last_checked_at).toBeTruthy();
  });

  it("sells crypto from a wallet with a network fee and refuses to overdraw the wallet", async () => {
    const w = (await db.one<{ id: string; detail_id: string }>(`select id, detail_id from tz_wallets where org_id = $1 and chain = 'TRON'`, [org]))!;
    const s = await deal({
      date: "2026-04-12", in_currency_id: cur.IRR, out_currency_id: cur.USDT, out_amount: "100", out_method: "wallet", out_ref_id: w.id,
      rate: "1200000", network_fee: "1", network: "TRON", address: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb", tx_hash: "aa11",
    });
    eq(s.deal.avg_cost, 1_050_000);
    eq(s.deal.profit, 15_000_000);
    const ls = await lines(s.deal.voucher_id);
    balanced(ls);
    const out = ls.filter((l) => l.key === "crypto_wallets");
    eq(out.reduce((a, l) => a.plus(D(l.fx_credit)), D(0)).toFixed(), 101);
    expect(out.every((l) => l.detail_id === w.detail_id)).toBe(true);
    eq(line(ls, "network_fees", "debit")!.debit, 1_050_000);
    eq(line(ls, "fx_trading_gain", "credit")!.credit, 15_000_000);
    const over = await deal({ date: "2026-04-12", in_currency_id: cur.IRR, out_currency_id: cur.USDT, out_amount: "1000", out_method: "wallet", out_ref_id: w.id, rate: "1200000" }, 400);
    expect(over.error.message).toContain("کافی نیست");
    // a fee in a foreign currency is valued at the deal's rate
    const f = await deal({ date: "2026-04-12", in_currency_id: cur.EUR, in_amount: "10", out_currency_id: cur.IRR, rate: "1150000", fee: "1", fee_currency_id: cur.EUR });
    eq(f.deal.fee_base, 1_150_000);
    const fl = await lines(f.deal.voucher_id);
    balanced(fl);
    eq(fl.filter((l) => l.key === "fx_cash").reduce((a, l) => a.plus(D(l.fx_debit)), D(0)).toFixed(), 11);
  });

  it("pays an incoming remittance in foreign cash at the average cost and books the difference", async () => {
    const corr = (await db.one<{ id: string }>(`select id from tz_parties where org_id = $1 and name = 'همکار استانبول'`, [org]))!;
    const r = (await c.post(o("/remittances"), {
      date: "2026-05-02", direction: "in", correspondent_id: corr.id, currency_id: cur.USD, amount: "100", rate: "1000000",
      pay_method: "cash", pay_currency_id: cur.USD, beneficiary: { name: "ذی‌نفع ارزی" },
    })).remittance;
    eq(r.pay_amount, 100);
    const paid = (await c.post(o(`/remittances/${r.id}/status`), { status: "paid", date: "2026-05-02" })).remittance;
    const ls = await lines(paid.paid_voucher_id);
    balanced(ls);
    eq(line(ls, "correspondents", "debit", cur.USD)!.debit, 100_000_000);
    const cash = line(ls, "fx_cash", "credit", cur.USD)!;
    eq(cash.credit, 110_000_000); // 100 × 1,100,000 (average after the revaluation)
    eq(cash.fx_credit, 100);
    eq(line(ls, "fx_trading_gain", "debit")!.debit, 10_000_000);
    await c.del(o(`/remittances/${r.id}`), 409); // a paid remittance cannot be deleted
  });

  it("removes a revaluation run", async () => {
    const list = await c.get(o("/revaluations"));
    expect(list.rows).toHaveLength(1);
    await c.del(o(`/revaluations/${list.rows[0].id}`));
    expect((await c.get(o("/revaluations"))).rows).toHaveLength(0);
    expect(await db.one(`select 1 from tz_vouchers where id = $1 and deleted_at is null`, [list.rows[0].id])).toBeNull();
  });
});

describe("fx: market rates for a toman business (Nobitex, custom source, refresh by kind)", () => {
  let c2: Client;
  let org2: string;
  const cur2: Record<string, string> = {};
  const urls: string[] = [];
  async function iranFetch(input: RequestInfo | URL): Promise<Response> {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    if (url.startsWith("https://api.nobitex.ir/market/stats")) {
      expect(url).toContain("dstCurrency=rls");
      return json({ status: "ok", stats: {
        "btc-rls": { isClosed: false, latest: "82000000000", bestBuy: "81900000000", bestSell: "82100000000", dayChange: "1.5" },
        "usdt-rls": { isClosed: false, latest: "1060000", bestBuy: "1059000", bestSell: "1061000", dayChange: "0.2" },
      } });
    }
    if (url === "https://api.example.ir/v1/price?key=secret") return json({ data: { usd: { price: "۱۰۵٬۰۰۰" } } });
    if (url.startsWith("https://open.er-api.com/")) return json({ result: "success", rates: { USD: 1, EUR: 0.8 } });
    if (url.startsWith("https://api.kucoin.com/")) return json({ code: "200000", data: { ticker: [{ symbol: "ETH-USDT", last: "2000", changeRate: "0.01" }] } });
    return new Response("not stubbed", { status: 404 });
  }

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: iranFetch as typeof fetch } });
    c2 = new Client(s.app);
    await c2.post("/auth/signup", { email: "fx2@example.com", password: "s3cret-pass", full_name: "صراف" });
    org2 = (await c2.post<{ id: string }>("/orgs", { name: "صرافی تومانی", business_kind: "exchange", modules: ["fx"], base_currency: "IRT", fiscal_year: 1405 })).id;
    for (const x of (await c2.get(`/o/${org2}/fx/rates`)).currencies) cur2[x.code] = x.id;
  });

  it("refuses unsafe custom URLs and keeps custom URLs from readers", async () => {
    const bad = await c2.put(`/o/${org2}/fx/settings`, { custom: [{ code: "USD", url: "http://127.0.0.1/price", path: "x" }] }, 400);
    expect(bad.error.message).toContain("https");
    const internal = await c2.put(`/o/${org2}/fx/settings`, { custom: [{ code: "USD", url: "https://10.0.0.5/price", path: "x" }] }, 400);
    expect(internal.error.message).toContain("داخلی");
  });

  it("prices crypto from Nobitex in toman, the dollar from a custom source and the rest from official crosses", async () => {
    await c2.put(`/o/${org2}/fx/settings`, {
      providers: ["custom", "nobitex", "kucoin", "open_er"],
      margin_pct: "1",
      custom: [{ code: "USD", url: "https://api.example.ir/v1/price?key=secret", path: "data.usd.price", unit: "base" }],
    });
    const r = await c2.post(`/o/${org2}/fx/rates/refresh`, {});
    expect(r.usd_source).toBe("custom");
    eq(r.usd_rate, 105_000);
    const board = await c2.get(`/o/${org2}/fx/rates`);
    const rate = (code: string) => board.currencies.find((x: { code: string }) => x.code === code).rate;
    eq(rate("BTC").mid, 8_200_000_000); // 82,000,000,000 rial ÷ 10
    expect(rate("BTC").source).toBe("nobitex");
    eq(rate("BTC").buy, 8_118_000_000); // − 1 %
    eq(rate("USDT").mid, 106_000);
    eq(rate("USD").mid, 105_000);
    expect(rate("USD").source).toBe("custom");
    eq(rate("ETH").mid, 210_000_000); // KuCoin 2000 USD × 105,000 (not on the Nobitex stub)
    eq(rate("EUR").mid, 131_250); // 1 / 0.8 × 105,000
    expect(urls.filter((u) => u.startsWith("https://api.nobitex.ir/")).length).toBe(1);
    // a second refresh inside 45 s uses the cache and finds nothing new
    const again = await c2.post(`/o/${org2}/fx/rates/refresh`, {});
    expect(again.updated).toBe(0);
    expect(urls.filter((u) => u.startsWith("https://api.nobitex.ir/")).length).toBe(1);
    // the custom URL (which may carry a key) is hidden from the public board settings
    expect(JSON.stringify(board.settings)).not.toContain("secret");
  });

  it("refreshes only the chosen kinds and keeps manual rates of the others", async () => {
    await c2.post(`/o/${org2}/fx/rates`, { rates: [{ currency_id: cur2.EUR, buy: "120000", sell: "122000" }, { currency_id: cur2.BTC, buy: "1", sell: "2" }] });
    const r = await c2.post(`/o/${org2}/fx/rates/refresh`, { kinds: ["crypto"] });
    expect(r.rows.map((x: { code: string }) => x.code)).toContain("BTC");
    expect(r.rows.map((x: { code: string }) => x.code)).not.toContain("EUR");
    const board = await c2.get(`/o/${org2}/fx/rates`);
    expect(board.currencies.find((x: { code: string }) => x.code === "EUR").rate.source).toBe("manual");
    eq(board.currencies.find((x: { code: string }) => x.code === "BTC").rate.mid, 8_200_000_000);
  });
});

describe("fx: review fixes (SSRF, revaluation order, chain balances, fees)", () => {
  let c4: Client;
  let db4: Db;
  let org4: string;
  const k: Record<string, string> = {};
  const p = (x: string) => `/o/${org4}/fx${x}`;
  const TRON2 = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
  const USDD = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
  const followed: string[] = [];
  async function fetch4(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://prices.example.com/usd") {
      // a public host that redirects to the cloud metadata service: a fetch that follows
      // redirects would read the internal answer
      if (init?.redirect === "manual" || init?.redirect === "error") {
        if (init.redirect === "error") throw new TypeError("redirect");
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }
      followed.push(url);
      return json({ usd: "999999" });
    }
    if (url === `https://api.trongrid.io/v1/accounts/${TRON2}`) {
      return json({ success: true, data: [{ balance: 1000000, trc20: [{ [USDD]: "1500000000000000000000" }] }] });
    }
    if (url === "https://api.trongrid.io/wallet/triggerconstantcontract") {
      const b = JSON.parse(String(init?.body ?? "{}"));
      if (b.contract_address === USDD && b.function_selector === "decimals()") {
        return json({ result: { result: true }, constant_result: ["0000000000000000000000000000000000000000000000000000000000000012"] });
      }
      return json({ result: { result: false } });
    }
    return stubFetch(input, init);
  }
  async function vlines(voucherId: string) {
    return db4.query<{ key: string; debit: string; credit: string; currency_id: string | null; fx_debit: string; fx_credit: string }>(
      `select a.system_key as key, l.debit, l.credit, l.currency_id, l.fx_debit, l.fx_credit
       from tz_voucher_lines l join tz_accounts a on a.id = l.account_id where l.voucher_id = $1 order by l.line_no`,
      [voucherId],
    );
  }
  const d4 = (b: Record<string, unknown>, e = 200) => c4.post(p("/deals"), { date: "2026-04-01", in_method: "cash", out_method: "cash", ...b }, e);

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: fetch4 as typeof fetch } });
    db4 = s.db;
    c4 = new Client(s.app);
    await c4.post("/auth/signup", { email: "fx4@example.com", password: "s3cret-pass", full_name: "صراف" });
    org4 = (await c4.post<{ id: string }>("/orgs", { name: "صرافی بازبینی", business_kind: "exchange", modules: ["fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
    for (const x of (await c4.get(p("/rates"))).currencies) k[x.code] = x.id;
    await c4.post(p("/rates"), { at: "2026-03-25T08:00:00Z", rates: [
      { currency_id: k.USD, buy: "1000000", sell: "1020000" },
      { currency_id: k.AED, buy: "270000", sell: "280000" },
      { currency_id: k.EUR, buy: "1150000", sell: "1170000" },
    ] });
  });

  it("refuses custom price URLs that reach internal hosts through IPv6-mapped addresses or a trailing dot", async () => {
    for (const url of ["https://[::ffff:127.0.0.1]/p", "https://[::ffff:a9fe:a9fe]/latest", "https://[64:ff9b::a9fe:a9fe]/x", "https://localhost./p", "https://metadata.google.internal./x"]) {
      const r = await c4.put(p("/settings"), { custom: [{ code: "USD", url, path: "x" }] }, 400);
      expect(r.error.message).toContain("داخلی");
    }
  });

  it("does not follow a custom price source's redirect", async () => {
    await c4.put(p("/settings"), { providers: ["custom", "open_er"], custom: [{ code: "USD", url: "https://prices.example.com/usd", path: "usd", unit: "base" }] });
    const r = await c4.post(p("/rates/refresh"), { currency_ids: [k.USD] });
    expect(followed).toHaveLength(0);
    expect(r.usd_source).not.toBe("custom");
    expect(r.errors.join(" ")).toContain("منبع سفارشی");
    await c4.put(p("/settings"), { providers: ["kucoin", "okx", "open_er"], custom: [] });
  });

  it("refuses to remove or re-post a revaluation when a later one exists", async () => {
    await d4({ date: "2026-04-03", in_currency_id: k.USD, in_amount: "100", out_currency_id: k.IRR, rate: "1000000" });
    await c4.post(p("/rates"), { at: "2026-04-30T08:00:00Z", rates: [{ currency_id: k.USD, buy: "1090000", sell: "1110000" }] });
    await c4.post(p("/rates"), { at: "2026-05-31T08:00:00Z", rates: [{ currency_id: k.USD, buy: "1190000", sell: "1210000" }] });
    const first = await c4.post(p("/revaluation"), { date: "2026-04-30" });
    const second = await c4.post(p("/revaluation"), { date: "2026-05-31" });
    expect(second.voucher_id).toBeTruthy();
    await c4.del(p(`/revaluations/${first.voucher_id}`), 409);
    await c4.post(p("/revaluation"), { date: "2026-04-30" }, 409);
    await c4.post(p("/revaluation"), { date: "2026-04-15" }, 409);
    // the latest run still brings the books to the market
    const pos = await c4.get(p("/reports/positions?date=2026-05-31"));
    const usd = pos.rows.find((r: { code: string }) => r.code === "USD");
    expect(D(usd.book_value).toFixed()).toBe("120000000");
    // undo in order: latest first
    await c4.del(p(`/revaluations/${second.voucher_id}`));
    await c4.del(p(`/revaluations/${first.voucher_id}`));
    expect((await c4.get(p("/revaluations"))).rows).toHaveLength(0);
  });

  it("buys crypto into a wallet with the fee in rial taken from the payout", async () => {
    const w = (await c4.post(`/o/${org4}/data/wallet`, { name: "تتر", currency_id: k.USDT, chain: "TRON", address: TRON2 })).row;
    const b = await d4({ date: "2026-04-04", in_currency_id: k.USDT, in_amount: "100", in_method: "wallet", in_ref_id: w.id, out_currency_id: k.IRR, rate: "1050000", fee: "500000" });
    expect(D(b.deal.fee_base).toFixed()).toBe("500000");
    const ls = await vlines(b.deal.voucher_id);
    const cash = ls.filter((l) => l.key === "cash").reduce((a, l) => a.plus(D(l.credit)).minus(D(l.debit)), D(0));
    expect(cash.toFixed()).toBe("104500000"); // 105,000,000 paid less the 500,000 fee
    expect(ls.find((l) => l.key === "fx_commission")!.credit).toBe("500000");
  });

  it("reads a TRC20 token's own decimals and refuses tokens on chains without tokens", async () => {
    const cur = (await c4.post(`/o/${org4}/data/currency`, { code: "USDD", name: "یو‌اس‌دی‌دی", kind: "crypto", decimals: 2 })).row;
    const w = (await c4.post(`/o/${org4}/data/wallet`, { name: "USDD", currency_id: cur.id, chain: "TRON", address: TRON2, token_contract: USDD })).row;
    const r = await c4.post(p(`/wallets/${w.id}/refresh`));
    expect(r.error).toBeNull();
    expect(D(r.live).toFixed()).toBe("1500");
    const bw = (await c4.post(`/o/${org4}/data/wallet`, { name: "تتر روی بیت‌کوین", currency_id: k.USDT, chain: "BTC", address: BTC_ADDR, token_contract: "x" })).row;
    const br = await c4.post(p(`/wallets/${bw.id}/refresh`));
    expect(br.live).toBeNull();
    expect(br.error).toBeTruthy();
  });
});

describe("fx: documents of a closed fiscal year stay as they are", () => {
  let c5: Client;
  let db5: Db;
  let org5: string;
  let fy1404 = "";
  const k: Record<string, string> = {};
  const p = (x: string) => `/o/${org5}/fx${x}`;
  const closeYear = () => db5.query(`update tz_fiscal_years set status = 'closed' where id = $1`, [fy1404]);
  const openYear = () => db5.query(`update tz_fiscal_years set status = 'open' where id = $1`, [fy1404]);
  const voucher = (id: string) => db5.one<{ deleted_at: string | null; date: string; fiscal_year_id: string; total_debit: string }>(
    `select deleted_at, date, fiscal_year_id, total_debit from tz_vouchers where id = $1`, [id]);

  beforeAll(async () => {
    const s = await makeServer({ config: { fetch: stubFetch as typeof fetch } });
    db5 = s.db;
    c5 = new Client(s.app);
    await c5.post("/auth/signup", { email: "fx5@example.com", password: "s3cret-pass", full_name: "صراف" });
    org5 = (await c5.post<{ id: string }>("/orgs", { name: "صرافی سال بسته", business_kind: "exchange", modules: ["fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
    for (const x of (await c5.get(p("/rates"))).currencies) k[x.code] = x.id;
    fy1404 = (await c5.post(`/o/${org5}/fiscal-years`, { jalali_year: 1404 })).fiscal_year.id;
  });

  it("refuses to change a closed year's deals and remittances, and still pays an old remittance in the open year", async () => {
    const buy = { date: "2026-03-10", in_method: "cash", out_method: "cash", in_currency_id: k.USD, in_amount: "100", out_currency_id: k.IRR, rate: "1000000" };
    const d = (await c5.post(p("/deals"), buy)).deal;
    const corr = (await c5.post(`/o/${org5}/data/party`, { name: "همکار دبی", roles: ["correspondent"] })).row;
    const rem = { date: "2026-03-10", direction: "out", correspondent_id: corr.id, currency_id: k.USD, amount: "50", rate: "1020000", pay_method: "cash", sender: { name: "فرستنده" }, beneficiary: { name: "گیرنده" } };
    const r1 = (await c5.post(p("/remittances"), rem)).remittance;
    const r2 = (await c5.post(p("/remittances"), rem)).remittance;
    for (const v of [d.voucher_id, r1.voucher_id, r2.voucher_id]) expect((await voucher(v))!.fiscal_year_id).toBe(fy1404);
    await closeYear();
    try {
      await c5.post(p(`/deals/${d.id}/cancel`), { reason: "اشتباه" }, 400);
      await c5.del(p(`/deals/${d.id}`), 400);
      await c5.put(p(`/deals/${d.id}`), { ...buy, date: "2026-04-05" }, 400); // moving it out of the closed year
      // a remittance of the closed year moves on: sent, paid and un-paid in the open year
      const sent = (await c5.post(p(`/remittances/${r1.id}/status`), { status: "sent" })).remittance;
      expect(sent.voucher_id).toBe(r1.voucher_id);
      const paid = (await c5.post(p(`/remittances/${r1.id}/status`), { status: "paid", date: "2026-04-05" })).remittance;
      expect(paid.status).toBe("paid");
      expect((await voucher(paid.paid_voucher_id))!.fiscal_year_id).not.toBe(fy1404);
      const unpaid = (await c5.post(p(`/remittances/${r1.id}/status`), { status: "sent" })).remittance;
      expect(unpaid.paid_voucher_id).toBeNull();
      // …but cancelling or deleting one would remove a voucher of the closed year
      await c5.post(p(`/remittances/${r2.id}/status`), { status: "cancelled" }, 400);
      await c5.del(p(`/remittances/${r2.id}`), 400);
      for (const v of [d.voucher_id, r1.voucher_id, r2.voucher_id]) {
        const row = (await voucher(v))!;
        expect(row.deleted_at).toBeNull();
        expect(row.date).toBe("2026-03-10");
        expect(row.fiscal_year_id).toBe(fy1404);
      }
      expect((await c5.get(p(`/deals/${d.id}`))).deal.status).toBe("posted");
      expect((await c5.get(p(`/remittances/${r2.id}`))).remittance.status).toBe("pending");
    } finally {
      await openYear();
    }
  });

  it("refuses to delete, move or un-post a manual voucher of a closed year", async () => {
    const cash = await accountId(db5, org5, "cash");
    const capital = await accountId(db5, org5, "capital");
    const box = await db5.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [org5]);
    const lines = [{ account_id: cash, detail_id: box!.detail_id, debit: "500" }, { account_id: capital, credit: "500" }];
    const v = (await c5.post(`/o/${org5}/accounting/vouchers`, { date: "2026-03-12", description: "سرمایه", lines })).voucher;
    await closeYear();
    try {
      await c5.del(`/o/${org5}/accounting/vouchers/${v.id}`, 400);
      await c5.put(`/o/${org5}/accounting/vouchers/${v.id}`, { date: "2026-04-12", description: "جابه‌جا", lines }, 400);
      await c5.post(`/o/${org5}/accounting/vouchers/${v.id}/status`, { status: "draft" }, 400);
      await c5.post(`/o/${org5}/accounting/vouchers/${v.id}/status`, { status: "final" }); // finalising changes no balance
      const row = (await voucher(v.id))!;
      expect(row.deleted_at).toBeNull();
      expect(row.date).toBe("2026-03-12");
      expect(D(row.total_debit).toNumber()).toBe(500);
    } finally {
      await openYear();
    }
  });
});
