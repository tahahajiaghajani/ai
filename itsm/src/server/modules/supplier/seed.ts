// Day-one defaults of supplier and contract management (Persian, idempotent): the settings row, service providers, a
// support contract underpinning the IT services (UC) with lines and obligations, a lease and a cloud contract with
// automatic renewal, the contract approval rule (the contract manager's manager), and notification rules for renewal
// reminders, expiry, automatic renewal and obligations coming due.
import type { Cond } from "@shared/model/conditions";
import { addJalaliMonths } from "@shared/supplier/logic";
import { addDays, todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { orgTz, updateIn } from "../../engine";
import { ensure, type SeedCounts } from "../itam/seed";
import { liveRows, sysOf, type Row } from "../itam/common";

/** 2: the supplier fields on tickets are in the «داخلی» field group (existing ones are moved into it once). */
export const SUPPLIER_SEED_VERSION = 2;

function notificationRules(): Row[] {
  const base = { active: true, notify_actor: false, digest: false, mandatory: false };
  return [
    { table_key: "contract", name: "مهلت اعلام تمدید قرارداد نزدیک است", event: "custom", custom_event: "contract.renewal_due", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "contract", name: "قرارداد منقضی شد", event: "custom", custom_event: "contract.expired", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "contract", name: "قرارداد خودکار تمدید شد", event: "custom", custom_event: "contract.auto_renewed", recipients: { event_users: true }, channels: ["in_app"] },
    { table_key: "contract_obligation", name: "موعد تعهد قراردادی نزدیک یا گذشته است", event: "custom", custom_event: "contract.obligation_due", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "contract_guarantee", name: "ضمانت‌نامه رو به پایان اعتبار است", event: "custom", custom_event: "contract.guarantee_due", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "contract_guarantee", name: "اعتبار ضمانت‌نامه تمام شد", event: "custom", custom_event: "contract.guarantee_expired", recipients: { event_users: true }, channels: ["in_app", "email"] },
  ].map((r) => ({ ...base, ...r }));
}

// SUP-016: whom a ticket waits on — the supplier, their ticket number and contact, the contract used — as the
// organisation's custom fields on the work tables (the platform's custom fields: admins relabel, move or switch them
// off; the incident's «منتظر تأمین‌کننده» pending reason already pauses its SLA). They are the team's working notes:
// in the «داخلی» field group, so a requester reading their own ticket never sees the supplier or the contract.
export const SUPPLIER_TASK_TABLES = ["incident", "incident_task", "problem_task", "change_task", "request_task"];
const SECTION = "تأمین‌کننده";
const SUPPLIER_TASK_FIELDS: Row[] = [
  { name: "u_supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", filter: true, section: SECTION, sort_order: 900, help: "تأمین‌کننده‌ای که کار نزد اوست" },
  { name: "u_supplier_ticket", label: "شمارهٔ تیکت تأمین‌کننده", type: "string", max_length: 80, search: true, section: SECTION, sort_order: 901 },
  { name: "u_supplier_contact_id", label: "مخاطب تأمین‌کننده", type: "ref", ref: "supplier_contact", section: SECTION, sort_order: 902 },
  { name: "u_contract_id", label: "قرارداد", type: "ref", ref: "contract", filter: true, section: SECTION, sort_order: 903, help: "قراردادی که کار بر پایهٔ آن انجام می‌شود" },
];

export async function seedSupplierDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "supplier_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= SUPPLIER_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "supplier_config", { config_key: "default" }, { name: "تنظیمات قراردادها" }));
  const today = todayISO(orgTz(sys));

  const support = await ensure(tx, sys, out, "supplier", { name: "شرکت پشتیبانی شبکهٔ پارس (نمونه)" }, { kinds: ["service_provider", "maintenance"], segment: "strategic", criticality: "high", state: "active", city: "تهران", payment_terms: "۳۰ روز پس از صورت‌حساب" });
  const cloud = await ensure(tx, sys, out, "supplier", { name: "ابر میزبان ایرانی (نمونه)" }, { kinds: ["cloud", "service_provider"], segment: "tactical", criticality: "high", state: "active" });
  const lessor = await ensure(tx, sys, out, "supplier", { name: "چاپ و تصویر (نمونه)" }, { kinds: ["lessor", "maintenance"], segment: "operational", criticality: "medium", state: "active" });
  await ensure(tx, sys, out, "supplier", { name: "پیمانکار بازیافت سبز (نمونه)" }, { kinds: ["disposal"], segment: "commodity", criticality: "low", state: "active" });
  await ensure(tx, sys, out, "supplier_contact", { supplier_id: support.id, name: "مدیر حساب" }, { contact_type: "account_manager", role: "مدیر فروش سازمانی", escalation_level: 0, is_primary: true });
  await ensure(tx, sys, out, "supplier_contact", { supplier_id: support.id, name: "پشتیبانی شبانه‌روزی" }, { contact_type: "support", role: "مرکز پشتیبانی", escalation_level: 1 });
  await ensure(tx, sys, out, "supplier_contact", { supplier_id: support.id, name: "مدیر فنی" }, { contact_type: "escalation", role: "مدیر فنی", escalation_level: 2 });

  for (const table_key of SUPPLIER_TASK_TABLES) {
    for (const f of SUPPLIER_TASK_FIELDS) {
      const row = await ensure(tx, sys, out, "custom_field", { table_key, name: f.name }, { ...f, field_group: "internal", active: true });
      // a field added before it had a group (seed 1) joins «داخلی» once; a group an administrator chose is kept
      if (!row.field_group && Number(cfg?.seeded ?? 0) < 2) await updateIn(tx, sys, "custom_field", row.id, { field_group: "internal" }, { trusted: true });
    }
  }
  // SUP-015: the supplier's clock on an incident runs while it waits on a named supplier (round the clock)
  const waiting = { and: [{ f: "state", op: "eq", v: "on_hold" }, { f: "hold_reason", op: "eq", v: "awaiting_supplier" }, { f: "u_supplier_id", op: "nempty" }] } as Cond;
  const ucDef = await ensure(tx, sys, out, "sla_definition", { table_key: "incident", name: "رفع خرابی توسط تأمین‌کننده (UC)" }, {
    type: "uc", target: "resolution", duration_mode: "fixed", duration: 8 * 3600, warn_percents: [50, 75, 90], start_condition: waiting,
    stop_condition: { or: [{ f: "state", op: "ne", v: "on_hold" }, { f: "hold_reason", op: "ne", v: "awaiting_supplier" }] } as Cond,
    cancel_condition: { f: "state", op: "eq", v: "canceled" } as Cond,
    description: "از وقتی رخداد «منتظر تأمین‌کننده» است تا وقتی تأمین‌کننده پاسخ دهد یا کار را برگرداند؛ هدف قرارداد پشتیبانی نمونه",
  });

  const uc = await ensure(tx, sys, out, "contract", { name: "پشتیبانی و نگهداری سرورها و شبکه (نمونه)" }, {
    sla_definitions: [ucDef.id],
    supplier_id: support.id, contract_type: "uc", state: "active", start_date: addDays(today, -290), end_date: addDays(today, 75), notice_period_days: 30, renewal_type: "manual",
    renewal_term_months: 12, value: "18000000000", annual_value: "18000000000", payment_frequency: "monthly",
    uc_targets: "- پاسخ به خرابی حیاتی: ۲ ساعت، شبانه‌روزی\n- رفع خرابی حیاتی: ۸ ساعت\n- بازدید پیشگیرانه: ماهانه",
    terms: "پشتیبانی سخت‌افزار و نرم‌افزار سرورها و تجهیزات شبکهٔ مرکز داده، با تأمین قطعه و جریمهٔ تأخیر.",
  });
  await ensure(tx, sys, out, "contract_line", { contract_id: uc.id, description: "پشتیبانی شبانه‌روزی سرورها" }, { quantity: "12", unit_price: "1000000000", period: "monthly" });
  await ensure(tx, sys, out, "contract_line", { contract_id: uc.id, description: "پشتیبانی تجهیزات شبکه" }, { quantity: "12", unit_price: "500000000", period: "monthly" });
  await ensure(tx, sys, out, "contract_obligation", { contract_id: uc.id, title: "گزارش ماهانهٔ عملکرد و خرابی‌ها" }, { party: "supplier", due_date: addJalaliMonths(today, 1), recurrence: "monthly" });
  await ensure(tx, sys, out, "contract_obligation", { contract_id: uc.id, title: "تمدید بیمه‌نامهٔ مسئولیت پیمانکار" }, { party: "supplier", due_date: addDays(today, 40), recurrence: "annual" });
  await ensure(tx, sys, out, "contract", { name: "اجارهٔ چاپگرهای چندکاره (نمونه)" }, {
    supplier_id: lessor.id, contract_type: "lease", state: "active", start_date: addDays(today, -120), end_date: addJalaliMonths(today, 8), notice_period_days: 60, renewal_type: "auto",
    renewal_term_months: 12, annual_value: "2400000000", payment_frequency: "monthly",
  });
  await ensure(tx, sys, out, "contract", { name: "میزبانی ابری محیط آزمون (نمونه)" }, {
    supplier_id: cloud.id, contract_type: "cloud", state: "active", start_date: addDays(today, -200), end_date: addDays(today, 165), notice_period_days: 30, renewal_type: "auto",
    renewal_term_months: 12, annual_value: "3600000000", payment_frequency: "monthly",
  });

  await ensure(tx, sys, out, "approval_rule", { table_key: "contract", name: "تأیید قرارداد" }, {
    condition: { f: "state", op: "eq", v: "pending_approval" } as Cond, mode: "sequential", active: true, expire_after: 14 * 86400, remind_every: 2 * 86400,
    levels: [{ name: "مدیر مدیر قرارداد", sources: [{ kind: "manager" }], rule: "any" }],
    description: "قرارداد پیش از فعال شدن به تأیید مدیر مسئول قرارداد می‌رسد",
  });
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  await updateIn(tx, sys, "supplier_config", String(config.id), { seeded: SUPPLIER_SEED_VERSION }, { trusted: true });
  return out;
}
