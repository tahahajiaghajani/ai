// Tables of workforce and agent experience (docs/modules/workforce_FA.md, catalogue docs/catalog/g7_levels_analytics.md
// «Module: workforce»): the skills catalogue and each person's proficiency (with evidence, verification and expiry),
// certifications, skill coverage requirements of groups and services, shift patterns (working calendars of the SLA
// service: Saturday–Wednesday, an optional Thursday half day, Friday off, the official Iranian holidays) and team
// rosters, time off with approval, presence, capacity of groups, the points ledger and kudos of light gamification,
// and the module's settings. Teams and their members are the access model's groups (`group`, `group_member`); work
// delegation is the access model's profile delegate and the approvals service's delegations; on-call rotations are the
// event module's (`oncall_*`, area oncall) — the rosters here are working shifts only.
// Area `workforce`: the module's organisation roles (seeded) give managers and team leads their access; every member
// reads their own rows and their teams' rosters through the module's participant source (src/server/modules/workforce).
// Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { NEVER } from "../model/conditions";
import { APPROVAL_STATES } from "../model/task";

const yes = (value: string, label: string, order: number, color?: Option["color"]): Option => ({ value, label, order, ...(color ? { color } : {}) });

// ---------------------------------------------------------------------------------------------------------------
// Vocabularies

/** The proficiency scale (behavioural anchors), 1–5. */
export const PROFICIENCY: { level: number; label: string; anchor: string }[] = [
  { level: 1, label: "آشنایی", anchor: "مفاهیم را می‌شناسد و با راهنما کارهای ساده را انجام می‌دهد" },
  { level: 2, label: "مقدماتی", anchor: "کارهای معمول را با کمی کمک انجام می‌دهد" },
  { level: 3, label: "توانا", anchor: "کارهای معمول و بیشتر موارد دشوار را مستقل انجام می‌دهد" },
  { level: 4, label: "پیشرفته", anchor: "مسائل پیچیده را حل می‌کند و دیگران را راهنمایی می‌کند" },
  { level: 5, label: "خبره", anchor: "مرجع سازمان است؛ روش‌ها را طراحی و آموزش می‌دهد" },
];
export const proficiencyLabel = (n: unknown): string => PROFICIENCY.find((p) => p.level === Number(n))?.label ?? "—";

export const SKILL_CATEGORIES: Option[] = [
  yes("technical", "فنی و زیرساخت", 1, "blue"),
  yes("application", "نرم‌افزار و سامانه‌ها", 2, "indigo"),
  yes("process", "فرایند و چارچوب (ITIL)", 3, "teal"),
  yes("security", "امنیت", 4, "red"),
  yes("soft", "ارتباطی و خدمت به مشتری", 5, "magenta"),
  yes("language", "زبان", 6, "purple"),
  yes("domain", "دانش کسب‌وکار", 7, "orange"),
];

export const SKILL_SOURCES: Option[] = [
  yes("self", "خوداظهاری", 1, "gray"),
  yes("manager", "ارزیابی سرپرست", 2, "blue"),
  yes("inferred", "استنتاج از کارهای انجام‌شده", 3, "purple"),
  yes("certified", "گواهینامه یا آزمون", 4, "green"),
];

export const SKILL_STATUSES: Option[] = [
  yes("active", "پذیرفته", 1, "green"),
  yes("suggested", "پیشنهاد در انتظار تأیید فرد", 2, "gold"),
  yes("declined", "رد شد", 3, "gray"),
];

export const SHIFT_KINDS: Option[] = [
  yes("day", "روزانه (اداری)", 1, "gold"),
  yes("evening", "عصر", 2, "orange"),
  yes("night", "شب", 3, "indigo"),
  yes("split", "دوپاره", 4, "teal"),
  yes("flex", "شناور", 5, "gray"),
];

export const ROSTER_ROLES: Option[] = [yes("primary", "اصلی", 1, "blue"), yes("backup", "پشتیبان", 2, "teal"), yes("trainee", "کارآموز", 3, "gray")];

export const ABSENCE_TYPES: Option[] = [
  yes("annual", "مرخصی استحقاقی", 1, "blue"),
  yes("hourly", "مرخصی ساعتی", 2, "teal"),
  yes("sick", "مرخصی استعلاجی", 3, "orange"),
  yes("mission", "مأموریت", 4, "purple"),
  yes("training", "آموزش", 5, "indigo"),
  yes("unpaid", "مرخصی بدون حقوق", 6, "gray"),
  yes("other", "دیگر", 7, "gray"),
];

export const PRESENCE_STATES: Option[] = [
  yes("available", "در دسترس", 1, "green"),
  yes("busy", "مشغول", 2, "orange"),
  yes("meeting", "در جلسه", 3, "purple"),
  yes("break", "استراحت", 4, "gold"),
  yes("away", "دور از میز", 5, "gray"),
  yes("offline", "خارج از سامانه", 6, "gray"),
];
/** Presence states in which a person takes new work. */
export const TAKES_WORK = ["available", "busy"];

export const POINT_REASONS: Option[] = [
  yes("resolved", "حل یک رکورد", 1, "green"),
  yes("within_sla", "حل در موعد توافق", 2, "teal"),
  yes("first_contact", "حل در نخستین تماس", 3, "blue"),
  yes("csat", "رضایت درخواست‌کننده", 4, "magenta"),
  yes("knowledge", "مقالهٔ دانش منتشرشده", 5, "indigo"),
  yes("kudos", "قدردانی همکاران", 6, "gold"),
  yes("adjustment", "اصلاح دستی", 7, "gray"),
];

// ---------------------------------------------------------------------------------------------------------------
// Skills (WFM-002/003/004/005/007/038)

const skill: TableDef = {
  key: "wfm_skill",
  table: "sm_wfm_skills",
  label: "مهارت",
  plural: "فهرست مهارت‌ها",
  icon: "graduation-cap",
  module: "workforce",
  area: "workforce",
  description: "مهارت‌های سازمان با دسته، کد SFIA و واژه‌هایی که استنتاج مهارت از کارهای حل‌شده با آن‌ها انجام می‌شود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, unique: true, list: true, search: true, sort: true, span: 12 },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "sfia_code", label: "کد SFIA", type: "string", maxLength: 12, ltr: true, span: 6 },
    { name: "routing", label: "در ارجاع مهارت‌محور به کار رود", type: "bool", default: true, filter: true, span: 6 },
    { name: "keywords", label: "واژه‌های نشانه", type: "tags", span: 24, help: "دسته‌ها، نام خدمت‌ها یا واژه‌هایی که در عنوان کارها نشانهٔ این مهارت است" },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, search: true, span: 24 },
  ],
  scope: { public: true },
  form: { related: [{ table: "wfm_person_skill", field: "skill_id", label: "افراد دارای این مهارت", columns: ["user_id", "level", "source", "verified", "expires_at"] }] },
  list: { columns: ["name", "category", "sfia_code", "routing", "active"], order: "category,name" },
};

const personSkill: TableDef = {
  key: "wfm_person_skill",
  table: "sm_wfm_person_skills",
  label: "مهارت فرد",
  plural: "مهارت‌های افراد",
  icon: "badge-check",
  module: "workforce",
  area: "workforce",
  description: "سطح تسلط یک نفر در یک مهارت با منبع، شواهد، تأییدکننده و انقضا؛ مهارت‌های استنتاجی تا تأیید خود فرد پیشنهادند",
  display: "label",
  fields: [
    { name: "user_id", label: "فرد", type: "user", required: true, default: "$me", list: true, filter: true, index: true, span: 12 },
    { name: "skill_id", label: "مهارت", type: "ref", ref: "wfm_skill", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "level", label: "سطح تسلط (۱ تا ۵)", type: "int", min: 1, max: 5, default: 2, required: true, list: true, sort: true, filter: true, span: 6, help: PROFICIENCY.map((p) => `${p.level}: ${p.label}`).join("، ") },
    { name: "source", label: "منبع", type: "choice", choices: SKILL_SOURCES, default: "self", list: true, filter: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: SKILL_STATUSES, default: "active", list: true, filter: true, span: 6 },
    { name: "expires_at", label: "انقضا", type: "date", sort: true, filter: true, span: 6 },
    { name: "evidence", label: "شواهد", type: "text", maxLength: 4000, span: 24 },
    { name: "verified", label: "تأییدشده", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8 },
    { name: "verified_by", label: "تأییدکننده", type: "user", readonly: true, span: 8 },
    { name: "verified_at", label: "زمان تأیید", type: "datetime", readonly: true, span: 8 },
    { name: "label", label: "عنوان", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  unique: [["user_id", "skill_id"]],
  list: { columns: ["user_id", "skill_id", "level", "source", "status", "verified", "expires_at"], order: "user_id,skill_id" },
};

const certification: TableDef = {
  key: "wfm_certification",
  table: "sm_wfm_certifications",
  label: "گواهینامه",
  plural: "گواهینامه‌ها",
  icon: "award",
  module: "workforce",
  area: "workforce",
  description: "گواهینامه‌های افراد (ITIL، فروشندگان، امنیت) با صادرکننده، شماره و انقضا؛ پیش از انقضا یادآوری می‌شود",
  display: "name",
  fields: [
    { name: "user_id", label: "فرد", type: "user", required: true, default: "$me", list: true, filter: true, index: true, span: 12 },
    { name: "name", label: "گواهینامه", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "issuer", label: "صادرکننده", type: "string", maxLength: 120, list: true, span: 8 },
    { name: "cert_number", label: "شمارهٔ گواهی", type: "string", maxLength: 80, ltr: true, span: 8 },
    { name: "skill_id", label: "مهارت مرتبط", type: "ref", ref: "wfm_skill", filter: true, span: 8 },
    { name: "issued_at", label: "تاریخ صدور", type: "date", span: 8 },
    { name: "expires_at", label: "تاریخ انقضا", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "verified", label: "تأییدشده", type: "bool", default: false, readonly: true, filter: true, span: 8 },
    { name: "reminded_at", label: "یادآوری انقضا", type: "datetime", system: true, audit: false },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  features: { attachments: true },
  list: { columns: ["user_id", "name", "issuer", "expires_at", "verified"], order: "expires_at" },
};

const coverage: TableDef = {
  key: "wfm_coverage",
  table: "sm_wfm_coverage",
  label: "نیاز مهارتی",
  plural: "نیازهای مهارتی",
  icon: "shield-check",
  module: "workforce",
  area: "workforce",
  description: "کمینهٔ افراد با سطح لازم از یک مهارت برای یک گروه یا خدمت؛ کمبود و «فرد کلیدی» (یک نفر تنها) از آن دیده می‌شود",
  display: "label",
  fields: [
    { name: "group_id", label: "گروه", type: "group", list: true, filter: true, index: true, span: 12 },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", filter: true, span: 12 },
    { name: "skill_id", label: "مهارت", type: "ref", ref: "wfm_skill", required: true, list: true, filter: true, span: 12 },
    { name: "min_level", label: "کمینهٔ سطح", type: "int", min: 1, max: 5, default: 3, list: true, span: 6 },
    { name: "min_people", label: "کمینهٔ افراد", type: "int", min: 1, max: 100, default: 2, list: true, span: 6 },
    { name: "critical", label: "نقش حیاتی", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "note", label: "توضیح", type: "text", maxLength: 1000, span: 24 },
    { name: "label", label: "عنوان", type: "string", system: true, maxLength: 300, search: true, audit: false, list: true },
  ],
  scope: { group: "group_id" },
  list: { columns: ["label", "group_id", "skill_id", "min_level", "min_people", "critical"], order: "group_id" },
};

// ---------------------------------------------------------------------------------------------------------------
// Shifts and rosters (WFM-015/018/043)

const shiftPattern: TableDef = {
  key: "wfm_shift_pattern",
  table: "sm_wfm_shift_patterns",
  label: "الگوی شیفت",
  plural: "الگوهای شیفت",
  icon: "calendar-range",
  module: "workforce",
  area: "workforce",
  description: "ساعات کاری هفتگی یک شیفت (تقویم کاری با تعطیلات رسمی)، با رنگ و نشانهٔ کوتاه برای برنامهٔ تیم",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, unique: true, list: true, search: true, span: 12 },
    { name: "code", label: "نشانه", type: "string", required: true, maxLength: 4, list: true, span: 6, help: "یک یا دو حرف برای خانه‌های برنامه (مانند «ص»)" },
    { name: "color", label: "رنگ", type: "color", default: "blue", span: 6 },
    { name: "calendar_id", label: "ساعات کاری (تقویم)", type: "ref", ref: "calendar", required: true, list: true, span: 12, help: "ساعت‌های هر روز هفته و تعطیلات از همین تقویم خوانده می‌شود" },
    { name: "kind", label: "نوع", type: "choice", choices: SHIFT_KINDS, default: "day", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "شرح", type: "text", maxLength: 1000, span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "code", "kind", "calendar_id", "active"], order: "name" },
};

const roster: TableDef = {
  key: "wfm_roster",
  table: "sm_wfm_rosters",
  label: "برنامهٔ شیفت",
  plural: "برنامه‌های شیفت",
  icon: "calendar-clock",
  module: "workforce",
  area: "workforce",
  description: "یک نفر در یک تیم با یک الگوی شیفت در یک بازهٔ تاریخ؛ شیفت‌های هر روز از ساعات کاری و تعطیلات الگو ساخته می‌شود",
  numbered: { prefix: "SCH", pad: 5 },
  display: "label",
  fields: [
    { name: "group_id", label: "تیم", type: "group", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "فرد", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "pattern_id", label: "الگوی شیفت", type: "ref", ref: "wfm_shift_pattern", required: true, list: true, filter: true, span: 12 },
    { name: "role", label: "نقش", type: "choice", choices: ROSTER_ROLES, default: "primary", list: true, filter: true, span: 12 },
    { name: "valid_from", label: "از", type: "date", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "valid_to", label: "تا", type: "date", list: true, sort: true, span: 8, help: "خالی: تا اطلاع بعدی" },
    { name: "note", label: "توضیح", type: "text", maxLength: 1000, span: 24 },
    { name: "label", label: "عنوان", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  scope: { own: ["user_id"], requester: ["user_id"], group: "group_id" },
  list: { columns: ["number", "user_id", "group_id", "pattern_id", "role", "valid_from", "valid_to"], order: "-valid_from" },
};

// ---------------------------------------------------------------------------------------------------------------
// Time off (WFM-016/017)

export const ABSENCE_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
    { value: "approved", label: "تأییدشده", category: "active", color: "green" },
    { value: "ended", label: "پایان‌یافته", category: "closed", color: "gray" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["requested"], to: "approved", label: "تأیید", roles: { area: "workforce", level: "full" } },
    { from: ["requested"], to: "rejected", label: "رد", requires: ["reject_reason"], roles: { area: "workforce", level: "full" } },
    { from: ["requested", "approved"], to: "canceled", label: "لغو" },
    { from: ["approved"], to: "ended", label: "پایان" },
  ],
  locked: ["closed", "canceled"],
};

const absence: TableDef = {
  key: "wfm_absence",
  table: "sm_wfm_absences",
  label: "مرخصی و غیبت",
  plural: "مرخصی‌ها و غیبت‌ها",
  icon: "plane",
  module: "workforce",
  area: "workforce",
  description: "مرخصی، مأموریت یا آموزش یک نفر با تأیید مدیر؛ در بازهٔ تأییدشده فرد از ارجاع خودکار بیرون است و جانشین کارهایش را می‌بیند",
  numbered: { prefix: "ABS", pad: 6 },
  display: "label",
  fields: [
    { name: "user_id", label: "فرد", type: "user", required: true, default: "$me", list: true, filter: true, index: true, span: 12 },
    { name: "group_id", label: "تیم", type: "group", list: true, filter: true, index: true, span: 12 },
    { name: "type", label: "نوع", type: "choice", choices: "$table.type", default: "annual", required: true, list: true, filter: true, span: 8 },
    { name: "start_at", label: "از", type: "datetime", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "end_at", label: "تا", type: "datetime", required: true, list: true, sort: true, span: 8 },
    { name: "days", label: "روزهای کاری", type: "decimal", readonly: true, list: true, span: 8 },
    { name: "delegate_id", label: "جانشین", type: "user", span: 8, help: "در این بازه کارهای ارجاع‌شده به فرد را می‌بیند و پیش می‌برد" },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "note", label: "توضیح", type: "text", maxLength: 2000, span: 24 },
    { name: "reject_reason", label: "دلیل رد", type: "text", maxLength: 2000, span: 24 },
    { name: "requested_by", label: "ثبت‌کننده", type: "user", readonly: true, span: 8 },
    { name: "applied", label: "در نمایهٔ فرد اعمال شد", type: "bool", default: false, system: true, audit: false },
    { name: "label", label: "عنوان", type: "string", system: true, maxLength: 300, search: true, audit: false },
  ],
  states: ABSENCE_STATES,
  scope: { own: ["user_id"], requester: ["user_id"], group: "group_id" },
  features: { journal: true, attachments: true, calendar: { start: "start_at", end: "end_at" } },
  list: { columns: ["number", "user_id", "type", "start_at", "end_at", "days", "state"], order: "-start_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Presence, capacity (WFM-012/013)

const agent: TableDef = {
  key: "wfm_agent",
  table: "sm_wfm_agents",
  label: "وضعیت کارشناس",
  plural: "وضعیت کارشناسان",
  icon: "user-round-check",
  module: "workforce",
  area: "workforce",
  description: "حضور لحظه‌ای هر کارشناس و ترجیح‌های او (سقف کار در جریان، حضور در جدول امتیازها)؛ خود فرد از «خانهٔ کارشناس» تغییرش می‌دهد",
  display: "user_id",
  fields: [
    { name: "user_id", label: "کارشناس", type: "user", required: true, unique: true, list: true, filter: true, span: 12 },
    { name: "presence", label: "حضور", type: "choice", choices: PRESENCE_STATES, default: "offline", list: true, filter: true, span: 6 },
    { name: "presence_note", label: "یادداشت حضور", type: "string", maxLength: 120, span: 6 },
    { name: "presence_since", label: "از", type: "datetime", list: true, span: 6 },
    { name: "last_seen", label: "آخرین فعالیت", type: "datetime", list: true, sort: true, span: 6 },
    { name: "auto_away", label: "دوری خودکار", type: "bool", default: false, span: 6 },
    { name: "wip_limit", label: "سقف کار در جریان", type: "int", min: 1, max: 200, span: 6 },
    { name: "leaderboard", label: "حضور در جدول امتیازها", type: "bool", default: false, filter: true, span: 6 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { write: NEVER },
  features: { history: false, sync: false },
  list: { columns: ["user_id", "presence", "presence_since", "last_seen"], order: "user_id" },
};

const presenceLog: TableDef = {
  key: "wfm_presence_log",
  table: "sm_wfm_presence_log",
  label: "سابقهٔ حضور",
  plural: "سابقهٔ حضور",
  icon: "history",
  module: "workforce",
  area: "workforce",
  description: "بازه‌های حضور هر کارشناس برای سنجش زمان در دسترس و بهره‌وری؛ فقط سامانه می‌نویسد",
  display: "state",
  fields: [
    { name: "user_id", label: "کارشناس", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "state", label: "حضور", type: "choice", choices: PRESENCE_STATES, required: true, list: true, filter: true, span: 6 },
    { name: "from_at", label: "از", type: "datetime", required: true, list: true, sort: true, filter: true, span: 6 },
    { name: "to_at", label: "تا", type: "datetime", list: true, span: 6 },
    { name: "minutes", label: "دقیقه", type: "int", list: true, span: 6 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { write: NEVER },
  features: { history: false, sync: false },
  list: { columns: ["user_id", "state", "from_at", "to_at", "minutes"], order: "-from_at" },
};

const capacity: TableDef = {
  key: "wfm_capacity",
  table: "sm_wfm_capacity",
  label: "ظرفیت تیم",
  plural: "ظرفیت تیم‌ها",
  icon: "gauge",
  module: "workforce",
  area: "workforce",
  description: "سقف کار باز هر کارشناس، توان حل روزانه، زمان رسیدگی، بهره‌وری هدف و کمینهٔ نیرو در شیفت؛ برای یک تیم یا یک نفر در آن",
  display: "label",
  fields: [
    { name: "group_id", label: "تیم", type: "group", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "فقط برای این فرد", type: "user", filter: true, span: 12, help: "خالی: همهٔ اعضای تیم" },
    { name: "max_open", label: "سقف کار باز هر نفر", type: "int", min: 1, max: 500, default: 8, list: true, span: 6 },
    { name: "daily_throughput", label: "توان حل روزانهٔ هر نفر", type: "decimal", min: 0, max: 500, list: true, span: 6, help: "خالی: از کارهای حل‌شدهٔ هشت هفتهٔ اخیر" },
    { name: "aht_hours", label: "زمان رسیدگی هر کار (ساعت)", type: "decimal", min: 0, max: 200, span: 6, help: "خالی: از سابقه" },
    { name: "occupancy", label: "بهره‌وری هدف (٪)", type: "percent", default: "80", min: 1, max: 100, span: 6 },
    { name: "shrinkage", label: "کسر نیرو (٪ مرخصی، جلسه، آموزش)", type: "percent", default: "30", min: 0, max: 90, span: 6 },
    { name: "min_staff", label: "کمینهٔ نیرو در ساعات کاری", type: "int", min: 0, max: 500, default: 1, span: 6 },
    { name: "note", label: "توضیح", type: "text", maxLength: 1000, span: 24 },
    { name: "label", label: "عنوان", type: "string", system: true, maxLength: 300, search: true, audit: false, list: true },
  ],
  scope: { own: ["user_id"], requester: [], group: "group_id" },
  unique: [["group_id", "user_id"]],
  list: { columns: ["label", "max_open", "daily_throughput", "occupancy", "min_staff"], order: "group_id" },
};

// ---------------------------------------------------------------------------------------------------------------
// Light gamification (WFM-035/036)

const points: TableDef = {
  key: "wfm_points",
  table: "sm_wfm_points",
  label: "امتیاز",
  plural: "دفتر امتیازها",
  icon: "trophy",
  module: "workforce",
  area: "workforce",
  description: "امتیازهای هر نفر از کارهای حل‌شده، حل در موعد، رضایت، دانش و قدردانی همکاران؛ فقط سامانه می‌نویسد",
  display: "reason",
  fields: [
    { name: "user_id", label: "فرد", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "points", label: "امتیاز", type: "int", required: true, list: true, span: 6 },
    { name: "reason", label: "دلیل", type: "choice", choices: POINT_REASONS, required: true, list: true, filter: true, span: 6 },
    { name: "table_key", label: "جدول", type: "string", maxLength: 60, ltr: true, filter: true, span: 6 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", maxLength: 36, ltr: true, hidden: true },
    { name: "record_number", label: "رکورد", type: "string", maxLength: 40, ltr: true, list: true, span: 6 },
    { name: "period", label: "ماه", type: "string", maxLength: 8, ltr: true, filter: true, index: true, span: 6 },
    { name: "at", label: "زمان", type: "datetime", list: true, sort: true, span: 6 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { write: NEVER },
  unique: [["user_id", "reason", "record_id"]],
  features: { history: false },
  list: { columns: ["user_id", "points", "reason", "record_number", "at"], order: "-at" },
};

const kudos: TableDef = {
  key: "wfm_kudos",
  table: "sm_wfm_kudos",
  label: "قدردانی",
  plural: "قدردانی‌ها",
  icon: "heart-handshake",
  module: "workforce",
  area: "workforce",
  description: "قدردانی یک همکار از کار دیگری، اختیاری با پیوند به یک رکورد",
  display: "message",
  fields: [
    { name: "from_id", label: "از", type: "user", required: true, default: "$me", list: true, filter: true, span: 12 },
    { name: "to_id", label: "به", type: "user", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "message", label: "پیام", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "table_key", label: "جدول", type: "string", maxLength: 60, ltr: true, span: 8 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", maxLength: 36, ltr: true, hidden: true },
    { name: "record_number", label: "رکورد", type: "string", maxLength: 40, ltr: true, list: true, span: 8 },
  ],
  scope: { own: ["from_id", "to_id"], requester: ["from_id"] },
  list: { columns: ["from_id", "to_id", "message", "record_number", "created_at"], order: "-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings

export const WORKFORCE_CONFIG_DEFAULTS = {
  routing_min_level: 2,
  routing_needs_verified: false,
  sync_profile_skills: true,
  idle_minutes: 15,
  shift_end_guard_minutes: 60,
  weekly_hours_max: 44,
  min_rest_hours: 12,
  points_resolved: 10,
  points_within_sla: 5,
  points_first_contact: 5,
  points_csat: 5,
  points_knowledge: 15,
  points_kudos: 3,
  leaderboard_enabled: true,
  team_min_size: 3,
  forecast_days: 28,
  history_weeks: 8,
};
export type WorkforceConfig = typeof WORKFORCE_CONFIG_DEFAULTS;

const config: TableDef = {
  key: "wfm_config",
  table: "sm_wfm_config",
  label: "تنظیمات نیروی کار",
  plural: "تنظیمات نیروی کار",
  icon: "settings",
  module: "workforce",
  area: "workforce",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, default: "تنظیمات نیروی کار", span: 12 },
    { name: "config_key", label: "کلید", type: "string", maxLength: 40, ltr: true, unique: true, hidden: true },
    { name: "routing_min_level", label: "کمینهٔ سطح برای ارجاع مهارت‌محور", type: "int", min: 1, max: 5, default: WORKFORCE_CONFIG_DEFAULTS.routing_min_level, span: 8, section: "ارجاع" },
    { name: "routing_needs_verified", label: "فقط مهارت‌های تأییدشده", type: "bool", default: WORKFORCE_CONFIG_DEFAULTS.routing_needs_verified, span: 8, section: "ارجاع" },
    { name: "sync_profile_skills", label: "مهارت‌ها در نمایهٔ اعضا نوشته شود", type: "bool", default: WORKFORCE_CONFIG_DEFAULTS.sync_profile_skills, span: 8, section: "ارجاع", help: "قاعدهٔ ارجاع «مهارت» سکو از نمایهٔ اعضا می‌خواند" },
    { name: "idle_minutes", label: "دوری خودکار پس از (دقیقه)", type: "int", min: 1, max: 240, default: WORKFORCE_CONFIG_DEFAULTS.idle_minutes, span: 8, section: "حضور و شیفت" },
    { name: "shift_end_guard_minutes", label: "پیشنهاد نکردن کار در پایان شیفت (دقیقه)", type: "int", min: 0, max: 240, default: WORKFORCE_CONFIG_DEFAULTS.shift_end_guard_minutes, span: 8, section: "حضور و شیفت" },
    { name: "weekly_hours_max", label: "سقف ساعت کار هفتگی", type: "decimal", min: 1, max: 100, default: String(WORKFORCE_CONFIG_DEFAULTS.weekly_hours_max), span: 8, section: "حضور و شیفت" },
    { name: "min_rest_hours", label: "کمینهٔ استراحت میان دو شیفت (ساعت)", type: "decimal", min: 0, max: 48, default: String(WORKFORCE_CONFIG_DEFAULTS.min_rest_hours), span: 8, section: "حضور و شیفت" },
    { name: "points_resolved", label: "امتیاز حل", type: "int", min: 0, max: 100, default: WORKFORCE_CONFIG_DEFAULTS.points_resolved, span: 6, section: "امتیازها" },
    { name: "points_within_sla", label: "امتیاز حل در موعد", type: "int", min: 0, max: 100, default: WORKFORCE_CONFIG_DEFAULTS.points_within_sla, span: 6, section: "امتیازها" },
    { name: "points_first_contact", label: "امتیاز حل بی‌ارجاع", type: "int", min: 0, max: 100, default: WORKFORCE_CONFIG_DEFAULTS.points_first_contact, span: 6, section: "امتیازها" },
    { name: "points_csat", label: "امتیاز رضایت", type: "int", min: 0, max: 100, default: WORKFORCE_CONFIG_DEFAULTS.points_csat, span: 6, section: "امتیازها" },
    { name: "points_knowledge", label: "امتیاز مقالهٔ دانش", type: "int", min: 0, max: 100, default: WORKFORCE_CONFIG_DEFAULTS.points_knowledge, span: 6, section: "امتیازها" },
    { name: "points_kudos", label: "امتیاز قدردانی", type: "int", min: 0, max: 100, default: WORKFORCE_CONFIG_DEFAULTS.points_kudos, span: 6, section: "امتیازها" },
    { name: "leaderboard_enabled", label: "جدول امتیازها (با رضایت افراد)", type: "bool", default: WORKFORCE_CONFIG_DEFAULTS.leaderboard_enabled, span: 12, section: "امتیازها" },
    { name: "team_min_size", label: "کمینهٔ اعضا برای نمایش آمار تیم", type: "int", min: 1, max: 20, default: WORKFORCE_CONFIG_DEFAULTS.team_min_size, span: 8, section: "کارنامه" },
    { name: "forecast_days", label: "افق پیش‌بینی (روز)", type: "int", min: 7, max: 90, default: WORKFORCE_CONFIG_DEFAULTS.forecast_days, span: 8, section: "کارنامه" },
    { name: "history_weeks", label: "سابقهٔ پیش‌بینی (هفته)", type: "int", min: 2, max: 52, default: WORKFORCE_CONFIG_DEFAULTS.history_weeks, span: 8, section: "کارنامه" },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: ["ارجاع", "حضور و شیفت", "امتیازها", "کارنامه"] },
  list: { columns: ["name", "routing_min_level", "idle_minutes", "weekly_hours_max"], order: "name" },
};

export const WORKFORCE_TABLES: TableDef[] = [skill, personSkill, certification, coverage, shiftPattern, roster, absence, agent, presenceLog, capacity, points, kudos, config];

/** Default options of the module's tenant-editable lists. */
export const WORKFORCE_CHOICE_LISTS: Record<string, Option[]> = {
  "wfm_skill.category": SKILL_CATEGORIES,
  "wfm_absence.type": ABSENCE_TYPES,
};
