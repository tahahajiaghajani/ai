// AES-256-GCM for secrets stored in the database (webhook secrets of online shops).
// The key is derived from APP_SECRET (cloud) or the installation secret (desktop).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(appSecret: string) {
  return createHash("sha256").update(`taraz-secrets:${appSecret}`).digest();
}

export function encryptSecret(appSecret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(appSecret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function decryptSecret(appSecret: string, stored: string): string {
  const [v, iv, enc, tag] = stored.split(".");
  if (v !== "v1" || !iv || !enc || !tag) return stored; // plain (older) value
  const d = createDecipheriv("aes-256-gcm", key(appSecret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
