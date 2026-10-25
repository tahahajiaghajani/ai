import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function key(purpose: string): Buffer {
  const secret = env.appSecret;
  if (!secret) throw new Error("APP_SECRET is not set");
  return createHash("sha256").update(`taha:${purpose}:${secret}`).digest();
}

export function hasSecret(): boolean {
  return Boolean(env.appSecret);
}

export function sign(payload: string): string {
  return createHmac("sha256", key("sig")).update(payload).digest("base64url");
}

/** Constant-time comparison of any two strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

/** Anonymous, stable visitor fingerprint for rate limits and logs (no raw IPs are stored). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`ip:${env.appSecret}:${ip}`).digest("hex").slice(0, 24);
}

export function clientIp(req: Request | Headers): string {
  const h = req instanceof Headers ? req : req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "0.0.0.0").trim();
}
