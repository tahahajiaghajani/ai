// The layout of a record's form: tabs, their sections and the fields in each, from the table definition (`form.tabs`,
// `form.sections`, each field's `tab`/`section`) or the organisation's arrangement (`form.arrangement`, written by the
// form layout designer). The state field (the header shows it with its transitions), the number and the watch list
// (side panel) are left out; engine-maintained fields close the main tab in a collapsed «اطلاعات سامانه» section and
// are left off a new record's form. Pure: no React, no antd.
import type { FieldDef, FormArrangement, TableDef } from "@shared/model/types";
import { fieldOf } from "./schema";

export interface LayoutSection {
  key: string;
  /** null: the tab's unnamed first section */
  label: string | null;
  fields: FieldDef[];
  /** engine-maintained fields (collapsed by default) */
  system?: boolean;
}

export interface LayoutTab {
  key: string;
  label: string;
  sections: LayoutSection[];
}

export const MAIN_TAB = "جزئیات";
export const SYSTEM_SECTION = "اطلاعات سامانه";

export interface LayoutOptions {
  mode: "create" | "update";
  /** further fields to leave out (shown elsewhere by a module) */
  exclude?: readonly string[];
  /** ignore the organisation's arrangement (the designer's «پیش‌فرض» preview) */
  ignoreArrangement?: boolean;
}

/** Fields that never sit in the form body. */
function outOfForm(def: TableDef, f: FieldDef, o: LayoutOptions): boolean {
  if (f.hidden || f.name === "number") return true;
  if (def.states && f.name === def.states.field) return true;
  if (def.features?.watchers && f.name === (def.scope?.watchers ?? "watch_list")) return true;
  if (o.exclude?.includes(f.name)) return true;
  return false;
}

const engineField = (f: FieldDef) => !!(f.system || f.base);

/** The fields of `def` that belong in the form body, in the definition's order. */
export function formFields(def: TableDef, o: LayoutOptions): FieldDef[] {
  return def.fields.filter((f) => !outOfForm(def, f, o) && !(o.mode === "create" && engineField(f)));
}

const keyOf = (s: string | null, i: number) => `${i}:${s ?? ""}`;

function systemSection(fields: FieldDef[]): LayoutSection[] {
  const sys = fields.filter(engineField);
  return sys.length ? [{ key: "__system", label: SYSTEM_SECTION, fields: sys, system: true }] : [];
}

/** Layout from the definition alone (no arrangement). */
function defaultLayout(def: TableDef, fields: FieldDef[]): LayoutTab[] {
  const body = fields.filter((f) => !engineField(f));
  const tabNames = [MAIN_TAB, ...(def.form?.tabs ?? []).filter((t) => t !== MAIN_TAB)];
  for (const f of body) if (f.tab && !tabNames.includes(f.tab)) tabNames.push(f.tab);
  const declared = def.form?.sections ?? [];
  const tabs: LayoutTab[] = tabNames.map((label, i) => ({ key: `t${i}:${label}`, label, sections: [] }));
  const sectionOf = (tab: LayoutTab, label: string | null): LayoutSection => {
    let s = tab.sections.find((x) => x.label === label);
    if (!s) {
      s = { key: keyOf(label, tab.sections.length), label, fields: [] };
      tab.sections.push(s);
    }
    return s;
  };
  // declared sections first, in their order, on the main tab (empty ones are dropped below)
  for (const s of declared) sectionOf(tabs[0], s);
  for (const f of body) {
    const tab = tabs.find((t) => t.label === (f.tab ?? MAIN_TAB)) ?? tabs[0];
    // unsectioned fields join the first declared section of the main tab, or the tab's unnamed section
    const label = f.section ?? (tab === tabs[0] && declared.length ? declared[0] : null);
    sectionOf(tab, label).fields.push(f);
  }
  for (const t of tabs) {
    t.sections = t.sections.filter((s) => s.fields.length);
    // the unnamed section leads its tab
    t.sections.sort((a, b) => Number(b.label === null) - Number(a.label === null));
  }
  return tabs;
}

/** Layout from the organisation's arrangement; fields it does not name keep their default place. */
function arrangedLayout(fields: FieldDef[], arr: FormArrangement): LayoutTab[] {
  const body = fields.filter((f) => !engineField(f));
  const byName = new Map(body.map((f) => [f.name, f]));
  const placed = new Set<string>();
  const tabs: LayoutTab[] = arr.tabs.map((t, ti) => ({
    key: `a${ti}:${t.label}`,
    label: t.label,
    sections: t.sections.map((s, si) => {
      const fs: FieldDef[] = [];
      for (const n of s.fields) {
        const f = byName.get(n);
        if (f && !placed.has(n)) {
          placed.add(n);
          fs.push(f);
        }
      }
      return { key: keyOf(s.label, si), label: s.label, fields: fs };
    }),
  }));
  const rest = body.filter((f) => !placed.has(f.name));
  if (rest.length) {
    // a field added after the arrangement (a new custom field, a module upgrade): its own section if the
    // arrangement has one by that name, else the first section of the first tab
    const all = tabs.flatMap((t) => t.sections);
    for (const f of rest) {
      const home = (f.section && all.find((s) => s.label === f.section)) || all[0];
      if (home) home.fields.push(f);
      else {
        tabs.push({ key: "a-rest", label: MAIN_TAB, sections: [{ key: "rest", label: null, fields: [f] }] });
        all.push(tabs[tabs.length - 1].sections[0]);
      }
    }
  }
  for (const t of tabs) t.sections = t.sections.filter((s) => s.fields.length);
  return tabs;
}

/** Tabs and sections of the form of `def`; empty tabs and sections are left out, the first tab always exists. */
export function formLayout(def: TableDef, o: LayoutOptions = { mode: "update" }): LayoutTab[] {
  const fields = formFields(def, o);
  const arr = o.ignoreArrangement ? undefined : def.form?.arrangement;
  const tabs = arr?.tabs?.length ? arrangedLayout(fields, arr) : defaultLayout(def, fields);
  const out = tabs.filter((t) => t.sections.length);
  if (!out.length) out.push({ key: "t0", label: MAIN_TAB, sections: [] });
  if (o.mode !== "create") out[0].sections.push(...systemSection(fields));
  return out;
}

/** The arrangement the designer starts from: the current layout written out (engine fields excluded). */
export function arrangementOf(def: TableDef, o: { ignoreArrangement?: boolean } = {}): FormArrangement {
  const tabs = formLayout(def, { mode: "create", ignoreArrangement: o.ignoreArrangement });
  return { tabs: tabs.map((t) => ({ label: t.label, sections: t.sections.map((s) => ({ label: s.label, fields: s.fields.map((f) => f.name) })) })) };
}

/** Grid span of a field on the 24-column form grid (wide types take the whole row). */
export function spanOf(f: FieldDef): number {
  if (f.span) return f.span;
  if (f.type === "markdown" || f.type === "text" || f.type === "json" || f.type === "conditions") return 24;
  if (f.type === "users" || f.type === "refs" || f.type === "tags" || f.type === "multichoice") return 12;
  return 8;
}

/** The fields of a layout, in reading order. */
export const layoutFieldNames = (tabs: LayoutTab[]): string[] => tabs.flatMap((t) => t.sections.flatMap((s) => s.fields.map((f) => f.name)));

/** True when `name` is a field of `def` that sits in the form body. */
export const inForm = (def: TableDef, name: string, mode: LayoutOptions["mode"] = "update"): boolean => {
  const f = fieldOf(def, name);
  return !!f && formFields(def, { mode }).includes(f);
};
