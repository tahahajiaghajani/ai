// Tables of approvals (docs/spec/services/sla.md §4): approval rules on a table (conditions → levels of approvers),
// the approvals the engine requests of people (one row per approver and level) and delegations (someone acts for an
// absent colleague for a while). Approvals are written only by the approval service (src/server/modules/sla); people
// decide them in «تأییدهای من» or on the record. Each person reads their own approvals through the generic API (row
// rule); the record's people see them on the record (the service checks that they may read it).
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import type { LevelDef } from "../sla/approvals";

/** What a new approval rule asks until its levels are edited: the requester's manager. */
export const DEFAULT_LEVELS: LevelDef[] = [{ name: "مدیر درخواست‌دهنده", sources: [{ kind: "manager" }], rule: "any" }];

export const APPROVAL_ROW_STATES: Option[] = [
  { value: "waiting", label: "در نوبت", color: "gray" },
  { value: "requested", label: "در انتظار تأیید", color: "gold" },
  { value: "approved", label: "تأییدشده", color: "green" },
  { value: "rejected", label: "ردشده", color: "red" },
  { value: "canceled", label: "لغوشده", color: "gray" },
  { value: "skipped", label: "بدون تأییدکننده", color: "gray" },
  { value: "no_longer_required", label: "دیگر لازم نیست", color: "gray" },
];

export const APPROVAL_RULES: Option[] = [
  { value: "any", label: "یک نفر کافی است" },
  { value: "all", label: "همه" },
  { value: "count", label: "تعداد مشخص" },
  { value: "percent", label: "درصد مشخص" },
  { value: "first", label: "نخستین پاسخ (تأیید یا رد) کافی است" },
];

export const APPROVAL_MODES: Option[] = [
  { value: "sequential", label: "پشت سر هم" },
  { value: "parallel", label: "هم‌زمان" },
];

export const EXPIRE_ACTIONS: Option[] = [
  { value: "reject", label: "رد" },
  { value: "approve", label: "تأیید" },
  { value: "cancel", label: "لغو درخواست تأیید" },
];

export const APPROVER_SOURCES: Option[] = [
  { value: "users", label: "افراد مشخص" },
  { value: "groups", label: "اعضای گروه" },
  { value: "manager", label: "مدیر درخواست‌دهنده" },
  { value: "field", label: "فیلد رکورد" },
  { value: "owner", label: "مالک خدمت یا پیکربندی" },
];

export const DELEGATION_SCOPES: Option[] = [
  { value: "approvals", label: "تأییدها", color: "green" },
  { value: "assignments", label: "کارهای ارجاعی", color: "blue" },
  { value: "notifications", label: "اعلان‌ها", color: "gold" },
];

const approvalRule: TableDef = {
  key: "approval_rule",
  table: "sm_approval_rules",
  label: "قاعدهٔ تأیید",
  plural: "قواعد تأیید",
  icon: "stamp",
  module: "sla",
  area: "settings",
  description: "چه رکوردهایی، از چه کسانی و در چند سطح تأیید می‌خواهند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12 },
    { name: "condition", label: "شرط", type: "conditions", condTableField: "table_key", rules: true, span: 24, help: "تأییدها وقتی درخواست می‌شوند که این شرط برقرار شود (هنگام ثبت، یا با تغییری که آن را برقرار کند)" },
    { name: "mode", label: "ترتیب سطح‌ها", type: "choice", choices: APPROVAL_MODES, default: "sequential", list: true, span: 8 },
    { name: "levels", label: "سطح‌های تأیید", type: "json", required: true, default: DEFAULT_LEVELS, span: 24 },
    { name: "auto_approve", label: "شرط تأیید خودکار", type: "conditions", condTableField: "table_key", span: 24, section: "مهلت و استثناها" },
    { name: "allow_self_approval", label: "تأیید رکورد خود مجاز است", type: "bool", default: false, span: 8, section: "مهلت و استثناها", help: "بدون آن، درخواست‌دهنده و کارشناس رکورد آن را تأیید نمی‌کنند" },
    { name: "remind_every", label: "یادآوری هر", type: "duration", min: 0, span: 8, section: "مهلت و استثناها" },
    { name: "expire_after", label: "مهلت تأیید", type: "duration", min: 0, span: 8, section: "مهلت و استثناها" },
    { name: "expire_action", label: "پس از پایان مهلت", type: "choice", choices: EXPIRE_ACTIONS, default: "reject", span: 8, section: "مهلت و استثناها" },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  unique: [["table_key", "name"]],
  scope: {},
  form: { sections: ["اصلی", "مهلت و استثناها"] },
  list: { columns: ["name", "table_key", "mode", "active"], order: "table_key,sort_order,name" },
};

const approval: TableDef = {
  key: "approval",
  table: "sm_approvals",
  label: "تأیید",
  plural: "تأییدها",
  icon: "stamp",
  module: "sla",
  area: "work",
  description: "تأییدی که از کسی برای یک رکورد خواسته شده است",
  display: "record_title",
  fields: [
    { name: "table_key", label: "جدول", type: "string", readonly: true, maxLength: 60, filter: true, ltr: true, span: 8 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", readonly: true, maxLength: 36, ltr: true, index: true, span: 8 },
    { name: "record_number", label: "رکورد", type: "string", readonly: true, maxLength: 40, list: true, search: true, ltr: true, span: 8 },
    { name: "record_title", label: "عنوان رکورد", type: "string", readonly: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "rule_id", label: "قاعدهٔ تأیید", type: "ref", ref: "approval_rule", readonly: true, filter: true, span: 8 },
    { name: "level", label: "سطح", type: "int", readonly: true, default: 1, list: true, span: 12 },
    { name: "level_name", label: "نام سطح", type: "string", readonly: true, maxLength: 120, span: 12 },
    { name: "round", label: "دور درخواست", type: "int", readonly: true, default: 1, span: 6 },
    { name: "approver_id", label: "تأییدکننده", type: "user", readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "group_id", label: "از گروه", type: "group", readonly: true, filter: true, span: 8 },
    { name: "source", label: "منبع تأییدکننده", type: "choice", choices: APPROVER_SOURCES, readonly: true, span: 8 },
    { name: "rule", label: "قاعدهٔ سطح", type: "choice", choices: APPROVAL_RULES, readonly: true, default: "any", span: 8 },
    { name: "threshold", label: "حد نصاب", type: "int", readonly: true, span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: APPROVAL_ROW_STATES, readonly: true, default: "requested", list: true, filter: true, index: true, span: 8 },
    { name: "comments", label: "توضیح", type: "text", readonly: true, span: 24 },
    { name: "due_at", label: "مهلت", type: "datetime", readonly: true, list: true, sort: true, filter: true, span: 8 },
    { name: "requested_at", label: "زمان درخواست", type: "datetime", readonly: true, sort: true, filter: true, span: 8 },
    { name: "requested_by", label: "درخواست‌شده با", type: "user", readonly: true, span: 8 },
    { name: "decided_at", label: "زمان تصمیم", type: "datetime", readonly: true, sort: true, filter: true, span: 8 },
    { name: "decided_by", label: "تصمیم‌گیرنده", type: "user", readonly: true, filter: true, index: true, span: 8 },
    { name: "delegated_from", label: "به جانشینی از", type: "user", readonly: true, filter: true, index: true, span: 8 },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", readonly: true, audit: false, span: 8 },
  ],
  scope: { own: ["approver_id", "delegated_from"] },
  rowAccess: {
    read: { or: [{ f: "approver_id", op: "is_me" }, { f: "delegated_from", op: "is_me" }, { f: "decided_by", op: "is_me" }] },
  },
  levels: { read: "view" },
  list: { columns: ["record_number", "record_title", "level", "approver_id", "state", "due_at"], order: "-requested_at" },
};

const delegation: TableDef = {
  key: "delegation",
  table: "sm_delegations",
  label: "جانشینی",
  plural: "جانشینی‌ها",
  icon: "user-round-check",
  module: "sla",
  area: "work",
  description: "در غیبت، کس دیگری تأییدها، کارهای ارجاعی یا اعلان‌های شما را در دست می‌گیرد",
  display: "reason",
  fields: [
    { name: "from_user", label: "از طرف", type: "user", required: true, default: "$me", list: true, filter: true, index: true, span: 12 },
    { name: "to_user", label: "جانشین", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "starts_at", label: "از", type: "datetime", required: true, default: "$now", list: true, sort: true, span: 12 },
    { name: "ends_at", label: "تا", type: "datetime", list: true, sort: true, span: 12 },
    { name: "scopes", label: "در چه کارهایی", type: "multichoice", choices: DELEGATION_SCOPES, default: ["approvals"], required: true, list: true, span: 24 },
    { name: "reason", label: "علت", type: "string", maxLength: 300, search: true, span: 18 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
  ],
  scope: { own: ["from_user", "to_user"] },
  rowAccess: {
    read: { or: [{ f: "from_user", op: "is_me" }, { f: "to_user", op: "is_me" }] },
    write: { f: "from_user", op: "is_me" },
  },
  levels: { read: "view", create: "view", write: "view", delete: "view" },
  list: { columns: ["from_user", "to_user", "starts_at", "ends_at", "scopes", "active"], order: "-starts_at" },
};

export const APPROVAL_TABLES: TableDef[] = [approvalRule, approval, delegation];
