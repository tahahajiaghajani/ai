// Tables of the field library (design F §3.1, package F1), in the access area «طراحی فرم و گردش‌کار»
// (`process_design`), which the forms (F2) and the process definitions (F4) join:
//   · field_type «نوع فیلد» — an organisation's own field types, each derived from one built-in type of
//     `@shared/forms/fieldtypes` (the built-in types live in code and are listed first); a key starts with u_
//   · field_def «فیلد» — the library: a named u_* field of a type, defined once and used by tables (an ordinary
//     `custom_field` row naming it in `library_id`, so the engine's overlay validates, filters, audits and syncs it
//     like any custom field), by forms and by process versions. Retired fields are offered for nothing new; every
//     table and published version that uses one keeps it.
// Access: area `process_design` — tenant_admin (full) and auditor (read) through "*"; F4b adds the roles «طراح
// گردش‌کار» and «مسئول انتشار گردش‌کارها». F1's routes also let holders of `settings` edit write these rows, as the
// system with the person recorded as the actor. Audit: the engine's history on both tables. Sync: synced like every
// engine table (Windows apps whose account reads the area receive them; changes are made on the web version or the
// server edition — pushes are refused, as for custom fields); SYNC_PROTOCOL 17. Demo data: nothing special — both
// tables have id and org_id, so the demo capture trigger records and purges the pack's rows.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { FIELD_GROUPS } from "../model/types";
import { registerArea } from "../access/areas";
import { BUILTIN_TYPE_OPTIONS, WIDGET_LABELS, type Widget } from "../forms/fieldtypes";

/** «طراحی فرم و گردش‌کار»: field types, library fields, forms and process definitions (never process cases). */
export const PROCESS_DESIGN_AREA = "process_design";
registerArea({ key: PROCESS_DESIGN_AREA, label: "طراحی فرم و گردش‌کار", group: "platform", module: "fields", platform: true });

/** Status of a field type or a library field: a retired one is offered for nothing new and keeps working where used. */
export const FIELD_STATUS: Option[] = [
  { value: "active", label: "فعال", color: "green", order: 1 },
  { value: "retired", label: "بازنشسته", color: "gray", order: 2 },
];

const WIDGET_OPTIONS: Option[] = (Object.keys(WIDGET_LABELS) as Widget[]).map((w, i) => ({ value: w, label: WIDGET_LABELS[w], order: i + 1 }));
const GROUP_OPTIONS: Option[] = Object.entries(FIELD_GROUPS).map(([value, label]) => ({ value, label }));

const fieldType: TableDef = {
  key: "field_type",
  table: "sm_field_types",
  label: "نوع فیلد",
  plural: "نوع‌های فیلد",
  icon: "shapes",
  module: "fields",
  area: PROCESS_DESIGN_AREA,
  description: "نوع‌های فیلدی که سازمان از نوع‌های پایه می‌سازد: نمایش، اعتبارسنجی و گزینه‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 80, list: true, search: true, sort: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 42, list: true, ltr: true, span: 12, help: "با u_ شروع می‌شود و پس از ساخت تغییر نمی‌کند" },
    { name: "base", label: "نوع پایه", type: "choice", choices: BUILTIN_TYPE_OPTIONS, required: true, list: true, filter: true, span: 12 },
    { name: "widget", label: "نمایش", type: "choice", choices: WIDGET_OPTIONS, span: 12, help: "فقط میان نمایش‌های همان نوع ذخیره (مثلاً فهرست کشویی ↔ گزینه‌های تکی)" },
    { name: "validation", label: "اعتبارسنجی", type: "json", span: 24, help: "حداکثر طول، الگو و پیام آن، کمینه و بیشینه، رقم‌های اعشار، محدودهٔ تاریخ، شمار و نوع پرونده‌ها، جدول و شرط ارجاع" },
    { name: "display", label: "تنظیمات نمایش", type: "json", span: 24, help: "چپ‌به‌راست، واحد مبلغ (ریال یا تومان)" },
    { name: "options", label: "گزینه‌های ثابت", type: "json", span: 24 },
    { name: "choices", label: "فهرست گزینه‌ها", type: "string", maxLength: 80, ltr: true, span: 12, help: "کلید یک فهرست گزینهٔ مشترک، به‌جای گزینه‌های ثابت" },
    { name: "status", label: "وضعیت", type: "choice", choices: FIELD_STATUS, default: "active", list: true, filter: true, span: 12 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
  ],
  unique: [["key"]],
  scope: {},
  list: { columns: ["name", "key", "base", "status", "updated_at"], order: "name" },
};

const fieldDef: TableDef = {
  key: "field_def",
  table: "sm_field_defs",
  label: "فیلد",
  plural: "فیلدها",
  icon: "text-cursor-input",
  module: "fields",
  area: PROCESS_DESIGN_AREA,
  description: "کتابخانهٔ فیلدهای سازمان: هر فیلد یک بار تعریف می‌شود و در جدول‌ها، فرم‌ها و گردش‌کارها به کار می‌رود",
  display: "label",
  fields: [
    { name: "label", label: "برچسب", type: "string", required: true, maxLength: 80, list: true, search: true, sort: true, span: 12 },
    { name: "name", label: "نام فنی", type: "string", required: true, maxLength: 42, list: true, search: true, ltr: true, span: 12, help: "با u_ شروع می‌شود و پس از نخستین کاربرد تغییر نمی‌کند" },
    { name: "type", label: "نوع فیلد", type: "string", required: true, maxLength: 42, list: true, filter: true, ltr: true, span: 12, help: "کلید یکی از نوع‌های پایه یا نوع‌های سازمان" },
    { name: "help", label: "راهنما", type: "string", maxLength: 300, span: 24 },
    { name: "placeholder", label: "متن نمونه", type: "string", maxLength: 120, span: 12 },
    { name: "default_value", label: "مقدار پیش‌فرض", type: "string", maxLength: 500, ltr: true, span: 12, help: "یک مقدار، یا $today، $now، $me، $my_unit و $my_domain" },
    { name: "options", label: "گزینه‌های ثابت", type: "json", span: 24 },
    { name: "choices", label: "فهرست گزینه‌ها", type: "string", maxLength: 80, ltr: true, span: 12, help: "کلید یک فهرست گزینهٔ مشترک؛ ویرایش فهرست‌های مشترک دسترسی «تنظیمات سازمان» می‌خواهد" },
    { name: "depends_on", label: "وابسته به", type: "string", maxLength: 42, ltr: true, span: 12, help: "فیلد گزینه‌ای دیگری از کتابخانه که گزینه‌های این فیلد را پالایش می‌کند" },
    { name: "validation", label: "اعتبارسنجی", type: "json", span: 24, help: "همان تنظیم‌های نوع فیلد، برای همین فیلد" },
    { name: "field_group", label: "گروه فیلد", type: "choice", choices: GROUP_OPTIONS, filter: true, span: 12, help: "حساسیت: فقط دارندگان این گروه فیلد آن را می‌بینند (مثلاً «مالی» یا «اطلاعات شخصی»)" },
    { name: "list", label: "ستون فهرست", type: "bool", default: false, span: 6 },
    { name: "search", label: "در جست‌وجو", type: "bool", default: false, span: 6 },
    { name: "filter", label: "در پالایه‌ها", type: "bool", default: false, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: FIELD_STATUS, default: "active", list: true, filter: true, span: 12 },
  ],
  unique: [["name"]],
  scope: {},
  list: { columns: ["label", "name", "type", "field_group", "status"], order: "label" },
};

export const FIELDS_TABLES: TableDef[] = [fieldType, fieldDef];
