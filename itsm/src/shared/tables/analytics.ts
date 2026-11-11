// Analytics, reporting and KPIs (docs/modules/analytics_FA.md): report and dashboard definitions, performance
// indicators and their stored scores, scheduled deliveries and their per-recipient log, and the module's settings.
// Every table is in area `reports`. Definitions are private by default and shared through `shares`, compiled by the
// module's hook into row columns the row rules test (people, groups, units, unit subtrees, role holders, everyone);
// the data behind any definition is always computed with the viewer's own access. Stored scores of org-wide
// indicators are readable only by those the indicator's `score_shares` name. Imported by the UI: pure.
import { NEVER, type Cond } from "../model/conditions";
import type { FieldDef, Option, TableDef } from "../model/types";
import { VIZ, VIZ_TYPES } from "../analytics/model";

export const ANALYTICS_STATUS: Option[] = [
  { value: "draft", label: "پیش‌نویس", color: "gray", order: 1 },
  { value: "published", label: "منتشرشده", color: "green", order: 2 },
  { value: "archived", label: "بایگانی", color: "gold", order: 3 },
];

export const VIZ_OPTIONS: Option[] = VIZ_TYPES.map((v, i) => ({ value: v, label: VIZ[v].label, order: i + 1 }));

export const PRACTICE_OPTIONS: Option[] = [
  { value: "incident", label: "رخداد", color: "red", order: 1 },
  { value: "problem", label: "مشکل", color: "orange", order: 2 },
  { value: "change", label: "تغییر", color: "blue", order: 3 },
  { value: "request", label: "درخواست", color: "teal", order: 4 },
  { value: "knowledge", label: "دانش", color: "purple", order: 5 },
  { value: "sla", label: "سطح خدمت", color: "gold", order: 6 },
  { value: "cmdb", label: "پیکربندی", color: "indigo", order: 7 },
  { value: "release", label: "انتشار و دواپس", color: "magenta", order: 8 },
  { value: "project", label: "پروژه", color: "green", order: 9 },
  { value: "event", label: "رویداد و کشیک", color: "orange", order: 10 },
  { value: "continuity", label: "دسترس‌پذیری و تداوم", color: "green", order: 11 },
  { value: "asset", label: "دارایی و مجوز", color: "indigo", order: 12 },
  { value: "supplier", label: "تأمین‌کننده و قرارداد", color: "teal", order: 13 },
  { value: "financial", label: "مالی", color: "gold", order: 14 },
  { value: "security", label: "امنیت، ریسک و انطباق", color: "red", order: 15 },
  { value: "portal", label: "درگاه و سلف‌سرویس", color: "blue", order: 16 },
  { value: "other", label: "سایر", color: "gray", order: 17 },
];

export const UNIT_OPTIONS: Option[] = [
  { value: "count", label: "تعداد", order: 1 },
  { value: "number", label: "عدد", order: 2 },
  { value: "duration", label: "مدت", order: 3 },
  { value: "percent", label: "درصد", order: 4 },
  { value: "money", label: "مبلغ", order: 5 },
];

export const DIRECTION_OPTIONS: Option[] = [
  { value: "up", label: "بیشتر بهتر است", color: "green", order: 1 },
  { value: "down", label: "کمتر بهتر است", color: "blue", order: 2 },
  { value: "none", label: "بی‌جهت", color: "gray", order: 3 },
];

export const GRAIN_OPTIONS: Option[] = [
  { value: "day", label: "روزانه", order: 1 },
  { value: "week", label: "هفتگی (شنبه تا جمعه)", order: 2 },
  { value: "month", label: "ماهانه (ماه شمسی)", order: 3 },
  { value: "quarter", label: "فصلی", order: 4 },
  { value: "year", label: "سالانه (از ۱ فروردین)", order: 5 },
];

export const KPI_STATUS_OPTIONS: Option[] = [
  { value: "good", label: "در هدف", color: "green", order: 1 },
  { value: "warn", label: "نزدیک آستانه", color: "gold", order: 2 },
  { value: "bad", label: "خارج از آستانه", color: "red", order: 3 },
  { value: "none", label: "بی‌هدف", color: "gray", order: 4 },
];

export const DELIVERY_STATUS: Option[] = [
  { value: "sent", label: "ارسال شد", color: "green", order: 1 },
  { value: "empty", label: "خالی بود؛ ارسال نشد", color: "gray", order: 2 },
  { value: "no_access", label: "گیرنده دسترسی نداشت", color: "gold", order: 3 },
  { value: "failed", label: "ناموفق", color: "red", order: 4 },
];

export const DELIVERY_CHANNELS: Option[] = [
  { value: "in_app", label: "اعلان درون‌برنامه", order: 1 },
  { value: "email", label: "ایمیل", order: 2 },
];

export const DELIVERY_FORMATS: Option[] = [
  { value: "xlsx", label: "پروندهٔ اکسل", order: 1 },
  { value: "summary", label: "خلاصه در متن پیام", order: 2 },
  { value: "link", label: "پیوند نسخهٔ چاپی", order: 3 },
];

const MAIN = "اصلی";
const SHARE = "اشتراک";
const DEF = "تعریف";

/** Who reads a definition: its owner, the people, groups and units it is shared with, role holders, or everyone. */
export const DEFINITION_READ: Cond = {
  or: [
    { f: "owner_id", op: "is_me" },
    { f: "r_all", op: "eq", v: true },
    { f: "r_users", op: "is_me" },
    { f: "r_groups", op: "is_my_group" },
    { f: "r_units", op: "in_my_unit" },
    { f: "r_lines", op: "in_my_unit_line" },
  ],
};

/** Who changes a definition: its owner and editors (people, groups, role holders shared «ویرایش»). */
export const DEFINITION_WRITE: Cond = { or: [{ f: "owner_id", op: "is_me" }, { f: "w_users", op: "is_me" }, { f: "w_groups", op: "is_my_group" }] };

/** The sharing fields of a definition and the columns the module compiles them into (never set by people). */
function sharingFields(): FieldDef[] {
  const sys = (f: FieldDef): FieldDef => ({ ...f, system: true, hidden: true, audit: false });
  return [
    { name: "owner_id", label: "مالک", type: "user", default: "$me", readonly: true, list: true, filter: true, sort: true, span: 8, section: SHARE },
    { name: "shares", label: "اشتراک با", type: "json", default: [], span: 24, section: SHARE, help: "اشتراک تعریف را می‌دهد، نه داده را: هر بیننده فقط رکوردهای مجاز خود را می‌بیند" },
    sys({ name: "r_users", label: "خوانندگان", type: "users" }),
    sys({ name: "r_groups", label: "گروه‌های خواننده", type: "refs", ref: "group" }),
    sys({ name: "r_units", label: "واحدهای خواننده", type: "refs", ref: "org_unit" }),
    sys({ name: "r_lines", label: "واحدهای خواننده با زیرمجموعه", type: "refs", ref: "org_unit" }),
    sys({ name: "r_all", label: "همهٔ خوانندگان گزارش‌ها", type: "bool", default: false }),
    sys({ name: "w_users", label: "ویرایشگران", type: "users" }),
    sys({ name: "w_groups", label: "گروه‌های ویرایشگر", type: "refs", ref: "group" }),
    sys({ name: "role_keys", label: "نقش‌های اشتراک", type: "tags" }),
  ];
}

const report: TableDef = {
  key: "analytics_report",
  table: "sm_analytics_reports",
  label: "گزارش",
  plural: "گزارش‌ها",
  icon: "chart-column",
  module: "analytics",
  area: "reports",
  description: "تعریف یک گزارش روی هر جدول: سنجه‌ها، بُعدها، شرط‌ها، بازهٔ زمانی و نوع نمایش",
  numbered: { prefix: "RPT", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 16, section: MAIN },
    { name: "status", label: "وضعیت", type: "choice", choices: ANALYTICS_STATUS, default: "draft", list: true, filter: true, span: 8, section: MAIN },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24, section: MAIN },
    { name: "folder", label: "پوشه", type: "string", maxLength: 80, list: true, filter: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12, section: MAIN },
    { name: "viz", label: "نمایش", type: "choice", choices: VIZ_OPTIONS, default: "column", readonly: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "certified", label: "تأییدشده", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8, section: MAIN, help: "عددهای این گزارش را مدیر گزارش‌ها تأیید کرده است" },
    { name: "trashed", label: "در سطل بازیافت", type: "bool", default: false, filter: true, span: 8, section: MAIN },
    { name: "trashed_at", label: "زمان انتقال به سطل", type: "datetime", system: true, audit: false },
    { name: "spec", label: "تعریف", type: "json", required: true, span: 24, section: DEF },
    { name: "spec_version", label: "نسخهٔ تعریف", type: "int", default: 1, system: true, audit: false },
    ...sharingFields(),
  ],
  scope: { own: ["owner_id"], requester: [], public: true },
  rowAccess: { read: DEFINITION_READ, write: DEFINITION_WRITE },
  list: { columns: ["number", "name", "table_key", "viz", "folder", "owner_id", "updated_at"], order: "-updated_at" },
  form: { sections: [MAIN, DEF, SHARE] },
};

const dashboard: TableDef = {
  key: "analytics_dashboard",
  table: "sm_analytics_dashboards",
  label: "داشبورد",
  plural: "داشبوردها",
  icon: "layout-dashboard",
  module: "analytics",
  area: "reports",
  description: "ابزارک‌های گزارش و شاخص روی یک صفحهٔ شبکه‌ای، با پالایه‌های سراسری، زبانه‌ها و حالت نمایشگر",
  numbered: { prefix: "DSH", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 16, section: MAIN },
    { name: "status", label: "وضعیت", type: "choice", choices: ANALYTICS_STATUS, default: "published", list: true, filter: true, span: 8, section: MAIN },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24, section: MAIN },
    { name: "folder", label: "پوشه", type: "string", maxLength: 80, list: true, filter: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "is_home", label: "صفحهٔ خانهٔ خوانندگان", type: "bool", default: false, list: true, filter: true, span: 6, section: MAIN, help: "برای هر کسی که آن را می‌بیند و داشبورد خانهٔ فضای کاری خود را ندارد" },
    { name: "home_workspaces", label: "داشبورد خانهٔ فضاهای کاری", type: "refs", ref: "workspace", span: 12, section: MAIN },
    { name: "tv_cycle", label: "گردش زبانه‌ها در حالت نمایشگر (ثانیه)", type: "int", min: 5, max: 600, default: 20, span: 8, section: MAIN },
    { name: "refresh_minutes", label: "تازه‌سازی داده (دقیقه)", type: "int", min: 1, max: 120, default: 5, span: 8, section: MAIN },
    { name: "certified", label: "تأییدشده", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "trashed", label: "در سطل بازیافت", type: "bool", default: false, filter: true, span: 8, section: MAIN },
    { name: "trashed_at", label: "زمان انتقال به سطل", type: "datetime", system: true, audit: false },
    { name: "layout", label: "چیدمان", type: "json", default: { widgets: [] }, span: 24, section: DEF },
    { name: "filters", label: "پالایه‌های سراسری", type: "json", default: [], span: 24, section: DEF },
    { name: "library_key", label: "کلید کتابخانه", type: "string", maxLength: 60, system: true, ltr: true, audit: false },
    ...sharingFields(),
  ],
  scope: { own: ["owner_id"], requester: [], public: true },
  rowAccess: { read: DEFINITION_READ, write: DEFINITION_WRITE },
  list: { columns: ["number", "name", "folder", "is_home", "owner_id", "updated_at"], order: "-updated_at" },
  form: { sections: [MAIN, DEF, SHARE] },
};

const indicator: TableDef = {
  key: "analytics_indicator",
  table: "sm_analytics_indicators",
  label: "شاخص",
  plural: "شاخص‌ها",
  icon: "gauge",
  module: "analytics",
  area: "reports",
  description: "شاخص عملکرد: فرمولی روی سنجه‌های جدول‌ها، با دوره، هدف، آستانه‌ها، تفکیک‌ها و عکس روزانه",
  numbered: { prefix: "KPI", pad: 4 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 16, section: MAIN },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 60, unique: true, ltr: true, list: true, filter: true, search: true, span: 8, section: MAIN, help: "مانند incident.mttr؛ پس از ساخت تغییر نمی‌کند" },
    { name: "description", label: "تعریف و روش سنجش", type: "text", maxLength: 2000, search: true, span: 24, section: MAIN },
    { name: "practice", label: "فرایند", type: "choice", choices: PRACTICE_OPTIONS, default: "other", list: true, filter: true, span: 8, section: MAIN },
    { name: "unit", label: "واحد", type: "choice", choices: UNIT_OPTIONS, default: "count", list: true, filter: true, span: 8, section: MAIN },
    { name: "direction", label: "جهت مطلوب", type: "choice", choices: DIRECTION_OPTIONS, default: "up", filter: true, span: 8, section: MAIN },
    { name: "grain", label: "دورهٔ سنجش", type: "choice", choices: GRAIN_OPTIONS, default: "month", list: true, filter: true, span: 8, section: MAIN },
    { name: "decimals", label: "رقم اعشار", type: "int", min: 0, max: 4, span: 8, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8, section: MAIN },
    { name: "formula", label: "فرمول", type: "string", required: true, maxLength: 500, ltr: true, span: 24, section: DEF, help: "عبارتی روی نام سنجه‌ها، مانند met / finished * 100" },
    { name: "parts", label: "سنجه‌ها", type: "json", required: true, span: 24, section: DEF },
    { name: "breakdowns", label: "بُعدهای تفکیک", type: "tags", span: 24, section: DEF, help: "نام فیلدهایی که همهٔ سنجه‌ها دارند، مانند priority یا assignment_group_id" },
    { name: "target", label: "هدف", type: "decimal", span: 8, section: "هدف و آستانه" },
    { name: "warn", label: "آستانهٔ هشدار (زرد)", type: "decimal", span: 8, section: "هدف و آستانه" },
    { name: "crit", label: "آستانهٔ بحران (قرمز)", type: "decimal", span: 8, section: "هدف و آستانه" },
    { name: "alert_users", label: "آگاه‌سازی هنگام عبور از آستانه", type: "users", span: 24, section: "هدف و آستانه", help: "فقط کسانی که اجازهٔ دیدن امتیازهای ذخیره‌شده را دارند پیام می‌گیرند" },
    { name: "collect", label: "عکس روزانه", type: "bool", default: true, filter: true, span: 8, section: "عکس و دسترسی" },
    { name: "score_shares", label: "خوانندگان امتیازهای ذخیره‌شده", type: "json", default: [], span: 24, section: "عکس و دسترسی", help: "امتیاز ذخیره‌شده عدد کل سازمان است؛ فقط این نقش‌ها، گروه‌ها و افراد آن را می‌بینند" },
    { name: "certified", label: "تأییدشده", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "owner_id", label: "مالک شاخص", type: "user", default: "$me", list: true, filter: true, span: 8, section: MAIN },
    { name: "formula_version", label: "نسخهٔ فرمول", type: "int", default: 1, system: true, audit: false },
    { name: "library_key", label: "کلید کتابخانه", type: "string", maxLength: 60, system: true, ltr: true, audit: false },
    { name: "collected_at", label: "آخرین عکس", type: "datetime", system: true, audit: false },
    { name: "s_users", label: "خوانندگان امتیاز", type: "users", system: true, hidden: true, audit: false },
    { name: "s_groups", label: "گروه‌های خوانندهٔ امتیاز", type: "refs", ref: "group", system: true, hidden: true, audit: false },
    { name: "s_all", label: "امتیاز برای همه", type: "bool", default: false, system: true, hidden: true, audit: false },
    { name: "s_roles", label: "نقش‌های خوانندهٔ امتیاز", type: "tags", system: true, hidden: true, audit: false },
  ],
  scope: { own: ["owner_id"], requester: [], public: true },
  list: { columns: ["number", "name", "key", "practice", "unit", "grain", "certified"], order: "practice,name" },
  form: { sections: [MAIN, DEF, "هدف و آستانه", "عکس و دسترسی"] },
};

const score: TableDef = {
  key: "analytics_score",
  table: "sm_analytics_scores",
  label: "امتیاز شاخص",
  plural: "امتیازهای شاخص",
  icon: "chart-spline",
  module: "analytics",
  area: "reports",
  description: "عکس ذخیره‌شدهٔ یک شاخص در یک دوره (کل سازمان، یا یک عنصر تفکیک)؛ فقط خوانندگانی که شاخص نام می‌برد",
  display: "period_label",
  fields: [
    { name: "indicator_id", label: "شاخص", type: "ref", ref: "analytics_indicator", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "indicator_key", label: "کلید شاخص", type: "string", maxLength: 60, ltr: true, filter: true, span: 12 },
    { name: "formula_version", label: "نسخهٔ فرمول", type: "int", default: 1, filter: true, span: 6 },
    { name: "grain", label: "دوره", type: "choice", choices: GRAIN_OPTIONS, default: "month", filter: true, span: 6 },
    { name: "period_key", label: "کلید دوره", type: "string", maxLength: 20, ltr: true, list: true, filter: true, sort: true, span: 6 },
    { name: "period_label", label: "دوره", type: "string", maxLength: 60, list: true, span: 6 },
    { name: "period_start", label: "آغاز دوره", type: "date", sort: true, filter: true, span: 6 },
    { name: "period_end", label: "پایان دوره (بعد از آخرین روز)", type: "date", span: 6 },
    { name: "breakdown", label: "بُعد تفکیک", type: "string", maxLength: 60, ltr: true, filter: true, list: true, span: 6 },
    { name: "element", label: "عنصر", type: "string", maxLength: 120, ltr: true, filter: true, span: 6 },
    { name: "element_label", label: "عنوان عنصر", type: "string", maxLength: 200, list: true, span: 12 },
    { name: "value", label: "مقدار", type: "decimal", list: true, sort: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: KPI_STATUS_OPTIONS, default: "none", list: true, filter: true, span: 6 },
    { name: "n", label: "رکوردهای پایه", type: "int", default: 0, span: 6 },
    { name: "parts", label: "مقدار سنجه‌ها", type: "json", span: 24 },
    { name: "final", label: "دورهٔ بسته", type: "bool", default: false, filter: true, span: 6 },
    { name: "collected_at", label: "زمان عکس", type: "datetime", sort: true, span: 6 },
    { name: "ids", label: "رکوردهای سازنده", type: "json", hidden: true, audit: false },
    { name: "s_users", label: "خوانندگان", type: "users", system: true, hidden: true, audit: false },
    { name: "s_groups", label: "گروه‌های خواننده", type: "refs", ref: "group", system: true, hidden: true, audit: false },
    { name: "s_all", label: "برای همه", type: "bool", default: false, system: true, hidden: true, audit: false },
  ],
  scope: { own: [], requester: [], public: true },
  rowAccess: { read: { or: [{ f: "s_all", op: "eq", v: true }, { f: "s_users", op: "is_me" }, { f: "s_groups", op: "is_my_group" }] }, write: NEVER },
  unique: [["indicator_id", "formula_version", "period_key", "breakdown", "element"]],
  features: { history: false },
  list: { columns: ["indicator_id", "period_label", "breakdown", "element_label", "value", "status", "collected_at"], order: "-period_key" },
};

const schedule: TableDef = {
  key: "analytics_schedule",
  table: "sm_analytics_schedules",
  label: "ارسال زمان‌بندی‌شده",
  plural: "ارسال‌های زمان‌بندی‌شده",
  icon: "calendar-clock",
  module: "analytics",
  area: "reports",
  description: "فرستادن یک گزارش یا داشبورد در زمان‌های تکرارشونده؛ برای هر گیرنده با دسترسی خود او ساخته می‌شود",
  numbered: { prefix: "SCD", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, span: 16, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "report_id", label: "گزارش", type: "ref", ref: "analytics_report", list: true, filter: true, span: 12, section: MAIN },
    { name: "dashboard_id", label: "داشبورد", type: "ref", ref: "analytics_dashboard", list: true, filter: true, span: 12, section: MAIN },
    { name: "schedule", label: "زمان‌بندی", type: "json", required: true, default: { kind: "weekly", time: "08:00", weekdays: [0] }, span: 24, section: MAIN },
    { name: "recipients", label: "گیرندگان", type: "users", span: 24, section: "گیرندگان" },
    { name: "recipient_groups", label: "گروه‌های گیرنده", type: "refs", ref: "group", span: 24, section: "گیرندگان" },
    { name: "include_owner", label: "برای خودم هم بفرست", type: "bool", default: true, span: 8, section: "گیرندگان" },
    { name: "channels", label: "کانال‌ها", type: "multichoice", choices: DELIVERY_CHANNELS, default: ["in_app", "email"], span: 12, section: "گیرندگان" },
    { name: "formats", label: "قالب‌ها", type: "multichoice", choices: DELIVERY_FORMATS, default: ["xlsx", "summary", "link"], span: 12, section: "گیرندگان" },
    { name: "skip_if_empty", label: "اگر خالی بود نفرست", type: "bool", default: true, span: 8, section: "گیرندگان" },
    { name: "message", label: "پیام همراه", type: "text", maxLength: 1000, span: 24, section: "گیرندگان" },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", readonly: true, list: true, filter: true, span: 8, section: MAIN },
    { name: "next_run_at", label: "ارسال بعدی", type: "datetime", system: true, list: true, sort: true, audit: false },
    { name: "last_run_at", label: "آخرین ارسال", type: "datetime", system: true, sort: true, audit: false },
    { name: "last_result", label: "نتیجهٔ آخرین ارسال", type: "string", maxLength: 300, system: true, audit: false },
  ],
  scope: { own: ["owner_id"], requester: [], public: true },
  rowAccess: { read: { f: "owner_id", op: "is_me" }, write: { f: "owner_id", op: "is_me" } },
  list: { columns: ["number", "name", "report_id", "dashboard_id", "active", "next_run_at", "owner_id"], order: "-updated_at" },
  form: { sections: [MAIN, "گیرندگان"] },
};

const delivery: TableDef = {
  key: "analytics_delivery",
  table: "sm_analytics_deliveries",
  label: "گزارش تحویل‌شده",
  plural: "گزارش‌های تحویل‌شده",
  icon: "inbox",
  module: "analytics",
  area: "reports",
  description: "یک ارسال برای یک گیرنده: با دسترسی خود او ساخته شده و فقط خود او آن را می‌بیند (شاهد تحویل)",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "recipient_id", label: "گیرنده", type: "user", required: true, list: true, filter: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: DELIVERY_STATUS, default: "sent", list: true, filter: true, span: 8 },
    { name: "delivered_at", label: "زمان", type: "datetime", list: true, sort: true, span: 8 },
    { name: "schedule_id", label: "زمان‌بندی", type: "ref", ref: "analytics_schedule", filter: true, span: 12 },
    { name: "report_id", label: "گزارش", type: "ref", ref: "analytics_report", filter: true, span: 12 },
    { name: "dashboard_id", label: "داشبورد", type: "ref", ref: "analytics_dashboard", filter: true, span: 12 },
    { name: "rows", label: "تعداد سطرها", type: "int", default: 0, span: 6 },
    { name: "summary", label: "خلاصه", type: "markdown", span: 24 },
    { name: "error", label: "خطا", type: "text", maxLength: 1000, span: 24 },
  ],
  scope: { own: ["recipient_id"], requester: [], public: true },
  rowAccess: { read: { f: "recipient_id", op: "is_me" }, write: NEVER },
  features: { attachments: true, history: false },
  list: { columns: ["title", "status", "delivered_at", "rows"], order: "-delivered_at" },
};

export const ANALYTICS_CONFIG_DEFAULTS = {
  small_cell_k: 0,
  snapshot_hour: 2,
  keep_days: 730,
  backfill_periods: 6,
};
export type AnalyticsConfig = typeof ANALYTICS_CONFIG_DEFAULTS;

const config: TableDef = {
  key: "analytics_config",
  table: "sm_analytics_configs",
  label: "تنظیمات گزارش‌ها",
  plural: "تنظیمات گزارش‌ها",
  icon: "settings-2",
  module: "analytics",
  area: "reports",
  description: "حریم خصوصی تجمیع، ساعت عکس روزانهٔ شاخص‌ها و نگهداری امتیازها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات گزارش‌ها", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "small_cell_k", label: "کمینهٔ رکورد هر خانه (k)", type: "int", min: 0, max: 50, default: ANALYTICS_CONFIG_DEFAULTS.small_cell_k, span: 8, help: "گروه‌هایی با رکورد کمتر از این عدد بدون مقدار نشان داده می‌شوند؛ صفر: خاموش" },
    { name: "snapshot_hour", label: "ساعت عکس روزانه", type: "int", min: 0, max: 23, default: ANALYTICS_CONFIG_DEFAULTS.snapshot_hour, span: 8 },
    { name: "keep_days", label: "نگهداری امتیازها (روز)", type: "int", min: 90, max: 3650, default: ANALYTICS_CONFIG_DEFAULTS.keep_days, span: 8 },
    { name: "backfill_periods", label: "دوره‌های پیشین در نخستین عکس", type: "int", min: 0, max: 24, default: ANALYTICS_CONFIG_DEFAULTS.backfill_periods, span: 8 },
    { name: "last_snapshot_on", label: "آخرین عکس روزانه", type: "date", system: true, audit: false },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
};

export const ANALYTICS_TABLES: TableDef[] = [report, dashboard, indicator, score, schedule, delivery, config];

/** The tables whose rows are definitions shared through `shares`. */
export const SHARED_DEFINITIONS = ["analytics_report", "analytics_dashboard"] as const;
