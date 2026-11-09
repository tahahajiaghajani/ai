// Data of the portal's screens (contracts: src/shared/portal/api.ts): every call of /api/o/:org/portal/* with React
// Query keys, and the few sign-in-free calls of the public pages (/api/public/portal/*). Light on purpose: the module's
// index imports it; the screens load with their pages.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LinkCodeView, PortalAnalytics, PortalAnswer, PortalApproval, PortalCatalog, PortalConfig, PortalHome, PortalItemsPage, PortalProfile, PortalSearchResult, PortalTicket, PortalTodo,
  PublicKbArticle, PublicKbCard, PublicKbHome, SurveyResults, SurveyView, TopicPage,
} from "@shared/portal/api";
import { api as rootApi, type OrgApi } from "../../lib/api";
import { useOrg } from "../../lib/org";

export type * from "@shared/portal/api";

const enc = encodeURIComponent;

export const PORTAL_KEYS = {
  all: (org: string) => ["portal", org] as const,
  config: (org: string, portal: string | null, preview: boolean) => ["portal", org, "config", portal, preview] as const,
  home: (org: string, portal: string | null, preview: boolean) => ["portal", org, "home", portal, preview] as const,
  catalog: (org: string, category: string | null, q: string) => ["portal", org, "catalog", category, q] as const,
  items: (org: string, tab: string, state: string, q: string, page: number) => ["portal", org, "items", tab, state, q, page] as const,
  ticket: (org: string, table: string, id: string) => ["portal", org, "ticket", table, id] as const,
  todo: (org: string) => ["portal", org, "todo"] as const,
  approval: (org: string, id: string) => ["portal", org, "approval", id] as const,
  search: (org: string, q: string) => ["portal", org, "search", q] as const,
  survey: (org: string, id: string) => ["portal", org, "survey", id] as const,
  results: (org: string, survey: string | null, days: number) => ["portal", org, "results", survey, days] as const,
  profile: (org: string) => ["portal", org, "profile"] as const,
  topic: (org: string, id: string) => ["portal", org, "topic", id] as const,
  analytics: (org: string, days: number) => ["portal", org, "analytics", days] as const,
  publications: (org: string) => ["portal", org, "publications"] as const,
  me: (org: string) => ["portal", org, "me"] as const,
};

const P = "/portal";

export const portalApi = {
  config: (api: OrgApi, portal?: string | null, preview?: boolean) => api.get<PortalConfig>(`${P}/config`, { portal: portal ?? undefined, preview: preview ? "1" : undefined }),
  choose: (api: OrgApi, portal: string) => api.post<{ ok: true }>(`${P}/portal-choice`, { portal }),
  home: (api: OrgApi, portal?: string | null, preview?: boolean) => api.get<PortalHome>(`${P}/home`, { portal: portal ?? undefined, preview: preview ? "1" : undefined }),
  catalog: (api: OrgApi, category?: string | null, q?: string) => api.get<PortalCatalog>(`${P}/catalog`, { category: category ?? undefined, q: q || undefined }),
  favorite: (api: OrgApi, item: string, on: boolean) => api.post<{ favorites: string[] }>(`${P}/favorites/${enc(item)}`, { on }),
  topic: (api: OrgApi, id: string) => api.get<TopicPage>(`${P}/topics/${enc(id)}`),
  search: (api: OrgApi, q: string, opts: { session?: string; log?: boolean } = {}) => api.get<PortalSearchResult>(`${P}/search`, { q, session: opts.session, log: opts.log === false ? "0" : undefined }),
  answer: (api: OrgApi, q: string) => api.post<{ answer: PortalAnswer | null }>(`${P}/search/answer`, { q }),
  event: (api: OrgApi, e: { kind: "deflect" | "order" | "report" | "click" | "feedback"; query?: string | null; ref_table?: string | null; ref_id?: string | null }) => api.post<{ ok: true }>(`${P}/events`, e).catch(() => undefined),
  items: (api: OrgApi, p: { tab: string; state: string; q?: string; page?: number; size?: number }) =>
    api.get<PortalItemsPage>(`${P}/items`, { tab: p.tab, state: p.state, q: p.q || undefined, page: p.page ? String(p.page) : undefined, size: p.size ? String(p.size) : undefined }),
  ticket: (api: OrgApi, table: string, id: string) => api.get<PortalTicket>(`${P}/tickets/${enc(table)}/${enc(id)}`),
  reply: (api: OrgApi, table: string, id: string, body: string, attachments: string[] = []) => api.post<PortalTicket>(`${P}/tickets/${enc(table)}/${enc(id)}/reply`, { body, attachments }),
  action: (api: OrgApi, table: string, id: string, action: string, comment?: string | null, rating?: number | null) => api.post<PortalTicket>(`${P}/tickets/${enc(table)}/${enc(id)}/action`, { action, comment: comment ?? null, rating: rating ?? null }),
  suggest: (api: OrgApi, table: string, id: string) => api.post<{ suggestions: string[]; model: string | null; fallback: boolean }>(`${P}/tickets/${enc(table)}/${enc(id)}/suggest`, {}),
  todo: (api: OrgApi) => api.get<PortalTodo>(`${P}/todo`),
  approval: (api: OrgApi, id: string) => api.get<PortalApproval>(`${P}/approvals/${enc(id)}`),
  decide: (api: OrgApi, id: string, decision: "approved" | "rejected", comment?: string | null) => api.post(`/approvals/${enc(id)}/decide`, { decision, comment: comment ?? null }),
  survey: (api: OrgApi, id: string) => api.get<SurveyView>(`${P}/surveys/${enc(id)}`),
  answerSurvey: (api: OrgApi, id: string, answers: Record<string, unknown>) => api.post<{ thanks: string }>(`${P}/surveys/${enc(id)}`, { answers }),
  results: (api: OrgApi, survey: string | null, days: number) => api.get<SurveyResults>(`${P}/survey-results`, { survey: survey ?? undefined, days: String(days) }),
  sendCampaign: (api: OrgApi, survey: string) => api.post<{ invited: number; skipped: number }>(`${P}/surveys/send/${enc(survey)}`, {}),
  recordSurveys: (api: OrgApi, table: string, id: string) => api.get<{ responses: { id: string; title: string; csat: number | null; score: number | null; comment: string | null; at: string | null }[] }>(`${P}/record-surveys/${enc(table)}/${enc(id)}`),
  profile: (api: OrgApi) => api.get<PortalProfile>(`${P}/profile`),
  linkCode: (api: OrgApi) => api.post<LinkCodeView>(`${P}/link-code`, {}),
  unlink: (api: OrgApi, id: string) => api.del<{ ok: true }>(`${P}/identities/${enc(id)}`),
  publish: (api: OrgApi, portal: string) => api.post<{ portal: Record<string, unknown> }>(`${P}/layout/${enc(portal)}/publish`, {}),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>(`${P}/seed`, { force: true }),
  analytics: (api: OrgApi, days: number) => api.get<PortalAnalytics>(`${P}/analytics`, { days: String(days) }),
  channelSecret: (api: OrgApi, id: string) => api.post<{ secret: string; webhook_url: string }>(`${P}/channels/${enc(id)}/secret`, {}),
  rotateChannel: (api: OrgApi, id: string) => api.post<{ webhook_url: string }>(`${P}/channels/${enc(id)}/rotate-key`, {}),
  registerChannel: (api: OrgApi, id: string) => api.post<{ ok: boolean; message: string }>(`${P}/channels/${enc(id)}/register`, {}),
  channelLog: (api: OrgApi, id: string) => api.get<{ items: { at: string; direction: string; status: string; chat: string | null; user: string | null; text: string | null; error: string | null }[]; display: Record<string, string> }>(`${P}/channels/${enc(id)}/log`),
  widgetKey: (api: OrgApi, id: string) => api.post<{ key: string; snippet: string }>(`${P}/widgets/${enc(id)}/key`, {}),
  widgetSnippet: (api: OrgApi, id: string) => api.get<{ snippet: string | null }>(`${P}/widgets/${enc(id)}/snippet`),
  publications: (api: OrgApi) => api.get<{ publications: { id: string; name: string; active: boolean; url: string | null; bases: { id: string; name: string; public: boolean; articles: number; held_back: number }[] }[] }>(`${P}/public-kb`),
  setPublication: (api: OrgApi, id: string, enabled: boolean, regenerate = false) => api.post<{ enabled: boolean; url: string | null }>(`${P}/public-kb/${enc(id)}`, { enabled, regenerate }),
  me: (api: OrgApi) => api.get<{ team: boolean; admin: boolean; channels_admin: boolean }>(`${P}/me`),
};

/** The sign-in-free calls of the public pages (no session; GET-only by the platform's rules, plus votes and answers). */
export const portalPublicApi = {
  kbHome: (token: string) => rootApi.get<PublicKbHome>(`/public/portal/kb/${enc(token)}`),
  kbSearch: (token: string, q: string, base?: string | null) => rootApi.get<{ hits: PublicKbCard[] }>(`/public/portal/kb/${enc(token)}/search`, { q, base: base ?? undefined }),
  kbArticle: (token: string, slug: string) => rootApi.get<PublicKbArticle>(`/public/portal/kb/${enc(token)}/a/${enc(slug)}`),
  kbVote: (token: string, slug: string, helpful: boolean) => rootApi.post<{ ok: true }>(`/public/portal/kb/${enc(token)}/a/${enc(slug)}/vote`, { helpful }),
  survey: (token: string) => rootApi.get<SurveyView>(`/public/portal/survey/${enc(token)}`),
  answerSurvey: (token: string, answers: Record<string, unknown>) => rootApi.post<{ thanks: string }>(`/public/portal/survey/${enc(token)}`, { answers }),
};

// ---------------------------------------------------------------------------------------------------------------
// Hooks

export function usePortalConfig(portal: string | null, preview: boolean) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.config(orgId, portal, preview), queryFn: () => portalApi.config(api, portal, preview), staleTime: 5 * 60_000 });
}

export function usePortalHome(portal: string | null, preview: boolean) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.home(orgId, portal, preview), queryFn: () => portalApi.home(api, portal, preview), staleTime: 30_000 });
}

export function usePortalCatalog(category: string | null, q: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.catalog(orgId, category, q), queryFn: () => portalApi.catalog(api, category, q), staleTime: 30_000 });
}

export function usePortalItems(tab: string, state: string, q: string, page: number) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.items(orgId, tab, state, q, page), queryFn: () => portalApi.items(api, { tab, state, q, page, size: 20 }), placeholderData: (prev) => prev });
}

export function usePortalTicket(table: string, id: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.ticket(orgId, table, id), queryFn: () => portalApi.ticket(api, table, id), refetchInterval: 60_000 });
}

export function usePortalTodo() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.todo(orgId), queryFn: () => portalApi.todo(api), staleTime: 15_000 });
}

export function usePortalMe() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: PORTAL_KEYS.me(orgId), queryFn: () => portalApi.me(api), staleTime: 5 * 60_000 });
}

/** Invalidate the portal's queries (after a reply, an order, an answer). */
export function usePortalRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return {
    all: () => qc.invalidateQueries({ queryKey: PORTAL_KEYS.all(orgId) }),
    ticket: (table: string, id: string) => qc.invalidateQueries({ queryKey: PORTAL_KEYS.ticket(orgId, table, id) }),
    todo: () => qc.invalidateQueries({ queryKey: PORTAL_KEYS.todo(orgId) }),
  };
}

/** A per-tab search session (knowledge deflection: search → view → no request). */
export function portalSession(): string {
  try {
    const k = "itsm.portal.session";
    let s = sessionStorage.getItem(k);
    if (!s) {
      s = Math.random().toString(36).slice(2, 14);
      sessionStorage.setItem(k, s);
    }
    return s;
  } catch {
    return "anon";
  }
}
