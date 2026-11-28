// The calls of «فرم‌ها» (design F §8.2, package F5), over F2's and F1's routes:
//   · GET /forms — every form of the system (system, process, catalogue, portal report, surveys, change risk), with
//     links and «editable» per row: `process_design` read or `settings` edit;
//   · process forms — POST /forms, GET|PATCH|DELETE /forms/:id, POST /forms/:id/preview (the designer's rights and
//     sample values in the body): `process_design` read/write or `settings` edit;
//   · a table's default form — PUT /forms/system/:table/overrides (labels, help, placeholders, «پنهان در فرم»,
//     «الزامی برای…» and the arrangement in one transaction: `settings` edit) and GET /forms/system/:table/preview for
//     a viewpoint's field groups and whom the organisation's requirements bind;
//   · the steps that use a form: the processes' drafts and published versions through the generic record API
//     (`process`: `process_design` read; `process_version`: `org` read) until F4c names them on the server;
//   · the UI policies that act on a table's fields (`ui_policy`, area «تنظیمات»).
import type { FieldDef, FieldGroup } from "@shared/model/types";
import type { FormLayoutV2, FormView, Right, StepRights } from "@shared/forms/layout";
import type { RequiredFor } from "@shared/forms/paths";
import type { OrgApi } from "../../../../lib/api";
import { recordsApi } from "../../../../records/data/api";
import type { RecordRow } from "../../../../records/model/types";
import type { OverrideInput } from "../fields/api";

export type FormKind = "system" | "process" | "catalog" | "portal_report" | "survey" | "risk";

/** A row of GET /forms. */
export interface FormEntry {
  key: string;
  kind: FormKind;
  name: string;
  table: string | null;
  group: string;
  id: string | null;
  fields: number;
  overrides?: number;
  arranged?: boolean;
  status?: string;
  version?: number;
  used_in: string[];
  note?: string;
  updated_at: string | null;
  link: string;
  editable: boolean;
}

export interface FormsList {
  kinds: { key: FormKind; label: string; count: number; available: boolean }[];
  forms: FormEntry[];
}

/** A process form as the API returns it. */
export interface FormOut {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version_no: number;
  layout: FormLayoutV2;
  fields: string[];
  published_at: string | null;
  /** published, and the layout changed since */
  changed: boolean;
  updated_at: string | null;
}

export interface FormDetail {
  form: FormOut;
  fields: Record<string, { label: string; type: string; type_label: string; def: FieldDef | null; retired: boolean }>;
  usage: { processes: string[] };
  editable: boolean;
  /** one of the demo pack's forms (release 1.1.5): it leaves whole with the pack */
  demo?: boolean;
}

export interface Viewpoint {
  kind: "me" | "persona" | "member";
  id: string;
  label: string;
  groups: FieldGroup[];
  scope: RequiredFor[];
}

export interface FormPreview {
  form: { id: string; name: string; status: string; version_no: number };
  step: { ref: string | null; label: string | null; rights: StepRights } | null;
  as: Viewpoint;
  rights: Record<string, Right>;
  shown: Record<string, Right>;
  view: FormView;
  fields: Record<string, FieldDef>;
  check: { values: Record<string, unknown>; dropped: string[]; problems: Record<string, string> } | null;
  publish_problems: string[];
}

export interface PreviewBody {
  rights?: StepRights | null;
  as?: string | null;
  values?: Record<string, unknown> | null;
}

export interface SystemPreview {
  table: string;
  as: Viewpoint;
  rights: Record<string, Right>;
  fields: { name: string; label: string; right: Right; required_by: "module" | "organisation" | null }[];
}

/** What PUT /forms/system/:table/overrides takes. */
export interface OverridesBody {
  fields?: Record<string, OverrideInput>;
  /** the tabs, sections and order of the fields; null: back to the default */
  arrangement?: { tabs: { label: string; sections: { label: string | null; fields: string[] }[] }[] } | null;
}

/** A UI policy row, as the inspector lists it. */
export interface PolicyRow {
  id: string;
  name: string;
  active: boolean;
  actions: { field: string; visible?: boolean; mandatory?: boolean; readonly?: boolean }[];
}

/** The processes (drafts) and published versions whose steps may use a form. */
export interface ProcessSources {
  processes: RecordRow[];
  versions: RecordRow[];
}

/** React-query keys of the pages (the organisation first). */
export const FORM_KEYS = {
  all: (org: string) => ["wf-forms", org] as const,
  list: (org: string) => ["wf-forms", org, "list"] as const,
  detail: (org: string, id: string) => ["wf-forms", org, "form", id] as const,
  preview: (org: string, id: string, stamp: string, body: string) => ["wf-forms", org, "preview", id, stamp, body] as const,
  viewpoint: (org: string, table: string, as: string) => ["wf-forms", org, "viewpoint", table, as] as const,
  steps: (org: string) => ["wf-forms", org, "steps"] as const,
  policies: (org: string, table: string) => ["wf-forms", org, "policies", table] as const,
};

const POLICY_FIELDS = ["name", "active", "actions", "table_key"];

export const formsApi = {
  list: (api: OrgApi) => api.get<FormsList>("/forms"),
  create: (api: OrgApi, body: { name: string; description?: string | null }) => api.post<{ form: FormOut }>("/forms", body),
  get: (api: OrgApi, id: string) => api.get<FormDetail>(`/forms/${id}`),
  update: (api: OrgApi, id: string, body: { name?: string; description?: string | null; layout?: FormLayoutV2 }) => api.patch<{ form: FormOut }>(`/forms/${id}`, body),
  remove: (api: OrgApi, id: string) => api.del<{ ok: true }>(`/forms/${id}`),
  preview: (api: OrgApi, id: string, body: PreviewBody) => api.post<FormPreview>(`/forms/${id}/preview`, body),
  systemPreview: (api: OrgApi, table: string, as: string) => api.get<SystemPreview>(`/forms/system/${table}/preview`, { as }),
  saveSystem: (api: OrgApi, table: string, body: OverridesBody) => api.put(`/forms/system/${table}/overrides`, body),
  /** the UI policies of a table (none when the caller may not read them) */
  policies: async (api: OrgApi, table: string): Promise<PolicyRow[]> => {
    const r = await recordsApi.list(api, "ui_policy", { filter: { f: "table_key", op: "eq", v: table }, size: 200, fields: POLICY_FIELDS, total: false, sort: "sort_order,name" });
    return r.rows.map((p) => ({ id: String(p.id), name: String(p.name ?? ""), active: p.active !== false, actions: Array.isArray(p.actions) ? (p.actions as PolicyRow["actions"]) : [] }));
  },
  /** the processes' drafts and their published versions (each part empty when the caller may not read it) */
  processSources: async (api: OrgApi): Promise<ProcessSources> => {
    const processes = await recordsApi
      .list(api, "process", { size: 200, fields: ["name", "key", "draft", "status", "current_version_id"], total: false, sort: "name" })
      .then((r) => r.rows)
      .catch(() => [] as RecordRow[]);
    const current = processes.map((p) => p.current_version_id).filter((v): v is string => typeof v === "string" && !!v);
    const versions = current.length
      ? await recordsApi
          .list(api, "process_version", { ids: current, size: current.length, fields: ["process_id", "name", "version_no", "graph", "steps"], total: false })
          .then((r) => r.rows)
          .catch(() => [] as RecordRow[])
      : [];
    return { processes, versions };
  },
};
