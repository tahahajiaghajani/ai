// The job queue's last words (Kariz 1.1.5 review, jobs-1..4), on PGlite and on a real PostgreSQL when one is configured:
// - a run that returned is a success even when the database fails while its outcome is written: the write is tried
//   again (and, failing every try, at the same process's next tick) — never the handler-failure path, which at a
//   job's last attempt failed it and ran its kind's exhausted hook on a healthy row (a demo pack's load ended
//   «failed» because one QUEUE_TIMEOUT met the statement that requeued it);
// - an exhausted hook is owed until it succeeds: one that failed (a transient error) or was cut is tried again by a
//   later tick, a few times, then given up in the log — a backup no longer stays «running» for good;
// - «لغو» of a queued job in the consoles ends it through the queue, so its kind settles its row as the hook would;
// - «دوباره» on a chain job the queue failed at its last attempt runs its queued next round now instead of answering
//   409 «این مورد تکراری است», and both actions say what they did (`status`).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { EXHAUSTED_ERROR, HOOK_TRIES, PermanentJobError, enqueue, registerJobHandler, tick } from "@server/jobs";
import { createPostgresDb } from "@server/db/postgres";
import { createBackup, deleteBackup } from "@server/modules/admin/backup";
import type { AuthUser, ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg, quietLog, useServerDb } from "./helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";

type Fail = { on: "one" | "query"; match: string; times: number; code: string; message: string };

/** The database, with the next `times` statements containing `match` failing (code, message) — a busy pool's answer. */
function flaky(db: Db, fails: Fail[]): Db {
  return new Proxy(db, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p === "one" || p === "query")
        return async (text: string, params?: unknown[]) => {
          const f = fails.find((x) => x.on === p && x.times > 0 && text.includes(x.match));
          if (f) {
            f.times--;
            throw Object.assign(new Error(f.message), { code: f.code });
          }
          return (v as (a: string, b?: unknown[]) => Promise<unknown>).call(t, text, params);
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as Db;
}

const QUEUE_TIMEOUT = { code: "QUEUE_TIMEOUT", message: "write CONNECTION_QUEUE_TIMEOUT: timed out waiting for a connection" };
/** finish(): a returned `{ again }` (requeued, forgiven), and the other outcomes (done, failed). */
const FINISH_QUEUED = "set status = 'queued', run_at = now() +";
const FINISH_OTHER = "update sm_jobs set status = $2, done_at = now()";

const editions = realPgAvailable() ? ["PGlite", "PostgreSQL"] : ["PGlite"];

for (const edition of editions) {
  describe(`the job queue's outcomes, owed hooks, «لغو» and «دوباره» (${edition})`, () => {
    let pg: RealPg | null = null;
    let db: Db;
    let cfg: ServerConfig;
    let client: Client;
    let org = "";
    let user: AuthUser;
    const warnings: string[] = [];
    const errors: string[] = [];
    const runs: Record<string, number> = {};
    const offs: (() => void)[] = [];

    beforeAll(async () => {
      if (edition === "PostgreSQL") {
        pg = await realPg("jobsout");
        const url = await extraDatabase(pg, `jobsout_${process.pid}`);
        useServerDb(async () => createPostgresDb({ url, ssl: false, max: 6 }));
      }
      const s = await makeServer();
      useServerDb(null);
      db = s.db;
      client = new Client(s.app);
      org = await signupWithOrg(client);
      const u = await db.one<{ id: string; email: string }>(`select id, email from sm_users limit 1`);
      user = { id: u!.id, email: u!.email } as AuthUser;
      cfg = {
        mode: "cloud",
        db,
        secret: "t",
        allowSignup: true,
        platformAdmins: [u!.email],
        origin: "cloud",
        log: { ...quietLog, warn: (m: string, d?: unknown) => void warnings.push(`${m} ${JSON.stringify(d ?? null)}`), error: (m: string, d?: unknown) => void errors.push(`${m} ${JSON.stringify(d ?? null)}`) },
        fetch,
      };
      // test kinds: one returning `{ again }`, one done, one whose hook always throws
      offs.push(registerJobHandler("test.again", async () => ((runs.again = (runs.again ?? 0) + 1), { again: 60_000 })));
      offs.push(registerJobHandler("test.once", async () => void (runs.once = (runs.once ?? 0) + 1)));
      offs.push(registerJobHandler("test.seed", async () => undefined));
      offs.push(
        registerJobHandler("test.brokenhook", async () => undefined, {
          onExhausted: async () => {
            runs.hook = (runs.hook ?? 0) + 1;
            throw new Error("the hook's own bug");
          },
        }),
      );
      offs.push(
        registerJobHandler(
          "test.permanent",
          async () => {
            throw new PermanentJobError("a decision of the handler");
          },
          {
            onExhausted: async () => {
              runs.permanentHook = (runs.permanentHook ?? 0) + 1;
              throw new Error("the database did not answer");
            },
          },
        ),
      );
      // nothing but each case's own jobs runs: the new organisation's seeds and record events are not due
      await db.query(`update sm_jobs set status = 'done', done_at = now() where status in ('queued', 'running')`);
    }, 240_000);
    afterAll(async () => {
      for (const off of offs) off();
      await db?.close().catch(() => undefined);
      await pg?.stop();
    }, 120_000);
    afterEach(async () => {
      warnings.length = 0;
      errors.length = 0;
      for (const k of Object.keys(runs)) delete runs[k];
      await db.query(`delete from sm_jobs where status in ('queued', 'running') or kind like 'test.%' or kind in ('admin.backup', 'admin.sweep', 'demo.load')`);
      await db.query(`delete from sm_backups where org_id = $1`, [org]);
      await db.query(`delete from sm_demo_packs where org_id = $1`, [org]);
    });

    const jobRow = (id: string) =>
      db.one<{ status: string; attempts: number; last_error: string | null; due: boolean }>(`select status, attempts, last_error, run_at <= now() as due from sm_jobs where id = $1`, [id]);
    /** What a worker that stopped during the job's last allowed attempt leaves (claimed, lock expired). */
    async function diedAtLastAttempt(kind: string, payload: Record<string, unknown>, opts: { maxAttempts?: number; dedupeKey?: string } = {}): Promise<string> {
      const id = await enqueue(db, { kind, orgId: org, payload, maxAttempts: opts.maxAttempts ?? 3, dedupeKey: opts.dedupeKey });
      await db.query(`update sm_jobs set status = 'running', attempts = max_attempts, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [id]);
      return id;
    }
    /** A job claimed again at its last allowed attempt: its two earlier runs lost their worker (its lock expired). */
    async function lastAttemptDue(kind: string, payload: Record<string, unknown>, opts: { maxAttempts?: number; dedupeKey?: string } = {}): Promise<string> {
      const id = await enqueue(db, { kind, orgId: org, payload, maxAttempts: opts.maxAttempts ?? 3, dedupeKey: opts.dedupeKey });
      await db.query(`update sm_jobs set status = 'running', attempts = max_attempts - 1, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [id]);
      return id;
    }
    /** The pause an owed hook waits before its next try, gone by. */
    const later = (id: string) => db.query(`update sm_jobs set updated_at = now() - interval '2 hours' where id = $1`, [id]);
    const run = (d: Db = db) => tick({ ...cfg, db: d }, { budgetMs: 15_000, cleanup: false });

    // ----- jobs-1: a returned run's outcome

    it("a load that returned at its last attempt goes on although the first write of its outcome failed (no hook, no «failed»)", async () => {
      await db.query(`insert into sm_demo_packs (org_id, state, size, progress) values ($1, 'loading', 'small', '{}'::jsonb)`, [org]);
      // a module seed still waiting: the load's first step brings it forward and returns { again: 1500 } (a normal return)
      const seed = await enqueue(db, { kind: "test.seed", orgId: org, delayMs: 3600_000 });
      const id = await lastAttemptDue("demo.load", { __demo: true }, { dedupeKey: "demo.load" });
      await tick({ ...cfg, db: flaky(db, [{ on: "one", match: FINISH_QUEUED, times: 1, ...QUEUE_TIMEOUT }]) }, { budgetMs: 15_000, cleanup: false, max: 1 });
      expect((await jobRow(seed))?.due).toBe(true); // the handler ran and returned
      expect(await jobRow(id)).toMatchObject({ status: "queued", attempts: 0 });
      expect(await db.one(`select state, error from sm_demo_packs where org_id = $1`, [org])).toEqual({ state: "loading", error: null });
      expect(warnings.filter((w) => w.includes("exhausted hook"))).toEqual([]);
    });

    it("every try of a returned run's outcome failing keeps its claim, and the same process's next tick writes it", async () => {
      const id = await lastAttemptDue("test.again", {});
      const failing: Fail = { on: "one", match: FINISH_QUEUED, times: 99, ...QUEUE_TIMEOUT };
      const d = flaky(db, [failing]);
      await run(d);
      expect(runs.again).toBe(1);
      // nothing was written: the job is still this worker's, at its last attempt — not failed, no hook
      expect(await jobRow(id)).toMatchObject({ status: "running", attempts: 3 });
      expect(warnings.some((w) => w.includes("its outcome was not saved"))).toBe(true);
      // still failing at the next tick: kept for the one after
      await run(d);
      expect(await jobRow(id)).toMatchObject({ status: "running", attempts: 3 });
      // the database answers again: the process's next tick writes what the run returned (forgiven), before anything
      // could take the job as a worker's death
      failing.times = 0;
      await run(d);
      expect(await jobRow(id)).toMatchObject({ status: "queued", attempts: 0, due: false });
      expect(runs.again).toBe(1); // written, not run again
      expect(warnings.filter((w) => w.includes("exhausted hook"))).toEqual([]);
    });

    it("a done run whose outcome write failed once is done — not queued again to run a second time", async () => {
      const id = await enqueue(db, { kind: "test.once", orgId: org, maxAttempts: 5 });
      await run(flaky(db, [{ on: "one", match: FINISH_OTHER, times: 1, ...QUEUE_TIMEOUT }]));
      expect(runs.once).toBe(1);
      expect(await jobRow(id)).toMatchObject({ status: "done", attempts: 1 });
      await db.query(`update sm_jobs set run_at = now() - interval '1 hour' where id = $1 and status = 'queued'`, [id]);
      await run();
      expect(runs.once).toBe(1);
    });

    // ----- jobs-2: an exhausted hook is owed until it succeeds

    it("a backup's exhausted hook that failed once runs again at a later tick: the backup ends «failed», and a new one can be made", async () => {
      const b = await createBackup(cfg, user, org, "شبانه");
      await db.query(`update sm_backups set status = 'running' where id = $1`, [b.id]);
      const job = await db.one<{ id: string }>(`select id from sm_jobs where kind = 'admin.backup' and payload->>'id' = $1`, [b.id]);
      await db.query(`update sm_jobs set status = 'running', attempts = max_attempts, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [job!.id]);
      const d = flaky(db, [{ on: "query", match: "update sm_backups set status = 'failed'", times: 1, ...QUEUE_TIMEOUT }]);
      await run(d);
      expect(await jobRow(job!.id)).toMatchObject({ status: "failed", last_error: EXHAUSTED_ERROR });
      expect(await db.one(`select status from sm_backups where id = $1`, [b.id])).toEqual({ status: "running" });
      expect(warnings.filter((w) => w.includes("exhausted hook failed"))).toHaveLength(1);
      // not before its pause: the next tick leaves it
      await run();
      expect(await db.one(`select status from sm_backups where id = $1`, [b.id])).toEqual({ status: "running" });
      await later(job!.id);
      await run();
      expect(await db.one(`select status, error from sm_backups where id = $1`, [b.id])).toEqual({ status: "failed", error: EXHAUSTED_ERROR });
      await expect(createBackup(cfg, user, org, "دوباره")).resolves.toMatchObject({ status: "queued" });
      // settled: nothing is owed any more
      await later(job!.id);
      await run();
      expect(warnings.filter((w) => w.includes("exhausted hook failed"))).toHaveLength(1);
    });

    it("a chain whose hook could not queue its next round is re-armed at a later tick", async () => {
      const id = await diedAtLastAttempt("admin.sweep", {}, { dedupeKey: "admin.sweep" });
      await run(flaky(db, [{ on: "one", match: "insert into sm_jobs (id, org_id, kind, payload, run_at, max_attempts, dedupe_key)", times: 1, ...QUEUE_TIMEOUT }]));
      expect(await jobRow(id)).toMatchObject({ status: "failed" });
      const next = () => db.query(`select id from sm_jobs where org_id = $1 and kind = 'admin.sweep' and status = 'queued'`, [org]);
      expect(await next()).toHaveLength(0);
      await later(id);
      await run();
      expect(await next()).toHaveLength(1);
    });

    it("a hook that keeps failing is given up after its last try, in the log as an error; «دوباره» clears what a job owed", async () => {
      const id = await diedAtLastAttempt("test.brokenhook", {});
      await run();
      for (let i = 1; i < HOOK_TRIES; i++) {
        await later(id);
        await run();
      }
      expect(runs.hook).toBe(HOOK_TRIES);
      expect(errors.filter((e) => e.includes("given up"))).toHaveLength(1);
      await later(id);
      await run();
      expect(runs.hook).toBe(HOOK_TRIES);
      // another job owing its hook, revived by «دوباره» before the hook's next try: a revived job owes nothing — here
      // it then ends by its handler's own decision (PermanentJobError, no hook), and no stale debt runs the hook
      const other = await diedAtLastAttempt("test.permanent", {});
      await run();
      expect(runs.permanentHook).toBe(1);
      await client.post(`/o/${org}/admin/jobs/${other}/retry`, {});
      await run();
      expect(await jobRow(other)).toMatchObject({ status: "failed", last_error: "a decision of the handler" });
      await later(other);
      await run();
      expect(runs.permanentHook).toBe(1);
    });

    // ----- jobs-3: «لغو» ends a queued job through its kind's last word

    it("«لغو» of a queued backup job leaves the backup «failed» with the reason, and the next backup can be made", async () => {
      const b = await createBackup(cfg, user, org, "شبانه");
      const job = await db.one<{ id: string }>(`select id from sm_jobs where kind = 'admin.backup' and payload->>'id' = $1`, [b.id]);
      const r = await client.post<{ id: string; status: string }>(`/o/${org}/admin/jobs/${job!.id}/cancel`, {});
      expect(r).toMatchObject({ id: job!.id, status: "failed" });
      expect(await jobRow(job!.id)).toMatchObject({ status: "failed", last_error: "لغو به دست مدیر" });
      expect(await db.one(`select status, error from sm_backups where id = $1`, [b.id])).toEqual({ status: "failed", error: "لغو به دست مدیر" });
      await expect(createBackup(cfg, user, org, "دوباره")).resolves.toMatchObject({ status: "queued" });
    });

    it("a backup an earlier «لغو» left «queued» (no job will make it) blocks no new backup and can be deleted", async () => {
      const a = await createBackup(cfg, user, org, "یک");
      await db.query(`delete from sm_jobs where kind = 'admin.backup' and payload->>'id' = $1`, [a.id]);
      await expect(deleteBackup(cfg, user, a.id)).resolves.toBeUndefined();
      const b = await createBackup(cfg, user, org, "دو");
      await db.query(`update sm_jobs set status = 'failed', last_error = 'لغو به دست مدیر', done_at = now() where kind = 'admin.backup' and payload->>'id' = $1`, [b.id]);
      const c = await createBackup(cfg, user, org, "سه");
      expect(c.status).toBe("queued");
      expect(await db.one(`select status from sm_backups where id = $1`, [b.id])).toEqual({ status: "failed" });
      // one that a job will still make stays «in progress»
      await expect(createBackup(cfg, user, org, "چهار")).rejects.toThrow("در حال ساخت");
      await expect(deleteBackup(cfg, user, c.id)).rejects.toThrow("در حال ساخت");
    });

    // ----- jobs-4: «دوباره» on a chain job whose next round is queued

    it("«دوباره» on a chain job the queue failed at its last attempt runs its queued next round now (no 409)", async () => {
      const id = await diedAtLastAttempt("admin.sweep", {}, { dedupeKey: "admin.sweep" });
      await run();
      expect(await jobRow(id)).toMatchObject({ status: "failed", last_error: EXHAUSTED_ERROR });
      const twin = await db.one<{ id: string; later: boolean }>(`select id, run_at > now() + interval '23 hours' as later from sm_jobs where org_id = $1 and dedupe_key = 'admin.sweep' and status = 'queued'`, [org]);
      expect(twin?.later).toBe(true);
      const r = await client.post<{ id: string; status: string; message?: string }>(`/o/${org}/admin/jobs/${id}/retry`, {});
      expect(r).toMatchObject({ id: twin!.id, status: "queued" });
      expect(r.message).toContain("اکنون");
      expect(await jobRow(twin!.id)).toMatchObject({ status: "queued", due: true });
      // the failed round stays as it ended (its history)
      expect(await jobRow(id)).toMatchObject({ status: "failed" });
    });

    it("«دوباره» on a failed job without a queued twin queues it again and says so", async () => {
      const id = await diedAtLastAttempt("test.once", {}, { dedupeKey: "test.once" });
      await run();
      expect(await jobRow(id)).toMatchObject({ status: "failed" });
      const r = await client.post<{ id: string; status: string }>(`/o/${org}/admin/jobs/${id}/retry`, {});
      expect(r).toMatchObject({ id, status: "queued" });
      await run();
      expect(await jobRow(id)).toMatchObject({ status: "done" });
      expect(runs.once).toBe(1);
    });
  });
}
