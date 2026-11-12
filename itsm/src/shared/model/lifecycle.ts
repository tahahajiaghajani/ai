// The lifecycle overlay of a table (design F §4.2, package F1): an organisation's safe changes to a module's state
// model, stored as ONE `custom_field` row named `_states` (like the form's `_form` row) whose `options` hold
//
//   { states: { <value>: { label?, color? } },
//     transitions: [{ key: "<from>><to>", label?, primary?, requires?, also?, when?, message?, off? }] }
//
// The engine merges it into the table's effective definition (src/server/engine/schema.ts `mergeLifecycle`), so every
// path sees the labels, the colours and the primary transition; `off` removes a transition the module marks
// `optional` (the API, Windows pushes and the UI all lose it, and never the only way out of a state); `also` narrows
// who may take a transition (`canTransitionRow`: one of these roles as well as the module's rule); the organisation's
// `requires` (`needs` on the merged transition) and `when` bind people's writes only (F1's `*` validateTransition
// hook, on the API and the push path alike; the record page greys a blocked transition out with `transitionBlocked`).
// What module code depends on never changes: state values and categories, `from` and `to`, guards, the module's own
// `requires` and `roles`. Tables whose lifecycle a module configures elsewhere (change models) take labels, colours and
// the primary transition only (`labelsOnly`).
// Imported by the UI: keep it free of server imports.
import type { ColorKey, FieldDef, StateModel, TableDef, Transition } from "./types";
import { COLOR_KEYS } from "./types";
import type { Cond, CondEnv, Lookup } from "./conditions";
import { condPaths, evaluate, validateCond } from "./conditions";

/** `custom_field.name` of the lifecycle overlay row (never a field name: those are `[a-z]…` or `u_…`). */
export const STATES_ROW = "_states";

/**
 * Tables whose lifecycle a module configures elsewhere in full (design F §4.3): the change models set the stages,
 * required and locked fields per change type, so the overlay offers labels, colours and the primary transition only.
 */
export const LABELS_ONLY_LIFECYCLES: ReadonlySet<string> = new Set(["change_request"]);

export interface StateOverlay {
  label?: string;
  color?: ColorKey;
}

export interface TransitionOverlay {
  /** the module transition it changes (`transitionKey`) */
  key: string;
  label?: string;
  /** the record page's main button (one per table) */
  primary?: boolean;
  /** fields people must fill to take it (beside the module's `requires`) */
  requires?: string[];
  /** narrowing: the caller must also hold one of these roles */
  also?: string[];
  /** a condition on the record's own fields that must hold for people, and the message when it does not */
  when?: Cond;
  message?: string;
  /** switched off (only a transition the module marks `optional`) */
  off?: boolean;
}

export interface LifecycleOverlay {
  states?: Record<string, StateOverlay>;
  transitions?: TransitionOverlay[];
}

/** A transition of an effective definition: the module's, with the organisation's overlay merged in. */
export interface EffectiveTransition extends Transition {
  /** the organisation's primary transition */
  primary?: boolean;
  /** the organisation's extra fields: people's writes only (never the system's or trusted ones) */
  needs?: string[];
  /** the organisation's condition: people's writes only */
  when?: Cond;
  whenMessage?: string;
}

/** The stable name of a module transition: its sources and its target («new,on_hold>in_progress», «*>canceled»). */
export function transitionKey(t: Pick<Transition, "from" | "to">): string {
  return `${t.from === "*" ? "*" : [...t.from].sort().join(",")}>${t.to}`;
}

const MAX_LABEL = 60;
const MAX_MESSAGE = 200;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const ROLE_KEY = /^[a-z][a-z0-9_]{1,40}$/;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const names = (v: unknown, re: RegExp): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && re.test(x)))].slice(0, 40) : []);

/** A clean overlay from stored JSON (an object or its text); null when nothing usable is left. Never throws. */
export function cleanLifecycle(raw: unknown): LifecycleOverlay | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const x = o as { states?: unknown; transitions?: unknown };
  const out: LifecycleOverlay = {};
  if (x.states && typeof x.states === "object" && !Array.isArray(x.states)) {
    const states: Record<string, StateOverlay> = {};
    for (const [value, s] of Object.entries(x.states as Record<string, unknown>).slice(0, 100)) {
      if (!s || typeof s !== "object" || Array.isArray(s)) continue;
      const so = s as { label?: unknown; color?: unknown };
      const st: StateOverlay = {};
      const label = text(so.label, MAX_LABEL);
      if (label) st.label = label;
      if (typeof so.color === "string" && (COLOR_KEYS as readonly string[]).includes(so.color)) st.color = so.color as ColorKey;
      if (st.label || st.color) states[value] = st;
    }
    if (Object.keys(states).length) out.states = states;
  }
  if (Array.isArray(x.transitions)) {
    const seen = new Set<string>();
    const ts: TransitionOverlay[] = [];
    for (const t of x.transitions.slice(0, 200)) {
      if (!t || typeof t !== "object" || Array.isArray(t)) continue;
      const to = t as Record<string, unknown>;
      const key = typeof to.key === "string" ? to.key.trim() : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const ov: TransitionOverlay = { key };
      const label = text(to.label, MAX_LABEL);
      if (label) ov.label = label;
      if (to.primary === true) ov.primary = true;
      const requires = names(to.requires, FIELD_NAME);
      if (requires.length) ov.requires = requires;
      const also = names(to.also, ROLE_KEY);
      if (also.length) ov.also = also;
      if (to.when && typeof to.when === "object" && !Array.isArray(to.when)) ov.when = to.when as Cond;
      const message = text(to.message, MAX_MESSAGE);
      if (message && ov.when) ov.message = message;
      if (to.off === true) ov.off = true;
      if (Object.keys(ov).length > 1) ts.push(ov);
    }
    if (ts.length) out.transitions = ts;
  }
  return out.states || out.transitions ? out : null;
}

/**
 * Would switching off the transitions in `off` leave one of their source states without a way out? Returns the
 * states that would be stranded (none = the switch is safe).
 */
export function strandedStates(model: StateModel, off: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const s of model.states) {
    const exits = model.transitions.filter((t) => t.to !== s.value && (t.from === "*" || t.from.includes(s.value)));
    if (!exits.length) continue;
    if (exits.every((t) => off.has(transitionKey(t)))) out.push(s.value);
  }
  return out;
}

/**
 * The module's state model with the organisation's overlay merged in (a new object; the registry's is never touched).
 * `labelsOnly`: labels, colours and the primary transition only (a lifecycle a module configures elsewhere).
 */
export function mergeLifecycle(model: StateModel, overlay: LifecycleOverlay | null | undefined, opts: { labelsOnly?: boolean } = {}): StateModel {
  if (!overlay) return model;
  const states = model.states.map((s) => {
    const o = overlay.states?.[s.value];
    return o ? { ...s, ...(o.label ? { label: o.label } : {}), ...(o.color ? { color: o.color } : {}) } : s;
  });
  const byKey = new Map((overlay.transitions ?? []).map((t) => [t.key, t]));
  let primary = false;
  const off = new Set<string>();
  const transitions = model.transitions.map((t) => {
    const key = transitionKey(t);
    const o = byKey.get(key);
    if (!o) return t;
    const m: EffectiveTransition = { ...t };
    if (o.label) m.label = o.label;
    if (o.primary && !primary) {
      m.primary = true;
      primary = true;
    }
    if (!opts.labelsOnly) {
      if (o.requires?.length) m.needs = [...o.requires];
      // narrowing only: `canTransitionRow` asks it on top of the module's `roles` (modules never set `also`)
      if (o.also?.length) m.also = [...o.also];
      if (o.when) {
        m.when = o.when;
        if (o.message) m.whenMessage = o.message;
      }
      if (o.off && t.optional) off.add(key);
    }
    return m;
  });
  // never the only way out of a state: switches that would strand a state are ignored here (and refused when saved)
  for (const key of [...off]) if (strandedStates(model, off).length) off.delete(key);
  return { ...model, states, transitions: off.size ? transitions.filter((t) => !off.has(transitionKey(t))) : transitions };
}

/**
 * The organisation's fields and conditions of a merged model that no longer fit the table `def` (its effective
 * definition): a needed field that is not on it any more is not asked, and a condition that does not validate against
 * it is dropped — nobody is held to a field that cannot be filled. The server refuses taking such a field off a table
 * while the overlay names it; this keeps a stored overlay harmless whatever happened since (a model without either
 * comes back as it is).
 */
export function pruneLifecycle(model: StateModel, def: TableDef): StateModel {
  let changed = false;
  const has = (n: string) => def.fields.some((f) => f.name === n);
  const transitions = model.transitions.map((t) => {
    const x = t as EffectiveTransition;
    if (!x.needs && !x.when) return t;
    const m: EffectiveTransition = { ...x };
    if (m.needs) {
      const kept = m.needs.filter(has);
      if (kept.length !== m.needs.length) {
        changed = true;
        if (kept.length) m.needs = kept;
        else delete m.needs;
      }
    }
    if (m.when && validateCond(m.when, def)) {
      changed = true;
      delete m.when;
      delete m.whenMessage;
    }
    return m;
  });
  return changed ? { ...model, transitions } : model;
}

/** What the lifecycle editor and the server need to judge an overlay. */
export interface LifecycleEnv {
  /** a field of the table as the organisation sees it (custom fields included), or undefined */
  field(name: string): FieldDef | undefined;
  /** is the field hidden from the form (`formHidden`)? */
  formHidden(name: string): boolean;
  /** does an access role of this key exist in the organisation? */
  roleExists(key: string): boolean;
  /** labels, colours and the primary transition only */
  labelsOnly?: boolean;
  /** the organisation's effective definition (conditions may name its own fields, custom ones included) */
  def?: TableDef;
  /** how conditions read dot-walks (unused: a condition names the record's own fields) */
  lookup?: Lookup;
}

/** Why an overlay cannot be saved for `def` (the module's definition from the registry): Persian reasons, empty when it can. */
export function lifecycleProblems(def: TableDef, raw: unknown, env: LifecycleEnv): string[] {
  const model = def.states;
  if (!model) return [`«${def.plural}» چرخهٔ وضعیت ندارد`];
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) return ["تنظیمات چرخهٔ عمر معتبر نیست"];
  const problems: string[] = [];
  const x = raw as { states?: unknown; transitions?: unknown };
  if (x.states !== undefined && x.states !== null) {
    if (typeof x.states !== "object" || Array.isArray(x.states)) problems.push("وضعیت‌ها معتبر نیستند");
    else
      for (const [value, s] of Object.entries(x.states as Record<string, unknown>)) {
        if (!model.states.some((st) => st.value === value)) {
          problems.push(`وضعیت «${value}» در «${def.plural}» نیست؛ وضعیت‌ها را ماژول تعیین می‌کند`);
          continue;
        }
        const so = (s ?? {}) as { label?: unknown; color?: unknown };
        if (so.label !== undefined && so.label !== null && (typeof so.label !== "string" || so.label.trim().length > MAX_LABEL)) problems.push(`برچسب وضعیت «${value}» حداکثر ${MAX_LABEL} نویسه است`);
        if (so.color !== undefined && so.color !== null && !(COLOR_KEYS as readonly unknown[]).includes(so.color)) problems.push(`رنگ وضعیت «${value}» معتبر نیست`);
      }
  }
  if (x.transitions !== undefined && x.transitions !== null) {
    if (!Array.isArray(x.transitions)) return [...problems, "انتقال‌ها معتبر نیستند"];
    const byKey = new Map(model.transitions.map((t) => [transitionKey(t), t]));
    const off = new Set<string>();
    let primaries = 0;
    for (const raw of x.transitions as unknown[]) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const t = typeof o.key === "string" ? byKey.get(o.key) : undefined;
      if (!t) {
        problems.push(`انتقال «${String(o.key ?? "")}» در «${def.plural}» نیست؛ انتقال‌ها را ماژول تعیین می‌کند`);
        continue;
      }
      if (o.label !== undefined && o.label !== null && (typeof o.label !== "string" || o.label.trim().length > MAX_LABEL)) problems.push(`برچسب «${t.label}» حداکثر ${MAX_LABEL} نویسه است`);
      if (o.primary === true) primaries++;
      const extra = (["requires", "also", "when", "off"] as const).filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== false && !(Array.isArray(o[k]) && !(o[k] as unknown[]).length));
      if (env.labelsOnly && extra.length) {
        problems.push(`در «${def.plural}» فقط برچسب، رنگ و انتقال اصلی تغییر می‌کند؛ مرحله‌ها و الزام‌ها جای دیگری تنظیم می‌شوند`);
        continue;
      }
      if (Array.isArray(o.requires)) {
        for (const n of o.requires) {
          const f = typeof n === "string" ? env.field(n) : undefined;
          if (!f || f.base || f.system || f.readonly || f.hidden) problems.push(`فیلد «${String(n)}» برای «${t.label}» لازم نمی‌شود: در «${def.plural}» نیست یا پر کردنی نیست`);
          else if (env.formHidden(f.name)) problems.push(`«${f.label}» در فرم پنهان است و برای «${t.label}» لازم نمی‌شود؛ نخست آن را در فرم نشان دهید`);
        }
      } else if (o.requires !== undefined && o.requires !== null) problems.push(`فیلدهای لازم «${t.label}» باید فهرست باشند`);
      if (Array.isArray(o.also)) {
        for (const r of o.also) if (typeof r !== "string" || !env.roleExists(r)) problems.push(`نقش «${String(r)}» برای «${t.label}» وجود ندارد`);
      } else if (o.also !== undefined && o.also !== null) problems.push(`نقش‌های «${t.label}» باید فهرست باشند`);
      if (o.when !== undefined && o.when !== null) {
        const p = validateCond(o.when, env.def ?? def, { lookup: env.lookup });
        if (p) problems.push(`شرط «${t.label}»: ${p}`);
        else if ([...condPaths(o.when as Cond)].some((path) => path.includes("."))) problems.push(`شرط «${t.label}» فقط فیلدهای خود رکورد را می‌سنجد`);
        if (o.message !== undefined && o.message !== null && (typeof o.message !== "string" || o.message.trim().length > MAX_MESSAGE)) problems.push(`پیام شرط «${t.label}» حداکثر ${MAX_MESSAGE} نویسه است`);
      }
      if (o.off === true) {
        if (!t.optional) problems.push(`«${t.label}» را ماژول به کار می‌برد و خاموش نمی‌شود`);
        else off.add(transitionKey(t));
      }
    }
    if (primaries > 1) problems.push("فقط یک انتقال اصلی ممکن است");
    const stranded = strandedStates(model, off);
    if (stranded.length) {
      const label = (v: string) => model.states.find((s) => s.value === v)?.label ?? v;
      problems.push(`با خاموش شدن این انتقال‌ها، از «${stranded.map(label).join("»، «")}» راهی به بیرون نمی‌ماند`);
    }
  }
  return problems;
}

/**
 * Why people may not take the transition now (its organisation condition `when` does not hold on `row`), or null. The
 * server asks it of people's writes; the record page greys the transition out with the same message.
 */
export function transitionBlocked(t: Transition, row: Record<string, unknown>, env: CondEnv = {}, def?: TableDef, lookup?: Lookup): string | null {
  const x = t as EffectiveTransition;
  if (!x.when || evaluate(x.when, row, env, def, lookup)) return null;
  return x.whenMessage || `«${t.label}» اکنون ممکن نیست`;
}

/** The organisation's extra fields of a transition that are still empty on `row` (people's writes). */
export function missingNeeds(t: Transition, row: Record<string, unknown>): string[] {
  const x = t as EffectiveTransition;
  return (x.needs ?? []).filter((n) => {
    const v = row[n];
    return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  });
}
