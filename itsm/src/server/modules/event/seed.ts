// Day-one defaults of event management and on-call (Persian, idempotent):
//   · the settings row (event_config) — it also records that the defaults were added (`seeded`)
//   · the team «پشتیبانی شبکه» when missing, its on-call schedule «کشیک پشتیبانی شبکه» (a weekly rotation of the
//     team's members from Saturday 08:00 and a night/holiday layer, when the team has members), its escalation
//     policy (on-call → the team's manager → the whole team, repeated once) and a route for network alerts
//   · sample sources (Alertmanager, Zabbix with its severity words, generic JSON) — without keys: «ساخت کلید» hands
//     one out
//   · processing rules (test events ignored, «unreachable» made critical, a disk-space threshold, network devices
//     tagged and routed), correlation rules (one CI, CMDB topology, one service), alert → incident rules (critical at
//     once, major after 15 minutes without an answer)
//   · the severity matrix (the `alert` table's priority matrix: impact × severity), an acknowledgement SLA per
//     priority on the 24 × 7 calendar, notification rules (a critical alert, a correlated group) and two custom roles
//     for operations («مهندس عملیات و کشیک», «مدیر عملیات و کشیک») that administrators may give
// Every item is created only when no live row with its natural key exists; once seeded, a second run adds nothing
// unless forced.
import { FULL_HOURS } from "@shared/sla/calendar";
import { SEVERITY_MATRIX } from "@shared/event/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, updateIn } from "../../engine";
import { localInstant } from "@shared/sla/calendar";
import { localDate } from "@shared/model/jalali-buckets";
import { addDays, weekday } from "@shared/jalali";
import { groupMembers } from "../notify/recipients";
import { seedCalendarsIn } from "../sla";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const EVENT_SEED_VERSION = 1;
export const NETWORK_TEAM = "پشتیبانی شبکه";

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

/** The last Saturday 08:00 (Tehran week) before now, in the organisation's zone. */
/** The start of the seeded weekly rotation: the last Saturday 08:00 (local) that has already passed. On a Saturday
 * before 08:00 this week's hand-over is still ahead, so the rotation starts a week earlier; otherwise a schedule seeded
 * then (CI on Saturday 06:58 Tehran time) would have nobody on call until 08:00. */
export function lastSaturday(tz: string, now = Date.now()): string {
  const today = localDate(now, tz);
  const sat = addDays(today, -weekday(today));
  let start = localInstant(sat, 8 * 60, tz);
  if (start > now) start = localInstant(addDays(sat, -7), 8 * 60, tz);
  return new Date(start).toISOString();
}

const grant = (read: string, write = "none", extra: Record<string, unknown> = {}) => ({ read, write, delete: "none", create: write !== "none", approve: false, admin: false, ...extra });

export async function seedEventDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfgRow] = await liveRows(tx, sys, "event_config", null, { order: "t.created_at", limit: 1 });
  if (cfgRow && Number(cfgRow.seeded ?? 0) >= EVENT_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfgRow ?? (await ensure(tx, sys, out, "event_config", { config_key: "default" }, { name: "تنظیمات رویداد" }));
  const tz = orgTz(sys);

  // calendars (24 × 7 for the acknowledgement SLA)
  let calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!calendars.length) {
    await seedCalendarsIn(tx, sys, { years: [] });
    calendars = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  const office = calendars.find((c) => c.is_default && c.active !== false) ?? null;
  const full = JSON.stringify(FULL_HOURS);
  const always = calendars.find((c) => c.active !== false && JSON.stringify(c.hours) === full) ?? (await ensure(tx, sys, out, "calendar", { name: "شبانه‌روزی" }, { timezone: tz, hours: FULL_HOURS, holiday_sets: [], description: "همهٔ ساعت‌های همهٔ روزها، بدون تعطیلی" }));

  // the network team, its schedule, policy and route
  const team = await ensure(tx, sys, out, "group", { name: NETWORK_TEAM }, { types: ["assignment", "oncall"], description: "پایش و پشتیبانی تجهیزات و ارتباطات شبکه" });
  const schedule = await ensure(tx, sys, out, "oncall_schedule", { name: "کشیک پشتیبانی شبکه" }, { group_id: team.id, calendar_id: office?.id ?? null, timezone: tz, description: "کشیک هفتگی از شنبه ساعت ۸ و لایهٔ شب‌ها، جمعه‌ها و تعطیلات رسمی" });
  const members = await groupMembers(sys, [String(team.id)], tx);
  if (members.length) {
    await ensure(tx, sys, out, "oncall_rotation", { schedule_id: schedule.id, name: "نوبت هفتگی" }, { layer: 1, rotation_type: "weekly", start_at: lastSaturday(tz), members, restriction: "none" });
    if (members.length > 1) await ensure(tx, sys, out, "oncall_rotation", { schedule_id: schedule.id, name: "شب‌ها و تعطیلات" }, { layer: 2, rotation_type: "daily", start_at: lastSaturday(tz), members: [...members.slice(1), members[0]], restriction: "off_hours" });
  }
  const policy = await ensure(tx, sys, out, "escalation_policy", { name: "ارتقای پشتیبانی شبکه" }, { group_id: team.id, is_default: true, repeat_times: 1, description: "کشیک ← مدیر تیم پس از ۱۰ دقیقه ← همهٔ تیم پس از ۲۰ دقیقه" });
  await ensure(tx, sys, out, "escalation_level", { policy_id: policy.id, level: 1 }, { delay_minutes: 0, target: "oncall", schedule_id: schedule.id, channels: ["in_app", "email", "sms"], description: "کشیک برنامه" });
  await ensure(tx, sys, out, "escalation_level", { policy_id: policy.id, level: 2 }, { delay_minutes: 10, target: "manager", target_group_id: team.id, channels: ["in_app", "email", "sms"], description: "مدیر تیم" });
  await ensure(tx, sys, out, "escalation_level", { policy_id: policy.id, level: 3 }, { delay_minutes: 20, target: "group", target_group_id: team.id, channels: ["in_app", "email"], description: "همهٔ اعضای تیم" });
  await ensure(tx, sys, out, "alert_route", { name: "هشدارهای شبکه" }, { sort_order: 10, condition: { or: [{ f: "tags", op: "contains", v: "شبکه" }, { f: "assignment_group_id", op: "eq", v: team.id }] }, time: "any", assignment_group_id: team.id, escalation_policy_id: policy.id, description: "هشدارهای تجهیزات شبکه به کشیک پشتیبانی شبکه می‌رسد" });
  if (!config.default_policy_id) await updateIn(tx, sys, "event_config", String(config.id), { default_policy_id: policy.id }, { trusted: true });

  // sources (no keys yet)
  await ensure(tx, sys, out, "event_source", { name: "Prometheus Alertmanager" }, { kind: "alertmanager", assignment_group_id: team.id, default_severity: "minor", severity_map: { critical: "critical", error: "major", warning: "warning", info: "info" }, description: "receivers.webhook_configs: url = نشانی دریافت همین منبع" });
  await ensure(tx, sys, out, "event_source", { name: "Zabbix" }, { kind: "zabbix", default_severity: "minor", severity_map: { disaster: "critical", high: "major", average: "minor", warning: "warning", information: "info", "not classified": "info" }, description: "رسانهٔ وب‌هوک Zabbix با پارامترهای event_id، trigger_id، host، trigger_name، severity، status" });
  await ensure(tx, sys, out, "event_source", { name: "وب‌هوک عمومی" }, { kind: "generic", default_severity: "minor", mapping: { message: "$.title", node: "$.host", severity: "$.severity", status: "$.status" }, description: "برای ابزارهای دیگر: نگاشت فیلدها را با مسیر JSON تنظیم کنید" });

  // processing rules
  await ensure(tx, sys, out, "event_rule", { name: "نادیده گرفتن رویدادهای آزمایشی" }, { action: "ignore", sort_order: 10, condition: { or: [{ f: "message", op: "contains", v: "[TEST]" }, { f: "tags", op: "contains", v: "test" }] }, description: "رویدادهایی که برای آزمودن اتصال فرستاده می‌شوند هشدار نمی‌سازند" });
  await ensure(tx, sys, out, "event_rule", { name: "قطع دسترسی بحرانی است" }, { action: "set", sort_order: 20, pattern: "(unreachable|is down|host down|قطع شد)", set_severity: "critical", description: "میزبان یا سرویس در دسترس نیست" });
  await ensure(tx, sys, out, "event_rule", { name: "آستانهٔ فضای دیسک" }, { action: "threshold", sort_order: 30, condition: { f: "metric", op: "contains", v: "disk" }, threshold_count: 3, threshold_minutes: 10, description: "هشدار فضای دیسک پس از سه رویداد در ده دقیقه" });
  await ensure(tx, sys, out, "event_rule", { name: "تجهیزات شبکه" }, { action: "set", sort_order: 40, condition: { or: [{ f: "node", op: "starts", v: "sw-" }, { f: "node", op: "starts", v: "rtr-" }, { f: "node", op: "starts", v: "fw-" }] }, set_group_id: team.id, add_tags: ["شبکه"], description: "سوییچ‌ها، مسیریاب‌ها و دیوارهای آتش به تیم شبکه" });

  // correlation and incidents
  await ensure(tx, sys, out, "correlation_rule", { name: "وابستگی در CMDB" }, { kind: "topology", sort_order: 10, window_minutes: 10, max_hops: 3, description: "هشدارهای پیکربندی‌های وابسته با پیکربندی بالادست یک گروه می‌شوند" });
  await ensure(tx, sys, out, "correlation_rule", { name: "هشدارهای یک پیکربندی" }, { kind: "ci", sort_order: 20, window_minutes: 15, description: "چند هشدار هم‌زمان روی یک پیکربندی یا میزبان" });
  await ensure(tx, sys, out, "correlation_rule", { name: "هشدارهای یک خدمت" }, { kind: "service", sort_order: 30, window_minutes: 15, description: "هشدارهای هم‌زمان پیکربندی‌های یک خدمت" });
  await ensure(tx, sys, out, "alert_incident_rule", { name: "هشدار بحرانی ← رخداد" }, { sort_order: 10, min_severity: "critical", delay_minutes: 0, per_group: true, auto_resolve: true, description: "هر گروه هم‌بستهٔ بحرانی یک رخداد" });
  await ensure(tx, sys, out, "alert_incident_rule", { name: "هشدار شدید بی‌پاسخ ← رخداد" }, { sort_order: 20, min_severity: "major", delay_minutes: 15, per_group: true, auto_resolve: true, description: "اگر هشدار شدید پانزده دقیقه تأیید نشود" });

  // the severity matrix (impact × severity → priority)
  await ensure(tx, sys, out, "priority_matrix", { table_key: "alert" }, { name: "ماتریس شدت هشدار", impact_field: "impact", urgency_field: "severity", priority_field: "priority", cells: SEVERITY_MATRIX, description: "اولویت هشدار از اثر (اهمیت پیکربندی) و شدت" });

  // acknowledgement SLA (MTTA target) on the 24 × 7 calendar
  await ensure(tx, sys, out, "sla_definition", { table_key: "alert", name: "زمان تأیید هشدار" }, {
    type: "sla", target: "response", calendar_id: always?.id ?? null, duration_mode: "priority", priority_field: "priority",
    durations: { "1": 5 * 60, "2": 15 * 60, "3": 30 * 60, "4": 60 * 60, "5": 4 * 3600 },
    start_condition: { f: "state", op: "eq", v: "open" },
    stop_condition: { f: "state", op: "nin", v: ["open", "flapping"] },
    cancel_condition: { f: "state", op: "in", v: ["suppressed", "maintenance"] },
    retroactive: true, retroactive_field: "opened_at", warn_percents: [50, 80], sort_order: 10,
    description: "تأیید هشدار باز: اولویت ۱ پنج دقیقه، ۲ پانزده دقیقه، ۳ نیم ساعت، ۴ یک ساعت، ۵ چهار ساعت؛ شبانه‌روزی",
  });

  // notifications
  await ensure(tx, sys, out, "notification_rule", { name: "هشدار بحرانی باز شد" }, { table_key: "alert", event: "created", condition: { f: "severity", op: "eq", v: "critical" }, recipients: { assignment_group: true, oncall: true }, channels: ["in_app", "email"], description: "به تیم و کشیک آن" });
  await ensure(tx, sys, out, "notification_rule", { name: "گروه هم‌بستهٔ تازه" }, { table_key: "alert_group", event: "created", recipients: { assignment_group: true }, channels: ["in_app"], description: "چند هشدار هم‌زمان یک گروه شدند" });

  // roles for operations (custom roles; administrators give them)
  await ensure(tx, sys, out, "role", { key: "ops_engineer" }, {
    name: "مهندس عملیات و کشیک", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "کار روی هشدارها و گروه‌های هم‌بستهٔ تیم خود، جایگزینی کشیک و فراخوان‌ها؛ دیدن تداوم",
    grants: { event: grant("all", "group", { create: false }), oncall: grant("all", "group", { create: false }), continuity: grant("all") },
    field_groups: ["internal", "personal"], contains: ["agent"],
  });
  await ensure(tx, sys, out, "role", { key: "ops_manager" }, {
    name: "مدیر عملیات و کشیک", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "تعریف منبع‌ها، قاعده‌ها، مسیرها، برنامه‌های کشیک و سیاست‌های ارتقا؛ همهٔ هشدارها",
    grants: { event: grant("all", "all", { delete: "all", approve: true, admin: true }), oncall: grant("all", "all", { delete: "all", approve: true, admin: true }), continuity: grant("all", "group") },
    field_groups: ["internal", "personal"], contains: ["ops_engineer"],
  });

  await updateIn(tx, sys, "event_config", String(config.id), { seeded: EVENT_SEED_VERSION }, { trusted: true });
  return out;
}
