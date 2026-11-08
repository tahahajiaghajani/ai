// The configuration management class pack (catalogue CMDB-002, CSDM-aligned): the CI classes every organisation starts
// with — a tree with abstract parents, Persian labels, class-specific attributes, completeness and staleness settings,
// relationship rules and the attributes that are under configuration control — plus the relationship types with their
// impact behaviour and the default identification rules of the reconciliation engine. The seed writes them as
// `ci_class` / `ci_rel_type` / `ci_identification_rule` rows (src/server/modules/cmdb/seed.ts); an organisation edits
// its rows, and the built-in defaults below keep labels and lists usable before the seed ran.
// Imported by the UI: keep it free of server imports.
import type { ColorKey, Option } from "../model/types";

/** Value types a class attribute may have (stored in `ci.attrs`, validated like engine fields). */
export type AttrType = "string" | "text" | "int" | "decimal" | "bool" | "date" | "datetime" | "choice" | "multichoice" | "url" | "ip" | "email" | "tags";

export const ATTR_TYPES: Record<AttrType, string> = {
  string: "متن کوتاه",
  text: "متن چندخطی",
  int: "عدد صحیح",
  decimal: "عدد اعشاری",
  bool: "بله/خیر",
  date: "تاریخ",
  datetime: "تاریخ و ساعت",
  choice: "گزینه",
  multichoice: "چند گزینه",
  url: "نشانی وب",
  ip: "نشانی IP",
  email: "ایمیل",
  tags: "برچسب‌ها",
};

/** One attribute of a class (`ci_class.attrs`); inherited by every descendant class. */
export interface AttrDef {
  /** [a-z][a-z0-9_]*, unique along the class's ancestry */
  name: string;
  label: string;
  type: AttrType;
  required?: boolean;
  /** counts for the «recommended» completeness score */
  recommended?: boolean;
  choices?: Option[];
  min?: number;
  max?: number;
  maxLength?: number;
  /** shown after the value («گیگابایت») */
  unit?: string;
  help?: string;
  ltr?: boolean;
  /** an identifier the reconciliation engine may match on */
  identifier?: boolean;
  /** retired attributes keep their values on CIs but are no longer offered (classes change additively) */
  archived?: boolean;
}

/** A relationship expectation of a class (`ci_class.rel_rules`, catalogue CMDB-006): orphans violate a minimum. */
export interface RelRule {
  /** relationship type key, or "*" for any propagating type */
  type: string;
  /** out: this CI is the parent of the relationship; in: it is the child */
  direction: "out" | "in";
  /** class key of the other end (its descendants included); empty = any class */
  target?: string | null;
  min?: number | null;
  max?: number | null;
  /** the sentence shown when the rule is violated */
  label?: string;
}

export type ClassFamily = "hardware" | "software" | "cloud" | "logical" | "service" | "information" | "ai" | "facility";

export const CLASS_FAMILIES: Record<ClassFamily, { label: string; color: ColorKey; icon: string; layer: number }> = {
  service: { label: "خدمت", color: "indigo", icon: "concierge-bell", layer: 0 },
  information: { label: "اطلاعات", color: "magenta", icon: "file-lock", layer: 1 },
  ai: { label: "هوش مصنوعی", color: "purple", icon: "bot", layer: 1 },
  logical: { label: "منطقی", color: "teal", icon: "boxes", layer: 2 },
  software: { label: "نرم‌افزار", color: "blue", icon: "app-window", layer: 2 },
  cloud: { label: "ابر", color: "green", icon: "cloud", layer: 3 },
  hardware: { label: "سخت‌افزار", color: "gray", icon: "server", layer: 4 },
  facility: { label: "تأسیسات", color: "gold", icon: "building-2", layer: 5 },
};

export interface ClassSeed {
  key: string;
  label: string;
  parent: string | null;
  family: ClassFamily;
  icon?: string;
  abstract?: boolean;
  /** counts for health and reporting (principal classes) */
  principal?: boolean;
  attrs?: AttrDef[];
  /** CI fields or attribute names that make a CI of the class «complete» */
  required?: string[];
  recommended?: string[];
  /** a CI of the class must have an owner (scope policy) */
  ownerRequired?: boolean;
  /** a CI not seen (discovered, or updated when not discovered) within this many days is stale */
  staleDays?: number;
  /** fields a CI needs before it becomes «عملیاتی» */
  operationalRequires?: string[];
  relRules?: RelRule[];
  /** attributes that may change only through an approved change (configuration control) */
  controlled?: string[];
  description?: string;
}

const yes = (v: string, label: string, order: number, color?: ColorKey): Option => ({ value: v, label, order, ...(color ? { color } : {}) });

const SERVER_ROLES: Option[] = [
  yes("application", "سرور نرم‌افزار", 1),
  yes("database", "سرور پایگاه داده", 2),
  yes("web", "وب‌سرور", 3),
  yes("file", "سرور فایل", 4),
  yes("domain_controller", "کنترل‌کنندهٔ دامنه", 5),
  yes("hypervisor", "میزبان مجازی‌سازی", 6),
  yes("mail", "سرور ایمیل", 7),
  yes("backup", "سرور پشتیبان‌گیری", 8),
  yes("other", "سایر", 9),
];

const DB_ENGINES: Option[] = [
  yes("postgresql", "PostgreSQL", 1),
  yes("sqlserver", "SQL Server", 2),
  yes("oracle", "Oracle", 3),
  yes("mysql", "MySQL / MariaDB", 4),
  yes("mongodb", "MongoDB", 5),
  yes("redis", "Redis", 6),
  yes("other", "سایر", 7),
];

const CLOUD_PROVIDERS: Option[] = [
  yes("arvan", "ابر آروان", 1),
  yes("abrnoc", "ابرناک", 2),
  yes("pars_pack", "پارس‌پک", 3),
  yes("aws", "AWS", 4),
  yes("azure", "Azure", 5),
  yes("gcp", "Google Cloud", 6),
  yes("private", "ابر خصوصی سازمان", 7),
  yes("other", "سایر", 8),
];

const DATA_CLASSES: Option[] = [
  yes("public", "عمومی", 1, "green"),
  yes("internal", "داخلی", 2, "blue"),
  yes("confidential", "محرمانه", 3, "orange"),
  yes("secret", "سری", 4, "red"),
];

const TIME_DISPOSITION: Option[] = [
  yes("tolerate", "تحمل (Tolerate)", 1, "gray"),
  yes("invest", "سرمایه‌گذاری (Invest)", 2, "green"),
  yes("migrate", "مهاجرت (Migrate)", 3, "gold"),
  yes("eliminate", "حذف (Eliminate)", 4, "red"),
];

const AUTONOMY: Option[] = [
  yes("assist", "دستیار (پیشنهاد به انسان)", 1),
  yes("supervised", "زیر نظر انسان", 2),
  yes("autonomous", "خودمختار", 3),
];

const HW_REQUIRED = ["owned_by", "support_group_id", "location_id", "serial_number"];
const HW_RECOMMENDED = ["manufacturer", "model_name", "asset_tag", "environment"];
const COMPUTE_RECOMMENDED = [...HW_RECOMMENDED, "os", "ip_address", "fqdn"];
const HOSTED: RelRule[] = [{ type: "runs_on", direction: "out", target: "computer", min: 1, label: "باید روی یک رایانه یا ماشین مجازی اجرا شود" }];

/**
 * The class tree. Keys are the system names (stable; labels may be renamed); a parent comes before its children. Every
 * class belongs to a family (colour, icon and layer of the service map).
 */
export const CLASS_LIBRARY: ClassSeed[] = [
  { key: "ci", label: "پیکربندی", parent: null, family: "logical", icon: "box", abstract: true, description: "ریشهٔ همهٔ کلاس‌ها" },

  // hardware
  { key: "hardware", label: "سخت‌افزار", parent: "ci", family: "hardware", icon: "cpu", abstract: true, required: HW_REQUIRED, recommended: HW_RECOMMENDED, ownerRequired: true, staleDays: 30 },
  {
    key: "computer", label: "رایانه", parent: "hardware", family: "hardware", icon: "monitor", principal: true, recommended: COMPUTE_RECOMMENDED,
    operationalRequires: ["owned_by", "support_group_id"],
    attrs: [
      { name: "cpu_model", label: "پردازنده", type: "string", recommended: true },
      { name: "disk_count", label: "تعداد دیسک", type: "int", min: 0, max: 512 },
      { name: "domain", label: "دامنه / گروه کاری", type: "string", ltr: true },
      { name: "antivirus", label: "ضدبدافزار", type: "string", help: "نام و نسخهٔ ضدبدافزار نصب‌شده" },
      { name: "disk_encrypted", label: "رمزگذاری دیسک", type: "bool" },
      { name: "last_logged_user", label: "آخرین کاربر واردشده", type: "string", ltr: true },
    ],
    controlled: ["os", "os_version", "ram_mb", "cpu_count"],
  },
  {
    key: "server", label: "سرور", parent: "computer", family: "hardware", icon: "server", principal: true,
    attrs: [
      { name: "server_role", label: "نقش سرور", type: "choice", choices: SERVER_ROLES, recommended: true },
      { name: "rack_u", label: "جایگاه در رک (U)", type: "int", min: 1, max: 60 },
      { name: "power_watts", label: "توان مصرفی", type: "int", min: 0, unit: "وات" },
      { name: "is_virtual_host", label: "میزبان مجازی‌سازی", type: "bool" },
    ],
  },
  { key: "desktop", label: "رایانهٔ رومیزی", parent: "computer", family: "hardware", icon: "monitor", principal: true },
  { key: "laptop", label: "رایانهٔ کیفی", parent: "computer", family: "hardware", icon: "laptop", principal: true },
  {
    key: "virtual_machine", label: "ماشین مجازی", parent: "computer", family: "hardware", icon: "layers", principal: true,
    required: ["owned_by", "support_group_id"], recommended: ["os", "ip_address", "fqdn", "environment"],
    attrs: [
      { name: "hypervisor", label: "بستر مجازی‌سازی", type: "choice", choices: [yes("vmware", "VMware vSphere", 1), yes("hyperv", "Hyper-V", 2), yes("proxmox", "Proxmox", 3), yes("kvm", "KVM", 4), yes("other", "سایر", 5)] },
      { name: "host_uuid", label: "شناسهٔ میزبان", type: "string", ltr: true, identifier: true, help: "شناسهٔ BIOS میزبان؛ قاعدهٔ رابطه‌سازی «اجرا روی» را می‌سازد" },
      { name: "vcpu", label: "پردازندهٔ مجازی", type: "int", min: 0, max: 1024 },
    ],
    relRules: [{ type: "runs_on", direction: "out", target: "computer", min: 1, label: "ماشین مجازی باید روی یک میزبان اجرا شود" }],
  },
  {
    key: "network_device", label: "تجهیز شبکه", parent: "hardware", family: "hardware", icon: "network", principal: true,
    attrs: [
      { name: "firmware", label: "نسخهٔ سفت‌افزار", type: "string", ltr: true, recommended: true },
      { name: "ports", label: "تعداد درگاه", type: "int", min: 0, max: 1024 },
      { name: "mgmt_ip", label: "IP مدیریتی", type: "ip", ltr: true, identifier: true },
    ],
    controlled: ["firmware"],
  },
  { key: "router", label: "مسیریاب", parent: "network_device", family: "hardware", icon: "router" },
  { key: "switch", label: "سوئیچ", parent: "network_device", family: "hardware", icon: "network" },
  { key: "firewall", label: "دیوار آتش", parent: "network_device", family: "hardware", icon: "shield", attrs: [{ name: "rule_count", label: "تعداد قاعده", type: "int", min: 0 }] },
  { key: "access_point", label: "نقطهٔ دسترسی بی‌سیم", parent: "network_device", family: "hardware", icon: "wifi" },
  { key: "load_balancer", label: "متعادل‌کنندهٔ بار", parent: "network_device", family: "hardware", icon: "split" },
  {
    key: "storage", label: "ذخیره‌ساز", parent: "hardware", family: "hardware", icon: "hard-drive", principal: true,
    attrs: [
      { name: "capacity_tb", label: "ظرفیت", type: "decimal", min: 0, unit: "ترابایت", recommended: true },
      { name: "used_tb", label: "فضای استفاده‌شده", type: "decimal", min: 0, unit: "ترابایت" },
      { name: "storage_kind", label: "نوع", type: "choice", choices: [yes("san", "SAN", 1), yes("nas", "NAS", 2), yes("das", "DAS", 3), yes("object", "ذخیره‌ساز شیء", 4), yes("tape", "نوار پشتیبان", 5)] },
    ],
  },
  { key: "printer", label: "چاپگر", parent: "hardware", family: "hardware", icon: "printer", staleDays: 60 },
  { key: "mobile_device", label: "دستگاه همراه", parent: "hardware", family: "hardware", icon: "smartphone", attrs: [{ name: "imei", label: "IMEI", type: "string", ltr: true, identifier: true }] },
  { key: "ups", label: "یوپی‌اس", parent: "hardware", family: "facility", icon: "battery-charging", attrs: [{ name: "capacity_kva", label: "ظرفیت", type: "decimal", unit: "کیلوولت‌آمپر" }] },

  // software
  { key: "software", label: "نرم‌افزار", parent: "ci", family: "software", icon: "app-window", abstract: true, required: ["owned_by", "support_group_id"], recommended: ["sw_version", "environment"], staleDays: 30 },
  {
    key: "application", label: "نرم‌افزار کاربردی", parent: "software", family: "software", icon: "app-window", principal: true,
    attrs: [
      { name: "vendor", label: "سازنده", type: "string", recommended: true },
      { name: "edition", label: "ویرایش", type: "string" },
      { name: "install_path", label: "مسیر نصب", type: "string", ltr: true },
      { name: "listen_port", label: "درگاه شنود", type: "int", min: 1, max: 65535 },
    ],
    relRules: HOSTED,
  },
  {
    key: "database", label: "پایگاه داده", parent: "software", family: "software", icon: "database", principal: true,
    attrs: [
      { name: "db_engine", label: "موتور پایگاه داده", type: "choice", choices: DB_ENGINES, recommended: true },
      { name: "db_port", label: "درگاه", type: "int", min: 1, max: 65535 },
      { name: "size_gb", label: "حجم", type: "decimal", min: 0, unit: "گیگابایت" },
      { name: "backup_policy", label: "سیاست پشتیبان‌گیری", type: "string" },
    ],
    relRules: HOSTED,
    controlled: ["sw_version"],
  },
  { key: "web_server", label: "وب‌سرور", parent: "software", family: "software", icon: "globe", attrs: [{ name: "server_product", label: "محصول", type: "choice", choices: [yes("nginx", "Nginx", 1), yes("iis", "IIS", 2), yes("apache", "Apache", 3), yes("other", "سایر", 4)] }], relRules: HOSTED },
  { key: "middleware", label: "میان‌افزار", parent: "software", family: "software", icon: "workflow", relRules: HOSTED },

  // cloud
  {
    key: "cloud_resource", label: "منبع ابری", parent: "ci", family: "cloud", icon: "cloud", principal: true,
    required: ["owned_by", "cloud_resource_id"], recommended: ["environment", "support_group_id"], staleDays: 7,
    attrs: [
      { name: "provider", label: "ارائه‌دهنده", type: "choice", choices: CLOUD_PROVIDERS, required: true },
      { name: "region", label: "منطقه", type: "string", ltr: true, recommended: true },
      { name: "resource_type", label: "نوع منبع", type: "string", ltr: true, help: "مثلاً vm، bucket، database، function" },
      { name: "account_id", label: "شناسهٔ حساب", type: "string", ltr: true },
    ],
  },
  { key: "cloud_account", label: "حساب ابری", parent: "cloud_resource", family: "cloud", icon: "key-round" },
  { key: "container_cluster", label: "خوشهٔ کانتینر", parent: "cloud_resource", family: "cloud", icon: "container", attrs: [{ name: "k8s_version", label: "نسخهٔ Kubernetes", type: "string", ltr: true }] },

  // logical
  { key: "logical", label: "منطقی", parent: "ci", family: "logical", icon: "boxes", abstract: true, required: ["owned_by"], recommended: ["description", "criticality"], staleDays: 365 },
  {
    key: "business_application", label: "سامانهٔ کسب‌وکار", parent: "logical", family: "software", icon: "layout-grid", principal: true,
    required: ["owned_by", "support_group_id", "criticality"], recommended: ["description", "environment"],
    attrs: [
      { name: "vendor", label: "سازنده یا پیمانکار", type: "string", recommended: true },
      { name: "users_count", label: "تعداد کاربران", type: "int", min: 0 },
      { name: "data_classification", label: "طبقهٔ داده", type: "choice", choices: DATA_CLASSES, recommended: true },
      { name: "time_disposition", label: "تصمیم TIME", type: "choice", choices: TIME_DISPOSITION },
      { name: "technology_stack", label: "فناوری‌ها", type: "tags" },
      { name: "hosting", label: "میزبانی", type: "choice", choices: [yes("on_prem", "مرکز دادهٔ سازمان", 1), yes("cloud", "ابر", 2), yes("saas", "نرم‌افزار به‌عنوان خدمت", 3), yes("hybrid", "ترکیبی", 4)] },
    ],
  },
  { key: "cluster", label: "خوشه", parent: "logical", family: "logical", icon: "group", attrs: [{ name: "cluster_kind", label: "نوع خوشه", type: "string" }], relRules: [{ type: "member_of", direction: "in", min: 2, label: "خوشه دست‌کم دو عضو لازم دارد" }] },
  { key: "ip_network", label: "شبکهٔ IP", parent: "logical", family: "logical", icon: "network", attrs: [{ name: "cidr", label: "محدودهٔ CIDR", type: "string", ltr: true, identifier: true }, { name: "vlan", label: "VLAN", type: "int", min: 1, max: 4094 }] },
  {
    key: "certificate", label: "گواهی دیجیتال", parent: "logical", family: "logical", icon: "badge-check", principal: true, required: ["owned_by", "expires_at"], recommended: ["support_group_id"],
    attrs: [
      { name: "subject", label: "موضوع (Subject)", type: "string", ltr: true, identifier: true, required: true },
      { name: "issuer", label: "صادرکننده", type: "string", ltr: true },
      { name: "sans", label: "نام‌های جایگزین (SAN)", type: "tags" },
      { name: "cert_serial", label: "شمارهٔ سریال گواهی", type: "string", ltr: true, identifier: true },
      { name: "key_algorithm", label: "الگوریتم کلید", type: "string", ltr: true },
      { name: "key_size", label: "طول کلید", type: "int", min: 0, unit: "بیت" },
    ],
    description: "گواهی TLS/SSL؛ «تاریخ انقضا» برای هشدار ۳۰، ۱۴ و ۷ روز پیش از انقضا به کار می‌رود. کلید خصوصی هرگز ثبت نمی‌شود.",
  },
  {
    key: "information_asset", label: "دارایی اطلاعاتی", parent: "logical", family: "information", icon: "file-lock", principal: true,
    attrs: [
      { name: "data_classification", label: "طبقهٔ داده", type: "choice", choices: DATA_CLASSES, required: true },
      { name: "personal_data", label: "دادهٔ شخصی دارد", type: "bool" },
      { name: "retention_months", label: "مدت نگهداری", type: "int", min: 0, unit: "ماه" },
      { name: "storage_location", label: "محل نگهداری", type: "string" },
    ],
  },

  // service layer (CSDM)
  { key: "service", label: "خدمت", parent: "ci", family: "service", icon: "concierge-bell", abstract: true, required: ["owned_by", "support_group_id", "criticality"], recommended: ["description"], staleDays: 365 },
  {
    key: "business_service", label: "خدمت کسب‌وکار", parent: "service", family: "service", icon: "briefcase", principal: true,
    relRules: [{ type: "*", direction: "out", min: 1, label: "خدمت کسب‌وکار باید دست‌کم به یک گزینه، خدمت فنی یا سامانه وابسته باشد" }],
  },
  { key: "technical_service", label: "خدمت فنی", parent: "service", family: "service", icon: "wrench", principal: true, relRules: [{ type: "*", direction: "out", min: 1, label: "خدمت فنی باید به پیکربندی‌هایی وابسته باشد" }] },
  { key: "offering", label: "گزینهٔ خدمت", parent: "service", family: "service", icon: "tag", relRules: [{ type: "has_offering", direction: "in", min: 1, label: "گزینه باید زیر یک خدمت باشد" }] },
  { key: "application_service", label: "خدمت نرم‌افزاری", parent: "service", family: "service", icon: "app-window", principal: true, relRules: [{ type: "*", direction: "out", min: 1, label: "خدمت نرم‌افزاری باید به اجزای فنی خود وابسته باشد" }] },

  // AI systems and digital assets (CMDB-061)
  { key: "ai", label: "هوش مصنوعی", parent: "ci", family: "ai", icon: "bot", abstract: true, required: ["owned_by"], recommended: ["description", "criticality"], staleDays: 180 },
  {
    key: "ai_system", label: "سامانهٔ هوش مصنوعی", parent: "ai", family: "ai", icon: "bot", principal: true,
    attrs: [
      { name: "provider", label: "ارائه‌دهنده", type: "string" },
      { name: "data_classification", label: "طبقهٔ داده", type: "choice", choices: DATA_CLASSES, recommended: true },
      { name: "autonomy", label: "سطح خودمختاری", type: "choice", choices: AUTONOMY, recommended: true },
    ],
  },
  { key: "ai_model", label: "مدل هوش مصنوعی", parent: "ai", family: "ai", icon: "brain", attrs: [{ name: "provider", label: "ارائه‌دهنده", type: "string" }, { name: "model_version", label: "نسخهٔ مدل", type: "string", ltr: true, recommended: true }, { name: "hosting", label: "میزبانی", type: "choice", choices: [yes("local", "روی رایانه‌های سازمان", 1), yes("domestic", "سرویس داخلی", 2), yes("foreign", "سرویس خارجی", 3)] }] },
  { key: "ai_agent", label: "عامل هوش مصنوعی", parent: "ai", family: "ai", icon: "bot-message-square", attrs: [{ name: "autonomy", label: "سطح خودمختاری", type: "choice", choices: AUTONOMY, recommended: true }, { name: "tools", label: "ابزارها", type: "tags" }] },
  { key: "mcp_server", label: "سرور MCP", parent: "ai", family: "ai", icon: "plug", attrs: [{ name: "endpoint", label: "نشانی", type: "url", ltr: true }] },

  // facilities
  { key: "facility", label: "تأسیسات", parent: "ci", family: "facility", icon: "building-2", abstract: true, required: ["owned_by", "location_id"], staleDays: 365 },
  { key: "data_center", label: "مرکز داده", parent: "facility", family: "facility", icon: "building-2", principal: true, attrs: [{ name: "tier_level", label: "سطح Tier", type: "choice", choices: [yes("1", "Tier I", 1), yes("2", "Tier II", 2), yes("3", "Tier III", 3), yes("4", "Tier IV", 4)] }] },
  { key: "rack", label: "رک", parent: "facility", family: "facility", icon: "server-cog", attrs: [{ name: "height_u", label: "ارتفاع", type: "int", min: 1, max: 60, unit: "U" }], relRules: [{ type: "located_in", direction: "out", target: "data_center", min: 1, label: "رک باید در یک مرکز داده باشد" }] },
];

/** How failure travels along a relationship: from the child to the parent, the other way, both or not at all. */
export type ImpactDir = "child_to_parent" | "parent_to_child" | "both" | "none";

export const IMPACT_DIRS: Option[] = [
  { value: "child_to_parent", label: "از فرزند به والد (والد وابسته است)", order: 1 },
  { value: "parent_to_child", label: "از والد به فرزند (فرزند وابسته است)", order: 2 },
  { value: "both", label: "دوطرفه", order: 3 },
  { value: "none", label: "بی‌اثر", order: 4 },
];

export const REL_CATEGORIES: Option[] = [
  { value: "dependency", label: "وابستگی", order: 1 },
  { value: "structure", label: "ساختار و عضویت", order: 2 },
  { value: "data", label: "جریان داده", order: 3 },
  { value: "resilience", label: "پشتیبان و تداوم", order: 4 },
  { value: "location", label: "مکان", order: 5 },
  { value: "other", label: "سایر", order: 6 },
];

export interface RelTypeSeed {
  key: string;
  /** «A <label> B» reading from the parent */
  label: string;
  /** «B <inverse> A» reading from the child */
  inverse: string;
  symmetric?: boolean;
  propagates: boolean;
  impact: ImpactDir;
  color: ColorKey;
  category: string;
  description?: string;
}

/** Relationship types (catalogue CMDB-005); a relationship reads «parent <label> child». */
export const REL_TYPES: RelTypeSeed[] = [
  { key: "depends_on", label: "وابسته به", inverse: "مورد استفادهٔ", propagates: true, impact: "child_to_parent", color: "indigo", category: "dependency", description: "والد بدون فرزند کار نمی‌کند" },
  { key: "runs_on", label: "اجرا روی", inverse: "اجراکنندهٔ", propagates: true, impact: "child_to_parent", color: "blue", category: "dependency", description: "نرم‌افزار یا ماشین مجازی روی رایانه اجرا می‌شود" },
  { key: "hosted_on", label: "میزبانی‌شده روی", inverse: "میزبانِ", propagates: true, impact: "child_to_parent", color: "blue", category: "dependency" },
  { key: "has_offering", label: "دارای گزینهٔ", inverse: "گزینه‌ای از", propagates: true, impact: "child_to_parent", color: "purple", category: "structure", description: "خدمت و گزینه‌های آن" },
  { key: "contains", label: "دربرگیرندهٔ", inverse: "درونِ", propagates: true, impact: "parent_to_child", color: "teal", category: "structure" },
  { key: "member_of", label: "عضوِ", inverse: "دارای عضوِ", propagates: true, impact: "parent_to_child", color: "teal", category: "structure", description: "عضو خوشه یا مجموعه؛ با گروه افزونگی، خرابی یک عضو خوشه را از کار نمی‌اندازد" },
  { key: "provides", label: "ارائه‌دهندهٔ", inverse: "ارائه‌شده توسطِ", propagates: true, impact: "parent_to_child", color: "indigo", category: "dependency" },
  { key: "supports", label: "پشتیبانِ", inverse: "پشتیبانی‌شده توسطِ", propagates: true, impact: "parent_to_child", color: "indigo", category: "dependency", description: "خدمت فنی که خدمت کسب‌وکار را پشتیبانی می‌کند" },
  { key: "virtualizes", label: "مجازی‌سازِ", inverse: "مجازی‌شده روی", propagates: true, impact: "parent_to_child", color: "blue", category: "dependency" },
  { key: "uses_certificate", label: "استفاده از گواهیِ", inverse: "گواهیِ", propagates: true, impact: "child_to_parent", color: "gold", category: "dependency", description: "انقضای گواهی به استفاده‌کنندهٔ آن اثر می‌گذارد" },
  { key: "located_in", label: "مستقر در", inverse: "محل استقرارِ", propagates: true, impact: "child_to_parent", color: "gold", category: "location" },
  { key: "impacts", label: "اثرگذار بر", inverse: "متأثر از", propagates: true, impact: "parent_to_child", color: "red", category: "dependency" },
  { key: "connects_to", label: "متصل به", inverse: "متصل به", symmetric: true, propagates: false, impact: "none", color: "gray", category: "structure" },
  { key: "sends_data_to", label: "ارسال داده به", inverse: "دریافت داده از", propagates: false, impact: "none", color: "magenta", category: "data" },
  { key: "exchanges_data_with", label: "تبادل داده با", inverse: "تبادل داده با", symmetric: true, propagates: false, impact: "none", color: "magenta", category: "data" },
  { key: "backs_up", label: "پشتیبان‌گیری از", inverse: "پشتیبان‌گیری‌شده توسطِ", propagates: false, impact: "none", color: "green", category: "resilience" },
  { key: "fails_over_to", label: "جایگزین هنگام خرابی:", inverse: "جایگزینِ خرابیِ", propagates: false, impact: "none", color: "green", category: "resilience" },
];

/** One ordered entry of an identification rule: every attribute must be present, the CI with equal values is the one. */
export interface IdentEntry {
  /** CI fields, attribute names (`attrs.x` or bare) or `@<rel_type>` = the same parent through that relationship */
  attrs: string[];
  label?: string;
}

export interface IdentRuleSeed {
  name: string;
  class: string;
  entries: IdentEntry[];
}

/** Default identification rules (catalogue CMDB-023: common hardware is identified without hand-built rules). */
export const IDENT_RULES: IdentRuleSeed[] = [
  {
    name: "شناسایی رایانه‌ها", class: "computer",
    entries: [
      { attrs: ["serial_number", "manufacturer"], label: "شمارهٔ سریال و سازنده" },
      { attrs: ["bios_uuid"], label: "شناسهٔ BIOS" },
      { attrs: ["cloud_resource_id"], label: "شناسهٔ منبع ابری" },
      { attrs: ["fqdn"], label: "نام کامل دامنه" },
      { attrs: ["hostname"], label: "نام میزبان" },
      { attrs: ["mac_address"], label: "نشانی MAC" },
      { attrs: ["serial_number"], label: "شمارهٔ سریال" },
    ],
  },
  { name: "شناسایی تجهیزات شبکه", class: "network_device", entries: [{ attrs: ["serial_number", "manufacturer"] }, { attrs: ["serial_number"] }, { attrs: ["mac_address"] }, { attrs: ["attrs.mgmt_ip"] }, { attrs: ["hostname"] }] },
  { name: "شناسایی سخت‌افزار دیگر", class: "hardware", entries: [{ attrs: ["serial_number", "manufacturer"] }, { attrs: ["serial_number"] }, { attrs: ["asset_tag"] }, { attrs: ["mac_address"] }, { attrs: ["name"] }] },
  { name: "شناسایی منابع ابری", class: "cloud_resource", entries: [{ attrs: ["cloud_resource_id"] }] },
  { name: "شناسایی نرم‌افزار روی میزبان", class: "software", entries: [{ attrs: ["name", "@runs_on"], label: "نام و میزبان" }, { attrs: ["name", "fqdn"] }] },
  { name: "شناسایی گواهی‌ها", class: "certificate", entries: [{ attrs: ["attrs.cert_serial", "attrs.issuer"] }, { attrs: ["attrs.subject", "expires_at"] }] },
  { name: "شناسایی با نام", class: "ci", entries: [{ attrs: ["name"], label: "نام یکتا" }] },
];

// ---------------------------------------------------------------------------------------------------------------
// Fixed choice lists of CIs

export const CI_ENVIRONMENTS: Option[] = [
  { value: "production", label: "عملیاتی (تولید)", color: "red", order: 1 },
  { value: "dr", label: "بازیابی از فاجعه", color: "orange", order: 2 },
  { value: "staging", label: "پیش‌تولید", color: "gold", order: 3 },
  { value: "test", label: "آزمون", color: "blue", order: 4 },
  { value: "development", label: "توسعه", color: "teal", order: 5 },
];

export const CI_CRITICALITY: Option[] = [
  { value: "1", label: "۱ — حیاتی", color: "red", order: 1 },
  { value: "2", label: "۲ — بالا", color: "orange", order: 2 },
  { value: "3", label: "۳ — متوسط", color: "gold", order: 3 },
  { value: "4", label: "۴ — کم", color: "gray", order: 4 },
];

export const OPERATIONAL_STATUSES: Option[] = [
  { value: "operational", label: "در حال کار", color: "green", order: 1 },
  { value: "non_operational", label: "از کار افتاده", color: "red", order: 2 },
  { value: "repair", label: "در حال تعمیر", color: "orange", order: 3 },
  { value: "dr_standby", label: "آماده‌به‌کار بازیابی", color: "blue", order: 4 },
  { value: "ready", label: "آمادهٔ بهره‌برداری", color: "teal", order: 5 },
];

export const INSTALL_STATUSES: Option[] = [
  { value: "installed", label: "نصب‌شده", order: 1 },
  { value: "pending_install", label: "در انتظار نصب", order: 2 },
  { value: "in_stock", label: "در انبار", order: 3 },
  { value: "in_transit", label: "در حال انتقال", order: 4 },
  { value: "pending_repair", label: "در انتظار تعمیر", order: 5 },
  { value: "absent", label: "ناپیدا", order: 6 },
  { value: "stolen", label: "سرقت‌شده", order: 7 },
  { value: "removed", label: "برچیده", order: 8 },
];

export const REL_ORIGINS: Option[] = [
  { value: "manual", label: "دستی", order: 1 },
  { value: "discovery", label: "کشف", order: 2 },
  { value: "import", label: "ورود داده", order: 3 },
  { value: "rule", label: "قاعده", order: 4 },
  { value: "ai", label: "پیشنهاد هوش مصنوعی", order: 5 },
  { value: "service", label: "سبد خدمات", order: 6 },
];

/** Issues the health job finds on a CI (`ci.health_issues`). */
export const HEALTH_ISSUES: Option[] = [
  { value: "missing_required", label: "ویژگی الزامی خالی", color: "orange", order: 1 },
  { value: "missing_owner", label: "بدون مالک", color: "red", order: 2 },
  { value: "missing_support", label: "بدون گروه پشتیبانی", color: "orange", order: 3 },
  { value: "stale", label: "کهنه", color: "gold", order: 4 },
  { value: "duplicate", label: "تکراری محتمل", color: "red", order: 5 },
  { value: "orphan", label: "رابطهٔ لازم ندارد", color: "orange", order: 6 },
  { value: "audit_failed", label: "قاعدهٔ ممیزی را ندارد", color: "red", order: 7 },
  { value: "not_certified", label: "تأیید دوره‌ای نشده", color: "gold", order: 8 },
  { value: "expiring", label: "رو به انقضا", color: "orange", order: 9 },
];

// ---------------------------------------------------------------------------------------------------------------
// Lookups over the built-in pack (the organisation's rows replace them where it has its own)

export const CLASS_OPTIONS = (): Option[] => CLASS_LIBRARY.map((c, i) => ({ value: c.key, label: c.label, order: i + 1, color: CLASS_FAMILIES[c.family].color }));
export const REL_TYPE_OPTIONS = (): Option[] => REL_TYPES.map((t, i) => ({ value: t.key, label: t.label, order: i + 1, color: t.color }));

const BY_KEY = new Map(CLASS_LIBRARY.map((c) => [c.key, c]));
export const builtinClass = (key: string): ClassSeed | undefined => BY_KEY.get(key);
export const builtinRelType = (key: string): RelTypeSeed | undefined => REL_TYPES.find((t) => t.key === key);

/** Built-in classes of a family (descendants included), e.g. the compute classes the form shows technical fields for. */
export function builtinDescendants(root: string): string[] {
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const c of CLASS_LIBRARY) if (c.parent === out[i] && !out.includes(c.key)) out.push(c.key);
  return out;
}
