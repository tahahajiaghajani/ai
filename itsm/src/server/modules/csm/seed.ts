// Day-one configuration of customer service management (Persian, idempotent, as the system) — no sample customers:
//   · the organisation roles «کارشناس خدمات مشتریان» (csm_agent: the cases of their groups, the customers they serve)
//     and «مدیر خدمات مشتریان» (csm_manager: every customer, escalations and notices to approve, definitions)
//   · the group «پشتیبانی مشتریان» (the default support group) and the root «مشتریان» of the organisation tree under
//     which every customer company gets its unit
//   · agreements of customer cases (response and resolution by priority) and the complaint clocks (acknowledgement in
//     two working days, a reply in ten — ISO 10002), notification rules and CSM KPIs for the analytics module
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla/calendars";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const CSM_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

const H = 3600;
const DAY = 8 * H;

export const CSM_ROLES: Row[] = [
  {
    key: "csm_agent", name: "کارشناس خدمات مشتریان", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "پرونده‌های مشتریان گروه‌های خود، حساب‌ها، مخاطبان، پایگاه نصب و استحقاق‌ها؛ دستورهای کار میدانی پرونده‌ها",
    grants: {
      csm: { read: "all", create: true, write: "group" }, field_service: { read: "group", create: true }, incident: { read: "all", create: true, write: "group" }, problem: { read: "all" },
      knowledge: { read: "all", create: true, write: "own" }, catalog: { read: "all" }, service: { read: "all" }, sla: { read: "all" }, cmdb: { read: "all" }, reports: { read: "all" }, org: { read: "all" }, users: { read: "all" },
    },
    field_groups: ["internal", "personal"], contains: ["requester"],
  },
  {
    key: "csm_manager", name: "مدیر خدمات مشتریان", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "همهٔ مشتریان و پرونده‌ها، پذیرش تشدیدها، تأیید و ارسال اطلاع‌رسانی‌ها، قراردادها و استحقاق‌ها با اطلاعات مالی",
    grants: { csm: { read: "all", create: true, write: "all", delete: "group", approve: true }, reports: { read: "all", create: true, write: "own" } },
    field_groups: ["internal", "personal", "financial"], contains: ["csm_agent"],
  },
];

export async function seedCsmDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "csm_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= CSM_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "csm_config", { config_key: "default" }, { name: "تنظیمات خدمات مشتریان" }));
  for (const r of CSM_ROLES) await ensure(tx, sys, out, "role", { key: r.key }, r);
  const group = await ensure(tx, sys, out, "group", { name: "پشتیبانی مشتریان" }, { types: ["assignment"], roles: ["csm_agent"], description: "پرونده‌های مشتریان بیرونی", active: true });
  const root = await ensure(tx, sys, out, "org_unit", { name: "مشتریان", kind: "company" }, { active: true, description: "ریشهٔ شرکت‌های مشتری؛ هر حساب مشتری واحدی زیر آن دارد" });

  let calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!calendars.length) {
    await seedCalendarsIn(tx, sys, { years: [] });
    calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  const office = (calendars.find((c) => c.is_default) ?? calendars[0])?.id ?? null;
  const common = { table_key: "customer_case", type: "sla", calendar_id: office, retroactive: true, retroactive_field: "opened_at", warn_percents: [50, 75, 90], active: true };
  const done = { f: "state", op: "in", v: ["resolved", "closed"] };
  const cancelled = { f: "state", op: "eq", v: "cancelled" };
  const defs: Row[] = [
    { ...common, name: "نخستین پاسخ به مشتری", target: "response", duration_mode: "priority", priority_field: "priority", durations: { "1": H, "2": 2 * H, "3": 4 * H, "4": DAY, "5": DAY }, sort_order: 10, start_condition: { f: "state", op: "eq", v: "new" }, stop_condition: { or: [{ f: "state", op: "ne", v: "new" }, { f: "first_response_at", op: "nempty" }] }, cancel_condition: cancelled, description: "نخستین پاسخ عمومی به مشتری" },
    { ...common, name: "حل پروندهٔ مشتری", target: "resolution", duration_mode: "priority", priority_field: "priority", durations: { "1": DAY, "2": 2 * DAY, "3": 3 * DAY, "4": 5 * DAY, "5": 10 * DAY }, sort_order: 20, pause_condition: { f: "state", op: "eq", v: "awaiting_customer" }, stop_condition: done, cancel_condition: cancelled, breach_actions: [{ type: "notify", fields: ["assigned_to"] }], description: "«منتظر مشتری» زمان را نگه می‌دارد" },
    { ...common, name: "اعلام دریافت شکایت", target: "response", duration_mode: "fixed", duration: 2 * DAY, sort_order: 30, start_condition: { f: "complaint", op: "eq", v: true }, stop_condition: { or: [{ f: "first_response_at", op: "nempty" }, done] }, cancel_condition: cancelled, description: "شکایت در دو روز کاری اعلام دریافت می‌شود (ISO 10002)" },
    { ...common, name: "پاسخ نهایی به شکایت", target: "resolution", duration_mode: "fixed", duration: 10 * DAY, sort_order: 40, start_condition: { f: "complaint", op: "eq", v: true }, stop_condition: done, cancel_condition: cancelled, breach_actions: [{ type: "escalate" }], description: "پاسخ نهایی شکایت در ده روز کاری" },
  ];
  for (const d of defs) await ensure(tx, sys, out, "sla_definition", { table_key: "customer_case", name: d.name }, d);
  const rules: Row[] = [
    { table_key: "case_escalation", name: "تشدید پذیرفته شد", event: "custom", custom_event: "escalation_active", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "case_escalation", name: "تشدید تازه برای پذیرش", event: "created", recipients: { roles: ["csm_manager"] }, channels: ["in_app"] },
    { table_key: "entitlement", name: "سهمیهٔ استحقاق رو به پایان است", event: "custom", custom_event: "entitlement_warning", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "customer_case", name: "مشتری راه‌حل را نپذیرفت", event: "state_changed", condition: { and: [{ f: "state", op: "changes_from", v: "resolved" }, { f: "state", op: "changes_to", v: "open" }] }, recipients: { assignee: true, assignment_group: true }, channels: ["in_app", "email"] },
    { table_key: "customer_notice", name: "اطلاع‌رسانی آمادهٔ تأیید", event: "created", recipients: { roles: ["csm_manager"] }, channels: ["in_app"] },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
  for (const r of rules) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  if (tableDef("analytics_indicator")) {
    const shares = ["csm_manager", "csm_agent", "tenant_admin"].map((id) => ({ kind: "role", id, right: "view" }));
    const kpis: Row[] = [
      { key: "csm.csat", name: "رضایت مشتریان", practice: "other", unit: "number", direction: "up", grain: "month", target: "4.5", warn: "4", crit: "3.5", decimals: 1, description: "میانگین امتیاز رضایت (از ۵) پرونده‌های حل‌شده در دوره.", formula: "csat", parts: [{ name: "csat", table: "customer_case", fn: "avg", field: "satisfaction", date_field: "resolved_at" }], breakdowns: ["account_id", "product_id"] },
      { key: "csm.resolution_acceptance", name: "پذیرش راه‌حل", practice: "other", unit: "percent", direction: "up", grain: "month", target: "90", warn: "80", crit: "70", description: "سهم پرونده‌های حل‌شده‌ای که مشتری راه‌حل آن را پذیرفت.", formula: "accepted / resolved * 100", parts: [{ name: "accepted", table: "customer_case", fn: "count", date_field: "resolved_at", filter: { f: "resolution_accepted", op: "eq", v: true } }, { name: "resolved", table: "customer_case", fn: "count", date_field: "resolved_at", filter: { f: "resolved_at", op: "nempty" } }], breakdowns: ["account_id"] },
      { key: "csm.complaints", name: "شکایت‌های مشتریان", practice: "other", unit: "count", direction: "down", grain: "month", description: "شکایت‌های ثبت‌شده در دوره (هر مجرا).", formula: "n", parts: [{ name: "n", table: "customer_case", fn: "count", date_field: "opened_at", filter: { f: "complaint", op: "eq", v: true } }], breakdowns: ["account_id", "complaint_severity"] },
    ];
    for (const k of kpis) await ensure(tx, sys, out, "analytics_indicator", { key: k.key }, { active: true, collect: true, certified: false, score_shares: shares, library_key: k.key, ...k });
  }
  await updateIn(tx, sys, "csm_config", String(config.id), { seeded: CSM_SEED_VERSION, default_group_id: config.default_group_id ?? group.id, root_unit_id: config.root_unit_id ?? root.id }, { trusted: true });
  return out;
}
