import "server-only";
import type { ProviderId } from "@/lib/settings-types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
}

export type ProviderErrorKind = "auth" | "quota" | "overloaded" | "model" | "invalid" | "blocked" | "other";

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: ProviderErrorKind,
  ) {
    super(message);
  }
}

function classify(status: number, text: string): ProviderErrorKind {
  if (status === 401 || status === 403 || /api[_ ]?key|PERMISSION_DENIED|unauthori[sz]ed|invalid x-api-key/i.test(text)) return "auth";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(text)) return "quota";
  if (status === 404 || /not found|does not exist|unknown model|model_not_found/i.test(text)) return "model";
  if (status === 503 || status === 529 || status === 500 || status === 502 || /overloaded|UNAVAILABLE/i.test(text)) return "overloaded";
  if (status === 400) return "invalid";
  return "other";
}

async function fail(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  let message = text;
  try {
    const j = JSON.parse(text);
    message = j?.error?.message || j?.message || text;
  } catch {}
  throw new ProviderError(message.slice(0, 400) || `HTTP ${res.status}`, res.status, classify(res.status, text));
}

/** Server-sent events → `data:` payloads. */
async function* sse(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith("data:")) yield buf.slice(5).trim();
}

function geminiThinking(model: string): Record<string, unknown> | undefined {
  if (/gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-3/.test(model)) return { thinkingLevel: "low" };
  return undefined;
}

async function* google(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const thinking = geminiThinking(r.model);
  const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(r.model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": r.apiKey },
    signal: r.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: r.system }] },
      contents: r.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: r.temperature,
        maxOutputTokens: r.maxTokens,
        ...(r.json ? { responseMimeType: "application/json" } : {}),
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      ],
    }),
  });
  if (!res.ok) await fail(res);
  for await (const data of sse(res)) {
    if (!data) continue;
    const j = JSON.parse(data);
    if (j.error) throw new ProviderError(j.error.message ?? "error", j.error.code ?? 500, classify(j.error.code ?? 500, j.error.message ?? ""));
    if (j.promptFeedback?.blockReason) throw new ProviderError(`blocked: ${j.promptFeedback.blockReason}`, 400, "blocked");
    for (const part of j.candidates?.[0]?.content?.parts ?? []) {
      if (part.text && !part.thought) yield part.text as string;
    }
  }
}

async function* anthropic(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": r.apiKey, "anthropic-version": "2023-06-01" },
    signal: r.signal,
    body: JSON.stringify({
      model: r.model,
      system: r.system,
      max_tokens: r.maxTokens,
      temperature: r.temperature,
      stream: true,
      messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) await fail(res);
  for await (const data of sse(res)) {
    if (!data) continue;
    const j = JSON.parse(data);
    if (j.type === "content_block_delta" && j.delta?.type === "text_delta") yield j.delta.text as string;
    else if (j.type === "error") throw new ProviderError(j.error?.message ?? "error", 500, j.error?.type === "overloaded_error" ? "overloaded" : "other");
  }
}

async function* openai(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${r.apiKey}` },
    signal: r.signal,
    body: JSON.stringify({
      model: r.model,
      stream: true,
      // newer OpenAI models only accept the default temperature and max_completion_tokens
      ...(/^(gpt-5|o\d)/.test(r.model) ? { max_completion_tokens: r.maxTokens } : { max_tokens: r.maxTokens, temperature: r.temperature }),
      messages: [{ role: "system", content: r.system }, ...r.messages],
    }),
  });
  if (!res.ok) await fail(res);
  for await (const data of sse(res)) {
    if (!data || data === "[DONE]") continue;
    const j = JSON.parse(data);
    if (j.error) throw new ProviderError(j.error.message ?? "error", 500, classify(500, j.error.message ?? ""));
    const t = j.choices?.[0]?.delta?.content;
    if (t) yield t as string;
  }
}

export function streamText(r: StreamRequest): AsyncGenerator<string> {
  if (r.provider === "anthropic") return anthropic(r);
  if (r.provider === "openai") return openai(r);
  return google(r);
}
