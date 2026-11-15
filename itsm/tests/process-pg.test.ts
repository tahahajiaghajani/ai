// F4b on a real PostgreSQL (design F §3.6.4–3.6.5, §7.1): every writer of a case takes the case's row lock first, so
//   · a timer races a submit: the timer's automatic decision holds the lock (settled, not committed) while the
//     approver's submission waits; it then finds the round settled and comes back late — one resume, one next step;
//   · the push subscriber races an online submit: the pushed submission of one person of a pool is being applied
//     while another submits online; the online one comes back late — one resume, no duplicate task rows;
//   · the §3.7 example runs with linked Windows apps with the authority on PostgreSQL (tests/process-replica-scenario.ts).
// Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/process-pg.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import { createPgliteDb } from "@server/db/pglite";
import type { Db, Tx } from "@server/db";
import { createIn } from "@server/engine";
import { applySubmission, submitTask } from "@server/modules/process/engine";
import { applyPendingIn } from "@server/modules/process/sync";
import { roundTimersIn, timerPass } from "@server/modules/process/timers";
import type { ServerConfig } from "@server/context";
import type { ProcessGraph } from "@shared/process";
import { useServerDb } from "./helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";
import { edge, kase, node, openTask, person, publish, start, tasks, users, world, type World } from "./process-engine-helpers";
import { replicaScenario } from "./process-replica-scenario";

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

async function usePg(name: string) {
  pg = await realPg(name);
  useServerDb(async (mode) => {
    // a Windows app keeps its own PGlite; the authority is on PostgreSQL
    if (mode === "desktop") return createPgliteDb({ desktop: true });
    const db = createPostgresDb({ url: await extraDatabase(pg, `${name}_${process.pid}_${++seq}`), ssl: false, max: 6 });
    pools.push(db);
    return db;
  });
}

async function stopPg() {
  useServerDb(null);
  await Promise.all(pools.splice(0).map((db) => Promise.race([db.close().catch(() => undefined), sleep(15_000)])));
  await pg?.stop();
}

describe.skipIf(!realPgAvailable())("workflow races on a real PostgreSQL (F4b)", () => {
  let w: World;
  const P: Record<string, string> = {};

  const graph = (approve: Record<string, unknown>, pool: string[]): ProcessGraph => ({
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
      node("a", "form_step", { action: "approve", form: w.forms.review, rights: { default: "read", fields: {} }, ...users(P.a1), ...approve }, "تأیید"),
      node("pay", "form_step", { action: "fill", form: w.forms.review, rights: { default: "read", fields: { u_finance_note: "edit" } }, ...users(...pool) }, "پرداخت"),
      node("ok", "end"),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "pay", "approved"), edge("a", "no", "rejected"), edge("pay", "ok")],
  });

  const pendingStep = async (user: string, task_id: string, more: Record<string, unknown>) =>
    String((await w.sys.write((tx) => createIn(tx, w.sys, "process_submission", { kind: "step", task_id, values: {}, submitted_by: user, submitted_at: new Date().toISOString(), ...more }, { trusted: true }))).id);

  const resumes = async () => (await w.o.db.query(`select id from sm_jobs where kind = 'flows.resume' and status = 'queued'`)).length;

  beforeAll(async () => {
    await usePg("process_f4b");
    w = await world();
    for (const [k, name] of [["r", "درخواست‌دهنده"], ["a1", "تأییدکننده"], ["x1", "امور مالی ۱"], ["x2", "امور مالی ۲"]] as const) P[k] = await person(w, name);
  }, 300_000);

  afterEach(() => {
    for (const release of gates.splice(0)) release();
  });

  afterAll(stopPg, 120_000);

  it("a timer races a submit: the automatic decision wins, the submission is late — one resume, the next step opened once", async () => {
    const proc = await publish(w, graph({ business: false, escalate: [{ after: { amount: 1, unit: "hour" }, action: "auto", outcome: "rejected" }] }, [P.x1]));
    const id = (await start(w, P.r, proc, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    const task = await openTask(w, id, "a", P.a1);
    await w.o.db.query(`update sm_process_tasks set opened_at = opened_at - interval '2 hours' where id = $1`, [task]);
    const sub = await pendingStep(P.a1, task, { outcome: "approved" });
    const before = await resumes();
    const timer = hold(w.o.db, (tx) => roundTimersIn(tx, w.sys, { cal: null }, id, "a", 1));
    await timer.ready;
    const submit = w.o.db.tx((tx) => applySubmission(tx, w.sys, sub));
    submit.catch(() => undefined);
    await queued(w.o.db, submit);
    timer.release();
    expect(await timer.done).toBeNull();
    expect(await submit).toMatchObject({ result: "late" });
    expect((await resumes()) - before).toBe(1);
    expect((await tasks(w, id)).filter((t) => t.step_key === "a").map((t) => t.status)).toEqual(["not_needed"]);
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "rejected", outcome: "rejected" });
    expect((await tasks(w, id)).filter((t) => t.step_key === "pay")).toHaveLength(0);
  }, 120_000);

  it("a timer pass locks only the rounds with something due: a busy case whose round waits does not hold it up (F4b-5)", async () => {
    const proc = await publish(w, graph({ business: false, remind_every: { amount: 1, unit: "day" } }, [P.x1]));
    const quiet = (await start(w, P.r, proc, { values: { u_amount: "200" } })).case!;
    const due = (await start(w, P.r, proc, { values: { u_amount: "201" } })).case!;
    await w.k.drain();
    await w.o.db.query(`update sm_process_tasks set opened_at = opened_at - interval '25 hours' where case_id = $1 and step_key = 'a'`, [due]);
    // someone holds the quiet case's row lock (a person's submit in progress)
    const busy = hold(w.o.db, (tx) => tx.query(`select id from sm_process_cases where id = $1 for update`, [quiet]));
    await busy.ready;
    const pass = timerPass(w.sys.cfg as ServerConfig, w.o.org, async () => undefined);
    pass.catch(() => undefined);
    const first = await Promise.race([pass.then(() => "done"), sleep(8_000).then(() => "waited")]);
    busy.release();
    await busy.done;
    await pass;
    expect(first).toBe("done");
    const reminded = (c: string) => w.o.db.one<{ at: string | null }>(`select reminded_at as at from sm_process_tasks where case_id = $1 and step_key = 'a'`, [c]);
    expect((await reminded(due))!.at).not.toBeNull();
    expect((await reminded(quiet))!.at).toBeNull();
  }, 120_000);

  it("the push subscriber races an online submit: one of the pool applied, the other late — one resume, no duplicate tasks", async () => {
    const proc = await publish(w, graph({}, [P.x1, P.x2]));
    const id = (await start(w, P.r, proc, { values: { u_amount: "200" } })).case!;
    await w.k.drain();
    await submitTask(await w.o.ctxOf(P.a1), await openTask(w, id, "a", P.a1), { outcome: "approved" });
    await w.k.drain();
    const t1 = await openTask(w, id, "pay", P.x1);
    const t2 = await openTask(w, id, "pay", P.x2);
    const pushed = await pendingStep(P.x1, t1, { values: { u_finance_note: "از برنامهٔ ویندوز" } });
    const before = await resumes();
    const subscriber = hold(w.o.db, (tx) => applyPendingIn(tx, w.sys, pushed, Date.now()));
    await subscriber.ready;
    const online = submitTask(await w.o.ctxOf(P.x2), t2, { values: { u_finance_note: "برخط" } });
    online.catch(() => undefined);
    await queued(w.o.db, online);
    subscriber.release();
    expect(await subscriber.done).toBe("applied");
    expect(await online).toMatchObject({ result: "late" });
    expect((await resumes()) - before).toBe(1);
    const round = (await tasks(w, id)).filter((t) => t.step_key === "pay");
    expect(round.map((t) => `${t.assigned_to === P.x1 ? "x1" : "x2"}:${t.status}`).sort()).toEqual(["x1:done", "x2:not_needed"]);
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "completed", data: { u_finance_note: "از برنامهٔ ویندوز" } });
    expect(await tasks(w, id)).toHaveLength(round.length + 2);
  }, 120_000);
});

describe.skipIf(!realPgAvailable())("linked Windows apps with the authority on PostgreSQL (F4b acceptance)", () => {
  beforeAll(() => usePg("process_f4b_replica"), 300_000);
  afterAll(stopPg, 120_000);
  replicaScenario("the §3.7 example with linked Windows apps (PostgreSQL)");
});
