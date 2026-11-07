// Contracts of retrieval (RAG), cited answers and the smart documents library, shared by the server
// (src/server/modules/ai/rag, src/server/routes/ai-rag.ts) and the UI. Client-safe. Paths are relative to
// /api/o/:org/ai:
//
//   POST /ask                AiAskRequest → AiAskResult                                   (ai:view)
//   POST /ask/stream         AiAskRequest → text/event-stream of AiAskEvent                (ai:view)
//   POST /retrieve           AiRetrieveRequest → AiRetrieveResult (passages only, no model) (ai:view)
//   GET  /rag/status         → AiRagStatus                                                 (ai:full)
//   POST /rag/rebuild        { table? } → { queued }   re-index (one table or everything)   (ai:full)
//   POST /rag/reconcile      → { queued }              compare the index with the records  (ai:full)
//   POST /docs/upload        multipart: collection_id, file, title? → { document }          (adds to a collection)
//   GET  /docs/:id/pages     ?chunk= → AiDocPages (with the cited passage to highlight)     (reads the document)
//   POST /docs/:id/reingest  → { ok }                                                      (changes the document)
//
// Every passage and citation comes from a record the asking member may read now, with only the fields they may see:
// the server never returns or cites anything else (docs/spec/AI.md).

/** What an answer abstains with when the readable sources hold nothing relevant. */
export const NO_ANSWER_FA = "در منابع در دسترس شما پاسخی پیدا نشد";

/** Where to look: nothing = every source the member may read. */
export interface AiAskScope {
  /** engine tables (keys) */
  tables?: string[];
  /** smart-document collections */
  collections?: string[];
  /** smart documents */
  documents?: string[];
  /** particular records (a record's own context) */
  records?: { table: string; id: string }[];
}

export interface AiAskRequest {
  question: string;
  scope?: AiAskScope | null;
  /** passages to use (default: the organisation's setting) */
  k?: number;
}

export interface AiRetrieveRequest {
  query: string;
  scope?: AiAskScope | null;
  k?: number;
  rerank?: boolean;
}

/** Where a passage comes from, as the member may see it. */
export interface AiCitation {
  /** number used in the answer ([n]) */
  n: number;
  table: string;
  table_label: string;
  id: string;
  /** record number (INC0000012) */
  number: string | null;
  title: string;
  field: string | null;
  field_label: string | null;
  /** page anchors (documents) */
  page: number | null;
  page_end: number | null;
  /** in-app path (without the org prefix) that opens the passage */
  path: string;
  chunk_id: string;
}

export interface AiPassage {
  n: number;
  chunk_id: string;
  text: string;
  heading: string | null;
  /** fused rank score (higher is better; only comparable within one answer) */
  score: number;
  citation: AiCitation;
}

export interface AiRetrieveInfo {
  /** pgvector in the database, or float arrays compared in the server */
  backend: "pgvector" | "portable";
  /** embedding key of the vectors used (provider model), null = only the local embedder */
  embedder: string | null;
  /** provider = a configured embedding model answered; local = the built-in embedder (basic quality) */
  quality: "provider" | "local";
  /** candidates found by each list (after the access filter) */
  lists: { fts: number; vector: number; local: number; like: number };
  reranked: boolean;
  ms: number;
}

export interface AiRetrieveResult {
  passages: AiPassage[];
  info: AiRetrieveInfo;
}

export interface AiAskResult {
  answer: string;
  /** nothing relevant in the member's sources (the answer is NO_ANSWER_FA) */
  abstained: boolean;
  /** a model wrote the answer; false = the top passages without synthesis (no model available) */
  synthesized: boolean;
  /** sources cited by the answer, in citation order */
  citations: AiCitation[];
  /** passages the answer was given (numbered as in the answer) */
  passages: AiPassage[];
  /** sentences of the answer that cite nothing or a source that does not support them */
  unsupported: string[];
  model: string | null;
  /** why there is no synthesis (no model, AI off…) */
  note: string | null;
  info: AiRetrieveInfo;
}

/** Server-sent events of POST /ask/stream: passages first, then the answer as it is written, then the result. */
export type AiAskEvent =
  | { type: "passages"; passages: AiPassage[]; info: AiRetrieveInfo }
  | { type: "text"; delta: string }
  | { type: "done"; result: AiAskResult }
  | { type: "error"; kind: string; message_fa: string };

export interface AiRagTableStatus {
  table: string;
  label: string;
  /** records indexed */
  documents: number;
  chunks: number;
  errors: number;
  /** records waiting for their provider vectors */
  pending: number;
  last_indexed_at: string | null;
  last_error: string | null;
}

export interface AiRagRun {
  id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  stats: Record<string, number>;
  error: string | null;
}

export interface AiRagStatus {
  enabled: boolean;
  backend: { kind: "pgvector" | "portable"; version: string | null; reason: string | null };
  embedder: {
    /** provider = a configured embedding model; local = the built-in embedder only */
    quality: "provider" | "local";
    key: string | null;
    connection_id: string | null;
    connection_label: string | null;
    model: string | null;
    dims: number | null;
    /** the provider is held (rate limit, quota) or failing now */
    problem: string | null;
  };
  tables: AiRagTableStatus[];
  collections: { id: string; name: string; documents: number; ready: number; failed: number; chunks: number }[];
  runs: AiRagRun[];
  /** chunks whose provider vector is missing (re-embedding in progress) */
  pending_vectors: number;
}

export type AiDocStatus = "ingesting" | "ready" | "failed" | "needs_ocr";

export interface AiDocPages {
  id: string;
  title: string;
  status: AiDocStatus;
  pages: { page: number; text: string }[];
  /** the text was read by a vision model */
  ocr: boolean;
  /** GET …/pages?chunk=<id>: the cited passage to highlight (null when it is not a chunk of this document) */
  highlight?: { page: number | null; text: string } | null;
}
