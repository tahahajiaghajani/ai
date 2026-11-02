// The assistant's tools: catalogue and filtering, numbers equal to the report services on seeded
// data, permissions and modules, the calculator, Jalali periods, and the proposal executors.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { Db } from "@server/db";
import { makeCtx, type Ctx, type ServerConfig, type AuthUser, type OrgRow, type MemberRow } from "@server/context";
import type { Role } from "@shared/permissions";
import { D } from "@shared/money";
import { ALL_TOOLS, toolsFor } from "@server/modules/ai/tools/index";
import { EXECUTORS, executeProposal } from "@server/modules/ai/tools/proposals";
import type { AiToolDef, ToolRuntime, ToolResult } from "@server/modules/ai/tools/registry";
import { comparePeriod, parseDateInput, presetPeriod, previousMonthToDate, resolvePeriod } from "@server/modules/ai/analytics/period";
import { contextBlock } from "@server/modules/ai/prompts";
import { evaluate } from "@server/modules/ai/analytics/calc";
import * as acc from "@server/modules/accounting/reports";
import { analysis } from "@server/modules/goods/reports";
import { goldPosition } from "@server/modules/gold/position";

const TODAY = "2026-11-02"; // 1405/08/11

let db: Db;
let c: Client;
let org: string;
let cfg: ServerConfig;
const ids: Record<string, string> = {};

async function ctxAs(role: Role, opts: { modules?: string[]; overrides?: MemberRow["overrides"] } = {}): Promise<Ctx> {
  const user = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users limit 1`))!;
  const o = (await db.one<OrgRow>(`select * from tz_orgs where id = $1`, [org]))!;
  if (opts.modules) o.modules = opts.modules as OrgRow["modules"];
  const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1 limit 1`, [org]))!;
  return makeCtx(cfg, user, o, { ...m, role, overrides: opts.overrides ?? {} });
}

function runtime(policy: ToolRuntime["dataPolicy"] = "full"): ToolRuntime & { stored: Record<string, unknown>[][] } {
  const stored: Record<string, unknown>[][] = [];
  return {
    today: TODAY,
    dataPolicy: policy,
    stored,
    async putData(rows) {
      stored.push(rows);
      return `ref${stored.length}`;
    },
  };
}

function tool(name: string): AiToolDef {
  const t = ALL_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

async function run(name: string, input: unknown, ctx?: Ctx, rt = runtime()): Promise<ToolResult & { data: any }> {
  const t = tool(name);
  const parsed = t.input.parse(input);
  return (await t.run(ctx ?? (await ctxAs("owner")), parsed, rt)) as ToolResult & { data: any };
}

describe("ai tools", () => {
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig;
    const o = (p: string) => `/o/${org}${p}`;
    const unit = (await db.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد'`, [org]))!.id;
    ids.itemA = (await c.post(o("/data/item"), { name: "دوربین مداربسته", kind: "goods", unit_id: unit, vat_pct: "0", sale_price: "1500000", reorder_point: "15" })).row.id;
    ids.itemB = (await c.post(o("/data/item"), { name: "کابل شبکه", kind: "goods", unit_id: unit, vat_pct: "10", sale_price: "200000" })).row.id;
    const cust = (await c.post(o("/data/party"), { name: "فروشگاه نیک", roles: ["customer"], mobile: "09121234567" })).row;
    const supp = (await c.post(o("/data/party"), { name: "پخش البرز", roles: ["supplier"] })).row;
    ids.customer = cust.id;
    ids.supplier = supp.id;
    await c.post(o("/goods/invoices"), { kind: "purchase", date: "2026-09-10", party_id: supp.id, lines: [{ item_id: ids.itemA, qty: "20", unit_price: "1000000", vat_pct: "0" }, { item_id: ids.itemB, qty: "100", unit_price: "100000", vat_pct: "0" }] });
    // Mehr 1405 (2026-09-23 … 2026-10-22) and Aban 1405 sales
    await c.post(o("/goods/invoices"), { kind: "sale", date: "2026-09-25", due_date: "2026-10-10", party_id: cust.id, lines: [{ item_id: ids.itemA, qty: "4", unit_price: "1500000", vat_pct: "0" }] });
    await c.post(o("/goods/invoices"), { kind: "sale", date: "2026-10-15", party_id: cust.id, discount: "50000", lines: [{ item_id: ids.itemA, qty: "2", unit_price: "1600000", vat_pct: "0" }, { item_id: ids.itemB, qty: "10", unit_price: "200000", vat_pct: "10" }] });
    await c.post(o("/goods/invoices"), { kind: "sale", date: "2026-10-28", party_id: cust.id, lines: [{ item_id: ids.itemB, qty: "5", unit_price: "210000", vat_pct: "10" }] });
    const box = (await db.one<{ id: string }>(`select id from tz_cash_boxes where org_id = $1 limit 1`, [org]))!.id;
    ids.box = box;
    await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-10-20", party_id: cust.id, lines: [{ method: "cash", cash_box_id: box, amount: "2000000" }] });
    await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-10-21", party_id: cust.id, lines: [{ method: "cheque", amount: "3000000", cheque: { serial_no: "556677", due_date: "2026-11-10" } }] });
    await c.post(o("/gold/rates"), { gram18: "80000000", mazaneh: "346000000" });
    const board = await c.get(o("/fx/rates"));
    for (const x of board.currencies) ids[`cur_${x.code}`] = x.id;
    await c.post(o("/fx/rates"), { at: "2026-11-01T08:00:00Z", rates: [{ currency_id: ids.cur_USD, buy: "1000000", sell: "1020000" }] });
  });

  it("has 20–24 tools with unique snake_case names, English descriptions and zod inputs", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(20);
    expect(ALL_TOOLS.length).toBeLessThanOrEqual(24);
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ALL_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(t.description.length).toBeGreaterThan(60);
      const persian = (t.description.match(/[\u0600-\u06FF]/g) ?? []).length;
      expect(persian / t.description.length).toBeLessThan(0.05);
      expect(typeof t.input.parse).toBe("function");
    }
  });

  it("filters tools by permission, proposals switch and modules", async () => {
    const owner = toolsFor(await ctxAs("owner"), { proposals: true }).map((t) => t.name);
    expect(owner).toContain("propose_invoice");
    expect(owner).toContain("propose_gold_doc");
    const ownerNoProposals = toolsFor(await ctxAs("owner"), { proposals: false }).map((t) => t.name);
    expect(ownerNoProposals.some((n) => n.startsWith("propose_"))).toBe(false);
    const viewer = toolsFor(await ctxAs("viewer"), { proposals: true }).map((t) => t.name);
    expect(viewer.some((n) => n.startsWith("propose_"))).toBe(false);
    expect(viewer).toContain("run_report");
    const goodsOnly = toolsFor(await ctxAs("owner", { modules: ["goods"] }), { proposals: true }).map((t) => t.name);
    for (const n of ["price_quote", "coin_bubble", "propose_gold_doc", "propose_fx_deal"]) expect(goodsOnly).not.toContain(n);
    const warehouse = toolsFor(await ctxAs("warehouse"), { proposals: true }).map((t) => t.name);
    expect(warehouse).not.toContain("cheques_calendar");
    expect(warehouse).toContain("inventory_advice");
  });

  it("calculates exactly without eval", async () => {
    expect(evaluate("(1200 + 300) × 9%").toString()).toBe("135");
    expect(evaluate("۳٫۵ میلیارد / ۷").toString()).toBe("500000000");
    expect(evaluate("0.1 + 0.2").toString()).toBe("0.3");
    expect(evaluate("-(2 - 5) * 1,000").toString()).toBe("3000");
    const r = await run("calculate", { expression: "10 / 3", decimals: 4 });
    expect(r.data.rounded).toBe("3.3333");
    await expect(run("calculate", { expression: "1 / 0" })).rejects.toThrow(/صفر/);
    await expect(run("calculate", { expression: "process.exit()" })).rejects.toThrow();
  });

  it("resolves Jalali periods on the server", () => {
    const m = presetPeriod("this_month", TODAY);
    expect([m.from, m.to]).toEqual(["2026-10-23", "2026-11-21"]);
    expect(m.label_fa).toBe("آبان ۱۴۰۵");
    const lm = presetPeriod("last_month", TODAY);
    expect([lm.from, lm.to]).toEqual(["2026-09-23", "2026-10-22"]);
    const q = presetPeriod("this_quarter", TODAY);
    expect([q.from, q.to]).toEqual(["2026-09-23", "2026-12-21"]);
    expect(q.label_fa).toBe("پاییز ۱۴۰۵");
    const w = presetPeriod("this_week", TODAY); // Monday → week starts Saturday 2026-10-31
    expect(w.from).toBe("2026-10-31");
    expect(comparePeriod(lm, "same_period_last_year").from).toBe("2025-09-23");
    expect(comparePeriod(lm, "previous_period").label_fa).toBe("شهریور ۱۴۰۵");
    expect(parseDateInput("۱۴۰۵/۰۸/۰۱", TODAY)).toBe("2026-10-23");
    expect(resolvePeriod({ from: "1405/07/01", to: "2026-10-22" }, TODAY).days).toBe(30);
    expect(() => resolvePeriod({ from: "1405/13/40" }, TODAY)).toThrow();
  });

  it("analyze_metric sales equal the goods sales report", async () => {
    const ctx = await ctxAs("owner");
    for (const [from, to] of [["2026-09-23", "2026-10-22"], ["2026-10-23", "2026-11-21"]]) {
      const rep = await analysis(ctx, "sales", { group: "item", from, to });
      const r = await run("analyze_metric", { metric: "sales_amount", period: { from, to } }, ctx);
      expect(D(r.data.total).toFixed()).toBe(D(rep.totals.amount).toFixed());
      const p = await run("analyze_metric", { metric: "gross_profit", period: { from, to } }, ctx);
      expect(D(p.data.total).toFixed()).toBe(D(rep.totals.profit).toFixed());
    }
    const byItem = await run("analyze_metric", { metric: "sales_amount", period: { preset: "this_quarter" }, group_by: "item" }, ctx);
    const rep = await analysis(ctx, "sales", { group: "item", from: "2026-09-23", to: "2026-12-21" });
    for (const row of rep.rows) expect(D(byItem.data.rows.find((r: any) => r.key === row.key)?.value ?? 0).toFixed()).toBe(D(row.amount).toFixed());
    const monthly = await run("analyze_metric", { metric: "sales_amount", period: { preset: "this_quarter" }, group_by: "month", compare_to: "previous_period" }, ctx);
    expect(monthly.data.rows.map((r: any) => r.label)).toEqual(["مهر ۱۴۰۵", "آبان ۱۴۰۵", "آذر ۱۴۰۵"]);
    expect(monthly.chart?.kind).toBe("line");
    expect(monthly.data.comparison.period.label_fa).toBe("تابستان ۱۴۰۵");
  });

  it("compares month to date with the first days of the previous month", () => {
    // 1405/08/21: 1–21 Aban against 1–21 Mehr (not 10–30 Mehr)
    const cur = presetPeriod("month_to_date", "2026-11-12");
    expect(cur.days).toBe(21);
    const prev = previousMonthToDate(cur);
    expect([prev.from, prev.to]).toEqual(["2026-09-23", "2026-10-13"]);
    expect(prev.days).toBe(21);
    // the 31st of a 31-day month against a 30-day month: cut at that month's end
    const long = presetPeriod("month_to_date", "2026-08-22"); // 1405/05/31
    const p2 = previousMonthToDate(long);
    expect(p2.to).toBe("2026-07-22"); // 1405/04/31
    const esf = previousMonthToDate(presetPeriod("month_to_date", "2027-04-20")); // 1406/01/31 against Esfand 1405
    expect(esf.from).toBe("2027-02-20");
    expect(esf.to).toBe("2027-03-20");
  });

  it("analyze_metric keeps totals and the comparison ahead of a long time series, bounded, and hides names under aggregates", async () => {
    const ctx = await ctxAs("owner");
    const daily = await run("analyze_metric", { metric: "sales_amount", period: { preset: "last_365_days" }, group_by: "day", compare_to: "previous_period" }, ctx);
    const keys = Object.keys(daily.data);
    expect(keys.indexOf("comparison")).toBeLessThan(keys.indexOf("rows"));
    expect(keys.indexOf("total")).toBeLessThan(keys.indexOf("rows"));
    expect(keys[keys.length - 1]).toBe("rows");
    expect(daily.data.rows_total).toBe(365);
    expect(daily.data.rows).toHaveLength(60);
    expect(daily.data.rows_omitted).toMatch(/305/);
    expect(daily.data.rows.at(-1).key).toBe(TODAY);
    expect(JSON.stringify(daily.data).length).toBeLessThan(24_000);
    const byParty = await run("analyze_metric", { metric: "sales_amount", period: { preset: "this_year" }, group_by: "party" }, ctx, runtime("aggregates"));
    expect(byParty.data.rows.length).toBeGreaterThan(0);
    expect(byParty.data.rows[0].label).toBe("شخص 1");
    expect(byParty.data.rows[0].key).toBeUndefined();
    const named = await run("analyze_metric", { metric: "sales_amount", period: { preset: "this_year" }, group_by: "party" }, ctx, runtime("masked"));
    expect(named.data.rows[0].label).not.toMatch(/^شخص \d/);
  });

  it("tells the model the unit the tools format money in", async () => {
    const ctx = await ctxAs("owner");
    const block = await contextBlock(ctx, null);
    const unit = JSON.parse(block.replace(/<\/?context>/g, "")).money_unit_shown_to_people;
    expect(unit).toMatch(ctx.org.base_currency === "IRT" ? /toman/ : ctx.org.base_currency === "IRR" ? /rial/ : new RegExp(ctx.org.base_currency));
    const toman = await ctxAs("owner");
    toman.org = { ...toman.org, base_currency: "IRT" };
    const base = (await db.one<{ code: string; symbol: string | null }>(`select code, symbol from tz_currencies where org_id = $1 and is_base`, [org]))!;
    await db.query(`update tz_currencies set code = 'IRT', symbol = null where org_id = $1 and is_base`, [org]);
    try {
      expect(JSON.parse((await contextBlock(toman, null)).replace(/<\/?context>/g, "")).money_unit_shown_to_people).toMatch(/toman/);
    } finally {
      await db.query(`update tz_currencies set code = $2, symbol = $3 where org_id = $1 and is_base`, [org, base.code, base.symbol]);
    }
  });

  it("balances and reports equal the accounting services", async () => {
    const ctx = await ctxAs("owner");
    const tb = await acc.trialBalance(db, org, { from: "2026-03-21", to: "2027-03-20", level: 3, nonZero: true });
    const r = await run("run_report", { report: "trial_balance", period: { preset: "fiscal_year" } }, ctx);
    expect(r.data.result.totals).toEqual(expect.objectContaining({ debit: tb.totals.debit, credit: tb.totals.credit }));
    expect(r.table?.total_rows).toBe(tb.rows.length);
    const is = await acc.incomeStatement(db, org, { from: "2026-03-21", to: "2027-03-20" });
    const r2 = await run("run_report", { report: "income_statement", period: { preset: "fiscal_year" } }, ctx);
    expect(r2.data.result.net).toBe(is.net);
    const inc = await run("analyze_metric", { metric: "income", period: { preset: "fiscal_year" } }, ctx);
    expect(D(inc.data.total).toFixed()).toBe(D(is.total_income).toFixed());
    const ar = await run("analyze_metric", { metric: "receivables", period: { to: TODAY } }, ctx);
    const balance = (await c.get(`/o/${org}/treasury/party-balance/${ids.customer}`)).balance;
    expect(D(ar.data.total).toFixed()).toBe(D(balance).toFixed());
    const cash = await run("analyze_metric", { metric: "cash_balance", period: { to: TODAY } }, ctx);
    const bal = await c.get(`/o/${org}/treasury/balances`);
    expect(D(cash.data.total).toFixed()).toBe(D(bal.cash_total).toFixed());
  });

  it("enforces report permissions and modules like the routes", async () => {
    const warehouse = await ctxAs("warehouse");
    await expect(run("run_report", { report: "cheques_due" }, warehouse)).rejects.toThrow();
    await expect(run("find_records", { type: "voucher" }, warehouse)).rejects.toThrow();
    const goodsOnly = await ctxAs("owner", { modules: ["goods"] });
    await expect(run("run_report", { report: "gold_stock" }, goodsOnly)).rejects.toThrow(/فعال/);
    const cashier = await ctxAs("cashier", { overrides: { reports: "none" } });
    await expect(run("analyze_metric", { metric: "gross_profit" }, cashier)).rejects.toThrow();
  });

  it("finds and reads records, masking identifiers by the data policy", async () => {
    const masked = await run("find_records", { type: "party", query: "نیک" }, undefined, runtime("masked"));
    expect(masked.data.rows[0].name).toBe("فروشگاه نیک");
    expect(masked.data.rows[0].mobile).not.toContain("1234567");
    const full = await run("find_records", { type: "party", query: "۰۹۱۲۱۲۳۴۵۶۷" }, undefined, runtime("full"));
    expect(full.data.rows[0].mobile).toBe("09121234567");
    const agg = await run("find_records", { type: "party", query: "نیک" }, undefined, runtime("aggregates"));
    expect(agg.data.rows[0].name).not.toContain("نیک");
    const inv = await run("find_records", { type: "invoice", period: { preset: "last_month" } });
    expect(inv.data.rows).toHaveLength(2); // the two sales of Mehr (the purchase is in Shahrivar)
    const one = await run("get_record", { type: "invoice", id: inv.refs![0].id });
    expect(one.data.lines.length).toBeGreaterThan(0);
    const party = await run("get_record", { type: "party", id: ids.customer });
    expect(party.data.balance.current_account).toContain("ریال");
  });

  it("gives positions, quotes and cheques", async () => {
    const q = await run("price_quote", { kind: "jewelry", weight: "10", wage_type: "percent", wage_value: "10", profit_pct: "7" });
    // 10 g × 80,000,000 = 800,000,000; wage 80,000,000; profit 61,600,000; VAT on wage+profit
    expect(q.data.breakdown[0].amount).toBe("800000000");
    expect(q.data.rates_used.gram18).toBe("80000000");
    const melted = await run("price_quote", { kind: "melted", weight: "4.6083", fineness: "705" });
    expect(D(melted.data.total).toFixed()).toBe("346000000");
    const g = await run("get_rates", { kind: "gold" });
    expect(g.data.gram18).toBe("80000000");
    const fx = await run("get_rates", { kind: "fx" });
    expect(fx.data.rows.find((r: any) => r.code === "USD").buy).toBe("1000000");
    const cal = await run("cheques_calendar", {});
    expect(D(cal.data.totals.received).toFixed()).toBe("3000000");
    const debt = await run("receivables_collection", {});
    expect(debt.data.rows[0].party).toBe("فروشگاه نیک");
    const reorder = await run("inventory_advice", { mode: "reorder" });
    expect(reorder.data.rows.map((r: any) => r.item)).toContain("دوربین مداربسته"); // 14 left ≤ reorder point 15
    const pos = await run("positions", { kind: "all" });
    const gp = await goldPosition(await ctxAs("owner"), TODAY);
    expect(pos.data.gold.totals.weight750).toBe(gp.totals.weight750);
    const rep = await run("run_report", { report: "gold_position", period: { to: TODAY } });
    expect(rep.data.result.totals.book).toBe(gp.totals.book);
    expect(pos.data.fx.rows).toEqual([]);
    const anomalies = await run("find_anomalies", { period: { preset: "last_90_days" } });
    expect(Array.isArray(anomalies.data.rows)).toBe(true);
  });

  it("proposal tools prepare drafts and executors create them only with permission", async () => {
    const owner = await ctxAs("owner");
    const p = await run("propose_invoice", { kind: "sale", party: "فروشگاه نیک", lines: [{ item: "کابل شبکه", qty: 3 }] }, owner);
    expect(p.proposal?.kind).toBe("sales_invoice");
    expect(p.proposal?.area).toBe("sales");
    expect(p.proposal?.preview.find((x) => x.label === "مبلغ کل")?.value).toContain("۶۶۰٬۰۰۰");
    const viewer = await ctxAs("viewer");
    await expect(executeProposal(viewer, "sales_invoice", p.proposal!.payload)).rejects.toThrow();
    const created = await executeProposal(owner, "sales_invoice", p.proposal!.payload);
    const inv = await db.one<{ status: string; total: string }>(`select status, total from tz_invoices where id = $1`, [created.id]);
    expect(inv).toEqual({ status: "draft", total: "660000" });

    await expect(run("propose_invoice", { kind: "sale", party: "نیک", lines: [{ item: "کابل شبکه", qty: 1 }] }, owner)).rejects.toThrow(/شناسه/);

    const cashAcc = (await db.one<{ code: string }>(`select code from tz_accounts where org_id = $1 and system_key = 'cash'`, [org]))!.code;
    const expAcc = (await db.one<{ code: string }>(`select code from tz_accounts where org_id = $1 and system_key = 'misc_expense'`, [org]))!.code;
    await expect(run("propose_voucher", { description: "هزینه", lines: [{ account: expAcc, debit: 100 }, { account: cashAcc, credit: 90 }] }, owner)).rejects.toThrow(/تراز/);
    const box = (await db.one<{ name: string }>(`select d.name from tz_cash_boxes b join tz_details d on d.id = b.detail_id where b.org_id = $1 limit 1`, [org]))!.name;
    const v = await run("propose_voucher", { description: "هزینهٔ پذیرایی", lines: [{ account: expAcc, debit: 100000 }, { account: cashAcc, detail: box, credit: 100000 }] }, owner);
    const vr = await executeProposal(owner, "voucher", v.proposal!.payload);
    expect((await db.one<{ status: string }>(`select status from tz_vouchers where id = $1`, [vr.id]))!.status).toBe("draft");
    await expect(executeProposal(await ctxAs("sales"), "voucher", v.proposal!.payload)).rejects.toThrow();

    const t = await run("propose_treasury_doc", { kind: "receipt", party: ids.customer, amount: "50000", money_unit: "toman", via: { method: "cash" } }, owner);
    expect((t.proposal!.payload as any).lines[0].amount).toBe("500000");
    const tr = await executeProposal(owner, "receipt", t.proposal!.payload);
    expect(tr.type).toBe("treasury_doc");

    const party = await run("propose_party", { kind: "person", name: "رضا کریمی", national_id: "0084575948", mobile: "09351112233" }, owner);
    const pr = await executeProposal(owner, "party", party.proposal!.payload);
    expect(pr.type).toBe("party");
    await expect(run("propose_party", { kind: "person", name: "دیگری", mobile: "09351112233" }, owner)).rejects.toThrow(/پیش‌تر/);
    await expect(run("propose_party", { kind: "person", name: "کد بد", national_id: "1234567890" }, owner)).rejects.toThrow(/کد ملی/);

    const fx = await run("propose_fx_deal", { side: "buy", currency: "USD", amount: "100" }, owner);
    const fr = await executeProposal(owner, "fx_deal", fx.proposal!.payload);
    const deal = await db.one<{ status: string; rate: string }>(`select status, rate from tz_fx_deals where id = $1`, [fr.id]);
    expect(deal!.status).toBe("draft");
    expect(D(deal!.rate).toFixed()).toBe("1000000");

    const gd = await run("propose_gold_doc", { kind: "buyback", lines: [{ kind: "old", weight: "5", fineness: "750" }] }, owner);
    expect(gd.proposal!.kind).toBe("gold_doc");
    const gr = await executeProposal(owner, "gold_doc", gd.proposal!.payload);
    expect((await db.one<{ status: string }>(`select status from tz_gold_docs where id = $1`, [gr.id]))!.status).toBe("draft");

    expect(Object.keys(EXECUTORS).sort()).toEqual(["fx_deal", "gold_doc", "party", "payment", "purchase_invoice", "quote", "receipt", "sales_invoice", "transfer", "voucher"]);
  });
});
