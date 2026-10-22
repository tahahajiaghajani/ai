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

/**
 * What went wrong, as far as the caller cares: `auth` (key rejected, project blocked) and `region` (the server's
 * location) fail every model; `quota` is a daily or hard limit on this model; `rate` a short per-minute limit;
 * `overloaded`, `timeout` and `network` are transient; `model` means the model is unknown or closed to this key.
 */
export type ProviderErrorKind = "auth" | "region" | "quota" | "rate" | "overloaded" | "timeout" | "network" | "model" | "invalid" | "blocked" | "other";

export class ProviderError extends Error {
  /** the model that failed (set by openStream) */
  model = "";
  constructor(
    message: string,
    public status: number,
    public kind: ProviderErrorKind,
    /** how long the service asked us to wait before retrying (429 RetryInfo), 0 when it did not say */
    public retryAfterMs = 0,
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

/** Error kind from an HTTP status and the raw error body (Gemini, Anthropic and OpenAI-compatible formats). */
export function classify(status: number, text: string): ProviderErrorKind {
  // Gemini answers 400 FAILED_PRECONDITION when the calling server is in an unsupported country
  if (/User location is not supported|unsupported_country|country, region,? or territory/i.test(text)) return "region";
  if (status === 402) return "quota";
  if (status === 429 || /RESOURCE_EXHAUSTED|rate_limit_error|insufficient_quota/i.test(text)) {
    // a daily quota (Gemini quotaId …PerDay…), no free tier for this model ("limit: 0") or no credit left: waiting a few seconds won't help
    return /PerDay|limit: 0\b|insufficient_quota|credit balance|credits are depleted|prepayment/i.test(text) ? "quota" : "rate";
  }
  if ([500, 502, 503, 504, 529].includes(status) || /overloaded|UNAVAILABLE|high demand/i.test(text)) return "overloaded";
  if (status === 401 || status === 403 || /api[_ ]?key|PERMISSION_DENIED|UNAUTHENTICATED|unauthori[sz]ed|invalid x-api-key|reported as leaked|denied access/i.test(text)) return "auth";
  if (status === 404 || /not found|does not exist|unknown model|model_not_found|no longer available/i.test(text)) return "model";
  if (status === 400) return "invalid";
  return "other";
}

/** Gemini's google.rpc.RetryInfo ("retryDelay": "45s" / "1.5s") in milliseconds, 0 when absent. */
function retryDelay(text: string): number {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(text);
  return m ? Math.round(Number(m[1]) * 1000) : 0;
}

export function errorFrom(status: number, text: string): ProviderError {
  let message = text;
  try {
    const j = JSON.parse(text);
    message = j?.error?.message || j?.message || text;
  } catch {}
  return new ProviderError(String(message).slice(0, 400) || `HTTP ${status}`, status, classify(status, text), retryDelay(text));
}

async function fail(res: Response): Promise<never> {
  throw errorFrom(res.status, await res.text().catch(() => ""));
}

/** Parses one SSE `data:` payload; a line that isn't JSON is skipped rather than failing the whole answer. */
function parse(data: string): Record<string, any> | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
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

/**
 * What a Gemini model accepts (October 2026). 2.x models take thinkingBudget and sampling settings. Gemini 3+ takes
 * thinkingLevel; 3.6+ and 4 ignore temperature (and will reject it), and Google asks to keep earlier 3.x at the
 * default, so it is only sent to 2.x. 3.8 Flash, 4 and the Pro models have no "minimal" level; "low" works on every
 * 3.x / 4 model, so aliases (gemini-flash-latest …) and unknown newer models get "low".
 */
export function geminiProfile(model: string): { thinking?: Record<string, unknown>; temperature: boolean; mayThink: boolean } {
  const m = model.toLowerCase().replace(/^models\//, "");
  if (/^(gemini-(1\.|2\.0)|gemma)/.test(m)) return { temperature: true, mayThink: false };
  if (/^gemini-2\.5-flash/.test(m)) return { thinking: { thinkingBudget: 0 }, temperature: true, mayThink: false };
  if (/^gemini-2\.5/.test(m)) return { thinking: { thinkingBudget: 1024 }, temperature: true, mayThink: true }; // 2.5 Pro cannot turn it off
  const minimal = /^gemini-3(\.1|\.5|\.6)?-flash/.test(m); // 3 Flash preview, 3.1 / 3.5 Flash-Lite, 3.5 / 3.6 Flash
  return { thinking: { thinkingLevel: minimal ? "minimal" : "low" }, temperature: false, mayThink: true };
}

async function* google(r: StreamRequest): AsyncGenerator<string> {
  const base = (r.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const p = geminiProfile(r.model);
  const turns = r.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  // the whole conversation as one user turn, for a model that insists on thought signatures in earlier model turns
  const folded = [{ role: "user", parts: [{ text: r.messages.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`).join("\n\n") }] }];
  const call = (plain: boolean, fold = false) =>
    fetch(`${base}/v1beta/models/${encodeURIComponent(r.model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": r.apiKey },
      signal: r.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: r.system }] },
        contents: fold ? folded : turns,
        generationConfig: {
          ...(p.temperature && !plain ? { temperature: r.temperature } : {}),
          maxOutputTokens: p.mayThink ? r.maxTokens + THINKING_ROOM : r.maxTokens,
          ...(r.json ? { responseMimeType: "application/json" } : {}),
          ...(p.thinking && !plain ? { thinkingConfig: p.thinking } : {}),
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    });
  let res = await call(false);
  if (res.status === 400) {
    // a model (or an alias's new target) that rejects our thinking or sampling settings: once more with its defaults
    const text = await res.text().catch(() => "");
    const signature = /signature/i.test(text) && r.messages.length > 1;
    if (!signature && !/thinking|temperature|generation_?config/i.test(text)) throw errorFrom(400, text);
    res = await call(true, signature);
  }
  if (!res.ok) await fail(res);
  let finish = "";
  let yielded = false;
  for await (const data of sse(res)) {
    const j = data ? parse(data) : null;
    if (!j) continue;
    if (j.error) throw errorFrom(Number(j.error.code) || 500, JSON.stringify(j));
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
    const j = data ? parse(data) : null;
    if (!j) continue;
    if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
      if (j.delta.text) {
        yielded = true;
        yield j.delta.text as string;
      }
    } else if (j.type === "message_delta" && j.delta?.stop_reason) stop = j.delta.stop_reason;
    else if (j.type === "error") throw new ProviderError(j.error?.message ?? "error", 500, j.error?.type === "overloaded_error" ? "overloaded" : j.error?.type === "rate_limit_error" ? "rate" : "other");
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
    const j = data && data !== "[DONE]" ? parse(data) : null;
    if (!j) continue;
    if (j.error) throw errorFrom(Number(j.error.code) || 500, JSON.stringify(j));
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
