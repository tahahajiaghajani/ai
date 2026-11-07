// Tables of the SLA service (docs/spec/services/sla.md): working calendars and holidays, SLA definitions and the
// timers attached to records (task SLAs). Configuration is ordinary engine records — generic lists and forms,
// history, sync and permissions — read in full by everyone with a read grant in the `sla` area (`scope.public`:
// reference data the SLA engine, the editors and the Windows app need). Task SLAs are written by the engine only
// (src/server/modules/sla). The approval and rule tables of the same service live in ./approvals and ./rules.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { DEFAULT_HOURS } from "../sla/calendar";
import { APPROVAL_TABLES } from "./approvals";
import { RULE_TABLES, RULE_CHOICE_LISTS } from "./rules";

export const HOLIDAY_SETS: Option[] = [
  { value: "ir", label: "تعطیلات رسمی ایران", color: "red", order: 1 },
  { value: "org", label: "تعطیلات سازمان", color: "blue", order: 2 },
];

export const HOLIDAY_KINDS: Option[] = [
  { value: "solar", label: "رسمی خورشیدی", color: "orange" },
  { value: "lunar", label: "رسمی قمری", color: "teal" },
  { value: "org", label: "سازمانی", color: "blue" },
  { value: "other", label: "دیگر", color: "gray" },
];

export const HOLIDAY_SOURCES: Option[] = [
  { value: "bundled", label: "تقویم رسمی همراه برنامه" },
  { value: "manual", label: "دستی" },
];

export const SLA_TYPES: Option[] = [
  { value: "sla", label: "توافق سطح خدمت (SLA)", color: "blue" },
  { value: "ola", label: "توافق سطح عملیات (OLA)", color: "teal" },
  { value: "uc", label: "قرارداد پشتیبان (UC)", color: "purple" },
];

export const SLA_TARGETS: Option[] = [
  { value: "response", label: "پاسخ" },
  { value: "resolution", label: "حل" },
  { value: "custom", label: "سفارشی" },
];

export const DURATION_MODES: Option[] = [
  { value: "priority", label: "به ازای اولویت" },
  { value: "fixed", label: "ثابت" },
];

export const TZ_SOURCES: Option[] = [
  { value: "calendar", label: "تقویم کاری" },
  { value: "org", label: "سازمان" },
  { value: "caller", label: "درخواست‌دهنده" },
  { value: "location", label: "مکان رکورد" },
];

export const SLA_STAGES: Option[] = [
  { value: "in_progress", label: "در جریان", color: "teal" },
  { value: "paused", label: "متوقف", color: "gold" },
  { value: "achieved", label: "در موعد انجام شد", color: "green" },
  { value: "breached", label: "نقض شد", color: "red" },
  { value: "canceled", label: "لغو شد", color: "gray" },
];

const calendar: TableDef = {
  key: "calendar",
  table: "sm_calendars",
  label: "تقویم کاری",
  plural: "تقویم‌های کاری",
  icon: "calendar-clock",
  module: "sla",
  area: "sla",
  description: "ساعات کاری هفته، منطقهٔ زمانی و مجموعه‌های تعطیلات؛ پایهٔ محاسبهٔ زمان کاری توافق‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "timezone", label: "منطقهٔ زمانی", type: "string", required: true, maxLength: 60, default: "Asia/Tehran", list: true, ltr: true, span: 12 },
    { name: "hours", label: "ساعات کاری هفته", type: "json", required: true, default: DEFAULT_HOURS, span: 24, help: "هفت فهرست از شنبه تا جمعه؛ هر بازه [«۰۸:۰۰»، «۱۶:۰۰»]؛ پایان پیش از شروع یعنی شیفت شبانه" },
    { name: "holiday_sets", label: "مجموعه‌های تعطیلات", type: "multichoice", choices: "holiday.set", default: ["ir"], span: 12 },
    { name: "is_default", label: "تقویم پیش‌فرض", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "timezone", "is_default", "active"], order: "name" },
};

const holiday: TableDef = {
  key: "holiday",
  table: "sm_holidays",
  label: "تعطیلی",
  plural: "تعطیلات",
  icon: "calendar-x",
  module: "sla",
  area: "sla",
  description: "روزهای تعطیل (کامل یا نیمه‌تعطیل) در مجموعه‌هایی که تقویم‌های کاری به کار می‌برند",
  display: "title",
  fields: [
    { name: "date", label: "تاریخ", type: "date", required: true, list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "title", label: "مناسبت", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "holiday_set", label: "مجموعه", type: "choice", choices: "holiday.set", default: "ir", required: true, list: true, filter: true, span: 8 },
    { name: "half_day", label: "نیمه‌تعطیل", type: "bool", default: false, list: true, filter: true, span: 8, help: "فقط نیمهٔ نخست زمان کاری آن روز کاری است" },
    { name: "kind", label: "نوع", type: "choice", choices: HOLIDAY_KINDS, default: "org", filter: true, span: 8 },
    { name: "predicted", label: "پیش‌بینی", type: "bool", default: false, list: true, filter: true, span: 8, help: "تاریخ قمری پیش‌بینی‌شده؛ پس از انتشار تقویم رسمی آن را تأیید یا جابه‌جا کنید" },
    { name: "alternative_date", label: "روز جایگزین احتمالی", type: "date", span: 8 },
    { name: "hijri", label: "تاریخ قمری", type: "string", maxLength: 10, ltr: true, span: 8 },
    { name: "note", label: "یادداشت", type: "string", maxLength: 300, span: 24 },
    { name: "year", label: "سال", type: "int", system: true, filter: true, sort: true, span: 8 },
    { name: "source", label: "منبع", type: "choice", choices: HOLIDAY_SOURCES, default: "manual", readonly: true, filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
  ],
  unique: [["holiday_set", "date"]],
  scope: { public: true },
  features: { calendar: { start: "date" } },
  list: { columns: ["date", "title", "holiday_set", "half_day", "predicted", "active"], order: "date" },
};

const COND_HELP = "روی رکوردهای جدول همین تعریف؛ خالی برای شروع یعنی همیشه";

const slaDefinition: TableDef = {
  key: "sla_definition",
  table: "sm_sla_definitions",
  label: "تعریف توافق سطح خدمت",
  plural: "تعریف‌های توافق سطح خدمت",
  icon: "timer",
  module: "sla",
  area: "sla",
  description: "هدف پاسخ یا حل یک جدول: مدت به ازای اولویت، تقویم کاری، شرط‌های شروع و توقف، هشدارها و اقدام‌های نقض",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12, help: "کلید جدولی که این توافق روی رکوردهای آن اجرا می‌شود (مانند todo یا incident)" },
    { name: "type", label: "نوع", type: "choice", choices: SLA_TYPES, default: "sla", list: true, filter: true, span: 8 },
    { name: "target", label: "هدف", type: "choice", choices: SLA_TARGETS, default: "resolution", list: true, filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "duration_mode", label: "تعیین مدت", type: "choice", choices: DURATION_MODES, default: "priority", span: 8, section: "مدت و تقویم" },
    { name: "duration", label: "مدت ثابت", type: "duration", min: 0, span: 8, section: "مدت و تقویم" },
    { name: "priority_field", label: "فیلد اولویت", type: "string", maxLength: 60, default: "priority", ltr: true, span: 8, section: "مدت و تقویم" },
    { name: "durations", label: "مدت به ازای اولویت (ثانیه)", type: "json", span: 24, section: "مدت و تقویم" },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 12, section: "مدت و تقویم", help: "خالی: شبانه‌روزی، همهٔ روزهای هفته" },
    { name: "timezone_source", label: "منطقهٔ زمانی", type: "choice", choices: TZ_SOURCES, default: "calendar", span: 12, section: "مدت و تقویم" },
    { name: "start_condition", label: "شرط شروع", type: "conditions", condTableField: "table_key", rules: true, span: 24, section: "شرط‌ها", help: COND_HELP },
    { name: "pause_condition", label: "شرط توقف موقت", type: "conditions", condTableField: "table_key", rules: true, span: 24, section: "شرط‌ها" },
    { name: "stop_condition", label: "شرط پایان", type: "conditions", condTableField: "table_key", rules: true, span: 24, section: "شرط‌ها" },
    { name: "reset_condition", label: "شرط شروع دوباره", type: "conditions", condTableField: "table_key", rules: true, span: 24, section: "شرط‌ها" },
    { name: "cancel_condition", label: "شرط لغو", type: "conditions", condTableField: "table_key", rules: true, span: 24, section: "شرط‌ها" },
    { name: "retroactive", label: "شروع از گذشته", type: "bool", default: false, span: 8, section: "شرط‌ها" },
    { name: "retroactive_field", label: "زمان شروع از فیلد", type: "string", maxLength: 60, ltr: true, span: 16, section: "شرط‌ها", help: "فیلد تاریخ و ساعت رکورد (مانند opened_at)" },
    { name: "warn_percents", label: "آستانه‌های هشدار (درصد)", type: "json", default: [50, 75, 90], span: 12, section: "هشدار و نقض" },
    { name: "breach_actions", label: "اقدام‌های هنگام نقض", type: "json", default: [], span: 24, section: "هشدار و نقض" },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", span: 12, section: "دامنه" },
    { name: "customer_unit_id", label: "مشتری (واحد سازمانی)", type: "ref", ref: "org_unit", span: 12, section: "دامنه" },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  unique: [["table_key", "name"]],
  scope: { public: true },
  form: { sections: ["اصلی", "مدت و تقویم", "شرط‌ها", "هشدار و نقض", "دامنه"] },
  list: { columns: ["name", "table_key", "type", "target", "active"], order: "table_key,sort_order,name" },
};

const taskSla: TableDef = {
  key: "task_sla",
  table: "sm_task_slas",
  label: "زمان‌سنج توافق",
  plural: "زمان‌سنج‌های توافق",
  icon: "hourglass",
  module: "sla",
  area: "sla",
  description: "توافق‌هایی که به رکوردها پیوسته‌اند: شروع، توقف‌ها، موعد، نقض؛ فقط سامانه آن‌ها را می‌نویسد",
  display: "name",
  fields: [
    { name: "name", label: "توافق", type: "string", readonly: true, maxLength: 150, list: true, search: true, span: 12 },
    { name: "definition_id", label: "تعریف توافق", type: "ref", ref: "sla_definition", readonly: true, filter: true, index: true, span: 12 },
    { name: "table_key", label: "جدول", type: "string", readonly: true, maxLength: 60, filter: true, ltr: true, span: 8 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", readonly: true, maxLength: 36, ltr: true, index: true, span: 8 },
    { name: "record_number", label: "رکورد", type: "string", readonly: true, maxLength: 40, list: true, search: true, ltr: true, span: 8 },
    { name: "type", label: "نوع", type: "choice", choices: SLA_TYPES, readonly: true, filter: true, span: 8 },
    { name: "target", label: "هدف", type: "choice", choices: SLA_TARGETS, readonly: true, filter: true, span: 8 },
    { name: "stage", label: "مرحله", type: "choice", choices: SLA_STAGES, default: "in_progress", readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "active", label: "در جریان", type: "bool", default: true, readonly: true, filter: true, span: 8 },
    { name: "breached", label: "نقض شده", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8 },
    { name: "start_at", label: "شروع", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8 },
    { name: "planned_end_at", label: "موعد", type: "datetime", readonly: true, list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "stop_at", label: "پایان", type: "datetime", readonly: true, sort: true, filter: true, span: 8 },
    { name: "breached_at", label: "زمان نقض", type: "datetime", readonly: true, sort: true, filter: true, span: 8 },
    { name: "pause_started_at", label: "متوقف از", type: "datetime", readonly: true, span: 8 },
    { name: "paused_total", label: "زمان کاری توقف", type: "duration", readonly: true, default: 0, span: 8 },
    { name: "duration", label: "مدت هدف (زمان کاری)", type: "duration", readonly: true, span: 8 },
    { name: "business_elapsed", label: "زمان کاری سپری‌شده", type: "duration", readonly: true, default: 0, audit: false, span: 8 },
    { name: "percent", label: "سهم سپری‌شده (درصد)", type: "percent", readonly: true, audit: false, list: true, sort: true, span: 8 },
    { name: "warned", label: "آخرین هشدار (درصد)", type: "int", readonly: true, default: 0, span: 8 },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", readonly: true, span: 8 },
    { name: "timezone", label: "منطقهٔ زمانی", type: "string", readonly: true, maxLength: 60, ltr: true, span: 8 },
    { name: "computed_at", label: "زمان محاسبه", type: "datetime", readonly: true, audit: false, span: 8 },
  ],
  scope: {},
  list: { columns: ["record_number", "name", "stage", "planned_end_at", "percent", "breached"], order: "-start_at" },
};

export const SLA_TABLES: TableDef[] = [calendar, holiday, slaDefinition, taskSla];

/** Every table of the SLA service (calendars, SLAs, approvals, rules); listed once in MODULE_TABLES. */
export const SLA_SERVICE_TABLES: TableDef[] = [...SLA_TABLES, ...APPROVAL_TABLES, ...RULE_TABLES];

/** Default options of the service's choice lists (organisations add their own sets in «فهرست‌های گزینه»). */
export const SLA_CHOICE_LISTS: Record<string, Option[]> = {
  "holiday.set": HOLIDAY_SETS,
  ...RULE_CHOICE_LISTS,
};
