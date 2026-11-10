// The job queue (sm_jobs): idempotent enqueue, ticks within a budget, retries with backoff, permanent failures,
// rescheduling, stale locks, record-event delivery that retries only the subscribers that failed, the cloud's cron
// route and the tick after write requests.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { enqueue, registerJobHandler, tick, listJobs, backoffMs, PermanentJobError, type Job } from "@server/jobs";
import { onRecordEvent } from "@server/engine/events";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { ServerConfig } from "@server/context";

describe("job queue", () => {
  let db: Db;
  let cfg: ServerConfig;
  let org = "";
  const offs: (() => void)[] = [];
  afterEach(() => {
    while (offs.length) offs.pop()!();
  });

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    org = await signupWithOrg(new Client(s.app));
    cfg = { mode: "cloud", db, secret: "t", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
  });

  const job = (id: string) => db.one<Job & { locked_until: string | null; run_at: string }>(`select * from sm_jobs where id = $1`, [id]);
  const due = (id: string) => db.query(`update sm_jobs set run_at = now() - interval '1 second' where id = $1`, [id]);

  it("adds a job once per dedupe key while it is queued", async () => {
    const a = await enqueue(db, { kind: "test.once", orgId: org, dedupeKey: "k1", payload: { n: 1 } });
    const b = await enqueue(db, { kind: "test.once", orgId: org, dedupeKey: "k1", payload: { n: 2 } });
    expect(b).toBe(a);
    const c = await enqueue(db, { kind: "test.once", orgId: null, dedupeKey: "k1" });
    expect(c).not.toBe(a);
    const ran: unknown[] = [];
    offs.push(registerJobHandler("test.once", async (j) => void ran.push(j.payload.n ?? null)));
    const r = await tick(cfg, { budgetMs: 5000 });
    expect(r).toMatchObject({ ran: 2, failed: 0, more: false });
    expect(ran.sort()).toEqual([1, null]);
    // done: the key is free again
    expect(await enqueue(db, { kind: "test.once", orgId: org, dedupeKey: "k1" })).not.toBe(a);
    await tick(cfg);
  });

  // the server edition's runner (docs/PERFORMANCE_FA.md): several due jobs claimed per statement and run together,
  // each exactly once
  it("runs due jobs several at a time with concurrency, each once", async () => {
    const seenRuns: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const off = registerJobHandler("test.wide", async (job) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      seenRuns.push(String(job.payload.n));
      inFlight--;
    });
    for (let n = 0; n < 10; n++) await enqueue(db, { kind: "test.wide", orgId: org, payload: { n } });
    const r = await tick(cfg, { budgetMs: 5000, concurrency: 4 });
    off();
    expect(r.ran).toBe(10);
    expect(seenRuns.sort()).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect((await listJobs(db, org, { kind: "test.wide" })).every((j) => j.status === "done")).toBe(true);
  });

  it("keeps the events of one record in order when jobs run together", async () => {
    const order: string[] = [];
    const off = registerJobHandler("record.test_order", async (job) => {
      await new Promise((r) => setTimeout(r, job.payload.step === 1 ? 30 : 1));
      order.push(`${job.payload.id}:${job.payload.step}`);
    });
    for (const [id, step] of [["a", 1], ["b", 1], ["a", 2], ["c", 1], ["a", 3]] as const) {
      await enqueue(db, { kind: "record.test_order", orgId: org, payload: { table: "todo", id, step } });
      await new Promise((r) => setTimeout(r, 2)); // distinct run_at
    }
    await tick(cfg, { budgetMs: 5000, concurrency: 5 });
    off();
    expect(order.filter((x) => x.startsWith("a:"))).toEqual(["a:1", "a:2", "a:3"]);
    expect(order).toHaveLength(5);
  });

  it("retries a failing job with backoff and keeps the last error", async () => {
    let calls = 0;
    offs.push(registerJobHandler("test.flaky", async () => {
      calls++;
      if (calls < 3) throw new Error(`خطای شمارهٔ ${calls}`);
    }));
    const id = await enqueue(db, { kind: "test.flaky", orgId: org });
    await tick(cfg);
    let j = (await job(id))!;
    expect(j).toMatchObject({ status: "queued", attempts: 1, last_error: "خطای شمارهٔ 1" });
    expect(Date.parse(j.run_at)).toBeGreaterThan(Date.now() + 10_000);
    await tick(cfg); // not due yet
    expect(calls).toBe(1);
    await due(id);
    await tick(cfg);
    await due(id);
    await tick(cfg);
    j = (await job(id))!;
    expect(j).toMatchObject({ status: "done", attempts: 3 });
    expect(backoffMs(1)).toBeGreaterThanOrEqual(15_000);
    expect(backoffMs(20)).toBeLessThanOrEqual(3600_000 * 1.2);
  });

  it("gives up after max attempts, or at once on a permanent error", async () => {
    offs.push(registerJobHandler("test.broken", async () => {
      throw new Error("همیشه خراب");
    }));
    offs.push(registerJobHandler("test.permanent", async () => {
      throw new PermanentJobError("درست‌شدنی نیست");
    }));
    const a = await enqueue(db, { kind: "test.broken", orgId: org, maxAttempts: 2 });
    const b = await enqueue(db, { kind: "test.permanent", orgId: org });
    const c = await enqueue(db, { kind: "test.unknown", orgId: org, maxAttempts: 1 });
    await tick(cfg);
    await due(a);
    await tick(cfg);
    expect(await job(a)).toMatchObject({ status: "failed", attempts: 2, last_error: "همیشه خراب" });
    expect(await job(b)).toMatchObject({ status: "failed", attempts: 1, last_error: "درست‌شدنی نیست" });
    expect(await job(c)).toMatchObject({ status: "failed", last_error: 'no handler for job kind "test.unknown"' });
    expect((await listJobs(db, org, { status: "failed" })).map((x) => x.kind).sort()).toEqual(["test.broken", "test.permanent", "test.unknown"]);
  });

  it("runs a job again later without counting an attempt, and saves its progress", async () => {
    let calls = 0;
    offs.push(registerJobHandler("test.steps.*", async (j, jctx) => {
      calls++;
      const step = Number(j.payload.step ?? 0) + 1;
      await jctx.save({ step });
      if (step < 3) return { again: 0 };
    }));
    const id = await enqueue(db, { kind: "test.steps.import", orgId: org });
    for (let i = 0; i < 3; i++) await tick(cfg);
    expect(calls).toBe(3);
    expect(await job(id)).toMatchObject({ status: "done", attempts: 1, payload: { step: 3 } });
  });

  it("takes over a job whose worker died, and never runs two ticks of one process at once", async () => {
    let ran = 0;
    offs.push(registerJobHandler("test.stale", async () => {
      ran++;
    }));
    const id = await enqueue(db, { kind: "test.stale", orgId: org });
    await db.query(`update sm_jobs set status = 'running', locked_until = now() - interval '1 minute', attempts = 1 where id = $1`, [id]);
    const [x, y] = await Promise.all([tick(cfg), tick(cfg)]);
    expect([x.busy, y.busy].filter(Boolean)).toHaveLength(1);
    expect(ran).toBe(1);
    expect(await job(id)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("stops at the budget and reports that more jobs are due", async () => {
    offs.push(registerJobHandler("test.many", async () => undefined));
    for (let i = 0; i < 3; i++) await enqueue(db, { kind: "test.many", orgId: org });
    const r = await tick(cfg, { max: 2 });
    expect(r).toMatchObject({ ran: 2, more: true });
    expect((await tick(cfg)).ran).toBe(1);
  });

  it("delivers record events to every subscriber, retrying only the one that failed", async () => {
    const calls: string[] = [];
    let fail = true;
    offs.push(onRecordEvent("t-a", () => void calls.push("a")));
    offs.push(onRecordEvent("t-b", () => {
      calls.push("b");
      if (fail) throw new Error("b down");
    }));
    offs.push(onRecordEvent("t-c", () => void calls.push("c"), { tables: ["other"] }));
    offs.push(onRecordEvent("t-d", () => void calls.push("d"), { kinds: ["record.updated"] }));
    const id = await enqueue(db, { kind: "record.created", orgId: org, payload: { kind: "record.created", table: "todo", id: "x" } });
    await tick(cfg);
    expect(calls).toEqual(["a", "b"]);
    fail = false;
    await due(id);
    await tick(cfg);
    expect(calls).toEqual(["a", "b", "b"]);
    expect(await job(id)).toMatchObject({ status: "done" });
  });

  // engine.archive runs again by itself; «اجرا اکنون» or a settings save while it runs queues a twin (same dedupe key)
  it("folds a job that runs again into a twin queued while it ran, without failing the tick", async () => {
    let runs = 0;
    offs.push(registerJobHandler("test.twin", async () => {
      if (++runs === 1) await enqueue(db, { kind: "test.twin", orgId: org, dedupeKey: "test.twin", delayMs: 3600_000 });
      return { again: 0 };
    }));
    const first = await enqueue(db, { kind: "test.twin", orgId: org, dedupeKey: "test.twin" });
    try {
      const r = await tick(cfg, { budgetMs: 5000, max: 1 });
      expect(r).toMatchObject({ ran: 1, failed: 0 });
      const jobs = await listJobs(db, org, { kind: "test.twin" });
      const queued = jobs.filter((j) => j.status === "queued");
      expect(queued).toHaveLength(1);
      expect(queued[0].id).not.toBe(first);
      expect(jobs.find((j) => j.id === first)?.status).toBe("done");
      // the twin runs no later than the job would have run again (now), not in an hour
      expect(new Date((await job(queued[0].id))!.run_at).getTime()).toBeLessThan(Date.now() + 60_000);
      expect(runs).toBe(1);
    } finally {
      await db.query(`delete from sm_jobs where kind = 'test.twin'`);
    }
  });

  it("keeps a record's events in order when another job's outcome cannot be saved", async () => {
    const order: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    offs.push(registerJobHandler("record.test_late", async (j) => {
      order.push(`start ${j.payload.step}`);
      if (j.payload.step === 1) {
        // the record's next event arrives while this one runs
        await enqueue(db, { kind: "record.test_late", orgId: org, payload: { table: "todo", id: "late", step: 2 } });
        await gate;
      }
      order.push(`end ${j.payload.step}`);
    }));
    offs.push(registerJobHandler("test.lost", async () => undefined));
    const lost = await enqueue(db, { kind: "test.lost", orgId: org });
    await enqueue(db, { kind: "record.test_late", orgId: org, payload: { table: "todo", id: "late", step: 1 } });
    // the database refuses to record the outcome of `test.lost` (a lost connection)
    const failing = (f: (text: string, params?: unknown[]) => Promise<unknown>) => (text: string, params?: unknown[]) =>
      /^\s*update sm_jobs set status\b/.test(text) && params?.[0] === lost ? Promise.reject(new Error("connection lost")) : f(text, params);
    const flaky = new Proxy(db, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (p === "query" || p === "one") return failing((v as (text: string, params?: unknown[]) => Promise<unknown>).bind(t));
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as Db;
    const fcfg = { ...cfg, db: flaky };
    try {
      const first = tick(fcfg, { budgetMs: 5000, concurrency: 8 }).then(() => "ok", (e) => `rejected: ${e}`);
      for (let i = 0; i < 400 && !order.includes("start 1"); i++) await new Promise((r) => setTimeout(r, 5));
      expect(order).toEqual(["start 1"]);
      await new Promise((r) => setTimeout(r, 30));
      // a second tick of this process while the first still runs the record's first event: it must not start the next
      const second = await tick(fcfg, { budgetMs: 2000, concurrency: 8 });
      expect(second.busy).toBe(true);
      open();
      expect(await first).toBe("ok");
      expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    } finally {
      open();
      await db.query(`delete from sm_jobs where kind in ('test.lost', 'record.test_late')`);
    }
  });
});

describe("job ticks on both runtimes", () => {
  it("cron route needs the secret when one is set", async () => {
    const { app } = await makeServer();
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret";
    try {
      const c = new Client(app);
      await c.get("/cron/tick", 401);
      c.token = "s3cret";
      const r = await c.get("/cron/tick");
      expect(r).toMatchObject({ ok: true, failed: 0 });
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("the web version runs queued jobs after a write request (waitUntil)", async () => {
    const pending: Promise<unknown>[] = [];
    const { app } = await makeServer({ config: { waitUntil: (work) => void pending.push(work()) } });
    const c = new Client(app);
    const org = await signupWithOrg(c);
    const seen: string[] = [];
    const off = onRecordEvent("t-after", (ev) => void seen.push(ev.kind), { tables: ["todo"] });
    try {
      await c.post(`/o/${org}/r/todo`, { short_description: "پس از پاسخ" });
      expect(pending.length).toBe(1);
      await Promise.all(pending);
      expect(seen).toEqual(["record.created"]);
      await c.get(`/o/${org}/r/todo`);
      expect(pending.length).toBe(1); // reads do not tick
    } finally {
      off();
    }
  });
});
