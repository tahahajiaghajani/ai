import "server-only";
import { db } from "@/lib/supabase/admin";

export const DEFAULT_PREWORK_PROMPT =
  "این تسک را کامل تحقیق کن، بهترین راهکار عملی را پیدا کن، آن را به فعالیت‌های کوچک و دقیق بشکن، روش انجام هر فعالیت را بنویس و هر کاری که ساده است یا آماده‌سازی کارهای پیچیده محسوب می‌شود را همین حالا انجام بده.";

export const DEFAULT_MAIN_PROMPT =
  "این تسک با این فایل‌هایی که در قسمت پیش‌کار انجام شده در اختیارت گذاشته می‌شود تا آن را تمام کنی. بعد از اتمام کار فایل‌های نهایی را تحت همان عنوان تسک اما در پوشه‌ی جدا با دیتا مپینگ دقیق و به همراه فایل توضیحات در همان GitHub و همان‌جا ذخیره کن.";

export interface AppSettings {
  models: {
    research: string[];
    structure: string[];
    methods: string[];
    execute: string[];
    report: string[];
    knowledge: string[];
    optimizer: string[];
    embedding: string;
  };
  pipeline: {
    methodsBatch: number;
    executeBatch: number;
    maxExecuteItems: number;
    useGoogleSearch: boolean;
    thinkingLevel: "LOW" | "MEDIUM" | "HIGH";
    historyChars: number;
    ragResults: number;
  };
  prework: { defaultPrompt: string };
  claude: { model: string; maxTurns: number; resumeSessions: boolean; defaultPrompt: string };
  graphify: { mode: "gemini" | "code-only" | "off"; model: string };
  knowledge: { autoExtract: boolean; minScore: number };
  upgrade: { autoMerge: boolean };
}

const FLASH_CHAIN = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest"];

export const DEFAULT_SETTINGS: AppSettings = {
  models: {
    research: FLASH_CHAIN,
    structure: FLASH_CHAIN,
    methods: FLASH_CHAIN,
    execute: FLASH_CHAIN,
    report: FLASH_CHAIN,
    knowledge: ["gemini-flash-lite-latest", "gemini-flash-latest"],
    optimizer: FLASH_CHAIN,
    embedding: "gemini-embedding-2",
  },
  pipeline: {
    methodsBatch: 6,
    executeBatch: 3,
    maxExecuteItems: 24,
    useGoogleSearch: false,
    thinkingLevel: "MEDIUM",
    historyChars: 60000,
    ragResults: 8,
  },
  prework: { defaultPrompt: DEFAULT_PREWORK_PROMPT },
  claude: { model: "", maxTurns: 250, resumeSessions: true, defaultPrompt: DEFAULT_MAIN_PROMPT },
  graphify: { mode: "gemini", model: "gemini-flash-latest" },
  knowledge: { autoExtract: true, minScore: 3 },
  upgrade: { autoMerge: false },
};

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
  const value = deepMerge(DEFAULT_SETTINGS, data?.value ?? {});
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
