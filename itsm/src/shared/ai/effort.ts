// Reasoning effort: one setting per job in the AI settings, mapped to what each provider accepts.
// Effort is the main control for how much a model thinks — and therefore for latency and cost.
import type { AiEffort, AiJob } from "./types";

export const AI_EFFORTS: { key: AiEffort; label: string }[] = [
  { key: "low", label: "کم" },
  { key: "medium", label: "متوسط" },
  { key: "high", label: "زیاد" },
  { key: "max", label: "بیشینه" },
];

export const AI_JOBS: { key: AiJob; label: string; tier: "smart" | "fast" | "vision" }[] = [
  { key: "assistant", label: "دستیار", tier: "smart" },
  { key: "analysis", label: "تحلیل، پیش‌بینی و برنامه", tier: "smart" },
  { key: "fast", label: "کارهای سریع و خلاصه‌ها", tier: "fast" },
  { key: "vision", label: "خواندن تصویر و سند", tier: "vision" },
];

/** Chat answers at medium, long analyses higher, short summaries and document reading low. */
export const DEFAULT_EFFORT: Record<AiJob, AiEffort> = { assistant: "medium", analysis: "high", fast: "low", vision: "low" };

export function jobTier(job: AiJob): "smart" | "fast" | "vision" {
  return AI_JOBS.find((j) => j.key === job)?.tier ?? "smart";
}

/** Claude models with adaptive thinking (Opus/Sonnet 4.6+, Haiku 5.5, every 5.x, Fable, Mythos). */
export function anthropicAdaptive(model: string): boolean {
  return /claude-(opus|sonnet)-4-[6-9]|claude-(opus|sonnet|haiku)-[5-9]|claude-(fable|mythos)-/.test(model);
}

/** Claude models that accept `output_config.effort`. */
export function anthropicEffortSupported(model: string): boolean {
  return /claude-opus-4-[5-9]|claude-sonnet-4-[6-9]|claude-(opus|sonnet|haiku)-[5-9]|claude-(fable|mythos)-/.test(model);
}

export function anthropicEffort(e: AiEffort): "low" | "medium" | "high" | "max" {
  return e;
}

/** OpenAI reasoning models (GPT-5.x, GPT-6.x, o-series) take `reasoning.effort`. */
export function openaiReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5|gpt-6)/.test(model.replace(/^[\w-]+\//, ""));
}

export function openaiEffort(e: AiEffort): "low" | "medium" | "high" | "max" {
  return e;
}

/** Gemini 3.x / 4 take a thinking level (low, medium, high); older models use their default. */
export function geminiThinkingLevel(e: AiEffort, model: string): "low" | "medium" | "high" | null {
  if (!/gemini-(3|4)/.test(model)) return null;
  return e === "max" ? "high" : e;
}

/** `reasoning_effort` of OpenAI-compatible chat services that accept it. */
export function chatReasoningEffort(e: AiEffort): "low" | "medium" | "high" {
  return e === "max" ? "high" : e;
}
