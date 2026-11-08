// Retrieval (RAG) of the AI layer — public API for modules (docs/spec/AI.md):
//   retrieve(ctx, query, opts)            passages + citations the asking member may read (never with systemCtx)
//   askWithCitations(ctx, question, scope) a grounded, cited answer (or the passages when no model can answer)
//   registerRagSource({ table, build, … }) a module's own document builder / AI-channel rule for one of its tables
//   indexNow / queueBackfill / queueReconcile  index maintenance
// Tables declare their RAG document in their TableDef (`ai: { title, text }`, field `ai`, `features.rag`).
// `installRag()` (src/server/routes/modules.ts) registers the indexer's jobs and event subscriber and the smart
// documents library.
import { registerAiFeature } from "../settings";
import { registerRecordPath } from "../tools/common";
import { DOC_COLLECTION, DOC_DOCUMENT } from "@shared/tables/docs";
import { installIndexer } from "./indexer";
import { installDocs } from "./docs";

export { retrieve, fuse, tsQueryOf, type RetrieveOptions, type RetrievedPassage, type RetrieveResult } from "./retrieve";
export { askWithCitations, checkCitations, askPrompt, publicPassages, ASK_SYSTEM, type AskOptions } from "./ask";
export { registerRagSource, isRagTable, ragTables, defaultDocument, buildDocument, type RagSource, type RagBuildArgs, type RagDocument, type RagPart } from "./registry";
export { indexNow, indexRecord, indexSession, queueBackfill, queueReconcile, reconcile, removeFromIndex, embedMissing, scheduleEmbed, ensureSchedules, RAG_JOBS, type IndexOutcome } from "./indexer";
export { activeEmbedder, embedTexts, embedKey, EmbedUnavailableError, type EmbedderInfo } from "./embed";
export { storeBackend, forceStoreBackend, setAnnMinRows, ensureAnnIndexes, type StoreBackend } from "./store";
export { chunkDocument, CHUNKER_VERSION, type Chunk } from "./chunker";
export { localEmbed, cosine, LOCAL_DIMS, LOCAL_KEY } from "./local-embed";
export { ragStatus, ragConfigChanged } from "./admin";
export { uploadDocument, reingestDocument, removeOwned, documentPages, extractDocument, DOC_JOBS } from "./docs";
export { parseFile } from "./parsers";

let installed = false;

/** The index, its jobs and the smart documents library (idempotent; called once when the app is created). */
export function installRag(): void {
  if (installed) return;
  installed = true;
  registerAiFeature("rag_ask", "assistant");
  registerAiFeature("rag_rerank", "assistant");
  registerRecordPath(DOC_DOCUMENT, (id) => `docs/d/${id}`);
  registerRecordPath(DOC_COLLECTION, (id) => `docs?collection=${id}`);
  installIndexer();
  installDocs();
}
