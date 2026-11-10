// Data of the enterprise service screens (src/server/routes/esm.ts): typed calls and query keys.
import type { OrgApi } from "../../lib/api";
import type { Row } from "./model";

export interface DepartmentLite {
  id: string;
  key: string;
  name: string;
  kind: string;
  icon: string | null;
  color: string | null;
  status: string;
  case_table: string;
  mine?: boolean;
}

export interface DeptQueue {
  table: string;
  label: string;
  icon: string;
  open: number;
  new: number;
  waiting: number;
  unassigned: number;
  mine: number;
  breached: number;
  created_30d: number;
  resolved_30d: number;
  csat: number | null;
  csat_n: number;
  recent: Row[];
  display: Record<string, string>;
}

export interface DepartmentHome {
  department: Row & { id: string; key: string; name: string; kind: string; case_table: string };
  admin: boolean;
  queues: DeptQueue[];
  services: { id: string; name: string; category: string | null; case_table: string; active: boolean; catalog_item_id: string | null }[];
  journeys: { total: number; rows: Row[]; display: Record<string, string> } | null;
  kb_articles: number | null;
  case_tables: { value: string; label: string }[];
}

export interface Tracker {
  journey: Row;
  meta: Row;
  display: Record<string, string>;
  activities: Row[];
  records: Record<string, { number: string | null; state: string | null; state_label: string | null; readable: boolean }>;
  tasks: Row[];
  can_write: boolean;
}

export const ESM_KEYS = {
  all: ["esm"] as const,
  meta: (org: string) => ["esm", org, "meta"] as const,
  departments: (org: string) => ["esm", org, "departments"] as const,
  home: (org: string, key: string) => ["esm", org, "home", key] as const,
  tracker: (org: string, id: string) => ["esm", org, "tracker", id] as const,
  todos: (org: string) => ["esm", org, "todos"] as const,
  myCases: (org: string, department: string | null = null) => ["esm", org, "my-cases", department] as const,
  preview: (org: string, tpl: string, anchor: string) => ["esm", org, "preview", tpl, anchor] as const,
  availability: (org: string, from: string, kind: string | null) => ["esm", org, "availability", from, kind] as const,
};

export const esmApi = {
  meta: (api: OrgApi) => api.get<{ seeded: boolean; admin: boolean; departments: DepartmentLite[] }>("/esm/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>("/esm/seed", {}),
  departments: (api: OrgApi) => api.get<{ departments: DepartmentLite[] }>("/esm/departments"),
  home: (api: OrgApi, key: string) => api.get<DepartmentHome>(`/esm/departments/${encodeURIComponent(key)}/home`),
  route: (api: OrgApi, text: string) =>
    api.post<{ matches: { score: number; service: { id: string; name: string; category: string | null; description: string | null; case_table: string; catalog_item_id: string | null }; department: { id: string; name: string; key: string } }[] }>("/esm/route", { text }),
  myCases: (api: OrgApi, department?: string | null) => api.get<{ cases: Row[] }>("/esm/my/cases", department ? { department } : {}),
  todos: (api: OrgApi) => api.get<{ tasks: Row[]; journeys: Row[]; display: Record<string, string> }>("/esm/my/todos"),
  transfer: (api: OrgApi, table: string, id: string, input: { department_id: string; service_id?: string | null; note: string }) =>
    api.post<{ table: string; id: string; number: string | null; moved: boolean }>(`/esm/cases/${table}/${id}/transfer`, input),
  child: (api: OrgApi, table: string, id: string, input: { department_id: string; service_id?: string | null; short_description: string; description?: string | null }) =>
    api.post<{ table: string; id: string; number: string | null }>(`/esm/cases/${table}/${id}/child`, input),
  startJourney: (api: OrgApi, input: Row) => api.post<{ journey: Row }>("/esm/journeys", input),
  tracker: (api: OrgApi, id: string) => api.get<Tracker>(`/esm/journeys/${id}/tracker`),
  preview: (api: OrgApi, tpl: string, anchor: string) => api.get<{ problems: { code: string; message: string }[]; activities: Row[] }>(`/esm/templates/${tpl}/preview`, { anchor }),
  availability: (api: OrgApi, q: { from: string; to: string; kind?: string | null; capacity?: number | null }) =>
    api.get<{ spaces: (Row & { busy: { start: string; end: string; state: string; mine: boolean; id: string | null }[] })[] }>("/esm/spaces/availability", {
      from: q.from, to: q.to, ...(q.kind ? { kind: q.kind } : {}), ...(q.capacity ? { capacity: q.capacity } : {}),
    }),
};
