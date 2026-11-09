// Tables of enterprise service management (docs/modules/esm_FA.md, catalogue docs/catalog/g4_requests.md «Module:
// esm»): service management for every department on the same engine — each department is a profile of an access
// workspace (`esm_department`: kind, live/in-setup state, delegated administrators, portal section) with its own
// services (`esm_service`: department → category → service, intake form from the catalogue, routing, audience) and
// case tables extending the task base: HR cases and HR tasks (the HR secure workspace), facilities requests, finance
// cases, legal requests (a secure workspace too), purchase requests under a delegation-of-authority matrix and a
// generic department case. Employee journeys (onboarding, offboarding, movers…) are versioned templates of activities
// planned on the working calendar and executed across departments (`journey`, `journey_activity`); facilities add
// bookable spaces, reservations with check-in and waitlists, visitors and health-and-safety events; HR adds
// employment profiles (audiences) and employee-relations notes readable only by named specialists.
//
// Access: department isolation is the access model's workspace rule — every case carries its department's
// `workspace_id` (stamped by the module's hook, never by people); HR and legal live in secure workspaces (deny by
// default: explicit members only, not tenant administrators or auditors). Configuration (departments, services,
// journey templates) is the area `esm`, written by the module's department administrators (`dept_admins`: a system
// copy of the department's administrators — the role «مدیر خدمات واحد» writes only the rows it owns this way).
// Behaviour: src/server/modules/esm; screens: src/ui/modules/esm. Imported by the UI: keep it free of server imports.
import type { FieldDef, Option, ScopeFields, StateModel, TableDef, TableFeatures, RelatedList } from "../model/types";
import { APPROVAL_STATES } from "../model/task";
import { registerLinkKind } from "../model/links";
import { registerArea } from "../access/areas";

registerArea({ key: "esm", label: "خدمات سازمانی", group: "service", module: "esm" });

// one request spawning work in another department (ESM-010): the parent's requester follows one record
registerLinkKind("esm_child", { out: "کار واحد دیگر برای", in: "کار واحد دیگر" });
// a case moved to another department (ESM-009): the new case keeps the old one as its origin
registerLinkKind("esm_transfer", { out: "منتقل‌شده از", in: "منتقل‌شده به" });

const o = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

// ----- vocabularies ---------------------------------------------------------------------------------------------------

export const DEPARTMENT_KINDS: Option[] = [
  o("hr", "منابع انسانی", 1, "magenta"),
  o("facilities", "پشتیبانی و تأسیسات", 2, "teal"),
  o("finance", "مالی", 3, "green"),
  o("legal", "حقوقی", 4, "indigo"),
  o("procurement", "تدارکات", 5, "orange"),
  o("security", "امنیت و انطباق", 6, "red"),
  o("it", "فناوری اطلاعات", 7, "blue"),
  o("custom", "واحد دیگر", 8, "gray"),
];

export const DEPARTMENT_STATES: Option[] = [o("setup", "در حال راه‌اندازی", 1, "gold"), o("live", "فعال", 2, "green"), o("retired", "بازنشسته", 3, "gray")];

/** The case tables of the departments (ESM-007): one task-based table each, plus the generic department case. */
export const ESM_CASE_TABLES = ["hr_case", "facility_request", "finance_case", "legal_request", "purchase_request", "service_case"] as const;
export type EsmCaseTable = (typeof ESM_CASE_TABLES)[number];
export const isEsmCaseTable = (t: unknown): t is EsmCaseTable => (ESM_CASE_TABLES as readonly string[]).includes(String(t));

export const CASE_TABLE_OPTIONS: Option[] = [
  o("hr_case", "پروندهٔ منابع انسانی", 1),
  o("facility_request", "درخواست پشتیبانی و تأسیسات", 2),
  o("finance_case", "پروندهٔ مالی", 3),
  o("legal_request", "درخواست حقوقی", 4),
  o("purchase_request", "درخواست خرید", 5),
  o("service_case", "پروندهٔ عمومی واحد", 6),
];

/** The department kind whose workspace a case table lives in by default (the HSE event is a facilities record). */
export const CASE_TABLE_KIND: Record<string, string> = {
  hse_event: "facilities",
  hr_case: "hr",
  facility_request: "facilities",
  finance_case: "finance",
  legal_request: "legal",
  purchase_request: "procurement",
  service_case: "custom",
};

export const ON_BEHALF: Option[] = [o("self", "فقط برای خود", 1), o("manager", "مدیر برای کارکنانش", 2), o("anyone", "برای هر کس", 3)];

export const COES: Option[] = [
  o("hr_operations", "عملیات منابع انسانی", 1),
  o("payroll", "حقوق و دستمزد", 2),
  o("benefits", "رفاه و مزایا", 3),
  o("talent", "جذب و استعداد", 4),
  o("learning", "آموزش و توسعه", 5),
  o("employee_relations", "روابط کار", 6),
  o("policy", "سیاست‌ها و مقررات", 7),
];

export const CONFIDENTIALITY: Option[] = [o("normal", "عادی", 1, "gray"), o("restricted", "محدود", 2, "gold"), o("highly", "بسیار محرمانه", 3, "red")];

export const HR_TASK_TYPES: Option[] = [
  o("task", "کار", 1, "blue"),
  o("sign", "امضای سند", 2, "indigo"),
  o("form", "تکمیل فرم", 3, "teal"),
  o("upload", "بارگذاری مدرک", 4, "orange"),
  o("acknowledge", "تأیید خواندن", 5, "purple"),
  o("learning", "آموزش", 6, "green"),
  o("survey", "نظرسنجی", 7, "gold"),
];

export const EMPLOYMENT_TYPES: Option[] = [
  o("permanent", "رسمی و دائم", 1),
  o("contract", "قراردادی", 2),
  o("temporary", "موقت", 3),
  o("project", "پروژه‌ای", 4),
  o("intern", "کارآموز", 5),
  o("consultant", "مشاور", 6),
];

export const PROFILE_STATES: Option[] = [o("pre_hire", "پیش از شروع", 1, "blue"), o("active", "شاغل", 2, "green"), o("leave", "مرخصی طولانی", 3, "gold"), o("notice", "در حال خروج", 4, "orange"), o("terminated", "خاتمهٔ همکاری", 5, "gray")];

export const ER_NOTE_TYPES: Option[] = [
  o("allegation", "ادعا", 1, "red"),
  o("interview", "مصاحبه", 2, "blue"),
  o("finding", "یافته", 3, "indigo"),
  o("determination", "تصمیم", 4, "purple"),
  o("outcome", "نتیجه", 5, "green"),
  o("wellbeing", "ارزیابی سلامت و رفاه", 6, "teal"),
  o("performance", "ارزیابی عملکرد", 7, "gold"),
  o("other", "دیگر", 8, "gray"),
];

export const JOURNEY_TYPES: Option[] = [
  o("onboarding", "ورود کارکنان", 1, "green"),
  o("offboarding", "خروج کارکنان", 2, "red"),
  o("mover", "جابه‌جایی داخلی", 3, "blue"),
  o("leave", "مرخصی طولانی", 4, "gold"),
  o("return", "بازگشت از مرخصی", 5, "teal"),
  o("relocation", "انتقال محل کار", 6, "purple"),
  o("promotion", "ارتقا", 7, "indigo"),
  o("custom", "سفر دیگر", 8, "gray"),
];

export const JOURNEY_PHASES: Option[] = [
  o("pre_start", "پیش از شروع", 1, "blue"),
  o("day_one", "روز نخست", 2, "green"),
  o("first_week", "هفتهٔ نخست", 3, "teal"),
  o("first_month", "ماه نخست", 4, "indigo"),
  o("before_end", "پیش از روز آخر", 5, "gold"),
  o("last_day", "روز آخر", 6, "orange"),
  o("after", "پس از آن", 7, "gray"),
];

export const ACTIVITY_KINDS: Option[] = [
  o("task", "کار", 1, "blue"),
  o("order", "سفارش از کاتالوگ", 2, "teal"),
  o("case", "پرونده در واحد دیگر", 3, "purple"),
  o("approval", "تأیید", 4, "gold"),
  o("sign", "امضای سند", 5, "indigo"),
  o("form", "تکمیل فرم", 6, "teal"),
  o("upload", "بارگذاری مدرک", 7, "orange"),
  o("acknowledge", "تأیید خواندن", 8, "purple"),
  o("learning", "آموزش", 9, "green"),
  o("survey", "نظرسنجی", 10, "gold"),
  o("notify", "اعلان", 11, "gray"),
];

export const ACTIVITY_ASSIGNEES: Option[] = [o("subject", "خود کارمند", 1), o("manager", "مدیر کارمند", 2), o("hr", "مسئول منابع انسانی سفر", 3), o("group", "گروه", 4)];

export const SPACE_KINDS: Option[] = [
  o("meeting_room", "اتاق جلسه", 1, "blue"),
  o("desk", "میز کار", 2, "teal"),
  o("office", "اتاق کار", 3, "indigo"),
  o("hall", "سالن", 4, "purple"),
  o("parking", "جای پارک", 5, "gray"),
  o("vehicle", "خودرو", 6, "orange"),
  o("equipment", "تجهیزات", 7, "gold"),
  o("other", "دیگر", 8, "gray"),
];

export const RESERVATION_SERVICES: Option[] = [o("catering", "پذیرایی", 1), o("av", "صوت و تصویر", 2), o("setup", "چیدمان", 3), o("cleaning", "نظافت", 4)];
export const RECURRENCE: Option[] = [o("none", "بدون تکرار", 1), o("daily", "هر روز کاری", 2), o("weekly", "هر هفته", 3)];

export const FACILITY_TYPES: Option[] = [
  o("maintenance", "تعمیر و نگهداری", 1, "orange"),
  o("cleaning", "نظافت", 2, "teal"),
  o("move", "جابه‌جایی", 3, "blue"),
  o("room_setup", "چیدمان و آماده‌سازی", 4, "indigo"),
  o("catering", "پذیرایی", 5, "gold"),
  o("access_card", "کارت تردد", 6, "purple"),
  o("parking", "پارکینگ", 7, "gray"),
  o("keys", "کلید", 8, "gray"),
  o("desk", "میز و فضای کار", 9, "green"),
  o("other", "دیگر", 10, "gray"),
];

export const HSE_TYPES: Option[] = [
  o("injury", "آسیب", 1, "red"),
  o("near_miss", "شبه‌حادثه", 2, "gold"),
  o("property_damage", "خسارت به اموال", 3, "orange"),
  o("environmental", "زیست‌محیطی", 4, "green"),
  o("unsafe_condition", "شرایط ناایمن", 5, "purple"),
];

export const FINANCE_KINDS: Option[] = [
  o("payment_enquiry", "پیگیری پرداخت", 1, "blue"),
  o("invoice", "صورتحساب", 2, "teal"),
  o("expense_claim", "هزینه و بازپرداخت", 3, "green"),
  o("advance", "مساعده", 4, "gold"),
  o("loan", "وام", 5, "orange"),
  o("vendor_setup", "تعریف تأمین‌کننده", 6, "indigo"),
  o("budget", "پرسش بودجه", 7, "purple"),
  o("payroll", "حقوق و دستمزد", 8, "magenta"),
  o("other", "دیگر", 9, "gray"),
];

export const CURRENCIES: Option[] = [o("IRR", "ریال", 1), o("USD", "دلار", 2), o("EUR", "یورو", 3), o("AED", "درهم", 4)];

export const LEGAL_MATTERS: Option[] = [
  o("contract_review", "بررسی قرارداد", 1, "blue"),
  o("advice", "مشاورهٔ حقوقی", 2, "teal"),
  o("dispute", "دعوا و شکایت", 3, "red"),
  o("compliance", "انطباق و مقررات", 4, "purple"),
  o("ip", "مالکیت فکری", 5, "indigo"),
  o("employment", "امور کار و استخدام", 6, "orange"),
  o("other", "دیگر", 7, "gray"),
];

/** Tenant-editable lists (the organisation edits them in «فهرست‌های گزینه»). */
export const ESM_CHOICE_LISTS: Record<string, Option[]> = {
  "hr_case.coe": COES,
  "facility_request.request_type": FACILITY_TYPES,
  "finance_case.case_kind": FINANCE_KINDS,
  "legal_request.matter_type": LEGAL_MATTERS,
  "space.kind": SPACE_KINDS,
};

// ----- the department case (ESM-007) ----------------------------------------------------------------------------------

export const ESM_CASE_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال رسیدگی", category: "active", color: "teal" },
    { value: "awaiting_info", label: "منتظر اطلاعات", category: "waiting", color: "gold" },
    { value: "awaiting_third_party", label: "منتظر طرف سوم", category: "waiting", color: "purple" },
    { value: "suspended", label: "معلق", category: "waiting", color: "gray" },
    { value: "resolved", label: "حل‌شده", category: "resolved", color: "green" },
    { value: "closed_complete", label: "بسته — انجام شد", category: "closed", color: "green" },
    { value: "closed_incomplete", label: "بسته — انجام نشد", category: "closed", color: "gray" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "awaiting_info", "awaiting_third_party", "suspended"], to: "in_progress", label: "شروع رسیدگی" },
    { from: ["new", "in_progress", "awaiting_third_party"], to: "awaiting_info", label: "درخواست اطلاعات" },
    { from: ["new", "in_progress", "awaiting_info"], to: "awaiting_third_party", label: "منتظر طرف سوم" },
    { from: ["new", "in_progress", "awaiting_info", "awaiting_third_party"], to: "suspended", label: "تعلیق" },
    { from: ["new", "in_progress", "awaiting_info", "awaiting_third_party", "suspended"], to: "resolved", label: "حل شد", requires: ["close_notes"] },
    { from: ["resolved"], to: "closed_complete", label: "تأیید و بستن" },
    { from: ["resolved"], to: "in_progress", label: "بازگشایی" },
    { from: ["new", "in_progress", "awaiting_info", "awaiting_third_party", "suspended"], to: "closed_incomplete", label: "بستن بدون انجام", requires: ["close_notes"] },
    { from: ["new", "awaiting_info"], to: "cancelled", label: "لغو" },
  ],
};

/** What a person who reaches a case only as its requester may do: confirm, reopen, cancel a new one, answer a question. */
export const CASE_REQUESTER_TRANSITIONS = [
  { from: ["resolved"], to: "closed_complete" },
  { from: ["resolved"], to: "in_progress" },
  { from: ["new", "awaiting_info"], to: "cancelled" },
  { from: ["awaiting_info"], to: "in_progress" },
];

const C_MAIN = "اصلی";
const C_RESOLVE = "حل";

/** The fields every department case adds to the task base. */
export const CASE_FIELDS: FieldDef[] = [
  // the display value: the summary, or a neutral title for sensitive services so notifications, references and
  // e-mail subjects never carry what the case is about (ESM-011)
  { name: "title", label: "عنوان نمایشی", type: "string", system: true, hidden: true, maxLength: 200, audit: false },
  { name: "department_id", label: "واحد", type: "ref", ref: "esm_department", system: true, list: true, filter: true, index: true, span: 8, section: C_MAIN },
  { name: "dept_service_id", label: "خدمت", type: "ref", ref: "esm_service", list: true, filter: true, index: true, span: 8, section: C_MAIN },
  { name: "sensitive", label: "حساس", type: "bool", readonly: true, default: false, filter: true, span: 8, section: C_MAIN, help: "اعلان‌های پروندهٔ حساس موضوع آن را نشان نمی‌دهند" },
  { name: "journey_id", label: "سفر کارمند", type: "ref", ref: "journey", readonly: true, filter: true, span: 8, section: C_MAIN },
  { name: "child_total", label: "کارهای واحدهای دیگر", type: "int", system: true, default: 0, audit: false },
  { name: "child_open", label: "کارهای باز واحدهای دیگر", type: "int", system: true, default: 0, audit: false },
  { name: "satisfaction", label: "رضایت درخواست‌کننده", type: "rating", min: 1, max: 5, filter: true, span: 8, section: C_RESOLVE },
];

export interface DeptCaseSpec {
  key: string;
  table: string;
  label: string;
  plural: string;
  icon: string;
  prefix: string;
  area: string;
  description: string;
  fields: FieldDef[];
  scope?: Partial<ScopeFields>;
  features?: TableFeatures;
  related?: RelatedList[];
  ai?: TableDef["ai"];
  columns?: string[];
}

/** A department case table: the task base, the department case fields and states, the requester rules. */
export function deptCase(s: DeptCaseSpec): TableDef {
  return {
    key: s.key,
    table: s.table,
    label: s.label,
    plural: s.plural,
    icon: s.icon,
    module: "esm",
    area: s.area,
    description: s.description,
    extends: "task",
    numbered: { prefix: s.prefix, pad: 7 },
    display: "title",
    fields: [...CASE_FIELDS, ...s.fields],
    states: ESM_CASE_STATES,
    scope: {
      own: ["caller_id", "requested_for", "opened_by", "assigned_to"],
      requester: ["requested_for", "caller_id", "opened_by"],
      watchers: "watch_list",
      group: "assignment_group_id",
      requesterWritable: ["description", "urgency", "satisfaction"],
      requesterTransitions: CASE_REQUESTER_TRANSITIONS,
      ...s.scope,
    },
    features: { sla: true, approvals: true, kanban: "state", ...s.features },
    ...(s.ai ? { ai: s.ai } : {}),
    form: { sections: [C_MAIN, C_RESOLVE], related: s.related ?? [] },
    list: { columns: s.columns ?? ["number", "short_description", "state", "priority", "dept_service_id", "assigned_to", "sla_due"], order: "-updated_at" },
  };
}

// ----- configuration: departments, services, journey templates --------------------------------------------------------

export const ESM_ADMIN_SCOPE: ScopeFields = { own: ["dept_admins"], requester: [], public: true };

const esmDepartment: TableDef = {
  key: "esm_department",
  table: "sm_esm_departments",
  label: "واحد خدمت‌دهنده",
  plural: "واحدهای خدمت‌دهنده",
  icon: "building-2",
  module: "esm",
  area: "esm",
  description: "هر واحد (منابع انسانی، پشتیبانی، مالی، حقوقی…) با فضای کاری، گروه‌ها، خدمت‌ها، کاتالوگ، دانش و مدیران خود روی یک موتور",
  display: "name",
  fields: [
    { name: "name", label: "نام واحد", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 40, unique: true, ltr: true, list: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: DEPARTMENT_KINDS, default: "custom", required: true, list: true, filter: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: DEPARTMENT_STATES, default: "setup", list: true, filter: true, span: 8, help: "واحد در حال راه‌اندازی در درگاه کارکنان دیده نمی‌شود" },
    { name: "dept_workspace_id", label: "فضای کاری", type: "ref", ref: "workspace", required: true, unique: true, list: true, filter: true, span: 8, help: "پرونده‌های واحد در این فضای کاری ثبت می‌شوند؛ فضای کاری امن فقط برای اعضای صریح آن است" },
    { name: "case_table", label: "نوع پروندهٔ پیش‌فرض", type: "choice", choices: CASE_TABLE_OPTIONS, default: "service_case", required: true, span: 8 },
    { name: "default_group_id", label: "گروه پیش‌فرض", type: "group", filter: true, span: 8 },
    { name: "manager_id", label: "مدیر واحد", type: "user", list: true, filter: true, span: 8 },
    { name: "admins", label: "مدیران تفویض‌شده", type: "users", span: 16, help: "تعریف خدمت‌ها و الگوهای سفر واحد را بدون دسترسی مدیر کل سامانه انجام می‌دهند" },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 8 },
    { name: "catalog_id", label: "کاتالوگ واحد", type: "ref", ref: "catalog", span: 8 },
    { name: "kb_base_id", label: "پایگاه دانش واحد", type: "ref", ref: "kb_base", span: 8 },
    { name: "sensitive", label: "پرونده‌ها حساس‌اند", type: "bool", default: false, span: 8, help: "اعلان‌های همهٔ پرونده‌های واحد بی‌موضوع فرستاده می‌شود" },
    { name: "portal_visible", label: "در درگاه کارکنان", type: "bool", default: true, filter: true, span: 8 },
    { name: "portal_order", label: "ترتیب در درگاه", type: "int", default: 100, sort: true, span: 8 },
    { name: "icon", label: "نشانه", type: "string", maxLength: 40, ltr: true, span: 8, placeholder: "users" },
    { name: "color", label: "رنگ", type: "color", span: 8 },
    { name: "pack_key", label: "بستهٔ محتوا", type: "string", maxLength: 40, readonly: true, ltr: true, span: 8 },
    { name: "pack_version", label: "نسخهٔ بسته", type: "int", readonly: true, span: 8 },
    { name: "intro", label: "معرفی در درگاه", type: "markdown", span: 24 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "dept_admins", label: "مدیران (رونوشت)", type: "users", system: true, hidden: true, audit: false },
  ],
  scope: ESM_ADMIN_SCOPE,
  list: { columns: ["name", "kind", "status", "dept_workspace_id", "manager_id"], order: "portal_order,name" },
};

const esmService: TableDef = {
  key: "esm_service",
  table: "sm_esm_services",
  label: "خدمت واحد",
  plural: "خدمت‌های واحدها",
  icon: "concierge-bell",
  module: "esm",
  area: "esm",
  description: "خدمت‌های هر واحد در طبقه‌بندی واحد ← دسته ← خدمت: فرم دریافت از کاتالوگ، گروه، مخاطب، سفر کارمند و قواعد ثبت برای دیگران",
  display: "name",
  fields: [
    { name: "name", label: "نام خدمت", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "department_id", label: "واحد", type: "ref", ref: "esm_department", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "category", label: "دسته", type: "string", maxLength: 80, list: true, filter: true, search: true, span: 8 },
    { name: "topic", label: "موضوع", type: "string", maxLength: 80, search: true, span: 8 },
    { name: "code", label: "کد", type: "string", maxLength: 60, ltr: true, unique: true, span: 8 },
    { name: "case_table", label: "نوع پرونده", type: "choice", choices: CASE_TABLE_OPTIONS, required: true, list: true, filter: true, span: 8 },
    { name: "case_category", label: "دستهٔ پرونده", type: "string", maxLength: 80, ltr: true, span: 8, help: "کد دسته در درخت دسته‌های همان نوع پرونده" },
    { name: "catalog_item_id", label: "فرم دریافت (قلم کاتالوگ)", type: "ref", ref: "catalog_item", span: 8 },
    { name: "group_id", label: "گروه رسیدگی", type: "group", filter: true, span: 8 },
    { name: "priority", label: "اولویت پیش‌فرض", type: "choice", choices: [o("1", "۱ — بحرانی", 1), o("2", "۲ — زیاد", 2), o("3", "۳ — متوسط", 3), o("4", "۴ — کم", 4), o("5", "۵ — برنامه‌ریزی", 5)], span: 8 },
    { name: "journey_template_id", label: "الگوی سفر", type: "ref", ref: "journey_template", span: 8 },
    { name: "on_behalf", label: "ثبت برای دیگران", type: "choice", choices: ON_BEHALF, default: "manager", span: 8 },
    { name: "audience", label: "مخاطبان", type: "conditions", condTable: "hr_profile", span: 24, help: "خالی: همهٔ کارکنان. مثلاً «نوع استخدام قراردادی و استان اصفهان»" },
    { name: "confidential", label: "پرونده‌ها محرمانه‌اند", type: "bool", default: false, span: 8 },
    { name: "sensitive", label: "اعلان بی‌موضوع", type: "bool", default: false, span: 8, help: "موضوع پرونده در اعلان‌ها، رایانامه و پیامک نمی‌آید" },
    { name: "subject_visible", label: "فرد موضوع پرونده آن را ببیند", type: "bool", default: true, span: 8 },
    { name: "target_hours", label: "هدف رسیدگی (ساعت کاری)", type: "int", min: 1, span: 8 },
    { name: "keywords", label: "کلیدواژه‌ها", type: "tags", search: true, span: 16, help: "برای مسیریابی درخواست‌ها به واحد درست" },
    { name: "icon", label: "نشانه", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", search: true, span: 24 },
    { name: "dept_admins", label: "مدیران (رونوشت)", type: "users", system: true, hidden: true, audit: false },
  ],
  scope: ESM_ADMIN_SCOPE,
  list: { columns: ["name", "department_id", "category", "case_table", "group_id", "active"], order: "department_id,sort_order,name" },
};

const journeyTemplate: TableDef = {
  key: "journey_template",
  table: "sm_journey_templates",
  label: "الگوی سفر کارمند",
  plural: "الگوهای سفر کارمند",
  icon: "route",
  module: "esm",
  area: "esm",
  description: "الگوی نسخه‌دار ورود، خروج، جابه‌جایی و… با فعالیت‌های چندواحدی که از تاریخ مبنا به روز کاری برنامه‌ریزی می‌شوند",
  display: "name",
  fields: [
    { name: "name", label: "نام الگو", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "type", label: "نوع سفر", type: "choice", choices: JOURNEY_TYPES, required: true, default: "onboarding", list: true, filter: true, span: 6 },
    { name: "code", label: "کد", type: "string", maxLength: 60, ltr: true, unique: true, span: 6 },
    { name: "department_id", label: "واحد مالک", type: "ref", ref: "esm_department", filter: true, span: 8 },
    { name: "template_version", label: "نسخه", type: "int", readonly: true, default: 1, list: true, span: 8 },
    { name: "anchor_label", label: "تاریخ مبنا", type: "string", maxLength: 80, default: "تاریخ شروع به کار", span: 8 },
    { name: "owner_group_id", label: "گروه مسئول", type: "group", span: 8 },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 8, help: "خالی: تقویم پیش‌فرض سازمان" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "dept_admins", label: "مدیران (رونوشت)", type: "users", system: true, hidden: true, audit: false },
  ],
  scope: { ...ESM_ADMIN_SCOPE, group: "owner_group_id" },
  form: { related: [{ table: "journey_template_activity", field: "template_id", label: "فعالیت‌ها", columns: ["sort_order", "code", "name", "phase", "kind", "assignee", "start_offset", "duration_days", "day_one"] }] },
  list: { columns: ["name", "type", "template_version", "active", "department_id"], order: "type,name" },
};

const journeyTemplateActivity: TableDef = {
  key: "journey_template_activity",
  table: "sm_journey_template_activities",
  label: "فعالیت الگوی سفر",
  plural: "فعالیت‌های الگوهای سفر",
  icon: "list-checks",
  module: "esm",
  area: "esm",
  description: "یک گام از الگوی سفر: کار، سفارش کاتالوگ، پرونده در واحد دیگر، تأیید، امضا یا آموزش با زمان نسبی و پیش‌نیاز",
  display: "name",
  fields: [
    { name: "template_id", label: "الگو", type: "ref", ref: "journey_template", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "code", label: "کد", type: "string", required: true, maxLength: 40, ltr: true, list: true, span: 6, help: "برای پیش‌نیازها: حروف لاتین کوچک، رقم و _" },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, list: true, span: 6 },
    { name: "name", label: "نام فعالیت", type: "string", required: true, maxLength: 160, list: true, search: true, span: 16 },
    { name: "phase", label: "مرحله", type: "choice", choices: JOURNEY_PHASES, default: "pre_start", list: true, filter: true, span: 8 },
    { name: "kind", label: "نوع", type: "choice", choices: ACTIVITY_KINDS, default: "task", required: true, list: true, filter: true, span: 8 },
    { name: "assignee", label: "انجام‌دهنده", type: "choice", choices: ACTIVITY_ASSIGNEES, default: "hr", list: true, span: 8 },
    { name: "group_id", label: "گروه انجام‌دهنده", type: "group", span: 8 },
    { name: "start_offset", label: "شروع (روز کاری نسبت به مبنا)", type: "int", min: -365, max: 365, list: true, span: 8, help: "منفی: پیش از تاریخ مبنا؛ خالی: همان آغاز سفر" },
    { name: "duration_days", label: "مهلت (روز کاری)", type: "int", min: 0, max: 365, default: 1, list: true, span: 8 },
    { name: "after", label: "پس از", type: "tags", span: 16, help: "کد فعالیت‌هایی که باید پیش از این انجام شوند" },
    { name: "condition", label: "شرط", type: "conditions", condTable: "journey", span: 24, help: "خالی: همیشه. مثلاً «نوع استخدام قراردادی»" },
    { name: "catalog_item_code", label: "کد قلم کاتالوگ", type: "string", maxLength: 60, ltr: true, span: 8, help: "برای «سفارش از کاتالوگ»" },
    { name: "order_answers", label: "پاسخ‌های فرم سفارش", type: "json", span: 24, help: "{\"model\": \"standard\", \"os\": \"windows\"}" },
    { name: "case_table", label: "نوع پرونده", type: "choice", choices: CASE_TABLE_OPTIONS, span: 8, help: "برای «پرونده در واحد دیگر»" },
    { name: "case_department_id", label: "واحد مقصد", type: "ref", ref: "esm_department", span: 8 },
    { name: "day_one", label: "لازم برای روز نخست", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "document_url", label: "نشانی سند", type: "url", ltr: true, span: 16 },
    { name: "instructions", label: "شرح کار", type: "markdown", span: 24 },
    { name: "dept_admins", label: "مدیران (رونوشت)", type: "users", system: true, hidden: true, audit: false },
  ],
  scope: ESM_ADMIN_SCOPE,
  unique: [["template_id", "code"]],
  list: { columns: ["template_id", "sort_order", "code", "name", "phase", "kind", "start_offset", "day_one"], order: "template_id,sort_order" },
};

// ----- HR -------------------------------------------------------------------------------------------------------------

const HR_MAIN = "اصلی";
const HR_PRIVATE = "محرمانه";

const hrCase = deptCase({
  key: "hr_case",
  table: "sm_hr_cases",
  label: "پروندهٔ منابع انسانی",
  plural: "پرونده‌های منابع انسانی",
  icon: "user-round-cog",
  prefix: "HRC",
  area: "hr",
  description: "پرونده‌های کارکنان در فضای کاری امن منابع انسانی: درخواست‌کننده و فرد موضوع پرونده جدا، مرکز تخصصی، سطح محرمانگی، یادداشت‌های حساس و کارهای کارمند و مدیر",
  fields: [
    { name: "subject_person_id", label: "فرد موضوع پرونده", type: "user", list: true, filter: true, index: true, span: 8, section: HR_MAIN },
    { name: "subject_visible", label: "فرد موضوع پرونده آن را ببیند", type: "bool", default: true, span: 8, section: HR_MAIN },
    { name: "subject_readers", label: "خوانندگان موضوع", type: "users", system: true, hidden: true, audit: false },
    { name: "coe", label: "مرکز تخصصی", type: "choice", choices: "hr_case.coe", list: true, filter: true, span: 8, section: HR_MAIN },
    { name: "confidentiality", label: "سطح محرمانگی", type: "choice", choices: CONFIDENTIALITY, default: "normal", list: true, filter: true, span: 8, section: HR_MAIN },
    { name: "effective_date", label: "تاریخ اثر", type: "date", span: 8, section: HR_MAIN },
    { name: "sensitive_notes", label: "یادداشت‌های حساس", type: "markdown", group: "hr", noSync: true, span: 24, section: HR_PRIVATE, help: "فقط کارشناسان منابع انسانی می‌بینند؛ به نسخهٔ ویندوز نمی‌رود" },
    { name: "pay_details", label: "جزئیات حقوق و مزایا", type: "text", group: "financial", noSync: true, span: 24, section: HR_PRIVATE },
    { name: "medical_notes", label: "اطلاعات پزشکی", type: "text", group: "hr", noSync: true, span: 24, section: HR_PRIVATE },
    { name: "disciplinary", label: "انضباطی", type: "bool", group: "hr", default: false, filter: true, span: 8, section: HR_PRIVATE },
    { name: "legal_hold", label: "نگهداری قانونی", type: "bool", group: "hr", default: false, span: 8, section: HR_PRIVATE },
  ],
  scope: { readers: ["subject_readers"] },
  features: { confidential: true, rag: true },
  // the HR partition of the index: AI answers and similar cases follow the case's access exactly (ESM-043)
  ai: { title: "short_description", text: ["description", "close_notes"] },
  related: [
    { table: "hr_task", field: "hr_case_id", label: "کارهای پرونده", columns: ["number", "short_description", "type", "assigned_to", "state", "due_date"] },
    { table: "hr_case_note", field: "hr_case_id", label: "یادداشت‌های روابط کار", columns: ["note_type", "author_id", "created_at", "legal_hold"] },
  ],
  columns: ["number", "short_description", "state", "coe", "confidentiality", "assigned_to", "sla_due"],
});

export const HR_TASK_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "done", label: "انجام شد", category: "closed", color: "green" },
    { value: "skipped", label: "کنار گذاشته شد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "in_progress", label: "شروع" },
    { from: ["open", "in_progress"], to: "done", label: "انجام شد", guard: "hr_task_done" },
    { from: ["open", "in_progress"], to: "skipped", label: "کنار گذاشتن", requires: ["outcome"], roles: { area: "hr", level: "edit" } },
    { from: ["done", "skipped"], to: "open", label: "بازگشایی", roles: { area: "hr", level: "edit" } },
  ],
};

const hrTask: TableDef = {
  key: "hr_task",
  table: "sm_hr_tasks",
  label: "کار منابع انسانی",
  plural: "کارهای منابع انسانی",
  icon: "clipboard-check",
  module: "esm",
  area: "hr",
  description: "کاری که کارمند، مدیر یا کارشناس باید انجام دهد: امضای سند، تکمیل فرم، بارگذاری مدرک، تأیید خواندن، آموزش",
  numbered: { prefix: "HRT", pad: 7 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16 },
    { name: "type", label: "نوع", type: "choice", choices: HR_TASK_TYPES, default: "task", required: true, list: true, filter: true, span: 8 },
    { name: "assigned_to", label: "انجام‌دهنده", type: "user", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "due_date", label: "مهلت", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه منابع انسانی", type: "group", filter: true, index: true, span: 8 },
    { name: "hr_case_id", label: "پرونده", type: "ref", ref: "hr_case", filter: true, index: true, span: 8 },
    { name: "journey_id", label: "سفر", type: "ref", ref: "journey", filter: true, index: true, span: 8 },
    { name: "journey_activity_id", label: "فعالیت سفر", type: "ref", ref: "journey_activity", readonly: true, span: 8 },
    { name: "instructions", label: "شرح کار", type: "markdown", span: 24 },
    { name: "document_url", label: "نشانی سند یا دوره", type: "url", ltr: true, span: 24 },
    { name: "acknowledged", label: "خواندم و پذیرفتم", type: "bool", default: false, span: 8 },
    { name: "signed_name", label: "نام امضاکننده", type: "string", maxLength: 120, span: 8 },
    { name: "signed_at", label: "زمان امضا", type: "datetime", readonly: true, span: 8 },
    { name: "response", label: "پاسخ", type: "text", span: 24 },
    { name: "outcome", label: "نتیجه یا دلیل", type: "text", span: 24 },
    { name: "done_at", label: "زمان انجام", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "case_readers", label: "خوانندگان", type: "users", system: true, hidden: true, audit: false },
  ],
  states: HR_TASK_STATES,
  // the person who must act owns the task (and works it in full); the HR group follows it; the subject and manager of
  // its journey read it
  scope: { own: ["assigned_to"], requester: [], readers: ["case_readers"], group: "assignment_group_id" },
  features: { journal: true, attachments: true, links: false, watchers: false, kanban: "state" },
  list: { columns: ["number", "short_description", "type", "assigned_to", "state", "due_date"], order: "due_date,-updated_at" },
};

const hrProfile: TableDef = {
  key: "hr_profile",
  table: "sm_hr_profiles",
  label: "نمایهٔ استخدامی",
  plural: "نمایه‌های استخدامی",
  icon: "id-card",
  module: "esm",
  area: "hr",
  description: "اطلاعات استخدامی هر کارمند (نوع استخدام، تاریخ‌ها، سمت، استان، مدیر) — مبنای مخاطب خدمت‌ها، مقاله‌ها و سفرها",
  display: "name",
  fields: [
    { name: "user_id", label: "کارمند", type: "user", required: true, unique: true, list: true, filter: true, span: 12 },
    { name: "name", label: "نام", type: "string", system: true, maxLength: 160, search: true, sort: true, list: true },
    { name: "employee_no", label: "شمارهٔ پرسنلی", type: "string", maxLength: 40, unique: true, ltr: true, list: true, search: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: PROFILE_STATES, default: "active", list: true, filter: true, span: 6 },
    { name: "employment_type", label: "نوع استخدام", type: "choice", choices: EMPLOYMENT_TYPES, default: "permanent", list: true, filter: true, span: 8 },
    { name: "job_title", label: "سمت", type: "string", maxLength: 120, search: true, span: 8 },
    { name: "grade", label: "رتبه", type: "string", maxLength: 40, span: 8 },
    { name: "legal_entity", label: "شرکت یا واحد حقوقی", type: "string", maxLength: 120, filter: true, span: 8 },
    { name: "province", label: "استان", type: "string", maxLength: 60, filter: true, span: 8 },
    { name: "location_id", label: "محل کار", type: "ref", ref: "location", filter: true, span: 8 },
    { name: "org_unit_id", label: "واحد سازمانی", type: "ref", ref: "org_unit", filter: true, span: 8 },
    { name: "manager_id", label: "مدیر", type: "user", filter: true, span: 8 },
    { name: "start_date", label: "تاریخ شروع", type: "date", sort: true, filter: true, list: true, span: 8 },
    { name: "end_date", label: "تاریخ پایان", type: "date", sort: true, filter: true, span: 8 },
    { name: "probation_end", label: "پایان دورهٔ آزمایشی", type: "date", span: 8 },
    { name: "hr_group_id", label: "گروه منابع انسانی", type: "group", filter: true, span: 8 },
    { name: "emergency_contact", label: "تماس اضطراری", type: "string", maxLength: 200, group: "personal", span: 12 },
    { name: "national_id", label: "کد ملی", type: "string", maxLength: 20, ltr: true, group: "hr", noSync: true, span: 12 },
    { name: "salary_band", label: "طبقهٔ حقوق", type: "string", maxLength: 40, group: "financial", noSync: true, span: 12 },
  ],
  // the employee reads their own profile and keeps their emergency contact; HR's group keeps the rest
  scope: { own: ["user_id"], requester: ["user_id"], requesterWritable: ["emergency_contact"], group: "hr_group_id" },
  features: { journal: false, attachments: true },
  list: { columns: ["name", "employee_no", "employment_type", "job_title", "status", "start_date"], order: "name" },
};

const hrCaseNote: TableDef = {
  key: "hr_case_note",
  table: "sm_hr_case_notes",
  label: "یادداشت روابط کار",
  plural: "یادداشت‌های روابط کار",
  icon: "notebook-pen",
  module: "esm",
  area: "hr",
  description: "یادداشت ساخت‌یافتهٔ پروندهٔ روابط کار (ادعا، یافته، تصمیم، نتیجه…) با دسترسی جداگانه: فقط نویسنده و متخصصان نام‌برده",
  display: "note_type",
  fields: [
    { name: "hr_case_id", label: "پرونده", type: "ref", ref: "hr_case", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "note_type", label: "نوع یادداشت", type: "choice", choices: ER_NOTE_TYPES, default: "finding", required: true, list: true, filter: true, span: 6 },
    { name: "legal_hold", label: "نگهداری قانونی", type: "bool", default: false, list: true, span: 6 },
    { name: "author_id", label: "نویسنده", type: "user", default: "$me", readonly: true, list: true, span: 12 },
    { name: "specialists", label: "متخصصان مجاز", type: "users", span: 12, help: "فقط این افراد و نویسنده یادداشت را می‌خوانند" },
    { name: "body", label: "متن", type: "markdown", required: true, group: "hr", noSync: true, span: 24 },
  ],
  scope: { own: ["author_id"], requester: [], readers: ["specialists"] },
  // the note's text never reaches a Windows-app replica (`noSync`: HR data stays on the server)
  features: { journal: false, attachments: true },
  list: { columns: ["hr_case_id", "note_type", "author_id", "created_at", "legal_hold"], order: "-created_at" },
};

// ----- journeys (ESM-012…015) -----------------------------------------------------------------------------------------

export const JOURNEY_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "active", label: "در جریان", category: "active", color: "teal" },
    { value: "waiting", label: "متوقف", category: "waiting", color: "gold" },
    { value: "completed", label: "تکمیل‌شده", category: "closed", color: "green" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned", "waiting"], to: "active", label: "آغاز" },
    { from: ["active"], to: "waiting", label: "توقف" },
    { from: ["active", "waiting"], to: "completed", label: "پایان سفر" },
    { from: ["planned", "active", "waiting"], to: "cancelled", label: "لغو", requires: ["notes"] },
  ],
};

const J_MAIN = "اصلی";
const J_PROGRESS = "پیشرفت";

const journey: TableDef = {
  key: "journey",
  table: "sm_journeys",
  label: "سفر کارمند",
  plural: "سفرهای کارکنان",
  icon: "route",
  module: "esm",
  area: "hr",
  description: "ورود، خروج، جابه‌جایی یا مرخصی یک کارمند: فعالیت‌های چندواحدی برنامه‌ریزی‌شده از تاریخ مبنا روی تقویم کاری، با پیشرفت و آمادگی روز نخست",
  numbered: { prefix: "JRN", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16, section: J_MAIN },
    { name: "type", label: "نوع سفر", type: "choice", choices: JOURNEY_TYPES, required: true, default: "onboarding", list: true, filter: true, span: 8, section: J_MAIN },
    { name: "template_id", label: "الگو", type: "ref", ref: "journey_template", required: true, filter: true, span: 8, section: J_MAIN },
    { name: "template_version", label: "نسخهٔ الگو", type: "int", readonly: true, span: 8, section: J_MAIN },
    { name: "anchor_date", label: "تاریخ مبنا", type: "date", required: true, list: true, sort: true, filter: true, span: 8, section: J_MAIN, help: "تغییر آن کارهای باز را دوباره برنامه‌ریزی می‌کند" },
    { name: "subject_person_id", label: "کارمند", type: "user", list: true, filter: true, index: true, span: 8, section: J_MAIN },
    { name: "subject_name", label: "نام کارمند (پیش از حساب کاربری)", type: "string", maxLength: 160, search: true, span: 8, section: J_MAIN },
    { name: "manager_id", label: "مدیر", type: "user", list: true, filter: true, index: true, span: 8, section: J_MAIN },
    { name: "hr_owner_id", label: "مسئول منابع انسانی", type: "user", default: "$me", filter: true, index: true, span: 8, section: J_MAIN },
    { name: "assignment_group_id", label: "گروه منابع انسانی", type: "group", filter: true, index: true, span: 8, section: J_MAIN },
    { name: "employment_type", label: "نوع استخدام", type: "choice", choices: EMPLOYMENT_TYPES, filter: true, span: 8, section: J_MAIN },
    { name: "location_id", label: "محل کار", type: "ref", ref: "location", filter: true, span: 8, section: J_MAIN },
    { name: "org_unit_id", label: "واحد سازمانی", type: "ref", ref: "org_unit", filter: true, span: 8, section: J_MAIN },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 8, section: J_MAIN },
    { name: "hr_case_id", label: "پروندهٔ مبدأ", type: "ref", ref: "hr_case", readonly: true, span: 8, section: J_MAIN },
    { name: "notes", label: "یادداشت", type: "text", span: 24, section: J_MAIN },
    { name: "progress", label: "پیشرفت", type: "percent", readonly: true, default: "0", list: true, sort: true, span: 8, section: J_PROGRESS },
    { name: "activities_total", label: "فعالیت‌ها", type: "int", readonly: true, default: 0, audit: false, span: 8, section: J_PROGRESS },
    { name: "activities_done", label: "انجام‌شده", type: "int", readonly: true, default: 0, audit: false, span: 8, section: J_PROGRESS },
    { name: "activities_overdue", label: "دیرکرد", type: "int", readonly: true, default: 0, audit: false, filter: true, span: 8, section: J_PROGRESS },
    { name: "day_one_total", label: "لازم برای روز نخست", type: "int", readonly: true, default: 0, audit: false, span: 8, section: J_PROGRESS },
    { name: "day_one_done", label: "آمادهٔ روز نخست", type: "int", readonly: true, default: 0, audit: false, span: 8, section: J_PROGRESS },
    { name: "day_one_ready", label: "آمادگی روز نخست", type: "bool", readonly: true, default: false, filter: true, list: true, span: 8, section: J_PROGRESS },
    { name: "next_due", label: "نزدیک‌ترین مهلت", type: "date", readonly: true, sort: true, span: 8, section: J_PROGRESS },
    { name: "started_at", label: "زمان آغاز", type: "datetime", readonly: true, span: 8, section: J_PROGRESS },
    { name: "completed_at", label: "زمان پایان", type: "datetime", readonly: true, sort: true, span: 8, section: J_PROGRESS },
    { name: "cycle_time", label: "مدت سفر", type: "duration", readonly: true, sort: true, span: 8, section: J_PROGRESS },
    { name: "opened_by", label: "ثبت‌کننده", type: "user", default: "$me", readonly: true, span: 8, section: J_PROGRESS },
    { name: "watch_list", label: "پیگیری‌کنندگان", type: "users", span: 24 },
  ],
  states: JOURNEY_STATES,
  // HR owns and works it; the employee and their manager follow its progress (read only)
  scope: { own: ["hr_owner_id", "opened_by"], requester: [], readers: ["subject_person_id", "manager_id"], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, links: true, watchers: true, kanban: "state", calendar: { start: "anchor_date" } },
  form: {
    sections: [J_MAIN, J_PROGRESS],
    related: [
      { table: "journey_activity", field: "journey_id", label: "فعالیت‌ها", columns: ["name", "phase", "kind", "state", "assignee_id", "due_date", "record_number"] },
      { table: "hr_task", field: "journey_id", label: "کارهای کارمند و مدیر", columns: ["number", "short_description", "type", "assigned_to", "state", "due_date"] },
    ],
  },
  list: { columns: ["number", "name", "type", "state", "anchor_date", "progress", "day_one_ready", "manager_id"], order: "anchor_date,-updated_at" },
};

export const ACTIVITY_STATES: StateModel = {
  field: "state",
  initial: "pending",
  states: [
    { value: "pending", label: "در انتظار", category: "new", color: "blue" },
    { value: "in_progress", label: "در جریان", category: "active", color: "teal" },
    { value: "done", label: "انجام شد", category: "closed", color: "green" },
    { value: "skipped", label: "کنار گذاشته شد", category: "canceled", color: "gray" },
    { value: "failed", label: "انجام نشد", category: "canceled", color: "red" },
  ],
  transitions: [
    { from: ["pending"], to: "in_progress", label: "شروع" },
    { from: ["pending", "in_progress"], to: "done", label: "انجام شد", guard: "activity_done" },
    { from: ["pending", "in_progress"], to: "skipped", label: "کنار گذاشتن", requires: ["outcome"] },
    { from: ["in_progress"], to: "failed", label: "انجام نشد", requires: ["outcome"] },
    { from: ["done", "skipped", "failed"], to: "pending", label: "بازگشایی" },
  ],
};

const journeyActivity: TableDef = {
  key: "journey_activity",
  table: "sm_journey_activities",
  label: "فعالیت سفر",
  plural: "فعالیت‌های سفر",
  icon: "list-checks",
  module: "esm",
  area: "hr",
  description: "یک فعالیت سفر کارمند با تاریخ شروع و مهلت روی تقویم کاری، پیش‌نیازها و رکورد کاری که در واحد مسئول ساخته شد",
  display: "name",
  fields: [
    { name: "journey_id", label: "سفر", type: "ref", ref: "journey", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "name", label: "فعالیت", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, readonly: true, span: 6 },
    { name: "phase", label: "مرحله", type: "choice", choices: JOURNEY_PHASES, list: true, filter: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: ACTIVITY_KINDS, readonly: true, list: true, filter: true, span: 6 },
    { name: "assignee_kind", label: "انجام‌دهنده", type: "choice", choices: ACTIVITY_ASSIGNEES, readonly: true, span: 6 },
    { name: "assignee_id", label: "فرد", type: "user", list: true, filter: true, index: true, span: 8 },
    { name: "group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "start_date", label: "شروع", type: "date", readonly: true, sort: true, span: 8 },
    { name: "due_date", label: "مهلت", type: "date", readonly: true, list: true, sort: true, filter: true, span: 8 },
    { name: "start_offset", label: "شروع نسبت به مبنا", type: "int", readonly: true, span: 8 },
    { name: "duration_days", label: "مهلت (روز کاری)", type: "int", readonly: true, span: 8 },
    { name: "after", label: "پیش‌نیازها", type: "tags", readonly: true, span: 12 },
    { name: "day_one", label: "لازم برای روز نخست", type: "bool", readonly: true, default: false, filter: true, span: 6 },
    { name: "overdue", label: "دیرکرد", type: "bool", readonly: true, default: false, filter: true, span: 6 },
    { name: "condition", label: "شرط", type: "conditions", condTable: "journey", readonly: true, span: 24 },
    { name: "catalog_item_code", label: "کد قلم کاتالوگ", type: "string", maxLength: 60, ltr: true, readonly: true, span: 8 },
    { name: "order_answers", label: "پاسخ‌های فرم سفارش", type: "json", readonly: true, hidden: true },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "case_table", label: "نوع پرونده", type: "choice", choices: CASE_TABLE_OPTIONS, readonly: true, span: 8 },
    { name: "case_department_id", label: "واحد مقصد", type: "ref", ref: "esm_department", readonly: true, span: 8 },
    { name: "record_table", label: "جدول رکورد کاری", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true },
    { name: "record_id", label: "شناسهٔ رکورد کاری", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true },
    { name: "record_number", label: "رکورد کاری", type: "string", maxLength: 40, ltr: true, readonly: true, list: true, span: 8 },
    { name: "started_at", label: "زمان شروع", type: "datetime", readonly: true, span: 8 },
    { name: "done_at", label: "زمان انجام", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "document_url", label: "نشانی سند", type: "url", ltr: true, readonly: true, span: 16 },
    { name: "instructions", label: "شرح کار", type: "markdown", readonly: true, span: 24 },
    { name: "outcome", label: "نتیجه یا دلیل", type: "text", span: 24 },
    { name: "sort_order", label: "ترتیب", type: "int", readonly: true, default: 100, sort: true },
    { name: "journey_readers", label: "خوانندگان سفر", type: "users", system: true, hidden: true, audit: false },
    { name: "hr_group_id", label: "گروه منابع انسانی", type: "group", system: true, hidden: true, audit: false },
  ],
  states: ACTIVITY_STATES,
  scope: { own: ["assignee_id"], requester: [], readers: ["journey_readers"], group: "hr_group_id" },
  features: { journal: true, attachments: false, links: false, watchers: false, approvals: true },
  list: { columns: ["journey_id", "name", "phase", "kind", "state", "assignee_id", "due_date", "record_number"], order: "journey_id,sort_order" },
};

// ----- facilities (ESM-026…033) ---------------------------------------------------------------------------------------

const facilityRequest = deptCase({
  key: "facility_request",
  table: "sm_facility_requests",
  label: "درخواست پشتیبانی و تأسیسات",
  plural: "درخواست‌های پشتیبانی و تأسیسات",
  icon: "wrench",
  prefix: "FAC",
  area: "facilities",
  description: "جابه‌جایی، تعمیر، نظافت، چیدمان، پذیرایی، کارت تردد، پارکینگ و کلید — با مکان (ساختمان، طبقه، اتاق) و پیمانکار",
  fields: [
    { name: "request_type", label: "نوع درخواست", type: "choice", choices: "facility_request.request_type", list: true, filter: true, span: 8, section: C_MAIN },
    { name: "space_id", label: "فضا", type: "ref", ref: "space", filter: true, span: 8, section: C_MAIN },
    { name: "preferred_at", label: "زمان مناسب", type: "datetime", sort: true, span: 8, section: C_MAIN },
    { name: "reservation_id", label: "رزرو", type: "ref", ref: "reservation", readonly: true, filter: true, span: 8, section: C_MAIN },
    { name: "contractor", label: "پیمانکار", type: "string", maxLength: 120, filter: true, span: 8, section: C_MAIN },
  ],
  features: { rag: true, calendar: { start: "preferred_at" } },
  ai: { title: "short_description", text: ["description", "close_notes"] },
  columns: ["number", "short_description", "state", "request_type", "location_id", "assigned_to", "sla_due"],
});

const space: TableDef = {
  key: "space",
  table: "sm_spaces",
  label: "فضا و منبع",
  plural: "فضاها و منابع",
  icon: "door-open",
  module: "esm",
  area: "facilities",
  description: "اتاق جلسه، میز، پارکینگ، خودرو و تجهیزات قابل رزرو در درخت مکان‌ها با ظرفیت، ویژگی‌ها، پنجرهٔ ورود و آزادسازی خودکار",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, search: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: "space.kind", default: "meeting_room", required: true, list: true, filter: true, span: 6 },
    { name: "location_id", label: "مکان (ساختمان، طبقه یا اتاق)", type: "ref", ref: "location", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "capacity", label: "ظرفیت", type: "int", min: 0, list: true, sort: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
    { name: "attributes", label: "ویژگی‌ها", type: "tags", filter: true, search: true, span: 24, placeholder: "ویدئوپروژکتور، تخته، ویدئوکنفرانس" },
    { name: "bookable", label: "قابل رزرو", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "requires_approval", label: "رزرو با تأیید", type: "bool", default: false, span: 6 },
    { name: "check_in_minutes", label: "پنجرهٔ ورود (دقیقه)", type: "int", min: 0, max: 240, default: 15, span: 6 },
    { name: "auto_release", label: "آزادسازی خودکار اگر کسی نیاید", type: "bool", default: true, span: 6 },
    { name: "max_hours", label: "بیشینهٔ مدت (ساعت)", type: "int", min: 1, max: 744, default: 8, span: 6 },
    { name: "owner_group_id", label: "گروه مسئول", type: "group", filter: true, span: 12 },
    { name: "map_x", label: "جای روی نقشه (افقی٪)", type: "int", min: 0, max: 100, span: 6 },
    { name: "map_y", label: "جای روی نقشه (عمودی٪)", type: "int", min: 0, max: 100, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { group: "owner_group_id", public: true },
  list: { columns: ["name", "kind", "location_id", "capacity", "bookable", "active"], order: "location_id,name" },
};

export const RESERVATION_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
    { value: "confirmed", label: "قطعی", category: "waiting", color: "teal" },
    { value: "checked_in", label: "حاضر", category: "active", color: "green" },
    { value: "completed", label: "پایان‌یافته", category: "closed", color: "gray" },
    { value: "released", label: "آزادشده", category: "canceled", color: "gray" },
    { value: "no_show", label: "حاضر نشد", category: "canceled", color: "red" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["requested"], to: "confirmed", label: "قطعی کردن", guard: "reservation_free" },
    { from: ["confirmed"], to: "checked_in", label: "ثبت حضور", guard: "reservation_window" },
    { from: ["confirmed", "checked_in"], to: "completed", label: "پایان" },
    { from: ["checked_in"], to: "released", label: "آزادسازی زودهنگام" },
    { from: ["confirmed"], to: "no_show", label: "حاضر نشد", roles: { area: "facilities", level: "edit" } },
    { from: ["requested", "confirmed"], to: "cancelled", label: "لغو" },
  ],
};

const reservation: TableDef = {
  key: "reservation",
  table: "sm_reservations",
  label: "رزرو",
  plural: "رزروها",
  icon: "calendar-check",
  module: "esm",
  area: "facilities",
  description: "رزرو فضا یا منبع با بررسی هم‌پوشانی، تأیید، تکرار، پنجرهٔ ورود، آزادسازی خودکار، فهرست انتظار و خدمات همراه (پذیرایی، صوت و تصویر)",
  numbered: { prefix: "RSV", pad: 7 },
  display: "title",
  fields: [
    { name: "title", label: "موضوع", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "space_id", label: "فضا", type: "ref", ref: "space", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "start_at", label: "شروع", type: "datetime", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "end_at", label: "پایان", type: "datetime", required: true, list: true, sort: true, span: 8 },
    { name: "attendees", label: "تعداد نفرات", type: "int", min: 1, span: 8 },
    { name: "booked_for", label: "برای", type: "user", default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "booked_by", label: "رزروکننده", type: "user", default: "$me", readonly: true, filter: true, index: true, span: 8 },
    { name: "recurrence", label: "تکرار", type: "choice", choices: RECURRENCE, default: "none", span: 8 },
    { name: "recurrence_until", label: "تکرار تا", type: "date", span: 8 },
    { name: "series_id", label: "سری", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true },
    { name: "services", label: "خدمات همراه", type: "multichoice", choices: RESERVATION_SERVICES, span: 16 },
    { name: "service_notes", label: "توضیح خدمات", type: "text", span: 24 },
    { name: "waitlist_position", label: "نوبت در فهرست انتظار", type: "int", readonly: true, filter: true, span: 8 },
    { name: "checked_in_at", label: "زمان حضور", type: "datetime", readonly: true, span: 8 },
    { name: "released_at", label: "زمان آزادسازی", type: "datetime", readonly: true, span: 8 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", system: true, filter: true, index: true },
    { name: "assignment_group_id", label: "گروه مسئول فضا", type: "group", system: true, filter: true, index: true },
  ],
  states: RESERVATION_STATES,
  scope: {
    own: ["booked_for", "booked_by"],
    requester: ["booked_for", "booked_by"],
    group: "assignment_group_id",
    requesterWritable: ["title", "attendees", "start_at", "end_at", "services", "service_notes"],
    requesterTransitions: [
      { from: ["requested", "confirmed"], to: "cancelled" },
      { from: ["confirmed"], to: "checked_in" },
      { from: ["checked_in"], to: "released" },
      { from: ["checked_in", "confirmed"], to: "completed" },
    ],
  },
  features: { journal: true, attachments: false, links: true, approvals: true, calendar: { start: "start_at", end: "end_at" } },
  list: { columns: ["number", "title", "space_id", "start_at", "end_at", "booked_for", "state"], order: "start_at" },
};

export const VISIT_STATES: StateModel = {
  field: "state",
  initial: "expected",
  states: [
    { value: "expected", label: "در انتظار ورود", category: "new", color: "blue" },
    { value: "checked_in", label: "حاضر", category: "active", color: "green" },
    { value: "checked_out", label: "خارج‌شده", category: "closed", color: "gray" },
    { value: "no_show", label: "نیامد", category: "canceled", color: "red" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["expected"], to: "checked_in", label: "ثبت ورود", guard: "visit_acknowledged" },
    { from: ["checked_in"], to: "checked_out", label: "ثبت خروج" },
    { from: ["expected"], to: "no_show", label: "نیامد" },
    { from: ["expected"], to: "cancelled", label: "لغو" },
  ],
};

const visit: TableDef = {
  key: "visit",
  table: "sm_visits",
  label: "مراجعه‌کننده",
  plural: "مراجعه‌کنندگان",
  icon: "badge-check",
  module: "esm",
  area: "facilities",
  description: "پیش‌ثبت مهمان توسط میزبان، ورود و خروج در پذیرش، کارت مهمان، تعهد محرمانگی و ایمنی و خبر به میزبان",
  numbered: { prefix: "VIS", pad: 7 },
  display: "visitor_name",
  fields: [
    { name: "visitor_name", label: "نام مهمان", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "visitor_company", label: "شرکت", type: "string", maxLength: 160, list: true, search: true, span: 12 },
    { name: "visitor_phone", label: "تلفن", type: "phone", group: "personal", span: 8 },
    { name: "visitor_email", label: "رایانامه", type: "email", group: "personal", ltr: true, span: 8 },
    { name: "visitor_id_no", label: "شمارهٔ کارت شناسایی", type: "string", maxLength: 30, ltr: true, group: "personal", noSync: true, span: 8 },
    { name: "host_id", label: "میزبان", type: "user", default: "$me", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "site_id", label: "ساختمان", type: "ref", ref: "location", required: true, list: true, filter: true, span: 8 },
    { name: "reception_group_id", label: "پذیرش", type: "group", filter: true, index: true, span: 8 },
    { name: "expected_at", label: "زمان ورود", type: "datetime", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "expected_until", label: "تا", type: "datetime", span: 8 },
    { name: "badge_no", label: "شمارهٔ کارت مهمان", type: "string", maxLength: 30, ltr: true, span: 8 },
    { name: "purpose", label: "هدف مراجعه", type: "text", span: 24 },
    { name: "nda_ack", label: "تعهد محرمانگی پذیرفته شد", type: "bool", default: false, span: 8 },
    { name: "safety_ack", label: "توجیه ایمنی پذیرفته شد", type: "bool", default: false, span: 8 },
    { name: "requires_nda", label: "تعهد محرمانگی لازم است", type: "bool", default: false, span: 8 },
    { name: "checked_in_at", label: "زمان ورود واقعی", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "checked_out_at", label: "زمان خروج", type: "datetime", readonly: true, span: 8 },
    { name: "late_minutes", label: "تأخیر نسبت به زمان پیش‌بینی (دقیقه)", type: "int", readonly: true, span: 8 },
  ],
  states: VISIT_STATES,
  scope: {
    own: ["host_id"],
    requester: ["host_id"],
    group: "reception_group_id",
    requesterWritable: ["visitor_name", "visitor_company", "visitor_phone", "visitor_email", "expected_at", "expected_until", "purpose", "requires_nda"],
    requesterTransitions: [{ from: ["expected"], to: "cancelled" }],
  },
  features: { journal: true, attachments: true, links: false, calendar: { start: "expected_at", end: "expected_until" } },
  list: { columns: ["number", "visitor_name", "visitor_company", "host_id", "site_id", "expected_at", "state"], order: "expected_at" },
};

const hseEvent = deptCase({
  key: "hse_event",
  table: "sm_hse_events",
  label: "رویداد ایمنی و بهداشت کار",
  plural: "رویدادهای ایمنی و بهداشت کار",
  icon: "hard-hat",
  prefix: "HSE",
  area: "facilities",
  description: "حادثه، شبه‌حادثه و شرایط ناایمن با جزئیات آسیب (محرمانه)، بررسی، علت ریشه‌ای، اقدام اصلاحی و گزارش قانونی",
  fields: [
    { name: "event_type", label: "نوع رویداد", type: "choice", choices: HSE_TYPES, default: "near_miss", required: true, list: true, filter: true, span: 8, section: C_MAIN },
    { name: "occurred_at", label: "زمان وقوع", type: "datetime", required: true, list: true, sort: true, span: 8, section: C_MAIN },
    { name: "injured_person", label: "فرد آسیب‌دیده", type: "string", maxLength: 160, group: "personal", span: 8, section: C_MAIN },
    { name: "injury_details", label: "جزئیات آسیب", type: "text", group: "personal", noSync: true, span: 24, section: C_MAIN },
    { name: "lost_days", label: "روزهای از دست رفته", type: "int", min: 0, span: 8, section: C_MAIN },
    { name: "immediate_action", label: "اقدام فوری", type: "text", span: 24, section: C_MAIN },
    { name: "root_cause", label: "علت ریشه‌ای", type: "text", span: 24, section: C_RESOLVE },
    { name: "corrective_actions", label: "اقدام‌های اصلاحی", type: "markdown", span: 24, section: C_RESOLVE },
    { name: "actions_due", label: "مهلت اقدام اصلاحی", type: "date", sort: true, span: 8, section: C_RESOLVE },
    { name: "reportable", label: "گزارش به مرجع قانونی لازم است", type: "bool", default: false, filter: true, span: 8, section: C_RESOLVE },
    { name: "reported_at", label: "زمان گزارش به مرجع", type: "datetime", span: 8, section: C_RESOLVE },
  ],
  features: { confidential: true },
  columns: ["number", "short_description", "event_type", "state", "occurred_at", "location_id", "assigned_to"],
});

// ----- finance, legal, procurement and the generic department case ------------------------------------------------------

const financeCase = deptCase({
  key: "finance_case",
  table: "sm_finance_cases",
  label: "پروندهٔ مالی",
  plural: "پرونده‌های مالی",
  icon: "landmark",
  prefix: "FNC",
  area: "request",
  description: "پیگیری پرداخت و صورتحساب، هزینه و بازپرداخت، مساعده و وام، تعریف تأمین‌کننده و پرسش بودجه — اطلاعات بانکی فقط برای کارشناسان مالی",
  fields: [
    { name: "case_kind", label: "نوع پرونده", type: "choice", choices: "finance_case.case_kind", default: "payment_enquiry", list: true, filter: true, span: 8, section: C_MAIN },
    { name: "amount", label: "مبلغ", type: "money", min: 0, list: true, sort: true, span: 8, section: C_MAIN },
    { name: "currency", label: "ارز", type: "choice", choices: CURRENCIES, default: "IRR", span: 8, section: C_MAIN },
    { name: "invoice_no", label: "شمارهٔ صورتحساب", type: "string", maxLength: 60, ltr: true, search: true, span: 8, section: C_MAIN },
    { name: "vendor_name", label: "تأمین‌کننده یا ذی‌نفع", type: "string", maxLength: 160, search: true, span: 8, section: C_MAIN },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", filter: true, span: 8, section: C_MAIN },
    { name: "payment_due", label: "سررسید پرداخت", type: "date", sort: true, filter: true, span: 8, section: C_MAIN },
    { name: "iban", label: "شمارهٔ شبا", type: "string", maxLength: 40, ltr: true, group: "financial", noSync: true, span: 8, section: C_MAIN },
    { name: "payment_ref", label: "شمارهٔ پیگیری پرداخت", type: "string", maxLength: 60, ltr: true, group: "financial", span: 8, section: C_RESOLVE },
    { name: "paid_on", label: "تاریخ پرداخت", type: "date", span: 8, section: C_RESOLVE },
  ],
  features: { rag: true },
  ai: { title: "short_description", text: ["description", "close_notes"] },
  columns: ["number", "short_description", "case_kind", "amount", "state", "assigned_to", "sla_due"],
});

const legalRequest = deptCase({
  key: "legal_request",
  table: "sm_legal_requests",
  label: "درخواست حقوقی",
  plural: "درخواست‌های حقوقی",
  icon: "scale",
  prefix: "LGL",
  area: "request",
  description: "بررسی قرارداد، مشاوره، دعوا و انطباق در فضای کاری امن حقوقی؛ «محرمانهٔ وکیل و موکل» به پرونده‌های برآمده از آن هم می‌رسد و از جست‌وجوی مشترک و هوش مصنوعی بیرون می‌ماند",
  fields: [
    { name: "matter_type", label: "نوع موضوع", type: "choice", choices: "legal_request.matter_type", default: "contract_review", list: true, filter: true, span: 8, section: C_MAIN },
    { name: "privileged", label: "محرمانهٔ وکیل و موکل", type: "bool", default: true, filter: true, span: 8, section: C_MAIN },
    { name: "counterparty", label: "طرف مقابل", type: "string", maxLength: 160, search: true, span: 8, section: C_MAIN },
    { name: "contract_value", label: "مبلغ قرارداد", type: "money", min: 0, span: 8, section: C_MAIN },
    { name: "deadline", label: "مهلت", type: "date", sort: true, filter: true, list: true, span: 8, section: C_MAIN },
    { name: "conflict_checked", label: "تعارض منافع بررسی شد", type: "bool", default: false, span: 8, section: C_MAIN },
    { name: "conflict_notes", label: "یادداشت تعارض منافع", type: "text", group: "internal", span: 24, section: C_MAIN },
    { name: "outcome", label: "نتیجه", type: "text", span: 24, section: C_RESOLVE },
  ],
  features: { confidential: true },
  columns: ["number", "short_description", "matter_type", "state", "deadline", "assigned_to", "sla_due"],
});

const purchaseRequest = deptCase({
  key: "purchase_request",
  table: "sm_purchase_requests",
  label: "درخواست خرید",
  plural: "درخواست‌های خرید",
  icon: "shopping-cart",
  prefix: "PUR",
  area: "request",
  description: "درخواست خرید با تأیید بر پایهٔ سقف اختیارات (بازه‌های مبلغ) و تفکیک وظایف: درخواست‌کننده، تأییدکننده و تحویل‌گیرنده یک نفر نیستند",
  fields: [
    { name: "items", label: "اقلام", type: "markdown", required: true, span: 24, section: C_MAIN },
    { name: "amount", label: "مبلغ برآوردی", type: "money", min: 0, required: true, list: true, sort: true, span: 8, section: C_MAIN },
    { name: "currency", label: "ارز", type: "choice", choices: CURRENCIES, default: "IRR", span: 8, section: C_MAIN },
    { name: "supplier", label: "تأمین‌کنندهٔ پیشنهادی", type: "string", maxLength: 160, search: true, span: 8, section: C_MAIN },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", filter: true, span: 8, section: C_MAIN },
    { name: "budget_line", label: "ردیف بودجه", type: "string", maxLength: 60, span: 8, section: C_MAIN },
    { name: "needed_by", label: "نیاز تا", type: "date", sort: true, span: 8, section: C_MAIN },
    { name: "receiver_id", label: "تحویل‌گیرنده", type: "user", filter: true, index: true, span: 8, section: C_MAIN },
    { name: "po_number", label: "شمارهٔ سفارش خرید", type: "string", maxLength: 40, ltr: true, search: true, span: 8, section: C_RESOLVE },
    { name: "received_at", label: "زمان تحویل", type: "datetime", readonly: true, span: 8, section: C_RESOLVE },
    { name: "receipt_notes", label: "یادداشت تحویل", type: "text", span: 24, section: C_RESOLVE },
  ],
  // the receiver is on the requester side: they read the purchase and the approvals service never asks them to approve
  scope: { own: ["caller_id", "requested_for", "opened_by", "assigned_to", "receiver_id"], requester: ["requested_for", "caller_id", "opened_by", "receiver_id"] },
  columns: ["number", "short_description", "amount", "approval", "state", "receiver_id", "needed_by"],
});

const serviceCase = deptCase({
  key: "service_case",
  table: "sm_service_cases",
  label: "پروندهٔ واحد",
  plural: "پرونده‌های واحدها",
  icon: "briefcase",
  prefix: "CAS",
  area: "request",
  description: "پروندهٔ عمومی هر واحد خدمت‌دهنده (بازاریابی، امنیت، کیفیت…) با خدمت، گروه و توافق سطح خدمت همان واحد",
  fields: [],
  features: { rag: true },
  ai: { title: "short_description", text: ["description", "close_notes"] },
});

// ----- settings ----------------------------------------------------------------------------------------------------------

export interface EsmConfig {
  auto_close_days: number;
  no_show_grace_minutes: number;
  masked_title: string;
  journey_horizon_days: number;
}

export const ESM_CONFIG_DEFAULTS: EsmConfig = { auto_close_days: 5, no_show_grace_minutes: 0, masked_title: "پروندهٔ محرمانه", journey_horizon_days: 3 };

const esmConfig: TableDef = {
  key: "esm_config",
  table: "sm_esm_config",
  label: "تنظیمات خدمات سازمانی",
  plural: "تنظیمات خدمات سازمانی",
  icon: "settings",
  module: "esm",
  area: "esm",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 80, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, maxLength: 40, unique: true, ltr: true, span: 12 },
    { name: "auto_close_days", label: "بستن خودکار پرونده‌های حل‌شده پس از (روز)", type: "int", min: 1, max: 60, default: 5, span: 12 },
    { name: "no_show_grace_minutes", label: "مهلت افزوده بر پنجرهٔ ورود رزرو (دقیقه)", type: "int", min: 0, max: 120, default: 0, span: 12 },
    { name: "masked_title", label: "عنوان پرونده‌های حساس در اعلان‌ها", type: "string", maxLength: 80, default: "پروندهٔ محرمانه", span: 12 },
    { name: "journey_horizon_days", label: "ساخت کارهای سفر چند روز کاری زودتر", type: "int", min: 0, max: 30, default: 3, span: 12 },
    { name: "seeded", label: "نسخهٔ دادهٔ آغازین", type: "int", system: true, default: 0, audit: false },
  ],
  scope: { public: true },
  list: { columns: ["name"], order: "name" },
};

export const ESM_TABLES: TableDef[] = [
  esmDepartment,
  esmService,
  journeyTemplate,
  journeyTemplateActivity,
  hrCase,
  hrTask,
  hrProfile,
  hrCaseNote,
  journey,
  journeyActivity,
  facilityRequest,
  space,
  reservation,
  visit,
  hseEvent,
  financeCase,
  legalRequest,
  purchaseRequest,
  serviceCase,
  esmConfig,
];
