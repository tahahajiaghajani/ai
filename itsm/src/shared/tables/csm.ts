// Tables of customer service management (docs/modules/csm_FA.md, catalogue docs/catalog/g4_requests.md «Module: csm»):
// service for external customers on the same engine. Accounts form a tree and are bound to a company node of the
// organisation tree (`org_unit_id`), so the access model's own rules decide what customers see: a contact is a member
// whose profile sits in that unit (their cases are theirs), the customer's administrator manages the unit (the access
// model's requester-side reading: every case of the account's people) and the support group works them. Contacts
// carry ITIL consumer roles; products, the installed base, contracts and entitlements (channels, coverage hours,
// support level, units consumed in a ledger) decide what support a customer gets; customer cases snapshot the
// entitlement at intake, show customer-friendly states, accept or reject a resolution and never leak internal notes
// (the journal's internal entries need the «internal» field group, which external contacts never hold). Escalations,
// account plans, stakeholders, quarterly reviews, health snapshots, customer experiences (brands) and regulated
// notices complete relationship management. Everything is in the access area `csm`.
// Behaviour: src/server/modules/csm; screens: src/ui/modules/csm. Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES } from "../model/task";

const o = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

export const ACCOUNT_KINDS: Option[] = [o("customer", "مشتری", 1, "blue"), o("partner", "شریک", 2, "purple"), o("prospect", "مشتری بالقوه", 3, "gray")];
export const ACCOUNT_TIERS: Option[] = [o("strategic", "راهبردی", 1, "magenta"), o("gold", "طلایی", 2, "gold"), o("silver", "نقره‌ای", 3, "gray"), o("bronze", "برنزی", 4, "orange")];
export const ACCOUNT_SEGMENTS: Option[] = [o("enterprise", "سازمان بزرگ", 1), o("government", "دولتی", 2), o("smb", "کسب‌وکار کوچک و متوسط", 3), o("consumer", "مصرف‌کننده", 4)];
export const RELATIONSHIP_TYPES: Option[] = [o("basic", "پایه", 1), o("cooperative", "همکارانه", 2), o("partnership", "شراکتی", 3)];
export const HEALTH_STATES: Option[] = [o("green", "سالم", 1, "green"), o("amber", "نیازمند توجه", 2, "gold"), o("red", "در خطر", 3, "red"), o("unknown", "نامعلوم", 4, "gray")];
export const CHURN_RISK: Option[] = [o("low", "کم", 1, "green"), o("medium", "متوسط", 2, "gold"), o("high", "زیاد", 3, "red")];

export const CONTACT_ROLES: Option[] = [
  o("customer", "مشتری خدمت", 1, "blue"),
  o("user", "کاربر", 2, "teal"),
  o("sponsor", "حامی", 3, "purple"),
  o("admin", "مدیر حساب در درگاه", 4, "magenta"),
  o("billing", "مالی", 5, "green"),
  o("technical", "فنی", 6, "indigo"),
];
export const PREFERRED_CHANNELS: Option[] = [o("email", "رایانامه", 1), o("sms", "پیامک", 2), o("phone", "تلفن", 3), o("messenger", "پیام‌رسان", 4), o("portal", "درگاه", 5)];
export const SUPPORT_LEVELS: Option[] = [o("basic", "پایه", 1, "gray"), o("standard", "استاندارد", 2, "blue"), o("premium", "ویژه", 3, "purple"), o("enterprise", "سازمانی", 4, "magenta")];
export const ENTITLEMENT_CHANNELS: Option[] = [o("portal", "درگاه", 1), o("email", "رایانامه", 2), o("phone", "تلفن", 3), o("chat", "گفت‌وگو", 4), o("onsite", "حضوری", 5)];
export const UNIT_TYPES: Option[] = [o("none", "نامحدود", 1), o("cases", "تعداد پرونده", 2), o("hours", "ساعت کار", 3)];
export const CASE_TYPES: Option[] = [
  o("question", "پرسش", 1, "blue"),
  o("problem", "اشکال", 2, "red"),
  o("request", "درخواست", 3, "teal"),
  o("suggestion", "پیشنهاد", 4, "green"),
  o("complaint", "شکایت", 5, "magenta"),
];
export const COMPLAINT_SEVERITY: Option[] = [o("low", "کم", 1, "gray"), o("medium", "متوسط", 2, "gold"), o("high", "زیاد", 3, "red")];
export const SENTIMENTS: Option[] = [o("positive", "مثبت", 1, "green"), o("neutral", "خنثی", 2, "gray"), o("negative", "منفی", 3, "red")];
export const ENTITLEMENT_STATUS: Option[] = [
  o("covered", "دارای استحقاق", 1, "green"),
  o("exhausted", "سهمیه تمام‌شده", 2, "orange"),
  o("expired", "منقضی", 3, "gray"),
  o("none", "بدون استحقاق", 4, "red"),
  o("channel", "این مجرا در استحقاق نیست", 5, "gold"),
];
export const ESCALATION_REASONS: Option[] = [o("sla_risk", "خطر نقض توافق", 1), o("customer_request", "درخواست مشتری", 2), o("executive", "پیگیری مدیران", 3), o("quality", "کیفیت خدمت", 4), o("other", "دیگر", 5)];
export const CADENCES: Option[] = [o("daily", "روزانه", 1), o("twice_weekly", "دو بار در هفته", 2), o("weekly", "هفتگی", 3), o("monthly", "ماهانه", 4), o("quarterly", "فصلی", 5)];
export const ATTITUDES: Option[] = [o("champion", "پیش‌برنده", 1, "green"), o("supporter", "حامی", 2, "teal"), o("neutral", "بی‌طرف", 3, "gray"), o("critic", "منتقد", 4, "gold"), o("blocker", "مانع", 5, "red")];
export const REGULATIONS: Option[] = [o("none", "داوطلبانه", 1), o("data_breach", "نقض دادهٔ شخصی", 2), o("major_incident", "رخداد مهم اثرگذار بر مشتری", 3), o("regulator", "الزام نهاد ناظر", 4)];
export const CONTRACT_STATES: Option[] = [o("draft", "پیش‌نویس", 1, "blue"), o("active", "در جریان", 2, "green"), o("expired", "پایان‌یافته", 3, "gray"), o("terminated", "فسخ‌شده", 4, "red")];

export const CSM_CHOICE_LISTS: Record<string, Option[]> = {
  "customer_account.segment": ACCOUNT_SEGMENTS,
  "customer_case.case_type": CASE_TYPES,
};

const A_MAIN = "اصلی";
const A_TEAM = "تیم حساب";
const A_HEALTH = "سلامت رابطه";

const customerAccount: TableDef = {
  key: "customer_account",
  table: "sm_customer_accounts",
  label: "حساب مشتری",
  plural: "حساب‌های مشتری",
  icon: "building",
  module: "csm",
  area: "csm",
  description: "مشتری سازمانی با درخت شرکت‌ها، سایت‌ها، بخش و رده، تیم حساب، نوع رابطه، سلامت رابطه و واحد سازمانی برای دسترسی کاربرانش",
  display: "name",
  fields: [
    { name: "name", label: "نام حساب", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12, section: A_MAIN },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, search: true, list: true, span: 6, section: A_MAIN },
    { name: "kind", label: "نوع", type: "choice", choices: ACCOUNT_KINDS, default: "customer", filter: true, span: 6, section: A_MAIN },
    { name: "parent_id", label: "حساب بالادستی", type: "ref", ref: "$self", filter: true, index: true, span: 12, section: A_MAIN },
    { name: "org_unit_id", label: "واحد سازمانی مشتری", type: "ref", ref: "org_unit", filter: true, span: 12, section: A_MAIN, help: "کاربران مشتری در این واحد عضوند؛ مدیر این واحد همهٔ پرونده‌های حساب را می‌بیند" },
    { name: "segment", label: "بخش", type: "choice", choices: "customer_account.segment", filter: true, span: 8, section: A_MAIN },
    { name: "tier", label: "رده", type: "choice", choices: ACCOUNT_TIERS, default: "silver", list: true, filter: true, span: 8, section: A_MAIN },
    { name: "relationship_type", label: "نوع رابطه", type: "choice", choices: RELATIONSHIP_TYPES, default: "basic", filter: true, span: 8, section: A_MAIN },
    { name: "email_domain", label: "دامنهٔ رایانامه", type: "string", maxLength: 120, ltr: true, search: true, span: 8, section: A_MAIN, help: "مخاطب تازه با این دامنه به همین حساب وصل می‌شود" },
    { name: "phone", label: "تلفن", type: "phone", span: 8, section: A_MAIN },
    { name: "website", label: "وب‌گاه", type: "url", ltr: true, span: 8, section: A_MAIN },
    { name: "city", label: "شهر", type: "string", maxLength: 80, filter: true, span: 8, section: A_MAIN },
    { name: "address", label: "نشانی", type: "text", span: 16, section: A_MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8, section: A_MAIN },
    { name: "relationship_manager_id", label: "مدیر رابطه", type: "user", list: true, filter: true, index: true, span: 8, section: A_TEAM },
    { name: "service_delivery_manager_id", label: "مدیر ارائهٔ خدمت", type: "user", filter: true, index: true, span: 8, section: A_TEAM },
    { name: "technical_account_manager_id", label: "مدیر فنی حساب", type: "user", filter: true, index: true, span: 8, section: A_TEAM },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", filter: true, index: true, span: 8, section: A_TEAM },
    { name: "health_score", label: "امتیاز سلامت", type: "int", readonly: true, sort: true, list: true, span: 8, section: A_HEALTH },
    { name: "health_status", label: "سلامت", type: "choice", choices: HEALTH_STATES, readonly: true, default: "unknown", list: true, filter: true, span: 8, section: A_HEALTH },
    { name: "churn_risk", label: "ریسک ریزش", type: "choice", choices: CHURN_RISK, readonly: true, filter: true, span: 8, section: A_HEALTH },
    { name: "health_factors", label: "عامل‌های سلامت", type: "json", system: true, audit: false, default: [] },
    { name: "health_at", label: "زمان محاسبه", type: "datetime", readonly: true, audit: false, span: 8, section: A_HEALTH },
    { name: "open_cases", label: "پرونده‌های باز", type: "int", readonly: true, default: 0, audit: false, sort: true, span: 8, section: A_HEALTH },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24, section: A_MAIN },
  ],
  scope: { own: ["relationship_manager_id", "service_delivery_manager_id", "technical_account_manager_id"], requester: [], group: "support_group_id" },
  features: { journal: true, attachments: true, links: true },
  form: {
    sections: [A_MAIN, A_TEAM, A_HEALTH],
    related: [
      { table: "customer_contact", field: "account_id", label: "مخاطبان", columns: ["name", "roles", "email", "is_primary", "active"] },
      { table: "customer_case", field: "account_id", label: "پرونده‌ها", columns: ["number", "short_description", "case_type", "state", "priority", "assigned_to"] },
      { table: "entitlement", field: "account_id", label: "استحقاق‌ها", columns: ["number", "name", "support_level", "state", "units_remaining", "ends_on"] },
      { table: "install_base_item", field: "account_id", label: "پایگاه نصب", columns: ["number", "name", "product_id", "serial_no", "status"] },
      { table: "customer_contract", field: "account_id", label: "قراردادها", columns: ["number", "name", "status", "starts_on", "ends_on"] },
      { table: "case_escalation", field: "account_id", label: "تشدیدها", columns: ["number", "short_description", "state", "owner_id"] },
      { table: "account_plan", field: "account_id", label: "برنامه‌های حساب", columns: ["name", "period", "status", "next_review"] },
      { table: "account_review", field: "account_id", label: "بازبینی‌های فصلی", columns: ["number", "title", "state", "held_at"] },
    ],
  },
  list: { columns: ["name", "code", "tier", "health_status", "relationship_manager_id", "open_cases"], order: "name" },
};

/** Account rows copy the account's support group (system) so the group reads and works them. */
const ACCOUNT_CHILD = { name: "support_group_id", label: "گروه پشتیبانی", type: "group", system: true, filter: true, index: true } as const;

const customerContact: TableDef = {
  key: "customer_contact",
  table: "sm_customer_contacts",
  label: "مخاطب مشتری",
  plural: "مخاطبان مشتری",
  icon: "contact",
  module: "csm",
  area: "csm",
  description: "فرد مشتری با نقش‌های ITIL (مشتری، کاربر، حامی) و نقش‌های مدیر حساب و مالی، مجرای ترجیحی و دسترسی به حساب‌های دیگر",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "کاربر درگاه", type: "user", unique: true, filter: true, index: true, span: 12, help: "عضوی که با این مخاطب وارد درگاه مشتریان می‌شود" },
    { name: "email", label: "رایانامه", type: "email", ltr: true, list: true, search: true, span: 12 },
    { name: "phone", label: "تلفن همراه", type: "phone", group: "personal", span: 8 },
    { name: "job_title", label: "سمت", type: "string", maxLength: 120, span: 8 },
    { name: "roles", label: "نقش‌ها", type: "multichoice", choices: CONTACT_ROLES, default: ["customer", "user"], list: true, filter: true, span: 8 },
    { name: "is_primary", label: "مخاطب اصلی", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "preferred_channel", label: "مجرای ترجیحی", type: "choice", choices: PREFERRED_CHANNELS, default: "email", span: 8 },
    { name: "language", label: "زبان", type: "choice", choices: [o("fa", "فارسی", 1), o("en", "انگلیسی", 2)], default: "fa", span: 8 },
    { name: "other_accounts", label: "دسترسی به حساب‌های دیگر", type: "refs", ref: "customer_account", span: 16 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { own: ["user_id"], requester: ["user_id"], group: "support_group_id", requesterWritable: ["phone", "preferred_channel", "language"] },
  features: { journal: false, attachments: false },
  list: { columns: ["name", "account_id", "email", "roles", "is_primary", "active"], order: "name" },
};

const customerProduct: TableDef = {
  key: "customer_product",
  table: "sm_customer_products",
  label: "محصول",
  plural: "محصولات",
  icon: "package",
  module: "csm",
  area: "csm",
  description: "محصول یا خدمتی که به مشتریان فروخته و پشتیبانی می‌شود، با گروه پشتیبانی و مهارت‌های لازم برای مسیریابی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, list: true, span: 6 },
    { name: "product_version", label: "نسخه", type: "string", maxLength: 40, ltr: true, span: 6 },
    { name: "family", label: "خانواده", type: "string", maxLength: 80, filter: true, span: 8 },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", filter: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", span: 8 },
    { name: "skills", label: "مهارت‌های لازم", type: "tags", span: 16 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
  ],
  scope: { group: "support_group_id", public: true },
  list: { columns: ["name", "code", "family", "support_group_id", "active"], order: "name" },
};

const installBaseItem: TableDef = {
  key: "install_base_item",
  table: "sm_install_base_items",
  label: "قلم پایگاه نصب",
  plural: "پایگاه نصب",
  icon: "server",
  module: "csm",
  area: "csm",
  description: "آنچه هر مشتری خریده و به کار می‌برد: محصول، شمارهٔ سریال، مکان، پیکربندی (CI) و دارایی — تا اثر یک CI مشتریان متأثر را پیدا کند",
  numbered: { prefix: "IBI", pad: 7 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "product_id", label: "محصول", type: "ref", ref: "customer_product", list: true, filter: true, index: true, span: 12 },
    { name: "serial_no", label: "شمارهٔ سریال", type: "string", maxLength: 80, ltr: true, search: true, list: true, span: 12 },
    { name: "quantity", label: "تعداد", type: "int", min: 1, default: 1, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: [o("active", "فعال", 1, "green"), o("retired", "کنارگذاشته", 2, "gray")], default: "active", list: true, filter: true, span: 6 },
    { name: "parent_id", label: "قلم بالادستی", type: "ref", ref: "$self", filter: true, span: 12 },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", filter: true, index: true, span: 12 },
    { name: "asset_ref", label: "دارایی", type: "string", maxLength: 120, ltr: true, span: 12, help: "شناسهٔ دارایی در مدیریت دارایی (وقتی آن ماژول نصب است)" },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 12 },
    { name: "contact_id", label: "مخاطب مسئول", type: "ref", ref: "customer_contact", span: 12 },
    { name: "installed_on", label: "تاریخ نصب", type: "date", span: 6 },
    { name: "warranty_end", label: "پایان ضمانت", type: "date", sort: true, filter: true, span: 6 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { group: "support_group_id" },
  features: { journal: false, attachments: true, links: true },
  list: { columns: ["number", "name", "account_id", "product_id", "serial_no", "status"], order: "account_id,name" },
};

const customerContract: TableDef = {
  key: "customer_contract",
  table: "sm_customer_contracts",
  label: "قرارداد مشتری",
  plural: "قراردادهای مشتری",
  icon: "file-signature",
  module: "csm",
  area: "csm",
  description: "قرارداد پشتیبانی با مشتری: دوره، محصولات تحت پوشش، شرایط و سطح خدمت؛ استحقاق‌ها از آن ساخته می‌شوند",
  numbered: { prefix: "CTR", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "status", label: "وضعیت", type: "choice", choices: CONTRACT_STATES, default: "draft", list: true, filter: true, span: 8 },
    { name: "starts_on", label: "از", type: "date", required: true, list: true, sort: true, span: 8 },
    { name: "ends_on", label: "تا", type: "date", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "products", label: "محصولات تحت پوشش", type: "refs", ref: "customer_product", span: 16 },
    { name: "value", label: "مبلغ قرارداد", type: "money", min: 0, group: "financial", span: 8 },
    { name: "owner_id", label: "مسئول قرارداد", type: "user", default: "$me", filter: true, span: 8 },
    { name: "document_url", label: "سند قرارداد", type: "url", ltr: true, span: 16 },
    { name: "terms", label: "شرایط و سطح خدمت", type: "markdown", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { own: ["owner_id"], requester: [], group: "support_group_id" },
  features: { journal: true, attachments: true, links: true },
  form: { related: [{ table: "entitlement", field: "contract_id", label: "استحقاق‌ها", columns: ["number", "name", "support_level", "state", "ends_on"] }] },
  list: { columns: ["number", "name", "account_id", "status", "starts_on", "ends_on"], order: "-ends_on" },
};

export const ENTITLEMENT_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "suspended", label: "معلق", category: "waiting", color: "gold" },
    { value: "expired", label: "منقضی", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft", "suspended"], to: "active", label: "فعال‌سازی" },
    { from: ["active"], to: "suspended", label: "تعلیق" },
    { from: ["active", "suspended"], to: "expired", label: "پایان" },
    { from: ["expired"], to: "active", label: "تمدید" },
  ],
};

const entitlement: TableDef = {
  key: "entitlement",
  table: "sm_entitlements",
  label: "استحقاق",
  plural: "استحقاق‌ها",
  icon: "badge-percent",
  module: "csm",
  area: "csm",
  description: "آنچه مشتری حق دارد: مجراها، ساعات پوشش، سطح پشتیبانی، اهداف پاسخ و حل و سهمیه (پرونده یا ساعت) که در دفتر مصرف کم می‌شود",
  numbered: { prefix: "ENT", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "customer_contract", filter: true, index: true, span: 8 },
    { name: "product_id", label: "محصول", type: "ref", ref: "customer_product", filter: true, index: true, span: 8 },
    { name: "ibi_id", label: "قلم پایگاه نصب", type: "ref", ref: "install_base_item", filter: true, span: 8 },
    { name: "contact_id", label: "فقط برای مخاطب", type: "ref", ref: "customer_contact", span: 8 },
    { name: "support_level", label: "سطح پشتیبانی", type: "choice", choices: SUPPORT_LEVELS, default: "standard", list: true, filter: true, span: 8 },
    { name: "channels", label: "مجراها", type: "multichoice", choices: ENTITLEMENT_CHANNELS, default: ["portal", "email", "phone"], span: 8 },
    { name: "coverage_calendar_id", label: "ساعات پوشش", type: "ref", ref: "calendar", span: 8, help: "خالی: شبانه‌روزی" },
    { name: "response_hours", label: "هدف نخستین پاسخ (ساعت)", type: "int", min: 1, span: 8, help: "هدف قراردادی برای نمایش؛ ساعت‌شمار پرونده از توافق سطح پشتیبانی است" },
    { name: "resolution_hours", label: "هدف حل (ساعت)", type: "int", min: 1, span: 8, help: "هدف قراردادی برای نمایش؛ ساعت‌شمار پرونده از توافق سطح پشتیبانی است" },
    { name: "starts_on", label: "از", type: "date", required: true, sort: true, span: 8 },
    { name: "ends_on", label: "تا", type: "date", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "unit_type", label: "سهمیه", type: "choice", choices: UNIT_TYPES, default: "none", span: 8 },
    { name: "units_total", label: "سهمیهٔ کل", type: "decimal", min: 0, span: 8 },
    { name: "units_used", label: "مصرف‌شده", type: "decimal", readonly: true, default: "0", span: 8 },
    { name: "units_remaining", label: "باقی‌مانده", type: "decimal", readonly: true, list: true, sort: true, span: 8 },
    { name: "warn_percent", label: "هشدار در مصرف (٪)", type: "int", min: 1, max: 100, default: 80, span: 8 },
    { name: "block_when_exhausted", label: "پس از اتمام سهمیه پرونده نپذیرد", type: "bool", default: false, span: 8 },
    { name: "service_credit_pct", label: "اعتبار جبرانی نقض توافق (٪)", type: "percent", min: 0, max: 100, span: 8 },
    { name: "credits_earned", label: "اعتبار جبرانی کسب‌شده (٪)", type: "percent", readonly: true, default: "0", span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  states: ENTITLEMENT_STATES,
  scope: { group: "support_group_id" },
  features: { journal: true, attachments: false, links: false },
  form: { related: [{ table: "entitlement_ledger", field: "entitlement_id", label: "دفتر مصرف", columns: ["at", "delta", "balance_after", "reason", "case_id"] }] },
  list: { columns: ["number", "name", "account_id", "support_level", "state", "units_remaining", "ends_on"], order: "account_id,-ends_on" },
};

const entitlementLedger: TableDef = {
  key: "entitlement_ledger",
  table: "sm_entitlement_ledger",
  label: "ردیف دفتر مصرف",
  plural: "دفتر مصرف استحقاق",
  icon: "receipt",
  module: "csm",
  area: "csm",
  description: "هر کاهش یا افزایش سهمیهٔ استحقاق با پرونده و دلیل آن (فقط ماژول می‌نویسد)",
  display: "reason",
  fields: [
    { name: "entitlement_id", label: "استحقاق", type: "ref", ref: "entitlement", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "case_id", label: "پرونده", type: "ref", ref: "customer_case", list: true, filter: true, index: true, span: 12 },
    { name: "at", label: "زمان", type: "datetime", default: "$now", list: true, sort: true, span: 8 },
    { name: "delta", label: "تغییر", type: "decimal", required: true, list: true, span: 8 },
    { name: "balance_after", label: "مانده", type: "decimal", list: true, span: 8 },
    { name: "reason", label: "دلیل", type: "string", required: true, maxLength: 200, list: true, span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { group: "support_group_id" },
  features: { journal: false, attachments: false, history: false },
  list: { columns: ["at", "entitlement_id", "case_id", "delta", "balance_after", "reason"], order: "-at" },
};

export const CUSTOMER_CASE_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "open", label: "در حال بررسی", category: "active", color: "teal" },
    { value: "awaiting_customer", label: "منتظر مشتری", category: "waiting", color: "gold" },
    { value: "awaiting_internal", label: "منتظر تیم داخلی", category: "waiting", color: "purple" },
    { value: "awaiting_vendor", label: "منتظر تأمین‌کننده", category: "waiting", color: "orange" },
    { value: "resolved", label: "حل‌شده", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new", "awaiting_customer", "awaiting_internal", "awaiting_vendor"], to: "open", label: "بررسی" },
    { from: ["new", "open", "awaiting_internal", "awaiting_vendor"], to: "awaiting_customer", label: "پرسش از مشتری" },
    { from: ["new", "open"], to: "awaiting_internal", label: "ارجاع به تیم داخلی" },
    { from: ["new", "open"], to: "awaiting_vendor", label: "منتظر تأمین‌کننده" },
    { from: ["new", "open", "awaiting_customer", "awaiting_internal", "awaiting_vendor"], to: "resolved", label: "حل شد", requires: ["close_notes"] },
    { from: ["resolved"], to: "closed", label: "پذیرش راه‌حل" },
    { from: ["resolved"], to: "open", label: "رد راه‌حل" },
    { from: ["new", "open", "awaiting_customer"], to: "cancelled", label: "لغو" },
  ],
};

/** What the customer sees as the state of their case (CSM-011): friendly words, no internal waiting reasons. */
export const CUSTOMER_STATUS: Record<string, string> = {
  new: "ثبت شد",
  open: "در حال بررسی",
  awaiting_customer: "منتظر پاسخ شما",
  awaiting_internal: "در حال بررسی",
  awaiting_vendor: "در حال بررسی",
  resolved: "حل شد — منتظر تأیید شما",
  closed: "بسته شد",
  cancelled: "لغو شد",
};

const CS_MAIN = "اصلی";
const CS_CUSTOMER = "مشتری و استحقاق";
const CS_RESOLVE = "حل";

const customerCase: TableDef = {
  key: "customer_case",
  table: "sm_customer_cases",
  label: "پروندهٔ مشتری",
  plural: "پرونده‌های مشتری",
  icon: "headphones",
  module: "csm",
  area: "csm",
  description: "پرسش، اشکال، درخواست، پیشنهاد یا شکایت مشتری با حساب، مخاطب، محصول، قلم پایگاه نصب و استحقاقی که هنگام ثبت ثبت شد",
  extends: "task",
  numbered: { prefix: "CS", pad: 7 },
  display: "short_description",
  fields: [
    { name: "case_type", label: "نوع پرونده", type: "choice", choices: "customer_case.case_type", default: "question", list: true, filter: true, span: 8, section: CS_MAIN },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", list: true, filter: true, index: true, span: 8, section: CS_CUSTOMER },
    { name: "contact_id", label: "مخاطب", type: "ref", ref: "customer_contact", filter: true, index: true, span: 8, section: CS_CUSTOMER },
    { name: "product_id", label: "محصول", type: "ref", ref: "customer_product", list: true, filter: true, index: true, span: 8, section: CS_CUSTOMER },
    { name: "ibi_id", label: "قلم پایگاه نصب", type: "ref", ref: "install_base_item", filter: true, span: 8, section: CS_CUSTOMER },
    { name: "entitlement_id", label: "استحقاق", type: "ref", ref: "entitlement", readonly: true, filter: true, index: true, span: 8, section: CS_CUSTOMER },
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "customer_contract", readonly: true, filter: true, span: 8, section: CS_CUSTOMER },
    { name: "entitlement_status", label: "وضعیت استحقاق", type: "choice", choices: ENTITLEMENT_STATUS, readonly: true, filter: true, span: 8, section: CS_CUSTOMER },
    { name: "entitlement_snapshot", label: "استحقاق هنگام ثبت", type: "json", system: true, audit: false },
    { name: "support_level", label: "سطح پشتیبانی", type: "choice", choices: SUPPORT_LEVELS, system: true, filter: true, span: 8, section: CS_CUSTOMER, help: "از استحقاق هنگام ثبت؛ توافق‌های پاسخ و حل همین سطح بر پرونده می‌نشیند" },
    { name: "complaint", label: "شکایت است", type: "bool", default: false, filter: true, span: 8, section: CS_MAIN },
    { name: "complaint_severity", label: "شدت شکایت", type: "choice", choices: COMPLAINT_SEVERITY, filter: true, span: 8, section: CS_MAIN },
    { name: "is_major", label: "پروندهٔ عمده", type: "bool", default: false, filter: true, span: 8, section: CS_MAIN },
    { name: "major_case_id", label: "پروندهٔ عمدهٔ مادر", type: "ref", ref: "$self", filter: true, index: true, span: 8, section: CS_MAIN },
    { name: "proactive", label: "پیش‌دستانه", type: "bool", readonly: true, default: false, filter: true, span: 8, section: CS_MAIN },
    { name: "customer_status", label: "وضعیت از نگاه مشتری", type: "string", system: true, maxLength: 80, audit: false },
    { name: "sentiment", label: "احساس", type: "choice", choices: SENTIMENTS, readonly: true, filter: true, span: 8, section: CS_MAIN },
    { name: "escalated", label: "تشدیدشده", type: "bool", readonly: true, default: false, filter: true, span: 8, section: CS_MAIN },
    { name: "root_cause", label: "علت ریشه‌ای", type: "text", span: 24, section: CS_RESOLVE },
    { name: "resolution_accepted", label: "مشتری راه‌حل را پذیرفت", type: "bool", readonly: true, filter: true, span: 8, section: CS_RESOLVE },
    { name: "satisfaction", label: "رضایت مشتری", type: "rating", min: 1, max: 5, filter: true, span: 8, section: CS_RESOLVE },
    { name: "units_charged", label: "سهمیهٔ مصرف‌شده", type: "decimal", readonly: true, span: 8, section: CS_RESOLVE },
  ],
  states: CUSTOMER_CASE_STATES,
  scope: {
    own: ["caller_id", "requested_for", "opened_by", "assigned_to"],
    requester: ["requested_for", "caller_id", "opened_by"],
    watchers: "watch_list",
    group: "assignment_group_id",
    requesterWritable: ["description", "urgency", "satisfaction"],
    requesterTransitions: [
      { from: ["resolved"], to: "closed" },
      { from: ["resolved"], to: "open" },
      { from: ["new", "open", "awaiting_customer"], to: "cancelled" },
      { from: ["awaiting_customer"], to: "open" },
    ],
  },
  features: { sla: true, approvals: true, rag: true, kanban: "state" },
  ai: { title: "short_description", text: ["description", "close_notes", "root_cause"] },
  form: {
    sections: [CS_MAIN, CS_CUSTOMER, CS_RESOLVE],
    related: [
      { table: "customer_case", field: "major_case_id", label: "پرونده‌های وابسته", columns: ["number", "short_description", "account_id", "state"] },
      { table: "case_escalation", field: "case_id", label: "تشدیدها", columns: ["number", "short_description", "state", "owner_id"] },
      { table: "entitlement_ledger", field: "case_id", label: "مصرف سهمیه", columns: ["at", "delta", "reason"] },
    ],
  },
  list: { columns: ["number", "short_description", "account_id", "case_type", "state", "priority", "assigned_to", "sla_due"], order: "-updated_at" },
};

export const ESCALATION_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
    { value: "active", label: "در جریان", category: "active", color: "red" },
    { value: "closed", label: "بسته", category: "closed", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["requested"], to: "active", label: "پذیرش تشدید", roles: { area: "csm", level: "full" } },
    { from: ["requested"], to: "rejected", label: "رد", requires: ["resolution"], roles: { area: "csm", level: "full" } },
    { from: ["active"], to: "closed", label: "بستن", requires: ["resolution"] },
  ],
};

const caseEscalation: TableDef = {
  key: "case_escalation",
  table: "sm_case_escalations",
  label: "تشدید",
  plural: "تشدیدها",
  icon: "trending-up",
  module: "csm",
  area: "csm",
  description: "تشدید یک پرونده یا کل حساب با مسئول، برنامه، دورهٔ گزارش و حامی اجرایی (درخواست ← پذیرش ← مدیریت ← بستن)",
  numbered: { prefix: "ESC", pad: 6 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "reason", label: "دلیل", type: "choice", choices: ESCALATION_REASONS, default: "customer_request", list: true, filter: true, span: 8 },
    { name: "case_id", label: "پرونده", type: "ref", ref: "customer_case", filter: true, index: true, span: 8 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 8 },
    { name: "severity", label: "شدت", type: "choice", choices: COMPLAINT_SEVERITY, default: "medium", filter: true, span: 8 },
    { name: "owner_id", label: "مسئول تشدید", type: "user", default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "executive_sponsor_id", label: "حامی اجرایی", type: "user", filter: true, index: true, span: 8 },
    { name: "cadence", label: "دورهٔ گزارش", type: "choice", choices: CADENCES, default: "daily", span: 8 },
    { name: "next_update_at", label: "گزارش بعدی", type: "datetime", sort: true, filter: true, span: 8 },
    { name: "requested_by", label: "درخواست‌کننده", type: "user", default: "$me", readonly: true, span: 8 },
    { name: "plan", label: "برنامهٔ اقدام", type: "markdown", span: 24 },
    { name: "resolution", label: "نتیجه", type: "text", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  states: ESCALATION_STATES,
  scope: { own: ["owner_id", "executive_sponsor_id", "requested_by"], requester: [], group: "support_group_id" },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "short_description", "account_id", "severity", "state", "owner_id", "next_update_at"], order: "-updated_at" },
};

const accountPlan: TableDef = {
  key: "account_plan",
  table: "sm_account_plans",
  label: "برنامهٔ حساب",
  plural: "برنامه‌های حساب",
  icon: "target",
  module: "csm",
  area: "csm",
  description: "مدل رابطه و برنامهٔ هر حساب: هدف‌ها، اقدام‌ها، دورهٔ بازبینی و بازبینی بعدی",
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "period", label: "دوره", type: "string", maxLength: 40, list: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: [o("draft", "پیش‌نویس", 1, "blue"), o("active", "در جریان", 2, "green"), o("closed", "بسته", 3, "gray")], default: "draft", list: true, filter: true, span: 8 },
    { name: "review_cadence", label: "دورهٔ بازبینی", type: "choice", choices: CADENCES, default: "quarterly", span: 8 },
    { name: "next_review", label: "بازبینی بعدی", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, index: true, span: 8 },
    { name: "objectives", label: "هدف‌ها", type: "markdown", span: 24 },
    { name: "initiatives", label: "اقدام‌ها", type: "markdown", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { own: ["owner_id"], requester: [], group: "support_group_id" },
  features: { journal: true, attachments: true },
  list: { columns: ["name", "account_id", "period", "status", "next_review", "owner_id"], order: "next_review" },
};

const accountStakeholder: TableDef = {
  key: "account_stakeholder",
  table: "sm_account_stakeholders",
  label: "ذی‌نفع حساب",
  plural: "نقشهٔ ذی‌نفعان",
  icon: "users-round",
  module: "csm",
  area: "csm",
  description: "ذی‌نفعان هر حساب با نفوذ، علاقه، نگرش و مسئول ارتباط",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "contact_id", label: "مخاطب", type: "ref", ref: "customer_contact", span: 12 },
    { name: "role_title", label: "نقش", type: "string", maxLength: 120, span: 12 },
    { name: "influence", label: "نفوذ", type: "rating", min: 1, max: 5, list: true, span: 8 },
    { name: "interest", label: "علاقه", type: "rating", min: 1, max: 5, list: true, span: 8 },
    { name: "attitude", label: "نگرش", type: "choice", choices: ATTITUDES, default: "neutral", list: true, filter: true, span: 8 },
    { name: "owner_id", label: "مسئول ارتباط", type: "user", filter: true, span: 12 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { own: ["owner_id"], requester: [], group: "support_group_id" },
  features: { journal: false, attachments: false },
  list: { columns: ["name", "account_id", "influence", "interest", "attitude", "owner_id"], order: "account_id,name" },
};

export const REVIEW_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "held", label: "برگزارشده", category: "active", color: "teal" },
    { value: "actions_open", label: "اقدام‌های باز", category: "waiting", color: "gold" },
    { value: "closed", label: "بسته", category: "closed", color: "green" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "held", label: "برگزار شد" },
    { from: ["held"], to: "actions_open", label: "اقدام‌ها باز است" },
    { from: ["held", "actions_open"], to: "closed", label: "بستن" },
    { from: ["planned"], to: "cancelled", label: "لغو" },
  ],
};

const accountReview: TableDef = {
  key: "account_review",
  table: "sm_account_reviews",
  label: "بازبینی خدمت با مشتری",
  plural: "بازبینی‌های خدمت (فصلی)",
  icon: "presentation",
  module: "csm",
  area: "csm",
  description: "جلسهٔ بازبینی دوره‌ای با مشتری با بستهٔ خودکار (تحقق توافق‌ها، رضایت، پرونده‌ها، تشدیدها، شکایت‌ها) و روایت و اقدام‌ها",
  numbered: { prefix: "QBR", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "period_from", label: "از", type: "date", required: true, span: 8 },
    { name: "period_to", label: "تا", type: "date", required: true, span: 8 },
    { name: "held_at", label: "زمان جلسه", type: "datetime", list: true, sort: true, span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, index: true, span: 8 },
    { name: "attendees", label: "حاضران", type: "users", span: 16 },
    { name: "pack", label: "بستهٔ بازبینی", type: "json", readonly: true, audit: false, span: 24 },
    { name: "pack_at", label: "زمان ساخت بسته", type: "datetime", readonly: true, audit: false, span: 8 },
    { name: "narrative", label: "روایت", type: "markdown", span: 24 },
    { name: "actions", label: "اقدام‌ها", type: "markdown", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  states: REVIEW_STATES,
  scope: { own: ["owner_id"], requester: [], group: "support_group_id" },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "title", "account_id", "state", "held_at", "owner_id"], order: "-period_to" },
};

const accountHealth: TableDef = {
  key: "account_health",
  table: "sm_account_health",
  label: "سلامت روزانهٔ حساب",
  plural: "سلامت روزانهٔ حساب‌ها",
  icon: "heart-pulse",
  module: "csm",
  area: "csm",
  description: "عکس روزانهٔ سلامت رابطه: امتیاز، عامل‌ها، رضایت، تحقق توافق، تشدیدها و شکایت‌ها (فقط ماژول می‌نویسد)",
  display: "day",
  fields: [
    { name: "account_id", label: "حساب", type: "ref", ref: "customer_account", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "day", label: "روز", type: "date", required: true, list: true, sort: true, span: 12 },
    { name: "score", label: "امتیاز", type: "int", list: true, span: 8 },
    { name: "status", label: "سلامت", type: "choice", choices: HEALTH_STATES, list: true, span: 8 },
    { name: "csat", label: "رضایت (از ۵)", type: "decimal", span: 8 },
    { name: "sla_attainment", label: "تحقق توافق (٪)", type: "percent", span: 8 },
    { name: "open_cases", label: "پرونده‌های باز", type: "int", span: 8 },
    { name: "escalations", label: "تشدیدها", type: "int", span: 8 },
    { name: "complaints", label: "شکایت‌ها", type: "int", span: 8 },
    { name: "factors", label: "عامل‌ها", type: "json", span: 24 },
    { ...ACCOUNT_CHILD },
  ],
  scope: { group: "support_group_id" },
  unique: [["account_id", "day"]],
  features: { journal: false, attachments: false, history: false },
  list: { columns: ["day", "account_id", "score", "status", "csat", "sla_attainment"], order: "-day" },
};

const customerExperience: TableDef = {
  key: "customer_experience",
  table: "sm_customer_experiences",
  label: "تجربهٔ مشتری (برند)",
  plural: "تجربه‌های مشتری",
  icon: "palette",
  module: "csm",
  area: "csm",
  description: "بستهٔ برند، مجراها، مقاله‌ها، فرم‌ها و گروه پشتیبانی برای گروهی از مشتریان یا محصولات — درگاه مشتریان آن را نمایش می‌دهد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "brand_name", label: "نام برند", type: "string", maxLength: 120, span: 12 },
    { name: "color", label: "رنگ", type: "color", span: 8 },
    { name: "logo_url", label: "نشانی نشان", type: "url", ltr: true, span: 16 },
    // which customers a brand serves is the desk's (customers read the brand, never the other accounts' ids)
    { name: "accounts", label: "حساب‌ها", type: "refs", ref: "customer_account", group: "internal", span: 12, help: "خالی: همهٔ حساب‌ها" },
    { name: "products", label: "محصولات", type: "refs", ref: "customer_product", span: 12 },
    { name: "channels", label: "مجراها", type: "multichoice", choices: ENTITLEMENT_CHANNELS, default: ["portal", "email"], span: 12 },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", span: 12 },
    { name: "kb_base_id", label: "پایگاه دانش", type: "ref", ref: "kb_base", span: 12 },
    { name: "default_case_type", label: "نوع پروندهٔ پیش‌فرض", type: "choice", choices: "customer_case.case_type", default: "question", span: 12 },
    { name: "greeting", label: "خوش‌آمد", type: "text", span: 24 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
  ],
  scope: { group: "support_group_id", public: true },
  list: { columns: ["name", "brand_name", "support_group_id", "active"], order: "name" },
};

export const NOTICE_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "approved", label: "تأییدشده", category: "active", color: "teal" },
    { value: "sent", label: "فرستاده‌شده", category: "closed", color: "green" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "approved", label: "تأیید متن", roles: { area: "csm", level: "full" } },
    { from: ["approved"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["approved"], to: "sent", label: "ارسال", guard: "notice_send" },
    { from: ["draft", "approved"], to: "cancelled", label: "لغو" },
  ],
};

const customerNotice: TableDef = {
  key: "customer_notice",
  table: "sm_customer_notices",
  label: "اطلاع‌رسانی به مشتریان",
  plural: "اطلاع‌رسانی‌های مشتریان",
  icon: "megaphone",
  module: "csm",
  area: "csm",
  description: "پیام تأییدشده به مخاطبان حساب‌های متأثر از یک رخداد یا نقض داده، با گواه ارسال برای هر گیرنده",
  numbered: { prefix: "NTC", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "موضوع", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "regulation", label: "مبنا", type: "choice", choices: REGULATIONS, default: "none", list: true, filter: true, span: 8 },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", filter: true, span: 8 },
    { name: "accounts", label: "حساب‌های متأثر", type: "refs", ref: "customer_account", required: true, group: "internal", span: 16 },
    { name: "body", label: "متن پیام", type: "markdown", required: true, span: 24 },
    { name: "channels", label: "مجراها", type: "multichoice", choices: [o("in_app", "درون‌برنامه", 1), o("email", "رایانامه", 2), o("sms", "پیامک", 3)], default: ["in_app", "email"], span: 12 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 12 },
    // who else got the notice (other customers' people) is the desk's; a recipient reads the notice itself
    { name: "recipients", label: "گیرندگان", type: "users", system: true, audit: false, group: "internal" },
    { name: "recipient_count", label: "تعداد گیرندگان", type: "int", readonly: true, default: 0, span: 8 },
    { name: "sent_at", label: "زمان ارسال", type: "datetime", readonly: true, sort: true, span: 8 },
    { name: "evidence", label: "گواه ارسال", type: "json", readonly: true, audit: false, span: 24 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, span: 8 },
  ],
  states: NOTICE_STATES,
  // the people it was sent to read it (their inbox links to it); the owner and the csm managers work it
  scope: { own: ["owner_id"], requester: [], readers: ["recipients"] },
  features: { journal: true, attachments: true, links: true, approvals: true },
  list: { columns: ["number", "title", "regulation", "state", "recipient_count", "sent_at"], order: "-updated_at" },
};

export interface CsmConfig {
  auto_close_days: number;
  proactive_on_major: boolean;
  health_green: number;
  health_amber: number;
}

export const CSM_CONFIG_DEFAULTS: CsmConfig = { auto_close_days: 3, proactive_on_major: true, health_green: 75, health_amber: 50 };

const csmConfig: TableDef = {
  key: "csm_config",
  table: "sm_csm_config",
  label: "تنظیمات خدمات مشتریان",
  plural: "تنظیمات خدمات مشتریان",
  icon: "settings",
  module: "csm",
  area: "csm",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 80, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, maxLength: 40, unique: true, ltr: true, span: 12 },
    { name: "auto_close_days", label: "بستن خودکار پرونده‌های حل‌شده پس از (روز)", type: "int", min: 1, max: 60, default: 3, span: 12 },
    { name: "proactive_on_major", label: "پروندهٔ پیش‌دستانه هنگام رخداد عمده", type: "bool", default: true, span: 12 },
    { name: "health_green", label: "مرز سلامت سبز", type: "int", min: 1, max: 100, default: 75, span: 12 },
    { name: "health_amber", label: "مرز سلامت زرد", type: "int", min: 1, max: 100, default: 50, span: 12 },
    { name: "default_group_id", label: "گروه پیش‌فرض", type: "group", span: 12 },
    { name: "root_unit_id", label: "واحد ریشهٔ مشتریان", type: "ref", ref: "org_unit", span: 12 },
    { name: "seeded", label: "نسخهٔ دادهٔ آغازین", type: "int", system: true, default: 0, audit: false },
  ],
  scope: { public: true },
  list: { columns: ["name"], order: "name" },
};

export const CSM_TABLES: TableDef[] = [
  customerAccount,
  customerContact,
  customerProduct,
  installBaseItem,
  customerContract,
  entitlement,
  entitlementLedger,
  customerCase,
  caseEscalation,
  accountPlan,
  accountStakeholder,
  accountReview,
  accountHealth,
  customerExperience,
  customerNotice,
  csmConfig,
];

/** Tables whose rows copy their account's support group. */
export const ACCOUNT_CHILD_TABLES = ["customer_contact", "install_base_item", "customer_contract", "entitlement", "entitlement_ledger", "case_escalation", "account_plan", "account_stakeholder", "account_review", "account_health"];
