import "server-only";
import { providerPreset, suggestModel } from "@/lib/ai/providers";
import { anthropicAdapter, anthropicError } from "@/lib/ai/llm/anthropic";
import { expandAuto, googleAdapter, googleError } from "@/lib/ai/llm/google";
import { openaiAdapter, openaiError } from "@/lib/ai/llm/openai";
import type { Connection, AiConfig } from "@/lib/connections";
import type { LlmAdapter, LlmErrorInfo } from "@/lib/ai/llm/types";

export type { LlmAdapter, LlmErrorInfo };

export function adapterFor(conn: Pick<Connection, "provider" | "secret" | "base_url">): LlmAdapter {
  const preset = providerPreset(conn.provider);
  if (preset.protocol === "google") return googleAdapter(conn.secret);
  if (preset.protocol === "anthropic") return anthropicAdapter(conn.secret, conn.base_url);
  return openaiAdapter(preset.id, conn.secret, conn.base_url);
}

export function errorInfo(provider: string, err: unknown): LlmErrorInfo {
  const p = providerPreset(provider).protocol;
  if (p === "google") return googleError(err);
  if (p === "anthropic") return anthropicError(err);
  return openaiError(err);
}

/**
 * Concrete models to try, in order: the chosen model (Google "auto" expands to the newest free
 * Flash generations), then the connection's fallback models.
 */
export async function modelChain(conn: Connection, model: string): Promise<string[]> {
  const preset = providerPreset(conn.provider);
  const cfg = (conn.config ?? {}) as AiConfig;
  let chosen = model.trim();
  if (!chosen) chosen = preset.protocol === "google" ? "auto" : suggestModel(conn.provider, cfg.models ?? []);
  if (!chosen) throw new Error(`برای اتصال «${conn.label}» مدلی انتخاب نشده است (تنظیمات ← مدل‌ها)`);
  let chain = [chosen];
  if (preset.protocol === "google" && /^auto(-lite)?$/.test(chosen)) {
    let names: string[] = [];
    try {
      names = await adapterFor(conn).listModels();
    } catch {
      /* the -latest aliases still work */
    }
    chain = expandAuto([chosen], names);
  }
  return [...new Set([...chain, ...(cfg.fallbacks ?? []).filter(Boolean)])];
}
