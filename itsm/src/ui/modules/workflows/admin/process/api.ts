// The calls of the process designer (design F §3.5, §8.4; package F6), over F4c's, F3's and F2's routes:
//   · GET /process/defs/:id — the designer's view: the process (its `version` guards the autosave), the draft, the
//     draft's problems, whether it differs from the published version, open cases, what the caller may do, names —
//     `process_design` read;
//   · PUT /process/defs/:id/draft — the autosave (the draft, and the name, category or description), refused when the
//     process changed since `version`; it answers with the view, its problems checked again — `process_design` write;
//   · GET /process/defs/:id/versions, POST …/versions/:vid/restore — «نسخه‌ها» (read; restore: write);
//   · «انتشار» and «بازنشسته‌کردن» (GET …/diff, POST …/publish, …/retire) are the hub's calls (../hub/api.ts), and the
//     process forms the steps use are «فرم‌ها»' calls (../forms/api.ts: the list, a form's layout and field
//     definitions, a new form, a step's form as a person sees it);
//   · «پیش‌نمایش»: the people of a step for a sample requester (POST /positions/resolve: `process_design` write or `org`
//     write in a unit or wider — the kit's ESTIMATE_GATES);
//   · «جریان خودکار»: the automations the caller reads (/r/flow, area «جریان‌های خودکار»).
// The response types are F4c's and F3's (src/server/modules/process/publish/{service,draft,diff}.ts,
// src/server/modules/positions/{service,resolve}.ts), copied here: the UI imports no server code.
import type { FlowProblem } from "@shared/flows/types";
import type { AssigneeRule, Quorum, StepAction, StepAssignees, ProcessGraph } from "@shared/process";
import type { OrgApi } from "../../../../lib/api";
import { recordsApi } from "../../../../records/data/api";
import type { PublishDiff } from "../hub/api";

/** A process's draft (F4c's `ProcessDraft`): every ✎ setting of the designer lives here. */
export interface ProcessDraft {
  graph: ProcessGraph;
  /** who may start a case (empty: every member) */
  starters: AssigneeRule[];
  title_template: string | null;
  /** fields the requester reads beyond the start form */
  requester_view: string[];
  managers: string[];
  manager_groups: string[];
  confidential: boolean;
}

export type ProcessStatus = "draft" | "published" | "retired";

/** The process row as the designer reads it (no draft; `version` guards the autosave). */
export interface ProcessOut {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  category: string | null;
  description: string | null;
  status: ProcessStatus;
  version_no: number | null;
  current_version_id: string | null;
  published_at: string | null;
  published_by: string | null;
  updated_at: string | null;
  version: number;
}

/** The caller's rights in «طراحی فرم و گردش‌کار». */
export interface DesignRights {
  read: boolean;
  write: boolean;
  create: boolean;
  publish: boolean;
}

/** GET /process/defs/:id (F4c's `ProcessDetail`). */
export interface ProcessDetail {
  process: ProcessOut;
  draft: ProcessDraft;
  problems: FlowProblem[];
  /** the draft differs from the published version */
  unpublished: boolean;
  open_cases: number;
  can: DesignRights;
  /** names of the managers, the groups and the publisher */
  display: Record<string, string>;
}

/** What the autosave sends. */
export interface DraftInput {
  draft: ProcessDraft;
  name?: string;
  icon?: string | null;
  category?: string | null;
  description?: string | null;
  /** the process's version the designer edited */
  version?: number;
}

/** A row of «نسخه‌ها». */
export interface VersionRow {
  id: string;
  version_no: number;
  name: string;
  note: string | null;
  published_by: string | null;
  published_at: string | null;
  confidential: boolean;
  diff: PublishDiff | null;
  current: boolean;
}

/** What «پیش‌نمایش» asks of POST /positions/resolve for one step. */
export interface ResolveBody {
  step: StepAssignees;
  action: StepAction;
  quorum?: Quorum | null;
  label?: string | null;
  requester: string;
  values?: Record<string, unknown>;
  fields?: Record<string, { type: string; ref?: string | null; label?: string | null }>;
  step_actors?: Record<string, string[]>;
  previous_actor?: string | null;
  managers?: string[];
  manager_groups?: string[];
}

/** F3's answer: the step's people (or why there are none), one line per person and their names. */
export interface ResolveResult {
  status: "ok" | "managers" | "nobody" | "too_many";
  people: { user: string; delegatedFrom: string | null; via: { kind: string; position?: string; unit?: string | null; group?: string } }[];
  found: number;
  limit: number;
  fallbackUsed: boolean;
  notes: string[];
  message: string | null;
  warnings: string[];
  lines: string[];
  display: { users: Record<string, string>; positions: Record<string, string>; units: Record<string, string>; groups: Record<string, string> };
}

/** An automation a «جریان خودکار» step may run. */
export interface FlowOption {
  id: string;
  name: string;
  published: boolean;
}

/** React-query keys of the designer (the organisation first). */
export const DESIGNER_KEYS = {
  all: (org: string) => ["wf-designer", org] as const,
  detail: (org: string, id: string) => ["wf-designer", org, "detail", id] as const,
  versions: (org: string, id: string) => ["wf-designer", org, "versions", id] as const,
  flows: (org: string) => ["wf-designer", org, "flows"] as const,
  resolve: (org: string, body: string) => ["wf-designer", org, "resolve", body] as const,
};

const enc = encodeURIComponent;

export const designerApi = {
  detail: (api: OrgApi, id: string) => api.get<ProcessDetail>(`/process/defs/${enc(id)}`),
  save: (api: OrgApi, id: string, body: DraftInput) => api.put<ProcessDetail>(`/process/defs/${enc(id)}/draft`, body),
  versions: (api: OrgApi, id: string) => api.get<{ versions: VersionRow[]; display: Record<string, string> }>(`/process/defs/${enc(id)}/versions`),
  restore: (api: OrgApi, id: string, version: string) => api.post<ProcessDetail>(`/process/defs/${enc(id)}/versions/${enc(version)}/restore`, {}),
  resolve: (api: OrgApi, body: ResolveBody) => api.post<ResolveResult>("/positions/resolve", body),
  /** the automations the caller reads (none when «جریان‌های خودکار» is closed to them) */
  flows: async (api: OrgApi): Promise<FlowOption[]> => {
    const r = await recordsApi.list(api, "flow", { size: 200, fields: ["name", "version_id"], sort: "name", total: false });
    return r.rows.map((f) => ({ id: String(f.id), name: String(f.name ?? ""), published: typeof f.version_id === "string" && !!f.version_id }));
  },
};
