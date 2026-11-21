// «سلامت سامانه»: whether the database answers, the schema is current, the secrets and the platform
// admins are configured, how full the database is and whether the background jobs run. Each check has a
// tone the console shows and a short Persian explanation of what to do.
import type { ServerConfig } from "../../context";
import type { Db } from "../../db";
import { MIGRATIONS } from "../../db/migrations";
import { APP_VERSION } from "@shared/constants";
import { faDigits, formatNumber } from "@shared/format";

export type HealthTone = "ok" | "warning" | "danger" | "neutral";

export interface HealthCheck {
  key: "db" | "migrations" | "secret" | "admins" | "db_size" | "jobs";
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
  /** the job queue (null when the database did not answer) */
  jobs: JobsHealth | null;
  checks: HealthCheck[];
}

/** The background job queue (sm_jobs) as «سلامت سامانه» sees it. */
export interface JobsHealth {
  /** queued jobs whose time has come (at most `JOB_COUNT_CAP`) */
  due: number;
  /** running jobs whose worker's lock expired (at most `JOB_COUNT_CAP`) */
  stalled: number;
  /** when the oldest due job was due */
  oldest_due: string | null;
  /** how long it has waited (milliseconds; 0 without due jobs) */
  wait_ms: number;
  /** when a job last finished (done or failed) */
  last_done: string | null;
  /**
   * Is the queue being worked — a job finished in the last `JOBS_ACTIVE_MS` or a worker holds one now? Due jobs then
   * wait because the queue is behind, not because it stopped.
   */
  active: boolean;
  /**
   * The web version's minute heartbeat: a pg_cron job that calls /api/cron/tick ("set"), none ("missing"), or it could
   * not be read ("unknown"); null on the Windows app and the server edition (their own timers run the queue).
   */
  heartbeat: "set" | "missing" | "unknown" | null;
}

/** Supabase Free holds 500 MB per project. */
export const FREE_DB_BYTES = 500 * 1024 * 1024;

/** The counts of due and stalled jobs stop here (the probe stays cheap however long the queue is). */
export const JOB_COUNT_CAP = 10_001;
/**
 * The oldest due job's wait from which the queue needs attention: with a heartbeat a due job waits a minute or two, so
 * 10 minutes means the queue is not running; an hour means people-facing work (notifications, SLA timers) is an hour late.
 */
export const JOBS_WARNING_MS = 10 * 60_000;
export const JOBS_DANGER_MS = 60 * 60_000;
/** A job finished within this long (or one held by its worker now): the queue runs (a job's lock lasts as long). */
export const JOBS_ACTIVE_MS = 5 * 60_000;

/** A wait in Persian words: «۲۵ دقیقه», «۲ ساعت و ۵ دقیقه», «۳ روز و ۴ ساعت». */
export function waitText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${faDigits(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${faDigits(hours)} ساعت و ${faDigits(minutes % 60)} دقیقه` : `${faDigits(hours)} ساعت`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${faDigits(days)} روز و ${faDigits(hours % 24)} ساعت` : `${faDigits(days)} روز`;
}

async function jobsHealth(db: Db, web: boolean): Promise<JobsHealth> {
  const r = await db.one<{ oldest_due: string | null; wait_ms: number | null; due: number; stalled: number; last_done: string | null; active: boolean }>(
    `select q.*, coalesce((extract(epoch from now() - q.oldest_due) * 1000)::bigint, 0) as wait_ms
     from (select (select min(run_at) from sm_jobs where status = 'queued' and run_at <= now()) as oldest_due,
                  (select count(*)::int from (select 1 from sm_jobs where status = 'queued' and run_at <= now() limit ${JOB_COUNT_CAP}) d) as due,
                  (select count(*)::int from (select 1 from sm_jobs where status = 'running' and locked_until < now() limit ${JOB_COUNT_CAP}) s) as stalled,
                  (select max(done_at) from sm_jobs where status in ('done', 'failed')) as last_done,
                  (exists (select 1 from sm_jobs where status = 'running' and locked_until >= now())
                   or exists (select 1 from sm_jobs where status in ('done', 'failed') and done_at > now() - ${JOBS_ACTIVE_MS} * interval '1 millisecond')) as active) q`,
  );
  return {
    due: r?.due ?? 0,
    stalled: r?.stalled ?? 0,
    oldest_due: r?.oldest_due ?? null,
    wait_ms: Math.max(0, Number(r?.wait_ms ?? 0)),
    last_done: r?.last_done ?? null,
    active: !!r?.active,
    heartbeat: web ? await heartbeat(db) : null,
  };
}

/** Is a pg_cron job calling /api/cron/tick scheduled (docs/SETUP_FA.md §4-1)? Best effort: "unknown" when unreadable. */
async function heartbeat(db: Db): Promise<JobsHealth["heartbeat"]> {
  try {
    const ext = await db.one<{ cron: boolean }>(`select exists(select 1 from pg_extension where extname = 'pg_cron') as cron`);
    if (!ext?.cron) return "missing";
    const jobs = await db.one<{ n: number }>(`select count(*)::int as n from cron.job where active and command ilike '%/api/cron/tick%'`);
    return (jobs?.n ?? 0) > 0 ? "set" : "missing";
  } catch {
    return "unknown";
  }
}

const HEARTBEAT_LABEL = { set: "راه‌اندازی شده", missing: "راه‌اندازی نشده", unknown: "نامعلوم" } as const;
const JOBS_RUN_ON_WEB =
  "نسخهٔ وب کارهای پس‌زمینه (رویدادهای رکوردها، اعلان‌ها، زمان‌سنج‌ها و پیش‌فرض‌های سازمان تازه) را فقط هنگام کار افراد با برنامه یا با تپش زمان‌بند اجرا می‌کند";

function jobsCheck(cfg: ServerConfig, j: JobsHealth): HealthCheck {
  const title = "صف کارهای پس‌زمینه";
  if (j.wait_ms < JOBS_WARNING_MS) {
    return { key: "jobs", title, tone: "ok", value: j.heartbeat ? `به‌روز؛ تپش دقیقه‌ای: ${HEARTBEAT_LABEL[j.heartbeat]}` : "به‌روز" };
  }
  const count = j.due >= JOB_COUNT_CAP ? `بیش از ${formatNumber(JOB_COUNT_CAP - 1)}` : formatNumber(j.due);
  // the Windows app and the server edition run the queue on their own timer: a queue being worked is behind, not stopped
  // (a bulk import's record events, the app catching up after it was closed), and a restart would cut its jobs
  const detail =
    cfg.mode === "desktop"
      ? j.active
        ? "کارهای پس‌زمینه اجرا می‌شوند ولی صف عقب است؛ برنامه را باز نگه دارید تا کارهای مانده انجام شوند"
        : "اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ برنامه را ببندید و دوباره باز کنید و اگر ماند، فایل گزارش برنامه را بفرستید"
      : cfg.server
        ? j.active
          ? "کارهای پس‌زمینه اجرا می‌شوند ولی صف عقب است؛ سرویس را دوباره راه‌اندازی نکنید و کار زمان‌بند را در «سلامت سرور» ببینید"
          : "اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ سرویس KarizApp را دوباره راه‌اندازی کنید و «سلامت سرور» را ببینید"
        : j.heartbeat === "set"
          ? "تپش دقیقه‌ای راه‌اندازی شده ولی صف عقب است: در Supabase ← Integrations ← Cron تاریخچهٔ «itsm-tick» و پاسخ‌هایش را ببینید (docs/SETUP_FA.md بخش ۹)"
          : j.heartbeat === "unknown"
            ? `${JOBS_RUN_ON_WEB} و راه‌اندازی تپش دقیقه‌ای از اینجا دیده نمی‌شود: اگر راه‌اندازی نشده، آن را طبق docs/SETUP_FA.md بخش ۴-۱ با pg_cron راه‌اندازی کنید`
            : `${JOBS_RUN_ON_WEB} و تپش دقیقه‌ای راه‌اندازی نشده است: آن را طبق docs/SETUP_FA.md بخش ۴-۱ با pg_cron راه‌اندازی کنید`;
  return {
    key: "jobs",
    title,
    tone: j.wait_ms >= JOBS_DANGER_MS ? "danger" : "warning",
    value: `قدیمی‌ترین کار سررسیده ${waitText(j.wait_ms)} منتظر است (${count} کار سررسیده)`,
    detail,
  };
}

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
  if (reachable) applied = (await db.query<{ id: string }>(`select id from sm_migrations order by id`).catch(() => [])).map((r) => r.id);
  const have = new Set(applied);
  const missing = MIGRATIONS.filter((m) => !have.has(m.id)).map((m) => m.id);
  const secret = secretSource(cfg);
  // the size cap of Supabase Free; the server edition's own PostgreSQL has none
  const limit = cfg.mode === "cloud" && !cfg.server ? FREE_DB_BYTES : null;
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
  // the background jobs: the oldest due job's wait (the web version runs the queue only from people's work and its
  // heartbeat, so a missing heartbeat shows here first)
  const jobs = reachable ? await jobsHealth(db, cfg.mode === "cloud" && !cfg.server).catch(() => null) : null;
  if (jobs) checks.push(jobsCheck(cfg, jobs));

  return {
    ok: checks.every((c) => c.tone === "ok" || c.tone === "neutral"),
    mode: cfg.mode,
    version: APP_VERSION,
    checked_at: new Date().toISOString(),
    db: { reachable, latency_ms: latency, kind: db.kind, bytes, limit },
    migrations: { applied: applied.length, expected: MIGRATIONS.length, missing, latest: applied.at(-1) ?? null },
    secret,
    platform_admin_emails: cfg.platformAdmins.length,
    jobs,
    checks,
  };
}
