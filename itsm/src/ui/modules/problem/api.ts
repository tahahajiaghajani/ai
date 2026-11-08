// Data of the problem screens: the module's operations (/problem/…: a problem from incidents, linking incidents,
// merging duplicates, sharing the workaround or fix, a known error from a problem, a task's findings, the candidate
// rules and their outcome, the dashboard) as typed calls. Light on purpose: the module's index imports it.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type { Outcome, ProblemDashboard } from "@shared/incident/api";

export type { Outcome, ProblemDashboard };

export const PROBLEM_KEYS = {
  all: (org: string) => ["problem", org] as const,
  dashboard: (org: string, days: number) => ["problem", org, "dashboard", days] as const,
};
registerLiveQueries("problem");

export const problemApi = {
  dashboard: (api: OrgApi, days: number) => api.get<ProblemDashboard>("/problem/dashboard", { days }),
  fromIncidents: (api: OrgApi, incident_ids: string[]) => api.post<{ problem: { id: string; number: string } } & Outcome>("/problem/from-incidents", { incident_ids }),
  link: (api: OrgApi, id: string, incident_ids: string[], unlink = false) => api.post<Outcome>(`/problem/${id}/link-incidents`, { incident_ids, unlink }),
  merge: (api: OrgApi, id: string, ids: string[]) => api.post<Outcome>(`/problem/${id}/merge`, { ids }),
  share: (api: OrgApi, id: string, kind: "workaround" | "fix", audience: "agents" | "callers") => api.post<{ incidents: number }>(`/problem/${id}/share`, { kind, audience }),
  knownError: (api: OrgApi, id: string) => api.post<{ row: { id: string; number: string } }>(`/problem/${id}/known-error`),
  copyFindings: (api: OrgApi, taskId: string) => api.post(`/problem/tasks/${taskId}/copy-findings`),
  runCandidates: (api: OrgApi) => api.post<{ created: number; updated: number; skipped: number }>("/problem/candidates/run"),
  promote: (api: OrgApi, id: string) => api.post<{ problem: { id: string; number: string } } & Outcome>(`/problem/candidates/${id}/promote`, {}),
  mergeCandidate: (api: OrgApi, id: string, problem_id: string) => api.post<Outcome>(`/problem/candidates/${id}/merge`, { problem_id }),
  ai: (api: OrgApi, id: string, skill: string) => api.post(`/problem/${id}/ai/${skill}`, {}),
};
