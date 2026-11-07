// Embedding adapters against stubbed HTTP (no real provider is called): the request each API style sends (OpenAI-
// compatible with dimensions, Jina's retrieval task, Gemini's batchEmbedContents with task types, Voyage's input type,
// Cohere v2), responses re-ordered by index, sizes checked, provider errors classified like the chat adapters; the
// embedding capability of connections (validation, presets, the connection test row) and the retrieval settings.
import { describe, expect, it } from "vitest";
import { embedCall, embedApiOf } from "@server/modules/ai/adapters/embed";
import { embedConfigOf } from "@server/modules/ai/connections";
import { normalizeSettings, settingsPatchSchema } from "@server/modules/ai/settings";
import { presetById } from "@shared/ai/presets";
import { ProviderError, type AdapterEnv, type ResolvedConnection } from "@server/modules/ai/types";

function stub(handler: (url: string, body: any, headers: Record<string, string>) => Response) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    const body = JSON.parse(String(init.body ?? "null"));
    calls.push({ url, body, headers });
    return handler(url, body, headers);
  }) as typeof fetch;
  const env: AdapterEnv = { fetch: fetchFn, mode: "desktop" };
  return { calls, env };
}

const conn = (preset: string, baseUrl: string, key: string | null = "test-key"): ResolvedConnection => ({ id: "c1", label: "x", preset: presetById(preset)!, protocol: presetById(preset)!.protocol, baseUrl, key });
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });

describe("embedding adapters", () => {
  it("OpenAI-compatible: /embeddings with dimensions, vectors re-ordered by index, usage tokens", async () => {
    const { calls, env } = stub(() => json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 7, total_tokens: 7 } }));
    const r = await embedCall(conn("openai", "https://api.openai.com/v1"), { model: "text-embedding-3-small", dims: 2, api: "openai" }, ["الف", "ب"], "document", env);
    expect(r).toEqual({ vectors: [[1, 0], [0, 1]], tokens: 7 });
    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(calls[0].body).toEqual({ model: "text-embedding-3-small", input: ["الف", "ب"], encoding_format: "float", dimensions: 2 });
    expect(calls[0].headers.authorization).toBe("Bearer test-key");
  });

  it("local servers without a key send no authorization; Jina adds its retrieval task", async () => {
    const { calls, env } = stub(() => json({ data: [{ index: 0, embedding: [0.5, 0.5, 0.5] }] }));
    await embedCall(conn("ollama", "http://127.0.0.1:11434/v1", null), { model: "bge-m3", dims: null, api: "openai" }, ["سلام"], "query", env);
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body.dimensions).toBeUndefined();
    await embedCall(conn("jina", "https://api.jina.ai/v1"), { model: "jina-embeddings-v3", dims: 3, api: "jina" }, ["پرسش"], "query", env);
    expect(calls[1].body).toMatchObject({ task: "retrieval.query", dimensions: 3 });
  });

  it("Gemini: batchEmbedContents with task types and output dimensionality, key in its header", async () => {
    const { calls, env } = stub(() => json({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }));
    const r = await embedCall(conn("google", "https://generativelanguage.googleapis.com/v1beta"), { model: "gemini-embedding-001", dims: 2, api: "gemini" }, ["الف", "ب"], "document", env);
    expect(r.vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-key");
    expect(calls[0].body.requests[0]).toEqual({ model: "models/gemini-embedding-001", content: { parts: [{ text: "الف" }] }, taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 2 });
  });

  it("Voyage and Cohere: their own input types", async () => {
    const v = stub(() => json({ data: [{ index: 0, embedding: [1, 2] }], usage: { total_tokens: 3 } }));
    await embedCall(conn("voyage", "https://api.voyageai.com/v1"), { model: "voyage-3.5", dims: 2, api: "voyage" }, ["x"], "query", v.env);
    expect(v.calls[0].body).toEqual({ model: "voyage-3.5", input: ["x"], input_type: "query", truncation: true, output_dimension: 2 });
    const c = stub(() => json({ embeddings: { float: [[1, 2]] }, meta: { billed_units: { input_tokens: 4 } } }));
    const r = await embedCall(conn("cohere", "https://api.cohere.com"), { model: "embed-v4.0", dims: 2, api: "cohere" }, ["x"], "document", c.env);
    expect(c.calls[0].url).toBe("https://api.cohere.com/v2/embed");
    expect(c.calls[0].body).toMatchObject({ model: "embed-v4.0", texts: ["x"], input_type: "search_document", embedding_types: ["float"], output_dimension: 2 });
    expect(r.tokens).toBe(4);
  });

  it("classifies provider errors (429 with Retry-After → rate, 401 → auth) and refuses malformed answers", async () => {
    const rate = stub(() => json({ error: { message: "Rate limit reached for requests per minute" } }, 429, { "retry-after": "7" }));
    const e1 = await embedCall(conn("openai", "https://api.openai.com/v1"), { model: "m", dims: null, api: "openai" }, ["x"], "query", rate.env).catch((e) => e);
    expect(e1).toBeInstanceOf(ProviderError);
    expect([e1.kind, e1.retryAfterMs]).toEqual(["rate", 7000]);
    const auth = stub(() => json({ error: { message: "Incorrect API key provided: test-key" } }, 401));
    const e2 = await embedCall(conn("openai", "https://api.openai.com/v1"), { model: "m", dims: null, api: "openai" }, ["x"], "query", auth.env).catch((e) => e);
    expect(e2.kind).toBe("auth");
    expect(e2.message).not.toContain("test-key");
    const short = stub(() => json({ data: [{ index: 0, embedding: [1, 2] }] }));
    const e3 = await embedCall(conn("openai", "https://api.openai.com/v1"), { model: "m", dims: null, api: "openai" }, ["x", "y"], "query", short.env).catch((e) => e);
    expect(e3.kind).toBe("invalid");
    const wrongSize = stub(() => json({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    const e4 = await embedCall(conn("openai", "https://api.openai.com/v1"), { model: "m", dims: 2, api: "openai" }, ["x"], "query", wrongSize.env).catch((e) => e);
    expect(e4.message).toMatch(/۳|3/);
  });
});

describe("embedding capability of connections", () => {
  const openai = presetById("openai")!;
  it("is opt-in for chat services, preset for embedding-only ones, refused where the protocol has none", () => {
    expect(embedConfigOf(openai, "openai-responses", undefined, null, true)).toBeNull();
    expect(embedConfigOf(openai, "openai-responses", { model: "text-embedding-3-large", dims: 1024 }, null, true)).toEqual({ model: "text-embedding-3-large", dims: 1024, api: "openai" });
    expect(embedConfigOf(presetById("voyage")!, "openai-chat", undefined, null, true)).toEqual({ model: "voyage-3.5", dims: 1024, api: "voyage" });
    expect(() => embedConfigOf(presetById("voyage")!, "openai-chat", { model: "" }, null, false)).toThrow(/مدل بردارسازی/);
    expect(() => embedConfigOf(presetById("anthropic")!, "anthropic", { model: "voyage-3" }, null, true)).toThrow(/بردارسازی ندارد/);
    // an update without `embed` keeps it; a blank model removes it
    const cur = { model: "m", dims: 8, api: "openai" as const };
    expect(embedConfigOf(openai, "openai-responses", undefined, cur, false)).toBe(cur);
    expect(embedConfigOf(openai, "openai-responses", { model: "" }, cur, false)).toBeNull();
    expect(embedApiOf("gemini")).toBe("gemini");
    expect(embedApiOf("anthropic")).toBeNull();
  });

  it("retrieval settings: defaults, normalisation of stored rows and the patch rules", () => {
    expect(normalizeSettings({}).rag).toEqual({ enabled: true, embed_connection_id: null, rerank: false, summaries: true, top_k: 8 });
    expect(normalizeSettings({ rag: { top_k: 99, rerank: "yes", embed_connection_id: "x" } }).rag).toEqual({ enabled: true, embed_connection_id: null, rerank: false, summaries: true, top_k: 8 });
    expect(settingsPatchSchema.safeParse({ rag: { top_k: 1 } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ rag: { top_k: 12, rerank: true } }).success).toBe(true);
  });
});
