// Day-one configuration of field service (Persian, idempotent, as the system):
//   · the organisation roles «تکنسین میدانی» (field_technician: the visits assigned to them), «توزیع‌کنندهٔ خدمات میدانی»
//     (dispatcher: every work order and task of their groups, assignment of others), «مدیر خدمات میدانی»
//     (field_manager) and «پیمانکار میدانی» (field_contractor: assigned visits only, no personal or internal fields)
//   · the dispatch group «توزیع خدمات میدانی» (the default) and three task templates with checklists
//   · on-site agreements: arrival (the response of a visit) and the fix of a work order; notification rules; field KPIs
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const FSM_SEED_VERSION = 2;

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

export const FSM_ROLES: Row[] = [
  {
    key: "field_technician", name: "تکنسین میدانی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "بازدیدهای سپرده به خود، دستورهای کار آن‌ها، قطعه‌ها و ثبت زمان؛ دیدن دانش",
    grants: { field_service: { read: "own", create: true, write: "own" }, knowledge: { read: "all" }, cmdb: { read: "all" } },
    field_groups: ["internal", "personal"], contains: ["requester"],
  },
  {
    key: "dispatcher", name: "توزیع‌کنندهٔ خدمات میدانی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "همهٔ دستورهای کار و وظیفه‌ها، تابلوی توزیع و واگذاری به تکنسین‌ها؛ دیدن موقعیت‌های ورود و خروج",
    grants: { field_service: { read: "all", create: true, write: "group", approve: true }, csm: { read: "all" }, incident: { read: "all" }, cmdb: { read: "all" }, knowledge: { read: "all" }, reports: { read: "all" }, org: { read: "all" }, users: { read: "all" } },
    field_groups: ["internal", "personal", "dispatch"], contains: ["requester"],
  },
  {
    key: "field_manager", name: "مدیر خدمات میدانی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "مدیریت خدمات میدانی: قلمروها، تکنسین‌ها، الگوها، برنامه‌های نگهداری و گزارش‌ها",
    grants: { field_service: { read: "all", create: true, write: "all", delete: "group", approve: true, admin: true }, reports: { read: "all", create: true, write: "own" } },
    field_groups: ["internal", "personal", "financial"], contains: ["dispatcher"],
  },
  {
    key: "field_contractor", name: "پیمانکار میدانی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "کاربر بیرونی: فقط بازدیدهای سپرده به خود، بی اطلاعات شخصی مشتری و یادداشت‌های داخلی",
    grants: { field_service: { read: "own", write: "own" } }, field_groups: [], contains: [],
  },
];

const TEMPLATES: Row[] = [
  {
    name: "بازدید دوره‌ای سامانهٔ سرمایش", work_type: "maintenance", required_skills: ["تأسیسات مکانیکی"], est_work_minutes: 90,
    checklist: [
      { key: "power_off", label: "برق دستگاه پیش از بازکردن قطع شد", type: "bool", required: true },
      { key: "filters", label: "فیلترها تمیز یا تعویض شد", type: "bool", required: true },
      { key: "pressure", label: "فشار گاز (psi)", type: "number", required: true },
      { key: "notes", label: "یادداشت بازدید", type: "text", required: false },
    ],
    parts: [{ name: "فیلتر هوا", quantity: 2 }], instructions: "بازدید فصلی دستگاه‌های سرمایش با ثبت فشار و وضعیت فیلترها.", safety: "پیش از هر کار برق را قطع و برچسب «کار در جریان» بزنید.",
  },
  {
    name: "نصب و راه‌اندازی تجهیزات شبکه", work_type: "install", required_skills: ["شبکه"], est_work_minutes: 120,
    checklist: [
      { key: "label", label: "برچسب اموال و سریال ثبت شد", type: "bool", required: true },
      { key: "link", label: "اتصال و چراغ‌های وضعیت بررسی شد", type: "bool", required: true },
      { key: "photo", label: "عکس رک پس از نصب پیوست شد", type: "bool", required: true },
    ],
    parts: [], instructions: "نصب دستگاه در رک، کابل‌کشی، برچسب‌گذاری و آزمون اتصال.", safety: "در اتاق سرور کفش و دستبند ضدالکتریسیتهٔ ساکن به کار ببرید.",
  },
  {
    name: "تعمیر دستگاه در محل", work_type: "repair", required_skills: ["سخت‌افزار"], est_work_minutes: 60,
    checklist: [
      { key: "diagnosis", label: "علت خرابی", type: "text", required: true },
      { key: "tested", label: "دستگاه پس از تعمیر آزمایش شد", type: "bool", required: true },
    ],
    parts: [], instructions: "عیب‌یابی، تعمیر یا تعویض قطعه و آزمون در حضور مشتری.", safety: null,
  },
];

export async function seedFsmDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "fsm_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= FSM_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "fsm_config", { config_key: "default" }, { name: "تنظیمات خدمات میدانی" }));
  for (const r of FSM_ROLES) {
    const role = await ensure(tx, sys, out, "role", { key: r.key }, r);
    // version 2: technicians' positions moved to the field group «dispatch» — the seeded dispatcher role keeps them
    const groups = Array.isArray(role.field_groups) ? (role.field_groups as string[]) : [];
    if (r.key === "dispatcher" && !groups.includes("dispatch")) await updateIn(tx, sys, "role", String(role.id), { field_groups: [...groups, "dispatch"] }, { trusted: true });
  }
  const group = await ensure(tx, sys, out, "group", { name: "توزیع خدمات میدانی" }, { types: ["assignment"], roles: ["dispatcher"], description: "توزیع و پیگیری کار در محل", active: true });
  for (const t of TEMPLATES) await ensure(tx, sys, out, "wo_task_template", { name: t.name }, { ...t, active: true });
  const calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  const office = (calendars.find((c) => c.is_default) ?? calendars[0])?.id ?? null;
  const defs: Row[] = [
    {
      table_key: "wo_task", name: "رسیدن به محل", type: "sla", target: "response", duration_mode: "priority", priority_field: "priority", durations: { "1": 2 * H, "2": 4 * H, "3": 8 * H, "4": 16 * H, "5": 24 * H },
      calendar_id: office, retroactive: true, retroactive_field: "created_at", warn_percents: [50, 75, 90], active: true, sort_order: 10,
      stop_condition: { or: [{ f: "arrived_at", op: "nempty" }, { f: "state", op: "in", v: ["on_site", "work_complete", "closed"] }] }, cancel_condition: { f: "state", op: "eq", v: "cancelled" },
      description: "از ثبت وظیفه تا رسیدن تکنسین به محل، جدا از توافق پرونده یا رخداد مادر",
    },
    {
      table_key: "work_order", name: "انجام دستور کار", type: "sla", target: "resolution", duration_mode: "priority", priority_field: "priority", durations: { "1": 8 * H, "2": 16 * H, "3": 24 * H, "4": 40 * H, "5": 80 * H },
      calendar_id: office, retroactive: true, retroactive_field: "opened_at", warn_percents: [75, 90], active: true, sort_order: 20,
      pause_condition: { f: "state", op: "in", v: ["awaiting_parts", "awaiting_customer"] }, stop_condition: { f: "state", op: "in", v: ["work_complete", "closed_complete", "closed_incomplete"] }, cancel_condition: { f: "state", op: "eq", v: "cancelled" },
      description: "رفع کار در محل؛ «منتظر قطعه» و «منتظر مشتری» زمان را نگه می‌دارند",
    },
  ];
  for (const d of defs) await ensure(tx, sys, out, "sla_definition", { table_key: d.table_key, name: d.name }, d);
  const rules: Row[] = [
    { table_key: "wo_task", name: "بازدید تازه به شما سپرده شد", event: "custom", custom_event: "task_dispatched", recipients: { event_users: true }, channels: ["in_app", "email", "sms"] },
    { table_key: "wo_task", name: "تکنسین بازدید را نپذیرفت", event: "state_changed", condition: { and: [{ f: "state", op: "changes_to", v: "pending_dispatch" }, { f: "state", op: "changes_from", v: "assigned" }] }, recipients: { assignment_group: true }, channels: ["in_app"] },
    { table_key: "wo_task", name: "بازدید منتظر قطعه است", event: "state_changed", condition: { f: "state", op: "changes_to", v: "pending_parts" }, recipients: { assignment_group: true }, channels: ["in_app"] },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
  for (const r of rules) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  if (tableDef("analytics_indicator")) {
    const shares = ["field_manager", "dispatcher", "tenant_admin"].map((id) => ({ kind: "role", id, right: "view" }));
    const kpis: Row[] = [
      { key: "fsm.first_time_fix", name: "حل در نخستین بازدید", practice: "other", unit: "percent", direction: "up", grain: "month", target: "85", warn: "75", crit: "60", description: "سهم دستورهای کار انجام‌شده‌ای که با یک بازدید حل شدند.", formula: "ftf / done * 100", parts: [{ name: "ftf", table: "work_order", fn: "count", date_field: "resolved_at", filter: { f: "first_time_fix", op: "eq", v: true } }, { name: "done", table: "work_order", fn: "count", date_field: "resolved_at", filter: { f: "resolved_at", op: "nempty" } }], breakdowns: ["territory_id", "work_type"] },
      { key: "fsm.travel_minutes", name: "میانگین زمان سفر", practice: "other", unit: "number", direction: "down", grain: "month", description: "میانگین دقیقه‌های سفر تا محل در بازدیدهای انجام‌شده.", formula: "travel", parts: [{ name: "travel", table: "wo_task", fn: "avg", field: "travel_minutes", date_field: "completed_at" }], breakdowns: ["territory_id"] },
    ];
    for (const k of kpis) await ensure(tx, sys, out, "analytics_indicator", { key: k.key }, { active: true, collect: true, certified: false, score_shares: shares, library_key: k.key, ...k });
  }
  await updateIn(tx, sys, "fsm_config", String(config.id), { seeded: FSM_SEED_VERSION, default_group_id: config.default_group_id ?? group.id }, { trusted: true });
  return out;
}
