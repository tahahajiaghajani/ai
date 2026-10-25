import "server-only";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
  /** called whenever Gemini sends anything (headers, thinking events), before visible text too */
  onProgress?: () => void;
}

/**
 * `auth` (key rejected) and `region` (the server's location) fail every model; `quota` is a daily limit on this
 * model; `rate` a per-minute limit; `overloaded`, `timeout` and `network` are transient; `model` means the model is
 * unknown or closed to this key.
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

/** The model finished without any visible text: a safety stop, or thinking used up the output limit. */
export class EmptyResponseError extends ProviderError {
  constructor(public finish: string) {
    super(`no text in the response${finish ? ` (${finish})` : ""}`, 200, /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII/i.test(finish) ? "blocked" : "other");
  }
}

/** Thinking tokens count against the output limit: extra room so they don't eat the answer. */
const THINKING_ROOM = 4096;

export function classify(status: number, text: string): ProviderErrorKind {
  // Gemini answers 400 FAILED_PRECONDITION when the calling server is in an unsupported country
  if (/User location is not supported|unsupported_country|country, region,? or territory/i.test(text)) return "region";
  if (status === 402 || /insufficient_quota|prepayment/i.test(text)) return "quota";
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(text)) return /PerDay|limit: 0\b/i.test(text) ? "quota" : "rate";
  if ([500, 502, 503, 504, 529].includes(status) || /overloaded|UNAVAILABLE|high demand/i.test(text)) return "overloaded";
  if (status === 401 || status === 403 || /api[_ ]?key|PERMISSION_DENIED|UNAUTHENTICATED|reported as leaked/i.test(text)) return "auth";
  if (status === 404 || /not found|does not exist|no longer available/i.test(text)) return "model";
  if (status === 400) return "invalid";
  return "other";
}

/** Gemini's google.rpc.RetryInfo ("retryDelay": "45s") in milliseconds, 0 when absent. */
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

function parse(data: string): Record<string, any> | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Server-sent events → `data:` payloads. */
async function* sse(res: Response, onData?: () => void): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onData?.();
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
 * What a Gemini model accepts (October 2026): 2.x takes thinkingBudget and temperature; 3.x+ takes thinkingLevel
 * and keeps its default temperature. Flash-Lite and the 3.5/3.6 Flash models accept "minimal"; "low" works on all.
 */
export function geminiProfile(model: string): { thinking?: Record<string, unknown>; temperature: boolean; mayThink: boolean } {
  const m = model.toLowerCase().replace(/^models\//, "");
  if (/^(gemini-(1\.|2\.0)|gemma)/.test(m)) return { temperature: true, mayThink: false };
  if (/^gemini-2\.5-flash/.test(m)) return { thinking: { thinkingBudget: 0 }, temperature: true, mayThink: false };
  if (/^gemini-2\.5/.test(m)) return { thinking: { thinkingBudget: 1024 }, temperature: true, mayThink: true };
  const minimal = /^gemini-3(\.1|\.5|\.6)?-flash/.test(m);
  return { thinking: { thinkingLevel: minimal ? "minimal" : "low" }, temperature: false, mayThink: true };
}

/** Streams the visible text of one Gemini call (Google AI Studio REST, server-sent events). */
export async function* streamGemini(r: StreamRequest): AsyncGenerator<string> {
  const p = geminiProfile(r.model);
  const turns = r.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  // the whole conversation as one user turn, for a model that insists on thought signatures in earlier model turns
  const folded = [{ role: "user", parts: [{ text: r.messages.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`).join("\n\n") }] }];
  const call = (plain: boolean, fold = false) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:streamGenerateContent?alt=sse`, {
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
    // a model that rejects our thinking or sampling settings: once more with its defaults
    const text = await res.text().catch(() => "");
    const signature = /signature/i.test(text) && r.messages.length > 1;
    if (!signature && !/thinking|temperature|generation_?config/i.test(text)) throw errorFrom(400, text);
    res = await call(true, signature);
  }
  if (!res.ok) throw errorFrom(res.status, await res.text().catch(() => ""));
  r.onProgress?.();
  let finish = "";
  let yielded = false;
  for await (const data of sse(res, r.onProgress)) {
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
