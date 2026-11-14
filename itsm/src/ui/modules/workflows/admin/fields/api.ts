// The calls of «فیلدها» (design F §8.1, package F5): the field library and the organisation's field types (F1's routes
// /fields/library and /fields/types: `process_design` read or `settings` edit; writes `process_design` write or
// `settings` edit), the creation paths a requirement binds (/fields/paths/:table), attaching a library field to a table
// (/fields/attach: `settings` edit), the default form's overrides of a table (PUT /forms/system/:table/overrides:
// `settings` edit) and the organisation's money unit (/financial/meta, every member). The rows a sheet edits are read
// whole through the generic record API (/r/field_def/:id, /r/field_type/:id); choice lists and table-only fields keep
// the generic API of `choice` and `custom_field`, as before.
import type { FieldType, Option } from "@shared/model/types";
import type { FieldTypeGroup, FieldTypeSettings, SettingKey, Widget } from "@shared/forms/fieldtypes";
import type { CreationPath, PathEffect, RequiredFor } from "@shared/forms/paths";
import type { MoneyUnit } from "@shared/financial/logic";
import type { OrgApi } from "../../../../lib/api";
import { recordsApi } from "../../../../records/data/api";
import type { RecordRow } from "../../../../records/model/types";

/** Where a library field is used: tables it is attached to, forms and published versions (names). */
export interface FieldUsage {
  tables: string[];
  forms: string[];
  versions: string[];
}

/** A row of GET /fields/library. */
export interface LibraryEntry {
  id: string;
  name: string;
  label: string;
  type: string;
  type_label: string;
  storage: FieldType | null;
  group: FieldTypeGroup | null;
  field_group: string | null;
  status: string;
  help: string | null;
  placeholder: string | null;
  usage: FieldUsage;
}

/** A built-in type of GET /fields/types. */
export interface BuiltinTypeEntry {
  key: string;
  label: string;
  group: FieldTypeGroup;
  storage: FieldType;
  widget: Widget;
  settings: FieldTypeSettings & { widget: Widget };
  editable: SettingKey[];
  /** its fixed target table exists (the «نقش سازمانی» type needs the positions) */
  available: boolean;
  fields: number;
}

/** An organisation's type of GET /fields/types (its settings resolved on top of its base). */
export interface OrgTypeEntry {
  id: string;
  key: string;
  name: string;
  base: string;
  base_label: string;
  storage: FieldType | null;
  widget: Widget | null;
  settings: (FieldTypeSettings & { widget: Widget }) | null;
  status: string;
  description: string | null;
  fields: number;
}

export interface TypesResult {
  groups: Record<FieldTypeGroup, string>;
  builtin: BuiltinTypeEntry[];
  types: OrgTypeEntry[];
}

export interface PathsResult {
  table: string;
  required_for: RequiredFor;
  paths: CreationPath[];
  effects: PathEffect[];
  blockers: string[];
}

/** What PUT /forms/system/:table/overrides takes for one field. */
export interface OverrideInput {
  label?: string | null;
  help?: string | null;
  placeholder?: string | null;
  form_hidden?: boolean;
  required?: boolean;
  required_for?: RequiredFor | null;
}

export interface AttachInput {
  table: string;
  field: string;
  section?: string | null;
  required?: boolean;
  required_for?: RequiredFor | null;
  form_hidden?: boolean;
}

/** React-query keys of the page (the organisation first). */
export const FIELD_KEYS = {
  library: (org: string) => ["wf-fields", org, "library"] as const,
  types: (org: string) => ["wf-fields", org, "types"] as const,
  row: (org: string, table: string, id: string) => ["wf-fields", org, "row", table, id] as const,
  paths: (org: string, table: string, rf: RequiredFor) => ["wf-fields", org, "paths", table, rf] as const,
  unit: (org: string) => ["wf-fields", org, "unit"] as const,
  all: (org: string) => ["wf-fields", org] as const,
};

export const fieldsApi = {
  library: (api: OrgApi) => api.get<{ fields: LibraryEntry[] }>("/fields/library"),
  types: (api: OrgApi) => api.get<TypesResult>("/fields/types"),
  /** a whole row of `field_def` or `field_type` (the sheet edits every column) */
  row: async (api: OrgApi, table: "field_def" | "field_type", id: string): Promise<RecordRow> => (await recordsApi.get(api, table, id)).row,
  saveField: (api: OrgApi, id: string | null, data: Record<string, unknown>) =>
    id ? api.patch<{ row: RecordRow }>(`/fields/library/${id}`, data) : api.post<{ row: RecordRow }>("/fields/library", data),
  saveType: (api: OrgApi, id: string | null, data: Record<string, unknown>) =>
    id ? api.patch<{ row: RecordRow }>(`/fields/types/${id}`, data) : api.post<{ row: RecordRow }>("/fields/types", data),
  paths: (api: OrgApi, table: string, requiredFor: RequiredFor) => api.get<PathsResult>(`/fields/paths/${table}`, { required_for: requiredFor }),
  attach: (api: OrgApi, body: AttachInput) => api.post<{ row: RecordRow }>("/fields/attach", body),
  overrides: (api: OrgApi, table: string, fields: Record<string, OverrideInput>) => api.put(`/forms/system/${table}/overrides`, { fields }),
  /** the organisation's money unit (financial settings `currency_display`); Rials when it cannot be read */
  moneyUnit: (api: OrgApi): Promise<MoneyUnit> =>
    api
      .get<{ currency_display?: MoneyUnit }>("/financial/meta")
      .then((m) => (m.currency_display === "toman" ? "toman" : "rial"))
      .catch(() => "rial" as const),
};

export type { Option };
