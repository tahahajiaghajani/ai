// Rate limiting of sign-in-free routes (public pages' APIs, the public status page): a fixed window per client and
// limiter — over the limit a request gets 429 with Retry-After, in Persian. Counters live in the process (the web
// version's instances count apart; the limit is a brake on scraping and floods, not an accounting), bounded in size.
// The client is the socket's peer on a Node server (the server edition, the Windows app; forwarding headers count only
// from the installation's trusted proxies — clientIp of auth/session.ts), else the first X-Forwarded-For hop the
// platform's proxy set (Vercel), else X-Real-IP, else "local".
import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "./errors";
import { clientIp as peerAwareIp, peerAddress } from "../auth/session";

export interface RateLimitOptions {
  /** the limiter's name (its counters are apart from other limiters') */
  name: string;
  /** requests per window and client */
  limit: number;
  windowMs: number;
  /** what counts as one client (default: its address) */
  key?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

const MAX_KEYS = 20_000;
const counters = new Map<string, { start: number; count: number }>();

/**
 * The client's address: on a Node server the socket's peer (a client cannot pick its own address with X-Forwarded-For
 * or X-Real-IP to escape a limit or an IP allowlist); where the platform hides the socket, as its proxy reports it.
 */
export function clientIp(c: Context): string {
  if (peerAddress(c) !== null) return peerAwareIp(c);
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "local";
  return c.req.header("x-real-ip")?.trim() || "local";
}

function prune(now: number): void {
  if (counters.size < MAX_KEYS) return;
  for (const [k, v] of counters) if (now - v.start > 3600_000) counters.delete(k);
  // still full: drop the oldest windows
  if (counters.size >= MAX_KEYS) {
    const old = [...counters.entries()].sort((a, b) => a[1].start - b[1].start).slice(0, Math.ceil(MAX_KEYS / 4));
    for (const [k] of old) counters.delete(k);
  }
}

/** Count one request of `key` against `o`; the seconds to wait when it is over the limit, else 0. */
export function hit(o: Pick<RateLimitOptions, "name" | "limit" | "windowMs">, key: string, now = Date.now()): number {
  const k = `${o.name}\u0000${key}`;
  const cur = counters.get(k);
  if (!cur || now - cur.start >= o.windowMs) {
    prune(now);
    counters.set(k, { start: now, count: 1 });
    return 0;
  }
  cur.count++;
  return cur.count > o.limit ? Math.max(1, Math.ceil((cur.start + o.windowMs - now) / 1000)) : 0;
}

/** Hono middleware: 429 «درخواست‌ها بیش از اندازه است» once a client passes the limit of the window. */
export function rateLimit(o: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const wait = hit(o, (o.key ?? clientIp)(c));
    if (wait) {
      c.header("Retry-After", String(wait));
      throw new AppError(429, "rate_limited", "درخواست‌ها بیش از اندازه است؛ کمی بعد دوباره امتحان کنید");
    }
    await next();
  };
}

/** Forget every counter (tests). */
export function resetRateLimits(): void {
  counters.clear();
}
