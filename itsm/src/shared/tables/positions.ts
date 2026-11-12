// Organisational roles «نقش‌های سازمانی» (design F §3.4, package F3): posts such as «رئیس شعبه» or «معاون اعتبارات»
// that people hold in units, so a workflow step can go to «رئیس شعبهٔ درخواست‌دهنده» instead of 500 groups.
//   · position «نقش سازمانی» — the catalogue: a key (process versions name a position by it, so it never changes), a
//     name, the kind of unit it is held in, the position it reports to (escalation), active.
//   · position_holder «دارندهٔ نقش سازمانی» — a person holds a position in a unit, with a kind («اصلی»، «سرپرست
//     (کفیل)»، «موقت») and dates of validity (inclusive, in the organisation's time zone); `source` says who keeps the
//     row: a person by hand (manual), the directory synchronisation or a directory sign-in (directory, `source_ref` =
//     the directory source), a spreadsheet import (import, `source_ref` = the import set). One row per position, person
//     and unit. The design names the unit column `unit_id`; that is a base column the access model keeps (the record's
//     anchor), so the holder's unit is `org_unit_id`, as on the member profile, and it is the table's unit scope:
//     a role with `org` write in a unit (tree) manages the holders of its units.
// Access: area `org` (reference data, `scope.public`): every built-in role but «کارشناس پیمانکار» reads; writes need
// `org` write (tenant_admin, service_desk_manager; team leads' «group» scope reaches no holder). Holder changes bump no
// scope epoch: positions decide who receives work, not what anyone may read (no access trigger on these tables; a
// person's inbox changes through their task rows). Audit: the engine's history on both tables; holders a directory
// keeps are listed in the sign-in log. Sync: synced like the rest of the organisation structure (SYNC_PROTOCOL 17 of
// the F release covers the new kinds). Demo data: nothing special — both tables have id and org_id, so the demo
// capture trigger records and purges the pack's rows.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { UNIT_KINDS } from "./access";

/** Kinds of holding a position: the post itself, acting in it, or for a while. */
export const HOLDER_KINDS: Option[] = [
  { value: "primary", label: "اصلی", color: "blue", order: 1 },
  { value: "acting", label: "سرپرست (کفیل)", color: "purple", order: 2 },
  { value: "temporary", label: "موقت", color: "gold", order: 3 },
];

/** Who keeps a holder row: a person by hand, the directory (AD), or a spreadsheet import. */
export const HOLDER_SOURCES: Option[] = [
  { value: "manual", label: "دستی", color: "gray", order: 1 },
  { value: "directory", label: "فهرست کاربران (AD)", color: "teal", order: 2 },
  { value: "import", label: "ورود از فایل", color: "indigo", order: 3 },
];

/** A position's key: a Latin identifier, the name process versions use for it. */
export const POSITION_KEY = /^[a-z][a-z0-9_]{1,39}$/;

const position: TableDef = {
  key: "position",
  table: "sm_positions",
  label: "نقش سازمانی",
  plural: "نقش‌های سازمانی",
  icon: "briefcase",
  module: "positions",
  area: "org",
  description: "سمت‌هایی مانند «رئیس شعبه» که افراد در واحدهای سازمان دارند؛ مرحله‌های گردش‌کار با آن‌ها به افراد سپرده می‌شوند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 40, list: true, search: true, ltr: true, span: 12, help: "با حرف لاتین کوچک شروع می‌شود و پس از ساخت تغییر نمی‌کند؛ گردش‌کارها با آن به این نقش اشاره می‌کنند" },
    { name: "unit_kind", label: "در واحدهای نوع", type: "choice", choices: UNIT_KINDS, list: true, filter: true, span: 12, help: "دارندگان این نقش در واحدهای همین نوع هستند؛ مثلاً رئیس شعبه در شعبه‌ها" },
    { name: "reports_to", label: "گزارش به", type: "ref", ref: "$self", filter: true, span: 12, help: "نقشی که تشدید مهلت مرحله‌ها به دارندهٔ آن می‌رسد" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
  ],
  unique: [["key"]],
  scope: { public: true },
  list: { columns: ["name", "key", "unit_kind", "active"], order: "name" },
};

const positionHolder: TableDef = {
  key: "position_holder",
  table: "sm_position_holders",
  label: "دارندهٔ نقش سازمانی",
  plural: "دارندگان نقش‌های سازمانی",
  icon: "user-check",
  module: "positions",
  area: "org",
  description: "چه کسی کدام نقش سازمانی را در کدام واحد و تا چه تاریخی دارد",
  display: "user_id",
  fields: [
    { name: "position_id", label: "نقش سازمانی", type: "ref", ref: "position", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "دارنده", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "org_unit_id", label: "واحد", type: "ref", ref: "org_unit", list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: HOLDER_KINDS, default: "primary", required: true, list: true, filter: true, span: 12 },
    { name: "valid_from", label: "از تاریخ", type: "date", list: true, sort: true, span: 12 },
    { name: "valid_to", label: "تا تاریخ", type: "date", list: true, sort: true, span: 12, help: "خالی: تا اطلاع بعدی؛ روز پایان هم جزو دوره است" },
    { name: "source", label: "منبع", type: "choice", choices: HOLDER_SOURCES, default: "manual", system: true, list: true, filter: true, span: 12 },
    { name: "source_ref", label: "شناسهٔ منبع", type: "string", maxLength: 64, system: true, hidden: true, ltr: true, span: 12 },
  ],
  unique: [["position_id", "user_id", "org_unit_id"]],
  scope: { public: true, unit: "org_unit_id" },
  list: { columns: ["position_id", "user_id", "org_unit_id", "kind", "valid_to", "source"], order: "position_id" },
};

export const POSITION_TABLES: TableDef[] = [position, positionHolder];
