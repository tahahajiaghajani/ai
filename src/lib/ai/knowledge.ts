import "server-only";
import { Embeddings } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import { Document, type DocumentInterface } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { genai } from "@/lib/ai/gemini";
import { db } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { parseGeminiError } from "@/lib/ai/quota";
import { sleep } from "@/lib/utils";

export const EMBEDDING_DIM = 768;

export const KNOWLEDGE_KINDS: Record<string, string> = {
  snippet: "قطعه‌کد قابل استفاده",
  workflow: "ورکفلو / فرایند",
  lesson: "درس آموخته",
  requester_profile: "نحوه‌ی کار با تسک‌دهنده",
  prompt: "پرامپت موفق",
  decision: "تصمیم فنی",
  dead_end: "بن‌بست (کاری که جواب نداد)",
  reference: "مرجع و منبع",
  document: "سند",
};

/** LangChain Embeddings backed by the Gemini embedding API (768-dim, task-type aware). */
export class GeminiEmbeddings extends Embeddings {
  constructor(private model: string) {
    super({ maxConcurrency: 3, maxRetries: 2 });
  }

  private async embed(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await genai().models.embedContent({
          model: this.model,
          contents: text.slice(0, 24_000),
          config: { outputDimensionality: EMBEDDING_DIM, taskType },
        });
        const values = res.embeddings?.[0]?.values;
        if (!values?.length) throw new Error("embedding خالی برگشت");
        return values;
      } catch (err) {
        const info = parseGeminiError(err);
        if ((info.isQuota && !info.isDaily) || info.isOverloaded) {
          await sleep(Math.min(info.retryDelayMs ?? 4_000, 15_000));
          continue;
        }
        throw err;
      }
    }
    throw new Error("سرویس embedding در دسترس نیست");
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const d of documents) out.push(await this.caller.call(() => this.embed(d, "RETRIEVAL_DOCUMENT")));
    return out;
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.caller.call(() => this.embed(document, "RETRIEVAL_QUERY"));
  }
}

/** LangChain VectorStore over the `knowledge_items` table (pgvector) with hybrid search. */
export class SupabaseKnowledgeStore extends VectorStore {
  declare FilterType: Record<string, unknown>;

  _vectorstoreType(): string {
    return "supabase-knowledge";
  }

  async addVectors(vectors: number[][], documents: DocumentInterface[]): Promise<string[]> {
    const rows = documents.map((d, i) => ({
      content: d.pageContent,
      metadata: d.metadata ?? {},
      embedding: `[${vectors[i].join(",")}]`,
      score: Number(d.metadata?.score ?? 0),
    }));
    const { data, error } = await db().from("knowledge_items").insert(rows).select("id");
    if (error) throw new Error(`ذخیره‌ی دانش: ${error.message}`);
    return (data ?? []).map((r) => r.id as string);
  }

  async addDocuments(documents: DocumentInterface[]): Promise<string[]> {
    const vectors = await this.embeddings.embedDocuments(documents.map((d) => d.pageContent));
    return this.addVectors(vectors, documents);
  }

  async similaritySearchVectorWithScore(query: number[], k: number, filter?: this["FilterType"]): Promise<[DocumentInterface, number][]> {
    const { data, error } = await db().rpc("match_knowledge", {
      query_embedding: `[${query.join(",")}]`,
      match_count: k,
      filter: filter ?? {},
    });
    if (error) throw new Error(`جستجوی دانش: ${error.message}`);
    return (data ?? []).map((r: { id: string; content: string; metadata: Record<string, unknown>; similarity: number }) => [
      new Document({ id: r.id, pageContent: r.content, metadata: r.metadata }),
      r.similarity,
    ]);
  }

  /** Semantic + keyword (Reciprocal Rank Fusion) search. */
  async hybridSearch(query: string, k: number, filter: Record<string, unknown> = {}) {
    const vector = await this.embeddings.embedQuery(query);
    const { data, error } = await db().rpc("hybrid_search_knowledge", {
      query_text: query,
      query_embedding: `[${vector.join(",")}]`,
      match_count: k,
      filter,
    });
    if (error) throw new Error(`جستجوی ترکیبی: ${error.message}`);
    return (data ?? []) as { id: string; content: string; metadata: Record<string, unknown>; similarity: number; score: number }[];
  }
}

export async function knowledgeStore() {
  const settings = await getSettings();
  return new SupabaseKnowledgeStore(new GeminiEmbeddings(settings.models.embedding), {});
}

export interface KnowledgeHit {
  id: string;
  title: string;
  kind: string;
  content: string;
  similarity: number;
  task_code?: string;
}

export async function searchKnowledge(query: string, k = 8, filter: Record<string, unknown> = {}): Promise<KnowledgeHit[]> {
  const count = await db().from("knowledge_items").select("id", { count: "exact", head: true });
  if (!count.count) return [];
  const store = await knowledgeStore();
  const rows = await store.hybridSearch(query.slice(0, 6000), k, filter);
  if (rows.length) await db().rpc("bump_knowledge_usage", { p_ids: rows.map((r) => r.id) });
  return rows
    .filter((r) => r.similarity > 0.35 || r.score > 0.02)
    .map((r) => ({
      id: r.id,
      title: String(r.metadata.title ?? "بدون عنوان"),
      kind: String(r.metadata.kind ?? "document"),
      content: r.content,
      similarity: r.similarity,
      task_code: r.metadata.task_code as string | undefined,
    }));
}

export function formatKnowledgeContext(hits: KnowledgeHit[], maxChars = 14_000): string {
  if (!hits.length) return "";
  let out = "";
  for (const h of hits) {
    const block = `### ${h.title}\n- نوع: ${KNOWLEDGE_KINDS[h.kind] ?? h.kind}${h.task_code ? ` | از تسک ${h.task_code}` : ""} | شباهت: ${h.similarity.toFixed(2)}\n\n${h.content.trim()}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}

export interface NewKnowledge {
  kind: string;
  title: string;
  content: string;
  tags?: string[];
  score?: number;
  task_id?: string | null;
  task_code?: string | null;
  requester_id?: string | null;
  source?: string;
}

/** Split long items into chunks and store them with embeddings (LangChain pipeline). */
export async function addKnowledge(items: NewKnowledge[]): Promise<number> {
  if (!items.length) return 0;
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 3500, chunkOverlap: 250 });
  const docs: Document[] = [];
  for (const it of items) {
    const chunks = await splitter.splitText(it.content);
    chunks.forEach((chunk, i) =>
      docs.push(
        new Document({
          pageContent: chunk,
          metadata: {
            kind: it.kind,
            title: chunks.length > 1 ? `${it.title} (${i + 1}/${chunks.length})` : it.title,
            tags: it.tags ?? [],
            score: it.score ?? 3,
            task_id: it.task_id ?? undefined,
            task_code: it.task_code ?? undefined,
            requester_id: it.requester_id ?? undefined,
            source: it.source ?? "app",
            chunk: i,
          },
        }),
      ),
    );
  }
  const store = await knowledgeStore();
  await store.addDocuments(docs);
  return docs.length;
}
