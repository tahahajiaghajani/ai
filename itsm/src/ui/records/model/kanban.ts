// The kanban board's model: the field a board groups by, its columns (options of a choice, states of a state model,
// or the values an aggregate found for members, groups and references), what a drop means (an update, a transition
// of the state model with the fields it requires, or a refusal with the reason) and WIP limits. Pure.
import type { ColorKey, FieldDef, Option, TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { fieldOf, offeredOptions, stateCategoryOf, stateOf } from "./schema";
import type { AggregateRow, DisplayMap } from "./types";

export interface BoardColumn {
  /** React key; "∅" for the empty column */
  key: string;
  /** the field's value in this column (null = empty) */
  value: string | null;
  label: string;
  color?: ColorKey;
  /** WIP limit of the column */
  wip?: number;
}

export const EMPTY_KEY = "∅";

/** The field a board groups by: the one asked for, the table's `features.kanban`, else its state field. */
export function boardField(def: TableDef, wanted?: string | null): FieldDef | undefined {
  const name = wanted || def.features?.kanban || def.states?.field;
  const f = name ? fieldOf(def, name) : undefined;
  return f && isBoardable(f) ? f : undefined;
}

/** Fields a board can group by: single choices (states included), members, groups, references and booleans. */
export function isBoardable(f: FieldDef): boolean {
  if (f.hidden || FIELD_TYPES[f.type].array) return false;
  return f.type === "choice" || f.type === "user" || f.type === "group" || f.type === "ref" || f.type === "bool";
}

/** Columns of a choice or state field, in option order (inactive options left out), plus «خالی» when allowed. */
export function choiceColumns(def: TableDef, f: FieldDef, choices: Record<string, Option[]>, wip: Record<string, number> = {}): BoardColumn[] {
  const opts = offeredOptions({ ...f, dependsOn: undefined }, choices);
  const cols: BoardColumn[] = opts.map((o) => ({ key: o.value, value: o.value, label: o.label, color: o.color, ...(wip[o.value] ? { wip: wip[o.value] } : {}) }));
  const isState = !!def.states && def.states.field === f.name;
  if (!isState && !f.required) cols.push({ key: EMPTY_KEY, value: null, label: "بدون مقدار" });
  return cols;
}

/** Columns of a boolean field. */
export const boolColumns = (): BoardColumn[] => [
  { key: "true", value: "true", label: "بله", color: "green" },
  { key: "false", value: "false", label: "خیر", color: "gray" },
];

/** Columns of a member, group or reference field: the values an aggregate found (most used first), then «خالی». */
export function aggregateColumns(rows: readonly AggregateRow[], display: DisplayMap, max = 12): BoardColumn[] {
  const cols: BoardColumn[] = [];
  for (const r of rows) {
    const k = r.keys[0];
    if (k === null || k === undefined || k === "" || cols.length >= max) continue;
    const id = String(k);
    cols.push({ key: id, value: id, label: r.labels[0] || display[id] || display[id.toLowerCase()] || "(محدود)" });
  }
  // records without a value always have a column to be dropped into (and dragged out of)
  cols.push({ key: EMPTY_KEY, value: null, label: "بدون مقدار" });
  return cols;
}

export type DropPlan =
  | { kind: "none" }
  | { kind: "update"; data: Record<string, unknown> }
  | { kind: "transition"; to: string; label: string; requires: string[] }
  | { kind: "blocked"; reason: string };

/**
 * What dropping `row` into the column of `value` means. On the state field: the transition of the state model from
 * the row's state (its required fields are asked for first); other fields: an update. The server re-checks roles
 * and guards — a refusal comes back as a Persian message.
 */
export function planDrop(def: TableDef, f: FieldDef, row: Record<string, unknown>, value: string | null): DropPlan {
  const current = row[f.name] === undefined || row[f.name] === null || row[f.name] === "" ? null : String(row[f.name]);
  if (current === value) return { kind: "none" };
  const sm = def.states;
  if (sm && sm.field === f.name) {
    if (value === null) return { kind: "blocked", reason: "وضعیت نمی‌تواند خالی باشد" };
    const t = sm.transitions.find((x) => x.to === value && (x.from === "*" || (current !== null && x.from.includes(current))));
    const from = stateOf(def, current)?.label ?? current ?? "";
    const to = stateOf(def, value)?.label ?? value;
    if (!t) return { kind: "blocked", reason: `از «${from}» نمی‌توان به «${to}» رفت` };
    return { kind: "transition", to: value, label: t.label, requires: t.requires ?? [] };
  }
  if (sm) {
    const cat = stateCategoryOf(def, row[sm.field]);
    if (cat && (sm.locked ?? ["closed", "canceled"]).includes(cat)) return { kind: "blocked", reason: "این رکورد بسته است و تغییر نمی‌کند" };
  }
  if (value === null && f.required) return { kind: "blocked", reason: `«${f.label}» الزامی است` };
  const v = f.type === "bool" ? value === "true" : value;
  return { kind: "update", data: { [f.name]: v } };
}

/** «full» at the limit, «over» beyond it. */
export function wipState(count: number, wip?: number): "ok" | "full" | "over" {
  if (!wip) return "ok";
  return count > wip ? "over" : count === wip ? "full" : "ok";
}

/** The column a row sits in. */
export function columnKeyOf(f: FieldDef, row: Record<string, unknown>): string {
  const v = row[f.name];
  if (v === null || v === undefined || v === "") return EMPTY_KEY;
  return String(v);
}
