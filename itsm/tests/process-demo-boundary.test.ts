// The demo pack and the organisation's own workflow cases (docs/DEMO_FA.md, design F): demo accounts approve no real
// record. A step of a case of the organisation's own never goes to the pack's people, whatever names them — a role the
// pack's groups carry, a group of the pack, a delegation — and a step left with nobody follows its «ifNobody»; nor do
// the process managers' «ارجاع» and the designer's preview offer them. The pack's own cases keep them. And a process
// of the pack is started by the pack's people only: a real case standing on the pack's process, version and form would
// lose them all at the purge. The purge leaves the organisation's own timer (`process.timer`) queued — the twin demo
// work queued while it ran too — and takes the jobs the pack made for its own rows (FINAL-5). An organisation-wide pass
// whose saved cursor is a row of the pack's (`sla.recalc`) stays and starts again; it is never demo work (FL-2).
// The boundary both ways (1.1.5): one of the pack's people who manages an organisation's own case is refused every
// manager action there («ارجاع», pause, resume, cancel, «ادامه از», «دوباره پیدا کردن انجام‌دهنده»), as a decision of a
// step they still hold or stand in for is — the case page offers them none, nothing of the case becomes the pack's, and
// a case whose managers are all the pack's falls to the organisation's administrators (NB4); a real person's request on
// a real case never writes the pack's rows, even asked inside a demo scope. And every
// write on a case of the pack's is the pack's, whoever makes it — a real holder's decision and the steps it opens, a real
// manager's actions, the organisation's timer (reminders, escalations, the automatic decision, «پایان مهلت»), «انتظار»
// and the delegation job (B9/P03, RC3) — so the purge takes all of it with the case and nothing names it after. An open
// task one of the pack's people held on an organisation's own case ends with the purge, and its round looks for people
// again: whoever is found gets it; nobody found, the journal says why, the case waits and its managers are told.
import { describe, it, expect, beforeAll } from "vitest";
import { create, createIn, updateIn } from "@server/engine";
import { inDemoScope, isDemoRow } from "@server/db/scope";
import { DEMO_JOB_SQL, enqueue, registerJobHandler } from "@server/jobs";
import { purgeStep, runToEnd } from "@server/modules/demo";
import { DEMO_PEOPLE_REAL_WORK, previewResolve } from "@server/modules/positions";
import { demoManagersWarning } from "@shared/process/validate";
import { caseDetail, cancelCaseAs, claimStep, pauseCase, reassignStep, reresolveStep, resumeCase, resumeFrom } from "@server/modules/process/api";
import { DEMO_PROCESS_START } from "@server/modules/process/engine";
import { applyPending } from "@server/modules/process/sync";
import { MORE, timerPass, TIMER_JOB } from "@server/modules/process/timers";
import type { ServerConfig } from "@server/context";
import { act, edge, journal, kase, node, openTask, person, publish, start, tasks, users, world, type Published, type World } from "./process-engine-helpers";

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

/** The pack as the loader leaves it, without the bank (its people added with `packPerson`; one a test before left stays). */
const loadPack = () =>
  w.o.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2) on conflict (org_id) do nothing`,
    [w.o.org, w.o.ownerId],
  );

/** The console's «حذف داده‌های نمایشی», to the end. */
async function purge(): Promise<void> {
  await w.o.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
  await w.o.owner.post(`${w.P}/demo/purge`, { confirm: "حذف کامل" });
  await runToEnd(w.o.cfg, w.o.org, "purge", { budgetMs: 300_000 });
  expect(await w.o.db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [w.o.org])).toBeNull();
}

/**
 * Rows of the organisation, in every table (outside the purge's own bookkeeping), that name one of `ids` anywhere in
 * their columns, per table: `pack` — only the pack's rows (sm_demo_rows), `real` — only the others, `any` — all.
 */
async function naming(ids: string[], which: "pack" | "real" | "any"): Promise<Record<string, number>> {
  const tables = await w.o.db.query<{ t: string }>(
    `select c.table_name as t from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%' and c.column_name = 'org_id' and c.table_name not like 'sm\\_demo\\_%'
        and exists (select 1 from information_schema.columns i where i.table_schema = c.table_schema and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'uuid')
      order by 1`,
  );
  const re = [...new Set(ids.map((x) => x.toLowerCase()))].join("|");
  const mark = which === "any" ? "" : `and ${which === "real" ? "not " : ""}exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id)`;
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    const r = await w.o.db.one<{ n: number }>(`select count(*)::int as n from ${t} x where x.org_id = $1 and lower(to_jsonb(x)::text) ~ $2 ${mark}`, [w.o.org, re]);
    if (r?.n) out[t] = r.n;
  }
  return out;
}

/** A case's ids that other rows name: the case, its runs and its tasks. */
async function caseIds(caseId: string): Promise<string[]> {
  const runs = await w.o.db.query<{ id: string }>(`select id::text as id from sm_flow_runs where org_id = $1 and trigger_record_id = $2`, [w.o.org, caseId]).catch(() => [] as { id: string }[]);
  const k = await kase(w, caseId);
  return [caseId, ...(k?.run_ref ? [k.run_ref] : []), ...runs.map((r) => r.id), ...(await tasks(w, caseId)).map((t) => t.id)];
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
const openAt2 = async (caseId: string, step: string) => (await tasks(w, caseId)).filter((t) => t.step_key === step && t.status === "open");

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

/** start → «تعیین مقدار» (fails when «شرح نیاز» is no amount: «نیاز به بررسی») → the steps given → end. */
const failing = (steps: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[], first: string) => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }),
    node("set", "set_values", { values: { u_amount: "{{case.u_need}}" } }),
    ...steps,
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "set"), edge("set", first), ...edges],
});
/** A refusal of FINAL-1's boundary: the pack's people take none of the organisation's own work (403, its own code). */
async function demoRefused(p: Promise<unknown>): Promise<void> {
  const e = (await p.then(() => null, (err: unknown) => err)) as { status?: number; code?: string; message?: string } | null;
  expect(e, "the action went through").toBeTruthy();
  expect({ status: e!.status, code: e!.code, message: e!.message }).toEqual({ status: 403, code: "demo_people_real_work", message: DEMO_PEOPLE_REAL_WORK });
}
/** A run that failed: «نیاز به بررسی» (the case's values cannot be set) — the job that runs it is the case's. */
async function startFailing(user: string, p: Published): Promise<string> {
  const id = (await start(w, user, p, { values: { u_amount: "5", u_need: "نامعتبر" } })).case!;
  await w.k.drain();
  expect(await kase(w, id)).toMatchObject({ state: "attention" });
  return id;
}

describe("one of the pack's people manages an organisation's own case (1.1.5, NB4)", () => {
  it("is refused every manager action there and the decision of a step they stand in for; the case page offers none; nothing of the case is the pack's and the purge leaves it as it was", async () => {
    const org = w.o.org;
    const db = w.o.db;
    await loadPack();
    const packManager = await packPerson("مسئول نمایشیِ گردش‌کار واقعی");
    // the step's one real member is away: the organisation's own case waits for nobody
    const later = await person(w, "کارشناس واقعیِ بازگشته");
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, later]);
    const REAL = await publish(w, failing([node("sec", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), ...users(later), ifNobody: "wait" }, "تأیید امنیت اطلاعات")], [edge("sec", "ok", "approved"), edge("sec", "no", "rejected")], "sec"), { managers: [packManager, manager] });
    const id = (await start(w, requester, REAL, { values: { u_amount: "5", u_need: "7" } })).case!;
    await w.k.drain();
    expect(await openAt(id)).toEqual([]);
    expect(await kase(w, id)).toMatchObject({ state: "waiting" });
    await db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [org, later]);
    // the pack's manager asks (a request of the pack's people runs in the demo scope, http/hono.ts): every manager action
    // is refused with FINAL-1's code — before 1.1.5 they wrote the pack's rows into the organisation's case
    const pack = await w.o.ctxOf(packManager);
    const asPack = <T>(fn: () => Promise<T>) => inDemoScope(org, fn);
    await demoRefused(asPack(() => reresolveStep(pack, id, { step: "sec" })));
    await demoRefused(asPack(() => reassignStep(pack, id, { step: "sec", to: [later] })));
    await demoRefused(asPack(() => pauseCase(pack, id, { comment: "بررسی" })));
    await demoRefused(asPack(() => cancelCaseAs(pack, id, { comment: "دیگر لازم نیست" })));
    const real = await w.o.ctxOf(manager);
    await pauseCase(real, id);
    await demoRefused(asPack(() => resumeCase(pack, id)));
    await resumeCase(real, id);
    // the case page reads for them (a manager reads the case) and offers no manager action
    const seen = await asPack(() => caseDetail(pack, id));
    expect(seen.can).toEqual({ cancel: false, manage: false, pause: false, resume: false, reassign: false, resume_from: false, reresolve: false });
    expect((await caseDetail(real, id)).can).toMatchObject({ manage: true, pause: true, reassign: true, reresolve: true });
    // a case of the same workflow whose run failed: the pack's manager does not resume it from a step either
    const stopped = await startFailing(requester, REAL);
    await demoRefused(asPack(() => resumeFrom(pack, stopped, { node: "sec" })));
    expect((await asPack(() => caseDetail(pack, stopped))).can.resume_from).toBe(false);
    // the real manager acts: the real member gets the step
    await reresolveStep(real, id, { step: "sec" });
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([later]);
    // a step they stand in for (the real member's delegation to them, which the step's people never follow — FINAL-1):
    // their decision as the delegate is refused too, and the task stays the real member's
    const handover = await w.sys.write((tx) => createIn(tx, w.sys, "delegation", { from_user: later, to_user: packManager, starts_at: new Date(Date.now() - 60_000).toISOString(), scopes: ["approvals"], active: true }, { trusted: true }));
    await w.k.drain();
    const task = (await openAt(id))[0].id;
    expect((await openAt(id)).map((t) => ({ to: t.assigned_to, for: t.delegated_from }))).toEqual([{ to: later, for: null }]);
    await demoRefused(asPack(() => act(w, packManager, task, { outcome: "approved" })));
    await w.sys.write((tx) => updateIn(tx, w.sys, "delegation", String(handover.id), { active: false }, { trusted: true }));
    await w.k.drain();
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([later]);
    // nothing of either case is the pack's
    expect(await naming([...(await caseIds(id)), ...(await caseIds(stopped))], "pack")).toEqual({});

    // ----- the purge takes the pack's people, never the work of the organisation's cases
    const before = { state: (await kase(w, id)).state, open: (await openAt(id)).map((t) => t.assigned_to) };
    await purge();
    expect({ state: (await kase(w, id)).state, open: (await openAt(id)).map((t) => t.assigned_to) }).toEqual(before);
    expect(await kase(w, stopped)).toMatchObject({ state: "attention" });
  }, 600_000);

  it("a real manager's request on an organisation's own case writes the organisation's rows, even when it runs inside a demo scope", async () => {
    const org = w.o.org;
    const db = w.o.db;
    await loadPack();
    const away = await person(w, "کارشناس واقعیِ دیرآمده");
    const other = await person(w, "کارشناس واقعیِ دیگر");
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, away]);
    const REAL = await publish(w, failing([node("sec", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), ...users(away), ifNobody: "wait" }, "تأیید امنیت اطلاعات")], [edge("sec", "ok", "approved"), edge("sec", "no", "rejected")], "sec"), { managers: [manager] });
    const id = (await start(w, requester, REAL, { values: { u_amount: "5", u_need: "7" } })).case!;
    const stopped = await startFailing(requester, REAL);
    const ended = (await start(w, requester, REAL, { values: { u_amount: "5", u_need: "7" } })).case!;
    await w.k.drain();
    await db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [org, away]);
    // every manager action of a real manager, each asked inside the organisation's demo scope (a request that runs there
    // by mistake: the case decides, never the scope it was asked in)
    const real = await w.o.ctxOf(manager);
    const inPack = <T>(fn: () => Promise<T>) => inDemoScope(org, fn);
    await inPack(() => reresolveStep(real, id, { step: "sec" }));
    await inPack(() => reassignStep(real, id, { step: "sec", task: null, to: [other] }));
    await inPack(() => pauseCase(real, id, { comment: "بررسی" }));
    await inPack(() => resumeCase(real, id));
    await inPack(() => resumeFrom(real, stopped, { node: "sec" }));
    await inPack(() => cancelCaseAs(real, ended, { comment: "تکراری" }));
    await w.k.drain();
    expect((await openAt(id)).map((t) => t.assigned_to).sort()).toEqual([away, other].sort());
    expect(await kase(w, stopped)).toMatchObject({ state: "active" });
    expect(await kase(w, ended)).toMatchObject({ state: "canceled" });
    // nothing of the three cases is the pack's (before 1.1.5 every action but the re-resolution wrote the pack's rows)
    const ids = [...(await caseIds(id)), ...(await caseIds(stopped)), ...(await caseIds(ended))];
    expect(await naming(ids, "pack")).toEqual({});
    // and the purge leaves all of it
    const before = await naming(ids, "any");
    await purge();
    expect(await naming(ids, "any")).toEqual(before);
    expect((await openAt(id)).map((t) => t.assigned_to).sort()).toEqual([away, other].sort());
  }, 600_000);

  it("a case whose managers are all the pack's — by name and in its manager group — falls to the organisation's administrators, as the designer warns", async () => {
    const org = w.o.org;
    const db = w.o.db;
    await loadPack();
    const packLead = await packPerson("مسئول نمایشیِ دیگر");
    const packMember = await packPerson("عضو نمایشیِ گروه مسئولان");
    // a group of the organisation's own that only one of the pack's people is in
    const group = await w.sys.write(async (tx) => {
      const g = await createIn(tx, w.sys, "group", { name: "مسئولان گردش‌کار (واقعی)", types: ["assignment"] }, { trusted: true });
      await createIn(tx, w.sys, "group_member", { group_id: g.id, user_id: packMember, kind: "member" }, { trusted: true });
      return String(g.id);
    });
    const away = await person(w, "کارشناس واقعیِ در مرخصی");
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, away]);
    const REAL = await publish(w, graph({ ...users(away), ifNobody: "wait" }), { managers: [packLead], manager_groups: [group] });
    const id = (await start(w, requester, REAL, { values })).case!;
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "waiting" });
    await db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [org, away]);
    // neither of the pack's people manages it, named or in the group
    for (const p of [packLead, packMember]) await demoRefused(inDemoScope(org, async () => pauseCase(await w.o.ctxOf(p), id, { comment: "بررسی" })));
    // the organisation's administrators do, as for a case naming no manager (before, nobody real could act on it)
    const owner = await w.o.ctxOf(w.o.ownerId);
    expect((await caseDetail(owner, id)).can).toMatchObject({ manage: true, pause: true, reassign: true, reresolve: true });
    await reresolveStep(owner, id, { step: "sec" });
    expect((await openAt(id)).map((t) => t.assigned_to)).toEqual([away]);
    expect(await naming(await caseIds(id), "pack")).toEqual({});
    // what the designer and the publish say of such managers
    expect(demoManagersWarning({ names: ["الف", "ب"], all: true })).toBe(
      "«الف»، «ب» از مسئولان این گردش‌کار حساب نمایشی‌اند و فقط پرونده‌هایی را مدیریت می‌کنند که حساب‌های نمایشی آغاز کنند؛ پرونده‌های خود سازمان را نه — پرونده‌های خود سازمان در این گردش‌کار به مدیران سازمان سپرده می‌شوند",
    );
  }, 600_000);
});

describe("every write on a case of the pack's is the pack's, whoever makes it (1.1.5, B9/P03)", () => {
  it("a real holder's decision (online and pushed) and the steps it opens, a real holder's «برداشتن کار», a real manager's «ارجاع», pause, resume, «ادامه از», «دوباره پیدا کردن انجام‌دهنده» and cancel: the pack's rows, which the purge takes with the case", async () => {
    const org = w.o.org;
    const db = w.o.db;
    await loadPack();
    const packRequester2 = await packPerson("درخواست‌دهندهٔ نمایشیِ پرونده‌ها");
    const a1 = await person(w, "تأییدکنندهٔ واقعیِ پروندهٔ نمایشی");
    const b1 = await person(w, "کارشناس واقعیِ اول");
    const b2 = await person(w, "کارشناس واقعیِ دوم");
    const b3 = await person(w, "کارشناس واقعیِ سوم");
    const steps = [
      node("a", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), ...users(a1), ifNobody: "wait" }, "تأیید"),
      node("b", "form_step", { action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), ...users(b1, b2) }, "بررسی"),
    ];
    // the organisation's own workflow, its real manager: the pack's people start its cases on the demo data
    const PROC = await publish(w, failing(steps, [edge("a", "b", "approved"), edge("a", "no", "rejected"), edge("b", "ok")], "a"), { managers: [manager] });
    const asPack = <T>(fn: () => Promise<T>) => inDemoScope(org, fn);
    const one = (await asPack(() => start(w, packRequester2, PROC, { values: { u_amount: "5", u_need: "7" } }))).case!;
    const stopped = await asPack(() => startFailing(packRequester2, PROC));
    // «دوباره پیدا کردن»: the approver is away when the third case reaches the step
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, a1]);
    const waits = (await asPack(() => start(w, packRequester2, PROC, { values: { u_amount: "5", u_need: "7" } }))).case!;
    await w.k.drain();
    await db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [org, a1]);
    for (const c of [one, stopped, waits]) expect(await isDemoRow(db, org, c)).toBe(true);
    // the real people act, as themselves (outside any demo scope)
    const real = await w.o.ctxOf(manager);
    await act(w, a1, await openTask(w, one, "a", a1), { outcome: "approved", comment: "تأیید شد" });
    await w.k.drain();
    const pool = await openTask(w, one, "b", b1);
    await claimStep(await w.o.ctxOf(b1), pool);
    await claimStep(await w.o.ctxOf(b1), pool, { release: true });
    await reassignStep(real, one, { step: "b", task: pool, to: [b3] });
    await pauseCase(real, one, { comment: "بررسی" });
    await resumeCase(real, one);
    await resumeFrom(real, stopped, { node: "a" });
    await w.k.drain();
    await reresolveStep(real, waits, { step: "a" });
    await act(w, a1, await openTask(w, waits, "a", a1), { outcome: "approved" });
    await w.k.drain();
    // the last decision as a Windows app pushes it — a person's own create through the record API, applied by its event job
    await create(await w.o.ctxOf(b2), "process_submission", { kind: "step", task_id: await openTask(w, waits, "b", b2), values: { u_finance_note: "انجام شد" } });
    await w.k.drain();
    await cancelCaseAs(real, one, { comment: "تکراری" });
    await w.k.drain();
    expect(await kase(w, one)).toMatchObject({ state: "canceled" });
    expect(await kase(w, stopped)).toMatchObject({ state: "active" });
    expect(await kase(w, waits)).toMatchObject({ state: "completed" });
    // every row about the three cases is the pack's: the real people's submissions, tasks, journal and audit lines, the
    // runs they resumed and the jobs they queued (before 1.1.5 all of them were the organisation's rows)
    const ids = [...(await caseIds(one)), ...(await caseIds(stopped)), ...(await caseIds(waits))];
    expect(await naming(ids, "real")).toEqual({});

    // ----- the purge takes the cases and everything about them
    await purge();
    for (const c of [one, stopped, waits]) expect(await db.one(`select 1 as x from sm_process_cases where id = $1`, [c])).toBeNull();
    expect(await naming(ids, "any")).toEqual({});
  }, 600_000);
});

describe("the organisation's timer and jobs on a case of the pack's (1.1.5, RC3)", () => {
  it("reminders, the escalations (notify the managers, give the step to others, decide it), «انتظار», «پایان مهلت» and a delegation write the pack's rows only; the purge leaves nothing of them", async () => {
    const org = w.o.org;
    const db = w.o.db;
    await loadPack();
    const packStarter = await packPerson("درخواست‌دهندهٔ نمایشیِ زمان‌دار");
    const first = await person(w, "تأییدکنندهٔ واقعیِ نخست");
    const taker = await person(w, "تأییدکنندهٔ واقعیِ جایگزین");
    const standIn = await person(w, "جانشین واقعی");
    const filler = await person(w, "کارشناس واقعیِ تکمیل");
    const hour = { amount: 1, unit: "hour" };
    const PROC = await publish(
      w,
      {
        nodes: [
          node("t", "trigger"),
          node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }),
          node("a", "form_step", {
            action: "approve", form: w.forms.review, rights: rights({}), ...users(first), business: false, remind_every: hour,
            escalate: [
              { after: hour, action: "notify", to: "managers" },
              { after: { amount: 2, unit: "hour" }, action: "reassign", rules: [{ kind: "users", users: [taker] }] },
              { after: { amount: 3, unit: "hour" }, action: "auto", outcome: "approved" },
            ],
          }, "تأیید"),
          node("wt", "wait_duration", { mode: "duration", duration: hour, business: false }, "انتظار"),
          node("b", "form_step", { action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), ...users(filler), due: hour, business: false }, "تکمیل"),
          node("ok", "end", { outcome: "completed" }),
          node("late", "end", { outcome: "canceled" }),
          node("no", "end", { outcome: "rejected" }),
        ],
        edges: [edge("t", "s"), edge("s", "a"), edge("a", "wt", "approved"), edge("a", "no", "rejected"), edge("wt", "b"), edge("b", "ok"), edge("b", "late", "timeout")],
      },
      { managers: [manager] },
    );
    const id = (await inDemoScope(org, () => start(w, packStarter, PROC, { values }))).case!;
    await w.k.drain();
    expect(await isDemoRow(db, org, id)).toBe(true);
    const timer = () => timerPass(w.o.cfg, org, (s) => applyPending(w.o.cfg, org, s, null));
    // two hours on: the reminder, the managers told, the step given to another (the organisation's own job)
    await db.query(`update sm_process_tasks set opened_at = opened_at - interval '2 hours 1 minute' where case_id = $1 and step_key = 'a'`, [id]);
    await timer();
    await w.k.drain();
    expect((await openAt2(id, "a")).map((t) => t.assigned_to)).toEqual([taker]);
    // the new holder hands their work to a stand-in (the organisation's own delegation; its job outside any demo scope)
    await w.sys.write((tx) => createIn(tx, w.sys, "delegation", { from_user: taker, to_user: standIn, starts_at: new Date(Date.now() - 60_000).toISOString(), scopes: ["approvals"], active: true }, { trusted: true }));
    await w.k.drain();
    expect((await openAt2(id, "a")).map((t) => ({ to: t.assigned_to, for: t.delegated_from }))).toEqual([{ to: standIn, for: taker }]);
    // three hours on: decided by the escalation; «انتظار» waits its hour, then «تکمیل» opens and its time runs out
    await db.query(`update sm_process_tasks set opened_at = opened_at - interval '1 hour', escalated_at = escalated_at - interval '1 hour', reminded_at = reminded_at - interval '1 hour' where case_id = $1 and step_key = 'a'`, [id]);
    await timer();
    await w.k.drain();
    await w.k.fireTimers();
    await w.k.drain();
    expect((await openAt2(id, "b")).map((t) => t.assigned_to)).toEqual([filler]);
    await db.query(`update sm_process_tasks set opened_at = opened_at - interval '2 hours', due_at = now() - interval '1 minute' where case_id = $1 and step_key = 'b'`, [id]);
    await timer();
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "canceled" });
    const lines = await journal(w, id);
    // (the managers, real people, hear nothing of the pack's case, and the journal says so)
    for (const l of ["پروندهٔ نمایشی است و اعلانی", "مهلت گذشت؛ «تأیید» به", "به جانشینی از", "خودکار «تأیید» شد", "مهلت «تکمیل» به پایان رسید"]) expect(lines.some((b) => b.includes(l)), l).toBe(true);
    // every row about the case is the pack's
    const ids = await caseIds(id);
    expect(await naming(ids, "real")).toEqual({});

    // ----- the purge takes it all
    await purge();
    expect(await db.one(`select 1 as x from sm_process_cases where id = $1`, [id])).toBeNull();
    expect(await naming(ids, "any")).toEqual({});
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
