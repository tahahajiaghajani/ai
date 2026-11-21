// A job whose worker stopped (Kariz 1.1.4, as 1.1.3): the web version's function cut at its time limit, a process that
// died or an outcome that could not be saved leaves the job `running` until its lock (5 minutes) expires. It is then
// taken again and run, whatever its attempts: a worker's death never fails a job by itself — only a handler's error
// counts against `max_attempts`.
// The 1.1.4 candidate failed such a job at its last allowed attempt instead (failExhausted). Its final review found that
// this ended healthy self-rescheduling chains — a run that dies keeps the attempt its claim counted for good, so a chain
// allowed three attempts ended at its third death, however many healthy runs lay between (JOBS-1) — and that it would
// have left the rows of stateful kinds non-terminal (a backup `running`, a demo pack `loading`, an agent run `queued`, an
// export or an import `running`, 27 kinds in all). It comes back in 1.1.5, with an attempt reset on success and per-kind
// exhausted hooks.
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

  it("takes a job whose worker stopped during its last allowed attempt again and runs it", async () => {
    handle("test.stalled");
    const id = await stalled("test.stalled", 3, 3, { lastError: "سرویس پاسخ نداد" });
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    expect(await job(id)).toMatchObject({ status: "done", attempts: 4, locked_until: null, locked_by: null });
    expect(ran).toEqual([id]);
    expect(warnings).toEqual([]);
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

  it("still fails a job whose handler throws on its last allowed attempt: only a handler's error counts", async () => {
    offs.push(
      registerJobHandler("test.stalled_throws", async () => {
        throw new Error("سرویس دوباره پاسخ نداد");
      }),
    );
    const id = await stalled("test.stalled_throws", 3, 3);
    await tick(cfg, { budgetMs: 5000, cleanup: false });
    const j = await job(id);
    expect(j).toMatchObject({ status: "failed", attempts: 4, last_error: "سرویس دوباره پاسخ نداد", locked_until: null, locked_by: null });
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
