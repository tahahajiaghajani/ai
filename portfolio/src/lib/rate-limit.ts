import "server-only";
import { env } from "@/lib/env";

const memory = new Map<string, { start: number; count: number }>();

/**
 * Fixed-window limiter kept in the server instance's memory (there is no database). Vercel keeps an instance warm
 * across many requests, so this stops floods and runaway loops; the hard ceiling is the AI key's own free quota.
 * Returns true when the call is allowed.
 */
export async function allow(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || now - cur.start > windowSeconds * 1000) {
    if (memory.size > 5000) memory.clear();
    memory.set(key, { start: now, count: 1 });
    return true;
  }
  cur.count++;
  return cur.count <= max;
}

/** One daily budget per instance for every call that spends the site's AI key (AI_DAILY_LIMIT). */
export function allowAi(): Promise<boolean> {
  return allow("ai:global:day", 86400, env.aiDailyLimit);
}
