// Supplier and contract management end to end: seeds, notice dates, the renewal calendar, reminders once per
// threshold, expiry and automatic renewal, renewals that copy lines and coverage and supersede the old contract,
// approvals activating a contract, recurring obligations, clause extraction from an attachment (rule-based without a
// model), the supplier 360 and scorecards, and access (agents read suppliers but not contracts).
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { upload } from "./engine-helpers";
import { computeScorecards, supplierSweep } from "@server/modules/supplier";
import { transitionIn } from "@server/engine";
import { addDays, todayISO } from "@shared/jalali";
import { noticeDate } from "@shared/supplier/logic";

let w: ItamWorld;
const today = () => todayISO("Asia/Tehran");
const events = async (kind: string) => (await w.e.db.query<{ payload: any }>(`select payload from sm_jobs where org_id = $1 and kind = $2`, [w.e.org, kind])).map((r) => r.payload);
/** A contract made active as its approval would (with the seeded approval rule in force, a writer cannot). */
const activate = (id: string) => w.sys.write((tx) => transitionIn(tx, w.sys, "contract", id, "active", {}));

beforeAll(async () => {
  w = await itamWorld();
}, 120_000);

describe("contracts", () => {
  it("keeps the notice date and lists renewals in the calendar", async () => {
    const uc = await w.idOf("contract", "name", "پشتیبانی و نگهداری سرورها و شبکه (نمونه)");
    const c = (await w.o.get(`${w.P}/r/contract/${uc}`)).row;
    expect(c.notice_date).toBe(noticeDate(c.end_date, 30));
    const cal = await w.p.am.client.get(`${w.P}/supplier/renewals?months=12`);
    const all = cal.months.flatMap((m: any) => m.entries);
    expect(all.some((e: any) => e.id === uc && e.kind === "notice")).toBe(true);
    expect(all.some((e: any) => e.table === "saas_subscription")).toBe(true);
    expect(all.some((e: any) => e.table === "license_entitlement")).toBe(true);
    expect(cal.counts.end_90).toBeGreaterThanOrEqual(1);
    expect(cal.counts.value_90).not.toBeNull();
    const agentCal = await w.p.agent.client.get(`${w.P}/supplier/renewals`);
    expect(agentCal.months.flatMap((m: any) => m.entries).some((e: any) => e.table === "contract")).toBe(false);
  });

  it("reminds once per threshold, expires and renews automatically", async () => {
    const sup = await w.idOf("supplier", "name", "ابر میزبان ایرانی (نمونه)");
    const soon = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "یادآوری آزمون", supplier_id: sup, contract_type: "support", start_date: addDays(today(), -300), end_date: addDays(today(), 40), notice_period_days: 10, reminder_days: [60, 30, 7] })).row;
    await activate(soon.id);
    const ended = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "پایان آزمون", supplier_id: sup, contract_type: "support", start_date: addDays(today(), -400), end_date: addDays(today(), -1), renewal_type: "manual" })).row;
    await activate(ended.id);
    const auto = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "تمدید خودکار آزمون", supplier_id: sup, contract_type: "cloud", start_date: addDays(today(), -400), end_date: addDays(today(), -2), renewal_type: "auto", renewal_term_months: 12 })).row;
    await activate(auto.id);
    const r = await supplierSweep(w.sys);
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(r.renewed).toBeGreaterThanOrEqual(1);
    const due = (await events("record.contract.renewal_due")).filter((e) => e.id === soon.id);
    expect(due).toHaveLength(1);
    expect(due[0].data.days_left).toBe(30);
    await supplierSweep(w.sys);
    expect((await events("record.contract.renewal_due")).filter((e) => e.id === soon.id)).toHaveLength(1);
    expect((await w.o.get(`${w.P}/r/contract/${ended.id}`)).row.state).toBe("expired");
    const renewed = (await w.o.get(`${w.P}/r/contract/${auto.id}`)).row;
    expect(renewed.state).toBe("active");
    expect(renewed.end_date > today()).toBe(true);
  });

  it("renews into a draft copy that supersedes the old contract when it starts", async () => {
    const uc = await w.idOf("contract", "name", "پشتیبانی و نگهداری سرورها و شبکه (نمونه)");
    const asset = await w.asset({ serial_number: "CNT-COV" });
    await w.p.am.client.post(`${w.P}/r/contract_coverage`, { contract_id: uc, target_kind: "asset", asset_id: asset.id, coverage_level: "h24" });
    await w.p.am.client.post(`${w.P}/r/contract_coverage`, { contract_id: uc, target_kind: "asset" }, 400);
    const r = await w.p.am.client.post(`${w.P}/supplier/contracts/${uc}/renew`, {});
    const draft = (await w.o.get(`${w.P}/r/contract/${r.id}`)).row;
    expect(draft.state).toBe("draft");
    expect(draft.previous_contract_id).toBe(uc);
    const lines = await w.o.post(`${w.P}/r/contract_line/query`, { filter: { f: "contract_id", op: "eq", v: r.id } });
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows[0].amount).toBeTruthy();
    const cov = await w.o.post(`${w.P}/r/contract_coverage/query`, { filter: { f: "contract_id", op: "eq", v: r.id } });
    expect(cov.rows[0].asset_id).toBe(asset.id);
    await w.p.am.client.post(`${w.P}/supplier/contracts/${uc}/renew`, {}, 409);
    await activate(r.id);
    const old = (await w.o.get(`${w.P}/r/contract/${uc}`)).row;
    expect(old.state).toBe("renewed");
    expect(old.renewed_by_id).toBe(r.id);
    // the asset 360 lists the coverage
    const v = await w.p.am.client.get(`${w.P}/itam/assets/${asset.id}/360`);
    expect(v.contracts.map((c: any) => c.id)).toContain(uc);
  });

  it("is activated by its approval", async () => {
    await w.o.put(`${w.P}/access/members/${w.p.am.userId}`, { manager_id: w.p.fin.userId });
    const sup = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
    const c = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "قرارداد با تأیید", supplier_id: sup, contract_type: "support", start_date: today(), end_date: addDays(today(), 365) })).row;
    const sent = await w.p.am.client.post(`${w.P}/r/contract/${c.id}/transition`, { to: "pending_approval" });
    expect(sent.row.approval).toBe("requested");
    await w.p.am.client.post(`${w.P}/r/contract/${c.id}/transition`, { to: "active" }, 409);
    const mine = await w.p.fin.client.get(`${w.P}/approvals/mine`);
    const a = mine.approvals.find((x: any) => x.record_id === c.id);
    expect(a).toBeTruthy();
    await w.p.fin.client.post(`${w.P}/approvals/${a.id}/decide`, { decision: "approved" });
    expect((await w.o.get(`${w.P}/r/contract/${c.id}`)).row.state).toBe("active");
  });

  it("creates the next occurrence of a recurring obligation", async () => {
    const uc = await w.idOf("contract", "name", "اجارهٔ چاپگرهای چندکاره (نمونه)");
    const o = (await w.p.am.client.post(`${w.P}/r/contract_obligation`, { contract_id: uc, title: "بازدید ماهانه", party: "supplier", due_date: today(), recurrence: "monthly" })).row;
    await w.p.am.client.post(`${w.P}/r/contract_obligation/${o.id}/transition`, { to: "fulfilled" });
    const next = await w.o.post(`${w.P}/r/contract_obligation/query`, { filter: { and: [{ f: "contract_id", op: "eq", v: uc }, { f: "title", op: "eq", v: "بازدید ماهانه" }, { f: "state", op: "eq", v: "open" }] } });
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0].due_date > today()).toBe(true);
  });

  it("lets tickets name the supplier, ticket and contract they wait on", async () => {
    const sup = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
    const uc = await w.idOf("contract", "name", "پشتیبانی و نگهداری سرورها و شبکه (نمونه)");
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "خرابی سوئیچ هسته", u_supplier_id: sup, u_supplier_ticket: "PRS-4411", u_contract_id: uc })).row;
    expect(inc.u_supplier_id).toBe(sup);
    const found = await w.o.post(`${w.P}/r/incident/query`, { filter: { f: "u_supplier_id", op: "eq", v: sup } });
    expect(found.rows.map((r: { id: string }) => r.id)).toContain(inc.id);
  });

  it("runs the supplier's clock while an incident waits on a named supplier", async () => {
    const sup = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "دیسک سرور پایگاه داده خراب است", u_supplier_id: sup })).row;
    await w.o.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_supplier" } });
    const timers = (await w.o.get(`${w.P}/r/incident/${inc.id}`)).meta.sla as { label: string; state: string }[];
    expect(timers.some((t) => t.label === "رفع خرابی توسط تأمین‌کننده (UC)")).toBe(true);
    const uc = await w.idOf("contract", "name", "پشتیبانی و نگهداری سرورها و شبکه (نمونه)");
    expect((await w.o.get(`${w.P}/r/contract/${uc}`)).row.sla_definitions).toHaveLength(1);
  });

  it("values a foreign-currency contract with the latest official rate", async () => {
    const sup = await w.idOf("supplier", "name", "ابر میزبان ایرانی (نمونه)");
    const c = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "اشتراک ارزی آزمون", supplier_id: sup, contract_type: "subscription", currency: "USD", foreign_value: "1000", start_date: today(), end_date: addDays(today(), 365) })).row;
    const row = (await w.p.am.client.get(`${w.P}/r/contract/${c.id}`)).row;
    expect(Number(row.fx_rate)).toBe(700000);
    expect(Number(row.value)).toBe(700_000_000);
  });

  it("reminds before a guarantee's validity ends, then marks it expired and releases it", async () => {
    const lease = await w.idOf("contract", "name", "اجارهٔ چاپگرهای چندکاره (نمونه)");
    const g = (await w.p.am.client.post(`${w.P}/r/contract_guarantee`, { contract_id: lease, kind: "performance", form: "bank_guarantee", issuer: "بانک ملت", reference_no: "BG-77", amount: "500000000", issue_date: addDays(today(), -300), expiry_date: addDays(today(), 25) })).row;
    const mine = async () => (await events("record.contract.guarantee_due")).filter((e) => e.id === g.id);
    await supplierSweep(w.sys);
    await supplierSweep(w.sys);
    expect(await mine()).toHaveLength(1);
    expect((await mine())[0].data.days_left).toBe(25);
    await w.p.am.client.patch(`${w.P}/r/contract_guarantee/${g.id}`, { expiry_date: addDays(today(), -1) });
    await supplierSweep(w.sys);
    expect((await w.o.get(`${w.P}/r/contract_guarantee/${g.id}`)).row.state).toBe("expired");
    await w.p.am.client.post(`${w.P}/r/contract_guarantee/${g.id}/transition`, { to: "released" });
    expect((await w.o.get(`${w.P}/r/contract_guarantee/${g.id}`)).row.released_at).toBeTruthy();
    await w.p.req.client.get(`${w.P}/r/contract_guarantee/${g.id}`, 404);
    await w.p.agent.client.post(`${w.P}/r/contract_guarantee`, { contract_id: lease, reference_no: "X" }, 403);
  });

  it("reminds an obligation once when it comes due and once when it is overdue", async () => {
    const uc = await w.idOf("contract", "name", "اجارهٔ چاپگرهای چندکاره (نمونه)");
    const o = (await w.p.am.client.post(`${w.P}/r/contract_obligation`, { contract_id: uc, title: "ارسال بیمه‌نامه", party: "supplier", due_date: addDays(today(), 3) })).row;
    const mine = async () => (await events("record.contract.obligation_due")).filter((e) => e.id === o.id);
    await supplierSweep(w.sys);
    await supplierSweep(w.sys);
    expect(await mine()).toHaveLength(1);
    expect((await mine())[0].data.overdue).toBe(false);
    await w.p.am.client.patch(`${w.P}/r/contract_obligation/${o.id}`, { due_date: addDays(today(), -1) });
    await supplierSweep(w.sys);
    await supplierSweep(w.sys);
    const all = await mine();
    expect(all).toHaveLength(2);
    expect(all.some((e) => e.data.overdue === true)).toBe(true);
  });
});

describe("clause extraction", () => {
  it("suggests terms and obligations from an attached contract without a model", async () => {
    const sup = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
    const c = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "قرارداد استخراج", supplier_id: sup, contract_type: "support" })).row;
    const none = await w.p.am.client.post(`${w.P}/supplier/contracts/${c.id}/extract`);
    expect(none.source.kind).toBe("none");
    const text = "این قرارداد از تاریخ 1405/02/01 به مدت 12 ماه معتبر است.\nمبلغ کل قرارداد 960,000,000 ریال است و پرداخت به صورت فصلی انجام می‌شود.\nاعلام کتبی عدم تمدید باید 45 روز پیش از پایان انجام شود.\nپیمانکار متعهد است گزارش ماهانهٔ عملکرد را ارائه کند.";
    const res = await upload(w.e.app, w.p.am.client, `${w.P}/r/contract/${c.id}/attachments`, "contract.txt", new TextEncoder().encode(text), "text/plain");
    expect(res.status).toBe(200);
    const r = await w.p.am.client.post(`${w.P}/supplier/contracts/${c.id}/extract`);
    expect(r.ai).toBe(false);
    expect(r.source.kind).toBe("attachment");
    const s = (f: string) => r.suggestions.find((x: any) => x.field === f);
    expect(s("value").value).toBe("960000000");
    expect(s("notice_period_days").value).toBe(45);
    expect(s("payment_frequency").value).toBe("quarterly");
    expect(s("start_date").evidence).toContain("1405/02/01");
    expect(r.obligations[0].party).toBe("supplier");
    // the person applies them through the record and adds the obligations
    await w.p.am.client.patch(`${w.P}/r/contract/${c.id}`, { value: s("value").value, notice_period_days: 45, start_date: s("start_date").value, end_date: s("end_date").value });
    const made = await w.p.am.client.post(`${w.P}/supplier/contracts/${c.id}/obligations`, { items: [{ title: r.obligations[0].title.slice(0, 200), party: "supplier", recurrence: "monthly" }] });
    expect(made.created).toHaveLength(1);
    await w.p.agent.client.post(`${w.P}/supplier/contracts/${c.id}/extract`, {}, 404);
  });
});

describe("suppliers", () => {
  it("scores suppliers and shows the 360", async () => {
    const sup = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
    await w.p.am.client.post(`${w.P}/r/supplier_review`, { supplier_id: sup, title: "بازبینی فصل", quality: 4, delivery: 5, communication: 3, value_for_money: 4 });
    const r = await computeScorecards(w.sys);
    expect(r.suppliers).toBeGreaterThan(0);
    const card = await w.o.post(`${w.P}/r/supplier_scorecard/query`, { filter: { f: "supplier_id", op: "eq", v: sup } });
    expect(card.rows[0].review_score).toBe(75);
    expect(card.rows[0].score).toBeGreaterThan(0);
    await w.p.am.client.post(`${w.P}/r/supplier_scorecard`, { supplier_id: sup, period: "1405-01" }, 403);
    const v = await w.p.am.client.get(`${w.P}/supplier/suppliers/${sup}/360`);
    expect(v.contracts.length).toBeGreaterThan(0);
    expect(v.scorecards[0].score).toBe(card.rows[0].score);
    // agents read suppliers (reference data) but not contracts
    const agent = await w.p.agent.client.get(`${w.P}/supplier/suppliers/${sup}/360`);
    expect(agent.contracts).toHaveLength(0);
    expect(agent.spend).toBeNull();
    await w.p.agent.client.post(`${w.P}/r/contract/query`, {}, 403);
    await w.p.agent.client.patch(`${w.P}/r/supplier/${sup}`, { notes: "x" }, 403);
  });
});
