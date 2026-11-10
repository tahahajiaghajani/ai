// The FilterBuilder's model: an editable tree of AND/OR groups and leaves that serialises to the engine's condition
// JSON (`Cond`, @shared/model/conditions) and back, the operators each field offers (Persian labels from `OPS`), the
// value each operator needs, relative Jalali windows («۷ روز گذشته»، «این ماه»…), the fields a filter may name
// (with one dot-walk into references) and the quick filters of a table. Pure: no React, no antd.
import type { Cond, Leaf, Lookup, Op, RelativeValue, ValueShape } from "@shared/model/conditions";
import { OPS, describe, describeRelative, opsFor, relativeWindow, resolvePath } from "@shared/model/conditions";
import type { FieldDef, Option, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { fieldOf } from "./schema";

export interface FLeaf {
  kind: "leaf";
  id: string;
  /** field path: "state", "caller_id.email" */
  f: string;
  /** "" until an operator is chosen */
  op: Op | "";
  v?: unknown;
}

export interface FGroup {
  kind: "group";
  id: string;
  join: "and" | "or";
  /** «چنین نیست که …» */
  not?: boolean;
  items: FNode[];
}

export type FNode = FLeaf | FGroup;

let seq = 0;
/** Ids for React keys; stable within a session, never stored. */
export const nodeId = (): string => `fn${++seq}`;

export const emptyGroup = (join: "and" | "or" = "and"): FGroup => ({ kind: "group", id: nodeId(), join, items: [] });
export const newLeaf = (f = "", op: Op | "" = "", v?: unknown): FLeaf => ({ kind: "leaf", id: nodeId(), f, op, ...(v === undefined ? {} : { v }) });

/** Operators that are the negation of another (a `{ not: leaf }` from elsewhere becomes the negative leaf). */
export const NEGATE: Partial<Record<Op, Op>> = {
  eq: "ne", ne: "eq", in: "nin", nin: "in", contains: "ncontains", ncontains: "contains", empty: "nempty", nempty: "empty",
};

function toNode(c: Cond): FNode {
  if ("and" in c) return { ...emptyGroup("and"), items: c.and.map(toNode) };
  if ("or" in c) return { ...emptyGroup("or"), items: c.or.map(toNode) };
  if ("not" in c) {
    const inner = c.not;
    if ("f" in inner) {
      const neg = NEGATE[inner.op];
      if (neg) return newLeaf(inner.f, neg, inner.v);
      return { ...emptyGroup("and"), not: true, items: [toNode(inner)] };
    }
    const g = toNode(inner) as FGroup;
    return { ...g, not: !g.not };
  }
  const l = c as Leaf;
  return newLeaf(l.f, l.op, l.v);
}

/** A condition as an editable tree; the root is always a plain (never negated) group, empty for no condition. */
export function fromCond(c: Cond | null | undefined): FGroup {
  if (!c || typeof c !== "object") return emptyGroup();
  const node = toNode(c);
  return node.kind === "group" && !node.not ? node : { ...emptyGroup("and"), items: [node] };
}

/** The value shape an operator needs. */
export const shapeOf = (op: Op | ""): ValueShape | null => (op ? OPS[op].value : null);

const blank = (x: unknown) => x === null || x === undefined || (typeof x === "string" && x.trim() === "");

/** A leaf with a field, an operator and the value that operator needs. */
export function isComplete(l: FLeaf): boolean {
  if (!l.f || !l.op) return false;
  switch (OPS[l.op].value) {
    case "none":
      return true;
    case "one":
      return !blank(l.v) && !Array.isArray(l.v);
    case "list":
      return Array.isArray(l.v) && l.v.length > 0 && l.v.every((x) => !blank(x));
    case "pair":
      return Array.isArray(l.v) && l.v.length === 2 && !blank(l.v[0]) && !blank(l.v[1]);
    case "relative":
      return relativeWindow(l.v) !== null;
  }
}

/**
 * The tree as the engine's condition: incomplete leaves are dropped, a group with one item is that item, nested
 * groups of the same kind are merged. Null when nothing is left (no filter).
 */
export function toCond(node: FNode): Cond | null {
  if (node.kind === "leaf") {
    if (!isComplete(node)) return null;
    const shape = OPS[node.op as Op].value;
    return shape === "none" ? { f: node.f, op: node.op as Op } : { f: node.f, op: node.op as Op, v: node.v };
  }
  const key = node.join;
  const items: Cond[] = [];
  for (const child of node.items) {
    const c = toCond(child);
    if (!c) continue;
    // {and: [{and: [a, b]}, c]} → {and: [a, b, c]}
    if (key in c && !(child.kind === "group" && child.not)) items.push(...((c as Record<string, Cond[]>)[key] ?? []));
    else items.push(c);
  }
  if (!items.length) return null;
  const out: Cond = items.length === 1 ? items[0] : key === "and" ? { and: items } : { or: items };
  return node.not ? { not: out } : out;
}

/** Leaves of a tree (complete or not). */
export function leavesOf(node: FNode, out: FLeaf[] = []): FLeaf[] {
  if (node.kind === "leaf") out.push(node);
  else for (const c of node.items) leavesOf(c, out);
  return out;
}

/** Number of complete leaves (the «پالایه (۳)» badge). */
export const countConditions = (node: FNode): number => leavesOf(node).filter(isComplete).length;

// ---------------------------------------------------------------------------------------------------------------
// Immutable edits (the builder keeps its tree in state)

export function updateNode(root: FGroup, id: string, fn: (n: FNode) => FNode | null): FGroup {
  const walk = (n: FNode): FNode | null => {
    if (n.id === id) return fn(n);
    if (n.kind === "leaf") return n;
    const items = n.items.map(walk).filter((x): x is FNode => x !== null);
    return items.length === n.items.length && items.every((x, i) => x === n.items[i]) ? n : { ...n, items };
  };
  const out = walk(root);
  return out && out.kind === "group" ? out : emptyGroup(root.join);
}

export const removeNode = (root: FGroup, id: string): FGroup => updateNode(root, id, () => null);

export function addChild(root: FGroup, groupId: string, child: FNode): FGroup {
  return updateNode(root, groupId, (n) => (n.kind === "group" ? { ...n, items: [...n.items, child] } : n));
}

// ---------------------------------------------------------------------------------------------------------------
// Fields, operators, values

/** Operators a path offers in a filter (rule-only operators left out). */
export function opsForPath(def: TableDef, path: string, lookup?: Lookup): Op[] {
  const r = resolvePath(def, path, lookup);
  if (!r) return [];
  return opsFor(r.field.type, refTarget(r.field, r.def.key)).filter((op) => !OPS[op].rule);
}

/** The operator a newly picked field starts with: the one people use most for its type. */
export function defaultOp(f: FieldDef, target: string | null): Op {
  const t = f.type;
  if (t === "secret" || FIELD_TYPES[t].family === "json") return "nempty";
  if (t === "user" || t === "users") return "is_me";
  if (t === "group" || (t === "ref" && target === "group")) return "is_my_group";
  if (t === "multichoice" || t === "tags" || t === "refs") return "contains";
  if (t === "choice" || t === "ref" || t === "color") return "in";
  if (t === "bool") return "eq";
  if (t === "date" || t === "datetime") return "relative";
  if (FIELD_TYPES[t].numeric) return "eq";
  return "contains";
}

/** The value a newly picked operator starts with (complete where a sensible default exists). */
export function defaultValue(op: Op, f?: FieldDef): unknown {
  switch (OPS[op].value) {
    case "none":
      return undefined;
    case "list":
      return [];
    case "pair":
      return [null, null];
    case "relative":
      return { unit: "day", n: 7, dir: "past" } satisfies RelativeValue;
    case "one":
      return f?.type === "bool" ? true : undefined;
  }
}

/** Carries a value over when the operator changes shape (one ↔ list ↔ pair); resets otherwise. */
export function convertValue(v: unknown, from: Op | "", to: Op, f?: FieldDef): unknown {
  const a = from ? OPS[from].value : null;
  const b = OPS[to].value;
  if (a === b) return v;
  if (a === "one" && b === "list") return blank(v) ? [] : [v];
  if (a === "list" && b === "one") return Array.isArray(v) && v.length ? v[0] : undefined;
  if (a === "one" && b === "pair") return [blank(v) ? null : v, null];
  if (a === "pair" && b === "one") return Array.isArray(v) ? (v[0] ?? undefined) : undefined;
  return defaultValue(to, f);
}

/** A leaf after its field changed: the field's default operator and value. */
export function withField(l: FLeaf, path: string, def: TableDef, lookup?: Lookup): FLeaf {
  const r = resolvePath(def, path, lookup);
  if (!r) return { ...l, f: path, op: "", v: undefined };
  const op = defaultOp(r.field, refTarget(r.field, r.def.key));
  return { ...l, f: path, op, v: defaultValue(op, r.field) };
}

/** A leaf after its operator changed. */
export function withOp(l: FLeaf, op: Op, def: TableDef, lookup?: Lookup): FLeaf {
  const r = resolvePath(def, l.f, lookup);
  return { ...l, op, v: convertValue(l.v, l.op, op, r?.field) };
}

// ---------------------------------------------------------------------------------------------------------------
// Relative windows

export interface RelativePreset {
  key: string;
  v: RelativeValue;
  label: string;
  /** looks back (past) or ahead (next) */
  dir: "past" | "now" | "next";
}

const preset = (key: string, v: RelativeValue, dir: RelativePreset["dir"]): RelativePreset => ({ key, v, label: describeRelative(v), dir });

/** The windows offered first; any other `{unit, n, dir}` or `{unit, from, to}` is accepted too. */
export const RELATIVE_PRESETS: RelativePreset[] = [
  preset("today", { unit: "day", from: 0, to: 0 }, "now"),
  preset("yesterday", { unit: "day", from: -1, to: -1 }, "past"),
  preset("7d", { unit: "day", n: 7, dir: "past" }, "past"),
  preset("30d", { unit: "day", n: 30, dir: "past" }, "past"),
  preset("week", { unit: "week", from: 0, to: 0 }, "now"),
  preset("last-week", { unit: "week", from: -1, to: -1 }, "past"),
  preset("month", { unit: "month", from: 0, to: 0 }, "now"),
  preset("last-month", { unit: "month", from: -1, to: -1 }, "past"),
  preset("quarter", { unit: "quarter", from: 0, to: 0 }, "now"),
  preset("year", { unit: "year", from: 0, to: 0 }, "now"),
  preset("tomorrow", { unit: "day", from: 1, to: 1 }, "next"),
  preset("next-7d", { unit: "day", n: 7, dir: "next" }, "next"),
  preset("next-week", { unit: "week", from: 1, to: 1 }, "next"),
  preset("next-month", { unit: "month", from: 1, to: 1 }, "next"),
];

/** The preset a window equals (whatever form it was written in), if any. */
export function presetOf(v: unknown): RelativePreset | undefined {
  const w = relativeWindow(v);
  if (!w) return undefined;
  return RELATIVE_PRESETS.find((p) => {
    const x = relativeWindow(p.v)!;
    return x.unit === w.unit && x.from === w.from && x.to === w.to;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The fields a filter may name

export interface PathOption {
  path: string;
  /** «درخواست‌دهنده ← ایمیل» */
  label: string;
  field: FieldDef;
  /** the table the field belongs to (the walked table for a dot-walk) */
  table: string;
  /** the reference walked through, for grouping («درخواست‌دهنده ←») */
  via?: { name: string; label: string };
  /** offered first (`filter: true`) */
  common: boolean;
}

const pickable = (f: FieldDef) => (!f.hidden || f.filter) && f.type !== "json" && f.type !== "conditions";
const byLabel = (a: PathOption, b: PathOption) => Number(b.common) - Number(a.common) || a.label.localeCompare(b.label, "fa");

/**
 * Fields of `def` a filter may name, the ones marked `filter` first; with `walk`, also the fields of the tables single
 * references point at (one level: «درخواست‌دهنده ← سمت»). Tables the caller cannot read are not walked into.
 */
export function filterPaths(def: TableDef, lookup: Lookup, opts: { walk?: boolean } = {}): PathOption[] {
  const own: PathOption[] = def.fields.filter(pickable).map((f) => ({ path: f.name, label: f.label, field: f, table: def.key, common: !!f.filter }));
  own.sort(byLabel);
  if (!opts.walk) return own;
  const walked: PathOption[] = [];
  for (const f of def.fields) {
    if (!pickable(f) || (f.type !== "ref" && f.type !== "user" && f.type !== "group")) continue;
    const target = refTarget(f, def.key);
    const t = target ? lookup(target) : undefined;
    if (!t) continue;
    for (const g of t.fields) {
      if (!pickable(g) || g.type === "secret") continue;
      walked.push({ path: `${f.name}.${g.name}`, label: `${f.label} ← ${g.label}`, field: g, table: t.key, via: { name: f.name, label: f.label }, common: false });
    }
  }
  return [...own, ...walked];
}

// ---------------------------------------------------------------------------------------------------------------
// Composition, URL form, description

/** AND of the given conditions (nulls skipped, nested ANDs merged); null when none is left. */
export function andAll(...conds: (Cond | null | undefined)[]): Cond | null {
  const items: Cond[] = [];
  for (const c of conds) {
    if (!c) continue;
    if ("and" in c) items.push(...c.and);
    else items.push(c);
  }
  return items.length === 0 ? null : items.length === 1 ? items[0] : { and: items };
}

/** The compact JSON of a condition for a URL (`?filter=`). */
export const encodeFilter = (c: Cond | null | undefined): string => (c ? JSON.stringify(c) : "");

/** A condition from a URL parameter; null when it is absent or not a condition object. */
export function decodeFilter(s: string | null | undefined): Cond | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return isCondShape(v) ? (v as Cond) : null;
  } catch {
    return null;
  }
}

/** A structural check (the server validates fields and values). */
export function isCondShape(v: unknown, depth = 0): boolean {
  if (depth > 10 || !v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if ("and" in o) return Array.isArray(o.and) && o.and.every((x) => isCondShape(x, depth + 1));
  if ("or" in o) return Array.isArray(o.or) && o.or.every((x) => isCondShape(x, depth + 1));
  if ("not" in o) return isCondShape(o.not, depth + 1);
  return typeof o.f === "string" && typeof o.op === "string" && o.op in OPS;
}

/** The sentence under the builder («وضعیت یکی از «جدید»، «در حال انجام» است و کارشناس من هستم»). */
export function describeFilter(c: Cond | null | undefined, def: TableDef, o: { lookup?: Lookup; choices?: Record<string, Option[]>; display?: Record<string, string>; tz?: string } = {}): string {
  return describe(c ?? null, def, o);
}

// ---------------------------------------------------------------------------------------------------------------
// Quick filters

export interface QuickFilter {
  key: string;
  label: string;
  cond: Cond;
}

/**
 * One-click filters of a table, derived from its fields: «واگذارشده به من»، «گروه‌های من»، «باز»، «بدون کارشناس»،
 * «پیگیری می‌کنم». Only those whose fields exist (and the caller can see) are offered.
 */
export function quickFilters(def: TableDef): QuickFilter[] {
  const has = (n: string) => !!fieldOf(def, n);
  const out: QuickFilter[] = [];
  if (has("assigned_to")) out.push({ key: "mine", label: "واگذارشده به من", cond: { f: "assigned_to", op: "is_me" } });
  const group = def.scope?.group ?? (has("assignment_group_id") ? "assignment_group_id" : undefined);
  if (group && has(group)) out.push({ key: "my-groups", label: "گروه‌های من", cond: { f: group, op: "is_my_group" } });
  if (has("active")) out.push({ key: "open", label: "باز", cond: { f: "active", op: "eq", v: true } });
  else if (def.states) {
    const open = def.states.states.filter((s) => s.category === "new" || s.category === "active" || s.category === "waiting").map((s) => s.value);
    if (open.length) out.push({ key: "open", label: "باز", cond: { f: def.states.field, op: "in", v: open } });
  }
  if (has("assigned_to")) out.push({ key: "unassigned", label: "بدون کارشناس", cond: { f: "assigned_to", op: "empty" } });
  const watchers = def.scope?.watchers ?? (has("watch_list") ? "watch_list" : undefined);
  if (watchers && has(watchers)) out.push({ key: "watching", label: "پیگیری می‌کنم", cond: { f: watchers, op: "is_me" } });
  return out;
}

/** The AND of the chosen quick filters. */
export function quickCond(def: TableDef, keys: readonly string[]): Cond | null {
  const all = quickFilters(def);
  return andAll(...keys.map((k) => all.find((q) => q.key === k)?.cond));
}
