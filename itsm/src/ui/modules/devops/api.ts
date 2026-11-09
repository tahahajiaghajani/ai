// Data of the DevOps screens (src/server/routes/devops.ts): typed calls and query keys.
import type { OrgApi } from "../../lib/api";
import type { DoraMetrics } from "@shared/devops/logic";
import type { Row } from "./model";

export const DEVOPS_KEYS = {
  all: ["devops"] as const,
  meta: (org: string) => ["devops", org, "meta"] as const,
  dora: (org: string, days: number, service: string | null) => ["devops", org, "dora", days, service] as const,
  pipeline: (org: string, days: number) => ["devops", org, "pipeline", days] as const,
  dev: (org: string, table: string, id: string) => ["devops", org, "dev", table, id] as const,
};

export interface DoraView {
  days: number;
  overall: DoraMetrics;
  services: (Omit<DoraMetrics, "weekly"> & { service: string | null })[];
  velocity: { deployments: number; from_pipelines: number; with_change: number; manual: number };
  definitions: Record<string, { name: string; formula: string; unit: string }>;
  display: Record<string, string>;
}

export const devopsApi = {
  meta: (api: OrgApi) => api.get<{ seeded: boolean; manages: boolean; hook_path: string; gate_path: string; demo: string }>("/devops/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>("/devops/seed", {}),
  secret: (api: OrgApi, id: string) => api.post<{ secret: string; hook_url: string; gate_url: string }>(`/devops/connections/${id}/secret`),
  rotateKey: (api: OrgApi, id: string) => api.post<{ hook_key: string; hook_url: string }>(`/devops/connections/${id}/rotate-key`),
  test: (api: OrgApi, id: string) => api.post<{ ok: boolean; status?: string; message?: string }>(`/devops/connections/${id}/test`),
  retry: (api: OrgApi, id: string) => api.post<{ status: string; message?: string }>(`/devops/events/${id}/retry`),
  dora: (api: OrgApi, days: number, service?: string | null) => api.get<DoraView>("/devops/dora", { days, ...(service ? { service } : {}) }),
  pipeline: (api: OrgApi, days: number) => api.get<{ environments: Row[]; rows: Row[]; display: Record<string, string> }>("/devops/pipeline", { days }),
  development: (api: OrgApi, table: string, id: string) => api.get<{ number: string | null; commits: Row[]; pull_requests: Row[]; builds: Row[]; deployments: Row[]; display: Record<string, string> }>(`/devops/records/${table}/${id}/development`),
  decideGate: (api: OrgApi, id: string, decision: string, reason?: string) => api.post<Row>(`/devops/gates/${id}/decide`, { decision, ...(reason ? { reason } : {}) }),
  verifyGates: (api: OrgApi) => api.get<{ ok: boolean; checked: number; broken: string | null }>("/devops/gates/verify"),
};
