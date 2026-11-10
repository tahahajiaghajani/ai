// The task: what every unit of ITSM work shares (incidents, problems, changes, requests, their tasks…). A TableDef
// with `extends: "task"` gets TASK_FIELDS (its own fields of the same name replace them), the default task state
// model unless it brings its own, the task scope columns and the engine's task behaviours: numbering, opened_at/by,
// active derived from the state category, resolved/closed stamps, reopen and reassignment counters, watchers and the
// first-response stamp. Choice lists named "$table.category" are per table ("incident.category").
// Imported by the UI: keep it free of server imports.
import type { FieldDef, Option, ScopeFields, StateCategory, StateDef, StateModel } from "./types";

export const PRIORITIES: Option[] = [
  { value: "1", label: "۱ — بحرانی", color: "red", order: 1 },
  { value: "2", label: "۲ — زیاد", color: "orange", order: 2 },
  { value: "3", label: "۳ — متوسط", color: "gold", order: 3 },
  { value: "4", label: "۴ — کم", color: "blue", order: 4 },
  { value: "5", label: "۵ — برنامه‌ریزی", color: "gray", order: 5 },
];

export const IMPACTS: Option[] = [
  { value: "1", label: "۱ — زیاد", order: 1 },
  { value: "2", label: "۲ — متوسط", order: 2 },
  { value: "3", label: "۳ — کم", order: 3 },
];

export const URGENCIES: Option[] = [
  { value: "1", label: "۱ — زیاد", order: 1 },
  { value: "2", label: "۲ — متوسط", order: 2 },
  { value: "3", label: "۳ — کم", order: 3 },
];

export const CHANNELS: Option[] = [
  { value: "portal", label: "درگاه کاربران" },
  { value: "email", label: "ایمیل" },
  { value: "phone", label: "تلفن" },
  { value: "chat", label: "گفتگو" },
  { value: "walk_in", label: "حضوری" },
  { value: "monitoring", label: "پایش خودکار" },
  { value: "api", label: "API" },
];

export const APPROVAL_STATES: Option[] = [
  { value: "not_requested", label: "درخواست نشده", color: "gray" },
  { value: "requested", label: "در انتظار تأیید", color: "gold" },
  { value: "approved", label: "تأییدشده", color: "green" },
  { value: "rejected", label: "ردشده", color: "red" },
];

/** Default close codes of a task table (tenant-editable list "$table.close_code"). */
export const CLOSE_CODES: Option[] = [
  { value: "solved", label: "حل شد" },
  { value: "workaround", label: "راه‌حل موقت" },
  { value: "not_reproducible", label: "تکرارپذیر نبود" },
  { value: "duplicate", label: "تکراری" },
  { value: "canceled_by_user", label: "انصراف کاربر" },
];

/**
 * The task fields. `$self` refs point at the extending table itself; choice lists named "$table.*" become
 * "<key>.*". Refs to tables that later modules define (service, service_offering, ci, location, group) are
 * validated as ids until those tables exist.
 */
export const TASK_FIELDS: FieldDef[] = [
  { name: "short_description", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24, ai: { index: true } },
  { name: "description", label: "شرح", type: "markdown", search: true, span: 24, ai: { index: true } },
  { name: "state", label: "وضعیت", type: "choice", list: true, filter: true, sort: true, index: true, span: 8 },
  { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, default: "4", list: true, filter: true, sort: true, span: 8 },
  { name: "impact", label: "اثر", type: "choice", choices: IMPACTS, default: "3", filter: true, span: 8 },
  { name: "urgency", label: "فوریت", type: "choice", choices: URGENCIES, default: "3", filter: true, span: 8 },
  { name: "category", label: "دسته", type: "choice", choices: "$table.category", filter: true, span: 8 },
  { name: "subcategory", label: "زیردسته", type: "choice", choices: "$table.subcategory", dependsOn: "category", span: 8 },
  { name: "channel", label: "مجرای دریافت", type: "choice", choices: CHANNELS, default: "portal", filter: true, span: 8 },
  { name: "caller_id", label: "درخواست‌دهنده", type: "user", default: "$me", list: true, filter: true, span: 8 },
  { name: "requested_for", label: "درخواست برای", type: "user", filter: true, span: 8 },
  { name: "opened_by", label: "ثبت‌کننده", type: "user", system: true, span: 8 },
  { name: "opened_at", label: "زمان ثبت", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8 },
  { name: "assignment_group_id", label: "گروه پشتیبانی", type: "group", list: true, filter: true, index: true, span: 8 },
  { name: "assigned_to", label: "کارشناس", type: "user", list: true, filter: true, sort: true, index: true, span: 8 },
  { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
  { name: "offering_id", label: "گزینهٔ خدمت", type: "ref", ref: "service_offering", span: 8 },
  { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8 },
  { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 8 },
  { name: "due_at", label: "موعد", type: "datetime", list: true, sort: true, filter: true, span: 8 },
  { name: "resolved_at", label: "زمان حل", type: "datetime", system: true, sort: true, filter: true, span: 8 },
  { name: "resolved_by", label: "حل‌کننده", type: "user", system: true, span: 8 },
  { name: "closed_at", label: "زمان بستن", type: "datetime", system: true, sort: true, filter: true, span: 8 },
  { name: "closed_by", label: "بندنده", type: "user", system: true, span: 8 },
  { name: "close_code", label: "نتیجهٔ بستن", type: "choice", choices: "$table.close_code", filter: true, span: 8 },
  { name: "close_notes", label: "یادداشت بستن", type: "text", span: 24 },
  { name: "parent_id", label: "رکورد والد", type: "ref", ref: "$self", span: 8 },
  { name: "watch_list", label: "پیگیری‌کنندگان", type: "users", span: 24 },
  { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
  { name: "escalation", label: "سطح تشدید", type: "int", default: 0, min: 0, max: 10, filter: true, span: 8 },
  { name: "reassignment_count", label: "دفعات ارجاع دوباره", type: "int", system: true, default: 0, span: 8 },
  { name: "reopen_count", label: "دفعات بازگشایی", type: "int", system: true, default: 0, span: 8 },
  { name: "time_worked", label: "زمان کار", type: "duration", min: 0, span: 8 },
  { name: "first_response_at", label: "زمان نخستین پاسخ", type: "datetime", system: true, span: 8 },
  { name: "active", label: "باز", type: "bool", system: true, default: true, filter: true, span: 8 },
  { name: "sla_due", label: "موعد توافق سطح خدمت", type: "datetime", system: true, sort: true, filter: true, span: 8 },
  { name: "knowledge", label: "ساخت مقالهٔ دانش", type: "bool", default: false, span: 8 },
];

export const TASK_SCOPE: ScopeFields = {
  own: ["caller_id", "requested_for", "opened_by", "assigned_to"],
  watchers: "watch_list",
  group: "assignment_group_id",
  // the record belongs to the person it is for (its unit/domain anchors come from their profile)
  requester: ["requested_for", "caller_id", "opened_by"],
  // a requester (who is not also working on the record) adds public comments and attachments and changes only these
  requesterWritable: ["description", "urgency", "watch_list"],
  // … and may confirm or reopen a resolved record and cancel a new one
  requesterTransitions: [
    { from: ["resolved"], to: "closed" },
    { from: ["resolved"], to: "in_progress" },
    { from: ["new"], to: "canceled" },
  ],
};

export const TASK_STATES: StateDef[] = [
  { value: "new", label: "جدید", category: "new", color: "blue" },
  { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
  { value: "on_hold", label: "در انتظار", category: "waiting", color: "gold" },
  { value: "resolved", label: "حل‌شده", category: "resolved", color: "green" },
  { value: "closed", label: "بسته", category: "closed", color: "gray" },
  { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
];

/** The default state model of a task table. */
export const DEFAULT_TASK_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: TASK_STATES,
  transitions: [
    { from: ["new", "on_hold"], to: "in_progress", label: "شروع کار" },
    { from: ["new", "in_progress"], to: "on_hold", label: "انتظار" },
    { from: ["new", "in_progress", "on_hold"], to: "resolved", label: "حل شد", requires: ["close_code", "close_notes"] },
    { from: ["resolved"], to: "in_progress", label: "بازگشایی" },
    { from: ["resolved"], to: "closed", label: "بستن" },
    { from: ["new", "in_progress", "on_hold"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

/** Category of a state value (undefined for an unknown value). */
export function stateCategory(model: StateModel | undefined, value: unknown): StateCategory | undefined {
  return model?.states.find((s) => s.value === value)?.category;
}

/** Categories after which a record is done (resolved, closed, canceled). */
export const DONE_CATEGORIES: StateCategory[] = ["resolved", "closed", "canceled"];

/** Transitions out of `from` (never to the same state). */
export function transitionsFrom(model: StateModel | undefined, from: unknown) {
  if (!model) return [];
  return model.transitions.filter((t) => t.to !== from && (t.from === "*" || t.from.includes(String(from ?? ""))));
}
