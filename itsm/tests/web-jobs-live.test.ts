// A running job keeps its claim while its handler works, and only the worker that holds a claim writes the job's outcome
// (Kariz 1.1.5, JOBS-2 of the 1.1.4 review). In 1.1.4 a claim locked a job for 5 minutes and nothing renewed it, and
// finish() matched the row by id alone: on the server edition another worker's tick («اجرای اکنون», a new leader) took a
// job the leader was still running — ran it a second time, or failed it at its last attempt — and the leader's finish
// then overwrote the row. Now:
// - the lock is renewed every HEARTBEAT_MS (well inside LOCK_MS) while the handler works, for at most HEARTBEAT_MAX_MS,
//   so a hung handler loses its claim at last; jctx.save / saveIn renew it too;
// - every statement of finish() requires status 'running' and locked_by = this worker: a claim that was lost (taken by
//   another worker, failed as exhausted, removed by the demo purge) writes nothing, and the loss is logged; save and
//   saveIn write nothing then either, and stop the handler;
// - the Windows app (one process per database) takes the jobs a process that ended left behind at once on its next
//   start (releaseStaleClaims), instead of waiting for their renewed locks to expire.
// Lock, heartbeat and maximum are shortened here through TickOptions.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enqueue, EXHAUSTED_ERROR, registerJobHandler, releaseStaleClaims, tick, type JobConfig, type JobContext } from "@server/jobs";
import type { Db } from "@server/db";
import { quietLog } from "./helpers";
import { JOBS_EDITIONS, otherProcess } from "./web-jobs-editions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every gate of a test: opened after it, so a failed assertion never leaves a tick waiting (and the next tests busy). */
const openers: (() => void)[] = [];
/** The ticks a test started: awaited after it. */
const pending: Promise<unknown>[] = [];

/** A handler that tells when it started and waits for `open()`; it counts its runs. */
function gated() {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  openers.push(open);
  let started!: (jctx: JobContext) => void;
  const running = new Promise<JobContext>((r) => (started = r));
  let calls = 0;
  const fn = async (_job: unknown, jctx: JobContext) => {
    calls++;
    if (calls === 1) {
      started(jctx);
      await gate;
    }
  };
  return { fn, open, running, calls: () => calls };
}

for (const edition of JOBS_EDITIONS) {
  describe(`a running job keeps its claim, and only its worker writes its outcome (${edition.name})`, () => {
    let db: Db;
    let close: () => Promise<void>;
    let cfg: JobConfig;
    let other: JobConfig;
    const warnings: string[] = [];
    const offs: (() => void)[] = [];
    const fast = { lockMs: 1500, heartbeatMs: 250, heartbeatMaxMs: 60_000, cleanup: false } as const;

    beforeAll(async () => {
      ({ db, close } = await edition.open());
      const log = { ...quietLog, warn: (m: string) => void warnings.push(m) };
      cfg = { db, log };
      other = { db: otherProcess(db), log };
    }, 240_000);
    afterAll(() => close(), 120_000);
    afterEach(async () => {
      while (openers.length) openers.pop()!();
      await Promise.race([Promise.allSettled(pending.splice(0)), sleep(20_000)]);
      while (offs.length) offs.pop()!();
      warnings.length = 0;
      await db.query(`delete from sm_jobs`);
    });
    /** A tick of the leader, awaited after the test whatever happens. */
    const lead = (opts: Parameters<typeof tick>[1]) => {
      const p = tick(cfg, opts);
      pending.push(p);
      return p;
    };

    const row = (id: string) =>
      db.one<{ status: string; attempts: number; locked_by: string | null; live: boolean; last_error: string | null; payload: Record<string, unknown> }>(
        `select status, attempts, locked_by, locked_until > now() as live, last_error, payload from sm_jobs where id = $1`,
        [id],
      );
    const expireLock = (id: string) => db.query(`update sm_jobs set locked_until = now() - interval '1 second' where id = $1`, [id]);

    it("the heartbeat renews an expired lock while the handler works: another process neither fails nor runs the job", async () => {
      for (const maxAttempts of [1, 2]) {
        const g = gated();
        offs.push(registerJobHandler(`test.long${maxAttempts}`, g.fn));
        const id = await enqueue(db, { kind: `test.long${maxAttempts}`, maxAttempts });
        const leader = lead({ ...fast, budgetMs: 30_000, worker: "leader" });
        await g.running;
        // its lock ran out (in production: 5 minutes of a legitimately long job)
        await expireLock(id);
        await sleep(fast.heartbeatMs * 3);
        expect(await row(id), "renewed").toMatchObject({ status: "running", locked_by: "leader", live: true });
        // another process's tick («اجرای اکنون» on another worker, a new leader) finds nothing to take
        const r = await tick(other, { ...fast, budgetMs: 1500, worker: "other" });
        expect(r.ran + r.failed).toBe(0);
        expect(await row(id)).toMatchObject({ status: "running", locked_by: "leader", attempts: 1 });
        g.open();
        await leader;
        expect(await row(id)).toMatchObject({ status: "done", attempts: 1, last_error: null, locked_by: null });
        expect(g.calls()).toBe(1);
      }
      expect(warnings).toEqual([]);
    });

    it("a lost claim writes nothing: the outcome belongs to whoever holds the job now", async () => {
      const g = gated();
      offs.push(registerJobHandler("test.lost", g.fn));
      const id = await enqueue(db, { kind: "test.lost", maxAttempts: 3 });
      const leader = lead({ ...fast, budgetMs: 30_000, worker: "leader" });
      await g.running;
      // another worker took it meanwhile (its lock had expired: a hung leader past the heartbeat's maximum)
      await db.query(`update sm_jobs set locked_by = 'other', attempts = attempts + 1 where id = $1`, [id]);
      g.open();
      await leader;
      expect(await row(id)).toMatchObject({ status: "running", locked_by: "other", attempts: 2 });
      expect(warnings.some((w) => w.startsWith("job test.lost: its claim was lost"))).toBe(true);
    });

    it("a lost claim of a failing job writes neither its error nor its retry", async () => {
      let started!: () => void;
      const running = new Promise<void>((r) => (started = r));
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      openers.push(() => open());
      offs.push(
        registerJobHandler("test.lost_err", async () => {
          started();
          await gate;
          throw new Error("خطای پس از دست رفتن");
        }),
      );
      const id = await enqueue(db, { kind: "test.lost_err", maxAttempts: 3 });
      const leader = lead({ ...fast, budgetMs: 30_000, worker: "leader" });
      await running;
      await db.query(`update sm_jobs set status = 'failed', last_error = $2, locked_by = null, done_at = now() where id = $1`, [id, EXHAUSTED_ERROR]);
      open();
      await leader;
      expect(await row(id)).toMatchObject({ status: "failed", last_error: EXHAUSTED_ERROR });
    });

    it("a lost claim of a job with a queued twin neither folds into the twin nor ends", async () => {
      const g = gated();
      offs.push(
        registerJobHandler("test.lost_twin", async (job, jctx) => {
          await g.fn(job, jctx);
          return { again: 60_000 };
        }),
      );
      const id = await enqueue(db, { kind: "test.lost_twin", maxAttempts: 3, dedupeKey: "twin" });
      const leader = lead({ ...fast, budgetMs: 30_000, worker: "leader" });
      await g.running;
      const twin = await enqueue(db, { kind: "test.lost_twin", maxAttempts: 3, dedupeKey: "twin", delayMs: 3_600_000 });
      expect(twin).not.toBe(id);
      await db.query(`update sm_jobs set locked_by = 'other' where id = $1`, [id]);
      g.open();
      await leader;
      expect(await row(id)).toMatchObject({ status: "running", locked_by: "other" });
      const t = await db.one<{ status: string; later: boolean }>(`select status, run_at > now() + interval '50 minutes' as later from sm_jobs where id = $1`, [twin]);
      expect(t).toEqual({ status: "queued", later: true });
    });

    it("jctx.save renews the lock; once the claim is lost it writes nothing and stops the handler", async () => {
      let reached = 0;
      const first = gated();
      const second = gated();
      offs.push(
        registerJobHandler("test.saves", async (job, jctx) => {
          await first.fn(job, jctx);
          await jctx.save({ step: 1 });
          reached = 1;
          // the claim is lost before the next save
          await second.fn(job, jctx);
          await jctx.save({ step: 2 });
          reached = 2;
        }),
      );
      // no heartbeat: only save renews
      const id = await enqueue(db, { kind: "test.saves", maxAttempts: 3 });
      const leader = lead({ ...fast, heartbeatMs: 0, budgetMs: 30_000, worker: "leader" });
      await first.running;
      await expireLock(id);
      first.open();
      await second.running;
      expect(reached).toBe(1);
      expect(await row(id)).toMatchObject({ status: "running", locked_by: "leader", live: true, payload: { step: 1 } });
      await db.query(`update sm_jobs set locked_by = 'other' where id = $1`, [id]);
      second.open();
      await leader;
      expect(reached).toBe(1);
      expect(await row(id)).toMatchObject({ status: "running", locked_by: "other", payload: { step: 1 } });
      expect(warnings.some((w) => w.startsWith("job test.saves: its claim was lost"))).toBe(true);
    });

    it("jctx.saveIn renews the lock inside the handler's transaction, and rolls it back once the claim is lost", async () => {
      let kept: Awaited<ReturnType<typeof row>> = null;
      let second: unknown = null;
      offs.push(
        registerJobHandler("test.saves_in", async (job, jctx) => {
          await expireLock(job.id);
          await jctx.db.tx((tx) => jctx.saveIn(tx, { done: true }));
          kept = await row(job.id);
          await db.query(`update sm_jobs set locked_by = 'other' where id = $1`, [job.id]);
          try {
            await jctx.db.tx(async (tx) => {
              await tx.query(`insert into sm_kv (key, value) values ('test.saves_in', '"x"'::jsonb)`);
              await jctx.saveIn(tx, { done: false });
            });
          } catch (e) {
            second = e;
            throw e;
          }
        }),
      );
      const id = await enqueue(db, { kind: "test.saves_in", maxAttempts: 3 });
      await tick(cfg, { ...fast, heartbeatMs: 0, budgetMs: 10_000, worker: "leader" });
      expect(kept).toMatchObject({ live: true, payload: { done: true } });
      expect(String((second as Error | null)?.message ?? "")).toContain("claim");
      expect(await row(id)).toMatchObject({ status: "running", locked_by: "other", payload: { done: true } });
      // the transaction that recorded work after the loss rolled back with it
      expect(await db.one(`select 1 from sm_kv where key = 'test.saves_in'`)).toBeNull();
    });

    it("the heartbeat stops after its maximum: a hung handler loses its claim and another tick takes the job", async () => {
      const g = gated();
      offs.push(registerJobHandler("test.hung", g.fn));
      const id = await enqueue(db, { kind: "test.hung", maxAttempts: 3 });
      const leader = lead({ lockMs: 600, heartbeatMs: 150, heartbeatMaxMs: 900, cleanup: false, budgetMs: 30_000, worker: "leader" });
      await g.running;
      await sleep(600);
      expect((await row(id))!.live).toBe(true);
      // past the maximum and one more lock
      await sleep(1500);
      expect(await row(id)).toMatchObject({ status: "running", locked_by: "leader", live: false });
      const r = await tick(other, { lockMs: 60_000, heartbeatMs: 0, cleanup: false, budgetMs: 3000, worker: "other" });
      expect(r.ran).toBe(1);
      expect(g.calls()).toBe(2);
      expect(await row(id)).toMatchObject({ status: "done", attempts: 2 });
      g.open();
      await leader;
      // the hung worker's late finish wrote nothing over the other's outcome
      expect(await row(id)).toMatchObject({ status: "done", attempts: 2 });
      expect(warnings.some((w) => w.startsWith("job test.hung: its claim was lost"))).toBe(true);
    });

    it("the Windows app's start takes the jobs its last process left running at once, the exhausted ones failed", async () => {
      let ran = 0;
      offs.push(registerJobHandler("test.left", async () => void ran++));
      const a = await enqueue(db, { kind: "test.left", maxAttempts: 3 });
      const b = await enqueue(db, { kind: "test.left", maxAttempts: 1 });
      // the process ended abruptly (a shutdown, a crash) while its heartbeat kept their locks a few minutes ahead
      await db.query(`update sm_jobs set status = 'running', attempts = 1, locked_by = 'w-old', locked_until = now() + interval '4 minutes' where id = any($1::uuid[])`, [`{${a},${b}}`]);
      expect((await tick(cfg, { budgetMs: 2000, cleanup: false })).ran).toBe(0);
      expect(await releaseStaleClaims(db)).toBe(2);
      await tick(cfg, { budgetMs: 5000, cleanup: false });
      expect(await row(a)).toMatchObject({ status: "done", attempts: 2 });
      expect(await row(b)).toMatchObject({ status: "failed", last_error: EXHAUSTED_ERROR });
      expect(ran).toBe(1);
    });

    if (edition.name === "PostgreSQL") {
      it("a heartbeat never waits behind the handler's own transaction that holds the job's row (saveIn)", async () => {
        let waiting = -1;
        offs.push(
          registerJobHandler("test.tx_hold", async (_job, jctx) => {
            await jctx.db.tx(async (tx) => {
              await jctx.saveIn(tx, { held: true });
              // the row stays locked by this transaction across several beats
              await sleep(fast.heartbeatMs * 4);
              const w = await db.one<{ n: number }>(
                `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
              );
              waiting = w?.n ?? -1;
            });
          }),
        );
        const id = await enqueue(db, { kind: "test.tx_hold", maxAttempts: 3 });
        await tick(cfg, { ...fast, budgetMs: 10_000, worker: "leader" });
        expect(waiting).toBe(0);
        expect(await row(id)).toMatchObject({ status: "done", payload: { held: true } });
      });
    }
  });
}

describe("the Windows app's start (wiring)", () => {
  it("releases the claims its last process left before its job timer starts", () => {
    const src = readFileSync(join(__dirname, "..", "src", "desktop", "server.ts"), "utf8");
    const release = src.indexOf("await releaseStaleClaims(db)");
    expect(release).toBeGreaterThan(0);
    expect(release).toBeLessThan(src.indexOf("const jobTimer = setInterval("));
  });
});
