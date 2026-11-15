// Locked fields of a built-in table (design F §3.3): the fields module code depends on. An organisation may relabel
// them and give them help, but never hide them from the form or make them required in its own name — the server
// refuses `form_hidden` and `required` on them with the reason (`lockRefusal`), so the UI is not the only guard, and
// the field manager shows each reason as a chip.
// Always ask about the module's definition from the registry (`tableDef(key)`), never an organisation's effective one:
// a tenant requirement must not lock a field, and organisation fields (u_*) are never locked.
// Imported by the UI: keep it free of server imports.
import type { TableDef } from "../model/types";

export type LockReason = "system" | "identity" | "access" | "transition" | "required" | "ai" | "module";

/** The chip of each reason, in the order they are checked. */
export const LOCK_REASONS: Record<LockReason, string> = {
  system: "سامانه‌ای",
  identity: "شناسهٔ رکورد",
  access: "پایهٔ دسترسی",
  transition: "لازم برای تغییر وضعیت",
  required: "الزامی در ماژول",
  ai: "پایهٔ جست‌وجوی هوشمند",
  module: "قفل‌شده در ماژول",
};

export interface FieldLock {
  reason: LockReason;
  label: string;
}

const lock = (reason: LockReason): FieldLock => ({ reason, label: LOCK_REASONS[reason] });

/** The scope columns the access model reads (`TableDef.scope`): own, group, unit, requester, readers and parent. */
function accessFields(def: TableDef): string[] {
  const s = def.scope ?? {};
  return [...(s.own ?? []), s.group, s.unit ?? "unit_id", ...(s.requester ?? []), ...(s.readers ?? []), s.parent].filter((x): x is string => !!x);
}

/** Locked fields of a table, by name, with every reason that locks each (organisation fields are never locked). */
export function lockedFields(def: TableDef): Record<string, FieldLock[]> {
  const out: Record<string, FieldLock[]> = {};
  const names = new Set(def.fields.filter((f) => !f.custom).map((f) => f.name));
  const add = (name: string | undefined, reason: LockReason) => {
    if (!name || !names.has(name)) return;
    const list = (out[name] ??= []);
    if (!list.some((l) => l.reason === reason)) list.push(lock(reason));
  };
  for (const f of def.fields) if (!f.custom && (f.base || f.system)) add(f.name, "system");
  add(def.display, "identity");
  if (def.states) add(def.states.field, "identity");
  add("number", "identity");
  for (const name of accessFields(def)) add(name, "access");
  for (const t of def.states?.transitions ?? []) for (const name of t.requires ?? []) add(name, "transition");
  for (const f of def.fields) if (!f.custom && f.required) add(f.name, "required");
  if (def.ai) {
    add(def.ai.title, "ai");
    for (const name of def.ai.text ?? []) add(name, "ai");
  }
  for (const f of def.fields) if (!f.custom && f.locked) add(f.name, "module");
  // reasons in a stable order, whatever order the checks above met them in
  const order = Object.keys(LOCK_REASONS) as LockReason[];
  for (const list of Object.values(out)) list.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason));
  return out;
}

export const isLocked = (def: TableDef, field: string): boolean => !!lockedFields(def)[field]?.length;

/** What an organisation tries to do to a locked field. */
export type LockedChange = "hide" | "require";

/** The refusal of hiding or requiring a locked field, naming its reasons; null when the field is not locked. */
export function lockRefusal(def: TableDef, field: string, change: LockedChange): string | null {
  const locks = lockedFields(def)[field];
  if (!locks?.length) return null;
  const label = def.fields.find((f) => f.name === field)?.label ?? field;
  const why = locks.map((l) => l.label).join("، ");
  return change === "hide" ? `«${label}» را نمی‌توانید از فرم پنهان کنید؛ این فیلد قفل است: ${why}` : `«${label}» را نمی‌توانید الزامی کنید؛ این فیلد قفل است: ${why}`;
}
