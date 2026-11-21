// A job whose worker stopped during its last allowed attempt (Kariz 1.1.4): the web version's function cut at its
// time limit while the job ran leaves it `running` with an expired lock. Once the claim has counted every allowed
// attempt it is failed with a Persian reason, never claimed and run again; before, the claim of expired locks took it
// again and again, so a job that never fits in its worker's time was retried forever. A job with an attempt left is
// still taken again, as before.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { enqueue, registerJobHandler, tick } from "@server/jobs";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { ServerConfig } from "@server/context";
import type { Db } from "@server/db";

describe("jobs whose worker stopped", () => {
  let db: Db;
  let cfg: ServerConfig;
  let org = "";
  const warnings: string[] = [];
  const ran: string[] = [];
  const offs: (() => void)[] = [];

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    org = await signupWithOrg(new Client(s.app));
    const log = { ...quietLog, warn: (m: string) => void warnings.push(m) };
    cfg = { mode: "cloud", db, secret: "t", allowSignup: true, platformAdmins: [], origin: "cloud", log, fetch };
  });
  afterEach(async () => {
    while (offs.length) offs.pop()!();
    ran.length = 0;
    warnings.length = 0;
    await db.query(`delete from sm_jobs where kind like 'test.%'`);
  });

  const handle = (kind: string) => offs.push(registerJobHandler(kind, async (j) => void ran.push(j.id)));
  const job = (id: string) => db.one<{ status: string; attempts: number; last_error: string | null; done_at: string | null; locked_until: string | null; locked_by: string | null }>(`select * from sm_jobs where id = $1`, [id]);

  /** A job a worker claimed and never finished: `attempts` as the claims counted them, its lock gone a minute ago. */
  async function stalled(kind: string, attempts: number, maxAttempts: number, opts: { lastError?: string; lockedFor?: string } = {}): Promise<string> {
    const id = await enqueue(db, { kind, orgId: org, maxAttempts });
    await db.query(
      `update sm_jobs set status = 'running', attempts = $2, locked_by = 'w-gone', locked_until = now() + $4::interval, last_error = $3 where id = $1`,
      [id, attempts, opts.lastError ?? null, opts.lockedFor ?? "-1 minute"],
    );
    return id;
  }

  it("fails a job that used its last attempt, with a Persian reason, without running it again", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 3, 3);
    await tick(cfg, { budgetMs: 5000 });
    const j = await job(id);
    expect(j).toMatchObject({ status: "failed", attempts: 3, locked_until: null, locked_by: null });
    expect(j!.last_error).toContain("آخرین تلاش مجاز");
    expect(j!.done_at).not.toBeNull();
    expect(ran).toEqual([]);
    expect(warnings.some((w) => w.startsWith("job test.stalled failed"))).toBe(true);
  });

  it("keeps the error of an earlier attempt before the reason", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 5, 5, { lastError: "سرویس پاسخ نداد" });
    await tick(cfg, { budgetMs: 5000 });
    const j = await job(id);
    expect(j!.status).toBe("failed");
    expect(j!.last_error!.startsWith("سرویس پاسخ نداد · ")).toBe(true);
    expect(j!.last_error).toContain("آخرین تلاش مجاز");
    expect(ran).toEqual([]);
  });

  it("takes a job with an attempt left again and runs it, as before", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 2, 3);
    await tick(cfg, { budgetMs: 5000 });
    expect(await job(id)).toMatchObject({ status: "done", attempts: 3 });
    expect(ran).toEqual([id]);
  });

  it("leaves a job whose last attempt is still running (its lock has not expired)", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 3, 3, { lockedFor: "4 minutes" });
    await tick(cfg, { budgetMs: 2000 });
    expect(await job(id)).toMatchObject({ status: "running", attempts: 3, locked_by: "w-gone" });
    expect(ran).toEqual([]);
  });

  it("fails at most 100 such jobs per tick, the rest at the next one", async () => {
    handle("test.stalled_many");
    await db.query(
      `insert into sm_jobs (id, org_id, kind, status, attempts, max_attempts, locked_by, locked_until)
       select gen_random_uuid(), $1, 'test.stalled_many', 'running', 8, 8, 'w-gone', now() - (g * interval '1 second')
       from generate_series(1, 120) g`,
      [org],
    );
    const count = async () =>
      (await db.query<{ status: string; n: number }>(`select status, count(*)::int as n from sm_jobs where kind = 'test.stalled_many' group by status`)).reduce(
        (m, r) => ({ ...m, [r.status]: r.n }),
        {} as Record<string, number>,
      );
    await tick(cfg, { budgetMs: 5000 });
    expect(await count()).toEqual({ failed: 100, running: 20 });
    await tick(cfg, { budgetMs: 5000 });
    expect(await count()).toEqual({ failed: 120 });
    expect(ran).toEqual([]);
  });
});
