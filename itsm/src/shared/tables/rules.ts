// Tables of the rules of records (docs/spec/services/sla.md §5): business rules (conditions → set values, notes,
// watchers, abort, a related record), assignment rules (→ a group and a person: fixed, round robin, least loaded,
// skills, on call), the priority matrix (impact × urgency → priority), categories (a tree per table) and UI
// policies (fields shown, required or read-only on a condition; also enforced by the server). The engine applies them
// on every write path through hooks (src/server/modules/sla/rules.ts, policies.ts).
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { ITIL_MATRIX } from "../sla/rules";

export const RULE_TIMINGS: Option[] = [
  { value: "before", label: "پیش از ذخیره" },
  { value: "after", label: "پس از ذخیره" },
];

export const RULE_EVENTS: Option[] = [
  { value: "insert", label: "ثبت" },
  { value: "update", label: "ویرایش" },
  { value: "state_change", label: "تغییر وضعیت" },
];

export const ASSIGNMENT_METHODS: Option[] = [
  { value: "fixed", label: "ثابت" },
  { value: "round_robin", label: "نوبتی" },
  { value: "least_loaded", label: "کم‌کارترین" },
  { value: "skills", label: "بر پایهٔ مهارت" },
  { value: "oncall", label: "آماده‌به‌کار" },
];

export const POLICY_SCOPES: Option[] = [
  { value: "both", label: "ثبت و ویرایش" },
  { value: "create", label: "فقط ثبت" },
  { value: "update", label: "فقط ویرایش" },
];

export const POLICY_TONES: Option[] = [
  { value: "info", label: "اطلاع" },
  { value: "warning", label: "هشدار" },
];

const TABLE_FIELD = { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12 } as const;

const businessRule: TableDef = {
  key: "business_rule",
  table: "sm_business_rules",
  label: "قاعدهٔ کسب‌وکار",
  plural: "قواعد کسب‌وکار",
  icon: "workflow",
  module: "sla",
  area: "settings",
  description: "پیش یا پس از ذخیرهٔ رکورد، در صورت برقراری شرط: مقدار فیلدها، یادداشت داخلی، پیگیری‌کنندگان، رکورد وابسته یا توقف با پیام",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { ...TABLE_FIELD },
    { name: "timing", label: "زمان اجرا", type: "choice", choices: RULE_TIMINGS, default: "before", list: true, filter: true, span: 8 },
    { name: "events", label: "هنگام", type: "multichoice", choices: RULE_EVENTS, default: ["insert", "update"], required: true, list: true, span: 16 },
    { name: "condition", label: "شرط", type: "conditions", condTableField: "table_key", rules: true, span: 24 },
    { name: "actions", label: "اقدام‌ها", type: "json", required: true, default: [], span: 24 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "table_key", "timing", "sort_order", "active"], order: "table_key,sort_order,name" },
};

const assignmentRule: TableDef = {
  key: "assignment_rule",
  table: "sm_assignment_rules",
  label: "قاعدهٔ ارجاع",
  plural: "قواعد ارجاع",
  icon: "route",
  module: "sla",
  area: "settings",
  description: "رکوردهای بی‌گروه و بی‌کارشناس به کدام گروه و کدام کارشناس برسند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { ...TABLE_FIELD },
    { name: "condition", label: "شرط", type: "conditions", condTableField: "table_key", span: 24 },
    { name: "group_id", label: "گروه", type: "group", list: true, filter: true, span: 12 },
    { name: "method", label: "روش انتخاب کارشناس", type: "choice", choices: ASSIGNMENT_METHODS, default: "fixed", list: true, span: 12 },
    { name: "user_id", label: "کارشناس (روش ثابت)", type: "user", span: 12 },
    { name: "skills", label: "مهارت‌های لازم", type: "tags", span: 12 },
    {
      name: "ai_group",
      label: "گروه با پیش‌بینی هوش مصنوعی",
      type: "bool",
      default: false,
      filter: true,
      span: 12,
      help: "گروه را مدل طبقه‌بندی این جدول از متن رکورد پیش‌بینی می‌کند، فقط وقتی اطمینانش به آستانهٔ «اعمال خودکار» مدل برسد؛ وگرنه گروه همین قاعده (اگر تعیین شده) به کار می‌رود",
    },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "table_key", "group_id", "method", "sort_order", "active"], order: "table_key,sort_order,name" },
};

const priorityMatrix: TableDef = {
  key: "priority_matrix",
  table: "sm_priority_matrices",
  label: "ماتریس اولویت",
  plural: "ماتریس‌های اولویت",
  icon: "grid-3x3",
  module: "sla",
  area: "settings",
  description: "اولویت هر رکورد از اثر و فوریت آن (پیش‌فرض ITIL، ویرایش‌پذیر)",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { ...TABLE_FIELD, unique: true },
    { name: "impact_field", label: "فیلد اثر", type: "string", maxLength: 60, default: "impact", ltr: true, span: 8 },
    { name: "urgency_field", label: "فیلد فوریت", type: "string", maxLength: 60, default: "urgency", ltr: true, span: 8 },
    { name: "priority_field", label: "فیلد اولویت", type: "string", maxLength: 60, default: "priority", ltr: true, span: 8 },
    { name: "cells", label: "خانه‌ها", type: "json", required: true, default: ITIL_MATRIX, span: 24, help: "{ «اثر»: { «فوریت»: «اولویت» } }" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "table_key", "active"], order: "table_key" },
};

const category: TableDef = {
  key: "category",
  table: "sm_categories",
  label: "دسته",
  plural: "دسته‌بندی‌ها",
  icon: "folder-tree",
  module: "sla",
  area: "settings",
  description: "درخت دسته و زیردستهٔ هر جدول (و هر فضای کاری) با گروه پیش‌فرض؛ گزینه‌های «دسته» و «زیردسته» از آن ساخته می‌شوند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { ...TABLE_FIELD },
    { name: "value", label: "کد", type: "string", required: true, maxLength: 80, list: true, ltr: true, span: 12, help: "مقداری که در فیلد «دسته» یا «زیردسته» رکوردها ذخیره می‌شود" },
    { name: "parent_id", label: "دستهٔ بالادستی", type: "ref", ref: "$self", filter: true, index: true, span: 12 },
    { name: "default_group_id", label: "گروه پیش‌فرض", type: "group", list: true, span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  unique: [["table_key", "value"]],
  scope: {},
  list: { columns: ["name", "table_key", "value", "default_group_id", "active"], order: "table_key,sort_order,name" },
};

const uiPolicy: TableDef = {
  key: "ui_policy",
  table: "sm_ui_policies",
  label: "سیاست فرم",
  plural: "سیاست‌های فرم",
  icon: "form-input",
  module: "sla",
  area: "settings",
  description: "در صورت برقراری شرط، فیلدهای فرم پنهان، الزامی یا فقط‌خواندنی می‌شوند؛ کارگزار الزامی و فقط‌خواندنی را هم بررسی می‌کند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { ...TABLE_FIELD },
    { name: "condition", label: "شرط", type: "conditions", condTableField: "table_key", span: 24, help: "خالی: همیشه" },
    { name: "actions", label: "فیلدها", type: "json", required: true, default: [], span: 24, help: "[{ «field»: «close_notes», «mandatory»: true }] — visible / mandatory / readonly" },
    { name: "applies_on", label: "در", type: "choice", choices: POLICY_SCOPES, default: "both", span: 8 },
    { name: "message", label: "پیام بالای فرم", type: "string", maxLength: 300, span: 16 },
    { name: "tone", label: "لحن پیام", type: "choice", choices: POLICY_TONES, default: "info", span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "table_key", "applies_on", "sort_order", "active"], order: "table_key,sort_order,name" },
};

export const RULE_TABLES: TableDef[] = [businessRule, assignmentRule, priorityMatrix, category, uiPolicy];

/** Choice lists of the rule tables (none yet: their options are static). */
export const RULE_CHOICE_LISTS: Record<string, Option[]> = {};
