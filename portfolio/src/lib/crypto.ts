import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function derive(purpose: string, secret: string): Buffer {
  return createHash("sha256").update(`taha:${purpose}:${secret}`).digest();
}

/** Encryption and signing always use the current secret. */
function key(purpose: string): Buffer {
  const secret = env.appSecret;
  if (!secret) throw new Error("APP_SECRET is not set");
  return derive(purpose, secret);
}

export function hasSecret(): boolean {
  return Boolean(env.appSecret);
}

/** AES-256-GCM → "v1.iv.tag.ciphertext" (base64url parts), for keys saved in the panel. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("enc"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** Tries the current secret, then APP_SECRET_PREVIOUS; GCM authenticates, so a wrong secret gives "" instead of garbage. */
export function decrypt(box: string | null | undefined): string {
  if (!box) return "";
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return "";
  for (const secret of [...new Set([env.appSecret, env.appSecretPrevious].filter(Boolean))]) {
    try {
      const d = createDecipheriv("aes-256-gcm", derive("enc", secret), Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    } catch {
      // next secret
    }
  }
  return "";
}

/** The last four characters, for showing which key is saved without showing the key. */
export function hint(secret: string): string {
  return secret.length > 8 ? `…${secret.slice(-4)}` : "…";
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

/** Anonymous, stable visitor fingerprint for rate limits (no raw IPs are stored). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`ip:${env.appSecret}:${ip}`).digest("hex").slice(0, 24);
}

export function clientIp(req: Request | Headers): string {
  const h = req instanceof Headers ? req : req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "0.0.0.0").trim();
}
