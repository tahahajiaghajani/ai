// Data of the release screens (src/server/routes/release.ts): typed calls and query keys. Light on purpose: the
// module's index imports it; the components live in lazily loaded pages.
import type { OrgApi } from "../../lib/api";
import type { Row } from "./model";

export const RELEASE_KEYS = {
  all: ["release"] as const,
  meta: (org: string) => ["release", org, "meta"] as const,
  roadmap: (org: string, q: Record<string, unknown>) => ["release", org, "roadmap", q] as const,
  board: (org: string) => ["release", org, "board"] as const,
  dashboard: (org: string, days: number) => ["release", org, "dashboard", days] as const,
  record: (org: string, id: string, what: string, extra?: unknown) => ["release", org, "record", id, what, extra ?? null] as const,
};

export interface ReleaseMeta {
  seeded: boolean;
  manages: boolean;
  config: { els_days: number; failure_window_hours: number; auto_advance: boolean; release_on_production: boolean; dora_days: number };
}

export interface Readiness {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  waived: number;
  pct: number;
  blockers: string[];
  ready: boolean;
}

export interface Band {
  id: string;
  start: string;
  end: string;
  label: string;
  kind: string;
  title?: string;
}

const rec = (id: string) => `/release/records/${id}`;

export const releaseApi = {
  meta: (api: OrgApi) => api.get<ReleaseMeta>("/release/meta"),
  seed: (api: OrgApi, force = false) => api.post<{ skipped: boolean; created: Record<string, number> }>("/release/seed", { force }),
  roadmap: (api: OrgApi, q: { from: string; to: string; type?: string; service?: string }) => api.get<{ releases: Row[]; bands: Band[]; display: Record<string, string>; timezone: string; unscheduled?: number }>("/release/roadmap", q),
  board: (api: OrgApi) => api.get<{ releases: (Row & { checks: Row[]; readiness: Readiness })[]; display: Record<string, string> }>("/release/board"),
  dashboard: (api: OrgApi, days: number) => api.get<Row>("/release/dashboard", { days }),
  overview: (api: OrgApi, id: string) => api.get<Row>(`${rec(id)}/overview`),
  runChecks: (api: OrgApi, id: string) => api.post<{ readiness: Readiness; checks: Row[] }>(`${rec(id)}/checks/run`),
  verdict: (api: OrgApi, id: string, result: string, status: string, evidence?: string) => api.post<Row>(`${rec(id)}/checks/${result}/verdict`, { status, ...(evidence ? { evidence } : {}) }),
  waive: (api: OrgApi, id: string, result: string, reason: string) => api.post<Row>(`${rec(id)}/checks/${result}/waive`, { reason }),
  decide: (api: OrgApi, id: string, input: { decision: string; rationale: string; conditions?: string | null; return_to?: string }) => api.post<{ decision: Row; release: Row }>(`${rec(id)}/decide`, input),
  changeFor: (api: OrgApi, id: string) => api.post<Row>(`${rec(id)}/change`),
  addScope: (api: OrgApi, id: string, table: string, ids: string[]) => api.post<{ added: string[]; skipped: { id: string; reason: string }[] }>(`${rec(id)}/scope`, { table, ids }),
  draftNotes: (api: OrgApi, id: string, audience: string, save = false) => api.post<{ title: string; body: string; ai: boolean; note?: Row }>(`${rec(id)}/notes/draft`, { audience, save }),
  briefing: (api: OrgApi, id: string) => api.post<{ text: string; ai: boolean }>(`${rec(id)}/briefing`),
  risk: (api: OrgApi, id: string) => api.get<{ score: number | null; band: string | null; factors: Row[]; explanation: string }>(`${rec(id)}/risk`),
  recalc: (api: OrgApi, id: string) => api.post<Row>(`${rec(id)}/recalc`),
  deploymentNarrative: (api: OrgApi, id: string) => api.post<{ text: string; band: string; ai: boolean }>(`/release/deployments/${id}/narrative`),
};
