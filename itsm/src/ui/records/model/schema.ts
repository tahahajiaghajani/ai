// The organisation's tables on the client: lookups, options of choice fields (static or tenant lists, dependent
// lists, inactive options), labels and what a field can do in a list or a form. Pure: no React, no antd.
import type { Lookup } from "@shared/model/conditions";
import type { FieldDef, Option, StateCategory, StateDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, STATE_CATEGORIES, refTarget } from "@shared/model/types";
import type { DisplayMap, RecordRow, TableMeta, TablesPayload } from "./types";

/** The organisation's effective table definitions (GET /meta/tables) with the helpers every component needs. */
export interface Schema {
  tables: Map<string, TableMeta>;
  choices: Record<string, Option[]>;
  def(key: string): TableMeta | undefined;
  /** for `resolvePath`, `describe`, `evaluate` (dot-walks into other tables) */
  lookup: Lookup;
}

export function makeSchema(p: TablesPayload): Schema {
  const tables = new Map(p.tables.map((t) => [t.key, t]));
  const def = (key: string) => tables.get(key);
  return { tables, choices: p.choices ?? {}, def, lookup: def };
}

export const fieldOf = (def: TableDef, name: string): FieldDef | undefined => def.fields.find((f) => f.name === name);

/** Long values the list API leaves out unless asked for, and that cannot be sorted. */
export const isLong = (f: Pick<FieldDef, "type">): boolean => f.type === "text" || f.type === "markdown" || f.type === "json" || f.type === "conditions";

/** The engine sorts every field but long texts, JSON and arrays (docs/spec/ENGINE.md §5). */
export const isSortable = (f: Pick<FieldDef, "type">): boolean => !isLong(f) && !FIELD_TYPES[f.type].array && f.type !== "secret";

/** May be shown as a list column (not hidden, not a secret, not a raw JSON/conditions value). */
export const isListable = (f: FieldDef): boolean => !f.hidden && f.type !== "secret" && f.type !== "json" && f.type !== "conditions";

/** Can be grouped by (lists, boards, aggregates): choices, refs, members, groups, booleans and short texts. */
export function isGroupable(f: FieldDef): boolean {
  if (f.hidden || f.type === "secret") return false;
  const fam = FIELD_TYPES[f.type].family;
  return fam === "choice" || fam === "ref" || fam === "bool" || f.type === "string" || f.type === "int" || f.type === "rating";
}

/** Simple values a list cell may edit in place (one control, no dialog). */
export function isInlineEditable(f: FieldDef): boolean {
  if (f.system || f.readonly || f.base || f.hidden) return false;
  return ["string", "int", "decimal", "money", "percent", "bool", "date", "datetime", "choice", "user", "group", "ref", "email", "url", "phone", "ip", "rating", "duration", "color"].includes(f.type);
}

/** The field a reference points into ("user" for members), resolving "$self". */
export const targetOf = (f: FieldDef, def: Pick<TableDef, "key">): string | null => refTarget(f, def.key);

/** Options of a choice-family field: its static options or the organisation's list, in their order. */
export function optionsOf(f: Pick<FieldDef, "choices">, choices: Record<string, Option[]>): Option[] {
  const raw = Array.isArray(f.choices) ? f.choices : typeof f.choices === "string" ? (choices[f.choices] ?? []) : [];
  return [...raw].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
}

/**
 * What a picker offers for `f` on `row`: active options (an inactive one only while the row still carries it) and,
 * for a dependent list, only the children of the parent field's current value (none while the parent is empty).
 */
export function offeredOptions(f: FieldDef, choices: Record<string, Option[]>, row?: Record<string, unknown> | null): Option[] {
  const current = row ? row[f.name] : undefined;
  const held = new Set((Array.isArray(current) ? current : current === null || current === undefined ? [] : [current]).map(String));
  let out = optionsOf(f, choices).filter((o) => o.active !== false || held.has(o.value));
  if (f.dependsOn) {
    const parent = row?.[f.dependsOn];
    out = parent === null || parent === undefined || parent === "" ? out.filter((o) => held.has(o.value)) : out.filter((o) => !o.parent || o.parent === String(parent) || held.has(o.value));
  }
  return out;
}

export function optionOf(f: Pick<FieldDef, "choices">, choices: Record<string, Option[]>, value: unknown): Option | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return optionsOf(f, choices).find((o) => o.value === String(value));
}

/** Label of an option value (the raw value when the list no longer has it). */
export function optionLabel(f: Pick<FieldDef, "choices">, choices: Record<string, Option[]>, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return optionOf(f, choices, value)?.label ?? String(value);
}

/** The state definition of a value (tables with a state model). */
export function stateOf(def: Pick<TableDef, "states">, value: unknown): StateDef | undefined {
  return def.states?.states.find((s) => s.value === String(value ?? ""));
}

export function stateCategoryOf(def: Pick<TableDef, "states">, value: unknown): StateCategory | undefined {
  return stateOf(def, value)?.category;
}

/** True while a record is open work (its state's category is new, active or waiting). */
export function isOpenState(def: Pick<TableDef, "states">, value: unknown): boolean {
  const c = stateCategoryOf(def, value);
  return c ? STATE_CATEGORIES[c].open : true;
}

/** The state field of a table with a state model. */
export const stateFieldOf = (def: TableDef): FieldDef | undefined => (def.states ? fieldOf(def, def.states.field) : undefined);

/** The text a reference to `row` shows: its display field (the engine's `display` for numbered tables adds the number). */
export function displayText(def: TableDef, row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const v = row[def.display];
  if (v === null || v === undefined || v === "") return "";
  return Array.isArray(v) ? v.join("، ") : String(v);
}

/** «TODO0000012 — عنوان» or just the display value. */
export function recordLabel(def: TableDef, row: Record<string, unknown> | null | undefined): string {
  const text = displayText(def, row);
  const no = row?.number ? String(row.number) : "";
  return no && text ? `${no} — ${text}` : no || text || "";
}

/** A referenced id's label from a response's display map (ids are lower-case uuids). */
export function displayOf(display: DisplayMap | undefined, id: unknown): string | undefined {
  if (id === null || id === undefined || id === "") return undefined;
  const k = String(id);
  return display?.[k] ?? display?.[k.toLowerCase()];
}

/** Fields shown on the list page by default: the table's `list.columns`, else the number, display and list fields. */
export function defaultColumns(def: TableDef): string[] {
  const visible = (n: string) => {
    const f = fieldOf(def, n);
    return !!f && isListable(f);
  };
  const fromDef = (def.list?.columns ?? []).filter(visible);
  if (fromDef.length) return fromDef;
  const out: string[] = [];
  if (fieldOf(def, "number")) out.push("number");
  if (!out.includes(def.display)) out.push(def.display);
  for (const f of def.fields) if (f.list && isListable(f) && !out.includes(f.name)) out.push(f.name);
  if (def.states && !out.includes(def.states.field)) out.push(def.states.field);
  if (out.length < 3 && fieldOf(def, "updated_at")) out.push("updated_at");
  return out.slice(0, 8);
}

/** The list's default order: the table's `list.order`, else the newest change first. */
export const defaultSort = (def: TableDef): string => def.list?.order || "-updated_at";

/** Parses "-priority,number" into [{ field, desc }]. */
export function parseSort(sort: string | null | undefined): { field: string; desc: boolean }[] {
  return String(sort ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("-") ? { field: s.slice(1), desc: true } : { field: s.replace(/^\+/, ""), desc: false }));
}

export const formatSort = (parts: { field: string; desc: boolean }[]): string => parts.map((p) => `${p.desc ? "-" : ""}${p.field}`).join(",");

/** Records of `def` may be watched / commented / attached / linked. */
export const hasFeature = (def: TableDef, k: "journal" | "attachments" | "watchers" | "links" | "history"): boolean =>
  k === "history" ? def.features?.history !== false : !!def.features?.[k];

/** A row's value read as a list of strings (array fields, or one value). */
export function valuesOf(v: unknown): string[] {
  if (v === null || v === undefined || v === "") return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

export const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** The row's own record id fields a list needs besides its columns. */
export const ALWAYS_FIELDS = ["number"] as const;

/** Is `row` a record (has an id and a version)? */
export const isRecord = (row: unknown): row is RecordRow => !!row && typeof row === "object" && typeof (row as RecordRow).id === "string";
