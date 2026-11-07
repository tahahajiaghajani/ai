// Flows («گردش‌کارها», docs/spec/services/flows.md): the configuration of the no-code automation as engine tables,
// so they get lists, forms, history, sync and permissions for free (area `flows`):
// - flow             a flow: its trigger (record event + table + condition | schedule | inbound webhook | manual |
//                    catalog order), who it runs as, and the draft graph the designer edits (`graph`); publishing
//                    snapshots trigger + graph into a `flow_version` and runs always execute a published version
// - flow_version     immutable published versions (a running run keeps the version it started with)
// - flow_connection  outside services the «فراخوانی HTTP» step may call: base address, extra allowed hosts, auth
//                    with an engine secret, static headers, timeout (the per-organisation allow-list)
// - schedule         recurring record creation from a template (monthly maintenance todo…), Jalali-friendly
// Runs and their step logs are runtime state of the runtime that executes them (sm_flow_runs, sm_flow_run_steps,
// sm_flow_waits: migration 0010_flows) — not engine tables: no history or events per step, never synchronised.
import type { Option, TableDef } from "../model/types";
import { RUN_AS_OPTIONS, TRIGGER_EVENTS, TRIGGER_KINDS } from "../flows/nodes";

const opts = (list: readonly { value: string; label: string }[]): Option[] => list.map((o, i) => ({ value: o.value, label: o.label, order: i + 1 }));

export const FLOW: TableDef = {
  key: "flow",
  table: "sm_flows",
  label: "گردش‌کار",
  plural: "گردش‌کارها",
  icon: "workflow",
  module: "flows",
  area: "flows",
  description: "خودکارسازی بدون کدنویسی: یک رویداد، زمان‌بندی یا وب‌هوک گام‌هایی را اجرا می‌کند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "dirty", label: "تغییر منتشرنشده", type: "bool", default: false, readonly: true, filter: true, span: 6, audit: false },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24 },
    { name: "trigger", label: "آغازگر", type: "choice", choices: opts(TRIGGER_KINDS), required: true, default: "record", list: true, filter: true, span: 12, section: "آغازگر" },
    { name: "trigger_table", label: "جدول رویداد", type: "string", maxLength: 60, ltr: true, list: true, filter: true, index: true, span: 12, section: "آغازگر" },
    { name: "trigger_events", label: "رویدادها", type: "multichoice", choices: opts(TRIGGER_EVENTS), span: 12, section: "آغازگر" },
    { name: "trigger_fields", label: "فقط با تغییر این فیلدها", type: "tags", span: 12, section: "آغازگر" },
    { name: "trigger_condition", label: "شرط رکورد", type: "conditions", condTableField: "trigger_table", span: 24, section: "آغازگر" },
    { name: "schedule", label: "زمان‌بندی", type: "json", span: 24, section: "آغازگر" },
    { name: "catalog_item", label: "قلم کاتالوگ", type: "string", maxLength: 80, ltr: true, span: 12, section: "آغازگر" },
    { name: "webhook_token", label: "کلید وب‌هوک", type: "secret", span: 12, section: "آغازگر" },
    { name: "run_as", label: "اجرا با دسترسی", type: "choice", choices: opts(RUN_AS_OPTIONS), required: true, default: "trigger_user", span: 12, section: "اجرا" },
    { name: "run_as_user", label: "کاربر اجرا", type: "user", span: 12, section: "اجرا" },
    // the designer's draft (published with a version); long, so lists leave it out
    { name: "graph", label: "طرح", type: "json", hidden: true, audit: false },
    { name: "version_no", label: "نسخهٔ منتشرشده", type: "int", readonly: true, list: true, span: 6, section: "نسخه" },
    { name: "version_id", label: "نسخهٔ جاری", type: "ref", ref: "flow_version", readonly: true, span: 12, section: "نسخه" },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, span: 6, section: "نسخه" },
  ],
  unique: [["name"]],
  scope: {},
  list: { columns: ["name", "trigger", "trigger_table", "active", "version_no", "updated_at"], order: "name" },
  form: { sections: ["اصلی", "آغازگر", "اجرا", "نسخه"], related: [{ table: "flow_version", field: "flow_id", label: "نسخه‌ها", columns: ["version_no", "note", "created_by", "created_at"] }] },
};

export const FLOW_VERSION: TableDef = {
  key: "flow_version",
  table: "sm_flow_versions",
  label: "نسخهٔ گردش‌کار",
  plural: "نسخه‌های گردش‌کار",
  icon: "history",
  module: "flows",
  area: "flows",
  description: "نسخه‌های منتشرشدهٔ گردش‌کارها؛ هر اجرا با نسخه‌ای که با آن آغاز شده ادامه می‌یابد",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", readonly: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "flow_id", label: "گردش‌کار", type: "ref", ref: "flow", readonly: true, required: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_no", label: "نسخه", type: "int", readonly: true, list: true, sort: true, span: 6 },
    { name: "note", label: "یادداشت انتشار", type: "string", readonly: true, maxLength: 300, list: true, span: 18 },
    { name: "trigger", label: "آغازگر", type: "json", readonly: true, audit: false },
    { name: "graph", label: "طرح", type: "json", readonly: true, hidden: true, audit: false },
  ],
  unique: [["flow_id", "version_no"]],
  scope: {},
  list: { columns: ["title", "version_no", "note", "created_by", "created_at"], order: "-created_at" },
};

export const AUTH_KINDS = [
  { value: "none", label: "بدون احراز هویت" },
  { value: "bearer", label: "توکن (Bearer)" },
  { value: "basic", label: "نام کاربری و گذرواژه" },
  { value: "header", label: "کلید در سرآیند" },
  { value: "query", label: "کلید در نشانی" },
] as const;

export const FLOW_CONNECTION: TableDef = {
  key: "flow_connection",
  table: "sm_flow_connections",
  label: "اتصال HTTP",
  plural: "اتصال‌های HTTP",
  icon: "plug",
  module: "flows",
  area: "flows",
  description: "سرویس‌های بیرونی که گام «فراخوانی HTTP» مجاز است صدا بزند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "base_url", label: "نشانی پایه", type: "url", required: true, list: true, ltr: true, span: 24, placeholder: "https://api.example.com" },
    { name: "hosts", label: "میزبان‌های مجاز دیگر", type: "tags", span: 24, placeholder: "files.example.com، *.example.com" },
    { name: "auth", label: "احراز هویت", type: "choice", choices: opts(AUTH_KINDS), default: "none", required: true, list: true, span: 12, section: "احراز هویت" },
    { name: "auth_name", label: "نام سرآیند یا پارامتر", type: "string", maxLength: 80, ltr: true, span: 12, section: "احراز هویت", placeholder: "X-API-Key" },
    { name: "username", label: "نام کاربری", type: "string", maxLength: 200, ltr: true, span: 12, section: "احراز هویت" },
    { name: "secret", label: "کلید یا گذرواژه", type: "secret", span: 12, section: "احراز هویت" },
    { name: "headers", label: "سرآیندهای ثابت", type: "json", span: 24, section: "پیشرفته" },
    { name: "timeout", label: "مهلت (ثانیه)", type: "int", min: 1, max: 60, default: 15, span: 6, section: "پیشرفته" },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24, section: "پیشرفته" },
  ],
  unique: [["name"]],
  scope: {},
  list: { columns: ["name", "base_url", "auth", "active", "updated_at"], order: "name" },
  form: { sections: ["اصلی", "احراز هویت", "پیشرفته"] },
};

export const SCHEDULE: TableDef = {
  key: "schedule",
  table: "sm_schedules",
  label: "زمان‌بندی",
  plural: "زمان‌بندی‌ها",
  icon: "calendar-clock",
  module: "flows",
  area: "flows",
  description: "ساخت دوره‌ای رکورد از یک الگو (مثلاً کار نگهداری ماهانه)",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 12 },
    { name: "spec", label: "تکرار", type: "json", required: true, span: 24 },
    { name: "template", label: "مقدارهای رکورد", type: "json", required: true, span: 24 },
    { name: "run_as", label: "ساخته به نام", type: "user", required: true, default: "$me", list: true, span: 12 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "table_key", "run_as", "active", "updated_at"], order: "name" },
};

export const FLOW_TABLES: TableDef[] = [FLOW, FLOW_VERSION, FLOW_CONNECTION, SCHEDULE];
