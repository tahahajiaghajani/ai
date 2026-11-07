// The engine's own tables: tenant customisation (custom fields, choice lists), saved list views, and «کار» — a
// generic work item that extends the task, so every task behaviour of the engine is exercised by a real table.
// Also the virtual `user` table: the members of the organisation as a reference target (user/users/group-less
// person fields point at it; its fields come from sm_users and sm_org_members, see docs/spec/ENGINE.md).
import type { FieldType, Option, TableDef } from "../model/types";
import { FIELD_TYPES } from "../model/types";
import { ROLES } from "../permissions";

/** Field types a tenant may give a custom field. */
export const CUSTOM_FIELD_TYPES = (Object.keys(FIELD_TYPES) as FieldType[]).filter((t) => t !== "secret" && t !== "conditions" && t !== "json");

export const USER_TABLE: TableDef = {
  key: "user",
  table: "sm_users",
  virtual: true,
  label: "کاربر",
  plural: "کاربران",
  icon: "user",
  module: "core",
  area: "users",
  display: "name",
  levels: { read: "none" },
  fields: [
    { name: "name", label: "نام", type: "string", search: true, list: true },
    { name: "email", label: "ایمیل", type: "email", search: true, ltr: true },
    { name: "title", label: "سمت", type: "string" },
    { name: "role", label: "نقش", type: "choice", choices: Object.entries(ROLES).map(([value, r]) => ({ value, label: r.title })) },
    { name: "is_active", label: "فعال", type: "bool" },
  ],
  scope: {},
  features: { sync: false, history: false },
};

const customField: TableDef = {
  key: "custom_field",
  table: "sm_custom_fields",
  label: "فیلد سفارشی",
  plural: "فیلدهای سفارشی",
  icon: "list-plus",
  module: "core",
  area: "settings",
  description: "فیلدهایی که سازمان به جدول‌ها می‌افزاید، یا برچسب و راهنمای تازه برای فیلدهای موجود",
  display: "label",
  fields: [
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12 },
    { name: "name", label: "نام فنی", type: "string", required: true, maxLength: 42, list: true, ltr: true, span: 12, help: "با u_ شروع می‌شود؛ یا نام فیلدی موجود برای تغییر برچسب و راهنمای آن" },
    { name: "label", label: "برچسب", type: "string", required: true, maxLength: 80, list: true, search: true, span: 12 },
    { name: "type", label: "نوع", type: "choice", choices: CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPES[t].label })), list: true, span: 12 },
    { name: "choices", label: "فهرست گزینه‌ها", type: "string", maxLength: 80, ltr: true, span: 12, help: "کلید فهرست گزینه‌ها (در «فهرست‌های گزینه»)" },
    { name: "options", label: "گزینه‌های ثابت", type: "json", span: 24 },
    { name: "ref", label: "جدول مقصد", type: "string", maxLength: 60, ltr: true, span: 12 },
    { name: "required", label: "الزامی", type: "bool", span: 6 },
    { name: "list", label: "ستون فهرست", type: "bool", span: 6 },
    { name: "search", label: "در جست‌وجو", type: "bool", span: 6 },
    { name: "filter", label: "در پالایه‌ها", type: "bool", span: 6 },
    { name: "help", label: "راهنما", type: "string", maxLength: 300, span: 24 },
    { name: "section", label: "بخش فرم", type: "string", maxLength: 80, span: 12 },
    { name: "max_length", label: "حداکثر طول", type: "int", min: 1, max: 100000, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 0, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
  ],
  unique: [["table_key", "name"]],
  scope: {},
  list: { columns: ["table_key", "name", "label", "type", "active"], order: "table_key,sort_order" },
};

const choice: TableDef = {
  key: "choice",
  table: "sm_choices",
  label: "گزینه",
  plural: "فهرست‌های گزینه",
  icon: "list",
  module: "core",
  area: "settings",
  description: "گزینه‌های فیلدهای انتخابی که سازمان ویرایش می‌کند (دسته‌ها، نتیجه‌های بستن…)",
  display: "label",
  fields: [
    { name: "list", label: "فهرست", type: "string", required: true, maxLength: 80, list: true, filter: true, search: true, ltr: true, span: 12 },
    { name: "value", label: "مقدار", type: "string", required: true, maxLength: 80, list: true, ltr: true, span: 12 },
    { name: "label", label: "برچسب", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "color", label: "رنگ", type: "color", span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", list: true, span: 6, help: "خالی: ترتیب گزینهٔ پیش‌فرض هم‌مقدار، یا پس از همه" },
    { name: "parent", label: "مقدار والد", type: "string", maxLength: 80, ltr: true, span: 12, help: "برای فهرست‌های وابسته (مثلاً زیردسته‌ای که به یک دسته تعلق دارد)" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
  ],
  unique: [["list", "value"]],
  scope: {},
  list: { columns: ["list", "value", "label", "sort_order", "active"], order: "list,sort_order" },
};

export const VIEW_KINDS: Option[] = [
  { value: "list", label: "فهرست" },
  { value: "kanban", label: "تابلو" },
  { value: "calendar", label: "تقویم" },
  { value: "chart", label: "نمودار" },
];

const view: TableDef = {
  key: "view",
  table: "sm_views",
  label: "نمای ذخیره‌شده",
  plural: "نماهای ذخیره‌شده",
  icon: "bookmark",
  module: "core",
  area: "work",
  description: "پالایه، ستون‌ها و ترتیب ذخیره‌شدهٔ یک فهرست؛ شخصی یا اشتراکی",
  display: "name",
  fields: [
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", readonly: true, list: true, filter: true, span: 12 },
    { name: "shared", label: "اشتراکی", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "is_default", label: "پیش‌فرض", type: "bool", default: false, span: 6 },
    { name: "kind", label: "نوع نما", type: "choice", choices: VIEW_KINDS, default: "list", span: 12 },
    { name: "filter", label: "شرط", type: "conditions", condTableField: "table_key", span: 24 },
    { name: "q", label: "عبارت جست‌وجو", type: "string", maxLength: 200, span: 12 },
    { name: "columns", label: "ستون‌ها", type: "json", span: 24 },
    { name: "sort", label: "ترتیب", type: "string", maxLength: 200, ltr: true, span: 12 },
    { name: "group_by", label: "گروه‌بندی", type: "string", maxLength: 60, ltr: true, span: 12 },
    { name: "page_size", label: "اندازهٔ صفحه", type: "int", min: 5, max: 500, span: 6 },
  ],
  // visibility is the row rule below (own or shared); the access model only asks for some read grant in the area
  scope: { own: ["owner_id"], public: true },
  rowAccess: {
    read: { or: [{ f: "owner_id", op: "is_me" }, { f: "shared", op: "eq", v: true }] },
    write: { f: "owner_id", op: "is_me" },
  },
  levels: { read: "view", create: "view", write: "view", delete: "view" },
  features: { history: false },
  list: { columns: ["name", "table_key", "kind", "shared", "owner_id"], order: "table_key,name" },
};

const todo: TableDef = {
  key: "todo",
  table: "sm_todos",
  label: "کار",
  plural: "کارها",
  icon: "list-checks",
  module: "core",
  area: "work",
  description: "کار عمومی: هر چیزی که باید کسی انجام دهد و پیگیری شود",
  extends: "task",
  numbered: { prefix: "TODO", pad: 7 },
  display: "short_description",
  fields: [
    { name: "tags", label: "برچسب‌ها", type: "tags", filter: true, span: 24 },
    { name: "estimate", label: "برآورد (ساعت)", type: "decimal", min: 0, span: 8 },
  ],
  scope: {},
  features: { tags: true, kanban: "state", calendar: { start: "due_at" } },
  list: { columns: ["number", "short_description", "state", "priority", "assigned_to", "due_at", "updated_at"], order: "-updated_at" },
  ai: { title: "short_description", text: ["description", "close_notes"] },
};

export const CORE_TABLES: TableDef[] = [customField, choice, view, todo];

/** Default options of the core tables' choice lists. */
export const CORE_CHOICE_LISTS: Record<string, Option[]> = {
  "todo.category": [
    { value: "general", label: "عمومی", order: 1 },
    { value: "followup", label: "پیگیری", order: 2 },
    { value: "meeting", label: "جلسه", order: 3 },
    { value: "report", label: "گزارش", order: 4 },
  ],
};
