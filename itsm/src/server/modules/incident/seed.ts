// Day-one defaults of incident management for an organisation (Persian, idempotent):
//   · the settings row (incident_config) — it also records that the defaults were added (`seeded`)
//   · working calendars when the organisation has none yet (the SLA service's seed adds the official holidays later)
//     and a 24 × 7 calendar for priority 1
//   · categories and subcategories (the `category` tree of the SLA service; it mirrors them into the choice lists)
//   · the ITIL priority matrix for incidents (editable in «ماتریس اولویت»)
//   · SLA definitions: response and resolution for P1 on the 24 × 7 calendar and P2–P5 on the office calendar, the
//     resolution clock paused while the incident waits on the requester, a supplier, a change or a problem
//   · two assignment groups («میز خدمت», «امنیت اطلاعات» — restricted) and their assignment rules
//   · notification rules (on top of the platform's built-ins: priority 1 created, high-priority assignment to a
//     group's manager, reopened, awaiting the requester, SLA warnings and breaches of P1/P2, major incidents, notes on
//     major incidents) and a UI policy (a declared major incident needs its manager)
//   · templates (incident models) and canned responses
// Every item is created only when no live row with its natural key exists; once the defaults were added, a second run
// adds nothing unless forced (an administrator's «افزودن پیش‌فرض‌ها» re-adds what was deleted).
import { DEFAULT_CATEGORIES, SLA_PAUSE_REASONS } from "@shared/tables/incident";
import { ITIL_MATRIX } from "@shared/sla/rules";
import { FULL_HOURS } from "@shared/sla/calendar";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const INCIDENT_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

const H = 3600;

/** Create `values` in `table` unless a live row matches `key`; returns the existing or new row. */
async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

/** The category tree of a table from the defaults (parents first). */
export async function seedCategories(tx: Tx, sys: Ctx, out: SeedCounts, table: string): Promise<void> {
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
    const parent = await ensure(tx, sys, out, "category", { table_key: table, value: c.value }, { name: c.label, sort_order: (i + 1) * 10 });
    for (const [j, [value, label]] of c.subs.entries()) {
      await ensure(tx, sys, out, "category", { table_key: table, value }, { name: label, parent_id: parent.id, sort_order: (j + 1) * 10 });
    }
  }
}

/** The organisation's office (default) and 24 × 7 calendars, created when missing. */
async function calendars(tx: Tx, sys: Ctx, out: SeedCounts): Promise<{ office: string | null; always: string | null }> {
  let rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!rows.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  const active = rows.filter((r) => r.active !== false);
  const office = active.find((r) => r.is_default) ?? null;
  const full = JSON.stringify(FULL_HOURS);
  let always = active.find((r) => r.name === "شبانه‌روزی") ?? active.find((r) => JSON.stringify(r.hours) === full) ?? null;
  if (!always) {
    always = await createIn(tx, sys, "calendar", { name: "شبانه‌روزی", timezone: orgTz(sys), hours: FULL_HOURS, holiday_sets: [], description: "همهٔ ساعت‌های همهٔ روزها، بدون تعطیلی" }, { trusted: true });
    out.created.calendar = (out.created.calendar ?? 0) + 1;
  }
  return { office: office?.id ?? null, always: always?.id ?? null };
}

const prio = (v: string | string[]): Cond => (Array.isArray(v) ? { f: "priority", op: "in", v } : { f: "priority", op: "eq", v });

/** The four SLA definitions of incidents (response/resolution × P1 24 × 7 / P2–P5 office hours). */
function slaDefinitions(office: string | null, always: string | null): Row[] {
  const canceled: Cond = { f: "state", op: "eq", v: "canceled" };
  const p1 = prio("1");
  const rest = prio(["2", "3", "4", "5"]);
  const responseStop: Cond = { or: [{ f: "state", op: "nin", v: ["new"] }, { f: "first_response_at", op: "nempty" }] };
  const resolutionStop: Cond = { f: "state", op: "in", v: ["resolved", "closed"] };
  const pause: Cond = { and: [{ f: "state", op: "eq", v: "on_hold" }, { f: "hold_reason", op: "in", v: SLA_PAUSE_REASONS }] };
  const reopened: Cond = { f: "reopen_count", op: "changed" };
  const common = { table_key: "incident", type: "sla", duration_mode: "priority", priority_field: "priority", retroactive: true, retroactive_field: "opened_at", warn_percents: [50, 75, 90] };
  return [
    {
      ...common, name: "پاسخ رخداد — اولویت ۱ (شبانه‌روزی)", target: "response", calendar_id: always, sort_order: 10,
      durations: { "1": 15 * 60 },
      start_condition: { and: [p1, { f: "state", op: "eq", v: "new" }] }, stop_condition: responseStop,
      cancel_condition: { or: [canceled, { f: "priority", op: "ne", v: "1" }] },
      description: "نخستین پاسخ یا شروع رسیدگی رخدادهای اولویت ۱ در همهٔ ساعت‌ها",
    },
    {
      ...common, name: "پاسخ رخداد", target: "response", calendar_id: office, sort_order: 20,
      durations: { "2": 30 * 60, "3": 2 * H, "4": 4 * H, "5": 8 * H },
      start_condition: { and: [rest, { f: "state", op: "eq", v: "new" }] }, stop_condition: responseStop,
      cancel_condition: { or: [canceled, { f: "priority", op: "eq", v: "1" }] },
      description: "نخستین پاسخ یا شروع رسیدگی در ساعات اداری",
    },
    {
      ...common, name: "حل رخداد — اولویت ۱ (شبانه‌روزی)", target: "resolution", calendar_id: always, sort_order: 30,
      durations: { "1": 4 * H },
      start_condition: p1, pause_condition: pause, stop_condition: resolutionStop, reset_condition: reopened,
      cancel_condition: { or: [canceled, { f: "priority", op: "ne", v: "1" }] },
      breach_actions: [{ type: "escalate" }],
      description: "حل رخدادهای اولویت ۱ در چهار ساعت، شبانه‌روزی",
    },
    {
      ...common, name: "حل رخداد", target: "resolution", calendar_id: office, sort_order: 40,
      durations: { "2": 8 * H, "3": 24 * H, "4": 40 * H, "5": 80 * H },
      start_condition: rest, pause_condition: pause, stop_condition: resolutionStop, reset_condition: reopened,
      cancel_condition: { or: [canceled, { f: "priority", op: "eq", v: "1" }] },
      breach_actions: [{ type: "escalate" }],
      description: "حل در ساعات اداری: اولویت ۲ یک روز، ۳ سه روز، ۴ پنج روز و ۵ ده روز کاری",
    },
  ];
}

/** Notification rules of incidents (additions to the platform's built-ins, never copies of them). */
function notificationRules(): Row[] {
  const high = prio(["1", "2"]);
  return [
    { name: "رخداد اولویت ۱ ثبت شد", event: "created", condition: prio("1"), recipients: { assignment_group: true, group_manager: true, roles: ["incident_manager"] }, channels: ["in_app", "email"] },
    { name: "رخداد مهم به گروه رسید (مدیر گروه)", event: "assigned", condition: { and: [high, { f: "assignment_group_id", op: "changed" }] }, recipients: { group_manager: true }, channels: ["in_app", "email"] },
    { name: "رخداد بازگشایی شد", event: "state_changed", condition: { and: [{ f: "state", op: "changes_from", v: "resolved" }, { f: "state", op: "changes_to", v: "in_progress" }] }, recipients: { assignee: true, group_manager: true }, channels: ["in_app", "email"] },
    { name: "منتظر پاسخ درخواست‌دهنده", event: "state_changed", condition: { and: [{ f: "state", op: "changes_to", v: "on_hold" }, { f: "hold_reason", op: "eq", v: "awaiting_caller" }] }, recipients: { requester: true }, channels: ["in_app", "email"] },
    { name: "نزدیک شدن به نقض توافق رخداد مهم", event: "sla_warning", condition: high, recipients: { assignment_group: true, group_manager: true }, channels: ["in_app"] },
    { name: "نقض توافق رخداد مهم", event: "sla_breach", condition: high, recipients: { group_manager: true, roles: ["incident_manager"] }, channels: ["in_app", "email"] },
    { name: "پیشنهاد رخداد عمده", event: "custom", custom_event: "incident.major_proposed", recipients: { roles: ["incident_manager"] }, channels: ["in_app", "email"] },
    { name: "اعلام رخداد عمده", event: "custom", custom_event: "incident.major_declared", recipients: { event_users: true, assignment_group: true, roles: ["incident_manager", "service_desk_manager"] }, channels: ["in_app", "email", "sms"], mandatory: true },
    { name: "رخداد عمده حل شد", event: "custom", custom_event: "incident.major_resolved", recipients: { event_users: true, assignment_group: true, roles: ["incident_manager"] }, channels: ["in_app", "email"] },
    { name: "یادداشت تازه روی رخداد عمده", event: "commented", entry_kinds: ["comment", "work_note"], condition: { f: "major_state", op: "eq", v: "accepted" }, recipients: { fields: ["mi_manager_id", "mi_comms_id"] }, channels: ["in_app"] },
  ].map((r) => ({ table_key: "incident", active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

const TEMPLATES: Row[] = [
  {
    name: "قطعی اینترنت ساختمان", short_description: "قطعی اینترنت در ساختمان", category: "network", subcategory: "network.internet", impact: "2", urgency: "1", channel: "phone",
    description: "- ساختمان و طبقه:\n- از چه زمانی:\n- چند نفر متأثرند:\n",
    tasks: [{ short_description: "بررسی تجهیزات شبکهٔ ساختمان", mandatory: true }, { short_description: "پیگیری با سرویس‌دهندهٔ اینترنت", mandatory: false }],
    description_note: "اگر چند ساختمان قطع است، رخداد عمده پیشنهاد دهید",
  },
  {
    name: "قفل شدن حساب کاربری", short_description: "حساب کاربری قفل شده است", category: "access", subcategory: "access.password", impact: "3", urgency: "2", channel: "phone",
    description: "- نام کاربری:\n- آخرین ورود موفق:\n", tasks: [],
    description_note: "پیش از بازکردن قفل، هویت تماس‌گیرنده را بررسی کنید",
  },
  {
    name: "چاپگر کار نمی‌کند", short_description: "چاپگر کار نمی‌کند", category: "hardware", subcategory: "hardware.printer", impact: "3", urgency: "3", channel: "portal",
    description: "- مدل و محل چاپگر:\n- پیام خطا:\n", tasks: [],
  },
];

const RESPONSES: Row[] = [
  { name: "دریافت شد", kind: "comment", body: "{{caller}} گرامی، درخواست شما با شمارهٔ {{number}} دریافت شد و {{assignee}} آن را پیگیری می‌کند." },
  { name: "اطلاعات بیشتر لازم است", kind: "comment", body: "{{caller}} گرامی، برای ادامهٔ رسیدگی به «{{title}}» لطفاً موارد زیر را بفرستید:\n\n- \n- " },
  { name: "حل شد؛ لطفاً تأیید کنید", kind: "comment", body: "{{caller}} گرامی، رخداد {{number}} حل شد. اگر مشکل برطرف شده است آن را تأیید کنید؛ در غیر این صورت همین‌جا پاسخ دهید تا دوباره بررسی شود." },
  { name: "پیگیری با تأمین‌کننده", kind: "both", body: "موضوع با تأمین‌کننده در میان گذاشته شد؛ پاسخ آن‌ها را در همین رخداد اطلاع می‌دهیم." },
];

/** Add the defaults inside `tx` as the system. */
export async function seedIncidentDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "incident_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= INCIDENT_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "incident_config", { config_key: "default" }, { name: "تنظیمات رخداد" }));

  const cals = await calendars(tx, sys, out);
  await seedCategories(tx, sys, out, "incident");
  await ensure(tx, sys, out, "priority_matrix", { table_key: "incident" }, { name: "ماتریس اولویت رخداد", cells: ITIL_MATRIX, description: "اثر × فوریت (ITIL)" });

  const desk = await ensure(tx, sys, out, "group", { name: "میز خدمت" }, { types: ["assignment"], description: "نخستین سطح پشتیبانی: ثبت، دسته‌بندی و حل رخدادها" });
  const security = await ensure(tx, sys, out, "group", { name: "امنیت اطلاعات" }, { types: ["assignment"], restricted: true, description: "رخدادهای امنیتی؛ فقط اعضا آن‌ها را می‌بینند" });
  await ensure(tx, sys, out, "assignment_rule", { table_key: "incident", name: "رخدادهای امنیتی ← امنیت اطلاعات" }, {
    condition: { or: [{ f: "category", op: "eq", v: "security" }, { f: "security_incident", op: "eq", v: true }] }, group_id: security.id, method: "least_loaded", sort_order: 10,
  });
  await ensure(tx, sys, out, "assignment_rule", { table_key: "incident", name: "رخدادهای دیگر ← میز خدمت" }, { group_id: desk.id, method: "least_loaded", sort_order: 100 });

  for (const d of slaDefinitions(cals.office, cals.always)) await ensure(tx, sys, out, "sla_definition", { table_key: "incident", name: d.name }, d);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: "incident", name: r.name }, r);
  await ensure(tx, sys, out, "ui_policy", { table_key: "incident", name: "رخداد عمده مدیر لازم دارد" }, {
    condition: { f: "major_state", op: "eq", v: "accepted" }, actions: [{ field: "mi_manager_id", mandatory: true }], message: "رخداد عمده: مدیر رخداد عمده را مشخص کنید", tone: "warning", sort_order: 100,
  });
  for (const [i, t] of TEMPLATES.entries()) await ensure(tx, sys, out, "incident_template", { name: t.name }, { ...t, sort_order: (i + 1) * 10 });
  for (const [i, r] of RESPONSES.entries()) await ensure(tx, sys, out, "incident_response", { name: r.name }, { ...r, sort_order: (i + 1) * 10 });

  const patch: Row = { seeded: INCIDENT_SEED_VERSION };
  if (!config.security_group_id) patch.security_group_id = security.id;
  await updateIn(tx, sys, "incident_config", config.id, patch, { trusted: true });
  return out;
}

export { ensure as ensureRow };
