// Light IT financial management (docs/modules/financial_FA.md; catalogue g6 «Module: financial»): the Jalali fiscal
// year (from 1 Farvardin) and its twelve posting periods, cost types (CapEx/OpEx), exchange rates to the Rial, the cost
// ledger every module posts to (asset purchases, depreciation, contracts, subscriptions, licences, repairs,
// allocations — insert-only, corrected by reversal), budgets per cost centre or unit with their lines, and the cost
// model that allocates pooled costs to services and their consumers (showback, chargeback). Money is in the financial
// field group; cost centres are units of the shared organisation tree (`org_unit`, kind «مرکز هزینه»).
// Imported by the UI: keep it free of server imports.
import type { AreaOp, FieldDef, Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES } from "../model/task";
import { CURRENCIES } from "./supplier";

const o = (value: string, label: string, color?: Option["color"]): Option => ({ value, label, ...(color ? { color } : {}) });
const ordered = (xs: Option[]): Option[] => xs.map((x, i) => ({ ...x, order: i + 1 }));
const SYSTEM_ONLY = (area: string): AreaOp => ({ area, level: "view", roles: ["_system"] });

export const CAPEX_OPEX: Option[] = ordered([o("capex", "سرمایه‌ای (CapEx)", "indigo"), o("opex", "جاری (OpEx)", "teal")]);

export const COST_CATEGORIES: Option[] = ordered([
  o("hardware", "سخت‌افزار", "blue"), o("software", "نرم‌افزار و مجوز", "indigo"), o("cloud", "ابر و اشتراک", "purple"), o("services", "خدمات بیرونی", "teal"),
  o("labour", "نیروی انسانی", "gold"), o("telecom", "ارتباطات", "orange"), o("facilities", "تأسیسات", "gray"), o("depreciation", "استهلاک", "magenta"),
  o("other", "سایر", "gray"),
]);

export const COST_SOURCES: Option[] = ordered([
  o("manual", "دستی", "gray"), o("asset_purchase", "خرید دارایی", "blue"), o("depreciation", "استهلاک", "magenta"), o("contract", "قرارداد", "teal"),
  o("saas", "اشتراک ابری", "purple"), o("license", "مجوز نرم‌افزار", "indigo"), o("purchase_order", "سفارش خرید", "blue"), o("repair", "تعمیر", "orange"),
  o("allocation", "تسهیم", "gold"), o("labour", "نیروی کار", "gold"), o("disposal", "اسقاط", "gray"),
]);

export const FINANCIAL_CHOICE_LISTS: Record<string, Option[]> = {
  "cost_type.category": COST_CATEGORIES,
};

export const PERIOD_STATUS: Option[] = ordered([o("open", "باز", "green"), o("soft_closed", "بستهٔ موقت", "gold"), o("closed", "بسته", "gray")]);

const fiscalYear: TableDef = {
  key: "fiscal_year",
  table: "sm_fiscal_years",
  label: "سال مالی",
  plural: "سال‌های مالی",
  icon: "calendar-range",
  module: "financial",
  area: "financial",
  description: "سال مالی جلالی از ۱ فروردین تا پایان اسفند، با دوازده دورهٔ ثبت",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 80, list: true, search: true, span: 12 },
    { name: "year", label: "سال (جلالی)", type: "int", required: true, min: 1300, max: 1600, unique: true, list: true, sort: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: PERIOD_STATUS, default: "open", list: true, filter: true, span: 6 },
    { name: "start_date", label: "آغاز", type: "date", readonly: true, list: true, span: 6 },
    { name: "end_date", label: "پایان", type: "date", readonly: true, list: true, span: 6 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  form: { related: [{ table: "fiscal_period", field: "fiscal_year_id", label: "دوره‌ها", columns: ["month", "name", "start_date", "end_date", "status"] }] },
  list: { columns: ["name", "year", "status", "start_date", "end_date"], order: "-year" },
};

const fiscalPeriod: TableDef = {
  key: "fiscal_period",
  table: "sm_fiscal_periods",
  label: "دورهٔ مالی",
  plural: "دوره‌های مالی",
  icon: "calendar-days",
  module: "financial",
  area: "financial",
  description: "ماه‌های سال مالی؛ ثبت هزینه در دورهٔ بسته پذیرفته نیست",
  display: "name",
  fields: [
    { name: "fiscal_year_id", label: "سال مالی", type: "ref", ref: "fiscal_year", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "month", label: "ماه", type: "int", required: true, min: 1, max: 12, list: true, sort: true, span: 6 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 10, ltr: true, unique: true, filter: true, sort: true, span: 6 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 40, list: true, search: true, span: 12 },
    { name: "start_date", label: "آغاز", type: "date", required: true, list: true, sort: true, span: 6 },
    { name: "end_date", label: "پایان", type: "date", required: true, list: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: PERIOD_STATUS, default: "open", list: true, filter: true, span: 12 },
  ],
  scope: { public: true },
  unique: [["fiscal_year_id", "month"]],
  list: { columns: ["fiscal_year_id", "month", "name", "start_date", "end_date", "status"], order: "key" },
};

const costType: TableDef = {
  key: "cost_type",
  table: "sm_cost_types",
  label: "نوع هزینه",
  plural: "انواع هزینه",
  icon: "tags",
  module: "financial",
  area: "financial",
  description: "درخت انواع هزینه با طبقهٔ سرمایه‌ای یا جاری و حساب دفتر کل",
  display: "name",
  fields: [
    { name: "code", label: "کد", type: "string", required: true, maxLength: 20, ltr: true, unique: true, list: true, search: true, sort: true, span: 6 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "parent_id", label: "والد", type: "ref", ref: "$self", filter: true, span: 6 },
    { name: "category", label: "طبقه", type: "choice", choices: "cost_type.category", default: "other", list: true, filter: true, span: 8 },
    { name: "capex_opex", label: "سرمایه‌ای / جاری", type: "choice", choices: CAPEX_OPEX, default: "opex", list: true, filter: true, span: 8 },
    { name: "gl_account", label: "حساب دفتر کل", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["code", "name", "category", "capex_opex", "gl_account", "active"], order: "code" },
};

const exchangeRate: TableDef = {
  key: "exchange_rate",
  table: "sm_exchange_rates",
  label: "نرخ ارز",
  plural: "نرخ‌های ارز",
  icon: "arrow-left-right",
  module: "financial",
  area: "financial",
  description: "نرخ تبدیل ارزها به ریال در هر تاریخ (رسمی، آزاد، بودجه‌ای)",
  display: "currency",
  fields: [
    { name: "currency", label: "ارز", type: "choice", choices: CURRENCIES.filter((c) => c.value !== "IRR"), required: true, list: true, filter: true, span: 8 },
    { name: "rate", label: "نرخ (ریال)", type: "decimal", required: true, list: true, sort: true, span: 8 },
    { name: "rate_date", label: "تاریخ", type: "date", required: true, default: "$today", list: true, sort: true, filter: true, span: 8 },
    { name: "rate_type", label: "نوع نرخ", type: "choice", choices: ordered([o("official", "رسمی (مرکز مبادله)", "blue"), o("market", "آزاد", "orange"), o("budget", "بودجه‌ای", "gray")]), default: "official", list: true, filter: true, span: 8 },
    { name: "source", label: "منبع", type: "string", maxLength: 120, span: 16 },
  ],
  scope: { public: true },
  unique: [["currency", "rate_date", "rate_type"]],
  list: { columns: ["currency", "rate", "rate_date", "rate_type", "source"], order: "-rate_date" },
};

const costEntry: TableDef = {
  key: "cost_entry",
  table: "sm_cost_entries",
  label: "ثبت هزینه",
  plural: "دفتر هزینه",
  icon: "receipt",
  module: "financial",
  area: "financial",
  description: "دفتر هزینه‌های فناوری اطلاعات: هر ردیف یک هزینه با تاریخ، دوره، مرکز هزینه، نوع، منبع و اقلام مرتبط؛ فقط افزودنی و اصلاح با ردیف برگشتی",
  numbered: { prefix: "CST", pad: 7 },
  display: "description",
  fields: [
    { name: "entry_date", label: "تاریخ", type: "date", required: true, default: "$today", list: true, sort: true, filter: true, index: true, span: 6 },
    { name: "period_id", label: "دورهٔ مالی", type: "ref", ref: "fiscal_period", readonly: true, list: true, filter: true, index: true, span: 6 },
    { name: "amount", label: "مبلغ (ریال)", type: "money", required: true, list: true, sort: true, span: 6, group: "financial" },
    { name: "capex_opex", label: "سرمایه‌ای / جاری", type: "choice", choices: CAPEX_OPEX, filter: true, list: true, span: 6 },
    { name: "description", label: "شرح", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "cost_center_id", label: "مرکز هزینه یا واحد", type: "ref", ref: "org_unit", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "cost_type_id", label: "نوع هزینه", type: "ref", ref: "cost_type", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "source", label: "منبع", type: "choice", choices: COST_SOURCES, default: "manual", list: true, filter: true, span: 8 },
    { name: "source_table", label: "جدول منبع", type: "string", maxLength: 63, system: true, hidden: true },
    { name: "source_id", label: "رکورد منبع", type: "string", maxLength: 40, system: true, hidden: true, index: true },
    { name: "source_key", label: "کلید ثبت", type: "string", maxLength: 160, system: true, hidden: true, index: true, audit: false },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", filter: true, index: true, span: 8 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, index: true, span: 8 },
    { name: "supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", filter: true, index: true, span: 8 },
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", filter: true, span: 8 },
    { name: "reversal_of", label: "برگشت ثبتِ", type: "ref", ref: "$self", readonly: true, filter: true, span: 8 },
    { name: "reversed", label: "برگشت خورده", type: "bool", readonly: true, default: false, filter: true, span: 8 },
  ],
  scope: {},
  list: { columns: ["number", "entry_date", "description", "amount", "cost_center_id", "cost_type_id", "source", "capex_opex"], order: "-entry_date,number" },
};

// ---------------------------------------------------------------------------------------------------------------
// Budgets (FIN-010/012)

export const BUDGET_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "submitted", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "approved", label: "مصوب", category: "active", color: "green" },
    { value: "locked", label: "قفل", category: "closed", color: "blue" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "submitted", label: "ارسال برای تأیید" },
    { from: ["submitted"], to: "draft", label: "بازگشت به پیش‌نویس" },
    // the approvals service settles a submitted budget (onApprovalSettled); a financial approver may approve directly
    { from: ["draft", "submitted"], to: "approved", label: "تصویب", roles: { area: "financial", level: "full" } },
    { from: ["approved"], to: "draft", label: "بازنگری", roles: { area: "financial", level: "full" } },
    { from: ["approved"], to: "locked", label: "قفل بودجه", roles: { area: "financial", level: "full" } },
    { from: ["draft", "submitted"], to: "canceled", label: "لغو" },
  ],
};

const approvalField: FieldDef = { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 };

const budget: TableDef = {
  key: "budget",
  table: "sm_budgets",
  label: "بودجه",
  plural: "بودجه‌ها",
  icon: "wallet",
  module: "financial",
  area: "financial",
  description: "بودجهٔ سالانهٔ یک مرکز هزینه یا واحد به تفکیک نوع هزینه، ماه و خدمت؛ با هزینهٔ واقعی مقایسه می‌شود",
  numbered: { prefix: "BDG", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "fiscal_year_id", label: "سال مالی", type: "ref", ref: "fiscal_year", required: true, list: true, filter: true, index: true, span: 6 },
    { name: "cost_center_id", label: "مرکز هزینه یا واحد", type: "ref", ref: "org_unit", required: true, list: true, filter: true, index: true, span: 6 },
    { name: "owner_id", label: "مسئول بودجه", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "total", label: "جمع بودجه", type: "money", readonly: true, list: true, sort: true, span: 8, group: "financial" },
    { name: "alert_percent", label: "هشدار مصرف (درصد)", type: "int", min: 1, max: 200, default: 90, span: 8, help: "وقتی هزینهٔ واقعی به این درصد بودجه برسد به مسئول اعلان می‌رسد" },
    { name: "alerted_percent", label: "آخرین هشدار", type: "int", system: true, hidden: true, audit: false },
    { ...approvalField },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: BUDGET_STATES,
  scope: { own: ["owner_id"], requester: ["owner_id"] },
  features: { journal: true, attachments: true },
  form: { related: [{ table: "budget_line", field: "budget_id", label: "سطرهای بودجه", columns: ["cost_type_id", "period_id", "service_id", "amount", "note"] }] },
  list: { columns: ["number", "name", "fiscal_year_id", "cost_center_id", "total", "state", "owner_id"], order: "-updated_at" },
  unique: [["fiscal_year_id", "cost_center_id", "name"]],
};

const budgetLine: TableDef = {
  key: "budget_line",
  table: "sm_budget_lines",
  label: "سطر بودجه",
  plural: "سطرهای بودجه",
  icon: "list",
  module: "financial",
  area: "financial",
  description: "مبلغ بودجه برای یک نوع هزینه، ماه (یا کل سال) و خدمت",
  display: "note",
  fields: [
    { name: "budget_id", label: "بودجه", type: "ref", ref: "budget", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "cost_type_id", label: "نوع هزینه", type: "ref", ref: "cost_type", required: true, list: true, filter: true, span: 12 },
    { name: "period_id", label: "ماه", type: "ref", ref: "fiscal_period", list: true, filter: true, span: 8, help: "خالی: کل سال، به‌طور مساوی میان ماه‌ها" },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, span: 8 },
    { name: "amount", label: "مبلغ (ریال)", type: "money", required: true, list: true, sort: true, span: 8, group: "financial" },
    { name: "note", label: "شرح", type: "string", maxLength: 200, search: true, span: 24 },
  ],
  scope: {},
  list: { columns: ["budget_id", "cost_type_id", "period_id", "service_id", "amount", "note"], order: "budget_id" },
};

// ---------------------------------------------------------------------------------------------------------------
// The cost model: allocation rules, runs and results (FIN-014/015/019/022/023)

export const ALLOCATION_METHODS: Option[] = ordered([
  o("percent", "درصد ثابت", "blue"), o("equal", "سهم برابر", "gray"), o("assets", "تعداد دارایی‌های در استفاده", "teal"),
  o("cis", "تعداد پیکربندی‌های پشتیبان", "indigo"), o("consumers", "تعداد واحدهای مصرف‌کننده", "purple"),
]);

const allocationRule: TableDef = {
  key: "allocation_rule",
  table: "sm_allocation_rules",
  label: "قاعدهٔ تسهیم",
  plural: "قاعده‌های تسهیم",
  icon: "split",
  module: "financial",
  area: "financial",
  description: "هزینه‌های یک مرکز هزینه (و نوع‌های هزینه) را با درصد یا محرک میان خدمت‌ها پخش می‌کند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "source_cost_center_id", label: "مرکز هزینهٔ مبدأ", type: "ref", ref: "org_unit", required: true, list: true, filter: true, span: 12 },
    { name: "cost_types", label: "نوع‌های هزینه", type: "refs", ref: "cost_type", span: 12, help: "خالی: همهٔ هزینه‌های مرکز" },
    { name: "method", label: "روش", type: "choice", choices: ALLOCATION_METHODS, default: "percent", required: true, list: true, filter: true, span: 12 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: {},
  form: { related: [{ table: "allocation_target", field: "rule_id", label: "مقصدها", columns: ["service_id", "percent", "driver_value"] }] },
  list: { columns: ["name", "source_cost_center_id", "method", "active", "sort_order"], order: "sort_order,name" },
};

const allocationTarget: TableDef = {
  key: "allocation_target",
  table: "sm_allocation_targets",
  label: "مقصد تسهیم",
  plural: "مقصدهای تسهیم",
  icon: "target",
  module: "financial",
  area: "financial",
  description: "خدمتی که سهمی از هزینه‌های یک قاعده می‌گیرد",
  display: "service_id",
  fields: [
    { name: "rule_id", label: "قاعده", type: "ref", ref: "allocation_rule", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, span: 12 },
    { name: "percent", label: "درصد", type: "percent", list: true, span: 8, help: "برای روش «درصد ثابت»" },
    { name: "driver_value", label: "مقدار محرک (آخرین اجرا)", type: "decimal", readonly: true, list: true, span: 8 },
  ],
  scope: {},
  unique: [["rule_id", "service_id"]],
  list: { columns: ["rule_id", "service_id", "percent", "driver_value"], order: "rule_id" },
};

export const ALLOCATION_RUN_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "calculated", label: "محاسبه‌شده", category: "active", color: "blue" },
    { value: "approved", label: "تأییدشده", category: "resolved", color: "green" },
    { value: "posted", label: "ثبت‌شده", category: "closed", color: "teal" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft", "calculated"], to: "calculated", label: "محاسبه", roles: SYSTEM_ONLY("financial") },
    { from: ["calculated"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["calculated"], to: "approved", label: "تأیید نتیجه", roles: { area: "financial", level: "full" } },
    { from: ["approved"], to: "posted", label: "ثبت در دفتر", roles: SYSTEM_ONLY("financial") },
    { from: ["draft", "calculated", "approved"], to: "canceled", label: "لغو" },
  ],
};

const allocationRun: TableDef = {
  key: "allocation_run",
  table: "sm_allocation_runs",
  label: "اجرای تسهیم",
  plural: "اجراهای تسهیم",
  icon: "calculator",
  module: "financial",
  area: "financial",
  description: "تسهیم هزینه‌های یک بازه میان خدمت‌ها و واحدهای مصرف‌کننده: نمایش هزینه (Showback) یا بازپرداخت با ثبت در دفتر (Chargeback)",
  numbered: { prefix: "ALC", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "mode", label: "نوع", type: "choice", choices: ordered([o("showback", "نمایش هزینه (Showback)", "blue"), o("chargeback", "بازپرداخت هزینه (Chargeback)", "purple")]), default: "showback", required: true, list: true, filter: true, span: 12 },
    { name: "fiscal_year_id", label: "سال مالی", type: "ref", ref: "fiscal_year", required: true, list: true, filter: true, span: 8 },
    { name: "period_from_id", label: "از ماه", type: "ref", ref: "fiscal_period", required: true, span: 8 },
    { name: "period_to_id", label: "تا ماه", type: "ref", ref: "fiscal_period", required: true, span: 8 },
    { name: "total_pool", label: "جمع هزینه‌های مبدأ", type: "money", readonly: true, list: true, span: 8, group: "financial" },
    { name: "total_allocated", label: "تسهیم‌شده", type: "money", readonly: true, list: true, span: 8, group: "financial" },
    { name: "unallocated", label: "تسهیم‌نشده", type: "money", readonly: true, span: 8, group: "financial" },
    { name: "calculated_at", label: "زمان محاسبه", type: "datetime", readonly: true, span: 8 },
    { name: "input_hash", label: "اثر انگشت داده‌ها", type: "string", maxLength: 80, readonly: true, ltr: true, span: 16, help: "اگر داده‌ها پس از محاسبه تغییر کند، این مقدار هم تغییر می‌کند" },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: ALLOCATION_RUN_STATES,
  scope: {},
  features: { journal: true },
  form: { related: [{ table: "allocation_result", field: "run_id", label: "نتیجه", columns: ["service_id", "consumer_unit_id", "amount", "basis"] }] },
  list: { columns: ["number", "name", "mode", "fiscal_year_id", "total_pool", "total_allocated", "state"], order: "-updated_at" },
};

const allocationResult: TableDef = {
  key: "allocation_result",
  table: "sm_allocation_results",
  label: "نتیجهٔ تسهیم",
  plural: "نتیجه‌های تسهیم",
  icon: "pie-chart",
  module: "financial",
  area: "financial",
  description: "سهم هر خدمت و هر واحد مصرف‌کننده از هزینه‌ها در یک اجرای تسهیم (نوشتهٔ سامانه)",
  display: "basis",
  fields: [
    { name: "run_id", label: "اجرا", type: "ref", ref: "allocation_run", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "rule_id", label: "قاعده", type: "ref", ref: "allocation_rule", filter: true, span: 12 },
    { name: "stage", label: "مرحله", type: "choice", choices: ordered([o("service", "به خدمت", "blue"), o("consumer", "به مصرف‌کننده", "purple")]), list: true, filter: true, span: 8 },
    { name: "source_cost_center_id", label: "مرکز هزینهٔ مبدأ", type: "ref", ref: "org_unit", filter: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", list: true, filter: true, index: true, span: 8 },
    { name: "consumer_unit_id", label: "واحد مصرف‌کننده", type: "ref", ref: "org_unit", list: true, filter: true, span: 8 },
    { name: "amount", label: "مبلغ (ریال)", type: "money", list: true, sort: true, span: 8, group: "financial" },
    { name: "driver_value", label: "مقدار محرک", type: "decimal", span: 8 },
    { name: "basis", label: "مبنا", type: "string", maxLength: 200, list: true, span: 24 },
  ],
  scope: {},
  list: { columns: ["run_id", "stage", "service_id", "consumer_unit_id", "amount", "basis"], order: "run_id" },
};

export const FINANCIAL_CONFIG_DEFAULTS = {
  currency_display: "rial" as "rial" | "toman",
  variance_threshold: 10,
  budget_alert_percent: 90,
  auto_capture: true,
  default_cost_center_id: null as string | null,
};
export type FinancialConfig = typeof FINANCIAL_CONFIG_DEFAULTS;

const config: TableDef = {
  key: "financial_config",
  table: "sm_financial_configs",
  label: "تنظیمات مالی",
  plural: "تنظیمات مالی",
  icon: "settings-2",
  module: "financial",
  area: "settings",
  description: "واحد نمایش پول، آستانهٔ انحراف، هشدار بودجه و ثبت خودکار هزینه‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات مالی", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "currency_display", label: "نمایش مبلغ‌ها", type: "choice", choices: ordered([o("rial", "ریال"), o("toman", "تومان")]), default: "rial", span: 12, help: "مبلغ‌ها همیشه به ریال ذخیره می‌شوند" },
    { name: "variance_threshold", label: "آستانهٔ انحراف (درصد)", type: "int", min: 1, max: 100, default: FINANCIAL_CONFIG_DEFAULTS.variance_threshold, span: 8 },
    { name: "budget_alert_percent", label: "هشدار پیش‌فرض بودجه (درصد)", type: "int", min: 1, max: 200, default: FINANCIAL_CONFIG_DEFAULTS.budget_alert_percent, span: 8 },
    { name: "auto_capture", label: "ثبت خودکار هزینه‌ها", type: "bool", default: true, span: 8, help: "خرید دارایی، استهلاک ماهانه، قراردادها، اشتراک‌ها و مجوزها" },
    { name: "default_cost_center_id", label: "مرکز هزینهٔ پیش‌فرض فناوری اطلاعات", type: "ref", ref: "org_unit", span: 12 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "currency_display", "variance_threshold"], order: "name" },
};

export const FINANCIAL_TABLES: TableDef[] = [fiscalYear, fiscalPeriod, costType, exchangeRate, costEntry, budget, budgetLine, allocationRule, allocationTarget, allocationRun, allocationResult, config];
