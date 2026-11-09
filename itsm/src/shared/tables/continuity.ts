// Tables of availability, capacity and IT service continuity (docs/modules/continuity_FA.md, catalogue
// docs/catalog/g2_operations.md «Module: continuity»):
//   availability  outage (the outage register: outages, degradations and planned outages of services and CIs, with
//                 their incident, change, alert and problem; availability, MTBF and MTRS are computed from it on the
//                 service's agreed hours)
//   capacity      capacity_record (utilisation against warning and critical thresholds, fed by hand or by monitoring
//                 events, with a linear time-to-exhaustion)
//   continuity    bia (business impact analysis: impact ratings by category over time buckets, MTPD/RTO/RPO/MBCO,
//                 dependencies), continuity_plan + plan_step (recovery plans with RTO offsets), exercise (DR tests and
//                 their results against RTO/RPO, with step timings)
//   settings      continuity_config
// Behaviour lives in src/server/modules/continuity; pure logic (availability maths, BIA, exercises) in
// src/shared/continuity; the screens in src/ui/modules/continuity.
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

export const OUTAGE_TYPES: Option[] = [
  { value: "outage", label: "قطعی کامل", color: "red", order: 1 },
  { value: "degradation", label: "افت کیفیت", color: "orange", order: 2 },
  { value: "planned", label: "قطعی برنامه‌ریزی‌شده", color: "teal", order: 3 },
];

export const OUTAGE_CAUSES: Option[] = [
  { value: "hardware", label: "سخت‌افزار", order: 1 },
  { value: "software", label: "نرم‌افزار", order: 2 },
  { value: "network", label: "شبکه", order: 3 },
  { value: "power", label: "برق و تأسیسات", order: 4 },
  { value: "change", label: "تغییر", order: 5 },
  { value: "capacity", label: "ظرفیت", order: 6 },
  { value: "security", label: "امنیت", order: 7 },
  { value: "third_party", label: "تأمین‌کننده یا اینترنت", order: 8 },
  { value: "human", label: "خطای انسانی", order: 9 },
  { value: "unknown", label: "نامعلوم", order: 10 },
];

export const OUTAGE_STATES: StateModel = {
  field: "state",
  initial: "ongoing",
  states: [
    { value: "proposed", label: "پیشنهادی", category: "new", color: "blue" },
    { value: "ongoing", label: "در جریان", category: "active", color: "red" },
    { value: "ended", label: "پایان‌یافته", category: "resolved", color: "green" },
    { value: "validated", label: "تأییدشده", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["proposed"], to: "ongoing", label: "تأیید قطعی" },
    { from: ["proposed", "ongoing"], to: "ended", label: "پایان قطعی", requires: ["end_at"] },
    { from: ["ended"], to: "ongoing", label: "ادامهٔ قطعی" },
    { from: ["ended"], to: "validated", label: "تأیید نهایی", requires: ["cause"] },
    { from: ["validated"], to: "ended", label: "بازگشایی", roles: { area: "continuity", level: "full" } },
    { from: ["proposed", "ongoing", "ended"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

export const CAPACITY_KINDS: Option[] = [
  { value: "technical", label: "فنی", order: 1 },
  { value: "human", label: "نیروی انسانی", order: 2 },
  { value: "information", label: "اطلاعات و داده", order: 3 },
  { value: "financial", label: "مالی و مجوز", order: 4 },
];

export const CAPACITY_STATUSES: Option[] = [
  { value: "ok", label: "عادی", color: "green", order: 1 },
  { value: "warning", label: "نزدیک به آستانه", color: "gold", order: 2 },
  { value: "critical", label: "فراتر از آستانهٔ بحرانی", color: "red", order: 3 },
  { value: "unknown", label: "بی‌اندازه‌گیری", color: "gray", order: 4 },
];

/** BIA impact categories (rows of the matrix). */
export const BIA_CATEGORIES: Option[] = [
  { value: "financial", label: "مالی", order: 1 },
  { value: "operational", label: "عملیاتی", order: 2 },
  { value: "regulatory", label: "قانونی و مقرراتی", order: 3 },
  { value: "reputational", label: "اعتبار و آبرو", order: 4 },
  { value: "customer", label: "مشتری و ذی‌نفع", order: 5 },
  { value: "safety", label: "ایمنی و سلامت", order: 6 },
];

/** BIA time buckets (columns of the matrix), with their length in seconds. */
export const BIA_BUCKETS: { value: string; label: string; seconds: number }[] = [
  { value: "h1", label: "۱ ساعت", seconds: 3600 },
  { value: "h4", label: "۴ ساعت", seconds: 4 * 3600 },
  { value: "d1", label: "۱ روز", seconds: 86_400 },
  { value: "d3", label: "۳ روز", seconds: 3 * 86_400 },
  { value: "w1", label: "۱ هفته", seconds: 7 * 86_400 },
];

/** Impact ratings 0–4. */
export const BIA_RATINGS: Option[] = [
  { value: "0", label: "بی‌اثر", color: "gray", order: 1 },
  { value: "1", label: "کم", color: "green", order: 2 },
  { value: "2", label: "متوسط", color: "gold", order: 3 },
  { value: "3", label: "زیاد", color: "orange", order: 4 },
  { value: "4", label: "بحرانی", color: "red", order: 5 },
];

export const BIA_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "active", color: "gold" },
    { value: "approved", label: "تأییدشده", category: "resolved", color: "green" },
    { value: "superseded", label: "جایگزین‌شده", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "ارسال برای بازبینی", requires: ["rto", "mtpd"] },
    { from: ["in_review"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["in_review"], to: "approved", label: "تأیید", roles: { area: "continuity", level: "full" } },
    { from: ["approved"], to: "in_review", label: "بازبینی دوباره" },
    { from: ["approved"], to: "superseded", label: "جایگزین شد" },
    { from: ["draft", "in_review"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

export const PLAN_TYPES: Option[] = [
  { value: "drp", label: "طرح بازیابی از فاجعه (DRP)", order: 1 },
  { value: "bcp", label: "طرح تداوم کسب‌وکار (BCP)", order: 2 },
  { value: "it_recovery", label: "طرح بازیابی سامانه", order: 3 },
  { value: "crisis", label: "طرح مدیریت بحران", order: 4 },
];

export const PLAN_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "active", color: "gold" },
    { value: "approved", label: "تأییدشده و منتشر", category: "resolved", color: "green" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "ارسال برای بازبینی" },
    { from: ["in_review"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["in_review"], to: "approved", label: "تأیید و انتشار", roles: { area: "continuity", level: "full" } },
    { from: ["approved"], to: "draft", label: "ویرایش (نسخهٔ تازه)" },
    { from: ["draft", "in_review", "approved"], to: "retired", label: "بازنشسته کردن" },
  ],
  locked: ["closed", "canceled"],
};

export const EXERCISE_TYPES: Option[] = [
  { value: "tabletop", label: "میزگرد (روی کاغذ)", order: 1 },
  { value: "walkthrough", label: "مرور گام‌به‌گام", order: 2 },
  { value: "simulation", label: "شبیه‌سازی", order: 3 },
  { value: "failover", label: "جابه‌جایی به سایت پشتیبان", order: 4 },
  { value: "full", label: "آزمون کامل", order: 5 },
];

export const EXERCISE_RESULTS: Option[] = [
  { value: "passed", label: "موفق", color: "green", order: 1 },
  { value: "partial", label: "موفق با کاستی", color: "gold", order: 2 },
  { value: "failed", label: "ناموفق", color: "red", order: 3 },
];

export const EXERCISE_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "in_progress", label: "در اجرا", category: "active", color: "orange" },
    { value: "results", label: "نتیجه ثبت شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "in_progress", label: "آغاز مانور" },
    { from: ["planned", "in_progress"], to: "results", label: "ثبت نتیجه", requires: ["result"] },
    { from: ["results"], to: "in_progress", label: "بازگشت به اجرا" },
    { from: ["results"], to: "closed", label: "بستن", requires: ["lessons"] },
    { from: ["planned", "in_progress"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

export interface ContinuityConfig {
  exclude_planned: boolean;
  degradation_weight: number;
  plan_review_months: number;
  bia_review_months: number;
  propose_on_major: boolean;
}

export const CONTINUITY_CONFIG_DEFAULTS: ContinuityConfig = {
  exclude_planned: true,
  degradation_weight: 50,
  plan_review_months: 12,
  bia_review_months: 12,
  propose_on_major: true,
};

const MAIN = "اصلی";
const TIME = "زمان و اثر";
const LINKS = "پیوندها";
const TARGETS = "هدف‌های بازیابی";
const RESULT = "نتیجه";

// ---------------------------------------------------------------------------------------------------------------
// Availability

const outage: TableDef = {
  key: "outage",
  table: "sm_outages",
  label: "قطعی",
  plural: "قطعی‌ها",
  icon: "power-off",
  module: "continuity",
  area: "continuity",
  description: "قطعی، افت کیفیت یا قطعی برنامه‌ریزی‌شدهٔ یک خدمت یا پیکربندی با شروع، پایان، اثر و علت؛ دسترس‌پذیری از همین‌ها حساب می‌شود",
  numbered: { prefix: "OUT", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24, section: MAIN },
    { name: "outage_type", label: "نوع", type: "choice", choices: OUTAGE_TYPES, required: true, default: "outage", list: true, filter: true, span: 8, section: MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, index: true, span: 8, section: MAIN },
    { name: "offering_id", label: "گزینهٔ خدمت", type: "ref", ref: "service_offering", filter: true, span: 8, section: MAIN },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8, section: MAIN },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8, section: MAIN },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8, section: MAIN },
    { name: "begin_at", label: "شروع", type: "datetime", required: true, default: "$now", list: true, sort: true, filter: true, index: true, span: 8, section: TIME },
    { name: "end_at", label: "پایان", type: "datetime", list: true, sort: true, filter: true, span: 8, section: TIME },
    { name: "duration", label: "مدت", type: "duration", readonly: true, list: true, sort: true, span: 8, section: TIME },
    { name: "impact_pct", label: "درصد اثر", type: "percent", default: "100", span: 8, section: TIME, help: "برای افت کیفیت: چند درصد خدمت در دسترس نبود" },
    { name: "affected_users", label: "کاربران متأثر", type: "int", min: 0, max: 100000000, default: 0, span: 8, section: TIME },
    { name: "customer_minutes", label: "دقیقه‌-کاربر متأثر", type: "int", readonly: true, span: 8, section: TIME },
    { name: "excluded", label: "بیرون از محاسبهٔ دسترس‌پذیری", type: "bool", default: false, filter: true, span: 8, section: TIME, help: "مانند نگهداری توافق‌شده بیرون از ساعات خدمت" },
    { name: "cause", label: "علت", type: "choice", choices: OUTAGE_CAUSES, list: true, filter: true, span: 8, section: TIME },
    { name: "cause_detail", label: "شرح علت", type: "text", span: 24, section: TIME },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", filter: true, index: true, span: 8, section: LINKS },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", filter: true, span: 8, section: LINKS },
    { name: "alert_id", label: "هشدار", type: "ref", ref: "alert", filter: true, span: 8, section: LINKS },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true, span: 8, section: LINKS },
    { name: "proposed_by", label: "پیشنهاد از", type: "string", readonly: true, maxLength: 60, span: 8, section: LINKS },
    { name: "description", label: "شرح", type: "markdown", span: 24, section: MAIN },
  ],
  states: OUTAGE_STATES,
  scope: { own: ["owner_id"], requester: [], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, calendar: { start: "begin_at", end: "end_at" } },
  form: { sections: [MAIN, TIME, LINKS] },
  list: { columns: ["number", "title", "outage_type", "service_id", "state", "begin_at", "end_at", "duration", "cause"], order: "-begin_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Capacity

const capacityRecord: TableDef = {
  key: "capacity_record",
  table: "sm_capacity_records",
  label: "رکورد ظرفیت",
  plural: "رکوردهای ظرفیت",
  icon: "gauge",
  module: "continuity",
  area: "continuity",
  description: "ظرفیت یک پیکربندی یا خدمت (فنی، انسانی، اطلاعات، مالی) با مصرف جاری، آستانه‌های اخطار و بحرانی و پیش‌بینی زمان پر شدن",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: CAPACITY_KINDS, default: "technical", list: true, filter: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: CAPACITY_STATUSES, readonly: true, default: "unknown", list: true, filter: true, span: 6 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", list: true, filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "metric", label: "سنجه", type: "string", maxLength: 120, ltr: true, list: true, span: 8, help: "مانند cpu، disk:/data یا licenses" },
    { name: "unit", label: "یکا", type: "string", maxLength: 30, span: 6 },
    { name: "capacity", label: "ظرفیت", type: "decimal", required: true, span: 6 },
    { name: "utilisation", label: "مصرف جاری", type: "decimal", list: true, span: 6 },
    { name: "utilisation_pct", label: "درصد مصرف", type: "percent", readonly: true, list: true, sort: true, span: 6 },
    { name: "warning_pct", label: "آستانهٔ اخطار (٪)", type: "percent", default: "80", span: 6 },
    { name: "critical_pct", label: "آستانهٔ بحرانی (٪)", type: "percent", default: "90", span: 6 },
    { name: "measured_at", label: "زمان اندازه‌گیری", type: "datetime", readonly: true, sort: true, span: 6 },
    { name: "event_match", label: "به‌روزرسانی از رویدادهای", type: "string", maxLength: 300, ltr: true, span: 12, help: "میزبان/سنجه، مانند db01/disk_used؛ مقدار رویداد مصرف جاری می‌شود" },
    { name: "samples", label: "نمونه‌ها", type: "json", readonly: true, audit: false, hidden: true },
    { name: "exhaustion_at", label: "پیش‌بینی پر شدن", type: "datetime", readonly: true, sort: true, filter: true, span: 8 },
    { name: "lead_time_days", label: "زمان تأمین (روز)", type: "int", min: 0, max: 3650, default: 30, span: 8, help: "اگر پیش‌بینی پر شدن زودتر از آن باشد، ریسک ظرفیت است" },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "notified_status", label: "آخرین وضعیت اعلام‌شده", type: "string", system: true, hidden: true, maxLength: 20, audit: false },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  scope: { own: ["owner_id"], requester: [], group: "assignment_group_id" },
  features: { journal: true, links: true },
  list: { columns: ["name", "ci_id", "metric", "utilisation_pct", "status", "exhaustion_at", "owner_id"], order: "-utilisation_pct" },
};

// ---------------------------------------------------------------------------------------------------------------
// Continuity: BIA, plans, exercises

const bia: TableDef = {
  key: "bia",
  table: "sm_bias",
  label: "تحلیل اثر کسب‌وکار",
  plural: "تحلیل‌های اثر کسب‌وکار",
  icon: "scale",
  module: "continuity",
  area: "continuity",
  description: "اثر از کار افتادن یک خدمت یا فرایند در گذر زمان، حداکثر زمان قابل تحمل (MTPD)، هدف‌های بازیابی (RTO/RPO) و وابستگی‌ها",
  numbered: { prefix: "BIA", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24, section: MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, span: 12, section: MAIN },
    { name: "activity", label: "فرایند یا فعالیت کسب‌وکار", type: "string", maxLength: 200, search: true, span: 12, section: MAIN },
    { name: "org_unit_id", label: "واحد سازمانی", type: "ref", ref: "org_unit", filter: true, span: 8, section: MAIN },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, span: 8, section: MAIN },
    { name: "respondent_id", label: "پاسخ‌دهنده", type: "user", filter: true, span: 8, section: MAIN },
    { name: "assignment_group_id", label: "گروه تداوم", type: "group", filter: true, span: 8, section: MAIN },
    { name: "vital", label: "کارکرد حیاتی کسب‌وکار", type: "bool", default: false, list: true, filter: true, span: 8, section: MAIN },
    { name: "is_template", label: "الگو", type: "bool", default: false, filter: true, span: 8, section: MAIN },
    { name: "impacts", label: "ماتریس اثر", type: "json", default: {}, span: 24, section: MAIN, help: "{ دسته: { بازه: امتیاز ۰ تا ۴ } }" },
    { name: "tolerance", label: "آستانهٔ تحمل", type: "int", min: 1, max: 4, default: 3, span: 8, section: TARGETS, help: "نخستین بازه‌ای که امتیاز اثر به این برسد، RTO پیشنهادی است" },
    { name: "proposed_rto", label: "RTO پیشنهادی", type: "duration", readonly: true, span: 8, section: TARGETS },
    { name: "mtpd", label: "حداکثر زمان قابل تحمل (MTPD)", type: "duration", list: true, span: 8, section: TARGETS },
    { name: "rto", label: "زمان هدف بازیابی (RTO)", type: "duration", list: true, span: 8, section: TARGETS },
    { name: "rpo", label: "نقطهٔ هدف بازیابی (RPO)", type: "duration", list: true, span: 8, section: TARGETS },
    { name: "mbco", label: "حداقل هدف تداوم (MBCO)", type: "text", span: 24, section: TARGETS },
    { name: "depends_cis", label: "پیکربندی‌های لازم", type: "refs", ref: "ci", span: 12, section: TARGETS },
    { name: "depends_services", label: "خدمت‌های لازم", type: "refs", ref: "service", span: 12, section: TARGETS },
    { name: "key_people", label: "افراد کلیدی", type: "users", span: 12, section: TARGETS },
    { name: "sites", label: "مکان‌ها", type: "refs", ref: "location", span: 12, section: TARGETS },
    { name: "suppliers", label: "تأمین‌کنندگان و داده‌ها", type: "text", span: 24, section: TARGETS },
    { name: "review_due", label: "موعد بازبینی", type: "date", sort: true, filter: true, span: 8, section: TARGETS },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", readonly: true, span: 8, section: TARGETS },
    { name: "approved_by", label: "تأییدکننده", type: "user", readonly: true, span: 8, section: TARGETS },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24, section: MAIN },
  ],
  states: BIA_STATES,
  scope: { own: ["owner_id", "respondent_id"], requester: [], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true },
  form: { sections: [MAIN, TARGETS], related: [{ table: "continuity_plan", field: "bia_id", label: "طرح‌ها", columns: ["number", "title", "plan_type", "state", "last_tested_at"] }] },
  list: { columns: ["number", "title", "service_id", "state", "vital", "rto", "rpo", "mtpd", "owner_id"], order: "-updated_at" },
  ai: { title: "title", text: ["mbco", "notes"] },
};

const continuityPlan: TableDef = {
  key: "continuity_plan",
  table: "sm_continuity_plans",
  label: "طرح تداوم و بازیابی",
  plural: "طرح‌های تداوم و بازیابی",
  icon: "life-buoy",
  module: "continuity",
  area: "continuity",
  description: "طرح بازیابی یک خدمت، مکان یا سناریو: معیارهای فعال‌سازی، تیم و زنجیرهٔ تماس، گام‌ها با زمان هدف، بازگشت به حالت عادی و بازبینی دوره‌ای",
  numbered: { prefix: "BCP", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24, section: MAIN },
    { name: "plan_type", label: "نوع", type: "choice", choices: PLAN_TYPES, required: true, default: "drp", list: true, filter: true, span: 8, section: MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, span: 8, section: MAIN },
    { name: "bia_id", label: "تحلیل اثر", type: "ref", ref: "bia", filter: true, span: 8, section: MAIN },
    { name: "sites", label: "مکان‌ها", type: "refs", ref: "location", span: 12, section: MAIN },
    { name: "owner_id", label: "مالک طرح", type: "user", default: "$me", list: true, filter: true, span: 6, section: MAIN },
    { name: "assignment_group_id", label: "تیم بازیابی", type: "group", filter: true, span: 6, section: MAIN },
    { name: "rto", label: "RTO", type: "duration", list: true, span: 8, section: TARGETS },
    { name: "rpo", label: "RPO", type: "duration", span: 8, section: TARGETS },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, default: "1.0", ltr: true, span: 8, section: TARGETS },
    { name: "invocation_criteria", label: "معیارهای فعال‌سازی", type: "markdown", span: 24, section: MAIN },
    { name: "call_tree", label: "تیم و زنجیرهٔ تماس", type: "markdown", group: "personal", span: 24, section: MAIN },
    { name: "return_to_normal", label: "بازگشت به حالت عادی", type: "markdown", span: 24, section: MAIN },
    { name: "review_months", label: "بازبینی هر چند ماه", type: "int", min: 1, max: 60, default: 12, span: 8, section: TARGETS },
    { name: "last_reviewed_at", label: "آخرین بازبینی", type: "date", sort: true, span: 8, section: TARGETS },
    { name: "next_review_at", label: "بازبینی بعدی", type: "date", readonly: true, sort: true, filter: true, span: 8, section: TARGETS },
    { name: "last_tested_at", label: "آخرین آزمون", type: "date", readonly: true, sort: true, filter: true, list: true, span: 8, section: TARGETS },
    { name: "last_test_result", label: "نتیجهٔ آخرین آزمون", type: "choice", choices: EXERCISE_RESULTS, readonly: true, filter: true, span: 8, section: TARGETS },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", readonly: true, span: 8, section: TARGETS },
  ],
  states: PLAN_STATES,
  scope: { own: ["owner_id"], requester: [], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true },
  form: {
    sections: [MAIN, TARGETS],
    related: [
      { table: "plan_step", field: "plan_id", label: "گام‌ها", columns: ["seq", "title", "role", "owner_id", "rto_offset_minutes"] },
      { table: "exercise", field: "plan_id", label: "مانورها", columns: ["number", "title", "exercise_type", "state", "scheduled_at", "result"] },
    ],
  },
  list: { columns: ["number", "title", "plan_type", "service_id", "state", "rto", "last_tested_at", "next_review_at"], order: "title" },
  ai: { title: "title", text: ["invocation_criteria", "return_to_normal"] },
};

const planStep: TableDef = {
  key: "plan_step",
  table: "sm_plan_steps",
  label: "گام بازیابی",
  plural: "گام‌های بازیابی",
  icon: "list-ordered",
  module: "continuity",
  area: "continuity",
  description: "یک گام طرح بازیابی با نقش مسئول و زمان هدف از لحظهٔ فعال‌سازی",
  display: "title",
  fields: [
    { name: "plan_id", label: "طرح", type: "ref", ref: "continuity_plan", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "seq", label: "ترتیب", type: "int", min: 1, max: 1000, default: 1, required: true, list: true, sort: true, span: 6 },
    { name: "rto_offset_minutes", label: "انجام تا (دقیقه پس از فعال‌سازی)", type: "int", min: 0, max: 100000, default: 60, list: true, span: 6 },
    { name: "title", label: "گام", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "role", label: "نقش", type: "string", maxLength: 120, list: true, span: 12 },
    { name: "owner_id", label: "مسئول", type: "user", list: true, span: 12 },
    { name: "action", label: "شرح کار", type: "markdown", span: 24 },
    { name: "group_id", label: "تیم بازیابی", type: "group", system: true, hidden: true, audit: false },
  ],
  scope: { own: ["owner_id"], requester: [], group: "group_id" },
  list: { columns: ["plan_id", "seq", "title", "role", "owner_id", "rto_offset_minutes"], order: "plan_id,seq" },
};

const exercise: TableDef = {
  key: "exercise",
  table: "sm_exercises",
  label: "مانور تداوم",
  plural: "مانورهای تداوم",
  icon: "flag",
  module: "continuity",
  area: "continuity",
  description: "آزمون یک طرح (میزگرد، شبیه‌سازی، جابه‌جایی به سایت پشتیبان): سناریو، هدف‌ها، زمان واقعی گام‌ها و بازیابی در برابر RTO/RPO، یافته‌ها",
  numbered: { prefix: "EXR", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24, section: MAIN },
    { name: "plan_id", label: "طرح", type: "ref", ref: "continuity_plan", required: true, list: true, filter: true, index: true, span: 12, section: MAIN },
    { name: "exercise_type", label: "نوع", type: "choice", choices: EXERCISE_TYPES, required: true, default: "tabletop", list: true, filter: true, span: 12, section: MAIN },
    { name: "scheduled_at", label: "زمان برنامه", type: "datetime", required: true, list: true, sort: true, filter: true, span: 8, section: MAIN },
    { name: "started_at", label: "آغاز واقعی", type: "datetime", readonly: true, sort: true, span: 8, section: MAIN },
    { name: "ended_at", label: "پایان", type: "datetime", readonly: true, span: 8, section: MAIN },
    { name: "owner_id", label: "هماهنگ‌کننده", type: "user", default: "$me", filter: true, span: 8, section: MAIN },
    { name: "assignment_group_id", label: "تیم", type: "group", filter: true, span: 8, section: MAIN },
    { name: "participants", label: "شرکت‌کنندگان", type: "users", span: 24, section: MAIN },
    { name: "scenario", label: "سناریو", type: "markdown", span: 24, section: MAIN },
    { name: "objectives", label: "هدف‌ها", type: "markdown", span: 24, section: MAIN },
    { name: "rto_target", label: "RTO هدف", type: "duration", span: 6, section: RESULT },
    { name: "rpo_target", label: "RPO هدف", type: "duration", span: 6, section: RESULT },
    { name: "actual_recovery", label: "زمان واقعی بازیابی", type: "duration", span: 6, section: RESULT },
    { name: "actual_data_loss", label: "دادهٔ ازدست‌رفتهٔ واقعی", type: "duration", span: 6, section: RESULT },
    { name: "rto_met", label: "RTO رعایت شد", type: "bool", readonly: true, default: false, list: true, filter: true, span: 6, section: RESULT },
    { name: "rpo_met", label: "RPO رعایت شد", type: "bool", readonly: true, default: false, filter: true, span: 6, section: RESULT },
    { name: "result", label: "نتیجه", type: "choice", choices: EXERCISE_RESULTS, list: true, filter: true, span: 12, section: RESULT },
    { name: "step_log", label: "زمان گام‌ها", type: "json", readonly: true, hidden: true, audit: false },
    { name: "findings", label: "یافته‌ها", type: "markdown", span: 24, section: RESULT },
    { name: "lessons", label: "درس‌آموخته‌ها و اقدام‌ها", type: "markdown", span: 24, section: RESULT },
  ],
  states: EXERCISE_STATES,
  scope: { own: ["owner_id"], requester: [], group: "assignment_group_id", readers: ["participants"], watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, calendar: { start: "scheduled_at" } },
  form: { sections: [MAIN, RESULT] },
  list: { columns: ["number", "title", "plan_id", "exercise_type", "state", "scheduled_at", "result", "rto_met"], order: "-scheduled_at" },
};

const continuityConfig: TableDef = {
  key: "continuity_config",
  table: "sm_continuity_configs",
  label: "تنظیمات تداوم و دسترس‌پذیری",
  plural: "تنظیمات تداوم و دسترس‌پذیری",
  icon: "settings-2",
  module: "continuity",
  area: "settings",
  description: "روش محاسبهٔ دسترس‌پذیری، بازبینی دوره‌ای طرح‌ها و تحلیل‌های اثر و پیشنهاد قطعی از رخدادهای عمده",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات تداوم", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "exclude_planned", label: "قطعی برنامه‌ریزی‌شده در دسترس‌پذیری شمرده نشود", type: "bool", default: true, span: 12 },
    { name: "degradation_weight", label: "وزن پیش‌فرض افت کیفیت (٪)", type: "int", min: 0, max: 100, default: CONTINUITY_CONFIG_DEFAULTS.degradation_weight, span: 8, help: "وقتی درصد اثر افت کیفیت ثبت نشده باشد" },
    { name: "plan_review_months", label: "بازبینی طرح‌ها هر چند ماه", type: "int", min: 1, max: 60, default: CONTINUITY_CONFIG_DEFAULTS.plan_review_months, span: 8 },
    { name: "bia_review_months", label: "بازبینی تحلیل‌های اثر هر چند ماه", type: "int", min: 1, max: 60, default: CONTINUITY_CONFIG_DEFAULTS.bia_review_months, span: 8 },
    { name: "propose_on_major", label: "پیشنهاد قطعی با اعلام رخداد عمده", type: "bool", default: true, span: 12 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "exclude_planned", "plan_review_months"], order: "name" },
};

export const CONTINUITY_TABLES: TableDef[] = [outage, capacityRecord, bia, continuityPlan, planStep, exercise, continuityConfig];
