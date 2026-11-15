// The demo pack never takes over the organisation's own work (docs/DEMO_FA.md): the steps of the rest of the bank
// (src/server/modules/demo/modules.ts) run inside the demo scope next to the organisation's real configuration, and
// what they set going — maintenance generation, approvals, experience scoring, allocation runs, control monitoring —
// may touch the pack's records only. Each step runs here as the load runs it (inside the demo scope, the job's way),
// with the small part of the memo it needs; the organisation's own records are written outside the scope.
// (The full pack's no-trace proof is tests/demo-purge.test.ts; it cannot hold real work of this kind: the organisation's
// own maintenance or budgets would rightly change the database between its snapshots.)
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, savepoint, updateIn, systemCtx } from "@server/engine";
import { periodKeyOf } from "@shared/financial/logic";
import { inDemoScope } from "@server/db/scope";
import { tick } from "@server/jobs";
import { hashPassword } from "@server/auth/password";
import { uuidv7 } from "@shared/id";
import { REGIONS } from "@server/modules/demo/bank";
import { answersFor, loadRefusals, newMemo, type LoadMemo, type StepArgs } from "@server/modules/demo/load";
import { stepContinuityGrc, stepExperience, stepField, stepFinance } from "@server/modules/demo/modules";
import { generateMaintenanceIn } from "@server/modules/field_service/service";
import { policyOf, scoreRecordIn } from "@server/modules/slm/xla";
import { measureIndicators } from "@server/modules/security/grc";
import type { Tx } from "@server/db";
import type { Ctx } from "@server/context";

/** Run due jobs (the modules' seeds first) until none is left. */
async function drain(e: EngineOrg, budgetMs = 240_000) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await e.db.query(`update sm_jobs set run_at = now() where status = 'queued' and run_at > now() and (kind like '%seed%' or kind like '%install%')`);
    const r = await tick(e.cfg, { budgetMs: 10_000 });
    if (!r.ran && !r.more) break;
  }
}

/** One of the pack's people (as the loader adds them): recorded, marked, a member with ordinary roles. */
async function persona(e: EngineOrg, local: string, roles: string[]): Promise<string> {
  const id = uuidv7();
  await e.db.query(`insert into sm_users (id, email, full_name, password_hash, prefs) values ($1, $2, $3, $4, $5::jsonb)`, [id, `${local}.${e.org.slice(0, 6)}@aftab-bank.example`, `نمایشی ${local}`, await hashPassword("demo-persona-pass-1405"), JSON.stringify({ demo_org: e.org })]);
  await e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users')`, [e.org, id]);
  await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, title, origin) values ($1, $2, $3, 'member', 'نمایشی', 'cloud')`, [uuidv7(), e.org, id]);
  await e.owner.put(`/o/${e.org}/access/members/${id}`, { roles, persona: "agent" });
  return id;
}

describe("the demo pack never takes over the organisation's own work", () => {
  let e: EngineOrg;
  let sys: Ctx;
  const args = (memo: LoadMemo): StepArgs => ({ cfg: e.cfg, orgId: e.org, memo, deadline: Date.now() + 300_000 });
  const demo = <T,>(fn: () => Promise<T>) => inDemoScope(e.org, fn);
  const demoWrite = <T,>(fn: (tx: Tx) => Promise<T>) => inDemoScope(e.org, () => sys.write(fn));
  const isDemo = async (id: string) => !!(await e.db.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2`, [e.org, id]));
  const count = async (sql: string, params: unknown[] = []) => (await e.db.one<{ n: number }>(sql, [e.org, ...params]))!.n;

  beforeAll(async () => {
    e = await engineOrg();
    await drain(e, 300_000);
    sys = await systemCtx(e.cfg, e.org);
  }, 600_000);

  it("the field step generates its own maintenance plans only, never another active plan that is due", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // the organisation's own plan, due now (made in the last hours: the module's six-hourly sweep has not generated it)
    const real = String((await sys.write((tx) => createIn(tx, sys, "maintenance_plan", { name: "سرویس ماهانهٔ ژنراتور ساختمان مرکزی", status: "active", generates: "work_order", every_n: 1, interval_unit: "month", lead_days: 7, horizon: 1, next_due: today, priority: "4" }, { trusted: true }))).id);
    // the pack's pieces the step's «plans» phase needs: the quarterly visit template and a branch of the first region
    const memo = newMemo("small");
    await demoWrite(async (tx) => {
      const loc = await createIn(tx, sys, "location", { name: "شعبهٔ آزمون بانک نمونه" }, { trusted: true });
      const tpl = await createIn(tx, sys, "wo_task_template", { name: "سرویس دوره‌ای فصلی خودپرداز", work_type: "maintenance", est_work_minutes: 90 }, { trusted: true });
      memo.units["wo_tpl:pm"] = String(tpl.id);
      memo.branches.push({ unit: "", location: String(loc.id), region: REGIONS[0], city: "تهران", name: "شعبهٔ آزمون" });
    });
    memo.cursor = 2;
    expect(await demo(() => stepField(args(memo), sys))).toBe(true);
    expect(loadRefusals(e.org)).toEqual({});
    const own = await e.db.query<{ id: string; last_generated_due: string | null }>(`select id::text, last_generated_due::text from sm_maintenance_plans where org_id = $1 and id <> $2`, [e.org, real]);
    expect(own.length).toBe(1);
    // the pack's plan: its first occurrence generated by the module inside the demo scope (demo work)
    expect(own[0].last_generated_due).toBeTruthy();
    const orders = await e.db.query<{ id: string }>(`select id::text from sm_work_orders where org_id = $1 and maintenance_plan_id = $2`, [e.org, own[0].id]);
    expect(orders.length).toBe(1);
    expect(await isDemo(orders[0].id)).toBe(true);
    expect(memo.counts.work_order).toBe(1);
    // the organisation's plan: untouched and nothing generated from it inside the demo scope
    const plan = await e.db.one<{ last_generated_due: string | null; next_due: string }>(`select last_generated_due::text, next_due::text from sm_maintenance_plans where id = $1`, [real]);
    expect(plan).toEqual({ last_generated_due: null, next_due: today });
    expect(await count(`select count(*)::int as n from sm_work_orders where org_id = $1 and maintenance_plan_id = $2`, [real])).toBe(0);
    expect(await count(`select count(*)::int as n from sm_demo_rows d where d.org_id = $1 and d.row_id = $2`, [real])).toBe(0);
    // … its own schedule generates it, outside the demo scope: the organisation's work
    await sys.write((tx) => generateMaintenanceIn(tx, sys));
    const generated = await e.db.query<{ id: string }>(`select id::text from sm_work_orders where org_id = $1 and maintenance_plan_id = $2`, [e.org, real]);
    expect(generated.length).toBe(1);
    expect(await isDemo(generated[0].id)).toBe(false);
  }, 300_000);

  it("the pack's people approve no real record, whatever names them; the pack's own records keep them", async () => {
    const finance = await persona(e, "finance", ["it_finance"]);
    const release = await persona(e, "release", ["release_manager"]);
    const pack = new Set([finance, release]);
    // a person of the pack in the organisation's own finance committee — the only approver source of the seeded rule
    // «تأیید بودجه» (as the pack's finance persona once was): written by demo work, as the load writes
    const committee = (await e.db.one<{ id: string }>(`select id::text from sm_groups where org_id = $1 and name = 'کمیتهٔ مالی فناوری اطلاعات' and deleted_at is null`, [e.org]))!.id;
    await demoWrite((tx) => createIn(tx, sys, "group_member", { group_id: committee, user_id: finance, kind: "member" }, { trusted: true }));
    const year = (await e.db.one<{ id: string }>(`select id::text from sm_fiscal_years where org_id = $1 and deleted_at is null order by year limit 1`, [e.org]))!.id;
    const cc = (await e.db.one<{ id: string }>(`select id::text from sm_org_units where org_id = $1 and code = 'CC-IT-INF' and deleted_at is null`, [e.org]))!.id;
    const approvals = (table: string, id: string) => e.db.query<{ approver_id: string | null; state: string }>(`select approver_id::text, state from sm_approvals where org_id = $1 and table_key = $2 and record_id = $3`, [e.org, table, id]);
    const submit = async (tx: Tx, name: string) => {
      const b = await createIn(tx, sys, "budget", { name, fiscal_year_id: year, cost_center_id: cc, state: "draft" }, { trusted: true });
      await updateIn(tx, sys, "budget", String(b.id), { state: "submitted" }, { trusted: true });
      return String(b.id);
    };
    // a real budget submitted while the pack is loaded: its round is planned, and nobody of the pack is in it
    const budget = await sys.write((tx) => submit(tx, "بودجهٔ واقعی زیرساخت (آزمون)"));
    const onBudget = await approvals("budget", budget);
    expect(onBudget.length).toBeGreaterThan(0);
    expect(onBudget.filter((a) => a.approver_id && pack.has(a.approver_id))).toEqual([]);
    // a real major release entering readiness: the release managers' source falls back to every holder of the role while
    // the release managers' group is empty — the pack's release manager is not asked
    const rel = String((await sys.write((tx) => createIn(tx, sys, "release", { short_description: "انتشار واقعی سامانهٔ حقوق (آزمون)", type: "major", state: "readiness" }, { trusted: true }))).id);
    const onRelease = await approvals("release", rel);
    expect(onRelease.length).toBeGreaterThan(0);
    expect(onRelease.filter((a) => a.approver_id && pack.has(a.approver_id))).toEqual([]);
    // the pack's own budget, submitted by demo work: the pack's people approve the pack's records
    const own = await demoWrite((tx) => submit(tx, "بودجهٔ نمایشی زیرساخت (آزمون)"));
    expect((await approvals("budget", own)).map((a) => a.approver_id)).toContain(finance);
  }, 300_000);

  it("the pack's experience policies score its own records only; a real request item keeps the organisation's policy", async () => {
    const requester = await persona(e, "requester", ["requester"]);
    const memo = newMemo("small");
    const desk = await demoWrite((tx) => createIn(tx, sys, "group", { name: "میز خدمت بانک نمونه (آزمون)", types: ["assignment"], active: true }, { trusted: true }));
    memo.groups.desk = String(desk.id);
    // (no ATM service in this memo: the pack's ATM incident policy is left out — never a policy without a condition)
    expect(await demo(() => stepExperience(args(memo), sys))).toBe(true);
    const policies = await e.db.query<{ id: string; table_key: string; condition: unknown }>(
      `select p.id::text, p.table_key, p.condition from sm_slm_xla_policies p where p.org_id = $1 and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = p.id)`, [e.org]);
    expect(policies.map((p) => p.table_key)).toEqual(["request_item"]);
    expect(policies[0].condition).toBeTruthy();
    const seeded = (await e.db.one<{ id: string }>(`select id::text from sm_slm_xla_policies where org_id = $1 and table_key = 'request_item' and name = 'تجربهٔ درخواست‌های خدمت'`, [e.org]))!.id;
    // items of the seeded catalogue the pack's requests use (the first one the loader's answers satisfy)
    const items = (await e.db.query<{ id: string }>(`select id::text from sm_catalog_items where org_id = $1 and state = 'published' and deleted_at is null and name in ('صندوق پست الکترونیک', 'لپ‌تاپ جدید', 'نصب نرم‌افزار') order by name`, [e.org])).map((r) => r.id);
    const order = async (tx: Tx, text: string, who: string, group?: string) => {
      const req = await createIn(tx, sys, "request", { short_description: text, caller_id: who, requested_for: who }, { trusted: true });
      for (const item of items) {
        const answers = await answersFor(tx, e.org, item, who);
        const ritm = await savepoint(tx, () => createIn(tx, sys, "request_item", { short_description: text, request_id: req.id, cat_item_id: item, quantity: 1, answers, caller_id: who, requested_for: who, assignment_group_id: group }, { trusted: true })).catch(() => null);
        if (ritm) return String(ritm.id);
      }
      throw new Error("no catalogue item of the pack's requests could be ordered");
    };
    // the organisation's own request item (outside the demo scope) and one of the pack (its desk group)
    const real = await sys.write((tx) => order(tx, "درخواست واقعی کارمند ستاد", e.ownerId));
    const own = await demoWrite((tx) => order(tx, "درخواست نمایشی کارمند شعبه", requester, memo.groups.desk));
    expect((await policyOf(sys.db, sys, "request_item", real))?.id).toBe(seeded);
    expect((await policyOf(sys.db, sys, "request_item", own))?.id).toBe(policies[0].id);
    // the SLM module's own scoring of the real item (its job, outside the demo scope): the organisation's policy
    const scored = await sys.write((tx) => scoreRecordIn(tx, sys, "request_item", real));
    expect(scored?.policy_id).toBe(seeded);
  }, 300_000);

  it("the finance step makes no allocation run while a rule of the organisation's own has real costs to share", async () => {
    const finance = await persona(e, "finance2", ["it_finance"]);
    const cc = (await e.db.one<{ id: string }>(`select id::text from sm_org_units where org_id = $1 and code = 'CC-IT-INF' and deleted_at is null`, [e.org]))!.id;
    const hw = (await e.db.one<{ id: string }>(`select id::text from sm_cost_types where org_id = $1 and code = 'HW' and deleted_at is null`, [e.org]))!.id;
    // the first month of this fiscal year (the seed opens next year's calendar too): inside the runs' months
    const jy = Number(periodKeyOf(new Date().toISOString().slice(0, 10)).slice(0, 4));
    const first = (await e.db.one<{ start_date: string }>(`select p.start_date::text from sm_fiscal_periods p join sm_fiscal_years y on y.id = p.fiscal_year_id where p.org_id = $1 and p.month = 1 and y.year = $2 and p.deleted_at is null`, [e.org, jy]))!.start_date;
    const entry = (tx: Tx, description: string) => createIn(tx, sys, "cost_entry", { entry_date: first, amount: "1500000000", description, cost_center_id: cc, cost_type_id: hw, source: "manual" }, { trusted: true });
    const runs = () => count(`select count(*)::int as n from sm_allocation_runs where org_id = $1 and deleted_at is null`);
    const runStep = async () => {
      const memo = newMemo("small");
      memo.people.personas.finance = finance;
      memo.cursor = 3;
      expect(await demo(() => stepFinance(args(memo), sys))).toBe(true);
    };
    // a cost of the pack on the organisation's default centre (a demo asset without a cost centre posts there): the pack's
    // own, and the runs are made
    await demoWrite((tx) => entry(tx, "خرید نمایشی تجهیزات"));
    await runStep();
    const made = await runs();
    expect(made).toBeGreaterThan(0);
    expect(loadRefusals(e.org)["finance.runs"]).toBeUndefined();
    // a real cost of the organisation on the centre its own rule shares: no run of the pack would leave it out
    await sys.write((tx) => entry(tx, "خرید واقعی سرور"));
    await runStep();
    expect(await runs()).toBe(made);
    expect(loadRefusals(e.org)["finance.runs"]).toMatch(/واقعی/);
  }, 300_000);

  it("the pack's risks are reviewed ones: the organisation's control monitoring raises no issue about them", async () => {
    const grc = await persona(e, "grc", ["grc_manager"]);
    const memo = newMemo("small");
    memo.people.personas.grc = grc;
    memo.cursor = 3;
    expect(await demo(() => stepContinuityGrc(args(memo), sys))).toBe(true);
    expect(memo.counts.grc_risk).toBe(5);
    // the hourly monitoring, outside the demo scope: «بازنگری دوره‌ای ریسک‌ها» measures the register's open risks
    await measureIndicators(sys);
    const control = (await e.db.one<{ id: string; indicator_status: string | null }>(`select id::text, indicator_status from sm_grc_controls where org_id = $1 and code = 'SEC-RM-01' and deleted_at is null`, [e.org]))!;
    expect(control.indicator_status).toBe("pass");
    expect(await count(`select count(*)::int as n from sm_grc_issues where org_id = $1 and control_id = $2`, [control.id])).toBe(0);
  }, 300_000);
});
