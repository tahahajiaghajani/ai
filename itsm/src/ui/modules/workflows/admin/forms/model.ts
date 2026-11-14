// The pure logic of «فرم‌ها» (design F §3.2, §3.3, §8.2, package F5): the list of every form (kinds, search, groups,
// the old link of the layout editor), the layout operations both designers share (a table's default form is edited
// as a layout of field items too), undo and redo, a table's default form as a draft over its overrides and what
// saving it sends and says, the rights of its preview for a viewpoint, and a process form's draft, autosave state,
// the steps that use it and its palette. No React, no requests: tested in tests/workflows-admin-forms-ui.test.ts.
import type { FieldDef, FieldGroup, FormArrangement, TableDef } from "@shared/model/types";
import { FIELD_GROUPS } from "@shared/model/types";
import {
  SPANS, cleanFormLayout, effectiveRights, fieldItems, formLayoutProblems, isFieldItem, tableFormFields, type FieldItem, type FormItem, type FormLayoutV2, type FormSection, type Right,
  type Span, type StepRights,
} from "@shared/forms/layout";
import { lockedFields, type FieldLock } from "@shared/forms/locked";
import type { RequiredFor } from "@shared/forms/paths";
import { formStepOf, type ProcessGraph, type ProcessNode, type StepAction } from "@shared/process";
import { faDigits } from "@shared/format";
import { SEP, matchesFa } from "../../../../lib/fa";
import { relTime } from "../../../../records/model/activity";
import { arrangementOf } from "../../../../records/model/layout";
import { sameValue } from "../../../../records/model/values";
import type { RecordRow, TableMeta } from "../../../../records/model/types";
import { nodeTitle } from "../../kit/model";
import type { LibraryEntry, OverrideInput } from "../fields/api";
import type { FormEntry, FormKind, FormOut, OverridesBody, ProcessSources } from "./api";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fa = (n: number) => faDigits(n);

// ---------------------------------------------------------------------------------------------------------------
// The list

export const KIND_ORDER: FormKind[] = ["system", "process", "catalog", "portal_report", "survey", "risk"];

/** The «نوع» column's short words (the chips carry the kinds' full names). */
export const KIND_SHORT: Record<FormKind, string> = { system: "سامانه", process: "گردش‌کار", catalog: "کاتالوگ", portal_report: "درگاه", survey: "نظرسنجی", risk: "پرسش‌نامه" };

/** The kind chip an address asks for (`?kind=`), when the list offers it. */
export function kindOf(params: URLSearchParams, available: readonly FormKind[]): FormKind | null {
  const k = params.get("kind") as FormKind | null;
  return k && available.includes(k) ? k : null;
}

/** The forms of a kind (all without one) whose name, table, group or note matches the search. */
export function filterForms(forms: readonly FormEntry[], f: { kind: FormKind | null; q: string }, tableLabel: (key: string) => string = (k) => k): FormEntry[] {
  const q = f.q.trim();
  return forms.filter((e) => (!f.kind || e.kind === f.kind) && (!q || matchesFa(`${e.name} ${e.table ? tableLabel(e.table) : ""} ${e.table ?? ""} ${e.group} ${e.note ?? ""}`, q)));
}

/**
 * The process forms close the list, in a group of their own — the automation flows' tables are listed under their area
 * «گردش‌کارها» until that is renamed (design F §9.4), so the processes' group is named for the kind.
 */
export const PROCESS_GROUP = "فرم‌های گردش‌کار";

export type ListRow = { type: "group"; key: string; label: string; count: number } | { type: "form"; key: string; entry: FormEntry };

/**
 * The list grouped by module, in the order the server lists them (each table's module, the linked kinds under their
 * module), the process forms last; within a group, system forms first, then the other kinds, as listed.
 */
export function groupRows(forms: readonly FormEntry[]): ListRow[] {
  const groups = new Map<string, FormEntry[]>();
  for (const e of forms) {
    const g = e.kind === "process" ? PROCESS_GROUP : e.group;
    const list = groups.get(g);
    if (list) list.push(e);
    else groups.set(g, [e]);
  }
  const names = [...groups.keys()].sort((a, b) => Number(a === PROCESS_GROUP) - Number(b === PROCESS_GROUP));
  const rows: ListRow[] = [];
  for (const g of names) {
    const items = [...groups.get(g)!].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    rows.push({ type: "group", key: `group:${g}`, label: g, count: items.length });
    for (const e of items) rows.push({ type: "form", key: e.key, entry: e });
  }
  return rows;
}

/** «به کار رفته در»: the first two, then «و n مورد دیگر». */
export function usedText(used: readonly string[]): string {
  if (!used.length) return "";
  const head = used.slice(0, 2).join("، ");
  return used.length > 2 ? `${head} و ${fa(used.length - 2)} مورد دیگر` : head;
}

/** «تغییر نسبت به پیش‌فرض» of a system form: the organisation's changes, and whether it arranged the form. */
export function changeText(e: Pick<FormEntry, "kind" | "overrides" | "arranged">): string {
  if (e.kind !== "system") return "";
  const parts: string[] = [];
  if (e.overrides) parts.push(`${fa(e.overrides)} تغییر`);
  if (e.arranged) parts.push("چیدمان سازمان");
  return parts.join(SEP);
}

/** The status chip's words: a process form's state and version, a linked form's own word. */
export function statusText(e: Pick<FormEntry, "kind" | "status" | "version">): string {
  if (e.kind === "process") {
    if (e.status === "published") return e.version ? `منتشرشده${SEP}نسخهٔ ${fa(e.version)}` : "منتشرشده";
    return "پیش‌نویس";
  }
  return e.status ?? "";
}

/** The old address of the layout editor (`settings/forms?table=todo`, the studio's link): the table's form now. */
export function oldLayoutTarget(search: string): string | null {
  const t = new URLSearchParams(search).get("table");
  return t && /^[a-z][a-z0-9_]{0,62}$/.test(t) ? `settings/forms/t/${t}` : null;
}

/** «آخرین تغییر» in words. */
export const changedAt = (iso: string | null, now = Date.now()): string => (iso ? relTime(iso, now) : "");

// ---------------------------------------------------------------------------------------------------------------
// Layout operations (a process form's layout; a table's default form edited as one)

/** Where something sits: a tab, a section of it, an item of the section. */
export type Sel = { kind: "tab"; t: number } | { kind: "section"; t: number; s: number } | { kind: "item"; t: number; s: number; i: number };
export interface At {
  t: number;
  s: number;
  i?: number;
}

export const NEW_TAB = "زبانهٔ تازه";
export const NEW_SECTION = "بخش تازه";
export const FIRST_TAB = "جزئیات";

export function itemAt(layout: FormLayoutV2, at: { t: number; s: number; i: number }): FormItem | null {
  return layout.tabs[at.t]?.sections[at.s]?.items[at.i] ?? null;
}

/** A layout with at least one tab and one section to put things in. */
export function ensureSection(layout: FormLayoutV2): FormLayoutV2 {
  if (layout.tabs.some((t) => t.sections.length)) return layout;
  const next = clone(layout);
  if (!next.tabs.length) next.tabs.push({ label: FIRST_TAB, sections: [] });
  next.tabs[0].sections.push({ label: null, items: [] });
  return next;
}

/** The section a new item goes to: the selected one (or the selected item's), else the last section of the first tab with one. */
export function targetSection(layout: FormLayoutV2, sel: Sel | null): { t: number; s: number } {
  if (sel && sel.kind !== "tab" && layout.tabs[sel.t]?.sections[sel.s]) return { t: sel.t, s: sel.s };
  const t = sel?.kind === "tab" && layout.tabs[sel.t]?.sections.length ? sel.t : layout.tabs.findIndex((x) => x.sections.length);
  return { t: Math.max(0, t), s: Math.max(0, (layout.tabs[Math.max(0, t)]?.sections.length ?? 1) - 1) };
}

/** Adds an item at a place (the end of the section without an index); returns the layout and where it went. */
export function insertItem(layout: FormLayoutV2, item: FormItem, at: At): { layout: FormLayoutV2; sel: Sel } {
  const next = clone(ensureSection(layout));
  const t = Math.min(at.t, next.tabs.length - 1);
  const tab = next.tabs[t].sections.length ? next.tabs[t] : next.tabs.find((x) => x.sections.length)!;
  const ti = next.tabs.indexOf(tab);
  const s = Math.min(at.s, tab.sections.length - 1);
  const items = tab.sections[s].items;
  const i = at.i === undefined ? items.length : Math.max(0, Math.min(items.length, at.i));
  items.splice(i, 0, item);
  return { layout: next, sel: { kind: "item", t: ti, s, i } };
}

/** Moves an item to another place (before index `to.i`, or to the end of the section). */
export function moveItem(layout: FormLayoutV2, from: { t: number; s: number; i: number }, to: At): { layout: FormLayoutV2; sel: Sel } {
  const item = itemAt(layout, from);
  if (!item) return { layout, sel: { kind: "item", ...from } };
  const next = clone(layout);
  next.tabs[from.t].sections[from.s].items.splice(from.i, 1);
  let i = to.i;
  // the same section, further down: the item's own removal shifted the target
  if (i !== undefined && to.t === from.t && to.s === from.s && i > from.i) i--;
  return insertItem(next, item, { t: to.t, s: to.s, i });
}

/** Every section in reading order (the «انتقال به…» choices). */
export function sectionList(layout: FormLayoutV2): { t: number; s: number; label: string }[] {
  return layout.tabs.flatMap((tab, t) => tab.sections.map((sec, s) => ({ t, s, label: `${tab.label} › ${sec.label ?? `بخش ${fa(s + 1)}`}` })));
}

/** One step up or down: within the section, else to the end of the previous or the start of the next section. */
export function shiftItem(layout: FormLayoutV2, at: { t: number; s: number; i: number }, d: -1 | 1): { layout: FormLayoutV2; sel: Sel } {
  const items = layout.tabs[at.t]?.sections[at.s]?.items;
  if (!items) return { layout, sel: { kind: "item", ...at } };
  const target = at.i + d;
  if (target >= 0 && target < items.length) return moveItem(layout, at, { t: at.t, s: at.s, i: d > 0 ? target + 1 : target });
  const all = sectionList(layout);
  const here = all.findIndex((x) => x.t === at.t && x.s === at.s);
  const other = all[here + d];
  if (!other) return { layout, sel: { kind: "item", ...at } };
  return moveItem(layout, at, { t: other.t, s: other.s, i: d > 0 ? 0 : undefined });
}

export function removeItem(layout: FormLayoutV2, at: { t: number; s: number; i: number }): FormLayoutV2 {
  const next = clone(layout);
  next.tabs[at.t]?.sections[at.s]?.items.splice(at.i, 1);
  return next;
}

export function updateItem(layout: FormLayoutV2, at: { t: number; s: number; i: number }, item: FormItem): FormLayoutV2 {
  const next = clone(layout);
  if (next.tabs[at.t]?.sections[at.s]?.items[at.i]) next.tabs[at.t].sections[at.s].items[at.i] = item;
  return next;
}

export function addTab(layout: FormLayoutV2): { layout: FormLayoutV2; sel: Sel } {
  const next = clone(layout);
  next.tabs.push({ label: next.tabs.length ? NEW_TAB : FIRST_TAB, sections: [{ label: null, items: [] }] });
  return { layout: next, sel: { kind: "tab", t: next.tabs.length - 1 } };
}

export function addSection(layout: FormLayoutV2, t: number): { layout: FormLayoutV2; sel: Sel } {
  const next = clone(layout);
  if (!next.tabs.length) next.tabs.push({ label: FIRST_TAB, sections: [] });
  const ti = Math.min(Math.max(0, t), next.tabs.length - 1);
  next.tabs[ti].sections.push({ label: NEW_SECTION, items: [] });
  return { layout: next, sel: { kind: "section", t: ti, s: next.tabs[ti].sections.length - 1 } };
}

export function updateSection(layout: FormLayoutV2, t: number, s: number, patch: Partial<Pick<FormSection, "label" | "columns">>): FormLayoutV2 {
  const next = clone(layout);
  const sec = next.tabs[t]?.sections[s];
  if (!sec) return layout;
  if ("label" in patch) sec.label = patch.label?.trim() ? patch.label : null;
  if ("columns" in patch) {
    if (patch.columns === 1 || patch.columns === 2) sec.columns = patch.columns;
    else delete sec.columns;
  }
  return next;
}

export function renameTab(layout: FormLayoutV2, t: number, label: string): FormLayoutV2 {
  const next = clone(layout);
  if (next.tabs[t]) next.tabs[t].label = label;
  return next;
}

/** A section one place up or down, across tabs at their edges. */
export function shiftSection(layout: FormLayoutV2, t: number, s: number, d: -1 | 1): { layout: FormLayoutV2; sel: Sel } {
  const next = clone(layout);
  const tab = next.tabs[t];
  if (!tab?.sections[s]) return { layout, sel: { kind: "section", t, s } };
  const target = s + d;
  if (target >= 0 && target < tab.sections.length) {
    const [x] = tab.sections.splice(s, 1);
    tab.sections.splice(target, 0, x);
    return { layout: next, sel: { kind: "section", t, s: target } };
  }
  const other = next.tabs[t + d];
  if (!other) return { layout, sel: { kind: "section", t, s } };
  const [x] = tab.sections.splice(s, 1);
  if (d > 0) other.sections.unshift(x);
  else other.sections.push(x);
  return { layout: next, sel: { kind: "section", t: t + d, s: d > 0 ? 0 : other.sections.length - 1 } };
}

export function shiftTab(layout: FormLayoutV2, t: number, d: -1 | 1): { layout: FormLayoutV2; sel: Sel } {
  const target = t + d;
  if (!layout.tabs[t] || target < 0 || target >= layout.tabs.length) return { layout, sel: { kind: "tab", t } };
  const next = clone(layout);
  const [x] = next.tabs.splice(t, 1);
  next.tabs.splice(target, 0, x);
  return { layout: next, sel: { kind: "tab", t: target } };
}

/** The field names a section or a tab holds (a removal takes them off the form). */
export const sectionFields = (sec: FormSection): string[] => sec.items.filter(isFieldItem).map((i) => i.field);

export function removeSection(layout: FormLayoutV2, t: number, s: number): FormLayoutV2 {
  const next = clone(layout);
  next.tabs[t]?.sections.splice(s, 1);
  return next;
}

export function removeTab(layout: FormLayoutV2, t: number): FormLayoutV2 {
  const next = clone(layout);
  next.tabs.splice(t, 1);
  return next;
}

/** The selection after a removal: the nearest thing still there (or nothing). */
export function clampSel(layout: FormLayoutV2, sel: Sel | null): Sel | null {
  if (!sel) return null;
  const tab = layout.tabs[sel.t];
  if (!tab) return layout.tabs.length ? { kind: "tab", t: layout.tabs.length - 1 } : null;
  if (sel.kind === "tab") return sel;
  const sec = tab.sections[sel.s];
  if (!sec) return tab.sections.length ? { kind: "section", t: sel.t, s: tab.sections.length - 1 } : { kind: "tab", t: sel.t };
  if (sel.kind === "section") return sel;
  if (sec.items[sel.i]) return sel;
  return sec.items.length ? { kind: "item", t: sel.t, s: sel.s, i: sec.items.length - 1 } : { kind: "section", t: sel.t, s: sel.s };
}

/** Where a field sits, or null. */
export function findField(layout: FormLayoutV2, name: string): { t: number; s: number; i: number } | null {
  for (let t = 0; t < layout.tabs.length; t++)
    for (let s = 0; s < layout.tabs[t].sections.length; s++) {
      const i = layout.tabs[t].sections[s].items.findIndex((x) => isFieldItem(x) && x.field === name);
      if (i >= 0) return { t, s, i };
    }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// A process form's items: behaviour, width

export type Behaviour = "normal" | "required" | "readonly" | "hidden";

export const BEHAVIOURS: { value: Behaviour; label: string }[] = [
  { value: "normal", label: "عادی" },
  { value: "required", label: "الزامی" },
  { value: "readonly", label: "فقط‌خواندنی" },
  { value: "hidden", label: "پنهان" },
];

export const behaviourOf = (i: FieldItem): Behaviour => (i.hidden ? "hidden" : i.readonly ? "readonly" : i.required ? "required" : "normal");

/** The item with one behaviour (they exclude each other, as the server cleans them). */
export function withBehaviour(i: FieldItem, b: Behaviour): FieldItem {
  const { hidden: _h, readonly: _r, required: _q, ...rest } = i;
  void _h;
  void _r;
  void _q;
  return b === "normal" ? rest : { ...rest, [b]: true };
}

export const SPAN_LABELS: Record<Span, string> = { 6: "یک‌چهارم ردیف", 8: "یک‌سوم ردیف", 12: "نیم ردیف", 16: "دوسوم ردیف", 18: "سه‌چهارم ردیف", 24: "تمام ردیف" };
export const SPAN_OPTIONS = SPANS.map((s) => ({ value: s, label: SPAN_LABELS[s] }));

const WIDE = new Set(["text", "markdown", "json"]);

/** The width an item takes when it names none (as `formView` gives it): long text and files a row, else half. */
export const autoSpan = (type: string | undefined, columns: 1 | 2 | undefined): Span => (columns === 1 || (type && WIDE.has(type)) ? 24 : 12);

// ---------------------------------------------------------------------------------------------------------------
// Undo and redo

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export const historyOf = <T>(v: T): History<T> => ({ past: [], present: v, future: [] });

/** A new present: the old one joins the past (capped), the future is dropped; the same value changes nothing. */
export function historyPush<T>(h: History<T>, v: T): History<T> {
  if (sameValue(h.present, v)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: v, future: [] };
}

/** The present replaced in place (typing on in the same box is one step to undo, not one per letter). */
export function historyReplace<T>(h: History<T>, v: T): History<T> {
  if (sameValue(h.present, v)) return h;
  return { past: h.past, present: v, future: [] };
}

const TYPED = new Set(["label", "help", "placeholder", "text"]);

/**
 * The key that makes one edit a continuation of the last (`prefix:prop`) when the only change is to a typed text — a
 * label, help, sample text or note — else undefined.
 */
export function typingKey(prefix: string, a: object, b: object): string | undefined {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]);
  return changed.length === 1 && TYPED.has(changed[0]) ? `${prefix}:${changed[0]}` : undefined;
}

export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ---------------------------------------------------------------------------------------------------------------
// A table's default form (system form): fields, draft, changes

export type SysKind = "module" | "library" | "table";

export const SYS_KIND_LABELS: Record<SysKind, string> = { module: "فیلد ماژول", library: "از کتابخانه", table: "فیلد همین جدول" };

/** A field of a table's form as the designer knows it. */
export interface SysField {
  name: string;
  label: string;
  type: FieldDef["type"];
  kind: SysKind;
  /** the module's own label (module fields) */
  defaultLabel: string | null;
  help: string;
  placeholder: string;
  formHidden: boolean;
  formRequired: RequiredFor | null;
  /** the module requires it (never the organisation's requirement) */
  moduleRequired: boolean;
  locks: FieldLock[];
  group: FieldGroup | null;
  /** the field's own section in the definition (a new field's home) */
  section: string | null;
}

/**
 * The fields of a table's default form — what the designer arranges: the organisation's definition `def` (the
 * schema), the module's `base` (the registry: locks, own labels, what the module requires).
 */
export function systemFields(def: TableDef, base: TableDef | undefined): SysField[] {
  const locks = base ? lockedFields(base) : {};
  const own = new Map((base?.fields ?? []).filter((f) => !f.custom).map((f) => [f.name, f]));
  return tableFormFields(def).map((f) => {
    const module = own.get(f.name);
    return {
      name: f.name,
      label: f.label,
      type: f.type,
      kind: f.library ? "library" : f.custom || !module ? "table" : "module",
      defaultLabel: module?.label ?? null,
      help: f.help ?? "",
      placeholder: f.placeholder ?? "",
      formHidden: !!f.formHidden,
      formRequired: f.formRequired ?? null,
      moduleRequired: !!module?.required,
      locks: module ? (locks[f.name] ?? []) : [],
      group: (f.group as FieldGroup | undefined) ?? null,
      section: f.section ?? null,
    };
  });
}

export interface SysOverride {
  label: string;
  help: string;
  placeholder: string;
  hidden: boolean;
  requiredFor: RequiredFor | null;
}

export interface SystemDraft {
  /** the form's tabs, sections and fields (items name fields only) */
  layout: FormLayoutV2;
  /** the organisation's arrangement is in use (false: the module's default layout) */
  arranged: boolean;
  fields: Record<string, SysOverride>;
}

export const layoutFromArrangement = (a: FormArrangement): FormLayoutV2 => ({
  tabs: a.tabs.map((t) => ({ label: t.label, sections: t.sections.map((s) => ({ label: s.label, items: s.fields.map((field) => ({ field })) })) })),
});

export const arrangementFromLayout = (l: FormLayoutV2): FormArrangement => ({
  tabs: l.tabs.map((t) => ({ label: t.label.trim() || FIRST_TAB, sections: t.sections.map((s) => ({ label: s.label?.trim() || null, fields: s.items.filter(isFieldItem).map((i) => i.field) })) })),
});

const overrideOf = (f: SysField): SysOverride => ({ label: f.label, help: f.help, placeholder: f.placeholder, hidden: f.formHidden, requiredFor: f.formRequired });

/** The stored state as a draft: the form as it is laid out today, and each field's overrides. */
export function systemDraft(def: TableDef, fields: readonly SysField[]): SystemDraft {
  return {
    layout: layoutFromArrangement(arrangementOf(def)),
    arranged: !!def.form?.arrangement?.tabs?.length,
    fields: Object.fromEntries(fields.map((f) => [f.name, overrideOf(f)])),
  };
}

/** The module's own layout (the arrangement the organisation would go back to). */
export const defaultLayout = (def: TableDef): FormLayoutV2 => layoutFromArrangement(arrangementOf(def, { ignoreArrangement: true }));

/**
 * The draft after the table changed under it (a field attached or removed while designing): a new field goes to the
 * section of its own name, else the first one, with its stored overrides; a field that is gone leaves the layout.
 */
export function reconcileDraft(draft: SystemDraft, fields: readonly SysField[]): SystemDraft {
  const names = new Set(fields.map((f) => f.name));
  let layout: FormLayoutV2 = {
    tabs: draft.layout.tabs.map((t) => ({ ...t, sections: t.sections.map((s) => ({ ...s, items: s.items.filter((i) => !isFieldItem(i) || names.has(i.field)) })) })),
  };
  const placed = new Set(fieldItems(layout).map((i) => i.field));
  const out: Record<string, SysOverride> = {};
  for (const f of fields) {
    out[f.name] = draft.fields[f.name] ?? overrideOf(f);
    if (placed.has(f.name) || f.name in draft.fields) continue;
    const home = sectionList(layout).find((x) => f.section && layout.tabs[x.t].sections[x.s].label === f.section) ?? sectionList(layout)[0];
    layout = insertItem(layout, { field: f.name }, home ? { t: home.t, s: home.s } : { t: 0, s: 0 }).layout;
  }
  return { ...draft, layout, fields: out };
}

/** Fields of the form that no section names (they would join the first section). */
export function unplaced(draft: SystemDraft, fields: readonly SysField[]): SysField[] {
  const placed = new Set(fieldItems(draft.layout).map((i) => i.field));
  return fields.filter((f) => !placed.has(f.name));
}

const lockText = (locks: readonly FieldLock[]) => `قفل است: ${locks.map((l) => l.label).join("، ")}`;

/** Why «پنهان در فرم» is not offered for a field (the server refuses the same), or null. */
export function hideBlocker(f: SysField, o: SysOverride): string | null {
  if (o.hidden) return null;
  if (f.locks.length) return lockText(f.locks);
  if (f.moduleRequired) return "ماژول آن را الزامی می‌خواهد";
  if (o.requiredFor) return "الزامی است؛ نخست الزام را بردارید";
  return null;
}

/** Why «الزامی برای…» is not offered for a field, or null. */
export function requireBlocker(f: SysField, o: SysOverride): string | null {
  if (f.locks.length) return lockText(f.locks);
  if (f.moduleRequired) return "ماژول آن را الزامی می‌خواهد";
  if (o.hidden) return "در فرم پنهان است؛ نخست آن را در فرم نمایش دهید";
  return null;
}

/** Library fields take their label, help and sample text from «فیلدها». */
export const ownTexts = (f: SysField): boolean => f.kind !== "library";

/** The field's state in words for its chip on the canvas. */
export function sysMarks(f: SysField, o: SysOverride): string[] {
  const out: string[] = [];
  if (o.hidden) out.push("پنهان در فرم");
  if (f.moduleRequired) out.push("الزامی در ماژول");
  else if (o.requiredFor) out.push(o.requiredFor === "agents" ? "الزامی برای کارشناسان" : "الزامی برای همه");
  return out;
}

export interface SystemChanges {
  body: OverridesBody;
  lines: string[];
  count: number;
}

const blank = (s: string) => !s.trim();

/**
 * What saving sends (only what changed) and the lines the confirmation shows. Library fields never send texts; a
 * requirement sends its audience; the arrangement is sent when it changed, null when the organisation goes back to
 * the module's layout.
 */
export function systemChanges(fields: readonly SysField[], baseline: SystemDraft, draft: SystemDraft): SystemChanges {
  const out: Record<string, OverrideInput> = {};
  const lines: string[] = [];
  for (const f of fields) {
    const a = baseline.fields[f.name];
    const b = draft.fields[f.name];
    if (!a || !b) continue;
    const o: OverrideInput = {};
    const name = a.label || f.name;
    if (ownTexts(f)) {
      if (b.label.trim() !== a.label.trim()) {
        o.label = blank(b.label) ? null : b.label.trim();
        lines.push(`برچسب «${name}» ← «${blank(b.label) ? (f.defaultLabel ?? f.name) : b.label.trim()}»`);
      }
      if (b.help.trim() !== a.help.trim()) {
        o.help = blank(b.help) ? null : b.help.trim();
        lines.push(`راهنمای «${name}» ${blank(b.help) ? "برداشته شد" : "تغییر کرد"}`);
      }
      if (b.placeholder.trim() !== a.placeholder.trim()) {
        o.placeholder = blank(b.placeholder) ? null : b.placeholder.trim();
        lines.push(`متن نمونهٔ «${name}» ${blank(b.placeholder) ? "برداشته شد" : "تغییر کرد"}`);
      }
    }
    if (b.hidden !== a.hidden) {
      o.form_hidden = b.hidden;
      lines.push(b.hidden ? `«${name}» در فرم پنهان می‌شود` : `«${name}» دوباره در فرم نمایش داده می‌شود`);
    }
    if (b.requiredFor !== a.requiredFor) {
      if (b.requiredFor) {
        o.required = true;
        o.required_for = b.requiredFor;
        lines.push(b.requiredFor === "agents" ? `«${name}» برای کارشناسان الزامی می‌شود` : `«${name}» برای همه الزامی می‌شود`);
      } else {
        o.required = false;
        lines.push(`الزام «${name}» برداشته می‌شود`);
      }
    }
    if (Object.keys(o).length) out[f.name] = o;
  }
  const body: OverridesBody = {};
  if (Object.keys(out).length) body.fields = out;
  const layoutChanged = !sameValue(arrangementFromLayout(draft.layout), arrangementFromLayout(baseline.layout)) || draft.arranged !== baseline.arranged;
  if (layoutChanged) {
    body.arrangement = draft.arranged ? arrangementFromLayout(draft.layout) : null;
    lines.push(draft.arranged ? arrangementLine(baseline.layout, draft.layout) : "چیدمان به پیش‌فرض ماژول برمی‌گردد");
  }
  return { body, lines, count: lines.length };
}

/** «چیدمان: ۲ فیلد به بخش دیگری رفت؛ ترتیب فیلدها، ۱ زبانه و ۲ بخش تغییر کرد». */
function arrangementLine(a: FormLayoutV2, b: FormLayoutV2): string {
  const where = (l: FormLayoutV2) => {
    const m = new Map<string, string>();
    l.tabs.forEach((t, ti) => t.sections.forEach((s, si) => s.items.forEach((i) => isFieldItem(i) && m.set(i.field, `${ti}:${t.label}›${si}:${s.label ?? ""}`))));
    return m;
  };
  const wa = where(a);
  const wb = where(b);
  const moved = [...wb.keys()].filter((k) => wa.get(k) !== wb.get(k)).length;
  const parts: string[] = [];
  if (moved) parts.push(`${fa(moved)} فیلد جای تازه دارد`);
  const order = (l: FormLayoutV2) => fieldItems(l).map((i) => i.field).join(",");
  if (!moved && order(a) !== order(b)) parts.push("ترتیب فیلدها تغییر کرد");
  const tabs = (l: FormLayoutV2) => l.tabs.map((t) => t.label).join("|");
  if (tabs(a) !== tabs(b)) parts.push("زبانه‌ها تغییر کرد");
  const secs = (l: FormLayoutV2) => l.tabs.map((t) => t.sections.map((s) => s.label ?? "").join("|")).join("‖");
  if (secs(a) !== secs(b)) parts.push("بخش‌ها تغییر کرد");
  return `چیدمان: ${parts.length ? parts.join("؛ ") : "به چیدمان سازمان درمی‌آید"}`;
}

/** A viewpoint of the system form's preview: «ثبت‌کننده» or «کارشناس» (the organisation's built-in roles). */
export type Persona = "requester" | "agent";
export const PERSONAS: { value: Persona; label: string }[] = [
  { value: "requester", label: "ثبت‌کننده" },
  { value: "agent", label: "کارشناس" },
];

/** Does the organisation's requirement bind this viewpoint (its `scope`: «همه», and «فقط کارشناسان» for agents)? */
export const binds = (rf: RequiredFor | null, scope: readonly RequiredFor[]): boolean => !!rf && scope.includes(rf);

/**
 * The rights of the draft's fields for a viewpoint — exactly as GET /forms/system/:table/preview decides them for the
 * stored form, through the shared `effectiveRights`: «پنهان در فرم» hidden; read-only and engine fields read; the
 * module's requirement, or the organisation's where it binds the viewpoint, required; then the viewpoint's field groups.
 */
export function systemRights(def: TableDef, fields: readonly SysField[], draft: SystemDraft, vp: { groups: readonly FieldGroup[]; scope: readonly RequiredFor[] }): Record<string, Right> {
  const defs = new Map(def.fields.map((f) => [f.name, f]));
  const items: FieldItem[] = fields.map((f) => {
    const o = draft.fields[f.name] ?? overrideOf(f);
    const d = defs.get(f.name);
    const item: FieldItem = { field: f.name };
    if (o.hidden) item.hidden = true;
    else if (d?.readonly || d?.system) item.readonly = true;
    else if (f.moduleRequired || binds(o.requiredFor, vp.scope)) item.required = true;
    return item;
  });
  const layout: FormLayoutV2 = { tabs: [{ label: FIRST_TAB, sections: [{ label: null, items }] }] };
  return effectiveRights(layout, null, defs, { groups: vp.groups });
}

/**
 * The table as the draft would make it, for the preview's layout: the draft's arrangement, labels, help and sample
 * texts (`required` left as the module's: the rights say who must fill what).
 */
export function previewTable(def: TableMeta, draft: SystemDraft): TableMeta {
  return {
    ...def,
    form: { ...(def.form ?? {}), arrangement: arrangementFromLayout(draft.layout) },
    fields: def.fields.map((f) => {
      const o = draft.fields[f.name];
      if (!o) return f;
      return { ...f, label: o.label.trim() || f.label, help: o.help.trim() || undefined, placeholder: o.placeholder.trim() || undefined, formHidden: o.hidden };
    }),
  };
}

/** «۲ الزامی، ۳ پنهان» for the preview's line (a Persian comma: a middle dot beside a digit reads as «۰»). */
export function rightsSummary(rights: Record<string, Right>): string {
  const n = (r: Right) => Object.values(rights).filter((x) => x === r).length;
  const parts: string[] = [];
  if (n("required")) parts.push(`${fa(n("required"))} الزامی`);
  if (n("read")) parts.push(`${fa(n("read"))} فقط‌خواندنی`);
  if (n("hidden")) parts.push(`${fa(n("hidden"))} پنهان`);
  return parts.join(SEP);
}

export const groupLabel = (g: FieldGroup | null): string => (g ? (FIELD_GROUPS[g] ?? g) : "");

// ---------------------------------------------------------------------------------------------------------------
// A process form: draft, autosave, palette, steps

export interface ProcessDraft {
  name: string;
  description: string;
  layout: FormLayoutV2;
}

export const processDraft = (f: FormOut): ProcessDraft => ({ name: f.name, description: f.description ?? "", layout: f.layout });

/**
 * What autosave sends for the draft (null: nothing changed since `saved`). The layout is compared and sent as the server
 * keeps it (`cleanFormLayout`: labels trimmed, an empty tab named «جزئیات»), so a stored form never looks changed.
 */
export function processPatch(saved: FormOut, d: ProcessDraft): { name?: string; description?: string | null; layout?: FormLayoutV2 } | null {
  const out: { name?: string; description?: string | null; layout?: FormLayoutV2 } = {};
  if (d.name.trim() && d.name.trim() !== saved.name) out.name = d.name.trim();
  if ((d.description.trim() || null) !== (saved.description?.trim() || null)) out.description = d.description.trim() || null;
  const layout = cleanFormLayout(d.layout);
  if (!sameValue(layout, saved.layout)) out.layout = layout;
  return Object.keys(out).length ? out : null;
}

/** A minimal definition of a library field from the library's list (until the form's own definitions arrive). */
export function libraryDef(e: Pick<LibraryEntry, "name" | "label" | "storage" | "help">): FieldDef {
  return { name: e.name, label: e.label, type: e.storage ?? "string", ...(e.help ? { help: e.help } : {}) } as FieldDef;
}

/** Why the draft cannot be saved (the server's own check, run before sending). */
export function draftProblems(d: ProcessDraft, defOf: (name: string) => FieldDef | undefined, retired: ReadonlySet<string>, kept: ReadonlySet<string>): string[] {
  const problems = d.name.trim() ? [] : ["نام فرم را بنویسید"];
  return [...problems, ...formLayoutProblems(d.layout, { field: (n) => defOf(n) ?? null, retired: (n) => retired.has(n), kept })];
}

/** Library fields the palette offers: active, not on the form yet, matching the search. */
export function paletteFields(lib: readonly LibraryEntry[], layout: FormLayoutV2, q: string): LibraryEntry[] {
  const used = new Set(fieldItems(layout).map((i) => i.field));
  return lib
    .filter((e) => e.status !== "retired" && !used.has(e.name) && (!q.trim() || matchesFa(`${e.label} ${e.name} ${e.type_label}`, q)))
    .sort((a, b) => a.label.localeCompare(b.label, "fa"));
}

export type SaveState = "saved" | "pending" | "saving" | "error" | "invalid";

/** The toolbar's save state: «ذخیره شد، ۲ دقیقه پیش», «در حال ذخیره…», «ذخیره نشد»… (never a middle dot before a digit: it reads as «۰») */
export function saveStateText(state: SaveState, at: string | null, now = Date.now(), problems = 0): string {
  switch (state) {
    case "saving":
      return "در حال ذخیره…";
    case "pending":
      return "تغییر ذخیره‌نشده";
    case "error":
      return "ذخیره نشد";
    case "invalid":
      return `${fa(problems)} ایراد؛ ذخیره نمی‌شود`;
    default:
      return at ? `ذخیره شد${SEP}${relTime(at, now)}` : "ذخیره شد";
  }
}

/** A step that uses a form: where it is, its rights and action. */
export interface StepOption {
  /** «<process id>:draft:<node>» or «<process id>:v<version>:<node>» */
  key: string;
  label: string;
  process: string;
  action: StepAction;
  rights: StepRights;
  source: "draft" | "version";
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The graph inside a draft (the designer keeps `{ graph }`; a bare graph is read too). */
function graphOf(raw: unknown): ProcessGraph | null {
  const o = isObj(raw) ? raw : null;
  const g = o && isObj(o.graph) ? o.graph : o;
  return g && Array.isArray(g.nodes) ? (g as unknown as ProcessGraph) : null;
}

/**
 * The steps that use a form: the form steps of each process's draft and of its published version that name it, with
 * their rights — the preview's «مرحله» choices. A published step its draft still holds unchanged is listed once.
 */
export function stepsUsing(formId: string, src: ProcessSources): StepOption[] {
  const out: StepOption[] = [];
  const seen = new Set<string>();
  const add = (process: RecordRow, n: ProcessNode, step: ReturnType<typeof formStepOf>, source: StepOption["source"], tag: string) => {
    const name = String(process.name ?? process.key ?? "");
    const sig = `${process.id}|${n.id}|${JSON.stringify(step.rights)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const label = `${name} › ${nodeTitle(n)}${source === "version" ? ` (${tag})` : ""}`;
    out.push({ key: `${process.id}:${source === "draft" ? "draft" : tag}:${n.id}`, label, process: name, action: step.action, rights: step.rights, source });
  };
  for (const p of src.processes) {
    const g = graphOf(p.draft);
    for (const n of g?.nodes ?? []) {
      if (n.type !== "form_step") continue;
      const step = formStepOf(n.config);
      if (step.form === formId) add(p, n, step, "draft", "draft");
    }
  }
  for (const v of src.versions) {
    const p = src.processes.find((x) => x.id === v.process_id);
    const g = graphOf(v.graph);
    if (!p || !g) continue;
    const steps = isObj(v.steps) ? v.steps : {};
    for (const n of g.nodes) {
      if (n.type !== "form_step") continue;
      const step = formStepOf(isObj(steps[n.id]) ? steps[n.id] : n.config);
      if (step.form === formId) add(p, n, step, "version", `نسخهٔ ${fa(Number(v.version_no ?? 0))}`);
    }
  }
  return out;
}

/** The preview's viewpoints of a process form: the designer, then the organisation's two personas. */
export const VIEWPOINTS: { value: string; label: string }[] = [
  { value: "me", label: "من" },
  { value: "requester", label: "درخواست‌دهنده" },
  { value: "agent", label: "کارشناس" },
];

/** A field item's chips on the canvas: its behaviour and «نمایش وقتی…». */
export function itemMarks(i: FieldItem): string[] {
  const out: string[] = [];
  const b = behaviourOf(i);
  if (b !== "normal") out.push(BEHAVIOURS.find((x) => x.value === b)!.label);
  if (i.showIf) out.push("شرطی");
  return out;
}
