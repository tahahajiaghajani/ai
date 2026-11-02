// Provider keys at rest: AES-256-GCM "v2" envelopes. The data key is derived from this runtime's
// secret with HKDF (purpose "siraf/ai-keys"); the key id names the secret that sealed it (a
// changed secret is detected without trying); the additional data binds a ciphertext to its
// business and connection, so a value copied to another row never opens. Strict: anything that is
// not a v2 envelope is unreadable — there is no plaintext pass-through.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v2";
const PURPOSE = "siraf/ai-keys";
const FINGERPRINT_PURPOSE = "siraf/ai-key-fingerprint";

export class KeyUnreadableError extends Error {
  constructor() {
    super("کلید ذخیره‌شده باز نمی‌شود؛ کلید را دوباره وارد کنید");
    this.name = "KeyUnreadableError";
  }
}

export interface KeyBinding {
  orgId: string;
  connectionId: string;
}

function derive(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("siraf", "utf8"), Buffer.from(info, "utf8"), 32));
}

/** Short id of the runtime secret: tells a changed secret apart from a damaged value. */
export function secretKeyId(secret: string): string {
  return createHash("sha256").update(`siraf/kid:${secret}`).digest("hex").slice(0, 8);
}

function aad(b: KeyBinding): Buffer {
  return Buffer.from(`${b.orgId}:${b.connectionId}`, "utf8");
}

export function encryptKey(secret: string, binding: KeyBinding, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(secret, PURPOSE), iv);
  c.setAAD(aad(binding));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, secretKeyId(secret), iv.toString("base64url"), enc.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function decryptKey(secret: string, binding: KeyBinding, stored: string | null | undefined): string {
  const parts = String(stored ?? "").split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new KeyUnreadableError();
  const [, kid, iv, enc, tag] = parts;
  if (kid !== secretKeyId(secret)) throw new KeyUnreadableError();
  try {
    const d = createDecipheriv("aes-256-gcm", derive(secret, PURPOSE), Buffer.from(iv, "base64url"));
    d.setAAD(aad(binding));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new KeyUnreadableError();
  }
}

/** Can this stored value be opened with the current secret? (never throws) */
export function keyReadable(secret: string, binding: KeyBinding, stored: string | null | undefined): boolean {
  try {
    decryptKey(secret, binding, stored);
    return true;
  } catch {
    return false;
  }
}

/** Masked hint shown instead of the key: «…a1B2». */
export function keyHint(plain: string): string {
  const s = plain.trim();
  return s.length <= 8 ? "…" : `…${s.slice(-4)}`;
}

/** HMAC fingerprint (duplicate detection) — never the key itself. */
export function keyFingerprint(secret: string, plain: string): string {
  return createHmac("sha256", derive(secret, FINGERPRINT_PURPOSE)).update(plain, "utf8").digest("hex").slice(0, 32);
}

/** A pasted key without spaces, line breaks and invisible direction/format marks. */
export function cleanKey(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\s\p{Cf}]/gu, "");
}

const KEY_PATTERNS: RegExp[] = [
  /\bsk-ant-[\w-]{6,}/g,
  /\bsk-[\w-]{10,}/g,
  /\bAIza[\w-]{16,}/g,
  /\bAQ\.[\w.-]{12,}/g,
  /\bxai-[\w-]{10,}/g,
  /\bnvapi-[\w-]{10,}/g,
  /\btpsg-[\w-]{6,}/g,
  /\bgsk_[\w]{10,}/g,
  /\baa-[\w-]{16,}/g,
];

/** Remove anything that looks like a key (and the known keys themselves) from a text we store or show. */
export function scrubSecrets(text: string, known: (string | null | undefined)[] = []): string {
  let out = String(text ?? "");
  for (const k of known) if (k && k.length >= 6) out = out.split(k).join("***");
  for (const re of KEY_PATTERNS) out = out.replace(re, "***");
  return out
    .replace(/(Bearer\s+)[\w.~+/=-]{8,}/gi, "$1***")
    .replace(/(x-api-key["':\s=]+)[\w.~+/=-]{8,}/gi, "$1***")
    .replace(/([?&](?:key|api_key|apikey)=)[^&\s"']+/gi, "$1***");
}
