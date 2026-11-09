// Day-one defaults of workforce and agent experience (Persian, idempotent, as the system):
//   · the settings row (wfm_config) — it also records that the defaults were added (`seeded`)
//   · the organisation roles «مدیر نیروی کار» (workforce_manager: every team, individual numbers with the «hr» field
//     group) and «سرپرست تیم (نیروی کار)» (workforce_lead: their teams' rosters, time off and skills; no «hr»)
//   · the IT skills catalogue (with the keywords skill inference and routing match), and skill needs for the IT teams
//     the other modules seed (when they exist)
//   · shift patterns on working calendars of the SLA service with the official Iranian holidays: office day with a
//     Thursday half day, office day without Thursday, evening and night shifts — Friday off in every one
//   · the approval rule of time off (the person's manager or their team's lead), notification rules (decided time
//     off, expiring certificates, suggested skills, kudos), the SLA of deciding time off and the analytics indicators
import { tableDef } from "@shared/tables";
import type { HoursJson } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, savepoint, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { eqAll, liveRows, sysOf, workforceConfig, type Row } from "./common";

/** 1: roles, skills, shift patterns, coverage, rules, SLA, indicators. */
export const WORKFORCE_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Row, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

const H = 3600;

export const WORKFORCE_ROLES: Row[] = [
  {
    key: "workforce_manager", name: "مدیر نیروی کار", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "برنامهٔ شیفت، مرخصی، مهارت‌ها و ظرفیت همهٔ تیم‌ها؛ کارنامهٔ فردی کارشناسان با گروه فیلد «منابع انسانی»",
    grants: { workforce: { read: "all", create: true, write: "all", delete: "all", approve: true, admin: true }, reports: { read: "all" } },
    field_groups: ["hr", "internal", "personal"], contains: ["agent"],
  },
  {
    key: "workforce_lead", name: "سرپرست تیم (نیروی کار)", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "برنامهٔ شیفت، تأیید مرخصی، تأیید مهارت‌ها و ظرفیت تیم‌های خود؛ کارنامهٔ تیم بدون عددهای فردی",
    grants: { workforce: { read: "group", create: true, write: "group", approve: true } },
    field_groups: ["internal", "personal"], contains: ["agent"],
  },
];

/** The IT skills catalogue: [name, category, SFIA code, keywords]. */
export const IT_SKILLS: [string, string, string | null, string[]][] = [
  ["پشتیبانی کاربران نهایی", "technical", "USUP", ["رایانه", "لپ‌تاپ", "چاپگر", "نرم‌افزار", "نصب", "ویندوز", "کاربر"]],
  ["ویندوز کلاینت", "technical", null, ["ویندوز", "windows", "درایور", "بوت"]],
  ["سرورهای ویندوز", "technical", "ITOP", ["سرور", "server", "iis", "dns", "dhcp"]],
  ["لینوکس", "technical", "ITOP", ["لینوکس", "linux", "ubuntu", "centos"]],
  ["شبکه", "technical", "NTDS", ["شبکه", "network", "سوئیچ", "روتر", "wifi", "وای‌فای", "اینترنت", "اتصال"]],
  ["VPN و دسترسی از راه دور", "technical", null, ["vpn", "ریموت", "دورکاری", "فورتی"]],
  ["اکتیو دایرکتوری و هویت", "technical", "IAMT", ["اکتیو", "active", "directory", "گذرواژه", "رمز", "حساب", "دسترسی", "قفل"]],
  ["ایمیل و Exchange", "application", null, ["ایمیل", "email", "exchange", "outlook", "صندوق"]],
  ["مایکروسافت ۳۶۵", "application", null, ["office", "آفیس", "teams", "تیمز", "onedrive", "sharepoint", "۳۶۵"]],
  ["پایگاه داده", "technical", "DBAD", ["پایگاه", "database", "sql", "اوراکل", "oracle", "postgres"]],
  ["مجازی‌سازی", "technical", null, ["vmware", "مجازی", "hyper", "ماشین"]],
  ["پشتیبان‌گیری و بازیابی", "technical", null, ["پشتیبان", "backup", "بازیابی", "restore"]],
  ["امنیت اطلاعات", "security", "SCTY", ["امنیت", "ویروس", "بدافزار", "فیشینگ", "نفوذ", "security"]],
  ["تلفن و ارتباطات", "technical", null, ["تلفن", "voip", "داخلی", "ویپ"]],
  ["سامانه‌های مالی و اداری", "application", null, ["مالی", "حسابداری", "حقوق", "اتوماسیون", "اداری"]],
  ["ITIL و مدیریت خدمت", "process", "ITSP", ["itil", "فرایند", "تغییر", "مشکل"]],
  ["ارتباط با مشتری", "soft", "RLMT", ["شکایت", "رضایت", "پیگیری", "تماس"]],
  ["زبان انگلیسی", "language", null, []],
];

/** Skill needs of the IT teams other modules seed: [group name, skill, min level, min people, critical]. */
export const IT_COVERAGE: [string, string, number, number, boolean][] = [
  ["میز خدمت", "پشتیبانی کاربران نهایی", 3, 2, true],
  ["میز خدمت", "ارتباط با مشتری", 3, 2, false],
  ["میز خدمت", "اکتیو دایرکتوری و هویت", 2, 2, false],
  ["پشتیبانی کاربران", "پشتیبانی کاربران نهایی", 3, 2, true],
  ["پشتیبانی کاربران", "مایکروسافت ۳۶۵", 3, 1, false],
  ["شبکه و زیرساخت", "شبکه", 3, 2, true],
  ["شبکه و زیرساخت", "سرورهای ویندوز", 3, 2, true],
  ["شبکه و زیرساخت", "VPN و دسترسی از راه دور", 3, 1, false],
  ["هویت و دسترسی", "اکتیو دایرکتوری و هویت", 3, 2, true],
  ["امنیت اطلاعات", "امنیت اطلاعات", 4, 2, true],
];

const day = (from: string, to: string): [string, string][] => [[from, to]];
const OFF: [string, string][] = [];

/** Shift patterns: [name, code, colour, kind, hours (Saturday first), description]. */
export const SHIFT_PATTERNS: [string, string, string, string, HoursJson, string][] = [
  ["صبح اداری با پنجشنبهٔ نیمه‌وقت", "ص", "gold", "day", [day("08:00", "16:00"), day("08:00", "16:00"), day("08:00", "16:00"), day("08:00", "16:00"), day("08:00", "16:00"), day("08:00", "12:00"), OFF], "شنبه تا چهارشنبه ۸ تا ۱۶، پنجشنبه ۸ تا ۱۲، جمعه و تعطیلات رسمی تعطیل"],
  ["صبح اداری (پنجشنبه تعطیل)", "ص۵", "orange", "day", [day("07:30", "15:30"), day("07:30", "15:30"), day("07:30", "15:30"), day("07:30", "15:30"), day("07:30", "15:30"), OFF, OFF], "شنبه تا چهارشنبه ۷:۳۰ تا ۱۵:۳۰؛ پنجشنبه، جمعه و تعطیلات رسمی تعطیل"],
  ["عصر", "ع", "indigo", "evening", [day("14:00", "22:00"), day("14:00", "22:00"), day("14:00", "22:00"), day("14:00", "22:00"), day("14:00", "22:00"), day("12:00", "18:00"), OFF], "شنبه تا چهارشنبه ۱۴ تا ۲۲، پنجشنبه ۱۲ تا ۱۸، جمعه تعطیل"],
  ["شب", "ش", "purple", "night", [day("22:00", "06:00"), day("22:00", "06:00"), day("22:00", "06:00"), day("22:00", "06:00"), day("22:00", "06:00"), day("22:00", "06:00"), OFF], "شنبه تا پنجشنبه از ۲۲ تا ۶ صبح روز بعد؛ شب جمعه تعطیل"],
];

export function approvalRules(): Row[] {
  return [{
    table_key: "wfm_absence", name: "تأیید مرخصی ← مدیر مستقیم یا سرپرست تیم", sort_order: 10, mode: "sequential", expire_after: 5 * 24 * H, remind_every: 24 * H, expire_action: "reject",
    condition: { f: "state", op: "eq", v: "requested" }, active: true, allow_self_approval: false,
    levels: [{ name: "مدیر یا سرپرست", sources: [{ kind: "manager" }, { kind: "owner", of: "team_lead" }], rule: "any" }],
    description: "مدیر مستقیم فرد یا سرپرست تیمش مرخصی را تأیید می‌کند؛ تأیید، مرخصی را «تأییدشده» و رد، «ردشده» می‌کند.",
  }];
}

export function notificationRules(): Row[] {
  const custom = (custom_event: string) => ({ event: "custom", custom_event });
  return [
    { table_key: "wfm_absence", name: "مرخصی شما تأیید شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "approved" }, recipients: { fields: ["user_id", "delegate_id"] }, channels: ["in_app", "email"] },
    { table_key: "wfm_absence", name: "مرخصی شما رد شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "rejected" }, recipients: { fields: ["user_id"] }, channels: ["in_app", "email"] },
    { table_key: "wfm_certification", name: "گواهینامهٔ شما رو به انقضا است", ...custom("wfm.cert_expiring"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "wfm_person_skill", name: "مهارت‌هایی از کارهای شما پیشنهاد شد", ...custom("wfm.skills_suggested"), recipients: { event_users: true }, channels: ["in_app"] },
    { table_key: "wfm_kudos", name: "همکاری از شما قدردانی کرد", event: "created", recipients: { fields: ["to_id"] }, channels: ["in_app"] },
  ];
}

export function indicators(): Row[] {
  const readers = ["workforce_manager", "tenant_admin"].map((id) => ({ kind: "role", id, right: "view" }));
  return [
    { key: "workforce.skill_verification", name: "سهم مهارت‌های تأییدشده", practice: "other", unit: "percent", direction: "up", grain: "month", formula: "verified / all * 100", parts: [{ name: "verified", table: "wfm_person_skill", fn: "count", filter: { and: [{ f: "status", op: "eq", v: "active" }, { f: "verified", op: "eq", v: true }] } }, { name: "all", table: "wfm_person_skill", fn: "count", filter: { f: "status", op: "eq", v: "active" } }], target: 80, warn: 60, crit: 40, description: "سهم مهارت‌های پذیرفتهٔ افراد که سرپرست یا مدیر تأییدشان کرده است." },
    { key: "workforce.cert_expiring", name: "گواهینامه‌های رو به انقضا (۳۰ روز آینده)", practice: "other", unit: "count", direction: "down", grain: "day", formula: "expiring", parts: [{ name: "expiring", table: "wfm_certification", fn: "count", filter: { f: "expires_at", op: "relative", v: { unit: "day", from: 0, to: 30 } } }], description: "گواهینامه‌هایی که در سی روز آینده منقضی می‌شوند." },
    { key: "workforce.absence_days", name: "روزهای مرخصی تأییدشده", practice: "other", unit: "number", direction: "none", grain: "month", formula: "days", parts: [{ name: "days", table: "wfm_absence", fn: "sum", field: "days", date_field: "start_at", filter: { f: "state", op: "in", v: ["approved", "ended"] } }], description: "جمع روزهای کاری مرخصی‌های تأییدشده که در دوره آغاز شدند." },
    { key: "workforce.kudos", name: "قدردانی‌های همکاران", practice: "other", unit: "count", direction: "up", grain: "month", formula: "kudos", parts: [{ name: "kudos", table: "wfm_kudos", fn: "count", date_field: "created_at" }], description: "قدردانی‌هایی که کارکنان در دوره از یکدیگر کردند." },
  ].map((i) => ({ ...i, owner_id: null, collect: true, score_shares: readers, library_key: i.key }));
}

/** Add the defaults inside `tx` as the system. */
export async function seedWorkforceDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const cfg = await workforceConfig(tx, sys);
  if (cfg.seeded >= WORKFORCE_SEED_VERSION && !opts.force) return { skipped: true, created: {} };
  const config = cfg.id ? { id: cfg.id } : await ensure(tx, sys, out, "wfm_config", { config_key: "default" }, { name: "تنظیمات نیروی کار" });

  for (const r of WORKFORCE_ROLES) await ensure(tx, sys, out, "role", { key: r.key }, r);

  const skills = new Map<string, string>();
  for (const [name, category, sfia, keywords] of IT_SKILLS) {
    const s = await ensure(tx, sys, out, "wfm_skill", { name }, { category, sfia_code: sfia, keywords, routing: category !== "language", active: true });
    skills.set(name, String(s.id));
  }

  const groups = new Map((await liveRows(tx, sys, "group", null, { limit: 2000 })).map((g) => [String(g.name), String(g.id)]));
  for (const [group, skill, level, people, critical] of IT_COVERAGE) {
    const g = groups.get(group);
    const s = skills.get(skill);
    if (g && s) await ensure(tx, sys, out, "wfm_coverage", { group_id: g, skill_id: s }, { min_level: level, min_people: people, critical });
  }
  const desk = groups.get("میز خدمت");
  if (desk) await savepoint(tx, () => ensure(tx, sys, out, "wfm_capacity", { group_id: desk }, { max_open: 10, daily_throughput: "12", occupancy: "80", shrinkage: "30", min_staff: 2 })).catch(() => undefined);

  // shift patterns on working calendars (the SLA service's) with the official holidays
  if (!(await liveRows(tx, sys, "calendar", null, { limit: 1 })).length) await seedCalendarsIn(tx, sys, { years: [] });
  for (const [name, code, color, kind, hours, description] of SHIFT_PATTERNS) {
    const cal = await ensure(tx, sys, out, "calendar", { name: `شیفت ${name}` }, { timezone: "Asia/Tehran", hours, holiday_sets: ["ir", "org"], is_default: false, active: true });
    await ensure(tx, sys, out, "wfm_shift_pattern", { name }, { code, color, kind, calendar_id: cal.id, description, active: true });
  }

  for (const r of approvalRules()) await ensure(tx, sys, out, "approval_rule", { table_key: r.table_key, name: r.name }, r);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);

  const calendars = await liveRows(tx, sys, "calendar", { f: "is_default", op: "eq", v: true }, { limit: 1 });
  await ensure(tx, sys, out, "sla_definition", { table_key: "wfm_absence", name: "تصمیم دربارهٔ مرخصی" }, {
    type: "ola", target: "response", duration_mode: "fixed", duration: 16 * H, calendar_id: calendars[0]?.id ?? null, sort_order: 10, warn_percents: [50, 80],
    start_condition: { f: "state", op: "eq", v: "requested" },
    stop_condition: { f: "state", op: "ne", v: "requested" },
    breach_actions: [{ type: "notify", roles: ["workforce_manager"] }],
    description: "هر درخواست مرخصی در دو روز کاری (۱۶ ساعت کاری) تأیید یا رد شود.",
  });

  if (tableDef("analytics_indicator")) {
    for (const i of indicators()) await savepoint(tx, () => ensure(tx, sys, out, "analytics_indicator", { key: i.key }, i)).catch(() => undefined);
  }

  await updateIn(tx, sys, "wfm_config", String(config.id), { seeded: WORKFORCE_SEED_VERSION }, { trusted: true });
  return out;
}
