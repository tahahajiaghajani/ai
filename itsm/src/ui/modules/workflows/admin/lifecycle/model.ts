// The pure logic of the lifecycle editor (design F §4.2–§4.4, §8.5, package F6): who reads and who changes a
// lifecycle, the draft (each state's label and colour; each transition's label, «اصلی», extra required fields, «فقط با
// نقش», condition and «خاموش») built from F1's GET /lifecycles/:table, the overlay a draft saves (only what differs from
// the module), what changed since the last save and what differs from the module's default («تفاوت با پیش‌فرض»), my
// changes put onto a lifecycle another administrator saved meanwhile, the problems F1's own validator finds (the same
// `lifecycleProblems` the server runs), the fields a transition may require and the preview: the states as the record
// page draws them and the buttons a record in one state offers.
// No React, no requests: tested in tests/workflows-hub-ui.test.ts.
import type { Cond } from "@shared/model/conditions";
import type { ColorKey, FieldDef, Option, TableDef } from "@shared/model/types";
import { STATE_CATEGORIES } from "@shared/model/types";
import { lifecycleProblems, type LifecycleOverlay, type TransitionOverlay } from "@shared/model/lifecycle";
import { faDigits } from "@shared/format";
import { SEP } from "../../../../lib/fa";
import { COLOR_LABELS } from "../../../../records/model/colors";
import { describeFilter } from "../../../../records/model/filter";
import { sameValue } from "../../../../records/model/values";
import type { AccessProbe } from "../fields/model";
import type { LifecycleTransition, LifecycleView } from "./api";

const fa = (n: number) => faDigits(n);

// ---------------------------------------------------------------------------------------------------------------
// Who may (F1: reading needs `settings` view, changing `settings` full — the membership level or the access grant)

export interface LifecycleAccess {
  read: boolean;
  write: boolean;
}

export function lifecycleAccess({ can, allows, writable }: AccessProbe): LifecycleAccess {
  const read = can("settings", "view") || allows({ area: "settings" });
  const full = can("settings", "full") || allows({ area: "settings", op: "admin" });
  return { read, write: writable && full };
}

/** F1's refusal to people below `settings` full: the page says it instead of offering the controls. */
export const LIFECYCLE_REFUSAL = "چرخهٔ عمر رکوردها را مدیر سازمان تغییر می‌دهد";

// ---------------------------------------------------------------------------------------------------------------
// The draft

export interface StateDraft {
  label: string;
  /** null: the module's colour */
  color: ColorKey | null;
}

export interface TransitionDraft {
  label: string;
  primary: boolean;
  needs: string[];
  also: string[];
  when: Cond | null;
  message: string;
  off: boolean;
}

export interface LifecycleDraft {
  states: Record<string, StateDraft>;
  transitions: Record<string, TransitionDraft>;
}

/** The draft of the lifecycle as it is now (the module's, with the organisation's overlay). */
export function draftOf(v: LifecycleView): LifecycleDraft {
  return {
    states: Object.fromEntries(v.states.map((s) => [s.value, { label: s.label, color: s.color === s.default_color ? null : s.color }])),
    transitions: Object.fromEntries(
      v.transitions.map((t) => [t.key, { label: t.label, primary: t.primary, needs: [...t.needs], also: [...t.also], when: t.when ?? null, message: t.message ?? "", off: t.off && t.optional }]),
    ),
  };
}

/** The module's own lifecycle, as a draft (what «بازگشت به پیش‌فرض» brings back). */
export function defaultDraft(v: LifecycleView): LifecycleDraft {
  return {
    states: Object.fromEntries(v.states.map((s) => [s.value, { label: s.default_label, color: null }])),
    transitions: Object.fromEntries(v.transitions.map((t) => [t.key, { label: t.default_label, primary: false, needs: [], also: [], when: null, message: "", off: false }])),
  };
}

/** One transition the primary one: choosing it clears the others («اصلی» is one per table); choosing it again clears it. */
export function setPrimary(d: LifecycleDraft, key: string): LifecycleDraft {
  const was = d.transitions[key]?.primary;
  return {
    ...d,
    transitions: Object.fromEntries(Object.entries(d.transitions).map(([k, t]) => [k, { ...t, primary: k === key ? !was : false }])),
  };
}

/** A change to one transition's draft. */
export function setTransition(d: LifecycleDraft, key: string, patch: Partial<TransitionDraft>): LifecycleDraft {
  const t = d.transitions[key];
  if (!t) return d;
  return { ...d, transitions: { ...d.transitions, [key]: { ...t, ...patch } } };
}

/** A change to one state's draft. */
export function setState(d: LifecycleDraft, value: string, patch: Partial<StateDraft>): LifecycleDraft {
  const s = d.states[value];
  if (!s) return d;
  return { ...d, states: { ...d.states, [value]: { ...s, ...patch } } };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The overlay a draft saves: only what differs from the module (a label equal to the module's is no change); in a
 * lifecycle a module configures elsewhere, labels, colours and the primary transition only. Null: nothing to keep.
 */
export function overlayOf(v: LifecycleView, d: LifecycleDraft): LifecycleOverlay | null {
  const states: NonNullable<LifecycleOverlay["states"]> = {};
  for (const s of v.states) {
    const x = d.states[s.value];
    if (!x) continue;
    const label = clean(x.label);
    const o: { label?: string; color?: ColorKey } = {};
    if (label && label !== s.default_label) o.label = label;
    if (x.color && x.color !== s.default_color) o.color = x.color;
    if (o.label || o.color) states[s.value] = o;
  }
  const transitions: TransitionOverlay[] = [];
  for (const t of v.transitions) {
    const x = d.transitions[t.key];
    if (!x) continue;
    const o: TransitionOverlay = { key: t.key };
    const label = clean(x.label);
    if (label && label !== t.default_label) o.label = label;
    if (x.primary) o.primary = true;
    if (!v.labels_only) {
      if (x.needs.length) o.requires = [...x.needs];
      if (x.also.length) o.also = [...x.also];
      if (x.when) {
        o.when = x.when;
        const message = clean(x.message);
        if (message) o.message = message;
      }
      if (x.off && t.optional) o.off = true;
    }
    if (Object.keys(o).length > 1) transitions.push(o);
  }
  const out: LifecycleOverlay = {};
  if (Object.keys(states).length) out.states = states;
  if (transitions.length) out.transitions = transitions;
  return out.states || out.transitions ? out : null;
}

/** Does the draft save anything other than what is stored? */
export const isDirty = (v: LifecycleView, d: LifecycleDraft): boolean => !sameValue(overlayOf(v, draftOf(v)), overlayOf(v, d));

/** Is the draft the module's own lifecycle (nothing for the organisation to keep)? */
export const isDefault = (v: LifecycleView, d: LifecycleDraft): boolean => overlayOf(v, d) === null;

/** Has the stored lifecycle changed since the page read it (another administrator saved)? */
export const overlayMoved = (seen: LifecycleView, now: LifecycleView): boolean => !sameValue(seen.overlay ?? null, now.overlay ?? null);

/**
 * My changes put onto the lifecycle as it is stored now. `seen` is what the page read, `mine` its draft, `now` what
 * another administrator has saved since: what I changed — line by line, as «ذخیرهٔ تغییرها» lists it: a state's label
 * or colour; a transition's label, required fields, roles, condition with its message, «خاموش»; the one «اصلی» — goes
 * onto `now`'s draft; what I left alone keeps their newer value. Saving the whole overlay from `mine` instead would
 * write back what they changed.
 */
export function rebaseDraft(seen: LifecycleView, mine: LifecycleDraft, now: LifecycleView): LifecycleDraft {
  const base = draftOf(seen);
  const out = draftOf(now);
  const differs = (a: unknown, b: unknown) => !sameValue(a, b);
  const sorted = (xs: readonly string[]) => [...xs].sort();
  for (const [value, s] of Object.entries(out.states)) {
    const was = base.states[value];
    const me = mine.states[value];
    if (!was || !me) continue;
    out.states[value] = {
      label: clean(me.label) !== clean(was.label) ? me.label : s.label,
      color: (me.color ?? null) !== (was.color ?? null) ? me.color : s.color,
    };
  }
  for (const [key, t] of Object.entries(out.transitions)) {
    const was = base.transitions[key];
    const me = mine.transitions[key];
    if (!was || !me) continue;
    const cond = differs(me.when, was.when) || clean(me.message) !== clean(was.message);
    out.transitions[key] = {
      ...t,
      label: clean(me.label) !== clean(was.label) ? me.label : t.label,
      needs: differs(sorted(me.needs), sorted(was.needs)) ? [...me.needs] : t.needs,
      also: differs(sorted(me.also), sorted(was.also)) ? [...me.also] : t.also,
      when: cond ? me.when : t.when,
      message: cond ? me.message : t.message,
      off: me.off !== was.off ? me.off : t.off,
    };
  }
  // «اصلی» is one per table: mine when I chose another (or none), else theirs
  const primaryOf = (d: LifecycleDraft) => Object.entries(d.transitions).find(([, t]) => t.primary)?.[0] ?? null;
  const chosen = primaryOf(mine);
  if (chosen !== primaryOf(base)) for (const [key, t] of Object.entries(out.transitions)) out.transitions[key] = { ...t, primary: key === chosen };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Problems (the server's own validator, on the effective definition)

export interface ProblemEnv {
  /** the module's definition (the registry's) */
  base: TableDef;
  /** the organisation's definition (its custom fields, «پنهان در فرم»), else the module's */
  def: TableDef;
  /** the roles the organisation has (null: unknown — the server checks them) */
  roles: ReadonlySet<string> | null;
}

/** Why the draft cannot be saved: F1's own reasons, in Persian (empty when it can). */
export function draftProblems(v: LifecycleView, d: LifecycleDraft, env: ProblemEnv): string[] {
  const field = (n: string): FieldDef | undefined => env.def.fields.find((f) => f.name === n);
  return lifecycleProblems(env.base, overlayOf(v, d), {
    field,
    formHidden: (n) => !!field(n)?.formHidden,
    roleExists: (k) => !env.roles || env.roles.has(k),
    labelsOnly: v.labels_only,
    def: env.def,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Words

/** A state's label in the draft (the module's when the draft's is empty). */
export function stateLabel(v: LifecycleView, d: LifecycleDraft, value: string): string {
  const s = v.states.find((x) => x.value === value);
  return clean(d.states[value]?.label ?? "") || s?.default_label || value;
}

/** «جدید، در انتظار ← در جریان»: where a transition goes from and to, with the draft's labels. */
export function transitionPath(v: LifecycleView, d: LifecycleDraft, t: Pick<LifecycleTransition, "from" | "to">): string {
  const from = t.from === "*" ? "هر وضعیت" : t.from.map((x) => stateLabel(v, d, x)).join(SEP);
  return `${from} ← ${stateLabel(v, d, t.to)}`;
}

/** A transition's label in the draft. */
export function transitionLabel(v: LifecycleView, d: LifecycleDraft, key: string): string {
  const t = v.transitions.find((x) => x.key === key);
  return clean(d.transitions[key]?.label ?? "") || t?.default_label || key;
}

export const categoryLabel = (c: keyof typeof STATE_CATEGORIES) => STATE_CATEGORIES[c]?.label ?? c;

export interface DiffLine {
  what: string;
  from: string;
  to: string;
}

export interface DiffNames {
  field: (name: string) => string;
  role: (key: string) => string;
  /** a condition in words */
  cond: (c: Cond) => string;
}

const list = (xs: readonly string[], name: (x: string) => string, none: string) => (xs.length ? xs.map(name).join(SEP) : none);
const colorText = (c: ColorKey | null | undefined) => (c ? COLOR_LABELS[c] : "رنگ ماژول");

/**
 * What differs between two drafts, line by line («برچسب وضعیت «جدید»: تازه ← نو»…). Against the module's own draft it
 * is «تفاوت با پیش‌فرض»; against the stored draft, what «ذخیرهٔ تغییرها» sends.
 */
export function draftDiff(v: LifecycleView, a: LifecycleDraft, b: LifecycleDraft, names: DiffNames): DiffLine[] {
  const out: DiffLine[] = [];
  for (const s of v.states) {
    const x = a.states[s.value];
    const y = b.states[s.value];
    if (!x || !y) continue;
    const lx = clean(x.label) || s.default_label;
    const ly = clean(y.label) || s.default_label;
    if (lx !== ly) out.push({ what: `برچسب وضعیت «${s.default_label}»`, from: lx, to: ly });
    if ((x.color ?? s.default_color) !== (y.color ?? s.default_color)) out.push({ what: `رنگ «${ly}»`, from: colorText(x.color ?? s.default_color), to: colorText(y.color ?? s.default_color) });
  }
  const primaryOf = (d: LifecycleDraft) => v.transitions.find((t) => d.transitions[t.key]?.primary);
  const pa = primaryOf(a);
  const pb = primaryOf(b);
  if (pa?.key !== pb?.key) out.push({ what: "انتقال اصلی", from: pa ? transitionLabel(v, a, pa.key) : "هیچ", to: pb ? transitionLabel(v, b, pb.key) : "هیچ" });
  for (const t of v.transitions) {
    const x = a.transitions[t.key];
    const y = b.transitions[t.key];
    if (!x || !y) continue;
    const title = `«${transitionLabel(v, b, t.key)}» (${transitionPath(v, b, t)})`;
    const lx = clean(x.label) || t.default_label;
    const ly = clean(y.label) || t.default_label;
    if (lx !== ly) out.push({ what: `برچسب انتقال ${transitionPath(v, b, t)}`, from: lx, to: ly });
    if (v.labels_only) continue;
    if (!sameValue([...x.needs].sort(), [...y.needs].sort())) out.push({ what: `فیلدهای لازم ${title}`, from: list(x.needs, names.field, "هیچ"), to: list(y.needs, names.field, "هیچ") });
    if (!sameValue([...x.also].sort(), [...y.also].sort())) out.push({ what: `فقط با نقش ${title}`, from: list(x.also, names.role, "بدون شرط نقش"), to: list(y.also, names.role, "بدون شرط نقش") });
    if (!sameValue(x.when, y.when) || clean(x.message) !== clean(y.message)) out.push({ what: `شرط ${title}`, from: x.when ? names.cond(x.when) : "بدون شرط", to: y.when ? names.cond(y.when) : "بدون شرط" });
    if (t.optional && x.off !== y.off) out.push({ what: title, from: x.off ? "خاموش" : "روشن", to: y.off ? "خاموش" : "روشن" });
  }
  return out;
}

/** A condition in words, on the table's own fields. */
export const condText = (c: Cond, def: TableDef, choices: Record<string, Option[]> = {}) => describeFilter(c, def, { choices }) || "شرط";

// ---------------------------------------------------------------------------------------------------------------
// Fields a transition may require, and the preview

export interface RequirableField {
  name: string;
  label: string;
  /** why it cannot be asked for (in the form's eyes) */
  blocked: string | null;
}

/**
 * The fields people can be asked to fill before a transition (F1's rule): the table's own fields that people fill —
 * not base, system, read-only or module-internal ones, not the state itself; a form-hidden field is listed, blocked.
 */
export function requirableFields(def: TableDef): RequirableField[] {
  return def.fields
    .filter((f) => !f.base && !f.system && !f.readonly && !f.hidden && f.name !== def.states?.field)
    .map((f) => ({ name: f.name, label: f.label, blocked: f.formHidden ? "در فرم پنهان است؛ نخست آن را در فرم نشان دهید" : null }));
}

export interface ChannelState {
  value: string;
  label: string;
  color: ColorKey | null;
  category: string;
}

/** The states as the record page draws them (the draft's labels and colours; the module's colour when unchanged). */
export function channel(v: LifecycleView, d: LifecycleDraft): ChannelState[] {
  return v.states.map((s) => ({ value: s.value, label: stateLabel(v, d, s.value), color: d.states[s.value]?.color ?? s.default_color, category: categoryLabel(s.category) }));
}

export interface PreviewButton {
  key: string;
  label: string;
  primary: boolean;
}

/** How many transitions the record page shows as buttons (the rest are in «بیشتر»). */
export const VISIBLE_BUTTONS = 3;

/**
 * The transitions a record in `state` offers, in the module's order as the record page lists them (a transition
 * switched off is gone; who may take one is decided per person and record, so all are shown).
 */
export function previewButtons(v: LifecycleView, d: LifecycleDraft, state: string): PreviewButton[] {
  return v.transitions
    .filter((t) => t.to !== state && (t.from === "*" || t.from.includes(state)) && !(t.optional && d.transitions[t.key]?.off))
    .map((t) => ({ key: t.key, label: transitionLabel(v, d, t.key), primary: !!d.transitions[t.key]?.primary }));
}

/** The editor's count line under the title. */
export function summaryText(v: LifecycleView, changes: number): string {
  const base = `${fa(v.states.length)} وضعیت${SEP}${fa(v.transitions.length)} انتقال`;
  return changes ? `${base}${SEP}${fa(changes)} تفاوت با پیش‌فرض` : base;
}

/** The chip of what may change here. */
export const scopeChip = (v: Pick<LifecycleView, "labels_only">) => (v.labels_only ? "فقط برچسب، رنگ و انتقال اصلی" : "سامانه‌ای — تغییرهای امن");
