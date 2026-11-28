// The web version's job queue from its own traffic (Kariz 1.1.4, src/server/app.ts). Vercel has no timer between
// requests, and without the per-minute heartbeat the only ticks were the daily cron and the tick after a write under
// /o/:org — so a new organisation's 28 seeds (due 10 minutes after POST /api/orgs, which never ticked) and record events
// waited for days. Now, once the answer is ready:
// - any request, at most once a minute per instance, ticks for 8 s when a job is due;
// - a write that queued jobs anywhere in the API ticks for 4 s when one of them (or another job) is due.
// The probe that tells whether a job is due runs after the answer, in the work handed to `waitUntil`: a busy pool, where
// it waits for a connection, holds no answer back (the release candidate's probe ran before the answer, up to 2 s more
// on every write that queued jobs: DB-2/JOBS-4 of its review), and it gives up after 2 s without a tick.
// The Windows app (its own timer) and the server edition (its scheduler leader) get no traffic tick.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import {
  enqueue,
  lastTrafficTick,
  registerJobHandler,
  resetTrafficTick,
  trafficClock,
  trafficTickDue,
  TRAFFIC_TICK_EVERY_MS,
  type TrafficClock,
} from "@server/jobs";
import { registerOrgSeed } from "@server/modules/orgs/service";
import { createPgliteDb } from "@server/db/pglite";
import { makeServer, Client, signupWithOrg, useServerDb } from "./helpers";
import type { Db, Queryable } from "@server/db";
import type { ServerEditionBridge } from "@server/context";

/** The probe's statement (queueHasDue) and a tick's claim (its first statement each round). */
const PROBE = /locked_until < now\(\)\)\) as due/;
const CLAIM = /^\s*update sm_jobs set status = 'running', attempts = attempts \+ 1/;
/** Ticks that ran (their claims) and a delay for the probe's statement alone: a pool whose connections are all busy. */
const seen = { claims: 0, probeDelayMs: 0, waiting: new Set<Promise<unknown>>() };
function instrumented(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "query" || prop === "one") {
        return (text: string, params?: unknown[]) => {
          if (CLAIM.test(text)) seen.claims++;
          const run = () => (target as Queryable)[prop](text, params);
          if (!seen.probeDelayMs || !PROBE.test(text)) return run();
          const late = new Promise((r) => setTimeout(r, seen.probeDelayMs)).then(run);
          seen.waiting.add(late);
          void late.finally(() => seen.waiting.delete(late)).catch(() => undefined);
          return late;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
beforeAll(() => useServerDb(async (mode) => instrumented(await createPgliteDb({ desktop: mode === "desktop" }))));
afterAll(() => useServerDb(null));

/** Milliseconds `f` took. */
async function took(f: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await f();
  return performance.now() - t0;
}

const serverBridge: ServerEditionBridge = {
  health: async () => ({}),
  info: () => ({ air_gapped: true, public_url: "https://kariz.test.local", directory_path: "" }),
  allow: async () => ({ allow: [] }),
};

/** A server whose `waitUntil` records (and starts) the work it is given, as Next.js `after` would run it. */
async function world(opts: { mode?: "cloud" | "desktop"; server?: boolean } = {}) {
  const pending: Promise<unknown>[] = [];
  const { app, db } = await makeServer({
    mode: opts.mode,
    config: { waitUntil: (work) => void pending.push(work()), ...(opts.server ? { server: serverBridge } : {}) },
  });
  return { app, db, pending, c: new Client(app) };
}

const ran: string[] = [];
const offs: (() => void)[] = [];
beforeAll(() => {
  offs.push(registerJobHandler("test.traffic", async (j) => void ran.push(j.id)));
});
beforeEach(() => {
  resetTrafficTick();
  ran.length = 0;
});
afterEach(() => resetTrafficTick());
afterAll(() => {
  while (offs.length) offs.pop()!();
});

const status = (db: Db, id: string) => db.one<{ status: string }>(`select status from sm_jobs where id = $1`, [id]).then((r) => r?.status);
/** The work handed to waitUntil has ended: no tick ran in it (no claim) when nothing was due. */
async function settled(pending: Promise<unknown>[]): Promise<number> {
  const claims = seen.claims;
  await Promise.all(pending);
  return seen.claims - claims;
}
/** The record event a todo's creation queued. */
const created = (db: Db, id: string) =>
  db.one<{ status: string }>(`select status from sm_jobs where kind = 'record.created' and payload->>'id' = $1`, [id]).then((r) => r?.status);

describe("the traffic tick of the web version", () => {
  let w: Awaited<ReturnType<typeof world>>;
  let org = "";
  beforeAll(async () => {
    w = await world();
    const claims = seen.claims;
    org = await signupWithOrg(w.c);
    // signing up and making the organisation queue nothing due (the seeds wait 10 minutes): no tick ran after them
    await Promise.all(w.pending);
    expect(seen.claims - claims).toBe(0);
  });
  // each test starts with no job of its own left by another (a failed one leaves its job queued)
  beforeEach(async () => {
    w.pending.length = 0;
    await w.db.query(`delete from sm_jobs where kind = 'test.traffic'`);
  });

  it("(a, b) a read runs a due job after its answer, and the next read inside the minute asks for no tick", async () => {
    const id = await enqueue(w.db, { kind: "test.traffic", orgId: org });
    await w.c.get(`/o/${org}`);
    expect(w.pending).toHaveLength(1);
    await Promise.all(w.pending);
    expect(await status(w.db, id)).toBe("done");
    expect(ran).toEqual([id]);
    // another due job: the gate, not the probe, keeps the next read from asking within the minute
    const next = await enqueue(w.db, { kind: "test.traffic", orgId: org });
    await w.c.get(`/o/${org}`);
    await w.c.get(`/o/${org}/members`);
    expect(w.pending).toHaveLength(1);
    expect(await status(w.db, next)).toBe("queued");
    await w.db.query(`delete from sm_jobs where id = $1`, [next]);
  });

  it("(d) with nothing due it runs no tick, and the gate is stamped", async () => {
    expect(trafficTickDue(trafficClock(), lastTrafficTick())).toBe(true);
    await w.c.get(`/o/${org}`);
    expect(trafficTickDue(trafficClock(), lastTrafficTick())).toBe(false);
    expect(await settled(w.pending)).toBe(0);
    // a job due now waits for the next minute's look (or a write that queues work): nothing more is handed to waitUntil
    const asked = w.pending.length;
    const id = await enqueue(w.db, { kind: "test.traffic", orgId: org });
    await w.c.get(`/o/${org}`);
    expect(w.pending).toHaveLength(asked);
    expect(await status(w.db, id)).toBe("queued");
    await w.db.query(`delete from sm_jobs where id = $1`, [id]);
  });

  it("(g) a request outside /o (GET /api/meta) runs a due job too", async () => {
    const id = await enqueue(w.db, { kind: "test.traffic", orgId: null });
    await w.c.get("/meta");
    expect(w.pending).toHaveLength(1);
    await Promise.all(w.pending);
    expect(await status(w.db, id)).toBe("done");
  });

  it("the cron route is left to tick by itself", async () => {
    const id = await enqueue(w.db, { kind: "test.traffic", orgId: null });
    const r = await w.c.get("/cron/tick");
    expect(r).toMatchObject({ ok: true, ran: 1 });
    expect(w.pending).toHaveLength(0);
    expect(await status(w.db, id)).toBe("done");
  });

  it("(f) POST /api/orgs runs a seed due at once through the after-write tick; delayed seeds alone ask for none", async () => {
    let seeded: string | null = null;
    const off = registerOrgSeed(async (tx, orgId) => {
      seeded = await enqueue(tx, { kind: "test.traffic", orgId });
    });
    try {
      // a read first stamps the gate (nothing due: no tick): what ticks after the write is the write's own rule
      await w.c.get("/meta");
      expect(await settled(w.pending)).toBe(0);
      const asked = w.pending.length;
      await w.c.post("/orgs", { name: "سازمان با پیش‌فرض فوری" });
      expect(w.pending).toHaveLength(asked + 1);
      expect(await settled(w.pending)).toBeGreaterThan(0);
      expect(seeded).not.toBeNull();
      expect(await status(w.db, seeded!)).toBe("done");
    } finally {
      off();
    }
    w.pending.length = 0;
    resetTrafficTick();
    await w.c.get("/meta");
    expect(await settled(w.pending)).toBe(0);
    await w.c.post("/orgs", { name: "سازمان با پیش‌فرض‌های دیرتر" });
    expect(await settled(w.pending)).toBe(0);
  });

  it("a write that queued a due job ticks once, and stamps the gate", async () => {
    await w.c.post(`/o/${org}/r/todo`, { short_description: "پس از پاسخ" });
    expect(w.pending).toHaveLength(1);
    await Promise.all(w.pending);
    expect(trafficTickDue(trafficClock(), lastTrafficTick())).toBe(false);
    await w.c.get(`/o/${org}/r/todo`);
    expect(w.pending).toHaveLength(1);
  });

  describe("the probe holds no answer back while it waits for a connection (a busy pool)", () => {
    afterEach(async () => {
      seen.probeDelayMs = 0;
      await Promise.all([...seen.waiting]);
    });

    it("a write that queued a due job is answered at once, and its tick runs after the answer", async () => {
      seen.probeDelayMs = 1_500;
      let row: { row: { id: string } } | null = null;
      const ms = await took(async () => {
        row = await w.c.post(`/o/${org}/r/todo`, { short_description: "پاسخ پیش از پرسش صف" });
      });
      // the release candidate answered after the probe: 1.5 s here, up to 2 s on a busy pool
      expect(ms).toBeLessThan(1_000);
      expect(await created(w.db, row!.row.id)).toBe("queued");
      expect(w.pending).toHaveLength(1);
      await Promise.all(w.pending);
      expect(await created(w.db, row!.row.id)).toBe("done");
    });

    it("a read at the minute's gate too", async () => {
      seen.probeDelayMs = 1_500;
      const id = await enqueue(w.db, { kind: "test.traffic", orgId: org });
      expect(await took(() => w.c.get(`/o/${org}`))).toBeLessThan(1_000);
      expect(w.pending).toHaveLength(1);
      await Promise.all(w.pending);
      expect(await status(w.db, id)).toBe("done");
    });

    it("a probe that gets no answer in 2 s gives up after the answer: no tick, and the work ends", async () => {
      seen.probeDelayMs = 3_000;
      let row: { row: { id: string } } | null = null;
      const ms = await took(async () => {
        row = await w.c.post(`/o/${org}/r/todo`, { short_description: "صف کند" });
      });
      expect(ms).toBeLessThan(1_000);
      const claims = seen.claims;
      expect(await took(() => Promise.all(w.pending))).toBeLessThan(2_800);
      expect(seen.claims).toBe(claims);
      expect(await created(w.db, row!.row.id)).toBe("queued");
    });
  });
});

describe("(e) no traffic tick on the Windows app or the server edition", () => {
  it("the Windows app (its own timer runs the queue)", async () => {
    const d = await world({ mode: "desktop" });
    const id = await enqueue(d.db, { kind: "test.traffic", orgId: null });
    await d.c.get("/meta");
    expect(d.pending).toHaveLength(0);
    expect(await status(d.db, id)).toBe("queued");
  });

  it("the server edition (its scheduler leader runs the queue; a write that queued jobs wakes it without a probe)", async () => {
    const s = await world({ server: true });
    const id = await enqueue(s.db, { kind: "test.traffic", orgId: null });
    await s.c.get("/meta");
    expect(s.pending).toHaveLength(0);
    expect(await status(s.db, id)).toBe("queued");
    await s.db.query(`delete from sm_jobs where id = $1`, [id]);
    // the organisation's seeds are not due, yet the write wakes the leader (its waitUntil is the wake-up)
    await signupWithOrg(s.c);
    expect(s.pending).toHaveLength(1);
    await Promise.all(s.pending);
  });
});

describe("(c) trafficTickDue: the larger gap of the wall and the monotonic clocks counts", () => {
  const last: TrafficClock = { wall: 1_800_000_000_000, mono: 5_000 };
  const after = (wall: number, mono: number): TrafficClock => ({ wall: last.wall + wall, mono: last.mono + mono });

  it("is due 61 s later on both clocks, not 59 s later", () => {
    expect(trafficTickDue(after(61_000, 61_000), last)).toBe(true);
    expect(trafficTickDue(after(59_000, 59_000), last)).toBe(false);
    expect(TRAFFIC_TICK_EVERY_MS).toBe(60_000);
  });

  it("a wall clock stepped back is still gated by the monotonic clock", () => {
    expect(trafficTickDue(after(-3_600_000, 30_000), last)).toBe(false);
    expect(trafficTickDue(after(-3_600_000, 61_000), last)).toBe(true);
  });

  it("a wall clock that moved on while the monotonic one stood still (a paused instance) is due", () => {
    expect(trafficTickDue(after(3_600_000, 1_000), last)).toBe(true);
  });

  it("is due before the first look", () => {
    resetTrafficTick();
    expect(trafficTickDue(trafficClock(), lastTrafficTick())).toBe(true);
  });
});
