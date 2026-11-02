// AI engine: key envelopes, the four provider adapters against stubbed HTTP (streamed text, tool
// calls with replay, usage, error classes), the routing chain with fallbacks and holds, budgets and
// the data policy. No real provider is ever called: every request goes through cfg.fetch.
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { makeCtx, type AuthUser, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import { cleanKey, decryptKey, encryptKey, keyFingerprint, keyHint, keyReadable, scrubSecrets } from "@server/modules/ai/crypto";
import { anthropicAdapter } from "@server/modules/ai/adapters/anthropic";
import { openaiChatAdapter } from "@server/modules/ai/adapters/openai-chat";
import { openaiResponsesAdapter } from "@server/modules/ai/adapters/openai-responses";
import { geminiAdapter } from "@server/modules/ai/adapters/gemini";
import { classifyStatus, readSse } from "@server/modules/ai/adapters/http";
import { ProviderError, type AdapterEnv, type NeutralMessage, type ResolvedConnection, type TurnResult } from "@server/modules/ai/types";
import { presetById } from "@shared/ai/presets";
import { estimateCostUsd } from "@shared/ai/prices";
import { generate, aiStatus, AiUnavailableError } from "@server/modules/ai/engine";
import { maskText, redactValue } from "@server/modules/ai/redact";
import { Client, quietLog } from "./helpers";

// ---------------------------------------------------------------- helpers

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let req = init;
    if (typeof input === "object" && !(input instanceof URL)) {
      const r = input as Request;
      req = { method: r.method, headers: Object.fromEntries(r.headers.entries()), body: await r.text(), ...init };
    }
    const headers: Record<string, string> = {};
    new Headers(req.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    let body: any = null;
    if (typeof req.body === "string" && req.body) {
      try {
        body = JSON.parse(req.body);
      } catch {
        body = req.body;
      }
    }
    calls.push({ url, body, headers });
    return handler(url, req);
  }) as typeof fetch;
  return { f, calls };
}

function sse(events: (object | [string, object] | string)[]): Response {
  const text = events
    .map((e) => (typeof e === "string" ? `data: ${e}\n\n` : Array.isArray(e) ? `event: ${e[0]}\ndata: ${JSON.stringify(e[1])}\n\n` : `data: ${JSON.stringify(e)}\n\n`))
    .join("");
  // split into small chunks to exercise the parser across chunk borders
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function conn(preset: string, over: Partial<ResolvedConnection> = {}): ResolvedConnection {
  const p = presetById(preset)!;
  return { id: `conn-${preset}`, label: p.label, preset: p, protocol: p.protocol, baseUrl: p.base_url ?? "http://localhost", key: "sk-test-SECRET-123456", ...over };
}

const env = (f: typeof fetch): AdapterEnv => ({ fetch: f, mode: "cloud" });
const user = (text: string): NeutralMessage => ({ role: "user", parts: [{ type: "text", text }] });
const TOOL = { name: "get_total", description: "Total sales", schema: { type: "object", properties: { month: { type: "string" } }, required: ["month"] } };

/** History after one tool round, replaying the adapter's own native content. */
function afterTool(r: TurnResult, c: ResolvedConnection, model: string): NeutralMessage[] {
  return [
    user("فروش مهر؟"),
    { role: "assistant", parts: [...(r.text ? [{ type: "text" as const, text: r.text }] : []), ...r.toolCalls.map((t) => ({ type: "tool_call" as const, id: t.id, name: t.name, input: t.input }))], native: { protocol: c.protocol, model, connection_id: c.id, content: r.native } },
    { role: "user", parts: r.toolCalls.map((t) => ({ type: "tool_result" as const, id: t.id, name: t.name, content: '{"total":"1200"}' })) },
  ];
}

// ---------------------------------------------------------------- keys

describe("AI keys: AES-256-GCM v2 envelopes", () => {
  const b = { orgId: "org-1", connectionId: "conn-1" };
  it("round-trips, binds the ciphertext to its business and connection, and is strict", () => {
    const enc = encryptKey("secret-a", b, "sk-ant-abcdef123456");
    expect(enc.startsWith("v2.")).toBe(true);
    expect(enc).not.toContain("abcdef");
    expect(decryptKey("secret-a", b, enc)).toBe("sk-ant-abcdef123456");
    expect(() => decryptKey("secret-a", { orgId: "org-1", connectionId: "conn-2" }, enc)).toThrow();
    expect(() => decryptKey("secret-a", { orgId: "org-2", connectionId: "conn-1" }, enc)).toThrow();
    expect(() => decryptKey("secret-b", b, enc)).toThrow();
    // no plaintext pass-through, no v1
    expect(() => decryptKey("secret-a", b, "sk-ant-abcdef123456")).toThrow();
    expect(() => decryptKey("secret-a", b, "v1.aaa.bbb.ccc")).toThrow();
    expect(keyReadable("secret-a", b, enc)).toBe(true);
    expect(keyReadable("secret-a", b, enc.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBe(false);
  });

  it("cleans pasted keys, masks hints, fingerprints and scrubs keys from texts", () => {
    expect(cleanKey(" sk-abc‏123 \n‎456 ")).toBe("sk-abc123456");
    expect(keyHint("sk-ant-api03-xyzW1234")).toBe("…1234");
    expect(keyFingerprint("s", "k1")).toBe(keyFingerprint("s", "k1"));
    expect(keyFingerprint("s", "k1")).not.toBe(keyFingerprint("s", "k2"));
    const t = scrubSecrets("bad key sk-ant-api03-abcdefgh AIzaSyA1234567890123456789 Bearer abcdefghijk xai-abcdefghijkl nvapi-abcdefghijkl tpsg-abcdef12 ?key=AIzaXYZ", ["mykey-123456"]);
    expect(t).not.toMatch(/sk-ant-api03|AIzaSy|abcdefghijk\b|xai-abc|nvapi-abc|tpsg-abc|AIzaXYZ/);
  });
});

// ---------------------------------------------------------------- adapters

describe("OpenAI-compatible Chat adapter", () => {
  it("streams text, parses split tool calls, reports usage and replays its own message", async () => {
    const { f, calls } = stubFetch(() =>
      calls.length === 1
        ? sse([
            { model: "deepseek-chat", choices: [{ delta: { reasoning_content: "فکر" } }] },
            { choices: [{ delta: { content: "بررسی " } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_total", arguments: '{"mo' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'nth":"مهر"}' } }] }, finish_reason: "tool_calls" }] },
            { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } },
            "[DONE]",
          ])
        : sse([{ choices: [{ delta: { content: "جمع ۱۲۰۰ ریال" }, finish_reason: "stop" }] }, "[DONE]"]),
    );
    const c = conn("deepseek");
    const a = openaiChatAdapter(c, env(f));
    const texts: string[] = [];
    const thinking: string[] = [];
    const r1 = await a.turn({ model: "deepseek-chat", system: "S", messages: [user("فروش مهر؟")], tools: [TOOL], effort: "medium", maxTokens: 1000 }, { onText: (d) => texts.push(d), onThinking: (d) => thinking.push(d) });
    expect(r1.stop).toBe("tool");
    expect(r1.toolCalls).toEqual([{ id: "call_1", name: "get_total", input: { month: "مهر" } }]);
    expect(texts.join("")).toBe("بررسی ");
    expect(thinking.join("")).toBe("فکر");
    expect(r1.usage).toMatchObject({ input: 60, cache_read: 40, output: 20 });
    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer sk-test-SECRET-123456");
    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.messages[0]).toEqual({ role: "system", content: "S" });

    const r2 = await a.turn({ model: "deepseek-chat", system: "S", messages: afterTool(r1, c, "deepseek-chat"), tools: [TOOL], maxTokens: 1000 });
    expect(r2.text).toBe("جمع ۱۲۰۰ ریال");
    const sent = calls[1].body.messages;
    expect(sent[2]).toMatchObject({ role: "assistant", reasoning_content: "فکر", tool_calls: [{ id: "call_1", function: { name: "get_total", arguments: '{"month":"مهر"}' } }] });
    expect(sent[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"total":"1200"}' });
  });

  it("drops a parameter the service rejects and asks again", async () => {
    const { f, calls } = stubFetch(() =>
      calls.length === 1 ? json(400, { error: { message: "Unrecognized request argument supplied: stream_options" } }) : sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
    );
    const r = await openaiChatAdapter(conn("metis", { baseUrl: "https://api.tapsage.com/openai/v1" }), env(f)).turn({ model: "gpt-x", system: "S", messages: [user("hi")], maxTokens: 100 });
    expect(r.text).toBe("ok");
    expect(calls[1].body.stream_options).toBeUndefined();
  });
});

describe("OpenAI Responses adapter", () => {
  it("is stateless, streams text, returns function calls and replays the output items", async () => {
    const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "ENC", summary: [] };
    const call = { type: "function_call", id: "fc_1", call_id: "call_9", name: "get_total", arguments: '{"month":"مهر"}', status: "completed" };
    const { f, calls } = stubFetch(() =>
      calls.length === 1
        ? sse([
            ["response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta", delta: "..." }],
            ["response.output_item.done", { type: "response.output_item.done", item: reasoning }],
            ["response.output_item.done", { type: "response.output_item.done", item: call }],
            ["response.completed", { type: "response.completed", response: { status: "completed", model: "gpt-6.1-sol", output: [reasoning, call], usage: { input_tokens: 500, output_tokens: 80, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 50 } } } }],
          ])
        : sse([
            ["response.output_text.delta", { type: "response.output_text.delta", delta: "جمع " }],
            ["response.output_text.delta", { type: "response.output_text.delta", delta: "۱۲۰۰" }],
            ["response.completed", { type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "جمع ۱۲۰۰" }] }], usage: { input_tokens: 10, output_tokens: 5 } } }],
          ]),
    );
    const c = conn("openai");
    const a = openaiResponsesAdapter(c, env(f));
    const r1 = await a.turn({ model: "gpt-6.1-sol", system: "S", messages: [user("فروش مهر؟")], tools: [TOOL], effort: "high", maxTokens: 2000 });
    expect(r1.stop).toBe("tool");
    expect(r1.toolCalls).toEqual([{ id: "call_9", name: "get_total", input: { month: "مهر" } }]);
    expect(r1.usage).toEqual({ input: 100, cache_read: 400, cache_write: 0, output: 80, reasoning: 50 });
    const b1 = calls[0].body;
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(b1).toMatchObject({ store: false, include: ["reasoning.encrypted_content"], reasoning: { effort: "high" }, instructions: "S", max_output_tokens: 2000 });
    expect(b1.temperature).toBeUndefined();
    const r2 = await a.turn({ model: "gpt-6.1-sol", system: "S", messages: afterTool(r1, c, "gpt-6.1-sol"), tools: [TOOL], maxTokens: 2000 });
    expect(r2.text).toBe("جمع ۱۲۰۰");
    const input = calls[1].body.input;
    expect(input).toContainEqual(reasoning);
    expect(input).toContainEqual(call);
    expect(input[input.length - 1]).toEqual({ type: "function_call_output", call_id: "call_9", output: '{"total":"1200"}' });
  });
});

describe("Gemini adapter", () => {
  it("streams over SSE, keeps thought signatures exactly and reports usage", async () => {
    const { f, calls } = stubFetch(() =>
      calls.length === 1
        ? sse([
            { candidates: [{ content: { role: "model", parts: [{ text: "planning", thought: true }] } }] },
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_total", args: { month: "مهر" } }, thoughtSignature: "SIG-1" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 300, cachedContentTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 }, modelVersion: "gemini-3.8-flash" },
          ])
        : sse([{ candidates: [{ content: { role: "model", parts: [{ text: "جمع ۱۲۰۰" }] }, finishReason: "STOP" }] }]),
    );
    const c = conn("google", { key: "AIzaTESTKEY000000000000" });
    const a = geminiAdapter(c, env(f));
    const thoughts: string[] = [];
    const r1 = await a.turn({ model: "gemini-3.8-flash", system: "S", messages: [user("فروش مهر؟")], tools: [TOOL], effort: "max", maxTokens: 1000 }, { onThinking: (d) => thoughts.push(d) });
    expect(thoughts).toEqual(["planning"]);
    expect(r1.stop).toBe("tool");
    expect(r1.toolCalls[0]).toMatchObject({ name: "get_total", input: { month: "مهر" } });
    expect(r1.usage).toEqual({ input: 200, cache_read: 100, cache_write: 0, output: 50, reasoning: 30 });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(calls[0].headers["x-goog-api-key"]).toBe("AIzaTESTKEY000000000000");
    expect(calls[0].body.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
    expect(calls[0].body.store).toBe(false);
    expect(calls[0].body.generationConfig.temperature).toBeUndefined();
    const r2 = await a.turn({ model: "gemini-3.8-flash", system: "S", messages: afterTool(r1, c, "gemini-3.8-flash"), tools: [TOOL], maxTokens: 1000 });
    expect(r2.text).toBe("جمع ۱۲۰۰");
    const contents = calls[1].body.contents;
    expect(contents[1].parts).toContainEqual({ functionCall: { name: "get_total", args: { month: "مهر" } }, thoughtSignature: "SIG-1" });
    expect(contents[2].parts[0]).toEqual({ functionResponse: { name: "get_total", response: { result: '{"total":"1200"}' } } });
  });

  it("classifies «User location is not supported» as a region error", async () => {
    const { f } = stubFetch(() => json(400, { error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } }));
    const err = await geminiAdapter(conn("google"), env(f)).turn({ model: "gemini-3.8-flash", system: "S", messages: [user("x")], maxTokens: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("region");
    expect(err.message).not.toContain("sk-test-SECRET");
  });
});

describe("Anthropic adapter (official SDK)", () => {
  const thinking = { type: "thinking", thinking: "plan", signature: "SIG-A" };
  const msg1 = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "SIG-A" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "بررسی" } }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "get_total", input: {} } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"month":' } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"مهر"}' } }],
    ["content_block_stop", { type: "content_block_stop", index: 2 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null }, usage: { output_tokens: 40 } }],
    ["message_stop", { type: "message_stop" }],
  ] as [string, object][];
  const msg2 = [
    ["message_start", { type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "جمع ۱۲۰۰" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 8 } }],
    ["message_stop", { type: "message_stop" }],
  ] as [string, object][];

  it("follows the Claude API rules and replays thinking blocks unchanged", async () => {
    const { f, calls } = stubFetch(() => (calls.length === 1 ? sse(msg1) : sse(msg2)));
    const c = conn("anthropic", { key: "sk-ant-test-KEY-123456" });
    const a = anthropicAdapter(c, env(f));
    const texts: string[] = [];
    const r1 = await a.turn({ model: "claude-opus-5-5", system: "S", systemNotes: "notes", messages: [user("فروش مهر؟")], tools: [TOOL], effort: "medium", maxTokens: 32000 }, { onText: (d) => texts.push(d) });
    expect(r1.stop).toBe("tool");
    expect(texts.join("")).toBe("بررسی");
    expect(r1.toolCalls).toEqual([{ id: "toolu_1", name: "get_total", input: { month: "مهر" } }]);
    expect(r1.usage).toMatchObject({ input: 50, output: 40, cache_read: 900 });
    const b = calls[0].body;
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(b.temperature).toBeUndefined();
    expect(b.top_p).toBeUndefined();
    expect(b.tool_choice).toBeUndefined();
    expect(b.output_config).toEqual({ effort: "medium" });
    expect(b.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(b.cache_control).toEqual({ type: "ephemeral" });
    expect(b.system[0]).toEqual({ type: "text", text: "S", cache_control: { type: "ephemeral" } });
    expect(b.tools[0]).toMatchObject({ name: "get_total", strict: true, eager_input_streaming: true });
    expect(b.fallbacks).toBe("default");
    expect(calls[0].headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(calls[0].headers.authorization).toBe("Bearer sk-ant-test-KEY-123456");

    const r2 = await a.turn({ model: "claude-opus-5-5", system: "S", messages: afterTool(r1, c, "claude-opus-5-5"), tools: [TOOL], effort: "medium", maxTokens: 32000 });
    expect(r2.text).toBe("جمع ۱۲۰۰");
    const sent = calls[1].body.messages;
    expect(sent[1].role).toBe("assistant");
    expect(sent[1].content[0]).toEqual(thinking);
    expect(sent[1].content[2]).toMatchObject({ type: "tool_use", id: "toolu_1", name: "get_total" });
    expect(sent[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "toolu_1", content: '{"total":"1200"}' });
  });

  it("sends x-api-key to custom gateways, no betas there, and maps 429 with retry-after", async () => {
    const { f, calls } = stubFetch(() => json(429, { type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your per-minute rate limit" } }, { "retry-after": "7" }));
    const c = conn("custom-anthropic", { baseUrl: "https://gw.example.com", key: "gw-key-123456789" });
    const err = await anthropicAdapter(c, env(f)).turn({ model: "claude-opus-5-5", system: "S", messages: [user("x")], maxTokens: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("rate");
    expect(err.retryAfterMs).toBe(7000);
    expect(calls[0].headers["x-api-key"]).toBe("gw-key-123456789");
    expect(calls[0].headers["anthropic-beta"]).toBeUndefined();
    expect(calls).toHaveLength(1); // the chain decides about retries, not the SDK
  });

  it("returns a refusal without running tools", async () => {
    const refusal = [
      msg2[0],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: null, explanation: null } }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ] as [string, object][];
    const { f } = stubFetch(() => sse(refusal));
    const r = await anthropicAdapter(conn("anthropic"), env(f)).turn({ model: "claude-opus-5-5", system: "S", messages: [user("x")], tools: [TOOL], maxTokens: 100 });
    expect(r.stop).toBe("refusal");
    expect(r.toolCalls).toEqual([]);
  });
});

describe("error classification", () => {
  it("maps provider answers to error kinds", () => {
    expect(classifyStatus(403, "unsupported_country_region_territory: Country, region, or territory not supported")).toBe("region");
    expect(classifyStatus(401, "Incorrect API key provided")).toBe("auth");
    expect(classifyStatus(429, "You exceeded your current quota, please check your plan and billing details", "insufficient_quota")).toBe("quota");
    expect(classifyStatus(429, "Rate limit reached for requests per minute")).toBe("rate");
    expect(classifyStatus(402, "Insufficient Balance")).toBe("quota");
    expect(classifyStatus(404, "The model `gpt-9` does not exist")).toBe("model");
    expect(classifyStatus(529, "Overloaded")).toBe("overloaded");
    expect(classifyStatus(400, "API key not valid. Please pass a valid API key.")).toBe("auth");
    expect(classifyStatus(400, "max_tokens: too large")).toBe("invalid");
  });

  it("parses SSE across chunk borders, comments and multi-line data", async () => {
    const body = new Response(": ping\n\nevent: a\ndata: {\"x\":\ndata: 1}\n\ndata: [DONE]\n\n").body!;
    const out = [];
    for await (const e of readSse(body)) out.push(e);
    expect(out).toEqual([{ event: "a", data: { x: 1 } }]);
  });

  it("estimates costs from the dated table (0 for local and unknown models)", () => {
    expect(estimateCostUsd("claude-opus-5-5", { input: 1_000_000, output: 1_000_000, cache_read: 0, cache_write: 0 }, { day: "2026-11-02" })).toEqual({ usd: "24", priced: true });
    expect(estimateCostUsd("unknown-model", { input: 1000, output: 1000, cache_read: 0, cache_write: 0 }, { day: "2026-11-02" })).toEqual({ usd: "0", priced: false });
    expect(estimateCostUsd("llama3", { input: 1000, output: 1000, cache_read: 0, cache_write: 0 }, { day: "2026-11-02", local: true }).usd).toBe("0");
  });
});

// ---------------------------------------------------------------- chain, budgets, data policy (through a real server)

async function engineServer(handler: Handler) {
  const { f, calls } = stubFetch(handler);
  const db = await createPgliteDb({});
  await migrate(db);
  const cfg: ServerConfig = { mode: "cloud", db, secret: "test-secret", secretSource: "env", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: f };
  const app = createApp(cfg);
  const c = new Client(app);
  await c.post("/auth/signup", { email: "owner@example.com", password: "s3cret-pass", full_name: "مالک" });
  const { id: orgId } = await c.post<{ id: string }>("/orgs", { name: "فروشگاه", business_kind: "mixed", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 });
  const ctx = async () => {
    const u = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users where email = 'owner@example.com'`))!;
    const org = (await db.one<OrgRow>(`select * from tz_orgs where id = $1`, [orgId]))!;
    const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1 and user_id = $2`, [orgId, u.id]))!;
    return makeCtx(cfg, u, org, m);
  };
  return { c, db, orgId, calls, ctx };
}

const ok = (text: string) => sse([{ choices: [{ delta: { content: text }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } }, "[DONE]"]);

describe("routing chain, holds and budgets", () => {
  it("falls back to the next connection on a rate limit and holds the first one", async () => {
    const s = await engineServer((url) => (url.includes("deepseek") ? json(429, { error: { message: "Rate limit reached per minute" } }, { "retry-after": "30" }) : ok("پاسخ دوم")));
    const a = await s.c.post(`/o/${s.orgId}/ai/connections`, { preset: "deepseek", key: "sk-deepseek-0000000001", models: { fast: ["deepseek-chat"] } });
    await s.c.post(`/o/${s.orgId}/ai/connections`, { preset: "openrouter", key: "sk-or-v1-000000000002", models: { fast: ["openai/gpt-6-luna"] } });
    const ctx = await s.ctx();
    expect((await aiStatus(ctx, "fast")).ok).toBe(true);
    const r = await generate(ctx, { job: "fast", feature: "digest", system: "S", prompt: "خلاصه" });
    expect(r.text).toBe("پاسخ دوم");
    expect(r.model).toBe("openai/gpt-6-luna");
    const hold = await s.db.one<{ until: string; kind: string }>(`select until, kind from tz_ai_holds where connection_id = $1`, [a.connection.id]);
    expect(hold?.kind).toBe("rate");
    expect(Date.parse(hold!.until) - Date.now()).toBeGreaterThan(20_000);
    const usage = await s.db.query<{ ok: boolean; error_kind: string | null }>(`select ok, error_kind from tz_ai_usage where feature = 'digest' order by created_at`);
    expect(usage.map((u) => u.ok)).toEqual([false, true]);
    // the held connection is skipped without a request
    const before = s.calls.filter((c) => c.url.includes("deepseek")).length;
    await generate(ctx, { job: "fast", feature: "digest", system: "S", prompt: "دوباره" });
    expect(s.calls.filter((c) => c.url.includes("deepseek")).length).toBe(before);
    const list = await s.c.get(`/o/${s.orgId}/ai/connections`);
    expect(list.connections.find((x: { id: string }) => x.id === a.connection.id).status).toBe("paused");
    await s.c.post(`/o/${s.orgId}/ai/connections/${a.connection.id}/resume`);
    expect(await s.db.one(`select 1 from tz_ai_holds where connection_id = $1`, [a.connection.id])).toBeNull();
  });

  it("moves on after an auth error, marks the connection and validates structured output", async () => {
    const s = await engineServer((url) =>
      url.includes("deepseek") ? json(401, { error: { message: "Authentication Fails, Your api key: sk-dee****0001 is invalid" } }) : sse([{ choices: [{ delta: { content: '```json\n{"total": "12", "note": null}\n```' }, finish_reason: "stop" }] }]),
    );
    const a = await s.c.post(`/o/${s.orgId}/ai/connections`, { preset: "deepseek", key: "sk-deepseek-0000000001" });
    await s.c.post(`/o/${s.orgId}/ai/connections`, { preset: "openrouter", key: "sk-or-v1-000000000002" });
    const { z } = await import("zod");
    const r = await generate(await s.ctx(), { job: "analysis", feature: "explain", system: "S", prompt: "x", schema: z.object({ total: z.string(), note: z.string().optional() }) });
    expect(r.object).toEqual({ total: "12" });
    const row = await s.db.one<{ status: string; last_error: { kind: string; detail: string } }>(`select status, last_error from tz_ai_connections where id = $1`, [a.connection.id]);
    expect(row?.status).toBe("error");
    expect(row?.last_error.kind).toBe("auth");
    expect(JSON.stringify(row)).not.toContain("sk-deepseek-0000000001");
  });

  it("stops at the monthly budget and reports it", async () => {
    const s = await engineServer(() => ok("x"));
    await s.c.post(`/o/${s.orgId}/ai/connections`, { preset: "openrouter", key: "sk-or-v1-000000000002", models: { smart: ["anthropic/claude-opus-5.5"] } });
    await s.c.put(`/o/${s.orgId}/ai/settings`, { budgets: { monthly_usd: "0.01", alert_pct: 50 } });
    const ctx = await s.ctx();
    // 1000 input + 100 output of Opus 5.5 = $0.006 → alert (50%), then over the cap
    await generate(ctx, { job: "assistant", feature: "digest", system: "S", prompt: "یک" });
    let st = await s.c.get(`/o/${s.orgId}/ai/status`);
    expect(st.budget.state).toBe("alert");
    await generate(ctx, { job: "assistant", feature: "digest", system: "S", prompt: "دو" });
    st = await s.c.get(`/o/${s.orgId}/ai/status`);
    expect(st.budget.state).toBe("stopped");
    expect(st.ok).toBe(false);
    expect(st.kind).toBe("budget");
    const err = await generate(ctx, { job: "assistant", feature: "digest", system: "S", prompt: "سه" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.kind).toBe("budget");
    const usage = await s.c.get(`/o/${s.orgId}/ai/usage`);
    expect(usage.totals.calls).toBe(2);
    expect(usage.totals.cost_usd).toBe("0.012");
    expect(usage.by_feature[0].feature).toBe("digest");
  });

  it("masks personal identifiers before they reach the model", async () => {
    const s = await engineServer(() => ok("ok"));
    await s.c.post(`/o/${s.orgId}/ai/connections`, { preset: "openrouter", key: "sk-or-v1-000000000002" });
    await generate(await s.ctx(), { job: "fast", feature: "digest", system: "S", prompt: "موبایل ۰۹۱۲۳۴۵۶۷۸۹ و شبا IR820540102680020817909002 و کارت 6037991899999999" });
    const sent = JSON.stringify(s.calls[s.calls.length - 1].body);
    expect(sent).not.toContain("۰۹۱۲۳۴۵۶۷۸۹");
    expect(sent).not.toContain("IR820540102680020817909002");
    expect(sent).toContain("***6789");
  });
});

describe("data policy", () => {
  it("masks identifiers by key and pattern; aggregates also hides names", () => {
    const data = { party: { type: "party", name: "علی رضایی", national_id: "0012345678", mobile: "09121234567" }, note: "تماس با 09351112233", total: "1200" };
    const masked = redactValue(data, "masked") as any;
    expect(masked.party.name).toBe("علی رضایی");
    expect(masked.party.national_id).toBe("***5678");
    expect(masked.party.mobile).toBe("***4567");
    expect(masked.note).toBe("تماس با ***2233");
    expect(masked.total).toBe("1200");
    const agg = redactValue(data, "aggregates") as any;
    expect(agg.party.name).toBe("[نام پنهان]");
    expect(redactValue(data, "full")).toEqual(data);
    expect(maskText("کد ملی 0499370899")).toBe("کد ملی ***0899");
    expect(maskText("مبلغ 1234567890")).toBe("مبلغ 1234567890");
  });
});
