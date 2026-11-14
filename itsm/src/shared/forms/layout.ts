// Process forms (design F §3.2, package F2): the layout of a `form` row — FormLayoutV2: tabs → sections → items, each
// item a library field (with the form's own width, label, help, «الزامی» / «فقط‌خواندنی» / «پنهان» and «نمایش وقتی…», a
// condition on the form's own values) or a note line — with its cleaning and limits (like the table arrangement's
// `cleanArrangement`), the problems a write is refused for, and the rights of a step.
//
// Rights. Each field of a form is hidden, read-only, editable or required for a person at a step. ONE pure function,
// `effectiveRights(form, step, fields, viewer)`, decides it for the designer's preview, the person's step form, the
// apply on the authority (only editable keys are merged) and the read redaction (hidden keys are removed). It applies,
// in order — a later layer wins over an earlier one:
//   1. the form's item flags: «پنهان» hidden, «فقط‌خواندنی» read, «الزامی» required, otherwise edit;
//   2. the step's rights (they live on the step, so one form serves several steps): a right the step names for the
//      field wins; for the others the step's default (read unless it says otherwise), refined by the form's flags — a
//      field the form hides stays hidden, a read-only one is read at most, a required one is required where the
//      default lets people edit;
//   3. the viewer's field groups: a field of a group the viewer does not hold is hidden («مالی», «اطلاعات شخصی»);
//   4. locked fields: never editable (read at most; a hidden field stays hidden).
// «نمایش وقتی…» (`showIf`) is presentation, not access: a field whose condition does not hold on the values being
// entered is not shown, asked for or taken (`applyShowIf`); readers keep the rights above.
// Imported by the UI: keep it free of server imports.
import type { Cond, CondEnv, Lookup } from "../model/conditions";
import { condPaths, evaluate, validateCond } from "../model/conditions";
import type { FieldDef, FieldGroup, TableDef } from "../model/types";
import { faDigits } from "../format";
import { LIBRARY_NAME } from "./fieldtypes";

// ---------------------------------------------------------------------------------------------------------------
// Rights

export type Right = "hidden" | "read" | "edit" | "required";

/** The rights in order, narrowest first. */
export const RIGHTS: readonly Right[] = ["hidden", "read", "edit", "required"];

export const RIGHT_LABELS: Record<Right, string> = { hidden: "پنهان", read: "خواندنی", edit: "ویرایش", required: "الزامی" };

export const isRight = (v: unknown): v is Right => typeof v === "string" && (RIGHTS as readonly string[]).includes(v);

/** The rights of a step over its form's fields: a right per field, and the default for the fields it does not name. */
export interface StepRights {
  default: Right;
  fields: Record<string, Right>;
}

/** A step that says nothing: everything readable («همه خواندنی»). */
export const DEFAULT_STEP_RIGHTS: Readonly<StepRights> = Object.freeze({ default: "read", fields: Object.freeze({}) as Record<string, Right> });

const RANK: Record<Right, number> = { hidden: 0, read: 1, edit: 2, required: 3 };

/** The narrower of two rights. */
export const narrower = (a: Right, b: Right): Right => (RANK[a] <= RANK[b] ? a : b);

export const canRead = (r: Right | undefined): boolean => !!r && r !== "hidden";
export const canEdit = (r: Right | undefined): boolean => r === "edit" || r === "required";

/** A step's rights from stored JSON: unknown rights and field names are left out; the default is read unless valid. */
export function cleanStepRights(raw: unknown): StepRights {
  const o = parse(raw);
  const fields: Record<string, Right> = {};
  const src = o && o.fields && typeof o.fields === "object" && !Array.isArray(o.fields) ? (o.fields as Record<string, unknown>) : {};
  for (const [name, r] of Object.entries(src).slice(0, MAX_FIELDS)) if (LIBRARY_NAME.test(name) && isRight(r)) fields[name] = r;
  return { default: isRight(o?.default) ? o!.default : "read", fields };
}

// ---------------------------------------------------------------------------------------------------------------
// The layout

export type Span = 6 | 8 | 12 | 16 | 18 | 24;
export const SPANS: readonly Span[] = [6, 8, 12, 16, 18, 24];

/** A library field on the form, with the form's own presentation of it. */
export interface FieldItem {
  field: string;
  span?: Span;
  /** this form's label and help (the library's otherwise) */
  label?: string;
  help?: string;
  required?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  /** shown only while this condition holds on the form's own values */
  showIf?: Cond;
}

/** A note line on the form (no data). */
export interface NoteItem {
  text: string;
  tone?: "info" | "warning";
}

export type FormItem = FieldItem | NoteItem;

export interface FormSection {
  label: string | null;
  columns?: 1 | 2;
  items: FormItem[];
}

export interface FormTab {
  label: string;
  sections: FormSection[];
}

export interface FormLayoutV2 {
  tabs: FormTab[];
}

export const isFieldItem = (i: FormItem): i is FieldItem => typeof (i as FieldItem).field === "string";

/** Caps of one form (like the table arrangement's). */
export const FORM_LIMITS = { tabs: 12, sections: 60, fields: 300, notes: 100, label: 80, help: 300, note: 500 } as const;
const MAX_FIELDS = FORM_LIMITS.fields;
const DEFAULT_TAB = "جزئیات";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const line = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function parse(raw: unknown): Record<string, any> | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isObj(o) ? o : null;
}

/** An empty form (a new form's layout). */
export const emptyLayout = (): FormLayoutV2 => ({ tabs: [] });

function cleanFieldItem(x: Record<string, unknown>): FieldItem {
  const item: FieldItem = { field: x.field as string };
  if ((SPANS as readonly unknown[]).includes(x.span)) item.span = x.span as Span;
  const label = line(x.label, FORM_LIMITS.label);
  if (label) item.label = label;
  const help = line(x.help, FORM_LIMITS.help);
  if (help) item.help = help;
  // hidden wins over read-only, and both over required (a field nobody can fill is never required)
  if (x.hidden === true) item.hidden = true;
  else if (x.readonly === true) item.readonly = true;
  else if (x.required === true) item.required = true;
  if (isObj(x.showIf)) item.showIf = x.showIf as Cond;
  return item;
}

/**
 * A clean layout from stored JSON (an object or its text): labels trimmed, every library field named once, flags that
 * contradict each other resolved (hidden over read-only over required), sizes capped. Never throws; a layout with
 * nothing usable is empty.
 */
export function cleanFormLayout(raw: unknown): FormLayoutV2 {
  const o = parse(raw);
  const seen = new Set<string>();
  let sections = 0;
  let notes = 0;
  const tabs: FormTab[] = [];
  for (const t of arr(o?.tabs).slice(0, FORM_LIMITS.tabs)) {
    if (!isObj(t)) continue;
    const secs: FormSection[] = [];
    for (const s of arr(t.sections)) {
      if (!isObj(s) || sections >= FORM_LIMITS.sections) continue;
      sections++;
      const items: FormItem[] = [];
      for (const x of arr(s.items)) {
        if (!isObj(x)) continue;
        if (typeof x.field === "string") {
          if (!LIBRARY_NAME.test(x.field) || seen.has(x.field) || seen.size >= MAX_FIELDS) continue;
          seen.add(x.field);
          items.push(cleanFieldItem(x));
        } else if (typeof x.text === "string") {
          const text = line(x.text, FORM_LIMITS.note);
          if (!text || notes >= FORM_LIMITS.notes) continue;
          notes++;
          items.push(x.tone === "info" || x.tone === "warning" ? { text, tone: x.tone } : { text });
        }
      }
      const sec: FormSection = { label: line(s.label, FORM_LIMITS.label) || null, items };
      if (s.columns === 1 || s.columns === 2) sec.columns = s.columns;
      secs.push(sec);
    }
    tabs.push({ label: line(t.label, FORM_LIMITS.label) || DEFAULT_TAB, sections: secs });
  }
  return { tabs };
}

/** The field items of a layout, in order. */
export function fieldItems(form: FormLayoutV2): FieldItem[] {
  const out: FieldItem[] = [];
  for (const t of form.tabs) for (const s of t.sections) for (const i of s.items) if (isFieldItem(i)) out.push(i);
  return out;
}

/** The library fields a layout uses, in order. */
export const layoutFields = (form: FormLayoutV2): string[] => fieldItems(form).map((i) => i.field);

// ---------------------------------------------------------------------------------------------------------------
// Field definitions: from the library (online), or from a version's snapshot (offline)

/** Where a form's field definitions come from: a map, a record by name, or a lookup. */
export type FieldSource = ReadonlyMap<string, FieldDef> | Readonly<Record<string, FieldDef>> | ((name: string) => FieldDef | null | undefined);

export function fieldGetter(src: FieldSource): (name: string) => FieldDef | undefined {
  if (typeof src === "function") return (n) => src(n) ?? undefined;
  if (src instanceof Map) return (n) => src.get(n);
  const rec = src as Readonly<Record<string, FieldDef>>;
  return (n) => (Object.prototype.hasOwnProperty.call(rec, n) ? rec[n] : undefined);
}

/**
 * The form's values as a table for conditions (`showIf`): its fields, nothing else — no record id, no walks into other
 * tables. `evaluate` and `validateCond` read it like any table.
 */
export function formValuesDef(form: FormLayoutV2, src: FieldSource, label = "فرم"): TableDef {
  const get = fieldGetter(src);
  return valuesDef(layoutFields(form).map(get).filter((f): f is FieldDef => !!f), label);
}

function valuesDef(fields: FieldDef[], label = "فرم"): TableDef {
  return { key: "form_values", table: "sm_form_values", label, plural: label, icon: "file-text", module: "forms", area: "process_design", display: fields[0]?.name ?? "", fields, scope: {}, virtual: true };
}

// ---------------------------------------------------------------------------------------------------------------
// What a write is refused for

export interface LayoutEnv {
  /** the library field of that name, as the online form builds it (null: not in the library, or not usable) */
  field(name: string): FieldDef | null | undefined;
  /** is the library field retired (offered for nothing new)? */
  retired?(name: string): boolean;
  /** fields the stored form already holds: a retired field stays where it is */
  kept?: ReadonlySet<string>;
  lookup?: Lookup;
}

const fa = (n: number) => faDigits(n);

/**
 * Why a layout cannot be saved (Persian reasons, empty when it can): its shape and caps, unknown or repeated fields, a
 * retired field the form did not already hold, contradicting flags, widths, and «نمایش وقتی…» conditions that are not
 * valid on the form's own fields.
 */
export function formLayoutProblems(raw: unknown, env: LayoutEnv): string[] {
  const problems: string[] = [];
  const o = parse(raw);
  if (!o || !Array.isArray(o.tabs)) return ["چیدمان فرم معتبر نیست"];
  if (o.tabs.length > FORM_LIMITS.tabs) problems.push(`فرم حداکثر ${fa(FORM_LIMITS.tabs)} زبانه دارد`);
  const seen = new Set<string>();
  let sections = 0;
  let notes = 0;
  const labelOf = (name: string, item?: Record<string, unknown>) => line(item?.label, FORM_LIMITS.label) || env.field(name)?.label || name;
  const conditions: { name: string; label: string; cond: unknown }[] = [];
  for (const t of o.tabs as unknown[]) {
    if (!isObj(t) || (t.sections !== undefined && !Array.isArray(t.sections))) {
      problems.push("یکی از زبانه‌های فرم معتبر نیست");
      continue;
    }
    for (const s of arr(t.sections)) {
      if (!isObj(s) || (s.items !== undefined && !Array.isArray(s.items))) {
        problems.push("یکی از بخش‌های فرم معتبر نیست");
        continue;
      }
      sections++;
      if (s.columns !== undefined && s.columns !== null && s.columns !== 1 && s.columns !== 2) problems.push(`ستون‌های بخش «${line(s.label, FORM_LIMITS.label) || "بی‌نام"}» باید ۱ یا ۲ باشد`);
      for (const x of arr(s.items)) {
        if (!isObj(x) || (typeof x.field !== "string" && typeof x.text !== "string")) {
          problems.push("یکی از اجزای فرم نه فیلد است نه یادداشت");
          continue;
        }
        if (typeof x.text === "string" && typeof x.field !== "string") {
          if (!line(x.text, FORM_LIMITS.note)) problems.push("یادداشت خالی در فرم آمده است");
          else notes++;
          continue;
        }
        const name = x.field as string;
        if (!LIBRARY_NAME.test(name)) {
          problems.push(`«${name}» نام فیلد کتابخانه نیست`);
          continue;
        }
        const f = env.field(name);
        if (!f) {
          problems.push(`فیلد «${name}» در کتابخانه نیست`);
          continue;
        }
        if (seen.has(name)) {
          problems.push(`«${labelOf(name)}» دو بار در فرم آمده است`);
          continue;
        }
        seen.add(name);
        if (env.retired?.(name) && !env.kept?.has(name)) problems.push(`فیلد «${f.label}» بازنشسته است و به فرم افزوده نمی‌شود`);
        if (x.span !== undefined && x.span !== null && !(SPANS as readonly unknown[]).includes(x.span)) problems.push(`پهنای «${labelOf(name, x)}» باید یکی از ۶، ۸، ۱۲، ۱۶، ۱۸ یا ۲۴ باشد`);
        if (x.required === true && x.hidden === true) problems.push(`«${labelOf(name, x)}» نمی‌تواند هم پنهان باشد و هم الزامی`);
        else if (x.required === true && x.readonly === true) problems.push(`«${labelOf(name, x)}» نمی‌تواند هم فقط‌خواندنی باشد و هم الزامی`);
        if (x.showIf !== undefined && x.showIf !== null) conditions.push({ name, label: labelOf(name, x), cond: x.showIf });
      }
    }
  }
  if (sections > FORM_LIMITS.sections) problems.push(`فرم حداکثر ${fa(FORM_LIMITS.sections)} بخش دارد`);
  if (seen.size > MAX_FIELDS) problems.push(`فرم حداکثر ${fa(MAX_FIELDS)} فیلد دارد`);
  if (notes > FORM_LIMITS.notes) problems.push(`فرم حداکثر ${fa(FORM_LIMITS.notes)} یادداشت دارد`);
  // conditions name the form's own fields (no walks into other tables), never the field they show
  if (conditions.length) {
    const def = valuesDef([...seen].map((n) => env.field(n)).filter((f): f is FieldDef => !!f));
    for (const c of conditions) {
      if (!isObj(c.cond)) {
        problems.push(`شرط نمایش «${c.label}» معتبر نیست`);
        continue;
      }
      const paths = [...condPaths(c.cond as Cond)];
      const walk = paths.find((p) => p.includes("."));
      const outside = paths.find((p) => !p.includes(".") && !seen.has(p));
      if (walk) problems.push(`شرط نمایش «${c.label}» فقط فیلدهای همین فرم را می‌سنجد`);
      else if (outside) problems.push(`شرط نمایش «${c.label}» فیلد «${outside}» را می‌سنجد که در این فرم نیست`);
      else if (paths.includes(c.name)) problems.push(`شرط نمایش «${c.label}» به خود آن فیلد بستگی دارد`);
      else {
        const p = validateCond(c.cond, def, { lookup: env.lookup });
        if (p) problems.push(`شرط نمایش «${c.label}»: ${p}`);
      }
    }
    // nor on each other in a circle: each would hide the other, and no order of entry could show them
    const reads = new Map<string, string[]>();
    for (const c of conditions) if (isObj(c.cond)) reads.set(c.name, [...condPaths(c.cond as Cond)].filter((p) => p !== c.name && seen.has(p)));
    const circle = conditionCircle(reads);
    if (circle) {
      const label = new Map(conditions.map((c) => [c.name, c.label]));
      const names = circle.map((n) => `«${label.get(n) ?? n}»`);
      problems.push(`شرط‌های نمایش ${names.slice(0, -1).join("، ")} و ${names[names.length - 1]} به یکدیگر بستگی دارند؛ یکی را بی‌شرط بگذارید`);
    }
  }
  return [...new Set(problems)];
}

/** A circle among «نمایش وقتی…» conditions (field → the fields its condition reads), in order; null when none. */
function conditionCircle(reads: ReadonlyMap<string, readonly string[]>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1);
    path.push(n);
    for (const m of reads.get(n) ?? []) {
      if (!reads.has(m)) continue;
      if (state.get(m) === 1) return path.slice(path.indexOf(m));
      if (!state.has(m)) {
        const found = visit(m);
        if (found) return found;
      }
    }
    path.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of reads.keys()) {
    if (state.has(n)) continue;
    const found = visit(n);
    if (found) return found;
  }
  return null;
}

/**
 * The fields of a table's default form — the record page's body: never a base column, a module's internal field
 * (`hidden`), or the number, state and watch list the page shows elsewhere. Without `engine`, not the
 * engine-maintained (system) fields either: the fields the system form designer arranges and a new record's form
 * shows.
 */
export function tableFormFields(def: TableDef, opts: { engine?: boolean } = {}): FieldDef[] {
  const watchers = def.features?.watchers ? (def.scope?.watchers ?? "watch_list") : null;
  return def.fields.filter((f) => !f.base && !f.hidden && f.name !== "number" && f.name !== def.states?.field && f.name !== watchers && (opts.engine || !f.system));
}

// ---------------------------------------------------------------------------------------------------------------
// Effective rights

/** Who looks: the field groups they hold ("all": every group — the system). */
export interface Viewer {
  groups: Iterable<FieldGroup> | "all";
}

export interface RightsOptions {
  /** further fields nobody edits here (beside definitions marked locked, read-only or system) */
  locked?: Iterable<string>;
}

/** The right an item's own flags give it (no step). */
export const flagRight = (item: FieldItem): Right => (item.hidden ? "hidden" : item.readonly ? "read" : item.required ? "required" : "edit");

/** A step's default for an item it does not name, refined by the item's flags. */
function refined(item: FieldItem, d: Right): Right {
  if (item.hidden) return "hidden";
  if (item.readonly) return narrower(d, "read");
  if (item.required && d === "edit") return "required";
  return d;
}

/**
 * The right of every field of `form` for `viewer` at `step` (null: the form alone): the form's flags, then the step's
 * rights, then the viewer's field groups, then locks (see the head of this file). A field without a definition in
 * `fields` is hidden. The same answer on every runtime: the designer's preview, the step form, the apply on the
 * authority and the read redaction all call this.
 */
export function effectiveRights(form: FormLayoutV2, step: StepRights | null | undefined, fields: FieldSource, viewer: Viewer, opts: RightsOptions = {}): Record<string, Right> {
  const get = fieldGetter(fields);
  const groups = viewer.groups === "all" ? null : new Set(viewer.groups);
  const locked = new Set(opts.locked ?? []);
  const named = step && isObj(step.fields) ? step.fields : {};
  const dflt: Right = step && isRight(step.default) ? step.default : "read";
  const out: Record<string, Right> = {};
  for (const item of fieldItems(form)) {
    const f = get(item.field);
    if (!f) {
      out[item.field] = "hidden";
      continue;
    }
    // 1. the form's flags
    let r = flagRight(item);
    // 2. the step: what it names for the field, else its default refined by the form's flags
    if (step) r = isRight(named[item.field]) ? named[item.field] : refined(item, dflt);
    // 3. the viewer's field groups
    if (f.group && groups && !groups.has(f.group)) r = "hidden";
    // 4. locks: never editable
    if (canEdit(r) && (locked.has(item.field) || f.locked || f.readonly || f.system)) r = "read";
    out[item.field] = r;
  }
  return out;
}

/** Fields of the rights a person may read / change. */
export const readableOf = (rights: Record<string, Right>): string[] => Object.keys(rights).filter((k) => canRead(rights[k]));
export const editableOf = (rights: Record<string, Right>): string[] => Object.keys(rights).filter((k) => canEdit(rights[k]));

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * The rights while values are entered: a field whose «نمایش وقتی…» does not hold is hidden — not shown, not asked for,
 * not taken. Conditions read only what the person may read (the values the form shows them), so every runtime answers
 * alike; a field that a condition hides counts as empty for the conditions of others. A condition that is not valid on
 * the form (it never is once saved) leaves its field shown.
 */
export function applyShowIf(form: FormLayoutV2, rights: Record<string, Right>, values: Record<string, unknown>, fields: FieldSource, env: CondEnv = {}): Record<string, Right> {
  const items = fieldItems(form).filter((i) => i.showIf && canRead(rights[i.field]));
  if (!items.length) return rights;
  const def = formValuesDef(form, fields);
  const valid = new Map(items.map((i) => [i.field, !validateCond(i.showIf, def)]));
  const out = { ...rights };
  for (let round = 0; round < 10; round++) {
    const seen: Record<string, unknown> = {};
    for (const [k, r] of Object.entries(out)) if (canRead(r) && !empty(values[k])) seen[k] = values[k];
    let changed = false;
    for (const i of items) {
      const shown = !valid.get(i.field) || evaluate(i.showIf, seen, env, def);
      const next: Right = shown ? rights[i.field] : "hidden";
      if (out[i.field] !== next) {
        out[i.field] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What a form shows

export interface ViewField {
  kind: "field";
  name: string;
  field: FieldDef;
  right: Right;
  span: Span;
  /** this form's label and help, else the field's */
  label: string;
  help?: string;
  showIf?: Cond;
}

export interface ViewNote {
  kind: "note";
  text: string;
  tone: "info" | "warning";
}

export interface FormView {
  tabs: { label: string; sections: { label: string | null; columns: 1 | 2; items: (ViewField | ViewNote)[] }[] }[];
}

const WIDE = new Set(["text", "markdown", "json"]);

/**
 * The form as a person sees it with these rights: hidden fields left out, and sections and tabs left with nothing to
 * show dropped. A field takes the item's width, else the whole row in a one-column section or for long text and files,
 * else half of it.
 */
export function formView(form: FormLayoutV2, rights: Record<string, Right>, fields: FieldSource): FormView {
  const get = fieldGetter(fields);
  const tabs: FormView["tabs"] = [];
  for (const t of form.tabs) {
    const sections: FormView["tabs"][number]["sections"] = [];
    for (const s of t.sections) {
      const columns = s.columns ?? 2;
      const items: (ViewField | ViewNote)[] = [];
      for (const i of s.items) {
        if (!isFieldItem(i)) {
          items.push({ kind: "note", text: i.text, tone: i.tone ?? "info" });
          continue;
        }
        const f = get(i.field);
        const right = rights[i.field];
        if (!f || !canRead(right)) continue;
        const v: ViewField = { kind: "field", name: i.field, field: f, right, span: i.span ?? (columns === 1 || WIDE.has(f.type) ? 24 : 12), label: i.label || f.label };
        const help = i.help || f.help;
        if (help) v.help = help;
        if (i.showIf) v.showIf = i.showIf;
        items.push(v);
      }
      if (items.some((x) => x.kind === "field") || (items.length && s.items.every((x) => !isFieldItem(x)))) sections.push({ label: s.label, columns, items });
    }
    if (sections.length) tabs.push({ label: t.label, sections });
  }
  return { tabs };
}
