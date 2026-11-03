// «سلامت سامانه»: whether the database answers, the schema is current, the secrets and the platform
// admins are configured, and how full the database is. Each check has a tone the console shows and
// a short Persian explanation of what to do.
import type { ServerConfig } from "../../context";
import { MIGRATIONS } from "../../db/migrations";
import { APP_VERSION } from "@shared/constants";
import { faDigits } from "@shared/format";

export type HealthTone = "ok" | "warning" | "danger" | "neutral";

export interface HealthCheck {
  key: "db" | "migrations" | "secret" | "admins" | "db_size";
  title: string;
  tone: HealthTone;
  /** the state in a few words */
  value: string;
  /** what to do about it (only when it is not ok) */
  detail?: string;
}

export interface SystemHealth {
  ok: boolean;
  mode: ServerConfig["mode"];
  version: string;
  checked_at: string;
  db: { reachable: boolean; latency_ms: number | null; kind: string; bytes: number | null; limit: number | null };
  migrations: { applied: number; expected: number; missing: string[]; latest: string | null };
  secret: "env" | "derived" | "installation";
  platform_admin_emails: number;
  checks: HealthCheck[];
}

/** Supabase Free holds 500 MB per project. */
export const FREE_DB_BYTES = 500 * 1024 * 1024;

export function secretSource(cfg: ServerConfig): SystemHealth["secret"] {
  if (cfg.secretSource) return cfg.secretSource;
  if (cfg.mode === "desktop") return "installation";
  return process.env.APP_SECRET ? "env" : "derived";
}

const mb = (bytes: number) => `${faDigits(Math.round(bytes / 1024 / 1024))} مگابایت`;

export async function systemHealth(cfg: ServerConfig): Promise<SystemHealth> {
  const db = cfg.db;
  const started = Date.now();
  let reachable = true;
  let bytes: number | null = null;
  try {
    const r = await db.one<{ bytes: number }>(`select pg_database_size(current_database())::bigint as bytes`);
    bytes = r ? Number(r.bytes) : null;
  } catch {
    reachable = false;
  }
  const latency = reachable ? Date.now() - started : null;
  let applied: string[] = [];
  if (reachable) applied = (await db.query<{ id: string }>(`select id from tz_migrations order by id`).catch(() => [])).map((r) => r.id);
  const have = new Set(applied);
  const missing = MIGRATIONS.filter((m) => !have.has(m.id)).map((m) => m.id);
  const secret = secretSource(cfg);
  const limit = cfg.mode === "cloud" ? FREE_DB_BYTES : null;
  const checks: HealthCheck[] = [];

  checks.push(
    reachable
      ? { key: "db", title: "پایگاه داده", tone: "ok", value: `در دسترس (${faDigits(latency ?? 0)} میلی‌ثانیه)` }
      : { key: "db", title: "پایگاه داده", tone: "danger", value: "پاسخ نمی‌دهد", detail: "نشانی پایگاه داده (DATABASE_URL) و وضعیت پروژهٔ Supabase را بررسی کنید" },
  );
  checks.push(
    missing.length === 0
      ? { key: "migrations", title: "ساختار پایگاه داده", tone: "ok", value: `به‌روز (${faDigits(MIGRATIONS.length)} مرحله)` }
      : {
          key: "migrations",
          title: "ساختار پایگاه داده",
          tone: "danger",
          value: `${faDigits(missing.length)} مرحله اجرا نشده`,
          detail: `مرحله‌های ${missing.join("، ")} اجرا نشده‌اند؛ برنامه را دوباره راه‌اندازی کنید یا supabase/schema.sql را اجرا کنید`,
        },
  );
  if (secret === "env") checks.push({ key: "secret", title: "کلید رمزنگاری", tone: "ok", value: "APP_SECRET تنظیم شده است" });
  else if (secret === "installation") checks.push({ key: "secret", title: "کلید رمزنگاری", tone: "ok", value: "کلید همین نصب" });
  else
    checks.push({
      key: "secret",
      title: "کلید رمزنگاری",
      tone: "warning",
      value: "از نشانی پایگاه داده ساخته شده",
      detail: "APP_SECRET را در Vercel تنظیم کنید؛ با تغییر نشانی پایگاه داده، نشست‌ها و کلیدهای ذخیره‌شده (از جمله کلیدهای هوش مصنوعی) خوانده نمی‌شوند",
    });
  if (cfg.mode === "desktop") checks.push({ key: "admins", title: "مدیران سامانه", tone: "ok", value: "نخستین حساب این رایانه" });
  else if (cfg.platformAdmins.length) checks.push({ key: "admins", title: "مدیران سامانه", tone: "ok", value: `${faDigits(cfg.platformAdmins.length)} ایمیل در PLATFORM_ADMIN_EMAILS` });
  else
    checks.push({
      key: "admins",
      title: "مدیران سامانه",
      tone: "warning",
      value: "PLATFORM_ADMIN_EMAILS خالی است",
      detail: "ایمیل خودتان را در PLATFORM_ADMIN_EMAILS بگذارید تا دسترسی مدیر سامانه به نخستین حساب وابسته نباشد",
    });
  if (bytes !== null) {
    if (limit) {
      const share = bytes / limit;
      checks.push({
        key: "db_size",
        title: "حجم پایگاه داده",
        tone: share >= 0.9 ? "danger" : share >= 0.7 ? "warning" : "ok",
        value: `${mb(bytes)} از ${mb(limit)}`,
        detail: share >= 0.7 ? "به سقف طرح رایگان Supabase نزدیک می‌شوید؛ داده‌های قدیمی را بایگانی کنید یا طرح را ارتقا دهید" : undefined,
      });
    } else checks.push({ key: "db_size", title: "حجم پایگاه داده", tone: "neutral", value: mb(bytes) });
  }

  return {
    ok: checks.every((c) => c.tone === "ok" || c.tone === "neutral"),
    mode: cfg.mode,
    version: APP_VERSION,
    checked_at: new Date().toISOString(),
    db: { reachable, latency_ms: latency, kind: db.kind, bytes, limit },
    migrations: { applied: applied.length, expected: MIGRATIONS.length, missing, latest: applied.at(-1) ?? null },
    secret,
    platform_admin_emails: cfg.platformAdmins.length,
    checks,
  };
}
