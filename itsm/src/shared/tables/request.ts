// Service request management and the service catalogue (docs/modules/request_FA.md, catalogue
// docs/catalog/g4_requests.md «Module: request»). Two areas:
//   catalog — the catalogue's definition, read by everyone who may order (`scope.public`) and changed by catalogue
//             administrators, or by an item's owner and editors / a catalogue's owner and managers with a write
//             grant of scope «own»: catalogues, categories, audiences («مخاطبان»), items (ITM, draft → review →
//             published → retired) with their immutable published versions, questions (variables) and shared
//             question sets (single-row or multi-row grids), form policies, fulfilment task templates, order-guide
//             rules and the module's settings row
//   request — what people order and the work it causes: carts and their lines (personal rows), requests (REQ, the
//             order header), requested items (RITM, one per line: answers, approvals, stage, SLA, due date) and
//             fulfilment tasks (RTSK), typed answer facts for reports, and subscriptions (SUB)
// States of requests roll up from their items and those of flow/template-driven items from their tasks; the module
// moves records along with transitions only the system may take (`SYSTEM_ONLY`), so people never see them as
// buttons. Imported by the UI: keep it free of server imports.
import type { AreaOp, FieldDef, Option, StateModel, TableDef } from "../model/types";
import type { Cond } from "../model/conditions";
import {
  AUDIENCE_MATCH, CART_KINDS, CATEGORY_ORDER, CLASSES_OF_SERVICE, FIELD_CLASSES, FREQUENCIES, FULFILMENT_MODES, ITEM_CLOSE_CODES, ITEM_TYPES, ON_BEHALF,
  PERSONAS, POLICY_SCOPES, REQUEST_CHANNELS, REQUESTER_CANCEL, STAGES, TASK_CLOSE_CODES, TASK_PHASES, VARIABLE_TYPE_OPTIONS,
} from "../request/vocab";

/** Transitions only the platform takes (roll-ups, approvals, fulfilment): no member holds the role. */
export const SYSTEM_ONLY = (area: string): AreaOp => ({ area, level: "view", roles: ["_system"] });

const meOnly: Cond = { f: "user_id", op: "is_me" };

const audienceFields = (section?: string): FieldDef[] => [
  { name: "available_for", label: "در دسترس برای", type: "refs", ref: "catalog_audience", span: 12, section, help: "خالی یعنی همه" },
  { name: "not_available_for", label: "در دسترس نیست برای", type: "refs", ref: "catalog_audience", span: 12, section, help: "بر «در دسترس برای» مقدم است" },
];

// ---------------------------------------------------------------------------------------------------------------
// The catalogue's definition (area catalog)

export const CATALOG: TableDef = {
  key: "catalog",
  table: "sm_catalogs",
  label: "کاتالوگ",
  plural: "کاتالوگ‌ها",
  icon: "library-big",
  module: "request",
  area: "catalog",
  description: "کاتالوگ‌های خدمت (فناوری اطلاعات، منابع انسانی، پشتیبانی…) با درخت دسته‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 6 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24 },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 8, help: "نام نماد lucide، مانند laptop" },
    { name: "color", label: "رنگ", type: "color", span: 8 },
    { name: "category_order", label: "ترتیب دسته‌ها", type: "choice", choices: CATEGORY_ORDER, default: "manual", span: 8 },
    { name: "banner", label: "پیام بالای کاتالوگ", type: "string", maxLength: 300, span: 24 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, span: 12 },
    { name: "managers", label: "مدیران کاتالوگ", type: "users", span: 12 },
    ...audienceFields("مخاطبان"),
  ],
  unique: [["name"]],
  scope: { public: true, own: ["owner_id", "managers"], requester: [] },
  list: { columns: ["name", "active", "sort_order", "owner_id", "updated_at"], order: "sort_order,name" },
  form: {
    sections: ["اصلی", "مخاطبان"],
    related: [
      { table: "catalog_category", field: "catalog_id", label: "دسته‌ها", columns: ["name", "parent_id", "sort_order", "active"] },
      { table: "catalog_item", field: "catalog_id", label: "اقلام", columns: ["number", "name", "type", "state", "category_id"] },
    ],
  },
};

export const CATALOG_CATEGORY: TableDef = {
  key: "catalog_category",
  table: "sm_catalog_categories",
  label: "دستهٔ کاتالوگ",
  plural: "دسته‌های کاتالوگ",
  icon: "folder-tree",
  module: "request",
  area: "catalog",
  description: "درخت دسته‌های هر کاتالوگ؛ برای کارشناسان گروه نوع درخواست در صف‌ها و گزارش‌ها هم هست",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "catalog_id", label: "کاتالوگ", type: "ref", ref: "catalog", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "parent_id", label: "دستهٔ بالاتر", type: "ref", ref: "$self", list: true, filter: true, span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24 },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 12 },
    ...audienceFields("مخاطبان"),
  ],
  scope: { public: true },
  list: { columns: ["name", "catalog_id", "parent_id", "sort_order", "active"], order: "sort_order,name" },
  form: { sections: ["اصلی", "مخاطبان"], related: [{ table: "catalog_item", field: "category_id", label: "اقلام", columns: ["number", "name", "type", "state"] }] },
};

export const CATALOG_AUDIENCE: TableDef = {
  key: "catalog_audience",
  table: "sm_catalog_audiences",
  label: "مخاطب کاتالوگ",
  plural: "مخاطبان کاتالوگ",
  icon: "users-round",
  module: "request",
  area: "catalog",
  description: "چه کسانی یک کاتالوگ، دسته یا قلم را می‌بینند و سفارش می‌دهند: افراد، گروه‌ها، واحدها، مکان‌ها، نقش‌ها یا شرطی بر نمایهٔ آن‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "match", label: "روش سنجش", type: "choice", choices: AUDIENCE_MATCH, default: "any", span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "users", label: "افراد", type: "users", span: 24 },
    { name: "groups", label: "گروه‌ها", type: "refs", ref: "group", span: 24 },
    { name: "units", label: "واحدهای سازمانی", type: "refs", ref: "org_unit", span: 18 },
    { name: "include_subunits", label: "با زیرمجموعه", type: "bool", default: true, span: 6 },
    { name: "locations", label: "مکان‌ها", type: "refs", ref: "location", span: 18 },
    { name: "include_sublocations", label: "با زیرمکان‌ها", type: "bool", default: true, span: 6 },
    { name: "roles", label: "نقش‌ها", type: "tags", span: 12, help: "کلید نقش‌ها، مانند agent" },
    { name: "personas", label: "پرسوناها", type: "multichoice", choices: PERSONAS, span: 12 },
    { name: "vip_only", label: "فقط افراد ویژه", type: "bool", default: false, span: 6 },
    { name: "condition", label: "شرط بر نمایهٔ عضو", type: "conditions", condTable: "member_profile", span: 24 },
    { name: "description", label: "شرح", type: "text", maxLength: 1000, span: 24 },
  ],
  unique: [["name"]],
  scope: { public: true },
  list: { columns: ["name", "match", "active", "updated_at"], order: "name" },
};

export const ITEM_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "gray" },
    { value: "review", label: "در بازبینی", category: "waiting", color: "gold" },
    { value: "published", label: "منتشرشده", category: "active", color: "green" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "review", label: "ارسال برای بازبینی" },
    { from: ["review"], to: "draft", label: "بازگرداندن به پیش‌نویس" },
    { from: ["published"], to: "retired", label: "بازنشسته کردن" },
    { from: ["retired"], to: "published", label: "بازگرداندن به کاتالوگ", guard: "has_version" },
    { from: ["retired"], to: "draft", label: "بازگشایی برای ویرایش" },
    // publishing snapshots a version first (POST /request/items/:id/publish)
    { from: ["draft", "review"], to: "published", label: "انتشار", roles: SYSTEM_ONLY("catalog") },
  ],
};

export const CATALOG_ITEM: TableDef = {
  key: "catalog_item",
  table: "sm_catalog_items",
  label: "قلم کاتالوگ",
  plural: "اقلام کاتالوگ",
  icon: "package",
  module: "request",
  area: "catalog",
  description: "مدل درخواست: پرسش‌ها، قیمت، زمان تحویل، تأیید، انجام و مخاطبان؛ هر انتشار نسخه‌ای ثابت می‌سازد",
  numbered: { prefix: "ITM", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, ai: { index: true } },
    { name: "code", label: "کد", type: "string", maxLength: 60, ltr: true, unique: true, list: true, search: true, span: 6, help: "کلید پایدار برای گردش‌کارها و API؛ خالی بماند خودکار ساخته می‌شود" },
    { name: "type", label: "نوع", type: "choice", choices: ITEM_TYPES, default: "standard", required: true, list: true, filter: true, span: 6 },
    { name: "catalog_id", label: "کاتالوگ", type: "ref", ref: "catalog", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "category_id", label: "دسته", type: "ref", ref: "catalog_category", list: true, filter: true, index: true, span: 12 },
    { name: "offering_id", label: "گزینهٔ خدمت", type: "ref", ref: "service_offering", filter: true, index: true, span: 12, help: "اگر تعیین شود، قلم فقط برای کسانی است که سبد خدمات به این گزینه حق استفاده داده است" },
    { name: "short_description", label: "خلاصه", type: "string", maxLength: 300, search: true, span: 24, ai: { index: true } },
    { name: "description", label: "شرح کامل", type: "markdown", search: true, span: 24, ai: { index: true } },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "color", label: "رنگ", type: "color", span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, span: 12, section: "مالکیت و نمایش" },
    { name: "editors", label: "ویرایشگران", type: "users", span: 12, section: "مالکیت و نمایش" },
    { name: "featured", label: "برگزیده", type: "bool", default: false, filter: true, span: 6, section: "مالکیت و نمایش" },
    { name: "hidden", label: "پنهان در فهرست", type: "bool", default: false, filter: true, span: 6, section: "مالکیت و نمایش", help: "فهرست نمی‌شود ولی با جست‌وجو و پیوند در دسترس است" },
    { name: "ad_hoc", label: "درخواست بدون مدل", type: "bool", default: false, filter: true, span: 6, section: "مالکیت و نمایش" },
    { name: "content_url", label: "نشانی محتوا", type: "url", span: 24, section: "مالکیت و نمایش" },
    { name: "button_label", label: "برچسب دکمهٔ سفارش", type: "string", maxLength: 40, span: 12, section: "مالکیت و نمایش" },
    { name: "title_template", label: "الگوی عنوان", type: "string", maxLength: 200, span: 12, section: "مالکیت و نمایش", help: "مثلاً {{item}} برای {{requested_for}} — {{model}}" },
    // ordering
    { name: "on_behalf", label: "سفارش برای دیگران", type: "choice", choices: ON_BEHALF, default: "anyone", span: 8, section: "سفارش" },
    { name: "multi_user", label: "سفارش برای چند نفر", type: "bool", default: false, span: 8, section: "سفارش" },
    { name: "cart_allowed", label: "افزودن به سبد", type: "bool", default: true, span: 8, section: "سفارش" },
    { name: "quantity_allowed", label: "تعیین تعداد", type: "bool", default: false, span: 8, section: "سفارش" },
    { name: "max_quantity", label: "حداکثر تعداد", type: "int", min: 1, max: 1000, default: 10, span: 8, section: "سفارش" },
    { name: "requester_edit", label: "ویرایش پاسخ‌ها تا پیش از تأیید", type: "bool", default: true, span: 8, section: "سفارش" },
    { name: "requester_cancel", label: "لغو به دست درخواست‌کننده", type: "choice", choices: REQUESTER_CANCEL, default: "before_fulfilment", span: 12, section: "سفارش" },
    { name: "requires_confirmation", label: "تأیید تحویل به دست درخواست‌کننده", type: "bool", default: true, span: 12, section: "سفارش" },
    // price and delivery
    { name: "price", label: "قیمت", type: "money", min: 0, list: true, span: 8, section: "قیمت و تحویل" },
    { name: "recurring_price", label: "هزینهٔ دوره‌ای", type: "money", min: 0, span: 8, section: "قیمت و تحویل" },
    { name: "recurring_frequency", label: "دورهٔ هزینه", type: "choice", choices: FREQUENCIES, span: 8, section: "قیمت و تحویل" },
    { name: "show_price", label: "نمایش قیمت به درخواست‌کننده", type: "bool", default: true, span: 8, section: "قیمت و تحویل" },
    { name: "creates_subscription", label: "ایجاد اشتراک پس از تحویل", type: "bool", default: false, span: 8, section: "قیمت و تحویل" },
    { name: "delivery_days", label: "زمان تحویل (روز کاری)", type: "int", min: 0, max: 365, span: 8, section: "قیمت و تحویل" },
    { name: "calendar_id", label: "تقویم کاری", type: "ref", ref: "calendar", span: 12, section: "قیمت و تحویل", help: "خالی: تقویم پیش‌فرض سازمان" },
    // fulfilment
    { name: "fulfilment_group_id", label: "گروه انجام", type: "group", filter: true, span: 12, section: "انجام" },
    { name: "flow_id", label: "گردش‌کار انجام", type: "ref", ref: "flow", refFilter: { f: "trigger", op: "in", v: ["catalog", "manual"] }, span: 12, section: "انجام" },
    { name: "approval_rule_id", label: "قاعدهٔ تأیید", type: "ref", ref: "approval_rule", span: 12, section: "انجام" },
    { name: "target_table", label: "جدول مقصد", type: "string", maxLength: 60, ltr: true, span: 12, section: "انجام", help: "فرم ثبت رکورد: کلید جدولی که رکورد در آن ساخته می‌شود" },
    { name: "field_map", label: "نگاشت فیلدها", type: "json", span: 24, section: "انجام", help: "{\"short_description\": \"{{subject}}\"}" },
    { name: "std_change_template", label: "الگوی تغییر استاندارد", type: "string", maxLength: 120, span: 12, section: "انجام" },
    { name: "variable_sets", label: "مجموعه‌پرسش‌ها", type: "refs", ref: "variable_set", span: 24, section: "انجام" },
    { name: "stages", label: "مرحله‌های نمایش پیشرفت", type: "multichoice", choices: "request_item.stage", span: 24, section: "انجام" },
    ...audienceFields("مخاطبان"),
    { name: "conversational", label: "سفارش در گفتگو با دستیار", type: "bool", default: true, span: 8, section: "مخاطبان" },
    { name: "review_interval_days", label: "بازبینی دوره‌ای (روز)", type: "int", min: 0, max: 3650, span: 8, section: "مخاطبان" },
    { name: "next_review_at", label: "بازبینی بعدی", type: "date", filter: true, sort: true, span: 8, section: "مخاطبان" },
    // published state
    { name: "version_no", label: "نسخهٔ منتشرشده", type: "int", readonly: true, list: true, span: 6, section: "نسخه" },
    { name: "version_id", label: "نسخهٔ جاری", type: "ref", ref: "catalog_item_version", readonly: true, span: 12, section: "نسخه" },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, sort: true, span: 6, section: "نسخه" },
    { name: "dirty", label: "تغییر منتشرنشده", type: "bool", default: false, readonly: true, filter: true, span: 6, section: "نسخه", audit: false },
    // statistics (nightly)
    { name: "sle_p50", label: "میانهٔ زمان انجام", type: "duration", readonly: true, span: 6, section: "آمار", audit: false },
    { name: "sle_p85", label: "انجام ۸۵٪ درخواست‌ها تا", type: "duration", readonly: true, span: 6, section: "آمار", audit: false },
    { name: "sle_p95", label: "انجام ۹۵٪ درخواست‌ها تا", type: "duration", readonly: true, span: 6, section: "آمار", audit: false },
    { name: "sle_samples", label: "تعداد نمونه‌ها", type: "int", readonly: true, span: 6, section: "آمار", audit: false },
    { name: "orders_90d", label: "سفارش‌های ۹۰ روز اخیر", type: "int", readonly: true, sort: true, span: 6, section: "آمار", audit: false },
  ],
  states: ITEM_STATES,
  scope: { public: true, own: ["owner_id", "editors"], requester: [] },
  features: { rag: true, attachments: true },
  ai: { title: "name", text: ["short_description", "description"] },
  list: { columns: ["number", "name", "type", "catalog_id", "category_id", "state", "version_no", "price"], order: "sort_order,name" },
  form: {
    sections: ["اصلی", "مالکیت و نمایش", "سفارش", "قیمت و تحویل", "انجام", "مخاطبان", "نسخه", "آمار"],
    related: [
      { table: "catalog_variable", field: "item_id", label: "پرسش‌ها", columns: ["sort_order", "label", "name", "type", "required"] },
      { table: "catalog_task_template", field: "item_id", label: "وظایف انجام", columns: ["sort_order", "short_description", "assignment_group_id"] },
      { table: "catalog_item_version", field: "item_id", label: "نسخه‌ها", columns: ["version_no", "note", "created_by", "created_at"] },
    ],
  },
};

export const CATALOG_ITEM_VERSION: TableDef = {
  key: "catalog_item_version",
  table: "sm_catalog_item_versions",
  label: "نسخهٔ قلم کاتالوگ",
  plural: "نسخه‌های قلم کاتالوگ",
  icon: "history",
  module: "request",
  area: "catalog",
  description: "نسخه‌های منتشرشده و تغییرناپذیر اقلام؛ هر قلم درخواست‌شده نسخه‌ای را که با آن سفارش داده شده نگه می‌دارد",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", readonly: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "item_id", label: "قلم", type: "ref", ref: "catalog_item", readonly: true, required: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_no", label: "نسخه", type: "int", readonly: true, list: true, sort: true, span: 6 },
    { name: "note", label: "یادداشت انتشار", type: "string", readonly: true, maxLength: 300, list: true, span: 18 },
    { name: "schema", label: "فرم و تنظیمات", type: "json", readonly: true, hidden: true, audit: false },
  ],
  unique: [["item_id", "version_no"]],
  scope: { public: true },
  list: { columns: ["title", "version_no", "note", "created_by", "created_at"], order: "-created_at" },
};

export const VARIABLE_SET: TableDef = {
  key: "variable_set",
  table: "sm_variable_sets",
  label: "مجموعه‌پرسش",
  plural: "مجموعه‌پرسش‌ها",
  icon: "list-checks",
  module: "request",
  area: "catalog",
  description: "پرسش‌های مشترک چند قلم (مانند «مرکز هزینه» یا «نشانی تحویل»)، یا جدولی چندسطری مانند «فهرست کاربران»",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", required: true, maxLength: 60, ltr: true, unique: true, list: true, span: 12, help: "حروف لاتین کوچک، رقم و _ ؛ کلید پاسخ‌های جدول" },
    { name: "multi_row", label: "جدول چندسطری", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "min_rows", label: "کمترین سطر", type: "int", min: 0, max: 500, default: 0, span: 8 },
    { name: "max_rows", label: "بیشترین سطر", type: "int", min: 1, max: 500, default: 20, span: 8 },
    { name: "shared", label: "در کتابخانهٔ مشترک", type: "bool", default: true, filter: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", maxLength: 1000, span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "code", "multi_row", "shared", "active"], order: "name" },
  form: { related: [{ table: "catalog_variable", field: "set_id", label: "پرسش‌ها", columns: ["sort_order", "label", "name", "type", "required"] }] },
};

export const CATALOG_VARIABLE: TableDef = {
  key: "catalog_variable",
  table: "sm_catalog_variables",
  label: "پرسش فرم",
  plural: "پرسش‌های فرم",
  icon: "text-cursor-input",
  module: "request",
  area: "catalog",
  description: "پرسش‌های فرم سفارش یک قلم یا یک مجموعه‌پرسش",
  display: "label",
  fields: [
    { name: "label", label: "پرسش", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "name", label: "نام فنی", type: "string", required: true, maxLength: 60, ltr: true, list: true, span: 6 },
    { name: "type", label: "نوع", type: "choice", choices: VARIABLE_TYPE_OPTIONS, required: true, default: "string", list: true, filter: true, span: 6 },
    { name: "item_id", label: "قلم", type: "ref", ref: "catalog_item", filter: true, index: true, span: 12 },
    { name: "set_id", label: "مجموعه‌پرسش", type: "ref", ref: "variable_set", filter: true, index: true, span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 6 },
    { name: "required", label: "الزامی", type: "bool", default: false, list: true, span: 6 },
    { name: "readonly", label: "فقط‌خواندنی", type: "bool", default: false, span: 6 },
    { name: "hidden", label: "پنهان", type: "bool", default: false, span: 6 },
    { name: "width", label: "پهنا", type: "choice", choices: [{ value: "full", label: "تمام عرض" }, { value: "half", label: "نیم عرض" }], default: "full", span: 6 },
    { name: "field_class", label: "ردهٔ داده", type: "choice", choices: FIELD_CLASSES, default: "public", span: 6 },
    { name: "default_value", label: "مقدار پیش‌فرض", type: "string", maxLength: 500, span: 12, help: "برای کاربر: $me؛ برای تاریخ: $today" },
    { name: "choices", label: "گزینه‌ها", type: "json", span: 24, help: "[{\"value\":\"a\",\"label\":\"…\",\"price\":\"0\"}]" },
    { name: "ref_table", label: "جدول ارجاع", type: "string", maxLength: 60, ltr: true, span: 12 },
    { name: "ref_filter", label: "شرط ارجاع", type: "conditions", condTableField: "ref_table", span: 24 },
    { name: "min", label: "کمینه", type: "decimal", span: 6 },
    { name: "max", label: "بیشینه", type: "decimal", span: 6 },
    { name: "max_length", label: "بیشترین طول", type: "int", min: 1, max: 20000, span: 6 },
    { name: "price_per_unit", label: "مبلغ هر واحد", type: "money", min: 0, span: 6, help: "برای پرسش عددی: به قیمت قلم افزوده می‌شود" },
    { name: "regex", label: "الگوی اعتبارسنجی", type: "string", maxLength: 300, ltr: true, span: 12 },
    { name: "regex_message", label: "پیام الگو", type: "string", maxLength: 200, span: 12 },
    { name: "help", label: "راهنما", type: "text", maxLength: 1000, span: 24 },
    { name: "placeholder", label: "متن نمونه", type: "string", maxLength: 120, span: 12 },
    { name: "map_to", label: "نگاشت به فیلد", type: "string", maxLength: 60, ltr: true, span: 12, help: "فیلد قلم درخواست‌شده (یا رکورد مقصد) که پاسخ در آن نوشته می‌شود" },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
  ],
  scope: { public: true },
  list: { columns: ["label", "name", "type", "item_id", "set_id", "sort_order", "required"], order: "sort_order,label" },
};

export const CATALOG_UI_POLICY: TableDef = {
  key: "catalog_ui_policy",
  table: "sm_catalog_ui_policies",
  label: "سیاست فرم سفارش",
  plural: "سیاست‌های فرم سفارش",
  icon: "sliders-horizontal",
  module: "request",
  area: "catalog",
  description: "شرط بر پاسخ‌ها ← نمایش، پنهان، الزامی یا فقط‌خواندنی کردن پرسش‌ها؛ در مرورگر و دوباره روی سرور",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "item_id", label: "قلم", type: "ref", ref: "catalog_item", filter: true, index: true, span: 12 },
    { name: "set_id", label: "مجموعه‌پرسش", type: "ref", ref: "variable_set", filter: true, index: true, span: 12 },
    { name: "applies_to", label: "کجا", type: "choice", choices: POLICY_SCOPES, default: "both", span: 12 },
    { name: "condition", label: "شرط", type: "json", span: 24 },
    { name: "actions", label: "اقدام‌ها", type: "json", span: 24, help: "[{\"variable\":\"end_date\",\"visible\":true,\"mandatory\":true}]" },
    { name: "message", label: "پیام", type: "string", maxLength: 300, span: 18 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
  ],
  scope: { public: true },
  list: { columns: ["name", "item_id", "set_id", "applies_to", "active"], order: "sort_order,name" },
};

export const CATALOG_TASK_TEMPLATE: TableDef = {
  key: "catalog_task_template",
  table: "sm_catalog_task_templates",
  label: "الگوی وظیفهٔ انجام",
  plural: "الگوهای وظیفهٔ انجام",
  icon: "list-ordered",
  module: "request",
  area: "catalog",
  description: "برنامهٔ انجام قلمی که گردش‌کار ندارد: وظایف به ترتیب، با گروه، دستورالعمل و وابستگی به وظیفهٔ پیشین",
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان وظیفه", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 8 },
    { name: "item_id", label: "قلم", type: "ref", ref: "catalog_item", required: true, filter: true, index: true, span: 12 },
    { name: "assignment_group_id", label: "گروه", type: "group", list: true, span: 12 },
    { name: "phase", label: "زمان ایجاد", type: "choice", choices: TASK_PHASES, default: "after_approval", span: 8 },
    { name: "depends_on_previous", label: "پس از پایان وظیفهٔ پیشین", type: "bool", default: true, span: 8 },
    { name: "requester_visible", label: "دیدنی برای درخواست‌کننده", type: "bool", default: false, span: 8 },
    { name: "class_of_service", label: "کلاس خدمت", type: "choice", choices: CLASSES_OF_SERVICE, default: "standard", span: 8 },
    { name: "condition", label: "فقط وقتی", type: "json", span: 16, help: "شرطی بر پاسخ‌ها؛ خالی یعنی همیشه" },
    { name: "instructions", label: "دستورالعمل", type: "markdown", span: 24 },
    { name: "checklist", label: "فهرست وارسی", type: "tags", span: 24 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
  ],
  scope: { public: true },
  list: { columns: ["sort_order", "short_description", "item_id", "assignment_group_id", "phase"], order: "sort_order" },
};

export const ORDER_GUIDE_RULE: TableDef = {
  key: "order_guide_rule",
  table: "sm_order_guide_rules",
  label: "قاعدهٔ راهنمای سفارش",
  plural: "قاعده‌های راهنمای سفارش",
  icon: "list-tree",
  module: "request",
  area: "catalog",
  description: "کدام اقلام، با چه شرطی بر پاسخ‌های راهنما، در سفارش گنجانده شوند و پاسخ‌ها به آن‌ها برسند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", maxLength: 120, list: true, search: true, span: 12 },
    { name: "guide_id", label: "راهنما", type: "ref", ref: "catalog_item", refFilter: { f: "type", op: "eq", v: "order_guide" }, required: true, list: true, filter: true, index: true, span: 12 },
    { name: "item_id", label: "قلم", type: "ref", ref: "catalog_item", required: true, list: true, span: 12 },
    { name: "condition", label: "شرط", type: "json", span: 24, help: "شرطی بر پاسخ‌های راهنما؛ خالی یعنی همیشه (بسته)" },
    { name: "mandatory", label: "اجباری", type: "bool", default: false, list: true, span: 6 },
    { name: "selected", label: "انتخاب پیش‌فرض", type: "bool", default: true, span: 6 },
    { name: "cascade", label: "رساندن پاسخ‌ها", type: "bool", default: true, span: 6 },
    { name: "quantity", label: "تعداد", type: "int", min: 1, max: 100, default: 1, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 6 },
  ],
  scope: { public: true },
  list: { columns: ["name", "guide_id", "item_id", "mandatory", "sort_order"], order: "sort_order" },
};

export const REQUEST_CONFIG: TableDef = {
  key: "request_config",
  table: "sm_request_configs",
  label: "تنظیمات درخواست خدمت",
  plural: "تنظیمات درخواست خدمت",
  icon: "settings-2",
  module: "request",
  area: "catalog",
  description: "یک ردیف برای سازمان: تأیید خودکار تحویل، یادآوری و لغو در انتظار اطلاعات، پنجرهٔ آمار و گروه پیش‌فرض",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات درخواست خدمت", maxLength: 80, span: 12 },
    { name: "confirm_days", label: "تأیید خودکار تحویل پس از (روز کاری)", type: "int", min: 0, max: 90, default: 5, span: 12 },
    { name: "info_reminder_days", label: "یادآوری در انتظار اطلاعات پس از (روز کاری)", type: "int", min: 0, max: 90, default: 2, span: 12 },
    { name: "info_cancel_days", label: "لغو در انتظار اطلاعات پس از (روز کاری)", type: "int", min: 0, max: 365, default: 10, span: 12 },
    { name: "sle_window_days", label: "پنجرهٔ آمار زمان انجام (روز)", type: "int", min: 7, max: 730, default: 90, span: 12 },
    { name: "default_group_id", label: "گروه پیش‌فرض انجام", type: "group", span: 12 },
    { name: "calendar_id", label: "تقویم کاری پیش‌فرض", type: "ref", ref: "calendar", span: 12 },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شده", type: "bool", default: false, readonly: true, span: 6 },
    { name: "seed_version", label: "نسخهٔ پیش‌فرض‌ها", type: "int", readonly: true, span: 6 },
  ],
  scope: { public: true },
  list: { columns: ["name", "confirm_days", "info_cancel_days", "updated_at"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Ordering and fulfilment (area request)

export const REQUEST_CART: TableDef = {
  key: "request_cart",
  table: "sm_request_carts",
  label: "سبد سفارش",
  plural: "سبدهای سفارش",
  icon: "shopping-cart",
  module: "request",
  area: "request",
  description: "سبد جاری، سبدهای ذخیره‌شده و فهرست علاقه‌مندی هر نفر (فقط برای خود او)",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "سبد سفارش", maxLength: 120, list: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: CART_KINDS, default: "cart", list: true, filter: true, span: 6 },
    { name: "user_id", label: "صاحب سبد", type: "user", default: "$me", required: true, index: true, span: 6 },
    { name: "requested_for", label: "درخواست برای", type: "user", span: 12 },
    { name: "location_id", label: "محل تحویل", type: "ref", ref: "location", span: 12 },
    { name: "needed_by", label: "تاریخ نیاز", type: "date", span: 12 },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, span: 12 },
    { name: "instructions", label: "توضیحات ویژه", type: "text", maxLength: 2000, span: 24 },
    { name: "request_id", label: "درخواست ثبت‌شده", type: "ref", ref: "request", readonly: true, span: 12 },
    { name: "checked_out_at", label: "زمان ثبت سفارش", type: "datetime", readonly: true, sort: true, filter: true, span: 12 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { read: meOnly, write: meOnly },
  features: { history: false },
  list: { columns: ["name", "kind", "requested_for", "checked_out_at", "updated_at"], order: "-updated_at" },
};

export const REQUEST_CART_LINE: TableDef = {
  key: "request_cart_line",
  table: "sm_request_cart_lines",
  label: "قلم سبد",
  plural: "اقلام سبد",
  icon: "shopping-basket",
  module: "request",
  area: "request",
  description: "یک قلم در سبد: نسخهٔ قلم، تعداد، پاسخ‌ها و این‌که برای چه کسی است",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", maxLength: 200, list: true, span: 12 },
    { name: "cart_id", label: "سبد", type: "ref", ref: "request_cart", required: true, index: true, span: 12 },
    { name: "user_id", label: "صاحب", type: "user", default: "$me", required: true, index: true, span: 12 },
    { name: "item_id", label: "قلم", type: "ref", ref: "catalog_item", required: true, list: true, span: 12 },
    { name: "version_id", label: "نسخه", type: "ref", ref: "catalog_item_version", readonly: true, span: 12 },
    { name: "quantity", label: "تعداد", type: "int", min: 1, max: 1000, default: 1, list: true, span: 6 },
    { name: "price", label: "قیمت", type: "money", readonly: true, list: true, span: 6 },
    { name: "requested_for", label: "درخواست برای", type: "user", span: 12 },
    { name: "requested_for_list", label: "برای این افراد", type: "users", span: 24 },
    { name: "answers", label: "پاسخ‌ها", type: "json", span: 24 },
    { name: "saved", label: "برای بعد", type: "bool", default: false, list: true, span: 6 },
    { name: "guide_id", label: "از راهنمای سفارش", type: "ref", ref: "catalog_item", readonly: true, span: 12 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { read: meOnly, write: meOnly },
  features: { history: false },
  list: { columns: ["title", "item_id", "quantity", "price", "saved"], order: "sort_order,created_at" },
};

const REQUEST_OPEN = ["submitted", "awaiting_approval", "in_fulfilment", "awaiting_info"];

export const REQUEST_STATES: StateModel = {
  field: "state",
  initial: "submitted",
  states: [
    { value: "submitted", label: "ثبت‌شده", category: "new", color: "blue" },
    { value: "awaiting_approval", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "in_fulfilment", label: "در حال انجام", category: "active", color: "teal" },
    { value: "awaiting_info", label: "در انتظار اطلاعات", category: "waiting", color: "orange" },
    { value: "delivered", label: "تحویل‌شده", category: "resolved", color: "green" },
    { value: "closed_complete", label: "انجام‌شده", category: "closed", color: "gray" },
    { value: "closed_incomplete", label: "بخشی انجام شد", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "closed", color: "red" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    // people cancel a whole order (its open items follow); everything else rolls up from the items
    { from: REQUEST_OPEN, to: "cancelled", label: "لغو درخواست", requires: ["close_notes"] },
    ...["submitted", "awaiting_approval", "in_fulfilment", "awaiting_info", "delivered", "closed_complete", "closed_incomplete", "rejected", "cancelled"].map((to) => ({
      from: "*" as const, to, label: "به‌روزرسانی از اقلام", roles: SYSTEM_ONLY("request"),
    })),
  ],
};

const ITEM_OPEN = ["pending", "awaiting_approval", "in_fulfilment", "awaiting_info", "backordered"];
const WORKING = ["in_fulfilment", "awaiting_info", "backordered"];

export const REQUEST_ITEM_STATES: StateModel = {
  field: "state",
  initial: "pending",
  states: [
    { value: "pending", label: "ثبت‌شده", category: "new", color: "blue" },
    { value: "awaiting_approval", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "in_fulfilment", label: "در حال انجام", category: "active", color: "teal" },
    { value: "awaiting_info", label: "در انتظار اطلاعات", category: "waiting", color: "orange" },
    { value: "backordered", label: "در انتظار تأمین", category: "waiting", color: "purple" },
    { value: "delivered", label: "تحویل‌شده", category: "resolved", color: "green" },
    { value: "closed_complete", label: "انجام‌شده", category: "closed", color: "gray" },
    { value: "closed_incomplete", label: "انجام ناقص", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "closed", color: "red" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    // «درخواست اطلاعات» (POST /request/items/:id/info) asks the requester a question and moves the item here
    { from: ["in_fulfilment", "backordered"], to: "awaiting_info", label: "درخواست اطلاعات", roles: SYSTEM_ONLY("request") },
    { from: ["awaiting_info", "backordered"], to: "in_fulfilment", label: "ادامهٔ انجام" },
    { from: ["delivered"], to: "in_fulfilment", label: "تحویل را نمی‌پذیرم" },
    { from: ["in_fulfilment", "awaiting_info"], to: "backordered", label: "در انتظار تأمین" },
    { from: WORKING, to: "delivered", label: "تحویل شد" },
    { from: ["delivered"], to: "closed_complete", label: "تأیید تحویل" },
    { from: WORKING, to: "closed_complete", label: "بستن (انجام‌شده)" },
    { from: [...WORKING, "delivered"], to: "closed_incomplete", label: "بستن (ناقص)", requires: ["close_notes"] },
    { from: ITEM_OPEN, to: "cancelled", label: "لغو", requires: ["close_notes"] },
    // the module moves a new item on: approvals, then fulfilment (or a rejection)
    { from: ["pending"], to: "awaiting_approval", label: "ارسال برای تأیید", roles: SYSTEM_ONLY("request") },
    { from: ["pending", "awaiting_approval"], to: "in_fulfilment", label: "شروع انجام", roles: SYSTEM_ONLY("request") },
    { from: ["pending", "awaiting_approval"], to: "rejected", label: "رد", roles: SYSTEM_ONLY("request") },
    { from: ["pending", "awaiting_approval"], to: "delivered", label: "تحویل شد", roles: SYSTEM_ONLY("request") },
    { from: ["pending", "awaiting_approval"], to: "closed_complete", label: "انجام شد", roles: SYSTEM_ONLY("request") },
  ],
};

export const REQUEST_TASK_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "pending", label: "در انتظار نوبت", category: "waiting", color: "gray" },
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "work_in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "on_hold", label: "معلق", category: "waiting", color: "gold" },
    { value: "closed_complete", label: "انجام‌شده", category: "closed", color: "green" },
    { value: "closed_incomplete", label: "انجام نشد", category: "closed", color: "red" },
    { value: "cancelled", label: "لغوشده", category: "canceled", color: "gray" },
    { value: "skipped", label: "لازم نشد", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open", "on_hold"], to: "work_in_progress", label: "شروع کار" },
    { from: ["open", "work_in_progress"], to: "on_hold", label: "تعلیق" },
    { from: ["open", "work_in_progress", "on_hold"], to: "closed_complete", label: "انجام شد" },
    { from: ["open", "work_in_progress", "on_hold"], to: "closed_incomplete", label: "انجام نشد", requires: ["close_notes"] },
    { from: ["pending", "open", "work_in_progress", "on_hold"], to: "skipped", label: "لازم نیست", requires: ["close_notes"] },
    { from: ["closed_complete", "closed_incomplete"], to: "work_in_progress", label: "بازگشایی" },
    { from: ["pending", "open", "work_in_progress", "on_hold"], to: "cancelled", label: "لغو", requires: ["close_notes"] },
    { from: ["pending"], to: "open", label: "نوبت رسید", roles: SYSTEM_ONLY("request") },
    { from: ["open"], to: "pending", label: "در انتظار وظیفهٔ پیشین", roles: SYSTEM_ONLY("request") },
  ],
};

const REQUESTER_FIELDS: FieldDef[] = [
  { name: "caller_id", label: "سفارش‌دهنده", type: "user" },
  { name: "requested_for", label: "درخواست برای", type: "user", list: true },
  { name: "channel", label: "مجرای سفارش", type: "choice", choices: REQUEST_CHANNELS },
];

export const REQUEST: TableDef = {
  key: "request",
  table: "sm_requests",
  label: "درخواست خدمت",
  plural: "درخواست‌های خدمت",
  icon: "shopping-bag",
  module: "request",
  area: "request",
  description: "سرآیند سفارش: یک یا چند قلم درخواست‌شده؛ وضعیت آن از اقلامش پیروی می‌کند",
  extends: "task",
  numbered: { prefix: "REQ", pad: 7 },
  display: "short_description",
  fields: [
    ...REQUESTER_FIELDS,
    { name: "category", label: "دسته", type: "choice", hidden: true },
    { name: "subcategory", label: "زیردسته", type: "choice", hidden: true },
    { name: "close_code", label: "نتیجهٔ بستن", type: "choice", choices: "request_item.close_code" },
    { name: "location_id", label: "محل تحویل", type: "ref" },
    { name: "needed_by", label: "تاریخ نیاز", type: "date", filter: true, sort: true, span: 8, section: "سفارش" },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 8, section: "سفارش" },
    { name: "items_count", label: "تعداد اقلام", type: "int", readonly: true, default: 0, list: true, span: 8, section: "سفارش" },
    { name: "total_price", label: "مبلغ کل", type: "money", readonly: true, list: true, span: 8, section: "سفارش" },
    { name: "recurring_total", label: "هزینهٔ دوره‌ای", type: "money", readonly: true, span: 8, section: "سفارش" },
    { name: "stage", label: "مرحله", type: "choice", choices: "request_item.stage", readonly: true, list: true, filter: true, span: 8, section: "سفارش" },
    // the people working its items and tasks (kept by the roll-up): they read the order header
    { name: "fulfillers", label: "انجام‌دهندگان", type: "users", readonly: true, hidden: true, audit: false },
  ],
  states: REQUEST_STATES,
  scope: {
    own: ["caller_id", "requested_for", "opened_by", "assigned_to", "fulfillers"],
    watchers: "watch_list",
    group: "assignment_group_id",
    requester: ["requested_for", "caller_id", "opened_by"],
    // close notes only with a cancellation (the module refuses them otherwise)
    requesterWritable: ["watch_list", "close_notes"],
    requesterTransitions: [{ from: REQUEST_OPEN, to: "cancelled" }],
  },
  features: { kanban: "state" },
  list: { columns: ["number", "short_description", "requested_for", "state", "items_count", "total_price", "opened_at"], order: "-opened_at" },
  form: {
    sections: ["اصلی", "سفارش"],
    related: [{ table: "request_item", field: "request_id", label: "اقلام درخواست", columns: ["number", "short_description", "cat_item_id", "state", "stage", "due_at"] }],
  },
};

export const REQUEST_ITEM: TableDef = {
  key: "request_item",
  table: "sm_request_items",
  label: "قلم درخواست‌شده",
  plural: "اقلام درخواست‌شده",
  icon: "package-check",
  module: "request",
  area: "request",
  description: "هر قلم سفارش با پاسخ‌ها، تأییدها، مرحله، موعد و وظایف انجام آن",
  extends: "task",
  numbered: { prefix: "RITM", pad: 7 },
  display: "short_description",
  fields: [
    ...REQUESTER_FIELDS,
    { name: "category", label: "دسته", type: "choice", hidden: true },
    { name: "subcategory", label: "زیردسته", type: "choice", hidden: true },
    { name: "close_code", label: "نتیجهٔ بستن", type: "choice" },
    { name: "location_id", label: "محل تحویل", type: "ref" },
    { name: "request_id", label: "درخواست", type: "ref", ref: "request", readonly: true, list: true, filter: true, index: true, span: 8, section: "سفارش" },
    { name: "cat_item_id", label: "قلم کاتالوگ", type: "ref", ref: "catalog_item", required: true, list: true, filter: true, index: true, span: 8, section: "سفارش" },
    { name: "item_version_id", label: "نسخهٔ قلم", type: "ref", ref: "catalog_item_version", readonly: true, span: 8, section: "سفارش" },
    { name: "category_id", label: "دستهٔ کاتالوگ", type: "ref", ref: "catalog_category", readonly: true, filter: true, span: 8, section: "سفارش" },
    { name: "quantity", label: "تعداد", type: "int", min: 1, max: 1000, default: 1, list: true, span: 8, section: "سفارش" },
    { name: "stage", label: "مرحله", type: "choice", choices: "$table.stage", list: true, filter: true, span: 8, section: "سفارش" },
    // answers are checked against the item's version on create; later only «ویرایش پاسخ‌ها» changes them
    { name: "answers", label: "پاسخ‌ها", type: "json", hidden: true, audit: false },
    { name: "private_answers", label: "پاسخ‌های حساس", type: "json", readonly: true, hidden: true, audit: false, group: "personal" },
    // sealed JSON of the secret answers: no hint (the last characters of the text are the last answer's)
    { name: "secret_answers", label: "پاسخ‌های محرمانه", type: "secret", readonly: true, hidden: true, hint: false },
    { name: "price", label: "قیمت واحد", type: "money", readonly: true, span: 8, section: "سفارش" },
    { name: "total", label: "مبلغ", type: "money", readonly: true, list: true, span: 8, section: "سفارش" },
    { name: "recurring_price", label: "هزینهٔ دوره‌ای", type: "money", readonly: true, span: 8, section: "سفارش" },
    { name: "recurring_frequency", label: "دورهٔ هزینه", type: "choice", choices: FREQUENCIES, readonly: true, span: 8, section: "سفارش" },
    { name: "cost", label: "هزینهٔ واقعی", type: "money", min: 0, group: "financial", span: 8, section: "سفارش" },
    { name: "ad_hoc", label: "بدون مدل", type: "bool", default: false, readonly: true, filter: true, span: 8, section: "سفارش" },
    { name: "fulfilment", label: "روش انجام", type: "choice", choices: FULFILMENT_MODES, readonly: true, filter: true, span: 8, section: "انجام" },
    { name: "approval_rule_id", label: "قاعدهٔ تأیید", type: "ref", ref: "approval_rule", readonly: true, span: 8, section: "انجام" },
    { name: "produced_table", label: "جدول رکورد ساخته‌شده", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true, span: 8, section: "انجام" },
    { name: "produced_id", label: "رکورد ساخته‌شده", type: "string", maxLength: 60, ltr: true, readonly: true, hidden: true, span: 8, section: "انجام" },
    { name: "requires_confirmation", label: "تأیید تحویل لازم است", type: "bool", default: false, readonly: true, span: 8, section: "انجام" },
    { name: "access_until", label: "پایان دسترسی", type: "date", filter: true, sort: true, span: 8, section: "انجام" },
    { name: "revoked_at", label: "زمان لغو دسترسی", type: "datetime", readonly: true, span: 8, section: "انجام" },
    { name: "subscription_id", label: "اشتراک", type: "ref", ref: "request_subscription", readonly: true, span: 8, section: "انجام" },
    // the service offering's entitlement when the item was ordered (SPF-014): offering, service, basis, agreements
    { name: "entitlement", label: "حق استفاده هنگام سفارش", type: "json", readonly: true, hidden: true, audit: false },
    { name: "flow_runs", label: "اجراهای گردش‌کار", type: "tags", readonly: true, hidden: true, audit: false },
    // the people working its tasks (kept by the roll-up): they read the item and its answers
    { name: "fulfillers", label: "انجام‌دهندگان", type: "users", readonly: true, hidden: true, audit: false },
    // the requester's feedback once the item is delivered (REQ-046)
    { name: "rating", label: "رضایت از انجام", type: "rating", min: 1, max: 5, span: 8, section: "بازخورد" },
    { name: "feedback", label: "نظر درخواست‌کننده", type: "text", maxLength: 2000, span: 16, section: "بازخورد" },
    // KPI stamps (docs/modules/request_FA.md «شاخص‌ها»)
    { name: "sle_p85", label: "انتظار آماری انجام (۸۵٪)", type: "duration", readonly: true, span: 8, section: "شاخص‌ها" },
    { name: "approval_requested_at", label: "زمان درخواست تأیید", type: "datetime", readonly: true, span: 8, section: "شاخص‌ها" },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", readonly: true, sort: true, span: 8, section: "شاخص‌ها" },
    { name: "fulfilment_started_at", label: "زمان شروع انجام", type: "datetime", readonly: true, sort: true, span: 8, section: "شاخص‌ها" },
    { name: "info_requested", label: "اطلاعات خواسته شد", type: "bool", default: false, readonly: true, filter: true, span: 8, section: "شاخص‌ها" },
    { name: "info_since", label: "در انتظار اطلاعات از", type: "datetime", readonly: true, span: 8, section: "شاخص‌ها" },
    { name: "info_wait", label: "زمان انتظار برای درخواست‌کننده", type: "duration", readonly: true, span: 8, section: "شاخص‌ها" },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", readonly: true, span: 8, section: "شاخص‌ها" },
    { name: "zero_touch", label: "انجام کاملاً خودکار", type: "bool", default: false, readonly: true, filter: true, span: 8, section: "شاخص‌ها" },
  ],
  states: REQUEST_ITEM_STATES,
  scope: {
    own: ["caller_id", "requested_for", "opened_by", "assigned_to", "fulfillers"],
    watchers: "watch_list",
    group: "assignment_group_id",
    requester: ["requested_for", "caller_id", "opened_by"],
    requesterWritable: ["watch_list", "rating", "feedback", "close_notes"],
    requesterTransitions: [
      { from: ["delivered"], to: "closed_complete" },
      { from: ["delivered"], to: "in_fulfilment" },
      { from: ITEM_OPEN, to: "cancelled" },
    ],
  },
  features: { sla: true, approvals: true, kanban: "state" },
  list: { columns: ["number", "short_description", "cat_item_id", "requested_for", "state", "stage", "assignment_group_id", "assigned_to", "due_at"], order: "-opened_at" },
  form: {
    sections: ["اصلی", "سفارش", "انجام", "بازخورد", "شاخص‌ها"],
    related: [{ table: "request_task", field: "request_item_id", label: "وظایف انجام", columns: ["number", "short_description", "state", "assignment_group_id", "assigned_to", "sort_order"] }],
  },
};

export const REQUEST_TASK: TableDef = {
  key: "request_task",
  table: "sm_request_tasks",
  label: "وظیفهٔ انجام",
  plural: "وظایف انجام",
  icon: "list-todo",
  module: "request",
  area: "request",
  description: "کاری که برای انجام یک قلم درخواست‌شده لازم است؛ از الگوهای قلم یا گردش‌کار ساخته می‌شود",
  extends: "task",
  numbered: { prefix: "RTSK", pad: 7 },
  display: "short_description",
  fields: [
    { name: "category", label: "دسته", type: "choice", hidden: true },
    { name: "subcategory", label: "زیردسته", type: "choice", hidden: true },
    { name: "close_code", label: "نتیجه", type: "choice", choices: "request_task.close_code" },
    { name: "caller_id", label: "درخواست‌دهنده", type: "user", default: null },
    { name: "request_item_id", label: "قلم درخواست‌شده", type: "ref", ref: "request_item", required: true, list: true, filter: true, index: true, span: 8, section: "انجام" },
    { name: "request_id", label: "درخواست", type: "ref", ref: "request", readonly: true, filter: true, index: true, span: 8, section: "انجام" },
    { name: "template_id", label: "الگو", type: "ref", ref: "catalog_task_template", readonly: true, span: 8, section: "انجام" },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, list: true, sort: true, span: 8, section: "انجام" },
    { name: "depends_on", label: "پس از", type: "ref", ref: "$self", span: 8, section: "انجام" },
    { name: "requester_visible", label: "دیدنی برای درخواست‌کننده", type: "bool", default: false, filter: true, span: 8, section: "انجام" },
    { name: "instructions", label: "دستورالعمل", type: "markdown", span: 24, section: "انجام" },
    { name: "checklist", label: "فهرست وارسی", type: "json", hidden: true },
    { name: "class_of_service", label: "کلاس خدمت", type: "choice", choices: CLASSES_OF_SERVICE, default: "standard", list: true, filter: true, span: 8, section: "جریان کار" },
    { name: "blocked", label: "مسدود", type: "bool", default: false, list: true, filter: true, span: 8, section: "جریان کار" },
    { name: "blocked_reason", label: "علت انسداد", type: "string", maxLength: 300, span: 8, section: "جریان کار" },
    { name: "blocked_since", label: "مسدود از", type: "datetime", readonly: true, span: 8, section: "جریان کار" },
    { name: "blocked_time", label: "زمان مسدود بودن", type: "duration", readonly: true, span: 8, section: "جریان کار" },
    { name: "deviation", label: "خارج از دستورالعمل", type: "bool", default: false, filter: true, span: 8, section: "جریان کار" },
    { name: "deviation_note", label: "شرح انحراف", type: "string", maxLength: 300, span: 16, section: "جریان کار" },
    // the revocation of time-bound access (the sweep makes it): it outlives the item, which closes before access ends
    { name: "revocation", label: "لغو دسترسی", type: "bool", default: false, readonly: true, filter: true, span: 8, section: "جریان کار" },
  ],
  states: REQUEST_TASK_STATES,
  scope: {
    own: ["assigned_to", "requested_for"],
    watchers: "watch_list",
    group: "assignment_group_id",
    // requested_for is filled only while the task is requester-visible: requesters read those tasks, never change them
    requester: ["requested_for"],
    requesterWritable: [],
    requesterTransitions: [],
  },
  features: { sla: true, kanban: "state" },
  list: { columns: ["number", "short_description", "request_item_id", "state", "assignment_group_id", "assigned_to", "class_of_service", "due_at"], order: "sort_order,-opened_at" },
  form: { sections: ["اصلی", "انجام", "جریان کار"] },
};

export const REQUEST_ANSWER: TableDef = {
  key: "request_answer",
  table: "sm_request_answers",
  label: "پاسخ سفارش",
  plural: "پاسخ‌های سفارش",
  icon: "table-properties",
  module: "request",
  area: "request",
  description: "پاسخ‌های عمومی و شخصی هر قلم به‌صورت دادهٔ نوع‌دار برای قاعده‌ها و گزارش‌ها (پاسخ‌های حساس و محرمانه در آن نمی‌آیند)",
  display: "label",
  fields: [
    { name: "label", label: "پرسش", type: "string", readonly: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "variable", label: "نام فنی", type: "string", readonly: true, maxLength: 60, ltr: true, list: true, filter: true, index: true, span: 12 },
    { name: "request_item_id", label: "قلم درخواست‌شده", type: "ref", ref: "request_item", readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "item_id", label: "قلم کاتالوگ", type: "ref", ref: "catalog_item", readonly: true, filter: true, index: true, span: 12 },
    { name: "value_text", label: "مقدار", type: "string", readonly: true, maxLength: 500, list: true, search: true, filter: true, span: 12 },
    { name: "value_num", label: "مقدار عددی", type: "decimal", readonly: true, filter: true, sort: true, span: 6 },
    { name: "value_date", label: "مقدار تاریخ", type: "date", readonly: true, filter: true, sort: true, span: 6 },
    { name: "requested_for", label: "درخواست برای", type: "user", readonly: true, span: 12 },
    { name: "caller_id", label: "سفارش‌دهنده", type: "user", readonly: true, span: 12 },
    { name: "assignment_group_id", label: "گروه", type: "group", readonly: true, span: 12 },
  ],
  scope: { own: ["requested_for", "caller_id"], group: "assignment_group_id", requester: ["requested_for", "caller_id"], requesterWritable: [], requesterTransitions: [] },
  features: { history: false },
  list: { columns: ["request_item_id", "label", "value_text", "value_num", "value_date"], order: "-created_at" },
};

export const SUBSCRIPTION_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
    { value: "active", label: "فعال", category: "active", color: "green" },
    { value: "suspended", label: "معلق", category: "waiting", color: "gold" },
    { value: "cancelled", label: "لغوشده", category: "closed", color: "gray" },
    { value: "expired", label: "منقضی", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["requested", "suspended"], to: "active", label: "فعال‌سازی" },
    { from: ["active"], to: "suspended", label: "تعلیق" },
    { from: ["requested", "active", "suspended"], to: "cancelled", label: "لغو اشتراک" },
    { from: ["active", "suspended"], to: "expired", label: "پایان دوره", roles: SYSTEM_ONLY("request") },
  ],
};

export const REQUEST_SUBSCRIPTION: TableDef = {
  key: "request_subscription",
  table: "sm_request_subscriptions",
  label: "اشتراک خدمت",
  plural: "اشتراک‌های خدمت",
  icon: "repeat",
  module: "request",
  area: "request",
  description: "آنچه هر نفر یا واحد مصرف می‌کند: از تحویل اقلام دارای هزینهٔ دوره‌ای ساخته می‌شود",
  numbered: { prefix: "SUB", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "item_id", label: "قلم کاتالوگ", type: "ref", ref: "catalog_item", required: true, list: true, filter: true, span: 12 },
    { name: "subscriber_id", label: "مشترک", type: "user", required: true, list: true, filter: true, span: 12 },
    { name: "request_item_id", label: "قلم درخواست‌شده", type: "ref", ref: "request_item", readonly: true, span: 12 },
    { name: "quantity", label: "تعداد", type: "int", min: 1, default: 1, span: 6 },
    { name: "recurring_price", label: "هزینهٔ دوره‌ای", type: "money", min: 0, list: true, span: 12 },
    { name: "recurring_frequency", label: "دوره", type: "choice", choices: FREQUENCIES, span: 6 },
    { name: "start_on", label: "آغاز", type: "date", list: true, sort: true, span: 12 },
    { name: "end_on", label: "پایان", type: "date", filter: true, sort: true, span: 12 },
    { name: "notes", label: "یادداشت", type: "text", maxLength: 2000, span: 24 },
  ],
  states: SUBSCRIPTION_STATES,
  scope: {
    own: ["subscriber_id"],
    requester: ["subscriber_id"],
    requesterWritable: [],
    requesterTransitions: [{ from: ["requested", "active", "suspended"], to: "cancelled" }],
  },
  list: { columns: ["number", "name", "subscriber_id", "state", "recurring_price", "start_on", "end_on"], order: "-created_at" },
};

/** Every table of the module (listed once in MODULE_TABLES). */
export const REQUEST_TABLES: TableDef[] = [
  CATALOG, CATALOG_CATEGORY, CATALOG_AUDIENCE, CATALOG_ITEM, CATALOG_ITEM_VERSION, VARIABLE_SET, CATALOG_VARIABLE, CATALOG_UI_POLICY,
  CATALOG_TASK_TEMPLATE, ORDER_GUIDE_RULE, REQUEST_CONFIG, REQUEST_CART, REQUEST_CART_LINE, REQUEST, REQUEST_ITEM, REQUEST_TASK,
  REQUEST_ANSWER, REQUEST_SUBSCRIPTION,
];

/** Default options of the module's tenant-editable choice lists. */
export const REQUEST_CHOICE_LISTS: Record<string, Option[]> = {
  "request_item.stage": STAGES,
  "request_item.close_code": ITEM_CLOSE_CODES,
  "request_task.close_code": TASK_CLOSE_CODES,
};

/** Open states (by table) — the module's queues and roll-ups. */
export const OPEN_ITEM_STATES = ITEM_OPEN;
export const OPEN_REQUEST_STATES = REQUEST_OPEN;
export const WORKING_ITEM_STATES = WORKING;
