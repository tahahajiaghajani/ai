// Tables of change enablement (docs/modules/change_FA.md, catalogue docs/catalog/g3_change.md «Module: change»):
// the change request itself (one record type for every change model: standard, normal, emergency, retrospective),
// its tasks, the configurable change models, templates and the standard-change catalogue, maintenance / blackout /
// freeze windows, CABs with their meetings and agendas, detected conflicts, planned outages, post-implementation
// reviews, the risk questionnaire, lockdowns, the teams' change success scores and the module's settings row.
// Behaviour lives in src/server/modules/change (hooks, risk, conflicts, CAB, jobs, routes); pure logic shared with the
// screens in src/shared/change/logic.ts; the screens in src/ui/modules/change.
//
// One state model serves every change model: its states are the union (new → assess → authorize → scheduled →
// implement → review → closed, canceled) and a model picks the states it uses (`change_model.states`, snapshotted
// on the change as `model_states`); the server only allows forward moves to the next state the model uses.
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES, TASK_FIELDS, TASK_SCOPE } from "../model/task";
import { registerLinkKind } from "../model/links";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

/** Change types (tenant-editable list `change_request.type`; the logic knows the four built-in values). */
export const CHANGE_TYPES: Option[] = [
  { value: "standard", label: "استاندارد (از پیش مجاز)", color: "green", order: 1 },
  { value: "normal", label: "عادی", color: "blue", order: 2 },
  { value: "emergency", label: "اضطراری", color: "red", order: 3 },
  { value: "latent", label: "گذشته‌نگر (ثبت پس از اجرا)", color: "gray", order: 4 },
];

/** Risk levels (static: the approval rules, bands and reports depend on these values). */
export const RISK_LEVELS: Option[] = [
  { value: "low", label: "کم", color: "green", order: 1 },
  { value: "moderate", label: "متوسط", color: "gold", order: 2 },
  { value: "high", label: "زیاد", color: "orange", order: 3 },
  { value: "very_high", label: "بسیار زیاد", color: "red", order: 4 },
];
export type RiskLevel = "low" | "moderate" | "high" | "very_high";
export const RISK_ORDER: RiskLevel[] = ["low", "moderate", "high", "very_high"];

export const RISK_SOURCES: Option[] = [
  { value: "calculated", label: "محاسبه‌شده" },
  { value: "manual", label: "تعیین دستی" },
  { value: "template", label: "از الگوی استاندارد" },
];

/** Outcome of an implemented change (`close_code`). */
export const CHANGE_CLOSE_CODES: Option[] = [
  { value: "successful", label: "موفق", color: "green", order: 1 },
  { value: "successful_issues", label: "موفق با مشکل", color: "gold", order: 2 },
  { value: "unsuccessful", label: "ناموفق", color: "red", order: 3 },
  { value: "backed_out", label: "برگشت داده شد", color: "orange", order: 4 },
  { value: "canceled", label: "لغو شد", color: "gray", order: 5 },
  { value: "auto_canceled", label: "لغو خودکار", color: "gray", order: 6 },
];
/** Outcomes that count as a failed change (KPIs, success scores, PIR). */
export const FAILED_CODES = ["unsuccessful", "backed_out"];
/** Outcomes of an implemented change (not cancellations). */
export const IMPLEMENTED_CODES = ["successful", "successful_issues", "unsuccessful", "backed_out"];

/** Reasons a change is in its state (dependent on the state: `parent` = the state value). */
export const STATUS_REASONS: Option[] = [
  { value: "rejected", label: "ردشده؛ نیازمند بازنگری", parent: "new", color: "red" },
  { value: "insufficient_data", label: "اطلاعات ناکافی", parent: "new" },
  { value: "schedule_conflict", label: "تداخل زمانی", parent: "new" },
  { value: "peer_review", label: "بازبینی همتا", parent: "assess" },
  { value: "technical_review", label: "بازبینی فنی", parent: "assess" },
  { value: "awaiting_info", label: "منتظر اطلاعات تکمیلی", parent: "assess" },
  { value: "awaiting_cab", label: "منتظر جلسهٔ CAB", parent: "authorize" },
  { value: "awaiting_approvers", label: "منتظر تأییدکنندگان", parent: "authorize" },
  { value: "awaiting_window", label: "منتظر پنجرهٔ اجرا", parent: "scheduled" },
  { value: "awaiting_vendor", label: "منتظر تأمین‌کننده", parent: "scheduled" },
  { value: "in_rollout", label: "در حال استقرار", parent: "implement" },
  { value: "in_test", label: "در حال آزمون", parent: "implement" },
  { value: "in_rollback", label: "در حال بازگشت", parent: "implement", color: "orange" },
  { value: "in_verification", label: "در حال صحت‌سنجی", parent: "implement" },
  { value: "in_documentation", label: "در حال مستندسازی", parent: "implement" },
  { value: "not_required", label: "دیگر لازم نیست", parent: "canceled" },
  { value: "no_resources", label: "نبود منابع", parent: "canceled" },
  { value: "reschedule", label: "نیاز به زمان‌بندی دوباره", parent: "canceled" },
  { value: "no_funding", label: "نبود بودجه", parent: "canceled" },
];

export const HOLD_REASONS: Option[] = [
  { value: "vendor", label: "منتظر تأمین‌کننده یا خرید", order: 1 },
  { value: "manager", label: "منتظر تصمیم مدیر", order: 2 },
  { value: "coordination", label: "منتظر هماهنگی گروه‌ها", order: 3 },
  { value: "task_review", label: "بازبینی کارها", order: 4 },
  { value: "lockdown", label: "قرنطینهٔ تغییرات", color: "red", order: 5 },
  { value: "other", label: "سایر", order: 6 },
];

export const CONFLICT_STATUSES: Option[] = [
  { value: "not_checked", label: "بررسی نشده", color: "gray" },
  { value: "none", label: "بدون تداخل", color: "green" },
  { value: "conflict", label: "تداخل دارد", color: "red" },
  { value: "acknowledged", label: "تداخل بررسی‌شده", color: "gold" },
];

export const DISCOVERED_BY: Option[] = [
  { value: "manual", label: "اعلام کارشناس" },
  { value: "audit", label: "ممیزی" },
  { value: "drift", label: "تشخیص انحراف پیکربندی" },
  { value: "monitoring", label: "پایش" },
];

/** Default categories of changes (seeded as the `category` tree of the SLA service). */
export const CHANGE_CATEGORIES: { value: string; label: string; subs: [string, string][] }[] = [
  { value: "infrastructure", label: "زیرساخت", subs: [["infrastructure.server", "سرور و مجازی‌سازی"], ["infrastructure.storage", "ذخیره‌سازی و پشتیبان"], ["infrastructure.datacenter", "مرکز داده، برق و سرمایش"]] },
  { value: "network", label: "شبکه", subs: [["network.firewall", "دیوارهٔ آتش"], ["network.routing", "مسیریابی و سوئیچینگ"], ["network.dns", "DNS و نام‌گذاری"], ["network.vpn", "اتصال از راه دور"]] },
  { value: "application", label: "نرم‌افزار و سامانه‌ها", subs: [["application.release", "انتشار نسخه"], ["application.config", "پیکربندی سامانه"], ["application.integration", "یکپارچه‌سازی"]] },
  { value: "database", label: "پایگاه داده", subs: [["database.schema", "ساختار و داده"], ["database.upgrade", "ارتقا و وصله"]] },
  { value: "security", label: "امنیت", subs: [["security.patch", "وصلهٔ امنیتی"], ["security.access", "دسترسی و هویت"], ["security.certificate", "گواهی و کلید"]] },
  { value: "endpoint", label: "رایانه‌های کاربران", subs: [["endpoint.software", "نصب نرم‌افزار"], ["endpoint.os", "سیستم‌عامل"]] },
];
const categoryOptions = (): Option[] => CHANGE_CATEGORIES.map((c, i) => ({ value: c.value, label: c.label, order: i + 1 }));
const subcategoryOptions = (): Option[] =>
  CHANGE_CATEGORIES.flatMap((c) => c.subs.map(([value, label], i) => ({ value, label, parent: c.value, order: i + 1 })));

export const TASK_TYPES: Option[] = [
  { value: "planning", label: "برنامه‌ریزی", order: 1 },
  { value: "implementation", label: "اجرا", order: 2 },
  { value: "testing", label: "آزمون", order: 3 },
  { value: "validation", label: "صحت‌سنجی", order: 4 },
  { value: "communication", label: "اطلاع‌رسانی", order: 5 },
  { value: "backout", label: "بازگشت", order: 6 },
  { value: "review", label: "بازبینی", order: 7 },
  { value: "other", label: "سایر", order: 8 },
];

export const WINDOW_KINDS: Option[] = [
  { value: "maintenance", label: "پنجرهٔ نگهداری", color: "teal", order: 1 },
  { value: "blackout", label: "ممنوعیت تغییر", color: "red", order: 2 },
  { value: "freeze", label: "انجماد تغییرات", color: "indigo", order: 3 },
  { value: "information", label: "رویداد اطلاعاتی", color: "gray", order: 4 },
];
export const WINDOW_RECURRENCE: Option[] = [
  { value: "none", label: "یک‌باره" },
  { value: "daily", label: "هر روز" },
  { value: "weekly", label: "هر هفته (روزهای انتخابی)" },
  { value: "monthly", label: "هر ماه (همان روزِ ماه شمسی)" },
  { value: "monthly_last", label: "هر ماه (روزِ آخرِ ماه شمسی)" },
  { value: "yearly", label: "هر سال (همان روز و ماه شمسی)" },
];
export const WEEKDAY_OPTIONS: Option[] = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"].map((label, i) => ({ value: String(i), label, order: i + 1 }));
export const ENFORCEMENT: Option[] = [
  { value: "block", label: "جلوگیری" },
  { value: "warn", label: "فقط هشدار" },
];

export const CAB_KINDS: Option[] = [
  { value: "change", label: "هیئت مشاوران تغییر (CAB)" },
  { value: "emergency", label: "هیئت اضطراری (ECAB)" },
  { value: "security", label: "امنیت" },
  { value: "network", label: "شبکه" },
  { value: "business", label: "کسب‌وکار" },
];
export const AGENDA_KINDS: Option[] = [
  { value: "authorize", label: "تصمیم دربارهٔ اجرا" },
  { value: "implemented", label: "مرور تغییر اجراشده" },
  { value: "pir", label: "بازبینی پس از اجرا" },
];
export const AGENDA_DECISIONS: Option[] = [
  { value: "pending", label: "در انتظار بررسی", color: "gray" },
  { value: "voting", label: "در حال رأی‌گیری", color: "blue" },
  { value: "approved", label: "تأیید شد", color: "green" },
  { value: "rejected", label: "رد شد", color: "red" },
  { value: "deferred", label: "به جلسهٔ بعد", color: "gold" },
  { value: "info_requested", label: "اطلاعات بیشتر خواسته شد", color: "orange" },
  { value: "reviewed", label: "مرور شد", color: "teal" },
];

export const CONFLICT_KINDS: Option[] = [
  { value: "same_ci", label: "همان پیکربندی در همان زمان", color: "red", order: 1 },
  { value: "same_service", label: "همان خدمت در همان زمان", color: "orange", order: 2 },
  { value: "related_ci", label: "پیکربندی وابسته در همان زمان", color: "orange", order: 3 },
  { value: "assignee_busy", label: "مجری هم‌زمان درگیر تغییر دیگر", color: "gold", order: 4 },
  { value: "blackout", label: "در دورهٔ ممنوعیت تغییر", color: "red", order: 5 },
  { value: "freeze", label: "در دورهٔ انجماد تغییرات", color: "indigo", order: 6 },
  { value: "outside_window", label: "بیرون از پنجرهٔ نگهداری", color: "gold", order: 7 },
  { value: "lockdown", label: "در قرنطینهٔ تغییرات", color: "red", order: 8 },
  { value: "outage", label: "هم‌زمان با قطعی برنامه‌ریزی‌شده", color: "orange", order: 9 },
];
export const CONFLICT_REVIEW: Option[] = [
  { value: "detected", label: "شناسایی‌شده", color: "red" },
  { value: "investigating", label: "در حال بررسی", color: "gold" },
  { value: "ignored", label: "نادیده گرفته شد", color: "gray" },
  { value: "resolved", label: "برطرف شد", color: "green" },
];

export const PIR_REASONS: Option[] = [
  { value: "emergency", label: "تغییر اضطراری" },
  { value: "failed", label: "اجرای ناموفق یا برگشت" },
  { value: "high_risk", label: "ریسک زیاد" },
  { value: "policy", label: "سیاست مدل تغییر" },
  { value: "manual", label: "به تشخیص مسئول" },
];
export const OBJECTIVES_MET: Option[] = [
  { value: "yes", label: "بله، کامل", color: "green" },
  { value: "partial", label: "تا حدی", color: "gold" },
  { value: "no", label: "خیر", color: "red" },
];
export const OUTAGE_TYPES: Option[] = [
  { value: "outage", label: "قطعی کامل", color: "red" },
  { value: "degradation", label: "افت کیفیت", color: "orange" },
];
export const QUESTION_KINDS: Option[] = [
  { value: "choice", label: "چندگزینه‌ای" },
  { value: "yes_no", label: "بله / خیر" },
  { value: "number", label: "عدد" },
];
export const PIR_POLICIES: Option[] = [
  { value: "settings", label: "طبق تنظیمات ماژول" },
  { value: "always", label: "همیشه" },
  { value: "never", label: "هرگز" },
];
export const CAB_POLICIES: Option[] = [
  { value: "risk", label: "بر اساس ریسک (تنظیمات)" },
  { value: "always", label: "همیشه" },
  { value: "never", label: "هرگز" },
];
export const SCORE_BANDS: Option[] = [
  { value: "excellent", label: "عالی", color: "green" },
  { value: "good", label: "خوب", color: "teal" },
  { value: "fair", label: "قابل قبول", color: "gold" },
  { value: "poor", label: "ضعیف", color: "red" },
];
export const TEMPLATE_KINDS: Option[] = [
  { value: "standard", label: "تغییر استاندارد (از پیش مجاز)" },
  { value: "template", label: "الگوی ثبت تغییر" },
];

/** Default options of the module's choice lists (registered once in src/shared/tables/index.ts). */
export const CHANGE_CHOICE_LISTS: Record<string, Option[]> = {
  "change_request.type": CHANGE_TYPES,
  "change_request.close_code": CHANGE_CLOSE_CODES,
  "change_request.status_reason": STATUS_REASONS,
  "change_request.hold_reason": HOLD_REASONS,
  "change_request.category": categoryOptions(),
  "change_request.subcategory": subcategoryOptions(),
  "change_task.task_type": TASK_TYPES,
};

// links between a change and the records around it (shown on both records with their direction's label)
registerLinkKind("initiated_by", { out: "آغازشده از", in: "آغازگرِ تغییر" });

// ---------------------------------------------------------------------------------------------------------------
// The change request

export const CHANGE_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "assess", label: "ارزیابی", category: "active", color: "teal" },
    { value: "authorize", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "scheduled", label: "زمان‌بندی‌شده", category: "waiting", color: "indigo" },
    { value: "implement", label: "در حال اجرا", category: "active", color: "purple" },
    { value: "review", label: "بازبینی", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "assess", label: "ارسال برای ارزیابی", guard: "change_lifecycle" },
    { from: ["new", "assess"], to: "authorize", label: "درخواست تأیید", guard: "change_lifecycle" },
    { from: ["new", "assess"], to: "scheduled", label: "زمان‌بندی", guard: "change_lifecycle" },
    { from: ["new"], to: "review", label: "ثبت به‌عنوان اجراشده", guard: "change_lifecycle" },
    // manual authorization: change managers only (the change area's approve right alone — team leads, service-desk
    // managers — is not enough); the guard keeps the change's own people from authorizing it
    { from: ["authorize"], to: "scheduled", label: "تأیید و زمان‌بندی", roles: { area: "change", level: "full", roles: ["change_manager", "tenant_admin"] }, guard: "change_lifecycle" },
    { from: ["authorize"], to: "implement", label: "تأیید و شروع اجرا", roles: { area: "change", level: "full", roles: ["change_manager", "tenant_admin"] }, guard: "change_lifecycle" },
    { from: ["scheduled"], to: "implement", label: "شروع اجرا", guard: "change_lifecycle" },
    { from: ["implement"], to: "review", label: "پایان اجرا", requires: ["close_code"], guard: "change_lifecycle" },
    { from: ["review"], to: "closed", label: "بستن", requires: ["close_code", "close_notes"], guard: "change_lifecycle" },
    { from: ["assess", "authorize", "scheduled"], to: "new", label: "بازگشت به پیش‌نویس", guard: "change_lifecycle" },
    { from: ["authorize", "scheduled"], to: "assess", label: "ارزیابی دوباره", guard: "change_lifecycle" },
    { from: ["scheduled"], to: "authorize", label: "تأیید دوباره", guard: "change_lifecycle" },
    { from: ["implement"], to: "scheduled", label: "توقف و زمان‌بندی دوباره", guard: "change_lifecycle" },
    { from: ["review"], to: "implement", label: "بازگشت به اجرا", guard: "change_lifecycle" },
    { from: ["new", "assess", "authorize", "scheduled", "implement"], to: "canceled", label: "لغو", requires: ["close_notes"], guard: "change_lifecycle" },
  ],
  locked: ["closed", "canceled"],
};
export type ChangeState = "new" | "assess" | "authorize" | "scheduled" | "implement" | "review" | "closed" | "canceled";
/** Every state in lifecycle order (the lifecycle bar, model editors). */
export const STATE_OPTIONS: Option[] = CHANGE_STATES.states.map((s, i) => ({ value: s.value, label: s.label, color: s.color, order: i + 1 }));

const MAIN = "اصلی";
const SERVICE = "خدمت و پیکربندی";
const SCHEDULE = "زمان‌بندی";
const PLANS = "برنامه‌ها";
const RISK = "ریسک و تأیید";
const CLOSURE = "نتیجه و بستن";

/** Task fields a change does not use as such: kept in the table, left out of its form. */
const HIDDEN_TASK = ["requested_for", "channel", "offering_id", "due_at", "escalation", "knowledge", "time_worked"];

const changeRequest: TableDef = {
  key: "change_request",
  table: "sm_change_requests",
  label: "تغییر",
  plural: "تغییرها",
  icon: "git-pull-request-arrow",
  module: "change",
  area: "change",
  description: "درخواست تغییر (RFC): از ثبت و ارزیابی ریسک تا تأیید، زمان‌بندی، اجرا و بازبینی پس از اجرا",
  extends: "task",
  numbered: { prefix: "CHG", pad: 7 },
  display: "short_description",
  fields: [
    ...TASK_FIELDS.filter((f) => HIDDEN_TASK.includes(f.name)).map((f) => ({ ...f, hidden: true })),
    { name: "short_description", label: "عنوان تغییر", type: "string", section: MAIN },
    { name: "type", label: "نوع تغییر", type: "choice", choices: "change_request.type", required: true, default: "normal", list: true, filter: true, sort: true, index: true, span: 8, section: MAIN },
    { name: "model_id", label: "مدل تغییر", type: "ref", ref: "change_model", refFilter: { f: "active", op: "eq", v: true }, filter: true, span: 8, section: MAIN },
    { name: "template_id", label: "الگو", type: "ref", ref: "change_template", filter: true, span: 8, section: MAIN, help: "مقدارهای الگو هنگام ثبت در فیلدهای خالی نوشته می‌شود" },
    { name: "description", label: "شرح تغییر", type: "markdown", section: MAIN },
    { name: "justification", label: "دلیل و توجیه کسب‌وکاری", type: "markdown", search: true, span: 24, section: MAIN, ai: { index: true } },
    { name: "expected_outcome", label: "نتیجه و منافع مورد انتظار", type: "markdown", span: 24, section: MAIN },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category", span: 8, section: MAIN },
    { name: "subcategory", label: "زیردسته", type: "choice", choices: "$table.subcategory", dependsOn: "category", span: 8, section: MAIN },
    { name: "status_reason", label: "دلیل وضعیت", type: "choice", choices: "change_request.status_reason", dependsOn: "state", filter: true, span: 8, section: MAIN },
    { name: "impact", label: "اثر", type: "choice", section: MAIN },
    { name: "urgency", label: "فوریت", type: "choice", section: MAIN },
    { name: "priority", label: "اولویت", type: "choice", section: MAIN, help: "از اثر و فوریت حساب می‌شود (ماتریس اولویت)" },
    { name: "caller_id", label: "درخواست‌دهنده", type: "user", section: MAIN },
    { name: "change_owner_id", label: "هماهنگ‌کنندهٔ تغییر", type: "user", default: "$me", list: true, filter: true, index: true, span: 8, section: MAIN },
    { name: "change_manager_id", label: "مدیر تغییر", type: "user", filter: true, index: true, span: 8, section: MAIN },
    { name: "assignment_group_id", label: "گروه مجری", type: "group", section: MAIN },
    { name: "assigned_to", label: "مجری", type: "user", section: MAIN },
    { name: "stakeholders", label: "ذی‌نفعان برای اطلاع‌رسانی", type: "users", span: 16, section: MAIN },
    { name: "parent_id", label: "تغییر والد", type: "ref", ref: "$self", filter: true, index: true, span: 8, section: MAIN },
    { name: "external_ref", label: "شناسهٔ بیرونی", type: "string", maxLength: 200, ltr: true, search: true, filter: true, span: 8, section: MAIN },
    { name: "on_hold", label: "متوقف", type: "bool", readonly: true, default: false, list: true, filter: true, span: 8, section: MAIN },
    { name: "on_hold_reason", label: "دلیل توقف", type: "choice", choices: "change_request.hold_reason", readonly: true, filter: true, span: 8, section: MAIN },
    { name: "on_hold_since", label: "متوقف از", type: "datetime", system: true, audit: false, span: 8, section: MAIN },

    { name: "service_id", label: "خدمت اصلی", type: "ref", ref: "service", section: SERVICE },
    { name: "ci_id", label: "پیکربندی اصلی (CI)", type: "ref", ref: "ci", section: SERVICE },
    { name: "affected_cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 12, section: SERVICE },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 12, section: SERVICE },
    { name: "impacted_services", label: "خدمت‌های اثرپذیر (محاسبه‌شده)", type: "refs", ref: "service", readonly: true, span: 12, section: SERVICE, help: "از نمودار وابستگی پیکربندی‌ها حساب می‌شود" },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", section: SERVICE },
    { name: "outage_expected", label: "قطعی یا افت خدمت پیش‌بینی می‌شود", type: "bool", default: false, filter: true, span: 8, section: SERVICE },
    { name: "outage_minutes", label: "مدت قطعی (دقیقه)", type: "int", min: 0, max: 100000, span: 8, section: SERVICE },

    { name: "planned_start", label: "شروع برنامه‌ریزی‌شده", type: "datetime", list: true, sort: true, filter: true, index: true, span: 8, section: SCHEDULE },
    { name: "planned_end", label: "پایان برنامه‌ریزی‌شده", type: "datetime", list: true, sort: true, filter: true, index: true, span: 8, section: SCHEDULE },
    { name: "maintenance_window_id", label: "پنجرهٔ نگهداری", type: "ref", ref: "change_window", refFilter: { f: "kind", op: "eq", v: "maintenance" }, filter: true, span: 8, section: SCHEDULE },
    { name: "actual_start", label: "شروع واقعی", type: "datetime", sort: true, filter: true, span: 8, section: SCHEDULE },
    { name: "actual_end", label: "پایان واقعی", type: "datetime", sort: true, filter: true, span: 8, section: SCHEDULE },
    { name: "duration_actual", label: "مدت واقعی اجرا", type: "duration", system: true, span: 8, section: SCHEDULE },
    { name: "is_late", label: "دیرهنگام (کمتر از مهلت اعلام)", type: "bool", system: true, default: false, filter: true, span: 8, section: SCHEDULE },
    { name: "lead_days", label: "روزهای کاری تا شروع", type: "int", system: true, audit: false, span: 8, section: SCHEDULE },
    { name: "in_blackout", label: "در دورهٔ ممنوعیت یا انجماد", type: "bool", readonly: true, default: false, filter: true, span: 8, section: SCHEDULE },
    { name: "outside_window", label: "بیرون از پنجرهٔ نگهداری", type: "bool", readonly: true, default: false, filter: true, span: 8, section: SCHEDULE },
    { name: "blackout_override_reason", label: "دلیل اجرا در دورهٔ ممنوعیت", type: "text", span: 24, section: SCHEDULE },
    { name: "conflict_status", label: "تداخل", type: "choice", choices: CONFLICT_STATUSES, readonly: true, default: "not_checked", list: true, filter: true, span: 8, section: SCHEDULE },
    { name: "conflict_count", label: "تداخل‌های باز", type: "int", readonly: true, default: 0, audit: false, sort: true, span: 8, section: SCHEDULE },
    { name: "conflict_checked_at", label: "آخرین بررسی تداخل", type: "datetime", readonly: true, audit: false, span: 8, section: SCHEDULE },
    { name: "exclude_conflicts", label: "بیرون از بررسی تداخل", type: "bool", default: false, span: 8, section: SCHEDULE },
    { name: "lockdown_id", label: "قرنطینه", type: "ref", ref: "change_lockdown", readonly: true, filter: true, span: 8, section: SCHEDULE },
    { name: "window_alerted_at", label: "یادآوری شروع پنجره", type: "datetime", system: true, hidden: true, audit: false },
    { name: "overrun_alerted_at", label: "هشدار پایان پنجره", type: "datetime", system: true, hidden: true, audit: false },

    { name: "implementation_plan", label: "برنامهٔ اجرا", type: "markdown", span: 24, tab: PLANS, ai: { index: true } },
    { name: "test_plan", label: "برنامهٔ آزمون", type: "markdown", span: 24, tab: PLANS },
    { name: "test_results", label: "نتیجه و شواهد آزمون", type: "markdown", span: 24, tab: PLANS },
    { name: "backout_plan", label: "برنامهٔ بازگشت", type: "markdown", span: 24, tab: PLANS, ai: { index: true } },
    { name: "backout_tested", label: "برنامهٔ بازگشت آزموده شده است", type: "bool", default: false, span: 12, tab: PLANS },
    { name: "communication_plan", label: "برنامهٔ اطلاع‌رسانی", type: "markdown", span: 24, tab: PLANS },
    { name: "planned_effort", label: "برآورد کار (ساعت)", type: "decimal", min: 0, span: 8, tab: PLANS },
    { name: "planned_cost", label: "هزینهٔ برآوردی (ریال)", type: "money", min: 0, group: "financial", span: 8, tab: PLANS },

    { name: "risk", label: "ریسک", type: "choice", choices: RISK_LEVELS, list: true, filter: true, sort: true, index: true, span: 8, tab: RISK },
    { name: "risk_score", label: "امتیاز ریسک", type: "int", system: true, sort: true, filter: true, span: 8, tab: RISK },
    { name: "risk_calculated", label: "ریسک محاسبه‌شده", type: "choice", choices: RISK_LEVELS, system: true, filter: true, span: 8, tab: RISK },
    { name: "risk_source", label: "منبع ریسک", type: "choice", choices: RISK_SOURCES, default: "calculated", filter: true, span: 8, tab: RISK },
    { name: "risk_override_reason", label: "دلیل تعیین دستی ریسک", type: "text", span: 16, tab: RISK },
    { name: "risk_answers", label: "پاسخ‌های ارزیابی ریسک", type: "json", hidden: true, default: {}, tab: RISK },
    { name: "risk_factors", label: "عامل‌های ریسک", type: "json", system: true, hidden: true, audit: false, default: [], tab: RISK },
    { name: "risk_explanation", label: "توضیح ریسک", type: "markdown", system: true, audit: false, span: 24, tab: RISK },
    { name: "risk_assessed_at", label: "زمان ارزیابی ریسک", type: "datetime", system: true, audit: false, span: 8, tab: RISK },
    { name: "approval", label: "وضعیت تأیید", type: "choice", choices: APPROVAL_STATES, tab: RISK },
    { name: "cab_required", label: "بررسی در CAB لازم است", type: "bool", system: true, default: false, filter: true, span: 8, tab: RISK },
    { name: "cab_id", label: "هیئت CAB", type: "ref", ref: "cab", filter: true, span: 8, tab: RISK },
    { name: "cab_meeting_id", label: "جلسهٔ CAB", type: "ref", ref: "cab_meeting", readonly: true, filter: true, span: 8, tab: RISK },
    { name: "cab_recommendation", label: "نظر CAB", type: "choice", choices: AGENDA_DECISIONS, readonly: true, filter: true, span: 8, tab: RISK },
    { name: "submitted_at", label: "زمان ارسال", type: "datetime", system: true, sort: true, filter: true, span: 8, tab: RISK },
    { name: "auth_cycle_at", label: "آغاز دور تأیید", type: "datetime", system: true, hidden: true, audit: false, tab: RISK },
    { name: "authorized_at", label: "زمان تأیید", type: "datetime", system: true, sort: true, filter: true, span: 8, tab: RISK },

    { name: "close_code", label: "نتیجهٔ اجرا", type: "choice", choices: "$table.close_code", list: false, tab: CLOSURE },
    { name: "close_notes", label: "یادداشت بستن", type: "text", tab: CLOSURE },
    { name: "requester_confirmed", label: "درخواست‌دهنده موفقیت را تأیید کرد", type: "bool", default: false, span: 12, tab: CLOSURE },
    { name: "implementation_rating", label: "کیفیت اجرا", type: "rating", min: 1, max: 5, span: 12, tab: CLOSURE },
    { name: "lessons", label: "درس‌آموخته‌ها", type: "markdown", span: 24, tab: CLOSURE, ai: { index: true } },
    { name: "pir_required", label: "بازبینی پس از اجرا لازم است", type: "bool", system: true, default: false, filter: true, span: 8, tab: CLOSURE },
    { name: "pir_id", label: "بازبینی پس از اجرا", type: "ref", ref: "change_pir", readonly: true, span: 8, tab: CLOSURE },
    { name: "incidents_caused", label: "رخدادهای ناشی از این تغییر", type: "int", readonly: true, default: 0, sort: true, filter: true, span: 8, tab: CLOSURE },
    { name: "retrospective", label: "ثبت گذشته‌نگر", type: "bool", default: false, filter: true, span: 8, tab: CLOSURE },
    { name: "discovered_by", label: "شناسایی از راه", type: "choice", choices: DISCOVERED_BY, span: 8, tab: CLOSURE },
    { name: "origin_table", label: "جدول منشأ", type: "string", maxLength: 60, readonly: true, hidden: true, ltr: true },
    { name: "origin_id", label: "رکورد منشأ", type: "string", maxLength: 40, readonly: true, hidden: true, ltr: true },
    { name: "model_states", label: "مرحله‌های مدل", type: "multichoice", choices: STATE_OPTIONS, system: true, hidden: true, audit: false, default: [] },
  ],
  states: CHANGE_STATES,
  scope: {
    ...TASK_SCOPE,
    // the coordinator and the change manager work the change like its implementer
    own: [...(TASK_SCOPE.own ?? []), "change_owner_id", "change_manager_id"],
    requester: ["requested_for", "caller_id", "opened_by"],
    requesterWritable: ["description", "urgency", "watch_list", "requester_confirmed"],
    requesterTransitions: [{ from: ["new"], to: "canceled" }],
  },
  features: { sla: true, approvals: true, confidential: true, rag: true, kanban: "state", calendar: { start: "planned_start", end: "planned_end" } },
  form: {
    sections: [MAIN, SERVICE, SCHEDULE],
    tabs: ["جزئیات", PLANS, RISK, CLOSURE],
    related: [
      { table: "change_task", field: "change_id", label: "کارهای تغییر", columns: ["number", "short_description", "task_type", "state", "assignment_group_id", "assigned_to", "planned_start"] },
      { table: "change_conflict", field: "change_id", label: "تداخل‌ها", columns: ["summary", "kind", "status", "overlap_start", "active"] },
      { table: "change_outage", field: "change_id", label: "قطعی‌های برنامه‌ریزی‌شده", columns: ["title", "outage_type", "starts_at", "ends_at"] },
      { table: "change_request", field: "parent_id", label: "تغییرهای فرزند", columns: ["number", "short_description", "state", "planned_start", "assigned_to"] },
      { table: "cab_agenda_item", field: "change_id", label: "بررسی در CAB", columns: ["title", "meeting_id", "kind", "decision"] },
    ],
  },
  list: { columns: ["number", "short_description", "type", "state", "risk", "planned_start", "planned_end", "assignment_group_id", "assigned_to", "conflict_status"], order: "-opened_at" },
  ai: { title: "short_description", text: ["description", "justification", "implementation_plan", "backout_plan", "close_notes", "lessons"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Change tasks

export const CHANGE_TASK_STATES: StateModel = {
  field: "state",
  initial: "pending",
  states: [
    { value: "pending", label: "منتظر شروع اجرا", category: "waiting", color: "gray" },
    { value: "open", label: "آماده", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "closed_complete", label: "انجام شد", category: "closed", color: "green" },
    { value: "closed_incomplete", label: "ناتمام بسته شد", category: "closed", color: "orange" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["pending"], to: "open", label: "آماده شد" },
    { from: ["pending", "open"], to: "in_progress", label: "شروع", guard: "change_task_ready" },
    { from: ["in_progress"], to: "open", label: "توقف" },
    { from: ["open", "in_progress", "pending"], to: "closed_complete", label: "انجام شد", guard: "change_task_ready" },
    { from: ["open", "in_progress", "pending"], to: "closed_incomplete", label: "بستن ناتمام", requires: ["close_notes"] },
    { from: ["open", "in_progress", "pending"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};
/** Task states that no longer hold up the change. */
export const TASK_DONE = ["closed_complete", "closed_incomplete", "canceled"];

const TASK_HIDDEN = ["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "approval", "escalation", "parent_id", "close_code", "due_at"];

const changeTask: TableDef = {
  key: "change_task",
  table: "sm_change_tasks",
  label: "کار تغییر",
  plural: "کارهای تغییر",
  icon: "list-checks",
  module: "change",
  area: "change",
  description: "گام‌های برنامه‌ریزی، اجرا، آزمون و صحت‌سنجی یک تغییر؛ با شروع اجرا به ترتیب وابستگی آماده می‌شوند",
  extends: "task",
  numbered: { prefix: "CTASK", pad: 7 },
  display: "short_description",
  fields: [
    ...TASK_FIELDS.filter((f) => TASK_HIDDEN.includes(f.name)).map((f) => ({ ...f, hidden: true })),
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "task_type", label: "نوع کار", type: "choice", choices: "change_task.task_type", default: "implementation", list: true, filter: true, span: 6 },
    { name: "mandatory", label: "لازم برای پایان اجرا", type: "bool", default: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "depends_on", label: "پس از کارهای", type: "refs", ref: "change_task", span: 18 },
    { name: "planned_start", label: "شروع برنامه‌ریزی‌شده", type: "datetime", list: true, sort: true, filter: true, span: 8 },
    { name: "planned_end", label: "پایان برنامه‌ریزی‌شده", type: "datetime", sort: true, filter: true, span: 8 },
    { name: "actual_start", label: "شروع واقعی", type: "datetime", sort: true, span: 8 },
    { name: "actual_end", label: "پایان واقعی", type: "datetime", sort: true, span: 8 },
    { name: "checklist", label: "گام‌ها", type: "markdown", span: 24, help: "هر گام یک سطر: «- [ ] …»؛ گام انجام‌شده «- [x] …»" },
    { name: "change_owner_id", label: "هماهنگ‌کنندهٔ تغییر", type: "user", system: true, span: 8 },
  ],
  states: CHANGE_TASK_STATES,
  scope: { ...TASK_SCOPE, own: [...(TASK_SCOPE.own ?? []), "change_owner_id"], requester: ["requested_for", "caller_id", "opened_by"] },
  // a task of a confidential change is confidential too (its readers follow the change: hooks.ts)
  features: { confidential: true, calendar: { start: "planned_start", end: "planned_end" } },
  list: { columns: ["number", "short_description", "change_id", "task_type", "state", "assignment_group_id", "assigned_to", "planned_start"], order: "sort_order,number" },
};

// ---------------------------------------------------------------------------------------------------------------
// Change models

const changeModel: TableDef = {
  key: "change_model",
  table: "sm_change_models",
  label: "مدل تغییر",
  plural: "مدل‌های تغییر",
  icon: "workflow",
  module: "change",
  area: "change",
  description: "رویکرد تکرارپذیر برای یک نوع تغییر: مرحله‌های چرخهٔ عمر، فیلدهای الزامی هر مرحله و سیاست‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام مدل", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "type", label: "نوع تغییر", type: "choice", choices: "change_request.type", required: true, list: true, filter: true, span: 6 },
    { name: "is_default", label: "پیش‌فرض این نوع", type: "bool", default: false, list: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "states", label: "مرحله‌های چرخهٔ عمر", type: "multichoice", choices: STATE_OPTIONS, required: true, span: 24, help: "پیش‌نویس، بستن و لغو همیشه هستند؛ مرحله‌های دیگر را می‌توان حذف کرد" },
    { name: "docs_deferred", label: "مستندسازی پس از اجرا (اضطراری)", type: "bool", default: false, span: 8, help: "برنامه‌ها پیش از تأیید لازم نیستند ولی پیش از بستن لازم‌اند" },
    { name: "lead_time_exempt", label: "بدون مهلت اعلام", type: "bool", default: false, span: 8 },
    { name: "cab_policy", label: "بررسی در CAB", type: "choice", choices: CAB_POLICIES, default: "risk", span: 8 },
    { name: "pir_policy", label: "بازبینی پس از اجرا", type: "choice", choices: PIR_POLICIES, default: "settings", span: 8 },
    { name: "requirements", label: "فیلدهای الزامی هر مرحله", type: "json", default: {}, hidden: true, help: "{ «مرحله»: [«فیلد»…] }" },
    { name: "locks", label: "فیلدهای قفل از هر مرحله", type: "json", default: {}, hidden: true, help: "{ «مرحله»: [«فیلد»…] }" },
    { name: "description", label: "توضیح", type: "text", span: 24 },
    { name: "revision", label: "ویرایش", type: "int", system: true, default: 1, span: 6 },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "type", "states", "is_default", "active"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Templates and the standard-change catalogue

export const TEMPLATE_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "review", label: "در بازبینی", category: "waiting", color: "gold" },
    { value: "published", label: "منتشرشده", category: "active", color: "green" },
    { value: "suspended", label: "معلق", category: "waiting", color: "orange" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "review", label: "ارسال برای بازبینی" },
    { from: ["review"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["review", "draft"], to: "published", label: "انتشار", roles: { area: "change", level: "full" } },
    { from: ["published"], to: "draft", label: "بازنگری (نسخهٔ تازه)" },
    { from: ["published"], to: "suspended", label: "تعلیق", roles: { area: "change", level: "full" } },
    { from: ["suspended"], to: "published", label: "انتشار دوباره", roles: { area: "change", level: "full" } },
    { from: ["draft", "published", "suspended"], to: "retired", label: "بازنشسته کردن", roles: { area: "change", level: "full" } },
    { from: ["retired"], to: "draft", label: "بازگردانی" },
  ],
  locked: ["closed"],
};

const changeTemplate: TableDef = {
  key: "change_template",
  table: "sm_change_templates",
  label: "الگوی تغییر",
  plural: "الگوها و تغییرهای استاندارد",
  icon: "layout-template",
  module: "change",
  area: "change",
  description: "الگوی ثبت تغییر، یا تغییر استاندارد از پیش مجاز با ریسک ارزیابی‌شده، برنامه‌ها و کارهای آماده",
  numbered: { prefix: "CHGT", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 16 },
    { name: "kind", label: "گونه", type: "choice", choices: TEMPLATE_KINDS, default: "standard", required: true, list: true, filter: true, span: 8 },
    { name: "category", label: "دسته", type: "choice", choices: "change_request.category", list: true, filter: true, span: 8 },
    { name: "model_id", label: "مدل تغییر", type: "ref", ref: "change_model", span: 8 },
    { name: "owner_id", label: "مالک الگو", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "authoring_group_id", label: "گروه نویسنده", type: "group", filter: true, span: 8, help: "فقط اعضای این گروه و مالک الگو آن را تغییر می‌دهند" },
    { name: "review_date", label: "تاریخ بازبینی دوره‌ای", type: "date", sort: true, filter: true, span: 8 },
    { name: "max_duration", label: "بیشینهٔ مدت اجرا", type: "duration", min: 0, span: 8 },
    { name: "short_description", label: "عنوان تغییر", type: "string", maxLength: 200, span: 24 },
    { name: "description", label: "شرح", type: "markdown", span: 24, search: true },
    { name: "justification", label: "توجیه", type: "markdown", span: 24 },
    { name: "implementation_plan", label: "برنامهٔ اجرا", type: "markdown", span: 24 },
    { name: "test_plan", label: "برنامهٔ آزمون", type: "markdown", span: 24 },
    { name: "backout_plan", label: "برنامهٔ بازگشت", type: "markdown", span: 24 },
    { name: "communication_plan", label: "برنامهٔ اطلاع‌رسانی", type: "markdown", span: 24 },
    { name: "risk", label: "ریسک ارزیابی‌شده", type: "choice", choices: RISK_LEVELS, default: "low", list: true, filter: true, span: 8 },
    { name: "impact", label: "اثر", type: "choice", choices: [{ value: "1", label: "۱ — زیاد" }, { value: "2", label: "۲ — متوسط" }, { value: "3", label: "۳ — کم" }], default: "3", span: 8 },
    { name: "assignment_group_id", label: "گروه مجری", type: "group", list: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", span: 12 },
    { name: "services", label: "خدمت‌های مجاز", type: "refs", ref: "service", span: 12 },
    { name: "ci_classes", label: "رده‌های پیکربندی مجاز", type: "tags", span: 24 },
    { name: "tasks", label: "کارهای الگو", type: "json", default: [], span: 24, help: "[{ «short_description»: «…», «task_type»: «implementation», «mandatory»: true }]" },
    { name: "usage_count", label: "دفعات استفاده", type: "int", readonly: true, default: 0, audit: false, list: true, sort: true, span: 6 },
    { name: "success_count", label: "موفق", type: "int", readonly: true, default: 0, audit: false, span: 6 },
    { name: "failure_count", label: "ناموفق", type: "int", readonly: true, default: 0, audit: false, span: 6 },
    { name: "last_used_at", label: "آخرین استفاده", type: "datetime", readonly: true, audit: false, sort: true, span: 6 },
    { name: "revision", label: "نسخه", type: "int", system: true, default: 1, span: 6 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", system: true, sort: true, span: 12 },
    { name: "published_by", label: "منتشرکننده", type: "user", system: true, span: 12 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
  ],
  states: TEMPLATE_STATES,
  scope: { public: true, own: ["owner_id"], group: "authoring_group_id" },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "name", "kind", "category", "risk", "state", "usage_count", "owner_id"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Maintenance, blackout and freeze windows

const changeWindow: TableDef = {
  key: "change_window",
  table: "sm_change_windows",
  label: "پنجرهٔ زمانی",
  plural: "پنجره‌های زمانی",
  icon: "calendar-range",
  module: "change",
  area: "change",
  description: "پنجره‌های نگهداری و دوره‌های ممنوعیت یا انجماد تغییرات، یک‌باره یا تکرارشونده به تقویم شمسی",
  numbered: { prefix: "WIN", pad: 4 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: WINDOW_KINDS, required: true, default: "maintenance", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "start_at", label: "شروع", type: "datetime", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "end_at", label: "پایان", type: "datetime", required: true, list: true, sort: true, span: 8 },
    { name: "enforcement", label: "رفتار", type: "choice", choices: ENFORCEMENT, default: "block", span: 8, help: "برای ممنوعیت و انجماد: جلوگیری از زمان‌بندی و اجرا یا فقط هشدار" },
    { name: "recurrence", label: "تکرار", type: "choice", choices: WINDOW_RECURRENCE, default: "none", list: true, span: 8 },
    { name: "weekdays", label: "روزهای هفته", type: "multichoice", choices: WEEKDAY_OPTIONS, span: 8 },
    { name: "until", label: "تکرار تا", type: "date", span: 8 },
    { name: "exempt_emergency", label: "تغییرهای اضطراری مستثنا", type: "bool", default: true, span: 8 },
    { name: "change_types", label: "فقط برای نوع‌های", type: "multichoice", choices: "change_request.type", span: 16 },
    { name: "services", label: "خدمت‌ها", type: "refs", ref: "service", span: 12 },
    { name: "cis", label: "پیکربندی‌ها", type: "refs", ref: "ci", span: 12 },
    { name: "scope_condition", label: "شرط تغییرها", type: "conditions", condTable: "change_request", span: 24, help: "خالی: همهٔ تغییرها (یا تغییرهای خدمت‌ها و پیکربندی‌های بالا)" },
    { name: "owner_group_id", label: "گروه مسئول", type: "group", span: 12 },
    { name: "source", label: "منبع", type: "choice", choices: [{ value: "manual", label: "دستی" }, { value: "holiday", label: "از تعطیلات رسمی" }, { value: "seed", label: "پیش‌فرض" }], default: "manual", readonly: true, span: 12 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true, group: "owner_group_id" },
  features: { calendar: { start: "start_at", end: "end_at" } },
  list: { columns: ["number", "name", "kind", "start_at", "end_at", "recurrence", "active"], order: "kind,start_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// CABs, meetings and agendas

const cab: TableDef = {
  key: "cab",
  table: "sm_cabs",
  label: "هیئت CAB",
  plural: "هیئت‌های CAB",
  icon: "users-round",
  module: "change",
  area: "change",
  description: "هیئت مشاوران تغییر: اعضا، رئیس جلسه، زمان جلسه‌های دوره‌ای و تغییرهایی که به دستور جلسه می‌آیند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "گونه", type: "choice", choices: CAB_KINDS, default: "change", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, span: 6 },
    { name: "manager_id", label: "رئیس جلسه (مدیر CAB)", type: "user", list: true, span: 12 },
    { name: "group_id", label: "گروه اعضا", type: "group", span: 12 },
    { name: "members", label: "اعضا", type: "users", span: 24 },
    { name: "meeting_weekday", label: "روز جلسه", type: "choice", choices: WEEKDAY_OPTIONS, span: 6 },
    { name: "meeting_time", label: "ساعت جلسه", type: "string", maxLength: 5, ltr: true, placeholder: "10:00", span: 6 },
    { name: "meeting_minutes", label: "مدت جلسه (دقیقه)", type: "int", min: 15, max: 600, default: 60, span: 6 },
    { name: "quorum", label: "حد نصاب حاضران", type: "int", min: 0, max: 100, default: 0, span: 6 },
    { name: "location", label: "مکان", type: "string", maxLength: 200, span: 12 },
    { name: "conference_url", label: "پیوند جلسهٔ برخط", type: "url", ltr: true, span: 12 },
    { name: "agenda_condition", label: "شرط ورود به دستور جلسه", type: "conditions", condTable: "change_request", span: 24, help: "خالی: تغییرهای در انتظار تأییدی که بررسی CAB لازم دارند" },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  unique: [["name"]],
  scope: { public: true, own: ["manager_id"], group: "group_id" },
  list: { columns: ["name", "kind", "manager_id", "meeting_weekday", "meeting_time", "active"], order: "name" },
};

export const MEETING_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال برگزاری", category: "active", color: "teal" },
    { value: "completed", label: "برگزار شد", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "in_progress", label: "شروع جلسه" },
    { from: ["in_progress"], to: "planned", label: "بازگشت به برنامه" },
    { from: ["planned", "in_progress"], to: "completed", label: "پایان جلسه" },
    { from: ["planned", "in_progress"], to: "canceled", label: "لغو جلسه" },
    { from: ["completed"], to: "in_progress", label: "بازگشایی صورت‌جلسه", roles: { area: "change", level: "full" } },
  ],
  locked: ["closed", "canceled"],
};

const cabMeeting: TableDef = {
  key: "cab_meeting",
  table: "sm_cab_meetings",
  label: "جلسهٔ CAB",
  plural: "جلسه‌های CAB",
  icon: "presentation",
  module: "change",
  area: "change",
  description: "جلسهٔ هیئت مشاوران تغییر: دستور جلسه، حاضران، تصمیم‌ها و صورت‌جلسه",
  numbered: { prefix: "CABM", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 16 },
    { name: "cab_id", label: "هیئت", type: "ref", ref: "cab", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "starts_at", label: "شروع", type: "datetime", required: true, list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "ends_at", label: "پایان", type: "datetime", required: true, sort: true, span: 8 },
    { name: "chair_id", label: "رئیس جلسه", type: "user", list: true, filter: true, span: 8 },
    { name: "attendees", label: "دعوت‌شدگان", type: "users", span: 24 },
    { name: "present", label: "حاضران", type: "users", span: 24 },
    { name: "location", label: "مکان", type: "string", maxLength: 200, span: 12 },
    { name: "conference_url", label: "پیوند جلسهٔ برخط", type: "url", ltr: true, span: 12 },
    { name: "notes", label: "یادداشت‌های جلسه", type: "markdown", span: 24 },
    { name: "minutes", label: "صورت‌جلسه", type: "markdown", span: 24, ai: { index: true } },
    { name: "action_items", label: "اقدام‌ها", type: "markdown", span: 24 },
    { name: "minutes_sent_at", label: "ارسال صورت‌جلسه", type: "datetime", system: true, span: 8 },
  ],
  states: MEETING_STATES,
  scope: { own: ["chair_id"] },
  features: { journal: true, attachments: true, calendar: { start: "starts_at", end: "ends_at" } },
  form: { related: [{ table: "cab_agenda_item", field: "meeting_id", label: "دستور جلسه", columns: ["sort_order", "title", "change_id", "kind", "decision"] }] },
  list: { columns: ["number", "title", "cab_id", "starts_at", "chair_id", "state"], order: "-starts_at" },
};

const cabAgendaItem: TableDef = {
  key: "cab_agenda_item",
  table: "sm_cab_agenda_items",
  label: "مورد دستور جلسه",
  plural: "موردهای دستور جلسه",
  icon: "list-ordered",
  module: "change",
  area: "change",
  description: "یک تغییر در دستور جلسهٔ CAB با تصمیم جلسه دربارهٔ آن",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 60, list: true, search: true, ltr: true, span: 8 },
    { name: "meeting_id", label: "جلسه", type: "ref", ref: "cab_meeting", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "kind", label: "موضوع", type: "choice", choices: AGENDA_KINDS, default: "authorize", list: true, filter: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "presenter_id", label: "ارائه‌دهنده", type: "user", span: 8 },
    { name: "decision", label: "تصمیم", type: "choice", choices: AGENDA_DECISIONS, readonly: true, default: "pending", list: true, filter: true, span: 8 },
    { name: "decided_by", label: "ثبت‌کنندهٔ تصمیم", type: "user", system: true, span: 8 },
    { name: "decided_at", label: "زمان تصمیم", type: "datetime", system: true, sort: true, span: 8 },
    { name: "decision_notes", label: "شرح تصمیم", type: "text", span: 24 },
    { name: "votes", label: "رأی‌ها", type: "json", system: true, hidden: true, audit: false, default: {} },
  ],
  unique: [["meeting_id", "change_id", "kind"]],
  scope: { public: true },
  list: { columns: ["sort_order", "title", "change_id", "meeting_id", "kind", "decision"], order: "sort_order,title" },
};

// ---------------------------------------------------------------------------------------------------------------
// Conflicts, planned outages, reviews

const changeConflict: TableDef = {
  key: "change_conflict",
  table: "sm_change_conflicts",
  label: "تداخل تغییر",
  plural: "تداخل‌های تغییر",
  icon: "triangle-alert",
  module: "change",
  area: "change",
  description: "تداخلی که بررسی خودکار یافته است: همان پیکربندی یا خدمت در همان زمان، دورهٔ ممنوعیت، بیرون از پنجرهٔ نگهداری…",
  display: "summary",
  fields: [
    { name: "summary", label: "شرح", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "kind", label: "نوع تداخل", type: "choice", choices: CONFLICT_KINDS, required: true, list: true, filter: true, span: 8 },
    { name: "status", label: "بررسی", type: "choice", choices: CONFLICT_REVIEW, default: "detected", list: true, filter: true, span: 8 },
    { name: "justification", label: "دلیل", type: "text", span: 24, help: "برای «نادیده گرفته شد» و «برطرف شد» لازم است" },
    { name: "other_change_id", label: "تغییر دیگر", type: "ref", ref: "change_request", readonly: true, filter: true, index: true, span: 8 },
    { name: "window_id", label: "پنجره", type: "ref", ref: "change_window", readonly: true, filter: true, span: 8 },
    { name: "lockdown_id", label: "قرنطینه", type: "ref", ref: "change_lockdown", readonly: true, span: 8 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", readonly: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", readonly: true, span: 8 },
    { name: "overlap_start", label: "از", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "overlap_end", label: "تا", type: "datetime", readonly: true, span: 8 },
    { name: "active", label: "هنوز برقرار", type: "bool", readonly: true, default: true, list: true, filter: true, span: 8 },
    { name: "key", label: "کلید", type: "string", maxLength: 200, readonly: true, hidden: true, audit: false },
    { name: "detected_at", label: "زمان شناسایی", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "assignment_group_id", label: "گروه مجری", type: "group", system: true, hidden: true },
    { name: "assigned_to", label: "مجری", type: "user", system: true, hidden: true },
    { name: "change_owner_id", label: "هماهنگ‌کننده", type: "user", system: true, hidden: true },
  ],
  unique: [["change_id", "key"]],
  scope: { own: ["change_owner_id", "assigned_to"], requester: [], group: "assignment_group_id" },
  list: { columns: ["summary", "change_id", "kind", "status", "overlap_start", "active"], order: "-detected_at" },
};

const changeOutage: TableDef = {
  key: "change_outage",
  table: "sm_change_outages",
  label: "قطعی برنامه‌ریزی‌شده",
  plural: "قطعی‌های برنامه‌ریزی‌شده",
  icon: "power-off",
  module: "change",
  area: "change",
  description: "قطعی یا افت کیفیتی که یک تغییر برای یک خدمت یا پیکربندی اعلام می‌کند",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "outage_type", label: "نوع", type: "choice", choices: OUTAGE_TYPES, default: "outage", list: true, filter: true, span: 8 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 12 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", filter: true, span: 12 },
    { name: "starts_at", label: "شروع", type: "datetime", required: true, list: true, sort: true, filter: true, span: 6 },
    { name: "ends_at", label: "پایان", type: "datetime", required: true, list: true, sort: true, span: 6 },
    { name: "announce", label: "اعلام به کاربران", type: "bool", default: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  features: { calendar: { start: "starts_at", end: "ends_at" } },
  list: { columns: ["title", "change_id", "outage_type", "starts_at", "ends_at"], order: "-starts_at" },
};

export const PIR_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "active", color: "teal" },
    { value: "completed", label: "انجام شد", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "شروع بازبینی" },
    { from: ["in_review"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["draft", "in_review"], to: "completed", label: "پایان بازبینی", requires: ["objectives_met", "lessons"] },
    { from: ["completed"], to: "in_review", label: "بازگشایی", roles: { area: "change", level: "full" } },
    { from: ["draft", "in_review"], to: "canceled", label: "لغو", roles: { area: "change", level: "full" } },
  ],
  locked: ["closed", "canceled"],
};

const changePir: TableDef = {
  key: "change_pir",
  table: "sm_change_pirs",
  label: "بازبینی پس از اجرا",
  plural: "بازبینی‌های پس از اجرا",
  icon: "clipboard-check",
  module: "change",
  area: "change",
  description: "بازبینی پس از اجرای تغییر (PIR): تحقق هدف‌ها، پیامدهای جانبی، دقت برنامه و درس‌آموخته‌ها",
  numbered: { prefix: "CPIR", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "reason", label: "دلیل بازبینی", type: "choice", choices: PIR_REASONS, default: "manual", filter: true, span: 8 },
    { name: "owner_id", label: "مسئول بازبینی", type: "user", default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 8 },
    { name: "due_at", label: "مهلت", type: "datetime", list: true, sort: true, filter: true, span: 8 },
    { name: "completed_at", label: "زمان پایان", type: "datetime", system: true, sort: true, span: 8 },
    { name: "objectives_met", label: "هدف‌ها محقق شد؟", type: "choice", choices: OBJECTIVES_MET, filter: true, span: 8 },
    { name: "plan_accuracy", label: "دقت برنامه", type: "rating", min: 1, max: 5, span: 8 },
    { name: "incidents_caused", label: "رخدادهای ناشی از تغییر", type: "int", min: 0, default: 0, span: 8 },
    { name: "side_effects", label: "پیامدهای جانبی", type: "markdown", span: 24 },
    { name: "timeline_md", label: "خط زمانی", type: "markdown", span: 24 },
    { name: "went_well", label: "چه چیزی خوب پیش رفت", type: "markdown", span: 24 },
    { name: "went_wrong", label: "چه چیزی خوب پیش نرفت", type: "markdown", span: 24 },
    { name: "lessons", label: "درس‌آموخته‌ها", type: "markdown", span: 24, ai: { index: true } },
    { name: "follow_up", label: "اقدام‌های پیگیری", type: "markdown", span: 24 },
  ],
  states: PIR_STATES,
  scope: { own: ["owner_id"], requester: [], group: "assignment_group_id" },
  // the review of a confidential change is confidential too (its readers follow the change: hooks.ts)
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true, confidential: true },
  list: { columns: ["number", "title", "change_id", "state", "owner_id", "due_at"], order: "-created_at" },
  ai: { title: "title", text: ["side_effects", "went_well", "went_wrong", "lessons"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Risk questionnaire, lockdowns, success scores, settings

const riskQuestion: TableDef = {
  key: "change_risk_question",
  table: "sm_change_risk_questions",
  label: "پرسش ارزیابی ریسک",
  plural: "پرسش‌های ارزیابی ریسک",
  icon: "list-checks",
  module: "change",
  area: "change",
  description: "پرسش‌نامهٔ ارزیابی ریسک تغییر: هر پاسخ امتیازی دارد و جمع امتیازها سطح ریسک را می‌سازد",
  display: "question",
  fields: [
    { name: "question", label: "پرسش", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "kind", label: "گونهٔ پاسخ", type: "choice", choices: QUESTION_KINDS, default: "choice", list: true, span: 8 },
    { name: "weight", label: "وزن", type: "int", min: 0, max: 10, default: 1, list: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "options", label: "گزینه‌ها و امتیازها", type: "json", default: [], hidden: true, help: "[{ «value»: «…», «label»: «…», «score»: 0..10 }]" },
    { name: "change_types", label: "فقط برای نوع‌های", type: "multichoice", choices: "change_request.type", span: 12 },
    { name: "condition", label: "فقط وقتی", type: "conditions", condTable: "change_request", span: 24, help: "پرسش فقط برای تغییرهایی نشان داده می‌شود که این شرط را دارند" },
    { name: "mandatory", label: "پاسخ لازم است", type: "bool", default: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "help", label: "راهنمای پرسش", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["sort_order", "question", "kind", "weight", "active"], order: "sort_order,question" },
};

export const LOCKDOWN_STATES: StateModel = {
  field: "state",
  initial: "active",
  states: [
    { value: "active", label: "فعال", category: "active", color: "red" },
    { value: "released", label: "پایان‌یافته", category: "closed", color: "gray" },
  ],
  transitions: [{ from: ["active"], to: "released", label: "پایان قرنطینه", roles: { area: "change", level: "full" } }],
  locked: ["closed"],
};

const changeLockdown: TableDef = {
  key: "change_lockdown",
  table: "sm_change_lockdowns",
  label: "قرنطینهٔ تغییرات",
  plural: "قرنطینه‌های تغییرات",
  icon: "shield-ban",
  module: "change",
  area: "change",
  description: "توقف همهٔ تغییرها یا تغییرهای یک محدوده هنگام بحران یا رخداد عمده؛ فقط تغییرهای اضطراری مجازند",
  numbered: { prefix: "LCK", pad: 4 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "starts_at", label: "شروع", type: "datetime", default: "$now", required: true, list: true, sort: true, span: 8 },
    { name: "ends_at", label: "پایان پیش‌بینی‌شده", type: "datetime", sort: true, span: 8 },
    { name: "hold_in_flight", label: "تغییرهای در جریان متوقف شوند", type: "bool", default: true, span: 8 },
    // only major incidents (proposed, declared or past): the lockdown is their response
    { name: "incident_id", label: "رخداد عمده", type: "ref", ref: "incident", refFilter: { f: "major_state", op: "in", v: ["proposed", "accepted", "resolved", "pir_done"] }, filter: true, span: 8 },
    { name: "services", label: "خدمت‌ها", type: "refs", ref: "service", span: 12 },
    { name: "cis", label: "پیکربندی‌ها", type: "refs", ref: "ci", span: 12 },
    { name: "scope_condition", label: "شرط تغییرها", type: "conditions", condTable: "change_request", span: 24, help: "خالی و بدون خدمت یا پیکربندی: همهٔ تغییرها" },
    { name: "reason", label: "دلیل", type: "markdown", span: 24 },
    { name: "released_at", label: "زمان پایان", type: "datetime", system: true, span: 8 },
    { name: "released_by", label: "پایان‌دهنده", type: "user", system: true, span: 8 },
    { name: "held_count", label: "تغییرهای متوقف‌شده", type: "int", system: true, default: 0, audit: false, span: 8 },
    // when its start came and the changes in flight were put on hold (the sweep applies a lockdown that starts later)
    { name: "applied_at", label: "زمان اعمال", type: "datetime", system: true, audit: false, span: 8 },
  ],
  states: LOCKDOWN_STATES,
  scope: { public: true },
  features: { journal: true },
  list: { columns: ["number", "title", "state", "starts_at", "ends_at", "held_count"], order: "-starts_at" },
};

const successScore: TableDef = {
  key: "change_success_score",
  table: "sm_change_success_scores",
  label: "امتیاز موفقیت تغییر",
  plural: "امتیازهای موفقیت تیم‌ها",
  icon: "gauge",
  module: "change",
  area: "change",
  description: "امتیاز هر گروه مجری از نتیجهٔ تغییرهای اجراشده در بازهٔ اخیر (هر شب دوباره حساب می‌شود)",
  display: "title",
  fields: [
    { name: "title", label: "گروه", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "group_id", label: "گروه مجری", type: "group", required: true, unique: true, filter: true, span: 12 },
    { name: "score", label: "امتیاز", type: "int", min: 0, max: 100, list: true, sort: true, span: 6 },
    { name: "band", label: "رده", type: "choice", choices: SCORE_BANDS, list: true, filter: true, span: 6 },
    { name: "implemented", label: "اجراشده", type: "int", list: true, span: 6 },
    { name: "successful", label: "موفق", type: "int", span: 6 },
    { name: "with_issues", label: "موفق با مشکل", type: "int", span: 6 },
    { name: "failed", label: "ناموفق یا برگشتی", type: "int", list: true, span: 6 },
    { name: "caused_incidents", label: "منجر به رخداد", type: "int", span: 6 },
    { name: "emergency", label: "اضطراری", type: "int", span: 6 },
    { name: "computed_at", label: "زمان محاسبه", type: "datetime", list: true, span: 12 },
  ],
  scope: { public: true },
  list: { columns: ["title", "score", "band", "implemented", "failed", "computed_at"], order: "-score" },
};

/** The module's settings and their defaults (one row per organisation; the server falls back to these). */
export const CHANGE_CONFIG_DEFAULTS = {
  risk_moderate_from: 26,
  risk_high_from: 51,
  risk_very_high_from: 76,
  questionnaire_weight: 60,
  lead_days_low: 1,
  lead_days_moderate: 2,
  lead_days_high: 5,
  lead_days_very_high: 5,
  cab_risks: ["high", "very_high"] as string[],
  default_cab_id: null as string | null,
  emergency_cab_id: null as string | null,
  change_manager_group_id: null as string | null,
  pir_required_for: ["emergency", "failed", "high_risk"] as string[],
  pir_due_days: 5,
  reauthorize_on_edit: true,
  review_auto_close_days: 0,
  stale_draft_days: 0,
  hold_blocks_cancel: true,
  success_window_days: 90,
  window_alert_minutes: 60,
  related_ci_conflicts: true,
  /** declaring a major incident starts a lockdown of its services and CIs (off by default) */
  lockdown_on_major: false,
};
export type ChangeConfig = typeof CHANGE_CONFIG_DEFAULTS;

const RISK_SECTION = "ریسک";
const POLICY = "سیاست‌ها";
const CAB_SECTION = "CAB و تأیید";

const changeConfig: TableDef = {
  key: "change_config",
  table: "sm_change_configs",
  label: "تنظیمات تغییر",
  plural: "تنظیمات تغییر",
  icon: "settings-2",
  module: "change",
  area: "settings",
  description: "آستانه‌های ریسک، مهلت اعلام، CAB پیش‌فرض، بازبینی پس از اجرا و رفتارهای خودکار",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات تغییر", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "risk_moderate_from", label: "ریسک متوسط از امتیاز", type: "int", min: 1, max: 100, default: CHANGE_CONFIG_DEFAULTS.risk_moderate_from, span: 8, section: RISK_SECTION },
    { name: "risk_high_from", label: "ریسک زیاد از امتیاز", type: "int", min: 1, max: 100, default: CHANGE_CONFIG_DEFAULTS.risk_high_from, span: 8, section: RISK_SECTION },
    { name: "risk_very_high_from", label: "ریسک بسیار زیاد از امتیاز", type: "int", min: 1, max: 100, default: CHANGE_CONFIG_DEFAULTS.risk_very_high_from, span: 8, section: RISK_SECTION },
    { name: "questionnaire_weight", label: "سهم پرسش‌نامه از امتیاز (درصد)", type: "int", min: 0, max: 100, default: CHANGE_CONFIG_DEFAULTS.questionnaire_weight, span: 8, section: RISK_SECTION, help: "بقیه از عامل‌های خودکار (تعداد پیکربندی‌ها، اثر، ممنوعیت، کامل بودن برنامه‌ها، امتیاز تیم…)" },
    { name: "lead_days_low", label: "مهلت اعلام ریسک کم (روز کاری)", type: "int", min: 0, max: 60, default: CHANGE_CONFIG_DEFAULTS.lead_days_low, span: 6, section: POLICY },
    { name: "lead_days_moderate", label: "مهلت ریسک متوسط", type: "int", min: 0, max: 60, default: CHANGE_CONFIG_DEFAULTS.lead_days_moderate, span: 6, section: POLICY },
    { name: "lead_days_high", label: "مهلت ریسک زیاد", type: "int", min: 0, max: 60, default: CHANGE_CONFIG_DEFAULTS.lead_days_high, span: 6, section: POLICY },
    { name: "lead_days_very_high", label: "مهلت ریسک بسیار زیاد", type: "int", min: 0, max: 60, default: CHANGE_CONFIG_DEFAULTS.lead_days_very_high, span: 6, section: POLICY },
    { name: "reauthorize_on_edit", label: "ویرایش زمان، برنامه یا پیکربندی پس از تأیید، تأیید دوباره بخواهد", type: "bool", default: true, span: 12, section: POLICY },
    { name: "hold_blocks_cancel", label: "تغییر متوقف لغو نشود", type: "bool", default: true, span: 12, section: POLICY },
    { name: "pir_required_for", label: "بازبینی پس از اجرا برای", type: "multichoice", choices: PIR_REASONS.filter((o) => ["emergency", "failed", "high_risk"].includes(o.value)), default: CHANGE_CONFIG_DEFAULTS.pir_required_for, span: 12, section: POLICY },
    { name: "pir_due_days", label: "مهلت بازبینی (روز کاری)", type: "int", min: 1, max: 60, default: CHANGE_CONFIG_DEFAULTS.pir_due_days, span: 6, section: POLICY },
    { name: "review_auto_close_days", label: "بستن خودکار پس از بازبینی (روز)", type: "int", min: 0, max: 90, default: 0, span: 6, section: POLICY, help: "صفر: هرگز" },
    { name: "stale_draft_days", label: "لغو خودکار پیش‌نویس‌های رهاشده (روز)", type: "int", min: 0, max: 365, default: 0, span: 6, section: POLICY, help: "صفر: هرگز" },
    { name: "window_alert_minutes", label: "یادآوری پیش از شروع پنجره (دقیقه)", type: "int", min: 0, max: 1440, default: CHANGE_CONFIG_DEFAULTS.window_alert_minutes, span: 6, section: POLICY },
    { name: "success_window_days", label: "بازهٔ امتیاز موفقیت (روز)", type: "int", min: 7, max: 730, default: CHANGE_CONFIG_DEFAULTS.success_window_days, span: 6, section: POLICY },
    { name: "related_ci_conflicts", label: "تداخل پیکربندی‌های وابسته (از CMDB)", type: "bool", default: true, span: 6, section: POLICY },
    { name: "lockdown_on_major", label: "قرنطینهٔ خودکار با اعلام رخداد عمده", type: "bool", default: false, span: 6, section: POLICY, help: "تغییرهای خدمت‌ها و پیکربندی‌های رخداد (یا همهٔ تغییرها) تا پایان قرنطینه متوقف می‌شوند" },
    { name: "cab_risks", label: "ریسک‌هایی که CAB لازم دارند", type: "multichoice", choices: RISK_LEVELS, default: CHANGE_CONFIG_DEFAULTS.cab_risks, span: 12, section: CAB_SECTION },
    { name: "change_manager_group_id", label: "گروه مدیران تغییر", type: "group", span: 12, section: CAB_SECTION },
    { name: "default_cab_id", label: "CAB پیش‌فرض", type: "ref", ref: "cab", span: 12, section: CAB_SECTION },
    { name: "emergency_cab_id", label: "هیئت اضطراری (ECAB)", type: "ref", ref: "cab", span: 12, section: CAB_SECTION },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: ["اصلی", RISK_SECTION, POLICY, CAB_SECTION] },
  list: { columns: ["name", "questionnaire_weight", "lead_days_high"], order: "name" },
};

export const CHANGE_TABLES: TableDef[] = [
  changeRequest, changeTask, changeModel, changeTemplate, changeWindow, cab, cabMeeting, cabAgendaItem, changeConflict, changeOutage, changePir,
  riskQuestion, changeLockdown, successScore, changeConfig,
];
