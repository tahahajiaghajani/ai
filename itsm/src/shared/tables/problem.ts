// Tables of problem management (docs/modules/problem_FA.md, catalogue docs/catalog/g2_operations.md «Module:
// problem»): the problem (a task with ITIL's lifecycle — assess, root-cause analysis, fix, monitoring — its RCA canvas
// and milestones), problem tasks, known errors (the KEDB), problem candidates raised by rules over incidents, and
// corrective and preventive actions (CAPA, shared with post-incident reviews), plus the module's settings row.
// Behaviour lives in src/server/modules/problem; screens in src/ui/modules/problem.
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { IMPACTS, PRIORITIES, TASK_SCOPE, URGENCIES } from "../model/task";
import { CAUSE_CODES, CHILD_TASK_STATES, DEFAULT_CATEGORIES, hideTaskFields } from "./incident";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

/** Where a problem comes from; the reactive ones follow incidents, the proactive ones come before them. */
export const PROBLEM_SOURCES: Option[] = [
  { value: "incident", label: "رخداد یا رخدادهای تکراری", color: "blue", order: 1 },
  { value: "major_incident", label: "رخداد عمده", color: "red", order: 2 },
  { value: "review", label: "بازبینی پس از رخداد", color: "orange", order: 3 },
  { value: "candidate", label: "نامزد خودکار", color: "gold", order: 4 },
  { value: "trend", label: "تحلیل روند", color: "teal", order: 5 },
  { value: "monitoring", label: "پایش و هشدار", color: "indigo", order: 6 },
  { value: "vendor", label: "اطلاعیهٔ تأمین‌کننده", color: "purple", order: 7 },
  { value: "vulnerability", label: "آسیب‌پذیری", color: "magenta", order: 8 },
  { value: "audit", label: "ممیزی", color: "gray", order: 9 },
  { value: "user", label: "پیشنهاد همکاران", color: "green", order: 10 },
];
/** Sources that make a problem proactive (identified before incidents pile up). */
export const PROACTIVE_SOURCES = ["trend", "monitoring", "vendor", "vulnerability", "audit", "user"];

export const INVESTIGATION_REASONS: Option[] = [
  { value: "recurring", label: "تکرار رخداد" },
  { value: "high_impact", label: "اثر زیاد" },
  { value: "non_routine", label: "رفتار غیرعادی" },
  { value: "other", label: "دیگر" },
];

export const PENDING_REASONS: Option[] = [
  { value: "vendor", label: "منتظر تأمین‌کننده", color: "orange" },
  { value: "change", label: "منتظر اجرای تغییر", color: "purple" },
  { value: "information", label: "منتظر اطلاعات", color: "gold" },
  { value: "resources", label: "منتظر منابع", color: "gray" },
];

export const PROBLEM_CLOSE_CODES: Option[] = [
  { value: "fixed", label: "رفع شد", order: 1 },
  { value: "workaround_only", label: "فقط راه‌حل موقت", order: 2 },
  { value: "risk_accepted", label: "پذیرش ریسک", order: 3 },
  { value: "duplicate", label: "تکراری", order: 4 },
  { value: "not_a_problem", label: "مشکل نبود", order: 5 },
];

export const CONTRIBUTING_FACTORS: Option[] = [
  { value: "people", label: "افراد و مهارت", color: "blue" },
  { value: "process", label: "فرایند و روش", color: "teal" },
  { value: "technology", label: "فناوری", color: "indigo" },
  { value: "supplier", label: "تأمین‌کننده", color: "purple" },
  { value: "change", label: "تغییرات", color: "orange" },
  { value: "environment", label: "محیط (برق، سرمایش، شبکهٔ بیرونی)", color: "gold" },
  { value: "measurement", label: "پایش و سنجش", color: "gray" },
];

export const RCA_METHODS: Option[] = [
  { value: "five_whys", label: "پنج چرا" },
  { value: "fishbone", label: "نمودار استخوان ماهی (ایشیکاوا)" },
  { value: "timeline", label: "تحلیل خط زمانی" },
  { value: "kepner_tregoe", label: "هست / نیست (کپنر-تریگو)" },
  { value: "other", label: "روش دیگر" },
];

/** Sections of the RCA canvas a problem (or its template) shows; none chosen = every section. */
export const RCA_SECTIONS: Option[] = [
  { value: "whys", label: "پنج چرا", order: 1 },
  { value: "fishbone", label: "استخوان ماهی", order: 2 },
  { value: "timeline", label: "خط زمانی", order: 3 },
  { value: "hypotheses", label: "فرضیه‌ها و شواهد", order: 4 },
  { value: "is_not", label: "هست / نیست", order: 5 },
];

export const LIKELIHOODS: Option[] = [
  { value: "1", label: "۱ — زیاد", order: 1 },
  { value: "2", label: "۲ — متوسط", order: 2 },
  { value: "3", label: "۳ — کم", order: 3 },
];

export const KE_EFFECTIVENESS: Option[] = [
  { value: "unknown", label: "نامعلوم", color: "gray" },
  { value: "effective", label: "مؤثر", color: "green" },
  { value: "partial", label: "تا حدی مؤثر", color: "gold" },
  { value: "ineffective", label: "بی‌اثر", color: "red" },
];

export const CANDIDATE_RULES: Option[] = [
  { value: "recurring_ci", label: "تکرار روی یک پیکربندی", color: "orange" },
  { value: "recurring_category", label: "تکرار در یک دسته", color: "gold" },
  { value: "major_incident", label: "رخداد عمده", color: "red" },
  { value: "reopened", label: "بازگشایی‌های پیاپی", color: "purple" },
  { value: "manual", label: "دستی", color: "gray" },
  { value: "ml", label: "خوشه‌بندی هوشمند", color: "indigo" },
];

export const ACTION_TYPES: Option[] = [
  { value: "prevent", label: "پیشگیری", color: "green" },
  { value: "mitigate", label: "کاهش اثر", color: "teal" },
  { value: "detect", label: "تشخیص زودتر", color: "blue" },
  { value: "repair", label: "اصلاح", color: "orange" },
];

export const PROBLEM_CHOICE_LISTS: Record<string, Option[]> = {
  "problem.source": PROBLEM_SOURCES,
  "problem.pending_reason": PENDING_REASONS,
  "problem.close_code": PROBLEM_CLOSE_CODES,
  "problem.cause_code": CAUSE_CODES,
  "problem.category": DEFAULT_CATEGORIES.map((c, i) => ({ value: c.value, label: c.label, order: i + 1 })),
  "problem.subcategory": DEFAULT_CATEGORIES.flatMap((c) => c.subs.map(([value, label], i) => ({ value, label, parent: c.value, order: i + 1 }))),
};

// ---------------------------------------------------------------------------------------------------------------
// The problem

const OPEN = ["new", "assess", "rca", "fix_in_progress", "pending"];

export const PROBLEM_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "assess", label: "ارزیابی", category: "active", color: "indigo" },
    { value: "rca", label: "تحلیل علت ریشه‌ای", category: "active", color: "purple" },
    { value: "fix_in_progress", label: "در حال رفع", category: "active", color: "teal" },
    { value: "pending", label: "در انتظار", category: "waiting", color: "gold" },
    { value: "resolved", label: "رفع‌شده (پایش)", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "ردشده یا لغو", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "assess", label: "شروع ارزیابی" },
    { from: ["new", "assess"], to: "rca", label: "پذیرش و تحلیل علت" },
    { from: ["rca"], to: "fix_in_progress", label: "علت پیدا شد", requires: ["cause_notes"] },
    { from: ["assess", "rca", "fix_in_progress"], to: "pending", label: "در انتظار", requires: ["pending_reason"] },
    { from: ["pending"], to: "rca", label: "ادامهٔ تحلیل" },
    { from: ["pending"], to: "fix_in_progress", label: "ادامهٔ رفع", requires: ["cause_notes"] },
    { from: ["fix_in_progress"], to: "resolved", label: "رفع شد", requires: ["fix_notes"] },
    { from: ["resolved", "fix_in_progress"], to: "rca", label: "تحلیل دوباره", roles: { area: "problem", level: "full" } },
    { from: ["resolved"], to: "closed", label: "بستن", requires: ["close_code"], guard: "problem_can_close" },
    { from: ["rca", "pending"], to: "closed", label: "پذیرش ریسک", requires: ["close_notes"], roles: { area: "problem", level: "full" } },
    { from: OPEN, to: "canceled", label: "رد یا لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const MAIN = "اصلی";
const ANALYSIS = "تحلیل و رفع";
const MILESTONES = "نقاط عطف";

const problem: TableDef = {
  key: "problem",
  table: "sm_problems",
  label: "مشکل",
  plural: "مشکلات",
  icon: "bug",
  module: "problem",
  area: "problem",
  description: "علت ناشناختهٔ یک یا چند رخداد: ارزیابی، تحلیل علت ریشه‌ای، راه‌حل موقت، رفع دائمی و پایش اثر",
  extends: "task",
  numbered: { prefix: "PRB", pad: 7 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "شرح مسئله", type: "string", section: MAIN },
    { name: "description", label: "شرح", type: "markdown", section: MAIN },
    { name: "source", label: "منشأ", type: "choice", choices: "problem.source", default: "incident", list: true, filter: true, span: 8, section: MAIN },
    { name: "proactive", label: "پیش‌گیرانه", type: "bool", system: true, filter: true, span: 8, section: MAIN },
    { name: "investigation_reason", label: "دلیل بررسی", type: "choice", choices: INVESTIGATION_REASONS, filter: true, span: 8, section: MAIN },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category", section: MAIN },
    { name: "subcategory", label: "زیردسته", type: "choice", choices: "$table.subcategory", dependsOn: "category", section: MAIN },
    { name: "impact", label: "اثر", type: "choice", choices: IMPACTS, section: MAIN },
    { name: "urgency", label: "فوریت", type: "choice", choices: URGENCIES, section: MAIN },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, section: MAIN },
    { name: "likelihood", label: "احتمال تکرار", type: "choice", choices: LIKELIHOODS, default: "2", filter: true, span: 8, section: MAIN },
    { name: "risk_score", label: "امتیاز ریسک", type: "int", readonly: true, audit: false, list: true, sort: true, filter: true, span: 8, section: MAIN, help: "از اثر، احتمال، شمار رخدادها و خطاهای شناخته‌شده حساب می‌شود" },
    { name: "manager_id", label: "مدیر مشکل", type: "user", filter: true, index: true, span: 8, section: MAIN },
    { name: "assignment_group_id", label: "گروه مسئول", type: "group", section: MAIN },
    { name: "assigned_to", label: "هماهنگ‌کننده", type: "user", section: MAIN },
    { name: "pending_reason", label: "دلیل انتظار", type: "choice", choices: "problem.pending_reason", filter: true, span: 8, section: MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", section: MAIN },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", section: MAIN },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 12, section: MAIN },
    { name: "affected_cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 12, section: MAIN },
    { name: "first_incident_id", label: "نخستین رخداد", type: "ref", ref: "incident", span: 8, section: MAIN },
    { name: "template_id", label: "الگو", type: "ref", ref: "problem_template", filter: true, span: 8, section: MAIN },

    { name: "symptoms", label: "نشانه‌ها", type: "markdown", span: 24, section: ANALYSIS, ai: { index: true } },
    { name: "workaround", label: "راه‌حل موقت", type: "markdown", span: 24, section: ANALYSIS, ai: { index: true } },
    { name: "cause_code", label: "کد علت", type: "choice", choices: "problem.cause_code", filter: true, span: 8, section: ANALYSIS },
    { name: "rca_method", label: "روش تحلیل", type: "choice", choices: RCA_METHODS, filter: true, span: 8, section: ANALYSIS },
    { name: "rca_sections", label: "بخش‌های کارگاه تحلیل", type: "multichoice", choices: RCA_SECTIONS, span: 16, section: ANALYSIS, help: "خالی: همهٔ بخش‌ها" },
    { name: "contributing_factors", label: "عوامل مؤثر", type: "multichoice", choices: CONTRIBUTING_FACTORS, filter: true, span: 8, section: ANALYSIS },
    { name: "cause_notes", label: "علت ریشه‌ای", type: "markdown", span: 24, section: ANALYSIS, ai: { index: true } },
    { name: "fix_notes", label: "راه‌حل دائمی", type: "markdown", span: 24, section: ANALYSIS, ai: { index: true } },
    { name: "rca", label: "کارگاه تحلیل علت", type: "json", hidden: true, default: {}, section: ANALYSIS },
    { name: "close_code", label: "نتیجهٔ بستن", type: "choice", choices: "$table.close_code", section: ANALYSIS },
    { name: "close_notes", label: "یادداشت بستن یا رد", type: "text", section: ANALYSIS },
    { name: "duplicate_of", label: "تکراریِ", type: "ref", ref: "$self", readonly: true, filter: true, span: 8, section: ANALYSIS },
    { name: "known_error", label: "خطای شناخته‌شده دارد", type: "bool", readonly: true, list: true, filter: true, span: 8, section: ANALYSIS },

    { name: "target_date", label: "تاریخ هدف", type: "date", sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "review_date", label: "بازبینی بعدی", type: "date", sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "incident_count", label: "رخدادهای مرتبط", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "tech_debt", label: "بدهی فنی", type: "int", readonly: true, audit: false, default: 0, sort: true, filter: true, span: 8, section: MILESTONES, help: "خطاهای شناخته‌شدهٔ فعال × رخدادهای مرتبط" },
    { name: "rca_at", label: "زمان یافتن علت", type: "datetime", system: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "workaround_at", label: "زمان انتشار راه‌حل موقت", type: "datetime", system: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "fix_at", label: "زمان رفع", type: "datetime", system: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "monitoring_until", label: "پایش تا", type: "date", system: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "time_to_rca", label: "زمان تا یافتن علت", type: "duration", system: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "time_to_fix", label: "زمان تا رفع", type: "duration", system: true, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "last_activity_at", label: "آخرین فعالیت", type: "datetime", readonly: true, audit: false, sort: true, filter: true, span: 8, section: MILESTONES },
    { name: "shared", label: "اطلاع‌رسانی‌های راه‌حل", type: "json", readonly: true, hidden: true, audit: false, default: {} },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", readonly: true, hidden: true, audit: false },
    { name: "monitoring_done", label: "پایش انجام شد", type: "bool", readonly: true, hidden: true, audit: false, default: false },
  ],
  states: PROBLEM_STATES,
  scope: {
    ...TASK_SCOPE,
    own: ["caller_id", "requested_for", "opened_by", "assigned_to", "manager_id"],
    requester: ["requested_for", "caller_id", "opened_by"],
    // whoever proposes a problem follows it and adds what they see; the team runs the analysis
    requesterWritable: ["description", "symptoms", "watch_list"],
    requesterTransitions: [],
  },
  features: { confidential: true, rag: true, kanban: "state" },
  form: {
    sections: [MAIN, ANALYSIS, MILESTONES],
    related: [
      { table: "incident", field: "problem_id", label: "رخدادهای مرتبط", columns: ["number", "short_description", "state", "priority", "opened_at"] },
      { table: "known_error", field: "problem_id", label: "خطاهای شناخته‌شده", columns: ["number", "short_description", "state", "use_count"] },
      { table: "problem_task", field: "problem_id", label: "کارهای مشکل", columns: ["number", "short_description", "task_type", "state", "assigned_to"] },
      { table: "corrective_action", field: "problem_id", label: "اقدام‌های اصلاحی", columns: ["number", "short_description", "action_type", "state", "due_at"] },
    ],
  },
  list: { columns: ["number", "short_description", "state", "priority", "incident_count", "known_error", "assignment_group_id", "assigned_to", "updated_at"], order: "priority,-risk_score,-opened_at" },
  ai: { title: "short_description", text: ["description", "symptoms", "cause_notes", "workaround", "fix_notes"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Problem tasks

export const PROBLEM_TASK_TYPES: Option[] = [
  { value: "general", label: "عمومی" },
  { value: "rca", label: "تحلیل علت" },
  { value: "fix", label: "رفع" },
];

const problemTask: TableDef = {
  key: "problem_task",
  table: "sm_problem_tasks",
  label: "کار مشکل",
  plural: "کارهای مشکل",
  icon: "list-todo",
  module: "problem",
  area: "problem",
  description: "بخشی از تحلیل یا رفع یک مشکل با کارشناس و گروه خودش؛ یافته‌ها به مشکل منتقل می‌شوند",
  extends: "task",
  numbered: { prefix: "PTASK", pad: 7 },
  display: "short_description",
  fields: [
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "task_type", label: "نوع کار", type: "choice", choices: PROBLEM_TASK_TYPES, default: "general", list: true, filter: true, span: 6 },
    { name: "mandatory", label: "لازم برای بستن مشکل", type: "bool", default: true, filter: true, span: 6 },
    { name: "findings", label: "یافته‌ها", type: "markdown", span: 24 },
    ...hideTaskFields(["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "approval", "escalation", "parent_id", "close_code"]),
  ],
  states: CHILD_TASK_STATES,
  scope: {},
  list: { columns: ["number", "short_description", "problem_id", "task_type", "state", "assigned_to", "due_at"], order: "-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Known errors (KEDB)

export const KNOWN_ERROR_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "published", label: "منتشرشده", category: "active", color: "teal" },
    { value: "fix_scheduled", label: "رفع زمان‌بندی‌شده", category: "active", color: "indigo" },
    { value: "vendor", label: "نزد تأمین‌کننده", category: "active", color: "purple" },
    { value: "no_action", label: "بدون اقدام", category: "active", color: "gold" },
    { value: "fixed", label: "رفع‌شده", category: "resolved", color: "green" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "published", label: "انتشار", requires: ["symptoms", "workaround"] },
    { from: ["published", "vendor", "no_action"], to: "fix_scheduled", label: "رفع زمان‌بندی شد" },
    { from: ["published", "fix_scheduled", "no_action"], to: "vendor", label: "ارجاع به تأمین‌کننده" },
    { from: ["published", "fix_scheduled", "vendor"], to: "no_action", label: "بدون اقدام", requires: ["root_cause"] },
    { from: ["fix_scheduled", "vendor", "no_action"], to: "published", label: "بازگشت به منتشرشده" },
    { from: ["published", "fix_scheduled", "vendor", "no_action"], to: "fixed", label: "رفع شد" },
    { from: ["fixed"], to: "published", label: "بازگشت (تکرار شد)" },
    { from: ["published", "fix_scheduled", "vendor", "no_action", "fixed"], to: "retired", label: "بازنشسته" },
    { from: ["draft"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const knownError: TableDef = {
  key: "known_error",
  table: "sm_known_errors",
  label: "خطای شناخته‌شده",
  plural: "خطاهای شناخته‌شده",
  icon: "book-alert",
  module: "problem",
  area: "problem",
  description: "مشکلی که علت یا راه‌حل موقتش معلوم است: نشانه‌ها برای تطبیق رخدادها، راه‌حل موقت برای کارشناسان",
  numbered: { prefix: "KE", pad: 6 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24, ai: { index: true } },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", list: true, filter: true, index: true, span: 12 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, index: true, span: 6 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 6 },
    { name: "symptoms", label: "نشانه‌ها", type: "markdown", search: true, span: 24, ai: { index: true } },
    { name: "root_cause", label: "علت", type: "markdown", search: true, span: 24, ai: { index: true } },
    { name: "workaround", label: "راه‌حل موقت", type: "markdown", search: true, span: 24, ai: { index: true } },
    { name: "category", label: "دسته (رخداد)", type: "choice", choices: "incident.category", filter: true, span: 8 },
    { name: "subcategory", label: "زیردسته (رخداد)", type: "choice", choices: "incident.subcategory", dependsOn: "category", span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8 },
    { name: "affected_cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 16 },
    { name: "effectiveness", label: "اثربخشی راه‌حل", type: "choice", choices: KE_EFFECTIVENESS, default: "unknown", list: true, filter: true, span: 8 },
    { name: "review_at", label: "بازبینی بعدی", type: "date", sort: true, filter: true, span: 8 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", system: true, sort: true, filter: true, span: 8 },
    { name: "published_by", label: "منتشرکننده", type: "user", system: true, span: 8 },
    { name: "use_count", label: "دفعات اعمال راه‌حل", type: "int", readonly: true, audit: false, default: 0, list: true, sort: true, span: 8 },
    { name: "last_used_at", label: "آخرین اعمال", type: "datetime", readonly: true, audit: false, sort: true, span: 8 },
    { name: "incident_count", label: "رخدادهای منطبق", type: "int", readonly: true, audit: false, default: 0, sort: true, span: 8 },
  ],
  states: KNOWN_ERROR_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true },
  list: { columns: ["number", "short_description", "state", "problem_id", "effectiveness", "use_count", "updated_at"], order: "-use_count,-updated_at" },
  ai: { title: "short_description", text: ["symptoms", "root_cause", "workaround"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Problem candidates (rules over incidents raise them; a person promotes, merges or dismisses)

export const CANDIDATE_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "reviewing", label: "در بررسی", category: "active", color: "teal" },
    { value: "promoted", label: "به مشکل تبدیل شد", category: "resolved", color: "green" },
    { value: "merged", label: "به مشکل موجود پیوست", category: "closed", color: "indigo" },
    { value: "dismissed", label: "کنار گذاشته شد", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "reviewing", label: "بررسی" },
    { from: ["new", "reviewing"], to: "dismissed", label: "کنار گذاشتن", requires: ["review_notes"] },
    { from: ["new", "reviewing"], to: "promoted", label: "تبدیل به مشکل", requires: ["problem_id"] },
    { from: ["new", "reviewing"], to: "merged", label: "پیوستن به مشکل موجود", requires: ["problem_id"] },
    { from: ["dismissed"], to: "reviewing", label: "بررسی دوباره" },
  ],
  locked: ["resolved", "closed", "canceled"],
};

const problemCandidate: TableDef = {
  key: "problem_candidate",
  table: "sm_problem_candidates",
  label: "نامزد مشکل",
  plural: "نامزدهای مشکل",
  icon: "radar",
  module: "problem",
  area: "problem",
  description: "رخدادهای تکراری که قاعده‌ها پیدا کرده‌اند؛ کارشناس مشکل آن را به مشکل تبدیل، به مشکلی موجود پیوست یا کنار می‌گذارد",
  numbered: { prefix: "PCN", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24 },
    { name: "rule_kind", label: "قاعده", type: "choice", choices: CANDIDATE_RULES, default: "manual", list: true, filter: true, span: 8 },
    { name: "score", label: "امتیاز", type: "int", default: 0, list: true, sort: true, filter: true, span: 8 },
    { name: "assigned_to", label: "بررسی‌کننده", type: "user", filter: true, index: true, span: 8 },
    { name: "incidents", label: "رخدادها", type: "refs", ref: "incident", span: 24 },
    { name: "incident_count", label: "شمار رخدادها", type: "int", default: 0, list: true, sort: true, span: 8 },
    { name: "first_at", label: "نخستین رخداد", type: "datetime", sort: true, span: 8 },
    { name: "last_at", label: "تازه‌ترین رخداد", type: "datetime", list: true, sort: true, filter: true, span: 8 },
    { name: "category", label: "دسته (رخداد)", type: "choice", choices: "incident.category", filter: true, span: 8 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "signature", label: "نشانهٔ تکرار", type: "string", maxLength: 300, hidden: true, readonly: true, index: true },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true, span: 12 },
    { name: "review_notes", label: "یادداشت بررسی", type: "text", span: 24 },
  ],
  states: CANDIDATE_STATES,
  scope: { own: ["assigned_to"] },
  features: { journal: true, links: true },
  list: { columns: ["number", "title", "rule_kind", "incident_count", "score", "state", "last_at"], order: "-score,-last_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Corrective and preventive actions (CAPA): from problems and post-incident reviews

export const ACTION_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "blocked", label: "متوقف", category: "waiting", color: "gold" },
    { value: "done", label: "انجام شد", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "blocked"], to: "in_progress", label: "شروع" },
    { from: ["new", "in_progress"], to: "blocked", label: "توقف" },
    { from: ["new", "in_progress", "blocked"], to: "done", label: "انجام شد", requires: ["evidence"] },
    { from: ["new", "in_progress", "blocked"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const correctiveAction: TableDef = {
  key: "corrective_action",
  table: "sm_corrective_actions",
  label: "اقدام اصلاحی",
  plural: "اقدام‌های اصلاحی و پیشگیرانه",
  icon: "shield-check",
  module: "problem",
  area: "problem",
  description: "اقدامی برای پیشگیری از تکرار، کاهش اثر یا تشخیص زودتر؛ از تحلیل مشکل یا بازبینی پس از رخداد",
  extends: "task",
  numbered: { prefix: "ACT", pad: 6 },
  display: "short_description",
  fields: [
    { name: "action_type", label: "نوع اقدام", type: "choice", choices: ACTION_TYPES, default: "prevent", list: true, filter: true, span: 8 },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true, index: true, span: 8 },
    { name: "review_id", label: "بازبینی پس از رخداد", type: "ref", ref: "incident_review", filter: true, index: true, span: 8 },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", filter: true, span: 8 },
    { name: "tracker_url", label: "پیوند پیگیری", type: "url", ltr: true, span: 16 },
    { name: "evidence", label: "شواهد انجام", type: "markdown", span: 24 },
    ...hideTaskFields(["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "approval", "escalation", "parent_id", "close_code", "ci_id", "location_id"]),
  ],
  states: ACTION_STATES,
  scope: {},
  list: { columns: ["number", "short_description", "action_type", "state", "assigned_to", "due_at", "problem_id"], order: "due_at,-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Templates (problem models, catalogue PRB-007): values a new problem starts with, the analysis it runs (method and
// the canvas's sections) and its tasks; offered to the groups named (or everyone), kept by the group it assigns to.

const problemTemplate: TableDef = {
  key: "problem_template",
  table: "sm_problem_templates",
  label: "الگوی مشکل",
  plural: "الگوهای مشکل",
  icon: "layout-template",
  module: "problem",
  area: "problem",
  description: "مدل‌های مشکل: مقدارهای آماده، روش و بخش‌های کارگاه تحلیل و کارهای از پیش تعریف‌شده",
  display: "name",
  fields: [
    { name: "name", label: "نام الگو", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "short_description", label: "شرح مسئله", type: "string", maxLength: 200, span: 24 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "source", label: "منشأ", type: "choice", choices: "problem.source", span: 8 },
    { name: "category", label: "دسته", type: "choice", choices: "problem.category", list: true, filter: true, span: 8 },
    { name: "subcategory", label: "زیردسته", type: "choice", choices: "problem.subcategory", dependsOn: "category", span: 8 },
    { name: "impact", label: "اثر", type: "choice", choices: IMPACTS, span: 8 },
    { name: "urgency", label: "فوریت", type: "choice", choices: URGENCIES, span: 8 },
    { name: "likelihood", label: "احتمال تکرار", type: "choice", choices: LIKELIHOODS, span: 8 },
    { name: "assignment_group_id", label: "گروه مسئول", type: "group", list: true, filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", span: 8 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", span: 8 },
    { name: "rca_method", label: "روش تحلیل", type: "choice", choices: RCA_METHODS, list: true, span: 8 },
    { name: "rca_sections", label: "بخش‌های کارگاه تحلیل", type: "multichoice", choices: RCA_SECTIONS, span: 16, help: "خالی: همهٔ بخش‌ها" },
    { name: "tasks", label: "کارهای الگو", type: "json", default: [], span: 24, help: "[{ «short_description»: «…», «task_type»: «rca», «assignment_group_id»: «…», «mandatory»: true }]" },
    { name: "groups", label: "فقط برای گروه‌های", type: "refs", ref: "group", span: 24, help: "خالی: همهٔ کارشناسان" },
    { name: "description_note", label: "توضیح برای هماهنگ‌کننده", type: "text", span: 24 },
  ],
  unique: [["name"]],
  // every reader of problems reads templates; the group they assign to (or a manager) keeps them
  scope: { public: true, group: "assignment_group_id" },
  list: { columns: ["name", "category", "rca_method", "assignment_group_id", "active"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

export const PROBLEM_CONFIG_DEFAULTS = {
  inactivity_days: 14,
  monitoring_days: 30,
  candidate_window_days: 30,
  candidate_min_incidents: 3,
  candidate_reopen_min: 2,
  close_requires_incident: false,
  resolve_waiting_incidents: true,
  ke_review_days: 90,
};
export type ProblemConfig = typeof PROBLEM_CONFIG_DEFAULTS;

const RULES = "قاعده‌ها";

const problemConfig: TableDef = {
  key: "problem_config",
  table: "sm_problem_configs",
  label: "تنظیمات مشکل",
  plural: "تنظیمات مشکل",
  icon: "settings-2",
  module: "problem",
  area: "settings",
  description: "یادآوری بی‌فعالیتی، پایش پس از رفع، قاعده‌های نامزد مشکل و رفتار بستن",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات مشکل", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "inactivity_days", label: "یادآوری بی‌فعالیتی پس از (روز)", type: "int", min: 0, max: 365, default: PROBLEM_CONFIG_DEFAULTS.inactivity_days, span: 8, section: RULES, help: "صفر: هرگز" },
    { name: "monitoring_days", label: "پایش پس از رفع (روز)", type: "int", min: 0, max: 365, default: PROBLEM_CONFIG_DEFAULTS.monitoring_days, span: 8, section: RULES },
    { name: "ke_review_days", label: "بازبینی خطای شناخته‌شده هر (روز)", type: "int", min: 0, max: 730, default: PROBLEM_CONFIG_DEFAULTS.ke_review_days, span: 8, section: RULES },
    { name: "candidate_window_days", label: "بازهٔ بررسی تکرار (روز)", type: "int", min: 1, max: 180, default: PROBLEM_CONFIG_DEFAULTS.candidate_window_days, span: 8, section: RULES },
    { name: "candidate_min_incidents", label: "حداقل رخداد برای نامزدی", type: "int", min: 2, max: 100, default: PROBLEM_CONFIG_DEFAULTS.candidate_min_incidents, span: 8, section: RULES },
    { name: "candidate_reopen_min", label: "بازگشایی‌های لازم برای نامزدی", type: "int", min: 0, max: 20, default: PROBLEM_CONFIG_DEFAULTS.candidate_reopen_min, span: 8, section: RULES, help: "صفر: این قاعده به کار نمی‌رود" },
    { name: "close_requires_incident", label: "بستن فقط با دست‌کم یک رخداد مرتبط", type: "bool", default: false, span: 12, section: RULES },
    { name: "resolve_waiting_incidents", label: "رفع مشکل، رخدادهای منتظر آن را حل کند", type: "bool", default: true, span: 12, section: RULES },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: [MAIN, RULES] },
  list: { columns: ["name", "inactivity_days", "monitoring_days"], order: "name" },
};

export const PROBLEM_TABLES: TableDef[] = [problem, problemTask, knownError, problemCandidate, correctiveAction, problemTemplate, problemConfig];
