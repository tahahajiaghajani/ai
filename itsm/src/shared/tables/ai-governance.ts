// AI governance and insights (docs/spec/AI.md §14–15): engine tables that travel between the web version and the
// Windows app, so that both runtimes hold one policy and one person's digests.
//   · `ai_data_policy` — the data-use policy of a table: whether its data may go to cloud models, only to models
//     running on the organisation's own computers, or never to any model; and a stricter personal-data masking for
//     it than the organisation's. Enforced by the AI chain before any call (src/server/modules/ai/datause.ts). Only AI
//     administrators change it (a hook holds every write path).
//   · `ai_digest` — an insight digest delivered to one person (daily or weekly), built from the insights that person may
//     see; read only by its recipient, written only by the runtime.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { NEVER } from "../model/conditions";

export const AI_DATA_POLICY = "ai_data_policy";
export const AI_DIGEST = "ai_digest";

export const DATA_USE: Option[] = [
  { value: "cloud", label: "مدل‌های ابری و محلی", color: "green" },
  { value: "local", label: "فقط مدل‌های محلی سازمان", color: "gold" },
  { value: "never", label: "هرگز به هیچ مدلی", color: "red" },
];

export const DATA_PII: Option[] = [
  { value: "inherit", label: "مطابق سیاست سازمان" },
  { value: "masked", label: "پوشاندن شناسه‌های شخصی" },
  { value: "aggregates", label: "پوشاندن شناسه‌ها و نام افراد" },
];

const policy: TableDef = {
  key: AI_DATA_POLICY,
  table: "sm_ai_data_policies",
  label: "سیاست دادهٔ هوش مصنوعی",
  plural: "سیاست‌های دادهٔ هوش مصنوعی",
  icon: "shield-check",
  module: "ai",
  area: "ai",
  description: "دادهٔ هر جدول به کدام مدل‌ها می‌رسد (ابری، فقط محلی، هرگز) و با چه پوشاندنی؛ پیش از هر فراخوانی مدل اعمال می‌شود",
  display: "table_key",
  fields: [
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, ltr: true, list: true, search: true, sort: true, span: 12 },
    { name: "use", label: "استفاده در مدل‌ها", type: "choice", choices: DATA_USE, default: "cloud", required: true, list: true, filter: true, span: 12 },
    { name: "pii", label: "پوشاندن دادهٔ شخصی", type: "choice", choices: DATA_PII, default: "inherit", required: true, list: true, filter: true, span: 12 },
    { name: "note", label: "توضیح", type: "text", span: 24 },
  ],
  unique: [["table_key"]],
  scope: { public: true },
  features: { history: true },
  list: { columns: ["table_key", "use", "pii"], order: "table_key" },
};

export const DIGEST_PERIODS: Option[] = [
  { value: "daily", label: "روزانه" },
  { value: "weekly", label: "هفتگی" },
];

const digest: TableDef = {
  key: AI_DIGEST,
  table: "sm_ai_digests",
  label: "خلاصهٔ بینش‌ها",
  plural: "خلاصه‌های بینش",
  icon: "newspaper",
  module: "ai",
  // a report delivered to one person (like a scheduled report's delivery): whoever reads reports reads their own
  area: "reports",
  description: "بینش‌های یک دوره برای یک نفر؛ فقط از داده‌هایی که خود او می‌بیند ساخته می‌شود و فقط خود او آن را می‌بیند",
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, readonly: true, list: true, search: true, span: 24 },
    { name: "recipient_id", label: "گیرنده", type: "user", required: true, readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "period", label: "دوره", type: "choice", choices: DIGEST_PERIODS, readonly: true, list: true, filter: true, span: 8 },
    { name: "period_key", label: "کلید دوره", type: "string", maxLength: 20, readonly: true, ltr: true, span: 8 },
    { name: "insights", label: "شمار بینش‌ها", type: "int", default: 0, readonly: true, list: true, span: 8 },
    { name: "body", label: "متن", type: "markdown", readonly: true, span: 24 },
    { name: "delivered_at", label: "زمان", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
  ],
  unique: [["recipient_id", "period", "period_key"]],
  scope: { own: ["recipient_id"], requester: [] },
  rowAccess: { read: { f: "recipient_id", op: "is_me" }, write: NEVER },
  features: { history: false },
  list: { columns: ["title", "period", "insights", "delivered_at"], order: "-delivered_at" },
};

export const AI_GOVERNANCE_TABLES: TableDef[] = [policy, digest];
