// Data of the knowledge screens (/knowledge/…, contracts in @shared/knowledge/api): the home, search, the reading view,
// suggestions next to records, feedback, versions (create, draft, submit, withdraw, checks, diff, restore), lifecycle
// (retire, restore, review), translations, links to records and capture, acknowledgements, the dashboard, the
// workspace and the AI helpers — typed calls and React Query hooks. Light on purpose: the module's index imports it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgApi } from "../../lib/api";
import { useOrg } from "../../lib/org";
import { registerLiveQueries } from "../../lib/live";
import type {
  KbAttestationItem, KbDashboard, KbDiff, KbExplain, KbHome, KbReadView, KbRecordPanel, KbSearchResult, KbSuggestion, KbVersionCheck, KbWorkspace,
} from "@shared/knowledge/api";
import type { Option } from "@shared/model/types";
import type { RecordRow, DisplayMap } from "../../records";

export type { KbAttestationItem, KbDashboard, KbDiff, KbExplain, KbHome, KbReadView, KbRecordPanel, KbSearchResult, KbSuggestion, KbVersionCheck, KbWorkspace };

export const KB_KEYS = {
  all: (org: string) => ["knowledge", org] as const,
  meta: (org: string) => ["knowledge", org, "meta"] as const,
  home: (org: string) => ["knowledge", org, "home"] as const,
  search: (org: string, q: string) => ["knowledge", org, "search", q] as const,
  read: (org: string, id: string) => ["knowledge", org, "read", id] as const,
  record: (org: string, table: string, id: string) => ["knowledge", org, "record", table, id] as const,
  check: (org: string, id: string) => ["knowledge", org, "check", id] as const,
  diff: (org: string, a: string, b: string) => ["knowledge", org, "diff", a, b] as const,
  attestations: (org: string) => ["knowledge", org, "attestations"] as const,
  dashboard: (org: string, days: number) => ["knowledge", org, "dashboard", days] as const,
  workspace: (org: string) => ["knowledge", org, "workspace"] as const,
  explain: (org: string, id: string, user: string) => ["knowledge", org, "explain", id, user] as const,
};
registerLiveQueries("knowledge");

export interface KbMeta {
  /** AI skills the member may use here (empty when AI is off or not allowed) */
  ai: string[];
  write_actions: Record<string, string>;
  types: Option[];
  admin: boolean;
}

export interface SearchArgs {
  q: string;
  base?: string | null;
  category?: string | null;
  type?: string | null;
  language?: string | null;
  sort?: "relevance" | "recent" | "popular";
  page?: number;
  size?: number;
  session?: string | null;
  channel?: string;
  /** false: not counted in the search analytics (type-ahead) */
  log?: boolean;
}

export interface NewArticle {
  base_id: string;
  category_id?: string | null;
  template_id?: string | null;
  article_type?: string | null;
  title: string;
  summary?: string | null;
  body?: string | null;
  language?: string | null;
  visibility?: "inherit" | "internal" | null;
}

type Row = RecordRow & Record<string, unknown>;
type Saved = { row: Row; display: DisplayMap };

const enc = encodeURIComponent;

export const kbApi = {
  meta: (api: OrgApi) => api.get<KbMeta>("/knowledge/meta"),
  home: (api: OrgApi) => api.get<KbHome>("/knowledge/home"),
  search: (api: OrgApi, a: SearchArgs) =>
    api.get<KbSearchResult>("/knowledge/search", { q: a.q, base: a.base ?? undefined, category: a.category ?? undefined, type: a.type ?? undefined, language: a.language ?? undefined, sort: a.sort, page: a.page, size: a.size, session: a.session ?? undefined, channel: a.channel, log: a.log === false ? "0" : undefined }),
  suggest: (api: OrgApi, text: string, session_id?: string | null, channel = "portal") => api.post<{ hits: KbSuggestion[]; snippets: KbSearchResult["snippets"] }>("/knowledge/suggest", { text, session_id: session_id ?? null, channel }),
  click: (api: OrgApi, article_id: string, query: string | null, position: number | null, session_id?: string | null, channel = "search") => api.post<{ ok: true }>("/knowledge/click", { article_id, query, position, session_id: session_id ?? null, channel }),
  deflect: (api: OrgApi, article_id: string | null, query: string | null, session_id?: string | null) => api.post<{ ok: true }>("/knowledge/deflect", { article_id, query, session_id: session_id ?? null }),
  read: (api: OrgApi, id: string, session?: string | null) => api.get<KbReadView>(`/knowledge/articles/${enc(id)}/read`, { session: session ?? undefined }),
  create: (api: OrgApi, a: NewArticle) => api.post<{ article: Row; version: Row }>("/knowledge/articles", a),
  draft: (api: OrgApi, id: string, kind: "minor" | "major" = "minor", note?: string | null) => api.post<{ version: Row }>(`/knowledge/articles/${enc(id)}/draft`, { kind, note: note ?? null }),
  retire: (api: OrgApi, id: string, reason: string, replaced_by?: string | null, at?: string | null) => api.post<Saved>(`/knowledge/articles/${enc(id)}/retire`, { reason, replaced_by: replaced_by ?? null, at: at ?? null }),
  restore: (api: OrgApi, id: string) => api.post<Saved>(`/knowledge/articles/${enc(id)}/restore`, {}),
  review: (api: OrgApi, id: string, outcome: "confirm" | "update" | "retire", note?: string | null, reason?: string | null) => api.post<Record<string, unknown>>(`/knowledge/articles/${enc(id)}/review`, { outcome, note: note ?? null, reason: reason ?? null }),
  vote: (api: OrgApi, id: string, helpful: boolean, reason?: string | null, comment?: string | null) => api.post<{ vote: string; helpful_yes: number; helpful_no: number }>(`/knowledge/articles/${enc(id)}/vote`, { helpful, reason: reason ?? null, comment: comment ?? null }),
  rate: (api: OrgApi, id: string, rating: number) => api.post<{ rating: number; rating_avg: string | null; rating_count: number }>(`/knowledge/articles/${enc(id)}/rate`, { rating }),
  flag: (api: OrgApi, id: string, reason: string, comment?: string | null, record?: { table: string; id: string; number?: string | null } | null) => api.post<{ task_id: string; task_number: string | null }>(`/knowledge/articles/${enc(id)}/flag`, { reason, comment: comment ?? null, record: record ?? null }),
  subscribe: (api: OrgApi, target_table: "kb_article" | "kb_category" | "kb_base", target_id: string, on: boolean) => api.post<{ subscribed: boolean }>(on ? "/knowledge/subscriptions" : "/knowledge/subscriptions/remove", { target_table, target_id }),
  explain: (api: OrgApi, id: string, user: string) => api.get<KbExplain>(`/knowledge/articles/${enc(id)}/access`, { user }),
  translate: (api: OrgApi, id: string, language: string, machine = false) => api.post<{ article: Row; version: Row }>(`/knowledge/articles/${enc(id)}/translate`, { language, machine }),
  submit: (api: OrgApi, versionId: string, publish_at?: string | null) => api.post<Saved>(`/knowledge/versions/${enc(versionId)}/submit`, { publish_at: publish_at ?? null }),
  withdraw: (api: OrgApi, versionId: string) => api.post<Saved>(`/knowledge/versions/${enc(versionId)}/withdraw`, {}),
  check: (api: OrgApi, versionId: string) => api.get<KbVersionCheck>(`/knowledge/versions/${enc(versionId)}/check`),
  diff: (api: OrgApi, a: string, b: string) => api.get<KbDiff>("/knowledge/diff", { a, b }),
  restoreVersion: (api: OrgApi, versionId: string) => api.post<{ version: Row }>(`/knowledge/versions/${enc(versionId)}/restore`, {}),
  validateAi: (api: OrgApi, versionId: string) => api.post<{ ok: true }>(`/knowledge/versions/${enc(versionId)}/validate-ai`, {}),
  record: (api: OrgApi, table: string, id: string, q?: string | null) => api.get<KbRecordPanel>(`/knowledge/records/${enc(table)}/${enc(id)}`, { q: q || undefined }),
  attach: (api: OrgApi, table: string, id: string, article_id: string, kind: "kb_solved_by" | "kb_workaround" | "kb_related" = "kb_solved_by", query?: string | null) =>
    api.post<{ link_id: string; reuse_count: number; already: boolean }>(`/knowledge/records/${enc(table)}/${enc(id)}/attach`, { article_id, kind, query: query ?? null }),
  detach: (api: OrgApi, table: string, id: string, link_id: string, reason: string) => api.post<{ ok: true }>(`/knowledge/records/${enc(table)}/${enc(id)}/detach`, { link_id, reason }),
  capture: (api: OrgApi, a: { table: string; id: string; wip?: boolean; title?: string | null; base_id?: string | null; ai?: boolean }) => api.post<{ article: Row; version: Row | null }>("/knowledge/capture", a),
  fromKnownError: (api: OrgApi, id: string) => api.post<{ article: Row; existing: boolean }>(`/knowledge/known-errors/${enc(id)}/article`, {}),
  reportGap: (api: OrgApi, text: string, record?: { table: string; id: string; number?: string | null } | null) => api.post<{ gap_id: string; number: string | null }>("/knowledge/gaps", { text, record: record ?? null }),
  attestations: (api: OrgApi) => api.get<{ items: KbAttestationItem[] }>("/knowledge/attestations/mine"),
  ack: (api: OrgApi, id: string) => api.post<Record<string, unknown>>(`/knowledge/attestations/${enc(id)}/ack`, {}),
  dashboard: (api: OrgApi, days: number) => api.get<KbDashboard>("/knowledge/dashboard", { days }),
  workspace: (api: OrgApi) => api.get<KbWorkspace>("/knowledge/workspace"),
  mergeDuplicate: (api: OrgApi, id: string, keep: "a" | "b") => api.post<{ ok: true; kept: string; retired: string }>(`/knowledge/duplicates/${enc(id)}/merge`, { keep }),
  reown: (api: OrgApi, from: string, to: string) => api.post<{ moved: number }>("/knowledge/reown", { from, to }),
  sweep: (api: OrgApi) => api.post<Record<string, number>>("/knowledge/sweep", { daily: true }),
  write: (api: OrgApi, action: string, text: string, base_id?: string | null) => api.post<{ text: string; model?: string | null }>("/knowledge/ai/write", { action, text, base_id: base_id ?? null }),
  skill: (api: OrgApi, skill: string, id?: string | null, other?: string | null) => api.post<Record<string, unknown>>(`/knowledge/ai/${enc(skill)}`, { id: id ?? null, other: other ?? null }),
};

export function useKbMeta() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: KB_KEYS.meta(orgId), queryFn: () => kbApi.meta(api), staleTime: 5 * 60_000 });
}

export function useKbHome() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: KB_KEYS.home(orgId), queryFn: () => kbApi.home(api), staleTime: 60_000 });
}

export function useKbRead(id: string, session?: string | null) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: KB_KEYS.read(orgId, id), queryFn: () => kbApi.read(api, id, session), enabled: !!id, retry: false });
}

/** Refreshes every knowledge query after a change (the reading view, the home, panels, the dashboard). */
export function useKbRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return () => qc.invalidateQueries({ queryKey: KB_KEYS.all(orgId) });
}

/** One id per browser tab for the knowledge event stream (sessions of search → view → deflect). */
export function kbSession(): string {
  try {
    const k = "itsm.kb.session";
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const n = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(k, n);
    return n;
  } catch {
    return "s0";
  }
}
