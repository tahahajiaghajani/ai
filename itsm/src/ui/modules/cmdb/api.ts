// Data of the configuration management screens: the module's operations (/cmdb/…: the dependency map, impact analysis
// and what-if, health, the class tree, the CI picker, imports through the reconciliation engine, merge, baselines,
// suggestions, queries, the Windows app's collector) as typed calls and query keys. Light on purpose: the module's
// index imports it; the components load with their pages.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type {
  CiPickerHit, CmdbMeta, CompareResult, HealthSummary, ImpactQuery, ImpactResult, IreInput, IreResult, LocalInventory, MapQuery, MapResult, MergePreview,
} from "@shared/cmdb/api";
import type { ClassInfo } from "@shared/cmdb/logic";
import type { RelTypeInfo } from "@shared/cmdb/logic";
import type { AttrDef, RelRule } from "@shared/cmdb/classes";
import type { HealthResult } from "@shared/cmdb/logic";

export type { CiPickerHit, CmdbMeta, CompareResult, HealthSummary, ImpactQuery, ImpactResult, IreResult, LocalInventory, MapQuery, MapResult, MergePreview };

export const CMDB_KEYS = {
  all: (org: string) => ["cmdb", org] as const,
  meta: (org: string) => ["cmdb", org, "meta"] as const,
  classes: (org: string) => ["cmdb", org, "classes"] as const,
  map: (org: string, q: unknown) => ["cmdb", org, "map", q] as const,
  impact: (org: string, q: unknown) => ["cmdb", org, "impact", q] as const,
  health: (org: string) => ["cmdb", org, "health"] as const,
  picker: (org: string, q: unknown) => ["cmdb", org, "picker", q] as const,
  summary: (org: string, id: string) => ["cmdb", org, "summary", id] as const,
  provenance: (org: string, id: string) => ["cmdb", org, "provenance", id] as const,
  compare: (org: string, id: string, against: string | null) => ["cmdb", org, "compare", id, against] as const,
  local: (org: string, software: boolean) => ["cmdb", org, "local", software] as const,
};
registerLiveQueries("cmdb");

export interface ClassRow extends ClassInfo {
  ancestry: string[];
  all_attrs: AttrDef[];
  all_required: string[];
  all_recommended: string[];
  all_rel_rules: RelRule[];
  all_controlled: string[];
  stale_days_effective: number | null;
  id?: string;
}

export interface ClassesPayload {
  classes: ClassRow[];
  types: RelTypeInfo[];
}

export interface QueryInput {
  class?: string | null;
  condition?: unknown;
  steps?: { type: string; direction: "out" | "in"; class?: string | null; condition?: unknown }[];
  page?: number;
  size?: number;
  fields?: string[];
}

export interface QueryOutput {
  rows: Record<string, unknown>[];
  display: Record<string, string>;
  total: number;
  truncated: boolean;
  steps: { label: string; count: number }[];
}

export interface ProvenanceRow {
  field: string;
  label: string;
  value: unknown;
  set_by: { source: string; name: string; at: string | null } | null;
  locked: boolean;
  observations: { source: string; name: string; value: unknown; at: string }[];
}

export const cmdbApi = {
  meta: (api: OrgApi) => api.get<CmdbMeta>("/cmdb/meta"),
  classes: (api: OrgApi) => api.get<ClassesPayload>("/cmdb/classes"),
  map: (api: OrgApi, q: MapQuery) => api.post<MapResult>("/cmdb/map", q),
  path: (api: OrgApi, from: string, to: string) => api.get<MapResult & { found: boolean }>("/cmdb/path", { from, to }),
  impact: (api: OrgApi, q: ImpactQuery) => api.post<ImpactResult>("/cmdb/impact", q),
  saveImpact: (api: OrgApi, q: ImpactQuery & { name: string; linked_table?: string | null; linked_id?: string | null }) => api.post<{ id: string; summary: string }>("/cmdb/impact/save", q),
  health: (api: OrgApi) => api.get<HealthSummary>("/cmdb/health"),
  runHealth: (api: OrgApi) => api.post<{ queued: boolean }>("/cmdb/health/run"),
  ciHealth: (api: OrgApi, id: string) => api.post<{ health: HealthResult | null }>(`/cmdb/ci/${id}/health`),
  summary: (api: OrgApi, id: string) => api.get<Record<string, unknown>>(`/cmdb/ci/${id}/summary`),
  provenance: (api: OrgApi, id: string) => api.get<{ rows: ProvenanceRow[]; sources: Record<string, string> }>(`/cmdb/ci/${id}/provenance`),
  picker: (api: OrgApi, q: { q?: string; class?: string; mine?: boolean; retired?: boolean; limit?: number }) => api.get<{ hits: CiPickerHit[] }>("/cmdb/picker", q as Record<string, string>),
  items: (api: OrgApi, input: IreInput) => api.post<IreResult>("/cmdb/ire/items", input),
  startRun: (api: OrgApi, input: { name: string; source_id?: string | null; class?: string | null; file_name?: string | null; dry_run?: boolean }) =>
    api.post<{ run: { id: string; number: string | null } }>("/cmdb/import/runs", input),
  batch: (api: OrgApi, runId: string, input: { rows: Record<string, unknown>[]; mapping?: Record<string, string>; default_class?: string | null; dry_run?: boolean }) =>
    api.post<IreResult>(`/cmdb/import/runs/${runId}/batch`, input),
  finishRun: (api: OrgApi, runId: string, error: string | null = null) => api.post<{ run: { id: string; state: string } }>(`/cmdb/import/runs/${runId}/finish`, { error }),
  runSource: (api: OrgApi, id: string) => api.post<{ rows: number; error?: string }>(`/cmdb/sources/${id}/run`),
  mergePreview: (api: OrgApi, survivor: string, absorbed: string[], taskId?: string | null) => api.post<MergePreview>("/cmdb/merge/preview", { survivor, absorbed, task_id: taskId ?? null }),
  merge: (api: OrgApi, survivor: string, absorbed: string[], taskId?: string | null) => api.post<{ task_id: string; survivor: string; absorbed: string[] }>("/cmdb/merge", { survivor, absorbed, task_id: taskId ?? null }),
  undoMerge: (api: OrgApi, taskId: string) => api.post<{ restored: number; skipped: number }>(`/cmdb/merge/${taskId}/undo`),
  snapshot: (api: OrgApi, id: string) => api.post<{ item_count: number; taken_at: string }>(`/cmdb/baselines/${id}/snapshot`),
  compare: (api: OrgApi, id: string, against?: string | null) => api.get<CompareResult>(`/cmdb/baselines/${id}/compare`, against ? { against } : {}),
  drift: (api: OrgApi, id: string) => api.post<{ created: number; existing: number }>(`/cmdb/baselines/${id}/drift`),
  runSuggestions: (api: OrgApi) => api.post<{ proposed: number; pairs: number }>("/cmdb/suggestions/run"),
  acceptSuggestion: (api: OrgApi, id: string, type?: string | null) => api.post<{ state: string; rel_id: string | null }>(`/cmdb/suggestions/${id}/accept`, { type: type ?? null }),
  rejectSuggestion: (api: OrgApi, id: string) => api.post<{ state: string }>(`/cmdb/suggestions/${id}/reject`),
  runRelRules: (api: OrgApi) => api.post<{ created: number; ended: number }>("/cmdb/rel-rules/run"),
  query: (api: OrgApi, q: QueryInput) => api.post<QueryOutput>("/cmdb/query", q),
  wrongCi: (api: OrgApi, input: { table: string; id: string; field?: string; correct_ci_id?: string | null; note?: string | null }) => api.post<{ finding_id: string | null }>("/cmdb/wrong-ci", input),
  localPreview: (api: OrgApi, software: boolean) => api.get<{ inventory: LocalInventory }>("/cmdb/collector/local/preview", { software: software ? "true" : "false" }),
  collectLocal: (api: OrgApi, input: { include_software?: boolean; dry_run?: boolean }) => api.post<{ inventory: LocalInventory; result: IreResult }>("/cmdb/collector/local", input),
  seed: (api: OrgApi) => api.post<{ created: Record<string, number> }>("/cmdb/seed"),
};
