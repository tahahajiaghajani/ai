// The cost ledger keeps to its own side of the demo boundary, whatever the date (docs/DEMO_FA.md): the pack's ledger
// (src/server/modules/demo/load.ts «ledger», inside the demo scope) posts the costs of the pack's items only, the
// organisation's capture (src/server/modules/financial/service.ts `capture`: its daily sweep, outside the scope) those
// of its own items only, and the organisation's allocation runs and budget alerts count its own costs only
// (`ledgerSide`). Main CI on 1 Azar 1405, minutes after midnight in Tehran with UTC still on 30 Aban: the pack's
// ledger went by the UTC date and stopped at Aban — and, an organisation-wide capture run inside the scope, it had
// posted the organisation's own contracts and subscription for every month up to Aban as well. The organisation's
// sweep then posted Azar for every item: the pack's outside the scope (the purge took those only because they sit on
// the pack's cost centres) and its own, real work the purge rightly kept — while on any other day the pack had taken
// those months first, so that after a purge the organisation's items lacked every month its sweep no longer covers.
// The clock is pinned (Date only: the capture goes by the organisation's calendar day) to the first half hour of a
// Jalali month in Tehran, to the middle of a month, and to the next month with the pack still loaded.
import { describe, it, expect, afterEach, vi } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx, transitionIn, updateIn } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { seedItamDefaults } from "@server/modules/itam";
import { seedSupplierDefaults } from "@server/modules/supplier";
import { budgetAlerts, calculateRun, ensureFiscalYear, financialSweep, seedFinancialDefaults } from "@server/modules/financial";
import { purgeStep } from "@server/modules/demo";
import { STEPS, loadRefusals, newMemo } from "@server/modules/demo/load";
import { REGIONS } from "@server/modules/demo/bank";
import { orgToday } from "@server/modules/itam/common";
import { addDays } from "@shared/jalali";
import type { Ctx } from "@server/context";

/** 1 Azar 1405, 00:30 in Tehran: UTC is still on 30 Aban (the hour of the main CI run) */
const MONTH_START = "2026-11-21T21:00:00.000Z";
/** 16 Aban 1405, noon in Tehran */
const MID_MONTH = "2026-11-07T08:30:00.000Z";
/** 3 Azar 1405, noon in Tehran: the organisation's daily sweep with the pack still loaded */
const NEXT_MONTH = "2026-11-24T08:30:00.000Z";

/** Every kind of cost the capture posts */
const SOURCES = ["asset_purchase", "contract", "depreciation", "disposal", "license", "repair", "saas"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Pin the clock (Date only; it moves on from there) */
function pin(iso: string): void {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(iso));
}
afterEach(() => vi.useRealTimers());

interface Items {
  /** every item that carries a cost */
  ids: Set<string>;
  /** in service since three months before the day, on the side's cost centre */
  depreciating: string;
  contract: string;
}

interface World {
  e: EngineOrg;
  sys: Ctx;
  real: Items;
  pack: Items;
  /** the pack's cost centre */
  centre: string;
}

/**
 * One of each kind of cost, dated around `day`: an asset depreciating on `centre`, one bought on the day without a
 * cost centre (the organisation's default one), a contract, a subscription, a yearly licence and one bought on the
 * day, a repair returned on the day and an asset disposed of on the day with book value left.
 */
async function items(e: EngineOrg, sys: Ctx, day: string, tag: string, centre: string): Promise<Items> {
  const id = async (sql: string, params: unknown[] = []) => (await e.db.one<{ id: string }>(sql, [e.org, ...params]))!.id;
  // a model that depreciates and bears no data (disposed of without a wipe certificate)
  const model = await id(`select id::text as id from sm_asset_models where org_id = $1 and name = $2 and deleted_at is null`, ["سامسونگ ۲۴ اینچ S24C360"]);
  const stockroom = await id(`select id::text as id from sm_stockrooms where org_id = $1 and code = 'WH-01' and deleted_at is null`);
  const software = await id(`select id::text as id from sm_software_models where org_id = $1 and deleted_at is null order by name limit 1`);
  const supplier = await id(`select id::text as id from sm_suppliers where org_id = $1 and deleted_at is null order by created_at limit 1`);
  return sys.write(async (tx) => {
    const ids = new Set<string>();
    const keep = (row: Record<string, unknown>) => {
      ids.add(String(row.id));
      return String(row.id);
    };
    const asset = (values: Record<string, unknown>) => createIn(tx, sys, "asset", { model_id: model, stockroom_id: stockroom, state: "in_stock", ...values }, { trusted: true });
    const depreciating = keep(await asset({ serial_number: `${tag}-DEP`, purchase_cost: "1200000000", purchase_date: addDays(day, -95), in_service_date: addDays(day, -95), cost_center_id: centre }));
    keep(await asset({ serial_number: `${tag}-NEW`, purchase_cost: "480000000", purchase_date: day, in_service_date: day }));
    const contract = keep(await createIn(tx, sys, "contract", { name: `پشتیبانی ${tag}`, contract_type: "support", state: "active", supplier_id: supplier, annual_value: "2400000000", start_date: addDays(day, -200), end_date: addDays(day, 165) }, { trusted: true }));
    keep(await createIn(tx, sys, "saas_subscription", { name: `اشتراک ${tag}`, state: "active", billing_cycle: "annual", annual_cost: "1200000000" }, { trusted: true }));
    keep(await createIn(tx, sys, "license_entitlement", { name: `مجوز سالانهٔ ${tag}`, software_model_id: software, metric: "per_device", quantity: 10, state: "active", annual_cost: "600000000", start_date: addDays(day, -100) }, { trusted: true }));
    keep(await createIn(tx, sys, "license_entitlement", { name: `مجوز خریداری‌شدهٔ ${tag}`, software_model_id: software, metric: "per_device", quantity: 5, state: "active", total_cost: "300000000", purchase_date: day, start_date: day }, { trusted: true }));
    const repair = keep(await createIn(tx, sys, "repair_order", { asset_id: depreciating, title: `تعمیر ${tag}`, fault: "نمایشگر روشن نمی‌شود", cost: "45000000" }, { trusted: true }));
    await transitionIn(tx, sys, "repair_order", repair, "repaired", { resolution: "تعویض برد تغذیه" });
    const scrap = keep(await asset({ serial_number: `${tag}-OLD`, purchase_cost: "900000000", purchase_date: addDays(day, -400), in_service_date: addDays(day, -400), cost_center_id: centre }));
    await transitionIn(tx, sys, "asset", scrap, "retired", { retire_reason: "پایان عمر مفید" });
    await transitionIn(tx, sys, "asset", scrap, "disposed", { disposal_method: "recycle" });
    return { ids, depreciating, contract };
  });
}

/**
 * An organisation with its modules' defaults and a demo pack (its load's job never runs here: the pack's items are
 * written inside the demo scope, as the load writes), its own items and the pack's dated around `at`.
 */
async function world(at: string): Promise<World> {
  const e = await engineOrg();
  await seedItamDefaults(e.cfg, e.org);
  await seedSupplierDefaults(e.cfg, e.org);
  await seedFinancialDefaults(e.cfg, e.org);
  await e.owner.post(`/o/${e.org}/demo/load`, { size: "small", force: true });
  pin(at);
  const sys = await systemCtx(e.cfg, e.org);
  await ensureFiscalYear(sys, 1405);
  const day = orgToday(sys);
  const own = (await e.db.one<{ id: string }>(`select id::text as id from sm_org_units where org_id = $1 and code = 'CC-IT-EUC' and deleted_at is null`, [e.org]))!.id;
  const real = await items(e, sys, day, "REAL", own);
  const centre = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "org_unit", { name: "مرکز هزینهٔ آزمون بانک نمونه", code: "AFT-CC-TEST", kind: "cost_center" }, { trusted: true })));
  const pack = await inDemoScope(e.org, () => items(e, sys, day, "AFT", String(centre.id)));
  return { e, sys, real, pack, centre: String(centre.id) };
}

/** The pack's ledger as the load runs it: the last phase of its ITAM workflows step, inside the demo scope. */
async function packLedger(w: World): Promise<void> {
  const step = STEPS.find((s) => s.key === "itam_flows")!;
  const memo = newMemo("small");
  // the step runs with the bank's asset people and a branch; its phases: fleet_status, transfers, audit, attestation,
  // disposal, ledger
  memo.itam = { officers: {}, managers: {}, regional: {} };
  memo.branches.push({ unit: "", location: "", region: REGIONS[0], city: "تهران", name: "شعبهٔ آزمون" });
  memo.cursor = 5;
  expect(await inDemoScope(w.e.org, () => step.run({ cfg: w.e.cfg, orgId: w.e.org, memo, deadline: Date.now() + 300_000 }, w.sys))).toBe(true);
  expect(loadRefusals(w.e.org)["itam.ledger"]).toBeUndefined();
}

interface Entry {
  key: string;
  source: string;
  /** the item the entry is for (its source key) */
  item: string | null;
  /** the entry is a row of the pack (made inside the demo scope) */
  demo: boolean;
  /** its item is one of the pack's */
  of_pack: boolean;
}

async function ledger(e: EngineOrg): Promise<Entry[]> {
  return e.db.query<Entry>(
    `select x.source_key as key, x.source, substring(x.source_key from '${UUID}') as item,
            exists (select 1 from sm_demo_rows d where d.org_id = x.org_id and d.row_id = x.id) as demo,
            exists (select 1 from sm_demo_rows d where d.org_id = x.org_id and d.row_id::text = substring(x.source_key from '${UUID}')) as of_pack
       from sm_cost_entries x where x.org_id = $1 and x.deleted_at is null and x.source_key is not null order by x.source_key`,
    [e.org],
  );
}

/** Entries on the wrong side: an item of the pack's posted by the organisation's work, or its own posted by the pack. */
const wrongSide = (rows: Entry[]) => rows.filter((r) => r.item && r.demo !== r.of_pack).map((r) => `${r.demo ? "the pack" : "the organisation"} posted ${r.key}`);
/** The kinds of cost one side posted for these items */
const sources = (rows: Entry[], ids: Set<string>, demo: boolean) => [...new Set(rows.filter((r) => r.item && ids.has(r.item) && r.demo === demo).map((r) => r.source))].sort();

async function purge(e: EngineOrg): Promise<void> {
  vi.useRealTimers();
  await e.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [e.ownerId]);
  await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
  for (let i = 0; i < 12; i++) {
    const p = await e.db.one<{ purge: string | null }>(`select progress->>'purge' as purge from sm_demo_packs where org_id = $1`, [e.org]);
    if (!p?.purge) break;
    await purgeStep(e.cfg, e.org);
  }
  expect((await e.owner.get(`/o/${e.org}/demo`)).state).toBe("none");
}

describe("the cost ledger keeps to its side of the demo boundary", () => {
  it("a pack loaded in a month's first half hour in Tehran posts that month for its items; the sweep posts its own", async () => {
    const w = await world(MONTH_START);
    // the window of the main CI run: UTC on the last day of Aban, the organisation's calendar on 1 Azar
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-21");
    expect(orgToday(w.sys)).toBe("2026-11-22");
    await packLedger(w);
    await financialSweep(w.sys);
    const rows = await ledger(w.e);
    expect(wrongSide(rows)).toEqual([]);
    expect(sources(rows, w.pack.ids, true)).toEqual(SOURCES);
    expect(sources(rows, w.real.ids, false)).toEqual(SOURCES);
    // the pack's ledger went as far as the organisation's month (its own capture's), Azar
    expect(rows.filter((r) => r.key === `dep:${w.pack.depreciating}:1405-09`).map((r) => r.demo)).toEqual([true]);
    expect(rows.filter((r) => r.key === `contract:${w.real.contract}:1405-09`).map((r) => r.demo)).toEqual([false]);
    // the purge leaves the organisation's ledger as its own work made it
    const own = rows.filter((r) => !r.demo).map((r) => r.key);
    await purge(w.e);
    expect((await ledger(w.e)).map((r) => r.key)).toEqual(own);
  }, 300_000);

  it("a pack loaded mid-month and kept into the next: each side's costs, runs and alerts are its own", async () => {
    const w = await world(MID_MONTH);
    expect(orgToday(w.sys)).toBe("2026-11-07");
    await packLedger(w);
    await financialSweep(w.sys);
    let rows = await ledger(w.e);
    expect(wrongSide(rows)).toEqual([]);
    expect(sources(rows, w.pack.ids, true)).toEqual(SOURCES);
    expect(sources(rows, w.real.ids, false)).toEqual(SOURCES);
    const { e, sys } = w;
    // the pack's costs on the organisation's default cost centre (its items without a cost centre post there) and a
    // rule of the pack's own beside the organisation's seeded rule of that centre
    const cfg = (await e.db.one<{ cc: string }>(`select default_cost_center_id::text as cc from sm_financial_configs where org_id = $1 and deleted_at is null`, [e.org]))!;
    const onDefault = async (demo: boolean) =>
      Number((await e.db.one<{ n: string }>(
        `select coalesce(sum(x.amount), 0)::text as n from sm_cost_entries x where x.org_id = $1 and x.cost_center_id = $2 and x.deleted_at is null
            and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) = $3`,
        [e.org, cfg.cc, demo],
      ))!.n);
    expect(await onDefault(true)).toBeGreaterThan(0);
    await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "allocation_rule", { name: "تسهیم آزمون بانک نمونه", source_cost_center_id: w.centre, method: "equal", active: true }, { trusted: true })));
    // the organisation's own showback of the year so far pools its own costs on its own rules' centres only
    const year = (await e.db.one<{ id: string }>(`select id::text as id from sm_fiscal_years where org_id = $1 and year = 1405 and deleted_at is null`, [e.org]))!.id;
    const period = async (m: number) => (await e.db.one<{ id: string; start_date: string; end_date: string }>(`select id::text as id, start_date::text, end_date::text from sm_fiscal_periods where org_id = $1 and fiscal_year_id = $2 and month = $3 and deleted_at is null`, [e.org, year, m]))!;
    const from = await period(1);
    const to = await period(8);
    const run = await sys.write((tx) => createIn(tx, sys, "allocation_run", { name: "نمایش هزینهٔ سازمان", mode: "showback", fiscal_year_id: year, period_from_id: from.id, period_to_id: to.id }, { trusted: true }));
    await calculateRun(await e.ctxOf(e.ownerId), String(run.id));
    const pooled = (await e.db.one<{ pool: string; own: string }>(
      `select r.total_pool::text as pool, (select coalesce(sum(x.amount), 0)::text from sm_cost_entries x
          where x.org_id = $1 and x.deleted_at is null and x.source <> 'allocation' and x.entry_date between $3 and $4
            and x.cost_center_id in (select a.source_cost_center_id from sm_allocation_rules a where a.org_id = $1 and a.active and a.deleted_at is null
              and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = a.id))
            and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id)) as own
         from sm_allocation_runs r where r.id = $2`,
      [e.org, run.id, from.start_date, to.end_date],
    ))!;
    expect(Number(pooled.pool)).toBe(Number(pooled.own));
    // a real budget of the default centre the size of the year's costs there, the pack's included: only the pack's
    // costs would take it to its alert threshold
    const hw = (await e.db.one<{ id: string }>(`select id::text as id from sm_cost_types where org_id = $1 and code = 'HW' and deleted_at is null`, [e.org]))!.id;
    const total = (await onDefault(true)) + (await onDefault(false));
    const budget = await sys.write(async (tx) => {
      const b = await createIn(tx, sys, "budget", { name: "بودجهٔ آزمون زیرساخت", fiscal_year_id: year, cost_center_id: cfg.cc, state: "draft", alert_percent: 90 }, { trusted: true });
      await createIn(tx, sys, "budget_line", { budget_id: b.id, cost_type_id: hw, amount: String(total) }, { trusted: true });
      await updateIn(tx, sys, "budget", String(b.id), { state: "approved" }, { trusted: true });
      return String(b.id);
    });
    expect((await onDefault(false)) / total).toBeLessThan(0.9);
    await budgetAlerts(sys);
    expect((await e.db.one<{ p: number | null }>(`select alerted_percent as p from sm_budgets where id = $1`, [budget]))!.p ?? 0).toBe(0);
    // three days into the next month, the pack still loaded: the organisation's daily sweep posts Azar for its own
    // items, and the pack's stay the pack's
    pin(NEXT_MONTH);
    expect(orgToday(sys)).toBe("2026-11-24");
    await financialSweep(sys);
    rows = await ledger(e);
    expect(wrongSide(rows)).toEqual([]);
    expect(rows.filter((r) => r.key === `contract:${w.real.contract}:1405-09`).map((r) => r.demo)).toEqual([false]);
    // after the purge the organisation's items keep every month its sweep covered while the pack was loaded
    const own = rows.filter((r) => !r.demo).map((r) => r.key);
    for (const m of ["1405-07", "1405-08", "1405-09"]) expect(own).toContain(`contract:${w.real.contract}:${m}`);
    await purge(e);
    expect((await ledger(e)).map((r) => r.key)).toEqual(own);
  }, 300_000);
});
