// F4c — the people's side of «گردش‌کارها» (design F §5, §8.6, §3.6.7, §6.1) through the API:
//   · acceptance: an administrator publishes the §3.7 process through the API, a clerk starts it, and the branch head's
//     «کارتابل» shows its step and a record approval together — with the seeded notice «مرحله‌ای منتظر شماست»;
//   · one API call per user page: «کارتابل», «گردش‌کارهای من», the diagram with the start form, «پرونده‌ها», the case
//     (diagram statuses, my rights, redacted values, history) and its printable view carry what their pages show;
//   · a return reaches the requester with its notice; the case's values are cut to what each reader may read;
//   · a pool step taken by one is «در دست …» for the others; managers pause, resume, reassign and cancel, journaled and
//     audited, and nobody else may;
//   · delegated items show «به جانشینی از …» in the delegate's «کارتابل», for process steps and record approvals.
import { describe, it, expect, beforeAll } from "vitest";
import { create, createIn } from "@server/engine";
import { claimStep, seedNotices, submitStep } from "@server/modules/process/api";
import { PAUSED_NOTE } from "@server/modules/process/engine";
import { act, edge, journal, kase, node, openTask, tasks } from "./process-engine-helpers";
import { bank, pettyDraft, type Bank } from "./process-api-helpers";

let b: Bank;
let P = "";
let c1 = "";
const db = () => b.w.o.db;
const notices = (user: string) => db().query<{ title: string }>(`select title from sm_notifications where org_id = $1 and user_id = $2 order by created_at`, [b.w.o.org, user]).then((r) => r.map((n) => n.title));
const ctxOf = (u: string) => b.w.o.ctxOf(u);

beforeAll(async () => {
  b = await bank();
  P = b.w.P;
  await seedNotices(b.w.o.cfg, b.w.o.org);
}, 600_000);

describe("«کارتابل» (design F §5)", () => {
  it("acceptance: an administrator publishes the §3.7 process through the API", async () => {
    const own = b.w.o.owner;
    const made = await own.post(`${P}/process/defs`, { name: "درخواست تنخواهِ شعبه", key: "petty_cash", category: "مالی" }, 201);
    expect(made.can).toMatchObject({ write: true, publish: true });
    const saved = await own.put(`${P}/process/defs/${made.process.id}/draft`, { draft: pettyDraft(b, { managers: [b.M.mgr.userId] }) });
    expect(saved.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    const pub = await own.post(`${P}/process/defs/${made.process.id}/publish`, { note: "نسخهٔ نخست" });
    expect(pub).toMatchObject({ version: { version_no: 1 }, message: "نسخهٔ ۱ منتشر شد؛ پرونده‌های تازه با آن آغاز می‌شوند" });
    expect((await b.M.clerk.client.get(`${P}/process/mine`)).processes.map((x: { key: string }) => x.key)).toEqual(["petty_cash"]);
  });

  it("acceptance: a branch head's inbox shows a process step and a record approval together", async () => {
    const r = await b.M.clerk.client.post(`${P}/process/start`, { process: "petty_cash", values: { u_amount: "750000000", u_need: "دستگاه شمارش اسکناس", u_branch: b.U.vanak } }, 201);
    expect(r).toMatchObject({ result: "applied" });
    c1 = r.case;
    await b.w.k.drain();
    const todo = await b.w.k.todo({ short_description: "خرید صندوق امانات" });
    await b.w.o.owner.post(`${P}/approvals/record/todo/${todo.id}/request`, { users: [b.M.head.userId], name: "تأیید خرید" });
    const box = await b.M.head.client.get(`${P}/process/inbox`);
    expect(box.rows.map((x: { kind: string }) => x.kind).sort()).toEqual(["process_step", "record_approval"]);
    const step = box.rows.find((x: { kind: string }) => x.kind === "process_step");
    expect(step).toMatchObject({ case_id: c1, step: "تأیید رئیس شعبه", source: "درخواست تنخواهِ شعبه", action: "approve", from: b.M.clerk.userId, on_behalf_of: null, can_act: true, link: `workflows/c/${c1}/s/${step.id}` });
    expect(box.rows.find((x: { kind: string }) => x.kind === "record_approval")).toMatchObject({ table: "todo", record_id: todo.id, action: "approve", can_act: true });
    expect(box).toMatchObject({ counts: { waiting: 2, steps: 1, approvals: 1 }, default_tab: "inbox", chips: [{ name: "درخواست تنخواهِ شعبه", count: 1 }] });
    expect(box.display[b.M.clerk.userId]).toBe("سارا کارمند باجه");
    expect(await b.M.head.client.get(`${P}/process/inbox/count`)).toEqual({ count: 2 });
    // the seeded rule told the head
    expect(await notices(b.M.head.userId)).toContain("مرحله‌ای منتظر شماست: «تأیید رئیس شعبه»");
  });

  it("one call per page: the case, the diagram, «گردش‌کارهای من» and «پرونده‌ها» carry what their pages show", async () => {
    const head = b.M.head.client;
    const d = await head.get(`${P}/process/cases/${c1}`);
    expect(d.case).toMatchObject({ id: c1, state: "active", process_name: "درخواست تنخواهِ شعبه", requested_by: b.M.clerk.userId, title: "تنخواه شعبهٔ ونک — ۷۵۰٬۰۰۰٬۰۰۰ ریال" });
    expect(d.statuses).toMatchObject({ s: { status: "done" }, a1: { status: "mine_open" } });
    expect(d.my_steps).toHaveLength(1);
    expect(d.my_steps[0]).toMatchObject({
      step_key: "a1", label: "تأیید رئیس شعبه", outcomes: ["approved", "rejected", "returned"],
      return_targets: [{ key: "s", label: "ثبت درخواست", default: true, to: b.M.clerk.userId }],
      rights: { u_amount: "read", u_finance_note: "read" }, queued: false,
    });
    expect(d.data).toMatchObject({ u_amount: "750000000", u_need: "دستگاه شمارش اسکناس" });
    expect(d.can).toMatchObject({ cancel: false, manage: false });
    expect(d.history.tasks.map((t: { step_key: string; status: string }) => [t.step_key, t.status])).toEqual([["s", "done"], ["a1", "open"]]);
    expect(d.history.submissions[0]).toMatchObject({ kind: "start", submitted_by: b.M.clerk.userId, values: { u_amount: "750000000" } });
    expect(d.history.journal.length).toBeGreaterThan(0);
    expect(d.display[b.M.clerk.userId]).toBe("سارا کارمند باجه");
    expect(d.forms.forms[b.w.forms.review].name).toBe("فرم بررسی مالی");
    // the requester's diagram: the start form, its rights and the step it goes to
    const v = await b.M.clerk.client.get(`${P}/process/defs/petty_cash/view`);
    expect(v.steps.map((s: { key: string }) => s.key)).toEqual(["s", "a1", "a2", "pay"]);
    expect(v.steps[1]).toMatchObject({ label: "تأیید رئیس شعبه", people: ["نقش سازمانی: رئیس شعبه"], mine: false });
    expect(v.start).toMatchObject({ can_start: true, step: "s", next: "تأیید رئیس شعبه", form: { id: b.w.forms.req }, rights: { u_amount: "required", u_need: "edit" } });
    expect(v.start.fields.u_amount.label).toBe("مبلغ درخواستی");
    // the head's diagram: their step and the case that waits there
    const hv = await head.get(`${P}/process/defs/petty_cash/view`);
    expect(hv.steps.find((s: { key: string }) => s.key === "a1")).toMatchObject({ mine: true, queue: [{ case_id: c1 }] });
    expect(hv.start.can_start).toBe(false);
    // «گردش‌کارهای من»
    expect((await b.M.clerk.client.get(`${P}/process/mine`)).processes).toEqual([expect.objectContaining({ key: "petty_cash", parts: ["آغازکننده", "در ۱ پروندهٔ باز"], can_start: true, waiting: 0 })]);
    expect((await head.get(`${P}/process/mine`)).processes).toEqual([expect.objectContaining({ key: "petty_cash", parts: ["تأییدکننده در «تأیید رئیس شعبه»", "در ۱ پروندهٔ باز"], can_start: false, waiting: 1 })]);
    // «پرونده‌ها»: filters by process, state, step, requester, unit and «آغازشده توسط من»
    const list = async (q: string, who = b.M.clerk) => (await who.client.get(`${P}/process/cases?${q}`)).rows.map((r: { id: string }) => r.id);
    expect(await list("process=petty_cash&state=open")).toEqual([c1]);
    expect(await list("state=closed")).toEqual([]);
    expect(await list("mine=1")).toEqual([c1]);
    expect(await list(`step=a1`)).toEqual([c1]);
    expect(await list(`step=pay`)).toEqual([]);
    expect(await list(`unit=${b.U.vanak}`)).toEqual([c1]);
    expect(await list(`unit=${b.U.finance}`)).toEqual([]);
    expect(await list(`requester=${b.M.clerk.userId}`, b.M.head)).toEqual([c1]);
    // someone who takes no part: no case
    await b.M.deputy.client.get(`${P}/process/cases/${c1}`, 404);
    expect(await list("", b.M.deputy)).toEqual([]);
  });

  it("a return reaches the requester with its notice, and the decision is journaled", async () => {
    const a1 = (await b.M.head.client.get(`${P}/process/cases/${c1}`)).my_steps[0].id;
    const refused = await b.M.head.client.post(`${P}/process/tasks/${a1}/submit`, { outcome: "returned" }, 400);
    expect(refused.error.details.fields.comment).toBe("برای رد یا بازگشت، توضیح بنویسید");
    const r = await b.M.head.client.post(`${P}/process/tasks/${a1}/submit`, { outcome: "returned", comment: "شرح نیاز را کامل کنید" });
    expect(r.result).toBe("applied");
    await b.w.k.drain();
    const c = await kase(b.w, c1);
    expect(await notices(b.M.clerk.userId)).toContain(`پروندهٔ ${c.number} برای اصلاح به شما بازگشت`);
    const box = await b.M.clerk.client.get(`${P}/process/inbox`);
    expect(box.rows).toEqual([expect.objectContaining({ kind: "process_step", step: "ثبت درخواست", case_id: c1 })]);
    expect(await journal(b.w, c1)).toContain("حسین رئیس شعبه «تأیید رئیس شعبه» را برای اصلاح بازگرداند: شرح نیاز را کامل کنید");
    // the clerk sends it again; the head approves; finance deputies (750,000,000 > 500,000,000)
    const s2 = box.rows[0].id;
    await b.M.clerk.client.post(`${P}/process/tasks/${s2}/submit`, { values: { u_need: "دستگاه شمارش اسکناس برای باجه" } });
    await b.w.k.drain();
    await b.M.head.client.post(`${P}/process/tasks/${await openTask(b.w, c1, "a1", b.M.head.userId)}/submit`, { outcome: "approved" });
    await b.w.k.drain();
    // «انجام‌شده‌ها»: the head's two decisions, newest first
    expect((await b.M.head.client.get(`${P}/process/done`)).rows.map((x: { step: string; outcome: string; case_id: string }) => [x.step, x.outcome, x.case_id])).toEqual([
      ["تأیید رئیس شعبه", "approved", c1], ["تأیید رئیس شعبه", "returned", c1],
    ]);
    await act(b.w, b.X.fd1, await openTask(b.w, c1, "a2", b.X.fd1), { outcome: "approved" });
    await b.w.k.drain();
    expect((await tasks(b.w, c1)).filter((t) => t.step_key === "pay" && t.status === "open").map((t) => t.assigned_to).sort()).toEqual([b.X.pay1, b.X.pay2].sort());
  });
});

describe("pool steps and the managers' actions (design F §5, §6.1)", () => {
  it("a pool step one person took is «در دست …» for the others", async () => {
    const t1 = await openTask(b.w, c1, "pay", b.X.pay1);
    const t2 = await openTask(b.w, c1, "pay", b.X.pay2);
    expect(await claimStep(await ctxOf(b.X.pay1), t1)).toEqual({ claimed_by: b.X.pay1 });
    await expect(submitStep(await ctxOf(b.X.pay2), t2, { values: { u_finance_note: "پرداخت شد" } })).rejects.toMatchObject({ status: 409, message: "این مرحله در دست پریسا امور مالی است" });
    await expect(claimStep(await ctxOf(b.X.pay2), t2)).rejects.toMatchObject({ status: 409 });
    expect(await claimStep(await ctxOf(b.X.pay1), t1, { release: true })).toEqual({ claimed_by: null });
  });

  it("managers pause, resume and reassign — journaled and audited — and nobody else may", async () => {
    const mgr = b.M.mgr.client;
    expect((await b.M.head.client.post(`${P}/process/cases/${c1}/pause`, { comment: "بررسی" }, 403)).error.message).toBe("این کار با مسئولان این گردش‌کار است");
    await mgr.post(`${P}/process/cases/${c1}/pause`, { comment: "کسری بودجه" });
    expect(await kase(b.w, c1)).toMatchObject({ state: "waiting" });
    const t1 = await openTask(b.w, c1, "pay", b.X.pay1);
    await expect(submitStep(await ctxOf(b.X.pay1), t1, { values: { u_finance_note: "پرداخت" } })).rejects.toMatchObject({ status: 409, message: PAUSED_NOTE });
    expect((await mgr.get(`${P}/process/cases/${c1}`)).can).toMatchObject({ manage: true, pause: false, resume: true, reassign: true });
    await mgr.post(`${P}/process/cases/${c1}/resume`, {});
    expect(await kase(b.w, c1)).toMatchObject({ state: "active", paused_at: null });
    // reassign pay2's task to another member of finance
    const t2 = await openTask(b.w, c1, "pay", b.X.pay2);
    const r = await mgr.post(`${P}/process/cases/${c1}/reassign`, { step: "pay", task: t2, to: [b.X.fdOther], comment: "پرویز در مرخصی است" });
    expect(r.tasks).toHaveLength(1);
    const pay = (await tasks(b.w, c1)).filter((t) => t.step_key === "pay");
    expect(pay.find((t) => t.id === t2)?.status).toBe("not_needed");
    expect(pay.find((t) => t.assigned_to === b.X.fdOther)?.status).toBe("open");
    const notes = await journal(b.w, c1);
    expect(notes).toContain("مینا مسئول تنخواه (مسئول گردش‌کار) پرونده را موقتاً متوقف کرد: کسری بودجه");
    expect(notes).toContain("مینا مسئول تنخواه (مسئول گردش‌کار) «بررسی و پرداخت» را از پرویز امور مالی به فرید معاون مالی دیگر سپرد: پرویز در مرخصی است");
    expect((await db().query<{ action: string }>(`select action from sm_audit where org_id = $1 and entity_id = $2 order by at`, [b.w.o.org, c1])).map((a) => a.action)).toEqual(["process.pause", "process.resume", "process.reassign"]);
    await b.w.k.drain();
    expect(await notices(b.X.fdOther)).toContain("مرحله‌ای منتظر شماست: «بررسی و پرداخت»");
    // the new person completes it; the requester hears the case ended
    await act(b.w, b.X.fdOther, await openTask(b.w, c1, "pay", b.X.fdOther), { values: { u_finance_note: "از تنخواه پرداخت شد" } });
    await b.w.k.drain();
    const c = await kase(b.w, c1);
    expect(c).toMatchObject({ state: "completed" });
    expect(await notices(b.M.clerk.userId)).toContain(`پروندهٔ ${c.number} به پایان رسید`);
  });

  it("a step that finds nobody tells the managers («مرحلهٔ بی‌انجام‌دهنده»), and their «ارجاع» gives it people", async () => {
    const own = b.w.o.owner;
    await b.w.sys.write((tx) => createIn(tx, b.w.sys, "position", { key: "audit_head", name: "رئیس ممیزی" }, { trusted: true }));
    const F = b.w.forms;
    const draft = {
      graph: {
        nodes: [
          node("t", "trigger"),
          node("s", "form_step", { action: "fill", start: true, form: F.req, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
          node("n1", "form_step", { action: "approve", form: F.review, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "audit_head", where: "anywhere" }] }, "تأیید ممیزی"),
          node("ok", "end", { outcome: "completed" }), node("no", "end", { outcome: "rejected" }),
        ],
        edges: [edge("t", "s"), edge("s", "n1"), edge("n1", "ok", "approved"), edge("n1", "no", "rejected")],
      },
      starters: [], title_template: null, requester_view: [], managers: [b.M.mgr.userId], manager_groups: [], confidential: false,
    };
    const made = await own.post(`${P}/process/defs`, { name: "تأیید ممیزی", key: "audit_check" }, 201);
    await own.put(`${P}/process/defs/${made.process.id}/draft`, { draft });
    await own.post(`${P}/process/defs/${made.process.id}/publish`, {});
    const id = (await b.M.clerk.client.post(`${P}/process/start`, { process: "audit_check", values: { u_amount: "5000" } }, 201)).case as string;
    await b.w.k.drain();
    expect(await kase(b.w, id)).toMatchObject({ state: "waiting" });
    expect(await notices(b.M.mgr.userId)).toContain("برای «تأیید ممیزی» کسی پیدا نشد");
    await b.M.mgr.client.post(`${P}/process/cases/${id}/reassign`, { step: "n1", to: [b.M.head.userId] });
    expect(await kase(b.w, id)).toMatchObject({ state: "active" });
    expect(await journal(b.w, id)).toContain("مینا مسئول تنخواه (مسئول گردش‌کار) «تأیید ممیزی» را به حسین رئیس شعبه سپرد");
    await b.M.head.client.post(`${P}/process/tasks/${await openTask(b.w, id, "n1", b.M.head.userId)}/submit`, { outcome: "approved" });
    await b.w.k.drain();
    expect(await kase(b.w, id)).toMatchObject({ state: "completed" });
  });

  it("the printable view lists the decisions with names and dates, and the readable values as people read them", async () => {
    const p = await b.M.clerk.client.get(`${P}/process/cases/${c1}/print`);
    expect(p.case).toMatchObject({ finished: true, state: "انجام‌شده", outcome: "انجام‌شده", requested_by: "سارا کارمند باجه", process: "درخواست تنخواهِ شعبه" });
    expect(p.decisions.map((x: { step: string; outcome: string; by: string }) => [x.step, x.outcome, x.by])).toEqual([
      ["ثبت درخواست", "ثبت شد", "سارا کارمند باجه"],
      ["تأیید رئیس شعبه", "بازگشت برای اصلاح", "حسین رئیس شعبه"],
      ["ثبت درخواست", "ثبت شد", "سارا کارمند باجه"],
      ["تأیید رئیس شعبه", "تأیید شد", "حسین رئیس شعبه"],
      ["تأیید معاونت مالی", "تأیید شد", "فرهاد معاون مالی"],
      ["بررسی و پرداخت", "ثبت شد", "فرید معاون مالی دیگر"],
    ]);
    expect(p.decisions[1].comment).toBe("شرح نیاز را کامل کنید");
    expect(p.decisions[0].at_text).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}/);
    expect(p.values).toContainEqual({ field: "u_amount", label: "مبلغ درخواستی", text: "۷۵۰٬۰۰۰٬۰۰۰ ریال" });
    expect(p.values).toContainEqual({ field: "u_branch", label: "شعبه", text: "شعبهٔ ونک" });
    // the requester reads the start form's fields, not the finance note of a later step
    expect(p.values.map((v: { field: string }) => v.field)).not.toContain("u_finance_note");
    expect((await b.M.mgr.client.get(`${P}/process/cases/${c1}/print`)).values.map((v: { field: string }) => v.field)).toContain("u_finance_note");
  });

  it("a manager cancels any open case; the requester only before a step after the start was done", async () => {
    const start = async () => (await b.M.clerk.client.post(`${P}/process/start`, { process: "petty_cash", values: { u_amount: "1000000", u_branch: b.U.vanak } }, 201)).case as string;
    const own = await start();
    await b.w.k.drain();
    expect(await b.M.clerk.client.post(`${P}/process/cases/${own}/cancel`, { comment: "اشتباه ثبت شد" })).toMatchObject({ result: "applied", by: "requester" });
    await b.w.k.drain();
    expect(await kase(b.w, own)).toMatchObject({ state: "canceled" });
    const other = await start();
    await b.w.k.drain();
    await b.M.head.client.post(`${P}/process/tasks/${await openTask(b.w, other, "a1", b.M.head.userId)}/submit`, { outcome: "approved" });
    await b.w.k.drain();
    expect((await b.M.clerk.client.post(`${P}/process/cases/${other}/cancel`, {}, 409)).error.message).toBe("پس از انجام نخستین مرحله، پرونده را فقط مسئولان گردش‌کار لغو می‌کنند");
    expect(await b.M.mgr.client.post(`${P}/process/cases/${other}/cancel`, { comment: "بودجهٔ ماه تمام شد" })).toMatchObject({ by: "manager" });
    await b.w.k.drain();
    const c = await kase(b.w, other);
    expect(c).toMatchObject({ state: "canceled" });
    expect(await notices(b.M.clerk.userId)).toContain(`پروندهٔ ${c.number} لغو شد`);
    expect((await b.M.mgr.client.post(`${P}/process/cases/${other}/resume-from`, { node: "a1" }, 409)).error.message).toBe("فقط پرونده‌ای که متوقف شده است از مرحله‌ای دوباره ادامه می‌یابد");
  });
});

describe("delegation in «کارتابل» (design F §5)", () => {
  it("delegated items show «به جانشینی از …» for process steps and record approvals", async () => {
    const now = Date.now();
    await create(b.w.sys, "delegation", { from_user: b.M.head.userId, to_user: b.M.dlg.userId, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 3_600_000).toISOString(), scopes: ["approvals"] }, { trusted: true });
    const r = await b.M.clerk.client.post(`${P}/process/start`, { process: "petty_cash", values: { u_amount: "2000000", u_branch: b.U.vanak } }, 201);
    await b.w.k.drain();
    const box = await b.M.dlg.client.get(`${P}/process/inbox`);
    const step = box.rows.find((x: { kind: string; case_id: string }) => x.kind === "process_step" && x.case_id === r.case);
    expect(step).toMatchObject({ step: "تأیید رئیس شعبه", on_behalf_of: b.M.head.userId, can_act: true });
    expect(box.rows.find((x: { kind: string }) => x.kind === "record_approval")).toMatchObject({ on_behalf_of: b.M.head.userId });
    expect(box.display[b.M.head.userId]).toBe("حسین رئیس شعبه");
    // the delegate acts for the head
    await b.M.dlg.client.post(`${P}/process/tasks/${step.id}/submit`, { outcome: "approved" });
    await b.w.k.drain();
    expect((await tasks(b.w, r.case)).find((t) => t.step_key === "a1")).toMatchObject({ acted_by: b.M.dlg.userId, acted_for: b.M.head.userId });
  });
});
