import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

const first = (v: string | null) => v?.split(",")[0]?.trim() || "";
const last = (v: string | null) => v?.split(",").map((s) => s.trim()).filter(Boolean).at(-1) || "";

/**
 * The visitor's IP for rate limits, read only from a header a proxy we trust has written (a visitor can put
 * anything into X-Forwarded-For). On Vercel: Vercel's own headers. Self-hosted: the header named by
 * TRUSTED_IP_HEADER (e.g. `ar-real-ip` behind ArvanCloud, `x-real-ip` set by your nginx), otherwise the
 * right-most X-Forwarded-For entry — the one the closest proxy appended (Next sets it to the socket address
 * when no proxy is in front).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const trusted = env.trustedIpHeader;
  if (trusted) return first(h.get(trusted)) || "0.0.0.0";
  if (process.env.VERCEL) return first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")) || first(h.get("x-forwarded-for")) || "0.0.0.0";
  return last(h.get("x-forwarded-for")) || first(h.get("x-real-ip")) || "0.0.0.0";
}
