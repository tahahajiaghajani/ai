// Tables of incident management (docs/modules/incident_FA.md, catalogue docs/catalog/g2_operations.md «Module:
// incident»): the incident itself (a task with ITIL's lifecycle, hold reasons, resolution and cause codes, the major
// incident overlay and its war-room fields), its child tasks, post-incident reviews, templates (incident models),
// canned responses and the module's settings row. Behaviour lives in src/server/modules/incident (hooks, services,
// jobs, routes); the record UI renders everything from these definitions (src/ui/modules/incident).
//
// Children of an incident that need their own access (tasks, reviews) carry their own group and people; data that
// only lives with the incident (the major-incident timeline, affected services and CIs, stakeholders) sits on the
// incident row itself, so every read path, the history and the Windows app's sync follow the incident's access.
// Imported by the UI: keep it free of server imports.
import type { FieldDef, Option, StateModel, TableDef } from "../model/types";
import { CHANNELS, IMPACTS, PRIORITIES, TASK_FIELDS, TASK_SCOPE, URGENCIES } from "../model/task";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists (tenant-editable: Settings › «فهرست‌های گزینه»)

export const INCIDENT_CHANNELS: Option[] = [
  ...CHANNELS,
  { value: "messenger", label: "پیام‌رسان" },
  { value: "sms", label: "پیامک" },
];

/** Why an incident waits (`on_hold`). The resolution SLA pauses on the first four (seeded definition). */
export const HOLD_REASONS: Option[] = [
  { value: "awaiting_caller", label: "منتظر درخواست‌دهنده", color: "gold", order: 1 },
  { value: "awaiting_supplier", label: "منتظر تأمین‌کننده", color: "orange", order: 2 },
  { value: "awaiting_change", label: "منتظر اجرای تغییر", color: "purple", order: 3 },
  { value: "awaiting_problem", label: "منتظر رفع مشکل", color: "indigo", order: 4 },
  { value: "awaiting_evidence", label: "منتظر شواهد و بررسی", color: "gray", order: 5 },
];

/** Hold reasons the seeded resolution SLA does not count (the clock stops while the incident waits on them). */
export const SLA_PAUSE_REASONS = ["awaiting_caller", "awaiting_supplier", "awaiting_change", "awaiting_problem"];

export const INCIDENT_CLOSE_CODES: Option[] = [
  { value: "solved", label: "حل شد", order: 1 },
  { value: "workaround", label: "با راه‌حل موقت", order: 2 },
  { value: "known_error", label: "خطای شناخته‌شده", order: 3 },
  { value: "resolved_by_change", label: "با اجرای تغییر", order: 4 },
  { value: "resolved_by_problem", label: "با رفع مشکل", order: 5 },
  { value: "resolved_by_caller", label: "به دست خود کاربر", order: 6 },
  { value: "user_error", label: "خطای کاربر یا آموزش", order: 7 },
  { value: "not_reproducible", label: "تکرارپذیر نبود", order: 8 },
  { value: "no_response", label: "بی‌پاسخ ماندن کاربر", order: 9 },
  { value: "duplicate", label: "تکراری", order: 10 },
  { value: "canceled_by_user", label: "انصراف کاربر", order: 11 },
];

export const CAUSE_CODES: Option[] = [
  { value: "hardware", label: "خرابی سخت‌افزار" },
  { value: "software", label: "خطای نرم‌افزار" },
  { value: "network", label: "شبکه و ارتباطات" },
  { value: "configuration", label: "پیکربندی نادرست" },
  { value: "capacity", label: "کمبود ظرفیت" },
  { value: "change", label: "پیامد یک تغییر" },
  { value: "human", label: "خطای انسانی" },
  { value: "supplier", label: "تأمین‌کننده" },
  { value: "security", label: "رویداد امنیتی" },
  { value: "power", label: "قطعی برق یا سرمایش" },
  { value: "external", label: "اختلال بیرونی (اینترنت سراسری، سرویس‌دهنده)" },
  { value: "unknown", label: "نامعلوم" },
];

/** Default categories (code → label, with subcategories). The seed also writes them as `category` rows per table. */
export const DEFAULT_CATEGORIES: { value: string; label: string; subs: [string, string][] }[] = [
  { value: "hardware", label: "سخت‌افزار", subs: [["hardware.computer", "رایانهٔ رومیزی و کیفی"], ["hardware.printer", "چاپگر و اسکنر"], ["hardware.peripheral", "تجهیزات جانبی"], ["hardware.mobile", "تلفن همراه و تبلت"]] },
  { value: "software", label: "نرم‌افزار", subs: [["software.os", "سیستم‌عامل"], ["software.office", "نرم‌افزارهای اداری"], ["software.business", "سامانه‌های کسب‌وکار"], ["software.install", "نصب و به‌روزرسانی"]] },
  { value: "network", label: "شبکه و اینترنت", subs: [["network.internet", "اینترنت"], ["network.vpn", "اتصال از راه دور (VPN)"], ["network.wifi", "شبکهٔ بی‌سیم"], ["network.lan", "شبکهٔ داخلی"]] },
  { value: "access", label: "حساب و دسترسی", subs: [["access.password", "گذرواژه و قفل حساب"], ["access.permission", "مجوز دسترسی"], ["access.mfa", "ورود دومرحله‌ای"]] },
  { value: "email", label: "ایمیل و ارتباطات", subs: [["email.mailbox", "صندوق ایمیل"], ["email.calendar", "تقویم و جلسه‌ها"], ["email.telephony", "تلفن و ویدئوکنفرانس"]] },
  { value: "security", label: "امنیت اطلاعات", subs: [["security.malware", "بدافزار"], ["security.phishing", "فیشینگ"], ["security.data_leak", "نشت داده"]] },
  { value: "infrastructure", label: "زیرساخت و مرکز داده", subs: [["infrastructure.server", "سرور"], ["infrastructure.storage", "ذخیره‌سازی و پشتیبان"], ["infrastructure.database", "پایگاه داده"], ["infrastructure.power", "برق و سرمایش"]] },
  { value: "other", label: "سایر", subs: [["other.general", "موارد دیگر"]] },
];

const categoryOptions = (): Option[] => DEFAULT_CATEGORIES.map((c, i) => ({ value: c.value, label: c.label, order: i + 1 }));
const subcategoryOptions = (): Option[] =>
  DEFAULT_CATEGORIES.flatMap((c) => c.subs.map(([value, label], i) => ({ value, label, parent: c.value, order: i + 1 })));

/**
 * The major-incident overlay (catalogue INC-045): candidate (flagged by the criteria) → proposed (an agent asks)
 * → accepted (declared by a major-incident manager) | rejected; an accepted one may be downgraded, and becomes
 * resolved with the incident and pir_done when its review is published. Set only through the module's actions.
 */
export const MAJOR_STATES: Option[] = [
  { value: "candidate", label: "نامزد رخداد عمده", color: "gold", order: 1 },
  { value: "proposed", label: "پیشنهاد رخداد عمده", color: "orange", order: 2 },
  { value: "accepted", label: "رخداد عمده", color: "red", order: 3 },
  { value: "rejected", label: "رد پیشنهاد", color: "gray", order: 4 },
  { value: "downgraded", label: "خارج از رخداد عمده", color: "gray", order: 5 },
  { value: "resolved", label: "رخداد عمدهٔ حل‌شده", color: "green", order: 6 },
  { value: "pir_done", label: "بازبینی انجام شد", color: "teal", order: 7 },
];
/** Overlay values in which an incident is (or was) a declared major incident. */
export const MAJOR_DECLARED = ["accepted", "resolved", "pir_done"];

export const REVIEW_TRIGGERS: Option[] = [
  { value: "major", label: "رخداد عمده" },
  { value: "breach", label: "نقض توافق" },
  { value: "data_loss", label: "از دست رفتن داده" },
  { value: "recurring", label: "تکرار رخداد" },
  { value: "manual", label: "به تشخیص مسئول" },
];

export const RESPONSE_KINDS: Option[] = [
  { value: "both", label: "پاسخ و یادداشت" },
  { value: "comment", label: "پاسخ به درخواست‌دهنده" },
  { value: "work_note", label: "یادداشت داخلی" },
];

/** Default options of the module's choice lists (registered once in src/shared/tables/index.ts). */
export const INCIDENT_CHOICE_LISTS: Record<string, Option[]> = {
  "incident.channel": INCIDENT_CHANNELS,
  "incident.hold_reason": HOLD_REASONS,
  "incident.close_code": INCIDENT_CLOSE_CODES,
  "incident.cause_code": CAUSE_CODES,
  "incident.category": categoryOptions(),
  "incident.subcategory": subcategoryOptions(),
};

// ---------------------------------------------------------------------------------------------------------------
// The incident

export const INCIDENT_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال رسیدگی", category: "active", color: "teal" },
    { value: "on_hold", label: "در انتظار", category: "waiting", color: "gold" },
    { value: "resolved", label: "حل‌شده", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "on_hold"], to: "in_progress", label: "شروع رسیدگی" },
    { from: ["new", "in_progress"], to: "on_hold", label: "در انتظار", requires: ["hold_reason"] },
    { from: ["new", "in_progress", "on_hold"], to: "resolved", label: "حل شد", requires: ["close_code", "close_notes"], guard: "incident_can_resolve" },
    { from: ["resolved"], to: "in_progress", label: "بازگشایی", guard: "incident_can_reopen" },
    { from: ["resolved"], to: "closed", label: "تأیید و بستن" },
    { from: ["new", "in_progress", "on_hold"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const MAIN = "اصلی";
const SERVICE = "خدمت و پیکربندی";
const TIMES = "زمان‌ها";
const CLOSURE = "حل و بستن";
const MAJOR = "رخداد عمده";
const FEEDBACK = "نظر درخواست‌دهنده";

const incident: TableDef = {
  key: "incident",
  table: "sm_incidents",
  label: "رخداد",
  plural: "رخدادها",
  icon: "siren",
  module: "incident",
  area: "incident",
  description: "هر اختلال یا افت کیفیت یک خدمت: ثبت، دسته‌بندی، اولویت، ارجاع، رسیدگی، حل و بستن، با رخدادهای عمده و بازبینی پس از آن",
  extends: "task",
  numbered: { prefix: "INC", pad: 7 },
  display: "short_description",
  fields: [
    // the task's fields, placed and relabelled where incident management needs it
    { name: "short_description", label: "عنوان", type: "string", section: MAIN },
    { name: "description", label: "شرح", type: "markdown", section: MAIN },
    { name: "caller_id", label: "درخواست‌دهنده", type: "user", section: MAIN },
    { name: "requested_for", label: "کاربر متأثر", type: "user", section: MAIN },
    { name: "channel", label: "مجرای دریافت", type: "choice", choices: "incident.channel", default: "portal", section: MAIN },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category", section: MAIN },
    { name: "subcategory", label: "زیردسته", type: "choice", choices: "$table.subcategory", dependsOn: "category", section: MAIN },
    { name: "impact", label: "اثر", type: "choice", choices: IMPACTS, section: MAIN },
    { name: "urgency", label: "فوریت", type: "choice", choices: URGENCIES, section: MAIN },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, section: MAIN, help: "از اثر و فوریت حساب می‌شود (ماتریس اولویت)" },
    { name: "assignment_group_id", label: "گروه پشتیبانی", type: "group", section: MAIN },
    { name: "assigned_to", label: "کارشناس", type: "user", section: MAIN },
    { name: "hold_reason", label: "دلیل انتظار", type: "choice", choices: "incident.hold_reason", filter: true, list: true, span: 8, section: MAIN },
    { name: "escalation", label: "سطح تشدید", type: "int", section: MAIN },
    { name: "vip", label: "کاربر ویژه", type: "bool", system: true, filter: true, span: 8, section: MAIN },
    { name: "security_incident", label: "رخداد امنیتی", type: "bool", default: false, filter: true, span: 8, section: MAIN, help: "رخداد را محرمانه می‌کند و به گروه امنیت می‌سپارد" },
    { name: "template_id", label: "الگو", type: "ref", ref: "incident_template", filter: true, readonly: true, span: 8, section: MAIN },

    { name: "service_id", label: "خدمت", type: "ref", ref: "service", section: SERVICE },
    { name: "offering_id", label: "گزینهٔ خدمت", type: "ref", ref: "service_offering", section: SERVICE },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", section: SERVICE },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 12, section: SERVICE },
    { name: "affected_cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 12, section: SERVICE },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", section: SERVICE },
    { name: "affected_users", label: "کاربران متأثر دیگر", type: "users", span: 16, section: SERVICE, help: "این افراد پیشرفت رخداد را می‌بینند" },

    { name: "detected_at", label: "زمان بروز یا تشخیص", type: "datetime", sort: true, filter: true, span: 8, section: TIMES },
    { name: "opened_at", label: "زمان ثبت", type: "datetime", section: TIMES },
    { name: "accepted_at", label: "زمان شروع رسیدگی", type: "datetime", system: true, sort: true, filter: true, span: 8, section: TIMES },
    { name: "first_response_at", label: "زمان نخستین پاسخ", type: "datetime", section: TIMES },
    { name: "due_at", label: "موعد", type: "datetime", section: TIMES },
    { name: "sla_due", label: "موعد توافق", type: "datetime", list: true, section: TIMES },
    { name: "resolved_at", label: "زمان حل", type: "datetime", section: TIMES },
    { name: "closed_at", label: "زمان بستن", type: "datetime", section: TIMES },
    { name: "follow_ups", label: "یادآوری‌های انتظار", type: "int", system: true, default: 0, span: 8, section: TIMES },

    { name: "close_code", label: "کد حل", type: "choice", choices: "$table.close_code", section: CLOSURE },
    { name: "cause_code", label: "کد علت", type: "choice", choices: "incident.cause_code", filter: true, span: 8, section: CLOSURE },
    { name: "close_notes", label: "یادداشت حل", type: "text", section: CLOSURE },
    { name: "workaround", label: "راه‌حل موقت", type: "markdown", span: 24, section: CLOSURE, ai: { index: true } },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true, index: true, span: 8, section: CLOSURE },
    { name: "known_error_id", label: "خطای شناخته‌شده", type: "ref", ref: "known_error", filter: true, index: true, span: 8, section: CLOSURE },
    { name: "parent_id", label: "رخداد والد", type: "ref", ref: "$self", filter: true, index: true, span: 8, section: CLOSURE },
    { name: "merged_into", label: "ادغام‌شده در", type: "ref", ref: "$self", readonly: true, filter: true, span: 8, section: CLOSURE },
    { name: "follow_up_of", label: "پیگیریِ رخداد", type: "ref", ref: "$self", readonly: true, span: 8, section: CLOSURE },

    { name: "major_state", label: "رخداد عمده", type: "choice", choices: MAJOR_STATES, readonly: true, list: true, filter: true, sort: true, index: true, span: 8, tab: MAJOR },
    { name: "mi_manager_id", label: "مدیر رخداد عمده", type: "user", filter: true, span: 8, tab: MAJOR },
    { name: "mi_comms_id", label: "مسئول اطلاع‌رسانی", type: "user", span: 8, tab: MAJOR },
    { name: "mi_declared_at", label: "زمان اعلام", type: "datetime", system: true, sort: true, filter: true, span: 8, tab: MAJOR },
    { name: "mi_declared_by", label: "اعلام‌کننده", type: "user", system: true, span: 8, tab: MAJOR },
    { name: "mi_reason", label: "دلیل اعلام یا رد", type: "text", readonly: true, span: 24, tab: MAJOR },
    { name: "bridge_url", label: "پیوند جلسهٔ هماهنگی", type: "url", ltr: true, span: 12, tab: MAJOR, help: "پیوند Skyroom، BigBlueButton، Jitsi یا هر جلسهٔ برخط" },
    { name: "chat_url", label: "کانال گفتگو", type: "url", ltr: true, span: 12, tab: MAJOR, help: "گروه پیام‌رسان یا کانال گفتگوی تیم" },
    { name: "comm_cadence", label: "فاصلهٔ اطلاع‌رسانی (دقیقه)", type: "int", min: 0, max: 1440, span: 8, tab: MAJOR },
    { name: "last_update_at", label: "آخرین اطلاع‌رسانی", type: "datetime", system: true, sort: true, span: 8, tab: MAJOR },
    { name: "next_update_at", label: "موعد اطلاع‌رسانی بعدی", type: "datetime", system: true, sort: true, filter: true, span: 8, tab: MAJOR },
    { name: "stakeholders", label: "ذی‌نفعان", type: "users", span: 24, tab: MAJOR, help: "اطلاعیه‌های رخداد عمده به آن‌ها می‌رسد" },
    { name: "business_impact", label: "اثر کسب‌وکاری", type: "markdown", span: 24, tab: MAJOR },
    { name: "timeline", label: "رویدادهای خط زمانی", type: "json", hidden: true, audit: false, default: [], tab: MAJOR },

    { name: "satisfaction", label: "رضایت", type: "rating", min: 1, max: 5, filter: true, span: 8, tab: FEEDBACK },
    { name: "satisfaction_comment", label: "نظر", type: "text", span: 24, tab: FEEDBACK },
  ],
  states: INCIDENT_STATES,
  scope: {
    ...TASK_SCOPE,
    // the people affected follow the incident like its requester (read only)
    own: [...(TASK_SCOPE.own ?? []), "affected_users"],
    // a requester also rates the resolution when confirming it
    requesterWritable: [...(TASK_SCOPE.requesterWritable ?? []), "satisfaction", "satisfaction_comment"],
  },
  features: { sla: true, confidential: true, rag: true, survey: true, kanban: "state" },
  form: {
    sections: [MAIN, SERVICE, TIMES, CLOSURE],
    tabs: ["جزئیات", MAJOR, FEEDBACK],
    related: [
      { table: "incident_task", field: "incident_id", label: "کارهای رخداد", columns: ["number", "short_description", "state", "assignment_group_id", "assigned_to"] },
      { table: "incident", field: "parent_id", label: "رخدادهای فرزند", columns: ["number", "short_description", "state", "caller_id", "opened_at"] },
      { table: "incident_review", field: "incident_id", label: "بازبینی‌ها", columns: ["number", "title", "state", "owner_id"] },
    ],
  },
  list: { columns: ["number", "short_description", "caller_id", "priority", "state", "assignment_group_id", "assigned_to", "sla_due", "updated_at"], order: "priority,-opened_at" },
  ai: { title: "short_description", text: ["description", "close_notes", "workaround"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Incident tasks

/** Task fields a child table does not use: kept in the table, left out of its form. */
export const hideTaskFields = (names: string[]): FieldDef[] => TASK_FIELDS.filter((f) => names.includes(f.name)).map((f) => ({ ...f, hidden: true }));

const CHILD_TASK_HIDDEN = ["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "approval", "escalation", "parent_id", "close_code"];

export const CHILD_TASK_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "pending", label: "معلق", category: "waiting", color: "gold" },
    { value: "closed_complete", label: "انجام شد", category: "closed", color: "green" },
    { value: "closed_incomplete", label: "ناتمام بسته شد", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "pending"], to: "in_progress", label: "شروع" },
    { from: ["new", "in_progress"], to: "pending", label: "تعلیق" },
    { from: ["new", "in_progress", "pending"], to: "closed_complete", label: "انجام شد" },
    { from: ["new", "in_progress", "pending"], to: "closed_incomplete", label: "بستن ناتمام", requires: ["close_notes"] },
    { from: ["new", "in_progress", "pending"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const incidentTask: TableDef = {
  key: "incident_task",
  table: "sm_incident_tasks",
  label: "کار رخداد",
  plural: "کارهای رخداد",
  icon: "list-checks",
  module: "incident",
  area: "incident",
  description: "بخشی از کار یک رخداد که گروه یا کارشناس دیگری انجام می‌دهد؛ کارهای الزامیِ باز مانع حل رخداد می‌شوند",
  extends: "task",
  numbered: { prefix: "ITASK", pad: 7 },
  display: "short_description",
  fields: [
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "mandatory", label: "لازم برای حل رخداد", type: "bool", default: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    ...hideTaskFields(CHILD_TASK_HIDDEN),
  ],
  states: CHILD_TASK_STATES,
  scope: {},
  list: { columns: ["number", "short_description", "incident_id", "state", "assignment_group_id", "assigned_to", "due_at"], order: "sort_order,number" },
};

// ---------------------------------------------------------------------------------------------------------------
// Post-incident reviews

export const REVIEW_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "active", color: "teal" },
    { value: "published", label: "منتشرشده", category: "resolved", color: "green" },
    { value: "archived", label: "بایگانی", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "فرستادن برای بازبینی", requires: ["summary", "root_cause"] },
    { from: ["in_review"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["in_review"], to: "published", label: "انتشار", guard: "review_can_publish", roles: { area: "incident", level: "full" } },
    { from: ["published"], to: "in_review", label: "بازگشایی بازبینی", roles: { area: "incident", level: "full" } },
    { from: ["published"], to: "archived", label: "بایگانی" },
    { from: ["draft", "in_review"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const REVIEW = "گزارش بازبینی";

const incidentReview: TableDef = {
  key: "incident_review",
  table: "sm_incident_reviews",
  label: "بازبینی پس از رخداد",
  plural: "بازبینی‌های پس از رخداد",
  icon: "clipboard-check",
  module: "incident",
  area: "incident",
  description: "گزارش بی‌سرزنشِ یک رخداد عمده یا مهم: خلاصه، اثر، خط زمانی، علت، تشخیص، حل، درس‌ها و اقدام‌های اصلاحی",
  numbered: { prefix: "PIR", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24 },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "review_trigger", label: "دلیل بازبینی", type: "choice", choices: REVIEW_TRIGGERS, default: "manual", filter: true, span: 12 },
    { name: "owner_id", label: "مسئول بازبینی", type: "user", default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "authors", label: "هم‌نویسندگان", type: "users", span: 16 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 8 },
    { name: "due_at", label: "مهلت انتشار", type: "datetime", list: true, sort: true, filter: true, span: 8 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", system: true, sort: true, filter: true, span: 8 },
    { name: "published_by", label: "منتشرکننده", type: "user", system: true, span: 8 },
    { name: "summary", label: "خلاصه", type: "markdown", span: 24, section: REVIEW, ai: { index: true } },
    { name: "impact", label: "اثر بر کسب‌وکار و کاربران", type: "markdown", span: 24, section: REVIEW },
    { name: "timeline_md", label: "خط زمانی", type: "markdown", span: 24, section: REVIEW },
    { name: "root_cause", label: "علت ریشه‌ای و عامل آغازگر", type: "markdown", span: 24, section: REVIEW, ai: { index: true } },
    { name: "detection", label: "چگونه تشخیص داده شد", type: "markdown", span: 24, section: REVIEW },
    { name: "resolution", label: "چگونه حل شد", type: "markdown", span: 24, section: REVIEW, ai: { index: true } },
    { name: "went_well", label: "چه چیزی خوب پیش رفت", type: "markdown", span: 24, section: REVIEW },
    { name: "went_wrong", label: "چه چیزی خوب پیش نرفت", type: "markdown", span: 24, section: REVIEW },
    { name: "lucky", label: "کجا خوش‌شانس بودیم", type: "markdown", span: 24, section: REVIEW },
    { name: "lessons", label: "درس‌آموخته‌ها", type: "markdown", span: 24, section: REVIEW, ai: { index: true } },
  ],
  states: REVIEW_STATES,
  scope: { own: ["owner_id", "authors"], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true },
  form: {
    sections: ["اصلی", REVIEW],
    related: [{ table: "corrective_action", field: "review_id", label: "اقدام‌های اصلاحی", columns: ["number", "short_description", "action_type", "state", "assigned_to", "due_at"] }],
  },
  list: { columns: ["number", "title", "incident_id", "state", "owner_id", "due_at"], order: "-created_at" },
  ai: { title: "title", text: ["summary", "root_cause", "resolution", "lessons"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Templates (incident models) and canned responses

const incidentTemplate: TableDef = {
  key: "incident_template",
  table: "sm_incident_templates",
  label: "الگوی رخداد",
  plural: "الگوهای رخداد",
  icon: "layout-template",
  module: "incident",
  area: "incident",
  description: "رخدادهای پرتکرار را با مقدارهای آماده و کارهای از پیش تعریف‌شده ثبت کنید",
  display: "name",
  fields: [
    { name: "name", label: "نام الگو", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "short_description", label: "عنوان رخداد", type: "string", maxLength: 200, span: 24 },
    { name: "description", label: "شرح رخداد", type: "markdown", span: 24 },
    { name: "category", label: "دسته", type: "choice", choices: "incident.category", list: true, filter: true, span: 8 },
    { name: "subcategory", label: "زیردسته", type: "choice", choices: "incident.subcategory", dependsOn: "category", span: 8 },
    { name: "channel", label: "مجرای دریافت", type: "choice", choices: "incident.channel", span: 8 },
    { name: "impact", label: "اثر", type: "choice", choices: IMPACTS, span: 8 },
    { name: "urgency", label: "فوریت", type: "choice", choices: URGENCIES, span: 8 },
    { name: "assignment_group_id", label: "گروه پشتیبانی", type: "group", list: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", span: 12 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", span: 12 },
    { name: "tasks", label: "کارهای الگو", type: "json", default: [], span: 24, help: "[{ «short_description»: «…», «assignment_group_id»: «…», «mandatory»: true }]" },
    { name: "groups", label: "فقط برای گروه‌های", type: "refs", ref: "group", span: 24, help: "خالی: همهٔ کارشناسان" },
    { name: "description_note", label: "توضیح برای کارشناس", type: "text", span: 24 },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "category", "assignment_group_id", "active"], order: "sort_order,name" },
};

const incidentResponse: TableDef = {
  key: "incident_response",
  table: "sm_incident_responses",
  label: "پاسخ آماده",
  plural: "پاسخ‌های آماده",
  icon: "message-square-text",
  module: "incident",
  area: "incident",
  description: "متن‌های آماده برای پاسخ یا یادداشت؛ جای‌نگهدارها هنگام درج پر می‌شوند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "برای", type: "choice", choices: RESPONSE_KINDS, default: "both", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "category", label: "دسته", type: "choice", choices: "incident.category", filter: true, span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 12 },
    { name: "body", label: "متن", type: "markdown", required: true, search: true, span: 24, help: "جای‌نگهدارها: {{caller}} {{number}} {{title}} {{assignee}} {{me}} {{group}}" },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "kind", "category", "active"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// The module's settings (one row per organisation; the server falls back to these defaults without it)

export const INCIDENT_CONFIG_DEFAULTS = {
  auto_close_days: 3,
  reopen_window_days: 7,
  follow_up_days: 3,
  follow_up_max: 2,
  reassignment_alert: 3,
  mi_candidate_priorities: ["1"] as string[],
  mi_candidate_affected: 10,
  mi_default_cadence: 30,
  mi_auto_problem: true,
  mi_auto_review: true,
  review_due_days: 5,
  cascade_children: true,
  propagate_comments: true,
  security_group_id: null as string | null,
};
export type IncidentConfig = typeof INCIDENT_CONFIG_DEFAULTS;

const BEHAVIOUR = "رفتار رخدادها";
const MAJOR_SECTION = "رخداد عمده";

const incidentConfig: TableDef = {
  key: "incident_config",
  table: "sm_incident_configs",
  label: "تنظیمات رخداد",
  plural: "تنظیمات رخداد",
  icon: "settings-2",
  module: "incident",
  area: "settings",
  description: "بستن خودکار، مهلت بازگشایی، یادآوری‌ها، معیار رخداد عمده و رفتار رخدادهای والد و فرزند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات رخداد", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "auto_close_days", label: "بستن خودکار پس از (روز کاری)", type: "int", min: 0, max: 60, default: INCIDENT_CONFIG_DEFAULTS.auto_close_days, span: 8, section: BEHAVIOUR, help: "رخداد حل‌شده بدون پاسخ درخواست‌دهنده بسته می‌شود؛ صفر: هرگز" },
    { name: "reopen_window_days", label: "مهلت بازگشایی (روز)", type: "int", min: 0, max: 365, default: INCIDENT_CONFIG_DEFAULTS.reopen_window_days, span: 8, section: BEHAVIOUR, help: "پس از آن به جای بازگشایی، رخداد پیگیری ثبت می‌شود؛ صفر: بدون محدودیت" },
    { name: "follow_up_days", label: "یادآوری انتظار درخواست‌دهنده (روز کاری)", type: "int", min: 0, max: 30, default: INCIDENT_CONFIG_DEFAULTS.follow_up_days, span: 8, section: BEHAVIOUR },
    { name: "follow_up_max", label: "حل خودکار پس از چند یادآوری", type: "int", min: 0, max: 10, default: INCIDENT_CONFIG_DEFAULTS.follow_up_max, span: 8, section: BEHAVIOUR, help: "صفر: هرگز" },
    { name: "reassignment_alert", label: "هشدار ارجاع پیاپی از", type: "int", min: 0, max: 20, default: INCIDENT_CONFIG_DEFAULTS.reassignment_alert, span: 8, section: BEHAVIOUR },
    { name: "cascade_children", label: "حل رخداد والد، فرزندان را هم حل کند", type: "bool", default: true, span: 8, section: BEHAVIOUR },
    { name: "propagate_comments", label: "پاسخ‌های رخداد والد به فرزندان برسد", type: "bool", default: true, span: 8, section: BEHAVIOUR },
    { name: "security_group_id", label: "گروه رخدادهای امنیتی", type: "group", span: 8, section: BEHAVIOUR },
    { name: "mi_candidate_priorities", label: "اولویت‌های نامزد رخداد عمده", type: "multichoice", choices: PRIORITIES, default: INCIDENT_CONFIG_DEFAULTS.mi_candidate_priorities, span: 12, section: MAJOR_SECTION },
    { name: "mi_candidate_affected", label: "کاربران متأثر برای نامزدی", type: "int", min: 0, max: 100000, default: INCIDENT_CONFIG_DEFAULTS.mi_candidate_affected, span: 12, section: MAJOR_SECTION, help: "صفر: این معیار به کار نمی‌رود" },
    { name: "mi_default_cadence", label: "فاصلهٔ پیش‌فرض اطلاع‌رسانی (دقیقه)", type: "int", min: 0, max: 1440, default: INCIDENT_CONFIG_DEFAULTS.mi_default_cadence, span: 8, section: MAJOR_SECTION },
    { name: "mi_auto_problem", label: "هر رخداد عمده یک مشکل بگیرد", type: "bool", default: true, span: 8, section: MAJOR_SECTION },
    { name: "mi_auto_review", label: "پیش‌نویس بازبینی پس از رخداد عمده", type: "bool", default: true, span: 8, section: MAJOR_SECTION },
    { name: "review_due_days", label: "مهلت بازبینی (روز کاری)", type: "int", min: 1, max: 60, default: INCIDENT_CONFIG_DEFAULTS.review_due_days, span: 8, section: MAJOR_SECTION },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", system: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: [MAIN, BEHAVIOUR, MAJOR_SECTION] },
  list: { columns: ["name", "auto_close_days", "reopen_window_days"], order: "name" },
};

export const INCIDENT_TABLES: TableDef[] = [incident, incidentTask, incidentReview, incidentTemplate, incidentResponse, incidentConfig];
