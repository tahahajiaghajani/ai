import "server-only";
import { randomInt } from "node:crypto";
import { decrypt, encrypt, signAll } from "@/lib/crypto";
import { db, isMissingTable } from "@/lib/db";
import { latinDigits } from "@/lib/format";

/**
 * Pro membership: an approved account gets a code of 12 digits (shown as 4827 1930 5561, ≈ 40 bits). Digits
 * only, because members type it on a Persian phone keyboard (its digit row gives ۰–۹, normalised here);
 * attempts are rate-limited per IP and globally. Entering the code — signed in, or on its own as a sign-in —
 * unlocks prices, stock and ordering for that account while the code is active (not revoked, not expired).
 * Only an HMAC of the code is stored for the lookup, plus an encrypted copy so the admin can show or resend it.
 */

export const CODES = "celin_pro_codes";
export const REQUESTS = "celin_pro_requests";

export const CODE_LENGTH = 12;

export function generateCode(): string {
  let s = String(1 + randomInt(9)); // no leading zero, so the code never looks shorter than it is
  for (let i = 1; i < CODE_LENGTH; i++) s += String(randomInt(10));
  return formatCode(s);
}

/** Latin digits with everything else (spaces, dashes, a pasted SMS text) removed; "" unless 12 digits remain. */
export function normalizeCode(input: string): string {
  const s = latinDigits(String(input ?? "")).replace(/\D/g, "");
  return s.length === CODE_LENGTH ? s : "";
}

/** 482719305561 → "4827 1930 5561". */
export function formatCode(norm: string): string {
  return norm.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Lookup hashes under every known secret (the first is the one new codes are stored with). */
export function codeHashes(norm: string): string[] {
  return signAll(`pro-code:${norm}`);
}

export interface CodeRow {
  id: string;
  user_id: string;
  hint: string;
  code_enc: string;
  request_id: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export const CODE_COLUMNS = "id, user_id, hint, code_enc, request_id, expires_at, redeemed_at, last_used_at, revoked_at, created_at";

export type CodeState = "active" | "issued" | "expired" | "revoked";

/** issued = not entered yet; active = entered and still valid. */
export function codeState(c: Pick<CodeRow, "expires_at" | "redeemed_at" | "revoked_at">, now = Date.now()): CodeState {
  if (c.revoked_at) return "revoked";
  if (c.expires_at && Date.parse(c.expires_at) <= now) return "expired";
  return c.redeemed_at ? "active" : "issued";
}

export interface ProStatus {
  active: boolean;
  /** a code was issued and waits to be entered */
  issued: boolean;
  expiresAt: string | null;
  since: string | null;
}

export const NO_PRO: ProStatus = { active: false, issued: false, expiresAt: null, since: null };

/** Pro state of an account; a database problem reads as "not Pro" (logged). */
export async function proStatus(userId: string): Promise<ProStatus> {
  const c = db();
  if (!c) return NO_PRO;
  const { data, error } = await c.from(CODES).select(CODE_COLUMNS).eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }).limit(5);
  if (error) {
    if (!isMissingTable(error)) console.error("[pro] status", error.message);
    return NO_PRO;
  }
  const rows = (data ?? []) as CodeRow[];
  const active = rows.find((r) => codeState(r) === "active");
  if (active) return { active: true, issued: false, expiresAt: active.expires_at, since: active.redeemed_at };
  return { ...NO_PRO, issued: rows.some((r) => codeState(r) === "issued") };
}

/**
 * Issues a new code for an account: earlier codes that are still open are revoked, so one account has one
 * code at a time. Returns the plain code (shown to the admin once, and sent to the member).
 */
export async function issueCode(userId: string, opts: { days?: number | null; requestId?: string | null; activate?: boolean } = {}): Promise<{ code: string; id: string; expiresAt: string | null }> {
  const c = db();
  if (!c) throw new Error("db_missing");
  const now = new Date();
  const expiresAt = opts.days && opts.days > 0 ? new Date(now.getTime() + opts.days * 86400_000).toISOString() : null;
  const { error: revokeError } = await c.from(CODES).update({ revoked_at: now.toISOString() }).eq("user_id", userId).is("revoked_at", null);
  if (revokeError) throw new Error(revokeError.message);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const norm = normalizeCode(code);
    const row = {
      user_id: userId,
      code_hash: codeHashes(norm)[0],
      code_enc: encrypt(code),
      hint: norm.slice(-4),
      request_id: opts.requestId ?? null,
      expires_at: expiresAt,
      redeemed_at: opts.activate ? now.toISOString() : null,
    };
    const { data, error } = await c.from(CODES).insert(row).select("id").single();
    if (!error && data) return { code, id: (data as { id: string }).id, expiresAt };
    if (error?.code !== "23505") throw new Error(error?.message ?? "insert failed");
  }
  throw new Error("could not create a unique code");
}

/** The code row for what someone typed (any state), or null. */
export async function findCode(input: string): Promise<CodeRow | null> {
  const norm = normalizeCode(input);
  const c = db();
  if (!norm || !c) return null;
  const { data, error } = await c.from(CODES).select(CODE_COLUMNS).in("code_hash", codeHashes(norm)).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CodeRow | null) ?? null;
}

/** Marks a code as entered (first time) and used now. */
export async function touchCode(row: CodeRow): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db()!
    .from(CODES)
    .update({ redeemed_at: row.redeemed_at ?? now, last_used_at: now })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
}

export function revealCode(row: Pick<CodeRow, "code_enc">): string {
  return decrypt(row.code_enc);
}

/** The member's most recent Pro request (for the "pending" / "declined" states), or null. */
export async function latestRequest(userId: string): Promise<{ status: "pending" | "approved" | "rejected"; reply: string; created_at: string } | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from(REQUESTS).select("status, reply, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error("[pro] request", error.message);
    return null;
  }
  return (data as { status: "pending" | "approved" | "rejected"; reply: string; created_at: string } | null) ?? null;
}
