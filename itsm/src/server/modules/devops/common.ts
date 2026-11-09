// Helpers of DevOps: verification of signed deliveries (HMAC-SHA256 over the raw body, a shared token, or basic
// authentication — each compared in constant time), random keys, the record numbers of the organisation's numbered
// tables, and the reads shared with release management (every read starts from `readable`).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { physicalTables } from "@shared/tables";
import type { HeaderFn } from "@shared/devops/logic";

export { eqAll, isUuid, liveRow, liveRows, msOf, sysOf, releaseConfig, managesReleases, environmentOf, isProductionEnv, type Row } from "../release/common";

/** The largest delivery accepted (bytes of the raw body). */
export const MAX_DELIVERY_BYTES = 1_000_000;
/** Bodies stored with the event up to this size (larger ones keep only their hash and the result). */
export const STORED_PAYLOAD_BYTES = 200_000;

/** A random URL-safe key (the webhook URL's key, a new secret). */
export const randomKey = (bytes = 18): string => randomBytes(bytes).toString("base64url");
/** A new signing secret (shown once). */
export const newSecret = (): string => `whsec_${randomBytes(24).toString("hex")}`;

export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const hmacHex = (secret: string, raw: string): string => createHmac("sha256", secret).update(raw, "utf8").digest("hex");

/** Constant-time comparison of two strings (their digests, so a length difference leaks nothing). */
export function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

export type VerifiedBy = "hmac" | "token" | "basic";

/**
 * How a delivery proves it knows the connection's secret, or null:
 *   · HMAC-SHA256 of the raw body, hex, in `X-Hub-Signature-256` (GitHub, Gitea), `X-Signature-256` or
 *     `X-ITSM-Signature` (Jenkins, the generic format), with or without the `sha256=` prefix
 *   · the secret itself in `X-Gitlab-Token` (GitLab's webhook token)
 *   · basic authentication whose password is the secret (Azure DevOps service hooks)
 */
export function verifyDelivery(secret: string, raw: string, h: HeaderFn): VerifiedBy | null {
  if (!secret) return null;
  const expected = hmacHex(secret, raw);
  for (const name of ["x-hub-signature-256", "x-signature-256", "x-itsm-signature"]) {
    const v = h(name)?.trim();
    if (!v) continue;
    const sig = v.toLowerCase().startsWith("sha256=") ? v.slice(7) : v;
    if (/^[0-9a-f]{64}$/i.test(sig) && sameSecret(sig.toLowerCase(), expected)) return "hmac";
    return null;
  }
  const token = h("x-gitlab-token")?.trim();
  if (token) return sameSecret(token, secret) ? "token" : null;
  const auth = h("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const password = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
    return sameSecret(password, secret) ? "basic" : null;
  }
  return null;
}

/** Prefix → pad of every numbered table (record numbers mentioned in commits, branches and titles). */
export function numberPrefixes(): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of physicalTables()) if (t.numbered?.prefix) out.set(t.numbered.prefix.toUpperCase(), t.numbered.pad ?? 7);
  return out;
}

/** Which table a record number belongs to (by its prefix). */
export function tableOfNumber(no: string): string | null {
  const m = /^([A-Z][A-Z_]*?)(\d+)$/.exec(no.toUpperCase());
  if (!m) return null;
  for (const t of physicalTables()) if (t.numbered?.prefix?.toUpperCase() === m[1]) return t.key;
  return null;
}
