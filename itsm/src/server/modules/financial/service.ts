// Services of IT financial management (catalogue FIN-001/003/005/006/007/010/012/014/015/019/022/023/039):
//   · fiscal years on demand (with their periods)
//   · automated cost capture per period — asset purchases (CapEx), monthly depreciation from ITAM's schedule, monthly
//     accruals of contracts, SaaS subscriptions and annual licences, one-off licence purchases, closed repairs and the
//     book value written off at disposal — idempotent by a source key, never into a closed period
//   · reversal of an entry (the ledger is insert-only)
//   · budget against actual by cost centre (cost type × month), IT spend views, budget alerts
//   · allocation runs: pooled costs of a cost centre to services (percent, equal shares, consumer units, supporting CIs,
//     assets in use), then each service's cost to its consumer units; showback statements; chargeback posting
//   · a service's cost (direct and allocated)
// Reads with the caller's access go through the engine (money needs the financial field group); capture and the
// sweep act as the system.
import type { Cond } from "@shared/model/conditions";
import type { BvaPayload, ServiceCost, SpendPayload, Statement } from "@shared/financial/api";
import { allocate, budgetVsActual, fiscalPeriods, fiscalYearOf, inputHash, monthlyShare, periodKeyOf, periodRange, type MoneyUnit } from "@shared/financial/logic";
import { depreciationSchedule, type DepMethod } from "@shared/itam/logic";
import { COST_SOURCES, FINANCIAL_CONFIG_DEFAULTS } from "@shared/tables/financial";
import { JALALI_MONTHS } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { D } from "@shared/money";
import type { Ctx } from "../../context";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { aggregate, createIn, defFor, emitEvent, get, list, removeIn, transitionIn, updateIn } from "../../engine";
import { configRow, hasGroup, isUuid, liveRow, liveRows, orgToday, sysOf, type Row } from "../itam/common";

export const financialConfig = (q: Ctx["db"], ctx: Ctx) => configRow(q, ctx, "financial_config", FINANCIAL_CONFIG_DEFAULTS);

const periodLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${JALALI_MONTHS[(m || 1) - 1]} ${faDigits(y)}`;
};

/** The fiscal year row of `jy`, created with its periods when missing (as the system). */
export async function ensureFiscalYear(sys: Ctx, jy: number): Promise<Row> {
  const [y] = await liveRows(sys.db, sys, "fiscal_year", { f: "year", op: "eq", v: jy } as Cond, { limit: 1 });
  if (y) return y;
  return sys.write((tx) => createIn(tx, sys, "fiscal_year", { year: jy, name: `سال مالی ${faDigits(jy)}`, status: "open" }, { trusted: true }));
}

// ---------------------------------------------------------------------------------------------------------------
// Automated cost capture (FIN-006/007)

const CODES = { hardware: "HW", software: "SW", cloud: "CLOUD", services: "SVC", repair: "MAINT", depreciation: "DEP", disposal: "DISP", allocation: "ALLOC" } as const;

export interface CaptureResult {
  period: string;
  created: number;
  by_source: Record<string, number>;
}

/** Post the costs of one period (key «1405-08») from ITAM and contracts; idempotent (a source key per cost). */
export async function capture(sys: Ctx, period: string): Promise<CaptureResult> {
  const out: CaptureResult = { period, created: 0, by_source: {} };
  const cfg = await financialConfig(sys.db, sys);
  const [y, m] = period.split("-").map(Number);
  const year = await ensureFiscalYear(sys, y);
  const [p] = await liveRows(sys.db, sys, "fiscal_period", { and: [{ f: "fiscal_year_id", op: "eq", v: year.id }, { f: "month", op: "eq", v: m }] } as Cond, { limit: 1 });
  if (!p || p.status === "closed") return out;
  const types = new Map((await liveRows(sys.db, sys, "cost_type", null, { limit: 1000 })).map((t) => [String(t.code), t]));
  const fallbackCc = isUuid(cfg.default_cost_center_id) ? String(cfg.default_cost_center_id) : null;
  const keys = new Set((await liveRows(sys.db, sys, "cost_entry", { f: "period_id", op: "eq", v: p.id } as Cond, { limit: 200000 })).map((e) => String(e.source_key ?? "")));
  const allKeys = async (prefix: string) => new Set((await liveRows(sys.db, sys, "cost_entry", { f: "source_key", op: "starts", v: prefix } as Cond, { limit: 200000 })).map((e) => String(e.source_key)));
  const pending: Row[] = [];
  const add = (key: string, source: string, code: string, amount: string, values: Row) => {
    if (keys.has(key) || D(amount).isZero()) return;
    const t = types.get(code);
    const cc = values.cost_center_id ?? fallbackCc;
    if (!t || !isUuid(cc)) return;
    keys.add(key);
    pending.push({ entry_date: values.entry_date ?? p.end_date, amount, source, source_key: key, cost_type_id: t.id, capex_opex: values.capex_opex ?? t.capex_opex ?? "opex", ...values, cost_center_id: cc });
  };
  const inPeriod = (d: unknown) => typeof d === "string" && d.slice(0, 10) >= String(p.start_date) && d.slice(0, 10) <= String(p.end_date);

  // asset purchases (CapEx) and depreciation
  const assets = await liveRows(sys.db, sys, "asset", { f: "purchase_cost", op: "nempty" } as Cond, { limit: 100000 });
  const purchased = await allKeys("asset_purchase:");
  const rules = new Map((await liveRows(sys.db, sys, "depreciation_rule", null, { limit: 500 })).map((r) => [String(r.id), r]));
  for (const a of assets) {
    const base = { asset_id: a.id, ci_id: a.ci_id ?? null, supplier_id: a.vendor_id ?? null, cost_center_id: a.cost_center_id ?? null };
    if (inPeriod(a.purchase_date) && !purchased.has(`asset_purchase:${a.id}`)) add(`asset_purchase:${a.id}`, "asset_purchase", CODES.hardware, String(a.purchase_cost), { ...base, entry_date: a.purchase_date, capex_opex: "capex", description: `خرید ${a.number ?? ""} — ${a.name ?? ""}`.slice(0, 300) });
    const rule = rules.get(String(a.depreciation_rule_id ?? ""));
    if (!rule || ["disposed", "canceled", "on_order"].includes(String(a.state))) continue;
    const start = String((rule.start_basis === "purchase" ? a.purchase_date : a.in_service_date || a.purchase_date) ?? "");
    if (!start) continue;
    const salvage = a.salvage_value ?? (rule.salvage_percent ? String((Number(a.purchase_cost) * Number(rule.salvage_percent)) / 100) : "0");
    const month = depreciationSchedule({ cost: a.purchase_cost, salvage, lifeMonths: Number(rule.life_months ?? 36), method: rule.method as DepMethod, ratePercent: rule.rate_percent, start }).find((x) => x.period === period);
    if (month) add(`dep:${a.id}:${period}`, "depreciation", CODES.depreciation, month.charge, { ...base, capex_opex: "opex", description: `استهلاک ${a.number ?? ""} — ${periodLabel(period)}` });
  }
  // contracts with an annual value (monthly accrual over their term)
  const contracts = await liveRows(sys.db, sys, "contract", { and: [{ f: "state", op: "in", v: ["active", "expired", "renewed", "terminated"] }, { f: "annual_value", op: "nempty" }] } as Cond, { limit: 20000 });
  for (const c of contracts) {
    if (c.start_date && String(c.start_date) > String(p.end_date)) continue;
    if (c.end_date && String(c.end_date) < String(p.start_date)) continue;
    const type = isUuid(c.cost_type_id) ? [...types.values()].find((t) => t.id === c.cost_type_id) : null;
    const code = type ? String(type.code) : c.contract_type === "license" || c.contract_type === "subscription" ? CODES.software : c.contract_type === "cloud" ? CODES.cloud : CODES.services;
    add(`contract:${c.id}:${period}`, "contract", code, monthlyShare(String(c.annual_value), m), { contract_id: c.id, supplier_id: c.supplier_id ?? null, service_id: c.service_id ?? null, cost_center_id: c.cost_center_id ?? null, description: `${c.name ?? ""} — ${periodLabel(period)}`.slice(0, 300) });
  }
  // SaaS subscriptions
  const subs = await liveRows(sys.db, sys, "saas_subscription", { and: [{ f: "state", op: "in", v: ["active", "cancel_pending"] }, { f: "annual_cost", op: "nempty" }] } as Cond, { limit: 5000 });
  for (const s of subs) add(`saas:${s.id}:${period}`, "saas", CODES.cloud, monthlyShare(String(s.annual_cost), m), { supplier_id: s.supplier_id ?? null, contract_id: s.contract_id ?? null, cost_center_id: s.cost_center_id ?? null, description: `${s.name ?? ""} — ${periodLabel(period)}`.slice(0, 300) });
  // licences: annual costs accrued, one-off purchases on their date
  const ents = await liveRows(sys.db, sys, "license_entitlement", { f: "state", op: "in", v: ["active", "expired"] } as Cond, { limit: 20000 });
  const licenses = await allKeys("license:");
  for (const e of ents) {
    const base = { supplier_id: e.supplier_id ?? null, contract_id: e.contract_id ?? null, cost_center_id: e.cost_center_id ?? null };
    if (e.annual_cost && (!e.end_date || String(e.end_date) >= String(p.start_date)) && (!e.start_date || String(e.start_date) <= String(p.end_date))) {
      add(`license:${e.id}:${period}`, "license", CODES.software, monthlyShare(String(e.annual_cost), m), { ...base, description: `${e.name ?? ""} — ${periodLabel(period)}`.slice(0, 300) });
    } else if (!e.annual_cost && e.total_cost && inPeriod(e.purchase_date ?? e.start_date) && !licenses.has(`license:${e.id}`)) {
      add(`license:${e.id}`, "license", CODES.software, String(e.total_cost), { ...base, entry_date: e.purchase_date ?? e.start_date, description: `خرید ${e.name ?? ""}`.slice(0, 300) });
    }
  }
  // closed repairs
  const repairs = await liveRows(sys.db, sys, "repair_order", { and: [{ f: "state", op: "in", v: ["repaired", "beyond_repair", "closed"] }, { f: "cost", op: "nempty" }] } as Cond, { limit: 20000 });
  const repaired = await allKeys("repair:");
  for (const r of repairs) {
    if (!inPeriod(r.returned_at ?? r.updated_at) || repaired.has(`repair:${r.id}`)) continue;
    const a = await liveRow(sys.db, sys, "asset", r.asset_id);
    add(`repair:${r.id}`, "repair", CODES.repair, String(r.cost), { asset_id: r.asset_id, ci_id: a?.ci_id ?? null, supplier_id: r.vendor_id ?? null, cost_center_id: a?.cost_center_id ?? null, entry_date: String(r.returned_at ?? r.updated_at).slice(0, 10), description: `تعمیر ${r.number ?? ""} — ${r.title ?? ""}`.slice(0, 300) });
  }
  // book value written off at disposal
  const disposed = await liveRows(sys.db, sys, "asset", { and: [{ f: "state", op: "eq", v: "disposed" }, { f: "book_value", op: "gt", v: "0" }] } as Cond, { limit: 20000 });
  const written = await allKeys("disposal:");
  for (const a of disposed) {
    if (!inPeriod(a.disposed_at) || written.has(`disposal:${a.id}`)) continue;
    add(`disposal:${a.id}`, "disposal", CODES.disposal, String(a.book_value), { asset_id: a.id, cost_center_id: a.cost_center_id ?? null, entry_date: String(a.disposed_at).slice(0, 10), description: `زیان اسقاط ${a.number ?? ""} (ارزش دفتری)`.slice(0, 300) });
  }
  for (let i = 0; i < pending.length; i += 200) {
    await sys.write(async (tx) => {
      for (const e of pending.slice(i, i + 200)) {
        await createIn(tx, sys, "cost_entry", e, { trusted: true });
        out.by_source[String(e.source)] = (out.by_source[String(e.source)] ?? 0) + 1;
        out.created++;
      }
    });
  }
  return out;
}

/** A reversal of an entry (negative amount, same dimensions, today), the original marked reversed. */
export async function reverseEntry(ctx: Ctx, id: string, reason: string): Promise<{ id: string; number: string | null }> {
  const { row } = await get(ctx, "cost_entry", id);
  const { def } = await defFor(ctx, "cost_entry");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ثبت در دفتر هزینه را ندارید");
  if (row.reversed) throw conflict("این ثبت پیش‌تر برگشت خورده است");
  if (row.reversal_of) throw conflict("ثبت برگشتی دوباره برگشت نمی‌خورد");
  if (!String(reason ?? "").trim()) throw bad("علت برگشت را بنویسید");
  const sys = sysOf(ctx, ctx.user.id);
  const created = await ctx.write(async (tx) => {
    const r = await createIn(tx, sys, "cost_entry", {
      entry_date: orgToday(ctx), amount: D(row.amount ?? 0).neg().toString(), description: `برگشت ${row.number ?? ""}: ${reason}`.slice(0, 300), cost_center_id: row.cost_center_id, cost_type_id: row.cost_type_id,
      capex_opex: row.capex_opex, source: row.source ?? "manual", source_key: row.source_key ? `${row.source_key}:reversal` : null, source_table: row.source_table ?? null, source_id: row.source_id ?? null,
      asset_id: row.asset_id ?? null, ci_id: row.ci_id ?? null, service_id: row.service_id ?? null, supplier_id: row.supplier_id ?? null, contract_id: row.contract_id ?? null, reversal_of: id,
    }, { trusted: true });
    await updateIn(tx, sys, "cost_entry", id, { reversed: true }, { trusted: true });
    return r;
  });
  return { id: String(created.id), number: (created.number as string) ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// Budget against actual and spend (FIN-010/012/039)

async function yearPeriods(ctx: Ctx, jy: number): Promise<{ year: Row | null; periods: Row[] }> {
  const ys = await list(ctx, "fiscal_year", { filter: { f: "year", op: "eq", v: jy }, size: 1, total: false });
  const year = ys.rows[0] ?? null;
  if (!year) return { year: null, periods: [] };
  const ps = await list(ctx, "fiscal_period", { filter: { f: "fiscal_year_id", op: "eq", v: year.id }, sort: "key", size: 12, total: false });
  return { year, periods: ps.rows };
}

export async function budgetVsActualFor(ctx: Ctx, jy: number, opts: { from?: number; to?: number; costCenterId?: string | null } = {}): Promise<BvaPayload> {
  if (!(await hasGroup(ctx, "financial"))) throw forbidden("مقایسهٔ بودجه با هزینهٔ واقعی گروه فیلد «مالی» لازم دارد");
  const cfg = await financialConfig(ctx.db, ctx);
  const { year, periods } = await yearPeriods(ctx, jy);
  const from = Math.max(1, opts.from ?? 1);
  const to = Math.min(12, opts.to ?? 12);
  const keys = periodRange(`${jy}-${String(from).padStart(2, "0")}`, `${jy}-${String(to).padStart(2, "0")}`);
  const periodKey = new Map(periods.map((p) => [String(p.id), String(p.key)]));
  const ccFilter: Cond[] = opts.costCenterId ? [{ f: "cost_center_id", op: "eq", v: opts.costCenterId }] : [];
  const budgets = year ? await list(ctx, "budget", { filter: { and: [{ f: "fiscal_year_id", op: "eq", v: year.id }, { f: "state", op: "in", v: ["approved", "locked"] }, ...ccFilter] }, size: 500, total: false }) : { rows: [], display: {} as Record<string, string> };
  const lines = budgets.rows.length ? await list(ctx, "budget_line", { filter: { f: "budget_id", op: "in", v: budgets.rows.map((b) => b.id) }, size: 10000, total: false }) : { rows: [], display: {} as Record<string, string> };
  const ccOf = new Map(budgets.rows.map((b) => [String(b.id), String(b.cost_center_id)]));
  const first = periods.find((p) => Number(p.month) === from)?.start_date ?? null;
  const last = periods.find((p) => Number(p.month) === to)?.end_date ?? null;
  const entries = first && last ? await list(ctx, "cost_entry", { filter: { and: [{ f: "entry_date", op: "between", v: [first, last] }, ...ccFilter] }, size: 100000, total: false, fields: ["entry_date", "amount", "cost_center_id", "cost_type_id"] }) : { rows: [], display: {} as Record<string, string> };
  const r = budgetVsActual(
    lines.rows.map((l) => ({ cost_center_id: ccOf.get(String(l.budget_id)) ?? "", cost_type_id: String(l.cost_type_id), period_key: l.period_id ? periodKey.get(String(l.period_id)) ?? null : null, amount: String(l.amount ?? 0) })),
    entries.rows.map((e) => ({ cost_center_id: String(e.cost_center_id), cost_type_id: String(e.cost_type_id), period_key: periodKeyOf(String(e.entry_date)), amount: String(e.amount ?? 0) })),
    keys,
    Number(cfg.budget_alert_percent ?? 90),
  );
  const names = { ...budgets.display, ...lines.display, ...entries.display };
  return {
    year: jy,
    periods: keys,
    unit: (cfg.currency_display as MoneyUnit) ?? "rial",
    rows: r.rows.map((row) => ({
      ...row,
      name: names[row.cost_center_id] ?? "—",
      by_type: row.by_type.map((t) => ({ ...t, name: names[t.cost_type_id] ?? "—" })),
      by_month: row.by_month.map((x) => ({ ...x, label: periodLabel(x.period_key) })),
    })),
    total: r.total,
    budgets: budgets.rows.length,
  };
}

export async function spendFor(ctx: Ctx, jy: number): Promise<SpendPayload> {
  if (!(await hasGroup(ctx, "financial"))) throw forbidden("نمای هزینه‌ها گروه فیلد «مالی» لازم دارد");
  const { periods } = await yearPeriods(ctx, jy);
  const start = periods[0]?.start_date ?? fiscalPeriods(jy)[0].start_date;
  const end = periods[periods.length - 1]?.end_date ?? fiscalPeriods(jy)[11].end_date;
  const filter: Cond = { f: "entry_date", op: "between", v: [start, end] };
  const agg = async (field: string) => aggregate(ctx, "cost_entry", { filter, groupBy: [field], metrics: [{ fn: "sum", field: "amount" }], limit: 200 });
  const [byType, bySource, bySupplier, byService, byCapex, byMonth] = await Promise.all([agg("cost_type_id"), agg("source"), agg("supplier_id"), agg("service_id"), agg("capex_opex"), aggregate(ctx, "cost_entry", { filter, groupBy: [{ field: "entry_date", bucket: "month" }], metrics: [{ fn: "sum", field: "amount" }], limit: 24 })]);
  const sumOf = (g: { values: Record<string, unknown> }) => String(g.values["sum:amount"] ?? "0");
  const named = (a: typeof byType) => a.rows.filter((g) => g.keys[0]).map((g) => ({ id: String(g.keys[0]), name: String(g.labels?.[0] ?? a.display?.[String(g.keys[0])] ?? "—"), amount: sumOf(g) }));
  return {
    year: jy,
    total: String(byType.totals?.["sum:amount"] ?? byType.rows.reduce<ReturnType<typeof D>>((a, g) => a.plus(D(sumOf(g))), D(0)).toString()),
    capex: sumOf(byCapex.rows.find((g) => g.keys[0] === "capex") ?? { values: {} }),
    opex: sumOf(byCapex.rows.find((g) => g.keys[0] === "opex") ?? { values: {} }),
    by_type: named(byType),
    by_source: bySource.rows.map((g) => ({ source: String(g.keys[0] ?? ""), label: COST_SOURCES.find((s) => s.value === g.keys[0])?.label ?? String(g.keys[0] ?? "—"), amount: sumOf(g) })),
    by_supplier: named(bySupplier),
    by_month: byMonth.rows.map((g) => ({ period_key: String(g.keys[0] ?? ""), label: String(g.labels?.[0] ?? g.keys[0] ?? ""), amount: sumOf(g) })),
    by_service: named(byService),
  };
}

/** Budget alerts (FIN-012): an approved budget whose actual reached its alert percent, once per threshold. */
export async function budgetAlerts(sys: Ctx): Promise<number> {
  const jy = fiscalYearOf(orgToday(sys));
  const [year] = await liveRows(sys.db, sys, "fiscal_year", { f: "year", op: "eq", v: jy } as Cond, { limit: 1 });
  if (!year) return 0;
  const budgets = await liveRows(sys.db, sys, "budget", { and: [{ f: "fiscal_year_id", op: "eq", v: year.id }, { f: "state", op: "in", v: ["approved", "locked"] }] } as Cond, { limit: 2000 });
  let n = 0;
  for (const b of budgets) {
    if (!D(b.total ?? 0).gt(0)) continue;
    const entries = await liveRows(sys.db, sys, "cost_entry", { and: [{ f: "cost_center_id", op: "eq", v: b.cost_center_id }, { f: "entry_date", op: "between", v: [year.start_date, year.end_date] }] } as Cond, { limit: 200000 });
    const actual = entries.reduce<ReturnType<typeof D>>((a, e) => a.plus(D(e.amount ?? 0)), D(0));
    const pct = Number(actual.div(D(b.total)).mul(100).toDecimalPlaces(0));
    const thresholds = [Number(b.alert_percent ?? 90), 100].filter((t, i, xs) => xs.indexOf(t) === i).sort((a, c) => a - c);
    const reached = thresholds.filter((t) => pct >= t && t > Number(b.alerted_percent ?? 0));
    if (!reached.length) continue;
    const t = reached[reached.length - 1];
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.financial.budget_alert", table: "budget", id: b.id, number: b.number ?? null, data: { users: [b.owner_id].filter(isUuid), used_pct: pct, threshold: t, actual: actual.toString(), total: b.total } });
      await updateIn(tx, sys, "budget", b.id, { alerted_percent: t }, { trusted: true, keepVersion: true });
    });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Allocation (FIN-014/015/019/022/023)

async function runPeriods(ctx: Ctx, run: Row): Promise<{ from: Row; to: Row }> {
  const from = await liveRow(ctx.db, sysOf(ctx), "fiscal_period", run.period_from_id);
  const to = await liveRow(ctx.db, sysOf(ctx), "fiscal_period", run.period_to_id);
  if (!from || !to) throw bad("ماه‌های اجرای تسهیم را مشخص کنید");
  return { from, to };
}

async function weightsFor(sys: Ctx, method: string, targets: Row[]): Promise<{ key: string; weight: string; driver: number }[]> {
  const out: { key: string; weight: string; driver: number }[] = [];
  for (const t of targets) {
    const service = await liveRow(sys.db, sys, "service", t.service_id);
    let driver = 1;
    if (method === "percent") driver = Number(t.percent ?? 0);
    else if (method === "consumers") driver = Array.isArray(service?.consumer_units) ? service!.consumer_units.length : 0;
    else if (method === "cis" && isUuid(service?.ci_id)) {
      driver = (await liveRows(sys.db, sys, "ci_rel", { and: [{ or: [{ f: "parent_id", op: "eq", v: service!.ci_id }, { f: "child_id", op: "eq", v: service!.ci_id }] }, { f: "valid_to", op: "empty" }] } as Cond, { limit: 10000 })).length;
    } else if (method === "cis") driver = 0;
    else if (method === "assets") {
      const units = Array.isArray(service?.consumer_units) ? service!.consumer_units : [];
      driver = units.length ? (await liveRows(sys.db, sys, "asset", { and: [{ f: "state", op: "eq", v: "in_use" }, { f: "unit_id", op: "in", v: units }] } as Cond, { limit: 100000 })).length : 0;
    }
    out.push({ key: String(t.id), weight: String(driver), driver });
  }
  return out;
}

/** Calculate an allocation run (as the caller, who must manage the financial area): results replaced. */
export async function calculateRun(ctx: Ctx, runId: string): Promise<{ total_pool: string; total_allocated: string; results: number }> {
  const { row: run } = await get(ctx, "allocation_run", runId);
  const { def } = await defFor(ctx, "allocation_run");
  if (!access().canWrite(ctx, def, run)) throw forbidden("اجازهٔ محاسبهٔ این تسهیم را ندارید");
  if (!["draft", "calculated"].includes(String(run.state))) throw conflict("اجرای تأییدشده یا ثبت‌شده دوباره محاسبه نمی‌شود");
  const sys = sysOf(ctx, ctx.user.id);
  const { from, to } = await runPeriods(ctx, run);
  const rules = await liveRows(ctx.db, sys, "allocation_rule", { f: "active", op: "eq", v: true } as Cond, { order: "t.sort_order nulls last, t.name", limit: 500 });
  const results: Row[] = [];
  const drivers: { key: string; driver: number }[] = [];
  let pool = D(0);
  let allocated = D(0);
  const hashInput: unknown[] = [];
  for (const rule of rules) {
    const types = Array.isArray(rule.cost_types) && rule.cost_types.length ? rule.cost_types : null;
    const where: Cond[] = [{ f: "cost_center_id", op: "eq", v: rule.source_cost_center_id }, { f: "entry_date", op: "between", v: [from.start_date, to.end_date] }, { f: "source", op: "ne", v: "allocation" }];
    if (types) where.push({ f: "cost_type_id", op: "in", v: types });
    const entries = await liveRows(ctx.db, sys, "cost_entry", { and: where } as Cond, { limit: 200000 });
    const amount = entries.reduce<ReturnType<typeof D>>((a, e) => a.plus(D(e.amount ?? 0)), D(0));
    pool = pool.plus(amount);
    const targets = await liveRows(ctx.db, sys, "allocation_target", { f: "rule_id", op: "eq", v: rule.id } as Cond, { limit: 500 });
    const weights = await weightsFor(sys, String(rule.method), targets);
    drivers.push(...weights.map((x) => ({ key: x.key, driver: x.driver })));
    hashInput.push({ rule: rule.id, version: rule.version, amount: amount.toString(), weights });
    const parts = allocate(amount.toString(), weights);
    for (const part of parts) {
      const t = targets.find((x) => x.id === part.key)!;
      const w = weights.find((x) => x.key === part.key)!;
      if (D(part.amount).isZero()) continue;
      allocated = allocated.plus(D(part.amount));
      results.push({ stage: "service", rule_id: rule.id, source_cost_center_id: rule.source_cost_center_id, service_id: t.service_id, amount: part.amount, driver_value: String(w.driver), basis: rule.method === "percent" ? `${faDigits(w.driver)}٪ از ${rule.name}` : `${faDigits(w.driver)} از ${faDigits(weights.reduce((a, x) => a + x.driver, 0))} (${rule.name})` });
    }
  }
  // each service's cost to its consumer units (equal shares)
  const byService = new Map<string, ReturnType<typeof D>>();
  for (const r of results) byService.set(String(r.service_id), (byService.get(String(r.service_id)) ?? D(0)).plus(D(r.amount)));
  for (const [serviceId, amount] of byService) {
    const service = await liveRow(ctx.db, sys, "service", serviceId);
    const units = (Array.isArray(service?.consumer_units) ? service!.consumer_units : []).filter(isUuid);
    if (!units.length) {
      results.push({ stage: "consumer", service_id: serviceId, consumer_unit_id: service?.provider_unit_id ?? null, amount: amount.toString(), basis: "بدون واحد مصرف‌کننده: به واحد ارائه‌دهنده" });
      continue;
    }
    for (const part of allocate(amount.toString(), units.map((u: string) => ({ key: u, weight: "1" })))) {
      results.push({ stage: "consumer", service_id: serviceId, consumer_unit_id: part.key, amount: part.amount, driver_value: "1", basis: `سهم برابر از ${faDigits(units.length)} واحد` });
    }
  }
  await ctx.write(async (tx) => {
    for (const old of await liveRows(tx, sys, "allocation_result", { f: "run_id", op: "eq", v: runId } as Cond, { limit: 100000 })) {
      await removeIn(tx, sys, "allocation_result", old.id);
    }
    for (const r of results) await createIn(tx, sys, "allocation_result", { run_id: runId, ...r }, { trusted: true });
    // the drivers were computed before this transaction (PGlite has one connection: no reads around it in here)
    for (const d of drivers) await updateIn(tx, sys, "allocation_target", d.key, { driver_value: String(d.driver) }, { trusted: true, keepVersion: true });
    await updateIn(tx, sys, "allocation_run", runId, { total_pool: pool.toString(), total_allocated: allocated.toString(), unallocated: pool.minus(allocated).toString(), calculated_at: new Date().toISOString(), input_hash: inputHash(hashInput) }, { trusted: true });
    if (run.state === "draft") await transitionIn(tx, sys, "allocation_run", runId, "calculated", {});
  });
  return { total_pool: pool.toString(), total_allocated: allocated.toString(), results: results.length };
}

/** Post an approved chargeback run: each consumer unit charged, each source cost centre credited (FIN-023). */
export async function postRun(ctx: Ctx, runId: string): Promise<{ entries: number }> {
  const { row: run } = await get(ctx, "allocation_run", runId);
  const { def } = await defFor(ctx, "allocation_run");
  if (!access().canWrite(ctx, def, run)) throw forbidden("اجازهٔ ثبت این تسهیم را ندارید");
  if (run.state !== "approved") throw conflict("فقط اجرای تأییدشده در دفتر ثبت می‌شود");
  if (run.mode !== "chargeback") throw conflict("نمایش هزینه (Showback) در دفتر ثبت نمی‌شود");
  const sys = sysOf(ctx, ctx.user.id);
  const { to } = await runPeriods(ctx, run);
  const [type] = await liveRows(ctx.db, sys, "cost_type", { f: "code", op: "eq", v: CODES.allocation } as Cond, { limit: 1 });
  if (!type) throw conflict("نوع هزینهٔ «تسهیم» (ALLOC) تعریف نشده است");
  const results = await liveRows(ctx.db, sys, "allocation_result", { f: "run_id", op: "eq", v: runId } as Cond, { limit: 100000 });
  const service = results.filter((r) => r.stage === "service");
  const consumer = results.filter((r) => r.stage === "consumer" && isUuid(r.consumer_unit_id));
  let n = 0;
  await ctx.write(async (tx) => {
    for (const r of consumer) {
      await createIn(tx, sys, "cost_entry", { entry_date: to.end_date, amount: String(r.amount), description: `بازپرداخت ${run.number ?? ""}: ${r.basis ?? ""}`.slice(0, 300), cost_center_id: r.consumer_unit_id, cost_type_id: type.id, capex_opex: "opex", source: "allocation", source_key: `alloc:${runId}:${r.id}`, service_id: r.service_id ?? null }, { trusted: true });
      n++;
    }
    const credits = new Map<string, ReturnType<typeof D>>();
    for (const r of service) if (isUuid(r.source_cost_center_id)) credits.set(String(r.source_cost_center_id), (credits.get(String(r.source_cost_center_id)) ?? D(0)).plus(D(r.amount)));
    for (const [cc, amount] of credits) {
      await createIn(tx, sys, "cost_entry", { entry_date: to.end_date, amount: amount.neg().toString(), description: `بستانکار بازپرداخت ${run.number ?? ""}`, cost_center_id: cc, cost_type_id: type.id, capex_opex: "opex", source: "allocation", source_key: `alloc:${runId}:credit:${cc}` }, { trusted: true });
      n++;
    }
    await transitionIn(tx, sys, "allocation_run", runId, "posted", {});
  });
  return { entries: n };
}

/** The showback or chargeback statement of a run, per consumer unit (FIN-022). */
export async function statementOf(ctx: Ctx, runId: string): Promise<Statement> {
  const { row: run } = await get(ctx, "allocation_run", runId);
  const r = await list(ctx, "allocation_result", { filter: { f: "run_id", op: "eq", v: runId }, size: 20000, total: false });
  const units = new Map<string, { unit_id: string | null; unit: string; total: ReturnType<typeof D>; lines: Statement["units"][number]["lines"] }>();
  const services = new Map<string, { service: string; total: ReturnType<typeof D> }>();
  for (const x of r.rows) {
    const service = x.service_id ? r.display[String(x.service_id)] ?? "—" : "—";
    if (x.stage === "service" && x.service_id) {
      const s = services.get(String(x.service_id)) ?? { service, total: D(0) };
      s.total = s.total.plus(D(x.amount ?? 0));
      services.set(String(x.service_id), s);
      continue;
    }
    const key = String(x.consumer_unit_id ?? "");
    const u = units.get(key) ?? { unit_id: (x.consumer_unit_id as string) ?? null, unit: x.consumer_unit_id ? r.display[String(x.consumer_unit_id)] ?? "—" : "بدون واحد", total: D(0), lines: [] };
    u.total = u.total.plus(D(x.amount ?? 0));
    u.lines.push({ service_id: (x.service_id as string) ?? null, service, amount: String(x.amount ?? "0"), basis: String(x.basis ?? "") });
    units.set(key, u);
  }
  const from = run.period_from_id ? r.display[String(run.period_from_id)] : null;
  const to = run.period_to_id ? r.display[String(run.period_to_id)] : null;
  return {
    run: { id: runId, number: (run.number as string) ?? null, name: String(run.name ?? ""), mode: String(run.mode), state: String(run.state), period: [from, to].filter(Boolean).join(" تا ") },
    units: [...units.values()].sort((a, b) => b.total.comparedTo(a.total)).map((u) => ({ unit_id: u.unit_id, unit: u.unit, total: u.total.toString(), lines: u.lines })),
    services: [...services.entries()].map(([service_id, s]) => ({ service_id, service: s.service, total: s.total.toString() })).sort((a, b) => D(b.total).comparedTo(D(a.total))),
    total: [...units.values()].reduce<ReturnType<typeof D>>((a, u) => a.plus(u.total), D(0)).toString(),
  };
}

/** A service's cost in a fiscal year: entries naming it and its share of allocation runs (FIN-019). */
export async function serviceCost(ctx: Ctx, serviceId: string, jy: number): Promise<ServiceCost> {
  if (!(await hasGroup(ctx, "financial"))) throw forbidden("هزینهٔ خدمت گروه فیلد «مالی» لازم دارد");
  const { row: service } = await get(ctx, "service", serviceId);
  const ps = fiscalPeriods(jy);
  const direct = await list(ctx, "cost_entry", { filter: { and: [{ f: "service_id", op: "eq", v: serviceId }, { f: "source", op: "ne", v: "allocation" }, { f: "entry_date", op: "between", v: [ps[0].start_date, ps[11].end_date] }] }, size: 100000, total: false, fields: ["entry_date", "amount"] });
  const years = await list(ctx, "fiscal_year", { filter: { f: "year", op: "eq", v: jy }, size: 1, total: false });
  const runs = years.rows[0] ? await list(ctx, "allocation_run", { filter: { and: [{ f: "fiscal_year_id", op: "eq", v: years.rows[0].id }, { f: "state", op: "in", v: ["approved", "posted"] }] }, size: 100, total: false }) : { rows: [] };
  const alloc = runs.rows.length ? await list(ctx, "allocation_result", { filter: { and: [{ f: "run_id", op: "in", v: runs.rows.map((x) => x.id) }, { f: "stage", op: "eq", v: "service" }, { f: "service_id", op: "eq", v: serviceId }] }, size: 10000, total: false, fields: ["amount"] }) : { rows: [] };
  const months = new Map<string, ReturnType<typeof D>>();
  let d = D(0);
  for (const e of direct.rows) {
    d = d.plus(D(e.amount ?? 0));
    const k = periodKeyOf(String(e.entry_date));
    months.set(k, (months.get(k) ?? D(0)).plus(D(e.amount ?? 0)));
  }
  const a = alloc.rows.reduce<ReturnType<typeof D>>((s, x) => s.plus(D(x.amount ?? 0)), D(0));
  return {
    service: { id: serviceId, name: String(service.name ?? "") },
    year: jy,
    direct: d.toString(),
    allocated: a.toString(),
    assets: "0",
    total: d.plus(a).toString(),
    by_month: ps.map((p) => ({ period_key: p.key, label: p.name, amount: (months.get(p.key) ?? D(0)).toString() })),
  };
}

export { notFound, monthlyShare };
