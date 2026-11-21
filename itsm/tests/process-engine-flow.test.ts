// F4a — workflow cases end to end on PGlite (design F §3.5–3.6): the form step (open, wait, settle, withdraw), the
// online services and `applySubmission` (rights, validation, key-by-key merge, files, quorum, return, settle,
// resume), the process-only steps and the case's end:
//   · start → approve → branch → fill → end; the reject path; return twice to «ثبت درخواست» (rounds 2 and 3);
//   · parallel + join all; parallel + join any with cancel_rest (the other branch's task «دیگر لازم نیست», and its
//     later submission is late, its values kept on the submission only);
//   · nobody to assign → the case waits (and `ifNobody: skip` passes the step);
//   · merge: legal ∥ finance in both orders keeps both values;
//   · a retired field: a case on an old version still shows and accepts it;
//   · quorum (any, all, count, percent, first) through the shared approval maths;
//   · the guards: comments, decisions a step does not offer, the person, starters, a start applied once, cancel;
//   · review F4a: a «بازگشت» reopens its target only for the earlier actors (the people a delegate acted for, through
//     today's delegations) and the returning step by its rules; rounds settled before the executor ran stay settled;
//     a start on an older version takes the current one's starters and access; unlabeled steps' tasks are named.
import { describe, it, expect, beforeAll } from "vitest";
import { applySubmission, processesRunHere, roundSettles, startCase, LATE_NOTE, STEP_OPENED } from "@server/modules/process/engine";
import { createIn, onRecordEvent, updateIn } from "@server/engine";
import { stepStatuses, type ProcessGraph } from "@shared/process";
import { uuidv7 } from "@shared/id";
import { PNG } from "./engine-helpers";
import { act, cancel, edge, journal, kase, node, openTask, person, publish, start, submission, tasks, users, world, type World } from "./process-engine-helpers";

let w: World;
let F: World["forms"];
const P: Record<string, string> = {};

const rights = (dflt: string, fields: Record<string, string> = {}) => ({ default: dflt, fields });
const startStep = () => node("s", "form_step", { action: "fill", start: true, form: F.req, rights: rights("edit") });

/** «آغاز» → «ثبت درخواست» → «تأیید رئیس شعبه» → amount > 500M ? «بررسی و پرداخت» : end. Reject ends rejected, return goes to the start. */
function basic(approver: string, filler: string): ProcessGraph {
  return {
    nodes: [
      node("t", "trigger"),
      startStep(),
      node("a", "form_step", { action: "approve", form: F.review, rights: rights("read"), ...users(approver) }, "تأیید رئیس شعبه"),
      node("b", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }),
      node("pay", "form_step", { action: "fill", form: F.review, rights: rights("read", { u_finance_note: "required" }), ...users(filler) }, "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "b", "approved"), edge("a", "no", "rejected"), edge("a", "s", "returned"), edge("b", "pay", "yes"), edge("b", "ok", "no"), edge("pay", "ok")],
  };
}

/** «بررسی حقوقی» ∥ «بررسی مالی» after the start, joined (all, or any with cancel_rest), then a final approval. */
function parallel(legal: string, finance: string, approver: string, mode: "all" | "any" = "all"): ProcessGraph {
  return {
    nodes: [
      node("t", "trigger"),
      startStep(),
      node("p", "parallel"),
      node("l", "form_step", { action: "fill", form: F.legal, rights: rights("read", { u_legal: "required" }), ...users(legal) }, "بررسی حقوقی"),
      node("m", "form_step", { action: "fill", form: F.fin, rights: rights("read", { u_fin: "required" }), ...users(finance) }, "بررسی مالی"),
      node("j", "join", { mode, ...(mode === "any" ? { cancel_rest: true } : {}) }),
      node("fa", "form_step", { action: "approve", form: F.review, rights: rights("read"), ...users(approver) }, "تأیید نهایی"),
      node("ok", "end"),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "p"), edge("p", "l"), edge("p", "m"), edge("l", "j"), edge("m", "j"), edge("j", "fa"), edge("fa", "ok", "approved"), edge("fa", "no", "rejected")],
  };
}

beforeAll(async () => {
  w = await world();
  F = w.forms;
  for (const [k, name] of [["r", "رضا درخواست‌دهنده"], ["h", "حسن رئیس شعبه"], ["f", "فرزانه امور مالی"], ["l", "لیلا حقوقی"], ["m", "مریم مالی"], ["x", "خسرو بیگانه"], ["d", "داوود جانشین"], ["a2", "علی تأییدکننده"], ["a3", "اکبر تأییدکننده"]] as const) {
    P[k] = await person(w, name);
  }
}, 600_000);

describe("a case from start to end", () => {
  it("start → approve → branch → fill → end: tasks, merge, progress, journal and the closed case", async () => {
    const p = await publish(w, basic(P.h, P.f), { title: "تنخواه {{case.u_amount}} — {{case.requested_by}}" });
    const started = await start(w, P.r, p, { values: { u_amount: "750000000", u_need: "خرید چاپگر" } });
    expect(started.result).toBe("applied");
    const id = started.case!;
    await w.k.drain();
    let c = await kase(w, id);
    expect(c.number).toMatch(/^PRC\d{7}$/);
    expect(c.title).toBe("تنخواه ۷۵۰٬۰۰۰٬۰۰۰ ریال — رضا درخواست‌دهنده");
    expect(c).toMatchObject({ state: "active", current_steps: [{ key: "a", label: "تأیید رئیس شعبه" }], open_rounds: { a: 1 } });
    expect(c.progress.s).toMatchObject({ status: "done", outcome: "submitted", round: 1 });
    expect(c.progress.a).toMatchObject({ status: "active", round: 1, waiting: 1 });
    expect(c.participants.sort()).toEqual([P.r, P.h].sort());

    // the approver: a read-only value they send is dropped and counted
    const approved = await act(w, P.h, await openTask(w, id, "a", P.h), { outcome: "approved", comment: "موافقم", values: { u_amount: "1" } });
    expect(approved).toMatchObject({ result: "applied", note: "۱ مقدار که در این مرحله اجازهٔ تغییرشان را نداشتید کنار گذاشته شد" });
    await w.k.drain();
    c = await kase(w, id);
    expect(c.data.u_amount).toBe("750000000");
    expect(c.progress.b).toMatchObject({ status: "done", port: "yes" });
    expect(c.current_steps).toEqual([{ key: "pay", label: "بررسی و پرداخت" }]);

    // «نظر مالی» is required at «بررسی و پرداخت»: a 400 with the field's message, and nothing kept
    const payTask = await openTask(w, id, "pay", P.f);
    const before = await w.o.db.one<{ n: number }>(`select count(*)::int as n from sm_process_submissions where case_id = $1`, [id]);
    await expect(act(w, P.f, payTask, { values: {} })).rejects.toMatchObject({ status: 400, details: { fields: { u_finance_note: "«نظر مالی» را وارد کنید" } } });
    expect(await w.o.db.one<{ n: number }>(`select count(*)::int as n from sm_process_submissions where case_id = $1`, [id])).toEqual(before);
    await act(w, P.f, payTask, { values: { u_finance_note: "پرداخت شد" } });
    await w.k.drain();

    c = await kase(w, id);
    expect(c).toMatchObject({ state: "completed", outcome: "completed" });
    expect([c.current_steps ?? [], c.open_rounds ?? {}]).toEqual([[], {}]);
    expect(c.data).toMatchObject({ u_amount: "750000000", u_need: "خرید چاپگر", u_finance_note: "پرداخت شد" });
    expect((await tasks(w, id)).map((t) => `${t.step_key}:${t.round}:${t.status}:${t.outcome}`)).toEqual(["s:1:done:submitted", "a:1:done:approved", "pay:1:done:submitted"]);
    const version = { graph: basic(P.h, P.f) };
    const view = stepStatuses(version, c, [], null);
    expect(view).toMatchObject({ s: { status: "done" }, a: { status: "done", outcome: "approved" }, b: { status: "done" }, pay: { status: "done" }, ok: { status: "done", outcome: "completed" }, no: { status: "skipped" } });
    const notes = await journal(w, id);
    expect(notes).toContain("رضا درخواست‌دهنده پرونده را ثبت کرد");
    expect(notes).toContain("حسن رئیس شعبه «تأیید رئیس شعبه» را تأیید کرد: موافقم");
    expect(notes.at(-1)).toBe("پرونده با نتیجهٔ «انجام‌شده» به پایان رسید");
  });

  it("the reject path: a comment is required, then the case ends rejected", async () => {
    const p = await publish(w, basic(P.h, P.f));
    const id = (await start(w, P.r, p, { values: { u_amount: "1000" } })).case!;
    await w.k.drain();
    const t = await openTask(w, id, "a", P.h);
    await expect(act(w, P.h, t, { outcome: "rejected" })).rejects.toMatchObject({ status: 400, details: { fields: { comment: "برای رد یا بازگشت، توضیح بنویسید" } } });
    await act(w, P.h, t, { outcome: "rejected", comment: "بودجه نداریم" });
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "rejected", outcome: "rejected" });
    expect((await kase(w, id)).progress.no).toMatchObject({ status: "done", outcome: "rejected" });
  });

  it("returns twice to «ثبت درخواست»: rounds 2 and 3 go to the requester, then the case completes", async () => {
    const p = await publish(w, basic(P.h, P.f));
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    for (const round of [2, 3]) {
      await act(w, P.h, await openTask(w, id, "a", P.h), { outcome: "returned", comment: `اصلاح ${round}` });
      await w.k.drain();
      const c = await kase(w, id);
      expect(c.open_rounds).toEqual({ s: round });
      // what lay after the reopened step runs again: its entry is gone until it does
      expect(c.progress.s).toMatchObject({ status: "active", round });
      expect(c.progress.a).toBeUndefined();
      await act(w, P.r, await openTask(w, id, "s", P.r), { values: { u_amount: String(100 * round) } });
      await w.k.drain();
      expect((await kase(w, id)).open_rounds).toEqual({ a: round });
    }
    await act(w, P.h, await openTask(w, id, "a", P.h), { outcome: "approved" });
    await w.k.drain();
    const c = await kase(w, id);
    expect(c).toMatchObject({ state: "completed", data: { u_amount: "300" } });
    expect((await tasks(w, id)).map((t) => `${t.step_key}:${t.round}:${t.outcome}`)).toEqual(["s:1:submitted", "a:1:returned", "s:2:submitted", "a:2:returned", "s:3:submitted", "a:3:approved"]);
    expect(c.progress.a).toMatchObject({ status: "done", outcome: "approved", round: 3 });
  });

  it("an unlabeled step's tasks carry its Persian name in every round, not the node's type key", async () => {
    const g = basic(P.h, P.f);
    for (const n of g.nodes) delete n.label;
    const p = await publish(w, g);
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    await act(w, P.h, await openTask(w, id, "a", P.h), { outcome: "returned", comment: "اصلاح" });
    await w.k.drain();
    const rows = await w.o.db.query<{ step_key: string; round: number; step_label: string }>(`select step_key, round, step_label from sm_process_tasks where case_id = $1 order by opened_at, round`, [id]);
    expect(rows.map((t) => `${t.step_key}:${t.round}:${t.step_label}`)).toEqual(["s:1:ثبت درخواست", "a:1:تأیید", "s:2:ثبت درخواست"]);
  });

  it("refuses a «بازگشت» the step does not offer, and a task that is not the person's", async () => {
    const g = basic(P.h, P.f);
    g.edges = g.edges.filter((e) => e.port !== "returned");
    const p = await publish(w, g);
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    const t = await openTask(w, id, "a", P.h);
    await expect(act(w, P.h, t, { outcome: "returned", comment: "x" })).rejects.toMatchObject({ status: 409, message: "این مرحله «بازگشت برای اصلاح» ندارد" });
    await expect(act(w, P.x, t, { outcome: "approved" })).rejects.toMatchObject({ status: 409, message: "این مرحله به شما سپرده نشده است" });
    expect((await tasks(w, id)).find((x) => x.id === t)?.status).toBe("open");
  });
});

describe("the workflow's own steps", () => {
  it("«انتخاب» takes the first matching case, «تعیین مقدار» writes case values, «اعلان» reaches people by rule; each opening emits its event", async () => {
    const opened: unknown[] = [];
    const off = onRecordEvent("test-step-opened", async (e) => void opened.push(e.data), { tables: ["process_case"], kinds: [STEP_OPENED] });
    try {
      const g: ProcessGraph = {
        nodes: [
          node("t", "trigger"),
          startStep(),
          node("c", "choice", { cases: [{ key: "small", label: "کم", rules: [{ left: "{{case.u_amount}}", op: "lt", right: "1000" }] }, { key: "mid", label: "میانه", rules: [{ left: "{{case.u_amount}}", op: "lt", right: "100000" }] }] }),
          node("v", "set_values", { values: { u_finance_note: "خودکار برای {{case.u_amount}}" } }),
          node("n", "notify", { to: [{ kind: "users", users: [P.f] }], subject: "پرونده {{case.number}}", body: "مبلغ {{case.u_amount}}" }),
          node("e", "form_step", { action: "review", form: F.review, rights: rights("read"), ...users(P.h) }, "بررسی"),
          node("ok", "end"),
          node("else", "end", { outcome: "canceled" }),
        ],
        edges: [edge("t", "s"), edge("s", "c"), edge("c", "v", "small"), edge("c", "e", "mid"), edge("c", "else", "else"), edge("v", "n"), edge("n", "e"), edge("e", "ok")],
      };
      const p = await publish(w, g);
      const small = (await start(w, P.r, p, { values: { u_amount: "500" } })).case!;
      const mid = (await start(w, P.r, p, { values: { u_amount: "5000" } })).case!;
      const big = (await start(w, P.r, p, { values: { u_amount: "500000" } })).case!;
      await w.k.drain();
      const c = await kase(w, small);
      expect(c.data.u_finance_note).toBe("خودکار برای 500");
      expect(c.progress.c).toMatchObject({ status: "done", port: "small" });
      const sent = await w.o.db.one<{ output: { recipients: string[]; count: number } }>(`select output from sm_flow_run_steps where run_id = $1 and node_id = 'n'`, [c.run_ref]);
      expect(sent?.output.recipients).toEqual([P.f]);
      expect((await kase(w, mid)).progress.c).toMatchObject({ port: "mid" });
      expect((await kase(w, mid)).data.u_finance_note).toBeUndefined();
      expect(await kase(w, big)).toMatchObject({ state: "canceled", outcome: "canceled" });
      expect(opened).toEqual(
        expect.arrayContaining([expect.objectContaining({ node: "e", round: 1, action: "review", people: [P.h], status: "ok" })]),
      );
    } finally {
      off();
    }
  });
});

describe("parallel branches", () => {
  it("join all: both branches' values are merged, then the final approval opens", async () => {
    const p = await publish(w, parallel(P.l, P.m, P.h));
    const id = (await start(w, P.r, p, { values: { u_amount: "500" } })).case!;
    await w.k.drain();
    expect((await kase(w, id)).open_rounds).toEqual({ l: 1, m: 1 });
    await act(w, P.l, await openTask(w, id, "l", P.l), { values: { u_legal: "بی‌اشکال" } });
    await w.k.drain();
    expect((await kase(w, id)).open_rounds).toEqual({ m: 1 });
    await act(w, P.m, await openTask(w, id, "m", P.m), { values: { u_fin: "بودجه هست" } });
    await w.k.drain();
    const c = await kase(w, id);
    expect(c.open_rounds).toEqual({ fa: 1 });
    expect(c.data).toMatchObject({ u_amount: "500", u_legal: "بی‌اشکال", u_fin: "بودجه هست" });
  });

  it("join all: both branches settled before the executor runs leave the case active with no open step", async () => {
    const p = await publish(w, parallel(P.l, P.m, P.h));
    const id = (await start(w, P.r, p, { values: { u_amount: "500" } })).case!;
    await w.k.drain();
    await act(w, P.l, await openTask(w, id, "l", P.l), { values: { u_legal: "بی‌اشکال" } });
    await act(w, P.m, await openTask(w, id, "m", P.m), { values: { u_fin: "بودجه هست" } });
    const c = await kase(w, id);
    expect(c).toMatchObject({ state: "active", open_rounds: {} });
    expect(c.current_steps ?? []).toEqual([]);
    expect(c.progress.l).toMatchObject({ status: "done", round: 1 });
    expect(c.progress.m).toMatchObject({ status: "done", round: 1 });
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "active", open_rounds: { fa: 1 } });
  });

  it("join any with cancel_rest: the other branch's task is «دیگر لازم نیست» and its later submission is late", async () => {
    const p = await publish(w, parallel(P.l, P.m, P.h, "any"));
    const id = (await start(w, P.r, p, { values: { u_amount: "500" } })).case!;
    await w.k.drain();
    const slow = await openTask(w, id, "m", P.m);
    await act(w, P.l, await openTask(w, id, "l", P.l), { values: { u_legal: "اول رسید" } });
    await w.k.drain();
    const c = await kase(w, id);
    expect(c.open_rounds).toEqual({ fa: 1 });
    expect((await tasks(w, id)).find((t) => t.id === slow)?.status).toBe("not_needed");
    expect(c.progress.m).toMatchObject({ status: "canceled" });
    expect(c.participants).not.toContain(P.m);
    const late = await act(w, P.m, slow, { values: { u_fin: "دیر رسید" } });
    expect(late).toMatchObject({ result: "late", note: LATE_NOTE });
    expect((await submission(w, late.submission))?.values).toEqual({ u_fin: "دیر رسید" });
    expect((await kase(w, id)).data.u_fin).toBeUndefined();
  });

  it("a submission whose wait was withdrawn (the join committed, its cancel not run yet) is late and closes nothing", async () => {
    const p = await publish(w, parallel(P.l, P.m, P.h, "any"));
    const id = (await start(w, P.r, p, { values: { u_amount: "500" } })).case!;
    await w.k.drain();
    const t = await openTask(w, id, "m", P.m);
    await w.o.db.query(`delete from sm_flow_waits where key = $1`, [`pstep:${id}:m:1`]);
    expect(await act(w, P.m, t, { values: { u_fin: "دیر" } })).toMatchObject({ result: "late", note: LATE_NOTE });
    expect((await tasks(w, id)).find((x) => x.id === t)).toMatchObject({ status: "open", acted_by: null });
    expect((await kase(w, id)).data.u_fin).toBeUndefined();
  });

  it("merge: legal ∥ finance in both orders keeps both values", async () => {
    for (const order of [["l", "m"], ["m", "l"]] as const) {
      const p = await publish(w, parallel(P.l, P.m, P.h));
      const id = (await start(w, P.r, p, { values: { u_amount: "900" } })).case!;
      await w.k.drain();
      const who = { l: P.l, m: P.m } as const;
      const vals = { l: { u_legal: `حقوقی ${order[0]}` }, m: { u_fin: `مالی ${order[0]}` } } as const;
      for (const step of order) {
        await act(w, who[step], await openTask(w, id, step, who[step]), { values: vals[step] });
        await w.k.drain();
      }
      expect((await kase(w, id)).data).toEqual({ u_amount: "900", u_legal: `حقوقی ${order[0]}`, u_fin: `مالی ${order[0]}` });
    }
  });
});

describe("people", () => {
  it("nobody to assign → the case waits with the step open and a note; ifNobody «skip» passes the step", async () => {
    const gone = await person(w, "کارمند رفته");
    await w.o.db.query(`update sm_org_members set is_active = false where user_id = $1`, [gone]);
    const g = basic(gone, P.f);
    const p = await publish(w, g);
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    const c = await kase(w, id);
    expect(c).toMatchObject({ state: "waiting", open_rounds: { a: 1 }, current_steps: [{ key: "a", label: "تأیید رئیس شعبه" }] });
    expect((await tasks(w, id)).filter((t) => t.step_key === "a")).toEqual([]);
    // the journal says why nobody was found, and — this organisation's notices are not seeded yet — that nobody was told
    // (1.1.5: «مسئولان گردش‌کار باخبر شدند» only when the managers' notice reaches someone; tests/process-owner-path.test.ts)
    expect(await journal(w, id)).toContain(
      "برای «تأیید رئیس شعبه» کسی پیدا نشد؛ مرحله منتظر مسئولان گردش‌کار می‌ماند (اعلان «مرحلهٔ بی‌انجام‌دهنده» روشن نیست و کسی باخبر نشد). ۱ نفر از افراد برگزیده عضو فعال سازمان نیست.",
    );
    expect(await w.o.db.one(`select key from sm_flow_waits where run_id = $1`, [c.run_ref])).toEqual({ key: `pstep:${id}:a:1` });

    const skip = basic(gone, P.f);
    Object.assign(skip.nodes.find((n) => n.id === "a")!.config, { ifNobody: "skip" });
    const id2 = (await start(w, P.r, await publish(w, skip), { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    const c2 = await kase(w, id2);
    expect(c2).toMatchObject({ state: "completed" });
    expect(c2.progress.a).toMatchObject({ status: "skipped", port: "approved" });
  });

  it("quorum all: the round settles when both approved; a delegate acts for the approver", async () => {
    const g = basic(P.a2, P.f);
    Object.assign(g.nodes.find((n) => n.id === "a")!.config, { ...users(P.a2, P.a3), quorum: "all" });
    const p = await publish(w, g);
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    await w.sys.write((tx) => createIn(tx, w.sys, "delegation", { from_user: P.a3, to_user: P.d, scopes: ["approvals"], starts_at: new Date(Date.now() - 60_000).toISOString() }, { trusted: true }));
    await act(w, P.a2, await openTask(w, id, "a", P.a2), { outcome: "approved" });
    await w.k.drain();
    expect((await kase(w, id)).progress.a).toMatchObject({ status: "active", waiting: 1 });
    // the delegation started after the step opened: its task moved to the delegate (F4b's process.delegation)
    const moved = (await tasks(w, id)).find((t) => t.step_key === "a" && t.status === "open")!;
    expect([moved.assigned_to, moved.delegated_from]).toEqual([P.d, P.a3]);
    const r = await act(w, P.d, moved.id, { outcome: "approved" });
    expect((await submission(w, r.submission))?.on_behalf_of).toBe(P.a3);
    await w.k.drain();
    const c = await kase(w, id);
    expect(c.state).toBe("completed");
    expect((await tasks(w, id)).filter((t) => t.step_key === "a").map((t) => `${t.acted_by === P.d ? "d" : "a2"}:${t.acted_for === P.a3 ? "for-a3" : "-"}`).sort()).toEqual(["a2:-", "d:for-a3"]);
    expect(await journal(w, id)).toContain("داوود جانشین «تأیید رئیس شعبه» را تأیید کرد (به جانشینی از اکبر تأییدکننده)");
  });

  it("quorum all after a «بازگشت»: the returning step opens again by its rules, so both approvers must approve", async () => {
    const h = await person(w, "هادی تأییدکننده");
    const a2 = await person(w, "امید تأییدکننده");
    const g = basic(h, P.f);
    Object.assign(g.nodes.find((n) => n.id === "a")!.config, { ...users(h, a2), quorum: "all" });
    const p = await publish(w, g);
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    await act(w, h, await openTask(w, id, "a", h), { outcome: "returned", comment: "مبلغ را اصلاح کنید" });
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "s" && t.round === 2).map((t) => t.assigned_to)).toEqual([P.r]);
    await act(w, P.r, await openTask(w, id, "s", P.r), { values: { u_amount: "200" } });
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "a" && t.round === 2).map((t) => t.assigned_to).sort()).toEqual([h, a2].sort());
    await act(w, h, await openTask(w, id, "a", h), { outcome: "approved" });
    await w.k.drain();
    expect((await kase(w, id)).progress.a).toMatchObject({ status: "active", round: 2, waiting: 1 });
    await act(w, a2, await openTask(w, id, "a", a2), { outcome: "approved" });
    await w.k.drain();
    expect((await kase(w, id)).state).toBe("completed");
  });

  it("a step a «بازگشت» reopens goes to the person a delegate acted for, through today's delegations", async () => {
    const x = await person(w, "ثریا کارشناس");
    const d = await person(w, "دلارام جانشین");
    const d2 = await person(w, "دانیال جانشین");
    const g: ProcessGraph = {
      nodes: [
        node("t", "trigger"),
        startStep(),
        node("f", "form_step", { action: "fill", form: F.legal, rights: rights("read", { u_legal: "required" }), ...users(x) }, "نظر کارشناس"),
        node("a", "form_step", { action: "approve", form: F.review, rights: rights("read"), ...users(P.h) }, "تأیید"),
        node("ok", "end"),
        node("no", "end", { outcome: "rejected" }),
      ],
      edges: [edge("t", "s"), edge("s", "f"), edge("f", "a"), edge("a", "ok", "approved"), edge("a", "no", "rejected"), edge("a", "f", "returned")],
    };
    const p = await publish(w, g);
    const since = new Date(Date.now() - 60_000).toISOString();
    const old = await w.sys.write((tx) => createIn(tx, w.sys, "delegation", { from_user: x, to_user: d, scopes: ["assignments"], starts_at: since }, { trusted: true }));
    const id = (await start(w, P.r, p, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    await act(w, d, await openTask(w, id, "f", d), { values: { u_legal: "بی‌اشکال" } });
    await w.k.drain();
    expect((await tasks(w, id)).find((t) => t.step_key === "f")).toMatchObject({ acted_by: d, acted_for: x });
    // d's delegation ends and x hands over to d2
    await w.sys.write(async (tx) => {
      await updateIn(tx, w.sys, "delegation", String(old.id), { ends_at: new Date(Date.now() - 1000).toISOString() }, { trusted: true });
      await createIn(tx, w.sys, "delegation", { from_user: x, to_user: d2, scopes: ["assignments"], starts_at: since }, { trusted: true });
    });
    await act(w, P.h, await openTask(w, id, "a", P.h), { outcome: "returned", comment: "نظر را کامل کنید" });
    await w.k.drain();
    const round2 = (await tasks(w, id)).filter((t) => t.step_key === "f" && t.round === 2);
    expect(round2.map((t) => [t.assigned_to, t.delegated_from])).toEqual([[d2, x]]);
    expect((await kase(w, id)).participants).toEqual(expect.arrayContaining([x, d2]));
  });

  it("starters: someone the version does not name cannot start a case", async () => {
    const p = await publish(w, basic(P.h, P.f), { starters: [{ kind: "users", users: [P.r] }] });
    await expect(start(w, P.x, p, { values: { u_amount: "1" } })).rejects.toMatchObject({ status: 409, message: "شما اجازهٔ آغاز این گردش‌کار را ندارید" });
    expect((await start(w, P.r, p, { values: { u_amount: "1" } })).result).toBe("applied");
  });
});

describe("submissions", () => {
  it("a start is applied once; another start with the same case id is late", async () => {
    const p = await publish(w, basic(P.h, P.f));
    const caseId = uuidv7();
    const row = { kind: "start", process_id: p.process, case_id: caseId, values: { u_amount: "10" }, submitted_by: P.r, submitted_at: new Date().toISOString() };
    const sub = await w.sys.write((tx) => createIn(tx, w.sys, "process_submission", row, { trusted: true }));
    const first = await w.sys.write((tx) => applySubmission(tx, w.sys, String(sub.id)));
    const again = await w.sys.write((tx) => applySubmission(tx, w.sys, String(sub.id)));
    expect(first).toMatchObject({ result: "applied", caseId });
    expect(again).toMatchObject({ result: "applied", caseId });
    const other = await w.sys.write((tx) => createIn(tx, w.sys, "process_submission", row, { trusted: true }));
    expect(await w.sys.write((tx) => applySubmission(tx, w.sys, String(other.id)))).toMatchObject({ result: "late", note: "این پرونده پیش‌تر ثبت شده است" });
    expect(await w.o.db.query(`select id from sm_process_cases where id = $1`, [caseId])).toHaveLength(1);
    expect(await w.o.db.query(`select id from sm_flow_runs where trigger_record_id = $1`, [caseId])).toHaveLength(1);
  });

  it("a start filled on an older version runs that version but takes the current version's starters and access settings", async () => {
    const v1 = await publish(w, basic(P.h, P.f));
    await publish(w, basic(P.h, P.f), { process: v1.process, starters: [{ kind: "users", users: [P.a2] }], managers: [P.h], confidential: true });
    const startOn = async (user: string) => {
      const row = { kind: "start", process_id: v1.process, version_id: v1.version, case_id: uuidv7(), values: { u_amount: "10" }, submitted_by: user, submitted_at: new Date().toISOString() };
      const sub = await w.sys.write((tx) => createIn(tx, w.sys, "process_submission", row, { trusted: true }));
      return w.sys.write((tx) => applySubmission(tx, w.sys, String(sub.id)));
    };
    expect(await startOn(P.r)).toMatchObject({ result: "refused", note: "شما اجازهٔ آغاز این گردش‌کار را ندارید" });
    const ok = await startOn(P.a2);
    expect(ok).toMatchObject({ result: "applied" });
    const c = await w.o.db.one<{ version_id: string; managers: string[]; confidential: boolean }>(`select version_id, managers, confidential from sm_process_cases where id = $1`, [ok.caseId]);
    expect(c).toMatchObject({ version_id: v1.version, managers: [P.h], confidential: true });
  });

  it("files: the submission's files are copied to the case and the value names the copies", async () => {
    const p = await publish(w, basic(P.h, P.f));
    const r = await start(w, P.r, p, { values: { u_amount: "10", u_invoice: [{ upload: 0 }] }, files: [{ name: "پیش‌فاکتور.png", data: PNG }] });
    const c = await kase(w, r.case!);
    const own = await w.o.db.query<{ id: string }>(`select id from sm_attachments where table_key = 'process_submission' and record_id = $1`, [r.submission]);
    const copies = await w.o.db.query<{ id: string; name: string }>(`select id, name from sm_attachments where table_key = 'process_case' and record_id = $1`, [c.id]);
    expect(copies).toHaveLength(1);
    expect(copies[0].name).toBe("پیش‌فاکتور.png");
    expect(copies[0].id).not.toBe(own[0].id);
    expect(c.data.u_invoice).toEqual([copies[0].id]);
    // a file of another record is refused
    await expect(start(w, P.r, p, { values: { u_amount: "10", u_invoice: [copies[0].id] } })).rejects.toMatchObject({ status: 400 });
  });

  it("cancel: the requester cancels before any step after the start; later they cannot", async () => {
    const p = await publish(w, basic(P.h, P.f));
    const id = (await start(w, P.r, p, { values: { u_amount: "10" } })).case!;
    await w.k.drain();
    await expect(cancel(w, P.x, id)).rejects.toMatchObject({ status: 409, message: "پرونده را فقط درخواست‌دهنده لغو می‌کند" });
    expect((await cancel(w, P.r, id, "منصرف شدم")).result).toBe("applied");
    await w.k.drain();
    const c = await kase(w, id);
    expect(c).toMatchObject({ state: "canceled", outcome: "canceled" });
    expect([c.current_steps ?? [], c.open_rounds ?? {}]).toEqual([[], {}]);
    expect((await tasks(w, id)).find((t) => t.step_key === "a")?.status).toBe("canceled");
    expect(await w.o.db.one(`select state from sm_flow_runs where id = $1`, [c.run_ref])).toEqual({ state: "canceled" });

    const id2 = (await start(w, P.r, p, { values: { u_amount: "10" } })).case!;
    await w.k.drain();
    await act(w, P.h, await openTask(w, id2, "a", P.h), { outcome: "returned", comment: "اصلاح" });
    await w.k.drain();
    await expect(cancel(w, P.r, id2)).rejects.toMatchObject({ status: 409, message: "پس از انجام نخستین مرحله، پرونده را فقط مسئولان گردش‌کار لغو می‌کنند" });
  });

  it("a retired field: a case on an old version still shows and accepts it", async () => {
    const g: ProcessGraph = {
      nodes: [
        node("t", "trigger"),
        node("s", "form_step", { action: "fill", start: true, form: F.old, rights: rights("edit") }),
        node("e", "form_step", { action: "fill", form: F.old, rights: rights("edit"), ...users(P.f) }, "تکمیل"),
        node("ok", "end"),
      ],
      edges: [edge("t", "s"), edge("s", "e"), edge("e", "ok")],
    };
    const p = await publish(w, g, { forms: [F.old] });
    const id = (await start(w, P.r, p, { values: { u_amount: "10", u_old: "پیش از بازنشستگی" } })).case!;
    await w.k.drain();
    const lib = await w.o.owner.get(`${w.P}/fields/library`);
    const old = (lib.fields ?? lib.rows ?? []).find((f: { name: string }) => f.name === "u_old");
    await w.o.owner.patch(`${w.P}/fields/library/${old.id}`, { status: "retired" });
    // a new publish refuses it; the running case's version keeps it in its snapshot
    await expect(publish(w, g, { forms: [F.old] })).rejects.toThrow();
    const version = await w.o.db.one<{ forms: { fields: Record<string, unknown> } }>(`select forms from sm_process_versions where id = $1`, [p.version]);
    expect(Object.keys(version!.forms.fields)).toContain("u_old");
    await act(w, P.f, await openTask(w, id, "e", P.f), { values: { u_old: "پس از بازنشستگی" } });
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "completed", data: { u_old: "پس از بازنشستگی" } });
  });
});

describe("where cases run", () => {
  it("a Windows app linked to the web version only records the submission («در صف ارسال»)", async () => {
    expect(await processesRunHere(w.o.cfg, w.o.org)).toBe(true);
    const linked = { ...w.o.cfg, mode: "desktop", desktop: { info: async () => ({ cloud: { linked: true, org_id: w.o.org } }), notifyLocalWrite: () => undefined } } as unknown as typeof w.o.cfg;
    expect(await processesRunHere(linked, w.o.org)).toBe(false);
    const p = await publish(w, basic(P.h, P.f));
    const ctx = { ...(await w.o.ctxOf(P.r)), cfg: linked };
    const r = await startCase(ctx, { process: p.process, values: { u_amount: "10" } });
    expect(r).toMatchObject({ result: "pending" });
    expect(await w.o.db.query(`select id from sm_process_cases where id = $1`, [r.case])).toEqual([]);
    expect(await submission(w, r.submission)).toMatchObject({ result: "pending", case_id: r.case });
  });
});

describe("quorum: the shared approval maths settle a round", () => {
  const t = (status: string, outcome: string | null = null, at = "2026-11-14T10:00:00Z") => ({ status, outcome, closed_at: status === "open" ? null : at }) as never;
  const approve = (quorum: string, threshold?: number) => ({ action: "approve" as const, quorum: quorum as never, threshold });
  it("any: the first approval settles; a rejection waits for the others", () => {
    expect(roundSettles(approve("any"), "approved", [t("done", "approved"), t("open")])).toBe("approved");
    expect(roundSettles(approve("any"), "rejected", [t("done", "rejected"), t("open")])).toBeNull();
    expect(roundSettles(approve("any"), "rejected", [t("done", "rejected"), t("done", "rejected")])).toBe("rejected");
  });
  it("all: everyone must approve; one rejection settles", () => {
    expect(roundSettles(approve("all"), "approved", [t("done", "approved"), t("open")])).toBeNull();
    expect(roundSettles(approve("all"), "approved", [t("done", "approved"), t("done", "approved")])).toBe("approved");
    expect(roundSettles(approve("all"), "rejected", [t("done", "rejected"), t("open")])).toBe("rejected");
  });
  it("count and percent: thresholds", () => {
    const three = (a: number) => [...Array(a)].map(() => t("done", "approved")).concat([...Array(3 - a)].map(() => t("open")));
    expect(roundSettles(approve("count", 2), "approved", three(1))).toBeNull();
    expect(roundSettles(approve("count", 2), "approved", three(2))).toBe("approved");
    expect(roundSettles(approve("percent", 60), "approved", three(1))).toBeNull();
    expect(roundSettles(approve("percent", 60), "approved", three(2))).toBe("approved");
    expect(roundSettles(approve("count", 2), "rejected", [t("done", "rejected"), t("done", "rejected"), t("open")])).toBe("rejected");
  });
  it("first: the earliest answer settles, approval or rejection; withdrawn tasks never count", () => {
    expect(roundSettles(approve("first"), "rejected", [t("done", "rejected"), t("open")])).toBe("rejected");
    expect(roundSettles(approve("first"), "approved", [t("done", "approved", "2026-11-14T09:00:00Z"), t("done", "rejected", "2026-11-14T10:00:00Z")])).toBe("approved");
    expect(roundSettles(approve("all"), "approved", [t("done", "approved"), t("not_needed")])).toBe("approved");
  });
  it("fill and review: the first submit settles; a «بازگشت» settles at once", () => {
    expect(roundSettles({ action: "fill" }, "submitted", [t("done", "submitted"), t("open")])).toBe("submitted");
    expect(roundSettles(approve("all"), "returned", [t("done", "returned"), t("open")])).toBe("returned");
  });
});
