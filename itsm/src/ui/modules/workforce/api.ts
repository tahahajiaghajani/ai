// Data of the workforce screens (src/server/routes/workforce.ts): typed calls and query keys. The shapes mirror the
// server modules' views (agent home, team board, capacity heatmap, performance, routing suggestions).
import type { AtRiskItem } from "@shared/slm/api";
import type { AgentMetrics, LabourIssue, RoutingCandidate, UtilBand } from "@shared/workforce/logic";
import type { OrgApi } from "../../lib/api";

export interface HomeItem { table: string; table_label: string; id: string; number: string | null; title: string; priority: string | null; state: string | null; state_label: string | null; sla_due: string | null; updated_at: string | null; stale_days: number | null }
export interface AgentHomeView {
  presence: { state: string; since: string | null; note: string | null; leaderboard: boolean; wip_limit: number | null };
  shift: { on: boolean | null; left_minutes: number | null; pattern: string | null; today: { start: string; end: string }[] };
  work: { items: HomeItem[]; total: number; by_table: { table: string; label: string; count: number }[] };
  queue: HomeItem[];
  at_risk: AtRiskItem[];
  recent: { table: string; table_label: string; id: string; number: string | null; title: string; at: string }[];
  next: { kind: string; title: string; reason: string; table: string | null; id: string | null; source: "rules" | "ai" };
  points: { month: number; total: number; level: { label: string; index: number; next: number | null; progress: number }; badges: { key: string; label: string }[]; recent: { reason: string; points: number; record_number: string | null; at: string | null }[] };
  kudos: { from: string | null; message: string; at: string | null }[];
  absences: { id: string; number: string | null; label: string; state: string; start_at: string | null; end_at: string | null }[];
  certifications: { id: string; name: string; expires_at: string | null; days: number | null }[];
}
export interface BoardCell { date: string; code: string | null; color: string | null; hours: number; absent: boolean; absence: string | null }
export interface TeamBoardView {
  group: { id: string; name: string };
  days: { date: string; weekday: string; holiday: string | null }[];
  people: { user_id: string; name: string; me: boolean; cells: BoardCell[] }[];
  coverage: { date: string; staff: number; min: number; gap: boolean }[];
  issues: LabourIssue[];
  can_manage: boolean;
}
export interface HeatCell { date: string; forecast: number; lower: number; upper: number; staff: number; capacity: number; required: number; utilisation: number | null; band: UtilBand; holiday: boolean }
export interface HeatRow { group_id: string; name: string; members: number; open: number; unassigned: number; load_pct: number | null; load_band: UtilBand; throughput: number; mape: number | null; cells: HeatCell[]; people: { user_id: string; name: string; open: number; limit: number; pct: number | null; band: UtilBand }[] | null }
export interface CapacityView { from: string; days: { date: string; weekday: number; holiday: string | null }[]; rows: HeatRow[]; all: boolean }
export interface TeamPerformance { group_id: string; name: string; members: number; suppressed: boolean; metrics: AgentMetrics | null; people: { user_id: string; name: string; metrics: AgentMetrics }[] | null; people_restricted: boolean }
export interface PerformanceView { period: { label: string; key: string }; me: AgentMetrics | null; person: { user_id: string; name: string; metrics: AgentMetrics } | null; teams: TeamPerformance[]; can: { individuals: boolean } }
export interface Suggestion { required: { skill_id: string; name: string; level: number; why: string }[]; candidates: (RoutingCandidate & { name: string })[]; group_id: string | null }
export interface MySkill { id: string; skill_id: string; label: string | null; level: number; source: string; status: string; verified: boolean; expires_at: string | null; evidence: string | null }
export interface CoverageRow { id: string; label: string; group_id: string | null; skill_id: string; skill: string; min_level: number; min_people: number; critical: boolean; qualified: { user_id: string; name: string; level: number }[]; gap: number; single_point: boolean }
export interface Leaderboard { enabled: boolean; period: string; teams: { group_id: string; name: string; points: number; members: number }[]; people: { user_id: string; name: string; points: number; me: boolean }[] }
export interface MyAbsence { id: string; number: string | null; type: string; label: string | null; state: string; approval: string | null; start_at: string; end_at: string; days: string | null; delegate_id: string | null; note: string | null; reject_reason: string | null }
export interface WorkforceMeta { seeded: boolean; manages: boolean; oversees: { all: boolean; groups: string[] }; my_groups: string[]; config: { idle_minutes: number; leaderboard_enabled: boolean; team_min_size: number; forecast_days: number } }

export const WFM_KEYS = {
  all: ["workforce"] as const,
  meta: (org: string) => ["workforce", org, "meta"] as const,
  home: (org: string) => ["workforce", org, "home"] as const,
  board: (org: string, group: string, from: string, days: number) => ["workforce", org, "board", group, from, days] as const,
  capacity: (org: string, from: string, days: number) => ["workforce", org, "capacity", from, days] as const,
  performance: (org: string, q: unknown) => ["workforce", org, "performance", q] as const,
  routing: (org: string, table: string, id: string) => ["workforce", org, "routing", table, id] as const,
  skills: (org: string) => ["workforce", org, "skills"] as const,
  catalogue: (org: string) => ["workforce", org, "catalogue"] as const,
  coverage: (org: string, group: string | null) => ["workforce", org, "coverage", group] as const,
  leaderboard: (org: string, group: string | null) => ["workforce", org, "leaderboard", group] as const,
  absences: (org: string) => ["workforce", org, "absences"] as const,
  experts: (org: string, skill: string, level: number) => ["workforce", org, "experts", skill, level] as const,
  groups: (org: string, ids: string[]) => ["workforce", org, "groups", ids.join(",")] as const,
};

export const wfmApi = {
  meta: (api: OrgApi) => api.get<WorkforceMeta>("/workforce/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean }>("/workforce/seed", {}),
  home: (api: OrgApi) => api.get<AgentHomeView>("/workforce/home"),
  presence: (api: OrgApi, state: string, note?: string | null) => api.post<{ presence: string }>("/workforce/presence", { state, note: note ?? null }),
  heartbeat: (api: OrgApi, idleMs: number) => api.post<{ presence: string; auto_away: boolean }>("/workforce/heartbeat", { idle_ms: idleMs }),
  prefs: (api: OrgApi, prefs: { leaderboard?: boolean; wip_limit?: number | null }) => api.post<{ leaderboard: boolean; wip_limit: number | null }>("/workforce/prefs", prefs),
  board: (api: OrgApi, group: string, from: string, days: number) => api.get<TeamBoardView>(`/workforce/teams/${group}/board`, { from, days }),
  capacity: (api: OrgApi, from: string, days: number) => api.get<CapacityView>("/workforce/capacity", { from, days }),
  routing: (api: OrgApi, table: string, id: string) => api.get<Suggestion>(`/workforce/routing/${table}/${id}`),
  experts: (api: OrgApi, skill: string, level: number) => api.get<{ people: { user_id: string; name: string; level: number; level_label: string; verified: boolean; presence: string | null }[] }>("/workforce/experts", { skill, level }),
  coverage: (api: OrgApi, group?: string | null) => api.get<{ rows: CoverageRow[] }>("/workforce/coverage", group ? { group } : {}),
  catalogue: (api: OrgApi) => api.get<{ skills: { id: string; name: string; category: string | null; sfia_code: string | null; description: string | null }[] }>("/workforce/skills/catalogue"),
  mySkills: (api: OrgApi) => api.get<{ skills: MySkill[] }>("/workforce/skills/mine"),
  saveSkill: (api: OrgApi, input: { skill_id: string; level: number; evidence?: string | null; expires_at?: string | null }) => api.post<{ id: string }>("/workforce/skills/mine", input),
  accept: (api: OrgApi, id: string) => api.post(`/workforce/skills/${id}/accept`, {}),
  decline: (api: OrgApi, id: string) => api.post(`/workforce/skills/${id}/decline`, {}),
  verify: (api: OrgApi, id: string, level?: number) => api.post(`/workforce/skills/${id}/verify`, level ? { level } : {}),
  infer: (api: OrgApi) => api.post<{ suggested: { skill_id: string; name: string; records: number; level: number }[] }>("/workforce/skills/infer", {}),
  absences: (api: OrgApi) => api.get<{ absences: MyAbsence[] }>("/workforce/absences/mine"),
  requestAbsence: (api: OrgApi, input: Record<string, unknown>) => api.post<{ id: string; number: string | null; state: string }>("/workforce/absences", input),
  cancelAbsence: (api: OrgApi, id: string) => api.post(`/workforce/absences/${id}/cancel`, {}),
  performance: (api: OrgApi, q: { user?: string; group?: string; period?: string }) => api.get<PerformanceView>("/workforce/performance", q),
  coaching: (api: OrgApi) => api.post<{ text: string; ai: boolean }>("/workforce/coaching", {}),
  leaderboard: (api: OrgApi, group?: string | null) => api.get<Leaderboard>("/workforce/leaderboard", group ? { group } : {}),
  kudos: (api: OrgApi, input: { to_id: string; message: string; table?: string; id?: string }) => api.post<{ id: string }>("/workforce/kudos", input),
};
