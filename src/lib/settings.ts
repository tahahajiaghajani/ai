import "server-only";
import { db } from "@/lib/supabase/admin";

export const DEFAULT_PREWORK_PROMPT =
  "درخواست و فایل‌های پیوست را دقیق بخوان و بفهم، و یک دستور کار کوتاه، کامل و عملی برای انجام همین درخواست آماده کن.";

export const DEFAULT_MAIN_PROMPT =
  "این تسک را همراه دستور کار پیش‌کار و فایل‌های پیوست در اختیارت می‌گذارم؛ آن را کامل انجام بده و فقط فایل‌های خروجی خواسته‌شده را تحویل بده. در پیام پایانی توضیح بده چه ساختی و چطور از آن استفاده شود.";

/** Defaults of earlier versions: a saved copy of these is upgraded to the new default. */
const LEGACY_DEFAULTS = {
  prework:
    "این تسک را کامل تحقیق کن، بهترین راهکار عملی را پیدا کن، آن را به فعالیت‌های کوچک و دقیق بشکن، روش انجام هر فعالیت را بنویس و هر کاری که ساده است یا آماده‌سازی کارهای پیچیده محسوب می‌شود را همین حالا انجام بده.",
  main: "این تسک با این فایل‌هایی که در قسمت پیش‌کار انجام شده در اختیارت گذاشته می‌شود تا آن را تمام کنی. بعد از اتمام کار فایل‌های نهایی را تحت همان عنوان تسک اما در پوشه‌ی جدا با دیتا مپینگ دقیق و به همراه فایل توضیحات در همان GitHub و همان‌جا ذخیره کن.",
};

export type ClaudeEffort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export type ClaudeThinking = "auto" | "on" | "off";

export interface ClaudeRunOptions {
  /** Claude Code model alias or full id; "" = the account default */
  model: string;
  effort: ClaudeEffort;
  thinking: ClaudeThinking;
}

export interface AppSettings {
  models: {
    /** pre-work agents (analysis, plan, helper files); "auto" = newest Flash models first */
    prework: string[];
    knowledge: string[];
    optimizer: string[];
    embedding: string;
  };
  pipeline: {
    /** at most this many helper files next to the work order */
    maxHelperFiles: number;
    useGoogleSearch: boolean;
    thinkingLevel: "LOW" | "MEDIUM" | "HIGH";
    historyChars: number;
    ragResults: number;
  };
  prework: { defaultPrompt: string };
  claude: ClaudeRunOptions & { maxTurns: number; resumeSessions: boolean; defaultPrompt: string };
  graphify: { mode: "gemini" | "code-only" | "off"; model: string };
  knowledge: { autoExtract: boolean; minScore: number };
  upgrade: { autoMerge: boolean };
}

export const DEFAULT_SETTINGS: AppSettings = {
  models: {
    prework: ["auto"],
    knowledge: ["auto-lite", "auto"],
    optimizer: ["auto"],
    embedding: "gemini-embedding-2",
  },
  pipeline: {
    maxHelperFiles: 3,
    useGoogleSearch: false,
    thinkingLevel: "HIGH",
    historyChars: 60000,
    ragResults: 6,
  },
  prework: { defaultPrompt: DEFAULT_PREWORK_PROMPT },
  claude: { model: "", effort: "", thinking: "auto", maxTurns: 250, resumeSessions: true, defaultPrompt: DEFAULT_MAIN_PROMPT },
  graphify: { mode: "gemini", model: "auto" },
  knowledge: { autoExtract: true, minScore: 3 },
  upgrade: { autoMerge: false },
};

/** What the send dialogs need to pre-fill: default prompts and the default Claude run options. */
export interface DispatchDefaults {
  prework: string;
  main: string;
  claude: ClaudeRunOptions;
  /** workflows that can be chosen when sending (the stage default is preselected) */
  workflows: { id: string; name: string; stage: "prework" | "main"; isDefault: boolean }[];
}

export function dispatchDefaults(s: AppSettings): DispatchDefaults {
  return { prework: s.prework.defaultPrompt, main: s.claude.defaultPrompt, claude: { model: s.claude.model, effort: s.claude.effort, thinking: s.claude.thinking }, workflows: [] };
}

/** Old saved settings: fixed model chains of earlier versions and legacy default prompts. */
function upgradeLegacy(v: AppSettings): AppSettings {
  const fixedChain = (c: unknown) => Array.isArray(c) && c.length > 0 && c.every((m) => typeof m === "string" && /^gemini-(flash|flash-lite)-latest$|^gemini-3\.5-flash$/.test(m));
  const models = { ...v.models };
  for (const k of ["prework", "knowledge", "optimizer"] as const) if (fixedChain(models[k])) models[k] = DEFAULT_SETTINGS.models[k];
  return {
    ...v,
    models,
    graphify: { ...v.graphify, model: v.graphify.model === "gemini-flash-latest" ? "auto" : v.graphify.model },
    prework: { defaultPrompt: v.prework.defaultPrompt.trim() === LEGACY_DEFAULTS.prework ? DEFAULT_PREWORK_PROMPT : v.prework.defaultPrompt },
    claude: { ...v.claude, defaultPrompt: v.claude.defaultPrompt.trim() === LEGACY_DEFAULTS.main ? DEFAULT_MAIN_PROMPT : v.claude.defaultPrompt },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T)) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = isObj(b) && isObj(v) ? deepMerge(b, v) : v === undefined || v === null ? b : v;
  }
  return out as T;
}

let memo: { at: number; value: AppSettings } | null = null;

export async function getSettings(fresh = false): Promise<AppSettings> {
  if (!fresh && memo && Date.now() - memo.at < 15_000) return memo.value;
  const { data } = await db().from("app_settings").select("value").eq("key", "config").maybeSingle();
  const value = upgradeLegacy(deepMerge(DEFAULT_SETTINGS, data?.value ?? {}));
  memo = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings(true);
  const next = deepMerge(current, patch);
  await db().from("app_settings").upsert({ key: "config", value: next, updated_at: new Date().toISOString() });
  memo = { at: Date.now(), value: next };
  return next;
}

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

export async function setKV(key: string, value: unknown) {
  await db().from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}
