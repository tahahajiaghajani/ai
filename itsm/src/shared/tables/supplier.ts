// Supplier and contract management (docs/modules/supplier_FA.md; catalogue g6 «Module: supplier»): one directory of
// outside organisations — manufacturers, resellers, software publishers, service and cloud providers, lessors,
// disposal vendors — with their contacts, segmentation, lifecycle, scorecards and reviews (area «vendor»), and one
// contract table for every kind of agreement — support and maintenance, warranty, lease, licence, subscription,
// underpinning contracts behind the service levels — with lines, coverage of assets, CIs and services, obligations,
// notice and renewal dates (area «contract»). ITAM and finance reference both. Money is in the financial field group.
// Imported by the UI: keep it free of server imports.
import type { AreaOp, FieldDef, Option, StateModel, TableDef } from "../model/types";
import { NEVER } from "../model/conditions";
import { APPROVAL_STATES } from "../model/task";

/** A transition only the module itself takes (a renewal supersedes the contract it renews). */
export const SYSTEM_ONLY = (area: string): AreaOp => ({ area, level: "view", roles: ["_system"] });

const o = (value: string, label: string, color?: Option["color"]): Option => ({ value, label, ...(color ? { color } : {}) });
const ordered = (xs: Option[]): Option[] => xs.map((x, i) => ({ ...x, order: i + 1 }));

/** Currencies of contracts, orders and rates (the base currency is the Rial: money fields hold Rials). */
export const CURRENCIES: Option[] = ordered([
  o("IRR", "ریال"), o("USD", "دلار آمریکا"), o("EUR", "یورو"), o("AED", "درهم امارات"), o("CNY", "یوان چین"), o("GBP", "پوند انگلیس"), o("TRY", "لیر ترکیه"),
]);

export const SUPPLIER_KINDS: Option[] = ordered([
  o("manufacturer", "سازنده", "blue"), o("reseller", "فروشنده و نماینده", "teal"), o("publisher", "ناشر نرم‌افزار", "indigo"),
  o("service_provider", "ارائه‌دهندهٔ خدمت", "green"), o("cloud", "ارائه‌دهندهٔ ابری", "purple"), o("maintenance", "پشتیبانی و نگهداری", "gold"),
  o("lessor", "اجاره‌دهنده", "orange"), o("disposal", "بازیافت و امحا", "gray"), o("consultant", "مشاور", "magenta"),
]);

export const CONTRACT_TYPES: Option[] = ordered([
  o("support", "پشتیبانی و نگهداری", "blue"), o("warranty", "ضمانت (گارانتی)", "green"), o("lease", "اجاره", "orange"), o("license", "مجوز نرم‌افزار", "indigo"),
  o("subscription", "اشتراک (SaaS)", "purple"), o("cloud", "خدمت ابری", "teal"), o("uc", "قرارداد پشتیبان خدمت (UC)", "magenta"),
  o("purchase", "خرید", "gold"), o("framework", "قرارداد چارچوب", "gray"), o("consulting", "مشاوره", "gray"), o("nda", "محرمانگی (NDA)", "red"),
  o("other", "سایر", "gray"),
]);

export const SUPPLIER_CHOICE_LISTS: Record<string, Option[]> = {
  "supplier.kinds": SUPPLIER_KINDS,
  "contract.contract_type": CONTRACT_TYPES,
};

export const CRITICALITY: Option[] = ordered([o("critical", "حیاتی", "red"), o("high", "زیاد", "orange"), o("medium", "متوسط", "gold"), o("low", "کم", "gray")]);

export const PAYMENT_FREQUENCIES: Option[] = ordered([
  o("one_off", "یک‌جا"), o("monthly", "ماهانه"), o("quarterly", "فصلی"), o("semiannual", "شش‌ماهه"), o("annual", "سالانه"),
]);

// ---------------------------------------------------------------------------------------------------------------
// Suppliers (SUP-001/003/004/042)

export const SUPPLIER_STATES: StateModel = {
  field: "state",
  initial: "prospective",
  states: [
    { value: "prospective", label: "بالقوه", category: "new", color: "blue" },
    { value: "onboarding", label: "در حال پذیرش", category: "active", color: "teal" },
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "under_review", label: "در بازبینی", category: "waiting", color: "gold" },
    { value: "suspended", label: "معلق", category: "waiting", color: "orange" },
    { value: "inactive", label: "غیرفعال", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
  ],
  transitions: [
    { from: ["prospective"], to: "onboarding", label: "شروع پذیرش" },
    { from: ["prospective", "onboarding", "under_review", "suspended", "inactive"], to: "active", label: "فعال‌سازی" },
    { from: ["active"], to: "under_review", label: "بازبینی" },
    { from: ["active", "under_review"], to: "suspended", label: "تعلیق", requires: ["status_reason"] },
    { from: ["active", "under_review", "suspended"], to: "inactive", label: "غیرفعال‌سازی", requires: ["status_reason"] },
    { from: ["prospective", "onboarding"], to: "rejected", label: "رد", requires: ["status_reason"] },
  ],
};

const S_MAIN = "اصلی";
const S_LEGAL = "هویت حقوقی";
const S_CONTACT = "تماس";
const S_FIN = "مالی و عملکرد";

const supplier: TableDef = {
  key: "supplier",
  table: "sm_suppliers",
  label: "تأمین‌کننده",
  plural: "تأمین‌کنندگان",
  icon: "building-2",
  module: "supplier",
  area: "vendor",
  description: "سازمان‌های بیرونی: سازنده، فروشنده، ناشر نرم‌افزار، ارائه‌دهندهٔ خدمت و ابر، اجاره‌دهنده و پیمانکار امحا — با مخاطبان، قراردادها و کارنامه",
  numbered: { prefix: "SUP", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 12, section: S_MAIN },
    { name: "kinds", label: "نقش‌ها", type: "multichoice", choices: "supplier.kinds", list: true, filter: true, span: 12, section: S_MAIN },
    { name: "segment", label: "بخش‌بندی", type: "choice", choices: ordered([o("strategic", "راهبردی", "purple"), o("tactical", "تاکتیکی", "blue"), o("operational", "عملیاتی", "teal"), o("commodity", "کالایی", "gray")]), filter: true, list: true, span: 8, section: S_MAIN },
    { name: "criticality", label: "اهمیت", type: "choice", choices: CRITICALITY, default: "medium", filter: true, list: true, sort: true, span: 8, section: S_MAIN },
    { name: "computed_criticality", label: "اهمیت محاسبه‌شده", type: "choice", choices: CRITICALITY, readonly: true, filter: true, span: 8, section: S_MAIN, help: "از پوشش قراردادها روی پیکربندی‌های حیاتی و حجم هزینه" },
    { name: "owner_id", label: "مدیر ارتباط", type: "user", default: "$me", list: true, filter: true, span: 8, section: S_MAIN },
    { name: "group_id", label: "گروه مسئول", type: "group", filter: true, span: 8, section: S_MAIN },
    { name: "status_reason", label: "علت وضعیت", type: "string", maxLength: 300, span: 8, section: S_MAIN },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24, section: S_MAIN, ai: { index: true } },

    { name: "legal_name", label: "نام ثبتی", type: "string", maxLength: 300, search: true, span: 12, section: S_LEGAL },
    { name: "national_id", label: "شناسهٔ ملی", type: "string", maxLength: 20, ltr: true, search: true, filter: true, span: 6, section: S_LEGAL },
    { name: "economic_code", label: "کد اقتصادی", type: "string", maxLength: 20, ltr: true, search: true, span: 6, section: S_LEGAL },
    { name: "registration_no", label: "شمارهٔ ثبت", type: "string", maxLength: 40, ltr: true, span: 8, section: S_LEGAL },
    { name: "country", label: "کشور", type: "string", maxLength: 80, default: "ایران", filter: true, span: 8, section: S_LEGAL },
    { name: "city", label: "شهر", type: "string", maxLength: 80, filter: true, span: 8, section: S_LEGAL },

    { name: "website", label: "وبگاه", type: "url", ltr: true, span: 12, section: S_CONTACT },
    { name: "email", label: "رایانامه", type: "email", ltr: true, span: 12, section: S_CONTACT },
    { name: "phone", label: "تلفن", type: "phone", ltr: true, span: 12, section: S_CONTACT },
    { name: "address", label: "نشانی", type: "text", span: 24, section: S_CONTACT },

    { name: "payment_terms", label: "شرایط پرداخت", type: "string", maxLength: 200, span: 12, section: S_FIN, group: "financial" },
    { name: "bank_account", label: "شمارهٔ شبا", type: "string", maxLength: 40, ltr: true, span: 12, section: S_FIN, group: "financial" },
    { name: "annual_spend", label: "هزینهٔ سال جاری", type: "money", readonly: true, audit: false, sort: true, span: 8, section: S_FIN, group: "financial" },
    { name: "score", label: "امتیاز عملکرد", type: "int", readonly: true, audit: false, list: true, sort: true, filter: true, span: 8, section: S_FIN, help: "از آخرین کارنامهٔ ماهانه (۰ تا ۱۰۰)" },
    { name: "score_at", label: "زمان کارنامه", type: "datetime", readonly: true, audit: false, span: 8, section: S_FIN },
  ],
  states: SUPPLIER_STATES,
  // the directory is reference data: whoever reads the area reads every supplier (pickers of models, assets, orders)
  scope: { own: ["owner_id"], group: "group_id", public: true },
  features: { journal: true, attachments: true, links: true, rag: true },
  form: {
    sections: [S_MAIN, S_LEGAL, S_CONTACT, S_FIN],
    related: [
      { table: "supplier_contact", field: "supplier_id", label: "مخاطبان", columns: ["name", "contact_type", "role", "escalation_level", "is_primary"] },
      { table: "contract", field: "supplier_id", label: "قراردادها", columns: ["number", "name", "contract_type", "state", "end_date"] },
      { table: "supplier_scorecard", field: "supplier_id", label: "کارنامه‌ها", columns: ["period_label", "score", "delivery_score", "quality_score", "sla_score"] },
      { table: "supplier_review", field: "supplier_id", label: "بازبینی‌ها", columns: ["number", "title", "review_date", "overall", "state"] },
    ],
  },
  list: { columns: ["number", "name", "kinds", "segment", "criticality", "state", "owner_id", "score"], order: "name" },
  ai: { title: "name", text: ["notes"] },
};

const supplierContact: TableDef = {
  key: "supplier_contact",
  table: "sm_supplier_contacts",
  label: "مخاطب تأمین‌کننده",
  plural: "مخاطبان تأمین‌کنندگان",
  icon: "contact",
  module: "supplier",
  area: "vendor",
  description: "افراد هر تأمین‌کننده با نقش، سطح تشدید و راه‌های تماس (اطلاعات شخصی در گروه «اطلاعات شخصی»)",
  display: "name",
  fields: [
    { name: "supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "contact_type", label: "نوع", type: "choice", choices: ordered([o("account_manager", "مدیر حساب"), o("support", "پشتیبانی"), o("technical", "فنی"), o("billing", "مالی"), o("escalation", "تشدید"), o("legal", "حقوقی"), o("other", "سایر")]), default: "support", list: true, filter: true, span: 8 },
    { name: "role", label: "سمت", type: "string", maxLength: 120, list: true, span: 8 },
    { name: "escalation_level", label: "سطح تشدید", type: "int", min: 0, max: 5, default: 0, list: true, sort: true, span: 8, help: "۰: تماس عادی؛ ۱ تا ۵ به ترتیب تشدید" },
    { name: "email", label: "رایانامه", type: "email", ltr: true, group: "personal", span: 8 },
    { name: "phone", label: "تلفن", type: "phone", ltr: true, group: "personal", span: 8 },
    { name: "mobile", label: "همراه", type: "phone", ltr: true, group: "personal", span: 8 },
    { name: "is_primary", label: "مخاطب اصلی", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "user_id", label: "عضو سامانه", type: "user", filter: true, span: 8, help: "اگر این فرد در سامانه حساب دارد" },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["supplier_id", "name", "contact_type", "role", "escalation_level", "is_primary"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Contracts (SUP-005/006/007/008/009/010/011/015)

export const CONTRACT_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "negotiation", label: "در مذاکره", category: "active", color: "blue" },
    { value: "pending_approval", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "expired", label: "منقضی", category: "closed", color: "orange" },
    { value: "terminated", label: "فسخ‌شده", category: "closed", color: "red" },
    { value: "renewed", label: "تمدیدشده", category: "closed", color: "teal" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "negotiation", label: "شروع مذاکره" },
    { from: ["draft", "negotiation"], to: "pending_approval", label: "ارسال برای تأیید", requires: ["supplier_id", "start_date", "end_date"] },
    // approvals move it on (onApprovalSettled); without an approval rule the contract manager activates it
    { from: ["draft", "negotiation", "pending_approval"], to: "active", label: "فعال‌سازی", requires: ["supplier_id", "start_date", "end_date"], guard: "contract_can_activate" },
    { from: ["pending_approval"], to: "negotiation", label: "بازگشت به مذاکره" },
    { from: ["active"], to: "expired", label: "پایان قرارداد" },
    { from: ["active"], to: "terminated", label: "فسخ", requires: ["termination_reason"] },
    { from: ["active", "expired"], to: "renewed", label: "تمدیدشده با قرارداد تازه", roles: SYSTEM_ONLY("contract") },
    { from: ["expired"], to: "active", label: "بازگشایی", requires: ["end_date"] },
    { from: ["draft", "negotiation", "pending_approval"], to: "canceled", label: "لغو" },
  ],
};

const C_MAIN = "اصلی";
const C_DATES = "تاریخ‌ها و تمدید";
const C_MONEY = "مالی";
const C_SERVICE = "سطح خدمت";

const approvalField: FieldDef = { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 };

const contract: TableDef = {
  key: "contract",
  table: "sm_contracts",
  label: "قرارداد",
  plural: "قراردادها",
  icon: "file-signature",
  module: "supplier",
  area: "contract",
  description: "هر توافق با تأمین‌کننده — پشتیبانی، ضمانت، اجاره، مجوز، اشتراک، خدمت ابری و قرارداد پشتیبان سطح خدمت — با تاریخ‌ها، مهلت اعلام، تمدید، ارزش، سطرها و پوشش",
  numbered: { prefix: "CNT", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 12, section: C_MAIN },
    { name: "supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", list: true, filter: true, index: true, span: 12, section: C_MAIN },
    { name: "contract_type", label: "نوع", type: "choice", choices: "contract.contract_type", required: true, default: "support", list: true, filter: true, span: 8, section: C_MAIN },
    { name: "vendor_ref", label: "شمارهٔ قرارداد طرف مقابل", type: "string", maxLength: 80, ltr: true, search: true, span: 8, section: C_MAIN },
    { name: "owner_id", label: "مدیر قرارداد", type: "user", default: "$me", list: true, filter: true, span: 8, section: C_MAIN },
    { name: "owner_group_id", label: "گروه مسئول", type: "group", filter: true, span: 8, section: C_MAIN },
    { name: "parent_id", label: "قرارداد مادر", type: "ref", ref: "$self", filter: true, span: 8, section: C_MAIN, help: "الحاقیه یا قرارداد اجرایی زیر یک قرارداد چارچوب" },
    { name: "previous_contract_id", label: "قرارداد پیشین", type: "ref", ref: "$self", filter: true, span: 8, section: C_MAIN, help: "قراردادی که این قرارداد تمدید آن است" },
    { name: "renewed_by_id", label: "تمدیدشده با", type: "ref", ref: "$self", readonly: true, span: 8, section: C_MAIN },
    { name: "document_id", label: "سند قرارداد (اسناد هوشمند)", type: "ref", ref: "doc_document", span: 16, section: C_MAIN, help: "متن قرارداد در «اسناد هوشمند» (با خواندن تصویر برای PDFهای اسکن‌شده) برای استخراج بندها" },
    { ...approvalField, section: C_MAIN },
    { name: "terms", label: "شرح و بندهای اصلی", type: "markdown", span: 24, section: C_MAIN, ai: { index: true } },
    { name: "termination_reason", label: "علت فسخ", type: "text", span: 24, section: C_MAIN },

    { name: "start_date", label: "شروع", type: "date", list: true, sort: true, filter: true, span: 6, section: C_DATES },
    { name: "end_date", label: "پایان", type: "date", list: true, sort: true, filter: true, index: true, span: 6, section: C_DATES },
    { name: "notice_period_days", label: "مهلت اعلام (روز)", type: "int", min: 0, max: 3650, default: 30, span: 6, section: C_DATES, help: "چند روز پیش از پایان باید تصمیم تمدید یا خاتمه اعلام شود" },
    { name: "notice_date", label: "آخرین مهلت اعلام", type: "date", readonly: true, sort: true, filter: true, index: true, list: true, span: 6, section: C_DATES },
    { name: "renewal_type", label: "تمدید", type: "choice", choices: ordered([o("manual", "دستی", "blue"), o("auto", "خودکار", "green"), o("none", "بدون تمدید", "gray")]), default: "manual", filter: true, span: 8, section: C_DATES },
    { name: "renewal_term_months", label: "دورهٔ تمدید (ماه)", type: "int", min: 1, max: 120, default: 12, span: 8, section: C_DATES },
    { name: "reminder_days", label: "یادآوری (روز پیش از مهلت)", type: "json", default: [90, 60, 30, 7], span: 8, section: C_DATES, help: "فهرست روزها؛ مثلاً [90, 60, 30, 7]" },
    { name: "reminded", label: "یادآوری‌های فرستاده", type: "json", system: true, hidden: true, audit: false },

    { name: "value", label: "ارزش کل", type: "money", sort: true, span: 8, section: C_MONEY, group: "financial" },
    { name: "annual_value", label: "هزینهٔ سالانه", type: "money", sort: true, list: true, span: 8, section: C_MONEY, group: "financial" },
    { name: "payment_frequency", label: "دورهٔ پرداخت", type: "choice", choices: PAYMENT_FREQUENCIES, default: "annual", span: 8, section: C_MONEY },
    { name: "currency", label: "ارز قرارداد", type: "choice", choices: CURRENCIES, default: "IRR", span: 8, section: C_MONEY },
    { name: "foreign_value", label: "ارزش به ارز قرارداد", type: "decimal", span: 8, section: C_MONEY, group: "financial", help: "برای قرارداد ارزی؛ ارزش ریالی با نرخ روز ثبت می‌شود" },
    { name: "fx_rate", label: "نرخ تبدیل به ریال", type: "decimal", span: 8, section: C_MONEY, group: "financial" },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 12, section: C_MONEY },
    { name: "cost_type_id", label: "نوع هزینه", type: "ref", ref: "cost_type", filter: true, span: 12, section: C_MONEY },

    { name: "service_id", label: "خدمت پشتیبانی‌شده", type: "ref", ref: "service", filter: true, span: 12, section: C_SERVICE },
    { name: "sla_definitions", label: "توافق‌های سطح خدمتی که پشتیبانی می‌کند", type: "refs", ref: "sla_definition", span: 12, section: C_SERVICE, help: "قرارداد پشتیبان (UC): توافق‌هایی که به تعهد این تأمین‌کننده تکیه دارند" },
    { name: "uc_targets", label: "تعهدهای سطح خدمت تأمین‌کننده", type: "markdown", span: 24, section: C_SERVICE, ai: { index: true }, help: "زمان پاسخ و رفع، ساعات پشتیبانی، جریمه‌ها" },
  ],
  states: CONTRACT_STATES,
  scope: { own: ["owner_id"], requester: ["owner_id"], group: "owner_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true, confidential: true, calendar: { start: "end_date" } },
  form: {
    sections: [C_MAIN, C_DATES, C_MONEY, C_SERVICE],
    related: [
      { table: "contract_line", field: "contract_id", label: "سطرها", columns: ["description", "quantity", "unit_price", "amount", "period"] },
      { table: "contract_coverage", field: "contract_id", label: "پوشش", columns: ["target_kind", "asset_id", "ci_id", "service_id", "coverage_level", "valid_to"] },
      { table: "contract_obligation", field: "contract_id", label: "تعهدها", columns: ["number", "title", "party", "due_date", "state"] },
      { table: "contract", field: "parent_id", label: "قراردادهای زیرمجموعه", columns: ["number", "name", "state", "end_date"] },
    ],
  },
  list: { columns: ["number", "name", "supplier_id", "contract_type", "state", "end_date", "notice_date", "annual_value", "owner_id"], order: "end_date" },
  ai: { title: "name", text: ["terms", "uc_targets"], attachments: true },
};

const contractLine: TableDef = {
  key: "contract_line",
  table: "sm_contract_lines",
  label: "سطر قرارداد",
  plural: "سطرهای قرارداد",
  icon: "list",
  module: "supplier",
  area: "contract",
  description: "اقلام، نرخ‌ها و دورهٔ هزینهٔ هر قرارداد",
  display: "description",
  fields: [
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "description", label: "شرح", type: "string", required: true, maxLength: 300, list: true, search: true, span: 12 },
    { name: "quantity", label: "مقدار", type: "decimal", default: "1", list: true, span: 6 },
    { name: "unit_price", label: "بهای واحد", type: "money", list: true, span: 6, group: "financial" },
    { name: "amount", label: "مبلغ", type: "money", readonly: true, list: true, span: 6, group: "financial" },
    { name: "period", label: "دوره", type: "choice", choices: PAYMENT_FREQUENCIES, default: "annual", list: true, span: 6 },
    { name: "model_id", label: "مدل کالا", type: "ref", ref: "asset_model", filter: true, span: 12 },
    { name: "software_model_id", label: "نرم‌افزار", type: "ref", ref: "software_model", filter: true, span: 12 },
    { name: "start_date", label: "از", type: "date", span: 6 },
    { name: "end_date", label: "تا", type: "date", span: 6 },
  ],
  scope: { parent: "contract_id" },
  list: { columns: ["contract_id", "description", "quantity", "unit_price", "amount", "period"], order: "contract_id" },
};

export const COVERAGE_KINDS: Option[] = ordered([o("asset", "دارایی"), o("ci", "پیکربندی"), o("service", "خدمت"), o("software_model", "نرم‌افزار"), o("location", "مکان")]);
export const COVERAGE_LEVELS: Option[] = ordered([
  o("full", "کامل", "green"), o("parts", "فقط قطعه", "blue"), o("labour", "فقط دستمزد", "teal"), o("onsite", "در محل", "indigo"), o("remote", "از راه دور", "gray"),
  o("nbd", "روز کاری بعد", "gold"), o("h24", "شبانه‌روزی", "red"),
]);

const contractCoverage: TableDef = {
  key: "contract_coverage",
  table: "sm_contract_coverages",
  label: "پوشش قرارداد",
  plural: "پوشش‌های قرارداد",
  icon: "shield-check",
  module: "supplier",
  area: "contract",
  description: "دارایی‌ها، پیکربندی‌ها، خدمت‌ها، نرم‌افزارها و مکان‌هایی که یک قرارداد پوشش می‌دهد",
  display: "label",
  fields: [
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "target_kind", label: "پوشش برای", type: "choice", choices: COVERAGE_KINDS, required: true, default: "asset", list: true, filter: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", list: true, filter: true, index: true, span: 12 },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", list: true, filter: true, index: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, index: true, span: 12 },
    { name: "software_model_id", label: "نرم‌افزار", type: "ref", ref: "software_model", filter: true, span: 12 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 12 },
    { name: "coverage_level", label: "سطح پوشش", type: "choice", choices: COVERAGE_LEVELS, default: "full", list: true, filter: true, span: 12 },
    { name: "valid_from", label: "از", type: "date", sort: true, span: 6 },
    { name: "valid_to", label: "تا", type: "date", list: true, sort: true, filter: true, span: 6 },
    { name: "label", label: "پوشش", type: "string", system: true, maxLength: 300, search: true, audit: false, span: 24 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
  ],
  scope: { parent: "contract_id" },
  list: { columns: ["contract_id", "target_kind", "asset_id", "ci_id", "coverage_level", "valid_to"], order: "-updated_at" },
};

export const OBLIGATION_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "waiting", label: "در انتظار طرف مقابل", category: "waiting", color: "gold" },
    { value: "fulfilled", label: "انجام‌شده", category: "closed", color: "green" },
    { value: "breached", label: "نقض‌شده", category: "resolved", color: "red" },
    { value: "waived", label: "چشم‌پوشی‌شده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open", "waiting"], to: "in_progress", label: "شروع" },
    { from: ["open", "in_progress"], to: "waiting", label: "در انتظار طرف مقابل" },
    { from: ["open", "in_progress", "waiting"], to: "fulfilled", label: "انجام شد" },
    { from: ["open", "in_progress", "waiting"], to: "breached", label: "نقض شد", requires: ["note"] },
    { from: ["breached"], to: "fulfilled", label: "جبران شد" },
    { from: ["open", "in_progress", "waiting"], to: "waived", label: "چشم‌پوشی", requires: ["note"] },
  ],
};

const contractObligation: TableDef = {
  key: "contract_obligation",
  table: "sm_contract_obligations",
  label: "تعهد قراردادی",
  plural: "تعهدهای قراردادی",
  icon: "list-checks",
  module: "supplier",
  area: "contract",
  description: "تعهدهای ما یا تأمین‌کننده با موعد و تکرار: گزارش دوره‌ای، بیمه‌نامه، ممیزی، تحویل",
  numbered: { prefix: "OBL", pad: 6 },
  display: "title",
  fields: [
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "party", label: "متعهد", type: "choice", choices: ordered([o("supplier", "تأمین‌کننده", "blue"), o("us", "سازمان ما", "teal")]), default: "supplier", list: true, filter: true, span: 8 },
    { name: "owner_id", label: "پیگیری‌کننده", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "due_date", label: "موعد", type: "date", list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "recurrence", label: "تکرار", type: "choice", choices: ordered([o("none", "یک‌بار"), o("monthly", "ماهانه"), o("quarterly", "فصلی"), o("annual", "سالانه")]), default: "none", filter: true, span: 8 },
    { name: "fulfilled_at", label: "زمان انجام", type: "datetime", readonly: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "note", label: "یادداشت نتیجه", type: "text", span: 24 },
    { name: "reminded", label: "یادآوری‌های فرستاده", type: "json", system: true, hidden: true, audit: false },
  ],
  states: OBLIGATION_STATES,
  scope: { own: ["owner_id"], parent: "contract_id" },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "contract_id", "title", "party", "owner_id", "due_date", "state"], order: "due_date" },
};

// ---------------------------------------------------------------------------------------------------------------
// Guarantees, bonds and retention (SUP-012)

export const GUARANTEE_KINDS: Option[] = ordered([
  o("bid", "ضمانت‌نامهٔ شرکت در مناقصه", "gray"), o("performance", "ضمانت‌نامهٔ انجام تعهدات", "blue"), o("advance", "ضمانت‌نامهٔ پیش‌پرداخت", "teal"),
  o("retention", "سپردهٔ حسن انجام کار (کسور)", "gold"), o("warranty", "ضمانت‌نامهٔ دورهٔ تضمین", "green"), o("insurance", "بیمه‌نامه", "purple"), o("other", "سایر", "gray"),
]);

export const GUARANTEE_FORMS: Option[] = ordered([
  o("bank_guarantee", "ضمانت‌نامهٔ بانکی", "blue"), o("insurance_policy", "بیمه‌نامه", "purple"), o("cheque", "چک", "gold"), o("promissory_note", "سفته", "orange"),
  o("cash", "واریز نقدی یا کسر از پرداخت", "green"), o("other", "سایر", "gray"),
]);

export const GUARANTEE_STATES: StateModel = {
  field: "state",
  initial: "active",
  states: [
    { value: "active", label: "در اعتبار", category: "active", color: "green" },
    { value: "expired", label: "منقضی", category: "waiting", color: "orange" },
    { value: "released", label: "آزادشده", category: "closed", color: "gray" },
    { value: "forfeited", label: "ضبط‌شده", category: "resolved", color: "red" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["active", "expired"], to: "released", label: "آزادسازی" },
    { from: ["active", "expired"], to: "forfeited", label: "ضبط", requires: ["note"] },
    { from: ["active"], to: "expired", label: "منقضی شد" },
    { from: ["expired"], to: "active", label: "تمدید شد", requires: ["expiry_date"] },
    { from: ["active"], to: "canceled", label: "لغو" },
  ],
};

const contractGuarantee: TableDef = {
  key: "contract_guarantee",
  table: "sm_contract_guarantees",
  label: "ضمانت‌نامه یا سپرده",
  plural: "ضمانت‌نامه‌ها و سپرده‌ها",
  icon: "landmark",
  module: "supplier",
  area: "contract",
  description: "ضمانت‌نامه‌های بانکی، بیمه‌نامه‌ها و سپرده‌های حسن انجام کار هر قرارداد با موعد اعتبار و آزادسازی",
  numbered: { prefix: "GRT", pad: 6 },
  display: "reference_no",
  fields: [
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: GUARANTEE_KINDS, default: "performance", required: true, list: true, filter: true, span: 12 },
    { name: "form", label: "شکل", type: "choice", choices: GUARANTEE_FORMS, default: "bank_guarantee", filter: true, span: 8 },
    { name: "issuer", label: "صادرکننده (بانک یا بیمه)", type: "string", maxLength: 120, search: true, span: 8 },
    { name: "reference_no", label: "شمارهٔ ضمانت‌نامه", type: "string", maxLength: 60, ltr: true, search: true, list: true, span: 8 },
    { name: "amount", label: "مبلغ", type: "money", list: true, sort: true, span: 8, group: "financial" },
    { name: "issue_date", label: "تاریخ صدور", type: "date", span: 8 },
    { name: "expiry_date", label: "پایان اعتبار", type: "date", list: true, sort: true, filter: true, index: true, span: 8, help: "یادآوری تمدید یا آزادسازی پیش از این تاریخ می‌آید" },
    { name: "release_due", label: "موعد آزادسازی", type: "date", sort: true, span: 8, help: "برای سپرده: پایان دورهٔ تضمین" },
    { name: "released_at", label: "زمان آزادسازی", type: "datetime", readonly: true, span: 8 },
    { name: "owner_id", label: "پیگیری‌کننده", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
    { name: "reminded", label: "یادآوری‌های فرستاده", type: "json", system: true, hidden: true, audit: false },
  ],
  states: GUARANTEE_STATES,
  scope: { own: ["owner_id"], parent: "contract_id" },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "contract_id", "kind", "reference_no", "amount", "expiry_date", "state"], order: "expiry_date" },
};

// ---------------------------------------------------------------------------------------------------------------
// Performance (SUP-020/021)

const scorecard: TableDef = {
  key: "supplier_scorecard",
  table: "sm_supplier_scorecards",
  label: "کارنامهٔ تأمین‌کننده",
  plural: "کارنامه‌های تأمین‌کنندگان",
  icon: "gauge",
  module: "supplier",
  area: "vendor",
  description: "امتیاز ماهانهٔ هر تأمین‌کننده از تحویل به‌موقع، کیفیت، تعهدها و بازبینی‌ها — محاسبه‌شده با سامانه",
  display: "period_label",
  fields: [
    { name: "supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "period", label: "دوره", type: "string", required: true, maxLength: 10, ltr: true, filter: true, sort: true, index: true, span: 6 },
    { name: "period_label", label: "دورهٔ گزارش", type: "string", maxLength: 40, list: true, span: 6 },
    { name: "score", label: "امتیاز کل", type: "int", readonly: true, list: true, sort: true, filter: true, span: 6 },
    { name: "delivery_score", label: "تحویل به‌موقع", type: "int", readonly: true, list: true, span: 6 },
    { name: "quality_score", label: "کیفیت", type: "int", readonly: true, list: true, span: 6 },
    { name: "sla_score", label: "تعهدهای قراردادی", type: "int", readonly: true, list: true, span: 6 },
    { name: "review_score", label: "بازبینی‌ها", type: "int", readonly: true, span: 6 },
    { name: "metrics", label: "جزئیات", type: "json", readonly: true, span: 24 },
    { name: "computed_at", label: "زمان محاسبه", type: "datetime", readonly: true, span: 8 },
  ],
  scope: { public: true },
  rowAccess: { write: NEVER },
  list: { columns: ["supplier_id", "period_label", "score", "delivery_score", "quality_score", "sla_score"], order: "-period" },
  unique: [["supplier_id", "period"]],
};

const review: TableDef = {
  key: "supplier_review",
  table: "sm_supplier_reviews",
  label: "بازبینی تأمین‌کننده",
  plural: "بازبینی‌های تأمین‌کنندگان",
  icon: "messages-square",
  module: "supplier",
  area: "vendor",
  description: "جلسه‌های بازبینی دوره‌ای (QBR) با امتیاز کیفیت، تحویل، ارتباط و ارزش، و کارهای بهبود",
  numbered: { prefix: "QBR", pad: 5 },
  display: "title",
  fields: [
    { name: "supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "review_date", label: "تاریخ", type: "date", default: "$today", list: true, sort: true, filter: true, span: 8 },
    { name: "reviewer_id", label: "بازبین", type: "user", default: "$me", filter: true, span: 8 },
    { name: "quality", label: "کیفیت", type: "rating", min: 1, max: 5, span: 6 },
    { name: "delivery", label: "تحویل", type: "rating", min: 1, max: 5, span: 6 },
    { name: "communication", label: "ارتباط", type: "rating", min: 1, max: 5, span: 6 },
    { name: "value_for_money", label: "ارزش در برابر هزینه", type: "rating", min: 1, max: 5, span: 6 },
    { name: "overall", label: "میانگین", type: "decimal", readonly: true, list: true, sort: true, span: 8 },
    { name: "summary", label: "جمع‌بندی", type: "markdown", span: 24 },
    { name: "actions", label: "کارهای بهبود", type: "markdown", span: 24 },
  ],
  states: {
    field: "state",
    initial: "scheduled",
    states: [
      { value: "scheduled", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
      { value: "held", label: "برگزارشده", category: "active", color: "teal" },
      { value: "closed", label: "بسته", category: "closed", color: "gray" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["scheduled"], to: "held", label: "برگزار شد" },
      { from: ["held"], to: "closed", label: "بستن" },
      { from: ["scheduled"], to: "canceled", label: "لغو" },
    ],
  },
  scope: { own: ["reviewer_id"] },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "supplier_id", "title", "review_date", "overall", "state"], order: "-review_date" },
};

export const SUPPLIER_CONFIG_DEFAULTS = {
  expire_auto: true,
  w_delivery: 30,
  w_quality: 25,
  w_sla: 25,
  w_review: 20,
  default_reminders: [90, 60, 30, 7] as number[],
};
export type SupplierConfig = typeof SUPPLIER_CONFIG_DEFAULTS;

const config: TableDef = {
  key: "supplier_config",
  table: "sm_supplier_configs",
  label: "تنظیمات تأمین‌کنندگان و قراردادها",
  plural: "تنظیمات تأمین‌کنندگان و قراردادها",
  icon: "settings-2",
  module: "supplier",
  area: "settings",
  description: "پایان خودکار قراردادها، یادآوری‌های پیش‌فرض و وزن‌های کارنامه",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات قراردادها", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "expire_auto", label: "قرارداد پس از پایان خودکار منقضی شود", type: "bool", default: true, span: 12 },
    { name: "default_reminders", label: "یادآوری‌های پیش‌فرض (روز)", type: "json", default: SUPPLIER_CONFIG_DEFAULTS.default_reminders, span: 12 },
    { name: "w_delivery", label: "وزن تحویل به‌موقع", type: "int", min: 0, max: 100, default: SUPPLIER_CONFIG_DEFAULTS.w_delivery, span: 6 },
    { name: "w_quality", label: "وزن کیفیت", type: "int", min: 0, max: 100, default: SUPPLIER_CONFIG_DEFAULTS.w_quality, span: 6 },
    { name: "w_sla", label: "وزن تعهدها", type: "int", min: 0, max: 100, default: SUPPLIER_CONFIG_DEFAULTS.w_sla, span: 6 },
    { name: "w_review", label: "وزن بازبینی", type: "int", min: 0, max: 100, default: SUPPLIER_CONFIG_DEFAULTS.w_review, span: 6 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "expire_auto"], order: "name" },
};

export const SUPPLIER_TABLES: TableDef[] = [supplier, supplierContact, contract, contractLine, contractCoverage, contractObligation, contractGuarantee, scorecard, review, config];
