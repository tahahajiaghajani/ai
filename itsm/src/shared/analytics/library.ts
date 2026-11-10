// The ITSM KPI library (catalogue ANA-002) and the dashboards seeded with it: MTTA, MTTR, first-contact resolution,
// reopen rate, SLA compliance, backlog and its ageing, major incidents, CSAT; change success, emergency share,
// change-caused incidents, lead time; the DORA metrics and release/project KPIs; request fulfilment time, zero-touch share, request SLA and CSAT; problem and
// knowledge measures; security (open security incidents, MTTC, overdue vulnerabilities, control test pass rate, risks
// above appetite) and the portal (CSAT, the virtual agent's deflection, the self-service share). Each indicator names the tables and fields it reads; the seed adds only those whose tables and
// fields exist in the organisation (modules not installed are skipped) — `libraryFor(lookup)`.
// Stored snapshots of these org-wide indicators are readable only by the roles in `score_roles` (the definitions and
// the live values — computed with each viewer's access — are for everyone who reads reports).
import type { Cond, Lookup } from "../model/conditions";
import type { DashboardFilter, DashboardLayout, IndicatorDef, ReportSpec, Share, Widget } from "./types";
import { indicatorProblem } from "./kpi";
import { specProblem } from "./model";

export interface LibraryIndicator extends IndicatorDef {
  /** roles that read the stored snapshots (held to the field groups of the numbers: amounts only for «مالی») */
  score_roles: string[];
  /** collected daily */
  collect: boolean;
  /** further tables that must exist for it to be seeded (the module whose KPI it is), beyond the parts' tables */
  requires?: string[];
}

export const PRACTICES: { value: string; label: string }[] = [
  { value: "incident", label: "رخداد" },
  { value: "problem", label: "مشکل" },
  { value: "change", label: "تغییر" },
  { value: "request", label: "درخواست" },
  { value: "knowledge", label: "دانش" },
  { value: "sla", label: "سطح خدمت" },
  { value: "cmdb", label: "پیکربندی" },
  { value: "release", label: "انتشار و دواپس" },
  { value: "project", label: "پروژه" },
  { value: "event", label: "رویداد و کشیک" },
  { value: "continuity", label: "دسترس‌پذیری و تداوم" },
  { value: "asset", label: "دارایی و مجوز" },
  { value: "supplier", label: "تأمین‌کننده و قرارداد" },
  { value: "financial", label: "مالی" },
  { value: "security", label: "امنیت، ریسک و انطباق" },
  { value: "portal", label: "درگاه و سلف‌سرویس" },
  { value: "other", label: "سایر" },
];

const RESOLVED = { f: "state", op: "in", v: ["resolved", "closed"] } as const;
const OPEN = { f: "active", op: "eq", v: true } as const;
const LAST_7_DAYS = { unit: "day", from: -6, to: 0 } as const;
const INCIDENT_READERS = ["service_desk_manager", "incident_manager", "tenant_admin"];
const CHANGE_READERS = ["change_manager", "service_desk_manager", "tenant_admin"];
const REQUEST_READERS = ["service_desk_manager", "tenant_admin"];
const RELEASE_READERS = ["release_manager", "change_manager", "tenant_admin"];
// «مدیر پروژه» is the project module's organisation role (seeded with it)
const PROJECT_READERS = ["project_manager", "tenant_admin"];
// the event module's «مدیر عملیات», the continuity module's «مدیر تداوم», ITAM's and procurement's managers, IT finance
const EVENT_READERS = ["ops_manager", "service_desk_manager", "tenant_admin"];
const CONTINUITY_READERS = ["continuity_manager", "ops_manager", "tenant_admin"];
const ASSET_READERS = ["asset_manager", "tenant_admin"];
const SUPPLIER_READERS = ["asset_manager", "procurement_manager", "tenant_admin"];
// stored budget figures go only to those of these roles who hold the «مالی» field group (the amounts' group)
const FINANCE_READERS = ["it_finance", "asset_manager", "tenant_admin"];
// stored security scores: never the tenant administrator (outside the secure workspace) — the security manager for
// security incidents, with the vulnerability or GRC manager for their own measures
const SOC_READERS = ["security_manager"];
const VULN_READERS = ["security_manager", "vulnerability_manager"];
const GRC_READERS = ["security_manager", "grc_manager"];
const PORTAL_READERS = ["service_desk_manager", "tenant_admin"];
const ALERT_DONE = { f: "state", op: "in", v: ["cleared", "closed"] } as const;
/**
 * Production deployments that finished (the DORA population): succeeded, failed or rolled back, also once closed. A
 * closed deployment is a success only when it was closed after succeeding (close code «successful»).
 */
const PROD = { f: "is_production", op: "eq", v: true } as const;
const PROD_FINISHED_STATES = { f: "state", op: "in", v: ["succeeded", "closed", "failed", "rolled_back"] } as const;
const PROD_OK_STATES: Cond = { or: [{ f: "state", op: "eq", v: "succeeded" }, { and: [{ f: "state", op: "eq", v: "closed" }, { f: "close_code", op: "eq", v: "successful" }] }] };
const PROD_FINISHED: Cond = { and: [PROD, PROD_FINISHED_STATES] };
const PROD_OK: Cond = { and: [PROD, PROD_OK_STATES] };

export const KPI_LIBRARY: LibraryIndicator[] = [
  // ----- incident ---------------------------------------------------------------------------------------------------
  {
    key: "incident.volume", name: "رخدادهای ثبت‌شده", practice: "incident", unit: "count", direction: "none", grain: "month",
    description: "تعداد رخدادهایی که در دوره ثبت شدند.",
    formula: "created", parts: [{ name: "created", table: "incident", fn: "count", date_field: "opened_at" }],
    breakdowns: ["priority", "category", "channel"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.backlog", name: "رخدادهای باز", practice: "incident", unit: "count", direction: "down", grain: "day",
    description: "رخدادهای باز در لحظهٔ اندازه‌گیری؛ روند آن از عکس‌های روزانه ساخته می‌شود.",
    formula: "open", parts: [{ name: "open", table: "incident", fn: "count", filter: OPEN }],
    breakdowns: ["priority", "assignment_group_id"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.mtta", name: "میانگین زمان تا پذیرش (MTTA)", practice: "incident", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از ثبت تا آغاز رسیدگی، برای رخدادهایی که در دوره پذیرفته شدند.",
    formula: "mtta", parts: [{ name: "mtta", table: "incident", fn: "avg", field: "time_to_accept", date_field: "accepted_at" }],
    target: 900, warn: 1800, crit: 3600, breakdowns: ["priority", "assignment_group_id"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.mttr", name: "میانگین زمان تا حل (MTTR)", practice: "incident", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از ثبت تا حل، برای رخدادهایی که در دوره حل شدند.",
    formula: "mttr", parts: [{ name: "mttr", table: "incident", fn: "avg", field: "time_to_resolve", date_field: "resolved_at", filter: RESOLVED }],
    target: 28_800, warn: 57_600, crit: 86_400, breakdowns: ["priority", "assignment_group_id", "category"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.fcr", name: "حل در نخستین تماس", practice: "incident", unit: "percent", direction: "up", grain: "month",
    description: "سهم رخدادهای حل‌شده‌ای که بی‌ارجاع به گروه دیگر و بی‌بازگشایی حل شدند.",
    formula: "first / resolved * 100",
    parts: [
      { name: "first", table: "incident", fn: "count", date_field: "resolved_at", filter: { and: [RESOLVED, { f: "reassignment_count", op: "eq", v: 0 }, { f: "reopen_count", op: "eq", v: 0 }] } },
      { name: "resolved", table: "incident", fn: "count", date_field: "resolved_at", filter: RESOLVED },
    ],
    target: 70, warn: 60, crit: 45, breakdowns: ["assignment_group_id", "channel"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.reopen_rate", name: "نرخ بازگشایی", practice: "incident", unit: "percent", direction: "down", grain: "month",
    description: "سهم رخدادهای حل‌شده‌ای که دست‌کم یک بار دوباره باز شدند.",
    formula: "reopened / resolved * 100",
    parts: [
      { name: "reopened", table: "incident", fn: "count", date_field: "resolved_at", filter: { and: [RESOLVED, { f: "reopen_count", op: "gt", v: 0 }] } },
      { name: "resolved", table: "incident", fn: "count", date_field: "resolved_at", filter: RESOLVED },
    ],
    target: 5, warn: 8, crit: 12, breakdowns: ["assignment_group_id", "category"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.sla_compliance", name: "پایبندی به SLA رخداد", practice: "incident", unit: "percent", direction: "up", grain: "month",
    description: "سهم زمان‌سنج‌های SLA رخداد که در دوره به پایان رسیدند و نقض نشدند.",
    formula: "met / finished * 100",
    parts: [
      { name: "met", table: "task_sla", fn: "count", date_field: "stop_at", filter: { and: [{ f: "table_key", op: "eq", v: "incident" }, { f: "stage", op: "eq", v: "achieved" }] } },
      { name: "finished", table: "task_sla", fn: "count", date_field: "stop_at", filter: { and: [{ f: "table_key", op: "eq", v: "incident" }, { f: "stage", op: "in", v: ["achieved", "breached"] }] } },
    ],
    target: 95, warn: 90, crit: 80, score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.aged_backlog", name: "رخدادهای باز قدیمی‌تر از یک هفته", practice: "incident", unit: "percent", direction: "down", grain: "day",
    description: "سهم رخدادهای باز که بیش از هفت روز از ثبت آن‌ها گذشته است (سن صف کار).",
    formula: "aged / open * 100",
    parts: [
      { name: "aged", table: "incident", fn: "count", filter: { and: [OPEN, { not: { f: "opened_at", op: "relative", v: LAST_7_DAYS } }] } },
      { name: "open", table: "incident", fn: "count", filter: OPEN },
    ],
    target: 10, warn: 20, crit: 35, breakdowns: ["assignment_group_id"], score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.major", name: "رخدادهای عمده", practice: "incident", unit: "count", direction: "down", grain: "month",
    description: "تعداد رخدادهای عمده‌ای که در دوره اعلام شدند.",
    formula: "major", parts: [{ name: "major", table: "incident", fn: "count", date_field: "mi_declared_at" }],
    score_roles: INCIDENT_READERS, collect: true,
  },
  {
    key: "incident.csat", name: "رضایت درخواست‌کنندگان رخداد", practice: "incident", unit: "percent", direction: "up", grain: "month",
    description: "سهم پاسخ‌های رضایت ۴ و ۵ از همهٔ امتیازهای داده‌شده به رخدادهای حل‌شدهٔ دوره.",
    formula: "happy / rated * 100",
    parts: [
      { name: "happy", table: "incident", fn: "count", date_field: "resolved_at", filter: { f: "satisfaction", op: "gte", v: 4 } },
      { name: "rated", table: "incident", fn: "count", date_field: "resolved_at", filter: { f: "satisfaction", op: "nempty" } },
    ],
    target: 85, warn: 75, crit: 60, breakdowns: ["assignment_group_id"], score_roles: INCIDENT_READERS, collect: true,
  },
  // ----- problem ----------------------------------------------------------------------------------------------------
  {
    key: "problem.time_to_rca", name: "میانگین زمان تا یافتن علت", practice: "problem", unit: "duration", direction: "down", grain: "quarter",
    description: "میانگین زمان از ثبت مشکل تا ثبت علت ریشه‌ای، برای مشکل‌هایی که در دوره به علت رسیدند.",
    formula: "rca", parts: [{ name: "rca", table: "problem", fn: "avg", field: "time_to_rca", date_field: "rca_at" }],
    breakdowns: ["assignment_group_id"], score_roles: ["problem_manager", "tenant_admin"], collect: true,
  },
  {
    key: "problem.open", name: "مشکل‌های باز", practice: "problem", unit: "count", direction: "down", grain: "day",
    description: "مشکل‌های باز در لحظهٔ اندازه‌گیری.",
    formula: "open", parts: [{ name: "open", table: "problem", fn: "count", filter: OPEN }],
    breakdowns: ["priority"], score_roles: ["problem_manager", "tenant_admin"], collect: true,
  },
  // ----- change -----------------------------------------------------------------------------------------------------
  {
    key: "change.success_rate", name: "نرخ موفقیت تغییر", practice: "change", unit: "percent", direction: "up", grain: "month",
    description: "سهم تغییرهای اجراشدهٔ دوره که ناموفق نشدند و برگشت داده نشدند.",
    formula: "(implemented - failed) / implemented * 100",
    parts: [
      { name: "implemented", table: "change_request", fn: "count", date_field: "actual_end", filter: { f: "close_code", op: "in", v: ["successful", "successful_issues", "unsuccessful", "backed_out"] } },
      { name: "failed", table: "change_request", fn: "count", date_field: "actual_end", filter: { f: "close_code", op: "in", v: ["unsuccessful", "backed_out"] } },
    ],
    target: 95, warn: 90, crit: 80, breakdowns: ["type", "risk", "assignment_group_id"], score_roles: CHANGE_READERS, collect: true,
  },
  {
    key: "change.emergency_rate", name: "سهم تغییرهای اضطراری", practice: "change", unit: "percent", direction: "down", grain: "month",
    description: "سهم تغییرهای اضطراری از همهٔ تغییرهای ثبت‌شدهٔ دوره.",
    formula: "emergency / total * 100",
    parts: [
      { name: "emergency", table: "change_request", fn: "count", date_field: "opened_at", filter: { f: "type", op: "eq", v: "emergency" } },
      { name: "total", table: "change_request", fn: "count", date_field: "opened_at" },
    ],
    target: 5, warn: 10, crit: 20, breakdowns: ["assignment_group_id"], score_roles: CHANGE_READERS, collect: true,
  },
  {
    key: "change.caused_incidents", name: "تغییرهای منجر به رخداد", practice: "change", unit: "percent", direction: "down", grain: "month",
    description: "سهم تغییرهای اجراشدهٔ دوره که دست‌کم یک رخداد از آن‌ها ناشی شد.",
    formula: "causing / implemented * 100",
    parts: [
      { name: "causing", table: "change_request", fn: "count", date_field: "actual_end", filter: { and: [{ f: "close_code", op: "nempty" }, { f: "incidents_caused", op: "gt", v: 0 }] } },
      { name: "implemented", table: "change_request", fn: "count", date_field: "actual_end", filter: { f: "close_code", op: "in", v: ["successful", "successful_issues", "unsuccessful", "backed_out"] } },
    ],
    target: 3, warn: 6, crit: 10, breakdowns: ["type"], score_roles: CHANGE_READERS, collect: true,
  },
  {
    key: "change.lead_time", name: "میانگین زمان تحویل تغییر", practice: "change", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از ثبت تغییر تا پایان اجرای آن، برای تغییرهایی که در دوره اجرا شدند (شاخص DORA).",
    formula: "lead", parts: [{ name: "lead", table: "change_request", fn: "avg", field: "actual_end", from: "opened_at", date_field: "actual_end" }],
    breakdowns: ["type"], score_roles: CHANGE_READERS, collect: true,
  },
  // ----- request ----------------------------------------------------------------------------------------------------
  {
    key: "request.fulfilment_time", name: "میانگین زمان انجام درخواست", practice: "request", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از ثبت قلم درخواست تا تحویل آن، برای قلم‌هایی که در دوره تحویل شدند.",
    formula: "fulfil",
    parts: [{ name: "fulfil", table: "request_item", fn: "avg", field: "resolved_at", from: "opened_at", date_field: "resolved_at", filter: { f: "state", op: "in", v: ["delivered", "closed_complete"] } }],
    breakdowns: ["assignment_group_id"], score_roles: REQUEST_READERS, collect: true,
  },
  {
    key: "request.zero_touch", name: "انجام کاملاً خودکار", practice: "request", unit: "percent", direction: "up", grain: "month",
    description: "سهم قلم‌های تحویل‌شده که بی‌دخالت کارشناس انجام شدند.",
    formula: "auto / delivered * 100",
    parts: [
      { name: "auto", table: "request_item", fn: "count", date_field: "resolved_at", filter: { and: [{ f: "zero_touch", op: "eq", v: true }, { f: "state", op: "in", v: ["delivered", "closed_complete"] }] } },
      { name: "delivered", table: "request_item", fn: "count", date_field: "resolved_at", filter: { f: "state", op: "in", v: ["delivered", "closed_complete"] } },
    ],
    score_roles: REQUEST_READERS, collect: true,
  },
  {
    key: "request.sla_compliance", name: "پایبندی به SLA درخواست", practice: "request", unit: "percent", direction: "up", grain: "month",
    description: "سهم زمان‌سنج‌های SLA اقلام درخواست که در دوره به پایان رسیدند و نقض نشدند.",
    formula: "met / finished * 100",
    parts: [
      { name: "met", table: "task_sla", fn: "count", date_field: "stop_at", filter: { and: [{ f: "table_key", op: "eq", v: "request_item" }, { f: "stage", op: "eq", v: "achieved" }] } },
      { name: "finished", table: "task_sla", fn: "count", date_field: "stop_at", filter: { and: [{ f: "table_key", op: "eq", v: "request_item" }, { f: "stage", op: "in", v: ["achieved", "breached"] }] } },
    ],
    target: 95, warn: 90, crit: 80, score_roles: REQUEST_READERS, collect: true,
  },
  {
    key: "request.csat", name: "رضایت درخواست‌کنندگان خدمت", practice: "request", unit: "percent", direction: "up", grain: "month",
    description: "سهم امتیازهای ۴ و ۵ از همهٔ امتیازهای داده‌شده به اقلام تحویل‌شدهٔ دوره.",
    formula: "happy / rated * 100",
    parts: [
      { name: "happy", table: "request_item", fn: "count", date_field: "resolved_at", filter: { f: "rating", op: "gte", v: 4 } },
      { name: "rated", table: "request_item", fn: "count", date_field: "resolved_at", filter: { f: "rating", op: "nempty" } },
    ],
    target: 85, warn: 75, crit: 60, score_roles: REQUEST_READERS, collect: true,
  },
  // ----- release and DevOps: the DORA metrics (the release module's tables; seeded only when it is installed) --------
  {
    key: "devops.deployment_frequency", name: "تناوب استقرار (DORA)", practice: "release", unit: "count", direction: "up", grain: "week",
    description: "استقرارهای موفق در محیط عملیاتی که در دوره پایان یافتند.",
    formula: "ok", parts: [{ name: "ok", table: "deployment", fn: "count", date_field: "actual_end", filter: PROD_OK }],
    breakdowns: ["service_id", "environment_id"], score_roles: RELEASE_READERS, collect: true,
  },
  {
    key: "devops.lead_time", name: "زمان تحویل تغییر (DORA)", practice: "release", unit: "duration", direction: "down", grain: "month",
    description: "میانهٔ زمان از نخستین کامیت تا استقرار موفق عملیاتی، برای استقرارهایی که در دوره پایان یافتند.",
    formula: "lead", parts: [{ name: "lead", table: "deployment", fn: "median", field: "lead_time", date_field: "actual_end", filter: { and: [PROD, PROD_OK_STATES, { f: "lead_time", op: "nempty" }] } }],
    target: 86_400, warn: 604_800, crit: 2_592_000, breakdowns: ["service_id"], score_roles: RELEASE_READERS, collect: true,
  },
  {
    key: "devops.change_failure_rate", name: "نرخ شکست تغییر (DORA)", practice: "release", unit: "percent", direction: "down", grain: "month",
    description: "سهم استقرارهای عملیاتی پایان‌یافتهٔ دوره که ناموفق بودند، بازگردانده شدند یا رخداد ساختند.",
    formula: "failed / finished * 100",
    parts: [
      { name: "failed", table: "deployment", fn: "count", date_field: "actual_end", filter: { and: [PROD, PROD_FINISHED_STATES, { f: "change_failure", op: "eq", v: true }] } },
      { name: "finished", table: "deployment", fn: "count", date_field: "actual_end", filter: PROD_FINISHED },
    ],
    target: 5, warn: 15, crit: 30, breakdowns: ["service_id"], score_roles: RELEASE_READERS, collect: true,
  },
  {
    key: "devops.time_to_restore", name: "زمان بازیابی خدمت (DORA)", practice: "release", unit: "duration", direction: "down", grain: "month",
    description: "میانهٔ زمان از پایان استقرار ناموفق عملیاتی تا بازیابی خدمت، برای بازیابی‌های دوره.",
    formula: "restore",
    parts: [{ name: "restore", table: "deployment", fn: "median", field: "restored_at", from: "actual_end", date_field: "restored_at", filter: { and: [{ f: "is_production", op: "eq", v: true }, { f: "change_failure", op: "eq", v: true }] } }],
    target: 3_600, warn: 86_400, crit: 604_800, breakdowns: ["service_id"], score_roles: RELEASE_READERS, collect: true,
  },
  {
    key: "release.on_time", name: "انتشارهای به‌موقع", practice: "release", unit: "percent", direction: "up", grain: "quarter",
    description: "سهم انتشارهایی که در دوره در محیط عملیاتی مستقر شدند و تا تاریخ برنامه‌ریزی‌شده عرضه شدند.",
    formula: "on_time / deployed * 100",
    parts: [
      { name: "on_time", table: "release", fn: "count", date_field: "deployed_at", filter: { f: "on_schedule", op: "eq", v: true } },
      { name: "deployed", table: "release", fn: "count", date_field: "deployed_at", filter: { f: "deployed_at", op: "nempty" } },
    ],
    target: 90, warn: 75, crit: 60, breakdowns: ["type"], score_roles: RELEASE_READERS, collect: true,
  },
  {
    key: "release.emergency_share", name: "سهم انتشارهای اضطراری", practice: "release", unit: "percent", direction: "down", grain: "quarter",
    description: "سهم انتشارهای اضطراری از همهٔ انتشارهایی که در دوره در محیط عملیاتی مستقر شدند.",
    formula: "emergency / deployed * 100",
    parts: [
      { name: "emergency", table: "release", fn: "count", date_field: "deployed_at", filter: { f: "type", op: "eq", v: "emergency" } },
      { name: "deployed", table: "release", fn: "count", date_field: "deployed_at", filter: { f: "deployed_at", op: "nempty" } },
    ],
    target: 5, warn: 10, crit: 20, score_roles: RELEASE_READERS, collect: true,
  },
  // ----- projects (the project module's tables; seeded only when it is installed) -------------------------------------
  {
    key: "project.off_track", name: "پروژه‌های خارج از روال", practice: "project", unit: "count", direction: "down", grain: "day",
    description: "پروژه‌های در جریان با سلامت «قرمز» در لحظهٔ اندازه‌گیری؛ روند آن از عکس‌های روزانه ساخته می‌شود.",
    formula: "red", parts: [{ name: "red", table: "project", fn: "count", filter: { and: [{ f: "state", op: "in", v: ["approved", "planning", "executing", "closing", "on_hold"] }, { f: "health", op: "eq", v: "red" }] } }],
    target: 0, warn: 2, crit: 5, breakdowns: ["type"], score_roles: PROJECT_READERS, collect: true,
  },
  {
    key: "project.on_schedule", name: "پروژه‌های بسته‌شدهٔ به‌موقع", practice: "project", unit: "percent", direction: "up", grain: "quarter",
    description: "سهم پروژه‌هایی که در دوره بسته شدند و انحراف زمانشان صفر یا کمتر بود.",
    formula: "on_time / closed * 100",
    parts: [
      { name: "on_time", table: "project", fn: "count", date_field: "actual_end", filter: { and: [{ f: "state", op: "eq", v: "closed" }, { f: "schedule_variance_days", op: "lte", v: 0 }] } },
      { name: "closed", table: "project", fn: "count", date_field: "actual_end", filter: { f: "state", op: "eq", v: "closed" } },
    ],
    target: 80, warn: 65, crit: 50, breakdowns: ["type"], score_roles: PROJECT_READERS, collect: true,
  },
  // ----- event management and on-call (the event module's tables; seeded only when it is installed) -------------------
  {
    key: "event.alert_mtta", name: "میانگین زمان تا پذیرش هشدار", practice: "event", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از باز شدن هشدار تا پذیرش آن، برای هشدارهایی که در دوره پذیرفته شدند.",
    formula: "mtta", parts: [{ name: "mtta", table: "alert", fn: "avg", field: "acknowledged_at", from: "opened_at", date_field: "acknowledged_at", filter: { f: "acknowledged_at", op: "nempty" } }],
    target: 300, warn: 900, crit: 1800, breakdowns: ["severity", "assignment_group_id"], score_roles: EVENT_READERS, collect: true,
  },
  {
    key: "event.alert_mttr", name: "میانگین زمان تا رفع هشدار", practice: "event", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از باز شدن هشدار تا رفع آن، برای هشدارهایی که در دوره رفع شدند.",
    formula: "mttr", parts: [{ name: "mttr", table: "alert", fn: "avg", field: "resolved_at", from: "opened_at", date_field: "resolved_at", filter: { f: "resolved_at", op: "nempty" } }],
    target: 3_600, warn: 14_400, crit: 43_200, breakdowns: ["severity", "assignment_group_id"], score_roles: EVENT_READERS, collect: true,
  },
  {
    key: "event.noise_ratio", name: "نسبت نویز هشدارها", practice: "event", unit: "percent", direction: "down", grain: "month",
    description: "سهم هشدارهای رفع یا بسته‌شدهٔ دوره که برچسب «نویز» گرفتند (بی‌پذیرش، گذرا، نوسانی).",
    formula: "noise / done * 100",
    parts: [
      { name: "noise", table: "alert", fn: "count", date_field: "resolved_at", filter: { and: [ALERT_DONE, { f: "noise_label", op: "eq", v: "noise" }] } },
      { name: "done", table: "alert", fn: "count", date_field: "resolved_at", filter: ALERT_DONE },
    ],
    target: 20, warn: 35, crit: 50, breakdowns: ["source_id"], score_roles: EVENT_READERS, collect: true,
  },
  {
    key: "event.oncall_load", name: "بار کشیک (پیج‌ها)", practice: "event", unit: "count", direction: "down", grain: "week",
    description: "پیج‌هایی که در دوره برای کشیک‌ها فرستاده شد؛ با تفکیک فرد، بار هر کشیک را نشان می‌دهد.",
    formula: "pages", parts: [{ name: "pages", table: "page", fn: "count", date_field: "sent_at", filter: { f: "sent_at", op: "nempty" } }],
    breakdowns: ["user_id"], score_roles: EVENT_READERS, collect: true,
  },
  // ----- availability and continuity (the continuity module installed) -------------------------------------------------
  {
    key: "continuity.availability", name: "دسترس‌پذیری خدمت‌ها در برابر هدف", practice: "continuity", unit: "percent", direction: "up", grain: "month",
    description: "میانگین دسترس‌پذیری روزانهٔ خدمت‌ها در دوره، در برابر هدف دسترس‌پذیری (با تفکیک خدمت، هر خدمت در برابر هدف خودش در «دسترس‌پذیری»).",
    formula: "availability", parts: [{ name: "availability", table: "service_score_fact", fn: "avg", field: "availability", date_field: "day", filter: { f: "availability", op: "nempty" } }],
    target: 99.5, warn: 99, crit: 98, decimals: 2, breakdowns: ["service_id"], score_roles: CONTINUITY_READERS, collect: true, requires: ["outage"],
  },
  {
    key: "continuity.unplanned_downtime", name: "زمان قطعی برنامه‌ریزی‌نشده", practice: "continuity", unit: "duration", direction: "down", grain: "month",
    description: "جمع مدت قطعی‌ها و افت‌های برنامه‌ریزی‌نشدهٔ ثبت‌شده که در دوره شروع شدند (قطعی‌های کنارگذاشته شمرده نمی‌شوند).",
    formula: "down", parts: [{ name: "down", table: "outage", fn: "sum", field: "duration", date_field: "begin_at", filter: { and: [{ f: "outage_type", op: "ne", v: "planned" }, { f: "excluded", op: "eq", v: false }] } }],
    breakdowns: ["service_id"], score_roles: CONTINUITY_READERS, collect: true,
  },
  // ----- assets and licences (the ITAM module installed) ---------------------------------------------------------------
  {
    key: "asset.stock_below_reorder", name: "قاعده‌های موجودی زیر نقطهٔ سفارش", practice: "asset", unit: "count", direction: "down", grain: "day",
    description: "قاعده‌های موجودی فعالی که موجودی آن‌ها به نقطهٔ سفارش رسیده یا تمام شده است (در لحظهٔ اندازه‌گیری).",
    formula: "low", parts: [{ name: "low", table: "stock_rule", fn: "count", filter: { and: [{ f: "active", op: "eq", v: true }, { f: "status", op: "in", v: ["low", "out"] }] } }],
    target: 0, warn: 2, crit: 5, breakdowns: ["stockroom_id"], score_roles: ASSET_READERS, collect: true,
  },
  {
    key: "asset.license_compliance", name: "انطباق مجوزهای نرم‌افزار", practice: "asset", unit: "percent", direction: "up", grain: "month",
    description: "سهم وضعیت‌های مجوز تطبیق‌های دوره که «منطبق» یا «مجوز مازاد» بودند (بی‌کمبود و بی‌نصب بدون مجوز).",
    formula: "ok / all * 100",
    parts: [
      { name: "ok", table: "license_position", fn: "count", date_field: "created_at", filter: { f: "status", op: "in", v: ["compliant", "over_licensed"] } },
      { name: "all", table: "license_position", fn: "count", date_field: "created_at" },
    ],
    target: 100, warn: 95, crit: 85, score_roles: ASSET_READERS, collect: true,
  },
  // ----- suppliers and contracts (the supplier module installed) -------------------------------------------------------
  {
    key: "supplier.contracts_expiring", name: "قراردادهای رو به پایان (۹۰ روز)", practice: "supplier", unit: "count", direction: "down", grain: "day",
    description: "قراردادهای فعالی که تا ۹۰ روز آینده به پایان می‌رسند (در لحظهٔ اندازه‌گیری) — برای تصمیم تمدید به‌موقع.",
    formula: "expiring", parts: [{ name: "expiring", table: "contract", fn: "count", filter: { and: [{ f: "state", op: "eq", v: "active" }, { f: "end_date", op: "relative", v: { unit: "day", n: 90, dir: "next" } }] } }],
    breakdowns: ["supplier_id"], score_roles: SUPPLIER_READERS, collect: true,
  },
  // ----- IT financial management (the financial module installed; amounts in the «مالی» field group) ---------------------
  {
    key: "financial.budget_vs_actual", name: "هزینهٔ واقعی در برابر بودجه", practice: "financial", unit: "percent", direction: "down", grain: "month",
    description: "هزینهٔ ثبت‌شده در دفتر هزینه در دوره، به درصد بودجهٔ مصوب همان ماه‌ها. فقط دارندگان گروه فیلد «مالی» عددها را می‌بینند.",
    formula: "actual / budget * 100",
    parts: [
      { name: "actual", table: "cost_entry", fn: "sum", field: "amount", date_field: "entry_date" },
      { name: "budget", table: "budget_line", fn: "sum", field: "amount", date_field: "period_id.start_date", filter: { f: "budget_id.state", op: "in", v: ["approved", "locked"] } },
    ],
    target: 100, warn: 105, crit: 115, score_roles: FINANCE_READERS, collect: true,
  },
  // ----- security operations, vulnerabilities, compliance and risk (the security module installed) ---------------------
  // live values run as each viewer: outside the secure workspace they count nothing; stored scores go to SOC_READERS…
  {
    key: "security.open_incidents", name: "رخدادهای امنیتی باز", practice: "security", unit: "count", direction: "down", grain: "day",
    description: "رخدادهای امنیتی بازِ لحظهٔ اندازه‌گیری، با تفکیک شدت. فقط اعضای مرکز عملیات امنیت عددها را می‌بینند.",
    formula: "open", parts: [{ name: "open", table: "sec_incident", fn: "count", filter: OPEN }],
    breakdowns: ["severity"], score_roles: SOC_READERS, collect: true,
  },
  {
    key: "security.mttc", name: "میانگین زمان مهار رخداد امنیتی (MTTC)", practice: "security", unit: "duration", direction: "down", grain: "month",
    description: "میانگین زمان از کشف تا مهار رخدادهای امنیتی‌ای که در دوره مهار شدند.",
    formula: "mttc", parts: [{ name: "mttc", table: "sec_incident", fn: "avg", field: "time_to_contain", date_field: "contained_at", filter: { f: "time_to_contain", op: "nempty" } }],
    breakdowns: ["severity"], score_roles: SOC_READERS, collect: true,
  },
  {
    key: "security.vuln_overdue", name: "آسیب‌پذیری‌های گذشته از موعد رفع", practice: "security", unit: "count", direction: "down", grain: "day",
    description: "یافته‌های آسیب‌پذیری بازی که از موعد رفع گذشته‌اند (در لحظهٔ اندازه‌گیری)، با تفکیک ردهٔ ریسک.",
    formula: "overdue", parts: [{ name: "overdue", table: "sec_vuln_item", fn: "count", filter: { and: [{ f: "overdue", op: "eq", v: true }, { f: "state", op: "in", v: ["open", "in_remediation", "deferred"] }] } }],
    target: 0, warn: 5, crit: 20, breakdowns: ["risk_rating"], score_roles: VULN_READERS, collect: true,
  },
  {
    key: "security.control_pass_rate", name: "نرخ موفقیت آزمون کنترل‌ها", practice: "security", unit: "percent", direction: "up", grain: "quarter",
    description: "سهم آزمون‌های کنترلِ ثبت‌شده در دوره که نتیجهٔ «اثربخش» داشتند.",
    formula: "passed / tested * 100",
    parts: [
      { name: "passed", table: "grc_control_test", fn: "count", date_field: "completed_at", filter: { f: "conclusion", op: "eq", v: "effective" } },
      { name: "tested", table: "grc_control_test", fn: "count", date_field: "completed_at", filter: { f: "conclusion", op: "nempty" } },
    ],
    target: 90, warn: 80, crit: 65, score_roles: GRC_READERS, collect: true,
  },
  {
    key: "security.risks_above_appetite", name: "ریسک‌های بالاتر از اشتها", practice: "security", unit: "count", direction: "down", grain: "day",
    description: "ریسک‌های فعال ثبت‌شده که ریسک باقی‌مانده‌شان بالاتر از اشتهای ریسک سازمان است (در لحظهٔ اندازه‌گیری).",
    formula: "above", parts: [{ name: "above", table: "grc_risk", fn: "count", filter: { and: [{ f: "above_appetite", op: "eq", v: true }, { f: "state", op: "nin", v: ["closed", "retired"] }] } }],
    target: 0, warn: 3, crit: 8, breakdowns: ["residual_rating"], score_roles: GRC_READERS, collect: true,
  },
  // ----- the self-service portal (the portal module installed) ---------------------------------------------------------
  {
    key: "portal.csat", name: "رضایت پاسخ‌دهندگان نظرسنجی (CSAT)", practice: "portal", unit: "percent", direction: "up", grain: "month",
    description: "سهم پاسخ‌های «راضی» (امتیاز رضایت در آستانهٔ هر نظرسنجی یا بالاتر) از همهٔ پاسخ‌های امتیازدارِ نظرسنجی‌های دوره.",
    formula: "satisfied / rated * 100",
    parts: [
      { name: "satisfied", table: "survey_response", fn: "count", date_field: "submitted_at", filter: { and: [{ f: "csat", op: "nempty" }, { f: "satisfied", op: "eq", v: true }] } },
      { name: "rated", table: "survey_response", fn: "count", date_field: "submitted_at", filter: { f: "csat", op: "nempty" } },
    ],
    target: 85, warn: 75, crit: 60, breakdowns: ["survey_id"], score_roles: PORTAL_READERS, collect: true, requires: ["portal"],
  },
  {
    key: "portal.deflection", name: "نرخ پیشگیری دستیار مجازی", practice: "portal", unit: "percent", direction: "up", grain: "month",
    description: "سهم گفتگوهای دستیار مجازی دوره (درگاه، ابزارک و پیام‌رسان‌ها) که بی‌واگذاری به کارشناس پایان یافتند — درخواستی که به میز خدمت نرسید.",
    formula: "contained / conversations * 100",
    parts: [
      { name: "contained", table: "va_conversation", fn: "count", date_field: "created_at", filter: { and: [{ f: "state", op: "ne", v: "handoff" }, { f: "handoff_id", op: "empty" }] } },
      { name: "conversations", table: "va_conversation", fn: "count", date_field: "created_at" },
    ],
    target: 60, warn: 45, crit: 30, breakdowns: ["channel"], score_roles: PORTAL_READERS, collect: true, requires: ["portal"],
  },
  {
    key: "portal.self_service_share", name: "سهم سلف‌سرویس از رخدادها", practice: "portal", unit: "percent", direction: "up", grain: "month",
    description: "سهم رخدادهای ثبت‌شدهٔ دوره که کاربران خودشان از درگاه، دستیار مجازی یا پیام‌رسان‌ها ثبت کردند.",
    formula: "self / all * 100",
    parts: [
      { name: "self", table: "incident", fn: "count", date_field: "created_at", filter: { f: "channel", op: "in", v: ["portal", "chat", "messenger"] } },
      { name: "all", table: "incident", fn: "count", date_field: "created_at" },
    ],
    target: 60, warn: 45, crit: 30, breakdowns: ["channel"], score_roles: PORTAL_READERS, collect: true, requires: ["portal"],
  },
  // ----- knowledge and service levels -------------------------------------------------------------------------------
  {
    key: "knowledge.published", name: "مقاله‌های تازه منتشرشده", practice: "knowledge", unit: "count", direction: "up", grain: "month",
    description: "مقاله‌هایی که نخستین بار در دوره منتشر شدند.",
    formula: "published", parts: [{ name: "published", table: "kb_article", fn: "count", date_field: "first_published_at" }],
    score_roles: ["knowledge_manager", "tenant_admin"], collect: true,
  },
  {
    key: "knowledge.helpfulness", name: "سودمندی مقاله‌ها", practice: "knowledge", unit: "percent", direction: "up", grain: "month",
    description: "سهم رأی‌های «مفید بود» از همهٔ رأی‌های مقاله‌های منتشرشده (تاکنون).",
    formula: "yes / (yes + no) * 100",
    parts: [
      { name: "yes", table: "kb_article", fn: "sum", field: "helpful_yes", filter: { f: "state", op: "eq", v: "published" } },
      { name: "no", table: "kb_article", fn: "sum", field: "helpful_no", filter: { f: "state", op: "eq", v: "published" } },
    ],
    target: 80, warn: 65, crit: 50, score_roles: ["knowledge_manager", "tenant_admin"], collect: true,
  },
  {
    key: "sla.breaches", name: "نقض‌های SLA", practice: "sla", unit: "count", direction: "down", grain: "month",
    description: "تعداد زمان‌سنج‌هایی که در دوره نقض شدند (همهٔ جدول‌ها).",
    formula: "breached", parts: [{ name: "breached", table: "task_sla", fn: "count", date_field: "breached_at", filter: { f: "breached", op: "eq", v: true } }],
    breakdowns: ["table_key"], score_roles: ["service_desk_manager", "tenant_admin"], collect: true,
  },
];

/** The library entries whose tables and fields exist here (modules not installed are skipped). */
export function libraryFor(lookup: Lookup): LibraryIndicator[] {
  return KPI_LIBRARY.filter((k) => indicatorProblem(k, lookup) === null && (k.requires ?? []).every((t) => !!lookup(t)));
}

// ----- seeded dashboards ---------------------------------------------------------------------------------------------

export interface LibraryDashboard {
  key: string;
  name: string;
  description: string;
  /** the table it needs (skipped when missing) */
  table: string;
  layout: DashboardLayout;
  filters: DashboardFilter[];
  shares: Share[];
  is_home: boolean;
}

const LAST_30: ReportSpec["time"] = { field: "opened_at", window: { unit: "day", from: -29, to: 0 } };
const w = (id: string, x: number, y: number, ww: number, h: number, rest: Partial<Widget>): Widget => ({ id, kind: "report", x, y, w: ww, h, ...rest }) as Widget;
const r = (spec: Omit<ReportSpec, "v">): ReportSpec => ({ v: 1, ...spec });
const roleShares = (roles: string[]): Share[] => roles.map((id) => ({ kind: "role", id, right: "view" }));

export const LIBRARY_DASHBOARDS: LibraryDashboard[] = [
  {
    key: "service_desk",
    name: "داشبورد میز خدمت",
    description: "صف کار، زمان‌های پذیرش و حل، پایبندی به SLA، بار گروه‌ها و الگوی ثبت رخدادها — هر بیننده فقط رخدادهای مجاز خودش را می‌بیند.",
    table: "incident",
    is_home: true,
    shares: roleShares(["agent", "team_lead", "service_desk_manager", "incident_manager", "problem_manager", "auditor"]),
    filters: [
      { key: "time", kind: "time", label: "بازهٔ زمانی" },
      { key: "group", kind: "field", field: "assignment_group_id", label: "گروه" },
      { key: "priority", kind: "field", field: "priority", label: "اولویت" },
    ],
    layout: {
      widgets: [
        { id: "k1", kind: "indicator", x: 0, y: 0, w: 3, h: 3, indicator_key: "incident.backlog" },
        { id: "k2", kind: "indicator", x: 3, y: 0, w: 3, h: 3, indicator_key: "incident.mtta" },
        { id: "k3", kind: "indicator", x: 6, y: 0, w: 3, h: 3, indicator_key: "incident.mttr" },
        { id: "k4", kind: "indicator", x: 9, y: 0, w: 3, h: 3, indicator_key: "incident.sla_compliance" },
        w("open_priority", 0, 3, 4, 6, { title: "رخدادهای باز به تفکیک اولویت", spec: r({ table: "incident", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "priority" }], viz: "donut", sort: { by: "key", dir: "asc" } }) }),
        w("trend", 4, 3, 8, 6, { title: "رخدادهای ثبت‌شده در ۳۰ روز گذشته", spec: r({ table: "incident", time: LAST_30, measures: [{ fn: "count", label: "ثبت‌شده" }], dims: [{ field: "opened_at", bucket: "day" }], viz: "line", compare: true }) }),
        w("ttr_priority", 0, 9, 6, 6, { title: "زمان حل به تفکیک اولویت", spec: r({ table: "incident", time: { field: "resolved_at", window: { unit: "day", from: -29, to: 0 } }, filter: RESOLVED, measures: [{ fn: "median", field: "time_to_resolve", label: "میانه" }, { fn: "p90", field: "time_to_resolve", label: "صدک ۹۰" }], dims: [{ field: "priority" }], viz: "column", sort: { by: "key", dir: "asc" } }) }),
        w("groups", 6, 9, 6, 6, { title: "بار کاری گروه‌ها", spec: r({ table: "incident", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "assignment_group_id" }], viz: "bar", limit: 8, other: true, sort: { by: "value", dir: "desc" } }) }),
        w("heat", 0, 15, 12, 6, { title: "الگوی ثبت: روز هفته × ساعت", spec: r({ table: "incident", time: { field: "opened_at", window: { unit: "day", from: -89, to: 0 } }, measures: [{ fn: "count" }], dims: [{ field: "opened_at", bucket: "weekday" }, { field: "opened_at", bucket: "hour_of_day" }], viz: "heatmap" }) }),
        w("ageing", 0, 21, 6, 5, { title: "سن رخدادهای باز (روز)", spec: r({ table: "incident", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "opened_at", ranges: [1, 3, 7, 30] }], viz: "column", sort: { by: "key", dir: "asc" } }) }),
        w("pareto", 6, 21, 6, 5, { title: "دسته‌های پرتکرار (پارتو)", spec: r({ table: "incident", time: { field: "opened_at", window: { unit: "day", from: -89, to: 0 } }, measures: [{ fn: "count" }], dims: [{ field: "category" }], viz: "pareto", limit: 10, other: true }) }),
        { id: "score", kind: "scorecard", x: 0, y: 26, w: 12, h: 7, title: "کارت امتیاز رخداد", indicator_keys: ["incident.volume", "incident.mtta", "incident.mttr", "incident.fcr", "incident.reopen_rate", "incident.sla_compliance", "incident.aged_backlog", "incident.csat"] },
      ],
    },
  },
  {
    key: "change_management",
    name: "داشبورد مدیریت تغییر",
    description: "موفقیت و شکست تغییرها، سهم اضطراری، رخدادهای ناشی از تغییر، قیف تغییرهای باز و برنامهٔ هفتهٔ پیش رو.",
    table: "change_request",
    is_home: false,
    shares: roleShares(["change_manager", "release_manager", "service_desk_manager", "team_lead", "agent", "auditor"]),
    filters: [
      { key: "time", kind: "time", label: "بازهٔ زمانی" },
      { key: "group", kind: "field", field: "assignment_group_id", label: "گروه" },
      { key: "type", kind: "field", field: "type", label: "نوع تغییر" },
    ],
    layout: {
      widgets: [
        { id: "k1", kind: "indicator", x: 0, y: 0, w: 3, h: 3, indicator_key: "change.success_rate" },
        { id: "k2", kind: "indicator", x: 3, y: 0, w: 3, h: 3, indicator_key: "change.emergency_rate" },
        { id: "k3", kind: "indicator", x: 6, y: 0, w: 3, h: 3, indicator_key: "change.caused_incidents" },
        { id: "k4", kind: "indicator", x: 9, y: 0, w: 3, h: 3, indicator_key: "change.lead_time" },
        w("monthly", 0, 3, 8, 6, { title: "تغییرها در هر ماه به تفکیک نوع", spec: r({ table: "change_request", time: { field: "opened_at", window: { unit: "month", from: -11, to: 0 } }, measures: [{ fn: "count" }], dims: [{ field: "opened_at", bucket: "month" }, { field: "type" }], viz: "column", options: { stacked: true } }) }),
        w("outcomes", 8, 3, 4, 6, { title: "نتیجهٔ اجرا", spec: r({ table: "change_request", time: { field: "actual_end", window: { unit: "day", from: -89, to: 0 } }, filter: { f: "close_code", op: "in", v: ["successful", "successful_issues", "unsuccessful", "backed_out"] }, measures: [{ fn: "count" }], dims: [{ field: "close_code" }], viz: "donut" }) }),
        w("funnel", 0, 9, 4, 6, { title: "قیف تغییرهای باز", spec: r({ table: "change_request", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "state" }], viz: "funnel", sort: { by: "key", dir: "asc" } }) }),
        w("risk", 4, 9, 8, 6, { title: "نرخ شکست به تفکیک ریسک", spec: r({ table: "change_request", time: { field: "actual_end", window: { unit: "day", from: -179, to: 0 } }, filter: { f: "close_code", op: "in", v: ["successful", "successful_issues", "unsuccessful", "backed_out"] }, measures: [{ fn: "ratio", filter: { f: "close_code", op: "in", v: ["unsuccessful", "backed_out"] }, label: "نرخ شکست" }], dims: [{ field: "risk" }], viz: "column", sort: { by: "key", dir: "asc" } }) }),
        w("upcoming", 0, 15, 12, 6, { title: "تغییرهای هفت روز پیش رو", spec: r({ table: "change_request", time: { field: "planned_start", window: { unit: "day", from: 0, to: 6 } }, measures: [], dims: [], columns: ["number", "short_description", "type", "risk", "planned_start", "assigned_to"], viz: "list", options: { order: "planned_start" } }) }),
        { id: "score", kind: "scorecard", x: 0, y: 21, w: 12, h: 6, title: "کارت امتیاز تغییر", indicator_keys: ["change.success_rate", "change.emergency_rate", "change.caused_incidents", "change.lead_time"] },
      ],
    },
  },
  {
    key: "release_devops",
    name: "داشبورد انتشار و دواپس",
    description: "چهار شاخص DORA از استقرارهای عملیاتی، انتشارهای به‌موقع و اضطراری، استقرارها در هر هفته و نتیجهٔ آن‌ها — هر بیننده فقط استقرارهای مجاز خودش را می‌بیند.",
    table: "deployment",
    is_home: false,
    shares: roleShares(["release_manager", "change_manager", "release_engineer", "auditor"]),
    filters: [
      { key: "time", kind: "time", label: "بازهٔ زمانی" },
      { key: "service", kind: "field", field: "service_id", label: "خدمت" },
    ],
    layout: {
      widgets: [
        { id: "k1", kind: "indicator", x: 0, y: 0, w: 3, h: 3, indicator_key: "devops.deployment_frequency" },
        { id: "k2", kind: "indicator", x: 3, y: 0, w: 3, h: 3, indicator_key: "devops.lead_time" },
        { id: "k3", kind: "indicator", x: 6, y: 0, w: 3, h: 3, indicator_key: "devops.change_failure_rate" },
        { id: "k4", kind: "indicator", x: 9, y: 0, w: 3, h: 3, indicator_key: "devops.time_to_restore" },
        w("weekly", 0, 3, 8, 6, { title: "استقرارهای عملیاتی در هر هفته", spec: r({ table: "deployment", time: { field: "actual_end", window: { unit: "week", from: -11, to: 0 } }, filter: PROD_FINISHED, measures: [{ fn: "count" }], dims: [{ field: "actual_end", bucket: "week" }, { field: "change_failure" }], viz: "column", options: { stacked: true } }) }),
        w("states", 8, 3, 4, 6, { title: "نتیجهٔ استقرارها", spec: r({ table: "deployment", time: { field: "actual_end", window: { unit: "day", from: -89, to: 0 } }, filter: PROD_FINISHED, measures: [{ fn: "count" }], dims: [{ field: "state" }], viz: "donut" }) }),
        { id: "score", kind: "scorecard", x: 0, y: 9, w: 12, h: 6, title: "کارت امتیاز انتشار", indicator_keys: ["devops.deployment_frequency", "devops.lead_time", "devops.change_failure_rate", "devops.time_to_restore", "release.on_time", "release.emergency_share"] },
      ],
    },
  },
];

/** The seeded dashboards whose table exists and whose every report definition is valid here. */
export function dashboardsFor(lookup: Lookup): LibraryDashboard[] {
  return LIBRARY_DASHBOARDS.filter((d) => {
    const def = lookup(d.table);
    if (!def) return false;
    return d.layout.widgets.every((x) => !x.spec || specProblem(x.spec, lookup(x.spec.table), lookup) === null);
  });
}
