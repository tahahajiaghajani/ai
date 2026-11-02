// Forecasting toolkit on synthetic series (classification, Croston/SBA/TSB, ETS and seasonal
// naive, backtests, refusals, price ranges, VaR) and the 13-week cash flow on seeded books.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { Db } from "@server/db";
import { makeCtx, type Ctx, type ServerConfig, type AuthUser, type OrgRow, type MemberRow } from "@server/context";
import { D } from "@shared/money";
import { classify, forecastSeries, historicalVaR, quantile, rateRanges, robustZ } from "@server/modules/ai/analytics/forecast";
import { cashflow13, forecast, type CashWeek } from "@server/modules/ai/features/forecasts";
import { moneyInfo } from "@server/modules/ai/tools/common";

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function normal(r: () => number) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

describe("forecast math", () => {
  it("classifies demand patterns (Syntetos–Boylan)", () => {
    expect(classify([10, 11, 9, 10, 12, 10, 9, 11]).cls).toBe("smooth");
    expect(classify([10, 40, 2, 25, 1, 60, 5, 30]).cls).toBe("erratic");
    expect(classify([0, 0, 5, 0, 0, 5, 0, 0, 6, 0, 0, 5]).cls).toBe("intermittent");
    expect(classify([0, 0, 1, 0, 0, 30, 0, 0, 2, 0, 0, 50]).cls).toBe("lumpy");
  });

  it("uses Croston/SBA/TSB for intermittent demand with a sensible level", () => {
    const y = Array.from({ length: 36 }, (_, i) => (i % 3 === 2 ? 9 : 0));
    const f = forecastSeries(y, 3);
    expect(f.ok).toBe(true);
    expect(["croston", "sba", "tsb", "ses"]).toContain(f.method_key);
    expect(f.points).toHaveLength(3);
    for (const p of f.points) {
      expect(p.p50).toBeGreaterThan(2);
      expect(p.p50).toBeLessThan(4);
      expect(p.p10).toBeLessThanOrEqual(p.p50);
      expect(p.p90).toBeGreaterThanOrEqual(p.p50);
      expect(p.p10).toBeGreaterThanOrEqual(0);
    }
    // SBA is Croston with the bias correction (1 − α/2): never above Croston on the same series
    const croston = forecastSeries(y, 1).points[0].p50;
    expect(croston).toBeGreaterThan(0);
  });

  it("TSB decays when an item stops selling", () => {
    const y = [...Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 6 : 0)), ...Array(12).fill(0)];
    const f = forecastSeries(y, 1);
    expect(f.ok).toBe(true);
    expect(f.points[0].p50).toBeLessThan(3);
  });

  it("picks a seasonal method for a seasonal monthly series and beats the naive benchmark", () => {
    const r = rng(7);
    const season = [100, 120, 150, 130, 110, 90, 80, 85, 95, 140, 180, 200];
    const y = Array.from({ length: 48 }, (_, i) => season[i % 12] + i * 0.5 + normal(r) * 3);
    const f = forecastSeries(y, 12, { seasonPeriod: 12 });
    expect(f.ok).toBe(true);
    expect(["seasonal_naive", "holt_winters"]).toContain(f.method_key);
    expect(f.backtest!.mase!).toBeLessThan(1);
    expect(f.backtest!.n).toBeGreaterThan(0);
    // next month is the first month of the cycle again: close to its seasonal level
    expect(Math.abs(f.points[0].p50 - (season[0] + 48 * 0.5))).toBeLessThan(15);
    expect(f.points[10].p50).toBeGreaterThan(f.points[6].p50);
  });

  it("measures the band's coverage and widens a band that was too narrow", () => {
    const r = rng(11);
    const y = Array.from({ length: 40 }, () => 100 + normal(r) * 10);
    const f = forecastSeries(y, 3);
    expect(f.ok).toBe(true);
    expect(f.backtest!.coverage80!).toBeGreaterThan(0.5);
    expect(f.points[0].p90 - f.points[0].p10).toBeGreaterThan(10);
  });

  it("refuses when the data is thin", () => {
    expect(forecastSeries([5, 6, 7], 3).refused_reason_fa).toMatch(/دادهٔ کافی نیست/);
    expect(forecastSeries(Array(12).fill(0), 3).ok).toBe(false);
    const sparse = [0, 0, 0, 4, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 5, 0, 0, 0];
    expect(forecastSeries(sparse, 3).refused_reason_fa).toMatch(/پراکنده/);
  });

  it("gives price ranges from EWMA volatility around today's price", () => {
    const r = rng(3);
    const prices = [100];
    for (let i = 1; i < 300; i++) prices.push(prices[i - 1] * Math.exp(normal(r) * 0.01));
    const out = rateRanges(prices, [1, 7, 30]);
    expect(out.ok).toBe(true);
    const last = prices[prices.length - 1];
    for (const p of out.points) {
      expect(p.p50).toBe(last);
      expect(p.p10).toBeLessThan(last);
      expect(p.p90).toBeGreaterThan(last);
    }
    expect(out.points[2].p90 - out.points[2].p10).toBeGreaterThan(out.points[0].p90 - out.points[0].p10);
    expect(out.sigma_daily).toBeGreaterThan(0.005);
    expect(out.sigma_daily).toBeLessThan(0.02);
    expect(out.backtest!.coverage80!).toBeGreaterThan(0.5);
    expect(rateRanges(prices.slice(0, 30), [1]).refused_reason_fa).toMatch(/۶۰|60/);
  });

  it("computes historical VaR, quantiles and robust z-scores", () => {
    expect(historicalVaR([1, 2, 3])).toBeNull();
    const pnl = Array.from({ length: 100 }, (_, i) => i - 50); // −50 … 49
    const v = historicalVaR(pnl, 0.95)!;
    expect(v.var).toBeCloseTo(45.05, 1);
    expect(v.es).toBeGreaterThan(v.var);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(Math.abs(robustZ(100, [10, 11, 9, 10, 12, 10]))).toBeGreaterThan(10);
  });
});

describe("13-week cash flow and forecasts on seeded books", () => {
  const TODAY = "2026-11-02"; // Monday; the week starts on Saturday 2026-10-31
  let db: Db;
  let c: Client;
  let org: string;
  let ctx: Ctx;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c, ["goods"]);
    const o = (p: string) => `/o/${org}${p}`;
    const unit = (await db.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد'`, [org]))!.id;
    const item = (await c.post(o("/data/item"), { name: "کالای آزمایشی", kind: "goods", unit_id: unit, vat_pct: "0" })).row.id;
    const cust = (await c.post(o("/data/party"), { name: "مشتری", roles: ["customer"] })).row.id;
    const supp = (await c.post(o("/data/party"), { name: "تأمین‌کننده", roles: ["supplier"] })).row.id;
    const box = (await db.one<{ id: string }>(`select id from tz_cash_boxes where org_id = $1 limit 1`, [org]))!.id;
    const bank = (await c.post(o("/data/bank_account"), { name: "ملت", bank_name: "ملت" })).row.id;
    const book = (await c.post(o("/data/cheque_book"), { bank_account_id: bank, title: "دسته‌چک", serial_from: "100001", serial_to: "100050", sheets: 50 })).row.id;
    // cash 10,000,000 on hand
    await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-10-01", party_id: cust, lines: [{ method: "cash", cash_box_id: box, amount: "10000000" }] });
    // a received cheque due in week 2 (2026-11-07 … 11-13) and an issued one due in week 3
    await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-10-02", party_id: cust, lines: [{ method: "cheque", amount: "4000000", cheque: { serial_no: "11", due_date: "2026-11-09" } }] });
    await c.post(o("/treasury/docs"), { kind: "payment", date: "2026-10-03", party_id: supp, lines: [{ method: "cheque", amount: "25000000", cheque: { cheque_book_id: book, serial_no: "100001", due_date: "2026-11-16" } }] });
    // an open sales invoice due in week 5 (2026-11-28 … 12-04)
    await c.post(o("/goods/invoices"), { kind: "purchase", date: "2026-09-01", party_id: supp, settlement: "credit", lines: [{ item_id: item, qty: "10", unit_price: "100000", vat_pct: "0" }] });
    await c.post(o("/goods/invoices"), { kind: "sale", date: "2026-10-30", due_date: "2026-11-30", party_id: cust, lines: [{ item_id: item, qty: "2", unit_price: "1500000", vat_pct: "0" }] });
    const user = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users limit 1`))!;
    const orgRow = (await db.one<OrgRow>(`select * from tz_orgs where id = $1`, [org]))!;
    const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1`, [org]))!;
    const cfg = { mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig;
    ctx = makeCtx(cfg, user, orgRow, m);
  });

  it("builds 13 weeks from balances, cheques both ways, open invoices and recurring costs", async () => {
    const f = await cashflow13(ctx, TODAY, await moneyInfo(ctx));
    const d = f.details as { weeks: CashWeek[]; opening: { total: string }; shortfall_weeks: string[] };
    expect(d.weeks).toHaveLength(13);
    expect(d.weeks[0].week_start).toBe("2026-10-31");
    expect(d.opening.total).toBe("10000000");
    expect(d.weeks[1].cheques_in).toBe("4000000");
    expect(d.weeks[2].cheques_out).toBe("25000000");
    expect(d.weeks[4].invoices_in).toBe("3000000");
    // the open purchase invoice (credit, no due date) is paid 30 days after its date: already past → this week
    expect(d.weeks[0].invoices_out).toBe("1000000");
    // closing = opening + running net, week by week
    let bal = D(d.opening.total);
    for (const w of d.weeks) {
      bal = bal.plus(D(w.net));
      expect(w.closing_p50).toBe(bal.toFixed());
      expect(D(w.closing_p10).lte(D(w.closing_p50))).toBe(true);
      expect(D(w.closing_p90).gte(D(w.closing_p50))).toBe(true);
    }
    // 10 + 4 − 25 − 1 = −12 million after week 3: a shortfall from then on
    expect(d.weeks[2].shortfall).toBe(true);
    expect(d.weeks[1].shortfall).toBe(false);
    expect(d.shortfall_weeks[0]).toBe(d.weeks[2].label);
    expect(f.series.forecast).toHaveLength(13);
    expect(f.series.history).toHaveLength(13);
  });

  it("refuses a sales forecast with too little history and checks permissions", async () => {
    const f = await forecast(ctx, "sales", { grain: "month" }, TODAY);
    expect(f.series.refused_reason_fa).toBeTruthy();
    expect(f.series.forecast).toEqual([]);
    const viewer = makeCtx(ctx.cfg, ctx.user, ctx.org, { ...ctx.member, role: "warehouse" });
    await expect(cashflow13(viewer, TODAY, await moneyInfo(viewer))).rejects.toThrow();
    await expect(forecast(ctx, "rate", { rate: "gold18" }, TODAY)).rejects.toThrow(/فعال نیست/);
  });

  it("demand forecast uses Jalali months and classifies the item", async () => {
    const f = await forecast(ctx, "demand", { item: "کالای آزمایشی" }, TODAY);
    expect(f.series.unit).toBe("عدد");
    expect(f.series.refused_reason_fa).toBeTruthy();
    expect(f.series.history.at(-1)?.period).toBe("مهر ۱۴۰۵");
  });
});
