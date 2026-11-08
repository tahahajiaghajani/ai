// Tables of configuration management (docs/modules/cmdb_FA.md, catalogue docs/catalog/g6_config_assets.md «Module:
// cmdb»): the CI class registry with class-specific attributes, the CIs themselves (one table for every class — the
// class's attributes live in `attrs`, validated against the class), typed effective-dated relationships, CI groups and
// redundancy groups, the reconciliation engine's sources and rules, import runs, health facts, data-quality and audit
// rules with their findings, de-duplication tasks, baselines, drift, impact simulations, saved maps and queries, the
// local discovery collector, certification campaigns and the module's settings row. Behaviour lives in
// src/server/modules/cmdb (hooks, graph and impact services, reconciliation, health, jobs, routes); the record UI renders
// everything from these definitions (src/ui/modules/cmdb).
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { TASK_FIELDS, TASK_SCOPE } from "../model/task";
import {
  CI_CRITICALITY, CI_ENVIRONMENTS, CLASS_OPTIONS, HEALTH_ISSUES, IMPACT_DIRS, INSTALL_STATUSES, OPERATIONAL_STATUSES, REL_CATEGORIES,
  REL_ORIGINS, REL_TYPE_OPTIONS, CLASS_FAMILIES,
} from "../cmdb/classes";
import { SIM_STATES } from "../cmdb/logic";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

export const CI_TIERS: Option[] = [
  { value: "tier_1", label: "رده ۱ — اثر جدی بر مشتریان یا درآمد", color: "red", order: 1 },
  { value: "tier_2", label: "رده ۲ — اثر قابل‌توجه", color: "orange", order: 2 },
  { value: "tier_3", label: "رده ۳ — اثر محدود", color: "gold", order: 3 },
  { value: "tier_4", label: "رده ۴ — بی‌اثر محسوس", color: "gray", order: 4 },
];

const FAMILY_OPTIONS: Option[] = Object.entries(CLASS_FAMILIES).map(([value, f], i) => ({ value, label: f.label, color: f.color, order: i + 1 }));

/** Default options of the module's choice lists (registered once in src/shared/tables/index.ts). */
export const CMDB_CHOICE_LISTS: Record<string, Option[]> = {
  "ci.class": CLASS_OPTIONS(),
  "ci_rel.type": REL_TYPE_OPTIONS(),
};

const yes = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

// ---------------------------------------------------------------------------------------------------------------
// CI classes (catalogue CMDB-001/002)

const CLASS_MAIN = "اصلی";
const CLASS_HEALTH = "کیفیت داده";
const CLASS_RULES = "قاعده‌ها";

const ciClass: TableDef = {
  key: "ci_class",
  table: "sm_ci_classes",
  label: "کلاس پیکربندی",
  plural: "کلاس‌های پیکربندی",
  icon: "shapes",
  module: "cmdb",
  area: "cmdb",
  description: "درخت کلاس‌ها با ویژگی‌های ویژهٔ هر کلاس، ارث‌بری، تنظیمات کیفیت داده و قاعده‌های رابطه",
  display: "label",
  fields: [
    { name: "label", label: "نام نمایشی", type: "string", required: true, maxLength: 80, list: true, search: true, sort: true, span: 12, section: CLASS_MAIN },
    { name: "key", label: "کلید سامانه‌ای", type: "string", required: true, maxLength: 63, list: true, search: true, ltr: true, span: 12, section: CLASS_MAIN, help: "با حروف کوچک لاتین؛ پس از ساخت تغییر نمی‌کند تا پرس‌وجوها نشکنند" },
    { name: "parent_key", label: "کلاس والد", type: "choice", choices: "ci.class", list: true, filter: true, span: 12, section: CLASS_MAIN },
    { name: "family", label: "خانواده", type: "choice", choices: FAMILY_OPTIONS, default: "logical", required: true, list: true, filter: true, span: 12, section: CLASS_MAIN },
    { name: "icon", label: "نماد", type: "string", maxLength: 40, ltr: true, span: 8, section: CLASS_MAIN, help: "نام یک نماد lucide، مثلاً server" },
    { name: "color", label: "رنگ", type: "color", span: 8, section: CLASS_MAIN },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8, section: CLASS_MAIN },
    { name: "abstract", label: "انتزاعی (فقط والد)", type: "bool", default: false, filter: true, span: 8, section: CLASS_MAIN, help: "پیکربندی مستقیماً در این کلاس ثبت نمی‌شود" },
    { name: "principal", label: "کلاس اصلی", type: "bool", default: false, filter: true, span: 8, section: CLASS_MAIN, help: "در سلامت و گزارش‌ها شمرده می‌شود" },
    { name: "create_disabled", label: "ساخت دستی بسته", type: "bool", default: false, span: 8, section: CLASS_MAIN, help: "فقط کشف و ورود داده این کلاس را می‌سازند" },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8, section: CLASS_MAIN },
    { name: "builtin", label: "از بستهٔ آماده", type: "bool", readonly: true, default: false, filter: true, span: 8, section: CLASS_MAIN },
    { name: "pack_version", label: "نسخهٔ بسته", type: "int", readonly: true, hidden: true },
    { name: "description", label: "شرح", type: "text", span: 24, section: CLASS_MAIN },
    { name: "attrs", label: "ویژگی‌های کلاس", type: "json", default: [], hidden: true, help: "تعریف ویژگی‌ها در «مدیریت کلاس‌ها»" },
    { name: "required_fields", label: "ویژگی‌های الزامی", type: "tags", span: 12, section: CLASS_HEALTH, help: "نام فیلدها یا attrs.<ویژگی>؛ برای امتیاز کامل بودن" },
    { name: "recommended_fields", label: "ویژگی‌های توصیه‌شده", type: "tags", span: 12, section: CLASS_HEALTH },
    { name: "owner_required", label: "مالک الزامی است", type: "bool", default: false, span: 8, section: CLASS_HEALTH },
    { name: "stale_days", label: "کهنگی پس از (روز)", type: "int", min: 0, max: 3650, span: 8, section: CLASS_HEALTH, help: "پیکربندی‌ای که در این مدت دیده یا به‌روز نشده، کهنه است؛ خالی: از کلاس والد" },
    { name: "operational_requires", label: "لازم برای «عملیاتی»", type: "tags", span: 8, section: CLASS_HEALTH, help: "مثلاً owned_by و support_group_id" },
    { name: "rel_rules", label: "قاعده‌های رابطه", type: "json", default: [], span: 24, section: CLASS_RULES, help: "رابطه‌های لازم و مجاز: نوع، جهت، کلاس طرف دیگر، کمینه و بیشینه" },
    { name: "controlled_attrs", label: "ویژگی‌های تحت کنترل تغییر", type: "tags", span: 12, section: CLASS_RULES, help: "تغییرشان بیرون از تغییر تأییدشده «انحراف» ثبت می‌کند" },
    { name: "asset_class", label: "کلاس دارایی متناظر", type: "string", maxLength: 63, ltr: true, span: 12, section: CLASS_RULES },
  ],
  scope: { public: true },
  unique: [["key"]],
  form: { sections: [CLASS_MAIN, CLASS_HEALTH, CLASS_RULES] },
  list: { columns: ["label", "key", "parent_key", "family", "abstract", "principal", "active"], order: "sort_order,label" },
};

// ---------------------------------------------------------------------------------------------------------------
// Configuration items (catalogue CMDB-003/004)

export const CI_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "on_order", label: "در حال تأمین", category: "waiting", color: "gold" },
    { value: "build", label: "در حال ساخت", category: "active", color: "teal" },
    { value: "test", label: "در آزمون", category: "active", color: "teal" },
    { value: "operational", label: "عملیاتی", category: "active", color: "green" },
    { value: "maintenance", label: "در نگهداری", category: "waiting", color: "orange" },
    { value: "end_of_life", label: "پایان عمر", category: "active", color: "gold" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
    { value: "disposed", label: "امحاشده", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "on_order", label: "سفارش" },
    { from: ["planned", "on_order", "test"], to: "build", label: "شروع ساخت" },
    { from: ["build"], to: "test", label: "آزمون" },
    { from: ["planned", "on_order", "build", "test", "maintenance", "end_of_life", "retired"], to: "operational", label: "عملیاتی", guard: "ci_can_operate" },
    { from: ["operational", "end_of_life"], to: "maintenance", label: "نگهداری" },
    { from: ["operational", "maintenance"], to: "end_of_life", label: "پایان عمر" },
    { from: ["planned", "on_order", "build", "test", "operational", "maintenance", "end_of_life"], to: "retired", label: "بازنشستگی" },
    { from: ["retired"], to: "disposed", label: "امحا", requires: ["disposal_notes"] },
    { from: ["planned", "on_order"], to: "canceled", label: "لغو" },
  ],
  locked: ["canceled"],
};

const MAIN = "اصلی";
const OWNERSHIP = "مالکیت و پشتیبانی";
const TECH = "شناسایی و فنی";
const QUALITY = "کشف و کیفیت داده";

/** CI fields that make sense only for compute classes (the form hides them for the others). */
export const COMPUTE_FIELDS = ["hostname", "fqdn", "ip_address", "mac_address", "bios_uuid", "os", "os_version", "cpu_count", "ram_mb", "disk_gb"];

const ci: TableDef = {
  key: "ci",
  table: "sm_cis",
  label: "پیکربندی",
  plural: "پیکربندی‌ها",
  icon: "boxes",
  module: "cmdb",
  area: "cmdb",
  description: "هر جزء مدیریت‌شدهٔ فناوری اطلاعات — سخت‌افزار، نرم‌افزار، منبع ابری، خدمت، گواهی یا دارایی اطلاعاتی — با کلاس، ویژگی‌ها، مالک، رابطه‌ها و چرخهٔ عمر",
  numbered: { prefix: "CI", pad: 7 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "class", label: "کلاس", type: "choice", choices: "ci.class", required: true, list: true, filter: true, sort: true, index: true, span: 12, section: MAIN },
    { name: "description", label: "شرح", type: "markdown", span: 24, section: MAIN, ai: { index: true } },
    { name: "environment", label: "محیط", type: "choice", choices: CI_ENVIRONMENTS, list: true, filter: true, span: 8, section: MAIN },
    { name: "criticality", label: "اهمیت", type: "choice", choices: CI_CRITICALITY, list: true, filter: true, sort: true, span: 8, section: MAIN },
    { name: "tier", label: "ردهٔ خدمت", type: "choice", choices: CI_TIERS, filter: true, span: 8, section: MAIN },
    { name: "operational_status", label: "وضعیت کارکرد", type: "choice", choices: OPERATIONAL_STATUSES, default: "operational", list: true, filter: true, span: 8, section: MAIN },
    { name: "install_status", label: "وضعیت نصب", type: "choice", choices: INSTALL_STATUSES, filter: true, span: 8, section: MAIN },
    { name: "tags", label: "برچسب‌ها", type: "tags", filter: true, search: true, span: 8, section: MAIN },

    { name: "owned_by", label: "مالک", type: "user", list: true, filter: true, span: 8, section: OWNERSHIP },
    { name: "managed_by", label: "مدیر فنی", type: "user", filter: true, span: 8, section: OWNERSHIP },
    { name: "used_by", label: "کاربر", type: "user", filter: true, span: 8, section: OWNERSHIP, help: "کسی که دستگاه را به کار می‌برد (در درگاه «دستگاه‌های من»)" },
    { name: "support_group_id", label: "گروه پشتیبانی", type: "group", list: true, filter: true, span: 8, section: OWNERSHIP },
    { name: "managed_by_group_id", label: "گروه مدیریت", type: "group", filter: true, span: 8, section: OWNERSHIP },
    { name: "change_approval_group_id", label: "گروه تأیید تغییر", type: "group", filter: true, span: 8, section: OWNERSHIP },
    { name: "company_id", label: "شرکت", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "company" }, filter: true, span: 8, section: OWNERSHIP },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, list: true, span: 8, section: OWNERSHIP },
    { name: "cost_center_id", label: "مرکز هزینه", type: "ref", ref: "org_unit", refFilter: { f: "kind", op: "eq", v: "cost_center" }, filter: true, span: 8, section: OWNERSHIP },
    { name: "maintenance_calendar_id", label: "تقویم نگهداری", type: "ref", ref: "calendar", span: 8, section: OWNERSHIP },

    { name: "serial_number", label: "شمارهٔ سریال", type: "string", maxLength: 120, ltr: true, search: true, filter: true, index: true, span: 8, section: TECH },
    { name: "asset_tag", label: "برچسب اموال", type: "string", maxLength: 80, ltr: true, search: true, filter: true, index: true, span: 8, section: TECH },
    { name: "manufacturer", label: "سازنده", type: "string", maxLength: 120, filter: true, span: 8, section: TECH },
    { name: "model_name", label: "مدل", type: "string", maxLength: 160, filter: true, span: 8, section: TECH },
    { name: "hostname", label: "نام میزبان", type: "string", maxLength: 120, ltr: true, search: true, filter: true, index: true, span: 8, section: TECH },
    { name: "fqdn", label: "نام کامل دامنه (FQDN)", type: "string", maxLength: 255, ltr: true, search: true, filter: true, index: true, span: 8, section: TECH },
    { name: "ip_address", label: "نشانی IP", type: "ip", ltr: true, search: true, filter: true, index: true, span: 8, section: TECH },
    { name: "mac_address", label: "نشانی MAC", type: "string", maxLength: 40, ltr: true, search: true, filter: true, index: true, span: 8, section: TECH },
    { name: "bios_uuid", label: "شناسهٔ BIOS", type: "string", maxLength: 80, ltr: true, filter: true, index: true, span: 8, section: TECH },
    { name: "cloud_resource_id", label: "شناسهٔ منبع ابری", type: "string", maxLength: 255, ltr: true, filter: true, index: true, span: 12, section: TECH },
    { name: "os", label: "سیستم‌عامل", type: "string", maxLength: 120, filter: true, span: 8, section: TECH },
    { name: "os_version", label: "نسخهٔ سیستم‌عامل", type: "string", maxLength: 80, ltr: true, span: 8, section: TECH },
    { name: "sw_version", label: "نسخه", type: "string", maxLength: 80, ltr: true, filter: true, span: 8, section: TECH },
    { name: "cpu_count", label: "تعداد هستهٔ پردازنده", type: "int", min: 0, max: 100000, span: 8, section: TECH },
    { name: "ram_mb", label: "حافظه (مگابایت)", type: "int", min: 0, span: 8, section: TECH },
    { name: "disk_gb", label: "دیسک (گیگابایت)", type: "int", min: 0, span: 8, section: TECH },
    { name: "url", label: "نشانی", type: "url", ltr: true, span: 12, section: TECH },
    { name: "expires_at", label: "تاریخ انقضا", type: "date", filter: true, sort: true, index: true, span: 6, section: TECH, help: "گواهی، مجوز یا ضمانت؛ ۳۰، ۱۴ و ۷ روز پیش از آن هشدار می‌رسد" },
    { name: "eol_date", label: "پایان پشتیبانی سازنده", type: "date", filter: true, sort: true, span: 6, section: TECH },
    { name: "attrs", label: "ویژگی‌های کلاس", type: "json", default: {}, hidden: true },
    { name: "change_id", label: "تغییر مجوز", type: "ref", ref: "change_request", hidden: true, filter: true, help: "تغییری که این ویرایش را مجاز می‌کند (کنترل پیکربندی)" },
    { name: "disposal_notes", label: "یادداشت امحا", type: "text", span: 24, section: QUALITY },

    { name: "discovery_source_id", label: "منبع کشف", type: "ref", ref: "cmdb_data_source", readonly: true, filter: true, span: 8, section: QUALITY },
    { name: "first_discovered_at", label: "نخستین کشف", type: "datetime", system: true, sort: true, filter: true, span: 8, section: QUALITY },
    { name: "last_discovered_at", label: "آخرین کشف", type: "datetime", system: true, sort: true, filter: true, span: 8, section: QUALITY },
    { name: "is_stale", label: "کهنه", type: "bool", system: true, default: false, filter: true, span: 6, section: QUALITY },
    { name: "health_score", label: "امتیاز سلامت", type: "int", system: true, audit: false, list: true, filter: true, sort: true, span: 6, section: QUALITY },
    { name: "health_issues", label: "ایرادهای داده", type: "multichoice", choices: HEALTH_ISSUES, system: true, audit: false, filter: true, span: 12, section: QUALITY },
    { name: "health", label: "جزئیات سلامت", type: "json", system: true, audit: false, hidden: true },
    { name: "health_at", label: "آخرین سنجش سلامت", type: "datetime", system: true, audit: false, hidden: true },
    { name: "locked_attrs", label: "ویژگی‌های قفل‌شده", type: "tags", span: 12, section: QUALITY, help: "منبع‌های کشف و ورود داده این ویژگی‌ها را بازنویسی نمی‌کنند" },
    { name: "attr_meta", label: "منبع مقدارها", type: "json", system: true, audit: false, hidden: true },
    { name: "certified_at", label: "آخرین تأیید مالک", type: "datetime", system: true, sort: true, filter: true, span: 6, section: QUALITY },
    { name: "certified_by", label: "تأییدکننده", type: "user", system: true, span: 6, section: QUALITY },
    { name: "supports_critical_function", label: "پشتیبان کارکرد حیاتی", type: "bool", system: true, default: false, filter: true, span: 6, section: QUALITY },
    { name: "max_criticality", label: "بالاترین اهمیت وابسته‌ها", type: "choice", choices: CI_CRITICALITY, system: true, filter: true, span: 6, section: QUALITY },
    { name: "merged_into", label: "ادغام‌شده در", type: "ref", ref: "$self", readonly: true, filter: true, span: 12, section: QUALITY },
  ],
  states: CI_STATES,
  scope: {
    own: ["owned_by", "managed_by", "used_by"],
    // the CI is anchored to its owner's unit (else its user's): unit-scoped grants and department heads follow them
    requester: ["owned_by", "used_by"],
    group: "support_group_id",
    watchers: "watch_list",
  },
  features: { journal: true, attachments: true, watchers: true, links: true, rag: true },
  form: {
    sections: [MAIN, OWNERSHIP, TECH, QUALITY],
    related: [
      { table: "incident", field: "ci_id", label: "رخدادها", columns: ["number", "short_description", "state", "priority", "assigned_to"] },
      { table: "problem", field: "ci_id", label: "مشکلات", columns: ["number", "short_description", "state", "assigned_to"] },
      { table: "cmdb_finding", field: "ci_id", label: "یافته‌های کیفیت داده", columns: ["number", "short_description", "kind", "state", "assigned_to"] },
      { table: "ci_drift", field: "ci_id", label: "انحراف‌ها", columns: ["number", "short_description", "attribute", "state"] },
    ],
  },
  list: { columns: ["number", "name", "class", "state", "operational_status", "environment", "criticality", "owned_by", "support_group_id", "health_score", "updated_at"], order: "name" },
  ai: { title: "name", text: ["description"] },
};

// ---------------------------------------------------------------------------------------------------------------
// Relationship types and relationships (catalogue CMDB-005/008/012)

const ciRelType: TableDef = {
  key: "ci_rel_type",
  table: "sm_ci_rel_types",
  label: "نوع رابطه",
  plural: "نوع‌های رابطه",
  icon: "git-fork",
  module: "cmdb",
  area: "cmdb",
  description: "نوع‌های رابطهٔ میان پیکربندی‌ها با برچسب دو سو و رفتار اثر",
  display: "label",
  fields: [
    { name: "label", label: "برچسب (از والد)", type: "string", required: true, maxLength: 60, list: true, search: true, span: 12, help: "«الف <برچسب> ب»" },
    { name: "inverse_label", label: "برچسب وارونه (از فرزند)", type: "string", required: true, maxLength: 60, list: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 63, ltr: true, list: true, span: 12 },
    { name: "category", label: "دسته", type: "choice", choices: REL_CATEGORIES, default: "dependency", filter: true, list: true, span: 12 },
    { name: "is_symmetric", label: "دوسویه (بی‌جهت)", type: "bool", default: false, span: 8 },
    { name: "propagates", label: "اثر را منتقل می‌کند", type: "bool", default: true, filter: true, list: true, span: 8 },
    { name: "impact", label: "جهت اثر", type: "choice", choices: IMPACT_DIRS, default: "child_to_parent", required: true, list: true, span: 8 },
    { name: "color", label: "رنگ", type: "color", span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "builtin", label: "از بستهٔ آماده", type: "bool", readonly: true, default: false, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  unique: [["key"]],
  list: { columns: ["label", "inverse_label", "key", "category", "propagates", "impact"], order: "sort_order,label" },
};

const ciRel: TableDef = {
  key: "ci_rel",
  table: "sm_ci_rels",
  label: "رابطهٔ پیکربندی",
  plural: "رابطه‌های پیکربندی",
  icon: "waypoints",
  module: "cmdb",
  area: "cmdb",
  description: "رابطهٔ جهت‌دار و تاریخ‌دار دو پیکربندی؛ پایان رابطه با «تا» ثبت می‌شود و نقشهٔ هر لحظه قابل بازسازی است",
  display: "label",
  fields: [
    { name: "parent_id", label: "والد", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "type", label: "نوع", type: "choice", choices: "ci_rel.type", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "child_id", label: "فرزند", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "label", label: "رابطه", type: "string", system: true, maxLength: 300, search: true, audit: false, span: 24 },
    { name: "origin_kind", label: "منشأ", type: "choice", choices: REL_ORIGINS, default: "manual", list: true, filter: true, span: 8 },
    { name: "source_id", label: "منبع داده", type: "ref", ref: "cmdb_data_source", filter: true, span: 8 },
    { name: "impact_weight", label: "وزن اثر (درصد)", type: "int", min: 0, max: 100, default: 100, span: 8, help: "۱۰۰: خرابی فرزند کامل منتقل می‌شود" },
    { name: "valid_from", label: "از", type: "datetime", default: "$now", sort: true, filter: true, span: 8 },
    { name: "valid_to", label: "تا", type: "datetime", sort: true, filter: true, list: true, span: 8, help: "خالی: رابطه برقرار است" },
    { name: "discovered_at", label: "زمان کشف", type: "datetime", readonly: true, span: 8 },
    { name: "last_seen_at", label: "آخرین مشاهده", type: "datetime", readonly: true, audit: false, sort: true, span: 8 },
    { name: "hide_on_map", label: "پنهان در نقشه", type: "bool", default: false, span: 8 },
    { name: "note", label: "یادداشت", type: "text", span: 24 },
    { name: "owned_by", label: "مالک والد", type: "user", system: true, hidden: true, audit: false },
    { name: "support_group_id", label: "گروه پشتیبانی والد", type: "group", system: true, hidden: true, audit: false },
  ],
  // a relationship is read where both of its CIs are (the dot-walk carries each CI's access); it is changed by whoever
  // may change its parent CI (copied anchors; the module's hook re-checks the CIs themselves)
  rowAccess: { read: { and: [{ f: "parent_id.name", op: "nempty" }, { f: "child_id.name", op: "nempty" }] } },
  scope: { own: ["owned_by"], group: "support_group_id" },
  list: { columns: ["parent_id", "type", "child_id", "origin_kind", "valid_from", "valid_to"], order: "-updated_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Groups (catalogue CMDB-012/015)

const ciGroup: TableDef = {
  key: "ci_group",
  table: "sm_ci_groups",
  label: "گروه پیکربندی",
  plural: "گروه‌های پیکربندی",
  icon: "group",
  module: "cmdb",
  area: "cmdb",
  description: "گروه ثابت، پویا (با شرط) یا افزونگی؛ گروه افزونگی تعیین می‌کند خرابی چند عضو، خوشه را از کار می‌اندازد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: [yes("static", "ثابت", 1), yes("dynamic", "پویا (با شرط)", 2), yes("redundancy", "افزونگی (خوشه)", 3)], default: "static", required: true, list: true, filter: true, span: 12 },
    { name: "condition", label: "شرط عضویت", type: "conditions", condTable: "ci", span: 24, help: "برای گروه پویا: هر پیکربندی که این شرط را دارد عضو است" },
    { name: "members", label: "اعضا", type: "refs", ref: "ci", span: 24, help: "برای گروه ثابت؛ در گروه افزونگی خالی: اعضای خوشه با رابطهٔ «عضوِ»" },
    { name: "ci_id", label: "پیکربندی خوشه", type: "ref", ref: "ci", filter: true, index: true, span: 12, help: "گروه افزونگی: پیکربندی‌ای که این اعضا نگه‌اش می‌دارند" },
    { name: "min_up", label: "کمینهٔ اعضای سالم", type: "int", min: 0, max: 10000, span: 6 },
    { name: "min_up_pct", label: "کمینهٔ درصد سالم", type: "percent", span: 6 },
    { name: "owner_group_id", label: "گروه مالک", type: "group", filter: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 12 },
    { name: "member_count", label: "تعداد اعضا", type: "int", system: true, audit: false, list: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { group: "owner_group_id" },
  list: { columns: ["name", "kind", "ci_id", "min_up", "member_count", "active"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Data sources, identification and reconciliation (catalogue CMDB-022…026)

export const SOURCE_KINDS: Option[] = [
  yes("manual", "دستی", 1),
  yes("file", "فایل (اکسل، CSV، JSON)", 2),
  yes("url", "نشانی وب (HTTPS)", 3),
  yes("api", "API و وب‌هوک", 4),
  yes("collector", "جمع‌آورندهٔ محلی", 5),
  yes("discovery", "کشف شبکه", 6),
  yes("connector", "اتصال‌دهنده", 7),
];

const cmdbSource: TableDef = {
  key: "cmdb_data_source",
  table: "sm_cmdb_sources",
  label: "منبع دادهٔ پیکربندی",
  plural: "منبع‌های دادهٔ پیکربندی",
  icon: "database-zap",
  module: "cmdb",
  area: "cmdb",
  description: "هر منبعی که پیکربندی‌ها را می‌سازد یا به‌روز می‌کند — با اولویت در آشتی داده و سیاست کهنگی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: SOURCE_KINDS, default: "file", required: true, list: true, filter: true, span: 12 },
    { name: "priority", label: "اولویت", type: "int", min: 1, max: 1000, default: 100, list: true, sort: true, span: 8, help: "عدد کمتر معتبرتر؛ مقدار منبع معتبرتر را منبع کم‌اعتبار بازنویسی نمی‌کند" },
    { name: "default_class", label: "کلاس پیش‌فرض", type: "choice", choices: "ci.class", span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "stale_after_days", label: "کهنگی پس از (روز)", type: "int", min: 0, max: 3650, default: 30, span: 8, help: "پیکربندی‌هایی که این منبع در این مدت گزارش نکرده" },
    { name: "delete_policy", label: "پیکربندی‌های گزارش‌نشده", type: "choice", choices: [yes("flag", "فقط علامت «کهنه»", 1), yes("retire", "بازنشسته شوند", 2), yes("none", "کاری نشود", 3)], default: "flag", span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8 },
    { name: "url", label: "نشانی داده", type: "url", ltr: true, span: 16, help: "برای منبع «نشانی وب»: فایل CSV یا JSON که هر چند ساعت خوانده می‌شود" },
    { name: "format", label: "قالب", type: "choice", choices: [yes("csv", "CSV", 1), yes("json", "JSON", 2)], default: "csv", span: 8 },
    { name: "json_path", label: "مسیر آرایه در JSON", type: "string", maxLength: 120, ltr: true, span: 8, help: "مثلاً data.items" },
    { name: "every_hours", label: "هر چند ساعت", type: "int", min: 0, max: 720, default: 0, span: 8, help: "صفر: فقط دستی" },
    { name: "mapping", label: "نگاشت ستون‌ها", type: "json", default: {}, span: 24, help: "ستون منبع ← فیلد پیکربندی یا attrs.<ویژگی>" },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", system: true, audit: false, list: true, sort: true, span: 8 },
    { name: "last_status", label: "نتیجهٔ آخرین اجرا", type: "string", system: true, audit: false, maxLength: 300, span: 16 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { own: ["owner_id"] },
  unique: [["name"]],
  list: { columns: ["name", "kind", "priority", "active", "last_run_at", "last_status"], order: "priority,name" },
};

const identRule: TableDef = {
  key: "ci_identification_rule",
  table: "sm_ci_ident_rules",
  label: "قاعدهٔ شناسایی",
  plural: "قاعده‌های شناسایی",
  icon: "fingerprint",
  module: "cmdb",
  area: "cmdb",
  description: "چگونه پیکربندی ورودی با پیکربندی موجود یکی دانسته شود: فهرست مرتب شناسه‌ها برای هر کلاس",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "class", label: "کلاس (با زیرکلاس‌ها)", type: "choice", choices: "ci.class", required: true, list: true, filter: true, span: 12 },
    { name: "entries", label: "شناسه‌ها به ترتیب", type: "json", default: [], span: 24, help: "هر ردیف فهرستی از ویژگی‌هاست که همه باید برابر باشند؛ @runs_on یعنی روی همان میزبان" },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "builtin", label: "از بستهٔ آماده", type: "bool", readonly: true, default: false, span: 8 },
  ],
  scope: { public: true },
  list: { columns: ["name", "class", "active", "sort_order"], order: "sort_order,name" },
};

const reconRule: TableDef = {
  key: "ci_reconciliation_rule",
  table: "sm_ci_recon_rules",
  label: "قاعدهٔ آشتی داده",
  plural: "قاعده‌های آشتی داده",
  icon: "git-merge",
  module: "cmdb",
  area: "cmdb",
  description: "کدام منبع برای کدام ویژگی معتبر است، و پس از چند روز بی‌خبری منبع دیگری می‌تواند جای آن بنویسد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "class", label: "کلاس (با زیرکلاس‌ها)", type: "choice", choices: "ci.class", required: true, list: true, filter: true, span: 12 },
    { name: "attributes", label: "ویژگی‌ها", type: "tags", span: 24, help: "خالی: همهٔ ویژگی‌ها" },
    { name: "source_id", label: "منبع", type: "ref", ref: "cmdb_data_source", required: true, list: true, filter: true, span: 12 },
    { name: "priority", label: "اولویت", type: "int", min: 1, max: 1000, default: 10, list: true, span: 6, help: "عدد کمتر معتبرتر" },
    { name: "max_age_days", label: "اعتبار تا (روز)", type: "int", min: 0, max: 3650, default: 30, span: 6, help: "اگر این منبع در این مدت گزارش نکند، منبع کم‌اعتبارتر می‌نویسد" },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 12 },
  ],
  scope: { public: true },
  list: { columns: ["name", "class", "source_id", "priority", "max_age_days", "active"], order: "class,priority" },
};

const RUN_STATES: StateModel = {
  field: "state",
  initial: "running",
  states: [
    { value: "running", label: "در حال اجرا", category: "active", color: "teal" },
    { value: "completed", label: "انجام شد", category: "resolved", color: "green" },
    { value: "failed", label: "ناموفق", category: "closed", color: "red" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["running"], to: "completed", label: "پایان" },
    { from: ["running"], to: "failed", label: "ناموفق" },
    { from: ["running"], to: "canceled", label: "لغو" },
  ],
  locked: ["canceled"],
};

const importRun: TableDef = {
  key: "cmdb_import_run",
  table: "sm_cmdb_import_runs",
  label: "اجرای ورود داده",
  plural: "اجراهای ورود داده",
  icon: "file-input",
  module: "cmdb",
  area: "cmdb",
  description: "هر ورود داده به پایگاه پیکربندی (فایل، JSON، نشانی وب، API یا جمع‌آورنده) با نتیجهٔ هر ردیف",
  numbered: { prefix: "IMP", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "source_id", label: "منبع", type: "ref", ref: "cmdb_data_source", list: true, filter: true, span: 12 },
    { name: "class", label: "کلاس پیش‌فرض", type: "choice", choices: "ci.class", filter: true, span: 8 },
    { name: "dry_run", label: "آزمایشی", type: "bool", default: false, filter: true, span: 8 },
    { name: "file_name", label: "فایل", type: "string", maxLength: 180, span: 8 },
    { name: "total", label: "ردیف‌ها", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "created", label: "ساخته‌شده", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "updated", label: "به‌روزشده", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "unchanged", label: "بدون تغییر", type: "int", system: true, audit: false, span: 6 },
    { name: "duplicates", label: "تکراری", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "failed", label: "ناموفق", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "started_at", label: "شروع", type: "datetime", system: true, sort: true, list: true, span: 6 },
    { name: "finished_at", label: "پایان", type: "datetime", system: true, sort: true, span: 6 },
    { name: "results", label: "نتیجهٔ ردیف‌ها", type: "json", system: true, audit: false, hidden: true },
    { name: "error", label: "خطا", type: "text", system: true, span: 24 },
  ],
  states: RUN_STATES,
  scope: { own: ["created_by"] },
  list: { columns: ["number", "name", "source_id", "state", "total", "created", "updated", "duplicates", "failed", "started_at"], order: "-started_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Data quality: health facts, rules, findings, de-duplication (catalogue CMDB-028/030/031/032)

const healthFact: TableDef = {
  key: "cmdb_health_fact",
  table: "sm_cmdb_health_facts",
  label: "سلامت روزانهٔ کلاس",
  plural: "سلامت روزانهٔ کلاس‌ها",
  icon: "activity",
  module: "cmdb",
  area: "cmdb",
  description: "شاخص‌های سلامت داده به تفکیک روز و کلاس: کامل بودن، درستی، انطباق، کهنه، تکراری و بی‌رابطه",
  display: "class",
  fields: [
    { name: "day", label: "روز", type: "date", required: true, list: true, sort: true, filter: true, index: true, span: 8 },
    { name: "class", label: "کلاس", type: "choice", choices: "ci.class", required: true, list: true, filter: true, span: 8 },
    { name: "total", label: "تعداد", type: "int", default: 0, list: true, span: 8 },
    { name: "complete", label: "کامل", type: "int", default: 0, list: true, span: 6 },
    { name: "correct", label: "درست", type: "int", default: 0, list: true, span: 6 },
    { name: "compliant", label: "منطبق", type: "int", default: 0, list: true, span: 6 },
    { name: "stale", label: "کهنه", type: "int", default: 0, span: 6 },
    { name: "duplicates", label: "تکراری", type: "int", default: 0, span: 6 },
    { name: "orphans", label: "بی‌رابطه", type: "int", default: 0, span: 6 },
    { name: "no_owner", label: "بی‌مالک", type: "int", default: 0, span: 6 },
    { name: "score", label: "امتیاز میانگین", type: "int", default: 0, list: true, span: 6 },
  ],
  scope: {},
  features: { history: false },
  unique: [["day", "class"]],
  list: { columns: ["day", "class", "total", "complete", "correct", "compliant", "score"], order: "-day,class" },
};

export const FINDING_KINDS: Option[] = [
  yes("missing_owner", "بدون مالک", 1, "red"),
  yes("missing_required", "ویژگی الزامی خالی", 2, "orange"),
  yes("stale", "کهنه", 3, "gold"),
  yes("orphan", "رابطهٔ لازم ندارد", 4, "orange"),
  yes("duplicate", "تکراری محتمل", 5, "red"),
  yes("data_quality", "قاعدهٔ کیفیت داده", 6, "orange"),
  yes("audit", "ممیزی", 7, "red"),
  yes("wrong_ci", "پیکربندی نادرست روی کار", 8, "purple"),
  yes("expiring", "رو به انقضا", 9, "gold"),
  yes("drift", "انحراف", 10, "red"),
];

const SEVERITIES: Option[] = [yes("high", "زیاد", 1, "red"), yes("medium", "متوسط", 2, "orange"), yes("low", "کم", 3, "gray")];

const cmdbRule: TableDef = {
  key: "cmdb_rule",
  table: "sm_cmdb_rules",
  label: "قاعدهٔ کیفیت داده",
  plural: "قاعده‌های کیفیت داده و ممیزی",
  icon: "list-checks",
  module: "cmdb",
  area: "cmdb",
  description: "شرطی که پیکربندی‌های یک کلاس باید داشته باشند؛ قاعدهٔ ممیزی درصد انطباق را می‌سنجد و برای ناهمخوان‌ها یافته می‌سازد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: [yes("data_quality", "کیفیت داده", 1), yes("audit", "ممیزی و انطباق", 2)], default: "data_quality", required: true, list: true, filter: true, span: 6 },
    { name: "severity", label: "شدت", type: "choice", choices: SEVERITIES, default: "medium", list: true, filter: true, span: 6 },
    { name: "class", label: "کلاس (با زیرکلاس‌ها)", type: "choice", choices: "ci.class", list: true, filter: true, span: 12 },
    { name: "category", label: "دستهٔ ممیزی", type: "string", maxLength: 80, filter: true, span: 12, help: "مثلاً «پشتیبان‌گیری» یا «امنیت»؛ انطباق به تفکیک دسته گزارش می‌شود" },
    { name: "scope_condition", label: "کدام پیکربندی‌ها", type: "conditions", condTable: "ci", span: 24, help: "خالی: همهٔ پیکربندی‌های کلاس" },
    { name: "check_condition", label: "باید این شرط را داشته باشند", type: "conditions", condTable: "ci", span: 24 },
    { name: "required_rel", label: "رابطهٔ لازم", type: "json", span: 24, help: "{ \"type\": \"backs_up\", \"direction\": \"in\", \"min\": 1 } — مثلاً هر پایگاه داده پشتیبان داشته باشد" },
    { name: "creates_findings", label: "برای ناهمخوان‌ها یافته بساز", type: "bool", default: true, span: 8 },
    { name: "due_days", label: "مهلت رفع (روز)", type: "int", min: 0, max: 365, default: 14, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "last_run_at", label: "آخرین بررسی", type: "datetime", system: true, audit: false, list: true, sort: true, span: 8 },
    { name: "last_checked", label: "بررسی‌شده", type: "int", system: true, audit: false, list: true, span: 8 },
    { name: "last_failing", label: "ناهمخوان", type: "int", system: true, audit: false, list: true, span: 8 },
    { name: "compliance", label: "انطباق", type: "percent", system: true, list: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "kind", "class", "severity", "active", "last_checked", "last_failing", "compliance"], order: "kind,name" },
};

/** Task fields a CMDB work item does not use (kept in the table, left out of its form). */
const hidden = (names: string[]) => TASK_FIELDS.filter((f) => names.includes(f.name)).map((f) => ({ ...f, hidden: true }));
const WORK_HIDDEN = ["channel", "category", "subcategory", "impact", "urgency", "caller_id", "requested_for", "service_id", "offering_id", "location_id", "knowledge", "approval", "escalation", "parent_id", "close_code", "priority"];

const FINDING_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال رفع", category: "active", color: "teal" },
    { value: "resolved", label: "رفع شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "waived", label: "چشم‌پوشی", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "in_progress", label: "شروع رفع" },
    { from: ["new", "in_progress"], to: "resolved", label: "رفع شد" },
    { from: ["resolved"], to: "in_progress", label: "بازگشایی" },
    { from: ["resolved"], to: "closed", label: "بستن" },
    { from: ["new", "in_progress"], to: "waived", label: "چشم‌پوشی", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const finding: TableDef = {
  key: "cmdb_finding",
  table: "sm_cmdb_findings",
  label: "یافتهٔ کیفیت داده",
  plural: "یافته‌های کیفیت داده",
  icon: "badge-alert",
  module: "cmdb",
  area: "cmdb",
  description: "ایراد دادهٔ یک پیکربندی که مالک یا گروه پشتیبانی آن باید رفع کند؛ با رفع ایراد خودکار بسته می‌شود",
  extends: "task",
  numbered: { prefix: "FND", pad: 7 },
  display: "short_description",
  fields: [
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع ایراد", type: "choice", choices: FINDING_KINDS, required: true, list: true, filter: true, span: 6 },
    { name: "severity", label: "شدت", type: "choice", choices: SEVERITIES, default: "medium", list: true, filter: true, span: 6 },
    { name: "rule_id", label: "قاعده", type: "ref", ref: "cmdb_rule", filter: true, span: 12 },
    { name: "detail", label: "جزئیات", type: "text", span: 24 },
    { name: "dedupe_key", label: "کلید یکتایی", type: "string", maxLength: 160, hidden: true, index: true, audit: false },
    { name: "auto", label: "ساختهٔ سامانه", type: "bool", default: false, readonly: true, hidden: true },
    ...hidden(WORK_HIDDEN),
  ],
  states: FINDING_STATES,
  scope: { ...TASK_SCOPE },
  list: { columns: ["number", "short_description", "ci_id", "kind", "severity", "state", "assigned_to", "due_at"], order: "-opened_at" },
};

const DEDUP_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال بررسی", category: "active", color: "teal" },
    { value: "resolved", label: "ادغام یا تأیید شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "تکراری نبود", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "in_progress", label: "شروع بررسی" },
    { from: ["new", "in_progress"], to: "resolved", label: "حل شد" },
    { from: ["resolved"], to: "in_progress", label: "بازگشایی" },
    { from: ["resolved"], to: "closed", label: "بستن" },
    { from: ["new", "in_progress"], to: "canceled", label: "تکراری نیست", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const dedupTask: TableDef = {
  key: "cmdb_dedup_task",
  table: "sm_cmdb_dedup_tasks",
  label: "بررسی تکراری",
  plural: "بررسی‌های تکراری",
  icon: "copy",
  module: "cmdb",
  area: "cmdb",
  description: "چند پیکربندی که احتمالاً یکی‌اند: انتخاب پیکربندی اصلی، پیش‌نمایش و ادغام (برگشت‌پذیر)",
  extends: "task",
  numbered: { prefix: "DUP", pad: 6 },
  display: "short_description",
  fields: [
    { name: "candidates", label: "پیکربندی‌های نامزد", type: "refs", ref: "ci", required: true, span: 24 },
    { name: "main_ci_id", label: "پیکربندی اصلی", type: "ref", ref: "ci", filter: true, span: 12 },
    { name: "score", label: "امتیاز شباهت", type: "int", min: 0, max: 100, list: true, sort: true, span: 6 },
    { name: "source_id", label: "منبع", type: "ref", ref: "cmdb_data_source", filter: true, span: 6 },
    { name: "reason", label: "دلیل", type: "text", span: 24 },
    { name: "candidate_key", label: "کلید نامزدها", type: "string", maxLength: 600, hidden: true, index: true, audit: false },
    { name: "merged_at", label: "زمان ادغام", type: "datetime", system: true, span: 8 },
    { name: "merged_by", label: "ادغام‌کننده", type: "user", system: true, span: 8 },
    { name: "undone_at", label: "زمان بازگرداندن", type: "datetime", system: true, span: 8 },
    { name: "merge_journal", label: "دفتر ادغام", type: "json", system: true, audit: false, hidden: true },
    ...hidden(WORK_HIDDEN),
  ],
  states: DEDUP_STATES,
  scope: { ...TASK_SCOPE },
  list: { columns: ["number", "short_description", "score", "main_ci_id", "state", "assigned_to", "opened_at"], order: "-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Baselines and drift (catalogue CMDB-037/038)

const BASELINE_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "approved", label: "تأییدشده", category: "active", color: "green" },
    { value: "superseded", label: "جایگزین‌شده", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "approved", label: "تأیید خط مبنا", guard: "baseline_has_items" },
    { from: ["approved"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["approved"], to: "superseded", label: "جایگزین شد" },
  ],
  locked: ["closed", "canceled"],
};

const baseline: TableDef = {
  key: "ci_baseline",
  table: "sm_ci_baselines",
  label: "خط مبنای پیکربندی",
  plural: "خط‌های مبنای پیکربندی",
  icon: "camera",
  module: "cmdb",
  area: "cmdb",
  description: "عکس ویژگی‌ها و رابطه‌های گروهی از پیکربندی‌ها در یک لحظه؛ مقایسه با وضعیت فعلی یا خط مبنای دیگر",
  numbered: { prefix: "BSL", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: [yes("release", "انتشار", 1), yes("golden", "تصویر طلایی", 2), yes("security", "امنیتی", 3), yes("audit", "ممیزی", 4), yes("other", "سایر", 5)], default: "release", filter: true, span: 6 },
    { name: "scope_kind", label: "دامنه", type: "choice", choices: [yes("class", "یک کلاس", 1), yes("group", "گروه پیکربندی", 2), yes("cis", "پیکربندی‌های مشخص", 3)], default: "cis", required: true, span: 6 },
    { name: "class", label: "کلاس", type: "choice", choices: "ci.class", filter: true, span: 8 },
    { name: "group_id", label: "گروه پیکربندی", type: "ref", ref: "ci_group", span: 8 },
    { name: "ci_ids", label: "پیکربندی‌ها", type: "refs", ref: "ci", span: 24 },
    { name: "include_relations", label: "با رابطه‌ها", type: "bool", default: true, span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8 },
    { name: "taken_at", label: "زمان عکس", type: "datetime", system: true, list: true, sort: true, span: 8 },
    { name: "item_count", label: "تعداد پیکربندی", type: "int", system: true, audit: false, list: true, span: 8 },
    { name: "approved_by", label: "تأییدکننده", type: "user", system: true, span: 8 },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", system: true, span: 8 },
    { name: "items", label: "عکس", type: "json", system: true, audit: false, hidden: true },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  states: BASELINE_STATES,
  scope: { own: ["owner_id"] },
  list: { columns: ["number", "name", "kind", "state", "item_count", "taken_at", "owner_id"], order: "-taken_at" },
};

const DRIFT_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "red" },
    { value: "investigating", label: "در حال بررسی", category: "active", color: "teal" },
    { value: "resolved", label: "تصمیم گرفته شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "investigating", label: "بررسی" },
    { from: ["new", "investigating"], to: "resolved", label: "تصمیم", requires: ["decision"] },
    { from: ["resolved"], to: "investigating", label: "بازگشایی" },
    { from: ["resolved"], to: "closed", label: "بستن" },
    { from: ["new", "investigating"], to: "canceled", label: "لغو", requires: ["close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const drift: TableDef = {
  key: "ci_drift",
  table: "sm_ci_drifts",
  label: "انحراف پیکربندی",
  plural: "انحراف‌های پیکربندی",
  icon: "triangle-alert",
  module: "cmdb",
  area: "cmdb",
  description: "تغییر یک ویژگی تحت کنترل بیرون از تغییر تأییدشده یا اختلاف با خط مبنا؛ پذیرفته (خط مبنا به‌روز) یا اصلاح می‌شود",
  extends: "task",
  numbered: { prefix: "DRF", pad: 6 },
  display: "short_description",
  fields: [
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "attribute", label: "ویژگی", type: "string", maxLength: 120, list: true, filter: true, span: 12 },
    { name: "expected", label: "مقدار مورد انتظار", type: "text", span: 12 },
    { name: "actual", label: "مقدار فعلی", type: "text", span: 12 },
    { name: "baseline_id", label: "خط مبنا", type: "ref", ref: "ci_baseline", filter: true, span: 12 },
    { name: "source_id", label: "منبع", type: "ref", ref: "cmdb_data_source", filter: true, span: 12 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", filter: true, span: 12 },
    { name: "decision", label: "تصمیم", type: "choice", choices: [yes("accepted", "پذیرفته شد (خط مبنا به‌روز)", 1), yes("remediated", "اصلاح شد", 2), yes("authorized", "با تغییر مجاز بود", 3)], filter: true, span: 12 },
    { name: "dedupe_key", label: "کلید یکتایی", type: "string", maxLength: 200, hidden: true, index: true, audit: false },
    ...hidden(WORK_HIDDEN),
  ],
  states: DRIFT_STATES,
  scope: { ...TASK_SCOPE },
  list: { columns: ["number", "short_description", "ci_id", "attribute", "state", "assignment_group_id", "opened_at"], order: "-opened_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Impact simulations, saved maps and saved queries (catalogue CMDB-013/014/020)

const impactSim: TableDef = {
  key: "ci_impact_sim",
  table: "sm_ci_impact_sims",
  label: "شبیه‌سازی اثر",
  plural: "شبیه‌سازی‌های اثر",
  icon: "radar",
  module: "cmdb",
  area: "work",
  description: "«اگر این پیکربندی‌ها از کار بیفتند چه می‌شود؟» — نتیجهٔ ذخیره‌شده برای یک تغییر یا تحلیل اثر کسب‌وکار",
  display: "name",
  fields: [
    { name: "name", label: "عنوان", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "sim_state", label: "وضعیت فرضی", type: "choice", choices: SIM_STATES, default: "down", required: true, list: true, span: 12 },
    { name: "ci_ids", label: "پیکربندی‌ها", type: "refs", ref: "ci", required: true, span: 24 },
    { name: "linked_table", label: "رکورد مرتبط (جدول)", type: "string", maxLength: 63, ltr: true, hidden: true },
    { name: "linked_id", label: "رکورد مرتبط", type: "string", maxLength: 40, ltr: true, hidden: true },
    { name: "linked_label", label: "رکورد مرتبط", type: "string", maxLength: 200, readonly: true, span: 12 },
    { name: "owner_id", label: "ثبت‌کننده", type: "user", default: "$me", readonly: true, list: true, span: 12 },
    { name: "summary", label: "خلاصه", type: "text", system: true, list: true, span: 24 },
    { name: "result", label: "نتیجه", type: "json", system: true, audit: false, hidden: true },
  ],
  rowAccess: { read: { f: "owner_id", op: "is_me" }, write: { f: "owner_id", op: "is_me" } },
  scope: { own: ["owner_id"] },
  list: { columns: ["name", "sim_state", "linked_label", "summary", "created_at"], order: "-created_at" },
};

const SHARED_ROW = { or: [{ f: "owner_id", op: "is_me" as const }, { f: "shared", op: "eq" as const, v: true }] };

const savedMap: TableDef = {
  key: "cmdb_map",
  table: "sm_cmdb_maps",
  label: "نقشهٔ ذخیره‌شده",
  plural: "نقشه‌های ذخیره‌شده",
  icon: "map",
  module: "cmdb",
  area: "work",
  description: "نمای ذخیره‌شدهٔ نقشهٔ وابستگی: ریشه‌ها، عمق، جهت، صافی‌ها و چیدمان؛ همیشه از دادهٔ زنده ساخته می‌شود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "root_ids", label: "پیکربندی‌های ریشه", type: "refs", ref: "ci", required: true, span: 24 },
    { name: "depth", label: "عمق", type: "int", min: 1, max: 6, default: 2, span: 6 },
    { name: "direction", label: "جهت", type: "choice", choices: [yes("both", "هر دو", 1), yes("dependents", "وابسته‌ها (بالادست)", 2), yes("dependencies", "وابستگی‌ها (پایین‌دست)", 3)], default: "both", span: 6 },
    { name: "types", label: "نوع‌های رابطه", type: "multichoice", choices: "ci_rel.type", span: 12 },
    { name: "classes", label: "کلاس‌ها", type: "multichoice", choices: "ci.class", span: 12 },
    { name: "layout", label: "چیدمان", type: "choice", choices: [yes("TB", "لایه‌ای از بالا", 1), yes("RL", "لایه‌ای از راست", 2)], default: "TB", span: 6 },
    { name: "shared", label: "اشتراک با همه", type: "bool", default: false, list: true, span: 6 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", readonly: true, list: true, span: 12 },
    { name: "positions", label: "جای گره‌ها", type: "json", hidden: true, audit: false },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  rowAccess: { read: SHARED_ROW, write: { f: "owner_id", op: "is_me" } },
  scope: { own: ["owner_id"] },
  list: { columns: ["name", "depth", "direction", "shared", "owner_id", "updated_at"], order: "name" },
};

const savedQuery: TableDef = {
  key: "cmdb_query",
  table: "sm_cmdb_queries",
  label: "پرس‌وجوی پیکربندی",
  plural: "پرس‌وجوهای پیکربندی",
  icon: "search-code",
  module: "cmdb",
  area: "work",
  description: "پرس‌وجوی ذخیره‌شده: کلاس، شرط و گام‌های رابطه (مثلاً «سرورهایی که سامانهٔ حقوق روی آن‌ها اجرا می‌شود»)",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "class", label: "کلاس آغاز", type: "choice", choices: "ci.class", list: true, span: 12 },
    { name: "condition", label: "شرط", type: "conditions", condTable: "ci", span: 24 },
    { name: "steps", label: "گام‌های رابطه", type: "json", default: [], span: 24, help: "[{ \"type\": \"runs_on\", \"direction\": \"out\", \"class\": \"server\" }]" },
    { name: "shared", label: "اشتراک با همه", type: "bool", default: false, list: true, span: 6 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", readonly: true, list: true, span: 6 },
    { name: "text", label: "متن پرس‌وجو", type: "text", span: 24 },
  ],
  rowAccess: { read: SHARED_ROW, write: { f: "owner_id", op: "is_me" } },
  scope: { own: ["owner_id"] },
  list: { columns: ["name", "class", "shared", "owner_id", "updated_at"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Rule-based relationships, suggestions, collectors, certification, policies (CMDB-007/034/035/041/048)

const relRule: TableDef = {
  key: "ci_rel_rule",
  table: "sm_ci_rel_rules",
  label: "قاعدهٔ رابطه‌سازی",
  plural: "قاعده‌های رابطه‌سازی",
  icon: "link-2",
  module: "cmdb",
  area: "cmdb",
  description: "رابطه را از برابری دو ویژگی می‌سازد (مثلاً شناسهٔ میزبان ماشین مجازی = شناسهٔ BIOS سرور ← «اجرا روی») و وقتی برابری از میان رفت پایان می‌دهد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 24 },
    { name: "source_class", label: "کلاس مبدأ (والد)", type: "choice", choices: "ci.class", required: true, list: true, span: 12 },
    { name: "source_attr", label: "ویژگی مبدأ", type: "string", required: true, maxLength: 80, ltr: true, span: 12, help: "نام فیلد یا attrs.<ویژگی>" },
    { name: "target_class", label: "کلاس مقصد (فرزند)", type: "choice", choices: "ci.class", required: true, list: true, span: 12 },
    { name: "target_attr", label: "ویژگی مقصد", type: "string", required: true, maxLength: 80, ltr: true, span: 12 },
    { name: "type", label: "نوع رابطه", type: "choice", choices: "ci_rel.type", required: true, list: true, span: 12 },
    { name: "mode", label: "رفتار", type: "choice", choices: [yes("create", "فقط ساختن", 1), yes("create_and_retire", "ساختن و پایان دادن", 2)], default: "create_and_retire", span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, list: true, span: 8 },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", system: true, audit: false, span: 8 },
    { name: "last_result", label: "نتیجه", type: "string", system: true, audit: false, maxLength: 200, span: 8 },
  ],
  scope: { public: true },
  list: { columns: ["name", "source_class", "type", "target_class", "active", "last_result"], order: "name" },
};

const SUGGESTION_STATES: StateModel = {
  field: "state",
  initial: "proposed",
  states: [
    { value: "proposed", label: "پیشنهاد", category: "new", color: "blue" },
    { value: "accepted", label: "پذیرفته", category: "closed", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["proposed"], to: "accepted", label: "پذیرش" },
    { from: ["proposed"], to: "rejected", label: "رد" },
  ],
  locked: ["closed", "canceled"],
};

const relSuggestion: TableDef = {
  key: "ci_rel_suggestion",
  table: "sm_ci_rel_suggestions",
  label: "پیشنهاد رابطه",
  plural: "پیشنهادهای رابطه",
  icon: "sparkles",
  module: "cmdb",
  area: "cmdb",
  description: "رابطه‌ای که از شواهد (هم‌آیی در رخدادها، هوش مصنوعی) پیشنهاد شده و مالک می‌پذیرد یا رد می‌کند",
  display: "label",
  fields: [
    { name: "parent_id", label: "والد", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "type", label: "نوع", type: "choice", choices: "ci_rel.type", required: true, list: true, span: 12 },
    { name: "child_id", label: "فرزند", type: "ref", ref: "ci", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "label", label: "پیشنهاد", type: "string", system: true, maxLength: 300, search: true, audit: false, span: 24 },
    { name: "score", label: "امتیاز", type: "int", min: 0, max: 100, list: true, sort: true, span: 6 },
    { name: "method", label: "روش", type: "choice", choices: [yes("cooccurrence", "هم‌آیی در رخدادها", 1), yes("ai", "هوش مصنوعی", 2), yes("rule", "قاعده", 3)], default: "cooccurrence", list: true, span: 6 },
    { name: "evidence", label: "شواهد", type: "json", readonly: true, span: 24 },
    { name: "decided_by", label: "تصمیم‌گیرنده", type: "user", system: true, span: 12 },
    { name: "rel_id", label: "رابطهٔ ساخته‌شده", type: "ref", ref: "ci_rel", readonly: true, span: 12 },
    { name: "pair_key", label: "کلید جفت", type: "string", maxLength: 200, hidden: true, index: true, audit: false },
  ],
  states: SUGGESTION_STATES,
  rowAccess: { read: { and: [{ f: "parent_id.name", op: "nempty" }, { f: "child_id.name", op: "nempty" }] } },
  scope: {},
  list: { columns: ["parent_id", "type", "child_id", "score", "method", "state"], order: "-score" },
};

const collector: TableDef = {
  key: "discovery_collector",
  table: "sm_discovery_collectors",
  label: "جمع‌آورندهٔ کشف",
  plural: "جمع‌آورنده‌های کشف",
  icon: "scan-search",
  module: "cmdb",
  area: "cmdb",
  description: "رایانه‌ای که موجودی خود (و بعدها شبکه) را جمع می‌کند و به پایگاه پیکربندی می‌فرستد؛ نسخهٔ ویندوزی برنامه یک جمع‌آورندهٔ آماده دارد",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: [yes("desktop", "برنامهٔ ویندوزی", 1), yes("agent", "عامل نصب‌شده", 2), yes("remote", "جمع‌آورندهٔ شبکه", 3)], default: "desktop", list: true, span: 12 },
    { name: "machine_id", label: "شناسهٔ رایانه", type: "string", maxLength: 120, ltr: true, index: true, span: 12 },
    { name: "hostname", label: "نام میزبان", type: "string", maxLength: 120, ltr: true, list: true, span: 12 },
    { name: "platform", label: "سیستم‌عامل", type: "string", maxLength: 120, span: 12 },
    { name: "agent_version", label: "نسخه", type: "string", maxLength: 40, ltr: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, span: 6 },
    { name: "every_hours", label: "تکرار هر چند ساعت", type: "int", min: 0, max: 720, default: 24, span: 8, help: "صفر: فقط دستی" },
    { name: "include_software", label: "نرم‌افزارهای نصب‌شده هم ثبت شوند", type: "bool", default: false, span: 8 },
    { name: "ci_id", label: "پیکربندی این رایانه", type: "ref", ref: "ci", readonly: true, span: 8 },
    { name: "source_id", label: "منبع داده", type: "ref", ref: "cmdb_data_source", readonly: true, span: 12 },
    { name: "last_heartbeat", label: "آخرین ارتباط", type: "datetime", system: true, audit: false, list: true, sort: true, span: 12 },
    { name: "last_run_at", label: "آخرین جمع‌آوری", type: "datetime", system: true, audit: false, span: 12 },
    { name: "last_result", label: "نتیجهٔ آخرین جمع‌آوری", type: "string", system: true, audit: false, maxLength: 300, span: 12 },
  ],
  scope: {},
  list: { columns: ["name", "kind", "hostname", "active", "last_heartbeat", "last_result"], order: "name" },
};

const CAMPAIGN_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "active", label: "در جریان", category: "active", color: "teal" },
    { value: "completed", label: "پایان‌یافته", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "active", label: "آغاز", requires: ["due_at"], guard: "campaign_can_start" },
    { from: ["active"], to: "completed", label: "پایان" },
    { from: ["draft", "active"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const certCampaign: TableDef = {
  key: "ci_cert_campaign",
  table: "sm_ci_cert_campaigns",
  label: "دورهٔ تأیید داده",
  plural: "دوره‌های تأیید داده",
  icon: "clipboard-check",
  module: "cmdb",
  area: "cmdb",
  description: "از مالکان می‌خواهد ویژگی‌ها و رابطه‌های پیکربندی‌هایشان را تا موعدی تأیید یا اصلاح کنند",
  numbered: { prefix: "CRC", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "condition", label: "پیکربندی‌ها", type: "conditions", condTable: "ci", span: 24, help: "خالی: همهٔ پیکربندی‌های فعال دارای مالک" },
    { name: "fields_to_confirm", label: "ویژگی‌هایی که تأیید می‌شوند", type: "tags", span: 24 },
    { name: "due_at", label: "موعد", type: "datetime", list: true, sort: true, span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", span: 8 },
    { name: "task_count", label: "کارها", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "done_count", label: "انجام‌شده", type: "int", system: true, audit: false, list: true, span: 6 },
    { name: "description", label: "پیام به مالکان", type: "markdown", span: 24 },
  ],
  states: CAMPAIGN_STATES,
  scope: { own: ["owner_id"] },
  list: { columns: ["number", "name", "state", "due_at", "task_count", "done_count"], order: "-created_at" },
};

const CERT_TASK_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "جدید", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "done", label: "تأیید شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "in_progress", label: "شروع" },
    { from: ["new", "in_progress"], to: "done", label: "تأیید داده‌ها" },
    { from: ["done"], to: "in_progress", label: "بازگشایی" },
    { from: ["done"], to: "closed", label: "بستن" },
    { from: ["new", "in_progress"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const certTask: TableDef = {
  key: "ci_cert_task",
  table: "sm_ci_cert_tasks",
  label: "تأیید دادهٔ پیکربندی",
  plural: "تأییدهای دادهٔ پیکربندی",
  icon: "badge-check",
  module: "cmdb",
  area: "work",
  description: "کار تأیید یک مالک در یک دوره: فهرست پیکربندی‌هایش؛ «تأیید داده‌ها» زمان تأیید را روی آن‌ها ثبت می‌کند",
  extends: "task",
  numbered: { prefix: "CRT", pad: 6 },
  display: "short_description",
  fields: [
    { name: "campaign_id", label: "دوره", type: "ref", ref: "ci_cert_campaign", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "ci_ids", label: "پیکربندی‌ها", type: "refs", ref: "ci", span: 24 },
    { name: "corrections", label: "اصلاحات لازم", type: "text", span: 24, help: "اگر ویژگی یا رابطه‌ای نادرست است اینجا بنویسید" },
    { name: "confirmed_count", label: "تأییدشده", type: "int", system: true, audit: false, span: 8 },
    ...hidden(WORK_HIDDEN),
  ],
  states: CERT_TASK_STATES,
  scope: { ...TASK_SCOPE },
  list: { columns: ["number", "short_description", "campaign_id", "state", "assigned_to", "due_at"], order: "-opened_at" },
};

const policy: TableDef = {
  key: "cmdb_policy",
  table: "sm_cmdb_policies",
  label: "سیاست دادهٔ پیکربندی",
  plural: "سیاست‌های دادهٔ پیکربندی",
  icon: "scroll-text",
  module: "cmdb",
  area: "cmdb",
  description: "عملی که هر شب روی پیکربندی‌های منطبق اجرا می‌شود: علامت کهنه، بازنشستگی پیکربندی‌های کهنه، یافته برای مالک",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "action", label: "عمل", type: "choice", choices: [yes("flag_stale", "علامت «کهنه»", 1), yes("retire", "بازنشستگی", 2), yes("finding", "یافته برای مالک", 3)], default: "finding", required: true, list: true, span: 12 },
    { name: "condition", label: "پیکربندی‌ها", type: "conditions", condTable: "ci", span: 24 },
    { name: "after_days", label: "دیده‌نشده بیش از (روز)", type: "int", min: 0, max: 3650, default: 90, span: 8, help: "صفر: بی‌توجه به آخرین مشاهده" },
    { name: "max_per_run", label: "بیشینه در هر اجرا", type: "int", min: 1, max: 5000, default: 200, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", system: true, audit: false, list: true, span: 8 },
    { name: "last_affected", label: "پیکربندی‌های اثرپذیرفته", type: "int", system: true, audit: false, list: true, span: 8 },
    { name: "last_skipped", label: "رهاشده", type: "int", system: true, audit: false, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "action", "after_days", "active", "last_run_at", "last_affected"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings row

export const CMDB_CONFIG_DEFAULTS = {
  w_completeness: 40,
  w_correctness: 40,
  w_compliance: 20,
  impact_depth: 8,
  map_max_nodes: 300,
  manual_priority: 20,
  controlled_mode: "flag" as "flag" | "block" | "off",
  health_findings: true,
  certify_days: 0,
  cert_warn_days: [30, 14, 7] as number[],
  suggest_min_support: 3,
};
export type CmdbConfig = typeof CMDB_CONFIG_DEFAULTS;

const CFG_HEALTH = "سلامت داده";
const CFG_GRAPH = "نقشه و اثر";
const CFG_CONTROL = "کنترل پیکربندی";

const config: TableDef = {
  key: "cmdb_config",
  table: "sm_cmdb_configs",
  label: "تنظیمات پیکربندی",
  plural: "تنظیمات پیکربندی",
  icon: "settings-2",
  module: "cmdb",
  area: "settings",
  description: "وزن‌های امتیاز سلامت، عمق اثر، اولویت ویرایش دستی، کنترل پیکربندی و هشدار انقضا",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات پیکربندی", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "w_completeness", label: "وزن کامل بودن", type: "int", min: 0, max: 100, default: CMDB_CONFIG_DEFAULTS.w_completeness, span: 8, section: CFG_HEALTH },
    { name: "w_correctness", label: "وزن درستی", type: "int", min: 0, max: 100, default: CMDB_CONFIG_DEFAULTS.w_correctness, span: 8, section: CFG_HEALTH },
    { name: "w_compliance", label: "وزن انطباق", type: "int", min: 0, max: 100, default: CMDB_CONFIG_DEFAULTS.w_compliance, span: 8, section: CFG_HEALTH },
    { name: "health_findings", label: "برای ایرادهای مهم یافته ساخته شود", type: "bool", default: true, span: 12, section: CFG_HEALTH },
    { name: "certify_days", label: "تأیید مالک هر چند روز لازم است", type: "int", min: 0, max: 3650, default: 0, span: 12, section: CFG_HEALTH, help: "صفر: تأیید دوره‌ای در انطباق شمرده نمی‌شود" },
    { name: "impact_depth", label: "عمق تحلیل اثر", type: "int", min: 1, max: 20, default: CMDB_CONFIG_DEFAULTS.impact_depth, span: 8, section: CFG_GRAPH },
    { name: "map_max_nodes", label: "بیشینهٔ گره‌های نقشه", type: "int", min: 50, max: 2000, default: CMDB_CONFIG_DEFAULTS.map_max_nodes, span: 8, section: CFG_GRAPH },
    { name: "suggest_min_support", label: "پیشنهاد رابطه از چند رخداد مشترک", type: "int", min: 2, max: 100, default: CMDB_CONFIG_DEFAULTS.suggest_min_support, span: 8, section: CFG_GRAPH },
    { name: "manual_priority", label: "اولویت ویرایش دستی", type: "int", min: 1, max: 1000, default: CMDB_CONFIG_DEFAULTS.manual_priority, span: 8, section: CFG_CONTROL, help: "در آشتی داده، با اولویت منبع‌ها مقایسه می‌شود (کمتر معتبرتر)" },
    { name: "controlled_mode", label: "تغییر ویژگی تحت کنترل بدون تغییر مجاز", type: "choice", choices: [yes("flag", "ثبت انحراف", 1), yes("block", "جلوگیری", 2), yes("off", "بی‌کنترل", 3)], default: "flag", span: 8, section: CFG_CONTROL },
    { name: "cert_warn_days", label: "هشدار انقضا (روز پیش از آن)", type: "json", default: CMDB_CONFIG_DEFAULTS.cert_warn_days, span: 8, section: CFG_CONTROL },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: [MAIN, CFG_HEALTH, CFG_GRAPH, CFG_CONTROL] },
  list: { columns: ["name", "w_completeness", "w_correctness", "w_compliance"], order: "name" },
};

export const CMDB_TABLES: TableDef[] = [
  ciClass, ci, ciRelType, ciRel, ciGroup, cmdbSource, identRule, reconRule, importRun, healthFact, cmdbRule, finding, dedupTask,
  baseline, drift, impactSim, savedMap, savedQuery, relRule, relSuggestion, collector, certCampaign, certTask, policy, config,
];
