import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText, ProviderError, EmptyResponseError, type ProviderErrorKind } from "@/lib/ai/providers";
import { openStream, type AiRuntime } from "@/lib/ai/runtime";

vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));

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
  it("classifies quota errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Resource has been exhausted (e.g. check quota)." } }), { status: 429 })));
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
  it("leaves room for thinking on Gemini models that may think", async () => {
    for (const model of ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"]) {
      const cfg = (await requestBody("google", model, geminiText)).generationConfig;
      expect(cfg.thinkingConfig).toBeUndefined();
      expect(cfg.maxOutputTokens).toBeGreaterThan(100);
    }
    const pro = (await requestBody("google", "gemini-2.5-pro", geminiText)).generationConfig;
    expect(pro.thinkingConfig).toEqual({ thinkingBudget: 1024 });
    expect(pro.maxOutputTokens).toBeGreaterThan(100 + 1024);
    const g3 = (await requestBody("google", "gemini-3-flash-preview", geminiText)).generationConfig;
    expect(g3.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(g3.maxOutputTokens).toBeGreaterThan(100);
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
  it("does not retry other errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(openStream(rt, "sys", base.messages)).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
