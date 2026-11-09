// IT financial management end to end: seeds (fiscal years from 1 Farvardin with their periods, cost types, cost
// centres, approved budgets), the insert-only ledger (period from the date, closed periods, reversal), automated cost
// capture from assets, depreciation, contracts and subscriptions (idempotent), budget against actual and its
// rule-based narrative, spend views, allocation runs (showback and chargeback posting, exact totals, statements),
// service cost, budget approval and alerts, and access (money needs the financial area and field group).
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { budgetAlerts, capture } from "@server/modules/financial";
import { fiscalYearOf, periodKeyOf } from "@shared/financial/logic";
import { todayISO } from "@shared/jalali";

let w: ItamWorld;
const today = () => todayISO("Asia/Tehran");
let jy: number;
let cc: string;
let hw: string;

beforeAll(async () => {
  w = await itamWorld();
  jy = fiscalYearOf(today());
  cc = await w.idOf("org_unit", "code", "CC-IT-INF");
  hw = await w.idOf("cost_type", "code", "HW");
}, 120_000);

describe("seeds", () => {
  it("adds this and next fiscal year with twelve periods, cost types, centres and budgets", async () => {
    const years = await w.p.fin.client.post(`${w.P}/r/fiscal_year/query`, { sort: "year" });
    expect(years.rows.map((y: any) => y.year)).toEqual([jy, jy + 1]);
    const periods = await w.p.fin.client.post(`${w.P}/r/fiscal_period/query`, { filter: { f: "fiscal_year_id", op: "eq", v: years.rows[0].id }, size: 20 });
    expect(periods.rows).toHaveLength(12);
    const budgets = await w.p.fin.client.post(`${w.P}/r/budget/query`, {});
    expect(budgets.rows.length).toBe(3);
    expect(budgets.rows.every((b: any) => b.state === "approved" && Number(b.total) > 0)).toBe(true);
    const meta = await w.p.fin.client.get(`${w.P}/financial/meta`);
    expect(meta).toMatchObject({ current_year: jy, financial: true, can_manage: true });
  });
});

describe("the ledger", () => {
  it("takes its period from the date and refuses changes and deletions", async () => {
    const e = (await w.p.fin.client.post(`${w.P}/r/cost_entry`, { entry_date: today(), amount: "5000000", description: "هزینهٔ دستی", cost_center_id: cc, cost_type_id: hw })).row;
    expect(e.period_id).toBeTruthy();
    expect(e.capex_opex).toBe("capex");
    expect(e.source).toBe("manual");
    await w.p.fin.client.patch(`${w.P}/r/cost_entry/${e.id}`, { amount: "1" }, 409);
    await w.p.fin.client.del(`${w.P}/r/cost_entry/${e.id}`, 403);
    const rev = await w.p.fin.client.post(`${w.P}/financial/entries/${e.id}/reverse`, { reason: "ثبت تکراری" });
    const back = (await w.p.fin.client.get(`${w.P}/r/cost_entry/${rev.id}`)).row;
    expect(back.amount).toBe("-5000000");
    expect(back.reversal_of).toBe(e.id);
    expect((await w.p.fin.client.get(`${w.P}/r/cost_entry/${e.id}`)).row.reversed).toBe(true);
    await w.p.fin.client.post(`${w.P}/financial/entries/${e.id}/reverse`, { reason: "دوباره" }, 409);
  });

  it("refuses entries in a closed period", async () => {
    const p = await w.p.fin.client.post(`${w.P}/r/fiscal_period/query`, { filter: { f: "key", op: "eq", v: `${jy + 1}-06` } });
    await w.p.fin.client.patch(`${w.P}/r/fiscal_period/${p.rows[0].id}`, { status: "closed" });
    const r = await w.p.fin.client.post(`${w.P}/r/cost_entry`, { entry_date: p.rows[0].start_date, amount: "1", description: "x", cost_center_id: cc, cost_type_id: hw }, 409);
    expect(r.error.message).toContain("بسته");
  });
});

describe("cost capture", () => {
  it("posts asset purchases, depreciation, contracts and subscriptions once", async () => {
    await w.asset({ serial_number: "FIN-1", purchase_cost: "600000000", purchase_date: today(), cost_center_id: cc });
    const period = periodKeyOf(today());
    const first = await capture(w.sys, period);
    expect(first.by_source.asset_purchase).toBeGreaterThanOrEqual(1);
    expect(first.by_source.contract).toBeGreaterThanOrEqual(1);
    expect(first.by_source.saas).toBeGreaterThanOrEqual(1);
    const again = await capture(w.sys, period);
    expect(again.created).toBe(0);
    const purchase = await w.p.fin.client.post(`${w.P}/r/cost_entry/query`, { filter: { f: "source", op: "eq", v: "asset_purchase" } });
    expect(purchase.rows.find((e: any) => e.amount === "600000000")?.capex_opex).toBe("capex");
  });
});

describe("budget against actual", () => {
  it("compares by cost centre, type and month, and narrates without a model", async () => {
    const b = await w.p.fin.client.get(`${w.P}/financial/bva?year=${jy}`);
    expect(b.budgets).toBe(3);
    const row = b.rows.find((r: any) => r.cost_center_id === cc);
    expect(Number(row.budget)).toBeGreaterThan(0);
    expect(Number(row.actual)).toBeGreaterThan(0);
    expect(row.by_month).toHaveLength(12);
    expect(row.by_type.some((t: any) => t.name === "خرید سخت‌افزار")).toBe(true);
    const n = await w.p.fin.client.post(`${w.P}/financial/bva/narrative`, { year: jy });
    expect(n.ai).toBe(false);
    expect(n.text).toContain("فناوری اطلاعات — زیرساخت");
    const spend = await w.p.fin.client.get(`${w.P}/financial/spend?year=${jy}`);
    expect(Number(spend.capex)).toBeGreaterThan(0);
    expect(spend.by_source.some((s: any) => s.source === "asset_purchase")).toBe(true);
  });

  it("alerts the budget's owner once the threshold is reached", async () => {
    const budget = (await w.p.fin.client.post(`${w.P}/r/budget/query`, { filter: { f: "cost_center_id", op: "eq", v: cc } })).rows[0];
    await w.p.fin.client.patch(`${w.P}/r/budget/${budget.id}`, { alert_percent: 1 });
    expect(await budgetAlerts(w.sys)).toBeGreaterThanOrEqual(1);
    expect(await budgetAlerts(w.sys)).toBe(0);
  });

  it("approves a submitted budget through the approvals service", async () => {
    const y = (await w.p.fin.client.post(`${w.P}/r/fiscal_year/query`, { filter: { f: "year", op: "eq", v: jy + 1 } })).rows[0];
    const b = (await w.p.fin.client.post(`${w.P}/r/budget`, { name: "بودجهٔ سال بعد", fiscal_year_id: y.id, cost_center_id: cc })).row;
    await w.p.fin.client.post(`${w.P}/r/budget_line`, { budget_id: b.id, cost_type_id: hw, amount: "1000000000" });
    expect((await w.p.fin.client.get(`${w.P}/r/budget/${b.id}`)).row.total).toBe("1000000000");
    await w.p.fin.client.post(`${w.P}/r/budget/${b.id}/transition`, { to: "submitted" });
    const committee = await w.idOf("group", "name", "کمیتهٔ مالی فناوری اطلاعات");
    await w.o.post(`${w.P}/access/groups/${committee}/members`, { user_ids: [w.p.auditor.userId] });
    // members added after the round opened are not asked: run the rules again for them
    await w.p.fin.client.post(`${w.P}/r/budget/${b.id}/transition`, { to: "draft" });
    await w.p.fin.client.post(`${w.P}/r/budget/${b.id}/transition`, { to: "submitted" });
    const mine = await w.p.auditor.client.get(`${w.P}/approvals/mine`);
    const a = mine.approvals.find((x: any) => x.record_id === b.id);
    expect(a).toBeTruthy();
    await w.p.auditor.client.post(`${w.P}/approvals/${a.id}/decide`, { decision: "approved" });
    expect((await w.p.fin.client.get(`${w.P}/r/budget/${b.id}`)).row.state).toBe("approved");
    await w.p.fin.client.post(`${w.P}/r/budget_line`, { budget_id: b.id, cost_type_id: hw, amount: "1" }, 409);
  });
});

describe("allocation", () => {
  it("allocates exactly to services and their consumers, posts chargeback and states it", async () => {
    const svcA = (await w.o.post(`${w.P}/r/service`, { name: "خدمت ایمیل", service_type: "business", consumer_units: [await w.idOf("org_unit", "code", "CC-HR"), await w.idOf("org_unit", "code", "CC-FIN")] })).row;
    const svcB = (await w.o.post(`${w.P}/r/service`, { name: "خدمت حسابداری", service_type: "business", consumer_units: [await w.idOf("org_unit", "code", "CC-FIN")] })).row;
    const rule = (await w.p.fin.client.post(`${w.P}/r/allocation_rule`, { name: "زیرساخت ۷۰/۳۰", source_cost_center_id: cc, method: "percent", sort_order: 1 })).row;
    await w.p.fin.client.post(`${w.P}/r/allocation_target`, { rule_id: rule.id, service_id: svcA.id, percent: "70" });
    await w.p.fin.client.post(`${w.P}/r/allocation_target`, { rule_id: rule.id, service_id: svcB.id, percent: "30" });
    const seeded = await w.idOf("allocation_rule", "name", "تسهیم هزینه‌های زیرساخت به خدمت‌ها");
    await w.p.fin.client.patch(`${w.P}/r/allocation_rule/${seeded}`, { active: false });
    const y = (await w.p.fin.client.post(`${w.P}/r/fiscal_year/query`, { filter: { f: "year", op: "eq", v: jy } })).rows[0];
    const ps = await w.p.fin.client.post(`${w.P}/r/fiscal_period/query`, { filter: { f: "fiscal_year_id", op: "eq", v: y.id }, sort: "key", size: 12 });
    const run = (await w.p.fin.client.post(`${w.P}/r/allocation_run`, { name: "تسهیم سال", mode: "chargeback", fiscal_year_id: y.id, period_from_id: ps.rows[0].id, period_to_id: ps.rows[11].id })).row;
    const calc = await w.p.fin.client.post(`${w.P}/financial/allocation-runs/${run.id}/calculate`);
    expect(Number(calc.total_pool)).toBeGreaterThan(0);
    expect(calc.total_allocated).toBe(calc.total_pool);
    const st = await w.p.fin.client.get(`${w.P}/financial/allocation-runs/${run.id}/statement`);
    expect(st.total).toBe(calc.total_pool);
    expect(st.services).toHaveLength(2);
    expect(st.units.length).toBe(2);
    const a = st.services.find((s: any) => s.service_id === svcA.id);
    expect(Number(a.total)).toBeCloseTo(Number(calc.total_pool) * 0.7, -1);
    await w.p.fin.client.post(`${w.P}/financial/allocation-runs/${run.id}/post`, {}, 409);
    await w.p.fin.client.post(`${w.P}/r/allocation_run/${run.id}/transition`, { to: "approved" });
    const posted = await w.p.fin.client.post(`${w.P}/financial/allocation-runs/${run.id}/post`);
    expect(posted.entries).toBe(st.units.reduce((n: number, u: any) => n + u.lines.length, 0) + 1);
    const alloc = await w.p.fin.client.post(`${w.P}/r/cost_entry/query`, { filter: { f: "source", op: "eq", v: "allocation" }, size: 100 });
    expect(alloc.rows.reduce((s: number, e: any) => s + Number(e.amount), 0)).toBe(0);
    expect((await w.p.fin.client.get(`${w.P}/r/allocation_run/${run.id}`)).row.state).toBe("posted");
    const cost = await w.p.fin.client.get(`${w.P}/financial/services/${svcA.id}/cost?year=${jy}`);
    expect(cost.allocated).toBe(a.total);
  });
});

describe("access", () => {
  it("keeps money to the financial area and field group", async () => {
    await w.p.agent.client.post(`${w.P}/r/cost_entry/query`, {}, 403);
    await w.p.agent.client.get(`${w.P}/financial/bva?year=${jy}`, 403);
    await w.p.req.client.get(`${w.P}/financial/spend`, 403);
    await w.p.am.client.post(`${w.P}/r/cost_entry`, { entry_date: today(), amount: "1", description: "x", cost_center_id: cc, cost_type_id: hw }, 403);
    const am = await w.p.am.client.get(`${w.P}/financial/bva?year=${jy}`);
    expect(am.rows.length).toBeGreaterThan(0);
    await w.p.am.client.post(`${w.P}/financial/capture`, {}, 403);
    await w.p.auditor.client.post(`${w.P}/r/allocation_result`, { run_id: "00000000-0000-0000-0000-000000000000" }, 403);
  });
});
