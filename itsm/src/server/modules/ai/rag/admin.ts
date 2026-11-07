// «نمایه و بازیابی» for ai:full: what the index of this runtime holds (per table and per collection the member may
// read), the vector backend and why, the embedding model and its health, pending vectors and the last runs.
import type { Ctx } from "../../../context";
import type { AiRagStatus } from "@shared/ai/rag";
import { aiErrorText } from "@shared/ai/errors";
import type { AiErrorKind } from "@shared/ai/types";
import { DOC_COLLECTION } from "@shared/tables/docs";
import { condEnv, defFor, orgSchema, readable } from "../../../engine";
import { loadEnv } from "../chain";
import { activeEmbedder, embedHeldUntil } from "./embed";
import { ragTables } from "./registry";
import { storeBackend } from "./store";
import { scheduleEmbed } from "./indexer";

export async function ragStatus(ctx: Ctx): Promise<AiRagStatus> {
  ctx.need("ai", "full");
  const env = await loadEnv(ctx);
  const [backend, embedder, schema] = await Promise.all([storeBackend(ctx.db), activeEmbedder(ctx, env), orgSchema(ctx)]);
  const rows = await ctx.db.query<{ table_key: string; documents: number; chunks: number; errors: number; pending: number; last: string | null; last_error: string | null }>(
    `select table_key, count(*)::int as documents, coalesce(sum(chunks), 0)::int as chunks, count(*) filter (where status = 'error')::int as errors,
            count(*) filter (where vec_pending)::int as pending, max(indexed_at) as last,
            (array_agg(error order by indexed_at desc) filter (where status = 'error'))[1] as last_error
     from sm_ai_rag_docs where org_id = $1 group by table_key`,
    [ctx.org.id],
  );
  const by = new Map(rows.map((r) => [r.table_key, r]));
  const tables = ragTables().map((d) => {
    const r = by.get(d.key);
    return {
      table: d.key,
      label: schema.def(d.key)?.plural ?? d.plural,
      documents: r?.documents ?? 0,
      chunks: r?.chunks ?? 0,
      errors: r?.errors ?? 0,
      pending: r?.pending ?? 0,
      last_indexed_at: r?.last ? new Date(r.last).toISOString() : null,
      last_error: r?.last_error ?? null,
    };
  });
  // collections the member may read (a private collection of someone else stays out of sight here too)
  const { def: cdef } = await defFor(ctx, DOC_COLLECTION);
  const params: unknown[] = [ctx.org.id];
  const where = readable(ctx, cdef, "k", params, await condEnv(ctx));
  const collections = await ctx.db.query<{ id: string; name: string; documents: number; ready: number; failed: number; chunks: number }>(
    `select k.id, k.name, count(d.id)::int as documents, count(d.id) filter (where d.status = 'ready')::int as ready,
            count(d.id) filter (where d.status in ('failed', 'needs_ocr'))::int as failed, coalesce(sum(s.chunks), 0)::int as chunks
     from sm_doc_collections k
     left join sm_doc_documents d on d.collection_id = k.id and d.org_id = k.org_id and d.deleted_at is null
     left join sm_ai_rag_docs s on s.org_id = k.org_id and s.table_key = 'doc_document' and s.record_id = d.id
     where k.org_id = $1 and ${where}
     group by k.id, k.name order by k.name limit 200`,
    params,
  );
  const runs = await ctx.db.query<{ id: string; kind: string; started_at: string; finished_at: string | null; stats: Record<string, number>; error: string | null }>(
    `select id, kind, started_at, finished_at, stats, error from sm_ai_rag_runs where org_id = $1 order by started_at desc limit 10`,
    [ctx.org.id],
  );
  let pending = 0;
  let problem: string | null = null;
  if (embedder) {
    pending = Number(
      (await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_chunks where org_id = $1 and kind = 'chunk' and (vec_key is null or vec_key <> $2)`, [ctx.org.id, embedder.key]))?.n ?? 0,
    );
    const held = await embedHeldUntil(ctx, embedder);
    if (held) problem = `${aiErrorText(((held.kind as AiErrorKind) ?? "rate")).message} (تا ${new Date(held.until).toISOString()})`;
    else if (embedder.row.status === "error" && embedder.row.last_error) problem = embedder.row.last_error.message;
  }
  return {
    enabled: env.settings.rag.enabled,
    backend: { kind: backend.kind, version: backend.version, reason: backend.reason },
    embedder: {
      quality: embedder ? "provider" : "local",
      key: embedder?.key ?? null,
      connection_id: embedder?.row.id ?? null,
      connection_label: embedder?.row.label ?? null,
      model: embedder?.config.model ?? null,
      dims: embedder?.config.dims ?? null,
      problem,
    },
    tables,
    collections,
    runs: runs.map((r) => ({ ...r, started_at: new Date(r.started_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null })),
    pending_vectors: pending,
  };
}

/** After the AI settings or a connection changed: vectors of a new embedding model are added in the background. */
export async function ragConfigChanged(ctx: Ctx): Promise<void> {
  try {
    const embedder = await activeEmbedder(ctx);
    if (embedder) await scheduleEmbed(ctx.db, ctx.org.id, 0);
  } catch (e) {
    ctx.cfg.log.warn("ai index: could not queue re-embedding", String((e as Error)?.message ?? e));
  }
}
