// Tables of light project and portfolio management (docs/modules/project_FA.md, catalogue docs/catalog/g3_change.md
// «Module: project»): portfolios, demands and ideas with their scoring (WSJF, RICE, weighted), projects with a charter,
// stage gates through the approvals service, a WBS of phases, tasks and milestones with finish-to-start dependencies
// (critical path computed by @shared/project/logic), baselines, the RAID log, status reports, resource allocations and
// time entries; and the module's settings row. Everything is in the access area `project`.
//
// Access: a project belongs to its manager and sponsor (own), its team reads it (`team`: readers), its group works it.
// Rows hanging off a project copy its manager and group (system fields) and the participant source «project_team»
// lets the team read the project's plan (src/server/modules/project/access.ts). Behaviour: src/server/modules/project;
// screens: src/ui/modules/project. Imported by the UI: keep it free of server imports.
import type { FieldDef, Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES, PRIORITIES } from "../model/task";
import { registerLinkKind } from "../model/links";

export const DEMAND_TYPES: Option[] = [
  { value: "project", label: "پروژه", color: "blue", order: 1 },
  { value: "enhancement", label: "بهبود", color: "teal", order: 2 },
  { value: "change", label: "تغییر", color: "purple", order: 3 },
  { value: "new_service", label: "خدمت تازه", color: "indigo", order: 4 },
  { value: "idea", label: "ایده", color: "gold", order: 5 },
];

export const SCORING_MODELS: Option[] = [
  { value: "wsjf", label: "WSJF (هزینهٔ تأخیر ÷ اندازه)" },
  { value: "rice", label: "RICE (دسترس × اثر × اطمینان ÷ تلاش)" },
  { value: "weighted", label: "امتیاز وزنی" },
];

export const RICE_IMPACTS: Option[] = [
  { value: "0.25", label: "بسیار کم (۰٫۲۵)", order: 1 },
  { value: "0.5", label: "کم (۰٫۵)", order: 2 },
  { value: "1", label: "متوسط (۱)", order: 3 },
  { value: "2", label: "زیاد (۲)", order: 4 },
  { value: "3", label: "بسیار زیاد (۳)", order: 5 },
];

export const PROJECT_TYPES: Option[] = [
  { value: "infrastructure", label: "زیرساخت", color: "teal", order: 1 },
  { value: "application", label: "نرم‌افزار", color: "blue", order: 2 },
  { value: "improvement", label: "بهبود خدمت", color: "green", order: 3 },
  { value: "compliance", label: "انطباق و امنیت", color: "red", order: 4 },
  { value: "other", label: "دیگر", color: "gray", order: 5 },
];

export const METHODOLOGIES: Option[] = [
  { value: "predictive", label: "پیش‌بین (آبشاری)" },
  { value: "agile", label: "چابک" },
  { value: "hybrid", label: "ترکیبی" },
];

export const RAG: Option[] = [
  { value: "green", label: "سبز — بر روال", color: "green", order: 1 },
  { value: "amber", label: "زرد — در خطر", color: "gold", order: 2 },
  { value: "red", label: "قرمز — خارج از روال", color: "red", order: 3 },
];

export const HEALTH: Option[] = [...RAG, { value: "unknown", label: "نامعلوم", color: "gray", order: 4 }];

export const SCHEDULE_STATUSES: Option[] = [
  { value: "not_started", label: "شروع نشده", color: "gray", order: 1 },
  { value: "on_track", label: "طبق برنامه", color: "green", order: 2 },
  { value: "ahead", label: "جلوتر از برنامه", color: "teal", order: 3 },
  { value: "delayed", label: "عقب‌تر از برنامه", color: "red", order: 4 },
];

export const TASK_KINDS: Option[] = [
  { value: "phase", label: "فاز", color: "indigo", order: 1 },
  { value: "task", label: "کار", color: "blue", order: 2 },
  { value: "milestone", label: "نقطهٔ عطف", color: "magenta", order: 3 },
];

export const RAID_KINDS: Option[] = [
  { value: "risk", label: "ریسک", color: "red", order: 1 },
  { value: "assumption", label: "فرض", color: "gray", order: 2 },
  { value: "issue", label: "مسئله", color: "orange", order: 3 },
  { value: "decision", label: "تصمیم", color: "blue", order: 4 },
  { value: "action", label: "اقدام", color: "teal", order: 5 },
  { value: "dependency", label: "وابستگی", color: "purple", order: 6 },
];

export const ALLOCATION_STATES: Option[] = [
  { value: "planned", label: "برنامه‌ریزی‌شده", color: "gray", order: 1 },
  { value: "requested", label: "درخواست‌شده", color: "gold", order: 2 },
  { value: "confirmed", label: "قطعی", color: "green", order: 3 },
];

export const PROJECT_CHOICE_LISTS: Record<string, Option[]> = {
  "demand.type": DEMAND_TYPES,
  "project.type": PROJECT_TYPES,
};

// links of projects with the records around them
registerLinkKind("originated_from", { out: "برخاسته از", in: "پروژهٔ برخاسته" });
registerLinkKind("converted_from", { out: "تبدیل‌شده از", in: "تبدیل‌شده به" });

export const PROJECT_CONFIG_DEFAULTS = {
  scoring_model: "wsjf",
  weekly_capacity_hours: "44",
  status_report_days: 14,
  amber_variance_days: 5,
  red_variance_days: 15,
  red_risk_score: 15,
};
export type ProjectConfig = typeof PROJECT_CONFIG_DEFAULTS;

// ---------------------------------------------------------------------------------------------------------------
// Portfolios and demands

const portfolio: TableDef = {
  key: "portfolio",
  table: "sm_portfolios",
  label: "سبد پروژه",
  plural: "سبدهای پروژه",
  icon: "briefcase",
  module: "project",
  area: "project",
  description: "سبد یا برنامهٔ پروژه‌ها با مالک، مدیر، بودجه و هدف‌های راهبردی",
  numbered: { prefix: "PFL", pad: 4 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 16 },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, span: 8 },
    { name: "parent_id", label: "سبد والد", type: "ref", ref: "$self", filter: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", list: true, span: 8 },
    { name: "manager_id", label: "مدیر سبد", type: "user", list: true, span: 8 },
    { name: "budget", label: "بودجه (ریال)", type: "money", min: 0, group: "financial", span: 8 },
    { name: "goals", label: "هدف‌های راهبردی", type: "markdown", span: 24 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
  ],
  scope: { public: true, own: ["owner_id", "manager_id"], requester: [] },
  list: { columns: ["number", "name", "owner_id", "manager_id", "active"], order: "name" },
};

export const DEMAND_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "submitted", label: "ثبت‌شده", category: "waiting", color: "blue" },
    { value: "screening", label: "در ارزیابی", category: "waiting", color: "indigo" },
    { value: "qualified", label: "واجد شرایط", category: "active", color: "teal" },
    { value: "approved", label: "تصویب‌شده", category: "resolved", color: "green" },
    { value: "converted", label: "تبدیل یا انجام‌شده", category: "closed", color: "purple" },
    { value: "deferred", label: "به تعویق", category: "waiting", color: "gold" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
  ],
  transitions: [
    { from: ["draft"], to: "submitted", label: "ارسال" },
    { from: ["submitted", "deferred"], to: "screening", label: "شروع ارزیابی" },
    { from: ["screening"], to: "qualified", label: "واجد شرایط است" },
    { from: ["qualified"], to: "approved", label: "تصویب", roles: { area: "project", level: "full" } },
    { from: ["approved"], to: "converted", label: "انجام‌شده (بی‌پروژه)", requires: ["decision_notes"] },
    { from: ["submitted", "screening", "qualified"], to: "deferred", label: "به تعویق" },
    { from: ["submitted", "screening", "qualified", "deferred", "approved"], to: "rejected", label: "رد", requires: ["decision_notes"] },
    { from: ["screening", "qualified"], to: "submitted", label: "بازگشت" },
  ],
};

const demand: TableDef = {
  key: "demand",
  table: "sm_demands",
  label: "تقاضا",
  plural: "تقاضاها",
  icon: "lightbulb",
  module: "project",
  area: "project",
  description: "تقاضا یا ایدهٔ تازه: مسئله، هدف، برآورد هزینه و تلاش، امتیازدهی (WSJF، RICE یا وزنی) و تبدیل به پروژه",
  numbered: { prefix: "DMD", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24, section: "اصلی" },
    { name: "type", label: "نوع", type: "choice", choices: "demand.type", default: "project", list: true, filter: true, span: 8, section: "اصلی" },
    { name: "submitted_by", label: "پیشنهاددهنده", type: "user", default: "$me", list: true, filter: true, span: 8, section: "اصلی" },
    { name: "business_owner_id", label: "مالک کسب‌وکاری", type: "user", filter: true, span: 8, section: "اصلی" },
    { name: "sponsor_id", label: "حامی", type: "user", filter: true, span: 8, section: "اصلی" },
    { name: "portfolio_id", label: "سبد", type: "ref", ref: "portfolio", filter: true, span: 8, section: "اصلی" },
    { name: "org_unit_id", label: "واحد متقاضی", type: "ref", ref: "org_unit", filter: true, span: 8, section: "اصلی" },
    { name: "problem", label: "مسئله یا فرصت", type: "markdown", search: true, span: 24, section: "اصلی" },
    { name: "objectives", label: "هدف‌ها و نتیجهٔ مورد انتظار", type: "markdown", span: 24, section: "اصلی" },
    { name: "benefits", label: "منافع", type: "markdown", span: 24, section: "اصلی" },
    { name: "risk", label: "ریسک", type: "choice", choices: [{ value: "low", label: "کم", color: "green" }, { value: "medium", label: "متوسط", color: "gold" }, { value: "high", label: "زیاد", color: "red" }], filter: true, span: 8, section: "برآورد" },
    { name: "est_hours", label: "برآورد تلاش (نفر-ساعت)", type: "decimal", min: 0, span: 8, section: "برآورد" },
    { name: "est_capex", label: "هزینهٔ سرمایه‌ای (ریال)", type: "money", min: 0, group: "financial", span: 8, section: "برآورد" },
    { name: "est_opex", label: "هزینهٔ جاری سالانه (ریال)", type: "money", min: 0, group: "financial", span: 8, section: "برآورد" },
    { name: "needed_by", label: "زمان نیاز", type: "date", sort: true, span: 8, section: "برآورد" },

    { name: "scoring_model", label: "مدل امتیازدهی", type: "choice", choices: SCORING_MODELS, default: "wsjf", span: 12, section: "امتیاز" },
    { name: "business_value", label: "ارزش کسب‌وکاری (۱ تا ۱۰)", type: "int", min: 1, max: 10, span: 6, section: "امتیاز" },
    { name: "time_criticality", label: "حساسیت زمانی (۱ تا ۱۰)", type: "int", min: 1, max: 10, span: 6, section: "امتیاز" },
    { name: "risk_reduction", label: "کاهش ریسک یا فرصت (۱ تا ۱۰)", type: "int", min: 1, max: 10, span: 6, section: "امتیاز" },
    { name: "job_size", label: "اندازهٔ کار (۱ تا ۱۰)", type: "int", min: 1, max: 10, span: 6, section: "امتیاز" },
    { name: "alignment", label: "هم‌راستایی راهبردی (۱ تا ۱۰)", type: "int", min: 1, max: 10, span: 6, section: "امتیاز" },
    { name: "reach", label: "دسترس (افراد در هر دوره)", type: "int", min: 0, span: 6, section: "امتیاز" },
    { name: "impact_level", label: "اثر بر هر نفر", type: "choice", choices: RICE_IMPACTS, span: 6, section: "امتیاز" },
    { name: "confidence", label: "اطمینان (درصد)", type: "percent", min: 0, max: 100, span: 6, section: "امتیاز" },
    { name: "effort_months", label: "تلاش (نفر-ماه)", type: "decimal", min: 0, span: 6, section: "امتیاز" },
    { name: "score", label: "امتیاز", type: "decimal", readonly: true, list: true, sort: true, filter: true, span: 6, section: "امتیاز" },
    { name: "score_wsjf", label: "WSJF", type: "decimal", readonly: true, span: 6, section: "امتیاز" },
    { name: "score_rice", label: "RICE", type: "decimal", readonly: true, span: 6, section: "امتیاز" },
    { name: "score_weighted", label: "امتیاز وزنی", type: "decimal", readonly: true, span: 6, section: "امتیاز" },

    { name: "decision_notes", label: "یادداشت تصمیم", type: "text", span: 24, section: "تصمیم" },
    { name: "converted_project_id", label: "پروژهٔ ساخته‌شده", type: "ref", ref: "project", readonly: true, filter: true, span: 12, section: "تصمیم" },
  ],
  states: DEMAND_STATES,
  scope: {
    own: ["submitted_by", "business_owner_id", "sponsor_id"],
    requester: ["submitted_by"],
    watchers: "watch_list",
    requesterWritable: ["problem", "objectives", "benefits", "needed_by", "watch_list"],
    requesterTransitions: [{ from: ["draft"], to: "submitted" }],
  },
  features: { journal: true, attachments: true, watchers: true, links: true, kanban: "state" },
  form: { sections: ["اصلی", "برآورد", "امتیاز", "تصمیم"] },
  list: { columns: ["number", "title", "type", "state", "score", "submitted_by", "needed_by"], order: "-score" },
};

// ---------------------------------------------------------------------------------------------------------------
// Projects

export const PROJECT_STATES: StateModel = {
  field: "state",
  initial: "proposed",
  states: [
    { value: "proposed", label: "پیشنهادی", category: "new", color: "gray" },
    { value: "gate", label: "در انتظار تصویب", category: "waiting", color: "gold" },
    { value: "approved", label: "تصویب‌شده", category: "waiting", color: "blue" },
    { value: "planning", label: "برنامه‌ریزی", category: "active", color: "indigo" },
    { value: "executing", label: "اجرا", category: "active", color: "teal" },
    { value: "closing", label: "در حال بستن", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "on_hold", label: "متوقف", category: "waiting", color: "orange" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["proposed"], to: "gate", label: "ارسال برای تصویب", guard: "project_gate" },
    { from: ["gate"], to: "proposed", label: "بازگشت به پیشنهاد" },
    { from: ["gate", "proposed"], to: "approved", label: "تصویب (بی‌گردش تأیید)", roles: { area: "project", level: "full" } },
    { from: ["approved"], to: "planning", label: "شروع برنامه‌ریزی" },
    { from: ["planning"], to: "executing", label: "شروع اجرا", guard: "project_gate" },
    { from: ["executing"], to: "closing", label: "شروع بستن", guard: "project_gate" },
    { from: ["closing"], to: "executing", label: "بازگشت به اجرا" },
    { from: ["closing"], to: "closed", label: "بستن پروژه", guard: "project_gate" },
    { from: ["planning", "executing"], to: "on_hold", label: "توقف" },
    { from: ["on_hold"], to: "planning", label: "ادامه: برنامه‌ریزی" },
    { from: ["on_hold"], to: "executing", label: "ادامه: اجرا" },
    { from: ["proposed", "gate", "approved", "planning", "executing", "on_hold"], to: "canceled", label: "لغو", requires: ["closure_notes"] },
  ],
};
/** States of a project whose plan is live (health, overdue work). */
export const PROJECT_RUNNING = ["planning", "executing", "closing"];

const P_MAIN = "اصلی";
const P_PLAN = "زمان و هزینه";
const P_CHARTER = "منشور";
const P_STATUS = "وضعیت";
const P_CLOSE = "بستن";

const project: TableDef = {
  key: "project",
  table: "sm_projects",
  label: "پروژه",
  plural: "پروژه‌ها",
  icon: "folder-kanban",
  module: "project",
  area: "project",
  description: "پروژه با منشور، حامی و مدیر، دروازه‌های تصویب، برنامهٔ کار با مسیر بحرانی، سلامت محاسبه‌شده و گزارش وضعیت",
  numbered: { prefix: "PRJ", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "نام پروژه", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16, section: P_MAIN },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, search: true, span: 8, section: P_MAIN },
    { name: "type", label: "نوع", type: "choice", choices: "project.type", default: "application", list: true, filter: true, span: 8, section: P_MAIN },
    { name: "methodology", label: "روش", type: "choice", choices: METHODOLOGIES, default: "predictive", span: 8, section: P_MAIN },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, default: "3", list: true, filter: true, sort: true, span: 8, section: P_MAIN },
    { name: "project_manager_id", label: "مدیر پروژه", type: "user", default: "$me", list: true, filter: true, index: true, span: 8, section: P_MAIN },
    { name: "sponsor_id", label: "حامی", type: "user", filter: true, index: true, span: 8, section: P_MAIN },
    { name: "portfolio_id", label: "سبد", type: "ref", ref: "portfolio", list: true, filter: true, index: true, span: 8, section: P_MAIN },
    { name: "assignment_group_id", label: "گروه پروژه", type: "group", filter: true, index: true, span: 8, section: P_MAIN },
    { name: "team", label: "اعضای تیم", type: "users", span: 16, section: P_MAIN, help: "اعضای تیم برنامه و کارهای پروژه را می‌بینند" },
    { name: "org_unit_id", label: "واحد حامی", type: "ref", ref: "org_unit", filter: true, span: 8, section: P_MAIN },
    { name: "demand_id", label: "تقاضا", type: "ref", ref: "demand", readonly: true, filter: true, span: 8, section: P_MAIN },
    { name: "description", label: "شرح", type: "markdown", search: true, span: 24, section: P_MAIN },

    { name: "planned_start", label: "شروع برنامه", type: "date", list: true, sort: true, filter: true, span: 8, section: P_PLAN },
    { name: "planned_end", label: "پایان برنامه", type: "date", list: true, sort: true, filter: true, span: 8, section: P_PLAN },
    { name: "projected_end", label: "پایان پیش‌بینی‌شده", type: "date", readonly: true, sort: true, span: 8, section: P_PLAN },
    { name: "actual_start", label: "شروع واقعی", type: "date", readonly: true, span: 8, section: P_PLAN },
    { name: "actual_end", label: "پایان واقعی", type: "date", readonly: true, span: 8, section: P_PLAN },
    { name: "baseline_end", label: "پایان در خط مبنا", type: "date", readonly: true, span: 8, section: P_PLAN },
    { name: "baseline_start", label: "شروع در خط مبنا", type: "date", readonly: true, hidden: true },
    { name: "baseline_taken_at", label: "زمان ثبت خط مبنا", type: "datetime", readonly: true, span: 8, section: P_PLAN },
    { name: "est_hours", label: "برآورد تلاش (ساعت)", type: "decimal", min: 0, span: 8, section: P_PLAN },
    { name: "actual_hours", label: "تلاش ثبت‌شده (ساعت)", type: "decimal", readonly: true, span: 8, section: P_PLAN },
    { name: "budget", label: "بودجه (ریال)", type: "money", min: 0, group: "financial", span: 8, section: P_PLAN },
    { name: "actual_cost", label: "هزینهٔ واقعی (ریال)", type: "money", min: 0, group: "financial", span: 8, section: P_PLAN },

    { name: "objectives", label: "هدف‌ها و معیار موفقیت", type: "markdown", span: 24, tab: P_CHARTER, ai: { index: true } },
    { name: "scope_in", label: "دامنه", type: "markdown", span: 24, tab: P_CHARTER },
    { name: "scope_out", label: "بیرون از دامنه", type: "markdown", span: 24, tab: P_CHARTER },
    { name: "assumptions", label: "فرض‌ها و محدودیت‌ها", type: "markdown", span: 24, tab: P_CHARTER },

    { name: "health", label: "سلامت", type: "choice", choices: HEALTH, readonly: true, default: "unknown", list: true, filter: true, sort: true, span: 8, tab: P_STATUS },
    { name: "health_override", label: "سلامت تعیین‌شده توسط مدیر", type: "choice", choices: RAG, span: 8, tab: P_STATUS, help: "خالی: سلامت محاسبه‌شده" },
    { name: "health_reasons", label: "دلیل‌های سلامت", type: "json", system: true, audit: false, default: [], span: 24, tab: P_STATUS },
    { name: "schedule_status", label: "زمان‌بندی", type: "choice", choices: SCHEDULE_STATUSES, readonly: true, default: "not_started", filter: true, span: 8, tab: P_STATUS },
    { name: "schedule_variance_days", label: "انحراف زمان (روز)", type: "int", readonly: true, sort: true, span: 8, tab: P_STATUS },
    { name: "pct_complete", label: "پیشرفت", type: "percent", readonly: true, list: true, sort: true, span: 8, tab: P_STATUS },
    { name: "tasks_total", label: "کارها", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: P_STATUS },
    { name: "tasks_done", label: "کارهای انجام‌شده", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: P_STATUS },
    { name: "tasks_overdue", label: "کارهای دیرکرد", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: P_STATUS },
    { name: "milestones_overdue", label: "نقطه‌های عطف دیرکرد", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: P_STATUS },
    { name: "open_risks", label: "ریسک‌های بالای آستانه", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: P_STATUS },
    { name: "last_status_at", label: "آخرین گزارش وضعیت", type: "datetime", readonly: true, span: 8, tab: P_STATUS },
    { name: "health_at", label: "زمان محاسبهٔ سلامت", type: "datetime", readonly: true, audit: false, span: 8, tab: P_STATUS },
    { name: "approval", label: "تصویب", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8, tab: P_STATUS },

    { name: "lessons", label: "درس‌آموخته‌ها", type: "markdown", span: 24, tab: P_CLOSE, ai: { index: true } },
    { name: "closure_notes", label: "یادداشت بستن", type: "text", span: 24, tab: P_CLOSE },
  ],
  states: PROJECT_STATES,
  scope: { own: ["project_manager_id", "sponsor_id"], readers: ["team"], requester: [], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, approvals: true, rag: true, kanban: "state", calendar: { start: "planned_start", end: "planned_end" } },
  // the charter, business case and minutes attached to a project are part of its AI document (read only by its readers)
  ai: { title: "name", text: ["description", "objectives", "scope_in", "lessons"], attachments: true },
  form: {
    sections: [P_MAIN, P_PLAN],
    tabs: ["جزئیات", P_CHARTER, P_STATUS, P_CLOSE],
    related: [
      { table: "project_task", field: "project_id", label: "کارها و نقطه‌های عطف", columns: ["number", "wbs", "short_description", "kind", "state", "assigned_to", "planned_start", "planned_end", "pct_complete"] },
      { table: "raid_item", field: "project_id", label: "ریسک‌ها، مسئله‌ها و تصمیم‌ها", columns: ["number", "kind", "title", "score", "state", "owner_id", "due_date"] },
      { table: "status_report", field: "project_id", label: "گزارش‌های وضعیت", columns: ["title", "overall", "state", "published_at"] },
      { table: "resource_allocation", field: "project_id", label: "تخصیص منابع", columns: ["user_id", "role", "start_date", "end_date", "hours_per_week", "state"] },
      { table: "release", field: "project_id", label: "انتشارها", columns: ["number", "short_description", "version_name", "state", "planned_end"] },
    ],
  },
  list: { columns: ["number", "name", "state", "health", "pct_complete", "project_manager_id", "planned_end", "portfolio_id"], order: "-updated_at" },
};

export const PROJECT_TASK_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "blocked", label: "متوقف", category: "waiting", color: "gold" },
    { value: "done", label: "انجام شد", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open", "blocked"], to: "in_progress", label: "شروع" },
    { from: ["open", "in_progress"], to: "blocked", label: "مانع دارد" },
    { from: ["open", "in_progress", "blocked"], to: "done", label: "انجام شد" },
    { from: ["done"], to: "in_progress", label: "بازگشایی" },
    { from: ["open", "in_progress", "blocked"], to: "canceled", label: "لغو" },
  ],
};
export const PROJECT_TASK_DONE = ["done", "canceled"];

/** Scope columns a row hanging off a project copies from it. */
const PROJECT_COPY: FieldDef[] = [
  { name: "project_manager_id", label: "مدیر پروژه", type: "user", system: true, hidden: true },
  { name: "assignment_group_id", label: "گروه پروژه", type: "group", system: true, hidden: true },
];

const projectTask: TableDef = {
  key: "project_task",
  table: "sm_project_tasks",
  label: "کار پروژه",
  plural: "کارهای پروژه",
  icon: "list-tree",
  module: "project",
  area: "project",
  description: "فاز، کار یا نقطهٔ عطف پروژه با مدت، وابستگی پایان‌به‌شروع، خط مبنا، پیشرفت و جایگاه در مسیر بحرانی",
  numbered: { prefix: "PTASK", pad: 7 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 24 },
    { name: "project_id", label: "پروژه", type: "ref", ref: "project", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "parent_id", label: "فاز یا کار والد", type: "ref", ref: "$self", filter: true, index: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: TASK_KINDS, default: "task", list: true, filter: true, span: 8 },
    { name: "wbs", label: "شمارهٔ ساختار کار", type: "string", maxLength: 40, readonly: true, ltr: true, list: true, sort: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, span: 8 },
    { name: "assigned_to", label: "مسئول", type: "user", list: true, filter: true, index: true, span: 12 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 12 },
    { name: "planned_start", label: "شروع", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "planned_end", label: "پایان", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "duration_days", label: "مدت (روز کاری)", type: "int", min: 0, max: 2000, span: 8 },
    { name: "depends_on", label: "پس از پایانِ", type: "refs", ref: "$self", span: 16 },
    { name: "lag_days", label: "فاصله پس از پیش‌نیاز (روز)", type: "int", min: -365, max: 365, default: 0, span: 8 },
    { name: "start_no_earlier", label: "زودتر از این شروع نشود", type: "date", span: 8 },
    { name: "est_hours", label: "برآورد (ساعت)", type: "decimal", min: 0, span: 8 },
    { name: "actual_hours", label: "ثبت‌شده (ساعت)", type: "decimal", readonly: true, span: 8 },
    { name: "pct_complete", label: "پیشرفت", type: "percent", min: 0, max: 100, list: true, span: 8 },
    { name: "baseline_start", label: "شروع در خط مبنا", type: "date", readonly: true, span: 8 },
    { name: "baseline_end", label: "پایان در خط مبنا", type: "date", readonly: true, span: 8 },
    { name: "is_critical", label: "در مسیر بحرانی", type: "bool", readonly: true, default: false, filter: true, span: 8 },
    { name: "float_days", label: "شناوری (روز کاری)", type: "int", readonly: true, span: 8 },
    { name: "actual_start", label: "شروع واقعی", type: "date", readonly: true, span: 8 },
    { name: "actual_end", label: "پایان واقعی", type: "date", readonly: true, span: 8 },
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", filter: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    PROJECT_COPY[0],
  ],
  states: PROJECT_TASK_STATES,
  scope: { own: ["assigned_to", "project_manager_id"], requester: [], group: "assignment_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, kanban: "state" },
  list: { columns: ["number", "wbs", "short_description", "project_id", "state", "assigned_to", "planned_end", "pct_complete"], order: "wbs" },
};

const raidItem: TableDef = {
  key: "raid_item",
  table: "sm_raid_items",
  label: "مورد RAID",
  plural: "ریسک‌ها، مسئله‌ها و تصمیم‌ها",
  icon: "shield-alert",
  module: "project",
  area: "project",
  description: "دفتر RAID پروژه: ریسک (احتمال × اثر)، فرض، مسئله، تصمیم، اقدام و وابستگی با مالک و موعد",
  numbered: { prefix: "RAID", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "kind", label: "گونه", type: "choice", choices: RAID_KINDS, required: true, default: "risk", list: true, filter: true, span: 8 },
    { name: "project_id", label: "پروژه", type: "ref", ref: "project", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, span: 12 },
    { name: "probability", label: "احتمال (۱ تا ۵)", type: "int", min: 1, max: 5, span: 6 },
    { name: "impact", label: "اثر (۱ تا ۵)", type: "int", min: 1, max: 5, span: 6 },
    { name: "score", label: "امتیاز", type: "int", readonly: true, list: true, sort: true, filter: true, span: 6 },
    { name: "due_date", label: "موعد", type: "date", list: true, sort: true, span: 6 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "response", label: "پاسخ یا تصمیم", type: "markdown", span: 24 },
    { name: "ai_draft", label: "پیش‌نویس هوش مصنوعی", type: "bool", readonly: true, default: false, span: 8 },
    ...PROJECT_COPY,
  ],
  states: {
    field: "state",
    initial: "open",
    states: [
      { value: "open", label: "باز", category: "new", color: "blue" },
      { value: "active", label: "در جریان", category: "active", color: "orange" },
      { value: "monitoring", label: "زیر نظر", category: "waiting", color: "gold" },
      { value: "closed", label: "بسته", category: "closed", color: "gray" },
      { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["open", "monitoring"], to: "active", label: "اقدام" },
      { from: ["open", "active"], to: "monitoring", label: "زیر نظر" },
      { from: ["open", "active", "monitoring"], to: "closed", label: "بستن" },
      { from: ["open"], to: "rejected", label: "رد" },
      { from: ["closed"], to: "open", label: "بازگشایی" },
    ],
  },
  scope: { own: ["owner_id", "project_manager_id"], requester: [], group: "assignment_group_id" },
  features: { journal: true, links: true },
  list: { columns: ["number", "kind", "title", "project_id", "score", "state", "owner_id", "due_date"], order: "-score" },
};

const statusReport: TableDef = {
  key: "status_report",
  table: "sm_status_reports",
  label: "گزارش وضعیت",
  plural: "گزارش‌های وضعیت",
  icon: "file-chart-column",
  module: "project",
  area: "project",
  description: "گزارش دوره‌ای پروژه با رنگ هر بعد، روایت، دستاوردها و گام‌های بعد، و تصویر ثابت شاخص‌ها هنگام انتشار",
  numbered: { prefix: "PSR", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "project_id", label: "پروژه", type: "ref", ref: "project", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "period_start", label: "از", type: "date", span: 8 },
    { name: "period_end", label: "تا", type: "date", list: true, sort: true, span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: [{ value: "draft", label: "پیش‌نویس", color: "gray" }, { value: "published", label: "منتشرشده", color: "green" }], default: "draft", list: true, filter: true, span: 8 },
    { name: "overall", label: "وضعیت کلی", type: "choice", choices: RAG, list: true, filter: true, span: 6 },
    { name: "schedule_rag", label: "زمان", type: "choice", choices: RAG, span: 6 },
    { name: "cost_rag", label: "هزینه", type: "choice", choices: RAG, span: 6 },
    { name: "scope_rag", label: "دامنه", type: "choice", choices: RAG, span: 6 },
    { name: "summary", label: "خلاصه", type: "markdown", span: 24 },
    { name: "achievements", label: "دستاوردهای این دوره", type: "markdown", span: 24 },
    { name: "next_steps", label: "گام‌های دورهٔ بعد", type: "markdown", span: 24 },
    { name: "risks_issues", label: "ریسک‌ها، مسئله‌ها و تصمیم‌های لازم", type: "markdown", span: 24 },
    { name: "metrics", label: "شاخص‌ها", type: "json", readonly: true, default: {}, span: 24 },
    { name: "ai_generated", label: "پیش‌نویس هوش مصنوعی", type: "bool", readonly: true, default: false, span: 8 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "published_by", label: "منتشرکننده", type: "user", readonly: true, span: 8 },
    { name: "audience", label: "گیرندگان", type: "users", system: true, hidden: true },
    ...PROJECT_COPY,
  ],
  scope: { own: ["project_manager_id"], requester: [], group: "assignment_group_id" },
  features: { journal: true, attachments: true },
  list: { columns: ["title", "project_id", "overall", "state", "published_at"], order: "-period_end" },
};

const allocation: TableDef = {
  key: "resource_allocation",
  table: "sm_resource_allocations",
  label: "تخصیص منبع",
  plural: "تخصیص‌های منابع",
  icon: "users-round",
  module: "project",
  area: "project",
  description: "ساعت‌های هفتگی یک نفر برای یک پروژه در یک بازه؛ نقشهٔ بار منابع از جمع آن‌ها ساخته می‌شود",
  display: "role",
  fields: [
    { name: "user_id", label: "فرد", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "project_id", label: "پروژه", type: "ref", ref: "project", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "role", label: "نقش در پروژه", type: "string", required: true, maxLength: 120, default: "عضو تیم", list: true, span: 12 },
    { name: "state", label: "وضعیت", type: "choice", choices: ALLOCATION_STATES, default: "planned", list: true, filter: true, span: 12 },
    { name: "start_date", label: "از", type: "date", required: true, list: true, sort: true, span: 8 },
    { name: "end_date", label: "تا", type: "date", required: true, list: true, sort: true, span: 8 },
    { name: "hours_per_week", label: "ساعت در هفته", type: "decimal", required: true, min: 0, max: 80, list: true, span: 8 },
    { name: "notes", label: "توضیح", type: "text", span: 24 },
    ...PROJECT_COPY,
  ],
  scope: { own: ["user_id", "project_manager_id"], requester: [], group: "assignment_group_id" },
  list: { columns: ["user_id", "project_id", "role", "start_date", "end_date", "hours_per_week", "state"], order: "start_date" },
};

const timeEntry: TableDef = {
  key: "time_entry",
  table: "sm_time_entries",
  label: "ثبت زمان",
  plural: "ثبت‌های زمان",
  icon: "timer",
  module: "project",
  area: "project",
  description: "ساعت کار یک نفر روی یک کار پروژه در یک روز؛ ارسال و تأیید مدیر پروژه، جمع در کار و پروژه",
  display: "label",
  fields: [
    { name: "label", label: "عنوان", type: "string", maxLength: 300, system: true, list: true, search: true },
    { name: "user_id", label: "فرد", type: "user", required: true, default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "entry_date", label: "روز", type: "date", required: true, default: "$today", list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "hours", label: "ساعت", type: "decimal", required: true, min: 0, max: 24, list: true, span: 8 },
    { name: "task_id", label: "کار پروژه", type: "ref", ref: "project_task", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "project_id", label: "پروژه", type: "ref", ref: "project", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "billable", label: "قابل صورت‌حساب", type: "bool", default: false, span: 8 },
    { name: "note", label: "شرح کار", type: "text", span: 24 },
    { name: "reject_reason", label: "دلیل رد", type: "text", span: 24 },
    PROJECT_COPY[0],
  ],
  states: {
    field: "state",
    initial: "draft",
    states: [
      { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
      { value: "submitted", label: "ارسال‌شده", category: "waiting", color: "blue" },
      { value: "approved", label: "تأییدشده", category: "closed", color: "green" },
      { value: "rejected", label: "ردشده", category: "active", color: "red" },
    ],
    transitions: [
      { from: ["draft", "rejected"], to: "submitted", label: "ارسال" },
      { from: ["submitted"], to: "approved", label: "تأیید", roles: { area: "project", level: "full" }, guard: "time_entry_approver" },
      { from: ["submitted"], to: "rejected", label: "رد", requires: ["reject_reason"], roles: { area: "project", level: "full" }, guard: "time_entry_approver" },
      { from: ["submitted"], to: "draft", label: "بازگشت به پیش‌نویس" },
    ],
  },
  scope: { own: ["user_id", "project_manager_id"], requester: [] },
  list: { columns: ["entry_date", "user_id", "task_id", "hours", "state"], order: "-entry_date" },
};

const projectConfig: TableDef = {
  key: "project_config",
  table: "sm_project_configs",
  label: "تنظیمات پروژه‌ها",
  plural: "تنظیمات پروژه‌ها",
  icon: "settings-2",
  module: "project",
  area: "project",
  description: "تنظیمات مدیریت پروژه و سبد سازمان: مدل امتیازدهی، ظرفیت هفتگی و آستانه‌های سلامت",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", maxLength: 40, ltr: true, unique: true, hidden: true },
    { name: "scoring_model", label: "مدل امتیازدهی پیش‌فرض", type: "choice", choices: SCORING_MODELS, default: PROJECT_CONFIG_DEFAULTS.scoring_model, span: 12 },
    { name: "weekly_capacity_hours", label: "ظرفیت هفتگی هر نفر (ساعت)", type: "decimal", min: 1, max: 80, default: PROJECT_CONFIG_DEFAULTS.weekly_capacity_hours, span: 8 },
    { name: "status_report_days", label: "فاصلهٔ گزارش وضعیت (روز)", type: "int", min: 1, max: 90, default: PROJECT_CONFIG_DEFAULTS.status_report_days, span: 8 },
    { name: "amber_variance_days", label: "زرد از انحراف (روز)", type: "int", min: 0, max: 365, default: PROJECT_CONFIG_DEFAULTS.amber_variance_days, span: 8 },
    { name: "red_variance_days", label: "قرمز از انحراف (روز)", type: "int", min: 0, max: 365, default: PROJECT_CONFIG_DEFAULTS.red_variance_days, span: 8 },
    { name: "red_risk_score", label: "آستانهٔ ریسک مهم (احتمال × اثر)", type: "int", min: 1, max: 25, default: PROJECT_CONFIG_DEFAULTS.red_risk_score, span: 8 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "scoring_model", "weekly_capacity_hours"], order: "name" },
};

export const PROJECT_TABLES: TableDef[] = [portfolio, demand, project, projectTask, raidItem, statusReport, allocation, timeEntry, projectConfig];
