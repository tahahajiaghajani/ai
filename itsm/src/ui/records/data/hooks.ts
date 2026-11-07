// Data hooks of the record UI: the organisation's table definitions (cached for the session, refreshed when a
// designer changes them), lists, single records, the activity stream, links, attachments, saved views, and the
// mutations with their cache updates. Query keys start with "records…"/"record…" and are registered with «زنده»
// (src/ui/lib/live.ts), so open lists and records refresh when another device changes them; forms keep their own
// draft, so a refresh never resets what someone is typing.
import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { registerLiveQueries } from "../../lib/live";
import { makeSchema, type Schema } from "../model/schema";
import { mergeActivity, type ActivityItem } from "../model/activity";
import { clientEnv } from "../model/policies";
import { VIEW_FIELDS } from "../model/views";
import type { DisplayMap, ListQuery, ListResult, RecordResult, RecordRow, TableMeta, ViewRow } from "../model/types";
import { recordsApi, uploadAttachment } from "./api";

registerLiveQueries("records", "records-agg", "record", "record-activity", "record-links", "record-attachments", "records-views");

/** Query keys (the organisation is part of every key: a person may switch organisations without a reload). */
export const keys = {
  meta: (org: string) => ["records-meta", org] as const,
  lists: (org: string, table: string) => ["records", org, table] as const,
  list: (org: string, table: string, q: ListQuery) => ["records", org, table, q] as const,
  aggs: (org: string, table: string) => ["records-agg", org, table] as const,
  record: (org: string, table: string, id: string) => ["record", org, table, id] as const,
  activity: (org: string, table: string, id: string) => ["record-activity", org, table, id] as const,
  links: (org: string, table: string, id: string) => ["record-links", org, table, id] as const,
  attachments: (org: string, table: string, id: string) => ["record-attachments", org, table, id] as const,
  views: (org: string, table: string) => ["records-views", org, table] as const,
};

// ---------------------------------------------------------------- definitions

/** The organisation's tables (GET /meta/tables): cached for 5 minutes, refreshed by the designers. */
export function useSchema() {
  const { api, orgId } = useOrg();
  const q = useQuery({
    queryKey: keys.meta(orgId),
    queryFn: async () => makeSchema(await recordsApi.tables(api)),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return { schema: q.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
}

/** Every table definition the caller may read (the brief's `useTableDefs`; the same cache as `useSchema`). */
export function useTableDefs() {
  const s = useSchema();
  return { tables: s.schema ? [...s.schema.tables.values()] : [], choices: s.schema?.choices ?? {}, schema: s.schema, isLoading: s.isLoading, error: s.error };
}

/** One table's definition (and the schema around it). `missing` once loaded without it (unknown or unreadable). */
export function useTableDef(key: string | null | undefined): { def: TableMeta | undefined; schema: Schema | undefined; isLoading: boolean; error: unknown; missing: boolean } {
  const s = useSchema();
  const def = key && s.schema ? s.schema.def(key) : undefined;
  return { def, schema: s.schema, isLoading: s.isLoading, error: s.error, missing: !!s.schema && !!key && !def };
}

/** Refreshes the definitions everywhere (after a custom field, choice or layout change). */
export function useRefreshSchema() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: keys.meta(orgId) }), [qc, orgId]);
}

/** The signed-in person's id and the client-side condition environment (is_me, the organisation's zone). */
export function useMe() {
  const { me } = useSession();
  const { timezone } = useOrg();
  const userId = me?.user.id ?? null;
  const env = useMemo(() => clientEnv(userId, timezone), [userId, timezone]);
  return { userId, name: me?.user.full_name ?? "", env, tz: timezone };
}

// ---------------------------------------------------------------- reads

export function useRecordList(table: string | null | undefined, query: ListQuery, opts: { enabled?: boolean } = {}) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: keys.list(orgId, table ?? "", query),
    queryFn: () => recordsApi.list(api, table!, query),
    enabled: !!table && opts.enabled !== false,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useAggregate(table: string | null | undefined, body: { filter?: Cond | null; q?: string; groupBy: string[] }, opts: { enabled?: boolean } = {}) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: [...keys.aggs(orgId, table ?? ""), body] as const,
    queryFn: () => recordsApi.aggregate(api, table!, { ...body, limit: 200 }),
    enabled: !!table && opts.enabled !== false && body.groupBy.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useRecord(table: string | null | undefined, id: string | null | undefined) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: keys.record(orgId, table ?? "", id ?? ""),
    queryFn: () => recordsApi.get(api, table!, id!),
    enabled: !!table && !!id,
    staleTime: 5_000,
    retry: (n, e) => n < 2 && ![403, 404].includes((e as { status?: number }).status ?? 0),
  });
}

/** Journal and field history merged (newest first), with their display labels. */
export function useActivity(def: TableMeta | undefined, id: string | null | undefined, createdAt?: string | null) {
  const { api, orgId } = useOrg();
  const table = def?.key ?? "";
  const journal = !!def?.features?.journal;
  const history = def?.features?.history !== false;
  const q = useQuery({
    queryKey: keys.activity(orgId, table, id ?? ""),
    queryFn: async () => {
      const [j, h] = await Promise.all([
        journal ? recordsApi.journal(api, table, id!, { limit: 200 }) : Promise.resolve({ entries: [], display: {} }),
        history ? recordsApi.history(api, table, id!, { limit: 500 }) : Promise.resolve({ entries: [], display: {} }),
      ]);
      return { journal: j.entries, history: h.entries, display: { ...h.display, ...j.display } as DisplayMap };
    },
    enabled: !!def && !!id && (journal || history),
    staleTime: 5_000,
  });
  const items: ActivityItem[] = useMemo(() => (q.data ? mergeActivity(q.data.journal, q.data.history, createdAt) : []), [q.data, createdAt]);
  return { items, display: q.data?.display ?? {}, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
}

export function useLinks(table: string, id: string | null | undefined, enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: keys.links(orgId, table, id ?? ""), queryFn: () => recordsApi.links(api, table, id!), enabled: !!id && enabled, staleTime: 10_000 });
}

export function useAttachments(table: string, id: string | null | undefined, enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: keys.attachments(orgId, table, id ?? ""), queryFn: () => recordsApi.attachments(api, table, id!), enabled: !!id && enabled, staleTime: 10_000 });
}

/** Saved views of a table the caller may read (own and shared). */
export function useViews(table: string | null | undefined) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: keys.views(orgId, table ?? ""),
    queryFn: async () => (await recordsApi.list(api, "view", { filter: { f: "table_key", op: "eq", v: table }, size: 200, sort: "name", fields: VIEW_FIELDS, total: false })).rows as ViewRow[],
    enabled: !!table,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------- cache helpers

/** Replaces a record's fields in every cached list of its table (inline edits, board moves). */
export function patchListRows(qc: QueryClient, org: string, table: string, id: string, patch: Partial<RecordRow> | null): void {
  qc.setQueriesData<ListResult>({ queryKey: keys.lists(org, table) }, (old) => {
    if (!old?.rows) return old;
    if (patch === null) return { ...old, rows: old.rows.filter((r) => r.id !== id), total: old.total === null ? null : Math.max(0, old.total - 1) };
    return { ...old, rows: old.rows.map((r) => (r.id === id ? ({ ...r, ...patch } as RecordRow) : r)) };
  });
}

/** Snapshot of a table's cached lists (to roll an optimistic change back). */
export function snapshotLists(qc: QueryClient, org: string, table: string) {
  const snap = qc.getQueriesData<ListResult>({ queryKey: keys.lists(org, table) });
  return () => {
    for (const [k, v] of snap) qc.setQueryData(k, v);
  };
}

// ---------------------------------------------------------------- mutations

/**
 * Writes on one table. Each call updates the caches it knows about and marks the table's lists stale; errors are
 * thrown as they come (ApiError with the server's Persian message — callers decide on the toast, the conflict
 * dialog or field errors).
 */
export function useRecordActions(table: string) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  return useMemo(() => {
    const putRecord = (r: RecordResult) => qc.setQueryData(keys.record(orgId, table, r.row.id), r);
    const lists = (refetch = true) => {
      void qc.invalidateQueries({ queryKey: keys.lists(orgId, table), refetchType: refetch ? "active" : "none" });
      void qc.invalidateQueries({ queryKey: keys.aggs(orgId, table), refetchType: refetch ? "active" : "none" });
    };
    const side = (id: string) => {
      void qc.invalidateQueries({ queryKey: keys.activity(orgId, table, id) });
    };
    const afterWrite = (r: RecordResult) => {
      putRecord(r);
      patchListRows(qc, orgId, table, r.row.id, r.row);
      lists();
      side(r.row.id);
      return r;
    };
    return {
      create: async (data: Record<string, unknown>) => afterWrite(await recordsApi.create(api, table, data)),
      update: async (id: string, data: Record<string, unknown>, version?: number) => afterWrite(await recordsApi.update(api, table, id, data, version)),
      transition: async (id: string, to: string, data: Record<string, unknown> = {}, version?: number) => afterWrite(await recordsApi.transition(api, table, id, to, data, version)),
      remove: async (id: string, version?: number) => {
        await recordsApi.remove(api, table, id, version);
        patchListRows(qc, orgId, table, id, null);
        qc.removeQueries({ queryKey: keys.record(orgId, table, id) });
        lists();
      },
      bulk: async (body: Parameters<typeof recordsApi.bulk>[2]) => {
        const r = await recordsApi.bulk(api, table, body);
        lists();
        return r;
      },
      comment: async (id: string, kind: "comment" | "work_note", body: string, attachments?: string[]) => {
        const r = await recordsApi.addJournal(api, table, id, { kind, body, ...(attachments?.length ? { attachments } : {}) });
        side(id);
        // a public reply may stamp first_response_at; the record's meta may change
        void qc.invalidateQueries({ queryKey: keys.record(orgId, table, id) });
        return r;
      },
      watch: async (id: string, on: boolean, userId?: string) => {
        const key = keys.record(orgId, table, id);
        const prev = qc.getQueryData<RecordResult>(key);
        if (prev && !userId) qc.setQueryData<RecordResult>(key, { ...prev, meta: { ...prev.meta, watching: on } });
        try {
          const r = on ? await recordsApi.watch(api, table, id, userId) : await recordsApi.unwatch(api, table, id, userId);
          const cur = qc.getQueryData<RecordResult>(key);
          if (cur) qc.setQueryData<RecordResult>(key, { ...cur, row: { ...cur.row, watch_list: r.watch_list }, meta: { ...cur.meta, watching: r.watching } });
          void qc.invalidateQueries({ queryKey: key });
          side(id);
          return r;
        } catch (e) {
          if (prev) qc.setQueryData(key, prev);
          throw e;
        }
      },
      addLink: async (id: string, body: { kind: string; table: string; id: string; note?: string }) => {
        const r = await recordsApi.addLink(api, table, id, body);
        void qc.invalidateQueries({ queryKey: keys.links(orgId, table, id) });
        void qc.invalidateQueries({ queryKey: keys.links(orgId, body.table, body.id) });
        return r;
      },
      removeLink: async (id: string, linkId: string) => {
        await recordsApi.removeLink(api, table, id, linkId);
        void qc.invalidateQueries({ queryKey: ["record-links", orgId] });
      },
      upload: async (id: string, file: File, signal?: AbortSignal) => {
        const a = await uploadAttachment(orgId, table, id, file, signal);
        void qc.invalidateQueries({ queryKey: keys.attachments(orgId, table, id) });
        return a;
      },
      removeAttachment: async (id: string, attachmentId: string) => {
        await recordsApi.removeAttachment(api, table, id, attachmentId);
        void qc.invalidateQueries({ queryKey: keys.attachments(orgId, table, id) });
      },
      /** reloads a record from the server (after a conflict) */
      reload: (id: string) => qc.fetchQuery({ queryKey: keys.record(orgId, table, id), queryFn: () => recordsApi.get(api, table, id), staleTime: 0 }),
      refreshLists: () => lists(),
    };
  }, [api, orgId, qc, table]);
}

export type RecordActions = ReturnType<typeof useRecordActions>;

/** Saved-view writes (the `view` table) with the views list refreshed. */
export function useViewActions(table: string) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  return useMemo(() => {
    const done = () => qc.invalidateQueries({ queryKey: keys.views(orgId, table) });
    return {
      create: async (data: Record<string, unknown>) => {
        const r = await recordsApi.create(api, "view", { table_key: table, ...data });
        await done();
        return r.row as ViewRow;
      },
      update: async (v: ViewRow, data: Record<string, unknown>) => {
        const r = await recordsApi.update(api, "view", v.id, data, v.version);
        await done();
        return r.row as ViewRow;
      },
      remove: async (v: ViewRow) => {
        await recordsApi.remove(api, "view", v.id, v.version);
        await done();
      },
    };
  }, [api, orgId, qc, table]);
}
