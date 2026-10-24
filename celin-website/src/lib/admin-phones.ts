import "server-only";
import { env } from "@/lib/env";
import { latinDigits, normalizePhone } from "@/lib/format";

/**
 * ADMIN_PHONES (optional): an allow-list of mobile numbers. A phone number alone never grants anything; when
 * the list is set, only accounts with these numbers may be made admin — with ADMIN_PASSWORD on /admin/login or
 * by another admin in Users → «مدیر کردن» (admin-auth.ts canActivateAdmin / promotionBlock).
 * Numbers may be written with Persian digits, +98 / 0098, spaces or dashes inside, and separated by commas
 * («،» too), semicolons, line breaks or spaces.
 */
export function parseAdminPhones(raw: string): string[] {
  const out = new Set<string>();
  for (const part of String(raw ?? "").split(/[,،;\n\r]+/)) {
    const whole = normalizePhone(part);
    if (whole) {
      out.add(whole);
      continue;
    }
    // "09121234567 0935 111 2222": glue space-separated pieces until they form a number
    let buf = "";
    for (const token of part.split(/\s+/).filter(Boolean)) {
      const next = buf + token;
      const glued = normalizePhone(next);
      const alone = normalizePhone(token);
      if (glued || alone) {
        out.add(glued || alone);
        buf = "";
      } else if (!/[\d۰-۹٠-٩+]/.test(token)) {
        buf = ""; // a word: whatever was collected is not a number
      } else {
        // too long to become one number: start again from this piece
        buf = latinDigits(next).replace(/\D/g, "").length >= 14 ? token : next;
      }
    }
  }
  return [...out];
}

let memo: { raw: string; list: string[] } | null = null;

/** The configured admin numbers (normalised 09xxxxxxxxx). */
export function adminPhones(): string[] {
  const raw = env.adminPhones;
  if (memo?.raw !== raw) memo = { raw, list: parseAdminPhones(raw) };
  return memo.list;
}

/** Whether this account phone is listed in ADMIN_PHONES. */
export function isAdminPhone(phone: string | null | undefined, list: string[] = adminPhones()): boolean {
  const p = normalizePhone(String(phone ?? ""));
  return Boolean(p) && list.includes(p);
}
