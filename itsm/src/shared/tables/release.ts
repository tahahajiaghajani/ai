// Tables of release and deployment management (docs/modules/release_FA.md, catalogue docs/catalog/g3_change.md
// «Module: release»): the release record (major / minor / patch / emergency) with its lifecycle draft → planning →
// build → test → readiness (go/no-go) → deploying → early life support → review → closed, its tasks, the versioned
// templates and policies, the readiness checks (a library of named checks and their results per release), go/no-go
// decisions, deployments per environment (shared with DevOps), the environment registry and test-environment
// bookings, release windows (slots of the release train), audience-specific release notes, defects, feature flags,
// the definitive media library (artifacts) and the module's settings row.
//
// A release groups change requests, problems it fixes and work items through typed links (`release_includes`,
// `fixes`), never by copying their data; deployments name their change. Behaviour lives in
// src/server/modules/release; pure logic shared with the screens in src/shared/release/logic.ts; the screens in
// src/ui/modules/release. Imported by the UI: keep it free of server imports.
import type { FieldDef, Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES, TASK_FIELDS, TASK_SCOPE } from "../model/task";
import { registerLinkKind } from "../model/links";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

/** Release types (tenant-editable list `release.type`; the logic knows the four built-in values). */
export const RELEASE_TYPES: Option[] = [
  { value: "major", label: "عمده", color: "red", order: 1 },
  { value: "minor", label: "جزئی", color: "blue", order: 2 },
  { value: "patch", label: "وصله", color: "green", order: 3 },
  { value: "emergency", label: "اضطراری", color: "orange", order: 4 },
];

/** Go/no-go decision of a release (static: the guard and the board depend on these values). */
export const GO_DECISIONS: Option[] = [
  { value: "pending", label: "تصمیم گرفته نشده", color: "gray", order: 1 },
  { value: "go", label: "اجرا (Go)", color: "green", order: 2 },
  { value: "go_with_conditions", label: "اجرا با شرط", color: "gold", order: 3 },
  { value: "no_go", label: "توقف (No-Go)", color: "red", order: 4 },
];

/** Risk bands of the deterministic release risk score (REL-015). */
export const RISK_BANDS: Option[] = [
  { value: "low", label: "کم", color: "green", order: 1 },
  { value: "medium", label: "متوسط", color: "gold", order: 2 },
  { value: "high", label: "زیاد", color: "orange", order: 3 },
  { value: "very_high", label: "بسیار زیاد", color: "red", order: 4 },
];

/** Outcome of a release (`close_code`, tenant-editable list `release.close_code`). */
export const RELEASE_CLOSE_CODES: Option[] = [
  { value: "successful", label: "موفق", color: "green", order: 1 },
  { value: "successful_issues", label: "موفق با مشکل", color: "gold", order: 2 },
  { value: "rolled_back", label: "بازگردانده شد", color: "orange", order: 3 },
  { value: "failed", label: "ناموفق", color: "red", order: 4 },
  { value: "canceled", label: "لغو شد", color: "gray", order: 5 },
];
/** Outcomes that count as a failed release (success rate, risk calibration). */
export const RELEASE_FAILED_CODES = ["rolled_back", "failed"];

/** Phases of release work (task phases and the phase a readiness check is bound to). */
export const RELEASE_PHASES: Option[] = [
  { value: "planning", label: "برنامه‌ریزی", color: "blue", order: 1 },
  { value: "build", label: "ساخت", color: "teal", order: 2 },
  { value: "test", label: "آزمون", color: "purple", order: 3 },
  { value: "readiness", label: "آمادگی", color: "gold", order: 4 },
  { value: "deploy", label: "استقرار", color: "orange", order: 5 },
  { value: "training", label: "آموزش", color: "indigo", order: 6 },
  { value: "communication", label: "اطلاع‌رسانی", color: "magenta", order: 7 },
  { value: "review", label: "بازبینی", color: "gray", order: 8 },
];

/** Automatic rules of readiness checks (REL-013); `condition` tests the release record, `manual` waits for a person. */
export const CHECK_RULES: Option[] = [
  { value: "tasks_done", label: "کارهای الزامی انجام شده است" },
  { value: "changes_authorized", label: "تغییرهای انتشار مجاز شده‌اند" },
  { value: "approvals_complete", label: "تأییدهای انتشار کامل است" },
  { value: "test_deploy_ok", label: "استقرار موفق در محیط آزمون یا پیش‌تولید" },
  { value: "no_open_critical_defects", label: "نقص بحرانی یا مهم باز نمانده است" },
  { value: "rollback_plan", label: "برنامهٔ بازگشت نوشته شده است" },
  { value: "release_notes", label: "یادداشت انتشار آماده است" },
  { value: "no_freeze", label: "پنجرهٔ انتشار با دورهٔ انجماد یا ممنوعیت تداخل ندارد" },
  { value: "condition", label: "شرط روی رکورد انتشار" },
  { value: "manual", label: "بررسی دستی" },
];

/** Result of one readiness check on one release. */
export const CHECK_STATUSES: Option[] = [
  { value: "pending", label: "بررسی نشده", color: "gray", order: 1 },
  { value: "pass", label: "قبول", color: "green", order: 2 },
  { value: "fail", label: "رد", color: "red", order: 3 },
  { value: "waived", label: "چشم‌پوشی‌شده", color: "gold", order: 4 },
  { value: "na", label: "نامربوط", color: "gray", order: 5 },
];
/** Statuses that let a release pass its gate. */
export const CHECK_PASSING = ["pass", "waived", "na"];

export const ENV_KINDS: Option[] = [
  { value: "development", label: "توسعه", color: "gray", order: 1 },
  { value: "test", label: "آزمون", color: "blue", order: 2 },
  { value: "uat", label: "آزمون پذیرش کاربر (UAT)", color: "indigo", order: 3 },
  { value: "staging", label: "پیش‌تولید", color: "purple", order: 4 },
  { value: "production", label: "عملیاتی", color: "red", order: 5 },
  { value: "dr", label: "بازیابی از فاجعه (DR)", color: "orange", order: 6 },
];

/** What an environment requires before a deployment starts (REL-019/020). */
export const ENV_PROTECTIONS: Option[] = [
  { value: "open", label: "آزاد", color: "green", order: 1 },
  { value: "approval", label: "تأیید لازم", color: "gold", order: 2 },
  { value: "change", label: "تغییر مجاز و تأیید لازم", color: "red", order: 3 },
];

/** Data classes an environment may hold (no production personal data in test, ISO 27001 A.8.33). */
export const DATA_CLASSES: Option[] = [
  { value: "synthetic", label: "دادهٔ ساختگی" },
  { value: "masked", label: "دادهٔ پوشانده‌شده" },
  { value: "production", label: "دادهٔ واقعی" },
];

export const DEPLOY_APPROACHES: Option[] = [
  { value: "big_bang", label: "یک‌باره" },
  { value: "phased", label: "مرحله‌ای (موج‌ها)" },
  { value: "rolling", label: "غلتان" },
  { value: "canary", label: "قناری" },
  { value: "blue_green", label: "آبی و سبز" },
  { value: "ring", label: "حلقه‌ای" },
  { value: "pull", label: "کششی (سلف‌سرویس)" },
  { value: "continuous", label: "پیوسته (خط لوله)" },
];

/** Planned or unplanned remediation (DORA rework rate, DEV-012). */
export const DEPLOY_KINDS: Option[] = [
  { value: "planned", label: "برنامه‌ریزی‌شده", color: "blue", order: 1 },
  { value: "remediation", label: "رفع اضطراری (هات‌فیکس)", color: "orange", order: 2 },
];

export const VERIFICATION_STATUSES: Option[] = [
  { value: "not_run", label: "انجام نشده", color: "gray", order: 1 },
  { value: "passed", label: "سالم", color: "green", order: 2 },
  { value: "failed", label: "ناسالم", color: "red", order: 3 },
];

export const NOTE_AUDIENCES: Option[] = [
  { value: "end_users", label: "کاربران نهایی", color: "blue", order: 1 },
  { value: "operations", label: "عملیات و پشتیبانی", color: "teal", order: 2 },
  { value: "management", label: "مدیران", color: "purple", order: 3 },
];
export const NOTE_LANGUAGES: Option[] = [
  { value: "fa", label: "فارسی" },
  { value: "en", label: "انگلیسی" },
];
export const NOTE_STATES: Option[] = [
  { value: "draft", label: "پیش‌نویس", color: "gray", order: 1 },
  { value: "published", label: "منتشرشده", color: "green", order: 2 },
];

export const WINDOW_KINDS: Option[] = [
  { value: "slot", label: "پنجرهٔ انتشار", color: "blue", order: 1 },
  { value: "release_freeze", label: "توقف انتشار", color: "red", order: 2 },
];
/** Recurrences understood by the shared window expansion (`occurrences` of @shared/change/logic). */
export const WINDOW_RECURRENCES: Option[] = [
  { value: "none", label: "یک‌بار" },
  { value: "weekly", label: "هفتگی" },
  { value: "monthly", label: "ماهانه (همان روز ماه)" },
  { value: "monthly_last", label: "آخرین روز هر ماه" },
  { value: "yearly", label: "سالانه" },
];
export const WEEKDAY_OPTIONS: Option[] = [
  { value: "6", label: "شنبه" },
  { value: "0", label: "یکشنبه" },
  { value: "1", label: "دوشنبه" },
  { value: "2", label: "سه‌شنبه" },
  { value: "3", label: "چهارشنبه" },
  { value: "4", label: "پنجشنبه" },
  { value: "5", label: "جمعه" },
];

export const DEFECT_SEVERITIES: Option[] = [
  { value: "critical", label: "بحرانی", color: "red", order: 1 },
  { value: "high", label: "مهم", color: "orange", order: 2 },
  { value: "medium", label: "متوسط", color: "gold", order: 3 },
  { value: "low", label: "کم", color: "green", order: 4 },
];

export const FLAG_STATES: Option[] = [
  { value: "off", label: "خاموش", color: "gray", order: 1 },
  { value: "partial", label: "عرضهٔ تدریجی", color: "gold", order: 2 },
  { value: "on", label: "روشن برای همه", color: "green", order: 3 },
  { value: "killed", label: "قطع اضطراری", color: "red", order: 4 },
];

export const ARTIFACT_STATES: Option[] = [
  { value: "draft", label: "ثبت‌شده", color: "gray", order: 1 },
  { value: "approved", label: "مجاز", color: "green", order: 2 },
  { value: "revoked", label: "لغو مجوز", color: "red", order: 3 },
];

/** Default options of the module's choice lists (registered once in src/shared/tables/index.ts). */
export const RELEASE_CHOICE_LISTS: Record<string, Option[]> = {
  "release.type": RELEASE_TYPES,
  "release.close_code": RELEASE_CLOSE_CODES,
  "release_task.phase": RELEASE_PHASES,
  "deployment.close_code": [
    { value: "successful", label: "موفق", color: "green", order: 1 },
    { value: "failed", label: "ناموفق", color: "red", order: 2 },
    { value: "rolled_back", label: "بازگردانده شد", color: "orange", order: 3 },
    { value: "canceled", label: "لغو شد", color: "gray", order: 4 },
  ],
  "defect.close_code": [
    { value: "fixed", label: "رفع شد", color: "green", order: 1 },
    { value: "not_reproducible", label: "تکرارپذیر نیست", color: "gray", order: 2 },
    { value: "duplicate", label: "تکراری", color: "gray", order: 3 },
    { value: "wont_fix", label: "رفع نمی‌شود", color: "orange", order: 4 },
  ],
};

// links between a release and the records it delivers (shown on both records with their direction's label)
registerLinkKind("release_includes", { out: "شامل", in: "در انتشارِ" });
registerLinkKind("els_incident", { out: "در پشتیبانی آغازینِ", in: "رخداد پشتیبانی آغازین" });
registerLinkKind("after_deployment", { out: "پس از استقرارِ", in: "رخداد پس از استقرار" });

/** Settings of the module (its row, else these). */
export const RELEASE_CONFIG_DEFAULTS = {
  els_days: 14,
  failure_window_hours: 24,
  auto_advance: true,
  release_on_production: true,
  update_cmdb_versions: true,
  tag_els_incidents: true,
  default_change_template_id: null as string | null,
};
export type ReleaseConfig = typeof RELEASE_CONFIG_DEFAULTS;

// ---------------------------------------------------------------------------------------------------------------
// The release

const MAIN = "اصلی";
const SCOPE_SECTION = "دامنه و خدمت";
const SCHEDULE = "زمان‌بندی";
const PLANS = "برنامه‌ها";
const READY = "آمادگی و ریسک";
const CLOSURE = "نتیجه و بازبینی";

/** Task fields a release does not use as such: kept in the table, left out of its form. */
const HIDDEN_TASK = ["requested_for", "channel", "offering_id", "due_at", "escalation", "knowledge", "time_worked", "impact", "urgency", "category", "subcategory", "location_id", "parent_id"];

export const RELEASE_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "planning", label: "برنامه‌ریزی", category: "active", color: "indigo" },
    { value: "build", label: "ساخت", category: "active", color: "teal" },
    { value: "test", label: "آزمون", category: "active", color: "purple" },
    { value: "readiness", label: "آمادگی و تصمیم", category: "waiting", color: "gold" },
    { value: "deploying", label: "در حال استقرار", category: "active", color: "orange" },
    { value: "els", label: "پشتیبانی آغازین", category: "resolved", color: "green" },
    { value: "review", label: "بازبینی", category: "resolved", color: "teal" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "on_hold", label: "متوقف", category: "waiting", color: "gold" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "planning", label: "شروع برنامه‌ریزی" },
    { from: ["draft", "planning"], to: "build", label: "شروع ساخت" },
    { from: ["build"], to: "test", label: "شروع آزمون" },
    { from: ["test"], to: "readiness", label: "بررسی آمادگی" },
    // the emergency procedure: straight to the go/no-go decision (REL-002)
    { from: ["draft", "planning", "build"], to: "readiness", label: "رویهٔ اضطراری: تصمیم فوری", guard: "release_emergency" },
    { from: ["readiness"], to: "deploying", label: "شروع استقرار", guard: "release_go" },
    { from: ["readiness"], to: "test", label: "بازگشت به آزمون" },
    { from: ["readiness"], to: "build", label: "بازگشت به ساخت" },
    { from: ["deploying"], to: "els", label: "استقرار انجام شد" },
    { from: ["deploying"], to: "test", label: "بازگشت (برگشت استقرار)" },
    { from: ["els"], to: "review", label: "پایان پشتیبانی آغازین" },
    { from: ["deploying"], to: "review", label: "رفتن به بازبینی" },
    { from: ["review"], to: "closed", label: "بستن", requires: ["close_code", "close_notes"] },
    { from: ["review", "els"], to: "deploying", label: "استقرار دوباره" },
    { from: ["planning", "build", "test", "readiness"], to: "on_hold", label: "توقف یا انجماد", requires: ["hold_reason"] },
    { from: ["on_hold"], to: "planning", label: "ادامه: برنامه‌ریزی" },
    { from: ["on_hold"], to: "build", label: "ادامه: ساخت" },
    { from: ["on_hold"], to: "test", label: "ادامه: آزمون" },
    { from: ["draft", "planning", "build", "test", "readiness", "on_hold"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};
/** States in which a release is still being prepared (no production deployment yet). */
export const RELEASE_PREPARING = ["draft", "planning", "build", "test", "readiness", "on_hold"];
/** States of a released release. */
export const RELEASE_LIVE = ["els", "review", "closed"];

const release: TableDef = {
  key: "release",
  table: "sm_releases",
  label: "انتشار",
  plural: "انتشارها",
  icon: "rocket",
  module: "release",
  area: "release",
  description: "انتشار نسخهٔ تازهٔ یک خدمت یا محصول: دامنه، کارها، آمادگی و تصمیم اجرا، استقرار در محیط‌ها و پشتیبانی آغازین",
  extends: "task",
  numbered: { prefix: "REL", pad: 7 },
  display: "short_description",
  fields: [
    ...TASK_FIELDS.filter((f) => HIDDEN_TASK.includes(f.name)).map((f) => ({ ...f, hidden: true })),
    { name: "short_description", label: "عنوان انتشار", type: "string", section: MAIN },
    { name: "version_name", label: "نسخه", type: "string", maxLength: 60, ltr: true, list: true, search: true, filter: true, span: 8, section: MAIN, help: "معنایی (2.4.0) یا تقویمی (1405.02)" },
    { name: "type", label: "نوع انتشار", type: "choice", choices: "release.type", required: true, default: "minor", list: true, filter: true, sort: true, index: true, span: 8, section: MAIN },
    { name: "template_id", label: "الگو", type: "ref", ref: "release_template", refFilter: { f: "active", op: "eq", v: true }, filter: true, span: 8, section: MAIN, help: "کارها، بررسی‌ها و برنامه‌های الگو هنگام ثبت رونوشت می‌شود" },
    { name: "description", label: "شرح و هدف انتشار", type: "markdown", section: MAIN },
    { name: "release_manager_id", label: "مدیر انتشار", type: "user", default: "$me", list: true, filter: true, index: true, span: 8, section: MAIN },
    { name: "assigned_to", label: "هماهنگ‌کنندهٔ انتشار", type: "user", section: MAIN },
    { name: "assignment_group_id", label: "تیم انتشار", type: "group", section: MAIN },
    { name: "caller_id", label: "درخواست‌دهنده", type: "user", section: MAIN },
    { name: "priority", label: "اولویت", type: "choice", section: MAIN },
    { name: "parent_release_id", label: "قطار یا انتشار والد", type: "ref", ref: "$self", filter: true, index: true, span: 8, section: MAIN },
    { name: "project_id", label: "پروژه", type: "ref", ref: "project", filter: true, index: true, span: 8, section: MAIN },
    { name: "stakeholders", label: "ذی‌نفعان برای اطلاع‌رسانی", type: "users", span: 16, section: MAIN },

    { name: "service_id", label: "خدمت یا محصول", type: "ref", ref: "service", list: true, section: SCOPE_SECTION },
    { name: "ci_id", label: "برنامهٔ کاربردی (CI)", type: "ref", ref: "ci", section: SCOPE_SECTION },
    { name: "affected_cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 12, section: SCOPE_SECTION },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 12, section: SCOPE_SECTION },
    { name: "impacted_services", label: "خدمت‌های اثرپذیر (محاسبه‌شده)", type: "refs", ref: "service", readonly: true, span: 12, section: SCOPE_SECTION, help: "از نمودار وابستگی پیکربندی‌ها حساب می‌شود" },
    { name: "known_errors_accepted", label: "خطاهای شناخته‌شدهٔ پذیرفته‌شده", type: "refs", ref: "known_error", span: 12, section: SCOPE_SECTION, help: "نقص‌هایی که با همین انتشار به محیط عملیاتی می‌روند" },
    { name: "changes_total", label: "تغییرهای انتشار", type: "int", readonly: true, default: 0, audit: false, span: 6, section: SCOPE_SECTION },
    { name: "changes_open", label: "تغییرهای باز", type: "int", readonly: true, default: 0, audit: false, span: 6, section: SCOPE_SECTION },
    { name: "problems_fixed", label: "مشکل‌های رفع‌شده", type: "int", readonly: true, default: 0, audit: false, span: 6, section: SCOPE_SECTION },

    { name: "planned_start", label: "شروع برنامه‌ریزی‌شده", type: "datetime", list: true, sort: true, filter: true, index: true, span: 8, section: SCHEDULE },
    { name: "planned_end", label: "تاریخ عرضهٔ برنامه‌ریزی‌شده", type: "datetime", list: true, sort: true, filter: true, index: true, span: 8, section: SCHEDULE },
    { name: "readiness_target_at", label: "موعد آمادگی", type: "datetime", sort: true, filter: true, span: 8, section: SCHEDULE },
    { name: "window_id", label: "پنجرهٔ انتشار", type: "ref", ref: "release_window", refFilter: { f: "kind", op: "eq", v: "slot" }, filter: true, span: 8, section: SCHEDULE },
    { name: "actual_start", label: "شروع واقعی کار", type: "datetime", sort: true, span: 8, section: SCHEDULE },
    { name: "actual_end", label: "پایان واقعی کار", type: "datetime", sort: true, span: 8, section: SCHEDULE },
    { name: "deployed_at", label: "زمان استقرار در محیط عملیاتی", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: SCHEDULE },
    { name: "released_at", label: "زمان عرضه به کاربران", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: SCHEDULE, help: "جدا از استقرار: با پرچم ویژگی ممکن است دیرتر باشد" },
    { name: "els_days", label: "مدت پشتیبانی آغازین (روز)", type: "int", min: 0, max: 180, span: 8, section: SCHEDULE },
    { name: "els_end_at", label: "پایان پشتیبانی آغازین", type: "datetime", readonly: true, sort: true, span: 8, section: SCHEDULE },
    { name: "hold_reason", label: "دلیل توقف یا انجماد", type: "text", span: 16, section: SCHEDULE },
    { name: "frozen_until", label: "منجمد تا", type: "datetime", span: 8, section: SCHEDULE },

    { name: "build_plan", label: "برنامهٔ ساخت", type: "markdown", span: 24, tab: PLANS },
    { name: "test_plan", label: "برنامهٔ آزمون", type: "markdown", span: 24, tab: PLANS },
    { name: "deployment_plan", label: "برنامهٔ استقرار", type: "markdown", span: 24, tab: PLANS, ai: { index: true } },
    { name: "rollback_plan", label: "برنامهٔ بازگشت", type: "markdown", span: 24, tab: PLANS, ai: { index: true } },
    { name: "communication_plan", label: "برنامهٔ اطلاع‌رسانی و آموزش", type: "markdown", span: 24, tab: PLANS },
    { name: "release_notes", label: "یادداشت انتشار", type: "markdown", search: true, span: 24, tab: PLANS, ai: { index: true } },

    { name: "go_no_go", label: "تصمیم اجرا", type: "choice", choices: GO_DECISIONS, readonly: true, default: "pending", list: true, filter: true, span: 8, tab: READY },
    { name: "go_no_go_at", label: "زمان تصمیم", type: "datetime", readonly: true, span: 8, tab: READY },
    { name: "go_conditions", label: "شرط‌های اجرا", type: "text", readonly: true, span: 24, tab: READY },
    { name: "checks_total", label: "بررسی‌های آمادگی", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: READY },
    { name: "checks_failed", label: "بررسی‌های ردشده", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: READY },
    { name: "checks_pending", label: "بررسی‌های مانده", type: "int", readonly: true, default: 0, audit: false, span: 6, tab: READY },
    { name: "readiness_pct", label: "آمادگی (درصد)", type: "int", readonly: true, default: 0, audit: false, list: true, sort: true, span: 6, tab: READY },
    { name: "checks_run_at", label: "آخرین اجرای بررسی‌ها", type: "datetime", readonly: true, audit: false, span: 8, tab: READY },
    { name: "risk_score", label: "امتیاز ریسک", type: "int", readonly: true, sort: true, filter: true, audit: false, span: 8, tab: READY },
    { name: "risk_band", label: "ریسک انتشار", type: "choice", choices: RISK_BANDS, readonly: true, list: true, filter: true, sort: true, span: 8, tab: READY },
    { name: "risk_factors", label: "عامل‌های ریسک", type: "json", system: true, hidden: true, audit: false, default: [], tab: READY },
    { name: "approval", label: "وضعیت تأیید", type: "choice", choices: APPROVAL_STATES, tab: READY },

    { name: "close_code", label: "نتیجهٔ انتشار", type: "choice", choices: "$table.close_code", tab: CLOSURE },
    { name: "close_notes", label: "یادداشت بستن", type: "text", tab: CLOSURE },
    { name: "lessons", label: "درس‌آموخته‌ها و اقدام‌ها", type: "markdown", span: 24, tab: CLOSURE, ai: { index: true } },
    { name: "els_incidents", label: "رخدادهای دورهٔ پشتیبانی آغازین", type: "int", readonly: true, default: 0, audit: false, span: 8, tab: CLOSURE },
    { name: "rolled_back", label: "بازگردانده شد", type: "bool", readonly: true, default: false, filter: true, span: 8, tab: CLOSURE },
    { name: "on_schedule", label: "به‌موقع عرضه شد", type: "bool", readonly: true, filter: true, span: 8, tab: CLOSURE },
    { name: "state_before_hold", label: "مرحلهٔ پیش از توقف", type: "string", maxLength: 40, system: true, hidden: true, audit: false },
  ],
  states: RELEASE_STATES,
  scope: {
    ...TASK_SCOPE,
    // the release manager works the release like its coordinator
    own: [...(TASK_SCOPE.own ?? []), "release_manager_id"],
    requester: ["caller_id", "opened_by"],
    requesterWritable: ["description", "watch_list"],
    requesterTransitions: [{ from: ["draft"], to: "canceled" }],
  },
  features: { sla: true, approvals: true, rag: true, kanban: "state", calendar: { start: "planned_start", end: "planned_end" } },
  ai: { title: "short_description", text: ["version_name", "description", "release_notes", "deployment_plan", "rollback_plan", "lessons"] },
  form: {
    sections: [MAIN, SCOPE_SECTION, SCHEDULE],
    tabs: ["جزئیات", PLANS, READY, CLOSURE],
    related: [
      { table: "release_task", field: "release_id", label: "کارهای انتشار", columns: ["number", "short_description", "phase", "state", "assigned_to", "due_at"] },
      { table: "deployment", field: "release_id", label: "استقرارها", columns: ["number", "environment_id", "state", "artifact_version", "actual_end", "assigned_to"] },
      { table: "release_check_result", field: "release_id", label: "بررسی‌های آمادگی", columns: ["name", "phase", "status", "message", "blocking", "evaluated_at"] },
      { table: "release_decision", field: "release_id", label: "تصمیم‌های اجرا", columns: ["decision", "decided_by", "decided_at", "conditions"] },
      { table: "release_note", field: "release_id", label: "یادداشت‌های انتشار", columns: ["title", "audience", "language", "state", "published_at"] },
      { table: "defect", field: "release_id", label: "نقص‌ها", columns: ["number", "short_description", "severity", "state", "assigned_to"] },
      { table: "release", field: "parent_release_id", label: "انتشارهای فرزند", columns: ["number", "short_description", "version_name", "state", "planned_end"] },
    ],
  },
  list: { columns: ["number", "short_description", "version_name", "type", "state", "service_id", "planned_end", "risk_band", "readiness_pct", "release_manager_id"], order: "planned_end" },
};

// ---------------------------------------------------------------------------------------------------------------
// Release tasks

export const RELEASE_TASK_STATES: StateModel = {
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
    { from: ["open", "blocked"], to: "in_progress", label: "شروع", guard: "release_task_ready" },
    { from: ["open", "in_progress"], to: "blocked", label: "مانع دارد" },
    { from: ["open", "in_progress", "blocked"], to: "done", label: "انجام شد", guard: "release_task_ready" },
    { from: ["done"], to: "in_progress", label: "بازگشایی" },
    { from: ["open", "in_progress", "blocked"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};
/** Task states that no longer hold up a release. */
export const RELEASE_TASK_DONE = ["done", "canceled"];

const TASK_HIDDEN = ["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "approval", "escalation", "parent_id", "close_code", "caller_id", "location_id", "service_id"];

const releaseTask: TableDef = {
  key: "release_task",
  table: "sm_release_tasks",
  label: "کار انتشار",
  plural: "کارهای انتشار",
  icon: "list-checks",
  module: "release",
  area: "release",
  description: "کارهای هر فاز انتشار — ساخت، آزمون، مستندسازی، آموزش، آماده‌سازی استقرار و اطلاع‌رسانی — با وابستگی و موعد",
  extends: "task",
  numbered: { prefix: "RTASK", pad: 7 },
  display: "short_description",
  fields: [
    ...TASK_FIELDS.filter((f) => TASK_HIDDEN.includes(f.name)).map((f) => ({ ...f, hidden: true })),
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "phase", label: "فاز", type: "choice", choices: "release_task.phase", default: "build", list: true, filter: true, sort: true, span: 6 },
    { name: "mandatory", label: "الزامی", type: "bool", default: true, filter: true, span: 6, help: "کار الزامی باز، بررسی «کارهای الزامی» را رد می‌کند" },
    { name: "depends_on", label: "وابسته به", type: "refs", ref: "$self", span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, span: 6 },
    { name: "planned_hours", label: "برآورد (ساعت)", type: "decimal", min: 0, span: 6 },
    { name: "release_manager_id", label: "مدیر انتشار", type: "user", system: true, hidden: true },
  ],
  states: RELEASE_TASK_STATES,
  scope: { ...TASK_SCOPE, own: [...(TASK_SCOPE.own ?? []), "release_manager_id"], requester: [] },
  features: { kanban: "state" },
  list: { columns: ["number", "short_description", "release_id", "phase", "state", "assigned_to", "due_at"], order: "due_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Templates and policies (versioned definitions)

const releaseTemplate: TableDef = {
  key: "release_template",
  table: "sm_release_templates",
  label: "الگوی انتشار",
  plural: "الگوهای انتشار",
  icon: "layout-template",
  module: "release",
  area: "release",
  description: "طرح آمادهٔ یک نوع انتشار: کارهای هر فاز، بررسی‌های آمادگی و برنامه‌ها؛ هنگام ثبت انتشار رونوشت می‌شود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 16 },
    { name: "type", label: "برای نوع", type: "choice", choices: "release.type", list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "tasks", label: "کارها", type: "json", default: [], span: 24, help: "[{ \"short_description\": \"…\", \"phase\": \"build\", \"mandatory\": true, \"offset_days\": 0, \"planned_hours\": 4 }]" },
    { name: "checks", label: "بررسی‌های آمادگی", type: "refs", ref: "release_check", span: 24, help: "خالی: بررسی‌های فعال هم‌نوع" },
    { name: "build_plan", label: "برنامهٔ ساخت", type: "markdown", span: 24 },
    { name: "test_plan", label: "برنامهٔ آزمون", type: "markdown", span: 24 },
    { name: "deployment_plan", label: "برنامهٔ استقرار", type: "markdown", span: 24 },
    { name: "rollback_plan", label: "برنامهٔ بازگشت", type: "markdown", span: 24 },
    { name: "communication_plan", label: "برنامهٔ اطلاع‌رسانی و آموزش", type: "markdown", span: 24 },
    { name: "els_days", label: "پشتیبانی آغازین (روز)", type: "int", min: 0, max: 180, span: 8 },
    { name: "services", label: "فقط برای خدمت‌ها", type: "refs", ref: "service", span: 16, help: "خالی: همهٔ خدمت‌ها" },
    { name: "revision", label: "ویرایش", type: "int", readonly: true, default: 1, list: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
  ],
  scope: { public: true },
  list: { columns: ["name", "type", "revision", "active"], order: "name" },
};

const releasePolicy: TableDef = {
  key: "release_policy",
  table: "sm_release_policies",
  label: "خط‌مشی انتشار",
  plural: "خط‌مشی‌های انتشار",
  icon: "scroll-text",
  module: "release",
  area: "release",
  description: "خط‌مشی نسخه‌دار انتشار و استقرار برای هر نوع: دورهٔ تناوب، بررسی‌های الزامی، پشتیبانی آغازین، رویهٔ اضطراری",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 16 },
    { name: "type", label: "نوع انتشار", type: "choice", choices: "release.type", list: true, filter: true, span: 8, help: "خالی: همهٔ نوع‌ها" },
    { name: "cadence", label: "دورهٔ تناوب", type: "string", maxLength: 200, span: 12, placeholder: "قطار ماهانه، وصلهٔ هفتگی…" },
    { name: "mandatory_checks", label: "بررسی‌های الزامی", type: "refs", ref: "release_check", span: 12 },
    { name: "go_no_go_required", label: "تصمیم اجرا لازم است", type: "bool", default: true, span: 8 },
    { name: "els_days", label: "پشتیبانی آغازین (روز)", type: "int", min: 0, max: 180, span: 8 },
    { name: "min_lead_days", label: "کمترین فاصلهٔ ثبت تا عرضه (روز)", type: "int", min: 0, max: 365, span: 8 },
    { name: "transition_package", label: "بستهٔ انتقال خدمت لازم است", type: "bool", default: false, span: 8 },
    { name: "procedure", label: "رویه", type: "markdown", span: 24 },
    { name: "revision", label: "ویرایش", type: "int", readonly: true, default: 1, list: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
  ],
  scope: { public: true },
  list: { columns: ["name", "type", "cadence", "revision", "active"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Readiness: the library of checks and their results per release

const releaseCheck: TableDef = {
  key: "release_check",
  table: "sm_release_checks",
  label: "بررسی آمادگی",
  plural: "بررسی‌های آمادگی",
  icon: "list-checks",
  module: "release",
  area: "release",
  description: "یک بررسی نام‌دار از فهرست آمادگی: قاعدهٔ خودکار، شرط روی انتشار یا بررسی دستی؛ با فاز و اثر بازدارنده",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 16 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 60, ltr: true, unique: true, list: true, span: 8 },
    { name: "rule", label: "قاعده", type: "choice", choices: CHECK_RULES, required: true, default: "manual", list: true, filter: true, span: 8 },
    { name: "phase", label: "فاز", type: "choice", choices: RELEASE_PHASES, default: "readiness", list: true, filter: true, span: 8 },
    { name: "blocking", label: "بازدارنده", type: "bool", default: true, list: true, filter: true, span: 8, help: "رد شدن آن جلوی شروع استقرار را می‌گیرد مگر با چشم‌پوشی" },
    { name: "condition", label: "شرط (برای قاعدهٔ شرط)", type: "conditions", condTable: "release", span: 24 },
    { name: "types", label: "برای نوع‌ها", type: "multichoice", choices: "release.type", span: 12, help: "خالی: همهٔ نوع‌ها" },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح و شواهد لازم", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "rule", "phase", "blocking", "active"], order: "sort_order,name" },
};

/** Scope columns a row hanging off a release copies from it (so it is read by whoever works the release). */
const RELEASE_COPY: FieldDef[] = [
  { name: "assignment_group_id", label: "تیم انتشار", type: "group", system: true, hidden: true },
  { name: "assigned_to", label: "هماهنگ‌کننده", type: "user", system: true, hidden: true },
  { name: "release_manager_id", label: "مدیر انتشار", type: "user", system: true, hidden: true },
];
const RELEASE_CHILD_SCOPE = { own: ["release_manager_id", "assigned_to"], requester: [], group: "assignment_group_id" };

const checkResult: TableDef = {
  key: "release_check_result",
  table: "sm_release_check_results",
  label: "نتیجهٔ بررسی آمادگی",
  plural: "نتیجه‌های بررسی آمادگی",
  icon: "clipboard-check",
  module: "release",
  area: "release",
  description: "نتیجهٔ یک بررسی آمادگی برای یک انتشار: قبول، رد، چشم‌پوشی با دلیل و تأییدکننده، یا در انتظار",
  display: "name",
  fields: [
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "check_id", label: "بررسی", type: "ref", ref: "release_check", required: true, filter: true, span: 12 },
    { name: "name", label: "نام", type: "string", maxLength: 160, readonly: true, list: true, search: true, span: 16 },
    { name: "rule", label: "قاعده", type: "choice", choices: CHECK_RULES, readonly: true, filter: true, span: 8 },
    { name: "phase", label: "فاز", type: "choice", choices: RELEASE_PHASES, readonly: true, list: true, filter: true, span: 8 },
    { name: "blocking", label: "بازدارنده", type: "bool", readonly: true, default: true, list: true, filter: true, span: 8 },
    { name: "status", label: "نتیجه", type: "choice", choices: CHECK_STATUSES, default: "pending", list: true, filter: true, sort: true, span: 8 },
    { name: "message", label: "پیام", type: "text", list: true, span: 24 },
    { name: "evidence", label: "شواهد", type: "text", span: 24 },
    { name: "evaluated_at", label: "زمان بررسی", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "checked_by", label: "بررسی‌کننده", type: "user", readonly: true, span: 8 },
    { name: "waiver_reason", label: "دلیل چشم‌پوشی", type: "text", span: 24 },
    { name: "waived_by", label: "چشم‌پوشی توسط", type: "user", readonly: true, span: 8 },
    ...RELEASE_COPY,
  ],
  unique: [["release_id", "check_id"]],
  scope: RELEASE_CHILD_SCOPE,
  list: { columns: ["name", "release_id", "phase", "status", "blocking", "evaluated_at"], order: "release_id,phase" },
};

const releaseDecision: TableDef = {
  key: "release_decision",
  table: "sm_release_decisions",
  label: "تصمیم اجرا",
  plural: "تصمیم‌های اجرا",
  icon: "gavel",
  module: "release",
  area: "release",
  description: "ثبت تصمیم اجرا یا توقف (Go/No-Go) با شرط‌ها، دلیل، تصمیم‌گیرنده و تصویر وضعیت آمادگی در همان لحظه",
  display: "decision",
  fields: [
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "decision", label: "تصمیم", type: "choice", choices: GO_DECISIONS.filter((o) => o.value !== "pending"), required: true, list: true, filter: true, span: 12 },
    { name: "conditions", label: "شرط‌ها", type: "text", span: 24 },
    { name: "rationale", label: "دلیل", type: "text", required: true, span: 24 },
    { name: "decided_by", label: "تصمیم‌گیرنده", type: "user", readonly: true, list: true, span: 8 },
    { name: "decided_at", label: "زمان تصمیم", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "via", label: "از راه", type: "choice", choices: [{ value: "manual", label: "ثبت مدیر انتشار" }, { value: "approval", label: "گردش تأیید" }], readonly: true, span: 8 },
    { name: "snapshot", label: "تصویر آمادگی", type: "json", system: true, default: {}, span: 24 },
    ...RELEASE_COPY,
  ],
  scope: RELEASE_CHILD_SCOPE,
  list: { columns: ["release_id", "decision", "decided_by", "decided_at"], order: "-decided_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Environments, bookings and windows

const environment: TableDef = {
  key: "release_environment",
  table: "sm_release_environments",
  label: "محیط",
  plural: "محیط‌ها",
  icon: "layers",
  module: "release",
  area: "release",
  description: "محیط‌های توسعه، آزمون، پیش‌تولید و عملیاتی: ترتیب در خط لوله، حفاظت، تأیید لازم و رده‌های دادهٔ مجاز",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 40, ltr: true, unique: true, list: true, span: 6, help: "نامی که خط لوله‌ها می‌فرستند (prod، staging…)" },
    { name: "kind", label: "نوع", type: "choice", choices: ENV_KINDS, required: true, default: "test", list: true, filter: true, span: 6 },
    { name: "aliases", label: "نام‌های دیگر", type: "tags", span: 12, help: "نام‌هایی که ابزارهای مختلف برای همین محیط به کار می‌برند" },
    { name: "protection", label: "حفاظت", type: "choice", choices: ENV_PROTECTIONS, default: "open", list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب در خط لوله", type: "int", default: 100, list: true, sort: true, span: 6 },
    { name: "allowed_data", label: "دادهٔ مجاز", type: "multichoice", choices: DATA_CLASSES, span: 12 },
    { name: "owner_id", label: "مالک", type: "user", span: 6 },
    { name: "assignment_group_id", label: "گروه پشتیبانی", type: "group", span: 6 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", span: 12 },
    { name: "bookable", label: "رزروپذیر", type: "bool", default: false, filter: true, span: 6 },
    { name: "color", label: "رنگ", type: "color", span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "کاربرد", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "key", "kind", "protection", "sort_order", "active"], order: "sort_order,name" },
};

export const PRODUCTION_KINDS = ["production"];

const booking: TableDef = {
  key: "environment_booking",
  table: "sm_environment_bookings",
  label: "رزرو محیط",
  plural: "رزروهای محیط",
  icon: "calendar-check",
  module: "release",
  area: "release",
  description: "رزرو محیط‌های مشترک آزمون و پیش‌تولید برای یک بازه، با بررسی هم‌پوشانی و آزادسازی خودکار",
  numbered: { prefix: "EB", pad: 6 },
  display: "purpose",
  fields: [
    { name: "environment_id", label: "محیط", type: "ref", ref: "release_environment", refFilter: { f: "bookable", op: "eq", v: true }, required: true, list: true, filter: true, index: true, span: 12 },
    { name: "purpose", label: "منظور", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "requested_by", label: "رزروکننده", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", filter: true, span: 8 },
    { name: "start_at", label: "از", type: "datetime", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "end_at", label: "تا", type: "datetime", required: true, list: true, sort: true, span: 8 },
    { name: "notes", label: "توضیح", type: "text", span: 24 },
  ],
  states: {
    field: "state",
    initial: "requested",
    states: [
      { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
      { value: "approved", label: "تأییدشده", category: "waiting", color: "gold" },
      { value: "active", label: "در حال استفاده", category: "active", color: "teal" },
      { value: "released", label: "آزادشده", category: "closed", color: "gray" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["requested"], to: "approved", label: "تأیید" },
      { from: ["requested", "approved"], to: "active", label: "شروع استفاده" },
      { from: ["approved", "active"], to: "released", label: "آزادسازی" },
      { from: ["requested", "approved"], to: "canceled", label: "لغو" },
    ],
  },
  scope: { public: true, own: ["requested_by"], requester: [] },
  features: { calendar: { start: "start_at", end: "end_at" } },
  list: { columns: ["number", "environment_id", "purpose", "requested_by", "start_at", "end_at", "state"], order: "start_at" },
};

const releaseWindow: TableDef = {
  key: "release_window",
  table: "sm_release_windows",
  label: "پنجرهٔ انتشار",
  plural: "پنجره‌های انتشار",
  icon: "calendar-range",
  module: "release",
  area: "release",
  description: "پنجره‌های قطار انتشار (مثلاً هر پنجشنبهٔ آخر ماه) با ظرفیت، و دوره‌های توقف انتشار؛ تکرار به تقویم شمسی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: WINDOW_KINDS, required: true, default: "slot", list: true, filter: true, span: 6 },
    { name: "capacity", label: "ظرفیت (تعداد انتشار)", type: "int", min: 0, max: 100, span: 6, help: "خالی: بی‌سقف" },
    { name: "start_at", label: "شروع نخستین نوبت", type: "datetime", required: true, list: true, sort: true, span: 8 },
    { name: "end_at", label: "پایان نخستین نوبت", type: "datetime", required: true, list: true, span: 8 },
    { name: "recurrence", label: "تکرار", type: "choice", choices: WINDOW_RECURRENCES, default: "none", list: true, span: 8 },
    { name: "weekdays", label: "روزهای هفته", type: "multichoice", choices: WEEKDAY_OPTIONS, span: 12 },
    { name: "until", label: "تکرار تا", type: "date", span: 12 },
    { name: "types", label: "برای نوع‌ها", type: "multichoice", choices: "release.type", span: 12, help: "خالی: همهٔ نوع‌ها" },
    { name: "services", label: "برای خدمت‌ها", type: "refs", ref: "service", span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "kind", "recurrence", "start_at", "capacity", "active"], order: "kind,start_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Deployments (shared with DevOps)

export const DEPLOYMENT_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "pending_approval", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "in_progress", label: "در حال استقرار", category: "active", color: "orange" },
    { value: "succeeded", label: "موفق", category: "resolved", color: "green" },
    { value: "failed", label: "ناموفق", category: "resolved", color: "red" },
    { value: "rolled_back", label: "بازگردانده شد", category: "resolved", color: "magenta" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "pending_approval", label: "درخواست تأیید" },
    { from: ["pending_approval"], to: "planned", label: "بازگشت به برنامه" },
    { from: ["planned", "pending_approval"], to: "in_progress", label: "شروع استقرار", guard: "deployment_gate" },
    { from: ["in_progress"], to: "succeeded", label: "موفق" },
    { from: ["in_progress"], to: "failed", label: "ناموفق", requires: ["result_notes"] },
    { from: ["in_progress", "succeeded", "failed"], to: "rolled_back", label: "بازگردانده شد", requires: ["result_notes"] },
    { from: ["failed"], to: "in_progress", label: "تلاش دوباره", guard: "deployment_gate" },
    { from: ["succeeded", "failed", "rolled_back"], to: "closed", label: "بستن" },
    { from: ["planned", "pending_approval"], to: "canceled", label: "لغو", requires: ["result_notes"] },
  ],
  locked: ["closed", "canceled"],
};
/** Finished deployments (they count in the DORA metrics). */
export const DEPLOYMENT_FINISHED = ["succeeded", "failed", "rolled_back", "closed"];
export const DEPLOYMENT_FAILED = ["failed", "rolled_back"];

const DEPLOY_HIDDEN = ["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "escalation", "parent_id", "location_id", "time_worked", "close_notes"];

const D_MAIN = "اصلی";
const D_TIME = "زمان";
const D_RESULT = "نتیجه و سلامت";
const D_PIPE = "خط لوله";

const deployment: TableDef = {
  key: "deployment",
  table: "sm_deployments",
  label: "استقرار",
  plural: "استقرارها",
  icon: "server-cog",
  module: "release",
  area: "release",
  description: "یک استقرار در یک محیط: نسخه، رویکرد، اهداف، تغییر مجاز، خط لوله و اجرای آن، تأیید سلامت و برنامهٔ بازگشت",
  extends: "task",
  numbered: { prefix: "DEP", pad: 7 },
  display: "short_description",
  fields: [
    ...TASK_FIELDS.filter((f) => DEPLOY_HIDDEN.includes(f.name)).map((f) => ({ ...f, hidden: true })),
    { name: "short_description", label: "عنوان", type: "string", section: D_MAIN },
    { name: "assignment_group_id", label: "تیم استقرار", type: "group", section: D_MAIN },
    { name: "assigned_to", label: "مجری استقرار", type: "user", section: D_MAIN },
    { name: "caller_id", label: "درخواست‌دهنده", type: "user", section: D_MAIN },
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", list: true, filter: true, index: true, span: 8, section: D_MAIN },
    { name: "environment_id", label: "محیط", type: "ref", ref: "release_environment", required: true, list: true, filter: true, index: true, span: 8, section: D_MAIN },
    { name: "is_production", label: "محیط عملیاتی", type: "bool", readonly: true, default: false, filter: true, span: 8, section: D_MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, index: true, section: D_MAIN },
    { name: "change_id", label: "تغییر مجاز", type: "ref", ref: "change_request", filter: true, index: true, span: 8, section: D_MAIN },
    { name: "approach", label: "رویکرد", type: "choice", choices: DEPLOY_APPROACHES, default: "big_bang", filter: true, span: 8, section: D_MAIN },
    { name: "kind", label: "گونه", type: "choice", choices: DEPLOY_KINDS, default: "planned", list: true, filter: true, span: 8, section: D_MAIN },
    { name: "artifact_version", label: "نسخه", type: "string", maxLength: 80, ltr: true, list: true, search: true, filter: true, span: 8, section: D_MAIN },
    { name: "artifact_id", label: "بستهٔ نرم‌افزاری", type: "ref", ref: "artifact", filter: true, span: 8, section: D_MAIN },
    { name: "commit_sha", label: "کامیت", type: "string", maxLength: 64, ltr: true, search: true, span: 8, section: D_MAIN },
    { name: "targets", label: "اهداف (پیکربندی‌ها)", type: "refs", ref: "ci", span: 24, section: D_MAIN },
    { name: "rollout_pct", label: "درصد عرضه", type: "percent", min: 0, max: 100, span: 8, section: D_MAIN },
    { name: "planned_start", label: "شروع برنامه‌ریزی‌شده", type: "datetime", sort: true, filter: true, span: 8, section: D_TIME },
    { name: "planned_end", label: "پایان برنامه‌ریزی‌شده", type: "datetime", sort: true, span: 8, section: D_TIME },
    { name: "actual_start", label: "شروع واقعی", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: D_TIME },
    { name: "actual_end", label: "پایان واقعی", type: "datetime", readonly: true, list: true, sort: true, filter: true, index: true, span: 8, section: D_TIME },
    { name: "duration", label: "مدت", type: "duration", readonly: true, span: 8, section: D_TIME },
    { name: "rollback_plan", label: "برنامهٔ بازگشت", type: "markdown", span: 24, section: D_RESULT },
    { name: "verification", label: "تأیید سلامت پس از استقرار", type: "choice", choices: VERIFICATION_STATUSES, default: "not_run", filter: true, span: 8, section: D_RESULT },
    { name: "verification_notes", label: "شواهد تأیید سلامت", type: "markdown", span: 24, section: D_RESULT },
    { name: "result_notes", label: "شرح نتیجه", type: "text", span: 24, section: D_RESULT },
    { name: "rollback_of", label: "بازگشتِ استقرار", type: "ref", ref: "$self", filter: true, span: 8, section: D_RESULT },
    { name: "pipeline_id", label: "خط لوله", type: "ref", ref: "dev_pipeline", filter: true, span: 8, section: D_PIPE },
    { name: "build_id", label: "اجرای خط لوله", type: "ref", ref: "dev_build", span: 8, section: D_PIPE },
    { name: "connection_id", label: "اتصال", type: "ref", ref: "devops_connection", readonly: true, filter: true, span: 8, section: D_PIPE },
    { name: "external_id", label: "شناسهٔ بیرونی", type: "string", maxLength: 200, readonly: true, ltr: true, search: true, span: 8, section: D_PIPE },
    { name: "external_url", label: "پیوند در ابزار", type: "url", readonly: true, span: 16, section: D_PIPE },
    { name: "initiated_by", label: "آغازگر (شناسهٔ ماشینی)", type: "string", maxLength: 160, readonly: true, span: 8, section: D_PIPE },
    { name: "on_behalf_of", label: "از طرف", type: "user", readonly: true, filter: true, span: 8, section: D_PIPE },
    { name: "first_commit_at", label: "زمان نخستین کامیت", type: "datetime", readonly: true, span: 8, section: D_TIME },
    { name: "lead_time", label: "زمان تحویل تغییر", type: "duration", readonly: true, sort: true, span: 8, section: D_TIME },
    { name: "restored_at", label: "بازیابی خدمت", type: "datetime", readonly: true, span: 8, help: "برای استقرار ناموفق: نخستین استقرار موفق بعدی در همان محیط و خدمت", section: D_TIME },
    { name: "incidents_caused", label: "رخدادهای ناشی از استقرار", type: "int", readonly: true, default: 0, filter: true, span: 8, section: D_RESULT },
    { name: "change_failure", label: "شکست تغییر (DORA)", type: "bool", readonly: true, default: false, filter: true, span: 8, section: D_RESULT },
    { name: "policy_note", label: "یادداشت خط‌مشی", type: "text", readonly: true, span: 24, section: D_RESULT },
    { name: "release_manager_id", label: "مدیر انتشار", type: "user", system: true, hidden: true },
    { name: "approval", label: "تأیید", type: "choice" },
    { name: "close_code", label: "نتیجه", type: "choice", choices: "$table.close_code", hidden: true },
  ],
  states: DEPLOYMENT_STATES,
  scope: { ...TASK_SCOPE, own: [...(TASK_SCOPE.own ?? []), "release_manager_id", "on_behalf_of"], requester: ["caller_id", "opened_by"], requesterTransitions: [] },
  features: { sla: true, approvals: true, kanban: "state", calendar: { start: "planned_start", end: "planned_end" } },
  form: {
    sections: [D_MAIN, D_TIME, D_RESULT, D_PIPE],
    related: [{ table: "deployment", field: "rollback_of", label: "استقرارهای بازگشت", columns: ["number", "environment_id", "state", "actual_end"] }],
  },
  list: { columns: ["number", "short_description", "environment_id", "artifact_version", "state", "release_id", "actual_end", "assigned_to"], order: "-actual_end" },
};

// ---------------------------------------------------------------------------------------------------------------
// Release notes, defects, feature flags, artifacts

const releaseNote: TableDef = {
  key: "release_note",
  table: "sm_release_notes",
  label: "یادداشت انتشار",
  plural: "یادداشت‌های انتشار",
  icon: "newspaper",
  module: "release",
  area: "release",
  description: "یادداشت انتشار برای یک مخاطب (کاربران، عملیات، مدیران) با منبع هر سطر؛ پیش‌نویس، بازبینی و انتشار",
  display: "title",
  fields: [
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "audience", label: "مخاطب", type: "choice", choices: NOTE_AUDIENCES, default: "end_users", list: true, filter: true, span: 8 },
    { name: "language", label: "زبان", type: "choice", choices: NOTE_LANGUAGES, default: "fa", list: true, span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: NOTE_STATES, default: "draft", list: true, filter: true, span: 8 },
    { name: "body", label: "متن", type: "markdown", search: true, span: 24 },
    { name: "sources", label: "منبع‌ها", type: "json", readonly: true, default: [], span: 24 },
    { name: "ai_generated", label: "پیش‌نویس هوش مصنوعی", type: "bool", readonly: true, default: false, span: 8 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "published_by", label: "منتشرکننده", type: "user", readonly: true, span: 8 },
    { name: "audience_users", label: "گیرندگان", type: "users", system: true, hidden: true },
    ...RELEASE_COPY,
  ],
  scope: RELEASE_CHILD_SCOPE,
  features: { journal: true, attachments: true },
  list: { columns: ["title", "release_id", "audience", "language", "state", "published_at"], order: "-published_at" },
};

const DEFECT_HIDDEN = ["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "escalation", "parent_id", "location_id", "approval"];

const defect: TableDef = {
  key: "defect",
  table: "sm_defects",
  label: "نقص",
  plural: "نقص‌ها",
  icon: "bug",
  module: "release",
  area: "release",
  description: "نقص یافته در آزمون یا محیط عملیاتی: شدت، محیط، نسخهٔ رفع، و خطای شناخته‌شده‌ای که با انتشار پذیرفته می‌شود",
  extends: "task",
  numbered: { prefix: "DEF", pad: 7 },
  display: "short_description",
  fields: [
    ...TASK_FIELDS.filter((f) => DEFECT_HIDDEN.includes(f.name)).map((f) => ({ ...f, hidden: true })),
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", list: true, filter: true, index: true, span: 8 },
    { name: "severity", label: "شدت", type: "choice", choices: DEFECT_SEVERITIES, default: "medium", list: true, filter: true, sort: true, span: 8 },
    { name: "found_in_env", label: "یافته در محیط", type: "ref", ref: "release_environment", filter: true, span: 8 },
    { name: "escaped", label: "نشت به محیط عملیاتی", type: "bool", readonly: true, default: false, filter: true, span: 8 },
    { name: "fix_version", label: "نسخهٔ رفع", type: "string", maxLength: 60, ltr: true, span: 8 },
    { name: "known_error_id", label: "خطای شناخته‌شده", type: "ref", ref: "known_error", filter: true, span: 8 },
    { name: "steps", label: "گام‌های بازتولید", type: "markdown", span: 24 },
  ],
  states: {
    field: "state",
    initial: "new",
    states: [
      { value: "new", label: "تازه", category: "new", color: "blue" },
      { value: "triaged", label: "ارزیابی‌شده", category: "active", color: "indigo" },
      { value: "in_progress", label: "در حال رفع", category: "active", color: "teal" },
      { value: "fixed", label: "رفع‌شده", category: "resolved", color: "green" },
      { value: "verified", label: "تأییدشده", category: "closed", color: "gray" },
      { value: "deferred", label: "به تعویق", category: "waiting", color: "gold" },
      { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["new"], to: "triaged", label: "ارزیابی" },
      { from: ["new", "triaged", "deferred"], to: "in_progress", label: "شروع رفع" },
      { from: ["in_progress", "triaged"], to: "fixed", label: "رفع شد", requires: ["close_code"] },
      { from: ["fixed"], to: "verified", label: "تأیید رفع" },
      { from: ["fixed"], to: "in_progress", label: "رفع نشد" },
      { from: ["new", "triaged", "in_progress"], to: "deferred", label: "به تعویق" },
      { from: ["new", "triaged", "deferred"], to: "rejected", label: "رد", requires: ["close_notes"] },
    ],
  },
  scope: TASK_SCOPE,
  features: { kanban: "state" },
  list: { columns: ["number", "short_description", "severity", "state", "release_id", "assigned_to"], order: "-opened_at" },
};
/** Defect states that no longer count as open. */
export const DEFECT_DONE = ["fixed", "verified", "rejected", "deferred"];

const featureFlag: TableDef = {
  key: "feature_flag",
  table: "sm_feature_flags",
  label: "پرچم ویژگی",
  plural: "پرچم‌های ویژگی",
  icon: "flag",
  module: "release",
  area: "release",
  description: "پرچم ویژگی برای جدا کردن «استقرار» از «عرضه»: درصد عرضه، محیط‌ها، مالک و قطع اضطراری",
  display: "key",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 120, ltr: true, unique: true, list: true, search: true, span: 12 },
    { name: "name", label: "نام", type: "string", maxLength: 160, list: true, search: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", filter: true, index: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: FLAG_STATES, default: "off", list: true, filter: true, span: 8 },
    { name: "rollout_pct", label: "درصد عرضه", type: "percent", min: 0, max: 100, list: true, span: 8 },
    { name: "environments", label: "محیط‌ها", type: "refs", ref: "release_environment", span: 8 },
    { name: "segments", label: "گروه‌های کاربران", type: "tags", span: 24 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true, own: ["owner_id"], requester: [] },
  features: { journal: true },
  list: { columns: ["key", "name", "service_id", "state", "rollout_pct", "release_id"], order: "key" },
};

const artifact: TableDef = {
  key: "artifact",
  table: "sm_artifacts",
  label: "بستهٔ نرم‌افزاری",
  plural: "کتابخانهٔ نرم‌افزار (DML)",
  icon: "package",
  module: "release",
  area: "release",
  description: "نسخهٔ مجاز یک بستهٔ نرم‌افزاری: چکیده، امضا، فهرست اجزا (SBOM)، منشأ ساخت و محل نگهداری",
  numbered: { prefix: "ART", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "artifact_version", label: "نسخه", type: "string", required: true, maxLength: 80, ltr: true, list: true, search: true, span: 6 },
    { name: "approval_state", label: "مجوز", type: "choice", choices: ARTIFACT_STATES, default: "draft", list: true, filter: true, span: 6 },
    { name: "digest", label: "چکیده (SHA-256)", type: "string", maxLength: 100, ltr: true, search: true, span: 12 },
    { name: "signed", label: "امضای معتبر", type: "bool", default: false, filter: true, span: 6 },
    { name: "location", label: "محل نگهداری", type: "url", span: 18 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 8 },
    { name: "release_id", label: "انتشار", type: "ref", ref: "release", filter: true, span: 8 },
    { name: "build_id", label: "اجرای ساخت", type: "ref", ref: "dev_build", span: 8 },
    { name: "source_commit", label: "کامیت منشأ", type: "string", maxLength: 64, ltr: true, span: 12 },
    { name: "sbom", label: "فهرست اجزا (SBOM)", type: "json", span: 24, help: "SPDX یا CycloneDX" },
    { name: "components", label: "تعداد اجزا", type: "int", readonly: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  unique: [["name", "artifact_version"]],
  list: { columns: ["number", "name", "artifact_version", "approval_state", "signed", "service_id"], order: "-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

const releaseConfig: TableDef = {
  key: "release_config",
  table: "sm_release_configs",
  label: "تنظیمات انتشار",
  plural: "تنظیمات انتشار",
  icon: "settings-2",
  module: "release",
  area: "release",
  description: "تنظیمات مدیریت انتشار و استقرار سازمان",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", maxLength: 40, ltr: true, unique: true, hidden: true },
    { name: "els_days", label: "پشتیبانی آغازین پیش‌فرض (روز)", type: "int", min: 0, max: 180, default: RELEASE_CONFIG_DEFAULTS.els_days, span: 8 },
    { name: "failure_window_hours", label: "بازهٔ نسبت دادن رخداد به استقرار (ساعت)", type: "int", min: 1, max: 720, default: RELEASE_CONFIG_DEFAULTS.failure_window_hours, span: 8 },
    { name: "auto_advance", label: "پیشبرد خودکار انتشار با استقرار عملیاتی موفق", type: "bool", default: true, span: 12 },
    { name: "release_on_production", label: "استقرار عملیاتی یعنی عرضه (بدون پرچم ویژگی)", type: "bool", default: true, span: 12 },
    { name: "update_cmdb_versions", label: "به‌روزرسانی نسخهٔ پیکربندی‌ها پس از استقرار موفق", type: "bool", default: true, span: 12 },
    { name: "tag_els_incidents", label: "پیوند خودکار رخدادهای دورهٔ پشتیبانی آغازین", type: "bool", default: true, span: 12 },
    { name: "default_change_template_id", label: "الگوی تغییر استاندارد خط لوله‌ها", type: "ref", ref: "change_template", span: 12 },
    { name: "dora_days", label: "بازهٔ شاخص‌های DORA (روز)", type: "int", min: 7, max: 365, default: 90, span: 12 },
    { name: "dora_definitions", label: "تعریف و آستانه‌های شاخص‌های DORA", type: "json", span: 24, help: "تعریف هر شاخص، فرمول و آستانه‌های ممتاز، بالا و متوسط" },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "els_days", "failure_window_hours"], order: "name" },
};

export const RELEASE_TABLES: TableDef[] = [
  release, releaseTask, releaseTemplate, releasePolicy, releaseCheck, checkResult, releaseDecision, environment, booking, releaseWindow,
  deployment, releaseNote, defect, featureFlag, artifact, releaseConfig,
];
