// Attempts count consecutive failures (Kariz 1.1.5, JOBS-1 of the 1.1.4 review). A run that returns normally — done, or
// `{ again }` for later — forgives the deaths and errors before it, so a self-rescheduling chain (the inbound mailbox's
// poller, a directory synchronisation, a scheduled export) is no longer worn down by every worker death over its life:
// in 1.1.4 a death kept the attempt its claim counted for good, and the 1.1.4 candidate's `failExhausted` ended such a
// chain at its third death, however many healthy runs lay between. Only `max_attempts` failures in a row exhaust a job:
// - a worker that died during the last allowed attempt: `failExhausted` fails the job with EXHAUSTED_ERROR, never runs it
//   again, and calls its kind's exhausted hook, which re-arms the chain or settles the kind's own row;
// - a handler that threw at the last allowed attempt: failed with its error, and the same hook (a PermanentJobError is
//   the handler's own decision: no hook).
// Hooks run after the job's update, each in try/catch, in the demo scope the job had; those of several exhausted jobs
// run one after the other while the tick has time — at least one a tick — and the rest wait, running and expired, for
// the next tick (the expired-lock claim never takes a job without an attempt left).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  enqueue,
  EXHAUSTED_ERROR,
  PermanentJobError,
  registerJobExhausted,
  registerJobHandler,
  tick,
  type ExhaustedContext,
  type Job,
} from "@server/jobs";
import { demoScopeOrg } from "@server/db/scope";
import type { JobConfig } from "@server/jobs";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import { JOBS_EDITIONS } from "./web-jobs-editions";

type Row = { status: string; attempts: number; max_attempts: number; last_error: string | null; locked_by: string | null; done_at: string | null };

for (const edition of JOBS_EDITIONS) {
  describe(`attempts count consecutive failures (${edition.name})`, () => {
    let db: Db;
    let close: () => Promise<void>;
    let cfg: JobConfig;
    const warnings: string[] = [];
    const offs: (() => void)[] = [];

    beforeAll(async () => {
      ({ db, close } = await edition.open());
      cfg = { db, log: { ...quietLog, warn: (m: string) => void warnings.push(m) } };
    }, 240_000);
    afterAll(() => close(), 120_000);
    afterEach(async () => {
      while (offs.length) offs.pop()!();
      warnings.length = 0;
      await db.query(`delete from sm_jobs`);
    });

    const row = (id: string) => db.one<Row>(`select status, attempts, max_attempts, last_error, locked_by, done_at from sm_jobs where id = $1`, [id]);
    const dueNow = (id: string) => db.query(`update sm_jobs set run_at = now() - interval '1 second' where id = $1 and status = 'queued'`, [id]);
    /** A worker claims the job (attempts + 1, as the claim counts it) and dies: its lock expired since. */
    const death = (id: string) =>
      db.query(`update sm_jobs set status = 'running', attempts = attempts + 1, locked_by = 'w-dead', locked_until = now() - interval '1 minute', run_at = now() where id = $1`, [id]);
    const run = () => tick(cfg, { budgetMs: 3000, cleanup: false });

    it("a chain survives deaths that are not consecutive: each healthy run forgives the one before it", async () => {
      let runs = 0;
      offs.push(
        registerJobHandler("test.chain", async () => {
          runs++;
          return { again: 60_000 };
        }),
      );
      const id = await enqueue(db, { kind: "test.chain", maxAttempts: 3, dedupeKey: "test.chain" });
      for (let life = 1; life <= 6; life++) {
        await dueNow(id);
        await run();
        expect(await row(id), `healthy run ${life}`).toMatchObject({ status: "queued", attempts: 0 });
        await death(id);
        await run();
        // taken again and run; the run that returned forgave the death (1.1.4 kept it: attempts 1, 2, 3 …)
        expect(await row(id), `after death ${life}`).toMatchObject({ status: "queued", attempts: 0, last_error: null });
      }
      expect(runs).toBe(12);
      expect(warnings).toEqual([]);
    });

    it("a thrown error is forgiven by the next run that returns, and the chain goes on", async () => {
      let n = 0;
      offs.push(
        registerJobHandler("test.flaky", async () => {
          if (++n === 1) throw new Error("سرویس پاسخ نداد");
          return { again: 60_000 };
        }),
      );
      const id = await enqueue(db, { kind: "test.flaky", maxAttempts: 2 });
      await run();
      expect(await row(id)).toMatchObject({ status: "queued", attempts: 1, last_error: "سرویس پاسخ نداد" });
      await dueNow(id);
      await run();
      expect(await row(id)).toMatchObject({ status: "queued", attempts: 0 });
      // a death and an error after it are consecutive failures of their own: the job still has its attempts
      await death(id);
      await run();
      expect(await row(id)).toMatchObject({ status: "queued", attempts: 0 });
    });

    it("max_attempts deaths in a row exhaust the job: failed with the reason, never run again, its hook told once", async () => {
      let runs = 0;
      const told: { job: Job; ectx: ExhaustedContext; demo: string | null }[] = [];
      offs.push(
        registerJobHandler(
          "test.dying",
          async () => {
            runs++;
            return { again: 60_000 };
          },
          { onExhausted: async (job, ectx) => void told.push({ job, ectx, demo: demoScopeOrg() }) },
        ),
      );
      const id = await enqueue(db, { kind: "test.dying", maxAttempts: 3, payload: { channel: "c1" } });
      // three workers in a row claimed it and died (each claim counts an attempt; nothing returned in between)
      await death(id);
      await death(id);
      await death(id);
      await run();
      const j = await row(id);
      expect(j).toMatchObject({ status: "failed", attempts: 3, last_error: EXHAUSTED_ERROR, locked_by: null });
      expect(j!.done_at).not.toBeNull();
      expect(runs).toBe(0);
      expect(told).toHaveLength(1);
      expect(told[0].job).toMatchObject({ id, kind: "test.dying", status: "failed", payload: { channel: "c1" } });
      expect(told[0].ectx).toMatchObject({ cause: "died", error: EXHAUSTED_ERROR });
      expect(told[0].demo).toBeNull();
      expect(warnings.some((w) => w.startsWith("job test.dying failed"))).toBe(true);
      // never taken again
      await run();
      expect(runs).toBe(0);
      expect(told).toHaveLength(1);
    });

    it("keeps the earlier error before the reason, within 2,000 characters", async () => {
      offs.push(registerJobHandler("test.dying_long", async () => undefined, { onExhausted: async () => undefined }));
      const earlier = ("پاسخ سرویس: " + "خ".repeat(2000)).slice(0, 2000);
      const id = await enqueue(db, { kind: "test.dying_long", maxAttempts: 1 });
      await db.query(`update sm_jobs set last_error = $2 where id = $1`, [id, earlier]);
      await death(id);
      await run();
      const j = await row(id);
      expect(warnings).toEqual([expect.stringContaining("job test.dying_long failed")]);
      expect(j!.status).toBe("failed");
      expect(j!.last_error!.length).toBeLessThanOrEqual(2000);
      expect(j!.last_error!.endsWith(` · ${EXHAUSTED_ERROR}`)).toBe(true);
      expect(j!.last_error!.startsWith("پاسخ سرویس: خخخ")).toBe(true);
    });

    it("a handler that throws at its last attempt: failed with its error, and the hook is told the cause", async () => {
      const told: ExhaustedContext[] = [];
      offs.push(
        registerJobHandler(
          "test.throws",
          async () => {
            throw new Error("پایگاه دادهٔ مقصد در دسترس نیست");
          },
          { onExhausted: async (_job, ectx) => void told.push(ectx) },
        ),
      );
      const id = await enqueue(db, { kind: "test.throws", maxAttempts: 2 });
      await run();
      expect(told).toEqual([]);
      await dueNow(id);
      await run();
      expect(await row(id)).toMatchObject({ status: "failed", attempts: 2, last_error: "پایگاه دادهٔ مقصد در دسترس نیست" });
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ cause: "error", error: "پایگاه دادهٔ مقصد در دسترس نیست" });
    });

    it("a PermanentJobError is the handler's own decision: failed at once, no hook", async () => {
      let hooked = 0;
      offs.push(
        registerJobHandler(
          "test.permanent",
          async () => {
            throw new PermanentJobError("ورودی نامعتبر");
          },
          { onExhausted: async () => void hooked++ },
        ),
      );
      const id = await enqueue(db, { kind: "test.permanent", maxAttempts: 5 });
      await run();
      expect(await row(id)).toMatchObject({ status: "failed", attempts: 1, last_error: "ورودی نامعتبر" });
      expect(hooked).toBe(0);
    });

    it("a hook that throws is logged with the job's id; the job stays failed and the next job's hook still runs", async () => {
      const told: string[] = [];
      offs.push(
        registerJobHandler("test.bad_hook", async () => undefined, {
          onExhausted: async (job) => {
            told.push(job.id);
            throw new Error("hook broke");
          },
        }),
      );
      const a = await enqueue(db, { kind: "test.bad_hook", maxAttempts: 1 });
      const b = await enqueue(db, { kind: "test.bad_hook", maxAttempts: 1 });
      await death(a);
      await death(b);
      await tick(cfg, { budgetMs: 5000, cleanup: false });
      expect((await row(a))!.status).toBe("failed");
      expect((await row(b))!.status).toBe("failed");
      expect(told.sort()).toEqual([a, b].sort());
      expect(warnings.filter((w) => w.includes("exhausted hook failed"))).toHaveLength(2);
    });

    it("registerJobExhausted gives a family ('prefix.*') its hook, as handlers are found", async () => {
      const told: string[] = [];
      offs.push(registerJobHandler("test.fam.one", async () => undefined));
      offs.push(registerJobExhausted("test.fam.*", async (job) => void told.push(job.kind)));
      const id = await enqueue(db, { kind: "test.fam.one", maxAttempts: 1 });
      await death(id);
      await run();
      expect(told).toEqual(["test.fam.one"]);
    });

    it("hooked exhausted jobs are failed one at a time while the tick has time, at least one a tick; plain ones all at once", async () => {
      const told: string[] = [];
      offs.push(
        registerJobHandler("test.slow_hook", async () => undefined, {
          onExhausted: async (job) => {
            told.push(job.id);
            await new Promise((r) => setTimeout(r, 300));
          },
        }),
      );
      offs.push(registerJobHandler("test.plain", async () => undefined));
      const hooked = [];
      for (let i = 0; i < 3; i++) hooked.push(await enqueue(db, { kind: "test.slow_hook", maxAttempts: 1 }));
      const plain = [];
      for (let i = 0; i < 5; i++) plain.push(await enqueue(db, { kind: "test.plain", maxAttempts: 1 }));
      for (const id of [...hooked, ...plain]) await death(id);
      // a tick whose budget is gone at once: one hook, every plain job
      await tick(cfg, { budgetMs: 1, cleanup: false });
      expect(told).toHaveLength(1);
      for (const id of plain) expect((await row(id))!.status).toBe("failed");
      const left = await db.query<{ status: string }>(`select status from sm_jobs where kind = 'test.slow_hook' order by status`);
      expect(left.map((r) => r.status)).toEqual(["failed", "running", "running"]);
      // the others wait for the next ticks, never taken and run again by the expired-lock claim
      await tick(cfg, { budgetMs: 5000, cleanup: false });
      expect(told.sort()).toEqual([...hooked].sort());
      expect((await db.query(`select 1 from sm_jobs where status <> 'failed'`)).length).toBe(0);
    });
  });
}

describe("an exhausted demo job's hook runs in the organisation's demo scope (PGlite)", () => {
  let db: Db;
  let org = "";
  const offs: (() => void)[] = [];
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    org = await signupWithOrg(new Client(s.app));
  });
  afterEach(() => {
    while (offs.length) offs.pop()!();
  });

  it("the pack's own job: the hook sees the demo scope; an organisation's job: none", async () => {
    const seen: Record<string, string | null> = {};
    offs.push(registerJobHandler("test.demo_hook", async () => undefined, { onExhausted: async (job) => void (seen[String(job.payload.name)] = demoScopeOrg()) }));
    const demo = await enqueue(db, { kind: "test.demo_hook", orgId: org, maxAttempts: 1, payload: { __demo: true, name: "demo" } });
    await db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_jobs')`, [org, demo]);
    const real = await enqueue(db, { kind: "test.demo_hook", orgId: org, maxAttempts: 1, payload: { name: "real" } });
    await db.query(`update sm_jobs set status = 'running', attempts = 1, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = any($1::uuid[])`, [`{${demo},${real}}`]);
    await tick({ db, log: quietLog }, { budgetMs: 5000, cleanup: false });
    expect(seen).toEqual({ demo: org, real: null });
  });
});
