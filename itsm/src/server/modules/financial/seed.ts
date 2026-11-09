// Day-one defaults of IT financial management (Persian, idempotent): the settings row, this and next fiscal year (from
// 1 Farvardin, with their twelve periods), the cost type tree with CapEx/OpEx, cost centres (units of kind «مرکز هزینه»
// in the organisation tree), sample exchange rates to update, approved budgets of the IT cost centres with lines, an
// allocation rule of infrastructure costs to the services, the «مدیر مالی فناوری اطلاعات» role, the budget approval
// rule and notification rules (budget alerts, approved budgets).
import type { Cond } from "@shared/model/conditions";
import { fiscalYearOf } from "@shared/financial/logic";
import { todayISO } from "@shared/jalali";
import { faDigits } from "@shared/format";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, updateIn } from "../../engine";
import { ensure, type SeedCounts } from "../itam/seed";
import { eqAll, liveRows, sysOf, type Row } from "../itam/common";

export const FINANCIAL_SEED_VERSION = 1;

const COST_TYPES: [string, string, string, string][] = [
  ["HW", "خرید سخت‌افزار", "hardware", "capex"],
  ["SW", "مجوز و نرم‌افزار", "software", "opex"],
  ["CLOUD", "اشتراک‌ها و خدمات ابری", "cloud", "opex"],
  ["SVC", "خدمات و قراردادهای پشتیبانی", "services", "opex"],
  ["MAINT", "تعمیر و نگهداری", "services", "opex"],
  ["DEP", "استهلاک", "depreciation", "opex"],
  ["LAB", "نیروی انسانی", "labour", "opex"],
  ["TEL", "ارتباطات و اینترنت", "telecom", "opex"],
  ["DISP", "زیان اسقاط", "other", "opex"],
  ["ALLOC", "تسهیم هزینه", "other", "opex"],
];

const COST_CENTRES: [string, string][] = [
  ["CC-IT-INF", "فناوری اطلاعات — زیرساخت"],
  ["CC-IT-EUC", "فناوری اطلاعات — کاربران نهایی"],
  ["CC-IT-APP", "فناوری اطلاعات — نرم‌افزار و مجوزها"],
  ["CC-HR", "منابع انسانی"],
  ["CC-FIN", "مالی"],
  ["CC-SALES", "فروش"],
];

const B = (n: number) => String(n * 1_000_000_000);
const FULL = { read: "all", create: true, write: "all", delete: "all", approve: true, admin: false };
const READ = { read: "all", create: false, write: "none", delete: "none", approve: false, admin: false };

export async function seedFinancialDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "financial_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= FINANCIAL_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "financial_config", { config_key: "default" }, { name: "تنظیمات مالی" }));
  const jy = fiscalYearOf(todayISO(orgTz(sys)));
  const years: Row[] = [];
  for (const y of [jy, jy + 1]) years.push(await ensure(tx, sys, out, "fiscal_year", { year: y }, { name: `سال مالی ${faDigits(y)}`, status: "open" }));

  const types = new Map<string, Row>();
  for (const [code, name, category, capex] of COST_TYPES) types.set(code, await ensure(tx, sys, out, "cost_type", { code }, { name, category, capex_opex: capex, active: true }));
  const centres = new Map<string, Row>();
  for (const [code, name] of COST_CENTRES) centres.set(code, await ensure(tx, sys, out, "org_unit", { code }, { name, kind: "cost_center", active: true }));
  const today = todayISO(orgTz(sys));
  for (const [currency, rate, type] of [["USD", "820000", "market"], ["EUR", "890000", "market"], ["AED", "223000", "market"], ["USD", "700000", "official"]] as const) {
    await ensure(tx, sys, out, "exchange_rate", { currency, rate_type: type, rate_date: today }, { rate, source: "نمونه — نرخ روز را وارد کنید" });
  }

  const budget = async (name: string, cc: string, lines: [string, number][]) => {
    const [found] = await liveRows(tx, sys, "budget", eqAll({ name, fiscal_year_id: years[0].id }), { limit: 1 });
    if (found) return found;
    const b = await createIn(tx, sys, "budget", { name, fiscal_year_id: years[0].id, cost_center_id: centres.get(cc)!.id, state: "draft", alert_percent: 90 }, { trusted: true });
    for (const [code, amount] of lines) await createIn(tx, sys, "budget_line", { budget_id: b.id, cost_type_id: types.get(code)!.id, amount: B(amount), note: types.get(code)!.name }, { trusted: true });
    await updateIn(tx, sys, "budget", String(b.id), { state: "approved" }, { trusted: true });
    out.created.budget = (out.created.budget ?? 0) + 1;
    return b;
  };
  await budget(`بودجهٔ زیرساخت فناوری اطلاعات ${faDigits(jy)}`, "CC-IT-INF", [["HW", 30], ["SVC", 20], ["CLOUD", 4], ["MAINT", 2], ["DEP", 15], ["TEL", 3]]);
  await budget(`بودجهٔ کاربران نهایی ${faDigits(jy)}`, "CC-IT-EUC", [["HW", 25], ["SW", 12], ["MAINT", 1], ["DEP", 10]]);
  await budget(`بودجهٔ نرم‌افزار و مجوزها ${faDigits(jy)}`, "CC-IT-APP", [["SW", 18], ["CLOUD", 6], ["SVC", 4]]);

  const rule = await ensure(tx, sys, out, "allocation_rule", { name: "تسهیم هزینه‌های زیرساخت به خدمت‌ها" }, { source_cost_center_id: centres.get("CC-IT-INF")!.id, method: "equal", active: true, sort_order: 10, description: "هزینه‌های مرکز هزینهٔ زیرساخت به سهم برابر میان خدمت‌های فعال" });
  const services = await liveRows(tx, sys, "service", { f: "status", op: "nin", v: ["retired"] } as Cond, { limit: 6 }).catch(() => [] as Row[]);
  for (const s of services) await ensure(tx, sys, out, "allocation_target", { rule_id: rule.id, service_id: s.id }, {});

  const committee = await ensure(tx, sys, out, "group", { name: "کمیتهٔ مالی فناوری اطلاعات" }, { types: ["approval"], description: "تأیید بودجه‌ها و نتیجهٔ تسهیم هزینه" });
  const [role] = await liveRows(tx, sys, "role", eqAll({ key: "it_finance" }), { limit: 1 });
  if (!role) {
    await createIn(tx, sys, "role", {
      key: "it_finance", name: "مدیر مالی فناوری اطلاعات", persona: "agent", description: "بودجه‌ها، دفتر هزینه، تسهیم و بازپرداخت هزینه با اطلاعات مالی؛ دیدن دارایی‌ها، مجوزها، قراردادها و تدارکات",
      grants: { financial: FULL, asset: READ, software: READ, contract: READ, procurement: { ...READ, approve: true }, vendor: READ, service: READ, reports: READ, org: READ, users: READ },
      field_groups: ["financial", "internal"], contains: ["requester"], workspaces: "member", domains: "own", active: true,
    }, { trusted: true });
    out.created.role = (out.created.role ?? 0) + 1;
  }
  await ensure(tx, sys, out, "approval_rule", { table_key: "budget", name: "تأیید بودجه" }, {
    condition: { f: "state", op: "eq", v: "submitted" } as Cond, mode: "sequential", active: true, expire_after: 14 * 86400,
    levels: [{ name: "کمیتهٔ مالی", sources: [{ kind: "groups", groups: [committee.id] }], rule: "any" }],
  });
  const base = { active: true, notify_actor: false, digest: false, mandatory: false };
  for (const r of [
    { table_key: "budget", name: "هزینهٔ واقعی به آستانهٔ بودجه رسید", event: "custom", custom_event: "financial.budget_alert", recipients: { event_users: true, roles: ["tenant_admin"] }, channels: ["in_app", "email"] },
    { table_key: "budget", name: "بودجه مصوب شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "approved" }, recipients: { fields: ["owner_id"] }, channels: ["in_app"] },
  ]) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, { ...base, ...r });
  const patch: Row = { seeded: FINANCIAL_SEED_VERSION };
  if (!config.default_cost_center_id) patch.default_cost_center_id = centres.get("CC-IT-INF")!.id;
  await updateIn(tx, sys, "financial_config", String(config.id), patch, { trusted: true });
  return out;
}
