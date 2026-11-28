// «صف کارهای پس‌زمینه» on «سلامت سامانه» (Kariz 1.1.4): the oldest due job's wait — ok below 10 minutes, a warning
// from 10 minutes, danger from an hour — with what to do for each edition. On the web version the queue runs only from
// people's work and the minute heartbeat (pg_cron calling /api/cron/tick), and the check says whether that heartbeat
// is set up; 1,725 jobs waited five days in production without a word on this page.
// Kariz 1.1.5: a job's claim stamps its `updated_at` and its worker's heartbeat renews its lock, so the row names a job
// that has held the queue for minutes by its claim time — and advises no restart while its lock is live — and a second
// row («کارهای ناتمام در آخرین تلاش») counts the jobs failed in the last 24 hours because their worker stopped during
// their last allowed attempt.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { systemHealth, waitText, type HealthCheck, type SystemHealth } from "@server/modules/platform/health";
import { EXHAUSTED_ERROR, enqueue, registerJobHandler, tick } from "@server/jobs";
import { makeServer, quietLog } from "./helpers";
import type { ServerConfig, ServerEditionBridge } from "@server/context";
import type { Db, Queryable } from "@server/db";

const serverBridge: ServerEditionBridge = {
  health: async () => ({}),
  info: () => ({ air_gapped: true, public_url: "https://kariz.test.local", directory_path: "" }),
  allow: async () => ({ allow: [] }),
};

/** The database, with the heartbeat's two queries answered as a Supabase project with pg_cron would (or failing). */
function withCron(db: Db, cron: { installed: boolean; jobs?: number; unreadable?: boolean }): Db {
  const fake = async (text: string): Promise<unknown[] | null> => {
    if (text.includes("from pg_extension")) return [{ cron: cron.installed }];
    if (text.includes("from cron.job")) {
      if (cron.unreadable) throw Object.assign(new Error("permission denied for schema cron"), { code: "42501" });
      return [{ n: cron.jobs ?? 0 }];
    }
    return null;
  };
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "query" || prop === "one") {
        return async (text: string, params?: unknown[]) => {
          const rows = await fake(text);
          if (rows) return prop === "one" ? rows[0] ?? null : rows;
          return (target as Queryable)[prop](text, params);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

describe("the job queue on «سلامت سامانه»", () => {
  let db: Db;
  beforeAll(async () => {
    db = (await makeServer()).db;
  });
  beforeEach(() => db.query(`delete from sm_jobs`));

  // every other check ok: an encryption key from the environment and a platform administrator by email
  const cfgOf = (over: Partial<ServerConfig> = {}): ServerConfig => ({
    mode: "cloud",
    db,
    secret: "t",
    secretSource: "env",
    allowSignup: true,
    platformAdmins: ["owner@example.com"],
    origin: "cloud",
    log: quietLog,
    fetch,
    ...over,
  });
  const jobs = (h: SystemHealth): HealthCheck => {
    const c = h.checks.find((x) => x.key === "jobs");
    expect(c).toBeDefined();
    return c!;
  };
  /** `n` queued jobs due `minutes` ago (and one waiting for later, which never counts) */
  const due = async (minutes: number, n = 1) => {
    await db.query(
      `insert into sm_jobs (id, kind, run_at) select gen_random_uuid(), 'test.health', now() - ($1::int * interval '1 minute') from generate_series(1, $2::int)`,
      [minutes, n],
    );
    await db.query(`insert into sm_jobs (id, kind, run_at) values (gen_random_uuid(), 'test.health', now() + interval '1 day')`);
  };

  it("no jobs: ok on the web version, with its heartbeat's state", async () => {
    const h = await systemHealth(cfgOf());
    expect(jobs(h)).toEqual({ key: "jobs", title: "صف کارهای پس‌زمینه", tone: "ok", value: "به‌روز؛ تپش دقیقه‌ای: راه‌اندازی نشده" });
    expect(h.ok).toBe(true);
    expect(h.jobs).toMatchObject({ due: 0, stalled: 0, oldest_due: null, wait_ms: 0, heartbeat: "missing" });
  });

  it("jobs due a few minutes ago: still ok", async () => {
    await due(3, 4);
    const h = await systemHealth(cfgOf());
    expect(jobs(h).tone).toBe("ok");
    expect(h.jobs).toMatchObject({ due: 4 });
    expect(h.ok).toBe(true);
  });

  it("a job due 15 minutes ago: a warning that tells the web version to set up the heartbeat", async () => {
    await due(15);
    const h = await systemHealth(cfgOf());
    const c = jobs(h);
    expect(c.tone).toBe("warning");
    expect(c.value).toBe("قدیمی‌ترین کار سررسیده ۱۵ دقیقه منتظر است (۱ کار سررسیده)");
    expect(c.detail).toContain("تپش دقیقه‌ای راه‌اندازی نشده است");
    expect(c.detail).toContain("docs/SETUP_FA.md بخش ۴-۱");
    expect(h.ok).toBe(false);
  });

  it("due 2 hours ago: danger", async () => {
    await due(120, 3);
    const c = jobs(await systemHealth(cfgOf()));
    expect(c.tone).toBe("danger");
    expect(c.value).toBe("قدیمی‌ترین کار سررسیده ۲ ساعت منتظر است (۳ کار سررسیده)");
  });

  it("with the heartbeat set up: «راه‌اندازی شده», and a late queue points to its history", async () => {
    const cron = withCron(db, { installed: true, jobs: 1 });
    expect(jobs(await systemHealth(cfgOf({ db: cron }))).value).toBe("به‌روز؛ تپش دقیقه‌ای: راه‌اندازی شده");
    await due(30);
    const c = jobs(await systemHealth(cfgOf({ db: cron })));
    expect(c.tone).toBe("warning");
    expect(c.detail).toContain("Integrations ← Cron");
    expect(c.detail).toContain("itsm-tick");
  });

  it("pg_cron without a job that calls /api/cron/tick counts as not set up; an unreadable cron.job as unknown", async () => {
    expect(jobs(await systemHealth(cfgOf({ db: withCron(db, { installed: true, jobs: 0 }) }))).value).toBe("به‌روز؛ تپش دقیقه‌ای: راه‌اندازی نشده");
    const unreadable = withCron(db, { installed: true, unreadable: true });
    expect(jobs(await systemHealth(cfgOf({ db: unreadable }))).value).toBe("به‌روز؛ تپش دقیقه‌ای: نامعلوم");
    await due(12);
    const c = jobs(await systemHealth(cfgOf({ db: unreadable })));
    expect(c.detail).toContain("از اینجا دیده نمی‌شود");
    expect(c.detail).toContain("docs/SETUP_FA.md بخش ۴-۱");
  });

  it("the Windows app: no heartbeat part, and its own advice", async () => {
    expect(jobs(await systemHealth(cfgOf({ mode: "desktop" }))).value).toBe("به‌روز");
    await due(25);
    const c = jobs(await systemHealth(cfgOf({ mode: "desktop" })));
    expect(c.tone).toBe("warning");
    expect(c.detail).toBe("اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ برنامه را ببندید و دوباره باز کنید و اگر ماند، فایل گزارش برنامه را بفرستید");
  });

  it("the server edition: its own advice", async () => {
    expect(jobs(await systemHealth(cfgOf({ server: serverBridge }))).value).toBe("به‌روز");
    await due(25);
    const c = jobs(await systemHealth(cfgOf({ server: serverBridge })));
    expect(c.detail).toBe("اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ سرویس KarizApp را دوباره راه‌اندازی کنید و «سلامت سرور» را ببینید");
  });

  // a queue that runs but is behind (a bulk import's record events on the server edition, the Windows app catching up
  // after it was closed) is not a stopped one: restarting the service would only cut the jobs in progress
  it("a queue that runs but is behind: the server edition and the Windows app are not told to restart", async () => {
    await due(25);
    await db.query(`insert into sm_jobs (id, kind, status, attempts, done_at) values (gen_random_uuid(), 'test.health', 'done', 1, now() - interval '1 minute')`);
    const server = await systemHealth(cfgOf({ server: serverBridge }));
    expect(server.jobs).toMatchObject({ active: true });
    expect(jobs(server)).toMatchObject({ tone: "warning", detail: "کارهای پس‌زمینه اجرا می‌شوند ولی صف عقب است؛ سرویس را دوباره راه‌اندازی نکنید و کار زمان‌بند را در «سلامت سرور» ببینید" });
    await db.query(`delete from sm_jobs where status = 'done'`);
    // a worker holds a job now (its lock has not expired)
    await db.query(
      `insert into sm_jobs (id, kind, status, attempts, locked_by, locked_until) values (gen_random_uuid(), 'test.health', 'running', 1, 'w-live', now() + interval '4 minutes')`,
    );
    const desktop = await systemHealth(cfgOf({ mode: "desktop" }));
    expect(jobs(desktop)).toMatchObject({ tone: "warning", detail: "کارهای پس‌زمینه اجرا می‌شوند ولی صف عقب است؛ برنامه را باز نگه دارید تا کارهای مانده انجام شوند" });
    // nothing finished in the last 5 minutes and no worker holds a job: stopped
    await db.query(`delete from sm_jobs where status = 'running'`);
    await db.query(`insert into sm_jobs (id, kind, status, attempts, done_at) values (gen_random_uuid(), 'test.health', 'done', 1, now() - interval '6 minutes')`);
    const stopped = await systemHealth(cfgOf({ mode: "desktop" }));
    expect(stopped.jobs).toMatchObject({ active: false });
    expect(jobs(stopped).detail).toBe("اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ برنامه را ببندید و دوباره باز کنید و اگر ماند، فایل گزارش برنامه را بفرستید");
  });

  // one long job holds the queue (the Windows app runs one job at a time; the server edition's round waits for each of
  // its jobs) and its lock has expired: its worker stopped (the queue takes the job again), and a restart would only cut
  // the jobs in progress (JOBS-3 of the 1.1.4 review). Its claim stamped `updated_at` 7 minutes ago (1.1.5: the
  // heartbeat renews the lock, so the lock no longer tells when the job was claimed)
  it("a job that has run for minutes with its lock expired is named, and no restart is advised", async () => {
    await due(11, 60);
    await db.query(
      `insert into sm_jobs (id, kind, status, attempts, locked_by, locked_until, updated_at)
       values (gen_random_uuid(), 'test.longsync', 'running', 1, 'w-live', now() - interval '2 minutes', now() - interval '7 minutes')`,
    );
    await db.query(`insert into sm_jobs (id, kind, status, attempts, done_at) values (gen_random_uuid(), 'test.health', 'done', 1, now() - interval '7 minutes')`);
    const desktop = await systemHealth(cfgOf({ mode: "desktop" }));
    const d = jobs(desktop);
    expect(d.tone).toBe("warning");
    expect(d.detail).not.toContain("ببندید و دوباره باز کنید");
    const s = jobs(await systemHealth(cfgOf({ server: serverBridge })));
    expect(s.detail).not.toContain("دوباره راه‌اندازی کنید");
    expect(desktop.jobs).toMatchObject({ due: 60, stalled: 1, active: false, running: { kind: "test.longsync", live: false } });
    expect(desktop.jobs!.running!.run_ms).toBeGreaterThanOrEqual(7 * 60_000);
    expect(desktop.jobs!.running!.run_ms).toBeLessThan(8 * 60_000);
    expect(d.detail).toContain("«test.longsync» از ۷ دقیقه پیش");
    expect(d.detail).toContain("برنامه را باز نگه دارید");
    expect(s.detail).toContain("«test.longsync» از ۷ دقیقه پیش");
    expect(s.detail).toContain("سرویس را دوباره راه‌اندازی نکنید");
    // past 2 hours (the heartbeat's maximum) its worker counts as hung: the advice is the stopped queue's again
    await db.query(`update sm_jobs set locked_until = now() - interval '2 hours 55 minutes', updated_at = now() - interval '3 hours' where kind = 'test.longsync'`);
    expect(jobs(await systemHealth(cfgOf({ mode: "desktop" }))).detail).toBe(
      "اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ برنامه را ببندید و دوباره باز کنید و اگر ماند، فایل گزارش برنامه را بفرستید",
    );
    expect(jobs(await systemHealth(cfgOf({ server: serverBridge }))).detail).toBe(
      "اجرای کارهای پس‌زمینه متوقف به نظر می‌رسد؛ سرویس KarizApp را دوباره راه‌اندازی کنید و «سلامت سرور» را ببینید",
    );
  });

  // JOBS-3 end to end with the 1.1.5 heartbeat: a real tick (the Windows app's: one job at a time) holds a job whose
  // worker is alive; its heartbeat keeps the lock live, and its claim was 7 minutes ago — the row names it by its claim,
  // and neither edition is told to restart (1.1.4 read the claim off the lock, which the heartbeat now moves forward)
  it("a live job that has held the queue for minutes is named by its claim time while its heartbeat keeps its lock", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    const off = registerJobHandler("test.gated", async () => {
      started();
      await gate;
    });
    try {
      const id = await enqueue(db, { kind: "test.gated", maxAttempts: 2 });
      const t = tick(cfgOf({ mode: "desktop" }), { budgetMs: 60_000, max: 1, cleanup: false, concurrency: 1, heartbeatMs: 100 });
      await running;
      // the job was claimed 7 minutes ago (as if it had run since), and 60 jobs have waited 11 minutes behind it
      await db.query(`update sm_jobs set updated_at = now() - interval '7 minutes' where id = $1`, [id]);
      await due(11, 60);
      await new Promise((r) => setTimeout(r, 300));
      for (const over of [{ mode: "desktop" as const }, { server: serverBridge }]) {
        const h = await systemHealth(cfgOf(over));
        expect(h.jobs).toMatchObject({ due: 60, stalled: 0, active: true, running: { kind: "test.gated", live: true } });
        expect(h.jobs!.running!.run_ms).toBeGreaterThanOrEqual(7 * 60_000);
        const c = jobs(h);
        expect(c.tone).toBe("warning");
        expect(c.detail).toContain("کار «test.gated» از ۷ دقیقه پیش در حال اجراست و بقیهٔ صف پشت آن منتظر است");
        expect(c.detail).not.toContain("دوباره راه‌اندازی کنید");
        expect(c.detail).not.toContain("ببندید و دوباره باز کنید");
      }
      release();
      await t;
    } finally {
      release();
      off();
    }
  });

  it("«کارهای ناتمام در آخرین تلاش» counts the jobs failed in the last 24 hours because their worker stopped at their last attempt", async () => {
    const exhausted = (h: SystemHealth) => h.checks.find((x) => x.key === "jobs_exhausted");
    const none = await systemHealth(cfgOf());
    expect(exhausted(none)).toEqual({ key: "jobs_exhausted", title: "کارهای ناتمام در آخرین تلاش", tone: "ok", value: "هیچ کاری در ۲۴ ساعت گذشته" });
    expect(none.ok).toBe(true);
    const failed = (error: string, hoursAgo: number) =>
      db.query(`insert into sm_jobs (id, kind, status, attempts, last_error, done_at) values (gen_random_uuid(), 'test.health', 'failed', 3, $1, now() - ($2::int * interval '1 hour'))`, [error, hoursAgo]);
    await failed(EXHAUSTED_ERROR, 1);
    await failed(`سرویس پاسخ نداد · ${EXHAUSTED_ERROR}`, 20);
    await failed("سرویس پاسخ نداد", 2); // a handler's error at its last attempt: a failure of its own, not this row's
    await failed(EXHAUSTED_ERROR, 30); // older than 24 hours
    const h = await systemHealth(cfgOf({ mode: "desktop" }));
    expect(h.jobs).toMatchObject({ exhausted_24h: 2 });
    const c = exhausted(h)!;
    expect(c).toMatchObject({ tone: "warning", value: "۲ کار در ۲۴ ساعت گذشته" });
    expect(c.detail).toContain("«ناموفق»");
    expect(h.ok).toBe(false);
  });

  it("counts stop at 10,001 and stalled workers are counted", async () => {
    await due(11, 10_050);
    await db.query(
      `insert into sm_jobs (id, kind, status, attempts, locked_by, locked_until) values (gen_random_uuid(), 'test.health', 'running', 1, 'w-gone', now() - interval '1 minute')`,
    );
    const h = await systemHealth(cfgOf());
    expect(h.jobs).toMatchObject({ due: 10_001, stalled: 1 });
    expect(jobs(h).value).toBe("قدیمی‌ترین کار سررسیده ۱۱ دقیقه منتظر است (بیش از ۱۰٬۰۰۰ کار سررسیده)");
  });

  it("waits read in Persian words", () => {
    expect(waitText(25 * 60_000 + 59_000)).toBe("۲۵ دقیقه");
    expect(waitText(125 * 60_000)).toBe("۲ ساعت و ۵ دقیقه");
    expect(waitText(120 * 60_000)).toBe("۲ ساعت");
    expect(waitText((5 * 24 + 2) * 3600_000 + 13 * 60_000)).toBe("۵ روز و ۲ ساعت");
    expect(waitText(3 * 24 * 3600_000)).toBe("۳ روز");
  });
});
