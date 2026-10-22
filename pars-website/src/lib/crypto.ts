import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function key(purpose: string): Buffer {
  const secret = env.appSecret;
  if (!secret) throw new Error("APP_SECRET is not set");
  return createHash("sha256").update(`pars:${purpose}:${secret}`).digest();
}

export function hasSecret(): boolean {
  return Boolean(env.appSecret);
}

/** AES-256-GCM → "v1.iv.tag.ciphertext" (base64url parts). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("enc"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(box: string | null | undefined): string {
  if (!box) return "";
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return "";
  try {
    const d = createDecipheriv("aes-256-gcm", key("enc"), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function sign(payload: string): string {
  return createHmac("sha256", key("sig")).update(payload).digest("base64url");
}

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
