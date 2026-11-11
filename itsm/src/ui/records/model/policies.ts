// What each field of a form is right now — hidden, required, read-only, waiting for its parent — from the table
// definition, the record's `meta` (what the caller may change, a locked state) and UI policies: conditions on the
// form's current values (evaluated live with the engine's `evaluate`) that show, hide, require or lock fields and
// show a note. Policies come from modules (`registerRecordExtensions(table, { policies })`) and, once the platform
// stores them, from the organisation (`ui_policy`); the server re-checks mandatory and read-only on every write.
// Pure: no React, no antd.
import type { Cond, CondEnv, Lookup } from "@shared/model/conditions";
import { evaluate } from "@shared/model/conditions";
import type { FieldDef, TableDef } from "@shared/model/types";
import { fieldOf, isEmptyValue } from "./schema";

export interface UiPolicyAction {
  field: string;
  visible?: boolean;
  mandatory?: boolean;
  readonly?: boolean;
}

export interface UiPolicy {
  key?: string;
  /** when the policy applies, on the form's current values; empty = always */
  when?: Cond | null;
  actions: UiPolicyAction[];
  /** a note above the form while the policy applies */
  message?: string;
  tone?: "info" | "warning";
  /** lower first; a later policy wins on the same field and property */
  order?: number;
  /** new records only, existing ones only, or both (default) */
  on?: "create" | "update" | "both";
}

export interface FormMessage {
  key: string;
  text: string;
  tone: "info" | "warning";
}

export interface FormState {
  hidden: Set<string>;
  required: Set<string>;
  readonly: Set<string>;
  /** dependent fields whose parent is still empty → the parent's label («اول «دسته» را انتخاب کنید») */
  waiting: Map<string, string>;
  messages: FormMessage[];
}

export interface FormContext {
  mode: "create" | "update";
  /** the caller may change the record (meta.canWrite; on create, the table's can.create) */
  canWrite: boolean;
  /** the record is in a locked state (only transitions out of it) */
  locked?: boolean;
  /** fields the caller may not change on this record (meta.readonly) */
  readonly?: readonly string[];
  env?: CondEnv;
  lookup?: Lookup;
}

/** Fields the engine maintains: shown read-only, left off a new record's form. */
export const isEngineField = (f: FieldDef): boolean => !!(f.system || f.base);

/**
 * Whether a person can enter anything in a new record of the table: a field that is not the engine's, not read-only
 * and not hidden. Tables the system writes (license reconciliation runs, caller verifications, policy
 * acknowledgements…) have none: their lists offer no «… تازه» (its form had nothing to fill and «ثبت» was refused).
 */
export const enterableOnCreate = (def: Pick<TableDef, "fields">): boolean => def.fields.some((f) => !isEngineField(f) && !f.readonly && !f.hidden);

/** The state of every field of `def` for `row` under `policies`. */
export function formState(def: TableDef, row: Record<string, unknown>, policies: readonly UiPolicy[], ctx: FormContext): FormState {
  const hidden = new Set<string>();
  const required = new Set<string>();
  const readonly = new Set<string>();
  /** read-only whatever a policy says (the server would refuse the change) */
  const hard = new Set<string>();
  const waiting = new Map<string, string>();
  const meta = new Set(ctx.readonly ?? []);
  const creating = ctx.mode === "create";

  for (const f of def.fields) {
    if (f.hidden || (creating && isEngineField(f))) hidden.add(f.name);
    if (f.system || f.base || f.readonly || meta.has(f.name) || !ctx.canWrite || (ctx.locked && !creating)) hard.add(f.name);
    if (f.required && !f.system && !f.readonly) required.add(f.name);
    if (f.dependsOn && isEmptyValue(row[f.dependsOn]) && isEmptyValue(row[f.name])) {
      const parent = fieldOf(def, f.dependsOn);
      waiting.set(f.name, parent?.label ?? f.dependsOn);
    }
  }
  for (const n of hard) readonly.add(n);

  const messages: FormMessage[] = [];
  const ordered = policies.map((p, i) => ({ p, i })).sort((a, b) => (a.p.order ?? 0) - (b.p.order ?? 0) || a.i - b.i);
  for (const { p, i } of ordered) {
    const on = p.on ?? "both";
    if (on !== "both" && on !== ctx.mode) continue;
    let applies = false;
    try {
      applies = evaluate(p.when ?? null, row, ctx.env ?? {}, def, ctx.lookup);
    } catch {
      applies = false;
    }
    if (!applies) continue;
    for (const a of p.actions) {
      if (!fieldOf(def, a.field)) continue;
      if (a.visible === false) hidden.add(a.field);
      if (a.visible === true) hidden.delete(a.field);
      if (a.mandatory === true) {
        required.add(a.field);
        hidden.delete(a.field);
      }
      if (a.mandatory === false) required.delete(a.field);
      if (a.readonly === true) readonly.add(a.field);
      if (a.readonly === false && !hard.has(a.field)) readonly.delete(a.field);
    }
    if (p.message) messages.push({ key: p.key ?? `policy-${i}`, text: p.message, tone: p.tone ?? "info" });
  }

  // a required field is never hidden; one nobody can fill is not asked for
  for (const n of required) {
    hidden.delete(n);
    if (readonly.has(n)) required.delete(n);
  }
  return { hidden, required, readonly, waiting, messages };
}

/** Required fields still empty on `row` (what blocks a save before the server is asked). */
export function missingRequired(def: TableDef, row: Record<string, unknown>, state: FormState): FieldDef[] {
  return def.fields.filter((f) => state.required.has(f.name) && !state.hidden.has(f.name) && isEmptyValue(row[f.name]));
}

/** Fields a transition requires that `row` (with `data` applied) leaves empty. */
export function transitionMissing(def: TableDef, requires: readonly string[], row: Record<string, unknown>, data: Record<string, unknown> = {}): FieldDef[] {
  const valueOf = (name: string) => (name in data ? data[name] : row[name]);
  return requires.map((name) => fieldOf(def, name)).filter((f): f is FieldDef => !!f && isEmptyValue(valueOf(f.name)));
}

/** The client-side environment of conditions: who is asking, the organisation's zone and clock. */
export function clientEnv(userId: string | null | undefined, tz: string, extra: Partial<CondEnv> = {}): CondEnv {
  return { userId: userId ?? null, tz, now: Date.now(), ...extra };
}
