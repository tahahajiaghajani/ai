// Shared plumbing of the raw-fetch adapters (OpenAI Responses, OpenAI-compatible Chat, Gemini):
// timers, server-sent-event parsing, and the provider error → AiErrorKind classification used by
// every adapter (the Anthropic adapter maps the SDK's typed errors through the same table).
import type { AiErrorKind } from "@shared/ai/types";
import { scrubSecrets } from "../crypto";
import { ProviderError } from "../types";

/** No byte from the provider for this long → the turn fails with `timeout`. */
export const IDLE_MS = 90_000;
/** Connection + first byte. */
export const CONNECT_MS = 45_000;

/** An AbortSignal that fires when `parent` aborts or `ms` pass; `touch(next?)` restarts the timer (optionally with a new length). */
export function idleSignal(parent: AbortSignal | undefined, ms: number) {
  const ac = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wait = ms;
  const arm = (next?: number) => {
    if (next) wait = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, wait);
  };
  const onAbort = () => ac.abort();
  if (parent?.aborted) ac.abort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  arm();
  return {
    signal: ac.signal,
    touch: (next?: number) => arm(next),
    timedOut: () => timedOut,
    done() {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

/** Parse a `text/event-stream` body: yields { event, data } with data JSON-parsed when possible. */
export async function* readSse(body: ReadableStream<Uint8Array>, touch?: () => void): AsyncGenerator<{ event: string | null; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | null = null;
  let data: string[] = [];
  const flush = function* () {
    if (!data.length) {
      event = null;
      return;
    }
    const raw = data.join("\n");
    data = [];
    const ev = event;
    event = null;
    if (raw === "[DONE]") return;
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    yield { event: ev, data: parsed };
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      touch?.();
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") {
          yield* flush();
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const val = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = val;
        else if (field === "data") data.push(val);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) {
      for (const line of buf.split("\n")) if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    yield* flush();
  } finally {
    reader.releaseLock();
  }
}

/** Retry-After header (seconds or HTTP date), retry-after-ms, or a hint in the message. */
export function retryAfterMs(headers: Headers | null | undefined, message = ""): number | null {
  const ms = Number(headers?.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const ra = headers?.get("retry-after");
  if (ra) {
    const s = Number(ra);
    if (Number.isFinite(s) && s >= 0) return Math.ceil(s * 1000);
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const hint = /retry (?:in|after) ([\d.]+)\s*s/i.exec(message) ?? /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message);
  return hint ? Math.ceil(Number(hint[1]) * 1000) : null;
}

const REGION_RE = /user location is not supported|unsupported_country|country,? region,? or territory|not available in your (country|region)|region (is )?not supported|your region|unsupported (region|location)|not supported in your (country|region|location)|from your location/i;
const QUOTA_RE = /insufficient_quota|insufficient (credits?|balance|funds)|credit balance|no credits|out of credits|payment required|exceeded your current quota|billing|\blimit: 0\b|quota exceeded for .*per ?day|PerDay|daily limit|balance is (too )?low|اعتبار|موجودی/i;
const MODEL_RE = /model[_ ]not[_ ]found|(model|deployment).{0,60}(not found|does not exist|not available|is not supported|unknown|no access|not have access|deprecated|retired)|unknown model|invalid model|no such model|does not have access to model|not a valid model/i;
const AUTH_RE = /invalid[_ ]api[_ ]key|incorrect api key|api key not valid|invalid x-api-key|unauthori[sz]ed|authentication|permission[_ ]denied|invalid (token|credentials)|api key (is )?(missing|invalid|expired|revoked)|API_KEY_INVALID/i;

/** Daily/no-credit quota vs a short per-minute limit (a 429 is a short limit unless it says otherwise). */
export function rateOrQuota(code: string | null, message: string): "rate" | "quota" {
  if (/\blimit: 0\b/.test(message)) return "quota";
  if (/per\s*minute|PerMinute|RPM|TPM|retry in \d/i.test(message)) return "rate";
  if (code === "insufficient_quota" || QUOTA_RE.test(message)) return "quota";
  return "rate";
}

/** Map an HTTP failure of any provider to an AiErrorKind. */
export function classifyStatus(status: number, message: string, code: string | null = null): AiErrorKind {
  const m = `${code ?? ""} ${message}`;
  if (REGION_RE.test(m)) return "region";
  if (status === 429) return rateOrQuota(code, m);
  if (status === 402 || (QUOTA_RE.test(m) && status !== 400 && status !== 404)) return "quota";
  if (status === 401) return "auth";
  if (status === 403) return MODEL_RE.test(m) ? "model" : "auth";
  // a 404 that does not talk about a model is usually a wrong base URL
  if (status === 404) return /model/i.test(m) ? "model" : "network";
  if (status === 408) return "timeout";
  if (status === 529 || status >= 500) return "overloaded";
  if (status === 400 || status === 413 || status === 422) {
    if (AUTH_RE.test(m)) return "auth";
    if (MODEL_RE.test(m)) return "model";
    if (/FAILED_PRECONDITION/.test(m) && /location|region|country/i.test(m)) return "region";
    return "invalid";
  }
  return "other";
}

/** Build a ProviderError from a failed response (reads the body; the text is scrubbed of keys). */
export async function errorFromResponse(res: Response, known: (string | null)[] = []): Promise<ProviderError> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 1500) || res.statusText || `HTTP ${res.status}`;
  let code: string | null = null;
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string; code?: string | number; type?: string; status?: string; details?: unknown } | string;
      message?: string;
      detail?: string;
    };
    const e = Array.isArray(j) ? (j[0] as typeof j)?.error : j.error;
    const eo = typeof e === "object" && e ? e : null;
    message = eo?.message ?? (typeof e === "string" ? e : null) ?? j.message ?? j.detail ?? message;
    code = eo?.code != null ? String(eo.code) : (eo?.type ?? eo?.status ?? null);
    if (eo?.status && eo.status !== code) message = `${eo.status}: ${message}`;
    if (eo?.details) message += ` ${JSON.stringify(eo.details).slice(0, 400)}`;
  } catch {
    /* not JSON */
  }
  const clean = scrubSecrets(`${res.status}: ${message}`, known);
  return new ProviderError(classifyStatus(res.status, clean, code), clean, res.status, retryAfterMs(res.headers, clean));
}

/** Classify a thrown fetch/network error (never an HTTP status). */
export function networkError(err: unknown, timedOut: boolean, known: (string | null)[] = []): ProviderError {
  if (err instanceof ProviderError) return err;
  if (timedOut) return new ProviderError("timeout", "پاسخی در زمان مقرر نرسید");
  const msg = scrubSecrets(String((err as Error)?.message ?? err), known);
  const cause = String((err as { cause?: { code?: string; message?: string } })?.cause?.code ?? (err as { cause?: { message?: string } })?.cause?.message ?? "");
  const all = `${msg} ${cause}`;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|fetch failed|socket|network|certificate|TLS|SSL/i.test(all)) return new ProviderError("network", msg.slice(0, 300));
  return new ProviderError("other", msg.slice(0, 300));
}

export function isAbort(err: unknown): boolean {
  return (err as Error)?.name === "AbortError" || /aborted|abort/i.test(String((err as Error)?.message ?? ""));
}

/** JSON that may be wrapped in a ``` fence or surrounded by prose. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

/** Parse tool-call arguments; `invalid` carries the raw text when it is not a JSON object. */
export function parseArgs(raw: string): { input: Record<string, unknown>; invalid?: string } {
  const s = raw.trim();
  if (!s) return { input: {} };
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) return { input: v as Record<string, unknown> };
  } catch {
    /* fall through */
  }
  return { input: {}, invalid: s.slice(0, 2000) };
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
