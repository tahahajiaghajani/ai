// Data of the agent studio and the proposals inbox (contracts: src/shared/ai/agents.ts, docs/spec/AI.md §11.8).
import type { AgentAdminItem, AgentAdminView, AgentCard, AgentConfigPatch, AgentRunView, AgentStartResult, AgentTestResult, AgentToolOption } from "@shared/ai/agents";
import type { AiActionView } from "@shared/ai/api";
import type { OrgApi } from "../../lib/api";

export const AGENT_KEYS = {
  admin: (org: string) => ["ai-agents", org, "admin"] as const,
  tools: (org: string, key: string) => ["ai-agents", org, "tools", key] as const,
  runs: (org: string, agent: string | null) => ["ai-agents", org, "runs", agent ?? "*"] as const,
  run: (org: string, id: string) => ["ai-agents", org, "run", id] as const,
  inbox: (org: string, status: string) => ["ai-agents", org, "inbox", status] as const,
};

const enc = encodeURIComponent;

export const agentsApi = {
  admin: (api: OrgApi) => api.get<AgentAdminView>("/ai/agents/admin"),
  patch: (api: OrgApi, key: string, patch: AgentConfigPatch) => api.patch<{ agent: AgentAdminItem }>(`/ai/agents/admin/${enc(key)}`, patch),
  create: (api: OrgApi, input: { key: string; name: string; from?: string | null }) => api.post<{ agent: AgentAdminItem }>("/ai/agents/admin", input),
  remove: (api: OrgApi, key: string) => api.del<{ ok: true }>(`/ai/agents/admin/${enc(key)}`),
  reset: (api: OrgApi, key: string) => api.post<{ agent: AgentAdminItem }>(`/ai/agents/admin/${enc(key)}/reset`, {}),
  principal: (api: OrgApi, key: string, roles: string[], active = true) => api.post<{ agent: AgentAdminItem }>(`/ai/agents/admin/${enc(key)}/principal`, { roles, active }),
  tools: (api: OrgApi, key: string) => api.get<{ tools: AgentToolOption[] }>(`/ai/agents/admin/${enc(key)}/tools`),
  test: (api: OrgApi, key: string, input: { table?: string | null; id?: string | null }) => api.post<AgentTestResult>(`/ai/agents/admin/${enc(key)}/test`, input),
  setSwitch: (api: OrgApi, on: boolean) => api.put<{ agents_on: boolean }>("/ai/agents/admin/switch", { on }),
  runs: (api: OrgApi, q: { agent?: string | null; limit?: number } = {}) => api.get<{ runs: AgentRunView[] }>("/ai/agents/runs", { agent: q.agent ?? undefined, limit: q.limit }),
  run: (api: OrgApi, id: string) => api.get<{ run: AgentRunView }>(`/ai/agents/runs/${enc(id)}`),
  stop: (api: OrgApi, id: string) => api.post<{ run: AgentRunView }>(`/ai/agents/runs/${enc(id)}/stop`, {}),
  forTable: (api: OrgApi, table: string | null) => api.get<{ agents: AgentCard[] }>("/ai/agents/for", { table: table ?? undefined }),
  start: (api: OrgApi, key: string, input: { table?: string | null; id?: string | null }) => api.post<AgentStartResult>(`/ai/agents/${enc(key)}/start`, input),
  inbox: (api: OrgApi, status?: string) => api.get<{ actions: AiActionView[] }>("/ai/actions", { inbox: "1", status: status || undefined, limit: 100 }),
  inboxCount: async (api: OrgApi) => (await api.get<{ actions: AiActionView[] }>("/ai/actions", { inbox: "1", status: "proposed", limit: 200 })).actions.filter((a) => a.can_decide).length,
};
