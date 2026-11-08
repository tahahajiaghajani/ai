// Data of the AI skills screens (contracts: src/shared/ai/skills.ts): the record panel's skills and open proposals, a
// run (with a stream for long text), the member's own runs and feedback, proposals applied or refused, and the admin
// «مهارت‌ها». Light: imported by the record extensions registered for every table.
import { useQuery } from "@tanstack/react-query";
import type { AiProposal } from "@shared/ai/types";
import type {
  SkillAdminItem, SkillAdminView, SkillCard, SkillConfigPatch, SkillEvalCase, SkillEvalView, SkillRunRequest, SkillRunResult, SkillRunView, SkillStreamEvent, SkillUsageRow, SkillVersionView,
} from "@shared/ai/skills";
import type { OrgApi } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { useOrg } from "../../lib/org";
import { readFrames } from "../client";

export const SKILL_KEYS = {
  record: (org: string, table: string, id: string) => ["ai-skills", org, "record", table, id] as const,
  text: (org: string) => ["ai-skills", org, "text"] as const,
  runs: (org: string, table: string | null, id: string | null) => ["ai-skills", org, "runs", table ?? "*", id ?? "*"] as const,
  admin: (org: string) => ["ai-skills", org, "admin"] as const,
  usage: (org: string, from: string, to: string) => ["ai-skills", org, "usage", from, to] as const,
};

const enc = encodeURIComponent;

export const skillsApi = {
  forRecord: (api: OrgApi, table: string, id: string) => api.get<{ skills: SkillCard[]; proposals: AiProposal[] }>(`/ai/skills/for/${enc(table)}/${enc(id)}`),
  text: (api: OrgApi) => api.get<{ skills: SkillCard[] }>("/ai/skills/text"),
  run: (api: OrgApi, key: string, req: SkillRunRequest) => api.post<SkillRunResult>(`/ai/skills/${enc(key)}/run`, req),
  runs: (api: OrgApi, q: { table?: string | null; id?: string | null; all?: boolean; limit?: number }) =>
    api.get<{ runs: SkillRunView[] }>("/ai/skills/runs", { table: q.table ?? undefined, id: q.id ?? undefined, all: q.all ? "1" : undefined, limit: q.limit }),
  feedback: (api: OrgApi, runId: string, rating: 1 | -1 | null, comment?: string | null) => api.post(`/ai/skills/runs/${enc(runId)}/feedback`, { rating, comment: comment ?? null }),
  confirm: (api: OrgApi, proposalId: string) => api.post<{ proposal: AiProposal }>(`/ai/actions/${enc(proposalId)}/confirm`, {}),
  reject: (api: OrgApi, proposalId: string, reason?: string) => api.post<{ proposal: AiProposal }>(`/ai/actions/${enc(proposalId)}/reject`, reason ? { reason } : {}),
  admin: (api: OrgApi) => api.get<SkillAdminView>("/ai/skills/admin"),
  patch: (api: OrgApi, key: string, patch: SkillConfigPatch) => api.patch<{ skill: SkillAdminItem }>(`/ai/skills/admin/${enc(key)}`, patch),
  saveVersion: (api: OrgApi, key: string, v: { system: string; template: string; output_schema?: unknown; temperature?: number | null; max_tokens?: number | null; note: string }) =>
    api.post<{ version: SkillVersionView }>(`/ai/skills/admin/${enc(key)}/versions`, v),
  publish: (api: OrgApi, key: string, versionId: string | null) => api.post<{ skill: SkillAdminItem }>(`/ai/skills/admin/${enc(key)}/publish`, { version_id: versionId }),
  copy: (api: OrgApi, key: string, input: { key: string; name: string }) => api.post<{ skill: SkillAdminItem }>(`/ai/skills/admin/${enc(key)}/copy`, input),
  test: (api: OrgApi, key: string, req: SkillRunRequest & { version_id?: string | null }) => api.post<SkillRunResult>(`/ai/skills/admin/${enc(key)}/test`, req),
  saveEval: (api: OrgApi, key: string, input: { id?: string | null; name: string; cases: SkillEvalCase[] }) => api.post<{ eval: SkillEvalView }>(`/ai/skills/admin/${enc(key)}/evals`, input),
  runEvals: (api: OrgApi, key: string, evalId?: string | null) => api.post<{ evals: SkillEvalView[] }>(`/ai/skills/admin/${enc(key)}/evals/run`, { eval_id: evalId ?? null }),
  usage: (api: OrgApi, from: string, to: string) => api.get<{ rows: SkillUsageRow[] }>("/ai/skills/admin/usage", { from, to }),
  principal: (api: OrgApi, roles: string[], active = true) => api.post<{ principal: SkillAdminView["principal"] }>("/ai/skills/admin/principal", { roles, active }),
};

/** A run whose text arrives as it is written; resolves with the final result (throws ApiError on a refusal). */
export async function runStream(api: OrgApi, key: string, req: SkillRunRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<SkillRunResult> {
  const res = await api.stream(`/ai/skills/${enc(key)}/run/stream`, req, signal);
  let result: SkillRunResult | null = null;
  for await (const f of readFrames(res.body!, undefined, signal)) {
    let ev: SkillStreamEvent;
    try {
      ev = JSON.parse(f.data) as SkillStreamEvent;
    } catch {
      continue;
    }
    if (ev.type === "text") onText(ev.delta);
    else if (ev.type === "done") result = ev.result;
    else if (ev.type === "error") throw new ApiError(ev.needs_settings ? 403 : 400, ev.kind, ev.message_fa);
  }
  if (!result) throw new ApiError(0, "network", "پاسخ کامل نرسید؛ دوباره امتحان کنید");
  return result;
}

export function useRecordSkills(table: string, id: string, enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SKILL_KEYS.record(orgId, table, id), queryFn: () => skillsApi.forRecord(api, table, id), enabled: enabled && !!id, staleTime: 30_000 });
}

export function useTextSkills(enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SKILL_KEYS.text(orgId), queryFn: () => skillsApi.text(api), enabled, staleTime: 60_000 });
}

export function useOwnRuns(table: string | null, id: string | null, enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SKILL_KEYS.runs(orgId, table, id), queryFn: () => skillsApi.runs(api, { table, id, limit: 20 }), enabled });
}
