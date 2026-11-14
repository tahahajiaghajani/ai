// List queries a screen starts together — the shell's badge counts, a dashboard's lists — travel as one request
// (POST /o/:org/batch/query, src/server/routes/records.ts). On the web version every request is a function call that
// signs the person in and loads the organisation and the access model again; fifteen badge counts were fifteen of
// those. A query waits a few milliseconds for company; alone, it goes as the plain POST /r/:table/query.
import { ApiError, type OrgApi } from "../../lib/api";
import type { ListQuery, ListResult } from "../model/types";

const WINDOW_MS = 6;
const MAX = 25;

interface Waiting {
  table: string;
  query: unknown;
  resolve: (r: ListResult) => void;
  reject: (e: unknown) => void;
}

const queues = new Map<string, { api: OrgApi; items: Waiting[] }>();

async function flush(key: string): Promise<void> {
  const q = queues.get(key);
  queues.delete(key);
  if (!q) return;
  for (let i = 0; i < q.items.length; i += MAX) {
    const part = q.items.slice(i, i + MAX);
    if (part.length === 1) {
      const w = part[0];
      q.api.post<ListResult>(`/r/${encodeURIComponent(w.table)}/query`, w.query).then(w.resolve, w.reject);
      continue;
    }
    q.api
      .post<{ results: ({ ok: true; result: ListResult } | { ok: false; status: number; error: { code?: string; message?: string; details?: unknown } })[] }>("/batch/query", {
        queries: part.map((w) => ({ table: w.table, query: w.query })),
      })
      .then(
        (r) =>
          part.forEach((w, j) => {
            const x = r.results[j];
            if (x?.ok) w.resolve(x.result);
            else w.reject(new ApiError(x?.status ?? 500, x?.error?.code ?? "error", x?.error?.message ?? "خطای ناشناخته", x?.error?.details));
          }),
        (e) => part.forEach((w) => w.reject(e)),
      );
  }
}

/** POST /r/:table/query, sent together with the other list queries of the next few milliseconds. */
export function batchedList(api: OrgApi, table: string, query: ListQuery | Record<string, unknown>): Promise<ListResult> {
  const key = (api as Partial<OrgApi>).orgId;
  // a client without its organisation (a stand-in in a test) asks directly
  if (!key) return api.post<ListResult>(`/r/${encodeURIComponent(table)}/query`, query);
  return new Promise<ListResult>((resolve, reject) => {
    let q = queues.get(key);
    if (!q) {
      q = { api, items: [] };
      queues.set(key, q);
      setTimeout(() => void flush(key), WINDOW_MS);
    }
    q.items.push({ table, query, resolve, reject });
  });
}
