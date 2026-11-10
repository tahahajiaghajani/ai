// Day-one defaults of change enablement for an organisation (Persian, idempotent):
//   · the settings row (change_config) — it also records that the defaults were added (`seeded`)
//   · the four change models (standard, normal, emergency, retrospective) with their lifecycles and policies
//   · the risk questionnaire (weighted questions; the risk engine combines it with the automatic profile)
//   · two groups («مدیران تغییر», «هیئت مشاوران تغییر») that carry the roles change_manager / cab_member, the weekly
//     CAB and the emergency CAB (ECAB)
//   · approval rules through the approvals service — low risk: the requester's manager (evidence-based auto-approval
//     when the backout plan is tested, nothing conflicts and the score is very low); moderate: a change manager; high
//     and very high: the CAB (a strict majority); emergency: the ECAB (any member)
//   · notification rules for the module's moments (rejected, authorized, window starting, overrun, conflicts, CAB
//     questions, emergency changes, failed changes, stakeholders, lockdowns, suspended standard changes)
//   · the SLA «زمان تأیید تغییر عادی» (five working days on the office calendar) and two UI policies
//   · categories (the SLA service's category tree, mirrored into the choice lists)
//   · windows: the Nowruz freeze, the fiscal year-end blackout and a weekly maintenance window (Jalali, recurring)
//   · the standard-change catalogue (published, pre-assessed) and one normal-change template
// Every item is created only when no live row with its natural key exists; once added, a second run adds nothing
// unless forced (an administrator's «افزودن پیش‌فرض‌ها» re-adds what was deleted).
import type { Cond } from "@shared/model/conditions";
import { currentJalaliYear, fromJalali, todayISO } from "@shared/jalali";
import { localInstant } from "@shared/sla/calendar";
import { CHANGE_CATEGORIES } from "@shared/tables/change";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { eqAll, iso, liveRows, sysOf, type Row } from "./common";

/**
 * Version of the defaults. An organisation seeded at an older version gets only the upgrade steps it lacks
 * (`UPGRADES`), never the whole seed again (what it deleted stays deleted).
 */
export const CHANGE_SEED_VERSION = 2;

/** The seeded CAB rule's name (its quorum is a strict majority: «بیش از نیمی»). */
export const CAB_RULE_NAME = "تغییر عادی پرریسک ← هیئت CAB";
/**
 * The CAB's share: ⌈0.51·n⌉ approvals are always more than half (exactly ⌊n/2⌋ + 1 up to 50 approvers); 50 % approved
 * on a tie, and a two-member board on a single yes.
 */
export const CAB_MAJORITY = 51;

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

const ALL_STATES = ["new", "assess", "authorize", "scheduled", "implement", "review", "closed", "canceled"];

export const SEED_MODELS: Row[] = [
  {
    name: "تغییر استاندارد", type: "standard", is_default: true, sort_order: 10, states: ["new", "scheduled", "implement", "review", "closed", "canceled"],
    lead_time_exempt: true, cab_policy: "never", pir_policy: "settings",
    description: "تغییر کم‌ریسک و تکرارپذیر از فهرست تغییرهای استاندارد؛ از پیش مجاز است و تأیید نمی‌خواهد.",
  },
  {
    name: "تغییر عادی", type: "normal", is_default: true, sort_order: 20, states: ALL_STATES, cab_policy: "risk", pir_policy: "settings",
    description: "ارزیابی، تأیید بر پایهٔ ریسک (مدیر، مدیر تغییر یا CAB)، زمان‌بندی، اجرا و بازبینی.",
  },
  {
    name: "تغییر اضطراری", type: "emergency", is_default: true, sort_order: 30, states: ["new", "authorize", "implement", "review", "closed", "canceled"],
    docs_deferred: true, lead_time_exempt: true, cab_policy: "always", pir_policy: "always",
    description: "برای رفع فوری اختلال یا خطر امنیتی: تأیید هیئت اضطراری، مستندسازی پس از اجرا و بازبینی پس از اجرای اجباری.",
  },
  {
    name: "ثبت گذشته‌نگر", type: "latent", is_default: true, sort_order: 40, states: ["new", "review", "closed", "canceled"],
    lead_time_exempt: true, cab_policy: "never", pir_policy: "settings",
    description: "تغییری که بدون ثبت پیشین اجرا شده است (یافته در ممیزی یا انحراف پیکربندی)؛ برای ثبت سابقه و بازبینی.",
  },
];

const choice = (...xs: [string, string, number][]) => xs.map(([value, label, score]) => ({ value, label, score }));

export const SEED_QUESTIONS: Row[] = [
  { question: "این نوع تغییر پیش‌تر در همین محیط با موفقیت اجرا شده است؟", kind: "choice", weight: 3, sort_order: 10, options: choice(["often", "بارها", 0], ["once", "یکی دو بار", 4], ["never", "هرگز", 10]) },
  { question: "اجرای تغییر چند کاربر یا مشتری را متأثر می‌کند؟", kind: "choice", weight: 3, sort_order: 20, options: choice(["few", "کمتر از ۵۰ نفر", 1], ["many", "۵۰ تا ۵۰۰ نفر", 5], ["all", "بیش از ۵۰۰ نفر یا مشتریان بیرونی", 10]) },
  { question: "تغییر در محیط آزمون آزموده شده است؟", kind: "choice", weight: 2, sort_order: 30, options: choice(["full", "کامل", 0], ["partial", "تا حدی", 5], ["none", "خیر", 10]) },
  { question: "بازگرداندن تغییر چقدر ممکن و آسان است؟", kind: "choice", weight: 3, sort_order: 40, options: choice(["easy", "کامل و سریع", 0], ["effort", "با زمان و تلاش زیاد", 5], ["impossible", "ناممکن یا ناقص", 10]) },
  { question: "اجرای تغییر به تأمین‌کنندهٔ بیرونی وابسته است؟", kind: "yes_no", weight: 1, sort_order: 50, options: choice(["yes", "بله", 6], ["no", "خیر", 0]) },
  { question: "قطعی یا افت خدمت در زمان اجرا چند دقیقه است؟", kind: "number", weight: 2, sort_order: 60, options: [{ value: "none", label: "بدون قطعی", score: 0, max: 0 }, { value: "short", label: "تا ۳۰ دقیقه", score: 4, max: 30 }, { value: "medium", label: "تا دو ساعت", score: 7, max: 120 }, { value: "long", label: "بیش از دو ساعت", score: 10 }] },
  { question: "تغییر بر داده‌های مالی یا شخصی اثر می‌گذارد؟", kind: "yes_no", weight: 2, sort_order: 70, options: choice(["yes", "بله", 8], ["no", "خیر", 0]) },
];

const inAuthorize = (...more: Cond[]): Cond => ({ and: [{ f: "state", op: "eq", v: "authorize" }, ...more] });

/** The authority matrix (CHG-029) as approval rules of the approvals service. */
export function approvalRules(): Row[] {
  return [
    {
      name: "تغییر عادی کم‌ریسک ← مدیر درخواست‌دهنده", sort_order: 10, mode: "sequential", expire_after: 5 * 24 * H, remind_every: 24 * H, expire_action: "reject",
      condition: inAuthorize({ f: "type", op: "eq", v: "normal" }, { f: "risk", op: "eq", v: "low" }),
      auto_approve: { and: [{ f: "backout_tested", op: "eq", v: true }, { f: "conflict_count", op: "eq", v: 0 }, { f: "risk_score", op: "lt", v: 15 }] },
      levels: [{ name: "مدیر درخواست‌دهنده", sources: [{ kind: "manager" }], rule: "any" }],
      description: "اگر برنامهٔ بازگشت آزموده شده، تداخلی نیست و امتیاز ریسک کمتر از ۱۵ است، خودکار تأیید می‌شود (تأیید بر پایهٔ شواهد).",
    },
    {
      name: "تغییر عادی با ریسک متوسط ← مدیر تغییر", sort_order: 20, mode: "sequential", expire_after: 5 * 24 * H, remind_every: 24 * H, expire_action: "reject",
      condition: inAuthorize({ f: "type", op: "eq", v: "normal" }, { f: "risk", op: "eq", v: "moderate" }),
      levels: [{ name: "مدیر تغییر", sources: [{ kind: "owner", of: "change_manager" }], rule: "any" }],
      description: "مدیر تغییرِ ثبت‌شده روی تغییر، وگرنه اعضای گروه مدیران تغییر.",
    },
    {
      name: CAB_RULE_NAME, sort_order: 30, mode: "sequential", expire_after: 10 * 24 * H, remind_every: 24 * H, expire_action: "reject",
      condition: inAuthorize({ f: "type", op: "eq", v: "normal" }, { f: "risk", op: "in", v: ["high", "very_high"] }),
      levels: [{ name: "هیئت CAB", sources: [{ kind: "owner", of: "cab" }], rule: "percent", threshold: CAB_MAJORITY }],
      description: "بیش از نیمی از اعضای CAB (رأی در جلسه یا در «تأییدهای من»).",
    },
    {
      name: "تغییر اضطراری ← هیئت اضطراری (ECAB)", sort_order: 40, mode: "sequential", expire_after: 8 * H, remind_every: H, expire_action: "reject",
      condition: inAuthorize({ f: "type", op: "eq", v: "emergency" }),
      levels: [{ name: "هیئت اضطراری", sources: [{ kind: "owner", of: "ecab" }], rule: "any" }],
      description: "یک عضو هیئت اضطراری کافی است؛ مستندسازی پس از اجرا کامل می‌شود.",
    },
  ].map((r) => ({ table_key: "change_request", active: true, allow_self_approval: false, ...r }));
}

/** Notification rules of the module (additions to the platform's built-ins). */
export function notificationRules(): Row[] {
  const custom = (custom_event: string) => ({ event: "custom", custom_event });
  return [
    { name: "تغییر تأیید نشد", ...custom("change.rejected"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { name: "تغییر مجاز شد", ...custom("change.authorized"), recipients: { event_users: true, assignment_group: true }, channels: ["in_app", "email"] },
    { name: "شروع پنجرهٔ اجرای تغییر نزدیک است", ...custom("change.window_starting"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { name: "اجرای تغییر از پایان برنامه گذشت", ...custom("change.overrun"), recipients: { event_users: true, roles: ["change_manager"] }, channels: ["in_app", "email"] },
    { name: "تداخل تازه برای تغییر", ...custom("change.conflict_detected"), recipients: { event_users: true }, channels: ["in_app"] },
    { name: "هیئت CAB اطلاعات بیشتری خواست", ...custom("change.cab_info_requested"), recipients: { event_users: true }, channels: ["in_app", "email"] },
    { name: "تغییر اضطراری ثبت شد", event: "created", condition: { f: "type", op: "eq", v: "emergency" }, recipients: { roles: ["change_manager"], fields: ["change_manager_id"] }, channels: ["in_app", "email"] },
    {
      name: "اجرای تغییر ناموفق بود", event: "updated", condition: { f: "close_code", op: "changes_to", v: "unsuccessful" }, recipients: { roles: ["change_manager"], fields: ["change_manager_id", "change_owner_id"] }, channels: ["in_app", "email"],
    },
    {
      name: "تغییر برگشت داده شد", event: "updated", condition: { f: "close_code", op: "changes_to", v: "backed_out" }, recipients: { roles: ["change_manager"], fields: ["change_manager_id", "change_owner_id"] }, channels: ["in_app", "email"],
    },
    {
      name: "اطلاع‌رسانی به ذی‌نفعان تغییر", event: "state_changed",
      condition: { or: [{ f: "state", op: "changes_to", v: "scheduled" }, { f: "state", op: "changes_to", v: "implement" }, { f: "state", op: "changes_to", v: "review" }] },
      recipients: { fields: ["stakeholders"] }, channels: ["in_app", "email"],
    },
  ].map((r) => ({ table_key: "change_request", active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

function otherRules(): Row[] {
  return [
    { table_key: "change_lockdown", name: "قرنطینهٔ تغییرات آغاز شد", event: "custom", custom_event: "change_lockdown.started", recipients: { roles: ["change_manager", "cab_member"] }, channels: ["in_app", "email"], mandatory: true },
    { table_key: "change_lockdown", name: "قرنطینهٔ تغییرات پایان یافت", event: "custom", custom_event: "change_lockdown.released", recipients: { roles: ["change_manager"] }, channels: ["in_app"] },
    { table_key: "change_template", name: "تغییر استاندارد معلق شد", event: "custom", custom_event: "change_template.suspended", recipients: { event_users: true, roles: ["change_manager"] }, channels: ["in_app", "email"] },
    { table_key: "change_pir", name: "بازبینی پس از اجرا به شما سپرده شد", event: "created", recipients: { fields: ["owner_id"], assignment_group: false }, channels: ["in_app", "email"] },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

const TEMPLATE_TASKS = {
  patch: [
    { short_description: "گرفتن نسخهٔ پشتیبان یا تصویر لحظه‌ای سرورها", task_type: "planning", mandatory: true },
    { short_description: "نصب وصله‌ها", task_type: "implementation", mandatory: true, after_previous: true },
    { short_description: "راه‌اندازی دوباره و بررسی خدمت‌ها", task_type: "validation", mandatory: true, after_previous: true },
  ],
  dns: [
    { short_description: "افزودن یا ویرایش رکورد", task_type: "implementation", mandatory: true },
    { short_description: "بررسی پاسخ DNS از شبکهٔ داخلی و بیرونی", task_type: "validation", mandatory: true, after_previous: true },
  ],
  cert: [
    { short_description: "دریافت گواهی تازه", task_type: "planning", mandatory: true },
    { short_description: "نصب گواهی روی سرورها و متعادل‌کننده‌ها", task_type: "implementation", mandatory: true, after_previous: true },
    { short_description: "بررسی زنجیرهٔ گواهی و تاریخ انقضا", task_type: "validation", mandatory: true, after_previous: true },
  ],
  disk: [
    { short_description: "افزایش دیسک در بستر مجازی", task_type: "implementation", mandatory: true },
    { short_description: "گسترش بخش‌بندی در سیستم‌عامل و بررسی", task_type: "validation", mandatory: true, after_previous: true },
  ],
  release: [
    { short_description: "آماده‌سازی بستهٔ انتشار و یادداشت نسخه", task_type: "planning", mandatory: true },
    { short_description: "استقرار در محیط عملیاتی", task_type: "implementation", mandatory: true, after_previous: true },
    { short_description: "آزمون دود و صحت‌سنجی", task_type: "testing", mandatory: true, after_previous: true },
    { short_description: "اطلاع‌رسانی به کاربران", task_type: "communication", mandatory: false },
  ],
};

export const SEED_TEMPLATES: Row[] = [
  {
    name: "نصب وصلهٔ امنیتی ماهانهٔ سرورهای ویندوز", kind: "standard", category: "security", risk: "low", impact: "3", max_duration: 4 * H,
    short_description: "نصب وصله‌های امنیتی ماهانهٔ سرورهای ویندوز",
    description: "نصب به‌روزرسانی‌های امنیتی ماهانهٔ مایکروسافت روی سرورهای فهرست‌شده در پنجرهٔ نگهداری هفتگی.",
    implementation_plan: "1. گرفتن تصویر لحظه‌ای از ماشین‌های مجازی\n2. نصب وصله‌ها از مخزن داخلی به‌روزرسانی\n3. راه‌اندازی دوباره به ترتیب وابستگی\n4. بررسی خدمت‌ها و رویدادنگارها",
    backout_plan: "حذف وصلهٔ مشکل‌ساز یا بازگرداندن تصویر لحظه‌ای ماشین مجازی.",
    test_plan: "بررسی دسترسی خدمت‌های اصلی و نبود خطای تازه در رویدادنگار سیستم.",
    tasks: TEMPLATE_TASKS.patch,
  },
  {
    name: "افزودن یا ویرایش رکورد DNS داخلی", kind: "standard", category: "network", risk: "low", impact: "3", max_duration: H,
    short_description: "افزودن یا ویرایش رکورد DNS داخلی",
    description: "افزودن رکورد A، CNAME یا PTR در منطقه‌های داخلی؛ بدون تغییر در منطقه‌های عمومی.",
    implementation_plan: "1. بررسی نبود رکورد تکراری\n2. افزودن یا ویرایش رکورد با TTL کوتاه\n3. ثبت در فهرست رکوردها",
    backout_plan: "حذف رکورد تازه یا بازگرداندن مقدار پیشین.",
    test_plan: "پرس‌وجوی رکورد با nslookup از دو زیرشبکه.",
    tasks: TEMPLATE_TASKS.dns,
  },
  {
    name: "تمدید گواهی TLS", kind: "standard", category: "security", risk: "low", impact: "3", max_duration: 2 * H,
    short_description: "تمدید گواهی TLS پیش از انقضا",
    description: "جایگزینی گواهی TLS رو به پایان با گواهی تازهٔ همان نام‌ها.",
    implementation_plan: "1. دریافت گواهی تازه\n2. نصب روی سرورها و متعادل‌کننده‌ها\n3. بارگذاری دوبارهٔ پیکربندی بدون قطع اتصال",
    backout_plan: "بازگرداندن گواهی پیشین تا پیش از تاریخ انقضای آن.",
    test_plan: "بررسی زنجیرهٔ گواهی و تاریخ انقضا از بیرون شبکه.",
    tasks: TEMPLATE_TASKS.cert,
  },
  {
    name: "افزایش فضای دیسک ماشین مجازی", kind: "standard", category: "infrastructure", risk: "low", impact: "3", max_duration: H,
    short_description: "افزایش فضای دیسک ماشین مجازی",
    description: "افزایش اندازهٔ دیسک یک ماشین مجازی در بستر مجازی‌سازی و گسترش آن در سیستم‌عامل.",
    implementation_plan: "1. بررسی فضای آزاد مخزن\n2. افزایش اندازهٔ دیسک\n3. گسترش بخش‌بندی در سیستم‌عامل",
    backout_plan: "کاهش اندازهٔ دیسک ممکن نیست؛ فضای افزوده بی‌اثر می‌ماند و خطری ندارد.",
    test_plan: "بررسی اندازهٔ تازه در سیستم‌عامل و سلامت فایل‌سیستم.",
    tasks: TEMPLATE_TASKS.disk,
  },
  {
    name: "انتشار نسخهٔ تازهٔ نرم‌افزار", kind: "template", category: "application", risk: "moderate", impact: "2",
    short_description: "انتشار نسخهٔ تازهٔ نرم‌افزار",
    description: "استقرار نسخهٔ تازهٔ یک سامانه در محیط عملیاتی.\n\n- سامانه:\n- نسخه:\n- تغییرهای مهم:\n",
    justification: "", implementation_plan: "1. استقرار بسته\n2. اجرای اسکریپت‌های پایگاه داده\n3. آزمون دود",
    backout_plan: "استقرار نسخهٔ پیشین و بازگرداندن پشتیبان پایگاه داده.", test_plan: "آزمون دود فرایندهای اصلی و پایش خطاها تا یک ساعت.",
    tasks: TEMPLATE_TASKS.release,
  },
];

/** The windows of a Jalali year: the Nowruz freeze, the fiscal year-end blackout, a weekly maintenance window. */
export function seedWindows(jy: number, tz: string): Row[] {
  const at = (y: number, m: number, d: number, minutes: number) => iso(localInstant(fromJalali(y, m, d), minutes, tz));
  // the next Thursday from the first of the year for the weekly window
  return [
    {
      name: "انجماد تغییرات نوروز", kind: "freeze", recurrence: "yearly", enforcement: "block", exempt_emergency: true,
      start_at: at(jy, 1, 1, 0), end_at: at(jy, 1, 14, 0), source: "seed",
      description: "از ۱ تا ۱۳ فروردین هر سال؛ فقط تغییرهای اضطراری.",
    },
    {
      name: "ممنوعیت تغییر پایان سال مالی", kind: "blackout", recurrence: "yearly", enforcement: "block", exempt_emergency: true,
      start_at: at(jy - 1, 12, 25, 0), end_at: at(jy, 1, 1, 0), source: "seed",
      description: "از ۲۵ اسفند تا پایان سال: بستن حساب‌ها و گزارش‌های پایان سال.",
    },
    {
      name: "پنجرهٔ نگهداری هفتگی", kind: "maintenance", recurrence: "weekly", weekdays: ["5"], enforcement: "block",
      start_at: at(jy, 1, 1, 22 * 60), end_at: at(jy, 1, 2, 4 * 60), source: "seed",
      description: "پنجشنبه‌ها ساعت ۲۲ تا ۴ بامداد جمعه؛ تغییرهایی که قطعی دارند در این پنجره اجرا شوند.",
    },
  ];
}

/** The office (default) calendar, created with the SLA service's seed when the organisation has none. */
async function officeCalendar(tx: Tx, sys: Ctx, out: SeedCounts): Promise<string | null> {
  let rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!rows.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  return (rows.find((r) => r.active !== false && r.is_default) ?? rows.find((r) => r.active !== false))?.id ?? null;
}

/** Steps that bring an organisation seeded at version `v - 1` to version `v` (keyed by `v`). */
const UPGRADES: Record<number, (tx: Tx, sys: Ctx, out: SeedCounts) => Promise<void>> = {
  // the seeded CAB rule approved on a tie (50 %): a strict majority, unless the organisation changed the rule
  2: async (tx, sys, out) => {
    for (const r of await liveRows(tx, sys, "approval_rule", eqAll({ table_key: "change_request", name: CAB_RULE_NAME }))) {
      const levels = Array.isArray(r.levels) ? (r.levels as Row[]) : [];
      if (!levels.some((l) => l.rule === "percent" && Number(l.threshold) === 50)) continue;
      const next = levels.map((l) => (l.rule === "percent" && Number(l.threshold) === 50 ? { ...l, threshold: CAB_MAJORITY } : l));
      await updateIn(tx, sys, "approval_rule", String(r.id), { levels: next }, { trusted: true });
      out.created.approval_rule_upgraded = (out.created.approval_rule_upgraded ?? 0) + 1;
    }
  },
};

/** Add the defaults inside `tx` as the system. */
export async function seedChangeDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "change_config", null, { order: "t.created_at", limit: 1 });
  const seeded = Number(cfg?.seeded ?? 0);
  if (cfg && seeded >= CHANGE_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  if (cfg && seeded >= 1 && !opts.force) {
    for (let v = seeded + 1; v <= CHANGE_SEED_VERSION; v++) await UPGRADES[v]?.(tx, sys, out);
    await updateIn(tx, sys, "change_config", String(cfg.id), { seeded: CHANGE_SEED_VERSION }, { trusted: true });
    return out;
  }
  const config = cfg ?? (await ensure(tx, sys, out, "change_config", { config_key: "default" }, { name: "تنظیمات تغییر" }));

  for (const m of SEED_MODELS) await ensure(tx, sys, out, "change_model", { name: m.name }, m);
  for (const q of SEED_QUESTIONS) await ensure(tx, sys, out, "change_risk_question", { question: q.question }, { active: true, mandatory: true, ...q });

  const managers = await ensure(tx, sys, out, "group", { name: "مدیران تغییر" }, { types: ["approval"], roles: ["change_manager"], description: "مدیران تغییر: تأیید تغییرهای با ریسک متوسط، مدیریت جلسه‌های CAB و تقویم تغییرات" });
  const board = await ensure(tx, sys, out, "group", { name: "هیئت مشاوران تغییر" }, { types: ["cab"], roles: ["cab_member"], description: "اعضای CAB: بررسی و تأیید تغییرهای پرریسک" });
  const cab = await ensure(tx, sys, out, "cab", { name: "هیئت مشاوران تغییر (CAB)" }, {
    kind: "change", group_id: board.id, meeting_weekday: "2", meeting_time: "10:00", meeting_minutes: 60, quorum: 3,
    description: "جلسهٔ هفتگی دوشنبه‌ها ساعت ۱۰؛ تغییرهای پرریسکِ در انتظار تأیید به دستور جلسه می‌آیند.",
  });
  const ecab = await ensure(tx, sys, out, "cab", { name: "هیئت اضطراری (ECAB)" }, {
    kind: "emergency", group_id: managers.id, description: "تصمیم فوری دربارهٔ تغییرهای اضطراری؛ جلسهٔ دوره‌ای ندارد.",
  });

  for (const r of approvalRules()) await ensure(tx, sys, out, "approval_rule", { table_key: "change_request", name: r.name }, r);
  for (const r of [...notificationRules(), ...otherRules()]) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);

  const office = await officeCalendar(tx, sys, out);
  await ensure(tx, sys, out, "sla_definition", { table_key: "change_request", name: "زمان تأیید تغییر عادی" }, {
    type: "ola", target: "custom", duration_mode: "fixed", duration: 40 * H, calendar_id: office, sort_order: 10, warn_percents: [50, 80],
    start_condition: { and: [{ f: "state", op: "eq", v: "authorize" }, { f: "type", op: "eq", v: "normal" }] },
    stop_condition: { f: "state", op: "in", v: ["scheduled", "implement", "review", "closed"] },
    cancel_condition: { f: "state", op: "in", v: ["new", "assess", "canceled"] },
    breach_actions: [{ type: "notify", roles: ["change_manager"] }],
    description: "تصمیم دربارهٔ تغییر عادی در پنج روز کاری (۴۰ ساعت کاری) از ورود به «در انتظار تأیید».",
  });
  await ensure(tx, sys, out, "ui_policy", { table_key: "change_request", name: "ریسک دستی دلیل لازم دارد" }, {
    condition: { f: "risk_source", op: "eq", v: "manual" }, actions: [{ field: "risk_override_reason", mandatory: true, visible: true }], sort_order: 100, applies_on: "both",
  });
  await ensure(tx, sys, out, "ui_policy", { table_key: "change_request", name: "تغییر اضطراری توجیه لازم دارد" }, {
    condition: { f: "type", op: "eq", v: "emergency" }, actions: [{ field: "justification", mandatory: true }], sort_order: 110, applies_on: "both",
    message: "برای تغییر اضطراری، دلیل فوریت را بنویسید", tone: "warning",
  });

  for (const [i, c] of CHANGE_CATEGORIES.entries()) {
    const parent = await ensure(tx, sys, out, "category", { table_key: "change_request", value: c.value }, { name: c.label, sort_order: (i + 1) * 10 });
    for (const [j, [value, label]] of c.subs.entries()) await ensure(tx, sys, out, "category", { table_key: "change_request", value }, { name: label, parent_id: parent.id, sort_order: (j + 1) * 10 });
  }

  const tz = orgTz(sys);
  for (const w of seedWindows(currentJalaliYear(todayISO(tz)), tz)) await ensure(tx, sys, out, "change_window", { name: w.name }, w);

  for (const t of SEED_TEMPLATES) await ensure(tx, sys, out, "change_template", { name: t.name }, { ...t, state: t.kind === "standard" ? "published" : "draft" });

  // rows that existed before (a forced seed of an older organisation) get the upgrades too (each is idempotent)
  for (let v = 2; v <= CHANGE_SEED_VERSION; v++) await UPGRADES[v]?.(tx, sys, out);
  const patch: Row = { seeded: CHANGE_SEED_VERSION };
  if (!config.default_cab_id) patch.default_cab_id = cab.id;
  if (!config.emergency_cab_id) patch.emergency_cab_id = ecab.id;
  if (!config.change_manager_group_id) patch.change_manager_group_id = managers.id;
  await updateIn(tx, sys, "change_config", String(config.id), patch, { trusted: true });
  return out;
}

export { ensure as ensureRow };
