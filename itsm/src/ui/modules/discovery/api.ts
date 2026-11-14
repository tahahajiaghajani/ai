// The discovery module's API as the screens use it (src/server/routes/discovery.ts, design A §4): the module's words
// and the caller's rights, the console's cards, one connector's page, and the actions on it. The server checks every
// right again; these hooks only read. A pass in progress is polled until it ends.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Option } from "@shared/model/types";
import type { DiscoveredRecord, TestResult } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import type { DisplayMap } from "../../records/model/types";
import type { BoardChip, BoardRow, ConnectorCard, ItemRow, OfferedKind, PanelData, QueueTab, RunInfo } from "./model";

export type { TestResult };

/** What a person may do in the module (guard.ts DiscoveryRights). */
export interface DiscoveryRights {
  admin: boolean;
  tenantAdmin: boolean;
  assetManager: boolean;
  softwareManager: boolean;
  cmdbRead: boolean;
  integrationsAdmin: boolean;
}

/** GET /discovery/meta */
export interface DiscoveryMeta {
  edition: "cloud" | "server";
  can: DiscoveryRights;
  kinds: OfferedKind[];
  all_kinds: { kind: string; label: string; icon: string; category: string; ready: boolean }[];
  min_every_minutes: number;
  min_status_every_minutes: number;
  words: { status: Option[]; item_states: Option[]; run_lanes: Option[]; run_states: Option[]; create_policies: Option[] };
}

/** GET /discovery/connectors/:id — the record (secrets as «کلید ذخیره شده»), its card and the caller's rights over it. */
export interface ConnectorPage {
  row: Record<string, unknown> & { id: string; name: string; kind: string; version?: number };
  display: DisplayMap;
  /** the engine's word on the record: whether the caller may write or delete it, and the fields it may not change */
  meta?: { canWrite?: boolean; canDelete?: boolean; readonly?: string[] };
  card: ConnectorCard | null;
  can: { edit: boolean; operate: boolean; preview: boolean; raw: boolean; approve_directory: boolean };
}

/** A previewed row (runner.ts PreviewRow). */
export interface PreviewRow {
  external_id: string;
  name: string;
  class: string;
  values: Record<string, unknown>;
  attrs: Record<string, unknown>;
  action: string;
  matched_by?: string | null;
  message?: string | null;
  warnings: string[];
  /** the tool's own element: tenant administrators only (the server leaves it out for others) */
  raw?: unknown;
}

export interface PreviewResult {
  run_id: string;
  rows: PreviewRow[];
  total?: number;
  complete?: boolean;
}

export type { DiscoveredRecord, RunInfo };

export const dkeys = {
  all: (org: string) => ["discovery", org] as const,
  meta: (org: string) => ["discovery", org, "meta"] as const,
  cards: (org: string) => ["discovery", org, "cards"] as const,
  page: (org: string, id: string) => ["discovery", org, "connector", id] as const,
  runs: (org: string, id: string) => ["discovery", org, "runs", id] as const,
  queue: (org: string) => ["discovery", org, "queue"] as const,
  board: (org: string) => ["discovery-board", org] as const,
  panel: (org: string, table: string, id: string) => ["discovery-panel", org, table, id] as const,
};

const status = (e: unknown) => (e as { status?: number } | null)?.status ?? 0;
/** One more try for a network failure, none for an answer the server meant (401, 403, 404). */
const retry = (n: number, e: unknown) => n < 1 && ![401, 403, 404].includes(status(e));

export function useDiscoveryMeta() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: dkeys.meta(orgId), queryFn: () => api.get<DiscoveryMeta>("/discovery/meta"), staleTime: 5 * 60_000, retry });
}

export function useConnectorCards() {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: dkeys.cards(orgId),
    queryFn: async () => (await api.get<{ connectors: ConnectorCard[] }>("/discovery/connectors")).connectors,
    retry,
    // a pass in progress moves its card
    refetchInterval: (q) => (q.state.data?.some((c) => c.running) ? 5000 : false),
  });
}

/** One connector's page; polled while a pass runs, and while `watch` (a pass was just queued and has not started). */
export function useConnectorPage(id: string | undefined, opts: { watch?: boolean } = {}) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: dkeys.page(orgId, id ?? ""),
    queryFn: () => api.get<ConnectorPage>(`/discovery/connectors/${id}`),
    enabled: !!id,
    retry,
    refetchInterval: (q) => (q.state.data?.card?.running || opts.watch ? 2500 : false),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The queue, the board and the panel

/** GET /discovery/queue: one tab's items across the connectors the person reads, with every tab's count. */
export interface QueueResult {
  rows: ItemRow[];
  total: number | null;
  page: number;
  size: number;
  display: DisplayMap;
  counts: Partial<Record<QueueTab, number>>;
}

export const QUEUE_PAGE = 50;

export function useQueue(p: { tab: QueueTab; connector?: string; q?: string; page: number }) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: [...dkeys.queue(orgId), p],
    queryFn: () => api.get<QueueResult>("/discovery/queue", { tab: p.tab, connector: p.connector || undefined, q: p.q || undefined, page: p.page, size: QUEUE_PAGE }),
    placeholderData: keepPreviousData,
    retry,
  });
}

/** GET /discovery/status: the targets the person reads, worst first, with each chip's count. */
export interface BoardResult {
  rows: BoardRow[];
  total: number;
  counts: Partial<Record<BoardChip, number>>;
  page: number;
  size: number;
}

export const BOARD_PAGE = 50;

/** The board, refreshed every minute while it is open (status moves on its own). */
export function useBoard(p: { chip?: BoardChip; q?: string; page: number }) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: [...dkeys.board(orgId), p],
    queryFn: () => api.get<BoardResult>("/discovery/status", { chip: p.chip || undefined, q: p.q || undefined, page: p.page, size: BOARD_PAGE }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    retry,
  });
}

/** GET /discovery/panel/:table/:id: the record's status, and for CMDB readers its sources and signals. */
export function usePanel(table: "ci" | "asset", id: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: dkeys.panel(orgId, table, id), queryFn: () => api.get<PanelData>(`/discovery/panel/${table}/${id}`), staleTime: 30_000, retry });
}
