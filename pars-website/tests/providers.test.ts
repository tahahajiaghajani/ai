import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText, ProviderError } from "@/lib/ai/providers";

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
