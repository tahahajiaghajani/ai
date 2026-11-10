// «عامل‌های هوش مصنوعی» and «دستیار مجازی» (docs/spec/AI.md §11.8, catalogue AI-058…064, AI-074…077): engine tables of
// the AI layer's agents and the virtual agent's brain.
//   · `ai_agent` — an agent: Persian name, goal and instructions, allowed tools, triggers, the principal (a service member
//     whose roles the administrator chooses), autonomy, budgets and guardrails. Area `ai`; only AI administrators change
//     agents (a hook holds every write path). Built-in agents are seeded switched off.
//   · `ai_agent_run` — one run, step by step (model turns, tool calls, proposals, applied actions, tokens, cost, errors):
//     local to the runtime that ran it (like the skills' runs), written only by the runtime, read only by AI administrators
//     (the studio) — never through the generic API.
//   · `va_topic` — the virtual agent's topics (keywords and Persian examples, what a topic does); `va_conversation` and
//     `va_message` — a requester's conversations with it (local, private to the requester, written by the runtime).
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { AGENT_AUTONOMY, AGENT_RUN_STATUS, AGENT_RUN_TRIGGERS, AGENT_TRIGGERS } from "../ai/agents";
import { SKILL_EVENTS, SKILL_TIERS } from "../ai/skills";
import { SKILL_GROUP_OPTIONS } from "./ai";
import { NEVER } from "../model/conditions";

export const AI_AGENT = "ai_agent";
export const AI_AGENT_RUN = "ai_agent_run";
export const VA_TOPIC = "va_topic";
export const VA_CONVERSATION = "va_conversation";
export const VA_MESSAGE = "va_message";

const opts = (m: Record<string, string | { label: string }>): Option[] => Object.entries(m).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));

const agent: TableDef = {
  key: AI_AGENT,
  table: "sm_ai_agents",
  label: "عامل هوش مصنوعی",
  plural: "عامل‌های هوش مصنوعی",
  icon: "bot",
  module: "ai",
  area: "ai",
  description: "کاری که هوش مصنوعی با هویت و نقش‌های خودش، در چارچوب ابزارها، بودجه و محدودیت‌های تعیین‌شده انجام می‌دهد",
  display: "name",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 80, ltr: true, list: true, search: true, sort: true, span: 12, help: "حرف لاتین کوچک، رقم، نقطه و _؛ پس از ساخت تغییر نمی‌کند." },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12 },
    { name: "description", label: "شرح", type: "text", search: true, span: 24 },
    { name: "module", label: "بخش", type: "string", maxLength: 40, ltr: true, readonly: true, list: true, filter: true, span: 8 },
    { name: "base_key", label: "عامل پایه", type: "string", maxLength: 80, ltr: true, readonly: true, span: 8 },
    { name: "builtin", label: "داخلی", type: "bool", default: false, readonly: true, list: true, filter: true, span: 8 },
    { name: "enabled", label: "فعال", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "goal", label: "هدف و دستورالعمل", type: "text", required: true, span: 24 },
    { name: "tables", label: "جدول‌ها", type: "tags", span: 24, help: "رکوردهایی که عامل روی آن‌ها کار می‌کند (رویدادها، زمان‌بندی و آزمایش)." },
    { name: "triggers", label: "آغاز با", type: "multichoice", choices: opts(AGENT_TRIGGERS), default: ["manual"], span: 12 },
    { name: "events", label: "رویدادها", type: "multichoice", choices: opts(SKILL_EVENTS), span: 12 },
    { name: "condition", label: "شرط اجرا", type: "json", span: 24 },
    { name: "schedule_minutes", label: "هر چند دقیقه", type: "int", min: 15, max: 10_080, span: 8 },
    { name: "schedule_filter", label: "رکوردهای زمان‌بندی", type: "json", span: 16 },
    { name: "tools", label: "ابزارهای مجاز", type: "tags", span: 24, help: "نام ابزارها یا الگو مثل get_* و skill:incident.triage؛ عامل فقط ابزارهایی را دارد که هم اینجا آمده و هم هویتش اجازه دارد." },
    { name: "autonomy", label: "اختیار عمل", type: "choice", choices: opts(AGENT_AUTONOMY), default: "suggest", required: true, list: true, span: 8 },
    { name: "auto_actions", label: "کارهای کم‌خطر مجاز", type: "tags", span: 16, help: "فقط در «اقدام خودکار»: draft_update_<جدول>:<فیلد>، draft_journal_entry:work_note، draft_link_records." },
    { name: "approvers", label: "تأییدکنندگان", type: "users", span: 12 },
    { name: "approver_group_id", label: "گروه تأییدکننده", type: "group", span: 12 },
    { name: "tier", label: "ردهٔ مدل", type: "choice", choices: opts(SKILL_TIERS), default: "standard", required: true, span: 8 },
    { name: "max_steps", label: "سقف گام در هر اجرا", type: "int", min: 1, max: 40, default: 8, span: 8 },
    { name: "max_tokens", label: "سقف واژه در هر اجرا", type: "int", min: 1000, max: 2_000_000, default: 60_000, span: 8 },
    { name: "max_actions", label: "سقف اقدام در هر اجرا", type: "int", min: 0, max: 200, default: 5, span: 8 },
    { name: "daily_runs", label: "سقف اجرای روزانه", type: "int", min: 1, max: 100_000, default: 50, span: 8 },
    { name: "forbidden_tables", label: "جدول‌های ممنوع", type: "tags", span: 12 },
    { name: "forbidden_fields", label: "فیلدهای ممنوع", type: "tags", span: 12, help: "نام فیلد یا جدول.فیلد" },
    { name: "forbidden_states", label: "وضعیت‌های ممنوع", type: "tags", span: 12, help: "وضعیتی که عامل هرگز رکوردی را به آن نمی‌برد (یا جدول:وضعیت)" },
    { name: "roles", label: "نقش‌هایی که آغازش می‌کنند", type: "tags", span: 12 },
    { name: "field_groups", label: "گروه‌های فیلد که به مدل می‌رسد", type: "multichoice", choices: SKILL_GROUP_OPTIONS, span: 12 },
    { name: "principal_id", label: "هویت عامل", type: "user", readonly: true, span: 12 },
    { name: "last_scheduled_at", label: "آخرین زمان‌بندی", type: "datetime", readonly: true, audit: false, span: 12 },
  ],
  unique: [["key"]],
  scope: {},
  features: { history: true },
  list: { columns: ["name", "key", "module", "autonomy", "enabled", "builtin"], order: "module,name" },
};

const run: TableDef = {
  key: AI_AGENT_RUN,
  table: "sm_ai_agent_runs",
  label: "اجرای عامل",
  plural: "اجراهای عامل",
  icon: "activity",
  module: "ai",
  area: "ai",
  description: "هر اجرای یک عامل گام به گام: برنامه، ابزارها، پیشنهادها، اقدام‌ها، مصرف و خطاها",
  display: "agent_name",
  fields: [
    { name: "agent_id", label: "عامل", type: "ref", ref: AI_AGENT, readonly: true, index: true, filter: true, span: 8 },
    { name: "agent_key", label: "کلید عامل", type: "string", maxLength: 80, readonly: true, ltr: true, list: true, filter: true, index: true, span: 8 },
    { name: "agent_name", label: "نام عامل", type: "string", maxLength: 120, readonly: true, list: true, span: 8 },
    { name: "trigger", label: "آغاز با", type: "choice", choices: opts(AGENT_RUN_TRIGGERS), readonly: true, list: true, filter: true, span: 6 },
    { name: "why", label: "رویداد", type: "string", maxLength: 60, readonly: true, span: 6 },
    { name: "started_by", label: "آغازکننده", type: "user", readonly: true, index: true, span: 6 },
    { name: "principal_id", label: "هویت عامل", type: "user", readonly: true, span: 6 },
    { name: "table_key", label: "جدول", type: "string", maxLength: 60, readonly: true, ltr: true, list: true, span: 6 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", maxLength: 36, readonly: true, ltr: true, index: true, span: 12 },
    { name: "record_number", label: "شمارهٔ رکورد", type: "string", maxLength: 40, readonly: true, ltr: true, list: true, span: 6 },
    { name: "status", label: "وضعیت", type: "choice", choices: opts(AGENT_RUN_STATUS), default: "queued", readonly: true, list: true, filter: true, span: 6 },
    { name: "dry_run", label: "آزمایشی", type: "bool", default: false, readonly: true, span: 6 },
    { name: "step_count", label: "گام‌ها", type: "int", default: 0, readonly: true, list: true, span: 6 },
    { name: "tool_calls", label: "فراخوانی ابزار", type: "int", default: 0, readonly: true, span: 6 },
    { name: "actions", label: "اقدام‌ها و پیشنهادها", type: "int", default: 0, readonly: true, span: 6 },
    { name: "applied", label: "اعمال‌شده", type: "int", default: 0, readonly: true, span: 6 },
    { name: "proposals", label: "پیشنهادها", type: "json", readonly: true },
    { name: "steps", label: "گام‌ها", type: "json", readonly: true },
    { name: "state", label: "وضعیت گفتگو", type: "json", readonly: true, hidden: true },
    { name: "tokens_in", label: "واژه‌های ورودی", type: "int", default: 0, readonly: true, span: 6 },
    { name: "tokens_out", label: "واژه‌های خروجی", type: "int", default: 0, readonly: true, span: 6 },
    { name: "cost_usd", label: "هزینه (دلار)", type: "string", maxLength: 24, readonly: true, ltr: true, span: 6 },
    { name: "outcome", label: "نتیجه", type: "markdown", readonly: true },
    { name: "error", label: "خطا", type: "string", maxLength: 500, readonly: true, span: 24 },
    { name: "started_at", label: "آغاز", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "ended_at", label: "پایان", type: "datetime", readonly: true, span: 8 },
  ],
  scope: { own: ["started_by"], requester: [] },
  // never through the generic API: a run's steps hold what the agent's principal read, which its starter may not read.
  // AI administrators read runs in the studio; whoever started one sees its status and its proposals (each checked)
  rowAccess: { read: NEVER },
  features: { sync: false, history: false },
  list: { columns: ["agent_name", "trigger", "record_number", "status", "step_count", "started_at"], order: "-started_at" },
};

export const VA_TOPIC_KINDS: Record<string, string> = {
  knowledge: "پاسخ از دانش",
  status: "وضعیت درخواست‌های من",
  order: "سفارش از کاتالوگ",
  catalog_item: "قلم مشخص کاتالوگ",
  report_issue: "گزارش مشکل",
  handoff: "گفتگو با کارشناس",
  answer: "پاسخ ثابت",
};

const topic: TableDef = {
  key: VA_TOPIC,
  table: "sm_va_topics",
  label: "موضوع دستیار مجازی",
  plural: "موضوع‌های دستیار مجازی",
  icon: "messages-square",
  module: "ai",
  area: "ai",
  description: "آنچه دستیار مجازی با هر نیت انجام می‌دهد: کلیدواژه‌ها و نمونه‌های فارسی، و کاری که پس از تشخیص می‌کند",
  display: "name",
  fields: [
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 60, ltr: true, list: true, search: true, span: 8 },
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 16 },
    { name: "kind", label: "کار", type: "choice", choices: opts(VA_TOPIC_KINDS), required: true, list: true, filter: true, span: 8 },
    { name: "enabled", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 8 },
    { name: "builtin", label: "داخلی", type: "bool", default: false, readonly: true, span: 8 },
    { name: "priority", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "keywords", label: "کلیدواژه‌ها", type: "tags", span: 24 },
    { name: "examples", label: "نمونه‌ها (هر خط یکی)", type: "text", span: 24 },
    { name: "item_id", label: "قلم کاتالوگ", type: "ref", ref: "catalog_item", span: 12 },
    { name: "tables", label: "جدول‌های دانش", type: "tags", span: 12, help: "برای «پاسخ از دانش»: جست‌وجو فقط در این جدول‌ها (خالی: همهٔ منابع)" },
    { name: "answer", label: "پاسخ", type: "markdown", span: 24 },
  ],
  unique: [["key"]],
  scope: { public: true },
  features: { history: true },
  list: { columns: ["name", "key", "kind", "enabled", "priority"], order: "priority,name" },
};

export const VA_STATES: Option[] = [
  { value: "open", label: "باز", color: "blue" },
  { value: "handoff", label: "واگذار به کارشناس", color: "orange" },
  { value: "ended", label: "پایان یافته", color: "gray" },
];

const conversation: TableDef = {
  key: VA_CONVERSATION,
  table: "sm_va_conversations",
  label: "گفتگوی دستیار مجازی",
  plural: "گفتگوهای دستیار مجازی",
  icon: "message-circle",
  module: "ai",
  area: "ai",
  display: "title",
  fields: [
    { name: "requester_id", label: "درخواست‌کننده", type: "user", required: true, readonly: true, index: true, list: true, span: 8 },
    { name: "title", label: "عنوان", type: "string", maxLength: 200, readonly: true, list: true, span: 16 },
    { name: "channel", label: "مجرا", type: "string", maxLength: 30, readonly: true, ltr: true, list: true, span: 8 },
    { name: "state", label: "وضعیت", type: "choice", choices: VA_STATES, default: "open", readonly: true, list: true, filter: true, span: 8 },
    { name: "topic", label: "موضوع جاری", type: "string", maxLength: 60, readonly: true, ltr: true, span: 8 },
    { name: "slots", label: "پاسخ‌های در جریان", type: "json", readonly: true, hidden: true },
    { name: "language", label: "زبان", type: "string", maxLength: 4, readonly: true, ltr: true, span: 6 },
    { name: "handoff_table", label: "جدول واگذاری", type: "string", maxLength: 60, readonly: true, ltr: true, span: 8 },
    { name: "handoff_id", label: "رکورد واگذاری", type: "string", maxLength: 36, readonly: true, ltr: true, span: 12 },
    { name: "messages_count", label: "پیام‌ها", type: "int", default: 0, readonly: true, span: 6 },
    { name: "last_at", label: "آخرین پیام", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "ended_at", label: "پایان", type: "datetime", readonly: true, span: 8 },
  ],
  scope: { own: ["requester_id"], requester: ["requester_id"] },
  rowAccess: { read: { f: "requester_id", op: "is_me" } },
  features: { sync: false, history: false },
  list: { columns: ["title", "channel", "state", "last_at"], order: "-last_at" },
};

const message: TableDef = {
  key: VA_MESSAGE,
  table: "sm_va_messages",
  label: "پیام دستیار مجازی",
  plural: "پیام‌های دستیار مجازی",
  icon: "message-square",
  module: "ai",
  area: "ai",
  display: "role",
  fields: [
    { name: "conversation_id", label: "گفتگو", type: "ref", ref: VA_CONVERSATION, required: true, readonly: true, index: true, span: 12 },
    { name: "requester_id", label: "درخواست‌کننده", type: "user", required: true, readonly: true, index: true, span: 12 },
    { name: "role", label: "فرستنده", type: "choice", choices: [{ value: "user", label: "کاربر" }, { value: "agent", label: "دستیار" }, { value: "system", label: "سامانه" }], readonly: true, span: 8 },
    { name: "text", label: "متن", type: "markdown", readonly: true },
    { name: "cards", label: "کارت‌ها", type: "json", readonly: true },
    { name: "topic", label: "موضوع", type: "string", maxLength: 60, readonly: true, ltr: true, span: 8 },
    { name: "route", label: "مسیر", type: "string", maxLength: 30, readonly: true, ltr: true, span: 8 },
  ],
  scope: { own: ["requester_id"], requester: ["requester_id"] },
  rowAccess: { read: { f: "requester_id", op: "is_me" } },
  features: { sync: false, history: false },
  list: { columns: ["role", "text", "created_at"], order: "created_at" },
};

export const AI_AGENT_TABLES: TableDef[] = [agent, run, topic, conversation, message];
