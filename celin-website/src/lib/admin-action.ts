import "server-only";
import { assertAdmin } from "@/lib/admin-auth";
import { UserError } from "@/lib/db";
import type { Result } from "@/lib/action";

/** Runs an admin Server Action body after the session check and turns errors into a Persian message. */
export async function guard<R extends Result>(fn: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  try {
    await assertAdmin();
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "unauthorized") return { ok: false, error: "نشست شما منقضی شده است؛ دوباره وارد شوید." };
    if (msg === "db_missing") return { ok: false, error: "پایگاه داده تنظیم نشده است." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof Error && e.name === "TimeoutError") return { ok: false, error: "سرویس در زمان مقرر پاسخ نداد؛ کمی بعد دوباره امتحان کنید." };
    console.error("[admin]", e);
    return { ok: false, error: `خطا: ${msg.slice(0, 260)}` };
  }
}

/** An API key as pasted: spaces, line breaks and invisible direction marks (common when copying in RTL pages) removed. */
export function cleanKey(v: unknown): string {
  return (typeof v === "string" ? v : "").replace(/[\s\p{Cf}]/gu, "").slice(0, 500);
}
