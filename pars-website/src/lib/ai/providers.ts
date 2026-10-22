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

/** The model finished without any visible text: a safety stop or refusal, or thinking used up the output limit. */
export class EmptyResponseError extends ProviderError {
  constructor(public finish: string) {
    super(`no text in the response${finish ? ` (${finish})` : ""}`, 200, /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII|refusal|content_filter/i.test(finish) ? "blocked" : "other");
  }
}

/** Thinking / reasoning tokens count against the output limit: extra room so they don't eat the answer (the prompts bound its length). */
const THINKING_ROOM = 4096;

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
  if (/gemini-2\.5-pro/.test(model)) return { thinkingBudget: 1024 }; // cannot be turned off
  if (/gemini-3/.test(model)) return { thinkingLevel: "low" };
  return undefined; // aliases (gemini-flash-latest, gemini-pro-latest) may point at either generation: model default
}

async function* google(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const thinking = geminiThinking(r.model);
  const mayThink = thinking?.thinkingBudget !== 0 && !/gemini-(1\.|2\.0)|gemma/.test(r.model);
  const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(r.model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": r.apiKey },
    signal: r.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: r.system }] },
      contents: r.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: r.temperature,
        maxOutputTokens: mayThink ? r.maxTokens + THINKING_ROOM : r.maxTokens,
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
  let finish = "";
  let yielded = false;
  for await (const data of sse(res)) {
    if (!data) continue;
    const j = JSON.parse(data);
    if (j.error) throw new ProviderError(j.error.message ?? "error", j.error.code ?? 500, classify(j.error.code ?? 500, j.error.message ?? ""));
    if (j.promptFeedback?.blockReason) throw new ProviderError(`blocked: ${j.promptFeedback.blockReason}`, 400, "blocked");
    const c = j.candidates?.[0];
    for (const part of c?.content?.parts ?? []) {
      if (part.text && !part.thought) {
        yielded = true;
        yield part.text as string;
      }
    }
    if (c?.finishReason) finish = c.finishReason;
  }
  if (!yielded) throw new EmptyResponseError(finish);
}

// Claude 3.x, 4.0–4.6 and Haiku 4.5 take sampling params and only think when asked. Newer models (Opus 4.7+,
// Sonnet 5+, Haiku 5.5) reject temperature (or any non-default value) and most think by default, inside max_tokens.
const CLAUDE_LEGACY = /^claude-(3[\w.-]*|haiku-4-5(-\d{8})?|sonnet-4(-[056])?(-\d{8})?|opus-4(-[0156])?(-\d{8})?)$/;

async function* anthropic(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  const legacy = CLAUDE_LEGACY.test(r.model);
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": r.apiKey, "anthropic-version": "2023-06-01" },
    signal: r.signal,
    body: JSON.stringify({
      model: r.model,
      system: r.system,
      // newer models: no sampling params; low effort keeps the (adaptive) thinking short, the extra room keeps it off the answer
      ...(legacy ? { max_tokens: r.maxTokens, temperature: r.temperature } : { max_tokens: r.maxTokens + THINKING_ROOM, output_config: { effort: "low" } }),
      stream: true,
      messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) await fail(res);
  let stop = "";
  let yielded = false;
  for await (const data of sse(res)) {
    if (!data) continue;
    const j = JSON.parse(data);
    if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
      if (j.delta.text) {
        yielded = true;
        yield j.delta.text as string;
      }
    } else if (j.type === "message_delta" && j.delta?.stop_reason) stop = j.delta.stop_reason;
    else if (j.type === "error") throw new ProviderError(j.error?.message ?? "error", 500, j.error?.type === "overloaded_error" ? "overloaded" : "other");
  }
  if (!yielded) throw new EmptyResponseError(stop);
}

async function* openai(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const reasoning = /^(gpt-5|o\d)/.test(r.model);
  // the chat variants and o1-mini / o1-preview take no reasoning_effort; "low" is accepted by every other reasoning model
  const effort = reasoning && !/^(gpt-5[\w.]*-chat|o1-mini|o1-preview)/.test(r.model);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${r.apiKey}` },
    signal: r.signal,
    body: JSON.stringify({
      model: r.model,
      stream: true,
      // reasoning models only accept the default temperature and max_completion_tokens, which also covers the (unstreamed) reasoning
      ...(reasoning
        ? { max_completion_tokens: r.maxTokens + THINKING_ROOM, ...(effort ? { reasoning_effort: "low" } : {}) }
        : { max_tokens: r.maxTokens, temperature: r.temperature }),
      messages: [{ role: "system", content: r.system }, ...r.messages],
    }),
  });
  if (!res.ok) await fail(res);
  let finish = "";
  let yielded = false;
  for await (const data of sse(res)) {
    if (!data || data === "[DONE]") continue;
    const j = JSON.parse(data);
    if (j.error) throw new ProviderError(j.error.message ?? "error", 500, classify(500, j.error.message ?? ""));
    const c = j.choices?.[0];
    if (c?.delta?.content) {
      yielded = true;
      yield c.delta.content as string;
    }
    if (c?.finish_reason) finish = c.finish_reason;
  }
  if (!yielded) throw new EmptyResponseError(finish);
}

export function streamText(r: StreamRequest): AsyncGenerator<string> {
  if (r.provider === "anthropic") return anthropic(r);
  if (r.provider === "openai") return openai(r);
  return google(r);
}
