// Tables of light field service management (docs/modules/field_service_FA.md, catalogue docs/catalog/g4_requests.md
// «Module: field_service»): work orders created from incidents, requests, customer cases, facilities requests,
// maintenance plans or directly, split into dispatchable tasks with skills, time windows, a technician, a visit
// lifecycle with timestamps (dispatched, accepted, en route, on site, complete), checklists, parts, time and travel,
// customer sign-off and a service report; task templates, territories with dispatch groups, technician profiles
// (skills with levels and expiry, certifications, shift calendar, contractors) and time-based maintenance plans that
// generate work ahead of time. Everything is in the access area `field_service` (registered here).
//
// Access: a technician owns the tasks assigned to them (`technician_id`) and reads the work orders those tasks belong
// to (`technicians`, a system copy kept by the module's hook); the dispatch group works the work order and its tasks;
// coordinates of check-ins sit in the «personal» field group (dispatch roles see them, contractors do not). Customers
// never read field records: what they need reaches them as public replies on their own case (en route, arrived,
// report) and through the booking route. Behaviour: src/server/modules/field_service; screens:
// src/ui/modules/field_service. Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { registerArea } from "../access/areas";
import { registerLinkKind } from "../model/links";

registerArea({ key: "field_service", label: "خدمات میدانی", group: "service", module: "field_service" });

// the record a work order was made for (an incident, a customer case, a facilities request…)
registerLinkKind("field_work", { out: "دستور کار برای", in: "دستور کار" });

const o = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

export const WORK_TYPES: Option[] = [
  o("repair", "تعمیر", 1, "red"),
  o("install", "نصب و راه‌اندازی", 2, "blue"),
  o("maintenance", "نگهداری دوره‌ای", 3, "teal"),
  o("inspection", "بازدید و بازرسی", 4, "indigo"),
  o("move", "جابه‌جایی", 5, "purple"),
  o("desk_side", "پشتیبانی پشت میز", 6, "green"),
  o("other", "دیگر", 7, "gray"),
];
export const BILLING_TYPES: Option[] = [o("warranty", "ضمانت", 1, "green"), o("contract", "قرارداد پشتیبانی", 2, "blue"), o("billable", "قابل صورتحساب", 3, "orange"), o("internal", "داخلی", 4, "gray")];
export const COVERAGE: Option[] = [o("covered", "تحت پوشش", 1, "green"), o("not_covered", "بیرون از پوشش", 2, "orange"), o("unknown", "نامعلوم", 3, "gray")];
export const TIME_KINDS: Option[] = [o("work", "کار", 1, "teal"), o("travel", "سفر", 2, "blue"), o("break", "استراحت", 3, "gray"), o("expense", "هزینه", 4, "orange")];
export const INTERVAL_UNITS: Option[] = [o("day", "روز", 1), o("week", "هفته", 2), o("month", "ماه", 3), o("year", "سال", 4)];
export const PLAN_STATUSES: Option[] = [o("active", "فعال", 1, "green"), o("paused", "متوقف", 2, "gold"), o("retired", "بازنشسته", 3, "gray")];
export const PLAN_GENERATES: Option[] = [o("work_order", "دستور کار", 1), o("facility_request", "درخواست تأسیسات", 2)];
export const MAP_PROVIDERS: Option[] = [o("neshan", "نشان", 1), o("balad", "بلد", 2), o("google", "گوگل", 3), o("osm", "اوپن‌استریت‌مپ", 4)];

export const FSM_CHOICE_LISTS: Record<string, Option[]> = { "work_order.work_type": WORK_TYPES };

export const WORK_ORDER_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "qualification", label: "ارزیابی", category: "new", color: "blue" },
    { value: "scheduled", label: "زمان‌بندی‌شده", category: "active", color: "indigo" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "awaiting_parts", label: "منتظر قطعه", category: "waiting", color: "orange" },
    { value: "awaiting_customer", label: "منتظر مشتری", category: "waiting", color: "gold" },
    { value: "work_complete", label: "کار انجام شد", category: "resolved", color: "green" },
    { value: "closed_complete", label: "بسته — انجام شد", category: "closed", color: "green" },
    { value: "closed_incomplete", label: "بسته — انجام نشد", category: "closed", color: "gray" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "qualification", label: "ارسال برای ارزیابی" },
    { from: ["draft", "qualification"], to: "scheduled", label: "آمادهٔ توزیع", guard: "wo_has_tasks" },
    { from: ["scheduled", "awaiting_parts", "awaiting_customer"], to: "in_progress", label: "شروع کار" },
    { from: ["scheduled", "in_progress"], to: "awaiting_parts", label: "منتظر قطعه" },
    { from: ["scheduled", "in_progress"], to: "awaiting_customer", label: "منتظر مشتری" },
    { from: ["awaiting_parts", "awaiting_customer"], to: "scheduled", label: "زمان‌بندی دوباره" },
    { from: ["scheduled", "in_progress", "awaiting_parts", "awaiting_customer"], to: "work_complete", label: "کار انجام شد", guard: "wo_tasks_done" },
    { from: ["work_complete"], to: "closed_complete", label: "بستن" },
    { from: ["work_complete"], to: "in_progress", label: "بازگشایی" },
    { from: ["scheduled", "in_progress", "awaiting_parts", "awaiting_customer", "work_complete"], to: "closed_incomplete", label: "بستن بدون انجام", requires: ["close_notes"] },
    { from: ["draft", "qualification", "scheduled", "awaiting_parts", "awaiting_customer"], to: "cancelled", label: "لغو", requires: ["close_notes"] },
  ],
};

const W_MAIN = "اصلی";
const W_SITE = "محل و مشتری";
const W_RESULT = "نتیجه";

const workOrder: TableDef = {
  key: "work_order",
  table: "sm_work_orders",
  label: "دستور کار",
  plural: "دستورهای کار",
  icon: "hard-hat",
  module: "field_service",
  area: "field_service",
  description: "کار در محل برای یک رخداد، درخواست، پرونده، تغییر یا برنامهٔ نگهداری: محل با راهنمای دسترسی، دارایی، علائم، پوشش و وظیفه‌های قابل توزیع",
  extends: "task",
  numbered: { prefix: "WO", pad: 7 },
  display: "short_description",
  fields: [
    { name: "work_type", label: "نوع کار", type: "choice", choices: "work_order.work_type", default: "repair", list: true, filter: true, span: 8, section: W_MAIN },
    { name: "symptoms", label: "علائم", type: "text", span: 24, section: W_MAIN },
    { name: "required_skills", label: "مهارت‌های لازم", type: "tags", filter: true, span: 16, section: W_MAIN },
    { name: "template_id", label: "الگوی وظیفه", type: "ref", ref: "wo_task_template", span: 8, section: W_MAIN },
    { name: "parent_table", label: "جدول مبدأ", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true },
    { name: "parent_record", label: "شناسهٔ مبدأ", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true },
    { name: "parent_number", label: "رکورد مبدأ", type: "string", maxLength: 40, ltr: true, readonly: true, list: true, search: true, span: 8, section: W_MAIN },
    { name: "maintenance_plan_id", label: "برنامهٔ نگهداری", type: "ref", ref: "maintenance_plan", readonly: true, filter: true, span: 8, section: W_MAIN },
    { name: "territory_id", label: "قلمرو", type: "ref", ref: "territory", list: true, filter: true, index: true, span: 8, section: W_MAIN },
    { name: "account_id", label: "حساب مشتری", type: "ref", ref: "customer_account", filter: true, index: true, span: 8, section: W_SITE },
    { name: "contact_id", label: "مخاطب در محل", type: "ref", ref: "customer_contact", span: 8, section: W_SITE },
    { name: "site_phone", label: "تلفن محل", type: "phone", group: "personal", span: 8, section: W_SITE },
    { name: "site_address", label: "نشانی", type: "text", span: 24, section: W_SITE },
    { name: "site_lat", label: "عرض جغرافیایی", type: "decimal", min: -90, max: 90, span: 8, section: W_SITE },
    { name: "site_lng", label: "طول جغرافیایی", type: "decimal", min: -180, max: 180, span: 8, section: W_SITE },
    { name: "access_notes", label: "راهنمای دسترسی به محل", type: "text", span: 24, section: W_SITE },
    { name: "asset_ref", label: "دارایی", type: "string", maxLength: 120, ltr: true, span: 8, section: W_SITE, help: "شناسهٔ دارایی در مدیریت دارایی (وقتی آن ماژول نصب است)" },
    { name: "billing_type", label: "نوع هزینه", type: "choice", choices: BILLING_TYPES, default: "internal", filter: true, span: 8, section: W_SITE },
    { name: "coverage", label: "پوشش", type: "choice", choices: COVERAGE, readonly: true, default: "unknown", filter: true, span: 8, section: W_SITE },
    { name: "entitlement_id", label: "استحقاق", type: "ref", ref: "entitlement", readonly: true, span: 8, section: W_SITE },
    { name: "tasks_total", label: "وظیفه‌ها", type: "int", readonly: true, default: 0, audit: false, span: 6, section: W_RESULT },
    { name: "tasks_open", label: "وظیفه‌های باز", type: "int", readonly: true, default: 0, audit: false, span: 6, section: W_RESULT },
    { name: "visits", label: "بازدیدها", type: "int", readonly: true, default: 0, audit: false, span: 6, section: W_RESULT },
    { name: "first_time_fix", label: "در نخستین بازدید حل شد", type: "bool", readonly: true, default: false, filter: true, span: 6, section: W_RESULT },
    { name: "scheduled_start", label: "نخستین بازدید", type: "datetime", readonly: true, list: true, sort: true, span: 8, section: W_RESULT },
    { name: "work_minutes", label: "زمان کار (دقیقه)", type: "int", readonly: true, default: 0, audit: false, span: 8, section: W_RESULT },
    { name: "travel_minutes", label: "زمان سفر (دقیقه)", type: "int", readonly: true, default: 0, audit: false, span: 8, section: W_RESULT },
    { name: "technicians", label: "تکنسین‌ها", type: "users", system: true, hidden: true, audit: false },
  ],
  states: WORK_ORDER_STATES,
  scope: {
    own: ["caller_id", "requested_for", "opened_by", "assigned_to"],
    requester: ["requested_for", "caller_id", "opened_by"],
    readers: ["technicians"],
    watchers: "watch_list",
    group: "assignment_group_id",
  },
  features: { sla: true, approvals: false, kanban: "state", rag: true },
  ai: { title: "short_description", text: ["description", "symptoms", "close_notes"] },
  form: {
    sections: [W_MAIN, W_SITE, W_RESULT],
    related: [
      { table: "wo_task", field: "work_order_id", label: "وظیفه‌ها و بازدیدها", columns: ["number", "short_description", "state", "technician_id", "scheduled_start", "arrived_at"] },
      { table: "parts_requirement", field: "work_order_id", label: "قطعه‌ها", columns: ["part_name", "quantity", "state", "stockroom"] },
      { table: "field_time_entry", field: "work_order_id", label: "زمان و هزینه", columns: ["kind", "user_id", "minutes", "amount", "started_at"] },
    ],
  },
  list: { columns: ["number", "short_description", "work_type", "state", "priority", "territory_id", "scheduled_start", "assigned_to"], order: "-updated_at" },
};

export const WO_TASK_STATES: StateModel = {
  field: "state",
  initial: "pending_dispatch",
  states: [
    { value: "pending_dispatch", label: "منتظر توزیع", category: "new", color: "blue" },
    { value: "assigned", label: "واگذارشده", category: "active", color: "indigo" },
    { value: "accepted", label: "پذیرفته‌شده", category: "active", color: "purple" },
    { value: "en_route", label: "در راه", category: "active", color: "orange" },
    { value: "on_site", label: "در محل", category: "active", color: "teal" },
    { value: "on_hold", label: "متوقف", category: "waiting", color: "gold" },
    { value: "pending_parts", label: "منتظر قطعه", category: "waiting", color: "orange" },
    { value: "work_complete", label: "کار انجام شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["pending_dispatch"], to: "assigned", label: "واگذاری", requires: ["technician_id"] },
    { from: ["assigned"], to: "accepted", label: "پذیرش" },
    { from: ["assigned", "accepted"], to: "pending_dispatch", label: "رد کار", requires: ["hold_reason"] },
    { from: ["accepted", "assigned"], to: "en_route", label: "حرکت به محل" },
    { from: ["accepted", "en_route"], to: "on_site", label: "رسیدن به محل" },
    { from: ["on_site"], to: "on_hold", label: "توقف", requires: ["hold_reason"] },
    { from: ["on_site"], to: "pending_parts", label: "منتظر قطعه" },
    { from: ["on_hold", "pending_parts"], to: "on_site", label: "ادامهٔ کار" },
    { from: ["on_hold", "pending_parts"], to: "assigned", label: "بازدید دوباره", requires: ["revisit_reason"] },
    { from: ["on_site"], to: "work_complete", label: "کار انجام شد", requires: ["resolution"], guard: "wot_checklist" },
    { from: ["work_complete"], to: "closed", label: "بستن" },
    { from: ["work_complete"], to: "on_site", label: "بازگشایی" },
    { from: ["pending_dispatch", "assigned", "accepted", "en_route", "on_hold", "pending_parts"], to: "cancelled", label: "لغو", requires: ["hold_reason"] },
  ],
};

const T_MAIN = "اصلی";
const T_TIME = "زمان‌ها";
const T_DONE = "پایان کار";

const woTask: TableDef = {
  key: "wo_task",
  table: "sm_wo_tasks",
  label: "وظیفهٔ دستور کار",
  plural: "وظیفه‌های دستور کار",
  icon: "wrench",
  module: "field_service",
  area: "field_service",
  description: "بازدید قابل توزیع: مهارت‌ها، مدت و سفر برآوردی، بازهٔ زمانی، تکنسین، چرخهٔ بازدید با زمان هر گام، چک‌لیست و امضای مشتری",
  numbered: { prefix: "WOT", pad: 7 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16, section: T_MAIN },
    { name: "work_order_id", label: "دستور کار", type: "ref", ref: "work_order", required: true, list: true, filter: true, index: true, span: 8, section: T_MAIN },
    { name: "technician_id", label: "تکنسین", type: "user", list: true, filter: true, index: true, span: 8, section: T_MAIN },
    { name: "assignment_group_id", label: "گروه توزیع", type: "group", filter: true, index: true, span: 8, section: T_MAIN },
    { name: "priority", label: "اولویت", type: "choice", choices: [o("1", "۱ — بحرانی", 1, "red"), o("2", "۲ — زیاد", 2, "orange"), o("3", "۳ — متوسط", 3, "gold"), o("4", "۴ — کم", 4, "blue"), o("5", "۵ — برنامه‌ریزی", 5, "gray")], default: "3", list: true, filter: true, sort: true, span: 8, section: T_MAIN },
    { name: "template_id", label: "الگو", type: "ref", ref: "wo_task_template", span: 8, section: T_MAIN },
    { name: "required_skills", label: "مهارت‌های لازم", type: "tags", filter: true, span: 16, section: T_MAIN },
    { name: "est_work_minutes", label: "مدت کار برآوردی (دقیقه)", type: "int", min: 0, default: 60, span: 8, section: T_MAIN },
    { name: "est_travel_minutes", label: "سفر برآوردی (دقیقه)", type: "int", min: 0, span: 8, section: T_MAIN },
    { name: "window_start", label: "بازهٔ مشتری از", type: "datetime", sort: true, span: 8, section: T_MAIN },
    { name: "window_end", label: "بازهٔ مشتری تا", type: "datetime", span: 8, section: T_MAIN },
    { name: "scheduled_start", label: "شروع برنامه", type: "datetime", list: true, sort: true, filter: true, span: 8, section: T_MAIN },
    { name: "scheduled_end", label: "پایان برنامه", type: "datetime", sort: true, span: 8, section: T_MAIN },
    { name: "instructions", label: "شرح کار", type: "markdown", span: 24, section: T_MAIN },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", system: true, filter: true },
    { name: "territory_id", label: "قلمرو", type: "ref", ref: "territory", system: true, filter: true, index: true },
    { name: "account_id", label: "حساب مشتری", type: "ref", ref: "customer_account", system: true, filter: true },
    { name: "site_lat", label: "عرض جغرافیایی محل", type: "decimal", system: true, audit: false },
    { name: "site_lng", label: "طول جغرافیایی محل", type: "decimal", system: true, audit: false },
    { name: "dispatched_at", label: "زمان واگذاری", type: "datetime", readonly: true, sort: true, span: 8, section: T_TIME },
    { name: "accepted_at", label: "زمان پذیرش", type: "datetime", readonly: true, span: 8, section: T_TIME },
    { name: "en_route_at", label: "زمان حرکت", type: "datetime", readonly: true, span: 8, section: T_TIME },
    { name: "arrived_at", label: "زمان رسیدن", type: "datetime", readonly: true, sort: true, span: 8, section: T_TIME },
    { name: "completed_at", label: "زمان پایان کار", type: "datetime", readonly: true, sort: true, span: 8, section: T_TIME },
    { name: "eta_at", label: "زمان رسیدن پیش‌بینی‌شده", type: "datetime", readonly: true, span: 8, section: T_TIME },
    { name: "travel_minutes", label: "سفر (دقیقه)", type: "int", readonly: true, span: 6, section: T_TIME },
    { name: "work_minutes", label: "کار (دقیقه)", type: "int", readonly: true, span: 6, section: T_TIME },
    { name: "break_minutes", label: "استراحت (دقیقه)", type: "int", readonly: true, default: 0, span: 6, section: T_TIME },
    { name: "visit_no", label: "شمارهٔ بازدید", type: "int", readonly: true, default: 1, span: 6, section: T_TIME },
    { name: "sla_due", label: "مهلت رسیدن", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: T_TIME },
    { name: "hold_reason", label: "دلیل توقف، رد یا لغو", type: "text", span: 24, section: T_DONE },
    { name: "revisit_reason", label: "دلیل بازدید دوباره", type: "text", span: 24, section: T_DONE },
    { name: "checklist", label: "چک‌لیست", type: "json", readonly: true, audit: false, default: [], span: 24, section: T_DONE },
    { name: "checklist_answers", label: "پاسخ‌های چک‌لیست", type: "json", default: {}, span: 24, section: T_DONE },
    { name: "checklist_done", label: "چک‌لیست کامل است", type: "bool", readonly: true, default: false, span: 8, section: T_DONE },
    { name: "resolution", label: "شرح کار انجام‌شده", type: "text", span: 24, section: T_DONE },
    { name: "signer_name", label: "نام امضاکنندهٔ مشتری", type: "string", maxLength: 120, readonly: true, span: 8, section: T_DONE },
    { name: "signed_at", label: "زمان امضا", type: "datetime", readonly: true, span: 8, section: T_DONE },
    { name: "signature_id", label: "پیوست امضا", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true },
    { name: "service_report", label: "گزارش خدمت", type: "markdown", readonly: true, audit: false, span: 24, section: T_DONE },
    { name: "check_in_lat", label: "عرض ورود", type: "decimal", readonly: true, group: "personal", audit: false, noSync: true, span: 6, section: T_TIME },
    { name: "check_in_lng", label: "طول ورود", type: "decimal", readonly: true, group: "personal", audit: false, noSync: true, span: 6, section: T_TIME },
    { name: "check_out_lat", label: "عرض خروج", type: "decimal", readonly: true, group: "personal", audit: false, noSync: true, span: 6, section: T_TIME },
    { name: "check_out_lng", label: "طول خروج", type: "decimal", readonly: true, group: "personal", audit: false, noSync: true, span: 6, section: T_TIME },
  ],
  states: WO_TASK_STATES,
  scope: { own: ["technician_id"], requester: [], group: "assignment_group_id" },
  features: { journal: true, attachments: true, links: false, watchers: false, sla: true, kanban: "state", calendar: { start: "scheduled_start", end: "scheduled_end" } },
  form: {
    sections: [T_MAIN, T_TIME, T_DONE],
    related: [{ table: "parts_requirement", field: "wo_task_id", label: "قطعه‌ها", columns: ["part_name", "quantity", "state", "stockroom", "serial_no"] }, { table: "field_time_entry", field: "wo_task_id", label: "زمان و هزینه", columns: ["kind", "minutes", "amount", "started_at"] }],
  },
  list: { columns: ["number", "short_description", "state", "priority", "technician_id", "scheduled_start", "territory_id"], order: "scheduled_start,-updated_at" },
};

const woTaskTemplate: TableDef = {
  key: "wo_task_template",
  table: "sm_wo_task_templates",
  label: "الگوی وظیفهٔ میدانی",
  plural: "الگوهای وظیفهٔ میدانی",
  icon: "clipboard-list",
  module: "field_service",
  area: "field_service",
  description: "الگوی کار تکراری: مهارت‌ها، مدت، قطعه‌ها، چک‌لیست اجباری پیش از پایان و نکته‌های ایمنی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "work_type", label: "نوع کار", type: "choice", choices: "work_order.work_type", default: "repair", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "required_skills", label: "مهارت‌های لازم", type: "tags", span: 16 },
    { name: "est_work_minutes", label: "مدت کار (دقیقه)", type: "int", min: 0, default: 60, span: 8 },
    { name: "checklist", label: "چک‌لیست", type: "json", default: [], span: 24, help: "[{\"key\": \"power_off\", \"label\": \"برق قطع شد\", \"type\": \"bool\", \"required\": true}]" },
    { name: "parts", label: "قطعه‌های معمول", type: "json", default: [], span: 24, help: "[{\"name\": \"فیلتر هوا\", \"quantity\": 1}]" },
    { name: "instructions", label: "شرح کار", type: "markdown", span: 24 },
    { name: "safety", label: "نکته‌های ایمنی", type: "markdown", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "work_type", "est_work_minutes", "active"], order: "name" },
};

const territory: TableDef = {
  key: "territory",
  table: "sm_territories",
  label: "قلمرو",
  plural: "قلمروها",
  icon: "map",
  module: "field_service",
  area: "field_service",
  description: "منطقهٔ خدمت با مکان‌ها، گروه توزیع، تقویم کاری، مرکز و شعاع",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "locations", label: "مکان‌ها", type: "refs", ref: "location", span: 24 },
    { name: "dispatch_group_id", label: "گروه توزیع", type: "group", list: true, filter: true, span: 12 },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 12 },
    { name: "center_lat", label: "عرض مرکز", type: "decimal", min: -90, max: 90, span: 8 },
    { name: "center_lng", label: "طول مرکز", type: "decimal", min: -180, max: 180, span: 8 },
    { name: "radius_km", label: "شعاع (کیلومتر)", type: "int", min: 0, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { group: "dispatch_group_id", public: true },
  list: { columns: ["name", "code", "dispatch_group_id", "active"], order: "name" },
};

const technician: TableDef = {
  key: "technician",
  table: "sm_technicians",
  label: "تکنسین",
  plural: "تکنسین‌ها",
  icon: "user-cog",
  module: "field_service",
  area: "field_service",
  description: "نمایهٔ تکنسین: قلمروها، مهارت‌ها با سطح و انقضا، گواهی‌ها، تقویم شیفت، ظرفیت روزانه و پیمانکار بودن",
  display: "name",
  fields: [
    { name: "user_id", label: "عضو", type: "user", required: true, unique: true, list: true, filter: true, span: 12 },
    { name: "name", label: "نام", type: "string", system: true, maxLength: 160, list: true, search: true, sort: true },
    { name: "territories", label: "قلمروها", type: "refs", ref: "territory", list: true, span: 12 },
    { name: "dispatch_group_id", label: "گروه توزیع", type: "group", filter: true, span: 12 },
    { name: "skills", label: "مهارت‌ها", type: "json", default: [], span: 24, help: "[{\"skill\": \"برق\", \"level\": 3, \"expires_on\": \"2027-03-20\"}]" },
    { name: "skill_tags", label: "مهارت‌های معتبر", type: "tags", system: true, filter: true, list: true },
    { name: "certifications", label: "گواهی‌ها", type: "json", default: [], span: 24, help: "[{\"name\": \"کار در ارتفاع\", \"expires_on\": \"2026-12-21\"}]" },
    { name: "calendar_id", label: "تقویم شیفت", type: "ref", ref: "calendar", span: 8 },
    { name: "max_tasks_per_day", label: "بیشینهٔ کار در روز", type: "int", min: 1, max: 30, default: 6, span: 8 },
    { name: "contractor", label: "پیمانکار", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "company", label: "شرکت پیمانکار", type: "string", maxLength: 120, span: 12 },
    { name: "vehicle", label: "خودرو", type: "string", maxLength: 80, span: 12 },
    { name: "home_lat", label: "عرض محل شروع", type: "decimal", min: -90, max: 90, group: "personal", span: 6 },
    { name: "home_lng", label: "طول محل شروع", type: "decimal", min: -180, max: 180, group: "personal", span: 6 },
    { name: "last_lat", label: "آخرین عرض", type: "decimal", readonly: true, group: "personal", audit: false, noSync: true, span: 6 },
    { name: "last_lng", label: "آخرین طول", type: "decimal", readonly: true, group: "personal", audit: false, noSync: true, span: 6 },
    { name: "last_seen_at", label: "آخرین موقعیت", type: "datetime", readonly: true, group: "personal", audit: false, noSync: true, span: 8 },
    { name: "available", label: "در دسترس", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
  ],
  scope: { own: ["user_id"], requester: [], group: "dispatch_group_id", public: true },
  list: { columns: ["name", "skill_tags", "territories", "contractor", "available"], order: "name" },
};

export const PART_STATES: StateModel = {
  field: "state",
  initial: "reserved",
  states: [
    { value: "reserved", label: "رزروشده", category: "new", color: "blue" },
    { value: "picked", label: "برداشته‌شده", category: "active", color: "teal" },
    { value: "consumed", label: "مصرف‌شده", category: "closed", color: "green" },
    { value: "returned", label: "برگشتی", category: "canceled", color: "gold" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["reserved"], to: "picked", label: "برداشتن" },
    { from: ["reserved", "picked"], to: "consumed", label: "مصرف" },
    { from: ["picked", "consumed"], to: "returned", label: "برگشت" },
    { from: ["reserved"], to: "cancelled", label: "لغو" },
  ],
};

const partsRequirement: TableDef = {
  key: "parts_requirement",
  table: "sm_parts_requirements",
  label: "قطعهٔ لازم",
  plural: "قطعه‌های لازم",
  icon: "cog",
  module: "field_service",
  area: "field_service",
  description: "قطعهٔ لازم یک وظیفه با انبار مبدأ، رزرو، برداشتن، مصرف، برگشت و قطعهٔ معیوب",
  display: "part_name",
  fields: [
    { name: "part_name", label: "قطعه", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "part_code", label: "کد قطعه", type: "string", maxLength: 60, ltr: true, search: true, span: 6 },
    { name: "quantity", label: "تعداد", type: "decimal", min: 0, default: "1", list: true, span: 6 },
    { name: "wo_task_id", label: "وظیفه", type: "ref", ref: "wo_task", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "work_order_id", label: "دستور کار", type: "ref", ref: "work_order", system: true, filter: true, index: true },
    { name: "stockroom", label: "انبار مبدأ", type: "string", maxLength: 120, list: true, span: 12, help: "نام انبار یا خودرو؛ با مدیریت دارایی، شناسهٔ انبار" },
    { name: "serial_no", label: "شمارهٔ سریال", type: "string", maxLength: 80, ltr: true, span: 8 },
    { name: "defective_returned", label: "قطعهٔ معیوب برگشت داده شد", type: "bool", default: false, span: 8 },
    { name: "rma_no", label: "شمارهٔ مرجوعی", type: "string", maxLength: 60, ltr: true, span: 8 },
    { name: "technician_id", label: "تکنسین", type: "user", system: true, filter: true, index: true },
    { name: "assignment_group_id", label: "گروه توزیع", type: "group", system: true, filter: true, index: true },
  ],
  states: PART_STATES,
  scope: { own: ["technician_id"], requester: [], group: "assignment_group_id" },
  features: { journal: false, attachments: false },
  list: { columns: ["part_name", "quantity", "wo_task_id", "state", "stockroom"], order: "-updated_at" },
};

const maintenancePlan: TableDef = {
  key: "maintenance_plan",
  table: "sm_maintenance_plans",
  label: "برنامهٔ نگهداری",
  plural: "برنامه‌های نگهداری",
  icon: "calendar-cog",
  module: "field_service",
  area: "field_service",
  description: "نگهداری و بازدید دوره‌ای یک دارایی، مکان یا مشتری: هر چند روز/هفته/ماه، چند روز زودتر دستور کار یا درخواست تأسیسات می‌سازد؛ ویرایش فقط نوبت‌های آینده را تغییر می‌دهد",
  numbered: { prefix: "PMP", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "status", label: "وضعیت", type: "choice", choices: PLAN_STATUSES, default: "active", list: true, filter: true, span: 6 },
    { name: "generates", label: "می‌سازد", type: "choice", choices: PLAN_GENERATES, default: "work_order", span: 6 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 8 },
    { name: "account_id", label: "حساب مشتری", type: "ref", ref: "customer_account", filter: true, span: 8 },
    { name: "template_id", label: "الگوی وظیفه", type: "ref", ref: "wo_task_template", span: 8 },
    { name: "group_id", label: "گروه انجام", type: "group", filter: true, span: 8 },
    { name: "territory_id", label: "قلمرو", type: "ref", ref: "territory", filter: true, span: 8 },
    { name: "every_n", label: "هر", type: "int", min: 1, max: 365, default: 1, required: true, span: 6 },
    { name: "interval_unit", label: "واحد", type: "choice", choices: INTERVAL_UNITS, default: "month", required: true, span: 6 },
    { name: "lead_days", label: "چند روز زودتر بسازد", type: "int", min: 0, max: 90, default: 7, span: 6 },
    { name: "horizon", label: "نوبت‌های پیش رو", type: "int", min: 1, max: 12, default: 1, span: 6 },
    { name: "next_due", label: "نوبت بعدی", type: "date", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "last_generated_due", label: "آخرین نوبت ساخته‌شده", type: "date", readonly: true, span: 8 },
    { name: "priority", label: "اولویت", type: "choice", choices: [o("2", "۲ — زیاد", 2), o("3", "۳ — متوسط", 3), o("4", "۴ — کم", 4)], default: "4", span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
  ],
  scope: { group: "group_id" },
  features: { journal: true, attachments: true },
  form: { related: [{ table: "work_order", field: "maintenance_plan_id", label: "دستورهای کار ساخته‌شده", columns: ["number", "short_description", "state", "scheduled_start"] }] },
  list: { columns: ["number", "name", "status", "every_n", "interval_unit", "next_due", "group_id"], order: "next_due" },
};

const fieldTimeEntry: TableDef = {
  key: "field_time_entry",
  table: "sm_field_time_entries",
  label: "ثبت زمان و هزینهٔ میدانی",
  plural: "زمان و هزینهٔ میدانی",
  icon: "timer",
  module: "field_service",
  area: "field_service",
  description: "زمان کار، سفر و استراحت هر وظیفه و هزینه‌ها با رسید، برای هزینه‌یابی و کارکرد",
  display: "kind",
  fields: [
    { name: "wo_task_id", label: "وظیفه", type: "ref", ref: "wo_task", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: TIME_KINDS, default: "work", required: true, list: true, filter: true, span: 6 },
    { name: "user_id", label: "فرد", type: "user", default: "$me", list: true, filter: true, index: true, span: 6 },
    { name: "started_at", label: "از", type: "datetime", list: true, sort: true, span: 8 },
    { name: "ended_at", label: "تا", type: "datetime", span: 8 },
    { name: "minutes", label: "دقیقه", type: "int", min: 0, list: true, span: 8 },
    { name: "amount", label: "مبلغ هزینه", type: "money", min: 0, list: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "work_order_id", label: "دستور کار", type: "ref", ref: "work_order", system: true, filter: true, index: true },
    { name: "assignment_group_id", label: "گروه توزیع", type: "group", system: true, filter: true, index: true },
  ],
  scope: { own: ["user_id"], requester: [], group: "assignment_group_id" },
  features: { journal: false, attachments: true },
  list: { columns: ["wo_task_id", "kind", "user_id", "started_at", "minutes", "amount"], order: "-started_at" },
};

export interface FsmConfig {
  travel_speed_kmh: number;
  road_factor: number;
  arrival_target_minutes: number;
  location_retention_days: number;
  map_provider: string;
}

export const FSM_CONFIG_DEFAULTS: FsmConfig = { travel_speed_kmh: 35, road_factor: 1.3, arrival_target_minutes: 240, location_retention_days: 7, map_provider: "neshan" };

const fsmConfig: TableDef = {
  key: "fsm_config",
  table: "sm_fsm_config",
  label: "تنظیمات خدمات میدانی",
  plural: "تنظیمات خدمات میدانی",
  icon: "settings",
  module: "field_service",
  area: "field_service",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 80, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, maxLength: 40, unique: true, ltr: true, span: 12 },
    { name: "default_group_id", label: "گروه توزیع پیش‌فرض", type: "group", span: 12 },
    { name: "travel_speed_kmh", label: "سرعت میانگین سفر (کیلومتر در ساعت)", type: "int", min: 5, max: 120, default: 35, span: 12 },
    { name: "road_factor", label: "ضریب مسیر به خط مستقیم", type: "decimal", min: 1, max: 3, default: "1.3", span: 12 },
    { name: "arrival_target_minutes", label: "هدف رسیدن به محل (دقیقه)", type: "int", min: 15, max: 10080, default: 240, span: 12 },
    { name: "location_retention_days", label: "نگهداری موقعیت‌های ورود و خروج (روز)", type: "int", min: 1, max: 90, default: 7, span: 12 },
    { name: "map_provider", label: "مسیریاب", type: "choice", choices: MAP_PROVIDERS, default: "neshan", span: 12 },
    { name: "seeded", label: "نسخهٔ دادهٔ آغازین", type: "int", system: true, default: 0, audit: false },
  ],
  scope: { public: true },
  list: { columns: ["name"], order: "name" },
};

export const FSM_TABLES: TableDef[] = [workOrder, woTask, woTaskTemplate, territory, technician, partsRequirement, maintenancePlan, fieldTimeEntry, fsmConfig];

/** Rows that copy their work order's dispatch group (and their task's technician). */
export const WO_CHILD_TABLES = ["wo_task", "parts_requirement", "field_time_entry"];
