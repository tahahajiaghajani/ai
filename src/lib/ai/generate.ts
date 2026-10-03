import "server-only";
import { adapterFor, errorInfo, modelChain } from "@/lib/ai/llm";
import { nextPacificMidnight } from "@/lib/ai/quota";
import { providerPreset } from "@/lib/ai/providers";
import { setConnectionStatus, type Connection } from "@/lib/connections";
import { DeadlineError, FatalError, RateLimitError, TransientError } from "@/lib/errors";
import { extractJson, sleep, wordCount } from "@/lib/utils";
import type { Block, Effort, LlmMessage, LlmRequest, LlmResponse } from "@/lib/ai/llm/types";
import type { LogInput } from "@/lib/events";

/** Job-bound hooks: persist partial output, report live status, remember models without quota. */
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
  conn: Connection;
  /** chosen model ("" = the provider's suggestion; Google "auto" = newest free Flash) */
  model: string;
  system: string;
  history?: LlmMessage[];
  user: Block[];
  jsonSchema?: Record<string, unknown>;
  effort?: Effort;
  maxOutputTokens?: number;
  useSearch?: boolean;
  deadline: number;
  partialKey: string;
  ctx: GenContext;
}

export interface GenResult {
  text: string;
  model: string;
  searchQueries: string[];
}

const CONTINUE_TEXT = "پاسخ قبلی‌ات به دلیل محدودیت زمان/طول قطع شد. دقیقاً از همان نقطه‌ای که متوقف شدی ادامه بده؛ هیچ چیزی را تکرار نکن و مقدمه ننویس.";
const CONTINUE_JSON = "خروجی JSON قبلی‌ات قطع شد. فقط ادامه‌ی دقیق همان JSON را از کاراکتر بعدی بنویس، بدون تکرار، بدون ``` و بدون توضیح.";

export const SAFETY_MARGIN_MS = 4_000;
const MIN_CALL_MS = 9_000;

export function thoughtHeadline(t: string): string | null {
  const bold = [...t.matchAll(/\*\*([^*]{3,120})\*\*/g)].map((m) => m[1].trim());
  if (bold.length) return bold[bold.length - 1];
  const line = t.trim().split("\n").reverse().find((l) => l.trim().length > 12);
  return line ? line.trim().slice(0, 120) : null;
}

/** Replace binary files by their text fallback (for models that cannot read images/PDFs). */
export function stripMedia(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.type === "file" ? { type: "text", text: b.fallback ?? `[فایل ${b.name} برای این مدل قابل ارسال نیست]` } : b));
}

/** Live reporting shared by single calls and the tool loop. */
export function streamHooks(ctx: GenContext, agent: string, model: string) {
  let lastLive = 0;
  let lastThoughtLog = 0;
  let headline = "";
  return {
    onText(chars: number) {
      const t = Date.now();
      if (t - lastLive < 2_500) return;
      lastLive = t;
      ctx.live({ chars, thought: headline || undefined, model });
    },
    onThought(text: string) {
      const t = Date.now();
      if (t - lastThoughtLog < 4_000) return;
      const head = thoughtHeadline(text);
      if (!head || head === headline) return;
      headline = head;
      lastThoughtLog = t;
      ctx.live({ thought: head, model });
      void ctx.log({ source: "ai", kind: "thought", title: head, detail: text.slice(-1200), data: { model, agent } });
    },
  };
}

/**
 * Handles a provider error for one model: returns "next" (try the next model), "retry" (same model
 * again, possibly with adjusted options) or throws (pause the connection / give up).
 */
export async function handleModelError(
  opts: { conn: Connection; ctx: GenContext; deadline: number },
  model: string,
  next: string | undefined,
  err: unknown,
  state: { overloadRetried: Set<string>; effortDropped: boolean; mediaDropped: boolean; searchDropped: boolean },
): Promise<"next" | "retry" | "no-effort" | "no-media" | "no-search"> {
  if (err instanceof DeadlineError || err instanceof RateLimitError) throw err;
  const info = errorInfo(opts.conn.provider, err);
  const google = providerPreset(opts.conn.provider).protocol === "google";
  switch (info.kind) {
    case "auth":
      await setConnectionStatus(opts.conn.id, false, info.message);
      throw new FatalError(`کلید اتصال «${opts.conn.label}» نامعتبر است یا دسترسی ندارد؛ در «تنظیمات ← اتصال‌ها» کلید را اصلاح کنید. (${info.message.slice(0, 200)})`);
    case "quota_none":
      if (google) {
        await opts.ctx.blockModel(model, new Date(Date.now() + 24 * 3600_000), "این مدل در پلن رایگان سهمیه ندارد");
        await opts.ctx.log({ source: "ai", kind: "warning", title: `مدل ${model} سهمیه ندارد`, detail: next ? `ادامه با ${next}` : "مدل جایگزینی باقی نمانده" });
        return "next";
      }
      throw new RateLimitError(opts.conn.id, new Date(Date.now() + 6 * 3600_000), "connection", `اعتبار یا سهمیه‌ی حساب «${opts.conn.label}» تمام شده است`, model);
    case "quota_daily": {
      const until = google ? nextPacificMidnight() : new Date(Date.now() + 12 * 3600_000);
      await opts.ctx.blockModel(model, until, "سقف روزانه");
      await opts.ctx.log({ source: "ai", kind: "warning", title: `مدل ${model} به سقف روزانه رسید`, detail: next ? `ادامه با ${next}` : "مدل جایگزینی باقی نمانده" });
      return "next";
    }
    case "rate": {
      if (google && !state.searchDropped && /search|grounding/i.test(info.message)) return "no-search";
      const wait = Math.max(info.retryAfterMs ?? 30_000, 5_000) + 2_000;
      throw new RateLimitError(opts.conn.id, new Date(Date.now() + wait), "connection", `سقف درخواست در دقیقه‌ی «${opts.conn.label}»`, model);
    }
    case "overloaded":
      if (!state.overloadRetried.has(model) && opts.deadline - Date.now() > 25_000) {
        state.overloadRetried.add(model);
        await sleep(3_500);
        return "retry";
      }
      await opts.ctx.log({ source: "ai", kind: "log", title: `مدل ${model} شلوغ است${next ? `؛ ادامه با ${next}` : ""}`, detail: info.message.slice(0, 300) });
      return "next";
    case "media":
      if (!state.mediaDropped) return "no-media";
      break;
    case "invalid":
      if (!state.effortDropped) return "no-effort";
      if (!state.mediaDropped) return "no-media";
      if (/model|not found|does not exist|unknown/i.test(info.message) && next) {
        await opts.ctx.log({ source: "ai", kind: "warning", title: `مدل ${model} در دسترس نیست؛ ادامه با ${next}`, detail: info.message.slice(0, 300) });
        return "next";
      }
      throw new FatalError(`درخواست به «${opts.conn.label}» (${model}) رد شد: ${info.message.slice(0, 400)}`);
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(info.message)) throw new TransientError(`ارتباط با «${opts.conn.label}» برقرار نشد`, 30_000);
  throw err;
}

/** Models of the chain that are not blocked right now (a model being continued goes first). */
export async function usableChain(conn: Connection, model: string, ctx: GenContext, preferred?: string): Promise<string[]> {
  const all = await modelChain(conn, model);
  const blocked = await ctx.blockedModels();
  const now = Date.now();
  let chain = all.filter((m) => {
    const b = blocked[m]?.blocked_until;
    return !b || new Date(b).getTime() <= now;
  });
  if (preferred && chain.includes(preferred)) chain = [preferred, ...chain.filter((m) => m !== preferred)];
  if (!chain.length) {
    const soonest = all.map((m) => (blocked[m]?.blocked_until ? new Date(blocked[m]!.blocked_until!).getTime() : now + 3600_000)).sort((a, b) => a - b)[0];
    throw new RateLimitError(conn.id, new Date(soonest), "connection", `همه‌ی مدل‌های «${conn.label}» به سقف مصرف رسیده‌اند`);
  }
  return chain;
}

/**
 * One text (or JSON) answer with: model fallback chain, automatic pause of the user's connection on
 * per-minute limits, deadline-aware streaming that saves partial output and continues next tick.
 */
export async function generate(opts: GenOptions): Promise<GenResult> {
  const partial = opts.ctx.getPartial();
  const continuing = partial && partial.key === opts.partialKey ? partial : null;
  const chain = await usableChain(opts.conn, opts.model, opts.ctx, continuing?.model);
  const state = { overloadRetried: new Set<string>(), effortDropped: false, mediaDropped: false, searchDropped: !opts.useSearch };
  let effort = opts.effort;
  let user = opts.user;
  let useSearch = !!opts.useSearch;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      return await streamText({ ...opts, effort, user, useSearch }, model, continuing?.model === model ? continuing.text : "");
    } catch (err) {
      const r = await handleModelError(opts, model, chain[i + 1], err, state);
      if (r === "next") continue;
      if (r === "no-effort") {
        state.effortDropped = true;
        effort = undefined;
      } else if (r === "no-media") {
        state.mediaDropped = true;
        user = stripMedia(user);
      } else if (r === "no-search") {
        state.searchDropped = true;
        useSearch = false;
        await opts.ctx.log({ source: "ai", kind: "warning", title: "جستجوی وب برای این کلید در دسترس نیست؛ ادامه بدون آن" });
      }
      i--;
    }
  }
  throw new TransientError(`هیچ‌یک از مدل‌های «${opts.conn.label}» پاسخ نداد`, 60_000);
}

async function streamText(opts: GenOptions, model: string, prefix: string): Promise<GenResult> {
  const adapter = adapterFor(opts.conn);
  let text = prefix;
  const queries = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const budget = opts.deadline - Date.now() - SAFETY_MARGIN_MS;
    if (budget < MIN_CALL_MS) {
      await opts.ctx.savePartial({ key: opts.partialKey, text, model });
      throw new DeadlineError();
    }
    const continuation = text.length > 0;
    const messages: LlmMessage[] = [...(opts.history ?? []), { role: "user", content: opts.user }];
    if (continuation) {
      messages.push({ role: "assistant", content: [{ type: "text", text }] });
      messages.push({ role: "user", content: [{ type: "text", text: opts.jsonSchema ? CONTINUE_JSON : CONTINUE_TEXT }] });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    const req: LlmRequest = {
      model,
      system: opts.system,
      messages,
      json: opts.jsonSchema && !continuation ? opts.jsonSchema : undefined,
      effort: opts.effort,
      maxOutputTokens: opts.maxOutputTokens,
      useSearch: opts.useSearch && !opts.jsonSchema,
      signal: controller.signal,
    };
    const base = text;
    let lastSave = Date.now();
    const hooks = streamHooks(opts.ctx, opts.agent, model);
    let res: LlmResponse;
    try {
      res = await adapter.turn(req, {
        onText: (chars) => {
          hooks.onText(base.length + chars);
          if (Date.now() - lastSave > 10_000) lastSave = Date.now();
        },
        onThought: hooks.onThought,
      });
    } finally {
      clearTimeout(timer);
    }
    opts.ctx.addUsage(res.usage);
    for (const q of res.searchQueries ?? []) queries.add(q);
    text = base + res.text;
    if (res.stop === "aborted") {
      await opts.ctx.savePartial({ key: opts.partialKey, text, model });
      throw new DeadlineError(`خروجی ${opts.agent} تا ${wordCount(text)} کلمه ذخیره شد؛ ادامه در اجرای بعدی`);
    }
    if (res.stop === "refusal") throw new FatalError(`مدل ${model} به این درخواست پاسخ نداد (رد ایمنی)`);
    if (res.stop === "max_tokens") {
      await opts.ctx.savePartial({ key: opts.partialKey, text, model });
      continue;
    }
    break;
  }
  await opts.ctx.savePartial(null);
  if (queries.size) {
    await opts.ctx.log({ source: "ai", kind: "search", title: `جستجوی وب: ${[...queries].slice(0, 3).join("، ")}`, data: { queries: [...queries] } });
  }
  opts.ctx.live({ chars: text.length, model });
  return { text: text.trim(), model, searchQueries: [...queries] };
}

/** Structured output with a JSON schema; retries once from scratch if the JSON is broken. */
export async function generateJson<T>(opts: GenOptions): Promise<{ data: T; model: string }> {
  const schemaNote = `\n\nخروجی فقط یک JSON معتبر مطابق این اسکیما باشد (بدون توضیح و بدون \`\`\`):\n${JSON.stringify(opts.jsonSchema)}`;
  const withNote = { ...opts, system: `${opts.system}${schemaNote}` };
  const res = await generate(withNote);
  try {
    return { data: extractJson<T>(res.text), model: res.model };
  } catch {
    await opts.ctx.savePartial(null);
    const retry = await generate({ ...withNote, effort: "LOW", partialKey: `${opts.partialKey}:retry` });
    return { data: extractJson<T>(retry.text), model: retry.model };
  }
}
