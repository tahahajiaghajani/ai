// Data of the flows screens: the API routes the engine's generic record API does not cover (publish, test and manual
// runs, run history, cancel, the built-in approval's decisions, webhook keys, the catalogue of installed services).
// Flows, versions, connections and schedules themselves are records (src/ui/records).
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import type { OrgApi } from "../../lib/api";
import type { FlowGraph, FlowProblem, FlowRunDetail, FlowRunView, RunState } from "@shared/flows";

export const flowKeys = {
  all: (orgId: string) => ["flows", orgId] as const,
  catalog: (orgId: string) => ["flows", orgId, "catalog"] as const,
  runs: (orgId: string, p: RunsQuery) => ["flows", orgId, "runs", p] as const,
  run: (orgId: string, id: string) => ["flows", orgId, "run", id] as const,
};

export interface RunsQuery {
  flow?: string;
  state?: RunState;
  test?: boolean;
  page?: number;
  size?: number;
}

export interface FlowCatalog {
  skills: { key: string; label: string; description: string | null; inputs: { name: string; label: string }[] }[];
  services: { notify: boolean; approval: boolean; ai_skill: boolean };
  limits: { nodes: number; steps: number; items: number; depth: number };
}

export interface RunInput {
  table?: string | null;
  record_id?: string | null;
  inputs?: Record<string, unknown>;
  graph?: FlowGraph;
}

export const flowsApi = {
  catalog: (api: OrgApi) => api.get<FlowCatalog>("/flows/catalog"),
  validate: (api: OrgApi, id: string, graph: FlowGraph) => api.post<{ problems: FlowProblem[] }>(`/flows/${id}/validate`, { graph }),
  publish: (api: OrgApi, id: string, version: number, note?: string) => api.post<{ version: { id: string; version_no: number }; problems: FlowProblem[] }>(`/flows/${id}/publish`, { version, note: note || null }),
  test: (api: OrgApi, id: string, input: RunInput) => api.post<FlowRunDetail>(`/flows/${id}/test`, input),
  run: (api: OrgApi, id: string, input: RunInput) => api.post<FlowRunDetail>(`/flows/${id}/run`, input),
  runs: (api: OrgApi, p: RunsQuery) =>
    api.get<{ runs: FlowRunView[]; total: number; page: number; size: number }>("/flows/runs", {
      ...(p.flow ? { flow: p.flow } : {}),
      ...(p.state ? { state: p.state } : {}),
      ...(p.test !== undefined ? { test: String(p.test) } : {}),
      page: String(p.page ?? 1),
      size: String(p.size ?? 25),
    }),
  run_: (api: OrgApi, id: string) => api.get<FlowRunDetail>(`/flows/runs/${id}`),
  cancel: (api: OrgApi, id: string) => api.post<{ ok: true; state: RunState }>(`/flows/runs/${id}/cancel`),
  decide: (api: OrgApi, waitId: string, decision: "approve" | "reject", comment?: string) => api.post<{ ok: true; final: string | null }>(`/flows/waits/${waitId}/decide`, { decision, comment: comment || null }),
  webhookToken: (api: OrgApi, id: string) => api.post<{ token: string; path: string }>(`/flows/${id}/webhook-token`),
};

export function useFlowCatalog() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: flowKeys.catalog(orgId), queryFn: () => flowsApi.catalog(api), staleTime: 60_000 });
}

export function useRuns(p: RunsQuery) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: flowKeys.runs(orgId, p), queryFn: () => flowsApi.runs(api, p), staleTime: 5_000, refetchInterval: 15_000 });
}

/** A run with its steps; polled every 1.5 s while it runs. */
export function useRun(id: string | null | undefined) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: flowKeys.run(orgId, id ?? ""),
    queryFn: () => flowsApi.run_(api, id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ["running", "waiting"].includes(q.state.data.run.state) ? (q.state.data.run.state === "running" ? 1500 : 10_000) : false),
  });
}
