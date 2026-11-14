// F4a acceptance (design F §3.7, §12 F4a): «درخواست تنخواهِ شعبه» runs end to end online on PGlite — published
// with the bank's organisational roles, started by a branch employee from a counter under the branch, approved by the
// branch head found up the unit tree, routed by the amount (over 500,000,000 Rial: the finance deputies, two named
// people, any one), paid by «امور مالی» with «نظر مالی» required; any «رد» ends it rejected and «بازگشت» reopens
// «ثبت درخواست» for the requester (round 2). The form's checks hold (at most 2 billion Rial, a date from today, up to
// three files), and only the starters may start it.
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { hasProcessErrors, stepStatuses, validateProcess, type ProcessGraph } from "@shared/process";
import { snapshotFields, readSnapshot } from "@shared/forms/snapshot";
import { localDate } from "@shared/model/jalali-buckets";
import { PNG } from "./engine-helpers";
import { act, edge, journal, kase, node, openTask, person, publish, start, tasks, world, type Published, type World } from "./process-engine-helpers";

let w: World;
const U: Record<string, string> = {};
const M: Record<string, string> = {};
let financeGroup: string;
let p: Published;
let graph: ProcessGraph;

const DAY = 86_400_000;
const today = (offset = 0) => localDate(Date.now() + offset * DAY, "Asia/Tehran");

async function unit(name: string, kind: string, parent?: string): Promise<string> {
  return String((await w.sys.write((tx) => createIn(tx, w.sys, "org_unit", { name, kind, parent_id: parent ?? null }, { trusted: true }))).id);
}
async function position(key: string, name: string, unitKind: string | null = null): Promise<void> {
  await w.sys.write((tx) => createIn(tx, w.sys, "position", { key, name, unit_kind: unitKind }, { trusted: true }));
}
async function holds(key: string, user: string, unitId: string | null): Promise<void> {
  const pos = (await w.o.db.one<{ id: string }>(`select id from sm_positions where org_id = $1 and key = $2`, [w.o.org, key]))!.id;
  await w.sys.write((tx) => createIn(tx, w.sys, "position_holder", { position_id: pos, user_id: user, org_unit_id: unitId, kind: "primary" }, { trusted: true }));
}

/** The §3.7 graph. */
function petty(): ProcessGraph {
  const F = w.forms;
  return {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: F.req, rights: { default: "edit", fields: {} } }),
      node("a1", "form_step", {
        action: "approve", form: F.review, rights: { default: "read", fields: {} }, quorum: "any",
        assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }],
        due: { amount: 1, unit: "day" }, escalate: [{ after: { amount: 2, unit: "day" }, action: "notify", to: "reports_to" }],
      }, "تأیید رئیس شعبه"),
      node("b", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }, "شرط مبلغ"),
      node("a2", "form_step", {
        action: "approve", form: F.review, rights: { default: "read", fields: {} }, quorum: "any",
        assignees: [{ kind: "position", position: "finance_deputy", where: "anywhere", members: [M.fd1, M.fd2] }],
      }, "تأیید معاونت مالی"),
      node("pay", "form_step", {
        action: "fill", form: F.review, rights: { default: "read", fields: { u_finance_note: "required" } },
        assignees: [{ kind: "group", group: financeGroup }],
      }, "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
      node("no", "end", { outcome: "rejected" }, "پایان (ردشده)"),
    ],
    edges: [
      edge("t", "s"), edge("s", "a1"),
      edge("a1", "b", "approved"), edge("a1", "no", "rejected"), edge("a1", "s", "returned"),
      edge("b", "a2", "yes"), edge("b", "pay", "no"),
      edge("a2", "pay", "approved"), edge("a2", "no", "rejected"), edge("a2", "s", "returned"),
      edge("pay", "ok"),
    ],
  };
}

beforeAll(async () => {
  w = await world();
  U.hq = await unit("بانک آفتاب", "company");
  U.north = await unit("مدیریت شعب شمال", "division", U.hq);
  U.vanak = await unit("شعبهٔ ونک", "branch", U.north);
  U.counter = await unit("باجهٔ ونک", "team", U.vanak);
  U.finance = await unit("ادارهٔ مالی", "department", U.hq);
  M.clerk = await person(w, "سارا کارمند باجه", { unit: U.counter });
  M.deputy = await person(w, "بهرام معاون شعبه", { unit: U.vanak });
  M.head = await person(w, "حسین رئیس شعبه", { unit: U.vanak });
  M.fd1 = await person(w, "فرهاد معاون مالی", { unit: U.finance });
  M.fd2 = await person(w, "فریبا معاون مالی", { unit: U.finance });
  M.fdOther = await person(w, "فرید معاون مالی دیگر", { unit: U.finance });
  M.pay1 = await person(w, "پریسا امور مالی", { unit: U.finance });
  M.pay2 = await person(w, "پرویز امور مالی", { unit: U.finance });
  M.outsider = await person(w, "اکرم بیرون از شعبه", { unit: U.finance });
  await position("branch_staff", "کارمند شعبه");
  await position("branch_deputy", "معاون شعبه");
  await position("branch_head", "رئیس شعبه", "branch");
  await position("finance_deputy", "معاون مالی");
  await holds("branch_staff", M.clerk, U.counter);
  await holds("branch_deputy", M.deputy, U.vanak);
  await holds("branch_head", M.head, U.vanak);
  for (const u of [M.fd1, M.fd2, M.fdOther]) await holds("finance_deputy", u, U.finance);
  financeGroup = String((await w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "امور مالی", types: ["assignment"] }, { trusted: true }))).id);
  await w.sys.write(async (tx) => {
    for (const u of [M.pay1, M.pay2]) await createIn(tx, w.sys, "group_member", { group_id: financeGroup, user_id: u, kind: "member" }, { trusted: true });
  });
  graph = petty();
  p = await publish(w, graph, {
    name: "درخواست تنخواهِ شعبه",
    forms: [w.forms.req, w.forms.review],
    starters: [{ kind: "position", position: "branch_staff", where: "anywhere" }, { kind: "position", position: "branch_deputy", where: "anywhere" }],
    title: "تنخواه {{case.u_branch}} — {{case.u_amount}}",
  });
}, 600_000);

describe("«درخواست تنخواهِ شعبه» (§3.7) end to end", () => {
  it("is a valid process for its forms", async () => {
    const v = await w.o.db.one<{ forms: unknown }>(`select forms from sm_process_versions where id = $1`, [p.version]);
    const snap = readSnapshot(v!.forms)!;
    const problems = validateProcess(graph, { forms: (id) => snap.forms[id], fields: snapshotFields(snap), titleTemplate: "تنخواه {{case.u_branch}} — {{case.u_amount}}" });
    expect(hasProcessErrors(problems)).toBe(false);
  });

  it("a large amount: branch head → finance deputies (any one) → «امور مالی» → completed, with the invoice on the case", async () => {
    const r = await start(w, M.clerk, p, {
      values: { u_amount: "750000000", u_need: "خرید دستگاه شمارش اسکناس", u_date: today(3), u_branch: U.vanak, u_invoice: [{ upload: 0 }] },
      files: [{ name: "پیش‌فاکتور.png", data: PNG }],
    });
    expect(r.result).toBe("applied");
    const id = r.case!;
    await w.k.drain();
    let c = await kase(w, id);
    expect(c.title).toBe("تنخواه شعبهٔ ونک — ۷۵۰٬۰۰۰٬۰۰۰ ریال");
    // the branch head is found up the tree from the counter; the step is due in one business day
    const a1 = (await tasks(w, id)).filter((t) => t.step_key === "a1");
    expect(a1.map((t) => t.assigned_to)).toEqual([M.head]);
    expect(Date.parse(a1[0].due_at!)).toBeGreaterThan(Date.now());
    await act(w, M.head, a1[0].id, { outcome: "approved", comment: "تأیید می‌شود" });
    await w.k.drain();

    // over 500,000,000: the two named finance deputies (not the third holder), any one of them
    const a2 = (await tasks(w, id)).filter((t) => t.step_key === "a2");
    expect(a2.map((t) => t.assigned_to).sort()).toEqual([M.fd1, M.fd2].sort());
    await act(w, M.fd2, await openTask(w, id, "a2", M.fd2), { outcome: "approved" });
    await w.k.drain();
    expect((await tasks(w, id)).find((t) => t.step_key === "a2" && t.assigned_to === M.fd1)?.status).toBe("not_needed");

    // «امور مالی»: the first to submit settles it; «نظر مالی» is required
    expect((await tasks(w, id)).filter((t) => t.step_key === "pay").map((t) => t.assigned_to).sort()).toEqual([M.pay1, M.pay2].sort());
    const payTask = await openTask(w, id, "pay", M.pay1);
    await expect(act(w, M.pay1, payTask, {})).rejects.toMatchObject({ status: 400 });
    await act(w, M.pay1, payTask, { values: { u_finance_note: "از تنخواه شعبه پرداخت شد" } });
    await w.k.drain();

    c = await kase(w, id);
    expect(c).toMatchObject({ state: "completed", outcome: "completed" });
    expect(c.data).toMatchObject({ u_amount: "750000000", u_branch: U.vanak, u_finance_note: "از تنخواه شعبه پرداخت شد" });
    const files = await w.o.db.query<{ id: string }>(`select id from sm_attachments where table_key = 'process_case' and record_id = $1`, [id]);
    expect(c.data.u_invoice).toEqual(files.map((f) => f.id));
    expect((await tasks(w, id)).find((t) => t.step_key === "pay" && t.assigned_to === M.pay2)?.status).toBe("not_needed");
    const view = stepStatuses({ graph }, c, [], null);
    expect(view).toMatchObject({ a1: { status: "done", outcome: "approved" }, a2: { status: "done", outcome: "approved" }, pay: { status: "done" }, ok: { status: "done" }, no: { status: "skipped" } });
    const notes = await journal(w, id);
    expect(notes).toContain("حسین رئیس شعبه «تأیید رئیس شعبه» را تأیید کرد: تأیید می‌شود");
    expect(notes).toContain("فریبا معاون مالی «تأیید معاونت مالی» را تأیید کرد");
  });

  it("a small amount goes straight to «امور مالی»; a return reopens «ثبت درخواست» for the requester (round 2)", async () => {
    const id = (await start(w, M.deputy, p, { values: { u_amount: "300000000", u_branch: U.vanak } })).case!;
    await w.k.drain();
    await act(w, M.head, await openTask(w, id, "a1", M.head), { outcome: "returned", comment: "شرح نیاز را بنویسید" });
    await w.k.drain();
    const round2 = (await tasks(w, id)).filter((t) => t.step_key === "s" && t.round === 2);
    expect(round2.map((t) => [t.assigned_to, t.status])).toEqual([[M.deputy, "open"]]);
    expect((await kase(w, id)).state).toBe("active");
    await act(w, M.deputy, round2[0].id, { values: { u_need: "پذیرایی جلسهٔ مشتریان" } });
    await w.k.drain();
    await act(w, M.head, await openTask(w, id, "a1", M.head), { outcome: "approved" });
    await w.k.drain();
    expect((await tasks(w, id)).filter((t) => t.step_key === "a2")).toEqual([]);
    await act(w, M.pay2, await openTask(w, id, "pay", M.pay2), { values: { u_finance_note: "پرداخت" } });
    await w.k.drain();
    const c = await kase(w, id);
    expect(c).toMatchObject({ state: "completed", data: { u_amount: "300000000", u_need: "پذیرایی جلسهٔ مشتریان" } });
    expect(c.progress.b).toMatchObject({ status: "done", port: "no" });
  });

  it("«رد» by the finance deputies ends the case rejected (rule any: one rejection leaves the other to decide)", async () => {
    const id = (await start(w, M.clerk, p, { values: { u_amount: "900000000" } })).case!;
    await w.k.drain();
    await act(w, M.head, await openTask(w, id, "a1", M.head), { outcome: "approved" });
    await w.k.drain();
    await act(w, M.fd1, await openTask(w, id, "a2", M.fd1), { outcome: "rejected", comment: "سقف تنخواه رعایت نشده است" });
    await w.k.drain();
    expect((await kase(w, id)).progress.a2).toMatchObject({ status: "active", waiting: 1 });
    await act(w, M.fd2, await openTask(w, id, "a2", M.fd2), { outcome: "rejected", comment: "موافق نیستم" });
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "rejected", outcome: "rejected" });
  });

  it("the form's checks and the starters hold", async () => {
    await expect(start(w, M.clerk, p, { values: { u_amount: "2000000001" } })).rejects.toMatchObject({ status: 400, details: { fields: { u_amount: expect.any(String) } } });
    await expect(start(w, M.clerk, p, { values: { u_amount: "1000", u_date: today(-1) } })).rejects.toMatchObject({ status: 400, details: { fields: { u_date: expect.any(String) } } });
    await expect(start(w, M.clerk, p, { values: { u_need: "بی مبلغ" } })).rejects.toMatchObject({ status: 400, details: { fields: { u_amount: "«مبلغ درخواستی» را وارد کنید" } } });
    await expect(start(w, M.outsider, p, { values: { u_amount: "1000" } })).rejects.toMatchObject({ status: 409, message: "شما اجازهٔ آغاز این گردش‌کار را ندارید" });
  });
});
