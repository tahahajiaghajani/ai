// The record engine's HTTP API (docs/spec/ENGINE.md §12) as typed calls on an organisation's client. Every function
// takes the `OrgApi` of `useOrg()`; errors are the platform's ApiError with the server's Persian message.
import type { Cond } from "@shared/model/conditions";
import { ApiError, type OrgApi } from "../../lib/api";
import { batchedList } from "./batch";
import type {
  AggregateResult, AttachmentItem, DisplayMap, HistoryEntry, JournalEntry, LinkItem, ListQuery, ListResult, RecordResult, RecordRow, TablesPayload, TableMeta,
} from "../model/types";
import type { Option } from "@shared/model/types";

const enc = encodeURIComponent;
const r = (table: string) => `/r/${enc(table)}`;
const rec = (table: string, id: string) => `${r(table)}/${enc(id)}`;

export const recordsApi = {
  tables: (api: OrgApi) => api.get<TablesPayload>("/meta/tables"),
  table: (api: OrgApi, key: string) => api.get<{ table: TableMeta; choices: Record<string, Option[]> }>(`/meta/tables/${enc(key)}`),

  /** POST /query: the filter travels as JSON in the body (no URL length limit). */
  // queries started together go as one request (./batch.ts)
  list: (api: OrgApi, table: string, q: ListQuery) => batchedList(api, table, clean(q)),
  get: (api: OrgApi, table: string, id: string) => api.get<RecordResult>(rec(table, id)),
  create: (api: OrgApi, table: string, data: Record<string, unknown>) => api.post<RecordResult>(r(table), data),
  update: (api: OrgApi, table: string, id: string, data: Record<string, unknown>, version?: number) =>
    api.patch<RecordResult>(rec(table, id), version ? { ...data, version } : data),
  transition: (api: OrgApi, table: string, id: string, to: string, data: Record<string, unknown> = {}, version?: number) =>
    api.post<RecordResult>(`${rec(table, id)}/transition`, { to, data, ...(version ? { version } : {}) }),
  remove: (api: OrgApi, table: string, id: string, version?: number) => api.del<{ ok: true }>(`${rec(table, id)}${version ? `?version=${version}` : ""}`),
  /** ≤ 500 records by ids (or the first 500 a filter matches); `transition` is the target state, `data` its values. */
  bulk: (api: OrgApi, table: string, body: { ids?: string[]; filter?: Cond | null; data?: Record<string, unknown>; transition?: string; delete?: boolean }) =>
    api.post<{ updated: number; failed: { id: string; message: string }[] }>(`${r(table)}/bulk`, body),
  aggregate: (api: OrgApi, table: string, body: { filter?: Cond | null; q?: string; groupBy: (string | { field: string; bucket?: string })[]; metrics?: { fn: string; field?: string }[]; limit?: number }) =>
    api.post<AggregateResult>(`${r(table)}/agg`, { metrics: [{ fn: "count" }], ...body }),
  exportRows: (api: OrgApi, table: string, body: ListQuery & { limit?: number }) =>
    api.post<{ columns: { name: string; label: string; type: string }[]; rows: (string | number | boolean | null)[][]; truncated: boolean }>(`${r(table)}/export`, clean(body)),
  importRows: (api: OrgApi, table: string, body: { rows: Record<string, string>[]; key?: string; dry_run?: boolean }) =>
    api.post<{ created: number; updated: number; errors: { row: number; field?: string; message: string }[]; dryRun: boolean; mapped: Record<string, string> }>(`${r(table)}/import`, body),

  journal: (api: OrgApi, table: string, id: string, o: { kinds?: string[]; limit?: number; before?: string } = {}) =>
    api.get<{ entries: JournalEntry[]; display: DisplayMap }>(`${rec(table, id)}/journal`, { kinds: o.kinds?.join(","), limit: o.limit, before: o.before }),
  addJournal: (api: OrgApi, table: string, id: string, body: { kind: "comment" | "work_note"; body: string; attachments?: string[] }) =>
    api.post<{ entry: JournalEntry; display: DisplayMap }>(`${rec(table, id)}/journal`, body),
  history: (api: OrgApi, table: string, id: string, o: { limit?: number } = {}) => api.get<{ entries: HistoryEntry[]; display: DisplayMap }>(`${rec(table, id)}/history`, { limit: o.limit }),
  links: (api: OrgApi, table: string, id: string) => api.get<{ links: LinkItem[] }>(`${rec(table, id)}/links`),
  addLink: (api: OrgApi, table: string, id: string, body: { kind: string; table: string; id: string; note?: string }) => api.post<{ link: LinkItem }>(`${rec(table, id)}/links`, body),
  removeLink: (api: OrgApi, table: string, id: string, linkId: string) => api.del<{ ok: true }>(`${rec(table, id)}/links/${enc(linkId)}`),
  watch: (api: OrgApi, table: string, id: string, userId?: string) => api.post<{ watching: boolean; watch_list: string[] }>(`${rec(table, id)}/watch`, userId ? { user_id: userId } : {}),
  unwatch: (api: OrgApi, table: string, id: string, userId?: string) =>
    api.del<{ watching: boolean; watch_list: string[] }>(`${rec(table, id)}/watch${userId ? `?user_id=${enc(userId)}` : ""}`),
  attachments: (api: OrgApi, table: string, id: string) => api.get<{ attachments: AttachmentItem[]; display: DisplayMap }>(`${rec(table, id)}/attachments`),
  removeAttachment: (api: OrgApi, table: string, id: string, attachmentId: string) => api.del<{ ok: true }>(`${rec(table, id)}/attachments/${enc(attachmentId)}`),
};

/** Drops empty parts of a list query (the server's zod schema refuses nulls for optional strings). */
function clean<T extends object>(q: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && !v.length && k !== "ids") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** URL of an attachment's bytes (`inline` only for raster images, as the server allows). */
export const attachmentUrl = (orgId: string, id: string, inline = false): string => `/api/o/${enc(orgId)}/attachments/${enc(id)}/content${inline ? "?inline=1" : ""}`;

/** Uploads a file to a record (multipart, field `file`); the server checks size and type. */
export async function uploadAttachment(orgId: string, table: string, id: string, file: File, signal?: AbortSignal): Promise<AttachmentItem> {
  const form = new FormData();
  form.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(`/api/o/${enc(orgId)}${rec(table, id)}/attachments`, { method: "POST", body: form, credentials: "same-origin", signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(0, "network", "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید");
  }
  const text = await res.text();
  let data: { attachment?: AttachmentItem; error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data?.attachment) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent("itsm:unauthorized"));
    const e = data?.error;
    const msg = res.status === 413 ? "فایل بزرگ‌تر از اندازهٔ مجاز است" : (e?.message ?? `بارگذاری «${file.name}» انجام نشد`);
    throw new ApiError(res.status, e?.code ?? "error", msg, e?.details);
  }
  return data.attachment;
}

/** Rows of every page of a list (for bulk work on «همهٔ نتیجه‌ها»), at most `max`. */
export async function allIds(api: OrgApi, table: string, q: ListQuery, max = 500): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  for (let page = 1; out.length < max; page++) {
    const res = await recordsApi.list(api, table, { ...q, page, size: Math.min(200, max), fields: ["number"], total: false });
    out.push(...res.rows);
    if (res.rows.length < Math.min(200, max)) break;
  }
  return out.slice(0, max);
}
