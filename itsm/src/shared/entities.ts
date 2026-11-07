// Master-data entities described once and used everywhere: the server validates and stores them through
// one generic CRUD (src/server/modules/data/crud.ts, /api/o/:org/data/:entity), the UI builds list pages,
// forms, pickers and spreadsheet imports from the same fields (src/ui/components/data.tsx).
//
// The platform defines none yet. A module adds its master data (categories, locations, services…) as
// entries of ENTITIES with a table of its own (org_id, deleted_at and the fields below; add the sync
// columns, a trigger and a registry entry when the table synchronises with the Windows app).
import type { Area } from "./permissions";
import type { ModuleKey } from "./constants";

export type FieldType =
  | "text" | "textarea" | "int" | "decimal" | "money" | "pct" | "bool" | "date"
  | "select" | "multiselect" | "ref" | "json" | "image" | "code";

export interface Option {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Option[];
  ref?: string; // entity key for "ref"
  refFilter?: Record<string, string>;
  default?: unknown;
  list?: boolean; // column in the list table
  search?: boolean; // matched by the search box
  filter?: boolean; // offered as a list filter
  format?: "nationalId" | "iban" | "card" | "mobile" | "email" | "postal" | "economic";
  maxLength?: number;
  span?: 6 | 8 | 12 | 16 | 18 | 24; // form grid span (of 24)
  section?: string;
  help?: string;
  ltr?: boolean;
  hidden?: boolean; // stored but not shown in forms
  readonly?: boolean;
  modules?: ModuleKey[];
}

export interface EntityDef {
  key: string;
  table: string;
  title: string;
  plural: string;
  area: Area;
  modules?: ModuleKey[];
  fields: FieldDef[];
  display: string;
  sub?: string;
  code?: { field: string; start: number };
  order: string;
  icon?: string;
  /** a spreadsheet import may create a missing row of this entity from its name alone (categories, locations…) */
  autoCreate?: boolean;
}

/** A field every list of master data may share: «فعال». */
export const ACTIVE_FIELD: FieldDef = { name: "is_active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 };

/** An automatic code field («خالی بگذارید تا خودکار پر شود»), numbered from `start`. */
export const codeField = (start = 1): FieldDef => ({ name: "code", label: "کد", type: "code", list: true, search: true, span: 6, ltr: true, help: `خالی بگذارید تا خودکار پر شود (از ${start})` });

/** Every entity of the app, by key. Modules add theirs. */
export const ENTITIES: Record<string, EntityDef> = {};

export function entity(key: string): EntityDef | undefined {
  return ENTITIES[key];
}

/** Fields available for an organisation's enabled modules. */
export function fieldsFor(def: EntityDef, modules: ModuleKey[]): FieldDef[] {
  return def.fields.filter((f) => !f.modules || f.modules.some((m) => modules.includes(m)));
}

/** Fields a spreadsheet import can fill (images and raw JSON are left to the form). */
export function importFields(def: EntityDef, modules: ModuleKey[]): FieldDef[] {
  return fieldsFor(def, modules).filter((f) => !f.readonly && !f.hidden && f.type !== "image" && f.type !== "json");
}
