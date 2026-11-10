// The organisation's view of the table registry: tenant custom fields (`custom_field` rows named u_* add a field
// stored in the row's `custom` jsonb; rows named like an existing field relabel it, change its help text or make
// an optional field required; the row named "_form" holds the form's arrangement, `def.form.arrangement`, see
// @shared/model/arrangement) and tenant choice lists (`choice` rows extend or edit the default options of a list
// by value; an inactive row hides an option for new values). Every engine path works on these effective
// definitions, so a custom field is filterable, sortable, validated, audited and synced like a built-in one.
//
// Cached per process and organisation; each request re-validates the cache with one small query (the stamp of
// both tables), so a change made on another cloud instance is seen by the next request.
import type { FieldDef, FieldGroup, FieldType, FormArrangement, Option, TableDef } from "@shared/model/types";
import { FIELD_GROUPS, FIELD_TYPES, COLOR_KEYS } from "@shared/model/types";
import { FORM_ROW, cleanArrangement } from "@shared/model/arrangement";
import type { Lookup } from "@shared/model/conditions";
import { CHOICE_LISTS, TABLES, tableDef } from "@shared/tables";
import { CUSTOM_FIELD_TYPES } from "@shared/tables/core";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
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
  const r = await q.one<{ a: string | null; b: string | null }>(
    `select (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from sm_custom_fields where org_id = $1) as a,
            (select count(*)::text || '/' || coalesce(max(updated_at)::text, '') from sm_choices where org_id = $1) as b`,
    [orgId],
  );
  return `${r?.a ?? ""}|${r?.b ?? ""}`;
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
      `select table_key, name, label, type, choices, options, ref, required, list, search, filter, help, section, field_group, max_length, sort_order
       from sm_custom_fields where org_id = $1 and deleted_at is null and active order by table_key, sort_order, name`,
      [orgId],
    ),
    q.query<ChoiceRow>(
      `select list, value, label, color, sort_order, parent, active from sm_choices where org_id = $1 and deleted_at is null order by list, sort_order, value`,
      [orgId],
    ),
  ]);
  const schema = buildSchema(fields, choices, stamp);
  cache.set(orgId, schema);
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return schema;
}

const CUSTOM_NAME = /^u_[a-z0-9_]{1,40}$/;

/** A custom field row as a FieldDef (null when the row is not usable: unknown type, bad name). */
export function customFieldDef(r: Pick<CustomFieldRow, "name" | "label" | "type" | "choices" | "options" | "ref" | "required" | "list" | "search" | "filter" | "help" | "section" | "field_group" | "max_length">): FieldDef | null {
  if (!CUSTOM_NAME.test(r.name)) return null;
  const type = r.type as FieldType;
  if (!type || !(CUSTOM_FIELD_TYPES as string[]).includes(type)) return null;
  const f: FieldDef = { name: r.name, label: r.label || r.name, type, custom: true };
  if (r.required) f.required = true;
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

export function buildSchema(fieldRows: CustomFieldRow[], choiceRows: ChoiceRow[], stamp = ""): OrgSchema {
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
    for (const r of rows) {
      // the form layout designer's row: the arrangement of the form, never a field
      if (r.name === FORM_ROW) {
        arrangement = cleanArrangement(r.options);
        continue;
      }
      const at = fields.findIndex((f) => f.name === r.name);
      if (at >= 0) {
        // an override of an existing field: label, help, list column, "required" for an optional field
        const f = fields[at];
        if (r.label) f.label = r.label;
        if (r.help) f.help = r.help;
        if (r.list) f.list = true;
        if (r.required && !f.system && !f.readonly && !f.base) f.required = true;
        continue;
      }
      const f = customFieldDef(r);
      if (f) fields.push(f);
    }
    const def: TableDef = arrangement ? { ...base, fields, form: { ...base.form, arrangement } } : { ...base, fields };
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
      if (!r.active) o.active = false;
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
