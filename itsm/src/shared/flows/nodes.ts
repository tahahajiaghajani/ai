// The node catalogue: every node type a flow can use — its Persian label, palette group, icon (a lucide name),
// output ports and the settings its property panel edits. The designer renders palette, ports and forms from it;
// the validator checks graphs against it; the executor implements each type (src/server/modules/flows/nodes.ts).
// Pure data: imported by the UI too.
import type { NodeType } from "./types";

/** How the property panel edits a setting (and what shape the value has). */
export type ConfigFieldKind =
  /** plain text */
  | "text"
  /** one line with data pills `{{…}}` */
  | "template"
  /** several lines (Markdown) with data pills */
  | "textarea"
  /** JSON/text body with data pills (LTR) */
  | "body"
  | "number"
  | "switch"
  | "select"
  /** a table key */
  | "table"
  /** a record id — usually a pill such as {{trigger.record.id}} */
  | "record"
  /** { field: template } for the table named by `tableKey` */
  | "values"
  /** an engine condition (Cond) on the table named by `tableKey` */
  | "condition"
  /** [{ left, op, right }] comparisons of data (pills) */
  | "rules"
  /** { users: string[], fields: string[], groups: string[] } — people, user fields of the record, groups */
  | "recipients"
  /** { amount, unit } */
  | "duration"
  /** [{ name, value }] — variables, inputs, outputs */
  | "assignments"
  /** [{ name, path }] — values picked out of a JSON answer */
  | "mappings"
  /** [{ key, value }] — headers, query parameters */
  | "keyvalues"
  /** a flow id */
  | "flow"
  /** a flow_connection id */
  | "connection"
  /** a registered AI skill key */
  | "skill";

export interface ConfigField {
  key: string;
  label: string;
  kind: ConfigFieldKind;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** the config key naming the table this field works on ("values", "condition", "record"); "" = the trigger's table */
  tableKey?: string;
  /** show only when another setting has one of these values */
  showIf?: { key: string; in: unknown[] };
  placeholder?: string;
  ltr?: boolean;
  default?: unknown;
}

export interface PortDef {
  key: string;
  label: string;
  /** the failure path: taken when the step fails (without one the run fails) */
  error?: boolean;
  /** several edges may leave this port (parallel branches) */
  multi?: boolean;
}

export type NodeGroup = "start" | "records" | "communication" | "control";

export interface NodeTypeDef {
  type: NodeType;
  label: string;
  /** one short line for the palette */
  hint: string;
  icon: string;
  group: NodeGroup;
  ports: PortDef[];
  fields: ConfigField[];
  /** outputs other steps can read as {{steps.<id>.output.<key>}} (the designer's pill picker) */
  outputs?: { key: string; label: string }[];
  /** the step may wait (the run pauses and resumes through the job queue) */
  waits?: boolean;
}

export const NODE_GROUPS: Record<NodeGroup, string> = {
  start: "شروع",
  records: "رکوردها",
  communication: "ارتباط و تأیید",
  control: "کنترل جریان",
};

const OUT: PortDef = { key: "out", label: "بعدی" };
const ERROR: PortDef = { key: "error", label: "خطا", error: true };

export const DURATION_UNITS = [
  { value: "minute", label: "دقیقه" },
  { value: "hour", label: "ساعت" },
  { value: "day", label: "روز" },
  { value: "week", label: "هفته" },
];

/** Comparisons of the data mode of «شرط» (`rules`). */
export const RULE_OPS = [
  { value: "eq", label: "برابر است با" },
  { value: "ne", label: "برابر نیست با" },
  { value: "gt", label: "بزرگ‌تر از" },
  { value: "gte", label: "بزرگ‌تر یا برابر" },
  { value: "lt", label: "کوچک‌تر از" },
  { value: "lte", label: "کوچک‌تر یا برابر" },
  { value: "contains", label: "شامل" },
  { value: "ncontains", label: "شامل نیست" },
  { value: "empty", label: "خالی است" },
  { value: "nempty", label: "خالی نیست" },
] as const;
export type RuleOp = (typeof RULE_OPS)[number]["value"];

const TABLE: ConfigField = { key: "table", label: "جدول", kind: "table", placeholder: "جدول شروع‌کننده" };
const RECORD: ConfigField = { key: "record", label: "رکورد", kind: "record", tableKey: "table", default: "{{trigger.record.id}}", ltr: true };

export const NODE_TYPES: Record<NodeType, NodeTypeDef> = {
  trigger: {
    type: "trigger",
    label: "شروع",
    hint: "رویدادی که گردش‌کار را آغاز می‌کند",
    icon: "zap",
    group: "start",
    ports: [OUT],
    fields: [],
  },
  update_record: {
    type: "update_record",
    label: "به‌روزرسانی رکورد",
    hint: "فیلدهای یک رکورد را تغییر می‌دهد",
    icon: "pencil-line",
    group: "records",
    ports: [OUT, ERROR],
    fields: [TABLE, RECORD, { key: "values", label: "مقدارها", kind: "values", tableKey: "table", required: true }],
    outputs: [{ key: "id", label: "شناسه" }, { key: "record", label: "رکورد" }, { key: "labels", label: "برچسب‌ها" }],
  },
  create_record: {
    type: "create_record",
    label: "ساخت رکورد",
    hint: "رکوردی تازه در یک جدول می‌سازد",
    icon: "file-plus",
    group: "records",
    ports: [OUT, ERROR],
    fields: [{ ...TABLE, required: true, placeholder: undefined }, { key: "values", label: "مقدارها", kind: "values", tableKey: "table", required: true }],
    outputs: [{ key: "id", label: "شناسه" }, { key: "number", label: "شماره" }, { key: "record", label: "رکورد" }, { key: "labels", label: "برچسب‌ها" }],
  },
  add_comment: {
    type: "add_comment",
    label: "یادداشت روی رکورد",
    hint: "نظر یا یادداشت کاری ثبت می‌کند",
    icon: "message-square-text",
    group: "records",
    ports: [OUT, ERROR],
    fields: [
      TABLE,
      RECORD,
      { key: "kind", label: "نوع", kind: "select", default: "work_note", options: [{ value: "work_note", label: "یادداشت کاری (داخلی)" }, { value: "comment", label: "نظر (عمومی)" }] },
      { key: "body", label: "متن", kind: "textarea", required: true },
    ],
    outputs: [{ key: "entry_id", label: "شناسهٔ یادداشت" }],
  },
  notify: {
    type: "notify",
    label: "ارسال اعلان",
    hint: "به افراد، گروه‌ها یا افراد رکورد خبر می‌دهد",
    icon: "bell",
    group: "communication",
    ports: [OUT, ERROR],
    fields: [
      { key: "to", label: "گیرندگان", kind: "recipients", tableKey: "table", required: true },
      { key: "subject", label: "عنوان", kind: "template", required: true },
      { key: "body", label: "متن", kind: "textarea" },
      { ...TABLE, label: "دربارهٔ رکوردِ جدول" },
      { ...RECORD, label: "دربارهٔ رکورد" },
    ],
    outputs: [{ key: "recipients", label: "گیرندگان" }, { key: "sent", label: "فرستاده شد" }],
  },
  approval: {
    type: "approval",
    label: "درخواست تأیید",
    hint: "از تأییدکنندگان تأیید می‌خواهد و منتظر می‌ماند",
    icon: "badge-check",
    group: "communication",
    ports: [{ key: "approved", label: "تأیید شد" }, { key: "rejected", label: "رد شد" }, ERROR],
    fields: [
      { key: "approvers", label: "تأییدکنندگان", kind: "recipients", tableKey: "table", required: true },
      {
        key: "rule",
        label: "قاعده",
        kind: "select",
        default: "any",
        options: [{ value: "any", label: "تأیید یک نفر کافی است" }, { value: "all", label: "همه باید تأیید کنند" }, { value: "count", label: "تعداد معینی تأیید کنند" }],
      },
      { key: "threshold", label: "تعداد تأیید لازم", kind: "number", default: 2, showIf: { key: "rule", in: ["count"] } },
      { key: "title", label: "عنوان", kind: "template", required: true },
      { key: "message", label: "توضیح", kind: "textarea" },
      { ...TABLE, label: "دربارهٔ رکوردِ جدول" },
      { ...RECORD, label: "دربارهٔ رکورد" },
    ],
    outputs: [{ key: "decision", label: "تصمیم" }, { key: "by", label: "تصمیم‌گیرنده" }, { key: "comment", label: "توضیح تصمیم" }],
    waits: true,
  },
  wait_condition: {
    type: "wait_condition",
    label: "انتظار برای شرط",
    hint: "تا برقرار شدن شرطی روی رکورد صبر می‌کند",
    icon: "hourglass",
    group: "control",
    ports: [OUT, { key: "timeout", label: "پایان مهلت" }],
    fields: [
      TABLE,
      RECORD,
      { key: "condition", label: "شرط", kind: "condition", tableKey: "table", required: true },
      { key: "timeout", label: "حداکثر انتظار", kind: "duration" },
      { key: "poll", label: "بررسی دوره‌ای (دقیقه)", kind: "number", default: 60 },
    ],
    outputs: [{ key: "matched", label: "شرط برقرار شد" }, { key: "timed_out", label: "مهلت تمام شد" }],
    waits: true,
  },
  wait_duration: {
    type: "wait_duration",
    label: "انتظار زمانی",
    hint: "مدتی یا تا زمانی معین صبر می‌کند",
    icon: "timer",
    group: "control",
    ports: [OUT],
    fields: [
      { key: "mode", label: "تا", kind: "select", default: "duration", options: [{ value: "duration", label: "گذشت مدت" }, { value: "until", label: "زمانی معین" }] },
      { key: "duration", label: "مدت", kind: "duration", showIf: { key: "mode", in: ["duration", undefined, null, ""] } },
      { key: "business", label: "به وقت کاری", kind: "switch", showIf: { key: "mode", in: ["duration", undefined, null, ""] } },
      { key: "until", label: "زمان", kind: "template", ltr: true, placeholder: "{{trigger.record.due_at}}", showIf: { key: "mode", in: ["until"] } },
    ],
    outputs: [{ key: "due_at", label: "زمان ادامه" }],
    waits: true,
  },
  branch: {
    type: "branch",
    label: "شرط (اگر / وگرنه)",
    hint: "بسته به شرطی یکی از دو مسیر را می‌رود",
    icon: "git-branch",
    group: "control",
    ports: [{ key: "yes", label: "بله" }, { key: "no", label: "خیر" }],
    fields: [
      { key: "mode", label: "بررسی", kind: "select", default: "record", options: [{ value: "record", label: "شرط روی رکورد" }, { value: "data", label: "مقایسهٔ داده‌ها" }] },
      { ...TABLE, showIf: { key: "mode", in: ["record", undefined, null, ""] } },
      { ...RECORD, showIf: { key: "mode", in: ["record", undefined, null, ""] } },
      { key: "condition", label: "شرط", kind: "condition", tableKey: "table", showIf: { key: "mode", in: ["record", undefined, null, ""] } },
      { key: "rules", label: "مقایسه‌ها", kind: "rules", showIf: { key: "mode", in: ["data"] } },
      { key: "match", label: "برقرار باشد", kind: "select", default: "all", options: [{ value: "all", label: "همهٔ مقایسه‌ها" }, { value: "any", label: "یکی از مقایسه‌ها" }], showIf: { key: "mode", in: ["data"] } },
    ],
    outputs: [{ key: "result", label: "نتیجه" }],
  },
  parallel: {
    type: "parallel",
    label: "اجرای موازی",
    hint: "چند مسیر را هم‌زمان پیش می‌برد",
    icon: "split",
    group: "control",
    ports: [{ key: "out", label: "شاخه‌ها", multi: true }],
    fields: [],
  },
  join: {
    type: "join",
    label: "پیوستن شاخه‌ها",
    hint: "منتظر پایان شاخه‌های موازی می‌ماند",
    icon: "merge",
    group: "control",
    ports: [OUT],
    fields: [{ key: "mode", label: "ادامه پس از", kind: "select", default: "all", options: [{ value: "all", label: "پایان همهٔ شاخه‌ها" }, { value: "any", label: "پایان نخستین شاخه" }] }],
  },
  for_each: {
    type: "for_each",
    label: "برای هر مورد",
    hint: "گام‌های بعدی را برای هر رکورد یا هر مورد فهرست اجرا می‌کند",
    icon: "repeat",
    group: "control",
    ports: [{ key: "each", label: "هر مورد" }, { key: "done", label: "پس از همه" }, ERROR],
    fields: [
      { key: "source", label: "موارد", kind: "select", default: "query", options: [{ value: "query", label: "رکوردهای یک جدول" }, { value: "list", label: "فهرستی از داده‌ها" }] },
      { ...TABLE, required: false, showIf: { key: "source", in: ["query", undefined, null, ""] } },
      { key: "condition", label: "شرط", kind: "condition", tableKey: "table", showIf: { key: "source", in: ["query", undefined, null, ""] } },
      { key: "sort", label: "مرتب‌سازی", kind: "text", ltr: true, placeholder: "-priority,number", showIf: { key: "source", in: ["query", undefined, null, ""] } },
      { key: "list", label: "فهرست", kind: "template", ltr: true, placeholder: "{{steps.http.output.items}}", showIf: { key: "source", in: ["list"] } },
      { key: "limit", label: "حداکثر تعداد", kind: "number", default: 100 },
    ],
    outputs: [{ key: "count", label: "تعداد موارد" }],
  },
  call_http: {
    type: "call_http",
    label: "فراخوانی HTTP",
    hint: "از سرویسی بیرونی (از اتصال‌های مجاز) درخواست می‌کند",
    icon: "globe",
    group: "communication",
    ports: [OUT, ERROR],
    fields: [
      { key: "connection", label: "اتصال", kind: "connection", required: true },
      { key: "method", label: "روش", kind: "select", default: "GET", options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })), ltr: true },
      { key: "path", label: "مسیر", kind: "template", ltr: true, placeholder: "/api/tickets/{{trigger.record.number}}" },
      { key: "query", label: "پارامترهای نشانی", kind: "keyvalues" },
      { key: "headers", label: "سرآیندها", kind: "keyvalues" },
      { key: "body", label: "بدنه (JSON)", kind: "body", ltr: true, showIf: { key: "method", in: ["POST", "PUT", "PATCH", "DELETE"] } },
      { key: "map", label: "برداشت از پاسخ", kind: "mappings" },
      { key: "timeout", label: "مهلت (ثانیه)", kind: "number", default: 15 },
    ],
    outputs: [{ key: "status", label: "کد پاسخ" }, { key: "body", label: "پاسخ" }],
  },
  set_vars: {
    type: "set_vars",
    label: "تعیین متغیرها",
    hint: "مقدارهایی را برای گام‌های بعد نگه می‌دارد",
    icon: "variable",
    group: "control",
    ports: [OUT],
    fields: [{ key: "vars", label: "متغیرها", kind: "assignments", required: true }],
  },
  subflow: {
    type: "subflow",
    label: "اجرای زیرگردش‌کار",
    hint: "گردش‌کاری دیگر را اجرا می‌کند و منتظر پایانش می‌ماند",
    icon: "workflow",
    group: "control",
    ports: [OUT, ERROR],
    fields: [
      { key: "flow", label: "گردش‌کار", kind: "flow", required: true },
      { key: "inputs", label: "ورودی‌ها", kind: "assignments" },
      { key: "wait", label: "منتظر پایان بماند", kind: "switch", default: true },
    ],
    outputs: [{ key: "run_id", label: "شناسهٔ اجرا" }, { key: "state", label: "وضعیت" }, { key: "outputs", label: "خروجی‌ها" }],
    waits: true,
  },
  ai_skill: {
    type: "ai_skill",
    label: "مهارت هوش مصنوعی",
    hint: "یکی از مهارت‌های دستیار را اجرا می‌کند",
    icon: "sparkles",
    group: "communication",
    ports: [OUT, ERROR],
    fields: [
      { key: "skill", label: "مهارت", kind: "skill", required: true },
      { key: "inputs", label: "ورودی‌ها", kind: "assignments" },
    ],
    outputs: [{ key: "text", label: "متن" }, { key: "data", label: "داده" }],
  },
  end: {
    type: "end",
    label: "پایان",
    hint: "اجرا را (همهٔ شاخه‌ها) به پایان می‌برد",
    icon: "flag",
    group: "control",
    ports: [],
    fields: [
      { key: "outcome", label: "نتیجه", kind: "select", default: "completed", options: [{ value: "completed", label: "انجام شد" }, { value: "failed", label: "ناموفق" }] },
      { key: "message", label: "پیام", kind: "template" },
      { key: "outputs", label: "خروجی‌ها (برای زیرگردش‌کار)", kind: "assignments" },
    ],
  },
};

/** Node types in palette order. */
export const PALETTE: NodeType[] = [
  "update_record", "create_record", "add_comment",
  "notify", "approval", "call_http", "ai_skill",
  "branch", "parallel", "join", "for_each", "wait_condition", "wait_duration", "set_vars", "subflow", "end",
];

export const nodeDef = (type: string): NodeTypeDef | undefined => (NODE_TYPES as Record<string, NodeTypeDef>)[type];

/** The label a node shows: its own, or its type's. */
export function nodeLabel(n: { type: string; label?: string | null }): string {
  return (n.label ?? "").trim() || nodeDef(n.type)?.label || n.type;
}

/** Default settings of a node type (from its fields' defaults). */
export function defaultConfig(type: NodeType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of NODE_TYPES[type].fields) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

/** Is a setting shown under the node's current settings (`showIf`)? */
export function fieldShown(f: ConfigField, config: Record<string, unknown>): boolean {
  if (!f.showIf) return true;
  const v = config[f.showIf.key];
  return f.showIf.in.includes(v as never) || (v === undefined && f.showIf.in.includes(undefined as never));
}

/** Trigger kinds with Persian labels. */
export const TRIGGER_KINDS = [
  { value: "record", label: "رویداد رکورد" },
  { value: "schedule", label: "زمان‌بندی" },
  { value: "webhook", label: "وب‌هوک ورودی" },
  { value: "manual", label: "اجرای دستی یا زیرگردش‌کار" },
  { value: "catalog", label: "سفارش از کاتالوگ" },
] as const;

export const TRIGGER_EVENTS = [
  { value: "created", label: "ایجاد" },
  { value: "updated", label: "تغییر" },
  { value: "state_changed", label: "تغییر وضعیت" },
  { value: "assigned", label: "ارجاع" },
  { value: "commented", label: "یادداشت تازه" },
  { value: "deleted", label: "حذف" },
] as const;

export const RUN_AS_OPTIONS = [
  { value: "trigger_user", label: "کاربرِ آغازکننده" },
  { value: "user", label: "کاربری معین (حساب سرویس)" },
  { value: "system", label: "سامانه (نقش سرویس)" },
] as const;

/** Engine tables a record trigger may not watch (the flows' own configuration). */
export const FLOW_TABLE_KEYS = ["flow", "flow_version", "flow_connection", "schedule"];

/** Limits shared by the designer, the validator and the executor. */
export const FLOW_LIMITS = {
  nodes: 200,
  /** steps one run may execute before it is stopped as a probable endless loop */
  steps: 1000,
  /** items a «برای هر مورد» may iterate */
  items: 500,
  /** nesting of flows started by flows (record events written by a run, subflows) */
  depth: 5,
  /** graph JSON size */
  graphBytes: 512 * 1024,
} as const;
