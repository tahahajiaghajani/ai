// Process forms (design F §3.2, package F2), in the access area «طراحی فرم و گردش‌کار» (`process_design`, registered by
// F1 in ./fields.ts):
//   · form «فرم» — a layout over the field library (`FormLayoutV2`, @shared/forms/layout): tabs → sections → library
//     fields (with this form's width, label, help, «الزامی» / «فقط‌خواندنی» / «پنهان» and «نمایش وقتی…») and note lines.
//     Process steps use forms; what each person may see or change lives on the step (`StepRights`), so one form serves
//     several steps. A process publish snapshots every form it uses into the version (@shared/forms/snapshot), so a
//     running case never changes under people's feet; `status`, `version_no` and `published_*` record those publishes
//     (the publish service writes them, people never do). `fields` lists the library fields the layout uses (kept by
//     the hook; F1's usage and the delete and rename guards of library fields read it).
//   · System forms (each table's default form) are not rows here: a table's `_form` arrangement plus its field
//     overrides (F1's /forms/system/:table/overrides). Named alternative forms of a table are not in version 1.
// Access: area `process_design` — tenant_admin (full) and auditor (read) through "*"; F4b adds «طراح گردش‌کار» and
// «مسئول انتشار گردش‌کارها». F2's routes also let holders of `settings` edit write these rows, as the system with the
// person recorded as the actor. Audit: the engine's history. Sync: synced like the field library (Windows apps whose
// account reads the area receive them); forms change on the web version or the server edition — a Windows app's push
// is refused; SYNC_PROTOCOL 17. Demo data: nothing special — id and org_id, so the demo capture trigger records and
// purges the pack's rows.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { PROCESS_DESIGN_AREA } from "./fields";

/** A form is a draft until a process publish takes it; it is published from then on (its version counts publishes). */
export const FORM_STATUS: Option[] = [
  { value: "draft", label: "پیش‌نویس", color: "gray", order: 1 },
  { value: "published", label: "منتشرشده", color: "green", order: 2 },
];

const form: TableDef = {
  key: "form",
  table: "sm_forms",
  label: "فرم",
  plural: "فرم‌ها",
  icon: "file-text",
  module: "forms",
  area: PROCESS_DESIGN_AREA,
  description: "فرم‌های گردش‌کار: چیدمانی از فیلدهای کتابخانه که مرحله‌های گردش‌کار به کار می‌برند",
  display: "name",
  fields: [
    { name: "name", label: "نام فرم", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "status", label: "وضعیت", type: "choice", choices: FORM_STATUS, default: "draft", system: true, list: true, filter: true, span: 6 },
    { name: "version_no", label: "نسخه", type: "int", default: 0, system: true, list: true, sort: true, span: 6, help: "شمار انتشارهایی که چیدمان تازه‌ای از این فرم را برداشته‌اند" },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
    { name: "layout", label: "چیدمان", type: "json", span: 24, help: "زبانه‌ها، بخش‌ها، فیلدهای کتابخانه و یادداشت‌ها" },
    { name: "fields", label: "فیلدهای به‌کاررفته", type: "json", system: true, hidden: true, audit: false },
    { name: "published_at", label: "آخرین انتشار", type: "datetime", system: true, sort: true, span: 12 },
    { name: "published_hash", label: "اثر چیدمان منتشرشده", type: "string", maxLength: 40, system: true, hidden: true, audit: false },
  ],
  unique: [["name"]],
  scope: {},
  list: { columns: ["name", "status", "version_no", "updated_at"], order: "name" },
};

export const FORMS_TABLES: TableDef[] = [form];
