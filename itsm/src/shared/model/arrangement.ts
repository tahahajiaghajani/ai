// The organisation's arrangement of a table's form — its tabs, their sections and the order of the fields in them —
// written by the form layout designer (Settings › چیدمان فرم‌ها) as ONE row of the `custom_field` table whose name is
// FORM_ROW and whose `options` hold the arrangement. One row per table keeps a layout change atomic and leaves the
// fields' own rows (labels, help, custom fields) alone. The engine surfaces it as `def.form.arrangement` in
// GET /meta/tables (src/server/engine/schema.ts); the UI lays the form out with it (src/ui/records/model/layout.ts).
// Fields an arrangement does not name keep their default place. Imported by the UI: keep it free of server imports.
import type { FormArrangement } from "./types";

/** `custom_field.name` of the arrangement row (never a field name: those are `[a-z]…` or `u_…`). */
export const FORM_ROW = "_form";

const MAX_TABS = 12;
const MAX_SECTIONS = 60;
const MAX_FIELDS = 400;
const MAX_LABEL = 80;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,62}$/;

const label = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) : "");

/**
 * A clean arrangement from stored JSON (an object or its text): labels trimmed, field names checked, every field
 * named once, sizes capped. Null when nothing usable is left.
 */
export function cleanArrangement(raw: unknown): FormArrangement | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const tabs = (o as { tabs?: unknown }).tabs;
  if (!Array.isArray(tabs)) return null;
  const seen = new Set<string>();
  let sections = 0;
  const out: FormArrangement["tabs"] = [];
  for (const t of tabs.slice(0, MAX_TABS)) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const tab = t as { label?: unknown; sections?: unknown };
    const secs: FormArrangement["tabs"][number]["sections"] = [];
    for (const s of Array.isArray(tab.sections) ? tab.sections : []) {
      if (!s || typeof s !== "object" || Array.isArray(s) || sections >= MAX_SECTIONS) continue;
      sections++;
      const sec = s as { label?: unknown; fields?: unknown };
      const fields: string[] = [];
      for (const f of Array.isArray(sec.fields) ? sec.fields : []) {
        if (typeof f !== "string" || !FIELD_NAME.test(f) || seen.has(f) || seen.size >= MAX_FIELDS) continue;
        seen.add(f);
        fields.push(f);
      }
      secs.push({ label: label(sec.label) || null, fields });
    }
    out.push({ label: label(tab.label) || "جزئیات", sections: secs });
  }
  return out.length ? { tabs: out } : null;
}
