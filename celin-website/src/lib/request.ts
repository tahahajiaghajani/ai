import "server-only";
import { headers } from "next/headers";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

const first = (v: string | null) => v?.split(",")[0]?.trim() || "";
const last = (v: string | null) => v?.split(",").map((s) => s.trim()).filter(Boolean).at(-1) || "";

/** The header a proxy / CDN adds to prove a request came through it (value: TRUSTED_PROXY_SECRET). */
export const PROXY_SECRET_HEADER = "x-celin-proxy";

/** Every visitor of a self-hosted site without a trusted proxy header shares this one rate-limit bucket. */
export const SHARED_IP = "0.0.0.0";

/** How the visitor's IP is found on this deployment (for the code below and Admin → Connections). */
export interface IpSetup {
  /** "vercel": Vercel's own header; "header": TRUSTED_IP_HEADER; "shared": no trustworthy source (self-hosted) */
  mode: "vercel" | "header" | "shared";
  header: string;
  /** TRUSTED_PROXY_SECRET is set: the header counts only on requests carrying it */
  secret: boolean;
  /** TRUSTED_IP_HEADER is set but cannot be trusted here (on Vercel without TRUSTED_PROXY_SECRET), so it is ignored */
  ignored: boolean;
}

export function ipSetup(): IpSetup {
  const header = env.trustedIpHeader;
  const secret = Boolean(env.trustedProxySecret);
  const vercel = Boolean(process.env.VERCEL);
  // on Vercel anyone can call <project>.vercel.app directly with any header: a CDN header counts only with the secret
  if (header && (!vercel || secret)) return { mode: "header", header, secret, ignored: false };
  return { mode: vercel ? "vercel" : "shared", header, secret, ignored: Boolean(header) };
}

let warned = false;
function warnOnce(msg: string) {
  if (warned) return;
  warned = true;
  console.error(`[request] ${msg}`);
}

/**
 * The visitor's IP for rate limits, read only from a header a proxy we trust has written: a visitor can put
 * anything into X-Forwarded-For, and Next.js keeps such a header as it came (it only fills it in when it is
 * missing), so without a proxy that overwrites it the value is the visitor's own choice.
 *
 * - Vercel: Vercel's own `x-vercel-forwarded-for` (Vercel overwrites it).
 * - TRUSTED_IP_HEADER (self-hosted behind nginx / Caddy / ArvanCloud, or a CDN in front of Vercel): that header —
 *   and with TRUSTED_PROXY_SECRET only on requests whose `x-celin-proxy` header carries the secret (required on
 *   Vercel, where the deployment is also reachable directly). `x-forwarded-for` is read from the right: the
 *   entry the closest proxy added.
 * - Self-hosted without TRUSTED_IP_HEADER: nothing can be trusted, so every visitor shares one bucket (safe, but
 *   strict; Admin → Connections and the server log say so).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const s = ipSetup();
  if (s.mode === "header") {
    const proven = !s.secret || safeEqual(h.get(PROXY_SECRET_HEADER) ?? "", env.trustedProxySecret);
    if (proven) {
      const ip = s.header === "x-forwarded-for" ? last(h.get(s.header)) : first(h.get(s.header));
      if (ip) return ip;
    }
    // a request that did not come through the proxy (or lacks the header): never trust what it says
    if (process.env.VERCEL) return first(h.get("x-vercel-forwarded-for")) || SHARED_IP;
    return SHARED_IP;
  }
  if (s.mode === "vercel") {
    if (s.ignored) warnOnce("TRUSTED_IP_HEADER is ignored on Vercel without TRUSTED_PROXY_SECRET (anyone could send it straight to the deployment); see docs/SETUP_FA.md §7.");
    return first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")) || SHARED_IP;
  }
  warnOnce("TRUSTED_IP_HEADER is not set on this self-hosted server: rate limits cannot tell visitors apart and are shared by everyone. Set it to the header your proxy writes the visitor's IP into (docs/SETUP_FA.md §7).");
  return SHARED_IP;
}
