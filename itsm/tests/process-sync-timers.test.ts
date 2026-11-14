// F4b — time and recovery in workflows (design F §3.4–3.5, §3.6.6), on the authority:
//   · delegation: a delegation that starts after a step opened moves the task to the delegate, who reads the case; its
//     end (time passing, nothing written) moves it back; the out-of-office profile does the same;
//   · `process.timer`: a reminder, an escalation (a notice to the managers; a reassignment), an automatic decision —
//     each once;
//   · a run that fails: «نیاز به بررسی», the managers told, the open tasks «لغو»; «ادامه از مرحلهٔ …» by a manager →
//     the case completes; «لغو پرونده» by a manager.
import { describe, it, expect, beforeAll } from "vitest";
import { create, systemCtx, updateIn } from "@server/engine";
import { cancelAsManager, resumeFromStep } from "@server/modules/process/recovery";
import type { ProcessGraph } from "@shared/process/graph";
import type { Client } from "./helpers";
import { act, edge, journal, kase, node, openTask, person, publish, start, tasks, users, world, type Published, type World } from "./process-engine-helpers";

let w: World;
const P: Record<string, string> = {};
let dlg: { client: Client; userId: string };

const notices = (user: string) => w.o.db.query<{ title: string }>(`select title from sm_notifications where org_id = $1 and user_id = $2 order by created_at`, [w.o.org, user]);
/** Time passes for a case's step: its tasks opened (and were reminded, and fall due) `ms` earlier. */
const passes = (caseId: string, step: string, ms: number) =>
  w.o.db.query(
    `update sm_process_tasks set opened_at = opened_at - $3 * interval '1 millisecond', due_at = due_at - $3 * interval '1 millisecond',
       reminded_at = reminded_at - $3 * interval '1 millisecond', escalated_at = escalated_at - $3 * interval '1 millisecond'
     where case_id = $1 and step_key = $2`,
    [caseId, step, ms],
  );
/** Run the jobs of `kind` that wait for a later time now, then everything due. */
async function dueNow(kind: string) {
  await w.o.db.query(`update sm_jobs set run_at = now() where kind = $1 and status = 'queued'`, [kind]);
  await w.k.drain();
}
const H = 3_600_000;

beforeAll(async () => {
  w = await world();
  for (const [k, name] of [["r", "درخواست‌دهنده"], ["p1", "رئیس شعبه"], ["p2", "امور مالی"], ["p3", "معاون شعبه"], ["dlg2", "جانشین غیاب"], ["mgr", "مسئول گردش‌کار"]] as const) P[k] = await person(w, name);
  dlg = await w.o.member("member", `tm-dlg-${Date.now()}@bank.test`);
  await w.o.owner.put(`${w.P}/access/members/${dlg.userId}`, { roles: ["requester"] });
}, 600_000);

const approveThenPay = (approve: Record<string, unknown>): ProcessGraph => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
    node("a", "form_step", { action: "approve", form: w.forms.review, rights: { default: "read", fields: {} }, ...users(P.p1), ...approve }, "تأیید رئیس شعبه"),
    node("pay", "form_step", { action: "fill", form: w.forms.review, rights: { default: "read", fields: { u_finance_note: "edit" } }, ...users(P.p2) }, "بررسی و پرداخت"),
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "a"), edge("a", "pay", "approved"), edge("a", "no", "rejected"), edge("pay", "ok")],
});

describe("delegation while a step is open", () => {
  let proc: Published;
  let c = "";

  it("a delegation that starts after the step opened moves the task to the delegate, who reads the case", async () => {
    proc = await publish(w, approveThenPay({}), { managers: [P.mgr] });
    c = (await start(w, P.r, proc, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    await dlg.client.get(`${w.P}/r/process_case/${c}`, 404);
    const now = Date.now();
    await create(w.sys, "delegation", { from_user: P.p1, to_user: dlg.userId, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + H).toISOString(), scopes: ["approvals"] }, { trusted: true });
    await w.k.drain();
    const t = (await tasks(w, c)).find((x) => x.step_key === "a")!;
    expect([t.assigned_to, t.delegated_from, t.status]).toEqual([dlg.userId, P.p1, "open"]);
    expect((await kase(w, c)).participants).toContain(dlg.userId);
    await dlg.client.get(`${w.P}/r/process_case/${c}`, 200);
    expect((await journal(w, c)).some((b) => b.includes("به جانشینی از رئیس شعبه"))).toBe(true);
    expect((await notices(dlg.userId)).map((n) => n.title)).toContain("مرحله‌ای به جانشینی از رئیس شعبه منتظر شماست");
  }, 120_000);

  it("its end moves the task back (time passes, nothing is written)", async () => {
    await w.o.db.query(`update sm_delegations set ends_at = now() - interval '1 second' where from_user = $1`, [P.p1]);
    await dueNow("process.delegation");
    const t = (await tasks(w, c)).find((x) => x.step_key === "a")!;
    expect([t.assigned_to, t.delegated_from]).toEqual([P.p1, null]);
    await dlg.client.get(`${w.P}/r/process_case/${c}`, 404);
  }, 120_000);

  it("the out-of-office profile does the same", async () => {
    const sys = await systemCtx(w.o.cfg, w.o.org);
    const profile = (await w.o.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2`, [w.o.org, P.p1]))!.id;
    await sys.write((tx) => updateIn(tx, sys, "member_profile", profile, { out_of_office: true, delegate_id: P.dlg2 }, { trusted: true }));
    await w.k.drain();
    let t = (await tasks(w, c)).find((x) => x.step_key === "a")!;
    expect([t.assigned_to, t.delegated_from]).toEqual([P.dlg2, P.p1]);
    // the delegate decides for the person
    await act(w, P.dlg2, t.id, { outcome: "approved" });
    await w.k.drain();
    t = (await tasks(w, c)).find((x) => x.step_key === "a")!;
    expect([t.status, t.acted_by, t.acted_for]).toEqual(["done", P.dlg2, P.p1]);
    await sys.write((tx) => updateIn(tx, sys, "member_profile", profile, { out_of_office: false, delegate_id: null }, { trusted: true }));
    await w.k.drain();
  }, 120_000);

  it("the end of an out-of-office period moves an open task back", async () => {
    const sys = await systemCtx(w.o.cfg, w.o.org);
    const id = (await start(w, P.r, proc, { values: { u_amount: "101" } })).case!;
    await w.k.drain();
    const profile = (await w.o.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2`, [w.o.org, P.p1]))!.id;
    await sys.write((tx) => updateIn(tx, sys, "member_profile", profile, { out_of_office: true, delegate_id: P.dlg2, ooo_until: new Date(Date.now() + H).toISOString() }, { trusted: true }));
    await w.k.drain();
    expect((await tasks(w, id)).find((x) => x.step_key === "a")!.assigned_to).toBe(P.dlg2);
    await w.o.db.query(`update sm_member_profiles set ooo_until = now() - interval '1 second' where id = $1`, [profile]);
    await dueNow("process.delegation");
    expect((await tasks(w, id)).find((x) => x.step_key === "a")).toMatchObject({ assigned_to: P.p1, delegated_from: null });
  }, 120_000);
});

describe("process.timer", () => {
  it("reminds, tells the managers when time is up, then decides automatically — each once", async () => {
    const proc = await publish(
      w,
      approveThenPay({
        due: { amount: 1, unit: "hour" }, business: false, remind_every: { amount: 30, unit: "minute" },
        escalate: [{ after: { amount: 2, unit: "hour" }, action: "notify", to: "managers" }, { after: { amount: 3, unit: "hour" }, action: "auto", outcome: "approved" }],
      }),
      { managers: [P.mgr] },
    );
    const c = (await start(w, P.r, proc, { values: { u_amount: "200" } })).case!;
    await w.k.drain();
    // the step's opening woke the timer for its first time (the reminder, half an hour on)
    const job = await w.o.db.one<{ run_at: string }>(`select run_at from sm_jobs where kind = 'process.timer' and status = 'queued'`);
    expect(job).toBeTruthy();
    expect(new Date(job!.run_at).getTime()).toBeLessThanOrEqual(Date.now() + 31 * 60_000);
    await passes(c, "a", 2.5 * H);
    await dueNow("process.timer");
    const late = "مهلت گذشت: «تأیید رئیس شعبه» در پروندهٔ";
    expect((await notices(P.p1)).filter((n) => n.title === "یادآوری مرحله: «تأیید رئیس شعبه»")).toHaveLength(1);
    expect((await notices(P.mgr)).filter((n) => n.title.startsWith(late))).toHaveLength(1);
    expect((await journal(w, c)).filter((b) => b.startsWith("مهلت گذشت؛ «تأیید رئیس شعبه» به مسئول گردش‌کار اطلاع داده شد"))).toHaveLength(1);
    expect((await tasks(w, c)).find((t) => t.step_key === "a")!.status).toBe("open");
    // again at once: nothing more
    await dueNow("process.timer");
    expect((await notices(P.p1)).filter((n) => n.title.startsWith("یادآوری مرحله"))).toHaveLength(1);
    expect((await notices(P.mgr)).filter((n) => n.title.startsWith(late))).toHaveLength(1);
    // another hour: decided automatically, and the case moves on
    await passes(c, "a", H);
    await dueNow("process.timer");
    await w.k.drain();
    expect((await tasks(w, c)).find((t) => t.step_key === "a")!.status).toBe("not_needed");
    expect((await journal(w, c)).filter((b) => b === "مهلت گذشت؛ «تأیید رئیس شعبه» خودکار «تأیید» شد")).toHaveLength(1);
    expect((await kase(w, c)).progress.a).toMatchObject({ status: "done", outcome: "approved" });
    expect((await tasks(w, c)).filter((t) => t.step_key === "pay").map((t) => [t.assigned_to, t.status])).toEqual([[P.p2, "open"]]);
  }, 120_000);

  it("an escalation that reassigns: the round goes to the other rule's people", async () => {
    const proc = await publish(w, approveThenPay({ escalate: [{ after: { amount: 1, unit: "hour" }, action: "reassign", rules: [{ kind: "users", users: [P.p3] }] }], business: false }));
    const c = (await start(w, P.r, proc, { values: { u_amount: "300" } })).case!;
    await w.k.drain();
    await passes(c, "a", 1.5 * H);
    await dueNow("process.timer");
    const round = (await tasks(w, c)).filter((t) => t.step_key === "a");
    expect(round.map((t) => [t.assigned_to, t.status]).sort()).toEqual([[P.p1, "not_needed"], [P.p3, "open"]].sort());
    expect((await notices(P.p3)).map((n) => n.title)).toContain("مرحله‌ای منتظر شماست: «تأیید رئیس شعبه»");
    expect((await kase(w, c)).participants).toContain(P.p3);
    await act(w, P.p3, await openTask(w, c, "a", P.p3), { outcome: "approved" });
    await w.k.drain();
    expect((await tasks(w, c)).filter((t) => t.step_key === "pay")).toHaveLength(1);
  }, 120_000);
});

describe("when a run fails", () => {
  /** start → «تعیین مقدار» that fails on this case's values → pay → end */
  const failing = (): ProcessGraph => ({
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
      node("set", "set_values", { values: { u_amount: "{{case.u_need}}" } }),
      node("pay", "form_step", { action: "fill", form: w.forms.review, rights: { default: "read", fields: { u_finance_note: "edit" } }, ...users(P.p2) }, "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }),
    ],
    edges: [edge("t", "s"), edge("s", "set"), edge("set", "pay"), edge("pay", "ok")],
  });

  it("a failing step → «نیاز به بررسی», the managers told → «ادامه از مرحلهٔ …» → the case completes", async () => {
    const proc = await publish(w, failing(), { managers: [P.mgr] });
    const c = (await start(w, P.r, proc, { values: { u_amount: "400", u_need: "نامعتبر" } })).case!;
    await w.k.drain();
    const k = await kase(w, c);
    expect(k.state).toBe("attention");
    expect((await journal(w, c)).some((b) => b.startsWith("اجرای پرونده متوقف شد و پرونده نیاز به بررسی دارد"))).toBe(true);
    expect((await notices(P.mgr)).map((n) => n.title)).toContain(`پروندهٔ ${k.number} متوقف شد`);
    // only a manager, only from a form step outside parallel blocks
    await expect(resumeFromStep(await w.o.ctxOf(P.r), c, "pay")).rejects.toThrow("این کار با مسئولان این گردش‌کار است");
    await expect(resumeFromStep(await w.o.ctxOf(P.mgr), c, "set")).rejects.toThrow("پرونده از این مرحله ادامه نمی‌یابد");
    const { run } = await resumeFromStep(await w.o.ctxOf(P.mgr), c, "pay");
    expect((await kase(w, c))).toMatchObject({ state: "active", run_ref: run });
    await w.k.drain();
    await act(w, P.p2, await openTask(w, c, "pay", P.p2), { values: { u_finance_note: "پرداخت شد" } });
    await w.k.drain();
    expect(await kase(w, c)).toMatchObject({ state: "completed", outcome: "completed", data: { u_finance_note: "پرداخت شد" } });
    expect((await journal(w, c)).some((b) => b.includes("پرونده را از مرحلهٔ «بررسی و پرداخت» ادامه داد"))).toBe(true);
    expect(await w.o.db.one(`select 1 as x from sm_audit where action = 'process.resume_from' and entity_id = $1`, [c])).toBeTruthy();
    await expect(resumeFromStep(await w.o.ctxOf(P.mgr), c, "pay")).rejects.toThrow("فقط پرونده‌ای که متوقف شده است");
  }, 120_000);

  it("«لغو پرونده» by a manager closes it, its open tasks «لغو»", async () => {
    const proc = await publish(w, approveThenPay({}), { managers: [P.mgr] });
    const c = (await start(w, P.r, proc, { values: { u_amount: "500" } })).case!;
    await w.k.drain();
    await expect(cancelAsManager(await w.o.ctxOf(P.p1), c, { comment: "x" })).rejects.toThrow("این کار با مسئولان این گردش‌کار است");
    await cancelAsManager(await w.o.ctxOf(P.mgr), c, { comment: "درخواست تکراری" });
    await w.k.drain();
    expect(await kase(w, c)).toMatchObject({ state: "canceled", outcome: "canceled" });
    expect((await tasks(w, c)).find((t) => t.step_key === "a")!.status).toBe("canceled");
    const run = await w.o.db.one<{ state: string }>(`select state from sm_flow_runs where id = (select run_ref::uuid from sm_process_cases where id = $1)`, [c]);
    expect(run!.state).toBe("canceled");
  }, 120_000);
});
