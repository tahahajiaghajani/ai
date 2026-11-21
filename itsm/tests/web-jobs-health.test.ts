// «صف کارهای پس‌زمینه» on «سلامت سامانه» (Kariz 1.1.4): the oldest due job's wait — ok below 10 minutes, a warning
// from 10 minutes, danger from an hour — with what to do for each edition. On the web version the queue runs only from
// people's work and the minute heartbeat (pg_cron calling /api/cron/tick), and the check says whether that heartbeat
// is set up; 1,725 jobs waited five days in production without a word on this page.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { systemHealth, waitText, type HealthCheck, type SystemHealth } from "@server/modules/platform/health";
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
