// One condition language for filters, queues, saved views, rules, SLA, notifications, UI policies, row rules and
// reports. A condition is plain JSON:
//
//   { and: Cond[] } | { or: Cond[] } | { not: Cond } | { f: "field.path", op, v? }
//
// `evaluate()` runs it in JS (UI, rules, notifications) and the server's `toSql()` (src/server/engine/sql.ts)
// translates it into a parameterised SQL predicate. Both follow the semantics written down here and are tested on
// the same fixtures (tests/engine-conditions.test.ts):
//
// - A leaf never yields NULL: positive operators are false on an empty value, negative ones (ne, nin, ncontains)
//   are true on it — so `not` behaves the same in JS and SQL.
// - Text matching (contains, ncontains, starts, ends) is case-insensitive for Latin letters and ignores the
//   differences of Persian typing: Arabic/Persian digits, ي/ی، ك/ک and zero-width marks (`normalizeSearch`).
//   `eq`/`in` compare text exactly.
// - Date-times compare to the millisecond; dates are calendar days. Relative windows («۷ روز گذشته»، «این ماه»)
//   are Jalali (weeks start on Saturday) in the organisation's time zone (`env.tz`).
// - Array fields (refs, users, multichoice, tags): contains/eq = holds the value, in = holds any of the values.
// - `f` may walk one or two single references: "caller_id.title", "parent_id.assigned_to.name".
// - changed / changes_to / changes_from compare with `env.prev` (only rules have it; null = the record is new).
// Imported by the UI: keep it free of server imports.
import { D } from "../money";
import { formatJalali, formatJalaliDateTime, parseJalaliInput, toFa } from "../jalali";
import type { FieldDef, FieldType, Option, TableDef } from "./types";
import { FIELD_TYPES, refTarget } from "./types";
import { DATE_UNITS, windowDates, windowInstants, zonedMidnight, type DateUnit, type RelativeWindow } from "./jalali-buckets";

export type Op =
  | "eq" | "ne" | "in" | "nin" | "lt" | "lte" | "gt" | "gte" | "between"
  | "contains" | "ncontains" | "starts" | "ends" | "empty" | "nempty"
  | "is_me" | "is_my_group" | "in_my_groups" | "in_my_unit" | "in_my_unit_tree"
  | "relative" | "changed" | "changes_to" | "changes_from";

export interface Leaf {
  f: string;
  op: Op;
  v?: unknown;
}
export type Cond = { and: Cond[] } | { or: Cond[] } | { not: Cond } | Leaf;

/**
 * A relative date window. `{unit, n, dir}`: the last (`past`) or next (`next`) n units *including* the current one
 * («۷ روز گذشته» = today and the 6 days before); n = 0 means the current unit only. `{unit, from, to}`: offsets from
 * the current unit, inclusive («دیروز» = {day, -1, -1}, «ماه گذشته» = {month, -1, -1}).
 */
export interface RelativeValue {
  unit: DateUnit;
  n?: number;
  dir?: "past" | "next";
  from?: number;
  to?: number;
}

/** Who evaluates and when: the identity behind is_me / my groups / my unit, the clock and the previous row. */
export interface CondEnv {
  /** reference instant (default: now) */
  now?: number | string | Date;
  /** IANA time zone of the organisation (default Asia/Tehran) */
  tz?: string;
  userId?: string | null;
  /** ids of my groups */
  groups?: string[];
  /** users who share a group with me (me included) */
  groupUsers?: string[];
  /** my organisation unit, its subtree, and the users in each */
  unitId?: string | null;
  unitTree?: string[];
  unitUsers?: string[];
  unitTreeUsers?: string[];
  /** rules only: the row before the change (null when the record is being created) */
  prev?: Record<string, unknown> | null;
}

export type ValueShape = "none" | "one" | "list" | "pair" | "relative";

export const OPS: Record<Op, { label: string; value: ValueShape; rule?: boolean; negative?: boolean }> = {
  eq: { label: "برابر است با", value: "one" },
  ne: { label: "برابر نیست با", value: "one", negative: true },
  in: { label: "یکی از", value: "list" },
  nin: { label: "هیچ‌یک از", value: "list", negative: true },
  lt: { label: "کمتر از", value: "one" },
  lte: { label: "کمتر از یا برابر", value: "one" },
  gt: { label: "بیشتر از", value: "one" },
  gte: { label: "بیشتر از یا برابر", value: "one" },
  between: { label: "بین", value: "pair" },
  contains: { label: "شامل", value: "one" },
  ncontains: { label: "شامل نیست", value: "one", negative: true },
  starts: { label: "شروع می‌شود با", value: "one" },
  ends: { label: "تمام می‌شود با", value: "one" },
  empty: { label: "خالی است", value: "none" },
  nempty: { label: "خالی نیست", value: "none" },
  is_me: { label: "من هستم", value: "none" },
  is_my_group: { label: "از گروه‌های من است", value: "none" },
  in_my_groups: { label: "از اعضای گروه‌های من است", value: "none" },
  in_my_unit: { label: "در واحد من است", value: "none" },
  in_my_unit_tree: { label: "در واحد من یا زیرمجموعهٔ آن است", value: "none" },
  relative: { label: "در بازهٔ", value: "relative" },
  changed: { label: "تغییر کرد", value: "none", rule: true },
  changes_to: { label: "تغییر کرد به", value: "one", rule: true },
  changes_from: { label: "تغییر کرد از", value: "one", rule: true },
};

const TEXT_OPS: Op[] = ["eq", "ne", "in", "nin", "contains", "ncontains", "starts", "ends", "empty", "nempty"];
const NUM_OPS: Op[] = ["eq", "ne", "in", "nin", "lt", "lte", "gt", "gte", "between", "empty", "nempty"];
const DATE_OPS: Op[] = ["eq", "ne", "lt", "lte", "gt", "gte", "between", "relative", "empty", "nempty"];
const CHOICE_OPS: Op[] = ["eq", "ne", "in", "nin", "empty", "nempty"];
const ARRAY_OPS: Op[] = ["contains", "ncontains", "eq", "ne", "in", "nin", "empty", "nempty"];
const RULE_OPS: Op[] = ["changed", "changes_to", "changes_from"];

/** Operators a field of `type` (pointing at `target` for references) accepts; rule-only operators come last. */
export function opsFor(type: FieldType, target?: string | null): Op[] {
  const info = FIELD_TYPES[type];
  let ops: Op[];
  if (type === "secret") return ["empty", "nempty"];
  if (info.family === "json") return ["empty", "nempty", "changed"];
  if (type === "user") ops = [...CHOICE_OPS, "is_me", "in_my_groups", "in_my_unit", "in_my_unit_tree"];
  else if (type === "users") ops = [...ARRAY_OPS, "is_me", "in_my_groups", "in_my_unit", "in_my_unit_tree"];
  else if (type === "group" || (type === "ref" && target === "group")) ops = [...CHOICE_OPS, "is_my_group", "in_my_groups"];
  else if (type === "ref") ops = target === "org_unit" ? [...CHOICE_OPS, "in_my_unit", "in_my_unit_tree"] : CHOICE_OPS;
  else if (type === "refs") ops = target === "group" ? [...ARRAY_OPS, "is_my_group", "in_my_groups"] : ARRAY_OPS;
  else if (info.array) ops = ARRAY_OPS;
  else if (info.numeric) ops = NUM_OPS;
  else if (type === "bool") ops = ["eq", "ne", "empty", "nempty"];
  else if (type === "date" || type === "datetime") ops = DATE_OPS;
  else if (info.family === "choice") ops = CHOICE_OPS;
  else ops = TEXT_OPS;
  return info.array ? [...ops, "changed"] : [...ops, ...RULE_OPS];
}

// ---------------------------------------------------------------------------------------------------------------
// Text normalisation shared with SQL: ASCII letters lower-cased, Persian/Arabic digits → Latin, Arabic yeh/alef
// maksura → Persian yeh, Arabic kaf → Persian kaf, zero-width marks removed. SQL: translate(x, SEARCH_FROM, SEARCH_TO)
// (characters of SEARCH_FROM beyond the length of SEARCH_TO are deleted).

export const SEARCH_FROM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏";
export const SEARCH_TO = "abcdefghijklmnopqrstuvwxyz01234567890123456789ییک";
const SEARCH_MAP = new Map<string, string>();
for (let i = 0; i < SEARCH_FROM.length; i++) SEARCH_MAP.set(SEARCH_FROM[i], SEARCH_TO[i] ?? "");

export function normalizeSearch(s: unknown): string {
  let out = "";
  for (const ch of String(s ?? "")) out += SEARCH_MAP.has(ch) ? SEARCH_MAP.get(ch)! : ch;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Field paths

/** The global table lookup (set by the registry, src/shared/tables); dot-walks resolve their targets through it. */
let globalLookup: (key: string) => TableDef | undefined = () => undefined;
export function setTableLookup(fn: (key: string) => TableDef | undefined): void {
  globalLookup = fn;
}
export type Lookup = (key: string) => TableDef | undefined;

export interface ResolvedPath {
  /** the field at the end of the path */
  field: FieldDef;
  /** the table that field belongs to */
  def: TableDef;
  /** the reference fields walked through (empty for a plain field), each with the table it belongs to */
  hops: { def: TableDef; field: FieldDef }[];
}

/** Resolve "field", "ref.field" or "ref.ref.field" against `def`; null when a step does not exist. */
export function resolvePath(def: TableDef, path: string, lookup: Lookup = globalLookup): ResolvedPath | null {
  const parts = String(path).split(".");
  if (!parts.length || parts.length > 3 || parts.some((p) => !p)) return null;
  const hops: ResolvedPath["hops"] = [];
  let at = def;
  for (let i = 0; i < parts.length; i++) {
    const field = at.fields.find((x) => x.name === parts[i]);
    if (!field) return null;
    if (i === parts.length - 1) return { field, def: at, hops };
    if (field.type !== "ref" && field.type !== "user" && field.type !== "group") return null;
    const target = refTarget(field, at.key);
    const next = target ? (target === at.key ? at : lookup(target)) : undefined;
    if (!next) return null;
    hops.push({ def: at, field });
    at = next;
  }
  return null;
}

/** Every field path a condition names (to load dot-walked values before `evaluate`). */
export function condPaths(cond: Cond | null | undefined, out = new Set<string>()): Set<string> {
  if (!cond || typeof cond !== "object") return out;
  if ("and" in cond) for (const c of cond.and) condPaths(c, out);
  else if ("or" in cond) for (const c of cond.or) condPaths(c, out);
  else if ("not" in cond) condPaths(cond.not, out);
  else if ("f" in cond) out.add(cond.f);
  return out;
}

/** The value at `path`: a flat key ("caller_id.title", filled by the server's loader) or nested objects. */
export function valueAt(row: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!row) return undefined;
  if (path in row) return row[path];
  let v: unknown = row;
  for (const p of path.split(".")) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    v = (v as Record<string, unknown>)[p];
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Values

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isEmptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Normalised relative window (offsets from the current unit). */
export function relativeWindow(v: unknown): RelativeWindow | null {
  if (!v || typeof v !== "object") return null;
  const r = v as RelativeValue;
  if (!r.unit || !(r.unit in DATE_UNITS)) return null;
  if (typeof r.from === "number" || typeof r.to === "number") {
    const from = Math.trunc(Number(r.from ?? 0));
    const to = Math.trunc(Number(r.to ?? from));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || Math.abs(from) > 5000 || Math.abs(to) > 5000) return null;
    return { unit: r.unit, from, to };
  }
  const n = Math.max(1, Math.trunc(Number(r.n ?? 1)) || 1);
  if (n > 5000) return null;
  return r.dir === "next" ? { unit: r.unit, from: 0, to: n - 1 } : { unit: r.unit, from: -(n - 1), to: 0 };
}

export function envNow(env: CondEnv): number {
  const n = env.now;
  if (n === undefined || n === null) return Date.now();
  if (typeof n === "number") return n;
  const t = n instanceof Date ? n.getTime() : Date.parse(n);
  return Number.isNaN(t) ? Date.now() : t;
}
export const envTz = (env: CondEnv) => env.tz || "Asia/Tehran";

/**
 * A condition operand normalised for a field type — the same in JS and SQL: numbers as decimal strings, dates as
 * ISO dates (Jalali input accepted), date-times as epoch ms (a bare date is its local midnight), booleans, lower-case
 * uuids, everything else as a string. Undefined when the operand is not valid for the type.
 */
export function operand(type: FieldType, v: unknown, env: CondEnv = {}): unknown {
  if (v === null || v === undefined) return undefined;
  const info = FIELD_TYPES[type];
  if (info.numeric) {
    const s = toLatin(String(v)).replace(/[,٬\s]/g, "").replace(/٫/g, ".");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
    if ((type === "int" || type === "rating" || type === "duration") && s.includes(".")) return undefined;
    return D(s).toString();
  }
  if (type === "bool") {
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return undefined;
  }
  if (type === "date") return isoDate(v, envTz(env));
  if (type === "datetime") return instant(v, envTz(env));
  if (info.family === "ref") {
    const s = String(v).trim().toLowerCase();
    return UUID.test(s) ? s : undefined;
  }
  if (typeof v === "object") return undefined;
  return String(v);
}

function toLatin(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function isoDate(v: unknown, tz: string): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  const s = toLatin(String(v)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(s)) ? undefined : s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? undefined : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t));
  }
  const j = parseJalaliInput(s);
  return j ?? undefined;
}

function instant(v: unknown, tz: string): number | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : undefined;
  const s = toLatin(String(v)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
    const d = isoDate(s, tz);
    return d ? zonedMidnight(d, tz) : undefined;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

/** A stored value normalised like an operand (null when empty). */
function stored(type: FieldType, v: unknown, env: CondEnv): unknown {
  if (isEmptyValue(v)) return null;
  if (FIELD_TYPES[type].array) return Array.isArray(v) ? v.map((x) => (FIELD_TYPES[type].family === "ref" ? String(x).toLowerCase() : String(x))) : null;
  const o = operand(type, v, env);
  return o === undefined ? null : o;
}

function compare(type: FieldType, a: unknown, b: unknown): number {
  if (FIELD_TYPES[type].numeric) return D(a as string).cmp(D(b as string));
  if (type === "datetime") return (a as number) - (b as number);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Guess a field type from a value (evaluate without a table definition). */
function guessType(v: unknown, o: unknown): FieldType {
  const x = v ?? o;
  if (Array.isArray(x)) return "tags";
  if (typeof x === "boolean") return "bool";
  if (typeof x === "number") return "decimal";
  if (typeof x === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return "date";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x)) return "datetime";
    if (UUID.test(x)) return "ref";
    if (/^-?\d+(\.\d+)?$/.test(x) && typeof o !== "string") return "decimal";
  }
  return "string";
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation

function sameValue(type: FieldType, a: unknown, b: unknown, env: CondEnv): boolean {
  if (FIELD_TYPES[type].family === "json") return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const x = stored(type, a, env);
  const y = stored(type, b, env);
  if (x === null || y === null) return x === y;
  if (Array.isArray(x) && Array.isArray(y)) return JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
  return compare(type, x, y) === 0;
}

function leafEq(type: FieldType, value: unknown, v: unknown, env: CondEnv): boolean {
  const cur = stored(type, value, env);
  const o = operand(type, v, env);
  if (cur === null || o === undefined) return false;
  if (Array.isArray(cur)) return cur.includes(String(o));
  return compare(type, cur, o) === 0;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function evalLeaf(leaf: Leaf, row: Record<string, unknown>, env: CondEnv, def?: TableDef, lookup?: Lookup): boolean {
  const resolved = def ? resolvePath(def, leaf.f, lookup) : null;
  const raw = valueAt(row, leaf.f);
  const type: FieldType = resolved ? resolved.field.type : guessType(raw, leaf.v);
  const array = !!FIELD_TYPES[type].array;
  const value = stored(type, raw, env);
  const op = leaf.op;
  switch (op) {
    case "empty":
      if (FIELD_TYPES[type].family === "json") return jsonEmpty(raw);
      return value === null;
    case "nempty":
      if (FIELD_TYPES[type].family === "json") return !jsonEmpty(raw);
      return value !== null;
    case "eq":
      return leafEq(type, raw, leaf.v, env);
    case "ne":
      return !leafEq(type, raw, leaf.v, env);
    case "contains":
    case "ncontains": {
      let hit: boolean;
      if (array) hit = leafEq(type, raw, leaf.v, env);
      else hit = value !== null && normalizeSearch(raw).includes(normalizeSearch(leaf.v));
      return op === "contains" ? hit : !hit;
    }
    case "starts":
      return value !== null && normalizeSearch(raw).startsWith(normalizeSearch(leaf.v));
    case "ends":
      return value !== null && normalizeSearch(raw).endsWith(normalizeSearch(leaf.v));
    case "in":
    case "nin": {
      const ops = list(leaf.v).map((x) => operand(type, x, env)).filter((x) => x !== undefined);
      let hit = false;
      if (value !== null) {
        if (Array.isArray(value)) hit = ops.some((o) => value.includes(String(o)));
        else hit = ops.some((o) => compare(type, value, o) === 0);
      }
      return op === "in" ? hit : !hit;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const o = operand(type, leaf.v, env);
      if (value === null || o === undefined || Array.isArray(value)) return false;
      const c = compare(type, value, o);
      return op === "lt" ? c < 0 : op === "lte" ? c <= 0 : op === "gt" ? c > 0 : c >= 0;
    }
    case "between": {
      const [a, b] = list(leaf.v).map((x) => operand(type, x, env));
      if (value === null || a === undefined || b === undefined || Array.isArray(value)) return false;
      return compare(type, value, a) >= 0 && compare(type, value, b) <= 0;
    }
    case "relative": {
      const w = relativeWindow(leaf.v);
      if (!w || value === null) return false;
      if (type === "datetime") {
        const r = windowInstants(w, envNow(env), envTz(env));
        return (value as number) >= r.from && (value as number) < r.to;
      }
      const r = windowDates(w, envNow(env), envTz(env));
      return String(value) >= r.from && String(value) < r.to;
    }
    case "is_me":
      return !!env.userId && anyOf(value, [env.userId.toLowerCase()]);
    case "is_my_group":
      return anyOf(value, env.groups ?? []);
    case "in_my_groups":
      return anyOf(value, type === "user" || type === "users" ? env.groupUsers ?? [] : env.groups ?? []);
    case "in_my_unit":
      return type === "user" || type === "users" ? anyOf(value, env.unitUsers ?? []) : anyOf(value, env.unitId ? [env.unitId] : []);
    case "in_my_unit_tree":
      return anyOf(value, type === "user" || type === "users" ? env.unitTreeUsers ?? [] : env.unitTree ?? []);
    case "changed":
    case "changes_to":
    case "changes_from": {
      if (env.prev === undefined) return false;
      const before = env.prev === null ? null : valueAt(env.prev, leaf.f);
      const changed = env.prev === null ? !isEmptyValue(raw) : !sameValue(type, before, raw, env);
      if (op === "changed") return changed;
      if (op === "changes_to") return changed && leafEq(type, raw, leaf.v, env);
      return changed && env.prev !== null && leafEq(type, before, leaf.v, env);
    }
    default:
      return false;
  }
}

function jsonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function anyOf(value: unknown, ids: string[]): boolean {
  if (value === null || !ids.length) return false;
  const set = new Set(ids.map((x) => String(x).toLowerCase()));
  return Array.isArray(value) ? value.some((x) => set.has(String(x).toLowerCase())) : set.has(String(value).toLowerCase());
}

/**
 * Evaluate a condition on a row. With `def`, values are compared by their field types (decimals exactly,
 * date-times by instant…); without it the type is guessed from the values. Dot-walked paths read flat keys
 * ("caller_id.title") or nested objects of `row`. An empty/absent condition is true.
 */
export function evaluate(cond: Cond | null | undefined, row: Record<string, unknown>, env: CondEnv = {}, def?: TableDef, lookup?: Lookup): boolean {
  if (!cond) return true;
  if ("and" in cond) return cond.and.every((c) => evaluate(c, row, env, def, lookup));
  if ("or" in cond) return cond.or.some((c) => evaluate(c, row, env, def, lookup));
  if ("not" in cond) return !evaluate(cond.not, row, env, def, lookup);
  if ("f" in cond) return evalLeaf(cond, row, env, def, lookup);
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

export interface ValidateOptions {
  /** allow changed / changes_to / changes_from (business rules, notifications) */
  rules?: boolean;
  lookup?: Lookup;
  /** may the caller see this path? (field security) */
  visible?: (path: string, field: FieldDef) => boolean;
  maxDepth?: number;
  maxLeaves?: number;
}

/** Why a condition is not valid for `def` (a Persian message), or null when it is. */
export function validateCond(cond: unknown, def: TableDef, opts: ValidateOptions = {}): string | null {
  let leaves = 0;
  const maxDepth = opts.maxDepth ?? 8;
  const maxLeaves = opts.maxLeaves ?? 200;
  const walk = (c: unknown, depth: number): string | null => {
    if (depth > maxDepth) return "شرط بیش از حد تودرتو است";
    if (!c || typeof c !== "object" || Array.isArray(c)) return "ساختار شرط معتبر نیست";
    const o = c as Record<string, unknown>;
    const keys = Object.keys(o);
    if ("and" in o || "or" in o) {
      const items = (o.and ?? o.or) as unknown;
      if (keys.length !== 1 || !Array.isArray(items)) return "ساختار شرط معتبر نیست";
      for (const x of items) {
        const p = walk(x, depth + 1);
        if (p) return p;
      }
      return null;
    }
    if ("not" in o) return keys.length === 1 ? walk(o.not, depth + 1) : "ساختار شرط معتبر نیست";
    if (typeof o.f !== "string" || typeof o.op !== "string" || keys.some((k) => k !== "f" && k !== "op" && k !== "v")) return "ساختار شرط معتبر نیست";
    if (++leaves > maxLeaves) return "شرط بیش از حد بزرگ است";
    const r = resolvePath(def, o.f, opts.lookup);
    if (!r) return `فیلد «${o.f}» در «${def.label}» وجود ندارد`;
    const label = pathLabel(def, o.f, opts.lookup);
    if (opts.visible && !opts.visible(o.f, r.field)) return `فیلد «${label}» در دسترس شما نیست`;
    const op = o.op as Op;
    if (!(op in OPS)) return `عملگر «${String(o.op)}» شناخته نیست`;
    if (OPS[op].rule && (!opts.rules || r.hops.length)) return `«${OPS[op].label}» فقط در قواعد و روی فیلدهای خود رکورد به کار می‌رود`;
    if (!opsFor(r.field.type, refTarget(r.field, r.def.key)).includes(op)) return `«${OPS[op].label}» برای «${label}» به کار نمی‌رود`;
    const t = r.field.type;
    const shape = OPS[op].value;
    if (shape === "one" && operand(t, o.v) === undefined) return `مقدار «${label}» معتبر نیست`;
    if (shape === "list") {
      if (!Array.isArray(o.v) || o.v.length > 500) return `برای «${label}» فهرستی از مقدارها لازم است`;
      if (o.v.some((x) => operand(FIELD_TYPES[t].array ? (FIELD_TYPES[t].family === "ref" ? "ref" : "string") : t, x) === undefined)) return `یکی از مقدارهای «${label}» معتبر نیست`;
    }
    if (shape === "pair" && (!Array.isArray(o.v) || o.v.length !== 2 || o.v.some((x) => operand(t, x) === undefined))) return `برای «${label}» دو مقدار (از و تا) لازم است`;
    if (shape === "relative" && !relativeWindow(o.v)) return `بازهٔ زمانی «${label}» معتبر نیست`;
    return null;
  };
  return walk(cond, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Persian description

export interface DescribeOptions {
  lookup?: Lookup;
  /** options of choice lists (tenant lists) by list key */
  choices?: Record<string, Option[]>;
  /** display values of referenced ids */
  display?: Record<string, string>;
  tz?: string;
}

/** «فیلد ← فیلد» label of a path. */
export function pathLabel(def: TableDef, path: string, lookup?: Lookup): string {
  const r = resolvePath(def, path, lookup);
  if (!r) return path;
  return [...r.hops.map((h) => h.field.label), r.field.label].join(" ← ");
}

const fa = (n: number | string) => toFa(String(n));

export function describeRelative(v: unknown): string {
  const w = relativeWindow(v);
  if (!w) return "بازهٔ نامعتبر";
  const unit = DATE_UNITS[w.unit];
  const named: Record<DateUnit, [string, string, string]> = {
    day: ["امروز", "دیروز", "فردا"],
    week: ["این هفته", "هفتهٔ گذشته", "هفتهٔ آینده"],
    month: ["این ماه", "ماه گذشته", "ماه آینده"],
    quarter: ["این فصل", "فصل گذشته", "فصل آینده"],
    year: ["امسال", "سال گذشته", "سال آینده"],
  };
  if (w.from === 0 && w.to === 0) return named[w.unit][0];
  if (w.from === -1 && w.to === -1) return named[w.unit][1];
  if (w.from === 1 && w.to === 1) return named[w.unit][2];
  if (w.to === 0 && w.from < 0) return `${fa(1 - w.from)} ${unit} گذشته`;
  if (w.from === 0 && w.to > 0) return `${fa(w.to + 1)} ${unit} آینده`;
  const side = (n: number) => (n < 0 ? `${fa(-n)} ${unit} پیش` : n > 0 ? `${fa(n)} ${unit} بعد` : `این ${unit}`);
  return `از ${side(w.from)} تا ${side(w.to)}`;
}

function describeValue(field: FieldDef, v: unknown, opts: DescribeOptions): string {
  if (v === null || v === undefined || v === "") return "«خالی»";
  const t = field.type;
  if (t === "bool") return operand("bool", v) ? "«بله»" : "«خیر»";
  if (t === "date") {
    const d = operand("date", v);
    return d ? `«${formatJalali(String(d))}»` : `«${String(v)}»`;
  }
  if (t === "datetime") {
    const ms = operand("datetime", v, { tz: opts.tz });
    return typeof ms === "number" ? `«${formatJalaliDateTime(new Date(ms).toISOString(), opts.tz)}»` : `«${String(v)}»`;
  }
  if (FIELD_TYPES[t].numeric) return fa(String(v));
  if (t === "choice" || t === "multichoice") {
    const options = Array.isArray(field.choices) ? field.choices : typeof field.choices === "string" ? opts.choices?.[field.choices] ?? [] : [];
    const o = options.find((x) => x.value === String(v));
    return `«${o?.label ?? String(v)}»`;
  }
  if (FIELD_TYPES[t].family === "ref") return `«${opts.display?.[String(v).toLowerCase()] ?? opts.display?.[String(v)] ?? String(v)}»`;
  return `«${String(v)}»`;
}

/** A human-readable Persian sentence for a condition, e.g. «وضعیت برابر «جدید» است و مسئول من هستم». */
export function describe(cond: Cond | null | undefined, def: TableDef, opts: DescribeOptions = {}): string {
  if (!cond) return "همهٔ رکوردها";
  const inner = (c: Cond, top: boolean): string => {
    if ("and" in c || "or" in c) {
      const items = ("and" in c ? c.and : c.or).map((x) => inner(x, false));
      if (!items.length) return "and" in c ? "همهٔ رکوردها" : "هیچ رکوردی";
      if (items.length === 1) return items[0];
      const s = items.join("and" in c ? " و " : " یا ");
      return top ? s : `(${s})`;
    }
    if ("not" in c) return `چنین نیست که ${inner(c.not, false)}`;
    const leaf = c as Leaf;
    const r = resolvePath(def, leaf.f, opts.lookup);
    const label = `«${pathLabel(def, leaf.f, opts.lookup)}»`;
    if (!r) return `${label} (فیلد ناشناخته)`;
    const f = r.field;
    const val = (x: unknown) => describeValue(f, x, opts);
    switch (leaf.op) {
      case "eq":
        return `${label} برابر ${val(leaf.v)} است`;
      case "ne":
        return `${label} برابر ${val(leaf.v)} نیست`;
      case "in":
        return `${label} یکی از ${list(leaf.v).map(val).join("، ")} است`;
      case "nin":
        return `${label} هیچ‌یک از ${list(leaf.v).map(val).join("، ")} نیست`;
      case "lt":
        return `${label} کمتر از ${val(leaf.v)} است`;
      case "lte":
        return `${label} کمتر از یا برابر ${val(leaf.v)} است`;
      case "gt":
        return `${label} بیشتر از ${val(leaf.v)} است`;
      case "gte":
        return `${label} بیشتر از یا برابر ${val(leaf.v)} است`;
      case "between": {
        const [a, b] = list(leaf.v);
        return `${label} بین ${val(a)} و ${val(b)} است`;
      }
      case "contains":
        return `${label} شامل ${val(leaf.v)} است`;
      case "ncontains":
        return `${label} شامل ${val(leaf.v)} نیست`;
      case "starts":
        return `${label} با ${val(leaf.v)} شروع می‌شود`;
      case "ends":
        return `${label} با ${val(leaf.v)} تمام می‌شود`;
      case "empty":
        return `${label} خالی است`;
      case "nempty":
        return `${label} خالی نیست`;
      case "is_me":
        return f.type === "users" ? `${label} شامل من است` : `${label} من هستم`;
      case "is_my_group":
        return `${label} یکی از گروه‌های من است`;
      case "in_my_groups":
        return f.type === "user" || f.type === "users" ? `${label} از اعضای گروه‌های من است` : `${label} یکی از گروه‌های من است`;
      case "in_my_unit":
        return `${label} در واحد من است`;
      case "in_my_unit_tree":
        return `${label} در واحد من یا زیرمجموعه‌های آن است`;
      case "relative":
        return `${label} در ${describeRelative(leaf.v)} است`;
      case "changed":
        return `${label} تغییر کرده است`;
      case "changes_to":
        return `${label} به ${val(leaf.v)} تغییر کرده است`;
      case "changes_from":
        return `${label} از ${val(leaf.v)} تغییر کرده است`;
      default:
        return `${label} ${String(leaf.op)}`;
    }
  };
  return inner(cond, true);
}
