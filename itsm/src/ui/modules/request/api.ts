// Data of the request screens (docs/modules/request_FA.md «API»): the catalogue as a person may order from it, item
// forms and the server's check, order guides, the cart and orders, the answers and progress of requested items, the
// builder's view of an item, the dashboard and the module's settings. Light on purpose: the module's index imports it;
// the components live in the lazily loaded pages.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Answers, FormSchema } from "@shared/request/form";
import type { OrgApi } from "../../lib/api";
import { useOrg } from "../../lib/org";

export const REQUEST_KEYS = {
  all: ["request"] as const,
  catalog: (org: string, p: object) => ["request", org, "catalog", p] as const,
  form: (org: string, id: string, forUser: string | null) => ["request", org, "form", id, forUser] as const,
  cart: (org: string) => ["request", org, "cart"] as const,
  answers: (org: string, table: string, id: string) => ["request", org, "answers", table, id] as const,
  progress: (org: string, id: string) => ["request", org, "progress", id] as const,
  definition: (org: string, id: string) => ["request", org, "definition", id] as const,
  dashboard: (org: string, days: number) => ["request", org, "dashboard", days] as const,
  config: (org: string) => ["request", org, "config"] as const,
};

export interface ItemCard {
  id: string;
  number: string | null;
  code: string;
  name: string;
  type: string;
  short_description: string | null;
  icon: string | null;
  color: string | null;
  catalog_id: string;
  category_id: string | null;
  featured: boolean;
  hidden: boolean;
  price: string | null;
  recurring_price: string | null;
  recurring_frequency: string | null;
  promise: string;
  sle: string;
  button_label: string | null;
  content_url: string | null;
  cart_allowed: boolean;
  multi_user: boolean;
  orderable: boolean;
  why: string | null;
}

export interface Browse {
  for: string;
  catalogs: { id: string; name: string; description: string | null; icon: string | null; color: string | null; banner: string | null }[];
  categories: { id: string; catalog_id: string; parent_id: string | null; name: string; description: string | null; icon: string | null; count: number }[];
  items: ItemCard[];
}

export interface Promise_ {
  days: number;
  text: string;
  due_at: string | null;
}

export interface ItemForm {
  item: ItemCard;
  version_id: string;
  schema: FormSchema;
  promise: Promise_ | null;
  for: string;
  display: Record<string, string>;
}

export interface CheckResult {
  errors: Record<string, string>;
  price: { unit: string; total: string; recurring: string | null; recurring_total: string | null } | null;
  title: string;
  promise: Promise_ | null;
}

export interface GuideLine {
  rule_id: string;
  item: ItemCard;
  version_id: string;
  schema: FormSchema;
  mandatory: boolean;
  selected: boolean;
  quantity: number;
  answers: Answers;
}

export interface LineInput {
  item_id: string;
  answers?: Answers;
  quantity?: number;
  requested_for?: string | null;
  requested_for_list?: string[] | null;
  guide_id?: string | null;
  version_id?: string | null;
}

export interface OrderInput {
  lines: LineInput[];
  guides?: { id: string; answers?: Answers }[];
  requested_for?: string | null;
  needed_by?: string | null;
  location_id?: string | null;
  cost_center_id?: string | null;
  instructions?: string | null;
  channel?: string | null;
}

export interface OrderResult {
  request: { id: string; number: string | null } | null;
  items: { id: string; number: string | null; title: string; state: string; requested_for: string }[];
  produced: { table: string; id: string; number: string | null } | null;
}

export interface CartLine {
  id: string;
  version: number;
  title: string | null;
  item_id: string;
  version_id: string | null;
  quantity: number;
  price: string | null;
  requested_for: string | null;
  requested_for_list: string[];
  answers: Answers | null;
  saved: boolean;
  item: ItemCard | null;
  problem: string | null;
}

export interface CartView {
  cart: { id: string | null; requested_for?: string | null; location_id?: string | null; needed_by?: string | null; cost_center_id?: string | null; instructions?: string | null };
  lines: CartLine[];
  totals: { total: string; recurring: string | null; count: number };
  display: Record<string, string>;
}

export interface AnswersView {
  item_id: string;
  number: string | null;
  state: string;
  schema: FormSchema;
  answers: Answers;
  sensitive: boolean;
  secrets: string[];
  can_edit: boolean;
  can_reveal: boolean;
  display: Record<string, string>;
}

export interface Progress {
  stages: { key: string; label: string; done: boolean; current: boolean }[];
  state: string;
  stage: string;
  due_at: string | null;
  overdue: boolean;
  tasks: { id: string; number: string | null; title: string; state: string }[];
  approvals: { pending: number; approved: number; rejected: number };
}

export interface DefinitionProblem {
  level: "error" | "warning";
  message: string;
  ref?: string;
}

export interface Definition {
  item: Record<string, any>;
  can_write: boolean;
  schema: FormSchema;
  problems: DefinitionProblem[];
  versions: { id: string; version_no: number; note: string | null; created_by: string | null; created_at: string }[];
  guide_rules: Record<string, any>[];
  flows: { id: string; name: string; trigger: string; catalog_item: string | null; active: boolean; version_no: number | null; bound: boolean }[];
  approval_rules: { id: string; name: string; active: boolean; bound: boolean }[];
  display: Record<string, string>;
}

export interface Dashboard {
  days: number;
  totals: { ordered: number; open: number; closed: number; overdue: number };
  by_state: { key: string; count: number }[];
  by_stage: { key: string; count: number }[];
  by_channel: { key: string; count: number }[];
  top_items: { id: string; name: string; count: number; p85: number | null }[];
  fulfilment: { p50: number | null; p85: number | null; p95: number | null; samples: number };
  within_promise: number | null;
  approval: { avg_hours: number | null; rejection_rate: number | null };
  first_time_right: number | null;
  waiting_share: number | null;
  zero_touch: number | null;
  self_service: number | null;
  ad_hoc: number | null;
  csat: { avg: number | null; count: number };
  backlog: { key: string; label: string; count: number }[];
  display: Record<string, string>;
}

export interface RequestConfigView {
  config: Record<string, any>;
  ai: string[];
  can_admin: boolean;
}

const R = "/request";

export const requestApi = {
  browse: (api: OrgApi, p: { q?: string; catalog?: string; category?: string; for?: string } = {}) => api.get<Browse>(`${R}/catalog`, p as Record<string, string>),
  form: (api: OrgApi, id: string, forUser?: string | null) => api.get<ItemForm>(`${R}/catalog/items/${id}`, forUser ? { for: forUser } : undefined),
  check: (api: OrgApi, id: string, body: { answers: Answers; quantity?: number; for?: string | null }) => api.post<CheckResult>(`${R}/catalog/items/${id}/check`, body),
  expand: (api: OrgApi, id: string, body: { answers: Answers; for?: string | null }) => api.post<{ guide: ItemCard; lines: GuideLine[]; errors: Record<string, string> }>(`${R}/guides/${id}/expand`, body),
  order: (api: OrgApi, input: OrderInput) => api.post<OrderResult>(`${R}/order`, input),
  cart: (api: OrgApi) => api.get<CartView>(`${R}/cart`),
  updateCart: (api: OrgApi, patch: Record<string, unknown>) => api.patch<CartView>(`${R}/cart`, patch),
  addLine: (api: OrgApi, line: LineInput & { saved?: boolean }) => api.post<{ line: CartLine; cart: CartView }>(`${R}/cart/lines`, line),
  updateLine: (api: OrgApi, id: string, patch: Partial<LineInput> & { saved?: boolean }) => api.patch<{ line: CartLine; cart: CartView }>(`${R}/cart/lines/${id}`, patch),
  removeLine: (api: OrgApi, id: string) => api.del<{ cart: CartView }>(`${R}/cart/lines/${id}`),
  checkout: (api: OrgApi, header: Omit<OrderInput, "lines"> = {}) => api.post<OrderResult>(`${R}/cart/checkout`, header),
  answers: (api: OrgApi, table: string, id: string) => api.get<AnswersView>(`${R}/answers/${table}/${id}`),
  editAnswers: (api: OrgApi, id: string, answers: Answers, version?: number) => api.put<AnswersView>(`${R}/items/${id}/answers`, { answers, version }),
  reveal: (api: OrgApi, id: string, name: string) => api.post<{ name: string; value: unknown }>(`${R}/items/${id}/reveal`, { name }),
  info: (api: OrgApi, id: string, message: string) => api.post(`${R}/items/${id}/info`, { message }),
  feedback: (api: OrgApi, id: string, rating: number, feedback?: string) => api.post(`${R}/items/${id}/feedback`, { rating, feedback }),
  reorder: (api: OrgApi, id: string) => api.get<{ item_id: string; answers: Answers; quantity: number; requested_for: string | null; available: boolean }>(`${R}/items/${id}/reorder`),
  changeItem: (api: OrgApi, id: string, itemId: string, force?: boolean) => api.post(`${R}/items/${id}/change-item`, { item_id: itemId, force }),
  convert: (api: OrgApi, id: string, note?: string) => api.post<{ table: string; id: string; number: string | null }>(`${R}/items/${id}/convert`, { note }),
  progress: (api: OrgApi, id: string) => api.get<Progress>(`${R}/items/${id}/progress`),
  definition: (api: OrgApi, id: string) => api.get<Definition>(`${R}/builder/${id}`),
  publish: (api: OrgApi, id: string, note?: string, version?: number) => api.post<{ version: { id: string; version_no: number }; problems: DefinitionProblem[] }>(`${R}/builder/${id}/publish`, { note, version }),
  newApprovalRule: (api: OrgApi, id: string, body: { name?: string; levels?: unknown[]; mode?: string }) => api.post(`${R}/builder/${id}/approval`, body),
  bindRule: (api: OrgApi, id: string, ruleId: string) => api.post(`${R}/builder/${id}/approval/bind`, { rule_id: ruleId }),
  newFlow: (api: OrgApi, id: string) => api.post<{ flow: { id: string } }>(`${R}/builder/${id}/flow`),
  copy: (api: OrgApi, id: string) => api.post<{ item: { id: string } }>(`${R}/builder/${id}/copy`),
  audience: (api: OrgApi, id: string, user: string) => api.get<{ can_order: boolean; reasons: string[] }>(`${R}/builder/${id}/audience`, { user }),
  dashboard: (api: OrgApi, days: number) => api.get<Dashboard>(`${R}/dashboard`, { days: String(days) }),
  config: (api: OrgApi) => api.get<RequestConfigView>(`${R}/config`),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>(`${R}/seed`, { force: true }),
  prefill: (api: OrgApi, itemId: string, text: string) => api.post<{ answers: Answers; complete: boolean; missing: string[] }>(`${R}/ai/prefill`, { item_id: itemId, text }),
};

export function useCatalog(p: { q?: string; catalog?: string; category?: string; for?: string }) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.catalog(orgId, p), queryFn: () => requestApi.browse(api, p), staleTime: 30_000 });
}

export function useItemForm(id: string | null | undefined, forUser?: string | null) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.form(orgId, id ?? "", forUser ?? null), queryFn: () => requestApi.form(api, id!, forUser), enabled: !!id, staleTime: 30_000 });
}

export function useCart(enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.cart(orgId), queryFn: () => requestApi.cart(api), enabled });
}

export function useAnswers(table: string, id: string | null | undefined) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.answers(orgId, table, id ?? ""), queryFn: () => requestApi.answers(api, table, id!), enabled: !!id });
}

export function useProgress(id: string | null | undefined) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.progress(orgId, id ?? ""), queryFn: () => requestApi.progress(api, id!), enabled: !!id });
}

export function useDefinition(id: string | null | undefined) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.definition(orgId, id ?? ""), queryFn: () => requestApi.definition(api, id!), enabled: !!id });
}

export function useRequestDashboard(days: number) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.dashboard(orgId, days), queryFn: () => requestApi.dashboard(api, days) });
}

export function useRequestConfig() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: REQUEST_KEYS.config(orgId), queryFn: () => requestApi.config(api), staleTime: 5 * 60_000 });
}

/** Invalidate the module's queries (after orders, cart changes and builder edits). */
export function useRequestRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return {
    all: () => qc.invalidateQueries({ queryKey: ["request", orgId] }),
    cart: () => qc.invalidateQueries({ queryKey: REQUEST_KEYS.cart(orgId) }),
    definition: (id: string) => qc.invalidateQueries({ queryKey: REQUEST_KEYS.definition(orgId, id) }),
    record: (id: string) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["request", orgId, "answers"] }),
        qc.invalidateQueries({ queryKey: REQUEST_KEYS.progress(orgId, id) }),
      ]),
  };
}

/** The number of lines in the caller's cart (the nav count). */
export const cartCount = async (api: OrgApi) => (await requestApi.cart(api)).totals.count;
