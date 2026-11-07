// The metadata model of the record engine: every table an ITSM user works with (incidents, problems, changes,
// requests, CIs, assets, KB articles — and configuration such as SLA definitions or saved views) is described once
// as a TableDef. The server generates its DDL, validates, stores, audits, secures, syncs and exposes it through one
// generic API (src/server/engine, docs/spec/ENGINE.md); the UI renders lists, forms, kanban and calendars from the
// same definition. This file is imported by the UI: keep it free of server imports.
import type { Area, Level } from "../permissions";
import type { Cond } from "./conditions";

/** Storage and validation kind of a field (the SQL type each maps to is in FIELD_TYPES). */
export type FieldType =
  | "string" | "text" | "markdown"
  | "int" | "decimal" | "money" | "percent" | "bool"
  | "date" | "datetime" | "duration"
  | "choice" | "multichoice"
  | "ref" | "refs" | "user" | "users" | "group"
  | "email" | "url" | "phone" | "ip"
  | "json" | "conditions" | "tags" | "color" | "rating" | "secret";

/** How the engine treats a field type: SQL column type, value family and whether the value is an array. */
export interface FieldTypeInfo {
  label: string;
  sql: "text" | "integer" | "bigint" | "numeric" | "boolean" | "date" | "timestamptz" | "uuid" | "jsonb";
  family: "text" | "number" | "bool" | "date" | "datetime" | "choice" | "ref" | "json";
  /** stored as a jsonb array of strings */
  array?: boolean;
  /** compared as numbers (decimal strings or integers) */
  numeric?: boolean;
}

export const FIELD_TYPES: Record<FieldType, FieldTypeInfo> = {
  string: { label: "متن کوتاه", sql: "text", family: "text" },
  text: { label: "متن چندخطی", sql: "text", family: "text" },
  markdown: { label: "متن قالب‌دار", sql: "text", family: "text" },
  int: { label: "عدد صحیح", sql: "integer", family: "number", numeric: true },
  decimal: { label: "عدد اعشاری", sql: "numeric", family: "number", numeric: true },
  money: { label: "مبلغ", sql: "numeric", family: "number", numeric: true },
  percent: { label: "درصد", sql: "numeric", family: "number", numeric: true },
  bool: { label: "بله/خیر", sql: "boolean", family: "bool" },
  date: { label: "تاریخ", sql: "date", family: "date" },
  datetime: { label: "تاریخ و ساعت", sql: "timestamptz", family: "datetime" },
  duration: { label: "مدت (ثانیه)", sql: "bigint", family: "number", numeric: true },
  choice: { label: "گزینه", sql: "text", family: "choice" },
  multichoice: { label: "چند گزینه", sql: "jsonb", family: "choice", array: true },
  ref: { label: "ارجاع", sql: "uuid", family: "ref" },
  refs: { label: "چند ارجاع", sql: "jsonb", family: "ref", array: true },
  user: { label: "کاربر", sql: "uuid", family: "ref" },
  users: { label: "چند کاربر", sql: "jsonb", family: "ref", array: true },
  group: { label: "گروه", sql: "uuid", family: "ref" },
  email: { label: "ایمیل", sql: "text", family: "text" },
  url: { label: "نشانی وب", sql: "text", family: "text" },
  phone: { label: "تلفن", sql: "text", family: "text" },
  ip: { label: "نشانی IP", sql: "text", family: "text" },
  json: { label: "JSON", sql: "jsonb", family: "json" },
  conditions: { label: "شرط", sql: "jsonb", family: "json" },
  tags: { label: "برچسب‌ها", sql: "jsonb", family: "choice", array: true },
  color: { label: "رنگ", sql: "text", family: "choice" },
  rating: { label: "امتیاز", sql: "integer", family: "number", numeric: true },
  secret: { label: "رمز", sql: "text", family: "text" },
};

/** Named colours (mapped to design-system tokens by the UI; never raw hex in data). */
export const COLOR_KEYS = ["gray", "red", "orange", "gold", "green", "teal", "blue", "indigo", "purple", "magenta"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** Field-level security groups: a field in a group is only visible to callers whose roles carry the group. */
export type FieldGroup = "internal" | "financial" | "personal" | "security" | "hr" | "admin";
export const FIELD_GROUPS: Record<FieldGroup, string> = {
  internal: "داخلی (کارشناسان)",
  financial: "مالی",
  personal: "اطلاعات شخصی",
  security: "امنیت",
  hr: "منابع انسانی",
  admin: "مدیریت",
};

/**
 * Module that owns a table. "core" is the engine itself; every ITSM module adds its key here when it adds its
 * tables (`src/shared/tables/<module>.ts`).
 */
export const MODULE_KEYS = ["core"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number] | (string & {});

/**
 * The access area a table belongs to. Today these are the platform's provisional areas (`@shared/permissions`);
 * the ITSM access model (src/server/access) maps them to its own grants.
 */
export type AreaKey = Area;

/** One option of a choice field (static in code, or a row of a tenant-editable choice list). */
export interface Option {
  value: string;
  label: string;
  color?: ColorKey;
  order?: number;
  /** inactive options stay valid on records that already carry them, but are not offered for new values */
  active?: boolean;
  /** dependent lists: the value of the parent field this option belongs to (e.g. a subcategory's category) */
  parent?: string;
}

/** Engine-computed default values. */
export type DefaultToken = "$now" | "$today" | "$me" | "$my_unit" | "$my_domain";

export interface FieldDef {
  /** column name: [a-z][a-z0-9_]*; names starting with `u_` are reserved for tenant custom fields */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** shown but not changed through the API (the engine and server hooks may still set it) */
  readonly?: boolean;
  /** stored but not shown in forms */
  hidden?: boolean;
  /** maintained by the engine (number, timestamps, resolved_at…); never accepted from a caller */
  system?: boolean;
  default?: unknown;
  /** choice list key (tenant-editable list, `sm_choices`) or static options */
  choices?: string | Option[];
  /** dependent choice list: options are filtered by the value of this field (`Option.parent`) */
  dependsOn?: string;
  /** target table key for ref/refs ("$self" = the table itself); user/users/group need none */
  ref?: string;
  /** condition the referenced record must satisfy (enforced on write, used by pickers) */
  refFilter?: Cond;
  /** conditions fields: the table the condition applies to (static) … */
  condTable?: string;
  /** … or the field of this row that holds the table key */
  condTableField?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  /** offered as a list column / matched by the search box / offered as a filter / sortable / indexed */
  list?: boolean;
  search?: boolean;
  filter?: boolean;
  sort?: boolean;
  index?: boolean;
  /** unique per organisation among live rows */
  unique?: boolean;
  /** field-level security group */
  group?: FieldGroup;
  /** written to the field history on change (default true; secrets are recorded without values) */
  audit?: boolean;
  span?: 6 | 8 | 12 | 16 | 18 | 24;
  section?: string;
  tab?: string;
  help?: string;
  placeholder?: string;
  ltr?: boolean;
  /** part of the RAG document / redacted before leaving the tenant */
  ai?: { index?: boolean; redact?: boolean };
  /** set by the engine: a tenant custom field (stored in the `custom` jsonb column) */
  custom?: boolean;
  /** set by the engine: a base column every table has (number, created_at…) */
  base?: boolean;
}

/** State categories: the engine's side effects and SLA/reporting semantics hang on them, not on state values. */
export type StateCategory = "new" | "active" | "waiting" | "resolved" | "closed" | "canceled";

export interface StateDef {
  value: string;
  label: string;
  category: StateCategory;
  color?: ColorKey;
}

/** Who may take a transition (default provider: an area level; the ITSM access model may refine it). */
export interface AreaOp {
  area: AreaKey;
  level: Level;
}

export interface Transition {
  from: string[] | "*";
  to: string;
  label: string;
  /** fields that must have a value once the transition is applied (the call may set them) */
  requires?: string[];
  roles?: AreaOp;
  /** name of a guard registered with `registerHooks(table, { guards })` */
  guard?: string;
}

export interface StateModel {
  field: "state";
  states: StateDef[];
  transitions: Transition[];
  initial: string;
  /** categories in which a record can no longer be edited (only transitions out of them); default closed, canceled */
  locked?: StateCategory[];
}

/** Which columns make a row "mine", "my group's", "my unit's"… for the access model (spec §3.3). */
export interface ScopeFields {
  /** user fields that make a row the caller's own (caller_id, requested_for, opened_by, assigned_to, owner_id…) */
  own?: string[];
  /** users field of watchers */
  watchers?: string;
  /** group field of the assignment group */
  group?: string;
  /** organisation unit column (default "unit_id") */
  unit?: string;
  /** domain column (default "domain_id") */
  domain?: string;
  /** workspace column (default "workspace_id") */
  workspace?: string;
}

/** Records of another table that point at this one, listed on the form (e.g. a problem's incidents). */
export interface RelatedList {
  table: string;
  field: string;
  label?: string;
  columns?: string[];
}

export interface FormLayout {
  sections?: string[];
  tabs?: string[];
  related?: RelatedList[];
}

export interface ListLayout {
  columns: string[];
  /** default sort: field names, "-" prefix for descending, comma separated */
  order: string;
}

export interface TableFeatures {
  journal?: boolean;
  attachments?: boolean;
  watchers?: boolean;
  history?: boolean;
  sla?: boolean;
  approvals?: boolean;
  links?: boolean;
  rag?: boolean;
  /** synchronised with the Windows app (default true) */
  sync?: boolean;
  tags?: boolean;
  survey?: boolean;
  confidential?: boolean;
  /** group-by field of the kanban board */
  kanban?: string;
  calendar?: { start: string; end?: string };
}

export interface TableDef {
  /** "incident" — the key used everywhere (API paths, refs, events) */
  key: string;
  /** "sm_incidents" — the physical table */
  table: string;
  label: string;
  plural: string;
  icon: string;
  module: ModuleKey;
  area: AreaKey;
  description?: string;
  /** adds TASK_FIELDS and the task behaviours (states, assignment, SLA, approvals) */
  extends?: "task";
  /** INC0001234: a counter per organisation and table, zero padded */
  numbered?: { prefix: string; pad: number };
  /** display field (what a reference to a row shows) */
  display: string;
  fields: FieldDef[];
  states?: StateModel;
  scope: ScopeFields;
  features?: TableFeatures;
  form?: FormLayout;
  list?: ListLayout;
  /** fields that make up the RAG document */
  ai?: { title: string; text: string[] };
  /** combinations of fields unique per organisation among live rows */
  unique?: string[][];
  /**
   * Row rules every caller is held to on top of the access provider — e.g. personal saved views:
   * `{ read: { or: [{ f: "owner_id", op: "is_me" }, { f: "shared", op: "eq", v: true }] }, write: { f: "owner_id", op: "is_me" } }`.
   */
  rowAccess?: { read?: Cond; write?: Cond };
  /** levels of `area` the default provider asks for (default: read view, create/write edit, delete full) */
  levels?: { read?: Level; create?: Level; write?: Level; delete?: Level };
  /** a reference target without a physical engine table (the members of the organisation) */
  virtual?: boolean;
}

/** Names of the base columns every engine table has (never field names of a TableDef). */
export const BASE_COLUMNS = [
  "id", "org_id", "no", "number", "workspace_id", "domain_id", "unit_id",
  "created_at", "created_by", "updated_at", "updated_by", "rev", "version", "deleted_at", "origin", "custom",
] as const;

/** Labels of the state categories. */
export const STATE_CATEGORIES: Record<StateCategory, { label: string; color: ColorKey; open: boolean }> = {
  new: { label: "جدید", color: "blue", open: true },
  active: { label: "در جریان", color: "teal", open: true },
  waiting: { label: "در انتظار", color: "gold", open: true },
  resolved: { label: "حل‌شده", color: "green", open: false },
  closed: { label: "بسته", color: "gray", open: false },
  canceled: { label: "لغوشده", color: "gray", open: false },
};

/** Categories in which a record counts as active (open work). */
export const OPEN_CATEGORIES: StateCategory[] = ["new", "active", "waiting"];

/** A field that holds one or more references, and the table key it points at ("user" for members). */
export function refTarget(f: Pick<FieldDef, "type" | "ref">, selfKey?: string): string | null {
  if (f.type === "user" || f.type === "users") return "user";
  if (f.type === "group") return f.ref ?? "group";
  if (f.type === "ref" || f.type === "refs") return f.ref === "$self" ? selfKey ?? null : f.ref ?? null;
  return null;
}

export const isArrayType = (t: FieldType) => !!FIELD_TYPES[t].array;
export const isRefType = (t: FieldType) => FIELD_TYPES[t].family === "ref";
export const isNumericType = (t: FieldType) => !!FIELD_TYPES[t].numeric;
