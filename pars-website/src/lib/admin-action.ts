import "server-only";
import { assertAdmin } from "@/lib/admin-auth";
import { ProviderError } from "@/lib/ai/providers";
import { aiErrorText } from "@/lib/ai-errors";
import type { AdminResult } from "@/app/actions/admin";

/** Runs an admin Server Action body after the session check and turns errors into a Persian message. */
export async function guard<R extends AdminResult>(fn: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  try {
    await assertAdmin();
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "unauthorized") return { ok: false, error: "نشست شما منقضی شده است؛ دوباره وارد شوید." };
    if (msg === "db_missing") return { ok: false, error: "پایگاه داده تنظیم نشده است." };
    if (e instanceof ProviderError) return { ok: false, error: aiErrorText(e) };
    if (e instanceof Error && e.name === "TimeoutError") return { ok: false, error: "سرویس در زمان مقرر پاسخ نداد؛ کمی بعد دوباره امتحان کنید." };
    console.error("[admin]", e);
    return { ok: false, error: msg.slice(0, 300) };
  }
}

/** Trimmed text for a Postgres column (NUL is rejected by Postgres). */
export function str(v: unknown, max = 20000): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}
