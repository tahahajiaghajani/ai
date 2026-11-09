// Tables of the tenant administration console (docs/modules/admin_FA.md; catalogue module «admin»):
//   · the slots of custom tables (`custom_01` … `custom_10`, area «custom»): real engine tables an organisation gives a
//     meaning in the studio — a name, a code and its own `u_*` fields (ordinary custom_field rows). Every engine path
//     works on them (DDL from the additive schema reconciliation, sync, history, access, the generated AI tools).
//   · admin_config — the organisation's console settings: the seed marker, onboarding steps marked done by hand and the
//     tenant administrator's switches of feature flags
//   · custom_table / studio_version — the studio: what each used slot means, and versioned snapshots of a table's
//     definition (restore, export and import between organisations as JSON)
//   · import_set (IMP) / transform_map — spreadsheet imports with a transform map, by hand or on a schedule
//   · data_export (DEX) — full or partial exports, made with the requester's access, files attached to the row
//   · licence_pool — seats by kind (agents, administrators…); consumption is computed from roles
//   · system_notice — notices to every member (the platform owner's announcements and the organisation's own)
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { registerArea } from "../access/areas";
import { CUSTOM_SLOTS, STUDIO_ICONS, slotPrefix } from "../admin/studio";

registerArea({ key: "custom", label: "جدول‌های سفارشی", group: "business", module: "admin" });

const faNum = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

export const SLOT_OPTIONS: Option[] = CUSTOM_SLOTS.map((s, i) => ({ value: s, label: `جایگاه ${faNum(i + 1)}` }));

const CUSTOM_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "in_progress", label: "در جریان", category: "active", color: "gold" },
    { value: "done", label: "انجام شد", category: "closed", color: "green" },
    { value: "canceled", label: "لغو شد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "in_progress", label: "شروع" },
    { from: ["open", "in_progress"], to: "done", label: "انجام شد" },
    { from: ["open", "in_progress"], to: "canceled", label: "لغو" },
    { from: ["done", "canceled"], to: "open", label: "بازگشایی" },
  ],
};

/** A slot of a custom table: the same in every organisation; its meaning and fields are each organisation's data. */
function slot(key: string, i: number): TableDef {
  return {
    key,
    table: `sm_${key}`,
    label: `جدول سفارشی ${faNum(i + 1)}`,
    plural: `جدول سفارشی ${faNum(i + 1)}`,
    icon: "table",
    module: "admin",
    area: "custom",
    description: "جدولی که سازمان در استودیو تعریف کرده است؛ نام و فیلدهای آن در «استودیو» آمده است",
    numbered: { prefix: slotPrefix(key), pad: 6 },
    display: "title",
    fields: [
      { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24 },
      { name: "owner_id", label: "مسئول", type: "user", default: "$me", list: true, filter: true, span: 12 },
      { name: "group_id", label: "گروه", type: "group", filter: true, span: 12 },
      { name: "description", label: "شرح", type: "markdown", span: 24 },
    ],
    states: CUSTOM_STATES,
    scope: { own: ["owner_id", "created_by"], requester: ["created_by"], group: "group_id" },
    features: { journal: true, attachments: true, links: true, watchers: true, kanban: "state" },
    ai: { title: "title", text: ["description"] },
    list: { columns: ["number", "title", "state", "owner_id", "updated_at"], order: "-updated_at" },
  };
}

export const CUSTOM_TABLES: TableDef[] = CUSTOM_SLOTS.map(slot);

const config: TableDef = {
  key: "admin_config",
  table: "sm_admin_config",
  label: "تنظیمات کنسول مدیریت",
  plural: "تنظیمات کنسول مدیریت",
  icon: "sliders-horizontal",
  module: "admin",
  area: "settings",
  description: "نشانهٔ پیش‌فرض‌های افزوده، گام‌های راه‌اندازی انجام‌شده و کلیدهای قابلیت سازمان",
  display: "key",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 20, default: "main", ltr: true, system: true, span: 12 },
    { name: "seeded", label: "نسخهٔ پیش‌فرض‌ها", type: "int", default: 0, system: true, audit: false, span: 12 },
    { name: "onboarding", label: "گام‌های راه‌اندازی", type: "json", default: {}, span: 24 },
    { name: "flags", label: "کلیدهای قابلیت سازمان", type: "json", default: {}, span: 24 },
  ],
  unique: [["key"]],
  scope: {},
  list: { columns: ["key", "seeded", "updated_at"], order: "key" },
};

const customTable: TableDef = {
  key: "custom_table",
  table: "sm_custom_tables",
  label: "جدول سفارشی",
  plural: "جدول‌های سفارشی",
  icon: "table-properties",
  module: "admin",
  area: "settings",
  description: "معنای هر جایگاه جدول سفارشی در این سازمان: نام، کد پایدار، نماد و نسخهٔ منتشرشده",
  display: "label",
  fields: [
    { name: "label", label: "نام", type: "string", required: true, maxLength: 60, list: true, search: true, sort: true, span: 12 },
    { name: "plural", label: "نام جمع", type: "string", required: true, maxLength: 70, span: 12 },
    { name: "code", label: "کد پایدار", type: "string", required: true, maxLength: 30, ltr: true, list: true, span: 12, help: "حرف کوچک لاتین، رقم و _؛ در خروجی و ورود میان سازمان‌ها همین کد جدول را می‌شناساند" },
    { name: "slot", label: "جایگاه", type: "choice", choices: SLOT_OPTIONS, required: true, list: true, filter: true, readonly: true, span: 12 },
    { name: "icon", label: "نماد", type: "choice", choices: STUDIO_ICONS.map((i) => ({ value: i, label: i })), default: "table", span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 12 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24, help: "برای اعضا و برای ابزارهای هوش مصنوعی" },
    { name: "revision", label: "نسخهٔ منتشرشده", type: "int", default: 0, system: true, list: true, span: 12 },
    { name: "published_at", label: "آخرین انتشار", type: "datetime", system: true, span: 12 },
  ],
  unique: [["slot"], ["code"]],
  scope: {},
  list: { columns: ["label", "code", "slot", "revision", "active"], order: "label" },
};

const studioVersion: TableDef = {
  key: "studio_version",
  table: "sm_studio_versions",
  label: "نسخهٔ استودیو",
  plural: "نسخه‌های استودیو",
  icon: "history",
  module: "admin",
  area: "settings",
  description: "تصویر یک جدول سفارشی (نام، فیلدها، چیدمان فرم و فهرست‌های گزینه) هنگام انتشار؛ قابل بازگردانی و خروجی",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 24 },
    { name: "table_code", label: "کد جدول", type: "string", required: true, maxLength: 30, ltr: true, list: true, filter: true, span: 12 },
    { name: "revision", label: "شمارهٔ نسخه", type: "int", required: true, list: true, sort: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: [{ value: "publish", label: "انتشار" }, { value: "import", label: "ورود از بسته" }, { value: "restore", label: "بازگردانی" }], default: "publish", list: true, span: 12 },
    { name: "note", label: "یادداشت", type: "string", maxLength: 300, span: 24 },
    { name: "snapshot", label: "تصویر تعریف", type: "json", system: true, span: 24 },
  ],
  scope: {},
  list: { columns: ["title", "table_code", "revision", "kind", "created_at"], order: "-created_at" },
};

export const IMPORT_STATUS: Option[] = [
  { value: "new", label: "تازه", color: "gray" },
  { value: "analyzed", label: "آمادهٔ اجرا", color: "blue" },
  { value: "running", label: "در حال اجرا", color: "gold" },
  { value: "done", label: "انجام شد", color: "green" },
  { value: "failed", label: "ناموفق", color: "red" },
];

const importSet: TableDef = {
  key: "import_set",
  table: "sm_import_sets",
  label: "مجموعهٔ ورود داده",
  plural: "مجموعه‌های ورود داده",
  icon: "file-input",
  module: "admin",
  area: "settings",
  description: "یک فایل CSV یا اکسل (یا نشانی آن برای ورود زمان‌بندی‌شده) و نقشهٔ تبدیلی که ستون‌هایش را به فیلدهای یک جدول می‌برد",
  numbered: { prefix: "IMP", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "target_table", label: "جدول مقصد", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 12 },
    { name: "transform_map_id", label: "نقشهٔ تبدیل", type: "ref", ref: "transform_map", list: true, span: 12 },
    { name: "source", label: "منبع", type: "choice", choices: [{ value: "upload", label: "فایل پیوست" }, { value: "url", label: "نشانی وب (زمان‌بندی‌شده)" }], default: "upload", span: 12 },
    { name: "source_url", label: "نشانی فایل", type: "url", span: 24, help: "CSV یا XLSX که در هر اجرا دوباره خوانده می‌شود" },
    { name: "schedule_hours", label: "تکرار هر چند ساعت", type: "int", min: 0, max: 720, default: 0, span: 12, help: "۰: فقط با دست" },
    { name: "status", label: "وضعیت", type: "choice", choices: IMPORT_STATUS, default: "new", system: true, list: true, filter: true, span: 12 },
    { name: "headers", label: "ستون‌های فایل", type: "json", system: true, span: 24 },
    { name: "sample", label: "نمونهٔ ردیف‌ها", type: "json", system: true, span: 24 },
    { name: "rows_total", label: "شمار ردیف‌ها", type: "int", system: true, span: 8 },
    { name: "stats", label: "نتیجهٔ آخرین اجرا", type: "json", system: true, span: 24 },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", system: true, list: true, sort: true, span: 8 },
    { name: "next_run_at", label: "اجرای بعد", type: "datetime", system: true, span: 8 },
    { name: "last_error", label: "آخرین خطا", type: "text", system: true, span: 24 },
  ],
  scope: {},
  features: { attachments: true },
  list: { columns: ["number", "name", "target_table", "status", "last_run_at"], order: "-updated_at" },
};

const transformMap: TableDef = {
  key: "transform_map",
  table: "sm_transform_maps",
  label: "نقشهٔ تبدیل",
  plural: "نقشه‌های تبدیل",
  icon: "arrow-right-left",
  module: "admin",
  area: "settings",
  description: "کدام ستون به کدام فیلد، با چه تبدیلی (جایگزینی مقدارها، مقدار ثابت، چسباندن ستون‌ها…) و با کدام فیلد کلید برای به‌روزرسانی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "target_table", label: "جدول مقصد", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 12 },
    { name: "rules", label: "قاعده‌ها", type: "json", default: [], span: 24 },
    { name: "key_field", label: "فیلد کلید", type: "string", maxLength: 64, ltr: true, span: 12, help: "رکوردهایی که این فیلدشان برابر است به‌روز می‌شوند (مثلاً number)" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 12 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "target_table", "key_field", "active"], order: "name" },
};

export const EXPORT_STATUS: Option[] = [
  { value: "queued", label: "در صف", color: "gray" },
  { value: "running", label: "در حال ساخت", color: "gold" },
  { value: "ready", label: "آماده", color: "green" },
  { value: "failed", label: "ناموفق", color: "red" },
  { value: "expired", label: "منقضی", color: "gray" },
];

export const EXPORT_FORMATS: Option[] = [
  { value: "json", label: "JSON (همهٔ جدول‌ها در یک فایل)" },
  { value: "csv", label: "CSV (هر جدول یک فایل)" },
  { value: "xlsx", label: "اکسل (هر جدول یک برگه)" },
];

const MINE = { or: [{ f: "created_by", op: "is_me" as const }, { f: "requested_for", op: "is_me" as const }] };

const dataExport: TableDef = {
  key: "data_export",
  table: "sm_data_exports",
  label: "خروجی داده",
  plural: "خروجی‌های داده",
  icon: "download",
  module: "admin",
  area: "settings",
  description: "خروجی جدول‌ها با دسترسی درخواست‌کننده (یا کاربر یکپارچه‌سازی یک برنامهٔ زمان‌بندی‌شده)؛ فایل‌ها پیوست همین ردیف‌اند",
  numbered: { prefix: "DEX", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 24 },
    { name: "tables", label: "جدول‌ها", type: "tags", required: true, list: true, span: 24 },
    { name: "format", label: "قالب", type: "choice", choices: EXPORT_FORMATS, default: "json", list: true, span: 12 },
    { name: "include_journal", label: "یادداشت‌ها هم بیاید", type: "bool", default: false, span: 12 },
    { name: "status", label: "وضعیت", type: "choice", choices: EXPORT_STATUS, default: "queued", system: true, list: true, filter: true, span: 12 },
    { name: "requested_for", label: "برای", type: "user", system: true, span: 12 },
    { name: "schedule_id", label: "برنامهٔ زمان‌بندی", type: "ref", ref: "export_schedule", system: true, span: 12 },
    { name: "stats", label: "جزئیات", type: "json", system: true, span: 24 },
    { name: "error", label: "خطا", type: "text", system: true, span: 24 },
    { name: "expires_at", label: "انقضا", type: "datetime", system: true, list: true, span: 12 },
  ],
  scope: { own: ["created_by", "requested_for"] },
  rowAccess: { read: MINE, write: MINE },
  features: { attachments: true },
  list: { columns: ["number", "title", "format", "status", "created_at"], order: "-created_at" },
};

export const LICENCE_KINDS: Option[] = [
  { value: "agent", label: "کارشناس", color: "blue" },
  { value: "admin", label: "مدیر سامانه", color: "purple" },
  { value: "occasional", label: "کارشناس گاه‌به‌گاه", color: "teal" },
  { value: "integration", label: "کاربر یکپارچه‌سازی", color: "gray" },
  { value: "ai_addon", label: "افزونهٔ هوش مصنوعی", color: "indigo" },
];

const licencePool: TableDef = {
  key: "licence_pool",
  table: "sm_licence_pools",
  label: "مجوز",
  plural: "مجوزها و صندلی‌ها",
  icon: "id-card",
  module: "admin",
  area: "settings",
  description: "تعداد صندلی هر گونه؛ مصرف از نقش‌های اعضا حساب می‌شود (درخواست‌کنندگان و تأییدکنندگان صندلی مصرف نمی‌کنند)",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: LICENCE_KINDS, required: true, default: "agent", list: true, filter: true, span: 12 },
    { name: "quantity", label: "تعداد", type: "int", required: true, min: 0, max: 1_000_000, default: 10, list: true, span: 8 },
    { name: "valid_until", label: "اعتبار تا", type: "date", list: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "note", label: "یادداشت", type: "text", maxLength: 2000, span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "kind", "quantity", "valid_until", "active"], order: "kind,name" },
};

export const NOTICE_SEVERITY: Option[] = [
  { value: "info", label: "آگاهی", color: "blue" },
  { value: "warning", label: "هشدار", color: "gold" },
  { value: "critical", label: "مهم", color: "red" },
  { value: "maintenance", label: "نگهداری سامانه", color: "purple" },
];

const notice: TableDef = {
  key: "system_notice",
  table: "sm_system_notices",
  label: "اطلاعیهٔ سامانه",
  plural: "اطلاعیه‌های سامانه",
  icon: "megaphone",
  module: "admin",
  area: "org",
  description: "پیام به همهٔ اعضای سازمان: اطلاعیه‌های مدیر سامانه (نگهداری، تغییرات) و اطلاعیه‌های خود سازمان",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 24 },
    { name: "body", label: "متن", type: "markdown", span: 24 },
    { name: "severity", label: "اهمیت", type: "choice", choices: NOTICE_SEVERITY, default: "info", list: true, filter: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 12 },
    { name: "starts_at", label: "از", type: "datetime", default: "$now", list: true, sort: true, span: 12 },
    { name: "ends_at", label: "تا", type: "datetime", list: true, span: 12 },
    { name: "source", label: "فرستنده", type: "choice", choices: [{ value: "org", label: "مدیر سازمان" }, { value: "platform", label: "مدیر سامانه" }], default: "org", system: true, list: true, filter: true, span: 12 },
    { name: "announcement_id", label: "شناسهٔ اطلاعیهٔ سامانه", type: "string", maxLength: 40, system: true, hidden: true, ltr: true, span: 12 },
    { name: "published_at", label: "زمان اعلام", type: "datetime", system: true, span: 12 },
  ],
  scope: { public: true },
  list: { columns: ["title", "severity", "starts_at", "ends_at", "source", "active"], order: "-starts_at" },
};

export const ADMIN_TABLES: TableDef[] = [...CUSTOM_TABLES, config, customTable, studioVersion, importSet, transformMap, dataExport, licencePool, notice];
