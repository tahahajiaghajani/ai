// Tables of service level management (docs/modules/slm_FA.md, catalogue docs/catalog/g7_levels_analytics.md
// «Module: slm»). The module adds the service-level layer on top of what the platform already has — it never repeats it:
//   · agreements are the service portfolio's `service_agreement` (AGR), extended here — kinds SLA / OLA / UC /
//     SIAM collaboration / first-line support, an eight-stage lifecycle with approvals, version, review cadence,
//     compliance and at-risk targets, the agreement document and the customer's acceptance (`extendTable` below)
//   · the measurable targets of an agreement (`slm_target`) are the SLA service's `sla_definition` timers (linked, or
//     generated and kept in step from the target), the service's availability (the portfolio's daily scores),
//     experience (XLA scores, survey responses) or an analytics indicator — with a compliance and an at-risk goal
//   · compliance per Jalali review period (`slm_compliance`), service credits and disputes (`slm_credit`), service
//     reviews with their generated pack (`slm_review`), the continual improvement register and plans
//     (`slm_improvement`, `slm_csi_plan`), XLA policies and live experience scores of records (`slm_xla_policy`,
//     `slm_xla_score`), agreement templates (`slm_template` + `slm_template_target`) and the settings row
// Behaviour lives in src/server/modules/slm; screens in src/ui/modules/slm. Area `sla` («توافق سطح خدمت»); the
// agreement itself stays in the portfolio's area `service`.
// Imported by the UI: keep it free of server imports.
import type { FieldDef, FormLayout, ListLayout, Option, ScopeFields, StateModel, TableDef, TableFeatures } from "../model/types";
import { NEVER } from "../model/conditions";
import { APPROVAL_STATES } from "../model/task";
import { SERVICE_PORTFOLIO_TABLES, OFFERING_LEVELS } from "./service_portfolio";
import { SLA_TARGETS } from "./sla";

const yes = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

export const AGREEMENT_KINDS: Option[] = [
  yes("sla", "توافق سطح خدمت (SLA)", 1, "blue"),
  yes("ola", "توافق سطح عملیات (OLA)", 2, "teal"),
  yes("uc", "قرارداد پشتیبان (UC)", 3, "purple"),
  yes("collaboration", "توافق همکاری ارائه‌دهندگان (SIAM)", 4, "indigo"),
  yes("flsa", "توافق پشتیبانی خط اول", 5, "gray"),
];

/** The SLA service's timer type a kind of agreement generates. */
export const TIMER_TYPE_OF: Record<string, "sla" | "ola" | "uc"> = { sla: "sla", ola: "ola", uc: "uc", collaboration: "ola", flsa: "sla" };

/** Kinds whose targets the customer sees (OLA, UC and collaboration targets are internal). */
export const CUSTOMER_KINDS = ["sla", "flsa"];

export const METRIC_CATEGORIES: Option[] = [
  yes("warranty", "تضمین (دسترس‌پذیری، زمان پاسخ و حل)", 1, "blue"),
  yes("utility", "سودمندی (کارکرد و نتیجه)", 2, "teal"),
  yes("experience", "تجربه (رضایت، XLA)", 3, "magenta"),
  yes("sustainability", "پایداری", 4, "green"),
];

export const TARGET_KINDS: Option[] = [
  yes("timer", "زمان‌سنج (پاسخ یا حل)", 1, "blue"),
  yes("availability", "دسترس‌پذیری خدمت", 2, "green"),
  yes("experience", "امتیاز تجربه (XLA)", 3, "magenta"),
  yes("satisfaction", "رضایت (CSAT)", 4, "purple"),
  yes("indicator", "شاخص تحلیلی", 5, "indigo"),
  yes("manual", "ثبت دستی در هر دوره", 6, "gray"),
];

export const REVIEW_PERIODS: Option[] = [yes("month", "ماهانه", 1), yes("quarter", "فصلی", 2), yes("year", "سالانه", 3)];

export const XLA_CLAUSES: Option[] = [
  yes("reporting", "فقط گزارش", 1, "gray"),
  yes("target", "هدف قراردادی", 2, "blue"),
  yes("bonus_malus", "پاداش و جریمه", 3, "orange"),
  yes("gain_share", "سهم از صرفه‌جویی", 4, "green"),
];

export const COMPLIANCE_STATUSES: Option[] = [
  yes("met", "برآورده", 1, "green"),
  yes("at_risk", "در خطر", 2, "gold"),
  yes("missed", "برآورده نشد", 3, "red"),
  yes("no_data", "بی‌داده", 4, "gray"),
];

export const XLA_BANDS: Option[] = [
  yes("excellent", "عالی", 1, "green"),
  yes("good", "خوب", 2, "teal"),
  yes("fair", "متوسط", 3, "gold"),
  yes("poor", "ضعیف", 4, "red"),
];

export const REVIEW_KINDS: Option[] = [yes("interval", "دوره‌ای", 1, "blue"), yes("event", "رویدادمحور (رخداد عمده، تغییر بزرگ)", 2, "orange")];

export const IMPROVEMENT_SOURCES: Option[] = [
  yes("review", "بازبینی خدمت", 1, "blue"),
  yes("breach", "نقض توافق", 2, "red"),
  yes("survey", "نظرسنجی و تجربه", 3, "magenta"),
  yes("complaint", "شکایت", 4, "orange"),
  yes("audit", "ممیزی", 5, "purple"),
  yes("idea", "پیشنهاد کارکنان", 6, "teal"),
  yes("ai", "پیشنهاد هوش مصنوعی", 7, "indigo"),
];

// ---------------------------------------------------------------------------------------------------------------
// The agreement lifecycle (SLM-002): requirements → viability → draft → negotiation → approval → communication and
// enablement → in force with periodic review → renewal → expiry or withdrawal. In force = the «active» category: the
// portfolio's `status` follows it (active / expired / draft), so entitlement and the portfolio's lists keep working.

export const AGREEMENT_STATES: StateModel = {
  field: "state",
  initial: "requirements",
  states: [
    { value: "requirements", label: "گردآوری نیازها", category: "new", color: "blue" },
    { value: "viability", label: "بررسی امکان‌پذیری", category: "new", color: "blue" },
    { value: "draft", label: "تدوین پیش‌نویس", category: "new", color: "indigo" },
    { value: "negotiation", label: "مذاکره", category: "waiting", color: "gold" },
    { value: "awaiting_approval", label: "در انتظار تأیید", category: "waiting", color: "orange" },
    { value: "enablement", label: "ابلاغ و آماده‌سازی", category: "waiting", color: "teal" },
    { value: "active", label: "در جریان", category: "active", color: "green" },
    { value: "under_review", label: "در بازبینی", category: "active", color: "teal" },
    { value: "renewal", label: "در تمدید", category: "active", color: "purple" },
    { value: "expired", label: "پایان‌یافته", category: "closed", color: "gray" },
    { value: "withdrawn", label: "خارج‌شده", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
  ],
  transitions: [
    { from: ["requirements"], to: "viability", label: "بررسی امکان‌پذیری" },
    { from: ["requirements", "viability"], to: "draft", label: "تدوین پیش‌نویس" },
    { from: ["draft"], to: "negotiation", label: "آغاز مذاکره" },
    { from: ["draft", "negotiation"], to: "awaiting_approval", label: "ارسال برای تأیید", guard: "agreement_ready" },
    { from: ["awaiting_approval"], to: "enablement", label: "تأیید (بی‌گردش تأیید)", roles: { area: "service", level: "full" }, guard: "agreement_ready" },
    { from: ["awaiting_approval"], to: "negotiation", label: "بازگشت به مذاکره" },
    { from: ["awaiting_approval", "negotiation"], to: "rejected", label: "رد توافق", requires: ["closed_note"], roles: { area: "service", level: "full" } },
    { from: ["enablement"], to: "active", label: "آغاز اجرا", guard: "agreement_ready" },
    { from: ["active"], to: "under_review", label: "آغاز بازبینی" },
    { from: ["under_review"], to: "active", label: "پایان بازبینی" },
    { from: ["active", "under_review"], to: "renewal", label: "آغاز تمدید" },
    { from: ["renewal"], to: "active", label: "تمدید شد", requires: ["valid_to"] },
    { from: ["expired"], to: "renewal", label: "احیا و تمدید" },
    { from: ["active", "under_review", "renewal"], to: "expired", label: "پایان اعتبار" },
    { from: ["requirements", "viability", "draft", "negotiation", "enablement", "active", "under_review", "renewal"], to: "withdrawn", label: "خروج از خدمت", requires: ["closed_note"] },
  ],
  locked: ["closed", "canceled"],
};

/** Agreement states in force (the «active» category). */
export const AGREEMENT_IN_FORCE = ["active", "under_review", "renewal"];

// ---------------------------------------------------------------------------------------------------------------
// Extending another module's table (local until the engine offers it: docs/modules/slm_FA.md «درخواست از سکو»)

export interface TableExtension {
  fields?: FieldDef[];
  /** properties of existing fields to change (help, section, tab, list…) */
  override?: Record<string, Partial<FieldDef>>;
  states?: StateModel;
  scope?: Partial<ScopeFields>;
  features?: TableFeatures;
  form?: FormLayout;
  list?: ListLayout;
  ai?: TableDef["ai"];
}

/**
 * Add fields, a state model, features and layout to a table another module defines, before the registry builds it
 * (the module's file is imported by src/shared/tables/index.ts before the registry is assembled). Additive only:
 * fields with an existing name are skipped, existing features stay on, scope lists are merged.
 */
export function extendTable(defs: TableDef[], key: string, ext: TableExtension): TableDef | null {
  const def = defs.find((d) => d.key === key);
  if (!def) return null;
  const names = new Set(def.fields.map((f) => f.name));
  def.fields = [...def.fields.map((f) => (ext.override?.[f.name] ? { ...f, ...ext.override[f.name] } : f)), ...(ext.fields ?? []).filter((f) => !names.has(f.name))];
  if (ext.states && !def.states) def.states = ext.states;
  if (ext.scope) {
    const own = [...new Set([...(def.scope.own ?? []), ...(ext.scope.own ?? [])])];
    def.scope = { ...def.scope, ...ext.scope, own };
  }
  if (ext.features) def.features = { ...ext.features, ...(def.features ?? {}) };
  if (ext.form) def.form = { ...(def.form ?? {}), ...ext.form, related: [...(def.form?.related ?? []), ...(ext.form.related ?? [])] };
  if (ext.list) def.list = ext.list;
  if (ext.ai && !def.ai) def.ai = ext.ai;
  return def;
}

const A_MAIN = "اصلی";
const A_PARTIES = "نوع و طرف‌ها";
const A_MEASURE = "اهداف و سنجش";
const A_DOC = "سند توافق";
const A_LIFE = "چرخهٔ عمر و بازبینی";

export const AGREEMENT_EXTENSION: TableExtension = {
  fields: [
    { name: "kind", label: "نوع توافق", type: "choice", choices: AGREEMENT_KINDS, default: "sla", required: true, list: true, filter: true, span: 8, section: A_PARTIES },
    { name: "provider_group_id", label: "گروه ارائه‌دهنده", type: "group", list: true, filter: true, index: true, span: 8, section: A_PARTIES, help: "برای OLA: گروهی که زمان‌سنج‌ها هنگام ارجاع به آن شروع می‌شوند" },
    { name: "customer_contact_id", label: "نمایندهٔ مشتری", type: "user", filter: true, span: 8, section: A_PARTIES },
    { name: "supplier_name", label: "تأمین‌کننده", type: "string", maxLength: 160, search: true, filter: true, span: 8, section: A_PARTIES, help: "برای قرارداد پشتیبان (UC)" },
    { name: "contract_ref", label: "شمارهٔ قرارداد", type: "string", maxLength: 80, ltr: true, span: 8, section: A_PARTIES },
    { name: "parent_agreement_id", label: "توافق بالادستی", type: "ref", ref: "service_agreement", filter: true, index: true, span: 8, section: A_PARTIES, help: "ساختار چندسطحی: توافق سازمانی ← توافق مشتری ← توافق خدمت" },
    { name: "compliance_target", label: "هدف انطباق (٪)", type: "percent", default: "95", min: 0, max: 100, span: 8, section: A_MEASURE },
    { name: "at_risk_target", label: "آستانهٔ هشدار (٪)", type: "percent", default: "97", min: 0, max: 100, span: 8, section: A_MEASURE, help: "زیر این مقدار، و هنوز بالای هدف، توافق «در خطر» است" },
    { name: "review_period", label: "دورهٔ سنجش", type: "choice", choices: REVIEW_PERIODS, default: "month", span: 8, section: A_MEASURE },
    { name: "calendar_id", label: "ساعات خدمت (تقویم)", type: "ref", ref: "calendar", span: 8, section: A_MEASURE, help: "تقویم پیش‌فرض زمان‌سنج‌های ساخته‌شده از اهداف" },
    { name: "volume_limit", label: "سقف حجم ماهانه", type: "int", min: 0, max: 10_000_000, span: 8, section: A_MEASURE, help: "رکوردهای بیش از این سقف در گزارش جدا شمرده می‌شوند" },
    { name: "monthly_fee", label: "بهای ماهانه", type: "money", group: "financial", span: 8, section: A_MEASURE, help: "پایهٔ محاسبهٔ جریمهٔ خدمت" },
    { name: "compliance_pct", label: "انطباق دورهٔ جاری (٪)", type: "percent", readonly: true, audit: false, list: true, span: 8, section: A_MEASURE },
    { name: "compliance_status", label: "وضعیت انطباق", type: "choice", choices: COMPLIANCE_STATUSES, readonly: true, audit: false, list: true, filter: true, span: 8, section: A_MEASURE },
    { name: "experience_pct", label: "تجربهٔ دورهٔ جاری (٪)", type: "percent", readonly: true, audit: false, span: 8, section: A_MEASURE },
    { name: "watermelon", label: "سبز در توافق، قرمز در تجربه", type: "bool", default: false, readonly: true, audit: false, filter: true, span: 8, section: A_MEASURE },
    { name: "measured_at", label: "آخرین سنجش", type: "datetime", readonly: true, audit: false, span: 8, section: A_MEASURE },
    { name: "service_hours", label: "ساعات و پوشش خدمت", type: "markdown", tab: A_DOC, span: 24 },
    { name: "responsibilities", label: "مسئولیت‌های طرفین", type: "markdown", tab: A_DOC, span: 24, ai: { index: true } },
    { name: "escalation", label: "مسیر تشدید و ارتباط", type: "markdown", tab: A_DOC, span: 24 },
    { name: "exclusions", label: "استثناها", type: "markdown", tab: A_DOC, span: 24, ai: { index: true } },
    { name: "agreement_version", label: "نسخه", type: "int", default: 1, readonly: true, list: true, span: 6, tab: A_LIFE },
    { name: "review_months", label: "فاصلهٔ بازبینی (ماه)", type: "int", default: 3, min: 1, max: 24, span: 6, tab: A_LIFE },
    { name: "next_review_at", label: "بازبینی بعدی", type: "date", list: true, sort: true, filter: true, span: 6, tab: A_LIFE },
    { name: "last_review_at", label: "آخرین بازبینی", type: "date", readonly: true, span: 6, tab: A_LIFE },
    { name: "review_overdue", label: "بازبینی عقب افتاده", type: "bool", default: false, system: true, filter: true, audit: false },
    { name: "review_reminded_for", label: "یادآوری بازبینی برای", type: "date", system: true, hidden: true, audit: false },
    { name: "expiry_reminded_for", label: "یادآوری تمدید برای", type: "date", system: true, hidden: true, audit: false },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8, tab: A_LIFE },
    { name: "accepted_at", label: "پذیرش مشتری", type: "datetime", readonly: true, span: 8, tab: A_LIFE },
    { name: "accepted_by", label: "پذیرفته‌شده توسط", type: "user", readonly: true, span: 8, tab: A_LIFE },
    { name: "template_id", label: "ساخته‌شده از الگو", type: "ref", ref: "slm_template", readonly: true, span: 12, tab: A_LIFE },
    { name: "closed_note", label: "توضیح رد یا خروج", type: "text", maxLength: 2000, span: 24, tab: A_LIFE },
  ],
  override: {
    status: { help: "از چرخهٔ عمر توافق پیروی می‌کند: «در جریان» تا وقتی توافق اجرا می‌شود" },
    terms: { tab: A_DOC, ai: { index: true } },
    manager_id: { label: "مالک توافق", list: true },
  },
  states: AGREEMENT_STATES,
  scope: { group: "provider_group_id" },
  features: { journal: true, attachments: true, links: true },
  form: {
    sections: [A_MAIN, A_PARTIES, A_MEASURE],
    tabs: [A_DOC, A_LIFE],
    related: [
      { table: "slm_target", field: "agreement_id", label: "اهداف", columns: ["name", "kind", "goal", "current_value", "current_status", "active"] },
      { table: "service_agreement", field: "parent_agreement_id", label: "توافق‌های زیرمجموعه", columns: ["number", "name", "kind", "state", "valid_to"] },
      { table: "slm_review", field: "agreement_id", label: "بازبینی‌ها", columns: ["number", "title", "scheduled_at", "state"] },
      { table: "slm_compliance", field: "agreement_id", label: "انطباق دوره‌ها", columns: ["period_label", "target_id", "value", "goal", "status", "final"] },
      { table: "slm_credit", field: "agreement_id", label: "جریمه‌ها", columns: ["number", "period_label", "credit_pct", "state"] },
    ],
  },
  list: { columns: ["number", "name", "kind", "customer_unit_id", "service_id", "state", "compliance_status", "valid_to"], order: "-valid_to" },
  ai: { title: "name", text: ["terms", "responsibilities", "exclusions"] },
};

extendTable(SERVICE_PORTFOLIO_TABLES, "service_agreement", AGREEMENT_EXTENSION);

// ---------------------------------------------------------------------------------------------------------------
// Targets (SLM-004/005/006/039/042): what an agreement promises and how it is measured

const HOURS = (p: string, section: string): FieldDef => ({
  name: `p${p}_hours`, label: `اولویت ${"۱۲۳۴۵"[Number(p) - 1]} (ساعت)`, type: "decimal", min: 0, max: 100_000, span: 6, section,
});

const T_MAIN = "هدف";
const T_TIMER = "زمان‌سنج";
const T_MONEY = "جریمه";

/** Fields shared by a template's target lines and an agreement's targets. */
function targetFields(): FieldDef[] {
  return [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12, section: T_MAIN },
    { name: "kind", label: "نوع", type: "choice", choices: TARGET_KINDS, default: "timer", required: true, list: true, filter: true, span: 6, section: T_MAIN },
    { name: "metric_category", label: "دستهٔ سنجه", type: "choice", choices: METRIC_CATEGORIES, default: "warranty", filter: true, span: 6, section: T_MAIN },
    { name: "goal", label: "هدف", type: "decimal", min: 0, max: 100, list: true, span: 6, section: T_MAIN, help: "زمان‌سنج: درصد رکوردهای در موعد؛ دسترس‌پذیری: درصد؛ تجربه و رضایت: امتیاز ۰ تا ۱۰۰" },
    { name: "at_risk", label: "آستانهٔ هشدار", type: "decimal", min: 0, max: 100, span: 6, section: T_MAIN, help: "زیر این مقدار و بالای هدف: «در خطر»؛ خالی: آستانهٔ توافق" },
    { name: "customer_facing", label: "به مشتری نشان داده شود", type: "bool", default: true, filter: true, span: 6, section: T_MAIN },
    { name: "xla_clause", label: "بند تجربه در قرارداد", type: "choice", choices: XLA_CLAUSES, default: "reporting", span: 6, section: T_MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 10, sort: true, span: 6, section: T_MAIN },
    { name: "table_key", label: "جدول رکوردها", type: "string", maxLength: 60, default: "incident", ltr: true, span: 8, section: T_TIMER, help: "کلید جدول، مثل incident یا request_item" },
    { name: "timer_target", label: "سنجهٔ زمان", type: "choice", choices: SLA_TARGETS.filter((o) => o.value !== "custom"), default: "resolution", span: 8, section: T_TIMER },
    ...["1", "2", "3", "4", "5"].map((p) => HOURS(p, T_TIMER)),
    { name: "credit_tiers", label: "پله‌های جریمه", type: "json", group: "financial", span: 24, section: T_MONEY, help: 'مانند [{"below": 95, "pct": 5}, {"below": 90, "pct": 10}] — درصدی از بهای ماهانه' },
    { name: "credit_cap_pct", label: "سقف جریمه (٪ بها)", type: "percent", group: "financial", span: 8, section: T_MONEY },
  ];
}

const templateTarget: TableDef = {
  key: "slm_template_target",
  table: "sm_slm_template_targets",
  label: "هدف الگو",
  plural: "اهداف الگوها",
  icon: "target",
  module: "slm",
  area: "sla",
  description: "یک هدف آمادهٔ الگو؛ با ساختن توافق از الگو به هدف همان توافق تبدیل می‌شود",
  display: "name",
  fields: [
    { name: "template_id", label: "الگو", type: "ref", ref: "slm_template", required: true, list: true, filter: true, index: true, span: 12, section: T_MAIN },
    ...targetFields(),
  ],
  scope: { public: true },
  form: { sections: [T_MAIN, T_TIMER, T_MONEY] },
  list: { columns: ["template_id", "name", "kind", "goal", "p1_hours", "p2_hours", "p3_hours"], order: "template_id,sort_order" },
};

const template: TableDef = {
  key: "slm_template",
  table: "sm_slm_templates",
  label: "الگوی توافق",
  plural: "الگوهای توافق",
  icon: "file-stack",
  module: "slm",
  area: "sla",
  description: "بستهٔ آمادهٔ توافق (طلایی، نقره‌ای، برنزی، OLA تیم، قرارداد پیمانکار) با متن سند و اهداف؛ توافق تازه از آن ساخته می‌شود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "نوع توافق", type: "choice", choices: AGREEMENT_KINDS, default: "sla", required: true, list: true, filter: true, span: 6 },
    { name: "level", label: "سطح", type: "choice", choices: OFFERING_LEVELS, default: "standard", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "review_months", label: "فاصلهٔ بازبینی (ماه)", type: "int", default: 3, min: 1, max: 24, span: 6 },
    { name: "compliance_target", label: "هدف انطباق (٪)", type: "percent", default: "95", span: 6 },
    { name: "at_risk_target", label: "آستانهٔ هشدار (٪)", type: "percent", default: "97", span: 6 },
    { name: "review_period", label: "دورهٔ سنجش", type: "choice", choices: REVIEW_PERIODS, default: "month", span: 6 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24 },
    { name: "terms", label: "شرایط و سطح خدمت", type: "markdown", span: 24, tab: A_DOC },
    { name: "service_hours", label: "ساعات و پوشش خدمت", type: "markdown", span: 24, tab: A_DOC },
    { name: "responsibilities", label: "مسئولیت‌های طرفین", type: "markdown", span: 24, tab: A_DOC },
    { name: "escalation", label: "مسیر تشدید و ارتباط", type: "markdown", span: 24, tab: A_DOC },
    { name: "exclusions", label: "استثناها", type: "markdown", span: 24, tab: A_DOC },
  ],
  scope: { public: true },
  form: { tabs: [A_DOC], related: [{ table: "slm_template_target", field: "template_id", label: "اهداف الگو", columns: ["sort_order", "name", "kind", "goal", "p1_hours", "p2_hours", "p3_hours"] }] },
  list: { columns: ["name", "kind", "level", "active"], order: "kind,name" },
};

const target: TableDef = {
  key: "slm_target",
  table: "sm_slm_targets",
  label: "هدف توافق",
  plural: "اهداف توافق‌ها",
  icon: "target",
  module: "slm",
  area: "sla",
  description: "هدف قابل‌سنجش یک توافق: زمان‌سنج‌های سرویس توافق (پاسخ و حل)، دسترس‌پذیری، تجربه یا یک شاخص، با هدف انطباق و آستانهٔ هشدار",
  display: "name",
  fields: [
    { name: "agreement_id", label: "توافق", type: "ref", ref: "service_agreement", required: true, list: true, filter: true, index: true, span: 12, section: T_MAIN },
    ...targetFields(),
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: T_MAIN },
    { name: "weight", label: "وزن", type: "int", default: 1, min: 0, max: 100, span: 6, section: T_MAIN },
    { name: "definition_id", label: "تعریف زمان‌سنج", type: "ref", ref: "sla_definition", filter: true, index: true, span: 12, section: T_TIMER, help: "یک تعریف موجود را برگزینید، یا ساعت‌ها را بنویسید تا تعریف ساخته و همگام شود" },
    { name: "calendar_id", label: "تقویم", type: "ref", ref: "calendar", span: 8, section: T_TIMER, help: "خالی: تقویم توافق" },
    { name: "generated", label: "تعریف از همین هدف ساخته شده", type: "bool", default: false, readonly: true, span: 8, section: T_TIMER },
    { name: "indicator_id", label: "شاخص", type: "ref", ref: "analytics_indicator", span: 12, section: T_MAIN, help: "برای نوع «شاخص تحلیلی»" },
    { name: "current_value", label: "مقدار دورهٔ جاری", type: "decimal", readonly: true, audit: false, list: true, span: 6, section: T_MAIN },
    { name: "current_status", label: "وضعیت", type: "choice", choices: COMPLIANCE_STATUSES, readonly: true, audit: false, list: true, filter: true, span: 6, section: T_MAIN },
    { name: "current_n", label: "رکوردهای سنجیده", type: "int", readonly: true, audit: false, span: 6, section: T_MAIN },
    { name: "measured_at", label: "آخرین سنجش", type: "datetime", readonly: true, audit: false, span: 6, section: T_MAIN },
  ],
  scope: { public: true },
  form: { sections: [T_MAIN, T_TIMER, T_MONEY] },
  list: { columns: ["agreement_id", "name", "kind", "goal", "current_value", "current_status", "active"], order: "agreement_id,sort_order" },
};

// ---------------------------------------------------------------------------------------------------------------
// Compliance per review period (SLM-034), service credits and disputes (SLM-035)

const compliance: TableDef = {
  key: "slm_compliance",
  table: "sm_slm_compliance",
  label: "انطباق دوره",
  plural: "انطباق دوره‌ها",
  icon: "calendar-check",
  module: "slm",
  area: "sla",
  description: "نتیجهٔ هر هدف در هر دورهٔ سنجش جلالی: رکوردهای در موعد و نقض‌شده، مقدار، هدف و وضعیت؛ فقط سامانه می‌نویسد",
  display: "period_label",
  fields: [
    { name: "agreement_id", label: "توافق", type: "ref", ref: "service_agreement", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "target_id", label: "هدف", type: "ref", ref: "slm_target", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "period_key", label: "کلید دوره", type: "string", required: true, maxLength: 20, ltr: true, filter: true, sort: true, span: 6 },
    { name: "period_label", label: "دوره", type: "string", maxLength: 60, list: true, span: 6 },
    { name: "period_start", label: "آغاز دوره", type: "date", sort: true, filter: true, span: 6 },
    { name: "period_end", label: "پایان دوره (روز بعد از آخرین روز)", type: "date", span: 6 },
    { name: "total", label: "سنجیده", type: "int", default: 0, list: true, span: 6 },
    { name: "met", label: "در موعد", type: "int", default: 0, span: 6 },
    { name: "breached", label: "نقض", type: "int", default: 0, list: true, span: 6 },
    { name: "excluded", label: "بیرون از سقف", type: "int", default: 0, span: 6 },
    { name: "value", label: "مقدار", type: "decimal", list: true, sort: true, span: 6 },
    { name: "goal", label: "هدف", type: "decimal", list: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: COMPLIANCE_STATUSES, default: "no_data", list: true, filter: true, span: 6 },
    { name: "final", label: "دورهٔ بسته", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "volume", label: "حجم رکوردهای دوره", type: "int", default: 0, span: 6 },
    { name: "over_limit", label: "بیش از سقف حجم", type: "bool", default: false, filter: true, span: 6 },
    { name: "computed_at", label: "زمان محاسبه", type: "datetime", sort: true, span: 12 },
  ],
  scope: { public: true },
  rowAccess: { write: NEVER },
  unique: [["target_id", "period_key"]],
  features: { history: false },
  list: { columns: ["agreement_id", "target_id", "period_label", "total", "breached", "value", "goal", "status", "final"], order: "-period_key" },
};

export const CREDIT_STATES: StateModel = {
  field: "state",
  initial: "calculated",
  states: [
    { value: "calculated", label: "محاسبه‌شده", category: "new", color: "blue" },
    { value: "disputed", label: "در اعتراض", category: "waiting", color: "orange" },
    { value: "approved", label: "تأییدشده", category: "active", color: "green" },
    { value: "invoiced", label: "اعمال در صورت‌حساب", category: "closed", color: "gray" },
    { value: "waived", label: "بخشوده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["calculated", "approved"], to: "disputed", label: "اعتراض به سنجش", requires: ["dispute_reason"] },
    { from: ["calculated", "disputed"], to: "approved", label: "تأیید جریمه", roles: { area: "sla", level: "full" } },
    { from: ["calculated", "disputed"], to: "waived", label: "بخشودن", requires: ["decision_note"], roles: { area: "sla", level: "full" } },
    { from: ["approved"], to: "invoiced", label: "اعمال در صورت‌حساب", roles: { area: "sla", level: "full" } },
  ],
  locked: ["closed", "canceled"],
};

const credit: TableDef = {
  key: "slm_credit",
  table: "sm_slm_credits",
  label: "جریمهٔ خدمت",
  plural: "جریمه‌های خدمت",
  icon: "badge-percent",
  module: "slm",
  area: "sla",
  description: "جریمه یا اعتبار خدمتی که از برآورده‌نشدن هدف یک دورهٔ بسته محاسبه شد؛ اعتراض، تصمیم و اعمال در صورت‌حساب",
  numbered: { prefix: "CRD", pad: 5 },
  display: "period_label",
  fields: [
    { name: "agreement_id", label: "توافق", type: "ref", ref: "service_agreement", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "target_id", label: "هدف", type: "ref", ref: "slm_target", required: true, list: true, filter: true, span: 12 },
    { name: "compliance_id", label: "انطباق دوره", type: "ref", ref: "slm_compliance", readonly: true, span: 12 },
    { name: "period_label", label: "دوره", type: "string", maxLength: 60, readonly: true, list: true, span: 6 },
    { name: "period_key", label: "کلید دوره", type: "string", maxLength: 20, ltr: true, readonly: true, filter: true, span: 6 },
    { name: "value", label: "مقدار سنجیده", type: "decimal", readonly: true, list: true, span: 6 },
    { name: "goal", label: "هدف", type: "decimal", readonly: true, span: 6 },
    { name: "credit_pct", label: "درصد جریمه از بها", type: "percent", readonly: true, list: true, span: 6 },
    { name: "amount", label: "مبلغ", type: "money", readonly: true, group: "financial", list: true, span: 6 },
    { name: "dispute_reason", label: "دلیل اعتراض و شواهد", type: "text", maxLength: 4000, span: 24 },
    { name: "decision_note", label: "تصمیم", type: "text", maxLength: 4000, span: 24 },
    { name: "manager_id", label: "مالک توافق", type: "user", system: true, filter: true },
  ],
  states: CREDIT_STATES,
  scope: { own: ["manager_id"], requester: [] },
  features: { journal: true, attachments: true },
  unique: [["target_id", "period_key"]],
  list: { columns: ["number", "agreement_id", "target_id", "period_label", "value", "credit_pct", "amount", "state"], order: "-period_key" },
};

// ---------------------------------------------------------------------------------------------------------------
// Service reviews (SLM-046/047) and the continual improvement register (CSI)

export const REVIEW_STATES: StateModel = {
  field: "state",
  initial: "scheduled",
  states: [
    { value: "scheduled", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "prepared", label: "بسته آماده است", category: "active", color: "teal" },
    { value: "held", label: "برگزار شد", category: "active", color: "indigo" },
    { value: "actions_open", label: "پیگیری اقدام‌ها", category: "waiting", color: "gold" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغو", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["scheduled"], to: "prepared", label: "ساختن بستهٔ بازبینی", guard: "review_pack" },
    { from: ["prepared"], to: "held", label: "ثبت برگزاری", requires: ["minutes"] },
    { from: ["held"], to: "actions_open", label: "پیگیری اقدام‌ها" },
    { from: ["held", "actions_open"], to: "closed", label: "بستن بازبینی", guard: "review_closable" },
    { from: ["scheduled", "prepared"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const review: TableDef = {
  key: "slm_review",
  table: "sm_slm_reviews",
  label: "بازبینی خدمت",
  plural: "بازبینی‌های خدمت",
  icon: "clipboard-list",
  module: "slm",
  area: "sla",
  description: "بازبینی دوره‌ای یا رویدادمحور یک توافق یا خدمت: بستهٔ ساخته‌شده از عددها، روایت، صورت‌جلسه، تصمیم‌ها و اقدام‌های بهبود",
  numbered: { prefix: "REV", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: REVIEW_KINDS, default: "interval", list: true, filter: true, span: 6 },
    { name: "agreement_id", label: "توافق", type: "ref", ref: "service_agreement", list: true, filter: true, index: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, index: true, span: 12 },
    { name: "period_from", label: "دوره از", type: "date", required: true, span: 6 },
    { name: "period_to", label: "دوره تا", type: "date", required: true, span: 6 },
    { name: "scheduled_at", label: "زمان نشست", type: "datetime", list: true, sort: true, filter: true, span: 6 },
    { name: "held_at", label: "زمان برگزاری", type: "datetime", readonly: true, sort: true, span: 6 },
    { name: "chair_id", label: "مسئول بازبینی", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "attendees", label: "حاضران", type: "users", span: 16 },
    { name: "event_ref", label: "رویداد", type: "string", maxLength: 200, span: 24, help: "برای بازبینی رویدادمحور: شمارهٔ رخداد عمده یا تغییر" },
    { name: "narrative", label: "روایت بازبینی", type: "markdown", span: 24, tab: "بسته" },
    { name: "narrative_ai", label: "روایت با هوش مصنوعی نوشته شد", type: "bool", default: false, readonly: true, span: 8, tab: "بسته" },
    { name: "pack", label: "بستهٔ عددها", type: "json", readonly: true, hidden: true, audit: false },
    { name: "pack_at", label: "زمان ساخت بسته", type: "datetime", readonly: true, span: 8, tab: "بسته" },
    { name: "minutes", label: "صورت‌جلسه", type: "markdown", span: 24, tab: "نشست" },
    { name: "decisions", label: "تصمیم‌ها", type: "markdown", span: 24, tab: "نشست" },
    { name: "satisfaction", label: "رضایت مشتری از خدمت", type: "rating", min: 1, max: 5, span: 8, tab: "نشست" },
  ],
  states: REVIEW_STATES,
  scope: { own: ["chair_id", "attendees"] },
  features: { journal: true, attachments: true, links: true, calendar: { start: "scheduled_at" } },
  form: {
    tabs: ["بسته", "نشست"],
    related: [{ table: "slm_improvement", field: "review_id", label: "اقدام‌های بهبود", columns: ["number", "short_description", "state", "assigned_to", "due_at"] }],
  },
  list: { columns: ["number", "title", "kind", "agreement_id", "scheduled_at", "chair_id", "state"], order: "-scheduled_at" },
};

export const IMPROVEMENT_STATES: StateModel = {
  field: "state",
  initial: "proposed",
  states: [
    { value: "proposed", label: "پیشنهادی", category: "new", color: "blue" },
    { value: "approved", label: "تأییدشده", category: "waiting", color: "teal" },
    { value: "in_progress", label: "در حال اجرا", category: "active", color: "indigo" },
    { value: "done", label: "انجام شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
  ],
  transitions: [
    { from: ["proposed"], to: "approved", label: "تأیید", roles: { area: "sla", level: "edit" } },
    { from: ["proposed", "approved"], to: "in_progress", label: "آغاز اجرا" },
    { from: ["in_progress"], to: "done", label: "انجام شد", requires: ["outcome"] },
    { from: ["done"], to: "in_progress", label: "بازگشایی" },
    { from: ["done"], to: "closed", label: "بستن (اثر سنجیده شد)" },
    { from: ["proposed", "approved"], to: "rejected", label: "رد", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const improvement: TableDef = {
  key: "slm_improvement",
  table: "sm_slm_improvements",
  label: "بهبود خدمت",
  plural: "ثبت بهبود مستمر",
  icon: "trending-up",
  module: "slm",
  area: "sla",
  description: "یک قلم در ثبت بهبود مستمر (CSI): از بازبینی، نقض، نظرسنجی، شکایت، ممیزی یا پیشنهاد، با ارزش، تلاش، مسئول، موعد و اثر سنجیده",
  extends: "task",
  numbered: { prefix: "CSI", pad: 5 },
  display: "short_description",
  fields: [
    { name: "source", label: "منشأ", type: "choice", choices: IMPROVEMENT_SOURCES, default: "idea", list: true, filter: true, span: 8 },
    { name: "agreement_id", label: "توافق", type: "ref", ref: "service_agreement", filter: true, index: true, span: 8 },
    { name: "review_id", label: "بازبینی", type: "ref", ref: "slm_review", filter: true, index: true, span: 8 },
    { name: "plan_id", label: "برنامهٔ بهبود", type: "ref", ref: "slm_csi_plan", list: true, filter: true, index: true, span: 8 },
    { name: "value", label: "ارزش (۱ تا ۵)", type: "int", min: 1, max: 5, default: 3, span: 6 },
    { name: "effort", label: "تلاش (۱ تا ۵)", type: "int", min: 1, max: 5, default: 3, span: 6 },
    { name: "score", label: "امتیاز اولویت", type: "decimal", readonly: true, list: true, sort: true, span: 6 },
    { name: "benefit", label: "سود مورد انتظار", type: "markdown", span: 24 },
    { name: "kpi_name", label: "سنجهٔ اثر", type: "string", maxLength: 160, span: 24 },
    { name: "kpi_baseline", label: "مقدار پایه", type: "decimal", span: 8 },
    { name: "kpi_target", label: "مقدار هدف", type: "decimal", span: 8 },
    { name: "kpi_actual", label: "مقدار پس از اجرا", type: "decimal", span: 8 },
    { name: "outcome", label: "نتیجه", type: "markdown", span: 24 },
  ],
  states: IMPROVEMENT_STATES,
  scope: {},
  list: { columns: ["number", "short_description", "source", "state", "priority", "assigned_to", "due_at", "score"], order: "-score,due_at" },
  ai: { title: "short_description", text: ["description", "benefit", "outcome"] },
};

export const PLAN_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "active", label: "در اجرا", category: "active", color: "green" },
    { value: "completed", label: "پایان‌یافته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغو", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "active", label: "آغاز برنامه" },
    { from: ["active"], to: "completed", label: "پایان برنامه" },
    { from: ["completed"], to: "active", label: "ادامهٔ برنامه" },
    { from: ["draft", "active"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const plan: TableDef = {
  key: "slm_csi_plan",
  table: "sm_slm_csi_plans",
  label: "برنامهٔ بهبود",
  plural: "برنامه‌های بهبود",
  icon: "map",
  module: "slm",
  area: "sla",
  description: "برنامهٔ بهبود مستمر یک دوره یا خدمت: هدف، مالک و اقلام بهبودی که زیر آن پیش می‌روند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 12 },
    { name: "period_from", label: "از", type: "date", list: true, span: 6 },
    { name: "period_to", label: "تا", type: "date", list: true, span: 6 },
    { name: "objective", label: "هدف برنامه", type: "markdown", span: 24 },
  ],
  states: PLAN_STATES,
  scope: { own: ["owner_id"] },
  features: { journal: true, attachments: true },
  form: { related: [{ table: "slm_improvement", field: "plan_id", label: "اقلام بهبود", columns: ["number", "short_description", "state", "assigned_to", "due_at", "score"] }] },
  list: { columns: ["name", "owner_id", "service_id", "period_from", "period_to", "state"], order: "-period_from" },
};

// ---------------------------------------------------------------------------------------------------------------
// Experience level agreements (SLM-039/040/042/043)

const xlaPolicy: TableDef = {
  key: "slm_xla_policy",
  table: "sm_slm_xla_policies",
  label: "سیاست تجربه (XLA)",
  plural: "سیاست‌های تجربه (XLA)",
  icon: "heart-pulse",
  module: "slm",
  area: "sla",
  description: "امتیاز تجربهٔ ۰ تا ۱۰۰ هر رکورد از سه محور اطمینان، کیفیت و زحمت درخواست‌کننده؛ نخستین سیاست مطابق اعمال می‌شود",
  numbered: { prefix: "XLA", pad: 4 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, default: "incident", ltr: true, list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 6 },
    { name: "threshold", label: "آستانهٔ هشدار (امتیاز کمتر از)", type: "int", default: 50, min: 0, max: 100, span: 6 },
    { name: "condition", label: "فقط رکوردهایی که", type: "conditions", condTableField: "table_key", span: 24, help: "خالی: همهٔ رکوردهای جدول" },
    { name: "w_reliability", label: "وزن اطمینان (٪)", type: "int", default: 40, min: 0, max: 100, span: 8, section: "وزن‌ها" },
    { name: "w_quality", label: "وزن کیفیت (٪)", type: "int", default: 40, min: 0, max: 100, span: 8, section: "وزن‌ها" },
    { name: "w_effort", label: "وزن زحمت درخواست‌کننده (٪)", type: "int", default: 20, min: 0, max: 100, span: 8, section: "وزن‌ها" },
    { name: "p_breach", label: "کسر برای هر نقض توافق", type: "int", default: 30, min: 0, max: 100, span: 8, section: "قواعد" },
    { name: "p_reopen", label: "کسر برای هر بازگشایی", type: "int", default: 25, min: 0, max: 100, span: 8, section: "قواعد" },
    { name: "p_reassign", label: "کسر برای هر ارجاع دوباره", type: "int", default: 15, min: 0, max: 100, span: 8, section: "قواعد" },
    { name: "p_late_response", label: "کسر برای پاسخ نخست دیر (بیش از ساعت‌های زیر)", type: "int", default: 20, min: 0, max: 100, span: 8, section: "قواعد" },
    { name: "response_hours", label: "پاسخ نخست تا (ساعت)", type: "decimal", default: "4", min: 0, max: 1000, span: 8, section: "قواعد" },
    { name: "p_chase", label: "کسر برای هر پیگیری درخواست‌کننده (بیش از دو بار)", type: "int", default: 10, min: 0, max: 100, span: 8, section: "قواعد" },
    { name: "use_survey", label: "پاسخ نظرسنجی هم حساب شود", type: "bool", default: true, span: 8, section: "قواعد", help: "شادی ۰ تا ۱۰ یا رضایت ۱ تا ۵ پاسخ‌دهنده، جای محور زحمت را می‌گیرد" },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
  ],
  scope: { public: true },
  form: { sections: ["اصلی", "وزن‌ها", "قواعد"] },
  list: { columns: ["number", "name", "table_key", "threshold", "sort_order", "active"], order: "table_key,sort_order" },
};

const xlaScore: TableDef = {
  key: "slm_xla_score",
  table: "sm_slm_xla_scores",
  label: "امتیاز تجربه",
  plural: "امتیازهای تجربه",
  icon: "smile",
  module: "slm",
  area: "sla",
  description: "امتیاز زندهٔ تجربهٔ یک رکورد با سهم هر محور و قواعدی که از آن کاستند؛ فقط سامانه می‌نویسد",
  display: "record_number",
  fields: [
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, ltr: true, filter: true, span: 6 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", required: true, maxLength: 36, ltr: true, index: true, hidden: true },
    { name: "record_number", label: "رکورد", type: "string", maxLength: 40, ltr: true, list: true, search: true, span: 6 },
    { name: "policy_id", label: "سیاست", type: "ref", ref: "slm_xla_policy", filter: true, span: 12 },
    { name: "score", label: "امتیاز", type: "int", min: 0, max: 100, list: true, sort: true, filter: true, span: 6 },
    { name: "band", label: "سطح", type: "choice", choices: XLA_BANDS, list: true, filter: true, span: 6 },
    { name: "reliability", label: "اطمینان", type: "int", span: 8 },
    { name: "quality", label: "کیفیت", type: "int", span: 8 },
    { name: "effort", label: "زحمت", type: "int", span: 8 },
    { name: "survey", label: "از نظرسنجی", type: "bool", default: false, filter: true, span: 6 },
    { name: "drivers", label: "عوامل", type: "json" },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, index: true, span: 12 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 6 },
    { name: "assigned_to", label: "کارشناس", type: "user", filter: true, span: 6 },
    { name: "alerted", label: "هشدار داده شد", type: "bool", default: false, span: 6 },
    { name: "computed_at", label: "زمان محاسبه", type: "datetime", list: true, sort: true, filter: true, span: 12 },
  ],
  scope: { own: ["assigned_to"], requester: [], group: "assignment_group_id" },
  rowAccess: { write: NEVER },
  unique: [["table_key", "record_id"]],
  features: { history: false },
  list: { columns: ["record_number", "table_key", "score", "band", "assignment_group_id", "computed_at"], order: "-computed_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

export const SLM_CONFIG_DEFAULTS = {
  compliance_target: 95,
  at_risk_target: 97,
  review_months: 3,
  review_reminder_days: 14,
  expiry_reminder_days: 30,
  k_min: 5,
  watermelon_gap: 20,
  require_experience_target: false,
};
export type SlmConfig = typeof SLM_CONFIG_DEFAULTS;

const config: TableDef = {
  key: "slm_config",
  table: "sm_slm_config",
  label: "تنظیمات سطح خدمت",
  plural: "تنظیمات سطح خدمت",
  icon: "settings",
  module: "slm",
  area: "sla",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, default: "تنظیمات سطح خدمت", span: 12 },
    { name: "config_key", label: "کلید", type: "string", maxLength: 40, ltr: true, unique: true, hidden: true },
    { name: "compliance_target", label: "هدف انطباق پیش‌فرض (٪)", type: "percent", default: String(SLM_CONFIG_DEFAULTS.compliance_target), span: 8 },
    { name: "at_risk_target", label: "آستانهٔ هشدار پیش‌فرض (٪)", type: "percent", default: String(SLM_CONFIG_DEFAULTS.at_risk_target), span: 8 },
    { name: "review_months", label: "فاصلهٔ بازبینی پیش‌فرض (ماه)", type: "int", min: 1, max: 24, default: SLM_CONFIG_DEFAULTS.review_months, span: 8 },
    { name: "review_reminder_days", label: "یادآوری بازبینی (روز پیش از موعد)", type: "int", min: 0, max: 90, default: SLM_CONFIG_DEFAULTS.review_reminder_days, span: 8 },
    { name: "expiry_reminder_days", label: "یادآوری تمدید (روز پیش از پایان)", type: "int", min: 0, max: 180, default: SLM_CONFIG_DEFAULTS.expiry_reminder_days, span: 8 },
    { name: "k_min", label: "کمترین تعداد پاسخ برای نمایش", type: "int", min: 1, max: 50, default: SLM_CONFIG_DEFAULTS.k_min, span: 8, help: "میانگین تجربه و رضایت گروه‌های کوچک‌تر نشان داده نمی‌شود" },
    { name: "watermelon_gap", label: "فاصلهٔ هشدار توافق و تجربه (امتیاز)", type: "int", min: 1, max: 100, default: SLM_CONFIG_DEFAULTS.watermelon_gap, span: 8 },
    { name: "require_experience_target", label: "توافق مشتری بدون هدف تجربه اجرا نشود", type: "bool", default: SLM_CONFIG_DEFAULTS.require_experience_target, span: 16 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "compliance_target", "at_risk_target", "review_months"], order: "name" },
};

export const SLM_TABLES: TableDef[] = [template, templateTarget, target, compliance, credit, review, improvement, plan, xlaPolicy, xlaScore, config];

/** The default options of the module's tenant-editable lists (none yet: its lists are fixed vocabularies). */
export const SLM_CHOICE_LISTS: Record<string, Option[]> = {};

