// The organisation's view of the table registry: tenant custom fields (`custom_field` rows named u_* add a field
// stored in the row's `custom` jsonb; rows named like an existing field relabel it, change its help text or make
// an optional field required; the row named "_form" holds the form's arrangement, `def.form.arrangement`, see
// @shared/model/arrangement) and tenant choice lists (`choice` rows extend or edit the default options of a list
// by value; an inactive row hides an option for new values). Every engine path works on these effective
// definitions, so a custom field is filterable, sortable, validated, audited and synced like a built-in one.
// Design F (package F1) adds: a `custom_field` row with `library_id` builds its field from the field library
// (`field_def` and its `field_type`, @shared/forms/fieldtypes), so a change there reaches every table that uses it;
// override rows carry a placeholder, `form_hidden` (→ FieldDef.formHidden: hidden on forms only) and a requirement
// (`required` + `required_for` → FieldDef.formRequired, people's writes only — never FieldDef.required, which binds
// every write); the row named "_states" holds the lifecycle overlay (@shared/model/lifecycle), merged into
// `def.states`; choice options a module marks `locked` stay active whatever a row says.
//
// Cached per process and organisation; each request re-validates the cache with one small query (the stamp of
// both tables), so a change made on another cloud instance is seen by the next request.
import type { FieldDef, FieldGroup, FieldType, FormArrangement, Option, TableDef } from "@shared/model/types";
import { FIELD_GROUPS, FIELD_TYPES, COLOR_KEYS } from "@shared/model/types";
import { FORM_ROW, cleanArrangement } from "@shared/model/arrangement";
import type { Lookup } from "@shared/model/conditions";
import { CHOICE_LISTS, TABLES, tableDef } from "@shared/tables";
import { CUSTOM_FIELD_TYPES } from "@shared/tables/core";
import { LABELS_ONLY_LIFECYCLES, STATES_ROW, cleanLifecycle, mergeLifecycle, pruneLifecycle } from "@shared/model/lifecycle";
import { lockedFields } from "@shared/forms/locked";
import { isRequiredFor, type RequiredFor } from "@shared/forms/paths";
import { libraryFieldDef, resolveFieldType, type FieldTypeRow, type LibraryFieldRow, type SettingsEnv } from "@shared/forms/fieldtypes";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { pgArray } from "../db";
import { notFound } from "../http/errors";
import { access } from "../access/provider";

export interface OrgSchema {
  /** effective definition of a table (custom fields and labels applied) */
  def(key: string): TableDef | undefined;
  /** the same, for dot-walks and condition validation */
  lookup: Lookup;
  /** options of a choice list (defaults merged with the organisation's rows) */
  choices(list: string): Option[];
  /** every list that has options, by key */
  lists(): Record<string, Option[]>;
  /** the stamp the cache entry was built from */
  stamp: string;
}

interface CustomFieldRow {
  table_key: string;
  name: string;
  label: string;
  type: string | null;
  choices: string | null;
  options: unknown;
  ref: string | null;
  required: boolean;
  list: boolean;
  search: boolean;
  filter: boolean;
  help: string | null;
  section: string | null;
  field_group?: string | null;
  max_length: number | null;
  sort_order: number | null;
  /** design F: the library field behind the row, the placeholder, hidden on forms only, whom a requirement binds */
  library_id?: string | null;
  placeholder?: string | null;
  form_hidden?: boolean | null;
  required_for?: string | null;
}

/** The field library rows the overlay reads (only when some row names a library field). */
export interface LibraryRows {
  /** live library fields by id */
  fields: Map<string, LibraryFieldRow>;
  /** the organisation's field types by key */
  types: Map<string, FieldTypeRow>;
}

interface ChoiceRow {
  list: string;
  value: string;
  label: string;
  color: string | null;
  sort_order: number | null;
  parent: string | null;
  active: boolean;
}

const cache = new Map<string, OrgSchema>();
const memo = new WeakMap<Ctx, { gen: number; p: Promise<OrgSchema> }>();
let generation = 0;

/** Forget cached schemas (a custom field or a choice changed in this process). */
export function invalidateSchema(orgId?: string): void {
  generation++;
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

async function stampOf(q: Queryable, orgId: string): Promise<string> {
  const r = await q.one<{ a: string | null; b: string | null; c: string | null; d: string | null }>(
    `select (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from sm_custom_fields where org_id = $1) as a,
            (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from sm_choices where org_id = $1) as b,
            (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from sm_field_defs where org_id = $1) as c,
            (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from sm_field_types where org_id = $1) as d`,
    [orgId],
  );
  return `${r?.a ?? ""}|${r?.b ?? ""}|${r?.c ?? ""}|${r?.d ?? ""}`;
}

/**
 * The effective schema of the caller's organisation (memoised on the request). Every engine entry point awaits it
 * first, so it also lets the access provider load the caller's subject (`prepare`) through the same queryable — inside
 * a transaction that is the transaction itself (PGlite has a single connection).
 */
export function orgSchema(ctx: Ctx, q: Queryable = ctx.db): Promise<OrgSchema> {
  const hit = memo.get(ctx);
  if (hit && hit.gen === generation) return hit.p;
  const provider = access();
  const p = provider.prepare ? Promise.all([loadSchema(q, ctx.org.id), provider.prepare(ctx, q)]).then(([s]) => s) : loadSchema(q, ctx.org.id);
  memo.set(ctx, { gen: generation, p });
  p.catch(() => memo.delete(ctx));
  return p;
}

export async function loadSchema(q: Queryable, orgId: string): Promise<OrgSchema> {
  const stamp = await stampOf(q, orgId);
  const hit = cache.get(orgId);
  if (hit && hit.stamp === stamp) return hit;
  const [fields, choices] = await Promise.all([
    q.query<CustomFieldRow>(
      `select table_key, name, label, type, choices, options, ref, required, list, search, filter, help, section, field_group, max_length, sort_order,
              library_id, placeholder, form_hidden, required_for
       from sm_custom_fields where org_id = $1 and deleted_at is null and active order by table_key, sort_order, name`,
      [orgId],
    ),
    q.query<ChoiceRow>(
      `select list, value, label, color, sort_order, parent, active from sm_choices where org_id = $1 and deleted_at is null order by list, sort_order, value`,
      [orgId],
    ),
  ]);
  const schema = buildSchema(fields, choices, stamp, await libraryRows(q, orgId, fields));
  cache.set(orgId, schema);
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return schema;
}

/** The library fields the organisation's rows name, with its field types (null when no row names one). */
async function libraryRows(q: Queryable, orgId: string, rows: CustomFieldRow[]): Promise<LibraryRows | null> {
  const ids = [...new Set(rows.map((r) => r.library_id).filter((x): x is string => !!x))];
  if (!ids.length) return null;
  const [fields, types] = await Promise.all([
    q.query<LibraryFieldRow & { id: string }>(
      `select id, name, label, type, help, placeholder, default_value, options, choices, depends_on, validation, field_group, list, search, filter, status
       from sm_field_defs where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
      [orgId, pgArray(ids)],
    ),
    q.query<FieldTypeRow>(`select key, name, base, widget, validation, display, options, choices, status from sm_field_types where org_id = $1 and deleted_at is null`, [orgId]),
  ]);
  return { fields: new Map(fields.map((f) => [String(f.id), f])), types: new Map(types.map((t) => [t.key, t])) };
}

/** What the shared cleaners cannot know inside the engine: which tables exist (the registry's physical ones). */
const LIBRARY_ENV: SettingsEnv = {
  tableExists: (key) => {
    const def = tableDef(key);
    return !!def && !def.virtual;
  },
};

/** Tables whose values are not fields of their own: a process case keeps its values in one json field (design F §3.6). */
const NO_LIBRARY_FIELDS = new Set(["process_case"]);

/** Whom an organisation's requirement binds: `required_for` («همه» unless it says «فقط کارشناسان»). */
const requiredFor = (r: Pick<CustomFieldRow, "required_for">): RequiredFor => (isRequiredFor(r.required_for) ? r.required_for : "all");

const CUSTOM_NAME = /^u_[a-z0-9_]{1,40}$/;

/** A custom field row as a FieldDef (null when the row is not usable: unknown type, bad name). */
export function customFieldDef(r: Pick<CustomFieldRow, "name" | "label" | "type" | "choices" | "options" | "ref" | "required" | "list" | "search" | "filter" | "help" | "section" | "field_group" | "max_length"> & Partial<Pick<CustomFieldRow, "placeholder" | "form_hidden" | "required_for">>): FieldDef | null {
  if (!CUSTOM_NAME.test(r.name)) return null;
  const type = r.type as FieldType;
  if (!type || !(CUSTOM_FIELD_TYPES as string[]).includes(type)) return null;
  const f: FieldDef = { name: r.name, label: r.label || r.name, type, custom: true };
  // an organisation's requirement binds people's writes only (design F §3.3)
  if (r.required) f.formRequired = requiredFor(r);
  if (r.placeholder) f.placeholder = r.placeholder;
  if (r.form_hidden) f.formHidden = true;
  if (r.list) f.list = true;
  if (r.search && FIELD_TYPES[type].sql === "text") f.search = true;
  if (r.filter) f.filter = true;
  if (r.help) f.help = r.help;
  if (r.section) f.section = r.section;
  // a custom field in a field group is hidden from members without it, like the module fields of that group
  if (r.field_group && r.field_group in FIELD_GROUPS) f.group = r.field_group as FieldGroup;
  if (r.max_length) f.maxLength = r.max_length;
  if (type === "choice" || type === "multichoice") {
    if (r.choices) f.choices = r.choices;
    else if (Array.isArray(r.options)) f.choices = cleanOptions(r.options);
    else f.choices = [];
  }
  if (type === "ref" || type === "refs") {
    if (!r.ref || !TABLES.has(r.ref)) return null;
    f.ref = r.ref;
  }
  return f;
}

/**
 * A table's field from the library (a `custom_field` row naming a `field_def`): type, validation, options, label, help
 * and placeholder from the library and its type — so a change there reaches every table — and, from the row, its
 * section, hiding on forms and the requirement. Null when the library field is gone or cannot be a field.
 */
function libraryField(table: string, r: CustomFieldRow, library: LibraryRows | null): FieldDef | null {
  if (NO_LIBRARY_FIELDS.has(table) || !CUSTOM_NAME.test(r.name)) return null;
  const lib = library?.fields.get(String(r.library_id));
  let f: FieldDef | null = null;
  if (lib) {
    const type = resolveFieldType(lib.type, library!.types, LIBRARY_ENV);
    f = type ? libraryFieldDef(lib, type, LIBRARY_ENV) : null;
  } else f = snapshotField(r.options);
  if (!f) return null;
  // values live in `custom` under the row's name (the library keeps it while the field is used)
  f.name = r.name;
  f.library ??= r.name;
  if (r.section) f.section = r.section;
  if (r.required) f.formRequired = requiredFor(r);
  if (r.form_hidden) f.formHidden = true;
  return f;
}

/** Keys of a library field's definition that the snapshot on its `custom_field` row may carry. */
const SNAPSHOT_KEYS: (keyof FieldDef)[] = [
  "label", "type", "help", "placeholder", "default", "choices", "dependsOn", "ref", "refFilter", "min", "max", "maxLength", "list", "search", "filter",
  "group", "ltr", "widget", "pattern", "patternMessage", "check", "decimals", "unit", "minDate", "maxDate", "accept",
];

/**
 * A library field from the definition its `custom_field` row carries (`options.field`, kept by the field library's
 * hook): a Windows app that does not receive the library's rows still builds the field. Null when it is not usable.
 */
export function snapshotField(raw: unknown): FieldDef | null {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { field?: unknown }).field : null;
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const x = s as Record<string, unknown>;
  const type = x.type as FieldType;
  if (typeof type !== "string" || !(type in FIELD_TYPES) || type === "secret" || type === "conditions") return null;
  const f = { name: "", label: "", type } as FieldDef;
  for (const k of SNAPSHOT_KEYS) if (x[k] !== undefined && x[k] !== null) (f as unknown as Record<string, unknown>)[k] = x[k];
  if (typeof f.label !== "string" || !f.label) return null;
  if ((type === "ref" || type === "refs") && (typeof f.ref !== "string" || !TABLES.has(f.ref))) return null;
  if (f.group && !(f.group in FIELD_GROUPS)) delete f.group;
  if (Array.isArray(f.choices)) f.choices = cleanOptions(f.choices);
  f.custom = true;
  return f;
}

function cleanOptions(raw: unknown[]): Option[] {
  const out: Option[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const x = o as Record<string, unknown>;
    const value = String(x.value ?? "").trim();
    if (!value) continue;
    const opt: Option = { value, label: String(x.label ?? value) };
    if (typeof x.color === "string" && (COLOR_KEYS as readonly string[]).includes(x.color)) opt.color = x.color as Option["color"];
    if (typeof x.order === "number") opt.order = x.order;
    out.push(opt);
  }
  return out;
}

export function buildSchema(fieldRows: CustomFieldRow[], choiceRows: ChoiceRow[], stamp = "", library: LibraryRows | null = null): OrgSchema {
  const byTable = new Map<string, CustomFieldRow[]>();
  for (const r of fieldRows) byTable.set(r.table_key, [...(byTable.get(r.table_key) ?? []), r]);
  const defs = new Map<string, TableDef>();
  const effective = (key: string): TableDef | undefined => {
    const base = tableDef(key);
    if (!base) return undefined;
    const rows = byTable.get(key);
    if (!rows?.length || base.virtual) return base;
    const hit = defs.get(key);
    if (hit) return hit;
    const fields = base.fields.map((f) => ({ ...f }));
    let arrangement: FormArrangement | null = null;
    let lifecycle: ReturnType<typeof cleanLifecycle> = null;
    let locks: ReturnType<typeof lockedFields> | null = null;
    for (const r of rows) {
      // the form layout designer's row: the arrangement of the form, never a field
      if (r.name === FORM_ROW) {
        arrangement = cleanArrangement(r.options);
        continue;
      }
      // the lifecycle editor's row: the organisation's safe changes to the state model, never a field
      if (r.name === STATES_ROW) {
        lifecycle = cleanLifecycle(r.options);
        continue;
      }
      const at = fields.findIndex((f) => f.name === r.name);
      if (at >= 0) {
        // an override of an existing field: label, help, placeholder, list column, hidden on forms only, and a
        // requirement on people's writes for an optional field (a module's requirement stays FieldDef.required)
        const f = fields[at];
        if (r.label) f.label = r.label;
        if (r.help) f.help = r.help;
        if (r.placeholder) f.placeholder = r.placeholder;
        if (r.list) f.list = true;
        if (r.required && !f.required && !f.system && !f.readonly && !f.base) f.formRequired = requiredFor(r);
        // a locked field is never hidden (the server refuses the row; an older row is ignored)
        if (r.form_hidden && !f.custom && !(locks ??= lockedFields(base))[f.name]) f.formHidden = true;
        continue;
      }
      const f = r.library_id ? libraryField(key, r, library) : customFieldDef(r);
      if (f) fields.push(f);
    }
    // a library field depends on another one only where both are attached
    for (const f of fields) if (f.library && f.dependsOn && !fields.some((x) => x.name === f.dependsOn)) delete f.dependsOn;
    let def: TableDef = arrangement ? { ...base, fields, form: { ...base.form, arrangement } } : { ...base, fields };
    // the organisation's fields and conditions of transitions name only what is on the table now (a field taken off it
    // is not asked, a condition naming one is dropped): nobody is held to a field that cannot be filled
    if (lifecycle && base.states) def = { ...def, states: pruneLifecycle(mergeLifecycle(base.states, lifecycle, { labelsOnly: LABELS_ONLY_LIFECYCLES.has(key) }), def) };
    defs.set(key, def);
    return def;
  };
  const merged = new Map<string, Option[]>();
  const rowsByList = new Map<string, ChoiceRow[]>();
  for (const r of choiceRows) rowsByList.set(r.list, [...(rowsByList.get(r.list) ?? []), r]);
  const choices = (list: string): Option[] => {
    const hit = merged.get(list);
    if (hit) return hit;
    const map = new Map<string, Option>();
    for (const o of CHOICE_LISTS.get(list) ?? []) map.set(o.value, { ...o });
    for (const r of rowsByList.get(list) ?? []) {
      const o: Option = { value: r.value, label: r.label || r.value };
      if (r.color && (COLOR_KEYS as readonly string[]).includes(r.color)) o.color = r.color as Option["color"];
      if (r.sort_order !== null && r.sort_order !== undefined) o.order = r.sort_order;
      else if (map.get(r.value)?.order !== undefined) o.order = map.get(r.value)!.order;
      if (r.parent) o.parent = r.parent;
      // an option module code tests (`locked`) stays active: relabelled, recoloured or reordered, never switched off
      const dflt = map.get(r.value);
      if (dflt?.locked) o.locked = true;
      if (!r.active && !dflt?.locked) o.active = false;
      map.set(r.value, o);
    }
    const out = [...map.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
    merged.set(list, out);
    return out;
  };
  return {
    def: effective,
    lookup: effective,
    choices,
    lists: () => {
      const keys = new Set([...CHOICE_LISTS.keys(), ...rowsByList.keys()]);
      return Object.fromEntries([...keys].sort().map((k) => [k, choices(k)]));
    },
    stamp,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Whom an organisation's requirement binds (FieldDef.formRequired, design F §3.3): people's writes only — «همه»
// binds every person, «فقط کارشناسان» the writers whose roles have the agent or admin persona. The system and
// trusted server code are never bound. The access model's persona lookup is plugged in by the field library module
// (`setRequirementAudience`); without it every person counts as an agent.

export type RequirementAudience = (ctx: Ctx, q: Queryable) => Promise<"agent" | "requester">;
let audience: RequirementAudience = async () => "agent";

export function setRequirementAudience(fn: RequirementAudience): void {
  audience = fn;
}

/** The kinds of organisation requirement that bind the caller's writes (none for the system). */
export async function requirementScope(ctx: Ctx, q: Queryable = ctx.db): Promise<RequiredFor[]> {
  if (ctx.actor === "system") return [];
  return (await audience(ctx, q)) === "agent" ? ["all", "agents"] : ["all"];
}

/** Does the organisation's requirement on `f` bind a writer of this scope? */
export const bindsRequirement = (f: Pick<FieldDef, "formRequired">, scope: readonly RequiredFor[]): boolean => !!f.formRequired && scope.includes(f.formRequired);

/** The effective definition of `key` for the caller's organisation, or 404. */
export async function defFor(ctx: Ctx, key: string, q?: Queryable): Promise<{ def: TableDef; schema: OrgSchema }> {
  const schema = await orgSchema(ctx, q);
  const def = schema.def(key);
  if (!def) throw notFound(`جدول «${key}» وجود ندارد`);
  return { def, schema };
}

/** Options of a choice field (static options, or the tenant's list). */
export function optionsOf(f: FieldDef, schema: Pick<OrgSchema, "choices">): Option[] {
  if (Array.isArray(f.choices)) return f.choices;
  if (typeof f.choices === "string") return schema.choices(f.choices);
  return [];
}
