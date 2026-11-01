import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, accountId } from "./helpers";
import type { Db } from "@server/db";

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
  });

  it("posts a balanced voucher and rejects an unbalanced one", async () => {
    const cash = await accountId(db, org, "cash");
    const capital = await accountId(db, org, "capital");
    const box = await db.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [org]);
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
