import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Shorter secrets are refused: tracking links are signed with APP_SECRET, so every visitor holds a sample of it. */
export const MIN_SECRET = 32;

const derived = new Map<string, Buffer>();

/** A slow key derivation (scrypt), memoised per secret and purpose, so guessing the secret offline costs real work. */
function derive(purpose: string, secret: string): Buffer {
  const id = `${purpose}\0${secret}`;
  let k = derived.get(id);
  if (!k) {
    k = scryptSync(secret, `taha-portfolio:${purpose}`, 32, { N: 1 << 14, r: 8, p: 1 });
    if (derived.size > 8) derived.clear();
    derived.set(id, k);
  }
  return k;
}

/** Encryption and signing always use the current secret. */
function key(purpose: string): Buffer {
  if (!hasSecret()) throw new Error(`APP_SECRET is not set or shorter than ${MIN_SECRET} characters`);
  return derive(purpose, env.appSecret);
}

export function hasSecret(): boolean {
  return env.appSecret.length >= MIN_SECRET;
}

/** For messages to the owner: a secret that is set but too short is refused like a missing one. */
export function secretState(): "ok" | "missing" | "short" {
  return hasSecret() ? "ok" : env.appSecret ? "short" : "missing";
}

/** The current secret, then APP_SECRET_PREVIOUS, for reading what was made before a rotation. */
const secrets = () => [...new Set([env.appSecret, env.appSecretPrevious].filter((s) => s.length >= MIN_SECRET))];

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
  for (const secret of secrets()) {
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

/** Re-encrypts a saved value with the current secret (after a rotation); "" when it cannot be read at all. */
export function reencrypt(box: string): string {
  const plain = decrypt(box);
  return plain ? encrypt(plain) : "";
}

/** A saved value that only APP_SECRET_PREVIOUS can still open (it is re-encrypted by the next save in the panel). */
export function needsReencrypt(box: string | null | undefined): boolean {
  if (!box || !hasSecret()) return false;
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return false;
  try {
    const d = createDecipheriv("aes-256-gcm", derive("enc", env.appSecret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]);
    return false;
  } catch {
    return Boolean(decrypt(box));
  }
}

/** The last four characters, for showing which key is saved without showing the key. */
export function hint(secret: string): string {
  return secret.length > 8 ? `…${secret.slice(-4)}` : "…";
}

export function sign(payload: string): string {
  return createHmac("sha256", key("sig")).update(payload).digest("base64url");
}

/** Signers for checking a signature: the current secret, then APP_SECRET_PREVIOUS (links made before a rotation). */
export function verifiers(): ((payload: string) => string)[] {
  if (!hasSecret()) return [];
  return secrets().map((secret) => (payload: string) => createHmac("sha256", derive("sig", secret)).update(payload).digest("base64url"));
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
