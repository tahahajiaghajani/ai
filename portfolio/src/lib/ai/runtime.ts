import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { EmptyResponseError, ProviderError, streamGemini, type ChatMessage, type ProviderErrorKind } from "@/lib/ai/gemini";

/**
 * Gemini models with a free tier that a new Google AI Studio key can call (October 2026), tried in order after any
 * GEMINI_MODELS override. Every model has its own free quota, so the chain also multiplies the daily capacity.
 */
export const GEMINI_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];

export interface AiRuntime {
  apiKey: string;
  models: string[];
  temperature: number;
  maxTokens: number;
}

/** A runtime for a given key: the preferred models first, then the free chain. */
export function runtimeFor(apiKey: string, preferred: string[] = []): AiRuntime {
  return { apiKey, models: [...new Set([...preferred, ...GEMINI_CHAIN])], temperature: 0.4, maxTokens: 900 };
}

/**
 * The model connection, or null when the assistant is switched off in the panel or no key is set. The key saved in
 * the panel (Connections) wins over GEMINI_API_KEY in Vercel; so does its model list over GEMINI_MODELS.
 */
export async function getRuntime(): Promise<AiRuntime | null> {
  const s = await getSettings();
  if (!s.ai.enabled) return null;
  const apiKey = decrypt(s.ai.keyEnc) || env.geminiKey;
  if (!apiKey) return null;
  return runtimeFor(apiKey, s.ai.models.length ? s.ai.models : env.geminiModels);
}

/** Models that just failed for a reason that lasts (daily quota, unknown model), per key, for this instance. */
const held = new Map<string, { until: number; err: ProviderError }>();
const HOLD_MS: Partial<Record<ProviderErrorKind, number>> = { quota: 30 * 60_000, model: 6 * 3600_000 };
const holdKey = (rt: AiRuntime, model: string) => `${createHash("sha256").update(rt.apiKey).digest("hex").slice(0, 16)}|${model}`;

/** Silence before the first token: a model that sends nothing at all this long is skipped. */
const FIRST_TOKEN_MS = 20_000;
/** Busy model, per-minute limit or network error: one more try of the same model after a short pause. */
const RETRY_SAME: ProviderErrorKind[] = ["overloaded", "rate", "network"];
/** Failures that say "try again later" rather than "this setup is wrong". */
export const TRANSIENT: ProviderErrorKind[] = [...RETRY_SAME, "timeout", "quota"];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

function asProviderError(e: unknown, timedOut: boolean, waited: number): ProviderError {
  if (e instanceof ProviderError) return e;
  if (timedOut) return new ProviderError(`nothing received for ${waited / 1000}s`, 504, "timeout");
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
  return new ProviderError(`${e instanceof Error ? e.message : String(e)}${cause}`.slice(0, 300), 0, "network");
}

/** The error to report after every model failed: a transient one (worth "try again later") over a permanent one. */
function worst(errors: ProviderError[]): ProviderError | undefined {
  return errors.find((e) => TRANSIENT.includes(e.kind)) ?? errors.at(-1);
}

async function* prepend(first: string, rest: AsyncGenerator<string>): AsyncGenerator<string> {
  if (first) yield first;
  yield* rest;
}

/**
 * Opens a stream on the first model that answers with text. Busy, rate-limited and network failures get one retry;
 * a daily quota, an unknown model or an empty answer moves on to the next model; a rejected key or an unsupported
 * server location stops at once (no other model would work).
 */
export async function openStream(
  rt: AiRuntime,
  system: string,
  messages: ChatMessage[],
  opts: { json?: boolean; signal?: AbortSignal; maxTokens?: number; temperature?: number } = {},
): Promise<{ model: string; chunks: AsyncGenerator<string> }> {
  const errors: ProviderError[] = [];
  const resting: ProviderError[] = [];
  for (const model of rt.models) {
    const hk = holdKey(rt, model);
    const h = held.get(hk);
    if (h && h.until > Date.now()) {
      resting.push(h.err);
      continue;
    }
    for (let attempt = 0; ; attempt++) {
      const cut = new AbortController();
      let waiting = true;
      let timer = setTimeout(() => cut.abort(), FIRST_TOKEN_MS);
      const alive = () => {
        if (!waiting) return;
        clearTimeout(timer);
        timer = setTimeout(() => cut.abort(), FIRST_TOKEN_MS);
      };
      const gen = streamGemini({
        apiKey: rt.apiKey,
        model,
        system,
        messages,
        temperature: opts.temperature ?? rt.temperature,
        maxTokens: opts.maxTokens ?? rt.maxTokens,
        json: opts.json,
        signal: opts.signal ? AbortSignal.any([opts.signal, cut.signal]) : cut.signal,
        onProgress: alive,
      });
      try {
        const first = await gen.next();
        waiting = false;
        clearTimeout(timer);
        if (first.done) throw new EmptyResponseError("");
        held.delete(hk);
        return { model, chunks: prepend(first.value, gen) };
      } catch (e) {
        waiting = false;
        clearTimeout(timer);
        if (opts.signal?.aborted) throw e;
        const err = asProviderError(e, cut.signal.aborted, FIRST_TOKEN_MS);
        err.model = model;
        errors.push(err);
        console.warn("[ai] attempt failed", model, err.kind, err.status, err.message);
        if (err.kind === "auth" || err.kind === "region") throw err;
        const wait = err.kind === "rate" ? err.retryAfterMs || 1500 : 600 + Math.floor(Math.random() * 600);
        if (attempt === 0 && RETRY_SAME.includes(err.kind) && wait <= 5000) {
          await sleep(wait, opts.signal);
          continue;
        }
        const hold = err.kind === "rate" ? Math.min(err.retryAfterMs, 60_000) : (HOLD_MS[err.kind] ?? 0);
        if (hold > 0) held.set(hk, { until: Date.now() + hold, err });
        break;
      }
    }
  }
  throw worst(errors) ?? worst(resting) ?? new ProviderError("no model configured", 500, "other");
}

export async function complete(rt: AiRuntime, system: string, messages: ChatMessage[], opts: Parameters<typeof openStream>[3] = {}): Promise<{ text: string; model: string }> {
  const { model, chunks } = await openStream(rt, system, messages, opts);
  let text = "";
  for await (const c of chunks) text += c;
  return { text, model };
}

/** Extracts the first JSON object from a model reply (tolerates code fences and prose). */
export function parseJsonObject<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
