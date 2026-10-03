import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Users' API keys and GitHub tokens are stored encrypted (AES-256-GCM). The key comes from
 * APP_SECRET_KEY, or is derived from the Supabase service key when that is not set (changing the
 * service key then makes the stored secrets unreadable and users connect again).
 */
function key(): Buffer {
  const base = env.appSecretKey || (env.supabaseServiceKey ? `derived:${env.supabaseServiceKey}` : "");
  if (!base) throw new Error("کلید رمزنگاری تنظیم نشده است (APP_SECRET_KEY)");
  return createHash("sha256").update(`taskflow-secrets:${base}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("قالب کلید ذخیره‌شده نامعتبر است");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("کلید ذخیره‌شده قابل بازگشایی نیست (کلید رمزنگاری اپ تغییر کرده)؛ اتصال را دوباره ثبت کنید");
  }
}

/** Last characters of a secret, shown in the UI so users recognise which key is stored. */
export function secretHint(secret: string): string {
  const s = secret.trim();
  return s.length <= 8 ? "••••" : `••••${s.slice(-4)}`;
}

/**
 * Each user's GitHub Actions runners authenticate with their own token, bound to the user id:
 * `u.<user id>.<signature>`. The app checks the signature and that the job belongs to that user.
 */
export function runnerTokenFor(userId: string): string {
  const base = env.runnerSecret;
  if (!base) throw new Error("CRON_SECRET تنظیم نشده است");
  const sig = createHmac("sha256", base).update(`runner:${userId}`).digest("hex").slice(0, 40);
  return `u.${userId}.${sig}`;
}

/** The user id of a valid runner token (null when it is not one of ours). */
export function verifyRunnerToken(token: string): string | null {
  const m = token.match(/^u\.([0-9a-f-]{36})\.([0-9a-f]{40})$/);
  if (!m) return null;
  const expected = Buffer.from(runnerTokenFor(m[1]).split(".")[2]);
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}
