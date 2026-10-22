import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText, classify, errorFrom, geminiProfile, ProviderError, EmptyResponseError, type ProviderErrorKind } from "@/lib/ai/providers";
import { GEMINI_CHAIN, openStream, runtimeFrom, type AiRuntime, type Attempt } from "@/lib/ai/runtime";
import { encrypt } from "@/lib/crypto";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";

vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));

process.env.APP_SECRET = "test-secret-for-providers-0123456789";

function sse(events: unknown[], status = 200): Response {
  const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\r\n\r\n`).join("");
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<string>) {
  let s = "";
  for await (const c of gen) s += c;
  return s;
}

const base = { apiKey: "k", model: "m", system: "sys", messages: [{ role: "user" as const, content: "hi" }], temperature: 0.2, maxTokens: 100 };

/** Stubs fetch with one SSE reply and returns the parsed request body after the stream is read. */
async function requestBody(provider: "google" | "anthropic" | "openai", model: string, events: unknown[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => sse(events));
  vi.stubGlobal("fetch", fetchMock);
  await collect(streamText({ ...base, provider, model }));
  return JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
}

async function rejection(gen: AsyncGenerator<string>): Promise<ProviderError> {
  const err = await collect(gen).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EmptyResponseError);
  return err as ProviderError;
}

const geminiText = [{ candidates: [{ content: { parts: [{ text: "ok" }] } }] }];
const claudeText = [{ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } }];
const openaiText = [{ choices: [{ delta: { content: "ok" } }] }, "[DONE]"];

afterEach(() => vi.unstubAllGlobals());

describe("streamText", () => {
  it("parses Gemini SSE and skips thoughts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ candidates: [{ content: { parts: [{ text: "think", thought: true }, { text: "سلام" }] } }] }, { candidates: [{ content: { parts: [{ text: " دنیا" }] } }] }])));
    expect(await collect(streamText({ ...base, provider: "google" }))).toBe("سلام دنیا");
  });
  it("parses Anthropic text deltas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ type: "message_start" }, { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }, { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }])));
    expect(await collect(streamText({ ...base, provider: "anthropic" }))).toBe("Hello");
  });
  it("parses OpenAI-compatible chunks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ choices: [{ delta: { content: "A" } }] }, { choices: [{ delta: { content: "B" } }] }, "[DONE]"])));
    expect(await collect(streamText({ ...base, provider: "openai" }))).toBe("AB");
  });
  it("tells a per-minute limit from a daily quota", async () => {
    const perMinute = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota… Please retry in 1.5s.", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1.5s" }] } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(perMinute), { status: 429 })));
    await expect(collect(streamText({ ...base, provider: "google" }))).rejects.toMatchObject({ kind: "rate", retryAfterMs: 1500 });
    const perDay = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { retryDelay: "45s" }] } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(perDay), { status: 429 })));
    await expect(collect(streamText({ ...base, provider: "google" }))).rejects.toMatchObject({ kind: "quota" });
  });
  it("classifies auth errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })));
    const err = await collect(streamText({ ...base, provider: "google" })).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("auth");
  });
});

describe("request bodies", () => {
  it.each(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-opus-4-7"])("%s gets no temperature, low effort and room for thinking", async (model) => {
    const body = await requestBody("anthropic", model, claudeText);
    expect(body.temperature).toBeUndefined();
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBeGreaterThan(100);
    expect(body.thinking).toBeUndefined();
  });
  it.each(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-sonnet-4-6", "claude-3-7-sonnet-latest"])("%s keeps temperature and no effort", async (model) => {
    const body = await requestBody("anthropic", model, claudeText);
    expect(body.temperature).toBe(0.2);
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBe(100);
  });
  it.each([
    ["gemini-3.5-flash-lite", "minimal"],
    ["gemini-3.1-flash-lite", "minimal"],
    ["gemini-3.6-flash", "minimal"],
    ["gemini-3-flash-preview", "minimal"],
    ["gemini-3.8-flash", "low"],
    ["gemini-3.7-flash", "low"],
    ["gemini-4-argon", "low"],
    ["gemini-3.1-pro-preview", "low"],
    ["gemini-flash-latest", "low"],
    ["gemini-flash-lite-latest", "low"],
    ["gemini-pro-latest", "low"],
  ])("%s gets thinkingLevel %s, no temperature and room for thinking", async (model, level) => {
    const cfg = (await requestBody("google", model, geminiText)).generationConfig;
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: level });
    expect(cfg.temperature).toBeUndefined();
    expect(cfg.maxOutputTokens).toBeGreaterThan(100);
  });
  it("keeps the 2.5 Pro thinking budget and temperature", async () => {
    const pro = (await requestBody("google", "gemini-2.5-pro", geminiText)).generationConfig;
    expect(pro.thinkingConfig).toEqual({ thinkingBudget: 1024 });
    expect(pro.temperature).toBe(0.2);
    expect(pro.maxOutputTokens).toBeGreaterThan(100 + 1024);
  });
  it("never sends a thinking level to 2.x or Gemma", () => {
    for (const m of ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash", "gemma-3-27b-it", "models/gemini-2.5-flash"]) {
      expect(geminiProfile(m).thinking?.thinkingLevel).toBeUndefined();
      expect(geminiProfile(m).temperature).toBe(true);
    }
  });
  it("retries once with the model's defaults when Gemini rejects the thinking or sampling settings", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const cfg = JSON.parse(String(init?.body)).generationConfig;
      return cfg.thinkingConfig ? new Response(JSON.stringify({ error: { code: 400, message: "Invalid value at 'generation_config.thinking_config.thinking_level'", status: "INVALID_ARGUMENT" } }), { status: 400 }) : sse(geminiText);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await collect(streamText({ ...base, provider: "google", model: "gemini-9-flash" }))).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("folds the conversation into one turn when Gemini asks for thought signatures", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return body.contents.length > 1 ? new Response(JSON.stringify({ error: { code: 400, message: "Function call is missing a thought_signature", status: "INVALID_ARGUMENT" } }), { status: 400 }) : sse(geminiText);
    });
    vi.stubGlobal("fetch", fetchMock);
    const messages = [
      { role: "user" as const, content: "سلام" },
      { role: "assistant" as const, content: "درود" },
      { role: "user" as const, content: "دموها؟" },
    ];
    expect(await collect(streamText({ ...base, provider: "google", model: "gemini-3.6-flash", messages }))).toBe("ok");
    const folded = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).contents;
    expect(folded).toHaveLength(1);
    expect(folded[0].parts[0].text).toContain("Assistant: درود");
  });
  it("skips SSE lines that are not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(["keep-alive", ...geminiText])));
    expect(await collect(streamText({ ...base, provider: "google" }))).toBe("ok");
  });
  it("keeps the exact limit when Gemini thinking is off", async () => {
    for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
      const cfg = (await requestBody("google", model, geminiText)).generationConfig;
      expect(cfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
      expect(cfg.maxOutputTokens).toBe(100);
    }
    expect((await requestBody("google", "gemini-2.0-flash", geminiText)).generationConfig.maxOutputTokens).toBe(100);
  });
  it.each(["gpt-5", "gpt-5-mini", "o4-mini"])("%s gets low reasoning effort and room for reasoning", async (model) => {
    const body = await requestBody("openai", model, openaiText);
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBeGreaterThan(100);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
  it("sends no reasoning_effort to gpt-5 chat models", async () => {
    const body = await requestBody("openai", "gpt-5-chat-latest", openaiText);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
  it.each(["gpt-4.1-mini", "deepseek-chat", "qwen/qwen3-32b"])("%s keeps max_tokens and temperature", async (model) => {
    const body = await requestBody("openai", model, openaiText);
    expect(body).toMatchObject({ max_tokens: 100, temperature: 0.2 });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });
});

describe("finish reasons", () => {
  const cases: [string, "google" | "anthropic" | "openai", unknown[], ProviderErrorKind][] = [
    ["Gemini thinking used up the limit", "google", [{ candidates: [{ content: { parts: [{ text: "…", thought: true }] }, finishReason: "MAX_TOKENS" }] }], "other"],
    ["Gemini safety stop", "google", [{ candidates: [{ finishReason: "SAFETY" }] }], "blocked"],
    ["Claude refusal", "anthropic", [{ type: "message_start" }, { type: "message_delta", delta: { stop_reason: "refusal" } }, { type: "message_stop" }], "blocked"],
    ["Claude thinking used up max_tokens", "anthropic", [{ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } }, { type: "message_delta", delta: { stop_reason: "max_tokens" } }], "other"],
    ["OpenAI reasoning used up the limit", "openai", [{ choices: [{ delta: { content: "" }, finish_reason: "length" }] }, "[DONE]"], "other"],
    ["OpenAI content filter", "openai", [{ choices: [{ delta: {}, finish_reason: "content_filter" }] }, "[DONE]"], "blocked"],
  ];
  it.each(cases)("%s without text is an error", async (_name, provider, events, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(events)));
    const err = await rejection(streamText({ ...base, provider }));
    expect(err.kind).toBe(kind);
  });
  it("keeps text that was cut off by the limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ candidates: [{ content: { parts: [{ text: "نیمه" }] }, finishReason: "MAX_TOKENS" }] }])));
    expect(await collect(streamText({ ...base, provider: "google" }))).toBe("نیمه");
  });
});

describe("openStream", () => {
  const rt: AiRuntime = { provider: "google", apiKey: "k", baseUrl: "", models: ["first", "second"], temperature: 0.2, maxTokens: 100, instructions: "" };

  it("tries the next model when one ends without text", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/first:") ? sse([{ candidates: [{ finishReason: "SAFETY" }] }]) : sse([{ candidates: [{ content: { parts: [{ text: "پاسخ" }] }, finishReason: "STOP" }] }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { model, chunks } = await openStream(rt, "sys", base.messages);
    expect(model).toBe("second");
    expect(await collect(chunks)).toBe("پاسخ");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("treats a stream with no events as empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("/first:") ? sse([]) : sse(geminiText))));
    expect((await openStream(rt, "sys", base.messages)).model).toBe("second");
  });
  it("fails instead of returning an empty answer when every model is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ candidates: [{ finishReason: "MAX_TOKENS" }] }])));
    const err = await openStream(rt, "sys", base.messages).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmptyResponseError);
  });
  it("moves on to the next model after a rejected request", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes("/first:") ? new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }) : sse(geminiText)));
    vi.stubGlobal("fetch", fetchMock);
    expect((await openStream({ ...rt, apiKey: "k-invalid" }, "sys", base.messages)).model).toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["a rejected key", 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, "auth"],
    ["an unsupported location", 400, { error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } }, "region"],
  ] as const)("stops at %s: no other model would work", async (_name, status, body, kind) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(openStream({ ...rt, apiKey: `k-stop-${kind}` }, "sys", base.messages)).rejects.toMatchObject({ kind, model: "first" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries a busy model once before falling back", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => (++calls === 1 ? new Response(JSON.stringify({ error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }), { status: 503 }) : sse(geminiText)));
    vi.stubGlobal("fetch", fetchMock);
    const tries: Attempt[] = [];
    const { model } = await openStream({ ...rt, apiKey: "k-busy" }, "sys", base.messages, { onAttempt: (a) => tries.push(a) });
    expect(model).toBe("first");
    expect(tries.map((a) => [a.model, a.ok, a.kind])).toEqual([
      ["first", false, "overloaded"],
      ["first", true, undefined],
    ]);
  });
  it("rests a model after a daily quota or a 404 and skips it on the next call", async () => {
    const daily = { error: { code: 429, message: "limit: 20", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } };
    const closed = { error: { code: 404, message: "This model models/gemini-2.5-flash-lite is no longer available to new users.", status: "NOT_FOUND" } };
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/first:") ? new Response(JSON.stringify(daily), { status: 429 }) : url.includes("/second:") ? new Response(JSON.stringify(closed), { status: 404 }) : sse(geminiText),
    );
    vi.stubGlobal("fetch", fetchMock);
    const three = { ...rt, apiKey: "k-rest", models: ["first", "second", "third"] };
    expect((await openStream(three, "sys", base.messages)).model).toBe("third");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tries: Attempt[] = [];
    expect((await openStream(three, "sys", base.messages, { onAttempt: (a) => tries.push(a) })).model).toBe("third");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(tries.map((a) => a.kind)).toEqual(["skipped", "skipped", undefined]);
    // the connection test still calls every model
    expect((await openStream(three, "sys", base.messages, { fresh: true })).model).toBe("third");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
  it("reports a transient failure over a later permanent one", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/first:") ? new Response(JSON.stringify({ error: { code: 429, message: "limit: 0" } }), { status: 429 }) : new Response(JSON.stringify({ error: { code: 404, message: "not found" } }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(openStream({ ...rt, apiKey: "k-worst" }, "sys", base.messages)).rejects.toMatchObject({ kind: "quota", model: "first" });
  });
  it("gives up on a model that sends nothing in time and tries the next", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/first:")
        ? new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
        : sse(geminiText),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tries: Attempt[] = [];
    expect((await openStream({ ...rt, apiKey: "k-slow" }, "sys", base.messages, { firstTokenMs: 30, onAttempt: (a) => tries.push(a) })).model).toBe("second");
    expect(tries[0]).toMatchObject({ model: "first", ok: false, kind: "timeout" });
  });
  const hang = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
  it("turns the caller's time limit into a timeout that names the model", async () => {
    vi.stubGlobal("fetch", hang);
    const ac = new AbortController();
    setTimeout(() => ac.abort(new DOMException("deadline", "TimeoutError")), 20);
    await expect(openStream({ ...rt, apiKey: "k-deadline" }, "sys", base.messages, { signal: ac.signal })).rejects.toMatchObject({ kind: "timeout", model: "first" });
  });
  it("lets a visitor's cancel through as it is", async () => {
    vi.stubGlobal("fetch", hang);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    await expect(openStream({ ...rt, apiKey: "k-cancel" }, "sys", base.messages, { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  /** An SSE response whose events trickle in; the body errors when the request is aborted, like a real fetch. */
  function trickle(events: unknown[], every: number, init?: RequestInit): Response {
    const enc = new TextEncoder();
    let timer: ReturnType<typeof setTimeout>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let i = 0;
        const next = () => {
          if (i === events.length) return controller.close();
          controller.enqueue(enc.encode(`data: ${JSON.stringify(events[i++])}\n\n`));
          timer = setTimeout(next, every);
        };
        timer = setTimeout(next, every);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(new DOMException("aborted", "AbortError"));
        });
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  it("keeps waiting while a reasoning model streams its thinking", async () => {
    const thinking = Array.from({ length: 8 }, () => ({ choices: [{ delta: { reasoning_content: "…" } }] }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => trickle([...thinking, { choices: [{ delta: { content: "answer" } }] }], 40, init)));
    const r = { ...rt, provider: "openai" as const, apiKey: "k-reason", models: ["deepseek-reasoner"] };
    const { chunks } = await openStream(r, "sys", base.messages, { firstTokenMs: 150 });
    expect(await collect(chunks)).toBe("answer");
  });
  it("still gives up on a stream that goes quiet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => trickle([{ choices: [{ delta: { content: "late" } }] }], 400, init)));
    const r = { ...rt, provider: "openai" as const, apiKey: "k-quiet", models: ["m"] };
    await expect(openStream(r, "sys", base.messages, { firstTokenMs: 100 })).rejects.toMatchObject({ kind: "timeout", model: "m" });
  });
  it("reports why resting models rest instead of a made-up quota", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-x" } }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = { ...rt, provider: "anthropic" as const, apiKey: "k-held", models: ["claude-x"] };
    await expect(openStream(r, "sys", base.messages)).rejects.toMatchObject({ kind: "model" });
    await expect(openStream(r, "sys", base.messages)).rejects.toMatchObject({ kind: "model", model: "claude-x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not rest a model that only can't afford this request's size", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 402, message: "This request requires more credits, or fewer max_tokens. You requested up to 7096 tokens, but can only afford 3000." } }), { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = { ...rt, provider: "openai" as const, apiKey: "k-sized", models: ["m"] };
    await expect(openStream(r, "sys", base.messages, { maxTokens: 3000 })).rejects.toMatchObject({ kind: "quota" });
    await expect(openStream(r, "sys", base.messages)).rejects.toMatchObject({ kind: "quota" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("classify", () => {
  it.each([
    [401, '{"error":{"code":401,"message":"API key not valid.","status":"UNAUTHENTICATED","details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}]}}', "auth"],
    [403, '{"error":{"code":403,"message":"Your project has been denied access. Please contact support.","status":"PERMISSION_DENIED"}}', "auth"],
    [400, '{"error":{"message":"Your API key was reported as leaked. Please use another API key."}}', "auth"],
    [400, '{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}', "region"],
    [404, '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users.","status":"NOT_FOUND"}}', "model"],
    [503, '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}', "overloaded"],
    [429, '{"error":{"code":429,"message":"Quota exceeded … limit: 0, model: gemini-3.1-pro"}}', "quota"],
    [429, '{"error":{"code":429,"message":"rate limited","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}}', "rate"],
    [402, '{"error":{"message":"Your prepayment credits are depleted."}}', "quota"],
    [400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', "quota"],
    [529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "overloaded"],
    [429, '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}', "quota"],
    [400, '{"error":{"message":"bad request"}}', "invalid"],
    [403, '{"error":{"message":"The model `gpt-9` does not exist or you do not have access to it.","type":"invalid_request_error","code":"model_not_found"}}', "model"],
  ] as const)("%i %s → %s", (status, body, kind) => {
    expect(classify(status, body)).toBe(kind);
  });
  it("reads Gemini's retry delay", () => {
    expect(errorFrom(429, '{"error":{"details":[{"retryDelay":"45s"}]}}').retryAfterMs).toBe(45000);
    expect(errorFrom(429, '{"error":{"message":"Please retry in 2.5s."}}').retryAfterMs).toBe(2500);
  });
});

describe("runtimeFrom", () => {
  const ai = { ...DEFAULT_SETTINGS.ai, apiKeyEnc: encrypt("AQ.test") };
  it("puts the free Gemini chain after the configured models, without duplicates", () => {
    const r = runtimeFrom({ ...ai, model: "gemini-flash-latest", fallbackModels: ["gemini-2.5-flash-lite", "gemini-3.6-flash"] });
    expect(r?.models).toEqual(["gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-3.6-flash", ...GEMINI_CHAIN.filter((m) => m !== "gemini-3.6-flash")]);
  });
  it("adds nothing for other providers", () => {
    expect(runtimeFrom({ ...ai, provider: "anthropic", model: "claude-haiku-5-5", fallbackModels: [] })?.models).toEqual(["claude-haiku-5-5"]);
  });
});
