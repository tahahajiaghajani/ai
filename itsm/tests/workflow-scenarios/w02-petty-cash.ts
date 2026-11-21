// W2 «درخواست تنخواه شعبه» — the guide's example (docs/modules/workflows_FA.md): «نزدیک‌ترین واحد بالادست» of kind
// branch with a fallback to the branch's head, «تأیید» with quorum «هرکدام», a numeric condition, a review with
// required fields that can return to the start step, rejection, deadlines with a reports_to escalation and the
// «پایان مهلت» port on the approval and on the returned start step, showIf, money/date/attachment fields, a title,
// requester_view and separation of duties. Runs R1–R7 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, DAY, e, H, item, n, note, PNG, section, tab, tehranDay, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W2 = { key: "aftab_petty_cash", name: "درخواست تنخواه شعبه" };

export function w2Draft(s: Scn): Draft {
  const F = s.forms.pc;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_pc_finance_note: "hidden", u_aftab_pc_paid_ref: "hidden" } }, due: { amount: 3, unit: "day" } }, "ثبت درخواست"),
        n("head", "form_step", {
          action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} },
          assignees: [{ kind: "position", position: "aftab_branch_head", where: "requester_unit_up", unitKind: "branch" }],
          fallback: [{ kind: "unit_head", of: "requester", unitKind: "branch" }],
          ifNobody: "managers", due: { amount: 1, unit: "day" }, business: true,
          escalate: [{ after: { amount: 4, unit: "hour" }, action: "notify", to: "reports_to" }],
        }, "تأیید رئیس شعبه"),
        n("cond", "branch", { mode: "data", rules: [{ left: "{{case.u_aftab_pc_amount}}", op: "gt", right: "50000000" }], match: "all" }, "مبلغ بیش از ۵۰ میلیون؟"),
        n("fin", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "aftab_finance_deputy", where: "anywhere" }] }, "تأیید معاونت مالی"),
        n("pay", "form_step", { action: "review", form: F, rights: { default: "read", fields: { u_aftab_pc_finance_note: "required", u_aftab_pc_paid_ref: "required" } }, assignees: [{ kind: "group", group: s.g("branch_finance") }] }, "بررسی و پرداخت"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
        n("expired", "end", { outcome: "canceled" }, "پایان (منقضی)"),
      ],
      edges: [
        e("start", "request"), e("request", "head"), e("request", "expired", "timeout"),
        e("head", "cond", "approved"), e("head", "rej", "rejected"), e("head", "request", "returned"), e("head", "expired", "timeout"),
        e("cond", "fin", "yes"), e("cond", "pay", "no"),
        e("fin", "pay", "approved"), e("fin", "rej", "rejected"),
        e("pay", "done"), e("pay", "request", "returned"),
      ],
    },
    starters: [{ kind: "users", users: s.ids("yaser", "somayeh", "negar") }],
    title_template: "تنخواه {{case.u_aftab_pc_amount}} — {{case.requested_by}}",
    requester_view: ["u_aftab_pc_paid_ref", "u_aftab_pc_finance_note"],
    managers: s.ids("mehrdad"),
  };
}

export async function setupW2(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  await s.person("yaser", "یاسر اموالی", { unit: "b0", ...demo });
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", ...demo });
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", ...demo });
  await s.person("parvaneh", "پروانه منابعی", { unit: "hr", ...demo });
  await s.person("mehrdad", "مهرداد بودجه‌نژاد", { unit: "fin", ...demo });
  await s.person("fd2", "فرزانه حسابداری", { unit: "fin", ...demo });
  await s.person("fa1", "علی خزانه", { unit: "fin", ...demo });
  await s.person("fa2", "زهرا پرداخت", { unit: "fin", ...demo });
  await s.person("ph_alborz", "حمید استان‌دار البرز", { unit: "alborz", ...demo });
  await s.person("ph_lorestan", "کریم استان‌دار لرستان", { unit: "lorestan", ...demo });
  // the branches' own heads (the unit's «مدیر واحد») and the holders of «رئیس شعبه» in the other branches
  for (const b of ["b0", "b1", "b2", "b3", "b4", "b5"]) {
    await s.person(`bm_${b}`, `رئیس واحد ${b}`, { unit: b, ...demo });
    await s.unitHead(b, `bm_${b}`);
  }
  await s.field("u_aftab_pc_amount", "مبلغ درخواستی", "money", { validation: { max: 2_000_000_000 } });
  await s.field("u_aftab_pc_need_date", "تاریخ نیاز", "date", { validation: { minDate: "$today" } });
  await s.field("u_aftab_pc_reason", "شرح نیاز", "text");
  await s.field("u_aftab_pc_invoice", "فاکتور پیش", "attachment", { validation: { max: 3 } });
  await s.field("u_aftab_pc_finance_note", "نظر مالی", "text");
  await s.field("u_aftab_pc_paid_ref", "شمارهٔ سند پرداخت", "string");
  await s.form("pc", "فرم تنخواه شعبه", [
    tab("درخواست", [
      section("مبلغ و تاریخ", [item("u_aftab_pc_amount", { required: true }), item("u_aftab_pc_need_date")], 2),
      section("شرح و پیوست", [item("u_aftab_pc_reason"), item("u_aftab_pc_invoice", { showIf: { f: "u_aftab_pc_amount", op: "gt", v: 10_000_000 } }), note("برای مبلغ بیش از ۱۰ میلیون فاکتور لازم است", "warning")]),
    ]),
    tab("امور مالی", [section("بررسی", [item("u_aftab_pc_finance_note"), item("u_aftab_pc_paid_ref")])]),
  ]);
  await s.position("aftab_province_head", "مدیر امور شعب استان", { unitKind: "division" });
  await s.position("aftab_branch_head", "رئیس شعبه", { unitKind: "branch", reportsTo: "aftab_province_head" });
  await s.position("aftab_finance_deputy", "معاون مالی", { unitKind: "department" });
  await s.hold("aftab_branch_head", "somayeh", "b0");
  for (const b of ["b1", "b2", "b3", "b4", "b5"]) await s.hold("aftab_branch_head", `bm_${b}`, b);
  await s.hold("aftab_province_head", "ph_alborz", "alborz");
  await s.hold("aftab_province_head", "ph_lorestan", "lorestan");
  await s.hold("aftab_finance_deputy", "mehrdad", "fin");
  await s.hold("aftab_finance_deputy", "fd2", "fin");
  await s.group("branch_finance", "امور مالی شعب", ["mehrdad", "fa1", "fa2"]);
  // RC4: «نزدیک‌ترین واحد بالادست» with holders at two levels — the pack's branch head, and a real head of the province
  await s.person("rh", "رئیس حوزهٔ البرز", { unit: "alborz" });
  await s.person("realemp", "کارمند واقعی شعبه", { unit: "b0" });
  await s.position("aftab_area_head", "رئیس حوزه");
  await s.hold("aftab_area_head", "somayeh", "b0");
  await s.hold("aftab_area_head", "rh", "alborz");
}

/** RC4's check: one approval by «رئیس حوزه» in the nearest unit up from the requester's. */
export function upDraft(s: Scn): Draft {
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: s.forms.pc, rights: { default: "edit", fields: { u_aftab_pc_finance_note: "hidden", u_aftab_pc_paid_ref: "hidden" } } }, "ثبت درخواست"),
        n("up", "form_step", { action: "approve", quorum: "any", form: s.forms.pc, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "aftab_area_head", where: "requester_unit_up" }] }, "تأیید رئیس حوزه"),
        n("done", "end", { outcome: "completed" }),
        n("rej", "end", { outcome: "rejected" }),
      ],
      edges: [e("start", "request"), e("request", "up"), e("up", "done", "approved"), e("up", "rej", "rejected")],
    },
    managers: s.ids("mehrdad"),
  };
}

const LATE = (label: string) => `مهلت «${label}» به پایان رسید؛ پرونده از مسیر «پایان مهلت» ادامه یافت`;

export function w02(ref: EditionRef): void {
  describe("W2 «درخواست تنخواه شعبه»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW2(s);
      const pub = await s.publish(W2.key, W2.name, w2Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
      await s.publish("aftab_up_check", "تأیید رئیس حوزه (بالادست)", upDraft(s));
    }, 600_000);

    it("R1 a large amount with an invoice: the branch head, the finance deputies (any), the branch finance group's review; the requester reads the internal fields of requester_view", async () => {
      const started = await s.multipart("yaser", "/process/start", {
        process: W2.key,
        values: { u_aftab_pc_amount: "60000000", u_aftab_pc_need_date: tehranDay(1), u_aftab_pc_reason: "خرید چاپگر شعبه", u_aftab_pc_invoice: [{ upload: 0 }] },
      }, [{ name: "factor.png", data: PNG, type: "image/png" }], 201);
      const c = started.case as string;
      await s.settle();
      const k = await s.kase(c);
      expect(k.title).toBe("تنخواه ۶۰٬۰۰۰٬۰۰۰ ریال — یاسر اموالی");
      // the invoice was copied to the case
      expect((await s.db.one<{ n: number }>(`select count(*)::int as n from sm_attachments where org_id = $1 and table_key = 'process_case' and record_id = $2 and deleted_at is null`, [s.org, c]))!.n).toBe(1);
      expect(await s.openAt(c, "head")).toEqual(["somayeh"]);
      await s.submit("somayeh", c, "head", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(c, "fin")).toEqual(["fd2", "mehrdad"]);
      await s.submit("mehrdad", c, "fin", { outcome: "approved" });
      await s.settle();
      expect(await s.at(c, "fin")).toEqual(["fd2:not_needed", "mehrdad:done"]);
      expect(await s.openAt(c, "pay")).toEqual(["fa1", "fa2", "mehrdad"]);
      // the review's required fields
      const bad = await s.refused(s.submit("fa1", c, "pay", { outcome: "submitted", values: { u_aftab_pc_finance_note: "تأیید" } }, 400));
      expect(Object.keys(bad.fields)).toEqual(["u_aftab_pc_paid_ref"]);
      await s.submit("fa1", c, "pay", { outcome: "submitted", values: { u_aftab_pc_finance_note: "پرداخت از تنخواه", u_aftab_pc_paid_ref: "SND-1405-77" } });
      await s.settle();
      expect(await s.kase(c)).toMatchObject({ state: "completed", outcome: "completed" });
      expect(await s.path(c)).toEqual(["start:out", "request:out", "head:approved", "cond:yes", "fin:approved", "pay:out", "done"]);
      // requester_view: the requester reads the payment's fields
      const mine = await s.detail("yaser", c);
      expect(mine.data).toMatchObject({ u_aftab_pc_paid_ref: "SND-1405-77", u_aftab_pc_finance_note: "پرداخت از تنخواه", u_aftab_pc_reason: "خرید چاپگر شعبه" });
      expect(Array.isArray(mine.data.u_aftab_pc_invoice) && mine.data.u_aftab_pc_invoice.length).toBe(1);
    }, 300_000);

    it("R2 a small amount: the invoice hidden by showIf is not taken; the review returns to the requester (a comment needed), who corrects and resubmits; the case completes", async () => {
      const started = await s.multipart("yaser", "/process/start", {
        process: W2.key,
        values: { u_aftab_pc_amount: "5000000", u_aftab_pc_need_date: tehranDay(2), u_aftab_pc_reason: "کاغذ", u_aftab_pc_invoice: [{ upload: 0 }] },
      }, [{ name: "factor.png", data: PNG, type: "image/png" }], 201);
      const c = started.case as string;
      await s.settle();
      expect((await s.kase(c)).data.u_aftab_pc_invoice ?? null).toBeNull();
      await s.submit("somayeh", c, "head", { outcome: "approved" });
      await s.settle();
      expect(await s.path(c)).toEqual(["start:out", "request:out", "head:approved", "cond:no", "pay:waiting"]);
      // «بازگشت» needs a comment
      await s.submit("fa2", c, "pay", { outcome: "returned" }, 400);
      await s.submit("fa2", c, "pay", { outcome: "returned", comment: "شرح نیاز ناقص است" });
      await s.settle();
      expect(await s.openAt(c, "request")).toEqual(["yaser"]);
      expect((await s.tasks(c)).filter((t) => t.step_key === "request" && t.status === "open")[0].round).toBe(2);
      expect((await s.bells("yaser")).some((t) => t.includes("برای اصلاح به شما بازگشت"))).toBe(true);
      await s.submit("yaser", c, "request", { values: { u_aftab_pc_reason: "کاغذ A4 برای دو ماه" } });
      await s.settle();
      // the way forward again: the branch head decides the corrected request (round 2), then the review (round 2)
      expect(await s.openAt(c, "head")).toEqual(["somayeh"]);
      await s.submit("somayeh", c, "head", { outcome: "approved" });
      await s.settle();
      expect((await s.tasks(c)).filter((t) => t.step_key === "pay" && t.status === "open").map((t) => Number(t.round))).toEqual([2, 2, 2]);
      expect(await s.openAt(c, "pay")).toEqual(["fa1", "fa2", "mehrdad"]);
      await s.submit("mehrdad", c, "pay", { outcome: "submitted", values: { u_aftab_pc_finance_note: "پرداخت شد", u_aftab_pc_paid_ref: "SND-2" } });
      await s.settle();
      expect(await s.kase(c)).toMatchObject({ state: "completed", data: { u_aftab_pc_reason: "کاغذ A4 برای دو ماه", u_aftab_pc_paid_ref: "SND-2" } });
    }, 300_000);

    it("R3 a rejection needs a comment; with one the case ends «پایان (ردشده)» and the requester is told", async () => {
      const r = await s.start("yaser", W2.key, { u_aftab_pc_amount: "7000000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      const bad = await s.refused(s.submit("somayeh", r.case, "head", { outcome: "rejected" }, 400));
      expect(bad.message).toContain("توضیح بنویسید");
      await s.submit("somayeh", r.case, "head", { outcome: "rejected", comment: "بودجهٔ این ماه تمام شده است" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "rejected", outcome: "rejected" });
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "head:rejected", "rej"]);
      expect((await s.bells("yaser")).some((t) => t.endsWith("رد شد"))).toBe(true);
    }, 300_000);

    it("R4 the branch head is the requester: she is left out (separation of duties) and the fallback, her branch's head, gets the step", async () => {
      const r = await s.start("somayeh", W2.key, { u_aftab_pc_amount: "8000000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      expect(await s.openAt(r.case, "head")).toEqual(["bm_b0"]);
      await s.submit("bm_b0", r.case, "head", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "pay")).toEqual(["fa1", "fa2", "mehrdad"]);
    }, 300_000);

    it("R4 (RC4) the nearest holder up the tree is the requester herself: the step goes one level up to the province's head", async () => {
      const r = await s.start("somayeh", "aftab_up_check", { u_aftab_pc_amount: "1000000" });
      await s.settle();
      expect(await s.openAt(r.case, "up")).toEqual(["rh"]);
    }, 300_000);

    it("R4 (RC4) the nearest holder up the tree is one of the pack's people on the organisation's own case: the step goes one level up to the real head", async () => {
      const r = await s.start("realemp", "aftab_up_check", { u_aftab_pc_amount: "1000000" });
      await s.settle();
      expect(await s.isDemo(r.case)).toBe(false);
      expect(await s.openAt(r.case, "up")).toEqual(["rh"]);
    }, 300_000);

    it("R5 the branch head never acts: after 4 hours the escalation is journaled once; after a day «پایان مهلت» ends the case «پایان (منقضی)»", async () => {
      const r = await s.start("yaser", W2.key, { u_aftab_pc_amount: "9000000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      expect(await s.openAt(r.case, "head")).toEqual(["somayeh"]);
      await s.elapse(r.case, "head", 5 * H);
      await s.timers();
      expect((await s.journal(r.case)).filter((l) => l.startsWith("مهلت گذشت؛ «تأیید رئیس شعبه» به") && l.endsWith("اطلاع داده شد"))).toHaveLength(1);
      // again: nothing more
      await s.timers();
      expect((await s.journal(r.case)).filter((l) => l.startsWith("مهلت گذشت؛"))).toHaveLength(1);
      expect(await s.openAt(r.case, "head")).toEqual(["somayeh"]);
      // the deadline: «پایان مهلت»
      await s.elapse(r.case, "head", DAY);
      await s.timers();
      expect(await s.kase(r.case)).toMatchObject({ state: "canceled", outcome: "canceled" });
      expect(await s.at(r.case, "head")).toEqual(["somayeh:not_needed"]);
      expect(await s.journal(r.case)).toContain(LATE("تأیید رئیس شعبه"));
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "head:timeout", "expired"]);
    }, 300_000);

    it("R5 (NB1) the reports_to escalation's bell reaches the province head, once: the journal's «اطلاع داده شد» is true", async () => {
      const r = await s.start("yaser", W2.key, { u_aftab_pc_amount: "9100000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      const before = (await s.bells("ph_alborz")).length;
      await s.elapse(r.case, "head", 5 * H);
      await s.timers();
      await s.timers();
      expect((await s.bells("ph_alborz")).slice(before).filter((t) => t.startsWith("مهلت گذشت: «تأیید رئیس شعبه»"))).toHaveLength(1);
      // and the person told may open the case the notice links to
      await s.detail("ph_alborz", r.case);
    }, 300_000);

    it("R5 (NB2) the reports_to escalation reaches the province head above the requester's branch, not every holder of the position", async () => {
      const r = await s.start("yaser", W2.key, { u_aftab_pc_amount: "9500000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      await s.elapse(r.case, "head", 5 * H);
      await s.timers();
      const line = (await s.journal(r.case)).find((l) => l.startsWith("مهلت گذشت؛ «تأیید رئیس شعبه» به"));
      expect(line).toBe("مهلت گذشت؛ «تأیید رئیس شعبه» به حمید استان‌دار البرز اطلاع داده شد");
    }, 300_000);

    it("R5b after a return, the requester leaves round 2 of «ثبت درخواست» for 3 days: its «پایان مهلت» ends the case", async () => {
      const r = await s.start("yaser", W2.key, { u_aftab_pc_amount: "4000000", u_aftab_pc_need_date: tehranDay(3) });
      await s.settle();
      await s.submit("somayeh", r.case, "head", { outcome: "returned", comment: "تاریخ نیاز را روشن کنید" });
      await s.settle();
      expect(await s.openAt(r.case, "request")).toEqual(["yaser"]);
      const t = (await s.tasks(r.case)).find((x) => x.step_key === "request" && x.status === "open")!;
      expect(t.due_at).toBeTruthy();
      await s.elapse(r.case, "request", 3 * DAY + H);
      await s.timers();
      expect(await s.kase(r.case)).toMatchObject({ state: "canceled", outcome: "canceled" });
      expect(await s.journal(r.case)).toContain(LATE("ثبت درخواست"));
    }, 300_000);

    it("R6 a requester with no branch above: the rules and the fallback find nobody, the step goes to the process managers", async () => {
      const r = await s.start("negar", W2.key, { u_aftab_pc_amount: "3000000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      expect(await s.openAt(r.case, "head")).toEqual(["mehrdad"]);
      await s.submit("mehrdad", r.case, "head", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "pay")).toEqual(["fa1", "fa2", "mehrdad"]);
    }, 300_000);

    it("R7 negatives: an amount over the field's limit, a past need date and a non-starter are refused; nothing is created", async () => {
      const count = async () => (await s.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and process_id = $2`, [s.org, s.procs[W2.key].id]))!.n;
      const n0 = await count();
      const big = await s.refused(s.start("yaser", W2.key, { u_aftab_pc_amount: "3000000000", u_aftab_pc_need_date: tehranDay(1) }, { expect: 400 }));
      expect(Object.keys(big.fields)).toEqual(["u_aftab_pc_amount"]);
      const past = await s.refused(s.start("yaser", W2.key, { u_aftab_pc_amount: "3000000", u_aftab_pc_need_date: tehranDay(-1) }, { expect: 400 }));
      expect(Object.keys(past.fields)).toEqual(["u_aftab_pc_need_date"]);
      const none = await s.refused(s.start("yaser", W2.key, { u_aftab_pc_need_date: tehranDay(1) }, { expect: 400 }));
      expect(Object.keys(none.fields)).toEqual(["u_aftab_pc_amount"]);
      const stranger = await s.refused(s.start("parvaneh", W2.key, { u_aftab_pc_amount: "3000000" }, { expect: 409 }));
      expect(stranger.message).toBe("شما اجازهٔ آغاز این گردش‌کار را ندارید");
      expect(await count()).toBe(n0);
    }, 300_000);

    it("R7 the requester cancels after the first step was done: refused; a manager cancels with a comment", async () => {
      const r = await s.start("yaser", W2.key, { u_aftab_pc_amount: "2000000", u_aftab_pc_need_date: tehranDay(1) });
      await s.settle();
      await s.submit("somayeh", r.case, "head", { outcome: "approved" });
      await s.settle();
      const no = await s.refused(s.caseAction("yaser", r.case, "cancel", "اشتباه شد", 409));
      expect(no.message).toBe("پس از انجام نخستین مرحله، پرونده را فقط مسئولان گردش‌کار لغو می‌کنند");
      await s.caseAction("mehrdad", r.case, "cancel", undefined, 400);
      await s.caseAction("mehrdad", r.case, "cancel", "درخواست تکراری");
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "canceled", outcome: "canceled" });
      expect(await s.at(r.case, "pay")).toEqual(["fa1:canceled", "fa2:canceled", "mehrdad:canceled"]);
    }, 300_000);
  });
}
