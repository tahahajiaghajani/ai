import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type Part, type GenerateContentConfig } from "@google/genai";
import { env } from "@/lib/env";
import { DeadlineError, RateLimitError, TransientError } from "@/lib/errors";
import { nextPacificMidnight, parseGeminiError } from "@/lib/ai/quota";
import { extractJson, wordCount } from "@/lib/utils";
import type { LogInput } from "@/lib/events";

let client: GoogleGenAI | null = null;

export function genai(): GoogleGenAI {
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY تنظیم نشده است");
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

/** Job-bound hooks the generator uses to persist progress and report live status. */
export interface GenContext {
  getPartial(): { key: string; text: string; model?: string } | null | undefined;
  savePartial(p: { key: string; text: string; model?: string } | null): Promise<void>;
  live(update: { chars?: number; thought?: string; model?: string }): void;
  log(e: Omit<LogInput, "task_id" | "job_id" | "upgrade_id">): Promise<void>;
  blockedModels(): Promise<Record<string, { blocked_until?: string; reason?: string }>>;
  blockModel(model: string, until: Date, reason: string): Promise<void>;
  addUsage(u: { input?: number; output?: number; thoughts?: number }): void;
}

export interface GenOptions {
  agent: string;
  models: string[];
  system: string;
  history?: Content[];
  userParts: Part[];
  jsonSchema?: Record<string, unknown>;
  thinking?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  maxOutputTokens?: number;
  useSearch?: boolean;
  temperature?: number;
  deadline: number;
  partialKey: string;
  ctx: GenContext;
}

export interface GenResult {
  text: string;
  model: string;
  searchQueries: string[];
  finishReason?: string;
}

const CONTINUE_TEXT =
  "پاسخ قبلی‌ات به دلیل محدودیت زمان/طول قطع شد. دقیقاً از همان نقطه‌ای که متوقف شدی ادامه بده؛ هیچ چیزی را تکرار نکن و مقدمه ننویس.";
const CONTINUE_JSON =
  "خروجی JSON قبلی‌ات قطع شد. فقط ادامه‌ی دقیق همان JSON را از کاراکتر بعدی بنویس، بدون تکرار، بدون ``` و بدون توضیح.";

const SAFETY_MARGIN_MS = 4_000;
const MIN_CALL_MS = 9_000;

function thoughtHeadline(t: string): string | null {
  const bold = [...t.matchAll(/\*\*([^*]{3,120})\*\*/g)].map((m) => m[1].trim());
  if (bold.length) return bold[bold.length - 1];
  const line = t.trim().split("\n").find((l) => l.trim().length > 12);
  return line ? line.trim().slice(0, 120) : null;
}

/**
 * Streams a Gemini response with:
 *  - model fallback chain (daily quota / limit 0 → next model)
 *  - automatic pause on per-minute limits (RateLimitError)
 *  - deadline-aware streaming that saves partial output and continues on the next tick
 *  - thought summaries surfaced to the live log
 */
export async function generate(opts: GenOptions): Promise<GenResult> {
  const blocked = await opts.ctx.blockedModels();
  const now = Date.now();
  const partial = opts.ctx.getPartial();
  const continuing = partial && partial.key === opts.partialKey ? partial : null;

  let chain = opts.models.filter((m) => {
    const b = blocked[m]?.blocked_until;
    return !b || new Date(b).getTime() <= now;
  });
  if (continuing?.model && chain.includes(continuing.model)) {
    chain = [continuing.model, ...chain.filter((m) => m !== continuing.model)];
  }

  if (!chain.length) {
    const soonest = opts.models
      .map((m) => (blocked[m]?.blocked_until ? new Date(blocked[m]!.blocked_until!).getTime() : now + 3600_000))
      .sort((a, b) => a - b)[0];
    throw new RateLimitError("gemini", new Date(soonest), "provider", "همه‌ی مدل‌های Gemini به سقف مصرف رسیده‌اند");
  }

  let lastErr: unknown = null;
  let useSearch = !!opts.useSearch;
  let thinking = opts.thinking;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      return await streamOnce({ ...opts, useSearch, thinking }, model, continuing?.model === model ? continuing.text : "");
    } catch (err) {
      if (err instanceof DeadlineError || err instanceof RateLimitError) throw err;
      const info = parseGeminiError(err);
      lastErr = err;

      if (info.isQuota) {
        if (useSearch && !info.quotaIds.length) {
          // Google Search grounding is not available on this key's free tier: retry without it.
          useSearch = false;
          await opts.ctx.log({ source: "gemini", kind: "warning", title: "جستجوی گوگل برای این کلید در دسترس نیست؛ ادامه بدون آن" });
          i--;
          continue;
        }
        if (info.isDaily || info.limitZero) {
          const until = info.limitZero ? new Date(Date.now() + 24 * 3600_000) : nextPacificMidnight();
          await opts.ctx.blockModel(model, until, info.limitZero ? "این مدل در پلن رایگان سهمیه ندارد" : "سقف روزانه");
          await opts.ctx.log({
            source: "gemini",
            kind: "warning",
            title: `مدل ${model} به سقف ${info.limitZero ? "دسترسی" : "روزانه"} رسید`,
            detail: chain[i + 1] ? `ادامه با مدل ${chain[i + 1]}` : "مدل جایگزینی باقی نمانده است",
          });
          continue;
        }
        const wait = Math.max(info.retryDelayMs ?? 30_000, 5_000) + 2_000;
        throw new RateLimitError("gemini", new Date(Date.now() + wait), "provider", "سقف درخواست در دقیقه‌ی Gemini", model);
      }

      if (info.isInvalid && thinking) {
        // Some models reject thinking levels: retry once without the thinking config.
        thinking = undefined;
        i--;
        continue;
      }

      if (info.isOverloaded) {
        await opts.ctx.log({ source: "gemini", kind: "warning", title: `مدل ${model} شلوغ است`, detail: info.message.slice(0, 300) });
        continue;
      }
      throw err;
    }
  }

  const info = parseGeminiError(lastErr);
  if (info.isQuota || (lastErr === null && chain.length)) {
    const b = await opts.ctx.blockedModels();
    const soonest = opts.models
      .map((m) => (b[m]?.blocked_until ? new Date(b[m]!.blocked_until!).getTime() : Date.now() + 60_000))
      .sort((a, c) => a - c)[0];
    throw new RateLimitError("gemini", new Date(soonest), "provider", "سهمیه‌ی همه‌ی مدل‌ها تمام شده است");
  }
  throw new TransientError(`Gemini در دسترس نیست: ${info.message.slice(0, 200)}`, 45_000);
}

async function streamOnce(opts: GenOptions, model: string, prefix: string): Promise<GenResult> {
  const timeLeft = opts.deadline - Date.now() - SAFETY_MARGIN_MS;
  if (timeLeft < MIN_CALL_MS) throw new DeadlineError();

  let text = prefix;
  let rounds = 0;
  let finishReason: string | undefined;
  const searchQueries = new Set<string>();

  // Continue automatically on MAX_TOKENS while time permits.
  while (rounds < 4) {
    rounds++;
    const isContinuation = text.length > 0;
    const contents: Content[] = [...(opts.history ?? []), { role: "user", parts: opts.userParts }];
    if (isContinuation) {
      contents.push({ role: "model", parts: [{ text }] });
      contents.push({ role: "user", parts: [{ text: opts.jsonSchema ? CONTINUE_JSON : CONTINUE_TEXT }] });
    }

    const config: GenerateContentConfig = {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? (opts.jsonSchema ? 0.4 : 0.8),
      maxOutputTokens: opts.maxOutputTokens ?? 32768,
      thinkingConfig: { includeThoughts: true, ...(opts.thinking ? { thinkingLevel: ThinkingLevel[opts.thinking] } : {}) },
    };
    if (opts.jsonSchema && !isContinuation) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = opts.jsonSchema;
    }
    if (opts.useSearch && !opts.jsonSchema) config.tools = [{ googleSearch: {} }];

    const controller = new AbortController();
    const budget = opts.deadline - Date.now() - SAFETY_MARGIN_MS;
    if (budget < MIN_CALL_MS) {
      await opts.ctx.savePartial({ key: opts.partialKey, text, model });
      throw new DeadlineError();
    }
    const timer = setTimeout(() => controller.abort(), budget);
    config.abortSignal = controller.signal;

    let thoughtBuf = "";
    let lastLive = 0;
    let lastSave = Date.now();
    let lastThoughtLog = 0;
    let lastHeadline = "";
    finishReason = undefined;

    try {
      const stream = await genai().models.generateContentStream({ model, contents, config });
      for await (const chunk of stream) {
        const cand = chunk.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          if (!part.text) continue;
          if (part.thought) thoughtBuf += part.text;
          else text += part.text;
        }
        if (cand?.finishReason) finishReason = String(cand.finishReason);
        for (const q of cand?.groundingMetadata?.webSearchQueries ?? []) searchQueries.add(q);
        if (chunk.usageMetadata) {
          opts.ctx.addUsage({
            input: chunk.usageMetadata.promptTokenCount ?? 0,
            output: chunk.usageMetadata.candidatesTokenCount ?? 0,
            thoughts: chunk.usageMetadata.thoughtsTokenCount ?? 0,
          });
        }

        const t = Date.now();
        if (thoughtBuf && t - lastThoughtLog > 4_000) {
          const head = thoughtHeadline(thoughtBuf);
          if (head && head !== lastHeadline) {
            lastHeadline = head;
            lastThoughtLog = t;
            void opts.ctx.log({ source: "gemini", kind: "thought", title: head, detail: thoughtBuf.slice(-1200), data: { model, agent: opts.agent } });
            thoughtBuf = "";
          }
        }
        if (t - lastLive > 2_500) {
          lastLive = t;
          opts.ctx.live({ chars: text.length, thought: lastHeadline || undefined, model });
        }
        if (t - lastSave > 10_000 && text.length > prefix.length) {
          lastSave = t;
          void opts.ctx.savePartial({ key: opts.partialKey, text, model });
        }
      }
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        await opts.ctx.savePartial({ key: opts.partialKey, text, model });
        throw new DeadlineError(`خروجی ${opts.agent} تا ${wordCount(text)} کلمه ذخیره شد؛ ادامه در اجرای بعدی`);
      }
      if (text.length > prefix.length) await opts.ctx.savePartial({ key: opts.partialKey, text, model });
      throw err;
    }
    clearTimeout(timer);

    if (finishReason === "MAX_TOKENS") {
      await opts.ctx.savePartial({ key: opts.partialKey, text, model });
      continue;
    }
    break;
  }

  await opts.ctx.savePartial(null);
  if (searchQueries.size) {
    await opts.ctx.log({
      source: "gemini",
      kind: "search",
      title: `جستجوی وب: ${[...searchQueries].slice(0, 3).join("، ")}`,
      data: { queries: [...searchQueries] },
    });
  }
  opts.ctx.live({ chars: text.length, model });
  return { text: text.trim(), model, searchQueries: [...searchQueries], finishReason };
}

/** Structured output with a JSON schema; retries once from scratch if the JSON is broken. */
export async function generateJson<T>(opts: GenOptions): Promise<{ data: T; model: string }> {
  const res = await generate(opts);
  try {
    return { data: extractJson<T>(res.text), model: res.model };
  } catch {
    await opts.ctx.savePartial(null);
    const retry = await generate({ ...opts, thinking: "LOW", partialKey: `${opts.partialKey}:retry` });
    return { data: extractJson<T>(retry.text), model: retry.model };
  }
}
