// The access model's own tables (docs/spec/ACCESS.md): the organisation structure (units, locations), workspaces
// (ESM service desks), groups and their members, member profiles (unit, manager, roles, delegate…) and the
// organisation's roles. They are ordinary engine tables — history, sync, the generic API — read in full by every
// member (`scope.public`: reference data the pickers and the Windows app's own access checks need) and changed only
// with the grants of their area (`org`, `users`). Server hooks (src/server/access/hooks.ts) keep tree paths, check
// cycles and role definitions, and bump the members' scope epochs.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { FIELD_GROUPS } from "../model/types";

export const UNIT_KINDS: Option[] = [
  { value: "company", label: "شرکت", color: "indigo" },
  { value: "division", label: "معاونت", color: "purple" },
  { value: "department", label: "اداره", color: "blue" },
  { value: "team", label: "تیم", color: "teal" },
  { value: "cost_center", label: "مرکز هزینه", color: "gold" },
  { value: "branch", label: "شعبه", color: "orange" },
];

export const LOCATION_KINDS: Option[] = [
  { value: "region", label: "منطقه" },
  { value: "country", label: "کشور" },
  { value: "province", label: "استان" },
  { value: "city", label: "شهر" },
  { value: "site", label: "سایت" },
  { value: "building", label: "ساختمان" },
  { value: "floor", label: "طبقه" },
  { value: "room", label: "اتاق" },
];

export const GROUP_TYPES: Option[] = [
  { value: "assignment", label: "ارجاع کار", color: "blue" },
  { value: "approval", label: "تأیید", color: "green" },
  { value: "cab", label: "هیئت مشورتی تغییر", color: "purple" },
  { value: "oncall", label: "آماده‌به‌کار", color: "orange" },
  { value: "general", label: "عمومی", color: "gray" },
];

export const MEMBER_KINDS: Option[] = [
  { value: "member", label: "عضو", color: "blue" },
  { value: "lead", label: "سرپرست", color: "purple" },
  { value: "observer", label: "ناظر", color: "gray" },
];

export const PERSONA_OPTIONS: Option[] = [
  { value: "requester", label: "درخواست‌دهنده" },
  { value: "agent", label: "کارشناس" },
  { value: "admin", label: "مدیر" },
];

/** Materialised tree paths are `/<root id>/…/<own id>/`: at most 60 levels of 37 characters. */
const PATH_MAX = 2300;

const orgUnit: TableDef = {
  key: "org_unit",
  table: "sm_org_units",
  label: "واحد سازمانی",
  plural: "واحدهای سازمانی",
  icon: "network",
  module: "access",
  area: "org",
  description: "درخت شرکت‌ها، معاونت‌ها، اداره‌ها، تیم‌ها، مراکز هزینه و شعبه‌ها",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 40, list: true, search: true, unique: true, ltr: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: UNIT_KINDS, default: "department", list: true, filter: true, span: 6 },
    { name: "parent_id", label: "واحد بالادستی", type: "ref", ref: "$self", filter: true, index: true, span: 12 },
    { name: "manager_id", label: "مدیر واحد", type: "user", list: true, filter: true, index: true, span: 12 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 12 },
    { name: "is_domain", label: "دامنهٔ جداگانه", type: "bool", default: false, filter: true, span: 6, help: "در جداسازی دامنه‌ها، رکوردهای افراد این شرکت و زیرمجموعه‌هایش فقط در همین دامنه دیده می‌شوند" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "path", label: "مسیر", type: "string", system: true, maxLength: PATH_MAX, hidden: true, audit: false },
    { name: "depth", label: "عمق", type: "int", system: true, hidden: true, audit: false },
  ],
  scope: { public: true },
  list: { columns: ["name", "code", "kind", "manager_id", "active"], order: "name" },
};

const location: TableDef = {
  key: "location",
  table: "sm_locations",
  label: "مکان",
  plural: "مکان‌ها",
  icon: "map-pin",
  module: "access",
  area: "org",
  description: "درخت منطقه، کشور، استان، شهر، سایت، ساختمان، طبقه و اتاق",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 150, list: true, search: true, sort: true, span: 12 },
    { name: "code", label: "کد", type: "string", maxLength: 40, list: true, search: true, unique: true, ltr: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: LOCATION_KINDS, default: "site", list: true, filter: true, span: 6 },
    { name: "parent_id", label: "مکان بالادستی", type: "ref", ref: "$self", filter: true, index: true, span: 12 },
    { name: "timezone", label: "منطقهٔ زمانی", type: "string", maxLength: 60, ltr: true, span: 12, placeholder: "Asia/Tehran" },
    { name: "address", label: "نشانی", type: "text", span: 24 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "path", label: "مسیر", type: "string", system: true, maxLength: PATH_MAX, hidden: true, audit: false },
    { name: "depth", label: "عمق", type: "int", system: true, hidden: true, audit: false },
  ],
  scope: { public: true },
  list: { columns: ["name", "code", "kind", "active"], order: "name" },
};

const workspace: TableDef = {
  key: "workspace",
  table: "sm_workspaces",
  label: "فضای کاری",
  plural: "فضاهای کاری",
  icon: "layout-grid",
  module: "access",
  area: "org",
  description: "میزهای خدمت سازمان (فناوری اطلاعات، منابع انسانی، پشتیبانی…)؛ هر کدام کاتالوگ، دسته‌ها و گروه‌های خود را دارد",
  display: "name",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 40, unique: true, list: true, ltr: true, span: 8 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 16 },
    { name: "icon", label: "نشانه", type: "string", maxLength: 40, ltr: true, span: 8, placeholder: "headset" },
    { name: "color", label: "رنگ", type: "color", span: 8 },
    { name: "is_default", label: "پیش‌فرض", type: "bool", default: false, list: true, span: 8 },
    { name: "secure", label: "امن", type: "bool", default: false, list: true, filter: true, span: 8, help: "رکوردهای فضای کاری امن را فقط اعضای آن می‌بینند؛ حتی مدیر سامانه و ممیز" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "key", "secure", "is_default", "active"], order: "name" },
};

const group: TableDef = {
  key: "group",
  table: "sm_groups",
  label: "گروه",
  plural: "گروه‌ها",
  icon: "users",
  module: "access",
  area: "org",
  description: "گروه‌های ارجاع کار، تأیید، هیئت تغییر و آماده‌به‌کار با اعضا و سرپرستان",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "types", label: "نوع", type: "multichoice", choices: GROUP_TYPES, default: ["assignment"], list: true, filter: true, span: 12 },
    { name: "parent_id", label: "گروه بالادستی", type: "ref", ref: "$self", filter: true, index: true, span: 12 },
    { name: "manager_id", label: "مدیر گروه", type: "user", list: true, filter: true, span: 12 },
    { name: "email", label: "ایمیل گروه", type: "email", ltr: true, span: 12 },
    { name: "skills", label: "مهارت‌ها", type: "tags", filter: true, span: 12 },
    { name: "roles", label: "نقش‌های اعضا", type: "tags", span: 12, help: "اعضای گروه این نقش‌ها را هم دارند" },
    { name: "restricted", label: "محدود", type: "bool", default: false, list: true, filter: true, span: 6, help: "رکوردهای ارجاع‌شده به گروه محدود را فقط اعضای آن (و درخواست‌دهنده) می‌بینند" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "types", "manager_id", "restricted", "active"], order: "name" },
};

const groupMember: TableDef = {
  key: "group_member",
  table: "sm_group_members",
  label: "عضویت گروه",
  plural: "عضویت‌های گروه",
  icon: "user-plus",
  module: "access",
  area: "org",
  display: "user_id",
  fields: [
    { name: "group_id", label: "گروه", type: "group", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "عضو", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نقش در گروه", type: "choice", choices: MEMBER_KINDS, default: "member", list: true, filter: true, span: 8 },
    { name: "valid_from", label: "معتبر از", type: "datetime", span: 8 },
    { name: "valid_to", label: "معتبر تا", type: "datetime", span: 8 },
  ],
  unique: [["group_id", "user_id"]],
  // a lead (team_lead: org write "group") manages the memberships of their groups
  scope: { own: ["user_id"], group: "group_id", public: true },
  features: { history: true },
  list: { columns: ["group_id", "user_id", "kind", "valid_to"], order: "group_id" },
};

const memberProfile: TableDef = {
  key: "member_profile",
  table: "sm_member_profiles",
  label: "نمایهٔ عضو",
  plural: "نمایه‌های اعضا",
  icon: "id-card",
  module: "access",
  area: "users",
  description: "واحد، مکان، مدیر، نقش‌ها، فضاهای کاری و جانشین هر عضو",
  display: "name",
  fields: [
    { name: "user_id", label: "عضو", type: "user", required: true, unique: true, list: true, filter: true, span: 12 },
    { name: "name", label: "نام", type: "string", maxLength: 200, readonly: true, list: true, search: true, sort: true, span: 12 },
    { name: "persona", label: "پرسونا", type: "choice", choices: PERSONA_OPTIONS, default: "requester", list: true, filter: true, span: 8 },
    { name: "roles", label: "نقش‌ها", type: "tags", list: true, span: 16 },
    { name: "org_unit_id", label: "واحد سازمانی", type: "ref", ref: "org_unit", list: true, filter: true, index: true, span: 12 },
    { name: "location_id", label: "مکان", type: "ref", ref: "location", filter: true, span: 12 },
    { name: "manager_id", label: "مدیر مستقیم", type: "user", filter: true, index: true, span: 12 },
    { name: "domain_unit_id", label: "دامنه", type: "ref", ref: "org_unit", filter: true, span: 12, help: "خالی: نزدیک‌ترین واحد بالادستی که دامنهٔ جداگانه است" },
    { name: "workspaces", label: "فضاهای کاری", type: "refs", ref: "workspace", span: 24, help: "عضویت مستقیم؛ عضویت در گروه یک فضای کاری هم کافی است" },
    { name: "title", label: "سمت", type: "string", maxLength: 120, list: true, span: 12 },
    { name: "phone", label: "تلفن", type: "phone", group: "personal", ltr: true, span: 12 },
    { name: "vip", label: "ویژه (VIP)", type: "bool", default: false, filter: true, span: 6 },
    { name: "skills", label: "مهارت‌ها", type: "tags", span: 18 },
    { name: "language", label: "زبان", type: "choice", choices: [{ value: "fa", label: "فارسی" }, { value: "en", label: "English" }], default: "fa", span: 6 },
    { name: "timezone", label: "منطقهٔ زمانی", type: "string", maxLength: 60, ltr: true, span: 6 },
    { name: "out_of_office", label: "خارج از دفتر", type: "bool", default: false, filter: true, span: 6 },
    { name: "ooo_until", label: "تا", type: "datetime", span: 6 },
    { name: "delegate_id", label: "جانشین", type: "user", span: 12, help: "در غیاب این عضو، رکوردهای ارجاع‌شده به او را می‌بیند و تغییر می‌دهد" },
  ],
  scope: { own: ["user_id"], public: true },
  list: { columns: ["name", "persona", "roles", "org_unit_id", "title"], order: "name" },
};

const FIELD_GROUP_OPTIONS: Option[] = Object.entries(FIELD_GROUPS).map(([value, label]) => ({ value, label }));

const role: TableDef = {
  key: "role",
  table: "sm_roles",
  label: "نقش",
  plural: "نقش‌ها",
  icon: "shield-check",
  module: "access",
  area: "users",
  description: "نقش‌های سازمان: مجوز هر حوزه، گروه‌های فیلد، نقش‌های دربرگرفته؛ ردیف هم‌کلید با نقش پیش‌فرض جای آن را می‌گیرد",
  display: "name",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 41, unique: true, list: true, ltr: true, span: 8 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 16 },
    { name: "description", label: "شرح", type: "text", span: 24 },
    { name: "persona", label: "پرسونا", type: "choice", choices: PERSONA_OPTIONS, default: "agent", list: true, filter: true, span: 8 },
    { name: "workspaces", label: "فضاهای کاری", type: "choice", choices: [{ value: "member", label: "فضاهای عضو" }, { value: "all", label: "همهٔ فضاها" }], default: "member", span: 8 },
    { name: "domains", label: "دامنه‌ها", type: "choice", choices: [{ value: "own", label: "دامنهٔ خود" }, { value: "all", label: "همهٔ دامنه‌ها" }], default: "own", span: 8 },
    { name: "grants", label: "مجوزها", type: "json", span: 24 },
    { name: "field_groups", label: "گروه‌های فیلد", type: "multichoice", choices: FIELD_GROUP_OPTIONS, span: 24 },
    { name: "contains", label: "نقش‌های دربرگرفته", type: "tags", span: 24 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
  ],
  scope: { public: true },
  list: { columns: ["name", "key", "persona", "active"], order: "name" },
};

export const ACCESS_TABLES: TableDef[] = [orgUnit, location, workspace, group, groupMember, memberProfile, role];
