// The order form of a catalogue item as data (REQ-005…REQ-008, REQ-015, REQ-051): a published version's schema —
// its questions (variables), the questions of its single-row question sets (sections), its multi-row grids, its form
// policies and its settings — and the pure functions both the browser and the server run on it:
//   formDef        the questions as an engine TableDef (virtual), so answers are rendered with the record kit's
//                  editors, conditions are the engine's `Cond` and the server checks values with `coerceValue`
//   formState      which questions are hidden, required or read-only now (definition + policies on the answers)
//   checkAnswers   required, patterns, ranges, lengths, options and grid rows — in every channel, again on the server
//   priceOf        unit price (+ option prices and per-unit prices), total and recurring charge (exact decimals)
//   titleOf        the requested item's title from the item's title template
//   cascade        answers of an order guide handed to the items it includes (same question name, compatible type)
// Pure: no server or UI imports.
import type { Cond, CondEnv, Lookup } from "../model/conditions";
import { evaluate, validateCond } from "../model/conditions";
import type { FieldDef, FieldType, Option, TableDef } from "../model/types";
import { add, cmp, isNumeric, mul } from "../money";
import { FIXED_REF, NO_VALUE_TYPES, variableType, type FieldClass, type ItemType, type VariableType } from "./vocab";

export interface ChoiceDef {
  value: string;
  label: string;
  /** added to the unit price when chosen (decimal string, Rial) */
  price?: string | null;
}

export interface VarDef {
  name: string;
  label: string;
  type: VariableType;
  order: number;
  required?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  /** a literal, or $me / $today */
  default?: string | null;
  choices?: ChoiceDef[];
  ref_table?: string | null;
  ref_filter?: Cond | null;
  min?: string | number | null;
  max?: string | number | null;
  max_length?: number | null;
  regex?: string | null;
  regex_message?: string | null;
  help?: string | null;
  placeholder?: string | null;
  width?: "full" | "half";
  field_class?: FieldClass;
  /** a field of the requested item (or of a record producer's target) the answer is copied into */
  map_to?: string | null;
  /** numbers: added to the unit price per unit answered */
  price_per_unit?: string | null;
  /** the single-row question set the question comes from (its section key) */
  section?: string | null;
}

export interface GridDef {
  /** the question set's code: the key of its rows in the answers */
  code: string;
  label: string;
  min_rows: number;
  max_rows: number;
  columns: VarDef[];
  help?: string | null;
}

export interface PolicyAction {
  variable: string;
  visible?: boolean;
  mandatory?: boolean;
  readonly?: boolean;
}

export interface PolicyDef {
  name: string;
  when: Cond | null;
  actions: PolicyAction[];
  applies_to: "both" | "order" | "fulfil";
  order: number;
  message?: string | null;
  /** a policy of a multi-row set: evaluated on each row of that grid */
  grid?: string | null;
}

export interface TaskTemplateDef {
  id: string;
  short_description: string;
  order: number;
  assignment_group_id?: string | null;
  phase: "after_approval" | "before_approval";
  depends_on_previous: boolean;
  requester_visible: boolean;
  class_of_service?: string | null;
  condition?: Cond | null;
  instructions?: string | null;
  checklist?: string[];
}

/** The item's settings a version freezes (what ordering, pricing and fulfilment read). */
export interface ItemSettings {
  id: string;
  number: string | null;
  name: string;
  code: string;
  type: ItemType;
  catalog_id: string | null;
  category_id: string | null;
  short_description?: string | null;
  description?: string | null;
  icon?: string | null;
  price?: string | null;
  recurring_price?: string | null;
  recurring_frequency?: string | null;
  show_price?: boolean;
  quantity_allowed?: boolean;
  max_quantity?: number | null;
  multi_user?: boolean;
  on_behalf?: string;
  cart_allowed?: boolean;
  delivery_days?: number | null;
  calendar_id?: string | null;
  requires_confirmation?: boolean;
  requester_edit?: boolean;
  requester_cancel?: string;
  title_template?: string | null;
  stages?: string[];
  fulfilment_group_id?: string | null;
  flow_id?: string | null;
  approval_rule_id?: string | null;
  target_table?: string | null;
  field_map?: Record<string, unknown> | null;
  std_change_template?: string | null;
  content_url?: string | null;
  ad_hoc?: boolean;
  button_label?: string | null;
  creates_subscription?: boolean;
}

export interface FormSchema {
  v: 1;
  item: ItemSettings;
  sections: { key: string; label: string }[];
  variables: VarDef[];
  grids: GridDef[];
  policies: PolicyDef[];
  tasks: TaskTemplateDef[];
}

export type Answers = Record<string, unknown>;

export const NAME_RE = /^[a-z][a-z0-9_]{0,59}$/;
/** Names a question may not take (they would shadow what a title template or a condition means). */
export const RESERVED_NAMES = new Set(["item", "requested_for", "quantity", "price", "total", "id", "number", "state"]);

export const isEmptyAnswer = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** The engine field type an answer of `v` is stored and checked as (null: no answer, or an attachment). */
export function fieldTypeOf(v: Pick<VarDef, "type">): FieldType | null {
  return variableType(v.type)?.field ?? null;
}

/** The reference target of a reference question. */
export function refOf(v: Pick<VarDef, "type" | "ref_table">): string | null {
  if (FIXED_REF[v.type]) return FIXED_REF[v.type];
  if (v.type === "reference" || v.type === "list_collector") return v.ref_table || null;
  return null;
}

const num = (x: unknown): number | undefined => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? undefined : Number(x));

/** One question as an engine field (null for labels and attachments, which the form renders itself). */
export function answerField(v: VarDef): FieldDef | null {
  const type = fieldTypeOf(v);
  if (!type || NO_VALUE_TYPES.has(v.type)) return null;
  const f: FieldDef = {
    name: v.name,
    label: v.label,
    type,
    required: !!v.required,
    readonly: !!v.readonly,
    hidden: !!v.hidden,
    help: v.help ?? undefined,
    placeholder: v.placeholder ?? undefined,
    span: v.width === "half" ? 12 : 24,
    section: v.section ?? undefined,
  };
  if (type === "choice" || type === "multichoice") f.choices = (v.choices ?? []).map((c, i) => ({ value: String(c.value), label: String(c.label || c.value), order: i + 1 }));
  const ref = refOf(v);
  if (ref) f.ref = ref;
  if (v.ref_filter && ref) f.refFilter = v.ref_filter;
  const min = num(v.min);
  const max = num(v.max);
  if (min !== undefined) f.min = min;
  if (max !== undefined) f.max = max;
  if (v.max_length && Number(v.max_length) > 0) f.maxLength = Number(v.max_length);
  if (v.type === "email" || v.type === "url" || v.type === "ip" || v.type === "phone") f.ltr = true;
  return f;
}

/** A virtual table of the questions (and one json field per grid): what the record kit renders and conditions read. */
export function formDef(schema: Pick<FormSchema, "variables" | "grids" | "item">): TableDef {
  const fields: FieldDef[] = [];
  for (const v of schema.variables) {
    const f = answerField(v);
    if (f) fields.push(f);
  }
  for (const g of schema.grids) fields.push({ name: g.code, label: g.label, type: "json", span: 24 });
  if (!fields.length) fields.push({ name: "_", label: "-", type: "string", hidden: true });
  return {
    key: "catalog_form",
    table: "",
    virtual: true,
    label: schema.item.name,
    plural: schema.item.name,
    icon: "package",
    module: "request",
    area: "request",
    display: fields[0].name,
    fields,
    scope: {},
  };
}

/** The columns of a grid as a virtual table (each row is checked and rendered against it). */
export function gridDef(g: GridDef): TableDef {
  const fields = g.columns.map(answerField).filter((f): f is FieldDef => !!f);
  if (!fields.length) fields.push({ name: "_", label: "-", type: "string", hidden: true });
  return { key: `catalog_grid_${g.code}`, table: "", virtual: true, label: g.label, plural: g.label, icon: "table", module: "request", area: "request", display: fields[0].name, fields, scope: {} };
}

/** Initial answers from the questions' defaults (`$me` → the person, `$today` → the local date). */
export function defaultAnswers(schema: Pick<FormSchema, "variables" | "grids">, ctx: { me?: string | null; today?: string }): Answers {
  const out: Answers = {};
  for (const v of schema.variables) {
    const d = v.default;
    if (d === null || d === undefined || d === "") continue;
    const t = fieldTypeOf(v);
    if (!t) continue;
    if (d === "$me") {
      if ((t === "user" || t === "users") && ctx.me) out[v.name] = t === "users" ? [ctx.me] : ctx.me;
      continue;
    }
    if (d === "$today") {
      if ((t === "date" || t === "datetime") && ctx.today) out[v.name] = ctx.today;
      continue;
    }
    if (t === "bool") out[v.name] = d === "true" || d === "1" || d === "بله";
    else if (t === "multichoice" || t === "users" || t === "refs") out[v.name] = String(d).split(/[,،]\s*/).filter(Boolean);
    else out[v.name] = d;
  }
  for (const g of schema.grids) if (g.min_rows > 0) out[g.code] = Array.from({ length: g.min_rows }, () => ({}));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Form state

export interface FormState {
  hidden: Set<string>;
  required: Set<string>;
  readonly: Set<string>;
  messages: { key: string; text: string }[];
}

export interface StateContext {
  /** the requester's order form, or the fulfiller's view of the answers */
  mode: "order" | "fulfil";
  env?: CondEnv;
  lookup?: Lookup;
}

function applyPolicies(
  def: TableDef,
  names: Set<string>,
  base: { hidden: Set<string>; required: Set<string>; readonly: Set<string> },
  policies: readonly PolicyDef[],
  row: Answers,
  ctx: StateContext,
  messages: { key: string; text: string }[] | null,
): void {
  const { hidden, required, readonly } = base;
  const ordered = policies.map((p, i) => ({ p, i })).sort((a, b) => (a.p.order ?? 0) - (b.p.order ?? 0) || a.i - b.i);
  for (const { p, i } of ordered) {
    if (p.applies_to !== "both" && p.applies_to !== ctx.mode) continue;
    let applies = false;
    try {
      applies = evaluate(p.when ?? null, row, ctx.env ?? {}, def, ctx.lookup);
    } catch {
      applies = false;
    }
    if (!applies) continue;
    for (const a of p.actions) {
      if (!names.has(a.variable)) continue;
      if (a.visible === false) hidden.add(a.variable);
      if (a.visible === true) hidden.delete(a.variable);
      if (a.mandatory === true) {
        required.add(a.variable);
        hidden.delete(a.variable);
      }
      if (a.mandatory === false) required.delete(a.variable);
      if (a.readonly === true) readonly.add(a.variable);
      if (a.readonly === false) readonly.delete(a.variable);
    }
    if (p.message && messages) messages.push({ key: `p${i}`, text: p.message });
  }
  // a required question is never hidden; a read-only one is never asked for
  for (const n of required) {
    hidden.delete(n);
    if (readonly.has(n)) required.delete(n);
  }
}

/** The state of every question for `answers` (definition flags, then the policies that apply now). */
export function formState(schema: FormSchema, answers: Answers, ctx: StateContext): FormState {
  const def = formDef(schema);
  const hidden = new Set<string>();
  const required = new Set<string>();
  const readonly = new Set<string>();
  const names = new Set<string>();
  for (const v of schema.variables) {
    names.add(v.name);
    if (v.hidden) hidden.add(v.name);
    if (v.required && !NO_VALUE_TYPES.has(v.type)) required.add(v.name);
    if (v.readonly) readonly.add(v.name);
  }
  for (const g of schema.grids) {
    names.add(g.code);
    if (g.min_rows > 0) required.add(g.code);
  }
  const messages: { key: string; text: string }[] = [];
  applyPolicies(def, names, { hidden, required, readonly }, schema.policies.filter((p) => !p.grid), answers, ctx, messages);
  return { hidden, required, readonly, messages };
}

/** The state of the cells of one grid row (the columns' flags and the set's policies on that row). */
export function rowState(schema: FormSchema, grid: GridDef, row: Answers, ctx: StateContext): Omit<FormState, "messages"> {
  const def = gridDef(grid);
  const hidden = new Set<string>();
  const required = new Set<string>();
  const readonly = new Set<string>();
  const names = new Set<string>();
  for (const c of grid.columns) {
    names.add(c.name);
    if (c.hidden) hidden.add(c.name);
    if (c.required && !NO_VALUE_TYPES.has(c.type)) required.add(c.name);
    if (c.readonly) readonly.add(c.name);
  }
  applyPolicies(def, names, { hidden, required, readonly }, schema.policies.filter((p) => p.grid === grid.code), row, ctx, null);
  return { hidden, required, readonly };
}

// ---------------------------------------------------------------------------------------------------------------
// Checking answers

export interface CheckResult {
  /** problems by question name (grid cells as `<grid>.<row>.<column>`) */
  errors: Record<string, string>;
  /** the answers to keep: known, visible questions only (hidden answers are dropped — data minimisation) */
  answers: Answers;
}

function compileRegex(src: string | null | undefined): RegExp | null {
  if (!src) return null;
  try {
    return new RegExp(src, "u");
  } catch {
    return null;
  }
}

function checkValue(v: VarDef, value: unknown, label: string): string | null {
  if (isEmptyAnswer(value)) return null;
  const t = fieldTypeOf(v);
  if (CHOICE_TYPE(v) && v.choices?.length) {
    const allowed = new Set(v.choices.map((c) => String(c.value)));
    const vals = Array.isArray(value) ? value : [value];
    if (vals.some((x) => !allowed.has(String(x)))) return `«${label}»: گزینهٔ انتخاب‌شده در فهرست نیست`;
  }
  if ((t === "int" || t === "decimal" || t === "money" || t === "rating" || t === "duration") && isNumeric(value)) {
    const n = String(value);
    if (v.min !== null && v.min !== undefined && v.min !== "" && cmp(n, String(v.min)) < 0) return `«${label}» دست‌کم ${v.min} است`;
    if (v.max !== null && v.max !== undefined && v.max !== "" && cmp(n, String(v.max)) > 0) return `«${label}» حداکثر ${v.max} است`;
  }
  if (typeof value === "string") {
    if (v.max_length && value.length > Number(v.max_length)) return `«${label}» حداکثر ${v.max_length} نویسه است`;
    const re = compileRegex(v.regex);
    if (re && !re.test(value)) return v.regex_message || `«${label}» با الگوی خواسته‌شده نمی‌خواند`;
  }
  return null;
}

const CHOICE_TYPE = (v: Pick<VarDef, "type">) => v.type === "select" || v.type === "radio" || v.type === "multiselect";

/**
 * Check answers against the form: unknown questions and hidden ones are dropped, required visible questions must be
 * answered, values must satisfy options, ranges, lengths and patterns, grids their row counts and cells. Type
 * coercion (dates, numbers, references) is the engine's (`coerceValue`/`checkRefs` on the server; the record kit's
 * editors in the browser) — this works on values already in their stored form.
 */
export function checkAnswers(schema: FormSchema, raw: Answers, ctx: StateContext & { secretsKept?: ReadonlySet<string> }): CheckResult {
  const state = formState(schema, raw, ctx);
  const errors: Record<string, string> = {};
  const answers: Answers = {};
  for (const v of schema.variables) {
    if (NO_VALUE_TYPES.has(v.type)) continue;
    const value = raw[v.name];
    if (state.hidden.has(v.name)) continue;
    const kept = v.type === "secret" && ctx.secretsKept?.has(v.name);
    if (state.required.has(v.name) && isEmptyAnswer(value) && !kept) {
      errors[v.name] = `«${v.label}» را پاسخ دهید`;
      continue;
    }
    const problem = checkValue(v, value, v.label);
    if (problem) errors[v.name] = problem;
    else if (!isEmptyAnswer(value)) answers[v.name] = value;
  }
  for (const g of schema.grids) {
    if (state.hidden.has(g.code)) continue;
    const rows = Array.isArray(raw[g.code]) ? (raw[g.code] as unknown[]).filter((r) => r && typeof r === "object") as Answers[] : [];
    const filled = rows.filter((r) => g.columns.some((c) => !isEmptyAnswer(r[c.name])));
    if (filled.length < g.min_rows || (state.required.has(g.code) && !filled.length)) {
      errors[g.code] = g.min_rows > 1 ? `«${g.label}» دست‌کم ${g.min_rows} سطر می‌خواهد` : `«${g.label}» را پر کنید`;
      continue;
    }
    if (filled.length > g.max_rows) {
      errors[g.code] = `«${g.label}» حداکثر ${g.max_rows} سطر دارد`;
      continue;
    }
    const kept: Answers[] = [];
    filled.forEach((r, i) => {
      const rs = rowState(schema, g, r, ctx);
      const clean: Answers = {};
      for (const c of g.columns) {
        if (NO_VALUE_TYPES.has(c.type) || rs.hidden.has(c.name)) continue;
        const value = r[c.name];
        if (rs.required.has(c.name) && isEmptyAnswer(value)) {
          errors[`${g.code}.${i}.${c.name}`] = `«${g.label}»، سطر ${i + 1}: «${c.label}» را پر کنید`;
          continue;
        }
        const problem = checkValue(c, value, `${g.label} ← ${c.label}`);
        if (problem) errors[`${g.code}.${i}.${c.name}`] = `سطر ${i + 1}: ${problem}`;
        else if (!isEmptyAnswer(value)) clean[c.name] = value;
      }
      kept.push(clean);
    });
    if (kept.length) answers[g.code] = kept;
  }
  return { errors, answers };
}

// ---------------------------------------------------------------------------------------------------------------
// Prices, titles, cascades

export interface PriceResult {
  unit: string;
  total: string;
  recurring: string | null;
  recurring_total: string | null;
}

/** Unit price = the item's price + prices of chosen options + per-unit prices × numeric answers; × quantity. */
export function priceOf(schema: Pick<FormSchema, "item" | "variables">, answers: Answers, quantity = 1): PriceResult {
  let unit = isNumeric(schema.item.price) ? String(schema.item.price) : "0";
  for (const v of schema.variables) {
    const value = answers[v.name];
    if (isEmptyAnswer(value)) continue;
    if (CHOICE_TYPE(v) && v.choices?.length) {
      for (const x of Array.isArray(value) ? value : [value]) {
        const c = v.choices.find((o) => String(o.value) === String(x));
        if (c && isNumeric(c.price)) unit = add(unit, c.price as string);
      }
    }
    if (isNumeric(v.price_per_unit) && isNumeric(value)) unit = add(unit, mul(v.price_per_unit as string, value as string));
  }
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  const recurring = isNumeric(schema.item.recurring_price) && cmp(String(schema.item.recurring_price), "0") > 0 ? String(schema.item.recurring_price) : null;
  return { unit, total: mul(unit, q), recurring, recurring_total: recurring ? mul(recurring, q) : null };
}

/** The text of an answer for people (option labels, yes/no, names from `display`). */
export function answerText(v: Pick<VarDef, "type" | "choices">, value: unknown, display: Record<string, string> = {}): string {
  if (isEmptyAnswer(value)) return "";
  if (v.type === "secret") return "••••";
  if (v.type === "bool") return value === true ? "بله" : "خیر";
  const one = (x: unknown): string => {
    const s = String(x);
    const c = v.choices?.find((o) => String(o.value) === s);
    if (c) return c.label;
    return display[s] ?? s;
  };
  if (Array.isArray(value)) return value.map(one).join("، ");
  if (typeof value === "object") {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return one(value);
}

/** The requested item's title from the template: {{item}}, {{requested_for}}, {{quantity}} and {{<question>}}. */
export function titleOf(schema: Pick<FormSchema, "item" | "variables">, answers: Answers, ctx: { requestedFor?: string | null; quantity?: number; display?: Record<string, string> } = {}): string {
  const tpl = (schema.item.title_template ?? "").trim();
  if (!tpl) return schema.item.name.slice(0, 200);
  const display = ctx.display ?? {};
  const out = tpl.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    if (key === "item") return schema.item.name;
    if (key === "requested_for") return ctx.requestedFor ? (display[ctx.requestedFor] ?? "") : "";
    if (key === "quantity") return String(ctx.quantity ?? 1);
    const v = schema.variables.find((x) => x.name === key);
    return v ? answerText(v, answers[key], display) : "";
  });
  return (out.replace(/\s+/g, " ").replace(/[\s—–-]+$/, "").trim() || schema.item.name).slice(0, 200);
}

/** Answers of a guide (or another item) for the questions of `to` with the same name and a compatible type. */
export function cascade(from: Answers, fromVars: readonly VarDef[], to: Pick<FormSchema, "variables">): Answers {
  const out: Answers = {};
  for (const v of to.variables) {
    if (!(v.name in from) || isEmptyAnswer(from[v.name])) continue;
    const src = fromVars.find((x) => x.name === v.name);
    if (src && fieldTypeOf(src) !== fieldTypeOf(v)) continue;
    if (v.type === "secret") continue;
    if (CHOICE_TYPE(v) && v.choices?.length) {
      const allowed = new Set(v.choices.map((c) => String(c.value)));
      const vals = Array.isArray(from[v.name]) ? (from[v.name] as unknown[]) : [from[v.name]];
      if (vals.some((x) => !allowed.has(String(x)))) continue;
    }
    out[v.name] = from[v.name];
  }
  return out;
}

/** Problems of a policy's condition and actions against the form (null when fine). */
export function policyProblem(schema: FormSchema, p: Pick<PolicyDef, "when" | "actions" | "grid">): string | null {
  const grid = p.grid ? schema.grids.find((g) => g.code === p.grid) : null;
  const def = grid ? gridDef(grid) : formDef(schema);
  if (p.when && Object.keys(p.when).length) {
    const why = validateCond(p.when, def);
    if (why) return why;
  }
  const names = new Set(grid ? grid.columns.map((c) => c.name) : [...schema.variables.map((v) => v.name), ...schema.grids.map((g) => g.code)]);
  for (const a of p.actions ?? []) if (!names.has(a.variable)) return `پرسش «${a.variable}» در این فرم نیست`;
  if (!(p.actions ?? []).length) return "سیاست دست‌کم یک اقدام می‌خواهد";
  return null;
}

/** Which of `rules` include their item for the guide's answers (empty condition = always: a bundle). */
export function guideIncludes<T extends { condition?: Cond | null; active?: boolean | null }>(rules: readonly T[], schema: FormSchema, answers: Answers, env: CondEnv = {}, lookup?: Lookup): T[] {
  const def = formDef(schema);
  return rules.filter((r) => {
    if (r.active === false) return false;
    if (!r.condition || !Object.keys(r.condition).length) return true;
    try {
      return evaluate(r.condition, answers, env, def, lookup);
    } catch {
      return false;
    }
  });
}

/** Questions whose answers must never leave the requested item (notifications, facts, AI documents, offline copies). */
export const isPrivateClass = (c: FieldClass | undefined): boolean => c === "sensitive" || c === "secret";

/** The option list of a question as engine options (for the condition builder and the editors). */
export const optionsOf = (v: Pick<VarDef, "choices">): Option[] => (v.choices ?? []).map((c, i) => ({ value: String(c.value), label: String(c.label || c.value), order: i + 1 }));
