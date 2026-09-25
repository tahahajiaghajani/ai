import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { jsonrepair } from "jsonrepair";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Convert latin digits in a string/number to Persian digits. */
export function faNum(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** Convert Persian/Arabic digits to latin digits (for parsing user input). */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Slug for GitHub folder names. Keeps Persian letters so the folder carries the task title,
 * but removes characters that are awkward in shells or URLs.
 */
export function slugify(text: string, max = 48): string {
  const s = text
    .normalize("NFC")
    .replace(/[‌‏‎]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return (s.slice(0, max).replace(/-$/, "") || "task");
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return faNum(0) + " بایت";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${faNum(v.toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Extract JSON from a model response: handles ```json fences, leading/trailing prose,
 * and repairs truncated or slightly malformed JSON (unclosed strings/arrays, stray commas).
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }
  // Only strip a fence that wraps the WHOLE answer — JSON strings may contain ``` code blocks.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)(?:```\s*)?$/i);
  const body = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(body) as T;
  } catch {
    const startObj = body.indexOf("{");
    const startArr = body.indexOf("[");
    const start = startArr >= 0 && (startArr < startObj || startObj < 0) ? startArr : startObj;
    const candidate = start >= 0 ? body.slice(start) : body;
    try {
      return JSON.parse(jsonrepair(candidate)) as T;
    } catch {
      throw new Error(`پاسخ مدل JSON معتبر نبود (${text.length} کاراکتر؛ انتها: «${text.slice(-120)}»)`);
    }
  }
}

export function randomId(len = 8): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export const PRIORITY_WEIGHT: Record<string, number> = { low: 30, medium: 50, high: 70, critical: 90 };
