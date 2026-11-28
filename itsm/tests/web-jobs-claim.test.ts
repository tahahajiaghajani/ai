// A job whose worker stopped: the web version's function cut at its time limit, a process that died or an outcome that
// could not be saved leaves the job `running` until its lock expires. With an attempt left it is taken again and run;
// at its last allowed attempt it is failed with a Persian reason (`failExhausted`, Kariz 1.1.5) and its kind's exhausted
// hook settles what the job left (tests/web-jobs-chain.test.ts, tests/web-jobs-exhausted.test.ts) — never run again, so
// a job that never fits in its worker's time is not retried forever.
// 1.1.4 took such a job again whatever its attempts (the 1.1.4 candidate's failExhausted ended healthy self-rescheduling
// chains: a death kept its attempt for good). 1.1.5 brings it back together with what made it safe: a run that returns
// normally forgives the deaths and errors before it (only consecutive failures exhaust a job), every stateful kind has
// its exhausted hook, and a live worker renews its lock (tests/web-jobs-live.test.ts), so an expired lock means a
// worker that is gone.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { enqueue, EXHAUSTED_ERROR, registerJobHandler, tick } from "@server/jobs";
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
    // the new organisation's seeds wait 10 minutes: nothing but this suite's jobs is due
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
  const job = (id: string) =>
    db.one<{ status: string; attempts: number; last_error: string | null; done_at: string | null; locked_until: string | null; locked_by: string | null }>(
      `select * from sm_jobs where id = $1`,
      [id],
    );

  /** A job a worker claimed and never finished: `attempts` as the claims counted them, its lock gone a minute ago. */
  async function stalled(kind: string, attempts: number, maxAttempts: number, opts: { lastError?: string; lockedFor?: string } = {}): Promise<string> {
    const id = await enqueue(db, { kind, orgId: org, maxAttempts });
    await db.query(
      `update sm_jobs set status = 'running', attempts = $2, locked_by = 'w-gone', locked_until = now() + $4::interval, last_error = $3 where id = $1`,
      [id, attempts, opts.lastError ?? null, opts.lockedFor ?? "-1 minute"],
    );
    return id;
  }

  it("fails a job whose worker stopped during its last allowed attempt, with a Persian reason, without running it", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 3, 3, { lastError: "سرویس پاسخ نداد" });
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    const j = await job(id);
    expect(j).toMatchObject({ status: "failed", attempts: 3, locked_until: null, locked_by: null, last_error: `سرویس پاسخ نداد · ${EXHAUSTED_ERROR}` });
    expect(j!.done_at).not.toBeNull();
    expect(ran).toEqual([]);
    expect(warnings.some((w) => w.startsWith("job test.stalled failed: its worker stopped during its last allowed attempt"))).toBe(true);
  });

  it("fails at most 100 such jobs of kinds without a hook per tick, the rest at the next one", async () => {
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
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    expect(await count()).toEqual({ failed: 100, running: 20 });
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    expect(await count()).toEqual({ failed: 120 });
    expect(ran).toEqual([]);
  });

  it("takes a job with an attempt left again and runs it, as before", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 2, 3);
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    expect(await job(id)).toMatchObject({ status: "done", attempts: 3 });
    expect(ran).toEqual([id]);
  });

  it("leaves a job whose worker still holds it (its lock has not expired)", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 3, 3, { lockedFor: "4 minutes" });
    await tick(cfg, { budgetMs: 2000, cleanup: false });
    expect(await job(id)).toMatchObject({ status: "running", attempts: 3, locked_by: "w-gone" });
    expect(ran).toEqual([]);
  });

  // (1.1.4 set this up as a death at the last attempt, taken again and run; 1.1.5 fails that one as exhausted, so the
  // worker here died with one attempt left and the handler's error on the last one fails the job)
  it("still fails a job whose handler throws on its last allowed attempt", async () => {
    offs.push(
      registerJobHandler("test.stalled_throws", async () => {
        throw new Error("سرویس دوباره پاسخ نداد");
      }),
    );
    const id = await stalled("test.stalled_throws", 2, 3);
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    const j = await job(id);
    expect(j).toMatchObject({ status: "failed", attempts: 3, last_error: "سرویس دوباره پاسخ نداد", locked_until: null, locked_by: null });
    expect(j!.done_at).not.toBeNull();
    expect(warnings.some((w) => w.startsWith("job test.stalled_throws failed"))).toBe(true);
  });

  // the inbound mailbox's poller, a directory sync, a scheduled export: one row that returns `{ again }` for good. Each
  // run that dies keeps the attempt its claim counted, so its attempts grow by one with every death over its life
  it("keeps a self-rescheduling chain alive across more deaths of its workers than its allowed attempts", async () => {
    let runs = 0;
    offs.push(
      registerJobHandler("test.chain", async () => {
        runs++;
        return { again: 60_000 };
      }),
    );
    const id = await enqueue(db, { kind: "test.chain", orgId: org, maxAttempts: 3, dedupeKey: "test.chain" });
    const dueNow = () => db.query(`update sm_jobs set run_at = now() where id = $1 and status = 'queued'`, [id]);
    /** A worker claims the job (attempts + 1, as the claim counts it) and dies; its lock has expired since. */
    const death = () =>
      db.query(`update sm_jobs set status = 'running', attempts = attempts + 1, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [id]);
    for (let life = 1; life <= 4; life++) {
      // healthy runs between the deaths
      for (let i = 0; i < 3; i++) {
        await dueNow();
        await tick(cfg, { budgetMs: 3000, cleanup: false });
      }
      await death();
      const before = runs;
      await tick(cfg, { budgetMs: 3000, cleanup: false });
      // taken again and run: the chain goes on
      expect(runs, `the run after death ${life}`).toBe(before + 1);
      expect((await job(id))?.status, `after death ${life}`).toBe("queued");
    }
    expect(runs).toBe(16);
    expect((await job(id))?.last_error).toBeNull();
    expect(warnings).toEqual([]);
  });
});
