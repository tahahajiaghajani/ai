// IT asset management (docs/modules/itam_FA.md; catalogue g6 «Module: itam»). The asset is the financial and
// contractual record, the CI its operational twin (linked 1:1 through `asset.ci_id`, kept in step by the module):
//   hardware (area «asset»)     models, stockrooms and stock rules, assets with a lifecycle (on order → in stock → in
//                               use → in repair → retired → disposed) and substates, the assignment history with
//                               acknowledgements, the stock movement ledger, physical audits with barcode/QR scans,
//                               repairs, secure disposal with data-wipe certificates, label templates, depreciation
//                               rules, hardware standards, loaner reservations, catalogue items bound to models
//   procurement (area «procurement»)  purchase requisitions → purchase orders → goods receipts that create the assets
//   software (area «software»)  software models with normalisation patterns, installations from the inventory
//                               collector, entitlements with licence metrics, allocations, reconciliation runs and
//                               the effective licence position, SaaS subscriptions and their accounts
// Money is in the financial field group everywhere. Imported by the UI: keep it free of server imports.
import type { AreaOp, FieldDef, Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES } from "../model/task";
import { CURRENCIES } from "./supplier";

const o = (value: string, label: string, color?: Option["color"], parent?: string): Option => ({ value, label, ...(color ? { color } : {}), ...(parent ? { parent } : {}) });
const ordered = (xs: Option[]): Option[] => xs.map((x, i) => ({ ...x, order: i + 1 }));
const SYSTEM_ONLY = (area: string): AreaOp => ({ area, level: "view", roles: ["_system"] });
const approvalField: FieldDef = { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 };

export const MODEL_CATEGORIES: Option[] = ordered([
  o("laptop", "رایانهٔ کیفی", "blue"), o("desktop", "رایانهٔ رومیزی", "blue"), o("monitor", "نمایشگر", "teal"), o("phone", "تلفن همراه", "purple"),
  o("tablet", "تبلت", "purple"), o("server", "سرور", "indigo"), o("network", "تجهیز شبکه", "indigo"), o("storage", "ذخیره‌ساز", "indigo"),
  o("printer", "چاپگر", "gray"), o("peripheral", "لوازم جانبی", "gray"), o("accessory", "متعلقات", "gray"), o("consumable", "اقلام مصرفی", "gold"),
  o("component", "قطعه", "orange"), o("other", "سایر", "gray"),
]);

export const SOFTWARE_CATEGORIES: Option[] = ordered([
  o("os", "سیستم‌عامل", "blue"), o("office", "اداری", "teal"), o("security", "امنیت و ضدویروس", "red"), o("database", "پایگاه داده", "indigo"),
  o("development", "توسعهٔ نرم‌افزار", "purple"), o("design", "طراحی", "magenta"), o("communication", "ارتباطات", "green"), o("utility", "ابزار", "gray"),
  o("business", "کسب‌وکار", "gold"), o("other", "سایر", "gray"),
]);

export const ITAM_CHOICE_LISTS: Record<string, Option[]> = {
  "asset_model.category": MODEL_CATEGORIES,
  "software_model.category": SOFTWARE_CATEGORIES,
};

export const ASSET_CLASSES: Option[] = ordered([o("hardware", "سخت‌افزار", "blue"), o("consumable", "اقلام مصرفی", "gold"), o("accessory", "متعلقات", "gray"), o("component", "قطعه", "orange")]);

export const LICENSE_METRICS: Option[] = ordered([
  o("per_device", "به‌ازای دستگاه", "blue"), o("per_user", "به‌ازای کاربر", "teal"), o("per_core", "به‌ازای هستهٔ پردازنده", "indigo"),
  o("concurrent", "کاربر هم‌زمان", "purple"), o("subscription", "اشتراک (صندلی)", "magenta"), o("site", "سایت یا سازمانی (نامحدود)", "green"),
  o("free", "رایگان", "gray"), o("open_source", "متن‌باز", "gray"),
]);

const MODEL_STATUS: Option[] = ordered([o("approved", "مصوب", "green"), o("under_review", "در بررسی", "gold"), o("exception", "استثنا", "orange"), o("deprecated", "منسوخ", "gray"), o("prohibited", "ممنوع", "red")]);

// ---------------------------------------------------------------------------------------------------------------
// Catalogue: depreciation rules, models, hardware standards (ITAM-003/004/006/042)

export const DEPRECIATION_METHODS: Option[] = ordered([
  o("straight_line", "خط مستقیم", "blue"), o("declining_balance", "نزولی (مانده)", "teal"), o("sum_of_years", "مجموع سنوات", "indigo"), o("none", "بدون استهلاک", "gray"),
]);

const depreciationRule: TableDef = {
  key: "depreciation_rule",
  table: "sm_depreciation_rules",
  label: "قاعدهٔ استهلاک",
  plural: "قاعده‌های استهلاک",
  icon: "trending-down",
  module: "itam",
  area: "asset",
  description: "روش، عمر مفید و ارزش اسقاط برای محاسبهٔ ارزش دفتری دارایی‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "method", label: "روش", type: "choice", choices: DEPRECIATION_METHODS, default: "straight_line", required: true, list: true, filter: true, span: 12 },
    { name: "life_months", label: "عمر مفید (ماه)", type: "int", min: 1, max: 600, default: 36, list: true, span: 8 },
    { name: "rate_percent", label: "نرخ سالانه (درصد)", type: "percent", span: 8, help: "برای روش نزولی؛ خالی: دو برابر نرخ خط مستقیم" },
    { name: "salvage_percent", label: "ارزش اسقاط (درصد بها)", type: "percent", default: "0", list: true, span: 8 },
    { name: "start_basis", label: "شروع از", type: "choice", choices: ordered([o("in_service", "تاریخ بهره‌برداری"), o("purchase", "تاریخ خرید")]), default: "in_service", span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 12 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "method", "life_months", "salvage_percent"], order: "name" },
};

const M_MAIN = "اصلی";
const M_LIFE = "چرخهٔ عمر و تأمین";
const M_ACK = "تعهدنامه";

const assetModel: TableDef = {
  key: "asset_model",
  table: "sm_asset_models",
  label: "مدل کالا",
  plural: "مدل‌های کالا",
  icon: "package",
  module: "itam",
  area: "asset",
  description: "کاتالوگ مدل‌های سخت‌افزار، لوازم و اقلام مصرفی با سازنده، دستهٔ دارایی و کلاس پیکربندی، وضعیت تأیید، بها، ضمانت، استهلاک و تاریخ‌های پایان پشتیبانی",
  numbered: { prefix: "MDL", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 12, section: M_MAIN },
    { name: "manufacturer_id", label: "سازنده", type: "ref", ref: "supplier", list: true, filter: true, span: 12, section: M_MAIN },
    { name: "model_number", label: "شمارهٔ مدل یا کد کالا", type: "string", maxLength: 120, ltr: true, search: true, filter: true, span: 8, section: M_MAIN },
    { name: "category", label: "دسته", type: "choice", choices: "asset_model.category", required: true, default: "other", list: true, filter: true, span: 8, section: M_MAIN },
    { name: "asset_class", label: "گونهٔ دارایی", type: "choice", choices: ASSET_CLASSES, default: "hardware", required: true, list: true, filter: true, span: 8, section: M_MAIN },
    { name: "tracking", label: "پیگیری", type: "choice", choices: ordered([o("individual", "تک‌به‌تک (با سریال)", "blue"), o("quantity", "تعدادی", "gold")]), default: "individual", filter: true, span: 8, section: M_MAIN },
    { name: "ci_class", label: "کلاس پیکربندی", type: "choice", choices: "ci.class", filter: true, span: 8, section: M_MAIN, help: "دارایی‌های این مدل یک پیکربندی از این کلاس در CMDB می‌گیرند؛ خالی: بدون پیکربندی (لوازم و اقلام مصرفی)" },
    { name: "status", label: "وضعیت تأیید", type: "choice", choices: MODEL_STATUS, default: "approved", list: true, filter: true, span: 8, section: M_MAIN },
    { name: "data_bearing", label: "حامل داده", type: "bool", default: false, filter: true, span: 8, section: M_MAIN, help: "اسقاط آن گواهی پاک‌سازی داده لازم دارد" },
    { name: "specs", label: "مشخصات", type: "markdown", span: 24, section: M_MAIN, ai: { index: true } },

    { name: "procurement_mode", label: "روش تأمین", type: "choice", choices: ordered([o("buy", "خرید"), o("lease", "اجاره"), o("both", "هر دو")]), default: "buy", filter: true, span: 8, section: M_LIFE },
    { name: "unit_cost", label: "بهای استاندارد (ریال)", type: "money", list: true, sort: true, span: 8, section: M_LIFE, group: "financial" },
    { name: "default_vendor_id", label: "فروشندهٔ پیش‌فرض", type: "ref", ref: "supplier", filter: true, span: 8, section: M_LIFE },
    { name: "warranty_months", label: "ضمانت استاندارد (ماه)", type: "int", min: 0, max: 240, default: 12, span: 8, section: M_LIFE },
    { name: "useful_life_months", label: "عمر مفید (ماه)", type: "int", min: 1, max: 600, default: 48, span: 8, section: M_LIFE },
    { name: "depreciation_rule_id", label: "قاعدهٔ استهلاک", type: "ref", ref: "depreciation_rule", span: 8, section: M_LIFE },
    { name: "release_date", label: "عرضه", type: "date", span: 6, section: M_LIFE },
    { name: "end_of_sale", label: "پایان فروش", type: "date", span: 6, section: M_LIFE },
    { name: "eol_date", label: "پایان پشتیبانی سازنده", type: "date", filter: true, sort: true, list: true, span: 6, section: M_LIFE },
    { name: "lifecycle_source", label: "منبع تاریخ‌ها", type: "choice", choices: ordered([o("vendor", "سازنده"), o("manual", "دستی"), o("approximated", "برآورد")]), default: "manual", span: 6, section: M_LIFE },

    { name: "requires_acknowledgement", label: "تحویل تعهدنامه می‌خواهد", type: "bool", default: false, filter: true, span: 24, section: M_ACK },
    { name: "acknowledgement_terms", label: "متن تعهدنامهٔ استفادهٔ مجاز", type: "markdown", span: 24, section: M_ACK },
  ],
  scope: { public: true },
  features: { attachments: true, rag: true },
  form: {
    sections: [M_MAIN, M_LIFE, M_ACK],
    related: [
      { table: "asset", field: "model_id", label: "دارایی‌ها", columns: ["number", "name", "asset_tag", "state", "assigned_to", "stockroom_id"] },
      { table: "stock_rule", field: "model_id", label: "قاعده‌های موجودی", columns: ["stockroom_id", "min_qty", "max_qty", "available", "status"] },
      { table: "catalog_item_model", field: "model_id", label: "اقلام کاتالوگ", columns: ["catalog_item_id", "consume_stock", "raise_purchase"] },
    ],
  },
  list: { columns: ["number", "name", "manufacturer_id", "category", "asset_class", "status", "unit_cost", "eol_date"], order: "name" },
  ai: { title: "name", text: ["specs"] },
};

const hardwareStandard: TableDef = {
  key: "hardware_standard",
  table: "sm_hardware_standards",
  label: "استاندارد سخت‌افزار",
  plural: "استانداردهای سخت‌افزار",
  icon: "badge-check",
  module: "itam",
  area: "asset",
  description: "پیکربندی‌های مصوب برای هر نقش (کارمند اداری، برنامه‌نویس، مدیر، کار میدانی) با مدل‌ها، لوازم، نرم‌افزارها و دورهٔ نوسازی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "persona", label: "برای", type: "choice", choices: ordered([o("office", "کارمند اداری"), o("developer", "برنامه‌نویس"), o("executive", "مدیر ارشد"), o("field", "کار میدانی"), o("designer", "طراح"), o("other", "سایر")]), default: "office", list: true, filter: true, span: 12 },
    { name: "models", label: "مدل‌های مصوب", type: "refs", ref: "asset_model", span: 24 },
    { name: "accessories", label: "لوازم همراه", type: "refs", ref: "asset_model", span: 24 },
    { name: "software", label: "نرم‌افزارهای همراه", type: "refs", ref: "software_model", span: 24 },
    { name: "refresh_months", label: "دورهٔ نوسازی (ماه)", type: "int", min: 6, max: 120, default: 48, list: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "description", label: "توضیح", type: "markdown", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "persona", "refresh_months", "active"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Stockrooms and stock (ITAM-013/014/015)

export const STOCKROOM_TYPES: Option[] = ordered([
  o("central", "انبار مرکزی", "blue"), o("regional", "انبار منطقه‌ای", "teal"), o("onsite", "انبارک محل", "gray"), o("secure", "اتاق امن", "red"),
  o("kiosk", "باجهٔ فناوری اطلاعات", "purple"), o("van", "خودروی پشتیبانی", "gold"), o("disposal", "محل اسقاط", "orange"),
]);

const stockroom: TableDef = {
  key: "stockroom",
  table: "sm_stockrooms",
  label: "انبار",
  plural: "انبارها",
  icon: "warehouse",
  module: "itam",
  area: "asset",
  description: "انبارهای دارایی با گونه، مکان، مسئول و انبار والد؛ موجودی هر مدل در هر انبار از دارایی‌های آن به دست می‌آید",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 30, ltr: true, unique: true, list: true, search: true, span: 6 },
    { name: "stockroom_type", label: "گونه", type: "choice", choices: STOCKROOM_TYPES, default: "central", list: true, filter: true, span: 6 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", list: true, filter: true, span: 12 },
    { name: "parent_id", label: "انبار والد", type: "ref", ref: "$self", filter: true, span: 12 },
    { name: "manager_id", label: "انباردار", type: "user", list: true, filter: true, span: 12 },
    { name: "group_id", label: "گروه انبار", type: "group", filter: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
    { name: "description", label: "توضیح", type: "text", span: 24 },
  ],
  scope: { own: ["manager_id"], group: "group_id", public: true },
  form: {
    related: [
      { table: "asset", field: "stockroom_id", label: "دارایی‌های این انبار", columns: ["number", "name", "model_id", "state", "substate", "quantity"] },
      { table: "stock_rule", field: "stockroom_id", label: "قاعده‌های موجودی", columns: ["model_id", "min_qty", "max_qty", "available", "status"] },
    ],
  },
  list: { columns: ["name", "code", "stockroom_type", "location_id", "manager_id", "active"], order: "name" },
};

export const STOCK_STATUS: Option[] = ordered([o("ok", "کافی", "green"), o("low", "زیر نقطهٔ سفارش", "orange"), o("out", "تمام‌شده", "red")]);

const stockRule: TableDef = {
  key: "stock_rule",
  table: "sm_stock_rules",
  label: "قاعدهٔ موجودی",
  plural: "قاعده‌های موجودی",
  icon: "gauge",
  module: "itam",
  area: "asset",
  description: "کمینه، بیشینه و مقدار سفارش هر مدل در هر انبار؛ کمبود هشدار و درخواست خرید می‌سازد",
  display: "label",
  fields: [
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "stockroom_id", label: "انبار", type: "ref", ref: "stockroom", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "min_qty", label: "نقطهٔ سفارش (کمینه)", type: "int", min: 0, max: 100000, default: 2, required: true, list: true, span: 6 },
    { name: "max_qty", label: "سطح هدف (بیشینه)", type: "int", min: 0, max: 100000, default: 10, list: true, span: 6 },
    { name: "reorder_qty", label: "مقدار سفارش", type: "int", min: 0, max: 100000, span: 6, help: "خالی: تا سطح هدف" },
    { name: "lead_days", label: "زمان تأمین (روز)", type: "int", min: 0, max: 365, default: 14, span: 6 },
    { name: "auto_requisition", label: "درخواست خرید خودکار", type: "bool", default: false, filter: true, span: 12, help: "با کمبود، پیش‌نویس درخواست خرید ساخته می‌شود" },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 12 },
    { name: "available", label: "موجودی آماده", type: "int", readonly: true, audit: false, list: true, sort: true, span: 6 },
    { name: "status", label: "وضعیت موجودی", type: "choice", choices: STOCK_STATUS, readonly: true, audit: false, list: true, filter: true, span: 6 },
    { name: "last_alert_at", label: "آخرین هشدار", type: "datetime", readonly: true, audit: false, span: 6 },
    { name: "last_requisition_id", label: "آخرین درخواست خرید", type: "ref", ref: "purchase_requisition", readonly: true, span: 6 },
    { name: "label", label: "قاعده", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: {},
  unique: [["model_id", "stockroom_id"]],
  list: { columns: ["model_id", "stockroom_id", "min_qty", "max_qty", "available", "status", "auto_requisition"], order: "-updated_at" },
};

export const MOVEMENT_KINDS: Option[] = ordered([
  o("receipt", "ورود از خرید", "green"), o("issue", "تحویل به کاربر", "blue"), o("return", "بازگشت به انبار", "teal"), o("transfer_out", "خروج انتقالی", "gold"),
  o("transfer_in", "ورود انتقالی", "gold"), o("repair_out", "ارسال به تعمیر", "orange"), o("repair_in", "بازگشت از تعمیر", "orange"),
  o("adjustment", "اصلاح موجودی", "purple"), o("disposal", "خروج برای اسقاط", "red"),
]);

const stockMovement: TableDef = {
  key: "stock_movement",
  table: "sm_stock_movements",
  label: "گردش موجودی",
  plural: "گردش موجودی",
  icon: "arrow-left-right",
  module: "itam",
  area: "asset",
  description: "دفتر تغییرناپذیر ورود و خروج انبار؛ اصلاح فقط با ردیف برگشتی",
  display: "label",
  fields: [
    { name: "moved_at", label: "زمان", type: "datetime", default: "$now", list: true, sort: true, filter: true, span: 8 },
    { name: "kind", label: "گونه", type: "choice", choices: MOVEMENT_KINDS, required: true, list: true, filter: true, span: 8 },
    { name: "quantity", label: "مقدار", type: "int", required: true, list: true, span: 8, help: "مثبت: ورود به انبار؛ منفی: خروج" },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "stockroom_id", label: "انبار", type: "ref", ref: "stockroom", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", list: true, filter: true, index: true, span: 12 },
    { name: "moved_by", label: "انجام‌دهنده", type: "user", default: "$me", filter: true, span: 12 },
    { name: "reference", label: "مرجع", type: "string", maxLength: 120, search: true, list: true, span: 12, help: "شمارهٔ رسید، سفارش، دارایی یا شمارش" },
    { name: "reversal_of", label: "برگشتِ", type: "ref", ref: "$self", readonly: true, span: 12 },
    { name: "note", label: "یادداشت", type: "string", maxLength: 300, span: 24 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: {},
  list: { columns: ["moved_at", "kind", "model_id", "stockroom_id", "quantity", "asset_id", "reference"], order: "-moved_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// The asset (ITAM-001/002/007/008/009/034/038/042)

export const ASSET_STATES: StateModel = {
  field: "state",
  initial: "in_stock",
  states: [
    { value: "on_order", label: "سفارش‌شده", category: "waiting", color: "purple" },
    { value: "in_stock", label: "در انبار", category: "new", color: "blue" },
    { value: "in_transit", label: "در راه", category: "waiting", color: "gold" },
    { value: "in_use", label: "در استفاده", category: "active", color: "green" },
    { value: "in_repair", label: "در تعمیر", category: "waiting", color: "orange" },
    { value: "missing", label: "مفقود", category: "waiting", color: "red" },
    { value: "retired", label: "بازنشسته", category: "resolved", color: "gray" },
    { value: "disposed", label: "اسقاط‌شده", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["on_order", "in_transit"], to: "in_stock", label: "دریافت در انبار", requires: ["stockroom_id"] },
    { from: ["on_order"], to: "canceled", label: "لغو سفارش" },
    { from: ["in_stock", "in_transit", "in_repair", "missing"], to: "in_use", label: "تحویل", guard: "asset_can_deploy" },
    { from: ["in_use"], to: "in_stock", label: "بازگشت به انبار", requires: ["stockroom_id"] },
    { from: ["in_stock", "in_use"], to: "in_transit", label: "ارسال" },
    { from: ["in_stock", "in_use", "in_transit"], to: "in_repair", label: "ارسال برای تعمیر" },
    { from: ["in_repair", "missing"], to: "in_stock", label: "بازگشت به انبار", requires: ["stockroom_id"] },
    { from: ["in_stock", "in_use", "in_transit", "in_repair"], to: "missing", label: "گزارش مفقودی", requires: ["retire_reason"] },
    { from: ["in_stock", "in_use", "in_repair", "missing"], to: "retired", label: "بازنشسته کردن", requires: ["retire_reason"] },
    { from: ["retired"], to: "in_stock", label: "بازگرداندن به خدمت", requires: ["stockroom_id"] },
    { from: ["retired"], to: "disposed", label: "اسقاط", requires: ["disposal_method"], guard: "asset_can_dispose" },
  ],
};

/** Substates of each state (a dependent choice: the option's parent is the state). */
export const ASSET_SUBSTATES: Option[] = ordered([
  o("available", "آماده", "green", "in_stock"), o("reserved", "رزروشده", "purple", "in_stock"), o("defective", "معیوب", "red", "in_stock"),
  o("pending_install", "آمادهٔ نصب", "blue", "in_stock"), o("pending_disposal", "در انتظار اسقاط", "gray", "in_stock"), o("pending_transfer", "در انتظار انتقال", "gold", "in_stock"),
  o("assigned", "تحویل‌شده", "green", "in_use"), o("loaner", "امانی", "teal", "in_use"), o("to_be_returned", "باید بازگردد", "orange", "in_use"),
  o("unverified", "تأییدنشده (از کشف)", "gold", "in_use"),
  o("internal_repair", "تعمیر داخلی", "orange", "in_repair"), o("vendor_repair", "نزد تأمین‌کننده (RMA)", "orange", "in_repair"),
  o("lost", "گم‌شده", "red", "missing"), o("stolen", "سرقت‌شده", "red", "missing"),
  o("awaiting_disposal", "در انتظار اسقاط", "gray", "retired"), o("sold", "فروخته‌شده", "gray", "retired"), o("donated", "اهداشده", "gray", "retired"),
  o("returned_to_vendor", "بازگشت به تأمین‌کننده", "gray", "retired"), o("consumed", "مصرف‌شده", "gray", "retired"),
]);

/** The substate a state starts in (the module sets it when the state changes and the substate no longer fits). */
export const DEFAULT_SUBSTATE: Record<string, string | null> = {
  in_stock: "available", in_use: "assigned", in_repair: "internal_repair", missing: "lost", retired: "awaiting_disposal",
  on_order: null, in_transit: null, disposed: null, canceled: null,
};

export const DISPOSAL_METHODS: Option[] = ordered([
  o("recycle", "بازیافت", "green"), o("destroy", "امحای فیزیکی", "red"), o("sell", "فروش", "blue"), o("donate", "اهدا", "teal"), o("return_to_vendor", "بازگشت به تأمین‌کننده", "gray"),
]);

/** Media sanitisation (NIST SP 800-88): clear, purge, destroy. */
export const SANITIZATION_METHODS: Option[] = ordered([
  o("clear", "پاک‌سازی ساده (Clear)", "gold"), o("purge", "پاک‌سازی کامل (Purge)", "green"), o("destroy", "تخریب فیزیکی (Destroy)", "red"), o("not_applicable", "بدون حامل داده", "gray"),
]);

export const USAGE_TYPES: Option[] = ordered([o("permanent", "دائم", "blue"), o("loaner", "امانی", "teal")]);
export const CONDITIONS: Option[] = ordered([o("new", "نو", "green"), o("good", "خوب", "teal"), o("fair", "متوسط", "gold"), o("poor", "ضعیف", "orange"), o("damaged", "آسیب‌دیده", "red")]);
export const ACK_STATES_OPTIONS: Option[] = ordered([o("none", "لازم نیست", "gray"), o("pending", "در انتظار تأیید کاربر", "gold"), o("accepted", "پذیرفته", "green"), o("declined", "نپذیرفته", "red")]);

const A_MAIN = "اصلی";
const A_USE = "تحویل و مکان";
const A_FIN = "مالی و استهلاک";
const A_WAR = "ضمانت و قرارداد";
const A_LIFE = "چرخهٔ عمر و اسقاط";

const asset: TableDef = {
  key: "asset",
  table: "sm_assets",
  label: "دارایی",
  plural: "دارایی‌ها",
  icon: "monitor-smartphone",
  module: "itam",
  area: "asset",
  description: "دفتر دارایی‌های فناوری اطلاعات: برچسب اموال، سریال، مدل، وضعیت و زیروضعیت، تحویل‌گیرنده، مکان و انبار، خرید، ضمانت، قراردادها، استهلاک و اسقاط — پیوند یک‌به‌یک با پیکربندی",
  numbered: { prefix: "AST", pad: 7 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", maxLength: 200, list: true, search: true, sort: true, span: 12, section: A_MAIN, help: "خالی: از مدل و برچسب ساخته می‌شود" },
    { name: "asset_tag", label: "برچسب اموال", type: "string", maxLength: 60, ltr: true, unique: true, list: true, search: true, filter: true, sort: true, index: true, span: 6, section: A_MAIN, help: "خالی: سامانه می‌سازد" },
    { name: "serial_number", label: "شمارهٔ سریال", type: "string", maxLength: 120, ltr: true, search: true, filter: true, index: true, span: 6, section: A_MAIN },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", required: true, list: true, filter: true, index: true, span: 12, section: A_MAIN },
    { name: "category", label: "دسته", type: "choice", choices: "asset_model.category", readonly: true, list: true, filter: true, span: 6, section: A_MAIN },
    { name: "asset_class", label: "گونه", type: "choice", choices: ASSET_CLASSES, readonly: true, filter: true, span: 6, section: A_MAIN },
    { name: "substate", label: "زیروضعیت", type: "choice", choices: ASSET_SUBSTATES, dependsOn: "state", list: true, filter: true, span: 8, section: A_MAIN },
    { name: "quantity", label: "تعداد", type: "int", min: 0, max: 1000000, default: 1, span: 8, section: A_MAIN, help: "برای اقلام تعدادی (مصرفی و لوازم)" },
    { name: "ci_id", label: "پیکربندی (CI)", type: "ref", ref: "ci", unique: true, filter: true, span: 8, section: A_MAIN, help: "همتای عملیاتی این دارایی در پایگاه پیکربندی" },
    { name: "parent_asset_id", label: "بخشی از / متصل به", type: "ref", ref: "$self", filter: true, span: 12, section: A_MAIN, help: "قطعه یا لوازمی که به دارایی دیگری وصل است" },
    { name: "managed_by", label: "مسئول دارایی", type: "user", filter: true, span: 6, section: A_MAIN },
    { name: "managed_by_group_id", label: "گروه مسئول", type: "group", filter: true, span: 6, section: A_MAIN },
    { name: "tags", label: "برچسب‌ها", type: "tags", filter: true, search: true, span: 12, section: A_MAIN },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24, section: A_MAIN, ai: { index: true } },

    { name: "assigned_to", label: "تحویل‌گیرنده", type: "user", list: true, filter: true, span: 8, section: A_USE },
    { name: "assigned_at", label: "زمان تحویل", type: "datetime", readonly: true, sort: true, span: 8, section: A_USE },
    { name: "usage_type", label: "نوع تحویل", type: "choice", choices: USAGE_TYPES, default: "permanent", filter: true, span: 8, section: A_USE },
    { name: "expected_return_at", label: "موعد بازگشت", type: "date", filter: true, sort: true, span: 8, section: A_USE },
    { name: "department_id", label: "واحد", type: "ref", ref: "org_unit", filter: true, span: 8, section: A_USE },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", list: true, filter: true, span: 8, section: A_USE },
    { name: "stockroom_id", label: "انبار", type: "ref", ref: "stockroom", list: true, filter: true, index: true, span: 8, section: A_USE },
    { name: "reserved_for", label: "رزرو برای", type: "user", filter: true, span: 8, section: A_USE },
    { name: "request_item_id", label: "قلم درخواست", type: "ref", ref: "request_item", filter: true, span: 8, section: A_USE },
    { name: "ack_state", label: "تعهدنامه", type: "choice", choices: ACK_STATES_OPTIONS, default: "none", readonly: true, filter: true, span: 8, section: A_USE },

    { name: "purchase_cost", label: "بهای خرید (ریال)", type: "money", sort: true, span: 8, section: A_FIN, group: "financial" },
    { name: "purchase_date", label: "تاریخ خرید", type: "date", sort: true, filter: true, span: 8, section: A_FIN },
    { name: "vendor_id", label: "فروشنده", type: "ref", ref: "supplier", filter: true, span: 8, section: A_FIN },
    { name: "po_id", label: "سفارش خرید", type: "ref", ref: "purchase_order", filter: true, span: 8, section: A_FIN },
    { name: "invoice_number", label: "شمارهٔ فاکتور", type: "string", maxLength: 60, ltr: true, span: 8, section: A_FIN, group: "financial" },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 8, section: A_FIN },
    { name: "depreciation_rule_id", label: "قاعدهٔ استهلاک", type: "ref", ref: "depreciation_rule", span: 8, section: A_FIN },
    { name: "in_service_date", label: "تاریخ بهره‌برداری", type: "date", sort: true, span: 8, section: A_FIN },
    { name: "salvage_value", label: "ارزش اسقاط", type: "money", span: 8, section: A_FIN, group: "financial" },
    { name: "book_value", label: "ارزش دفتری", type: "money", readonly: true, audit: false, sort: true, list: true, span: 8, section: A_FIN, group: "financial" },
    { name: "accumulated_depreciation", label: "استهلاک انباشته", type: "money", readonly: true, audit: false, span: 8, section: A_FIN, group: "financial" },
    { name: "book_value_at", label: "ارزش دفتری در تاریخ", type: "date", readonly: true, audit: false, span: 8, section: A_FIN },

    { name: "warranty_start", label: "شروع ضمانت", type: "date", span: 6, section: A_WAR },
    { name: "warranty_end", label: "پایان ضمانت", type: "date", list: true, sort: true, filter: true, index: true, span: 6, section: A_WAR },
    { name: "warranty_contract_id", label: "قرارداد ضمانت", type: "ref", ref: "contract", filter: true, span: 12, section: A_WAR },
    { name: "support_contract_id", label: "قرارداد پشتیبانی", type: "ref", ref: "contract", filter: true, span: 12, section: A_WAR },
    { name: "lease_contract_id", label: "قرارداد اجاره", type: "ref", ref: "contract", filter: true, span: 12, section: A_WAR },
    { name: "lease_end", label: "پایان اجاره", type: "date", sort: true, filter: true, span: 12, section: A_WAR },
    { name: "reminded", label: "یادآوری‌های فرستاده", type: "json", system: true, hidden: true, audit: false },

    { name: "received_at", label: "دریافت", type: "datetime", readonly: true, sort: true, span: 6, section: A_LIFE },
    { name: "deployed_at", label: "نخستین تحویل", type: "datetime", readonly: true, sort: true, span: 6, section: A_LIFE },
    { name: "retired_at", label: "بازنشستگی", type: "datetime", readonly: true, sort: true, span: 6, section: A_LIFE },
    { name: "disposed_at", label: "اسقاط", type: "datetime", readonly: true, sort: true, span: 6, section: A_LIFE },
    { name: "last_audit_at", label: "آخرین شمارش", type: "datetime", readonly: true, sort: true, filter: true, span: 6, section: A_LIFE },
    { name: "last_audit_result", label: "نتیجهٔ آخرین شمارش", type: "choice", choices: ordered([o("found", "دیده شد", "green"), o("moved", "جابه‌جا", "gold"), o("missing", "دیده نشد", "red")]), readonly: true, filter: true, span: 6, section: A_LIFE },
    { name: "encrypted", label: "رمزگذاری دیسک", type: "bool", default: false, filter: true, span: 6, section: A_LIFE },
    { name: "mdm_enrolled", label: "در مدیریت دستگاه (MDM)", type: "bool", default: false, filter: true, span: 6, section: A_LIFE },
    { name: "retire_reason", label: "علت بازنشستگی یا مفقودی", type: "text", span: 24, section: A_LIFE },
    { name: "disposal_method", label: "روش اسقاط", type: "choice", choices: DISPOSAL_METHODS, filter: true, span: 8, section: A_LIFE },
    { name: "disposal_order_id", label: "دستور اسقاط", type: "ref", ref: "disposal_order", readonly: true, filter: true, span: 8, section: A_LIFE },
    { name: "sanitization_method", label: "روش پاک‌سازی داده", type: "choice", choices: SANITIZATION_METHODS, filter: true, span: 8, section: A_LIFE },
    { name: "sanitized_at", label: "زمان پاک‌سازی", type: "datetime", span: 8, section: A_LIFE },
    { name: "certificate_no", label: "شمارهٔ گواهی پاک‌سازی", type: "string", maxLength: 80, ltr: true, search: true, span: 8, section: A_LIFE },
  ],
  states: ASSET_STATES,
  // the person using it reads it (also without a role in the area: the module's «دارایی‌های من» grant)
  scope: { own: ["assigned_to", "managed_by"], requester: ["assigned_to"], group: "managed_by_group_id", watchers: "watch_list" },
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true, kanban: "state" },
  form: {
    sections: [A_MAIN, A_USE, A_FIN, A_WAR, A_LIFE],
    related: [
      { table: "asset_assignment", field: "asset_id", label: "تاریخچهٔ تحویل", columns: ["assigned_to", "location_id", "from_at", "to_at", "usage_type", "condition_in"] },
      { table: "contract_coverage", field: "asset_id", label: "پوشش قراردادها", columns: ["contract_id", "coverage_level", "valid_from", "valid_to"] },
      { table: "repair_order", field: "asset_id", label: "تعمیرها", columns: ["number", "title", "state", "vendor_id", "cost"] },
      { table: "stock_movement", field: "asset_id", label: "گردش انبار", columns: ["moved_at", "kind", "stockroom_id", "quantity", "reference"] },
      { table: "asset_acknowledgement", field: "asset_id", label: "تعهدنامه‌ها", columns: ["number", "user_id", "state", "requested_at", "decided_at"] },
      { table: "asset", field: "parent_asset_id", label: "اجزا و لوازم متصل", columns: ["number", "name", "model_id", "state"] },
      { table: "cost_entry", field: "asset_id", label: "هزینه‌ها", columns: ["number", "entry_date", "description", "amount", "source"] },
    ],
  },
  list: { columns: ["number", "asset_tag", "name", "model_id", "state", "substate", "assigned_to", "location_id", "warranty_end"], order: "-updated_at" },
  ai: { title: "name", text: ["notes"] },
};

const assignment: TableDef = {
  key: "asset_assignment",
  table: "sm_asset_assignments",
  label: "تحویل دارایی",
  plural: "تاریخچهٔ تحویل دارایی‌ها",
  icon: "hand-helping",
  module: "itam",
  area: "asset",
  description: "هر تحویل و بازگشت دارایی: به چه کسی یا کجا، از کی تا کی، نوع تحویل، وضعیت ظاهری و تعهدنامه (نوشتهٔ سامانه)",
  display: "label",
  fields: [
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "assigned_to", label: "تحویل‌گیرنده", type: "user", list: true, filter: true, span: 12 },
    { name: "department_id", label: "واحد", type: "ref", ref: "org_unit", filter: true, span: 8 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", list: true, filter: true, span: 8 },
    { name: "usage_type", label: "نوع", type: "choice", choices: USAGE_TYPES, list: true, span: 8 },
    { name: "from_at", label: "از", type: "datetime", required: true, list: true, sort: true, span: 8 },
    { name: "to_at", label: "تا", type: "datetime", list: true, sort: true, filter: true, span: 8 },
    { name: "expected_return_at", label: "موعد بازگشت", type: "date", span: 8 },
    { name: "condition_out", label: "وضعیت هنگام تحویل", type: "choice", choices: CONDITIONS, span: 8 },
    { name: "condition_in", label: "وضعیت هنگام بازگشت", type: "choice", choices: CONDITIONS, list: true, span: 8 },
    { name: "assigned_by", label: "تحویل‌دهنده", type: "user", span: 8 },
    { name: "acknowledgement_id", label: "تعهدنامه", type: "ref", ref: "asset_acknowledgement", span: 12 },
    { name: "request_item_id", label: "قلم درخواست", type: "ref", ref: "request_item", span: 12 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: { own: ["assigned_to"], requester: ["assigned_to"] },
  list: { columns: ["asset_id", "assigned_to", "location_id", "usage_type", "from_at", "to_at"], order: "-from_at" },
};

export const ACK_STATES: StateModel = {
  field: "state",
  initial: "pending",
  states: [
    { value: "pending", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "accepted", label: "پذیرفته", category: "closed", color: "green" },
    { value: "declined", label: "نپذیرفته", category: "resolved", color: "red" },
    { value: "expired", label: "منقضی", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["pending"], to: "accepted", label: "پذیرش", requires: ["signature_name"] },
    { from: ["pending"], to: "declined", label: "عدم پذیرش", requires: ["decision_note"] },
    { from: ["pending"], to: "expired", label: "انقضا" },
    { from: ["declined", "expired"], to: "pending", label: "درخواست دوباره" },
  ],
};

const acknowledgement: TableDef = {
  key: "asset_acknowledgement",
  table: "sm_asset_acks",
  label: "تعهدنامهٔ دارایی",
  plural: "تعهدنامه‌های دارایی",
  icon: "signature",
  module: "itam",
  area: "asset",
  description: "رسید و تعهد استفادهٔ مجاز که تحویل‌گیرنده با امضای نام خود می‌پذیرد",
  numbered: { prefix: "ACK", pad: 6 },
  display: "label",
  fields: [
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "تحویل‌گیرنده", type: "user", required: true, list: true, filter: true, span: 12 },
    { name: "assignment_id", label: "تحویل", type: "ref", ref: "asset_assignment", readonly: true, span: 12 },
    { name: "requested_at", label: "درخواست", type: "datetime", default: "$now", readonly: true, list: true, sort: true, span: 6 },
    { name: "decided_at", label: "پاسخ", type: "datetime", readonly: true, list: true, sort: true, span: 6 },
    { name: "terms", label: "متن تعهدنامه", type: "markdown", readonly: true, span: 24 },
    { name: "signature_name", label: "امضا (نام کامل)", type: "string", maxLength: 160, span: 12 },
    { name: "decision_note", label: "توضیح", type: "text", span: 24 },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", system: true, audit: false },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  states: ACK_STATES,
  scope: { own: ["user_id"], requester: ["user_id"] },
  features: { journal: true },
  list: { columns: ["number", "asset_id", "user_id", "state", "requested_at", "decided_at"], order: "-requested_at" },
};

const reservation: TableDef = {
  key: "asset_reservation",
  table: "sm_asset_reservations",
  label: "رزرو دارایی امانی",
  plural: "رزروهای دارایی امانی",
  icon: "calendar-clock",
  module: "itam",
  area: "asset",
  description: "رزرو دارایی‌های امانی (لپ‌تاپ، ویدئو‌پروژکتور، گوشی آزمون) برای بازه‌ای مشخص",
  numbered: { prefix: "RSV", pad: 6 },
  display: "purpose",
  fields: [
    { name: "purpose", label: "منظور", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "user_id", label: "برای", type: "user", default: "$me", required: true, list: true, filter: true, span: 12 },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", filter: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", list: true, filter: true, span: 12 },
    { name: "from_date", label: "از", type: "date", required: true, list: true, sort: true, span: 6 },
    { name: "to_date", label: "تا", type: "date", required: true, list: true, sort: true, span: 6 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
  ],
  states: {
    field: "state",
    initial: "requested",
    states: [
      { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
      { value: "confirmed", label: "قطعی", category: "active", color: "teal" },
      { value: "checked_out", label: "تحویل‌شده", category: "active", color: "green" },
      { value: "returned", label: "بازگشته", category: "closed", color: "gray" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["requested"], to: "confirmed", label: "تأیید رزرو", requires: ["asset_id"] },
      { from: ["confirmed"], to: "checked_out", label: "تحویل", requires: ["asset_id"] },
      { from: ["checked_out"], to: "returned", label: "بازگشت" },
      { from: ["requested", "confirmed"], to: "canceled", label: "لغو" },
    ],
  },
  scope: { own: ["user_id"], requester: ["user_id"] },
  features: { calendar: { start: "from_date", end: "to_date" } },
  list: { columns: ["number", "purpose", "user_id", "asset_id", "from_date", "to_date", "state"], order: "from_date" },
};

// ---------------------------------------------------------------------------------------------------------------
// Physical audits (ITAM-029/032)

const audit: TableDef = {
  key: "inventory_audit",
  table: "sm_inventory_audits",
  label: "شمارش دارایی",
  plural: "شمارش‌های دارایی",
  icon: "scan-barcode",
  module: "itam",
  area: "asset",
  description: "انبارگردانی و ممیزی فیزیکی یک انبار یا مکان با اسکن بارکد و QR؛ دیده‌شده، دیده‌نشده، جابه‌جا و ناشناخته",
  numbered: { prefix: "AUD", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "scope_kind", label: "دامنه", type: "choice", choices: ordered([o("stockroom", "یک انبار", "blue"), o("location", "یک مکان", "teal")]), default: "stockroom", required: true, list: true, span: 12 },
    { name: "stockroom_id", label: "انبار", type: "ref", ref: "stockroom", list: true, filter: true, span: 12 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", list: true, filter: true, span: 12 },
    { name: "owner_id", label: "مسئول شمارش", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "planned_date", label: "تاریخ برنامه", type: "date", list: true, sort: true, span: 8 },
    { name: "mark_missing", label: "دیده‌نشده‌ها «مفقود» شوند", type: "bool", default: false, span: 12, help: "در پایان شمارش، دارایی‌های دیده‌نشده به وضعیت مفقود می‌روند" },
    { name: "expected_count", label: "مورد انتظار", type: "int", readonly: true, list: true, span: 6 },
    { name: "found_count", label: "دیده‌شده", type: "int", readonly: true, list: true, span: 6 },
    { name: "missing_count", label: "دیده‌نشده", type: "int", readonly: true, list: true, span: 6 },
    { name: "unexpected_count", label: "ناشناخته یا جابه‌جا", type: "int", readonly: true, span: 6 },
    { name: "started_at", label: "شروع", type: "datetime", readonly: true, span: 8 },
    { name: "completed_at", label: "پایان", type: "datetime", readonly: true, span: 8 },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: {
    field: "state",
    initial: "planned",
    states: [
      { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
      { value: "in_progress", label: "در حال شمارش", category: "active", color: "teal" },
      { value: "completed", label: "پایان‌یافته", category: "resolved", color: "green" },
      { value: "closed", label: "بسته", category: "closed", color: "gray" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["planned"], to: "in_progress", label: "شروع شمارش" },
      { from: ["in_progress"], to: "completed", label: "پایان شمارش" },
      { from: ["completed"], to: "closed", label: "بستن" },
      { from: ["planned", "in_progress"], to: "canceled", label: "لغو" },
    ],
  },
  scope: { own: ["owner_id"], group: "group_id" },
  features: { journal: true, attachments: true },
  form: { related: [{ table: "inventory_audit_item", field: "audit_id", label: "اقلام", columns: ["asset_id", "result", "scanned_at", "scanned_by", "scanned_code"] }] },
  list: { columns: ["number", "name", "stockroom_id", "location_id", "state", "expected_count", "found_count", "missing_count"], order: "-updated_at" },
};

export const AUDIT_RESULTS: Option[] = ordered([o("pending", "شمرده نشده", "gray"), o("found", "دیده شد", "green"), o("moved", "جابه‌جا", "gold"), o("missing", "دیده نشد", "red"), o("unexpected", "ناشناخته", "purple")]);

const auditItem: TableDef = {
  key: "inventory_audit_item",
  table: "sm_inventory_audit_items",
  label: "قلم شمارش",
  plural: "اقلام شمارش",
  icon: "scan-line",
  module: "itam",
  area: "asset",
  description: "هر دارایی مورد انتظار یا اسکن‌شده در یک شمارش و نتیجهٔ آن",
  display: "label",
  fields: [
    { name: "audit_id", label: "شمارش", type: "ref", ref: "inventory_audit", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", list: true, filter: true, index: true, span: 12 },
    { name: "expected", label: "مورد انتظار", type: "bool", default: false, filter: true, span: 6 },
    { name: "result", label: "نتیجه", type: "choice", choices: AUDIT_RESULTS, default: "pending", list: true, filter: true, span: 6 },
    { name: "scanned_code", label: "کد اسکن‌شده", type: "string", maxLength: 300, ltr: true, list: true, span: 12 },
    { name: "scanned_at", label: "زمان اسکن", type: "datetime", list: true, sort: true, span: 8 },
    { name: "scanned_by", label: "اسکن‌کننده", type: "user", list: true, span: 8 },
    { name: "note", label: "یادداشت", type: "string", maxLength: 300, span: 24 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: {},
  list: { columns: ["audit_id", "asset_id", "result", "scanned_code", "scanned_at", "scanned_by"], order: "-updated_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Repairs and disposal (ITAM-035/038)

const repair: TableDef = {
  key: "repair_order",
  table: "sm_repair_orders",
  label: "تعمیر دارایی",
  plural: "تعمیرهای دارایی",
  icon: "wrench",
  module: "itam",
  area: "asset",
  description: "تعمیر داخلی یا ارسال به تأمین‌کننده (RMA) با پوشش ضمانت، هزینه و دارایی جایگزین",
  numbered: { prefix: "RMA", pad: 6 },
  display: "title",
  fields: [
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "repair_kind", label: "گونه", type: "choice", choices: ordered([o("internal", "تعمیر داخلی", "teal"), o("vendor", "نزد تأمین‌کننده (RMA)", "orange")]), default: "internal", list: true, filter: true, span: 8 },
    { name: "vendor_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", list: true, filter: true, span: 8 },
    { name: "contract_id", label: "قرارداد ضمانت یا پشتیبانی", type: "ref", ref: "contract", span: 8 },
    { name: "under_warranty", label: "در ضمانت", type: "bool", readonly: true, default: false, filter: true, span: 6 },
    { name: "assigned_to", label: "کارشناس", type: "user", default: "$me", list: true, filter: true, span: 6 },
    { name: "group_id", label: "گروه", type: "group", filter: true, span: 6 },
    { name: "loaner_asset_id", label: "دارایی جایگزین", type: "ref", ref: "asset", span: 6 },
    { name: "fault", label: "شرح خرابی", type: "markdown", required: true, span: 24 },
    { name: "resolution", label: "کار انجام‌شده", type: "markdown", span: 24 },
    { name: "cost", label: "هزینه (ریال)", type: "money", list: true, sort: true, span: 8, group: "financial" },
    { name: "sent_at", label: "ارسال", type: "datetime", readonly: true, span: 8 },
    { name: "returned_at", label: "بازگشت", type: "datetime", readonly: true, span: 8 },
    { name: "previous_state", label: "وضعیت پیش از تعمیر", type: "string", maxLength: 30, system: true, hidden: true },
  ],
  states: {
    field: "state",
    initial: "new",
    states: [
      { value: "new", label: "تازه", category: "new", color: "blue" },
      { value: "diagnosing", label: "در حال عیب‌یابی", category: "active", color: "teal" },
      { value: "awaiting_vendor", label: "نزد تأمین‌کننده", category: "waiting", color: "gold" },
      { value: "awaiting_parts", label: "در انتظار قطعه", category: "waiting", color: "orange" },
      { value: "repaired", label: "تعمیرشده", category: "resolved", color: "green" },
      { value: "beyond_repair", label: "غیرقابل تعمیر", category: "resolved", color: "red" },
      { value: "closed", label: "بسته", category: "closed", color: "gray" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["new", "awaiting_parts", "awaiting_vendor"], to: "diagnosing", label: "عیب‌یابی" },
      { from: ["new", "diagnosing"], to: "awaiting_vendor", label: "ارسال به تأمین‌کننده", requires: ["vendor_id"] },
      { from: ["diagnosing", "awaiting_vendor"], to: "awaiting_parts", label: "در انتظار قطعه" },
      { from: ["new", "diagnosing", "awaiting_vendor", "awaiting_parts"], to: "repaired", label: "تعمیر شد", requires: ["resolution"] },
      { from: ["new", "diagnosing", "awaiting_vendor", "awaiting_parts"], to: "beyond_repair", label: "غیرقابل تعمیر", requires: ["resolution"] },
      { from: ["repaired", "beyond_repair"], to: "closed", label: "بستن" },
      { from: ["new", "diagnosing"], to: "canceled", label: "لغو" },
    ],
  },
  scope: { own: ["assigned_to"], group: "group_id" },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "asset_id", "title", "repair_kind", "vendor_id", "state", "cost"], order: "-updated_at" },
};

const disposal: TableDef = {
  key: "disposal_order",
  table: "sm_disposal_orders",
  label: "دستور اسقاط",
  plural: "دستورهای اسقاط",
  icon: "recycle",
  module: "itam",
  area: "asset",
  description: "اسقاط امن دسته‌ای از دارایی‌ها با تأیید، پاک‌سازی داده (NIST 800-88)، گواهی پاک‌سازی و روش بازیافت، فروش یا اهدا",
  numbered: { prefix: "DSP", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "method", label: "روش", type: "choice", choices: DISPOSAL_METHODS, default: "recycle", required: true, list: true, filter: true, span: 6 },
    { name: "vendor_id", label: "پیمانکار اسقاط", type: "ref", ref: "supplier", list: true, filter: true, span: 6 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { ...approvalField },
    { name: "certificate_no", label: "شمارهٔ گواهی پیمانکار", type: "string", maxLength: 80, ltr: true, span: 8 },
    { name: "certificate_date", label: "تاریخ گواهی", type: "date", span: 8 },
    { name: "proceeds", label: "درآمد فروش (ریال)", type: "money", span: 8, group: "financial" },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: {
    field: "state",
    initial: "requested",
    states: [
      { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
      { value: "approved", label: "تأییدشده", category: "active", color: "teal" },
      { value: "sanitizing", label: "در حال پاک‌سازی", category: "active", color: "gold" },
      { value: "awaiting_certificate", label: "در انتظار گواهی", category: "waiting", color: "orange" },
      { value: "completed", label: "اسقاط‌شده", category: "resolved", color: "green" },
      { value: "closed", label: "بسته", category: "closed", color: "gray" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["requested"], to: "approved", label: "تأیید", roles: { area: "asset", level: "full" } },
      { from: ["approved"], to: "sanitizing", label: "شروع پاک‌سازی" },
      { from: ["approved", "sanitizing"], to: "awaiting_certificate", label: "در انتظار گواهی" },
      { from: ["approved", "sanitizing", "awaiting_certificate"], to: "completed", label: "اسقاط انجام شد", guard: "disposal_can_complete" },
      { from: ["completed"], to: "closed", label: "بستن" },
      { from: ["requested", "approved"], to: "canceled", label: "لغو" },
    ],
  },
  scope: { own: ["owner_id"], requester: ["owner_id"], group: "group_id" },
  features: { journal: true, attachments: true },
  form: { related: [{ table: "disposal_item", field: "order_id", label: "دارایی‌ها", columns: ["asset_id", "sanitization_method", "sanitized_at", "certificate_no", "verified"] }] },
  list: { columns: ["number", "title", "method", "vendor_id", "state", "owner_id"], order: "-updated_at" },
};

const disposalItem: TableDef = {
  key: "disposal_item",
  table: "sm_disposal_items",
  label: "قلم اسقاط",
  plural: "اقلام اسقاط",
  icon: "file-badge",
  module: "itam",
  area: "asset",
  description: "یک دارایی در دستور اسقاط با روش پاک‌سازی داده، زمان، انجام‌دهنده و شمارهٔ گواهی (پروندهٔ گواهی پیوست می‌شود)",
  display: "label",
  fields: [
    { name: "order_id", label: "دستور اسقاط", type: "ref", ref: "disposal_order", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "asset_id", label: "دارایی", type: "ref", ref: "asset", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "sanitization_method", label: "روش پاک‌سازی", type: "choice", choices: SANITIZATION_METHODS, list: true, filter: true, span: 8 },
    { name: "sanitized_at", label: "زمان پاک‌سازی", type: "datetime", list: true, span: 8 },
    { name: "sanitized_by", label: "انجام‌دهنده", type: "user", span: 8 },
    { name: "certificate_no", label: "شمارهٔ گواهی پاک‌سازی", type: "string", maxLength: 80, ltr: true, list: true, search: true, span: 12 },
    { name: "verified", label: "بازبینی شد", type: "bool", default: false, list: true, filter: true, span: 12 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: {},
  features: { attachments: true },
  unique: [["order_id", "asset_id"]],
  list: { columns: ["order_id", "asset_id", "sanitization_method", "sanitized_at", "certificate_no", "verified"], order: "-updated_at" },
};

const labelTemplate: TableDef = {
  key: "label_template",
  table: "sm_label_templates",
  label: "الگوی برچسب",
  plural: "الگوهای برچسب",
  icon: "qr-code",
  module: "itam",
  area: "asset",
  description: "چیدمان برچسب‌های QR روی برگهٔ A4: ستون‌ها، ردیف‌ها، اندازه و حاشیه به میلی‌متر و آنچه روی برچسب می‌آید",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "is_default", label: "پیش‌فرض", type: "bool", default: false, list: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, span: 6 },
    { name: "cols_count", label: "ستون‌ها", type: "int", min: 1, max: 8, default: 3, list: true, span: 6 },
    { name: "rows_count", label: "ردیف‌ها", type: "int", min: 1, max: 20, default: 8, list: true, span: 6 },
    { name: "label_width_mm", label: "پهنا (میلی‌متر)", type: "decimal", default: "63.5", span: 6 },
    { name: "label_height_mm", label: "بلندی (میلی‌متر)", type: "decimal", default: "33.9", span: 6 },
    { name: "margin_top_mm", label: "حاشیهٔ بالا", type: "decimal", default: "13", span: 6 },
    { name: "margin_side_mm", label: "حاشیهٔ کناره", type: "decimal", default: "7", span: 6 },
    { name: "gap_x_mm", label: "فاصلهٔ افقی", type: "decimal", default: "2.5", span: 6 },
    { name: "gap_y_mm", label: "فاصلهٔ عمودی", type: "decimal", default: "0", span: 6 },
    { name: "fields", label: "روی برچسب", type: "multichoice", choices: ordered([o("tag", "برچسب اموال"), o("name", "نام"), o("model", "مدل"), o("serial", "سریال"), o("number", "شمارهٔ دارایی"), o("location", "مکان")]), default: ["tag", "name", "serial"], span: 24 },
    { name: "title", label: "سرعنوان برچسب", type: "string", maxLength: 80, span: 24, help: "مثلاً نام سازمان؛ خالی: بدون سرعنوان" },
  ],
  scope: { public: true },
  list: { columns: ["name", "cols_count", "rows_count", "is_default", "active"], order: "name" },
};

const catalogItemModel: TableDef = {
  key: "catalog_item_model",
  table: "sm_catalog_item_models",
  label: "مدل قلم کاتالوگ",
  plural: "مدل‌های اقلام کاتالوگ",
  icon: "link",
  module: "itam",
  area: "asset",
  description: "قلم کاتالوگی که دارایی از یک مدل تحویل می‌دهد: از موجودی رزرو می‌کند یا اگر موجود نیست درخواست خرید می‌سازد",
  display: "label",
  fields: [
    { name: "catalog_item_id", label: "قلم کاتالوگ", type: "ref", ref: "catalog_item", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "consume_stock", label: "از موجودی رزرو شود", type: "bool", default: true, list: true, span: 8 },
    { name: "raise_purchase", label: "نبودِ موجودی ← درخواست خرید", type: "bool", default: true, list: true, span: 8 },
    { name: "preference", label: "اولویت", type: "int", default: 1, min: 1, max: 99, sort: true, span: 8 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: { public: true },
  unique: [["catalog_item_id", "model_id"]],
  list: { columns: ["catalog_item_id", "model_id", "consume_stock", "raise_purchase", "preference"], order: "preference" },
};

// ---------------------------------------------------------------------------------------------------------------
// Procurement (ITAM-024/025/026)

export const REQUISITION_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "pending_approval", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "approved", label: "تأییدشده", category: "active", color: "teal" },
    { value: "ordered", label: "سفارش داده شد", category: "resolved", color: "blue" },
    { value: "closed", label: "بسته", category: "closed", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "pending_approval", label: "ارسال برای تأیید", guard: "requisition_has_lines" },
    { from: ["pending_approval"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["draft", "pending_approval"], to: "approved", label: "تأیید", roles: { area: "procurement", level: "full" }, guard: "requisition_has_lines" },
    { from: ["pending_approval"], to: "rejected", label: "رد", roles: { area: "procurement", level: "full" } },
    { from: ["approved"], to: "ordered", label: "ثبت سفارش" },
    { from: ["ordered"], to: "closed", label: "بستن" },
    { from: ["draft", "pending_approval", "approved"], to: "canceled", label: "لغو" },
  ],
};

const requisition: TableDef = {
  key: "purchase_requisition",
  table: "sm_purchase_requisitions",
  label: "درخواست خرید",
  plural: "درخواست‌های خرید",
  icon: "shopping-cart",
  module: "itam",
  area: "procurement",
  description: "درخواست خرید کالا از مدل‌های کاتالوگ با تأیید (مرکز هزینه، سقف مبلغ) پیش از سفارش",
  numbered: { prefix: "PRQ", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "requested_for", label: "برای", type: "user", default: "$me", list: true, filter: true, span: 6 },
    { name: "needed_by", label: "تاریخ نیاز", type: "date", list: true, sort: true, span: 6 },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 12 },
    { name: "supplier_id", label: "تأمین‌کنندهٔ پیشنهادی", type: "ref", ref: "supplier", filter: true, span: 12 },
    { name: "total", label: "جمع (ریال)", type: "money", readonly: true, list: true, sort: true, span: 8, group: "financial" },
    { ...approvalField },
    { name: "source", label: "منشأ", type: "choice", choices: ordered([o("manual", "دستی"), o("reorder", "کمبود موجودی"), o("request", "درخواست خدمت")]), default: "manual", readonly: true, filter: true, span: 8 },
    { name: "request_item_id", label: "قلم درخواست", type: "ref", ref: "request_item", readonly: true, span: 12 },
    { name: "stock_rule_id", label: "قاعدهٔ موجودی", type: "ref", ref: "stock_rule", readonly: true, span: 12 },
    { name: "purchase_order_id", label: "سفارش خرید", type: "ref", ref: "purchase_order", readonly: true, span: 12 },
    { name: "justification", label: "توجیه", type: "markdown", span: 24 },
  ],
  states: REQUISITION_STATES,
  scope: { own: ["requested_for"], requester: ["requested_for"] },
  features: { journal: true, attachments: true, links: true },
  form: { related: [{ table: "purchase_requisition_line", field: "requisition_id", label: "اقلام", columns: ["model_id", "description", "quantity", "unit_price", "amount"] }] },
  list: { columns: ["number", "title", "requested_for", "total", "state", "approval", "needed_by"], order: "-updated_at" },
};

const requisitionLine: TableDef = {
  key: "purchase_requisition_line",
  table: "sm_purchase_requisition_lines",
  label: "قلم درخواست خرید",
  plural: "اقلام درخواست خرید",
  icon: "list",
  module: "itam",
  area: "procurement",
  description: "یک مدل یا کالا در درخواست خرید با تعداد و بهای واحد",
  display: "description",
  fields: [
    { name: "requisition_id", label: "درخواست خرید", type: "ref", ref: "purchase_requisition", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", list: true, filter: true, span: 12, refFilter: { f: "status", op: "nin", v: ["prohibited"] } },
    { name: "description", label: "شرح", type: "string", maxLength: 300, list: true, search: true, span: 24, help: "خالی: نام مدل" },
    { name: "quantity", label: "تعداد", type: "int", min: 1, max: 100000, default: 1, required: true, list: true, span: 8 },
    { name: "unit_price", label: "بهای واحد", type: "money", list: true, span: 8, group: "financial", help: "خالی: بهای استاندارد مدل" },
    { name: "amount", label: "مبلغ", type: "money", readonly: true, list: true, span: 8, group: "financial" },
  ],
  scope: {},
  list: { columns: ["requisition_id", "model_id", "description", "quantity", "unit_price", "amount"], order: "requisition_id" },
};

export const PO_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "ordered", label: "سفارش‌شده", category: "active", color: "blue" },
    { value: "partially_received", label: "بخشی دریافت شد", category: "active", color: "gold" },
    { value: "received", label: "دریافت شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "ordered", label: "ثبت سفارش", requires: ["supplier_id"], guard: "po_has_lines" },
    { from: ["ordered", "partially_received"], to: "partially_received", label: "دریافت بخشی", roles: SYSTEM_ONLY("procurement") },
    { from: ["ordered", "partially_received"], to: "received", label: "دریافت کامل", roles: SYSTEM_ONLY("procurement") },
    { from: ["partially_received"], to: "received", label: "بستن با دریافت بخشی", requires: ["notes"] },
    { from: ["received"], to: "closed", label: "بستن" },
    { from: ["draft", "ordered"], to: "canceled", label: "لغو" },
  ],
};

const purchaseOrder: TableDef = {
  key: "purchase_order",
  table: "sm_purchase_orders",
  label: "سفارش خرید",
  plural: "سفارش‌های خرید",
  icon: "file-text",
  module: "itam",
  area: "procurement",
  description: "سفارش به تأمین‌کننده با سطرها، موعد تحویل و انبار مقصد؛ وضعیت از دریافت‌ها به دست می‌آید",
  numbered: { prefix: "PO", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "supplier_id", label: "تأمین‌کننده", type: "ref", ref: "supplier", list: true, filter: true, index: true, span: 12 },
    { name: "requisition_id", label: "درخواست خرید", type: "ref", ref: "purchase_requisition", filter: true, span: 12 },
    { name: "owner_id", label: "کارشناس خرید", type: "user", default: "$me", list: true, filter: true, span: 12 },
    { name: "order_date", label: "تاریخ سفارش", type: "date", default: "$today", list: true, sort: true, span: 6 },
    { name: "expected_date", label: "موعد تحویل", type: "date", list: true, sort: true, filter: true, span: 6 },
    { name: "delivery_stockroom_id", label: "انبار مقصد", type: "ref", ref: "stockroom", filter: true, span: 12 },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 12 },
    { name: "currency", label: "ارز", type: "choice", choices: CURRENCIES, default: "IRR", span: 6 },
    { name: "fx_rate", label: "نرخ تبدیل", type: "decimal", span: 6, group: "financial" },
    { name: "total", label: "جمع (ریال)", type: "money", readonly: true, list: true, sort: true, span: 6, group: "financial" },
    { name: "received_at", label: "دریافت کامل", type: "datetime", readonly: true, span: 6 },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: PO_STATES,
  scope: { own: ["owner_id"] },
  features: { journal: true, attachments: true, links: true },
  form: {
    related: [
      { table: "purchase_order_line", field: "po_id", label: "سطرها", columns: ["line_no", "model_id", "description", "quantity", "received_qty", "unit_price", "amount"] },
      { table: "goods_receipt", field: "po_id", label: "رسیدهای کالا", columns: ["number", "stockroom_id", "received_at", "state"] },
    ],
  },
  list: { columns: ["number", "title", "supplier_id", "order_date", "expected_date", "total", "state"], order: "-updated_at" },
};

const poLine: TableDef = {
  key: "purchase_order_line",
  table: "sm_purchase_order_lines",
  label: "سطر سفارش خرید",
  plural: "سطرهای سفارش خرید",
  icon: "list",
  module: "itam",
  area: "procurement",
  description: "یک مدل در سفارش با تعداد سفارش‌شده و دریافت‌شده",
  display: "description",
  fields: [
    { name: "po_id", label: "سفارش خرید", type: "ref", ref: "purchase_order", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "line_no", label: "ردیف", type: "int", min: 1, max: 9999, list: true, sort: true, span: 6 },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", list: true, filter: true, span: 12, refFilter: { f: "status", op: "nin", v: ["prohibited"] } },
    { name: "description", label: "شرح", type: "string", maxLength: 300, list: true, search: true, span: 24 },
    { name: "quantity", label: "تعداد", type: "int", min: 1, max: 100000, default: 1, required: true, list: true, span: 6 },
    { name: "received_qty", label: "دریافت‌شده", type: "int", readonly: true, default: 0, list: true, span: 6 },
    { name: "unit_price", label: "بهای واحد", type: "money", list: true, span: 6, group: "financial" },
    { name: "amount", label: "مبلغ", type: "money", readonly: true, list: true, span: 6, group: "financial" },
    { name: "requisition_line_id", label: "قلم درخواست خرید", type: "ref", ref: "purchase_requisition_line", readonly: true, span: 12 },
  ],
  scope: {},
  list: { columns: ["po_id", "line_no", "model_id", "description", "quantity", "received_qty", "amount"], order: "line_no" },
};

const receipt: TableDef = {
  key: "goods_receipt",
  table: "sm_goods_receipts",
  label: "رسید کالا",
  plural: "رسیدهای کالا",
  icon: "package-check",
  module: "itam",
  area: "procurement",
  description: "دریافت کالای یک سفارش در انبار؛ ثبت آن دارایی‌ها را با سریال، بها، ضمانت و قاعدهٔ استهلاک می‌سازد",
  numbered: { prefix: "GRN", pad: 6 },
  display: "number",
  fields: [
    { name: "po_id", label: "سفارش خرید", type: "ref", ref: "purchase_order", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "stockroom_id", label: "انبار", type: "ref", ref: "stockroom", required: true, list: true, filter: true, span: 12 },
    { name: "received_at", label: "زمان دریافت", type: "datetime", default: "$now", list: true, sort: true, span: 8 },
    { name: "received_by", label: "دریافت‌کننده", type: "user", default: "$me", list: true, span: 8 },
    { name: "assets_created", label: "دارایی‌های ساخته‌شده", type: "int", readonly: true, default: 0, list: true, span: 8 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
  ],
  states: {
    field: "state",
    initial: "draft",
    states: [
      { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
      { value: "posted", label: "ثبت‌شده", category: "closed", color: "green" },
      { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
    ],
    transitions: [
      { from: ["draft"], to: "posted", label: "ثبت دریافت", guard: "receipt_can_post" },
      { from: ["draft"], to: "canceled", label: "لغو" },
    ],
  },
  scope: {},
  features: { attachments: true },
  form: { related: [{ table: "goods_receipt_line", field: "receipt_id", label: "سطرها", columns: ["po_line_id", "model_id", "quantity", "serials"] }] },
  list: { columns: ["number", "po_id", "stockroom_id", "received_at", "assets_created", "state"], order: "-received_at" },
};

const receiptLine: TableDef = {
  key: "goods_receipt_line",
  table: "sm_goods_receipt_lines",
  label: "سطر رسید کالا",
  plural: "سطرهای رسید کالا",
  icon: "list",
  module: "itam",
  area: "procurement",
  description: "تعداد دریافت‌شده از یک سطر سفارش، با شماره‌سریال‌ها (هر خط یک سریال)",
  display: "label",
  fields: [
    { name: "receipt_id", label: "رسید", type: "ref", ref: "goods_receipt", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "po_line_id", label: "سطر سفارش", type: "ref", ref: "purchase_order_line", required: true, list: true, span: 12 },
    { name: "model_id", label: "مدل", type: "ref", ref: "asset_model", readonly: true, list: true, span: 12 },
    { name: "quantity", label: "تعداد", type: "int", min: 1, max: 10000, default: 1, required: true, list: true, span: 12 },
    { name: "serials", label: "شماره‌سریال‌ها", type: "text", ltr: true, span: 12, help: "هر خط یک سریال؛ برای اقلام تک‌به‌تک" },
    { name: "asset_tags", label: "برچسب‌های اموال", type: "text", ltr: true, span: 12, help: "اختیاری؛ هر خط یک برچسب، هم‌ترتیب با سریال‌ها" },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: {},
  list: { columns: ["receipt_id", "po_line_id", "model_id", "quantity"], order: "receipt_id" },
};

// ---------------------------------------------------------------------------------------------------------------
// Software asset management (ITAM-048/050/053/056/058/059/061/070)

const SW_MAIN = "اصلی";
const SW_MATCH = "یکسان‌سازی";

const softwareModel: TableDef = {
  key: "software_model",
  table: "sm_software_models",
  label: "مدل نرم‌افزار",
  plural: "مدل‌های نرم‌افزار",
  icon: "app-window",
  module: "itam",
  area: "software",
  description: "محصول‌های نرم‌افزاری یکسان‌سازی‌شده (ناشر، محصول، ویرایش) با معیار مجوز، وضعیت مجاز بودن و الگوهایی که نام‌های کشف‌شده را به آن می‌رسانند",
  numbered: { prefix: "SWM", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 12, section: SW_MAIN },
    { name: "publisher_id", label: "ناشر", type: "ref", ref: "supplier", list: true, filter: true, span: 12, section: SW_MAIN },
    { name: "product", label: "محصول", type: "string", maxLength: 160, search: true, span: 8, section: SW_MAIN },
    { name: "edition", label: "ویرایش", type: "string", maxLength: 80, span: 8, section: SW_MAIN },
    { name: "sw_version", label: "نسخه", type: "string", maxLength: 40, ltr: true, span: 8, section: SW_MAIN },
    { name: "category", label: "دسته", type: "choice", choices: "software_model.category", default: "other", list: true, filter: true, span: 8, section: SW_MAIN },
    { name: "license_metric", label: "معیار مجوز", type: "choice", choices: LICENSE_METRICS, default: "per_device", required: true, list: true, filter: true, span: 8, section: SW_MAIN },
    { name: "status", label: "وضعیت", type: "choice", choices: ordered([o("approved", "مجاز", "green"), o("restricted", "محدود", "gold"), o("prohibited", "ممنوع", "red"), o("under_review", "در بررسی", "gray")]), default: "approved", list: true, filter: true, span: 8, section: SW_MAIN },
    { name: "list_price", label: "بهای هر مجوز (ریال)", type: "money", span: 8, section: SW_MAIN, group: "financial" },
    { name: "eol_date", label: "پایان پشتیبانی", type: "date", filter: true, sort: true, span: 8, section: SW_MAIN },
    { name: "is_saas", label: "خدمت ابری (SaaS)", type: "bool", default: false, filter: true, span: 8, section: SW_MAIN },
    { name: "description", label: "توضیح", type: "text", span: 24, section: SW_MAIN },
    { name: "match_patterns", label: "الگوهای نام", type: "tags", span: 24, section: SW_MATCH, help: "بخشی از نام نصب‌شده (بی‌توجه به حروف)، یا عبارت منظم میان دو /" },
    { name: "publisher_patterns", label: "الگوهای ناشر", type: "tags", span: 24, section: SW_MATCH, help: "اگر پر باشد، ناشر نصب هم باید بخورد" },
    { name: "exclude_patterns", label: "الگوهای استثنا", type: "tags", span: 24, section: SW_MATCH, help: "نام‌هایی که با وجود شباهت این نرم‌افزار نیستند (مثلاً «Viewer»)" },
  ],
  scope: { public: true },
  features: { attachments: true },
  form: {
    sections: [SW_MAIN, SW_MATCH],
    related: [
      { table: "license_entitlement", field: "software_model_id", label: "مجوزها", columns: ["number", "name", "metric", "quantity", "end_date", "state"] },
      { table: "software_install", field: "software_model_id", label: "نصب‌ها", columns: ["ci_id", "raw_name", "raw_version", "user_id", "last_seen_at", "active"] },
    ],
  },
  list: { columns: ["number", "name", "publisher_id", "category", "license_metric", "status"], order: "name" },
};

const softwareInstall: TableDef = {
  key: "software_install",
  table: "sm_software_installs",
  label: "نصب نرم‌افزار",
  plural: "نصب‌های نرم‌افزار",
  icon: "hard-drive-download",
  module: "itam",
  area: "software",
  description: "نرم‌افزار نصب‌شده روی هر دستگاه — از جمع‌آورندهٔ موجودی (پایگاه پیکربندی)، ورود داده یا ثبت دستی — یکسان‌سازی‌شده به مدل نرم‌افزار",
  display: "raw_name",
  fields: [
    { name: "ci_id", label: "دستگاه", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "software_model_id", label: "مدل نرم‌افزار", type: "ref", ref: "software_model", list: true, filter: true, index: true, span: 12 },
    { name: "raw_name", label: "نام کشف‌شده", type: "string", required: true, maxLength: 300, list: true, search: true, span: 12 },
    { name: "raw_version", label: "نسخه", type: "string", maxLength: 80, ltr: true, list: true, span: 6 },
    { name: "raw_publisher", label: "ناشر کشف‌شده", type: "string", maxLength: 200, search: true, span: 6 },
    { name: "source", label: "منبع", type: "choice", choices: ordered([o("discovery", "جمع‌آورندهٔ موجودی", "blue"), o("import", "ورود داده", "teal"), o("manual", "دستی", "gray")]), default: "manual", list: true, filter: true, span: 8 },
    { name: "source_ci_id", label: "پیکربندی نرم‌افزار", type: "ref", ref: "ci", readonly: true, index: true, span: 8 },
    { name: "user_id", label: "کاربر دستگاه", type: "user", filter: true, list: true, span: 8 },
    { name: "cores", label: "هسته‌های دستگاه", type: "int", readonly: true, span: 6 },
    { name: "first_seen_at", label: "نخستین مشاهده", type: "datetime", readonly: true, sort: true, span: 6 },
    { name: "last_seen_at", label: "آخرین مشاهده", type: "datetime", readonly: true, audit: false, sort: true, list: true, span: 6 },
    { name: "last_used_at", label: "آخرین استفاده", type: "datetime", sort: true, filter: true, span: 6, help: "از اندازه‌گیری مصرف یا ورود داده؛ خالی: نامعلوم" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "removed_at", label: "برچیده‌شدن", type: "datetime", readonly: true, span: 6 },
    { name: "normalized_by", label: "یکسان‌سازی با", type: "choice", choices: ordered([o("rule", "الگو"), o("manual", "دستی"), o("none", "یکسان‌نشده")]), readonly: true, filter: true, span: 6 },
    { name: "reclaim_state", label: "بازپس‌گیری", type: "choice", choices: ordered([o("none", "—", "gray"), o("proposed", "پیشنهادشده", "gold"), o("notified", "به کاربر اطلاع داده شد", "orange"), o("reclaimed", "بازپس گرفته شد", "green"), o("opted_out", "کاربر نگه داشت", "blue")]), default: "none", filter: true, span: 6 },
  ],
  scope: { own: ["user_id"] },
  list: { columns: ["ci_id", "raw_name", "raw_version", "software_model_id", "user_id", "last_seen_at", "active"], order: "-last_seen_at" },
};

export const ENTITLEMENT_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "expired", label: "منقضی", category: "closed", color: "orange" },
    { value: "terminated", label: "خاتمه‌یافته", category: "closed", color: "red" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft", "expired"], to: "active", label: "فعال‌سازی", requires: ["quantity", "metric"] },
    { from: ["active"], to: "expired", label: "انقضا" },
    { from: ["active"], to: "terminated", label: "خاتمه" },
    { from: ["draft"], to: "canceled", label: "لغو" },
  ],
};

const entitlement: TableDef = {
  key: "license_entitlement",
  table: "sm_license_entitlements",
  label: "مجوز نرم‌افزار",
  plural: "مجوزهای نرم‌افزار",
  icon: "key-round",
  module: "itam",
  area: "software",
  description: "حق استفادهٔ خریداری‌شده: نرم‌افزار، معیار (دستگاه، کاربر، هسته، اشتراک…)، تعداد، تاریخ‌ها، بها، قرارداد و کلید (رمزنگاری‌شده)",
  numbered: { prefix: "ENT", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "software_model_id", label: "نرم‌افزار", type: "ref", ref: "software_model", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "metric", label: "معیار", type: "choice", choices: LICENSE_METRICS, default: "per_device", required: true, list: true, filter: true, span: 8 },
    { name: "quantity", label: "تعداد", type: "int", min: 0, max: 10000000, default: 1, required: true, list: true, sort: true, span: 8 },
    { name: "min_cores", label: "کمینهٔ هسته برای هر دستگاه", type: "int", min: 1, max: 256, default: 1, span: 8, help: "برای معیار هسته (مثلاً ۸ یا ۱۶)" },
    { name: "supplier_id", label: "فروشنده", type: "ref", ref: "supplier", filter: true, span: 12 },
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", filter: true, span: 12 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8 },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 8 },
    { name: "po_number", label: "شمارهٔ سفارش", type: "string", maxLength: 60, ltr: true, span: 8 },
    { name: "purchase_date", label: "تاریخ خرید", type: "date", sort: true, span: 6 },
    { name: "start_date", label: "شروع", type: "date", sort: true, span: 6 },
    { name: "end_date", label: "پایان", type: "date", list: true, sort: true, filter: true, index: true, span: 6, help: "خالی: دائمی" },
    { name: "true_up_date", label: "موعد تعدیل (True-up)", type: "date", sort: true, filter: true, span: 6 },
    { name: "unit_cost", label: "بهای واحد (ریال)", type: "money", span: 8, group: "financial" },
    { name: "total_cost", label: "بهای کل (ریال)", type: "money", list: true, sort: true, span: 8, group: "financial" },
    { name: "annual_cost", label: "هزینهٔ سالانه (ریال)", type: "money", span: 8, group: "financial", help: "برای اشتراک‌ها و پشتیبانی سالانه" },
    { name: "license_key", label: "کلید مجوز", type: "secret", span: 12 },
    { name: "downgrade_rights", label: "حق استفاده از نسخهٔ پایین‌تر", type: "bool", default: false, span: 6 },
    { name: "allocation_required", label: "تخصیص نام‌دار لازم است", type: "bool", default: false, span: 6, help: "مصرف از تخصیص‌ها شمرده می‌شود، نه از نصب‌ها" },
    { name: "reminded", label: "یادآوری‌های فرستاده", type: "json", system: true, hidden: true, audit: false },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: ENTITLEMENT_STATES,
  scope: { own: ["owner_id"] },
  features: { journal: true, attachments: true, links: true },
  form: { related: [{ table: "license_allocation", field: "entitlement_id", label: "تخصیص‌ها", columns: ["user_id", "ci_id", "allocated_at", "released_at", "active"] }] },
  list: { columns: ["number", "name", "software_model_id", "metric", "quantity", "end_date", "state", "total_cost"], order: "-updated_at" },
};

const allocation: TableDef = {
  key: "license_allocation",
  table: "sm_license_allocations",
  label: "تخصیص مجوز",
  plural: "تخصیص‌های مجوز",
  icon: "user-check",
  module: "itam",
  area: "software",
  description: "تخصیص نام‌دار یک مجوز به کاربر یا دستگاه",
  display: "label",
  fields: [
    { name: "entitlement_id", label: "مجوز", type: "ref", ref: "license_entitlement", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "کاربر", type: "user", list: true, filter: true, span: 6 },
    { name: "ci_id", label: "دستگاه", type: "ref", ref: "ci", list: true, filter: true, span: 6 },
    { name: "allocated_at", label: "تخصیص", type: "datetime", default: "$now", list: true, sort: true, span: 6 },
    { name: "released_at", label: "آزادسازی", type: "datetime", list: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "note", label: "یادداشت", type: "string", maxLength: 300, span: 18 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: { own: ["user_id"] },
  list: { columns: ["entitlement_id", "user_id", "ci_id", "allocated_at", "released_at", "active"], order: "-allocated_at" },
};

export const POSITION_STATUS: Option[] = ordered([
  o("compliant", "منطبق", "green"), o("under_licensed", "کمبود مجوز", "red"), o("over_licensed", "مجوز مازاد", "gold"), o("unlicensed", "بدون مجوز", "red"),
  o("unlimited", "نامحدود", "teal"), o("free", "رایگان", "gray"),
]);

const reconcileRun: TableDef = {
  key: "license_reconcile_run",
  table: "sm_license_reconcile_runs",
  label: "تطبیق مجوزها",
  plural: "اجراهای تطبیق مجوز",
  icon: "scale",
  module: "itam",
  area: "software",
  description: "هر بار محاسبهٔ وضعیت مؤثر مجوزها: نصب‌ها و تخصیص‌ها در برابر مجوزهای فعال (نوشتهٔ سامانه)",
  numbered: { prefix: "LRN", pad: 6 },
  display: "number",
  fields: [
    { name: "status", label: "وضعیت", type: "choice", choices: ordered([o("running", "در حال اجرا", "blue"), o("done", "انجام شد", "green"), o("failed", "ناموفق", "red")]), readonly: true, list: true, filter: true, span: 6 },
    { name: "trigger", label: "آغاز با", type: "choice", choices: ordered([o("manual", "دستی"), o("schedule", "زمان‌بندی"), o("change", "تغییر داده")]), readonly: true, list: true, span: 6 },
    { name: "started_at", label: "شروع", type: "datetime", readonly: true, list: true, sort: true, span: 6 },
    { name: "finished_at", label: "پایان", type: "datetime", readonly: true, span: 6 },
    { name: "products", label: "نرم‌افزارها", type: "int", readonly: true, list: true, span: 6 },
    { name: "compliant", label: "منطبق", type: "int", readonly: true, list: true, span: 6 },
    { name: "under_licensed", label: "کمبود مجوز", type: "int", readonly: true, list: true, span: 6 },
    { name: "over_licensed", label: "مازاد", type: "int", readonly: true, span: 6 },
    { name: "exposure", label: "ریسک کمبود (ریال)", type: "money", readonly: true, list: true, span: 8, group: "financial" },
    { name: "savings", label: "صرفه‌جویی ممکن (ریال)", type: "money", readonly: true, list: true, span: 8, group: "financial" },
    { name: "error", label: "خطا", type: "string", maxLength: 500, readonly: true, span: 24 },
  ],
  scope: {},
  form: { related: [{ table: "license_position", field: "run_id", label: "وضعیت هر نرم‌افزار", columns: ["software_model_id", "metric", "entitled", "consumed", "delta", "status"] }] },
  list: { columns: ["number", "status", "trigger", "started_at", "products", "compliant", "under_licensed", "exposure", "savings"], order: "-started_at" },
};

const position: TableDef = {
  key: "license_position",
  table: "sm_license_positions",
  label: "وضعیت مجوز",
  plural: "وضعیت مجوزها",
  icon: "shield-half",
  module: "itam",
  area: "software",
  description: "وضعیت مؤثر هر نرم‌افزار در یک تطبیق: مجوز در برابر مصرف، کسری یا مازاد، ریسک ریالی و صرفه‌جویی از نصب‌های بی‌استفاده",
  display: "label",
  fields: [
    { name: "run_id", label: "تطبیق", type: "ref", ref: "license_reconcile_run", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "software_model_id", label: "نرم‌افزار", type: "ref", ref: "software_model", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "metric", label: "معیار", type: "choice", choices: LICENSE_METRICS, list: true, filter: true, span: 6 },
    { name: "entitled", label: "مجوز", type: "int", readonly: true, list: true, span: 6 },
    { name: "consumed", label: "مصرف", type: "int", readonly: true, list: true, span: 6 },
    { name: "delta", label: "اختلاف", type: "int", readonly: true, list: true, sort: true, span: 6 },
    { name: "installs", label: "نصب‌ها", type: "int", readonly: true, span: 6 },
    { name: "devices", label: "دستگاه‌ها", type: "int", readonly: true, span: 6 },
    { name: "users", label: "کاربران", type: "int", readonly: true, span: 6 },
    { name: "unused_installs", label: "نصب‌های بی‌استفاده", type: "int", readonly: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: POSITION_STATUS, readonly: true, list: true, filter: true, span: 8 },
    { name: "unit_price", label: "بهای واحد", type: "money", readonly: true, span: 8, group: "financial" },
    { name: "exposure", label: "ریسک کمبود", type: "money", readonly: true, sort: true, span: 8, group: "financial" },
    { name: "savings", label: "صرفه‌جویی ممکن", type: "money", readonly: true, sort: true, span: 8, group: "financial" },
    { name: "detail", label: "جزئیات", type: "json", readonly: true, span: 24 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: {},
  list: { columns: ["software_model_id", "metric", "entitled", "consumed", "delta", "status", "exposure"], order: "delta" },
};

const saas: TableDef = {
  key: "saas_subscription",
  table: "sm_saas_subscriptions",
  label: "اشتراک SaaS",
  plural: "اشتراک‌های SaaS",
  icon: "cloud",
  module: "itam",
  area: "software",
  description: "اشتراک خدمت‌های ابری با صندلی‌های خریداری‌شده، واگذارشده و فعال، هزینه، تمدید و مالک",
  numbered: { prefix: "SAAS", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "supplier_id", label: "ارائه‌دهنده", type: "ref", ref: "supplier", list: true, filter: true, span: 12 },
    { name: "software_model_id", label: "مدل نرم‌افزار", type: "ref", ref: "software_model", filter: true, span: 12 },
    { name: "contract_id", label: "قرارداد", type: "ref", ref: "contract", filter: true, span: 12 },
    { name: "plan", label: "طرح", type: "string", maxLength: 80, span: 8 },
    { name: "billing_cycle", label: "دورهٔ صورت‌حساب", type: "choice", choices: ordered([o("monthly", "ماهانه"), o("annual", "سالانه")]), default: "annual", span: 8 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "seats", label: "صندلی خریداری‌شده", type: "int", min: 0, max: 10000000, default: 0, list: true, span: 6 },
    { name: "seats_assigned", label: "واگذارشده", type: "int", readonly: true, list: true, span: 6 },
    { name: "seats_active", label: "فعال (۳۰ روز)", type: "int", readonly: true, list: true, span: 6 },
    { name: "cost_per_seat", label: "بهای هر صندلی (ریال)", type: "money", span: 6, group: "financial" },
    { name: "annual_cost", label: "هزینهٔ سالانه (ریال)", type: "money", list: true, sort: true, span: 8, group: "financial" },
    { name: "renewal_date", label: "تمدید", type: "date", list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "auto_renew", label: "تمدید خودکار", type: "bool", default: true, filter: true, span: 8 },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 12 },
    { name: "sso", label: "ورود یکپارچه (SSO)", type: "bool", default: false, span: 6 },
    { name: "admin_url", label: "نشانی مدیریت", type: "url", ltr: true, span: 6 },
    { name: "reminded", label: "یادآوری‌های فرستاده", type: "json", system: true, hidden: true, audit: false },
    { name: "notes", label: "یادداشت", type: "markdown", span: 24 },
  ],
  states: {
    field: "state",
    initial: "active",
    states: [
      { value: "trial", label: "آزمایشی", category: "new", color: "blue" },
      { value: "active", label: "فعال", category: "active", color: "green" },
      { value: "cancel_pending", label: "در انتظار لغو", category: "waiting", color: "orange" },
      { value: "ended", label: "پایان‌یافته", category: "closed", color: "gray" },
    ],
    transitions: [
      { from: ["trial", "cancel_pending"], to: "active", label: "فعال‌سازی" },
      { from: ["active"], to: "cancel_pending", label: "لغو در پایان دوره" },
      { from: ["trial", "active", "cancel_pending"], to: "ended", label: "پایان" },
    ],
  },
  scope: { own: ["owner_id"] },
  features: { journal: true, attachments: true },
  form: { related: [{ table: "saas_account", field: "subscription_id", label: "حساب‌ها", columns: ["user_id", "email", "role", "last_active_at", "active"] }] },
  list: { columns: ["number", "name", "supplier_id", "seats", "seats_assigned", "seats_active", "annual_cost", "renewal_date", "state"], order: "renewal_date" },
};

const saasAccount: TableDef = {
  key: "saas_account",
  table: "sm_saas_accounts",
  label: "حساب SaaS",
  plural: "حساب‌های SaaS",
  icon: "user-round",
  module: "itam",
  area: "software",
  description: "حساب هر کاربر در یک اشتراک ابری با آخرین فعالیت (برای یافتن صندلی‌های بی‌استفاده)",
  display: "label",
  fields: [
    { name: "subscription_id", label: "اشتراک", type: "ref", ref: "saas_subscription", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "کاربر", type: "user", list: true, filter: true, span: 12 },
    { name: "email", label: "رایانامه", type: "email", ltr: true, list: true, search: true, group: "personal", span: 12 },
    { name: "external_id", label: "شناسهٔ بیرونی", type: "string", maxLength: 120, ltr: true, span: 12 },
    { name: "role", label: "نقش", type: "string", maxLength: 80, list: true, span: 8 },
    { name: "last_active_at", label: "آخرین فعالیت", type: "datetime", list: true, sort: true, filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "label", label: "شرح", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: { own: ["user_id"] },
  list: { columns: ["subscription_id", "user_id", "email", "role", "last_active_at", "active"], order: "-last_active_at" },
};

export const ITAM_CONFIG_DEFAULTS = {
  tag_prefix: "IT-",
  auto_ci: true,
  auto_assets: true,
  ack_expire_days: 14,
  ack_remind_days: 3,
  warranty_reminders: [90, 30, 7] as number[],
  unused_days: 90,
  qr_base_url: "",
};
export type ItamConfig = typeof ITAM_CONFIG_DEFAULTS;

const config: TableDef = {
  key: "itam_config",
  table: "sm_itam_configs",
  label: "تنظیمات دارایی‌ها",
  plural: "تنظیمات دارایی‌ها",
  icon: "settings-2",
  module: "itam",
  area: "settings",
  description: "پیشوند برچسب اموال، ساخت خودکار پیکربندی، تعهدنامه، یادآوری ضمانت، نصب‌های بی‌استفاده و نشانی QR",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات دارایی‌ها", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "tag_prefix", label: "پیشوند برچسب اموال", type: "string", maxLength: 12, ltr: true, default: ITAM_CONFIG_DEFAULTS.tag_prefix, span: 8 },
    { name: "auto_ci", label: "ساخت خودکار پیکربندی برای دارایی", type: "bool", default: true, span: 8, help: "برای مدل‌هایی که کلاس پیکربندی دارند" },
    { name: "auto_assets", label: "ساخت خودکار دارایی برای دستگاه‌های کشف‌شده", type: "bool", default: true, span: 8, help: "رایانه، سرور، گوشی و تجهیز شبکه‌ای که در پایگاه پیکربندی هست و دارایی ندارد، هر روز دارایی می‌گیرد" },
    { name: "ack_expire_days", label: "انقضای تعهدنامه (روز)", type: "int", min: 1, max: 365, default: ITAM_CONFIG_DEFAULTS.ack_expire_days, span: 8 },
    { name: "ack_remind_days", label: "یادآوری تعهدنامه هر چند روز", type: "int", min: 1, max: 60, default: ITAM_CONFIG_DEFAULTS.ack_remind_days, span: 8 },
    { name: "warranty_reminders", label: "یادآوری پایان ضمانت و اجاره (روز)", type: "json", default: ITAM_CONFIG_DEFAULTS.warranty_reminders, span: 8 },
    { name: "unused_days", label: "نصب بی‌استفاده پس از (روز)", type: "int", min: 7, max: 730, default: ITAM_CONFIG_DEFAULTS.unused_days, span: 8 },
    { name: "qr_base_url", label: "نشانی سامانه برای QR", type: "url", ltr: true, span: 24, help: "QR برچسب‌ها به صفحهٔ دارایی در این نشانی اشاره می‌کند؛ خالی: فقط برچسب اموال" },
    { name: "last_reconcile_at", label: "آخرین تطبیق مجوزها", type: "datetime", readonly: true, audit: false, span: 12 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  list: { columns: ["name", "tag_prefix", "auto_ci"], order: "name" },
};

export const ITAM_TABLES: TableDef[] = [
  depreciationRule, assetModel, hardwareStandard, stockroom, stockRule, stockMovement, asset, assignment, acknowledgement, reservation,
  audit, auditItem, repair, disposal, disposalItem, labelTemplate, catalogItemModel,
  requisition, requisitionLine, purchaseOrder, poLine, receipt, receiptLine,
  softwareModel, softwareInstall, entitlement, allocation, reconcileRun, position, saas, saasAccount, config,
];
