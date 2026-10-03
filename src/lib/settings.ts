import "server-only";
import { db } from "@/lib/supabase/admin";

export const DEFAULT_PREWORK_PROMPT =
  "درخواست و فایل‌های پیوست را دقیق بخوان و بفهم، و یک دستور کار کوتاه، کامل و عملی برای انجام همین درخواست آماده کن.";

export const DEFAULT_MAIN_PROMPT =
  "این کار را همراه دستور کار پیش‌کار و فایل‌های پیوست کامل انجام بده و فقط فایل‌های خواسته‌شده را تحویل بده. در پیام پایانی کوتاه بگو چه ساختی یا چه تغییری دادی و چطور استفاده شود.";

export type ClaudeEffort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export type ClaudeThinking = "auto" | "on" | "off";
export type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ClaudeRunOptions {
  /** Claude Code model alias or full id; "" = the account default */
  model: string;
  effort: ClaudeEffort;
  thinking: ClaudeThinking;
}

/** Which of the user's connections (and which model) a stage uses. */
export interface StageModel {
  connectionId: string | null;
  /** "" = the provider's suggested model; Google: "auto" = newest free Flash models */
  model: string;
}

/** How the main work is done: the in-app code agent (any provider) or Claude Code in GitHub Actions. */
export type MainEngine = "agent" | "claude_code";

/** Personal settings of each user (user_settings, key "config"). */
export interface UserConfig {
  /** work context added to every agent's instructions (field, organisation, conventions) */
  about: string;
  stages: {
    prework: StageModel;
    main: StageModel & { engine: MainEngine };
    /** project knowledge file and file summaries; empty connection = same as pre-work */
    knowledge: StageModel;
  };
  pipeline: {
    /** at most this many helper files next to the work order */
    maxHelperFiles: number;
    useSearch: boolean;
    thinking: ThinkingLevel;
    /** earlier prompts/replies of the same task carried into the next run */
    historyChars: number;
    /** tool-calling turns of the code agent per run */
    maxAgentTurns: number;
  };
  prework: { defaultPrompt: string };
  main: { defaultPrompt: string };
  claude: ClaudeRunOptions & { maxTurns: number; resumeSessions: boolean };
  graphify: { mode: "llm" | "code-only" | "off" };
  knowledge: { autoUpdate: boolean };
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  about: "",
  stages: {
    prework: { connectionId: null, model: "" },
    main: { connectionId: null, model: "", engine: "agent" },
    knowledge: { connectionId: null, model: "" },
  },
  pipeline: { maxHelperFiles: 3, useSearch: false, thinking: "HIGH", historyChars: 40000, maxAgentTurns: 60 },
  prework: { defaultPrompt: DEFAULT_PREWORK_PROMPT },
  main: { defaultPrompt: DEFAULT_MAIN_PROMPT },
  claude: { model: "", effort: "", thinking: "auto", maxTurns: 250, resumeSessions: true },
  graphify: { mode: "llm" },
  knowledge: { autoUpdate: true },
};

/** App-wide settings managed by the owner (app_settings, key "system"). */
export interface SystemSettings {
  registration: { autoApprove: boolean };
  upgrade: { autoMerge: boolean };
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  registration: { autoApprove: false },
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
    out[k] = isObj(b) && isObj(v) ? deepMerge(b, v) : v === undefined ? b : v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// per-user key/value (agents, workflows, config)
// ---------------------------------------------------------------------------
export async function getUserKV<T>(userId: string, key: string, fallback: T): Promise<T> {
  const { data } = await db().from("user_settings").select("value").eq("user_id", userId).eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

export async function setUserKV(userId: string, key: string, value: unknown) {
  const { error } = await db().from("user_settings").upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`ذخیره‌ی تنظیمات: ${error.message}`);
}

const memo = new Map<string, { at: number; value: UserConfig }>();

export async function getUserConfig(userId: string, fresh = false): Promise<UserConfig> {
  const hit = memo.get(userId);
  if (!fresh && hit && Date.now() - hit.at < 10_000) return hit.value;
  const saved = await getUserKV<Partial<UserConfig> | null>(userId, "config", null);
  const value = deepMerge(DEFAULT_USER_CONFIG, saved ?? {});
  memo.set(userId, { at: Date.now(), value });
  return value;
}

export async function saveUserConfig(userId: string, patch: unknown): Promise<UserConfig> {
  const next = deepMerge(await getUserConfig(userId, true), patch);
  await setUserKV(userId, "config", next);
  memo.set(userId, { at: Date.now(), value: next });
  return next;
}

/** Stage choice with its fallback (knowledge → pre-work). */
export function stageModel(cfg: UserConfig, stage: "prework" | "main" | "knowledge"): StageModel {
  const s = cfg.stages[stage];
  if (stage === "knowledge" && !s.connectionId) return cfg.stages.prework;
  return s;
}

// ---------------------------------------------------------------------------
// system settings (owner)
// ---------------------------------------------------------------------------
let sysMemo: { at: number; value: SystemSettings } | null = null;

export async function getSystemSettings(fresh = false): Promise<SystemSettings> {
  if (!fresh && sysMemo && Date.now() - sysMemo.at < 15_000) return sysMemo.value;
  const { data } = await db().from("app_settings").select("value").eq("key", "system").maybeSingle();
  const value = deepMerge(DEFAULT_SYSTEM_SETTINGS, data?.value ?? {});
  sysMemo = { at: Date.now(), value };
  return value;
}

export async function saveSystemSettings(patch: unknown): Promise<SystemSettings> {
  const next = deepMerge(await getSystemSettings(true), patch);
  await db().from("app_settings").upsert({ key: "system", value: next, updated_at: new Date().toISOString() });
  sysMemo = { at: Date.now(), value: next };
  return next;
}

/** What the send dialogs need to pre-fill. */
export interface DispatchDefaults {
  /** what the user can use right now (AI connections, GitHub, Claude Code) */
  caps: import("@/lib/types").Capabilities;
  prework: string;
  main: string;
  claude: ClaudeRunOptions;
  engine: MainEngine;
  /** workflows that can be chosen when sending (the stage default is preselected) */
  workflows: { id: string; name: string; stage: "prework" | "main"; isDefault: boolean }[];
  /** the user's projects for the project combobox */
  projects: { id: string; name: string; slug: string; files: number }[];
}
