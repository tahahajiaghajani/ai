// The table registry: every TableDef of the app, resolved once at load time (task fields merged, base fields added,
// placeholders replaced, the definition checked). Modules add their tables in their own file
// (src/shared/tables/<module>.ts) and list it in MODULE_TABLES below; tests and plugins may also call
// `registerTable`. The server derives the DDL, the sync registry and the API from here; the UI gets the same
// definitions (with the organisation's customisations) from GET /api/o/:org/meta/tables.
// Imported by the UI: keep it free of server imports.
import type { FieldDef, Option, TableDef } from "../model/types";
import { BASE_COLUMNS, FIELD_TYPES, refTarget } from "../model/types";
import { setTableLookup, validateCond } from "../model/conditions";
import { CLOSE_CODES, DEFAULT_TASK_STATES, TASK_FIELDS, TASK_SCOPE } from "../model/task";
import { CORE_CHOICE_LISTS, CORE_TABLES, USER_TABLE } from "./core";
import { ACCESS_TABLES } from "./access";
import { NOTIFY_TABLES } from "./notify";
import { SLA_CHOICE_LISTS, SLA_SERVICE_TABLES } from "./sla";
import { FLOW_TABLES } from "./flows";
import { INCIDENT_CHOICE_LISTS, INCIDENT_TABLES } from "./incident";
import { PROBLEM_CHOICE_LISTS, PROBLEM_TABLES } from "./problem";
import { DOCS_TABLES } from "./docs";
import { CMDB_CHOICE_LISTS, CMDB_TABLES } from "./cmdb";
import { SERVICE_PORTFOLIO_TABLES } from "./service_portfolio";
import { CHANGE_CHOICE_LISTS, CHANGE_TABLES } from "./change";
import { REQUEST_CHOICE_LISTS, REQUEST_TABLES } from "./request";
import { KNOWLEDGE_CHOICE_LISTS, KNOWLEDGE_TABLES } from "./knowledge";
import { AI_TABLES } from "./ai";
import { RELEASE_CHOICE_LISTS, RELEASE_TABLES } from "./release";
import { DEVOPS_TABLES } from "./devops";
import { PROJECT_CHOICE_LISTS, PROJECT_TABLES } from "./project";
import { ANALYTICS_TABLES } from "./analytics";
import { AI_AGENT_TABLES } from "./ai-agents";
import { EVENT_TABLES } from "./event";
import { CONTINUITY_TABLES } from "./continuity";
import { ITAM_CHOICE_LISTS, ITAM_TABLES } from "./itam";
import { SUPPLIER_CHOICE_LISTS, SUPPLIER_TABLES } from "./supplier";
import { FINANCIAL_CHOICE_LISTS, FINANCIAL_TABLES } from "./financial";
import { SECURITY_CHOICE_LISTS, SECURITY_TABLES } from "./security";
import { PORTAL_TABLES } from "./portal";
import { AI_GOVERNANCE_TABLES } from "./ai-governance";

export { CUSTOM_FIELD_TYPES, VIEW_KINDS } from "./core";

/** Table definitions per module; a module adds its file's export here. */
const MODULE_TABLES: TableDef[][] = [
  CORE_TABLES,
  ACCESS_TABLES,
  NOTIFY_TABLES,
  SLA_SERVICE_TABLES,
  FLOW_TABLES,
  DOCS_TABLES,
  INCIDENT_TABLES,
  PROBLEM_TABLES,
  CMDB_TABLES,
  SERVICE_PORTFOLIO_TABLES,
  CHANGE_TABLES,
  REQUEST_TABLES,
  KNOWLEDGE_TABLES,
  AI_TABLES,
  RELEASE_TABLES,
  DEVOPS_TABLES,
  PROJECT_TABLES,
  ANALYTICS_TABLES,
  AI_AGENT_TABLES,
  EVENT_TABLES,
  CONTINUITY_TABLES,
  ITAM_TABLES,
  SUPPLIER_TABLES,
  FINANCIAL_TABLES,
  SECURITY_TABLES,
  PORTAL_TABLES,
  AI_GOVERNANCE_TABLES,
];

/** Every table by key (resolved definitions). */
export const TABLES = new Map<string, TableDef>();

/** Default options of choice lists (used until an organisation edits the list in `sm_choices`). */
export const CHOICE_LISTS = new Map<string, Option[]>();

export function registerChoiceList(key: string, options: Option[]): void {
  CHOICE_LISTS.set(key, options);
}

const listeners: ((def: TableDef) => void)[] = [];

/** Called for every table registered from now on and for every table already registered. */
export function onTableRegistered(fn: (def: TableDef) => void): void {
  listeners.push(fn);
  for (const def of TABLES.values()) fn(def);
}

export function tableDef(key: string): TableDef | undefined {
  return TABLES.get(key);
}

export function fieldOf(def: TableDef, name: string): FieldDef | undefined {
  return def.fields.find((f) => f.name === name);
}

/** Tables with a physical table (not the virtual `user`), sorted by key. */
export function physicalTables(): TableDef[] {
  return [...TABLES.values()].filter((d) => !d.virtual).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
/** PostgreSQL reserved words a column name may not be (generated SQL does not quote identifiers). */
const RESERVED = new Set(
  ("all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column concurrently " +
    "constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp current_user default " +
    "deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ilike in initially inner intersect " +
    "into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset on only or order outer " +
    "overlaps placing primary references returning right select session_user similar some symmetric system_user table tablesample then to " +
    "trailing true union unique user using variadic verbose when where window with").split(" "),
);

/** The base fields every table has, as (system) field definitions — lists, filters and sorts can name them. */
function baseFields(def: TableDef): FieldDef[] {
  const out: FieldDef[] = [];
  if (def.numbered) out.push({ name: "number", label: "شماره", type: "string", system: true, base: true, list: true, search: true, sort: true, ltr: true, audit: false });
  out.push(
    { name: "created_at", label: "زمان ایجاد", type: "datetime", system: true, base: true, sort: true, filter: true, audit: false },
    { name: "created_by", label: "ایجادکننده", type: "user", system: true, base: true, filter: true, audit: false },
    { name: "updated_at", label: "آخرین تغییر", type: "datetime", system: true, base: true, sort: true, filter: true, audit: false },
    { name: "updated_by", label: "آخرین تغییردهنده", type: "user", system: true, base: true, filter: true, audit: false },
    { name: "workspace_id", label: "فضای کاری", type: "ref", ref: "workspace", base: true, hidden: true, filter: true },
    { name: "domain_id", label: "دامنه", type: "ref", ref: "org_unit", system: true, base: true, hidden: true },
    { name: "unit_id", label: "واحد سازمانی", type: "ref", ref: "org_unit", system: true, base: true, hidden: true, filter: true },
  );
  return out;
}

function fail(def: { key?: string }, msg: string): never {
  throw new Error(`table "${def.key}": ${msg}`);
}

/** Resolve and check a table definition (developer errors throw at load time). */
export function buildTable(input: TableDef): TableDef {
  if (!IDENT.test(input.key)) fail(input, "key must be [a-z][a-z0-9_]*");
  if (!input.virtual && !/^sm_[a-z0-9_]+$/.test(input.table)) fail(input, "table must be sm_*");
  const task = input.extends === "task";
  let fields: FieldDef[] = task ? TASK_FIELDS.map((f) => ({ ...f })) : [];
  for (const f of input.fields) {
    const at = fields.findIndex((x) => x.name === f.name);
    if (at >= 0) fields[at] = { ...fields[at], ...f };
    else fields.push({ ...f });
  }
  fields = fields.map((f) => ({
    ...f,
    ref: f.ref === "$self" ? input.key : f.ref,
    choices: typeof f.choices === "string" ? f.choices.replace(/^\$table\./, `${input.key}.`) : f.choices,
  }));
  const features = { history: true, sync: true, ...(task ? { journal: true, attachments: true, watchers: true, links: true } : {}), ...input.features };
  if (features.watchers && !fields.some((f) => f.name === "watch_list")) fields.push({ name: "watch_list", label: "پیگیری‌کنندگان", type: "users", span: 24 });
  // confidential rows (docs/spec/ACCESS.md): only the assignment group, the people on the record, those on its access
  // list and holders of the table's confidential field group read a row flagged confidential
  if (features.confidential) {
    if (!fields.some((f) => f.name === "confidential")) fields.push({ name: "confidential", label: "محرمانه", type: "bool", default: false, filter: true, span: 6 });
    if (!fields.some((f) => f.name === "access_list")) fields.push({ name: "access_list", label: "فهرست دسترسی", type: "users", span: 18 });
  }
  const states = input.states ?? (task ? DEFAULT_TASK_STATES : undefined);
  if (states) {
    const options: Option[] = states.states.map((s, i) => ({ value: s.value, label: s.label, color: s.color, order: i + 1 }));
    const at = fields.findIndex((f) => f.name === states.field);
    const stateField: FieldDef = { ...(at >= 0 ? fields[at] : { name: states.field, label: "وضعیت", list: true, filter: true, sort: true, index: true }), type: "choice", choices: options, default: states.initial };
    if (at >= 0) fields[at] = stateField;
    else fields.push(stateField);
  }
  if (!input.virtual) {
    for (const f of fields) {
      if (!IDENT.test(f.name)) fail(input, `field name "${f.name}"`);
      if ((BASE_COLUMNS as readonly string[]).includes(f.name)) fail(input, `"${f.name}" is a base column`);
      if (f.name.startsWith("u_")) fail(input, `"${f.name}": u_ is reserved for custom fields`);
      if (RESERVED.has(f.name)) fail(input, `"${f.name}" is a reserved SQL word`);
    }
    fields.push(...baseFields(input));
  }
  const names = new Set<string>();
  for (const f of fields) {
    if (names.has(f.name)) fail(input, `duplicate field "${f.name}"`);
    names.add(f.name);
    if (!(f.type in FIELD_TYPES)) fail(input, `field "${f.name}" has unknown type "${f.type}"`);
    if ((f.type === "ref" || f.type === "refs") && !f.ref) fail(input, `ref field "${f.name}" needs ref`);
    if (f.dependsOn && !fields.some((x) => x.name === f.dependsOn)) fail(input, `field "${f.name}" depends on unknown "${f.dependsOn}"`);
  }
  const has = (n: string) => names.has(n);
  if (!has(input.display)) fail(input, `display field "${input.display}" does not exist`);
  for (const c of input.list?.columns ?? []) if (!has(c)) fail(input, `list column "${c}" does not exist`);
  for (const c of (input.list?.order ?? "").split(",").map((s) => s.trim().replace(/^-/, "")).filter(Boolean)) if (!has(c)) fail(input, `list order "${c}" does not exist`);
  for (const u of input.unique ?? []) for (const c of u) if (!has(c)) fail(input, `unique field "${c}" does not exist`);
  if (features.kanban && !has(features.kanban)) fail(input, `kanban field "${features.kanban}" does not exist`);
  if (features.calendar && (!has(features.calendar.start) || (features.calendar.end && !has(features.calendar.end)))) fail(input, "calendar fields do not exist");
  if (states) {
    const values = new Set(states.states.map((s) => s.value));
    if (!values.has(states.initial)) fail(input, `initial state "${states.initial}" is not a state`);
    for (const t of states.transitions) {
      if (!values.has(t.to) || (t.from !== "*" && t.from.some((x) => !values.has(x)))) fail(input, `transition to "${t.to}" names an unknown state`);
      for (const r of t.requires ?? []) if (!has(r)) fail(input, `transition to "${t.to}" requires unknown field "${r}"`);
    }
  }
  const scope = input.scope && Object.keys(input.scope).length ? input.scope : task ? TASK_SCOPE : input.scope ?? {};
  for (const c of [...(scope.own ?? []), ...(scope.requester ?? []), ...(scope.requesterWritable ?? []), scope.watchers, scope.group].filter(Boolean) as string[]) {
    if (!has(c)) fail(input, `scope field "${c}" does not exist`);
  }
  const def: TableDef = { ...input, fields, features, states, scope };
  if (task) {
    const close = fields.find((f) => f.name === "close_code");
    if (typeof close?.choices === "string" && !CHOICE_LISTS.has(close.choices)) CHOICE_LISTS.set(close.choices, CLOSE_CODES);
  }
  return def;
}

/** Check the conditions a definition carries (once every table is known: they may walk into other tables). */
function checkConditions(def: TableDef): void {
  for (const [what, cond] of [["rowAccess.read", def.rowAccess?.read], ["rowAccess.write", def.rowAccess?.write]] as const) {
    if (!cond) continue;
    const problem = validateCond(cond, def);
    if (problem) fail(def, `${what}: ${problem}`);
  }
  for (const f of def.fields) {
    if (!f.refFilter) continue;
    const target = refTarget(f, def.key);
    const t = target ? TABLES.get(target) : undefined;
    if (t) {
      const problem = validateCond(f.refFilter, t);
      if (problem) fail(def, `refFilter of "${f.name}": ${problem}`);
    }
  }
}

/** Add (or replace) a table. Returns the resolved definition. */
export function registerTable(input: TableDef): TableDef {
  const def = buildTable(input);
  TABLES.set(def.key, def);
  checkConditions(def);
  for (const fn of listeners) fn(def);
  return def;
}

setTableLookup((key) => TABLES.get(key));
for (const [key, options] of Object.entries(CORE_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(SLA_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(INCIDENT_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(PROBLEM_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(CMDB_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(CHANGE_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(REQUEST_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(KNOWLEDGE_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(RELEASE_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(PROJECT_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(ITAM_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(SUPPLIER_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(FINANCIAL_CHOICE_LISTS)) registerChoiceList(key, options);
for (const [key, options] of Object.entries(SECURITY_CHOICE_LISTS)) registerChoiceList(key, options);

/** The members of the organisation as a reference target (virtual: no table of its own). */
export const USER_DEF = buildTable(USER_TABLE);
TABLES.set(USER_DEF.key, USER_DEF);
for (const group of MODULE_TABLES) for (const t of group) TABLES.set(t.key, buildTable(t));
for (const def of TABLES.values()) checkConditions(def);
