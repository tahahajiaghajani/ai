// Embedding adapters: one request of texts → vectors, per API style. OpenAI-compatible `/embeddings` (OpenAI, Ollama,
// LM Studio, llama.cpp, vLLM, Together, Mistral, DashScope, the domestic gateways), Jina (the same with a task), Gemini
// (`batchEmbedContents`), Voyage (`/embeddings` with input_type) and Cohere (`/v2/embed`); the test-only "fake" style
// answers with folded local vectors. Errors are ProviderErrors with the same kinds as the chat adapters (keys scrubbed),
// so the caller applies the same holds and fallbacks. Batching, retries, holds and usage live in ../rag/embed.ts.
import type { AiEmbedConfig, AiErrorKind } from "@shared/ai/types";
import { ProviderError, type AdapterEnv, type ResolvedConnection } from "../types";
import { connectMs, errorFromResponse, joinUrl, networkError } from "./http";
import { foldVector, localEmbed } from "../rag/local-embed";

export type EmbedKind = "document" | "query";

export interface EmbedCallResult {
  vectors: number[][];
  /** input tokens the provider counted (estimated when it does not say) */
  tokens: number;
}

/** How many texts one request may carry, per API style. */
export const EMBED_BATCH: Record<AiEmbedConfig["api"], number> = { openai: 96, jina: 96, voyage: 96, gemini: 96, cohere: 90, fake: 256 };

/** The API style a connection's protocol implies when it does not name one (null: the protocol has no embeddings). */
export function embedApiOf(protocol: ResolvedConnection["protocol"]): AiEmbedConfig["api"] | null {
  if (protocol === "gemini") return "gemini";
  if (protocol === "anthropic") return null;
  return "openai";
}

const estimate = (texts: string[]) => texts.reduce((n, t) => n + Math.ceil(t.length / 3.5), 0);

function invalid(msg = "پاسخ سرویس بردارسازی معتبر نبود"): ProviderError {
  return new ProviderError("invalid", msg);
}

function checkVectors(vectors: unknown, count: number, dims: number | null): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count) throw invalid(`سرویس بردارسازی ${vectors && Array.isArray(vectors) ? vectors.length : 0} بردار برای ${count} متن داد`);
  let size = -1;
  return vectors.map((v) => {
    if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === "number" && Number.isFinite(x))) throw invalid();
    if (size < 0) size = v.length;
    if (v.length !== size) throw invalid("طول بردارهای پاسخ یکسان نیست");
    if (dims && v.length !== dims) throw invalid(`مدل بردار ${v.length} بعدی داد، نه ${dims} بعدی؛ «اندازهٔ بردار» را خالی بگذارید یا با مدل یکی کنید`);
    return v as number[];
  });
}

async function postJson(env: AdapterEnv, conn: ResolvedConnection, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const timeout = AbortSignal.timeout(connectMs(conn) > 60_000 ? 300_000 : 60_000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await env.fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: sig });
  } catch (e) {
    throw networkError(e, timeout.aborted && !signal?.aborted, [conn.key]);
  }
  if (!res.ok) throw await errorFromResponse(res, [conn.key]);
  try {
    return await res.json();
  } catch {
    throw invalid();
  }
}

/** One embedding request (≤ EMBED_BATCH texts). */
export async function embedCall(conn: ResolvedConnection, cfg: AiEmbedConfig, texts: string[], kind: EmbedKind, env: AdapterEnv, signal?: AbortSignal): Promise<EmbedCallResult> {
  const bearer: Record<string, string> = conn.key ? { authorization: `Bearer ${conn.key}` } : {};
  switch (cfg.api) {
    case "fake": {
      const err = texts.map((t) => /\[embed-error:([a-z_]+)\]/.exec(t)?.[1]).find(Boolean);
      if (err) throw new ProviderError(err as AiErrorKind, `fake ${err} error`, err === "rate" ? 429 : 400, err === "rate" ? 1000 : null);
      return { vectors: texts.map((t) => foldVector(localEmbed(`fake ${t}`), cfg.dims ?? 64)), tokens: estimate(texts) };
    }
    case "gemini": {
      const model = cfg.model.replace(/^models\//, "");
      const j = await postJson(
        env,
        conn,
        joinUrl(conn.baseUrl, `models/${encodeURIComponent(model)}:batchEmbedContents`),
        conn.key ? { "x-goog-api-key": conn.key } : {},
        {
          requests: texts.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
            taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
            ...(cfg.dims ? { outputDimensionality: cfg.dims } : {}),
          })),
        },
        signal,
      );
      const vectors = checkVectors((j?.embeddings ?? []).map((e: { values?: number[] }) => e?.values), texts.length, cfg.dims);
      return { vectors, tokens: estimate(texts) };
    }
    case "cohere": {
      const j = await postJson(
        env,
        conn,
        joinUrl(conn.baseUrl, "v2/embed"),
        bearer,
        {
          model: cfg.model,
          texts,
          input_type: kind === "query" ? "search_query" : "search_document",
          embedding_types: ["float"],
          truncate: "END",
          ...(cfg.dims ? { output_dimension: cfg.dims } : {}),
        },
        signal,
      );
      const vectors = checkVectors(j?.embeddings?.float ?? j?.embeddings, texts.length, cfg.dims);
      return { vectors, tokens: Number(j?.meta?.billed_units?.input_tokens) || estimate(texts) };
    }
    case "voyage": {
      const j = await postJson(
        env,
        conn,
        joinUrl(conn.baseUrl, "embeddings"),
        bearer,
        { model: cfg.model, input: texts, input_type: kind, truncation: true, ...(cfg.dims ? { output_dimension: cfg.dims } : {}) },
        signal,
      );
      const data = [...(j?.data ?? [])].sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0));
      return { vectors: checkVectors(data.map((d: { embedding?: number[] }) => d?.embedding), texts.length, cfg.dims), tokens: Number(j?.usage?.total_tokens) || estimate(texts) };
    }
    default: {
      // OpenAI-compatible (and Jina, which adds its retrieval task)
      const body: Record<string, unknown> = { model: cfg.model, input: texts, encoding_format: "float", ...(cfg.dims ? { dimensions: cfg.dims } : {}) };
      if (cfg.api === "jina") body.task = kind === "query" ? "retrieval.query" : "retrieval.passage";
      const j = await postJson(env, conn, joinUrl(conn.baseUrl, "embeddings"), bearer, body, signal);
      const data = [...(j?.data ?? [])].sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0));
      return {
        vectors: checkVectors(data.map((d: { embedding?: number[] }) => d?.embedding), texts.length, cfg.dims),
        tokens: Number(j?.usage?.total_tokens ?? j?.usage?.prompt_tokens) || estimate(texts),
      };
    }
  }
}
