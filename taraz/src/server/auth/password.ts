// Password hashing with scrypt (Node built-in): `scrypt$N$r$p$salt$hash`.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, createHmac } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const key = await scrypt(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
    const expected = Buffer.from(hashB64, "base64");
    return expected.length === key.length && timingSafeEqual(expected, key);
  } catch {
    return false;
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function hmac(secret: string, s: string): string {
  return createHmac("sha256", secret).update(s).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Human-friendly one-time code like `K7QX-2M9P-...` (no ambiguous letters). */
export function readableCode(groups = 4, size = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(groups * size);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  const out: string[] = [];
  for (let i = 0; i < groups; i++) out.push(chars.slice(i * size, (i + 1) * size).join(""));
  return out.join("-");
}

export function passwordProblem(pw: string): string | null {
  if (!pw || pw.length < 8) return "رمز عبور باید دست‌کم ۸ نویسه باشد";
  if (pw.length > 200) return "رمز عبور خیلی طولانی است";
  if (/^\d+$/.test(pw)) return "رمز عبور نباید فقط عدد باشد";
  return null;
}
