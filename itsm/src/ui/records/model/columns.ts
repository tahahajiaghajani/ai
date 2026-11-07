// List columns: the defaults of a table, what a person chose (per organisation, person and table — kept in this
// browser; saved views carry their columns to the server so they roam), clean-up against the current definition
// (a removed or hidden field drops out), moves and toggles, and the `fields` a list request must ask for.
// Pure: no React, no antd; the storage is passed in (localStorage in the app, a Map in tests).
import type { TableDef } from "@shared/model/types";
import { resolvePath, type Lookup } from "@shared/model/conditions";
import { defaultColumns, fieldOf, isListable } from "./schema";

/** What a person chose for one table's list. */
export interface ColumnPrefs {
  columns: string[];
  /** column widths in px (resized columns only) */
  widths?: Record<string, number>;
}

/** Minimal storage (localStorage, or a Map in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MAX_COLUMNS = 16;

/** Storage key of a person's columns for a table in an organisation. */
export const columnsKey = (orgId: string, userId: string, table: string): string => `itsm.cols.${orgId}.${userId}.${table}`;

/**
 * Keeps the columns that still exist and may be listed (dot-walks resolved through `lookup`), without duplicates,
 * at most MAX_COLUMNS; falls back to the table's defaults when nothing usable is left.
 */
export function sanitizeColumns(cols: unknown, def: TableDef, lookup?: Lookup): string[] {
  const list = Array.isArray(cols) ? cols.filter((c): c is string => typeof c === "string") : [];
  const out: string[] = [];
  for (const c of list) {
    if (out.includes(c)) continue;
    const f = c.includes(".") ? resolvePath(def, c, lookup)?.field : fieldOf(def, c);
    if (!f || !isListable(f)) continue;
    out.push(c);
    if (out.length >= MAX_COLUMNS) break;
  }
  return out.length ? out : defaultColumns(def);
}

/** A person's saved columns for a table (sanitised), or the table's defaults. */
export function loadColumns(store: KeyValueStore | null | undefined, key: string, def: TableDef, lookup?: Lookup): ColumnPrefs {
  let raw: unknown = null;
  try {
    const s = store?.getItem(key);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<ColumnPrefs>) : null;
  const columns = sanitizeColumns(Array.isArray(raw) ? raw : o?.columns, def, lookup);
  const widths: Record<string, number> = {};
  for (const [k, v] of Object.entries(o?.widths ?? {})) if (columns.includes(k) && typeof v === "number" && v >= 48 && v <= 1200) widths[k] = Math.round(v);
  return Object.keys(widths).length ? { columns, widths } : { columns };
}

/** Stores a person's columns; the table's defaults are stored as «nothing» so a later default change reaches them. */
export function saveColumns(store: KeyValueStore | null | undefined, key: string, prefs: ColumnPrefs, def: TableDef): void {
  if (!store) return;
  try {
    const same = prefs.columns.join(",") === defaultColumns(def).join(",");
    if (same && !prefs.widths) store.removeItem(key);
    else store.setItem(key, JSON.stringify(prefs.widths ? prefs : { columns: prefs.columns }));
  } catch {
    // private mode or a full storage: the choice lasts for this page only
  }
}

/** Shows or hides a column (hiding the last one is refused). */
export function toggleColumn(cols: string[], name: string): string[] {
  if (cols.includes(name)) return cols.length > 1 ? cols.filter((c) => c !== name) : cols;
  return cols.length >= MAX_COLUMNS ? cols : [...cols, name];
}

/** Moves a column from one position to another. */
export function moveColumn(cols: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= cols.length || to < 0 || to >= cols.length) return cols;
  const out = [...cols];
  const [c] = out.splice(from, 1);
  out.splice(to, 0, c);
  return out;
}

/**
 * The `fields` of a list request: the columns plus what every row needs (number, display field, state) and the
 * fields of grouping, kanban cards or row colouring. Dot-walks are asked for as they are.
 */
export function requestFields(def: TableDef, columns: string[], extra: (string | null | undefined)[] = []): string[] {
  const out = new Set<string>();
  if (fieldOf(def, "number")) out.add("number");
  out.add(def.display);
  if (def.states) out.add(def.states.field);
  for (const c of columns) out.add(c);
  for (const c of extra) if (c) out.add(c);
  return [...out];
}
