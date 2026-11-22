// The demo pack and the organisation's own workflow cases (docs/DEMO_FA.md, design F): demo accounts approve no real
// record. A step of a case of the organisation's own never goes to the pack's people, whatever names them — a role the
// pack's groups carry, a group of the pack, a delegation — and a step left with nobody follows its «ifNobody»; nor do
// the process managers' «ارجاع» and the designer's preview offer them. The pack's own cases keep them. And a process
// of the pack is started by the pack's people only: a real case standing on the pack's process, version and form would
// lose them all at the purge. The purge leaves the organisation's own timer (`process.timer`) queued — the twin demo
// work queued while it ran too — and takes the jobs the pack made for its own rows (FINAL-5). An organisation-wide pass
// whose saved cursor is a row of the pack's (`sla.recalc`) stays and starts again; it is never demo work (FL-2). And
// one of the pack's people who manages an organisation's own case and runs «دوباره پیدا کردن انجام‌دهنده» on it writes
// the organisation's work (1.1.5): the purge leaves the real member the step it gave them. An open task one of the pack's
// people held on an organisation's own case ends with the purge, and its round looks for people again: whoever is found
// gets it; nobody found, the journal says why, the case waits and its managers are told.
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { inDemoScope, isDemoRow } from "@server/db/scope";
import { DEMO_JOB_SQL, enqueue, registerJobHandler } from "@server/jobs";
import { purgeStep, runToEnd } from "@server/modules/demo";
import { DEMO_PEOPLE_REAL_WORK, previewResolve } from "@server/modules/positions";
import { pauseCase, reassignStep, reresolveStep, resumeCase } from "@server/modules/process/api";
import { DEMO_PROCESS_START } from "@server/modules/process/engine";
import { applyPending } from "@server/modules/process/sync";
import { MORE, timerPass, TIMER_JOB } from "@server/modules/process/timers";
import type { ServerConfig } from "@server/context";
import { edge, journal, kase, node, person, publish, start, tasks, users, world, type Published, type World } from "./process-engine-helpers";

let w: World;
let requester: string;
let analyst: string;
let approver: string;
let manager: string;
let packAnalyst: string;
let packRequester: string;
let packGroup: string;
let ROLE: Published;
let GROUP: Published;
let AWAY: Published;

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const values = { u_amount: "5" };

/** One of the pack's people, as the loader adds them: an account marked with the organisation's pack, a member. */
async function packPerson(name: string): Promise<string> {
  const id = await person(w, name);
  await w.o.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, w.o.org]);
  await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [w.o.org, id]);
  return id;
}

/** start → «تأیید امنیت اطلاعات» (the rule given) → end. */
const graph = (step: Record<string, unknown>) => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }),
    node("sec", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), ...step }, "تأیید امنیت اطلاعات"),
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "sec"), edge("sec", "ok", "approved"), edge("sec", "no", "rejected")],
});
const openAt = async (caseId: string) => (await tasks(w, caseId)).filter((t) => t.step_key === "sec" && t.status === "open");

beforeAll(async () => {
  w = await world();
  requester = await person(w, "درخواست‌دهندهٔ واقعی");
  analyst = await person(w, "تحلیل‌گر امنیت واقعی");
  approver = await person(w, "تأییدکنندهٔ واقعی");
  manager = await person(w, "مسئول گردش‌کار");
  await w.o.owner.put(`${w.P}/access/members/${analyst}`, { roles: ["security_analyst"] });
  packAnalyst = await packPerson("تحلیل‌گر نمایشی");
  packRequester = await packPerson("درخواست‌دهندهٔ نمایشی");
  // the pack's security group, written by demo work as the load writes it: its member holds the role through it
  packGroup = await inDemoScope(w.o.org, () =>
    w.sys.write(async (tx) => {
      const g = await createIn(tx, w.sys, "group", { name: "عملیات امنیت (نمایشی)", roles: ["security_analyst"] }, { trusted: true });
      await createIn(tx, w.sys, "group_member", { group_id: g.id, user_id: packAnalyst, kind: "member" }, { trusted: true });
      return String(g.id);
    }),
  );
  // a real approver who is away, with the pack's analyst as their out-of-office delegate
  await w.o.db.query(`update sm_member_profiles set out_of_office = true, delegate_id = $2 where org_id = $1 and user_id = $3`, [w.o.org, packAnalyst, approver]);
  ROLE = await publish(w, graph({ assignees: [{ kind: "role", role: "security_analyst" }] }), { managers: [manager] });
  GROUP = await publish(w, graph({ assignees: [{ kind: "group", group: packGroup }], ifNobody: "skip" }));
  AWAY = await publish(w, graph(users(approver)));
}, 300_000);

describe("a case of the organisation's own never goes to the demo pack's people", () => {
  it("a role the pack's groups carry: the organisation's own holder only", async () => {
    const id = (await start(w, requester, ROLE, { values })).case!;
    await w.k.drain();
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([analyst]);
  }, 120_000);

  it("a group of the pack finds nobody: the step follows its «ifNobody» (skip) and the case goes on", async () => {
    const id = (await start(w, requester, GROUP, { values })).case!;
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "sec")).toEqual([]);
    expect(await kase(w, id)).toMatchObject({ state: "completed" });
    expect((await journal(w, id)).join(" | ")).toContain("تأیید امنیت اطلاعات");
  }, 120_000);

  it("a delegate of the pack does not stand in: the away approver keeps the step", async () => {
    const id = (await start(w, requester, AWAY, { values })).case!;
    await w.k.drain();
    expect((await openAt(id)).map((t) => ({ to: t.assigned_to, for: t.delegated_from }))).toEqual([{ to: approver, for: null }]);
  }, 120_000);

  it("the process managers' «ارجاع» refuses the pack's people", async () => {
    const id = (await start(w, requester, ROLE, { values })).case!;
    await w.k.drain();
    await expect(reassignStep(await w.o.ctxOf(manager), id, { step: "sec", to: [packAnalyst] })).rejects.toThrow(DEMO_PEOPLE_REAL_WORK);
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([analyst]);
  }, 120_000);

  it("the designer's preview finds what the step would: real work for a real requester, the pack's for the pack's", async () => {
    const owner = await w.o.ctxOf(w.o.ownerId);
    const step = { assignees: [{ kind: "role", role: "security_analyst" }] };
    expect((await previewResolve(owner, { step, action: "approve", requester })).people.map((p) => p.user)).toEqual([analyst]);
    expect((await previewResolve(owner, { step, action: "approve", requester: packRequester })).people.map((p) => p.user).sort()).toEqual([analyst, packAnalyst].sort());
  }, 120_000);

  it("a case of the pack's keeps them: its step goes to the pack's analyst too", async () => {
    const id = (await inDemoScope(w.o.org, () => start(w, packRequester, ROLE, { values }))).case!;
    await w.k.drain();
    expect(await w.o.db.one(`select 1 as x from sm_demo_rows where org_id = $1 and row_id = $2`, [w.o.org, id])).toBeTruthy();
    expect((await openAt(id)).map((t) => t.assigned_to).sort()).toEqual([analyst, packAnalyst].sort());
  }, 120_000);
});

describe("a process of the demo pack is started by the pack's people only", () => {
  it("a real member's start is refused, with nothing written; the pack's person starts it", async () => {
    const pack = await publish(w, graph(users(analyst)));
    await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_processes')`, [w.o.org, pack.process]);
    const cases = async () => (await w.o.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and process_id = $2`, [w.o.org, pack.process]))!.n;
    await expect(start(w, requester, pack, { values })).rejects.toThrow(DEMO_PROCESS_START);
    expect(await cases()).toBe(0);
    const id = (await inDemoScope(w.o.org, () => start(w, packRequester, pack, { values }))).case!;
    await w.k.drain();
    expect(await cases()).toBe(1);
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([analyst]);
  }, 120_000);
});

describe("the demo pack's purge keeps the organisation's timer (FINAL-5)", () => {
  it("the timer's twin that demo work queued while it ran stays queued, once, for the real cases; the pack's own jobs leave", async () => {
    const org = w.o.org;
    const db = w.o.db;
    const timers = () => db.query<{ id: string; status: string }>(`select id, status from sm_jobs where org_id = $1 and kind = $2 order by created_at, id`, [org, TIMER_JOB]);
    // a real case waits on a three-day «پایان مهلت»: the opening of its step queued the organisation's timer (J1)
    const decider = await person(w, "تأییدکنندهٔ مهلت‌دار");
    const timed = graph({ ...users(decider), due: { amount: 3, unit: "day" }, business: false });
    const DUE = await publish(w, { nodes: [...timed.nodes, node("late", "end", { outcome: "canceled" })], edges: [...timed.edges, edge("sec", "late", "timeout")] });
    const real = (await start(w, requester, DUE, { values })).case!;
    await w.k.drain();
    const j1 = (await timers()).filter((j) => j.status === "queued");
    expect(j1).toHaveLength(1);
    expect(await isDemoRow(db, org, j1[0].id)).toBe(false);
    // then the pack is loaded (as the loader leaves it, without the bank): a case of the pack's own, which the pack's
    // process manager pauses
    await db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
      [org, w.o.ownerId],
    );
    const packManager = await packPerson("مسئول گردش‌کار نمایشی");
    const PACK = await inDemoScope(org, () => publish(w, graph(users(packAnalyst)), { managers: [packManager] }));
    const demoCase = (await inDemoScope(org, () => start(w, packRequester, PACK, { values }))).case!;
    await w.k.drain();
    await inDemoScope(org, async () => pauseCase(await w.o.ctxOf(packManager), demoCase));
    // while J1 runs, the pack's manager resumes the demo case (a request of the pack's people: demo work), which wakes
    // the timer: J1 is not queued, so a twin (J2) is queued in the demo transaction — and recorded with the pack's rows
    let during: (() => Promise<unknown>) | null = () => inDemoScope(org, async () => resumeCase(await w.o.ctxOf(packManager), demoCase));
    registerJobHandler(TIMER_JOB, async (job, jctx) => {
      // the organisation's timer as installProcessTimers registers it, with that request arriving while it runs
      const now = during;
      during = null;
      if (now) await now();
      if (!job.org_id) return;
      const cfg = jctx.cfg as ServerConfig;
      const next = await timerPass(cfg, job.org_id, (id) => applyPending(cfg, job.org_id!, id, null), Date.now(), jctx.deadline - 500);
      if (next === MORE) return { again: 0 };
      if (next !== null) return { again: Math.max(1000, next - Date.now()) };
    });
    await db.query(`update sm_jobs set run_at = now() where id = $1`, [j1[0].id]);
    await w.k.drain();
    expect(during).toBeNull();
    // J1 ended, found the twin queued and folded into it: J2 is the organisation's only timer now
    const folded = await timers();
    expect(folded.find((j) => j.id === j1[0].id)?.status).toBe("done");
    const twin = folded.filter((j) => j.status === "queued");
    expect(twin).toHaveLength(1);
    expect(await isDemoRow(db, org, twin[0].id)).toBe(true);
    // jobs the pack made for its own rows — one about its case, one of its own — and an organisation-wide one demo work
    // queued that has run
    registerJobHandler("test.final5", async () => undefined);
    const aboutCase = await inDemoScope(org, () => enqueue(db, { kind: "test.final5", orgId: org, payload: { case: demoCase }, delayMs: 3_600_000 }));
    const packOwn = await inDemoScope(org, () => enqueue(db, { kind: "test.final5", orgId: org, payload: { __demo: true }, delayMs: 3_600_000 }));
    const ran = await inDemoScope(org, () => enqueue(db, { kind: "test.final5", orgId: org, payload: {} }));
    await w.k.drain();
    expect((await db.one<{ status: string }>(`select status from sm_jobs where id = $1`, [ran]))?.status).toBe("done");

    // ----- the purge
    await db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
    await w.o.owner.post(`${w.P}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(w.o.cfg, org, "purge", { budgetMs: 300_000 });
    expect(await db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    expect(await db.one(`select 1 as x from sm_process_cases where id = $1`, [demoCase])).toBeNull();
    // the organisation's timer is there, queued exactly once; the pack's jobs and the demo work's ended one went
    expect((await timers()).filter((j) => j.status === "queued").map((j) => j.id)).toEqual([twin[0].id]);
    for (const id of [aboutCase, packOwn, ran]) expect(await db.one(`select 1 as x from sm_jobs where id = $1`, [id]), id).toBeNull();
    // and it serves the real case: three days on, its «پایان مهلت» fires and the case goes on by that port
    await db.query(`update sm_process_tasks set opened_at = opened_at - interval '4 days', due_at = due_at - interval '4 days' where case_id = $1`, [real]);
    await db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = $2 and status = 'queued'`, [org, TIMER_JOB]);
    await w.k.drain();
    expect((await tasks(w, real)).filter((t) => t.step_key === "sec").map((t) => t.status)).toEqual(["not_needed"]);
    expect((await journal(w, real)).some((b) => b.startsWith("مهلت «تأیید امنیت اطلاعات» به پایان رسید"))).toBe(true);
  }, 600_000);
});

describe("the demo pack's purge starts the organisation's own passes again where their cursor is a demo row (FL-2)", () => {
  it("a real «sla.recalc» saved at a demo row stays queued, once, never demo work, and walks the real rows from the start; jobs about the pack's rows leave", async () => {
    const org = w.o.org;
    const db = w.o.db;
    const job = (id: string) => db.one<{ status: string; payload: Record<string, unknown> }>(`select status, payload from sm_jobs where id = $1`, [id]);
    const later = (id: string) => db.query(`update sm_jobs set run_at = now() + interval '1 hour' where id = $1`, [id]);
    // the pack is loaded (as the loader leaves it, without the bank), with a row of its own among the rows the
    // organisation's passes walk (ids are time-ordered: the pack's rows sit between real ones)
    await db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
      [org, w.o.ownerId],
    );
    const demoRow = String((await inDemoScope(org, () => w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "گروه نمایشی FL-2" }, { trusted: true })))).id);
    expect(await isDemoRow(db, org, demoRow)).toBe(true);
    // an administrator edited a holiday: the organisation's SLA recalculation (not demo work) did a slice of a large
    // organisation and saved where it left off — on the pack's row
    const recalc = await enqueue(db, { kind: "sla.recalc", orgId: org, dedupeKey: "sla.recalc" });
    await db.query(`update sm_jobs set payload = jsonb_build_object('after', $2::text) where id = $1`, [recalc, demoRow]);
    await later(recalc);
    expect(await isDemoRow(db, org, recalc)).toBe(false);
    // an organisation-wide pass demo work happened to queue, saved on the same row; a pass with nothing saved; one whose
    // payload names the organisation (as the notification clean-up's does); one that has ended on the pack's row; and a
    // job about the pack's row
    const pass = (kind: string, payload: Record<string, unknown>) => enqueue(db, { kind, orgId: org, dedupeKey: kind, payload, delayMs: 3_600_000 });
    const demoPass = await inDemoScope(org, () => pass("test.fl2_pass", { after: demoRow }));
    expect(await isDemoRow(db, org, demoPass)).toBe(true);
    const plain = await pass("test.fl2_plain", {});
    const ofOrg = await pass("test.fl2_org", { org });
    const ended = await pass("test.fl2_ended", { after: demoRow });
    await db.query(`update sm_jobs set status = 'done', done_at = now() where id = $1`, [ended]);
    const aboutRow = await enqueue(db, { kind: "test.fl2_row", orgId: org, payload: { id: demoRow }, delayMs: 3_600_000 });

    // ----- the purge: what it finds first is never the organisation's pass (the job runner would run it as demo work)
    await db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
    await w.o.owner.post(`${w.P}/demo/purge`, { confirm: "حذف کامل" });
    const phase = async () => (await db.one<{ phase: string | null }>(`select progress->>'purge' as phase from sm_demo_packs where org_id = $1`, [org]))?.phase ?? "expand";
    while ((await phase()) === "expand") await purgeStep(w.o.cfg, org);
    expect(await isDemoRow(db, org, recalc)).toBe(false);
    expect(await db.one<{ demo: boolean }>(`select ${DEMO_JOB_SQL} as demo from sm_jobs where id = $1`, [recalc])).toEqual({ demo: false });
    expect(await isDemoRow(db, org, ended)).toBe(true);
    expect(await isDemoRow(db, org, aboutRow)).toBe(true);
    await runToEnd(w.o.cfg, org, "purge", { budgetMs: 300_000 });
    expect(await db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    expect(await db.one(`select 1 as x from sm_groups where id = $1`, [demoRow])).toBeNull();
    // the organisation's passes stay, queued once each, and start again: they name no demo row
    expect(await job(recalc)).toEqual({ status: "queued", payload: {} });
    expect((await db.query<{ id: string }>(`select id from sm_jobs where org_id = $1 and kind = 'sla.recalc' and status = 'queued'`, [org])).map((r) => r.id)).toEqual([recalc]);
    expect(await job(demoPass)).toEqual({ status: "queued", payload: {} });
    // the others keep their payloads; the ended pass and the job about the pack's row went
    expect(await job(plain)).toEqual({ status: "queued", payload: {} });
    expect(await job(ofOrg)).toEqual({ status: "queued", payload: { org } });
    expect(await job(ended)).toBeNull();
    expect(await job(aboutRow)).toBeNull();
    // and the recalculation walks the organisation's timers from the start
    await db.query(`update sm_jobs set run_at = now() where id = $1`, [recalc]);
    await w.k.drain();
    expect((await job(recalc))?.status).toBe("done");
  }, 600_000);
});

describe("one of the pack's people manages an organisation's own case (1.1.5)", () => {
  it("«دوباره پیدا کردن انجام‌دهنده» by them writes the organisation's work, which the purge leaves: the real member keeps the step", async () => {
    const org = w.o.org;
    const db = w.o.db;
    // the pack is loaded (as the loader leaves it, without the bank), with one of its people a manager of a real process
    await db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
      [org, w.o.ownerId],
    );
    const packManager = await packPerson("مسئول نمایشیِ گردش‌کار واقعی");
    // the step's one real member is not active yet: the organisation's own case waits for nobody
    const later = await person(w, "کارشناس واقعیِ بازگشته");
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, later]);
    const REAL = await publish(w, graph({ ...users(later), ifNobody: "wait" }), { managers: [packManager] });
    const id = (await start(w, requester, REAL, { values })).case!;
    await w.k.drain();
    expect(await openAt(id)).toEqual([]);
    expect(await isDemoRow(db, org, id)).toBe(false);
    // back at work (straight in the database: no re-resolution is queued), and the pack's manager asks for it — a request
    // of the pack's people runs in the demo scope (http/hono.ts)
    await db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [org, later]);
    const r = await inDemoScope(org, async () => reresolveStep(await w.o.ctxOf(packManager), id, { step: "sec" }));
    expect(r.people.map((p) => p.id)).toEqual([later]);
    const open = await openAt(id);
    expect(open.map((t) => t.assigned_to)).toEqual([later]);
    // the organisation's own work: neither the new task nor the journal entry is one of the pack's rows
    expect(await isDemoRow(db, org, open[0].id)).toBe(false);
    const entry = await db.one<{ id: string }>(`select id::text as id from sm_journal where table_key = 'process_case' and record_id = $1 and data ->> 'reresolved' = 'true' order by created_at desc limit 1`, [id]);
    expect(entry).toBeTruthy();
    expect(await isDemoRow(db, org, entry!.id)).toBe(false);

    // ----- the purge takes the pack's people, never the work they gave the organisation's case
    await db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
    await w.o.owner.post(`${w.P}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(w.o.cfg, org, "purge", { budgetMs: 300_000 });
    expect(await db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([later]);
    expect(await kase(w, id)).toMatchObject({ state: "active" });
  }, 600_000);
});

describe("the purge ends an open task one of the pack's people held on an organisation's own case (1.1.5)", () => {
  it("its round looks for people again: the real member found gets it; nobody found is journaled, the case waits and its managers are told", async () => {
    const org = w.o.org;
    const db = w.o.db;
    await db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
      [org, w.o.ownerId],
    );
    const packHolder = await packPerson("کارشناس نمایشیِ پروندهٔ واقعی");
    const back = await person(w, "کارشناس واقعیِ همان مرحله");
    const away = await person(w, "کارشناس واقعیِ غایب");
    const AGAIN = await publish(w, graph({ ...users(back), ifNobody: "wait" }), { managers: [manager] });
    const NOBODY = await publish(w, graph({ ...users(away), ifNobody: "wait" }), { managers: [manager] });
    const again = (await start(w, requester, AGAIN, { values })).case!;
    const nobody = (await start(w, requester, NOBODY, { values })).case!;
    await w.k.drain();
    // each real step's task is in the hands of the pack's person (FINAL-1 never gives it one: an account the pack took
    // over, a task from before it) — straight in the database; and the second step's member is away by the purge
    for (const id of [again, nobody]) await db.query(`update sm_process_tasks set assigned_to = $2 where case_id = $1 and step_key = 'sec' and status = 'open'`, [id, packHolder]);
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, away]);

    await db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
    await w.o.owner.post(`${w.P}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(w.o.cfg, org, "purge", { budgetMs: 300_000 });
    expect(await db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    // the pack person's tasks ended
    for (const id of [again, nobody]) expect((await tasks(w, id)).filter((t) => t.step_key === "sec" && t.status === "not_needed").length).toBe(1);
    // the real member found again has the step, and the journal says why (before, the step had nobody and said nothing)
    expect((await openAt(again)).map((t) => t.assigned_to)).toEqual([back]);
    expect(await kase(w, again)).toMatchObject({ state: "active" });
    expect((await journal(w, again)).some((l) => l.includes("حذف داده‌های نمایشی") && l.includes("سپرده شد"))).toBe(true);
    // nobody found: the journal says so, the case waits, and the managers' notice is on its way
    expect(await openAt(nobody)).toEqual([]);
    expect(await kase(w, nobody)).toMatchObject({ state: "waiting" });
    expect((await journal(w, nobody)).some((l) => l.includes("حذف داده‌های نمایشی") && l.includes("کسی پیدا نشد"))).toBe(true);
    const opened = await db.one(`select 1 as x from sm_jobs where org_id = $1 and kind = 'record.process_step_opened' and payload ->> 'id' = $2 and payload -> 'data' ->> 'status' = 'nobody' and (payload -> 'data' ->> 'reresolved')::boolean`, [org, nobody]);
    expect(opened).toBeTruthy();
  }, 600_000);
});
