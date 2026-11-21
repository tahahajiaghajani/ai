// W8 «وام قرض‌الحسنهٔ کارکنان» — quorum «همه», exclusions «درخواست‌دهنده» and «انجام‌دهندگان یک مرحله», a field of the
// financial field group, the previous actor's manager, a condition matching all its rules with lte, an automatic
// rejection after the deadline, a person field with «منتظر بماند», and a return from an approval to a middle step.
// Runs R1–R6 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, DAY, e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W8 = { key: "aftab_staff_loan", name: "وام قرض‌الحسنهٔ کارکنان" };

export function w8Draft(s: Scn): Draft {
  const F = s.forms.ln;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_ln_salary: "hidden", u_aftab_ln_hr_ok: "hidden", u_aftab_ln_committee: "hidden" } } }, "ثبت درخواست"),
        n("guar", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "field", field: "u_aftab_ln_guarantor" }], ifNobody: "wait" }, "تأیید ضامن"),
        n("hr", "form_step", { action: "review", form: F, rights: { default: "read", fields: { u_aftab_ln_salary: "edit", u_aftab_ln_hr_ok: "required" } }, assignees: [{ kind: "group", group: s.g("hr") }] }, "بررسی سوابق"),
        n("cond", "branch", { mode: "data", match: "all", rules: [{ left: "{{case.u_aftab_ln_amount}}", op: "lte", right: "300000000" }, { left: "{{case.u_aftab_ln_months}}", op: "lte", right: "24" }] }, "وام کوچک؟"),
        n("small", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "manager", of: "previous_actor" }] }, "تأیید مدیر"),
        n("committee", "form_step", {
          action: "approve", quorum: "all", form: F, rights: { default: "read", fields: { u_aftab_ln_committee: "edit" } },
          assignees: [{ kind: "position", position: "aftab_loan_committee", where: "anywhere" }], exclude: ["requester", "step:guar"],
          escalate: [{ after: { amount: 3, unit: "day" }, action: "auto", outcome: "rejected" }],
        }, "کمیتهٔ وام"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [
        e("start", "request"), e("request", "guar"),
        e("guar", "hr", "approved"), e("guar", "rej", "rejected"), e("guar", "request", "returned"),
        e("hr", "cond"), e("hr", "request", "returned"),
        e("cond", "small", "yes"), e("cond", "committee", "no"),
        e("small", "done", "approved"), e("small", "rej", "rejected"),
        e("committee", "done", "approved"), e("committee", "rej", "rejected"), e("committee", "hr", "returned"),
      ],
    },
    starters: [{ kind: "users", users: s.ids("negar", "yaser", "somayeh", "ramin") }],
    title_template: "وام {{case.u_aftab_ln_amount}} — {{case.requested_by}}",
    managers: s.ids("parvaneh"),
  };
}

export async function setupW8(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  // «مدیر دارایی» holds the financial field group; «کارشناس» does not
  await s.person("parvaneh", "پروانه منابعی", { unit: "hr", roles: ["asset_manager"], ...demo });
  await s.person("hr1", "کارشناس منابع انسانی", { unit: "hr", manager: "parvaneh", roles: ["agent"], ...demo });
  await s.person("mehrdad", "مهرداد بودجه‌نژاد", { unit: "fin", ...demo });
  await s.person("lc3", "عضو کمیتهٔ وام", { unit: "fin", ...demo });
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", ...demo });
  await s.person("yaser", "یاسر اموالی", { unit: "b0", ...demo });
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", ...demo });
  await s.person("ramin", "رامین دارایی", { unit: "it", ...demo });
  await s.person("gc1", "همکار ضامن", { unit: "it", ...demo });
  await s.group("hr", "منابع انسانی", ["parvaneh", "hr1"]);
  await s.field("u_aftab_ln_amount", "مبلغ وام", "money");
  await s.field("u_aftab_ln_months", "تعداد اقساط", "int", { validation: { min: 1, max: 60 } });
  await s.field("u_aftab_ln_salary", "حقوق ماهانه", "money", { field_group: "financial" });
  await s.field("u_aftab_ln_guarantor", "ضامن", "user");
  await s.field("u_aftab_ln_purpose", "مصرف", "select", { options: [{ value: "home", label: "مسکن" }, { value: "car", label: "خودرو" }, { value: "other", label: "سایر" }] });
  await s.field("u_aftab_ln_hr_ok", "سوابق تأیید شد", "checkbox");
  await s.field("u_aftab_ln_committee", "نظر کمیته", "text");
  await s.form("ln", "فرم وام کارکنان", [
    tab("درخواست", [section(null, [item("u_aftab_ln_amount", { required: true }), item("u_aftab_ln_months", { required: true }), item("u_aftab_ln_purpose"), item("u_aftab_ln_guarantor")])]),
    tab("منابع انسانی", [section(null, [item("u_aftab_ln_salary"), item("u_aftab_ln_hr_ok")])]),
    tab("کمیته", [section(null, [item("u_aftab_ln_committee")])]),
  ]);
  await s.position("aftab_loan_committee", "عضو کمیتهٔ وام");
  for (const p of ["mehrdad", "parvaneh", "lc3"]) await s.hold("aftab_loan_committee", p, "hq");
}

const loan = (s: Scn, o: Record<string, unknown> = {}) => ({ u_aftab_ln_amount: "200000000", u_aftab_ln_months: 12, u_aftab_ln_purpose: "home", u_aftab_ln_guarantor: s.id("gc1"), ...o });

/** The guarantor approves and HR confirms the records (hr1 or پروانه): the next step is open. */
async function guarantorAndHr(s: Scn, caseId: string, guarantor = "gc1", reviewer = "hr1"): Promise<void> {
  await s.submit(guarantor, caseId, "guar", { outcome: "approved" });
  await s.settle();
  await s.submit(reviewer, caseId, "hr", { outcome: "submitted", values: { u_aftab_ln_hr_ok: true } });
  await s.settle();
}

export function w08(ref: EditionRef): void {
  describe("W8 «وام قرض‌الحسنهٔ کارکنان»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW8(s);
      const pub = await s.publish(W8.key, W8.name, w8Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R1 a small loan: the guarantor, HR (the salary only within the financial field group), the HR reviewer's manager; completed", async () => {
      const r = await s.start("negar", W8.key, loan(s));
      await s.settle();
      expect(await s.openAt(r.case, "guar")).toEqual(["gc1"]);
      await s.submit("gc1", r.case, "guar", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "hr")).toEqual(["hr1", "parvaneh"]);
      expect((await s.myStep("parvaneh", r.case, "hr")).rights).toMatchObject({ u_aftab_ln_salary: "edit", u_aftab_ln_hr_ok: "required" });
      expect((await s.myStep("hr1", r.case, "hr")).rights).toMatchObject({ u_aftab_ln_salary: "hidden", u_aftab_ln_hr_ok: "required" });
      await s.submit("hr1", r.case, "hr", { outcome: "submitted", values: { u_aftab_ln_hr_ok: true } });
      await s.settle();
      // the HR reviewer's manager
      expect(await s.openAt(r.case, "small")).toEqual(["parvaneh"]);
      await s.submit("parvaneh", r.case, "small", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_ln_hr_ok: true } });
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "guar:approved", "hr:out", "cond:yes", "small:approved", "done"]);
    }, 300_000);

    it("R2 a large loan whose guarantor sits on the committee: he is left out (step:guar); all of the rest must approve; one rejection ends it", async () => {
      const r = await s.start("negar", W8.key, loan(s, { u_aftab_ln_amount: "800000000", u_aftab_ln_months: 36, u_aftab_ln_guarantor: s.id("mehrdad") }));
      await s.settle();
      await guarantorAndHr(s, r.case, "mehrdad", "parvaneh");
      expect(await s.openAt(r.case, "committee")).toEqual(["lc3", "parvaneh"]);
      await s.submit("lc3", r.case, "committee", { outcome: "approved", values: { u_aftab_ln_committee: "موافقم" } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "active" });
      await s.submit("parvaneh", r.case, "committee", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_ln_committee: "موافقم" } });
      const r2 = await s.start("yaser", W8.key, loan(s, { u_aftab_ln_amount: "900000000", u_aftab_ln_months: 48, u_aftab_ln_guarantor: s.id("mehrdad") }));
      await s.settle();
      await guarantorAndHr(s, r2.case, "mehrdad");
      await s.submit("lc3", r2.case, "committee", { outcome: "rejected", comment: "سقف وام رعایت نشده" });
      await s.settle();
      expect(await s.kase(r2.case)).toMatchObject({ state: "rejected" });
      expect(await s.at(r2.case, "committee")).toEqual(["lc3:done", "parvaneh:not_needed"]);
    }, 300_000);

    it("R3 the committee returns to HR: round 2 goes to the earlier HR actor; resubmitted, the committee opens again", async () => {
      const r = await s.start("somayeh", W8.key, loan(s, { u_aftab_ln_amount: "700000000", u_aftab_ln_months: 30 }));
      await s.settle();
      await guarantorAndHr(s, r.case);
      await s.submit("parvaneh", r.case, "committee", { outcome: "returned", comment: "سوابق حقوق را دوباره بررسی کنید" });
      await s.settle();
      expect(await s.openAt(r.case, "hr")).toEqual(["hr1"]);
      await s.submit("hr1", r.case, "hr", { outcome: "submitted", values: { u_aftab_ln_hr_ok: true } });
      await s.settle();
      expect((await s.tasks(r.case)).filter((t) => t.step_key === "committee" && t.status === "open").map((t) => Number(t.round))).toEqual([2, 2, 2]);
    }, 300_000);

    it("R4 the committee does not answer for 3 days: rejected automatically", async () => {
      const r = await s.start("ramin", W8.key, loan(s, { u_aftab_ln_amount: "600000000", u_aftab_ln_months: 30 }));
      await s.settle();
      await guarantorAndHr(s, r.case);
      await s.elapse(r.case, "committee", 3 * DAY + 60_000);
      await s.timers();
      expect(await s.journal(r.case)).toContain("مهلت گذشت؛ «کمیتهٔ وام» خودکار «رد» شد");
      expect(await s.kase(r.case)).toMatchObject({ state: "rejected" });
    }, 300_000);

    it("R5 the requester names herself as guarantor: excluded, the step waits and the managers are told; «ارجاع» refuses the requester, takes a colleague", async () => {
      const r = await s.start("negar", W8.key, loan(s, { u_aftab_ln_guarantor: s.id("negar") }));
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "waiting" });
      expect(await s.journal(r.case)).toContain("برای «تأیید ضامن» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.");
      expect(await s.bells("parvaneh")).toContain("برای «تأیید ضامن» کسی پیدا نشد");
      const no = await s.refused(s.reassign("parvaneh", r.case, "guar", ["negar"], { expect: 400 }));
      expect(no.message).toBe("درخواست‌دهنده این مرحله را انجام نمی‌دهد");
      await s.reassign("parvaneh", r.case, "guar", ["gc1"], { comment: "ضامن دیگری معرفی شد" });
      expect(await s.openAt(r.case, "guar")).toEqual(["gc1"]);
      expect(await s.kase(r.case)).toMatchObject({ state: "active" });
    }, 300_000);

    it("R6 a value the start step may not change (the salary) is left out, and the requester is told how many", async () => {
      const r = await s.start("negar", W8.key, loan(s, { u_aftab_ln_salary: "150000000" }));
      expect(r.note).toBe("۱ مقدار که در این مرحله اجازهٔ تغییرشان را نداشتید کنار گذاشته شد");
      expect((await s.kase(r.case)).data.u_aftab_ln_salary ?? null).toBeNull();
    }, 300_000);
  });
}
