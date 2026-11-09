// «مهارت‌های هوش مصنوعی» — the skills framework of the AI layer (docs/spec/AI.md §11, catalogue AI-006/007/164/165/
// 169/170): a skill is a prompt-backed feature — inputs from a record, a versioned prompt, a model tier, an output
// schema, grounding, triggers and who may use it. Built-in skills live in code (src/server/modules/ai/skills/builtin);
// an organisation's `ai_skill` row carries its configuration of one (enabled, roles, triggers, limits, the published
// version) and copies of its own; `ai_skill_version` keeps the prompts it wrote (published, rolled back, diffed);
// `ai_skill_eval` its offline evaluation sets and their scores. Area `ai`: definitions are changed only by AI
// administrators (a hook holds every write path to that, whatever the area grant says).
// `ai_skill_run` is the private log of runs: local to each runtime (like the usage ledger and conversations), readable
// only by the member who started the run (row rule), written only by the runtime; AI administrators see the log
// through the skills admin, never through the generic API — and anyone sees a run's output only while they may read
// its record and everything it read (`clearance`), otherwise only its metadata.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { SKILL_EVENTS, SKILL_GROUNDINGS, SKILL_OUTPUTS, SKILL_TARGETS, SKILL_TIERS, SKILL_TRIGGERS } from "../ai/skills";

export const AI_SKILL = "ai_skill";
export const AI_SKILL_VERSION = "ai_skill_version";
export const AI_SKILL_RUN = "ai_skill_run";
export const AI_SKILL_EVAL = "ai_skill_eval";

const opts = (m: Record<string, string | { label: string }>): Option[] =>
  Object.entries(m).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));

export const SKILL_GROUP_OPTIONS: Option[] = [
  { value: "internal", label: "داخلی" },
  { value: "financial", label: "مالی" },
  { value: "personal", label: "شخصی" },
  { value: "security", label: "امنیتی" },
  { value: "hr", label: "منابع انسانی" },
  { value: "admin", label: "مدیریتی" },
];

export const VERSION_STATES: Option[] = [
  { value: "draft", label: "پیش‌نویس", color: "gray" },
  { value: "published", label: "منتشرشده", color: "green" },
  { value: "retired", label: "کنارگذاشته", color: "orange" },
];

export const RUN_STATUSES: Option[] = [
  { value: "ok", label: "انجام شد", color: "green" },
  { value: "fallback", label: "با قاعده (بی‌مدل)", color: "gold" },
  { value: "error", label: "ناموفق", color: "red" },
];

const skill: TableDef = {
  key: AI_SKILL,
  table: "sm_ai_skills",
  label: "مهارت هوش مصنوعی",
  plural: "مهارت‌های هوش مصنوعی",
  icon: "sparkles",
  module: "ai",
  area: "ai",
  description: "کاری که هوش مصنوعی با درخواستی نسخه‌دار، روی داده‌هایی که کاربر می‌بیند انجام می‌دهد",
  display: "name",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 80, ltr: true, list: true, search: true, sort: true, span: 12, help: "حرف لاتین کوچک، رقم، نقطه و _؛ پس از ساخت تغییر نمی‌کند." },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "description", label: "شرح", type: "text", search: true, span: 24 },
    { name: "module", label: "بخش", type: "string", maxLength: 40, ltr: true, list: true, filter: true, readonly: true, span: 8 },
    { name: "base_key", label: "مهارت پایه", type: "string", maxLength: 80, ltr: true, readonly: true, span: 8, help: "مهارت داخلی‌ای که این مهارت از آن ساخته شده است" },
    { name: "builtin", label: "داخلی", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8 },
    { name: "enabled", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "target", label: "روی", type: "choice", choices: opts(SKILL_TARGETS), default: "record", readonly: true, span: 8 },
    { name: "output", label: "خروجی", type: "choice", choices: opts(SKILL_OUTPUTS), default: "text", readonly: true, list: true, span: 8 },
    { name: "tables", label: "جدول‌ها", type: "tags", span: 24, help: "کلید جدول‌هایی که مهارت روی رکوردهایشان کار می‌کند؛ «*» یعنی همه." },
    { name: "tier", label: "ردهٔ مدل", type: "choice", choices: opts(SKILL_TIERS), default: "standard", required: true, list: true, span: 8 },
    { name: "grounding", label: "منبع پاسخ", type: "choice", choices: opts(SKILL_GROUNDINGS), default: "none", required: true, span: 8 },
    { name: "grounding_k", label: "تعداد منابع", type: "int", min: 1, max: 12, default: 5, span: 8 },
    { name: "collections", label: "مجموعه‌های اسناد", type: "refs", ref: "doc_collection", span: 24 },
    { name: "triggers", label: "اجرا", type: "multichoice", choices: opts(SKILL_TRIGGERS), default: ["manual"], span: 12 },
    { name: "events", label: "رویدادها", type: "multichoice", choices: opts(SKILL_EVENTS), span: 12 },
    { name: "condition", label: "شرط اجرای خودکار", type: "json", span: 24, help: "شرطی روی رکورد (زبان شرط‌ها)؛ خالی یعنی همهٔ رکوردها." },
    { name: "schedule_minutes", label: "هر چند دقیقه", type: "int", min: 15, max: 10_080, span: 8 },
    { name: "schedule_filter", label: "رکوردهای زمان‌بندی", type: "json", span: 16 },
    { name: "roles", label: "نقش‌های مجاز", type: "tags", span: 12, help: "خالی یعنی هر کسی که رکورد را می‌بیند و به هوش مصنوعی دسترسی دارد." },
    { name: "field_groups", label: "گروه‌های فیلد که می‌خواند", type: "multichoice", choices: SKILL_GROUP_OPTIONS, span: 12, help: "فیلدهای این گروه‌ها فقط وقتی به مدل می‌رسند که کاربر هم آن‌ها را ببیند." },
    { name: "auto_apply", label: "اعمال خودکار", type: "tags", span: 12, help: "فقط فیلدهایی که اینجا نام می‌برید در اجرای خودکار بی‌تأیید ثبت می‌شوند؛ «work_note» برای یادداشت داخلی. پاسخ به درخواست‌کننده هرگز خودکار فرستاده نمی‌شود." },
    { name: "daily_limit", label: "سقف اجرای روزانهٔ سازمان", type: "int", min: 1, max: 1_000_000, span: 6 },
    { name: "user_daily_limit", label: "سقف روزانهٔ هر عضو", type: "int", min: 1, max: 100_000, span: 6 },
    { name: "active_version_id", label: "نسخهٔ منتشرشده", type: "ref", ref: AI_SKILL_VERSION, readonly: true, span: 12 },
    { name: "last_scheduled_at", label: "آخرین اجرای زمان‌بندی", type: "datetime", readonly: true, audit: false, span: 12 },
  ],
  unique: [["key"]],
  scope: {},
  features: { history: true },
  list: { columns: ["name", "key", "module", "output", "tier", "enabled", "builtin"], order: "module,name" },
};

const version: TableDef = {
  key: AI_SKILL_VERSION,
  table: "sm_ai_skill_versions",
  label: "نسخهٔ مهارت",
  plural: "نسخه‌های مهارت",
  icon: "git-branch",
  module: "ai",
  area: "ai",
  description: "درخواست (پرامپت) یک مهارت در یک نسخه: دستور سامانه، الگوی پیام با جای‌نگهدارها، طرح خروجی",
  display: "label",
  fields: [
    { name: "skill_id", label: "مهارت", type: "ref", ref: AI_SKILL, required: true, list: true, filter: true, index: true, readonly: true, span: 12 },
    { name: "revision", label: "نسخه", type: "int", readonly: true, list: true, sort: true, span: 6 },
    { name: "label", label: "عنوان", type: "string", maxLength: 160, readonly: true, list: true, span: 6 },
    { name: "state", label: "وضعیت", type: "choice", choices: VERSION_STATES, default: "draft", readonly: true, list: true, filter: true, span: 8 },
    { name: "system", label: "دستور سامانه", type: "text", required: true, span: 24 },
    { name: "template", label: "الگوی پیام", type: "text", required: true, span: 24 },
    { name: "output_schema", label: "طرح خروجی (JSON Schema)", type: "json", span: 24 },
    { name: "temperature", label: "خلاقیت (دما)", type: "decimal", min: 0, max: 2, span: 8 },
    { name: "max_tokens", label: "سقف واژه‌های خروجی", type: "int", min: 64, max: 32_000, span: 8 },
    { name: "note", label: "یادداشت تغییر", type: "string", maxLength: 300, list: true, span: 24 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", readonly: true, span: 12 },
    { name: "published_by", label: "منتشرکننده", type: "user", readonly: true, span: 12 },
  ],
  scope: {},
  list: { columns: ["skill_id", "revision", "state", "note", "created_by", "created_at"], order: "-created_at" },
};

const run: TableDef = {
  key: AI_SKILL_RUN,
  table: "sm_ai_skill_runs",
  label: "اجرای مهارت",
  plural: "اجراهای مهارت",
  icon: "history",
  module: "ai",
  area: "ai",
  description: "هر بار اجرای یک مهارت: ورودی، خروجی، منابع، مدل، مصرف و بازخورد — فقط برای کسی که آن را اجرا کرده است",
  display: "skill_key",
  fields: [
    { name: "skill_key", label: "مهارت", type: "string", maxLength: 80, readonly: true, ltr: true, list: true, filter: true, index: true, span: 8 },
    { name: "skill_id", label: "ردیف مهارت", type: "ref", ref: AI_SKILL, readonly: true, span: 8 },
    { name: "version_id", label: "نسخه", type: "ref", ref: AI_SKILL_VERSION, readonly: true, span: 8 },
    { name: "version_no", label: "شمارهٔ نسخه", type: "int", readonly: true, span: 6 },
    { name: "invoker_id", label: "اجراکننده", type: "user", readonly: true, required: true, list: true, filter: true, index: true, span: 8 },
    { name: "principal", label: "از طرف", type: "choice", choices: [{ value: "person", label: "خود کاربر" }, { value: "service", label: "دستیار هوش مصنوعی" }], default: "person", readonly: true, span: 6 },
    { name: "table_key", label: "جدول", type: "string", maxLength: 60, readonly: true, ltr: true, list: true, filter: true, span: 6 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", maxLength: 36, readonly: true, ltr: true, index: true, span: 12 },
    { name: "record_number", label: "شمارهٔ رکورد", type: "string", maxLength: 40, readonly: true, ltr: true, list: true, span: 6 },
    { name: "input_hash", label: "چکیدهٔ ورودی", type: "string", maxLength: 64, readonly: true, ltr: true, span: 12 },
    { name: "params", label: "پارامترها", type: "json", readonly: true },
    { name: "status", label: "وضعیت", type: "choice", choices: RUN_STATUSES, default: "ok", readonly: true, list: true, filter: true, span: 6 },
    { name: "output_kind", label: "نوع خروجی", type: "choice", choices: opts(SKILL_OUTPUTS), readonly: true, span: 6 },
    { name: "output_text", label: "خروجی", type: "markdown", readonly: true },
    { name: "output_json", label: "خروجی ساختاریافته", type: "json", readonly: true },
    { name: "citations", label: "منابع", type: "json", readonly: true },
    // what the run read (the proposals' tokens: fields, `@g:` groups, `@f:` fields of sources, `@r:` records): its
    // output is shown only to people who may read all of it now — its author too
    { name: "clearance", label: "آنچه خوانده شد", type: "json", readonly: true, hidden: true },
    { name: "model", label: "مدل", type: "string", maxLength: 120, readonly: true, ltr: true, list: true, span: 8 },
    { name: "connection", label: "اتصال", type: "string", maxLength: 120, readonly: true, span: 8 },
    { name: "tokens_in", label: "واژه‌های ورودی", type: "int", readonly: true, span: 6 },
    { name: "tokens_out", label: "واژه‌های خروجی", type: "int", readonly: true, span: 6 },
    { name: "cost_usd", label: "هزینه (دلار)", type: "string", maxLength: 24, readonly: true, ltr: true, span: 6 },
    { name: "latency_ms", label: "زمان (میلی‌ثانیه)", type: "int", readonly: true, span: 6 },
    { name: "error", label: "خطا", type: "string", maxLength: 500, readonly: true, span: 24 },
    { name: "proposal_id", label: "پیشنهاد", type: "string", maxLength: 36, readonly: true, ltr: true, span: 12 },
    { name: "feedback", label: "بازخورد", type: "int", min: -1, max: 1, readonly: true, list: true, filter: true, span: 6 },
    { name: "feedback_comment", label: "توضیح بازخورد", type: "string", maxLength: 1000, readonly: true, span: 24 },
  ],
  scope: { own: ["invoker_id"], requester: [] },
  // a run is private to the member who started it, whatever the area grant: a summary built from fields its author
  // could see never becomes visible to anyone else through the record API
  rowAccess: { read: { f: "invoker_id", op: "is_me" } },
  features: { sync: false, history: false },
  list: { columns: ["skill_key", "record_number", "status", "model", "feedback", "created_at"], order: "-created_at" },
};

const evalSet: TableDef = {
  key: AI_SKILL_EVAL,
  table: "sm_ai_skill_evals",
  label: "مجموعهٔ ارزیابی مهارت",
  plural: "مجموعه‌های ارزیابی مهارت",
  icon: "flask-conical",
  module: "ai",
  area: "ai",
  description: "نمونه‌های ورودی و ویژگی‌های مورد انتظار خروجی یک مهارت؛ با مدل خود سازمان اجرا و نمره‌گذاری می‌شود",
  display: "name",
  fields: [
    { name: "skill_key", label: "مهارت", type: "string", required: true, maxLength: 80, ltr: true, list: true, filter: true, index: true, span: 12 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "cases", label: "نمونه‌ها", type: "json", required: true, span: 24 },
    { name: "last_score", label: "آخرین نمره", type: "decimal", readonly: true, list: true, span: 8 },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", readonly: true, list: true, span: 8 },
    { name: "last_model", label: "مدل آخرین اجرا", type: "string", maxLength: 120, readonly: true, ltr: true, span: 8 },
    { name: "last_results", label: "نتیجهٔ نمونه‌ها", type: "json", readonly: true, span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "skill_key", "last_score", "last_run_at"], order: "skill_key,name" },
};

export const AI_TABLES: TableDef[] = [skill, version, run, evalSet];
