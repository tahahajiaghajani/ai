import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, accountId } from "./helpers";
import type { Db } from "@server/db";
import { D } from "@shared/money";

describe("core: auth, organisation, vouchers, reports", () => {
  let c: Client;
  let db: Db;
  let org: string;
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
  });

  it("creates the organisation with chart of accounts, fiscal year and defaults", async () => {
    const info = await c.get(`/o/${org}`);
    expect(info.org.name).toBe("فروشگاه آزمایشی");
    expect(info.fiscal_years).toHaveLength(1);
    expect(info.fiscal_years[0].start_date).toBe("2026-03-21");
    expect(info.member.role).toBe("owner");
    const accounts = await c.get(`/o/${org}/accounting/accounts`);
    expect(accounts.accounts.length).toBeGreaterThan(100);
    const keys = accounts.accounts.map((a: { system_key: string }) => a.system_key).filter(Boolean);
    expect(keys).toEqual(expect.arrayContaining(["cash", "ar", "sales", "gold_inventory", "fx_cash", "crypto_wallets"]));
  });

  it("creates master data with automatic codes and detail accounts", async () => {
    const p = await c.post(`/o/${org}/data/party`, { name: "علی رضایی", mobile: "۰۹۱۲۱۲۳۴۵۶۷", roles: ["customer"] });
    expect(p.row.code).toBe("1001");
    expect(p.row.mobile).toBe("09121234567");
    expect(p.row.detail_id).toBeTruthy();
    const list = await c.get(`/o/${org}/data/party?q=رضایی`);
    expect(list.total).toBe(1);
    await c.post(`/o/${org}/data/party`, { name: "بد", national_id: "1234567890" }, 400);
    // each kind of detail account keeps to its own code band (the cash box already holds 20001)
    const d = await db.one<{ code: string }>(`select code from sm_details where id = $1`, [p.row.detail_id]);
    expect(Number(d!.code)).toBeGreaterThanOrEqual(10001);
    expect(Number(d!.code)).toBeLessThan(20000);
  });

  it("posts a balanced voucher and rejects an unbalanced one", async () => {
    const cash = await accountId(db, org, "cash");
    const capital = await accountId(db, org, "capital");
    const box = await db.one<{ detail_id: string }>(`select detail_id from sm_cash_boxes where org_id = $1`, [org]);
    const v = await c.post(`/o/${org}/accounting/vouchers`, {
      date: "2026-04-01",
      description: "آورده‌ی نقدی",
      lines: [
        { account_id: cash, detail_id: box!.detail_id, debit: "500000000" },
        { account_id: capital, credit: "500000000" },
      ],
    });
    expect(v.voucher.no).toBe(1);
    const bad = await c.post(`/o/${org}/accounting/vouchers`, { date: "2026-04-01", lines: [{ account_id: cash, detail_id: box!.detail_id, debit: "10" }, { account_id: capital, credit: "9" }] }, 400);
    expect(bad.error.message).toContain("تراز نیست");
    const missingDetail = await c.post(`/o/${org}/accounting/vouchers`, { date: "2026-04-01", lines: [{ account_id: cash, debit: "10" }, { account_id: capital, credit: "10" }] }, 400);
    expect(missingDetail.error.message).toContain("تفصیلی");
    const tb = await c.get(`/o/${org}/accounting/reports/trial-balance?level=1`);
    expect(tb.totals.debit).toBe("500000000");
    expect(tb.totals.credit).toBe("500000000");
    const bs = await c.get(`/o/${org}/accounting/reports/balance-sheet`);
    expect(bs.balanced).toBe(true);
    expect(bs.total_assets).toBe("500000000");
  });

  it("closes the fiscal year and opens the next one with the balances", async () => {
    const fy = (await c.get(`/o/${org}`)).fiscal_years[0];
    const r = await c.post(`/o/${org}/fiscal-years/${fy.id}/close`);
    expect(r.ok).toBe(true);
    const info = await c.get(`/o/${org}`);
    expect(info.fiscal_years).toHaveLength(2);
    const next = info.fiscal_years.find((f: { id: string }) => f.id === r.next_fiscal_year_id);
    const tb = await c.get(`/o/${org}/accounting/reports/trial-balance?level=3&fiscal_year_id=${next.id}`);
    const cashRow = tb.rows.find((x: { code: string }) => x.code === "1101");
    expect(cashRow.balance).toBe("500000000");
  });
});

describe("accounting reports: brought-forward balances and foreign currencies", () => {
  let c: Client;
  let db: Db;
  let org: string;
  let box: string;
  const acc: Record<string, string> = {};
  const cur: Record<string, string> = {};
  const o = (p: string) => `/o/${org}${p}`;
  const post = (date: string, lines: unknown[]) => c.post(o("/accounting/vouchers"), { date, lines });
  const bal = (rows: { balance: string }[]) => rows.map((r) => r.balance);
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    for (const k of ["cash", "capital", "misc_expense", "fx_parties"]) acc[k] = await accountId(db, org, k);
    for (const r of await db.query<{ id: string; code: string }>(`select id, code from sm_currencies where org_id = $1`, [org])) cur[r.code] = r.id;
    box = (await db.one<{ detail_id: string }>(`select detail_id from sm_cash_boxes where org_id = $1`, [org]))!.detail_id;
  });

  it("reports the opening voucher of a year as its opening balance, not as turnover", async () => {
    await post("2026-04-01", [{ account_id: acc.cash, detail_id: box, debit: "500000000" }, { account_id: acc.capital, credit: "500000000" }]);
    await post("2026-06-01", [{ account_id: acc.misc_expense, debit: "30000000" }, { account_id: acc.cash, detail_id: box, credit: "30000000" }]);
    const fy1 = (await c.get(o(""))).fiscal_years[0];
    const closed = await c.post(o(`/fiscal-years/${fy1.id}/close`));
    const fy2 = (await c.get(o(""))).fiscal_years.find((f: { id: string }) => f.id === closed.next_fiscal_year_id);
    expect(fy2.start_date).toBe("2027-03-21");
    const opening = await c.get(o(`/accounting/vouchers?fiscal_year_id=${fy2.id}&kind=opening`));
    expect(opening.rows.map((v: { date: string }) => v.date)).toEqual(["2027-03-21"]);
    await post("2027-04-10", [{ account_id: acc.misc_expense, debit: "20000000" }, { account_id: acc.cash, detail_id: box, credit: "20000000" }]);

    // 6/8-column trial balance of the new year, over the range the screen asks for
    const year = `fiscal_year_id=${fy2.id}&from=${fy2.start_date}&to=${fy2.end_date}`;
    const tb = await c.get(o(`/accounting/reports/trial-balance?level=3&${year}`));
    const row = (code: string) => tb.rows.find((r: { code: string }) => r.code === code);
    const cols = (r: { opening: string; debit: string; credit: string; balance: string }) => [r.opening, r.debit, r.credit, r.balance];
    expect(cols(row("1101"))).toEqual(["470000000", "0", "20000000", "450000000"]); // cash
    expect(cols(row("5101"))).toEqual(["-500000000", "0", "0", "-500000000"]); // capital
    expect(cols(row("5301"))).toEqual(["30000000", "0", "0", "30000000"]); // the year's loss carried in
    for (const r of tb.rows) expect(D(r.opening).plus(D(r.debit)).minus(D(r.credit)).toString()).toBe(r.balance);
    expect(tb.totals).toEqual({ opening_dr: "470000000", opening_cr: "470000000", debit: "20000000", credit: "20000000", balance_dr: "470000000", balance_cr: "470000000" });

    // the ledger of the year starts from the brought-forward balance and lists only the year's movements
    const led = await c.get(o(`/accounting/reports/ledger?account_id=${acc.cash}&${year}`));
    expect(led.opening).toBe("470000000");
    expect(bal(led.rows)).toEqual(["450000000"]);
    expect(led.totals).toMatchObject({ debit: "0", credit: "20000000", balance: "450000000" });

    // without a fiscal year (statements, cash book): from the new year on, the same opening …
    const fromNewYear = await c.get(o(`/accounting/reports/ledger?account_id=${acc.cash}&from=${fy2.start_date}`));
    expect(fromNewYear.opening).toBe("470000000");
    expect(bal(fromNewYear.rows)).toEqual(["450000000"]);
    expect(fromNewYear.totals).toMatchObject({ debit: "0", credit: "20000000", balance: "450000000" });
    // … and a range that also holds the old year's closing keeps the opening voucher as a movement
    const across = await c.get(o(`/accounting/reports/ledger?account_id=${acc.cash}&from=2026-05-01`));
    expect(across.opening).toBe("500000000");
    expect(bal(across.rows)).toEqual(["470000000", "0", "470000000", "450000000"]);
    expect(across.totals.balance).toBe("450000000");
    const all = await c.get(o(`/accounting/reports/trial-balance?level=3`));
    expect(all.rows.find((r: { code: string }) => r.code === "1101").balance).toBe("450000000");
  });

  it("keeps foreign amounts per currency in the ledger and the party statement", async () => {
    const party = (await c.post(o("/data/party"), { name: "مشتری ارزی", roles: ["customer"] })).row;
    const fx = (code: string, side: "debit" | "credit", amount: string, rate: string) => ({
      account_id: acc.fx_parties,
      detail_id: party.detail_id,
      currency_id: cur[code],
      fx_rate: rate,
      [side]: D(amount).times(rate).toString(),
      [`fx_${side}`]: amount,
    });
    await post("2027-04-01", [fx("USD", "debit", "100", "1000000"), fx("EUR", "debit", "50", "1150000"), { account_id: acc.capital, credit: "157500000" }]);
    await post("2027-05-10", [{ account_id: acc.capital, debit: "30000000" }, fx("USD", "credit", "30", "1000000")]);

    for (const by of [`account_id=${acc.fx_parties}`, `detail_id=${party.detail_id}`]) {
      const led = await c.get(o(`/accounting/reports/ledger?${by}&from=2027-05-01`));
      expect(led.opening).toBe("157500000");
      // 100 USD + 50 EUR is not «150» of anything
      expect(led.opening_fx).toBeNull();
      expect(led.totals.fx_balance).toBeNull();
      expect(led.fx_balances).toEqual([
        { currency_id: cur.EUR, currency_code: "EUR", opening: "50", debit: "0", credit: "0", balance: "50" },
        { currency_id: cur.USD, currency_code: "USD", opening: "100", debit: "0", credit: "30", balance: "70" },
      ]);
      // the running foreign balance of a line is in the line's own currency
      expect(led.rows.map((r: { currency_code: string; fx_balance: string }) => [r.currency_code, r.fx_balance])).toEqual([["USD", "70"]]);
    }
    // one currency: a single foreign figure as before
    const usd = await c.get(o(`/accounting/reports/ledger?detail_id=${party.detail_id}&currency_id=${cur.USD}&from=2027-05-01`));
    expect([usd.opening_fx, usd.totals.fx_balance]).toEqual(["100", "70"]);
    expect(usd.fx_balances.map((f: { currency_code: string }) => f.currency_code)).toEqual(["USD"]);
  });
});
