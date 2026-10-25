import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const memory = new Map<string, { start: number; count: number }>();

/** Fixed-window limiter. Returns true when the call is allowed. Uses the database when available. */
export async function allow(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const c = db();
  if (c) {
    const { data, error } = await c.rpc("portfolio_hit_rate_limit", { p_key: key, p_window: windowSeconds, p_max: max });
    if (!error) return data !== false;
  }
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || now - cur.start > windowSeconds * 1000) {
    memory.set(key, { start: now, count: 1 });
    if (memory.size > 5000) memory.clear();
    return true;
  }
  cur.count++;
  return cur.count <= max;
}

/** One daily budget shared by all visitors for every call that spends the site's AI key (AI_DAILY_LIMIT). */
export function allowAi(): Promise<boolean> {
  return allow("ai:global:day", 86400, env.aiDailyLimit);
}
