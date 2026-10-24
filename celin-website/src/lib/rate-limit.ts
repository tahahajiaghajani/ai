import "server-only";
import { db } from "@/lib/db";

const memory = new Map<string, { start: number; count: number }>();

/** Fixed-window limiter. Returns true when the call is allowed. Uses the database when available. */
export async function allow(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const c = db();
  if (c) {
    const { data, error } = await c.rpc("celin_hit_rate_limit", { p_key: key, p_window: windowSeconds, p_max: max });
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

/** Whether `key` has already reached `max` hits in its current window — without counting this call. */
export async function limited(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const c = db();
  if (c) {
    const { data, error } = await c.from("celin_rate_limits").select("window_start, count").eq("key", key).maybeSingle();
    if (!error) {
      const r = data as { window_start: string; count: number } | null;
      return Boolean(r && Date.parse(r.window_start) > Date.now() - windowSeconds * 1000 && r.count >= max);
    }
  }
  const cur = memory.get(key);
  return Boolean(cur && Date.now() - cur.start <= windowSeconds * 1000 && cur.count >= max);
}
