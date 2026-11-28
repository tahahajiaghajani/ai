// The calls of «نقش‌های سازمانی» (design F §3.4, §8, package F5): the overview of positions with current holders, units,
// vacancies and sources (GET /positions/overview: `org` read), positions and their holders through the generic record
// API (/r/position, /r/position_holder: `org` read; writes `org` write where it reaches), the holder import from a
// spreadsheet or an import set (POST /positions/holders/import: `org` create and write in a unit or wider; a dry run
// first) and the preview of a step's people for a sample requester (POST /positions/resolve: `process_design` write or
// `org` write in a unit or wider).
import type { Quorum, StepAction, StepAssignees } from "@shared/process";
import type { OrgApi } from "../../../../lib/api";
import { recordsApi } from "../../../../records/data/api";
import type { DisplayMap, RecordRow } from "../../../../records/model/types";

export interface PositionOverview {
  id: string;
  key: string;
  name: string;
  unit_kind: string | null;
  active: boolean;
  reports_to: string | null;
  /** one of the demo pack's positions (release 1.1.5) */
  demo?: boolean;
  holders: number;
  units: number;
  sources: { manual: number; directory: number; import: number };
  vacancies: number | null;
  ending: number;
}

export interface HolderRow {
  id: string;
  version: number;
  position_id: string;
  user_id: string;
  org_unit_id: string | null;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  source: string;
}

export interface HolderImportResult {
  dry_run: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped: { row: number; message: string }[];
  errors: { row: number; message: string }[];
}

export interface HolderImportInput {
  import_set_id?: string | null;
  rows?: Record<string, unknown>[] | null;
  mode: "merge" | "replace";
  dry_run: boolean;
}

export interface ResolveInput {
  step: StepAssignees;
  action: StepAction;
  quorum?: Quorum | null;
  label?: string | null;
  requester: string;
}

export interface ResolveResult {
  status: "ok" | "managers" | "nobody" | "too_many";
  people: { user: string; delegatedFrom: string | null; via: { kind: string; position?: string; unit?: string | null } }[];
  found: number;
  limit: number;
  fallbackUsed: boolean;
  notes: string[];
  message: string | null;
  warnings: string[];
  lines: string[];
  /** `demo`: the demo pack's people among the people found (lower-case ids; release 1.1.5) */
  display?: { users?: Record<string, string>; demo?: string[] };
}

export const POSITION_KEYS = {
  overview: (org: string) => ["wf-positions", org, "overview"] as const,
  position: (org: string, id: string) => ["wf-positions", org, "position", id] as const,
  holders: (org: string, id: string) => ["wf-positions", org, "holders", id] as const,
  sets: (org: string) => ["wf-positions", org, "import-sets"] as const,
  all: (org: string) => ["wf-positions", org] as const,
};

const HOLDER_FIELDS = ["position_id", "user_id", "org_unit_id", "kind", "valid_from", "valid_to", "source"];

const holderOf = (r: RecordRow): HolderRow => ({
  id: String(r.id),
  version: Number(r.version),
  position_id: String(r.position_id ?? ""),
  user_id: String(r.user_id ?? ""),
  org_unit_id: typeof r.org_unit_id === "string" ? r.org_unit_id : null,
  kind: String(r.kind ?? "primary"),
  valid_from: typeof r.valid_from === "string" ? r.valid_from.slice(0, 10) : null,
  valid_to: typeof r.valid_to === "string" ? r.valid_to.slice(0, 10) : null,
  source: String(r.source ?? "manual"),
});

export const positionsApi = {
  overview: (api: OrgApi) => api.get<{ positions: PositionOverview[]; today: string }>("/positions/overview"),
  /** a position's record, with whether it is one of the demo pack's (`demo`, from the record's meta) */
  position: async (api: OrgApi, id: string): Promise<RecordRow & { demo: boolean }> => {
    const r = await recordsApi.get(api, "position", id);
    return { ...r.row, demo: (r.meta as { demo?: unknown }).demo === true };
  },
  holders: async (api: OrgApi, position: string): Promise<{ rows: HolderRow[]; display: DisplayMap }> => {
    const r = await recordsApi.list(api, "position_holder", { filter: { f: "position_id", op: "eq", v: position }, size: 500, fields: HOLDER_FIELDS, total: false });
    return { rows: r.rows.map(holderOf), display: r.display ?? {} };
  },
  savePosition: (api: OrgApi, id: string | null, data: Record<string, unknown>, version?: number) =>
    id ? recordsApi.update(api, "position", id, data, version) : recordsApi.create(api, "position", data),
  saveHolder: (api: OrgApi, id: string | null, data: Record<string, unknown>, version?: number) =>
    id ? recordsApi.update(api, "position_holder", id, data, version) : recordsApi.create(api, "position_holder", data),
  removeHolder: (api: OrgApi, id: string, version: number) => recordsApi.remove(api, "position_holder", id, version),
  importHolders: (api: OrgApi, body: HolderImportInput) => api.post<HolderImportResult>("/positions/holders/import", body),
  /** import sets whose target is the holders table (`settings` read) */
  importSets: async (api: OrgApi) =>
    (await recordsApi.list(api, "import_set", { filter: { f: "target_table", op: "eq", v: "position_holder" }, size: 50, fields: ["name", "status", "last_run_at"], total: false })).rows.map((r) => ({ id: String(r.id), name: String(r.name ?? "") })),
  resolve: (api: OrgApi, body: ResolveInput) => api.post<ResolveResult>("/positions/resolve", body),
};
