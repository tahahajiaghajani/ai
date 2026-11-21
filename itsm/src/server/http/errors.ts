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

/**
 * The mark src/server/db/postgres.ts puts on every error that leaves it: a Node socket code (ECONNRESET…) is the
 * database's only then — the same codes from an outbound HTTP call are not.
 */
const DB_ERROR = Symbol.for("itsm.db-error");

/** Node socket codes: the database connection failed (only on an error marked by postgres.ts). */
const SOCKET_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"]);
/** postgres.js' codes for a connection that could not be made or was lost, and the server shutting down. */
const CONNECTION_CODES = new Set(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "57P01", "57P02", "57P03"]);
/** Supavisor's FATAL XX000 answers (any case, with or without its «(ECODE)» prefix): no backend could be had… */
const POOLER_BUSY = /unable to check out (a )?connection|failed to check out a connection|pool checkout failed|max client connections reached|max clients reached in session mode/i;
/** …or the backend it held went away. */
const POOLER_GONE = /connection to database closed|DbHandler exited|pool terminating/i;

/** The database cannot do this now: 503 with the seconds after which to try again (null: retrying will not help). */
function dbUnavailable(code: string, message: string, retryAfterS: number | null, dbCode: string): AppError {
  return new AppError(503, code, message, retryAfterS === null ? { db_code: dbCode } : { retry_after_s: retryAfterS, db_code: dbCode });
}

const dbBusy = (c: string) => dbUnavailable("db_busy", "سامانه اکنون بیش از حد مشغول است و اتصالی به پایگاه داده آزاد نشد؛ چند ثانیهٔ دیگر دوباره امتحان کنید", 5, c);
const dbTimeout = (c: string) => dbUnavailable("db_timeout", "پایگاه داده در زمان مجاز پاسخ نداد و این کار نیمه‌کاره متوقف شد؛ چند لحظهٔ دیگر دوباره امتحان کنید", 5, c);
const dbLocked = (c: string) => dbUnavailable("db_locked", "داده‌ای که این کار لازم دارد اکنون در دست کار دیگری است؛ چند لحظهٔ دیگر دوباره امتحان کنید", 3, c);
const dbGone = (c: string) => dbUnavailable("db_unavailable", "ارتباط با پایگاه داده برقرار نشد یا قطع شد؛ چند لحظهٔ دیگر دوباره امتحان کنید", 5, c);
const dbReadOnly = (c: string) =>
  dbUnavailable("db_read_only", "پایگاه داده اکنون فقط‌خواندنی است (معمولاً چون فضای طرح Supabase پر شده است)؛ تا مدیر سامانه فضا آزاد نکند، ثبت و ویرایش ممکن نیست", null, c);

/**
 * A database that is busy, slow, locked, gone or read-only (the web version behind Supabase's pooler bounds every wait:
 * src/server/cloud.ts webPoolOptions): a 503 the person can act on instead of a 500. `db_code` is what the database or
 * the driver said — Supavisor's own «(ECODE)» when it gave one.
 */
function dbUnavailableMessage(err: { code?: string; message?: string }, marked: boolean): AppError | null {
  const code = String(err.code);
  if (code === "QUEUE_TIMEOUT" || code === "53300" || code === "53200") return dbBusy(code);
  if (code === "57014" || code === "DB_TIMEOUT" || code === "25P03") return dbTimeout(code);
  if (code === "55P03") return dbLocked(code);
  if (code === "25006" || code === "53100") return dbReadOnly(code);
  if (CONNECTION_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code) || (marked && SOCKET_CODES.has(code))) return dbGone(code);
  if (code === "XX000" || marked) {
    const text = String(err.message ?? "");
    const own = /^\((E[A-Z0-9_]+)\)/.exec(text)?.[1] ?? code;
    if (POOLER_BUSY.test(text)) return dbBusy(own);
    if (POOLER_GONE.test(text)) return dbGone(own);
  }
  return null;
}

/** Persian message for a database error (unique violation, a busy, slow or unreachable database, etc.). */
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
      return dbUnavailableMessage(err, DB_ERROR in err);
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
