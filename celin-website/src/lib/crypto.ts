import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function derive(purpose: string, secret: string): Buffer {
  return createHash("sha256").update(`celin:${purpose}:${secret}`).digest();
}

/** Encryption and signing always use the current secret. */
function key(purpose: string): Buffer {
  const secret = env.appSecret;
  if (!secret) throw new Error("APP_SECRET is not set");
  return derive(purpose, secret);
}

/**
 * Every secret a stored value may have been encrypted with: the current one, APP_SECRET_PREVIOUS
 * (after a rotation) and the service-role key (the fallback before APP_SECRET was set).
 */
function decryptionKeys(): Buffer[] {
  return [...new Set([env.appSecret, env.appSecretPrevious, env.supabaseKey].filter(Boolean))].map((s) => derive("enc", s));
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

/** Tries each known secret; GCM authenticates, so a wrong key fails instead of returning garbage. */
export function decrypt(box: string | null | undefined): string {
  if (!box) return "";
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return "";
  for (const k of decryptionKeys()) {
    try {
      const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    } catch {
      // next secret
    }
  }
  return "";
}

export function sign(payload: string): string {
  return createHmac("sha256", key("sig")).update(payload).digest("base64url");
}

/**
 * HMACs of a payload under every known secret (current first). Used for values that are looked up by their
 * hash, such as Pro codes, so they keep working after APP_SECRET is rotated (APP_SECRET_PREVIOUS).
 */
export function signAll(payload: string): string[] {
  const secrets = [...new Set([env.appSecret, env.appSecretPrevious, env.supabaseKey].filter(Boolean))];
  return secrets.map((s) => createHmac("sha256", derive("sig", s)).update(payload).digest("base64url"));
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
