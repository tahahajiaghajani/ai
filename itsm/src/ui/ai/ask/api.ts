// Data of retrieval, cited answers and the smart documents library (contracts: src/shared/ai/rag.ts): asking with a
// stream (passages, then the answer as it is written, then the result), the index's admin status, the documents of a
// collection, a document's pages and uploads. Light: modules import it from their index files.
import { useQuery } from "@tanstack/react-query";
import type { AiAskEvent, AiAskRequest, AiAskResult, AiDocPages, AiPassage, AiRagStatus, AiRetrieveInfo } from "@shared/ai/rag";
import type { OrgApi } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { useOrg } from "../../lib/org";
import { readFrames } from "../client";

export const RAG_KEYS = {
  status: (org: string) => ["ai-rag", org, "status"] as const,
  pages: (org: string, id: string, chunk: string | null) => ["ai-rag", org, "pages", id, chunk ?? ""] as const,
  collections: (org: string) => ["ai-rag", org, "collections"] as const,
  documents: (org: string, collection: string | null) => ["ai-rag", org, "documents", collection ?? "*"] as const,
};

export interface AskHandlers {
  onPassages?(passages: AiPassage[], info: AiRetrieveInfo): void;
  onText?(delta: string): void;
}

/** Ask with a stream; resolves with the final result (throws ApiError for a refused request or a stream error). */
export async function askStream(api: OrgApi, req: AiAskRequest, h: AskHandlers, signal?: AbortSignal): Promise<AiAskResult> {
  const res = await api.stream("/ai/ask/stream", req, signal);
  let result: AiAskResult | null = null;
  for await (const f of readFrames(res.body!, undefined, signal)) {
    let ev: AiAskEvent;
    try {
      ev = JSON.parse(f.data) as AiAskEvent;
    } catch {
      continue;
    }
    if (ev.type === "passages") h.onPassages?.(ev.passages, ev.info);
    else if (ev.type === "text") h.onText?.(ev.delta);
    else if (ev.type === "done") result = ev.result;
    else if (ev.type === "error") throw new ApiError(400, ev.kind, ev.message_fa);
  }
  if (!result) throw new ApiError(0, "network", "پاسخ کامل نرسید؛ دوباره بپرسید");
  return result;
}

export function useRagStatus(enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: RAG_KEYS.status(orgId), queryFn: () => api.get<AiRagStatus>("/ai/rag/status"), enabled, refetchInterval: 15_000 });
}

export function useDocPages(id: string, chunk: string | null) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: RAG_KEYS.pages(orgId, id, chunk), queryFn: () => api.get<AiDocPages & { highlight: { page: number | null; text: string } | null }>(`/ai/docs/${id}/pages`, { chunk }), enabled: !!id });
}

export interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  sharing: string;
  classification: string;
  owner_id: string;
  ai_enabled: boolean;
  open_contrib: boolean;
  version: number;
}

export interface DocumentRow {
  id: string;
  title: string;
  collection_id: string;
  owner_id: string;
  status: string;
  language: string | null;
  pages: number | null;
  file_id?: string | null;
  file_name: string | null;
  mime: string | null;
  size: number | null;
  ocr: boolean;
  error: string | null;
  summary: string | null;
  tags: string[];
  updated_at: string;
  version: number;
}

export function useCollections() {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: RAG_KEYS.collections(orgId),
    queryFn: () => api.get<{ rows: CollectionRow[] }>("/r/doc_collection", { size: 200, sort: "name", total: "false" }).then((r) => r.rows),
  });
}

export function useDocuments(collection: string | null) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: RAG_KEYS.documents(orgId, collection),
    queryFn: () =>
      api
        .get<{ rows: DocumentRow[]; display: Record<string, string> }>("/r/doc_document", {
          size: 200,
          sort: "-updated_at",
          total: "false",
          fields: "title,collection_id,owner_id,status,language,pages,file_name,mime,size,ocr,error,summary,tags,updated_at",
          ...(collection ? { filter: JSON.stringify({ f: "collection_id", op: "eq", v: collection }) } : {}),
        }),
    // documents being read refresh until they are done
    refetchInterval: (q) => ((q.state.data?.rows ?? []).some((d) => d.status === "ingesting") ? 3000 : false),
  });
}

/** Upload one file into a collection (multipart). */
export async function uploadDocument(orgId: string, collection: string, file: File, signal?: AbortSignal): Promise<DocumentRow> {
  const form = new FormData();
  form.append("collection_id", collection);
  form.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(`/api/o/${orgId}/ai/docs/upload`, { method: "POST", body: form, credentials: "same-origin", signal });
  } catch {
    throw new ApiError(0, "network", "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید");
  }
  const data = (await res.json().catch(() => null)) as { document?: DocumentRow; error?: { code: string; message: string } } | null;
  if (!res.ok || !data?.document) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `خطای ${res.status}`);
  return data.document;
}
