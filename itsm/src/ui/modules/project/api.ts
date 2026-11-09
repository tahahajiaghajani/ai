// Data of the project screens (src/server/routes/project.ts): typed calls and query keys.
import type { OrgApi } from "../../lib/api";
import type { Row } from "./model";

export const PROJECT_KEYS = {
  all: ["project"] as const,
  meta: (org: string) => ["project", org, "meta"] as const,
  portfolio: (org: string, portfolio: string | null) => ["project", org, "portfolio", portfolio] as const,
  demands: (org: string) => ["project", org, "demands"] as const,
  gantt: (org: string, id: string) => ["project", org, "gantt", id] as const,
  resources: (org: string, weeks: number) => ["project", org, "resources", weeks] as const,
};

export const projectApi = {
  meta: (api: OrgApi) => api.get<{ seeded: boolean; manages: boolean; config: { scoring_model: string; capacity: number; status_report_days: number } }>("/project/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>("/project/seed", {}),
  portfolio: (api: OrgApi, portfolio?: string | null) => api.get<Row>("/project/portfolio", portfolio ? { portfolio } : {}),
  demands: (api: OrgApi) => api.get<{ columns: { state: string; label: string; color?: string; items: Row[] }[]; display: Record<string, string> }>("/project/demands/board"),
  convert: (api: OrgApi, id: string, input: Row = {}) => api.post<Row>(`/project/demands/${id}/convert`, input),
  gantt: (api: OrgApi, id: string) => api.get<{ project: Row; tasks: Row[]; display: Record<string, string>; today: string }>(`/project/projects/${id}/gantt`),
  baseline: (api: OrgApi, id: string) => api.post<{ tasks: number }>(`/project/projects/${id}/baseline`),
  recalc: (api: OrgApi, id: string) => api.post<Row>(`/project/projects/${id}/recalc`),
  copy: (api: OrgApi, id: string, name: string, planned_start: string) => api.post<Row>(`/project/projects/${id}/copy`, { name, planned_start }),
  draftStatus: (api: OrgApi, id: string, save = false) => api.post<{ draft: Row; ai: boolean; report?: Row }>(`/project/projects/${id}/status/draft`, { save }),
  resources: (api: OrgApi, weeks: number) => api.get<{ weeks: string[]; capacity: number; people: { user_id: string; weeks: { week: string; hours: number; load: number; over: boolean }[]; peak: number }[]; display: Record<string, string> }>("/project/resources", { weeks }),
  from: (api: OrgApi, table: string, id: string) => api.post<Row>(`/project/from/${table}/${id}`, {}),
};
