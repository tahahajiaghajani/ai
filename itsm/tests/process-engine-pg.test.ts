// F4a — workflow submissions side by side on a real PostgreSQL (design F §3.6.4–3.6.5): every apply locks the
// submission's row, then the case's, so
//   · two approvers deciding at once (rule any): the first settles the round, the second finds its task «دیگر لازم
//     نیست» and comes back late — one decision applied, one resume, the next step opened once;
//   · rule all: the second approval, waiting behind the first, sees it and settles the round;
//   · a submission offered twice at once (the push subscriber and the hourly re-check) is applied once.
// The test holds the first apply's transaction open (applied, not committed) while the second runs, then checks the
// state a serial order gives. Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/process-engine-pg.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import type { Db, Tx } from "@server/db";
import { createIn } from "@server/engine";
import { applySubmission, type ApplyResult } from "@server/modules/process/engine";
import type { ProcessGraph } from "@shared/process";
import { useServerDb } from "./helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";
import { edge, journal, kase, node, openTask, person, publish, start, tasks, users, world, type World } from "./process-engine-helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gates: (() => void)[] = [];

/** Hold a transaction open after `work` (its locks and uncommitted rows with it) until `release()`. */
function hold<T>(db: Db, work: (tx: Tx) => Promise<T>) {
  let inside!: () => void;
  let open!: () => void;
  let out!: T;
  const ready = new Promise<void>((r) => (inside = r));
  const gate = new Promise<void>((r) => (open = r));
  gates.push(open);
  const done = db.tx(async (tx) => {
    out = await work(tx);
    inside();
    await gate;
  }).then(() => out);
  done.catch(() => inside());
  return { ready, release: open, done };
}

/** Wait until a session of this database waits for a lock, the racer settled, or a few seconds passed. */
async function queued(db: Db, settled: Promise<unknown>, ms = 4000): Promise<void> {
  let done = false;
  settled.then(() => (done = true), () => (done = true));
  const until = Date.now() + ms;
  while (!done && Date.now() < until) {
    const w = await db.one<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
    if ((w?.n ?? 0) >= 1) return;
    await sleep(25);
  }
}

let pg: RealPg;
let seq = 0;
const pools: Db[] = [];

describe.skipIf(!realPgAvailable())("workflow submissions side by side (real PostgreSQL)", () => {
  let w: World;
  const P: Record<string, string> = {};

  /** start → approve (two approvers, `quorum`) → fill → end */
  const graph = (quorum: "any" | "all"): ProcessGraph => ({
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
      node("a", "form_step", { action: "approve", form: w.forms.review, rights: { default: "read", fields: {} }, quorum, ...users(P.a1, P.a2) }, "تأیید"),
      node("pay", "form_step", { action: "fill", form: w.forms.review, rights: { default: "read", fields: { u_finance_note: "edit" } }, ...users(P.f) }, "پرداخت"),
      node("ok", "end"),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "pay", "approved"), edge("a", "no", "rejected"), edge("pay", "ok")],
  });

  /** A case waiting at «تأیید», and a pending approval of each approver. */
  async function twoApprovals(quorum: "any" | "all") {
    const id = (await start(w, P.r, await publish(w, graph(quorum)), { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    const sub = async (user: string) => {
      const task_id = await openTask(w, id, "a", user);
      const row = { kind: "step", task_id, outcome: "approved", values: {}, submitted_by: user, submitted_at: new Date().toISOString() };
      return String((await w.sys.write((tx) => createIn(tx, w.sys, "process_submission", row, { trusted: true }))).id);
    };
    return { id, s1: await sub(P.a1), s2: await sub(P.a2) };
  }

  /** Apply `first` and hold it open, apply `second` meanwhile, then let the first commit. */
  async function race(first: string, second: string): Promise<[ApplyResult, ApplyResult]> {
    const one = hold(w.o.db, (tx) => applySubmission(tx, w.sys, first));
    await one.ready;
    const two = w.o.db.tx((tx) => applySubmission(tx, w.sys, second));
    two.catch(() => undefined);
    await queued(w.o.db, two);
    one.release();
    return [await one.done, await two];
  }

  beforeAll(async () => {
    pg = await realPg("process");
    useServerDb(async () => {
      const url = await extraDatabase(pg, `process_${process.pid}_${++seq}`);
      const db = createPostgresDb({ url, ssl: false, max: 6 });
      pools.push(db);
      return db;
    });
    w = await world();
    for (const [k, name] of [["r", "درخواست‌دهنده"], ["a1", "تأییدکنندهٔ یکم"], ["a2", "تأییدکنندهٔ دوم"], ["f", "امور مالی"]] as const) P[k] = await person(w, name);
  }, 300_000);

  afterEach(() => {
    for (const release of gates.splice(0)) release();
  });

  afterAll(async () => {
    useServerDb(null);
    await Promise.all(pools.splice(0).map((db) => Promise.race([db.close().catch(() => undefined), sleep(15_000)])));
    await pg?.stop();
  }, 120_000);

  it("rule any: two approvers at once — one decision applied, the other late, one resume, the next step opened once", async () => {
    const { id, s1, s2 } = await twoApprovals("any");
    const [a, b] = await race(s1, s2);
    expect(a).toMatchObject({ result: "applied", settled: "approved" });
    expect(b).toMatchObject({ result: "late" });
    const round = (await tasks(w, id)).filter((t) => t.step_key === "a");
    expect(round.map((t) => `${t.assigned_to === P.a1 ? "a1" : "a2"}:${t.status}`).sort()).toEqual(["a1:done", "a2:not_needed"]);
    expect(await w.o.db.query(`select id from sm_jobs where kind = 'flows.resume' and status = 'queued'`)).toHaveLength(1);
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "pay").map((t) => t.assigned_to)).toEqual([P.f]);
    expect((await journal(w, id)).filter((b) => b.includes("«تأیید» را تأیید کرد"))).toHaveLength(1);
    expect((await kase(w, id)).open_rounds).toEqual({ pay: 1 });
  }, 120_000);

  it("rule all: the second approval waits behind the first, sees it and settles the round once", async () => {
    const { id, s1, s2 } = await twoApprovals("all");
    const [a, b] = await race(s1, s2);
    expect(a).toMatchObject({ result: "applied", settled: null });
    expect(b).toMatchObject({ result: "applied", settled: "approved" });
    expect((await tasks(w, id)).filter((t) => t.step_key === "a").map((t) => t.status)).toEqual(["done", "done"]);
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "pay")).toHaveLength(1);
    expect((await kase(w, id)).progress.a).toMatchObject({ status: "done", outcome: "approved" });
  }, 120_000);

  it("a submission offered twice at once is applied once", async () => {
    const { id, s1 } = await twoApprovals("any");
    const [a, b] = await race(s1, s1);
    expect(a).toMatchObject({ result: "applied", settled: "approved" });
    expect(b).toMatchObject({ result: "applied" });
    expect((await tasks(w, id)).filter((t) => t.step_key === "a" && t.status === "done")).toHaveLength(1);
    expect((await journal(w, id)).filter((x) => x.includes("«تأیید» را تأیید کرد"))).toHaveLength(1);
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "pay")).toHaveLength(1);
  }, 120_000);
});
