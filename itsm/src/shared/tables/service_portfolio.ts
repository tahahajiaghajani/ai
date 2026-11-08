// Tables of the service portfolio (docs/modules/service_portfolio_FA.md, catalogue docs/catalog/g6_config_assets.md
// «Module: service_portfolio»): the portfolio taxonomy, services (each one the portfolio record of a CI of class
// business_service / technical_service — the CI carries the graph, the service the portfolio fields), offerings (also CIs,
// so impact reaches them), commitments that generate SLA definitions, deployed instances, subscriptions, customer
// agreements, daily service scores, proposals, design and transition packages, business relationships and reviews,
// application assessments, technology standards, business capabilities and the module's settings row.
// Behaviour lives in src/server/modules/service_portfolio; the record UI renders everything from these definitions
// (src/ui/modules/service_portfolio).
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { PRIORITIES } from "../model/task";
import { CI_CRITICALITY, CI_ENVIRONMENTS } from "../cmdb/classes";
import { CI_TIERS } from "./cmdb";

const yes = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

export const SERVICE_TYPES: Option[] = [
  yes("business", "خدمت کسب‌وکار (مشتری‌محور)", 1, "indigo"),
  yes("technical", "خدمت فنی (پشتیبان)", 2, "blue"),
  yes("enabling", "خدمت توانمندساز", 3, "teal"),
];

/** The CI class a service type is recorded as in the CMDB. */
export const SERVICE_CI_CLASS: Record<string, string> = { business: "business_service", technical: "technical_service", enabling: "technical_service" };

/** Live service status (status page, incidents, outages). */
export const SERVICE_STATUSES: Option[] = [
  yes("operational", "عملیاتی", 1, "green"),
  yes("degraded", "کاهش کارایی", 2, "gold"),
  yes("partial_outage", "قطعی بخشی", 3, "orange"),
  yes("major_outage", "قطعی کامل", 4, "red"),
  yes("maintenance", "در حال نگهداری", 5, "blue"),
];

const STATUS_OVERRIDES: Option[] = [yes("auto", "خودکار (از رخدادها و پیکربندی‌ها)", 0), ...SERVICE_STATUSES];

const CHANNELS: Option[] = [
  yes("portal", "درگاه", 1),
  yes("phone", "تلفن", 2),
  yes("email", "ایمیل", 3),
  yes("chat", "گفتگوی برخط", 4),
  yes("messenger", "پیام‌رسان (بله، ایتا، تلگرام)", 5),
  yes("walk_in", "مراجعهٔ حضوری", 6),
];

const DIGITAL_SPECTRUM: Option[] = [
  yes("analogue", "غیردیجیتال", 1),
  yes("supported", "با پشتیبانی دیجیتال", 2),
  yes("enabled", "توانمندشده با دیجیتال", 3),
  yes("digital", "کاملاً دیجیتال", 4),
];

const SECURITY_CLASSES: Option[] = [yes("public", "عمومی", 1, "green"), yes("internal", "داخلی", 2, "blue"), yes("confidential", "محرمانه", 3, "orange"), yes("secret", "سری", 4, "red")];

const CONTINUITY_TIERS: Option[] = [yes("critical", "حیاتی", 1, "red"), yes("important", "مهم", 2, "orange"), yes("standard", "عادی", 3, "gray")];

export const OFFERING_LEVELS: Option[] = [
  yes("gold", "طلایی", 1, "gold"),
  yes("silver", "نقره‌ای", 2, "gray"),
  yes("bronze", "برنزی", 3, "orange"),
  yes("standard", "استاندارد", 4, "blue"),
  yes("custom", "ویژه", 5, "purple"),
];

export const COMMITMENT_KINDS: Option[] = [
  yes("availability", "دسترس‌پذیری", 1, "green"),
  yes("response", "زمان پاسخ", 2, "blue"),
  yes("resolution", "زمان حل", 3, "indigo"),
  yes("support_hours", "ساعات پشتیبانی", 4, "gray"),
];

// ---------------------------------------------------------------------------------------------------------------
// Portfolio taxonomy (SPF-003)

const portfolioNode: TableDef = {
  key: "portfolio_node",
  table: "sm_portfolio_nodes",
  label: "شاخهٔ سبد خدمات",
  plural: "شاخه‌های سبد خدمات",
  icon: "folder-tree",
  module: "service_portfolio",
  area: "service",
  description: "درخت سبد → دسته‌ها (تا پنج سطح) → خدمت‌ها، با مالک هر شاخه",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "parent_id", label: "شاخهٔ بالاتر", type: "ref", ref: "$self", list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: [yes("portfolio", "سبد", 1), yes("category", "دسته", 2)], default: "category", list: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", filter: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "path", label: "مسیر", type: "string", system: true, audit: false, hidden: true, index: true },
    { name: "depth", label: "سطح", type: "int", system: true, audit: false, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "parent_id", "kind", "owner_id", "sort_order"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Services (SPF-001/002/007/008/009)

export const SERVICE_STATES: StateModel = {
  field: "state",
  initial: "proposed",
  states: [
    { value: "proposed", label: "پیشنهادی", category: "new", color: "blue" },
    { value: "approved", label: "تأییدشده", category: "active", color: "indigo" },
    { value: "design", label: "در طراحی", category: "active", color: "purple" },
    { value: "transition", label: "در گذار", category: "active", color: "teal" },
    { value: "live", label: "زنده", category: "active", color: "green" },
    { value: "deprecated", label: "رو به کنارگذاری", category: "active", color: "gold" },
    { value: "retired", label: "کنارگذاشته", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["proposed"], to: "approved", label: "تأیید", roles: { area: "service", level: "full" } },
    { from: ["proposed"], to: "rejected", label: "رد", roles: { area: "service", level: "full" } },
    { from: ["approved"], to: "design", label: "شروع طراحی" },
    { from: ["approved", "design"], to: "transition", label: "شروع گذار" },
    { from: ["approved", "design", "transition", "deprecated"], to: "live", label: "زنده", guard: "service_can_go_live" },
    { from: ["live"], to: "deprecated", label: "کنارگذاری تدریجی", requires: ["retire_reason"] },
    { from: ["live", "deprecated"], to: "retired", label: "کنارگذاشتن", requires: ["retire_reason"], guard: "service_can_retire" },
  ],
  locked: ["canceled"],
};

const S_MAIN = "اصلی";
const S_ROLES = "نقش‌ها";
const S_LEVEL = "سطح خدمت و تداوم";
const S_STATUS = "وضعیت";
const S_MORE = "اطلاعات بیشتر";

const service: TableDef = {
  key: "service",
  table: "sm_services",
  label: "خدمت",
  plural: "خدمت‌ها",
  icon: "concierge-bell",
  module: "service_portfolio",
  area: "service",
  description: "خدمتی که فناوری اطلاعات به مشتریان یا خدمت‌های دیگر ارائه می‌کند: ارزش، مالک، رده، گزینه‌ها، تعهدها و نقشهٔ وابستگی",
  numbered: { prefix: "SVC", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12, section: S_MAIN },
    { name: "service_type", label: "نوع", type: "choice", choices: SERVICE_TYPES, default: "business", required: true, list: true, filter: true, span: 12, section: S_MAIN },
    { name: "portfolio_node_id", label: "شاخهٔ سبد", type: "ref", ref: "portfolio_node", list: true, filter: true, index: true, span: 12, section: S_MAIN },
    { name: "ci_id", label: "پیکربندی خدمت", type: "ref", ref: "ci", readonly: true, filter: true, index: true, span: 12, section: S_MAIN },
    { name: "description", label: "شرح به زبان مشتری", type: "markdown", span: 24, section: S_MAIN, ai: { index: true } },
    { name: "value_proposition", label: "ارزش پیشنهادی", type: "markdown", span: 24, section: S_MAIN, ai: { index: true } },
    { name: "outcomes", label: "نتایج مورد انتظار", type: "markdown", span: 24, section: S_MAIN, ai: { index: true } },
    { name: "tags", label: "برچسب‌ها", type: "tags", search: true, filter: true, span: 12, section: S_MAIN },
    { name: "service_key", label: "شناسهٔ مهندسی", type: "string", maxLength: 80, ltr: true, unique: true, filter: true, span: 12, section: S_MAIN, help: "برای گزارش استقرار از خط لوله‌ها" },

    { name: "owner_id", label: "مالک خدمت", type: "user", list: true, filter: true, span: 8, section: S_ROLES },
    { name: "owner_group_id", label: "تیم مالک", type: "group", filter: true, span: 8, section: S_ROLES },
    { name: "product_owner_id", label: "مالک محصول", type: "user", filter: true, span: 8, section: S_ROLES },
    { name: "relationship_manager_id", label: "مدیر ارتباط با کسب‌وکار", type: "user", filter: true, span: 8, section: S_ROLES },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", filter: true, span: 8, section: S_ROLES },
    { name: "change_approval_group_id", label: "تأییدکنندگان تغییر", type: "group", span: 8, section: S_ROLES },
    { name: "stakeholder_groups", label: "گروه‌های ذی‌نفع", type: "refs", ref: "group", span: 12, section: S_ROLES, help: "مخاطب اطلاعیه‌های وضعیت و تغییرهای برنامه‌ریزی‌شده" },
    { name: "provider_unit_id", label: "واحد ارائه‌دهنده", type: "ref", ref: "org_unit", filter: true, span: 12, section: S_ROLES },
    { name: "consumer_units", label: "واحدهای مصرف‌کننده", type: "refs", ref: "org_unit", span: 24, section: S_ROLES },

    { name: "tier", label: "رده", type: "choice", choices: CI_TIERS, list: true, filter: true, sort: true, span: 8, section: S_LEVEL },
    { name: "criticality", label: "اهمیت", type: "choice", choices: CI_CRITICALITY, filter: true, span: 8, section: S_LEVEL },
    { name: "availability_target", label: "هدف دسترس‌پذیری", type: "percent", span: 8, section: S_LEVEL },
    { name: "calendar_id", label: "ساعات خدمت", type: "ref", ref: "calendar", span: 8, section: S_LEVEL },
    { name: "channels", label: "مجراهای پشتیبانی", type: "multichoice", choices: CHANNELS, span: 16, section: S_LEVEL },
    { name: "continuity_tier", label: "ردهٔ تداوم", type: "choice", choices: CONTINUITY_TIERS, filter: true, span: 8, section: S_LEVEL },
    { name: "rto", label: "زمان هدف بازیابی (RTO)", type: "duration", span: 8, section: S_LEVEL },
    { name: "rpo", label: "نقطهٔ هدف بازیابی (RPO)", type: "duration", span: 8, section: S_LEVEL },
    { name: "security_classification", label: "طبقهٔ امنیتی", type: "choice", choices: SECURITY_CLASSES, filter: true, span: 8, section: S_LEVEL },
    { name: "digital_spectrum", label: "طیف دیجیتال", type: "choice", choices: DIGITAL_SPECTRUM, span: 8, section: S_LEVEL },

    { name: "status", label: "وضعیت جاری", type: "choice", choices: SERVICE_STATUSES, default: "operational", readonly: true, list: true, filter: true, span: 8, section: S_STATUS },
    { name: "status_override", label: "تعیین وضعیت", type: "choice", choices: STATUS_OVERRIDES, default: "auto", span: 8, section: S_STATUS },
    { name: "status_since", label: "از", type: "datetime", readonly: true, sort: true, span: 8, section: S_STATUS },
    { name: "status_reason", label: "علت وضعیت", type: "string", maxLength: 200, readonly: true, audit: false, span: 24, section: S_STATUS },
    { name: "status_note", label: "پیام وضعیت", type: "text", span: 24, section: S_STATUS, help: "روی صفحهٔ وضعیت دیده می‌شود" },
    { name: "on_status_page", label: "در صفحهٔ وضعیت", type: "bool", default: false, filter: true, list: true, span: 8, section: S_STATUS },

    { name: "documentation_url", label: "مستندات", type: "url", ltr: true, span: 12, section: S_MORE },
    { name: "name_en", label: "نام انگلیسی", type: "string", maxLength: 160, ltr: true, span: 12, section: S_MORE },
    { name: "description_en", label: "شرح انگلیسی", type: "markdown", span: 24, section: S_MORE },
    { name: "annual_cost", label: "هزینهٔ سالانه", type: "money", group: "financial", span: 8, section: S_MORE },
    { name: "cost_model", label: "مدل هزینه", type: "text", group: "financial", span: 16, section: S_MORE },
    { name: "last_reviewed_at", label: "آخرین بازبینی", type: "date", filter: true, sort: true, span: 8, section: S_MORE },
    { name: "review_months", label: "بازبینی هر چند ماه", type: "int", min: 0, max: 60, default: 12, span: 8, section: S_MORE },
    { name: "review_warned_for", label: "یادآوری بازبینی برای", type: "date", readonly: true, hidden: true, audit: false },
    { name: "retire_reason", label: "دلیل کنارگذاری", type: "text", span: 24, section: S_MORE },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", system: true, span: 8, section: S_MORE },
    { name: "live_at", label: "زمان زنده شدن", type: "datetime", system: true, sort: true, span: 8, section: S_MORE },
    { name: "retired_at", label: "زمان کنارگذاری", type: "datetime", system: true, span: 8, section: S_MORE },
    { name: "score", label: "امتیاز عملکرد", type: "int", readonly: true, audit: false, list: true, sort: true, span: 8, section: S_STATUS },
  ],
  states: SERVICE_STATES,
  scope: { own: ["owner_id", "product_owner_id", "relationship_manager_id"], group: "owner_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true, kanban: "state" },
  form: {
    sections: [S_MAIN, S_ROLES, S_LEVEL, S_STATUS, S_MORE],
    related: [
      { table: "service_offering", field: "service_id", label: "گزینه‌ها", columns: ["number", "name", "level", "state", "support_group_id"] },
      { table: "service_instance", field: "service_id", label: "نمونه‌های استقرار", columns: ["name", "environment", "region", "active"] },
      { table: "incident", field: "service_id", label: "رخدادها", columns: ["number", "short_description", "state", "priority"] },
      { table: "service_subscription", field: "service_id", label: "مشترکان", columns: ["label", "subscriber_kind", "valid_to"] },
    ],
  },
  list: { columns: ["number", "name", "service_type", "state", "tier", "owner_id", "status", "score"], order: "name" },
  ai: { title: "name", text: ["description", "value_proposition", "outcomes"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Offerings and commitments (SPF-004/005)

const OFFERING_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "deprecated", label: "رو به کنارگذاری", category: "active", color: "gold" },
    { value: "retired", label: "کنارگذاشته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft", "deprecated"], to: "active", label: "فعال", guard: "offering_can_activate" },
    { from: ["active"], to: "deprecated", label: "کنارگذاری تدریجی" },
    { from: ["draft", "active", "deprecated"], to: "retired", label: "کنارگذاشتن" },
  ],
  locked: ["closed", "canceled"],
};

const O_MAIN = "اصلی";
const O_ENTITLE = "چه کسانی می‌توانند استفاده کنند";
const O_SPEC = "مشخصات";

const offering: TableDef = {
  key: "service_offering",
  table: "sm_service_offerings",
  label: "گزینهٔ خدمت",
  plural: "گزینه‌های خدمت",
  icon: "tag",
  module: "service_portfolio",
  area: "service",
  description: "نسخهٔ قابل‌سفارش یک خدمت برای یک سطح، منطقه یا گروه مشتری با تعهدها، ساعات و گروه پشتیبانی خود",
  numbered: { prefix: "OFR", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12, section: O_MAIN },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, index: true, span: 12, section: O_MAIN },
    { name: "level", label: "سطح", type: "choice", choices: OFFERING_LEVELS, default: "standard", list: true, filter: true, span: 8, section: O_MAIN },
    { name: "region", label: "منطقه", type: "string", maxLength: 80, filter: true, span: 8, section: O_MAIN },
    { name: "ci_id", label: "پیکربندی گزینه", type: "ref", ref: "ci", readonly: true, index: true, span: 8, section: O_MAIN },
    { name: "description", label: "شرح", type: "markdown", span: 24, section: O_MAIN, ai: { index: true } },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", list: true, filter: true, span: 8, section: O_MAIN },
    { name: "approval_group_id", label: "گروه تأیید درخواست", type: "group", span: 8, section: O_MAIN },
    { name: "calendar_id", label: "ساعات پشتیبانی", type: "ref", ref: "calendar", span: 8, section: O_MAIN },
    { name: "availability_target", label: "هدف دسترس‌پذیری", type: "percent", span: 8, section: O_SPEC },
    { name: "price", label: "بها", type: "money", group: "financial", span: 8, section: O_SPEC },
    { name: "price_unit", label: "واحد بها", type: "choice", choices: [yes("month", "ماهانه", 1), yes("user_month", "هر کاربر در ماه", 2), yes("once", "یک‌باره", 3), yes("unit", "هر واحد", 4)], group: "financial", span: 8, section: O_SPEC },
    { name: "utility", label: "سودمندی (چه می‌دهد)", type: "markdown", span: 24, section: O_SPEC },
    { name: "warranty", label: "تضمین (چگونه می‌دهد)", type: "markdown", span: 24, section: O_SPEC },
    { name: "entitled_everyone", label: "همهٔ کارکنان", type: "bool", default: true, span: 24, section: O_ENTITLE },
    { name: "entitled_units", label: "واحدهای سازمانی", type: "refs", ref: "org_unit", span: 12, section: O_ENTITLE },
    { name: "entitled_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12, section: O_ENTITLE },
    { name: "entitled_locations", label: "مکان‌ها", type: "refs", ref: "location", span: 12, section: O_ENTITLE },
    { name: "owner_id", label: "مالک خدمت", type: "user", system: true, hidden: true, audit: false },
  ],
  states: OFFERING_STATES,
  scope: { own: ["owner_id"], group: "support_group_id" },
  form: {
    sections: [O_MAIN, O_SPEC, O_ENTITLE],
    related: [
      { table: "service_commitment", field: "offering_id", label: "تعهدها", columns: ["label", "kind", "target", "priority", "active"] },
      { table: "service_subscription", field: "offering_id", label: "مشترکان", columns: ["label", "subscriber_kind", "valid_to"] },
    ],
  },
  list: { columns: ["number", "name", "service_id", "level", "state", "support_group_id"], order: "name" },
  ai: { title: "name", text: ["description", "utility", "warranty"] },
};

const commitment: TableDef = {
  key: "service_commitment",
  table: "sm_service_commitments",
  label: "تعهد خدمت",
  plural: "تعهدهای خدمت",
  icon: "handshake",
  module: "service_portfolio",
  area: "service",
  description: "تعهد قابل‌اندازه‌گیری یک گزینه — دسترس‌پذیری، زمان پاسخ و حل برای هر اولویت، ساعات پشتیبانی — که تعریف توافق سطح خدمت را می‌سازد",
  display: "label",
  fields: [
    { name: "offering_id", label: "گزینهٔ خدمت", type: "ref", ref: "service_offering", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: COMMITMENT_KINDS, required: true, list: true, filter: true, span: 12 },
    { name: "target", label: "هدف", type: "decimal", required: true, list: true, span: 8, help: "دسترس‌پذیری: درصد؛ پاسخ و حل: ساعت؛ ساعات پشتیبانی: ساعت در هفته" },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, list: true, span: 8, help: "برای زمان پاسخ و حل" },
    { name: "calendar_id", label: "تقویم", type: "ref", ref: "calendar", span: 8 },
    { name: "valid_from", label: "اعتبار از", type: "date", span: 8 },
    { name: "valid_to", label: "اعتبار تا", type: "date", span: 8 },
    { name: "generate_sla", label: "تعریف توافق ساخته شود", type: "bool", default: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, list: true, span: 8 },
    { name: "revision", label: "ویرایش", type: "int", system: true, default: 1, span: 8 },
    { name: "sla_definition_id", label: "تعریف توافق", type: "ref", ref: "sla_definition", readonly: true, span: 8 },
    { name: "label", label: "تعهد", type: "string", system: true, maxLength: 300, search: true, audit: false, span: 24 },
    { name: "owner_id", label: "مالک خدمت", type: "user", system: true, hidden: true, audit: false },
  ],
  scope: { own: ["owner_id"] },
  list: { columns: ["label", "offering_id", "kind", "target", "priority", "active"], order: "offering_id,kind" },
};

// ---------------------------------------------------------------------------------------------------------------
// Instances, subscriptions, agreements (SPF-006/013/014)

const instance: TableDef = {
  key: "service_instance",
  table: "sm_service_instances",
  label: "نمونهٔ استقرار خدمت",
  plural: "نمونه‌های استقرار خدمت",
  icon: "server-cog",
  module: "service_portfolio",
  area: "service",
  description: "استقرار یک خدمت در یک محیط و منطقه (مثلاً «ایمیل — تولید — مرکز دادهٔ تهران») با پیکربندی‌ها و تیم پشتیبانی خود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "environment", label: "محیط", type: "choice", choices: CI_ENVIRONMENTS, default: "production", list: true, filter: true, span: 8 },
    { name: "region", label: "منطقه یا مرکز داده", type: "string", maxLength: 80, list: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "ci_id", label: "پیکربندی (خدمت نرم‌افزاری)", type: "ref", ref: "ci", filter: true, span: 12 },
    { name: "ci_group_id", label: "گروه پیکربندی", type: "ref", ref: "ci_group", span: 12 },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", filter: true, span: 12 },
    { name: "owner_id", label: "مالک خدمت", type: "user", system: true, hidden: true, audit: false },
  ],
  scope: { own: ["owner_id"], group: "support_group_id" },
  list: { columns: ["name", "service_id", "environment", "region", "support_group_id", "active"], order: "name" },
};

export const SUBSCRIBER_KINDS: Option[] = [yes("user", "فرد", 1), yes("group", "گروه", 2), yes("unit", "واحد سازمانی", 3), yes("location", "مکان", 4)];

const subscription: TableDef = {
  key: "service_subscription",
  table: "sm_service_subscriptions",
  label: "اشتراک خدمت",
  plural: "اشتراک‌های خدمت",
  icon: "bell-ring",
  module: "service_portfolio",
  // read with the catalogue: requesters read their own subscriptions (row rule), service readers all of a service's
  area: "catalog",
  description: "فرد، گروه یا واحدی که از یک خدمت یا گزینه استفاده می‌کند و خبر وضعیت، قطعی و تغییرهای برنامه‌ریزی‌شده را می‌گیرد",
  display: "label",
  fields: [
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "offering_id", label: "گزینه", type: "ref", ref: "service_offering", filter: true, index: true, span: 12 },
    { name: "subscriber_kind", label: "مشترک", type: "choice", choices: SUBSCRIBER_KINDS, default: "user", required: true, list: true, filter: true, span: 8 },
    { name: "user_id", label: "فرد", type: "user", filter: true, index: true, span: 16 },
    { name: "group_id", label: "گروه", type: "group", filter: true, span: 16 },
    { name: "org_unit_id", label: "واحد سازمانی", type: "ref", ref: "org_unit", filter: true, span: 16 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 16 },
    { name: "valid_from", label: "از", type: "date", span: 8 },
    { name: "valid_to", label: "تا", type: "date", list: true, span: 8 },
    { name: "notify", label: "خبر وضعیت بگیرد", type: "bool", default: true, span: 8 },
    { name: "origin_kind", label: "منشأ", type: "choice", choices: [yes("manual", "دستی", 1), yes("self", "خود مشترک", 2), yes("rule", "قاعده", 3)], default: "manual", filter: true, span: 8 },
    { name: "label", label: "اشتراک", type: "string", system: true, maxLength: 300, search: true, audit: false, list: true, span: 24 },
  ],
  // writes follow the area's grants (service owners and catalogue managers); people subscribe themselves through
  // POST /service_portfolio/services/:id/subscribe
  rowAccess: {
    read: { or: [{ f: "user_id", op: "is_me" }, { f: "group_id", op: "is_my_group" }, { f: "org_unit_id", op: "in_my_unit" }, { f: "service_id.name", op: "nempty" }] },
  },
  scope: { own: ["user_id"], group: "group_id" },
  list: { columns: ["label", "service_id", "offering_id", "subscriber_kind", "valid_to"], order: "-created_at" },
};

const agreement: TableDef = {
  key: "service_agreement",
  table: "sm_service_agreements",
  label: "توافق مشتری",
  plural: "توافق‌های مشتری",
  icon: "file-signature",
  module: "service_portfolio",
  area: "service",
  description: "توافق با یک واحد یا مشتری بیرونی: کدام گزینه‌ها با کدام سطح خدمت در اختیار آن است",
  numbered: { prefix: "AGR", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "customer_unit_id", label: "مشتری (واحد یا شرکت)", type: "ref", ref: "org_unit", required: true, list: true, filter: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "offerings", label: "گزینه‌ها", type: "refs", ref: "service_offering", span: 12 },
    { name: "valid_from", label: "از", type: "date", list: true, span: 8 },
    { name: "valid_to", label: "تا", type: "date", list: true, sort: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: [yes("draft", "پیش‌نویس", 1, "blue"), yes("active", "در جریان", 2, "green"), yes("expired", "پایان‌یافته", 3, "gray")], default: "draft", list: true, filter: true, span: 8 },
    { name: "terms", label: "شرایط و سطح خدمت", type: "markdown", span: 24 },
    { name: "manager_id", label: "مسئول", type: "user", filter: true, span: 12 },
    { name: "document_url", label: "سند توافق", type: "url", ltr: true, span: 12 },
  ],
  scope: { own: ["manager_id"] },
  list: { columns: ["number", "name", "customer_unit_id", "service_id", "status", "valid_to"], order: "-valid_to" },
};

const scoreFact: TableDef = {
  key: "service_score_fact",
  table: "sm_service_score_facts",
  label: "امتیاز روزانهٔ خدمت",
  plural: "امتیازهای روزانهٔ خدمت",
  icon: "gauge",
  module: "service_portfolio",
  area: "service",
  description: "امتیاز عملکرد هر خدمت در هر روز از دسترس‌پذیری، رخدادها، نقض توافق‌ها و رضایت",
  display: "service_id",
  fields: [
    { name: "day", label: "روز", type: "date", required: true, list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, index: true, span: 16 },
    { name: "availability", label: "دسترس‌پذیری", type: "percent", list: true, span: 6 },
    { name: "incidents", label: "رخدادها", type: "int", default: 0, list: true, span: 6 },
    { name: "major", label: "رخداد عمده", type: "int", default: 0, span: 6 },
    { name: "breaches", label: "نقض توافق", type: "int", default: 0, span: 6 },
    { name: "problems", label: "مشکل باز", type: "int", default: 0, span: 6 },
    { name: "csat", label: "رضایت", type: "decimal", span: 6 },
    { name: "score", label: "امتیاز", type: "int", list: true, sort: true, span: 6 },
    { name: "components", label: "اجزای امتیاز", type: "json", hidden: true, audit: false },
  ],
  scope: {},
  features: { history: false },
  unique: [["day", "service_id"]],
  list: { columns: ["day", "service_id", "availability", "incidents", "score"], order: "-day" },
};

// ---------------------------------------------------------------------------------------------------------------
// Proposals and design packages (SPF-017/018)

const PROPOSAL_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "submitted", label: "ارسال‌شده", category: "waiting", color: "gold" },
    { value: "evaluation", label: "در ارزیابی", category: "active", color: "teal" },
    { value: "approved", label: "تأییدشده", category: "resolved", color: "green" },
    { value: "chartered", label: "منشور صادر شد", category: "closed", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
    { value: "withdrawn", label: "پس‌گرفته", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "submitted", label: "ارسال", requires: ["business_need"] },
    { from: ["submitted"], to: "evaluation", label: "شروع ارزیابی" },
    { from: ["evaluation"], to: "approved", label: "تأیید", roles: { area: "service", level: "full" } },
    { from: ["submitted", "evaluation"], to: "rejected", label: "رد", requires: ["decision_notes"], roles: { area: "service", level: "full" } },
    { from: ["approved"], to: "chartered", label: "صدور منشور خدمت", guard: "proposal_can_charter" },
    { from: ["draft", "submitted"], to: "withdrawn", label: "پس‌گرفتن" },
    { from: ["evaluation"], to: "submitted", label: "بازگشت برای تکمیل" },
  ],
  locked: ["closed", "canceled"],
};

const SCORE: Option[] = [1, 2, 3, 4, 5].map((n) => yes(String(n), ["", "خیلی کم", "کم", "متوسط", "زیاد", "خیلی زیاد"][n], n));

const proposal: TableDef = {
  key: "service_proposal",
  table: "sm_service_proposals",
  label: "پیشنهاد خدمت",
  plural: "پیشنهادهای خدمت",
  icon: "lightbulb",
  module: "service_portfolio",
  area: "service",
  description: "پیشنهاد خدمت تازه، تغییر یا کنارگذاری یک خدمت با تقاضا، منابع، منافع و ریسک‌ها؛ تأیید آن خدمت را منشور می‌کند",
  numbered: { prefix: "SPR", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: [yes("new", "خدمت تازه", 1), yes("change", "تغییر خدمت", 2), yes("retire", "کنارگذاری خدمت", 3)], default: "new", required: true, list: true, filter: true, span: 6 },
    { name: "service_type", label: "نوع خدمت", type: "choice", choices: SERVICE_TYPES, default: "business", span: 6 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 12, help: "برای تغییر یا کنارگذاری" },
    { name: "proposer_id", label: "پیشنهاددهنده", type: "user", default: "$me", list: true, filter: true, span: 12 },
    { name: "portfolio_node_id", label: "شاخهٔ سبد", type: "ref", ref: "portfolio_node", span: 12 },
    { name: "business_need", label: "نیاز کسب‌وکار", type: "markdown", span: 24 },
    { name: "expected_benefits", label: "منافع مورد انتظار", type: "markdown", span: 24 },
    { name: "predicted_demand", label: "تقاضای پیش‌بینی‌شده", type: "text", span: 12 },
    { name: "resources", label: "منابع لازم", type: "text", span: 12 },
    { name: "risks", label: "ریسک‌ها و اثر بر خدمت‌های موجود", type: "markdown", span: 24 },
    { name: "value_score", label: "ارزش کسب‌وکاری", type: "choice", choices: SCORE, span: 8 },
    { name: "fit_score", label: "همخوانی راهبردی", type: "choice", choices: SCORE, span: 8 },
    { name: "risk_score", label: "ریسک", type: "choice", choices: SCORE, span: 8 },
    { name: "score", label: "امتیاز", type: "int", system: true, list: true, sort: true, span: 8 },
    { name: "decision_notes", label: "یادداشت تصمیم", type: "text", span: 24 },
    { name: "chartered_service_id", label: "خدمت منشورشده", type: "ref", ref: "service", readonly: true, span: 12 },
  ],
  states: PROPOSAL_STATES,
  scope: { own: ["proposer_id"] },
  list: { columns: ["number", "name", "kind", "state", "score", "proposer_id", "created_at"], order: "-created_at" },
};

const DESIGN_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "waiting", color: "gold" },
    { value: "approved", label: "تأییدشده", category: "active", color: "teal" },
    { value: "accepted", label: "پذیرفته در عملیات", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "in_review", label: "ارسال برای بازبینی" },
    { from: ["in_review"], to: "draft", label: "بازگشت" },
    { from: ["in_review"], to: "approved", label: "تأیید طراحی", roles: { area: "service", level: "full" } },
    { from: ["approved"], to: "accepted", label: "پذیرش در عملیات", guard: "design_ready" },
    { from: ["accepted"], to: "closed", label: "بستن" },
    { from: ["draft", "in_review", "approved"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const designPackage: TableDef = {
  key: "service_design_package",
  table: "sm_service_design_packages",
  label: "بستهٔ طراحی و گذار",
  plural: "بسته‌های طراحی و گذار",
  icon: "drafting-compass",
  module: "service_portfolio",
  area: "service",
  description: "نیازمندی‌ها، مشخصات طراحی، معیارهای پذیرش و فهرست آمادگی عملیاتی یک خدمت تازه یا تغییر بزرگ",
  numbered: { prefix: "SDT", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "owner_id", label: "مسئول طراحی", type: "user", default: "$me", list: true, filter: true, span: 12 },
    { name: "reviewer_id", label: "بازبین", type: "user", span: 12 },
    { name: "functional_reqs", label: "نیازمندی‌های کارکردی", type: "markdown", span: 24 },
    { name: "nonfunctional_reqs", label: "نیازمندی‌های غیرکارکردی", type: "markdown", span: 24, help: "دسترس‌پذیری، ظرفیت، امنیت، تداوم، پایداری و انطباق" },
    { name: "design_specs", label: "مشخصات طراحی", type: "markdown", span: 24 },
    { name: "acceptance_criteria", label: "معیارهای پذیرش", type: "markdown", span: 24 },
    { name: "readiness", label: "فهرست آمادگی عملیاتی", type: "json", default: [], span: 24, help: "[{ \"item\": \"مستندات پشتیبانی\", \"done\": false }]" },
    { name: "readiness_pct", label: "آمادگی", type: "percent", system: true, list: true, span: 8 },
  ],
  states: DESIGN_STATES,
  scope: { own: ["owner_id", "reviewer_id"] },
  list: { columns: ["number", "name", "service_id", "state", "readiness_pct", "owner_id"], order: "-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Business relationships (SPF-026), application portfolio (SPF-027), technology (SPF-028), capabilities (SPF-029)

const relationship: TableDef = {
  key: "customer_relationship",
  table: "sm_customer_relationships",
  label: "ارتباط با مشتری",
  plural: "ارتباط با مشتریان",
  icon: "users-round",
  module: "service_portfolio",
  area: "service",
  description: "واحد یا مشتری بیرونی با مدیر ارتباط، مجراها، انتظارها و فرصت‌ها و بازبینی‌های دوره‌ای",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "customer_unit_id", label: "واحد یا شرکت", type: "ref", ref: "org_unit", list: true, filter: true, span: 12 },
    { name: "manager_id", label: "مدیر ارتباط", type: "user", list: true, filter: true, span: 12 },
    { name: "relationship_type", label: "نوع", type: "choice", choices: [yes("internal", "واحد داخلی", 1), yes("external", "مشتری بیرونی", 2), yes("partner", "شریک", 3)], default: "internal", list: true, filter: true, span: 12 },
    { name: "channels", label: "مجراهای سفارش، تشدید و شکایت", type: "text", span: 24 },
    { name: "expectations", label: "انتظارها", type: "markdown", span: 24 },
    { name: "opportunities", label: "فرصت‌ها", type: "markdown", span: 24 },
    { name: "satisfaction", label: "رضایت", type: "rating", min: 1, max: 5, list: true, span: 8 },
    { name: "next_review_at", label: "بازبینی بعدی", type: "date", list: true, sort: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
  ],
  scope: { own: ["manager_id"] },
  form: { related: [{ table: "customer_review", field: "relationship_id", label: "بازبینی‌ها", columns: ["number", "held_at", "state", "satisfaction"] }] },
  list: { columns: ["name", "customer_unit_id", "manager_id", "relationship_type", "satisfaction", "next_review_at"], order: "name" },
};

const REVIEW_STATES: StateModel = {
  field: "state",
  initial: "scheduled",
  states: [
    { value: "scheduled", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "held", label: "برگزار شد", category: "active", color: "teal" },
    { value: "actions_open", label: "اقدام‌ها باز", category: "waiting", color: "gold" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["scheduled"], to: "held", label: "برگزار شد", requires: ["minutes"] },
    { from: ["held"], to: "actions_open", label: "پیگیری اقدام‌ها" },
    { from: ["held", "actions_open"], to: "closed", label: "بستن" },
    { from: ["scheduled"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const customerReview: TableDef = {
  key: "customer_review",
  table: "sm_customer_reviews",
  label: "بازبینی با مشتری",
  plural: "بازبینی‌های با مشتری",
  icon: "calendar-check",
  module: "service_portfolio",
  area: "service",
  description: "نشست دوره‌ای با مشتری: صورت‌جلسه، اقدام‌ها، تغییر توافق‌ها و رضایت",
  numbered: { prefix: "CRV", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "relationship_id", label: "ارتباط", type: "ref", ref: "customer_relationship", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "held_at", label: "زمان نشست", type: "datetime", list: true, sort: true, span: 8 },
    { name: "manager_id", label: "مدیر ارتباط", type: "user", default: "$me", filter: true, span: 8 },
    { name: "attendees", label: "حاضران", type: "users", span: 24 },
    { name: "minutes", label: "صورت‌جلسه", type: "markdown", span: 24 },
    { name: "actions", label: "اقدام‌ها", type: "markdown", span: 24 },
    { name: "agreement_changes", label: "تغییر توافق‌ها", type: "text", span: 24 },
    { name: "satisfaction", label: "رضایت", type: "rating", min: 1, max: 5, list: true, span: 8 },
  ],
  states: REVIEW_STATES,
  scope: { own: ["manager_id", "attendees"] },
  list: { columns: ["number", "title", "relationship_id", "held_at", "state", "satisfaction"], order: "-held_at" },
};

const ASSESS_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "sent", label: "در انتظار ارزیاب", category: "waiting", color: "gold" },
    { value: "completed", label: "انجام شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "sent", label: "ارسال به ارزیاب", requires: ["assessor_id"] },
    { from: ["draft", "sent"], to: "completed", label: "ثبت نتیجه", requires: ["business_value", "technical_fit", "time_disposition"] },
    { from: ["completed"], to: "closed", label: "بستن" },
    { from: ["completed"], to: "sent", label: "بازگشایی" },
  ],
  locked: ["closed", "canceled"],
};

const appAssessment: TableDef = {
  key: "app_assessment",
  table: "sm_app_assessments",
  label: "ارزیابی سامانه",
  plural: "ارزیابی‌های سامانه",
  icon: "clipboard-list",
  module: "service_portfolio",
  area: "service",
  description: "ارزیابی ارزش کسب‌وکاری، تناسب فنی، هزینه، ریسک و رضایت یک سامانهٔ کسب‌وکار و تصمیم TIME",
  numbered: { prefix: "ASM", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "ci_id", label: "سامانهٔ کسب‌وکار", type: "ref", ref: "ci", required: true, refFilter: { f: "class", op: "eq", v: "business_application" }, list: true, filter: true, index: true, span: 12 },
    { name: "assessor_id", label: "ارزیاب", type: "user", list: true, filter: true, span: 12 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", span: 12 },
    { name: "business_value", label: "ارزش کسب‌وکاری", type: "rating", min: 1, max: 5, span: 8 },
    { name: "technical_fit", label: "تناسب فنی", type: "rating", min: 1, max: 5, span: 8 },
    { name: "cost_score", label: "هزینه (۵ = ارزان)", type: "rating", min: 1, max: 5, span: 8 },
    { name: "risk_score", label: "ریسک (۵ = کم)", type: "rating", min: 1, max: 5, span: 8 },
    { name: "satisfaction", label: "رضایت کاربران", type: "rating", min: 1, max: 5, span: 8 },
    { name: "time_disposition", label: "تصمیم TIME", type: "choice", choices: [yes("tolerate", "تحمل", 1, "gray"), yes("invest", "سرمایه‌گذاری", 2, "green"), yes("migrate", "مهاجرت", 3, "gold"), yes("eliminate", "حذف", 4, "red")], list: true, filter: true, span: 8 },
    { name: "recommendation", label: "توصیه", type: "markdown", span: 24 },
  ],
  states: ASSESS_STATES,
  scope: { own: ["assessor_id", "owner_id"] },
  list: { columns: ["number", "title", "ci_id", "state", "time_disposition", "assessor_id"], order: "-created_at" },
};

const techStandard: TableDef = {
  key: "technology_standard",
  table: "sm_technology_standards",
  label: "استاندارد فناوری",
  plural: "استانداردهای فناوری",
  icon: "shield-check",
  module: "service_portfolio",
  area: "service",
  description: "محصول یا نسخه‌ای که مجاز، رو به کنارگذاری، ممنوع یا استثناست، با تاریخ پایان پشتیبانی",
  display: "name",
  fields: [
    { name: "name", label: "محصول", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "vendor", label: "سازنده", type: "string", maxLength: 120, list: true, filter: true, span: 12 },
    { name: "product_version", label: "نسخه", type: "string", maxLength: 60, ltr: true, list: true, span: 8, help: "خالی: همهٔ نسخه‌ها" },
    { name: "status", label: "وضعیت", type: "choice", choices: [yes("approved", "مجاز", 1, "green"), yes("retiring", "رو به کنارگذاری", 2, "gold"), yes("prohibited", "ممنوع", 3, "red"), yes("exception", "استثنا", 4, "purple")], default: "approved", required: true, list: true, filter: true, span: 8 },
    { name: "eol_date", label: "پایان پشتیبانی", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "valid_from", label: "اعتبار از", type: "date", span: 8 },
    { name: "valid_to", label: "اعتبار تا", type: "date", span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", filter: true, span: 8 },
    { name: "match_field", label: "تطبیق با", type: "choice", choices: [yes("os", "سیستم‌عامل", 1), yes("sw_version", "نسخهٔ نرم‌افزار", 2), yes("name", "نام پیکربندی", 3), yes("model_name", "مدل", 4)], default: "os", span: 8, help: "کدام ویژگی پیکربندی‌ها با نام محصول مقایسه شود" },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "vendor", "product_version", "status", "eol_date"], order: "name" },
};

const capability: TableDef = {
  key: "business_capability",
  table: "sm_business_capabilities",
  label: "قابلیت کسب‌وکار",
  plural: "قابلیت‌های کسب‌وکار",
  icon: "network",
  module: "service_portfolio",
  area: "service",
  description: "درخت قابلیت‌های کسب‌وکار (سه سطح) با خدمت‌ها و سامانه‌هایی که آن را پوشش می‌دهند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "parent_id", label: "قابلیت بالاتر", type: "ref", ref: "$self", list: true, filter: true, index: true, span: 12 },
    { name: "level", label: "سطح", type: "int", system: true, list: true, span: 6 },
    { name: "owner_id", label: "مالک", type: "user", filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "coverage", label: "پوشش", type: "choice", choices: [yes("full", "کامل", 1, "green"), yes("partial", "ناقص", 2, "gold"), yes("none", "بدون پوشش", 3, "red")], filter: true, list: true, span: 6 },
    { name: "services", label: "خدمت‌ها", type: "refs", ref: "service", span: 24 },
    { name: "applications", label: "سامانه‌ها", type: "refs", ref: "ci", span: 24 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "parent_id", "level", "coverage", "owner_id"], order: "sort_order,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings row

export const SERVICE_CONFIG_DEFAULTS = {
  status_page_title: "وضعیت خدمات",
  status_page_public: false,
  review_warn_days: 14,
  w_availability: 40,
  w_incidents: 30,
  w_breaches: 20,
  w_csat: 10,
  notify_subscribers: true,
};
export type ServiceConfig = typeof SERVICE_CONFIG_DEFAULTS;

const serviceConfig: TableDef = {
  key: "service_config",
  table: "sm_service_configs",
  label: "تنظیمات سبد خدمات",
  plural: "تنظیمات سبد خدمات",
  icon: "settings-2",
  module: "service_portfolio",
  area: "settings",
  description: "صفحهٔ وضعیت، وزن‌های امتیاز عملکرد و خبر به مشترکان",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات سبد خدمات", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "status_page_title", label: "عنوان صفحهٔ وضعیت", type: "string", maxLength: 80, default: SERVICE_CONFIG_DEFAULTS.status_page_title, span: 12 },
    { name: "notify_subscribers", label: "خبر تغییر وضعیت به مشترکان", type: "bool", default: true, span: 12 },
    { name: "status_page_public", label: "صفحهٔ وضعیت عمومی (بدون ورود)", type: "bool", default: false, span: 12, help: "با پیوند محرمانه، برای وب‌سایت یا اینترانت" },
    { name: "status_page_token", label: "کلید پیوند عمومی", type: "string", maxLength: 80, readonly: true, hidden: true, audit: false, index: true },
    { name: "review_warn_days", label: "یادآوری بازبینی (روز پیش از موعد)", type: "int", min: 0, max: 90, default: 14, span: 12 },
    { name: "w_availability", label: "وزن دسترس‌پذیری", type: "int", min: 0, max: 100, default: SERVICE_CONFIG_DEFAULTS.w_availability, span: 6 },
    { name: "w_incidents", label: "وزن رخدادها", type: "int", min: 0, max: 100, default: SERVICE_CONFIG_DEFAULTS.w_incidents, span: 6 },
    { name: "w_breaches", label: "وزن نقض توافق", type: "int", min: 0, max: 100, default: SERVICE_CONFIG_DEFAULTS.w_breaches, span: 6 },
    { name: "w_csat", label: "وزن رضایت", type: "int", min: 0, max: 100, default: SERVICE_CONFIG_DEFAULTS.w_csat, span: 6 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "status_page_title"], order: "name" },
};

export const SERVICE_PORTFOLIO_TABLES: TableDef[] = [
  portfolioNode, service, offering, commitment, instance, subscription, agreement, scoreFact, proposal, designPackage, relationship,
  customerReview, appAssessment, techStandard, capability, serviceConfig,
];
