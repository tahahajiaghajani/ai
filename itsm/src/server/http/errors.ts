// Errors carry a Persian message for the user and a stable code for programs.
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const bad = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "ابتدا وارد حساب خود شوید") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "شما به این بخش دسترسی ندارید") => new AppError(403, "forbidden", message);
export const notFound = (message = "مورد خواسته‌شده پیدا نشد") => new AppError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const tooMany = (message = "تلاش‌های زیادی انجام شد؛ چند دقیقه بعد دوباره امتحان کنید") => new AppError(429, "rate_limited", message);

/** Persian message for a database error (unique violation, etc.). */
export function dbErrorMessage(e: unknown): AppError | null {
  const err = e as { code?: string; constraint?: string; detail?: string; message?: string; column?: string };
  if (!err || typeof err !== "object" || !err.code) return null;
  switch (err.code) {
    case "23505": {
      const c = err.constraint || "";
      if (c.includes("code")) return conflict("این کد قبلاً استفاده شده است");
      if (c.includes("_no_")) return conflict("این شماره قبلاً استفاده شده است");
      if (c.includes("email")) return conflict("این ایمیل قبلاً ثبت شده است");
      return conflict("این مورد تکراری است");
    }
    case "23503":
      return conflict("این مورد به دادهٔ دیگری وابسته است");
    case "23502":
      return bad("یکی از فیلدهای الزامی خالی است", { column: err.column ?? null });
    case "22P02":
    case "22003":
    case "22007":
    case "22008":
      return bad("مقدار واردشده معتبر نیست");
    case "40001":
    case "40P01":
      return new AppError(503, "retry", "سیستم مشغول است؛ دوباره امتحان کنید");
    default:
      return null;
  }
}

export function zodToAppError(e: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of e.issues) {
    const path = issue.path.join(".") || "_";
    if (!fields[path]) fields[path] = issue.message;
  }
  const first = Object.values(fields)[0] ?? "اطلاعات ارسال‌شده معتبر نیست";
  return new AppError(400, "validation", first, { fields });
}
