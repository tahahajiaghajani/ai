// Day-one defaults of release and deployment management (Persian, idempotent, as the system):
//   · the settings row (release_config) with the DORA definitions and thresholds; it records the seed (`seeded`)
//   · the group «مدیران انتشار» (role release_manager): go/no-go, waivers, deployment approvals; the organisation role
//     «مهندس انتشار» (release_engineer): works the releases, deployments and changes of their groups (agents only read
//     releases)
//   · the readiness check library (automatic rules and manual checks) and the release policy of each type (major,
//     minor, patch, emergency: decision required, early life support, lead time, the emergency procedure)
//   · release templates — the readiness checklist template of a major release with its phase tasks, a minor release
//     and an emergency fix
//   · the environment registry: development, test, staging and production (protected by an authorized change)
//   · release windows: the weekly release train, the monthly train of major releases, the release freeze before Nowruz
//   · approval rules on the approvals service: go/no-go of major and emergency releases (release managers, then the
//     service owner), deployments to protected environments (release managers)
//   · notification rules (decision recorded, deployed to production, early life support ended, deployment failed,
//     readiness overdue) and the SLA «زمان تصمیم اجرای انتشار» (two working days in readiness)
//   · a template flow (inactive until published): a failed production deployment tells its release manager and
//     implementer at once
// Every item is created only when no live row with its natural key exists; a second run adds nothing unless forced.
import { currentJalaliYear, fromJalali, todayISO } from "@shared/jalali";
import { localInstant } from "@shared/sla/calendar";
import { DORA_DEFINITIONS } from "@shared/devops/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, savepoint, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const RELEASE_SEED_VERSION = 1;
export const RELEASE_MANAGERS_GROUP = "مدیران انتشار";

/** The organisation role of release engineers (a role row; the built-in roles stay in code). */
export const RELEASE_ENGINEER_ROLE: Row = {
  key: "release_engineer", name: "مهندس انتشار", persona: "agent", workspaces: "member", domains: "own", active: true,
  description: "کار روی انتشارها، استقرارها و تغییرهای گروه‌های خود؛ دیدن همهٔ انتشارها، پیکربندی و دانش",
  grants: { release: { read: "all", create: true, write: "group" }, change: { read: "all", create: true, write: "group" } },
  field_groups: ["internal", "personal"], contains: ["agent"],
};

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

const H = 3600;

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

/** The readiness check library (REL-013). */
export const SEED_CHECKS: Row[] = [
  { key: "tasks_done", name: "کارهای الزامی انتشار انجام شده است", rule: "tasks_done", phase: "readiness", blocking: true, sort_order: 10, description: "همهٔ کارهای الزامی انتشار در وضعیت «انجام شد» یا «لغوشده» باشند." },
  { key: "changes_authorized", name: "تغییرهای انتشار مجاز شده‌اند", rule: "changes_authorized", phase: "readiness", blocking: true, sort_order: 20, description: "هر درخواست تغییرِ انتشار دست‌کم «زمان‌بندی‌شده» باشد." },
  { key: "test_deploy_ok", name: "استقرار موفق در محیط آزمون یا پیش‌تولید", rule: "test_deploy_ok", phase: "test", blocking: true, sort_order: 30, description: "همین نسخه پیش از عملیاتی شدن در آزمون، UAT یا پیش‌تولید با موفقیت مستقر شده باشد." },
  { key: "no_critical_defects", name: "نقص بحرانی یا مهم باز نمانده است", rule: "no_open_critical_defects", phase: "test", blocking: true, sort_order: 40, description: "نقص‌های بحرانی و مهمِ انتشار رفع، تأیید یا آگاهانه به تعویق افتاده باشند." },
  { key: "uat_signoff", name: "آزمون پذیرش کاربر (UAT) امضا شد", rule: "manual", phase: "test", blocking: true, sort_order: 50, types: ["major", "minor"], description: "نمایندهٔ کسب‌وکار نتیجهٔ آزمون پذیرش را تأیید کرده است؛ صورت‌جلسه را پیوست کنید." },
  { key: "rollback_plan", name: "برنامهٔ بازگشت نوشته و آزموده شده است", rule: "rollback_plan", phase: "readiness", blocking: true, sort_order: 60, description: "گام‌های بازگشت، زمان لازم و نشانه‌های تصمیم به بازگشت روشن باشد." },
  { key: "release_notes", name: "یادداشت انتشار آماده است", rule: "release_notes", phase: "communication", blocking: false, sort_order: 70, description: "یادداشت انتشار برای کاربران یا عملیات نوشته یا منتشر شده باشد." },
  { key: "no_freeze", name: "پنجرهٔ انتشار با انجماد یا ممنوعیت تداخل ندارد", rule: "no_freeze", phase: "readiness", blocking: true, sort_order: 80, description: "بازهٔ انتشار با دوره‌های توقف انتشار و انجماد یا ممنوعیت تغییرات هم‌پوشانی نداشته باشد." },
  { key: "support_ready", name: "پشتیبانی و میز خدمت آماده است", rule: "manual", phase: "training", blocking: false, sort_order: 90, types: ["major"], description: "دانش، آموزش میز خدمت و برنامهٔ پشتیبانی آغازین آماده است (پذیرش عملیاتی)." },
  { key: "approvals", name: "تأییدهای انتشار کامل است", rule: "approvals_complete", phase: "readiness", blocking: true, sort_order: 100, description: "گردش تأیید انتشار (اگر لازم بوده) بسته شده باشد." },
];

/** The release policy of each type (REL-002). */
export const SEED_POLICIES: Row[] = [
  { name: "خط‌مشی انتشار عمده", type: "major", cadence: "قطار ماهانه (آخرین روز هر ماه)", go_no_go_required: true, els_days: 14, min_lead_days: 14, transition_package: true, procedure: "۱. برنامه‌ریزی و تعیین دامنه\n۲. ساخت و آزمون در محیط آزمون و پیش‌تولید\n۳. آزمون پذیرش کاربر\n۴. بررسی آمادگی و جلسهٔ تصمیم اجرا (Go/No-Go)\n۵. استقرار در پنجرهٔ انتشار\n۶. پشتیبانی آغازین دو هفته‌ای و بازبینی" },
  { name: "خط‌مشی انتشار جزئی", type: "minor", cadence: "قطار هفتگی (سه‌شنبه‌ها)", go_no_go_required: true, els_days: 7, min_lead_days: 5, transition_package: false },
  { name: "خط‌مشی وصله", type: "patch", cadence: "در هر پنجرهٔ هفتگی", go_no_go_required: false, els_days: 3, min_lead_days: 1, transition_package: false },
  { name: "رویهٔ انتشار اضطراری", type: "emergency", cadence: "در هر زمان، با تصمیم فوری", go_no_go_required: true, els_days: 7, min_lead_days: 0, transition_package: false, procedure: "انتشار اضطراری از پیش‌نویس یا ساخت مستقیم به «آمادگی و تصمیم» می‌رود؛ مدیر انتشار با بررسی‌های بازدارنده تصمیم فوری می‌گیرد و مستندسازی پس از استقرار کامل می‌شود." },
];

const MAJOR_TASKS = [
  { short_description: "تعیین دامنه و فهرست تغییرهای انتشار", phase: "planning", mandatory: true, offset_days: 0, planned_hours: 4 },
  { short_description: "ساخت بستهٔ انتشار و ثبت در کتابخانهٔ نرم‌افزار", phase: "build", mandatory: true, offset_days: 7, planned_hours: 16, after_previous: true },
  { short_description: "استقرار در محیط آزمون و اجرای آزمون‌های رگرسیون", phase: "test", mandatory: true, offset_days: 12, planned_hours: 16, after_previous: true },
  { short_description: "آزمون پذیرش کاربر (UAT) و امضای کسب‌وکار", phase: "test", mandatory: true, offset_days: 16, planned_hours: 8, after_previous: true },
  { short_description: "آموزش میز خدمت و به‌روزرسانی مقاله‌های دانش", phase: "training", mandatory: false, offset_days: 18, planned_hours: 6 },
  { short_description: "نوشتن یادداشت انتشار و برنامهٔ اطلاع‌رسانی", phase: "communication", mandatory: true, offset_days: 18, planned_hours: 3 },
  { short_description: "جلسهٔ تصمیم اجرا (Go/No-Go)", phase: "readiness", mandatory: true, offset_days: 20, planned_hours: 1 },
  { short_description: "استقرار در محیط عملیاتی و آزمون دود", phase: "deploy", mandatory: true, offset_days: 21, planned_hours: 4, after_previous: true },
  { short_description: "بازبینی انتشار و ثبت درس‌آموخته‌ها", phase: "review", mandatory: false, offset_days: 35, planned_hours: 2 },
];

export function seedTemplates(checkIds: Record<string, string>): Row[] {
  const pick = (...keys: string[]) => keys.map((k) => checkIds[k]).filter(Boolean);
  return [
    {
      name: "الگوی انتشار عمده با فهرست آمادگی کامل", type: "major", els_days: 14, tasks: MAJOR_TASKS,
      checks: pick("tasks_done", "changes_authorized", "test_deploy_ok", "no_critical_defects", "uat_signoff", "rollback_plan", "release_notes", "no_freeze", "support_ready", "approvals"),
      description: "چرخهٔ کامل انتشار عمده: برنامه‌ریزی، ساخت، آزمون، UAT، آموزش، اطلاع‌رسانی، تصمیم اجرا، استقرار و بازبینی؛ با همهٔ بررسی‌های آمادگی.",
      deployment_plan: "۱. اعلام شروع پنجره به ذی‌نفعان\n۲. پشتیبان‌گیری از پایگاه داده و پیکربندی\n۳. استقرار بسته در محیط عملیاتی (موج نخست)\n۴. آزمون دود و پایش شاخص‌ها\n۵. عرضه به همهٔ کاربران و اعلام پایان",
      rollback_plan: "اگر آزمون دود ناموفق بود یا نرخ خطا بیش از دو برابر شد: بازگرداندن نسخهٔ پیشین از کتابخانهٔ نرم‌افزار و بازگرداندن پشتیبان پایگاه داده؛ زمان لازم حدود ۳۰ دقیقه.",
      test_plan: "آزمون‌های خودکار رگرسیون، آزمون کارایی روی پیش‌تولید و آزمون پذیرش کاربر با سناریوهای کسب‌وکار.",
      communication_plan: "یک هفته پیش: اعلام زمان انتشار؛ روز انتشار: اعلام شروع و پایان؛ پس از انتشار: یادداشت انتشار برای کاربران.",
    },
    {
      name: "الگوی انتشار جزئی", type: "minor", els_days: 7,
      tasks: [
        { short_description: "ساخت و استقرار در محیط آزمون", phase: "build", mandatory: true, offset_days: 0, planned_hours: 4 },
        { short_description: "آزمون و تأیید", phase: "test", mandatory: true, offset_days: 3, planned_hours: 4, after_previous: true },
        { short_description: "یادداشت انتشار", phase: "communication", mandatory: false, offset_days: 4, planned_hours: 1 },
        { short_description: "استقرار در محیط عملیاتی", phase: "deploy", mandatory: true, offset_days: 5, planned_hours: 2, after_previous: true },
      ],
      checks: pick("tasks_done", "changes_authorized", "test_deploy_ok", "no_critical_defects", "rollback_plan", "no_freeze"),
      description: "انتشار هفتگی بهبودها و رفع اشکال‌ها.",
    },
    {
      name: "الگوی رفع اضطراری", type: "emergency", els_days: 7,
      tasks: [
        { short_description: "ساخت و آزمون سریع رفع", phase: "build", mandatory: true, offset_days: 0, planned_hours: 2 },
        { short_description: "استقرار و پایش", phase: "deploy", mandatory: true, offset_days: 0, planned_hours: 1, after_previous: true },
        { short_description: "تکمیل مستندات و بازبینی پس از استقرار", phase: "review", mandatory: false, offset_days: 3, planned_hours: 2 },
      ],
      checks: pick("changes_authorized", "rollback_plan"),
      description: "رفع فوری یک مشکل عملیاتی با رویهٔ اضطراری؛ مستندسازی پس از استقرار.",
    },
  ];
}

export const SEED_ENVIRONMENTS: Row[] = [
  { key: "dev", name: "توسعه", kind: "development", protection: "open", sort_order: 10, aliases: ["development", "develop"], allowed_data: ["synthetic"], color: "gray", description: "محیط توسعه‌دهندگان؛ استقرار آزاد." },
  { key: "test", name: "آزمون", kind: "test", protection: "open", sort_order: 20, aliases: ["testing", "qa", "sit"], allowed_data: ["synthetic", "masked"], bookable: true, color: "blue", description: "آزمون یکپارچه و رگرسیون." },
  { key: "staging", name: "پیش‌تولید", kind: "staging", protection: "approval", sort_order: 30, aliases: ["stage", "preprod", "pre-production", "uat"], allowed_data: ["masked"], bookable: true, color: "purple", description: "همانند محیط عملیاتی؛ آزمون کارایی و پذیرش. استقرار با تأیید." },
  { key: "prod", name: "عملیاتی", kind: "production", protection: "change", sort_order: 40, aliases: ["production", "live", "prd", "main"], allowed_data: ["production"], color: "red", description: "محیط عملیاتی؛ استقرار فقط با تغییر مجاز و تأیید." },
];

export function seedReleaseWindows(jy: number, tz: string): Row[] {
  const at = (y: number, m: number, d: number, minutes: number) => new Date(localInstant(fromJalali(y, m, d), minutes, tz)).toISOString();
  return [
    {
      name: "قطار انتشار هفتگی", kind: "slot", recurrence: "weekly", weekdays: ["3"], capacity: 3,
      start_at: at(jy, 1, 1, 20 * 60), end_at: at(jy, 1, 1, 23 * 60), types: ["minor", "patch"],
      description: "سه‌شنبه‌ها ساعت ۲۰ تا ۲۳؛ حداکثر سه انتشار جزئی یا وصله.",
    },
    {
      name: "قطار ماهانهٔ انتشارهای عمده", kind: "slot", recurrence: "monthly_last", capacity: 1,
      start_at: at(jy, 1, 31, 22 * 60), end_at: at(jy, 2, 1, 2 * 60), types: ["major"],
      description: "آخرین روز هر ماه از ساعت ۲۲ تا ۲ بامداد؛ یک انتشار عمده در هر نوبت.",
    },
    {
      name: "توقف انتشار پیش از نوروز", kind: "release_freeze", recurrence: "yearly",
      start_at: at(jy - 1, 12, 20, 0), end_at: at(jy, 1, 1, 0), types: ["major", "minor"],
      description: "از ۲۰ اسفند تا پایان سال انتشار عمده و جزئی نداریم؛ وصله و انتشار اضطراری مجاز است.",
    },
  ];
}

const inReadiness = (types: string[]) => ({ and: [{ f: "state", op: "eq", v: "readiness" }, { f: "type", op: "in", v: types }] });

export function approvalRules(): Row[] {
  return [
    {
      table_key: "release", name: "تصمیم اجرای انتشار عمده یا اضطراری", sort_order: 10, mode: "sequential", expire_after: 3 * 24 * H, remind_every: 12 * H, expire_action: "reject",
      condition: inReadiness(["major", "emergency"]),
      levels: [
        { name: "مدیران انتشار", sources: [{ kind: "owner", of: "release_manager" }], rule: "any" },
        { name: "مالک خدمت", sources: [{ kind: "owner", of: "service_owner" }], rule: "any" },
      ],
      description: "مدیر انتشار و سپس مالک خدمت؛ تأیید نهایی با نبود بررسی بازدارنده «اجرا» ثبت می‌شود و رد آن «توقف».",
    },
    {
      table_key: "deployment", name: "استقرار در محیط حفاظت‌شده", sort_order: 10, mode: "sequential", expire_after: 2 * 24 * H, remind_every: 8 * H, expire_action: "reject",
      condition: { f: "state", op: "eq", v: "pending_approval" },
      levels: [{ name: "مدیران انتشار", sources: [{ kind: "owner", of: "release_manager" }], rule: "any" }],
      description: "استقرار در پیش‌تولید و عملیاتی با تأیید یکی از مدیران انتشار (جز مجری خود استقرار).",
    },
  ].map((r) => ({ active: true, allow_self_approval: false, ...r }));
}

export function notificationRules(): Row[] {
  const custom = (custom_event: string) => ({ event: "custom", custom_event });
  return [
    { table_key: "release", name: "تصمیم اجرای انتشار ثبت شد", ...custom("release.go_no_go"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "release", name: "پشتیبانی آغازین انتشار پایان یافت", ...custom("release.els_ended"), recipients: { event_users: true }, channels: ["in_app"] },
    {
      table_key: "release", name: "انتشار در محیط عملیاتی مستقر شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "els" },
      recipients: { fields: ["stakeholders", "release_manager_id"] }, channels: ["in_app", "email"],
    },
    {
      table_key: "release", name: "انتشار به مرحلهٔ تصمیم اجرا رسید", event: "state_changed", condition: { f: "state", op: "changes_to", v: "readiness" },
      recipients: { fields: ["release_manager_id"], roles: ["release_manager"] }, channels: ["in_app"],
    },
    {
      table_key: "deployment", name: "استقرار ناموفق بود یا بازگردانده شد", event: "state_changed",
      condition: { or: [{ f: "state", op: "changes_to", v: "failed" }, { f: "state", op: "changes_to", v: "rolled_back" }] },
      recipients: { fields: ["release_manager_id", "assigned_to"], assignment_group: true }, channels: ["in_app", "email"],
    },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

/** The template flow of the module (inactive: an administrator publishes and switches it on). */
export const FAILED_DEPLOYMENT_FLOW = (): Row => ({
  name: "استقرار عملیاتی ناموفق ← خبر فوری به مدیر انتشار",
  active: false,
  description: "الگو: وقتی استقرار در محیط عملیاتی ناموفق می‌شود یا بازگردانده می‌شود، مدیر انتشار و مجری آن فوراً خبردار شوند. پیش از استفاده منتشر و فعال کنید.",
  trigger: "record",
  trigger_table: "deployment",
  trigger_events: ["state_changed"],
  trigger_condition: { and: [{ f: "is_production", op: "eq", v: true }, { f: "state", op: "in", v: ["failed", "rolled_back"] }] },
  run_as: "trigger_user",
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      {
        id: "notify1", type: "notify", label: "خبر به مدیر انتشار و مجری", position: { x: 0, y: 140 },
        config: {
          to: { fields: ["release_manager_id", "assigned_to"] },
          subject: "استقرار {{trigger.record.number}} در محیط عملیاتی ناموفق بود",
          body: "استقرار «{{trigger.record.short_description}}» ناموفق بود یا بازگردانده شد. برنامهٔ بازگشت و رخدادهای پس از استقرار را بررسی کنید.",
        },
      },
    ],
    edges: [{ id: "trigger-out-notify1", source: "trigger", target: "notify1" }],
    layout: { direction: "TB" },
  },
});

async function officeCalendar(tx: Tx, sys: Ctx, out: SeedCounts): Promise<string | null> {
  let rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!rows.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  return (rows.find((r) => r.active !== false && r.is_default) ?? rows.find((r) => r.active !== false))?.id ?? null;
}

/** Add the defaults inside `tx` as the system. */
export async function seedReleaseDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "release_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= RELEASE_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "release_config", { config_key: "default" }, { name: "تنظیمات انتشار", dora_definitions: DORA_DEFINITIONS }));

  await ensure(tx, sys, out, "group", { name: RELEASE_MANAGERS_GROUP }, { types: ["approval"], roles: ["release_manager"], description: "مدیران انتشار: تصمیم اجرا یا توقف، چشم‌پوشی از بررسی‌های آمادگی و تأیید استقرار در محیط‌های حفاظت‌شده" });

  await ensure(tx, sys, out, "role", { key: RELEASE_ENGINEER_ROLE.key }, RELEASE_ENGINEER_ROLE);

  const checkIds: Record<string, string> = {};
  for (const c of SEED_CHECKS) checkIds[String(c.key)] = String((await ensure(tx, sys, out, "release_check", { key: c.key }, { active: true, ...c })).id);
  for (const p of SEED_POLICIES) {
    const mandatory = p.type === "emergency" ? [checkIds.rollback_plan].filter(Boolean) : [checkIds.rollback_plan, checkIds.no_freeze].filter(Boolean);
    await ensure(tx, sys, out, "release_policy", { name: p.name }, { active: true, mandatory_checks: mandatory, ...p });
  }
  for (const t of seedTemplates(checkIds)) await ensure(tx, sys, out, "release_template", { name: t.name }, { active: true, ...t });
  for (const e of SEED_ENVIRONMENTS) await ensure(tx, sys, out, "release_environment", { key: e.key }, { active: true, ...e });
  const tz = orgTz(sys);
  for (const w of seedReleaseWindows(currentJalaliYear(todayISO(tz)), tz)) await ensure(tx, sys, out, "release_window", { name: w.name }, { active: true, ...w });

  for (const r of approvalRules()) await ensure(tx, sys, out, "approval_rule", { table_key: r.table_key, name: r.name }, r);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  const office = await officeCalendar(tx, sys, out);
  await ensure(tx, sys, out, "sla_definition", { table_key: "release", name: "زمان تصمیم اجرای انتشار" }, {
    type: "ola", target: "custom", duration_mode: "fixed", duration: 16 * H, calendar_id: office, sort_order: 10, warn_percents: [50, 80],
    start_condition: { f: "state", op: "eq", v: "readiness" },
    stop_condition: { f: "state", op: "in", v: ["deploying", "els", "review", "closed"] },
    cancel_condition: { f: "state", op: "in", v: ["build", "test", "on_hold", "canceled"] },
    breach_actions: [{ type: "notify", roles: ["release_manager"] }],
    description: "تصمیم اجرا یا توقف در دو روز کاری (۱۶ ساعت کاری) از ورود انتشار به «آمادگی و تصمیم».",
  });

  const flow = FAILED_DEPLOYMENT_FLOW();
  await savepoint(tx, () => ensure(tx, sys, out, "flow", { name: flow.name }, flow)).catch(() => undefined);

  const patch: Row = { seeded: RELEASE_SEED_VERSION };
  if (!config.dora_definitions) patch.dora_definitions = DORA_DEFINITIONS;
  await updateIn(tx, sys, "release_config", String(config.id), patch, { trusted: true });
  return out;
}

export { ensure as ensureRow };
