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
