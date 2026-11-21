// W4 «تأیید قرارداد خرید تجهیزات» — parallel branches joined by «همه» and by «نخستین شاخه» with the rest canceled,
// two forms in one process, quorums «تعداد», «درصد» and «نخستین پاسخ», a role rule narrowed to some people, named
// people, a group, the earlier actors left out, a step lifting a form's hidden flag, and gte on money. Runs R1–R7.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W4 = { key: "aftab_procurement", name: "تأیید قرارداد خرید تجهیزات" };

export function w4Draft(s: Scn, o: { legalAlsoEditsFin?: boolean; returnFromInside?: boolean } = {}): Draft {
  const A = s.forms.pra;
  const B = s.forms.prb;
  const legalRights: Record<string, string> = { u_aftab_pr_legal: "required", u_aftab_pr_amount: "read", ...(o.legalAlsoEditsFin ? { u_aftab_pr_fin: "edit" } : {}) };
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: A, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
        n("par1", "parallel", {}, "بررسی‌های هم‌زمان"),
        n("legal", "form_step", { action: o.returnFromInside ? "review" : "fill", form: B, rights: { default: "hidden", fields: legalRights }, assignees: [{ kind: "group", group: s.g("legal") }] }, "نظر حقوقی"),
        n("tech", "form_step", { action: "fill", form: B, rights: { default: "hidden", fields: { u_aftab_pr_tech: "required" } }, assignees: [{ kind: "role", role: "agent", members: s.ids("negar", "sepideh", "ramin") }] }, "نظر فنی"),
        n("fin", "form_step", { action: "fill", form: B, rights: { default: "hidden", fields: { u_aftab_pr_fin: "required", u_aftab_pr_amount: "read" } }, assignees: [{ kind: "position", position: "aftab_finance_deputy", where: "anywhere" }] }, "نظر مالی"),
        n("join1", "join", { mode: "all" }),
        n("par2", "parallel", {}, "استعلام قیمت"),
        n("qa", "form_step", { action: "fill", form: B, rights: { default: "hidden", fields: { u_aftab_pr_price_a: "required" } }, assignees: [{ kind: "users", users: s.ids("ramin") }] }, "استعلام الف"),
        n("qb", "form_step", { action: "fill", form: B, rights: { default: "hidden", fields: { u_aftab_pr_price_b: "required" } }, assignees: [{ kind: "users", users: s.ids("arman") }] }, "استعلام ب"),
        n("join2", "join", { mode: "any", cancel_rest: true }),
        n("committee", "form_step", { action: "approve", quorum: "count", threshold: 2, form: B, rights: { default: "read", fields: {} }, assignees: [{ kind: "users", users: s.ids("kaveh", "mehrdad", "kambiz") }], exclude: ["earlier_actors"] }, "کمیتهٔ خرید"),
        n("risk", "choice", {
          cases: [
            { key: "high", label: "ریسک بالا", rules: [{ left: "{{case.u_aftab_pr_risk}}", op: "eq", right: "high" }] },
            { key: "big", label: "مبلغ بزرگ", rules: [{ left: "{{case.u_aftab_pr_amount}}", op: "gte", right: "5000000000" }] },
          ],
        }, "سطح ریسک"),
        n("board", "form_step", { action: "approve", quorum: "percent", threshold: 60, form: B, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "aftab_board_member", where: "anywhere" }] }, "تأیید هیئت‌مدیره"),
        n("ceo", "form_step", { action: "approve", quorum: "first", form: B, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "aftab_ceo", where: "anywhere" }, { kind: "users", users: s.ids("mehrdad") }] }, "تأیید مدیرعامل"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [
        e("start", "request"), e("request", "par1"),
        e("par1", "legal"), e("par1", "tech"), e("par1", "fin"),
        e("legal", "join1"), e("tech", "join1"), e("fin", "join1"),
        ...(o.returnFromInside ? [e("legal", "request", "returned")] : []),
        e("join1", "par2"), e("par2", "qa"), e("par2", "qb"), e("qa", "join2"), e("qb", "join2"),
        e("join2", "committee"),
        e("committee", "risk", "approved"), e("committee", "rej", "rejected"), e("committee", "request", "returned"),
        e("risk", "board", "high"), e("risk", "ceo", "big"), e("risk", "done", "else"),
        e("board", "done", "approved"), e("board", "rej", "rejected"),
        e("ceo", "done", "approved"), e("ceo", "rej", "rejected"),
      ],
    },
    starters: [{ kind: "users", users: s.ids("ramin", "kambiz") }],
    title_template: "خرید {{case.u_aftab_pr_title}}",
    managers: s.ids("kaveh"),
  };
}

export async function setupW4(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  const agent = { roles: ["agent", "requester"], ...demo };
  await s.person("ramin", "رامین دارایی", { unit: "it", ...agent });
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", ...agent });
  await s.person("sepideh", "سپیده انتشاری", { unit: "it", ...agent });
  await s.person("kambiz", "کامبیز پروژه‌پور", { unit: "it", ...demo });
  await s.person("arman", "آرمان خریدار", { unit: "fin", ...demo });
  await s.person("kaveh", "کاوه تغییری", { unit: "it", ...demo });
  await s.person("mehrdad", "مهرداد بودجه‌نژاد", { unit: "fin", ...demo });
  await s.person("fd2", "فرزانه حسابداری", { unit: "fin", ...demo });
  await s.person("zhaleh", "ژاله ریسک‌شناس", { unit: "sec", ...demo });
  await s.person("bd1", "عضو هیئت‌مدیرهٔ یکم", { unit: "hq", ...demo });
  await s.person("bd2", "عضو هیئت‌مدیرهٔ دوم", { unit: "hq", ...demo });
  await s.person("ceo", "مدیرعامل بانک", { unit: "hq", ...demo });
  await s.person("lg1", "حقوقدان یکم", { unit: "hq", ...demo });
  await s.person("lg2", "حقوقدان دوم", { unit: "hq", ...demo });
  await s.group("legal", "امور حقوقی", ["lg1", "lg2"]);
  await s.field("u_aftab_pr_title", "عنوان خرید", "string");
  await s.field("u_aftab_pr_vendor", "تأمین‌کننده", "string");
  await s.field("u_aftab_pr_amount", "مبلغ قرارداد", "money");
  await s.field("u_aftab_pr_quote", "پیش‌فاکتور", "attachment");
  await s.field("u_aftab_pr_risk", "سطح ریسک", "radio", { options: [{ value: "low", label: "کم" }, { value: "medium", label: "متوسط" }, { value: "high", label: "زیاد" }] });
  await s.field("u_aftab_pr_legal", "نظر حقوقی", "text");
  await s.field("u_aftab_pr_tech", "نظر فنی", "text");
  await s.field("u_aftab_pr_fin", "نظر مالی", "text");
  await s.field("u_aftab_pr_price_a", "قیمت استعلام الف", "money");
  await s.field("u_aftab_pr_price_b", "قیمت استعلام ب", "money");
  await s.form("pra", "فرم درخواست خرید", [tab("قرارداد", [section(null, [item("u_aftab_pr_title", { required: true }), item("u_aftab_pr_vendor"), item("u_aftab_pr_amount", { required: true }), item("u_aftab_pr_risk", { required: true }), item("u_aftab_pr_quote")])])]);
  await s.form("prb", "فرم بررسی خرید", [
    tab("حقوقی", [section(null, [item("u_aftab_pr_legal", { hidden: true })])]),
    tab("فنی", [section(null, [item("u_aftab_pr_tech")])]),
    tab("مالی", [section(null, [item("u_aftab_pr_fin"), item("u_aftab_pr_amount")])]),
    tab("استعلام", [section(null, [item("u_aftab_pr_price_a"), item("u_aftab_pr_price_b")])]),
  ]);
  await s.position("aftab_finance_deputy", "معاون مالی", { unitKind: "department" });
  await s.hold("aftab_finance_deputy", "mehrdad", "fin");
  await s.position("aftab_board_member", "عضو هیئت‌مدیره");
  for (const p of ["zhaleh", "kaveh", "mehrdad", "bd1", "bd2"]) await s.hold("aftab_board_member", p, "hq");
  await s.position("aftab_ceo", "مدیرعامل");
  await s.hold("aftab_ceo", "ceo", "hq");
}

const order = (o: Record<string, unknown> = {}) => ({ u_aftab_pr_title: "سرور ذخیره‌سازی", u_aftab_pr_vendor: "شرکت نمونه", u_aftab_pr_amount: "900000000", u_aftab_pr_risk: "low", ...o });

/** The three reviews in parallel, then the two quotes («الف» first): the committee's step is open. */
async function reviewsAndQuotes(s: Scn, caseId: string): Promise<void> {
  expect([await s.openAt(caseId, "legal"), await s.openAt(caseId, "tech"), await s.openAt(caseId, "fin")]).toEqual([["lg1", "lg2"], ["negar", "ramin", "sepideh"], ["mehrdad"]]);
  await s.submit("lg1", caseId, "legal", { values: { u_aftab_pr_legal: "قرارداد بی‌اشکال است" } });
  await s.submit("sepideh", caseId, "tech", { values: { u_aftab_pr_tech: "مشخصات مناسب است" } });
  await s.submit("mehrdad", caseId, "fin", { values: { u_aftab_pr_fin: "بودجه دارد" } });
  await s.settle();
  expect([await s.openAt(caseId, "qa"), await s.openAt(caseId, "qb")]).toEqual([["ramin"], ["arman"]]);
  await s.submit("ramin", caseId, "qa", { values: { u_aftab_pr_price_a: "880000000" } });
  await s.settle();
}

export function w04(ref: EditionRef): void {
  describe("W4 «تأیید قرارداد خرید تجهیزات»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW4(s);
      const pub = await s.publish(W4.key, W4.name, w4Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R1 low risk: three reviews at once, each seeing its own field; the first quote cancels the other (a late one keeps its values); the committee without the earlier actors (count 2); completed", async () => {
      const r = await s.start("ramin", W4.key, order());
      await s.settle();
      // each branch reads only its own field (and the amount for legal and finance); the form's hidden flag lifted by the step
      expect((await s.myStep("lg1", r.case, "legal")).rights).toEqual({ u_aftab_pr_legal: "required", u_aftab_pr_amount: "read", u_aftab_pr_tech: "hidden", u_aftab_pr_fin: "hidden", u_aftab_pr_price_a: "hidden", u_aftab_pr_price_b: "hidden" });
      expect((await s.myStep("negar", r.case, "tech")).rights).toEqual({ u_aftab_pr_legal: "hidden", u_aftab_pr_amount: "hidden", u_aftab_pr_tech: "required", u_aftab_pr_fin: "hidden", u_aftab_pr_price_a: "hidden", u_aftab_pr_price_b: "hidden" });
      expect((await s.myStep("mehrdad", r.case, "fin")).rights).toMatchObject({ u_aftab_pr_fin: "required", u_aftab_pr_amount: "read", u_aftab_pr_legal: "hidden" });
      const qbTask = async () => (await s.tasks(r.case)).find((t) => t.step_key === "qb");
      await s.submit("lg1", r.case, "legal", { values: { u_aftab_pr_legal: "قرارداد بی‌اشکال است" } });
      await s.submit("sepideh", r.case, "tech", { values: { u_aftab_pr_tech: "مشخصات مناسب است" } });
      await s.settle();
      // the join waits for every branch
      expect(await s.openAt(r.case, "qa")).toEqual([]);
      await s.submit("mehrdad", r.case, "fin", { values: { u_aftab_pr_fin: "بودجه دارد" } });
      await s.settle();
      const qb = await qbTask();
      await s.submit("ramin", r.case, "qa", { values: { u_aftab_pr_price_a: "880000000" } });
      await s.settle();
      expect(await s.at(r.case, "qb")).toEqual(["arman:not_needed"]);
      // آرمان's later submit: late, his values kept on the submission, nothing in the case
      const late = await s.submitTask("arman", qb!.id, { values: { u_aftab_pr_price_b: "870000000" } });
      expect(late.result).toBe("late");
      expect((await s.submission(late.submission))!.values).toMatchObject({ u_aftab_pr_price_b: "870000000" });
      expect((await s.kase(r.case)).data.u_aftab_pr_price_b ?? null).toBeNull();
      // مهرداد (finance review) and رامین (requester, quote) acted earlier: the committee is کاوه and کامبیز, both needed
      expect(await s.openAt(r.case, "committee")).toEqual(["kambiz", "kaveh"]);
      await s.submit("kaveh", r.case, "committee", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "active" });
      await s.submit("kambiz", r.case, "committee", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed" });
      expect((await s.path(r.case)).filter((p) => p.startsWith("risk") || p === "done")).toEqual(["risk:else", "done"]);
      expect((await s.kase(r.case)).data).toMatchObject({ u_aftab_pr_legal: "قرارداد بی‌اشکال است", u_aftab_pr_tech: "مشخصات مناسب است", u_aftab_pr_fin: "بودجه دارد", u_aftab_pr_price_a: "880000000" });
    }, 300_000);

    it("R2 a rejection the count can no longer outweigh ends the case at once", async () => {
      const r = await s.start("ramin", W4.key, order());
      await s.settle();
      await reviewsAndQuotes(s, r.case);
      await s.submit("kaveh", r.case, "committee", { outcome: "rejected", comment: "قیمت بالاست" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "rejected", outcome: "rejected" });
      expect(await s.at(r.case, "committee")).toEqual(["kambiz:not_needed", "kaveh:done"]);
    }, 300_000);

    it("R3 high risk: the board decides by 60% of 5 (3); two approvals and a rejection wait, a third approval settles it; three rejections reject", async () => {
      const r = await s.start("ramin", W4.key, order({ u_aftab_pr_risk: "high" }));
      await s.settle();
      await reviewsAndQuotes(s, r.case);
      for (const who of ["kaveh", "kambiz"]) await s.submit(who, r.case, "committee", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "board")).toEqual(["bd1", "bd2", "kaveh", "mehrdad", "zhaleh"]);
      await s.submit("bd1", r.case, "board", { outcome: "approved" });
      await s.submit("bd2", r.case, "board", { outcome: "approved" });
      await s.submit("kaveh", r.case, "board", { outcome: "rejected", comment: "ریسک بالاست" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "active" });
      await s.submit("zhaleh", r.case, "board", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed" });
      const r2 = await s.start("ramin", W4.key, order({ u_aftab_pr_risk: "high" }));
      await s.settle();
      await reviewsAndQuotes(s, r2.case);
      for (const who of ["kaveh", "kambiz"]) await s.submit(who, r2.case, "committee", { outcome: "approved" });
      await s.settle();
      for (const who of ["bd1", "bd2"]) await s.submit(who, r2.case, "board", { outcome: "rejected", comment: "نه" });
      await s.settle();
      expect(await s.kase(r2.case)).toMatchObject({ state: "active" });
      await s.submit("mehrdad", r2.case, "board", { outcome: "rejected", comment: "نه" });
      await s.settle();
      expect(await s.kase(r2.case)).toMatchObject({ state: "rejected" });
    }, 300_000);

    it("R4 a large amount (gte 5 billion, medium risk): the CEO's step, the first answer decides — a rejection by مهرداد", async () => {
      const r = await s.start("ramin", W4.key, order({ u_aftab_pr_amount: "6000000000", u_aftab_pr_risk: "medium" }));
      await s.settle();
      await reviewsAndQuotes(s, r.case);
      for (const who of ["kaveh", "kambiz"]) await s.submit(who, r.case, "committee", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "ceo")).toEqual(["ceo", "mehrdad"]);
      await s.submit("mehrdad", r.case, "ceo", { outcome: "rejected", comment: "بودجهٔ سال تمام است" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "rejected" });
      expect(await s.at(r.case, "ceo")).toEqual(["ceo:not_needed", "mehrdad:done"]);
    }, 300_000);

    it("R5 the parallel reviews' values merge key by key, whichever is sent first", async () => {
      const r = await s.start("ramin", W4.key, order());
      await s.settle();
      await s.submit("mehrdad", r.case, "fin", { values: { u_aftab_pr_fin: "یکم مالی" } });
      await s.submit("lg2", r.case, "legal", { values: { u_aftab_pr_legal: "دوم حقوقی" } });
      await s.submit("negar", r.case, "tech", { values: { u_aftab_pr_tech: "سوم فنی" } });
      await s.settle();
      expect((await s.kase(r.case)).data).toMatchObject({ u_aftab_pr_fin: "یکم مالی", u_aftab_pr_legal: "دوم حقوقی", u_aftab_pr_tech: "سوم فنی" });
      expect(await s.openAt(r.case, "qa")).toEqual(["ramin"]);
    }, 300_000);

    it("R6 the validator warns of a field editable on two parallel branches", async () => {
      await s.owner.post(`${s.P}/process/defs`, { name: "خرید (آزمون اعتبار)", key: "aftab_procurement_check" }, 201).then((r) => (s.procs.aftab_procurement_check = { id: r.process.id, key: "aftab_procurement_check" }));
      const saved = await s.saveDraft("aftab_procurement_check", w4Draft(s, { legalAlsoEditsFin: true }));
      expect(saved.problems.map((p: { message: string }) => p.message)).toContain("فیلد «نظر مالی» در دو شاخهٔ موازی ویرایش‌پذیر است؛ آخرین ثبت می‌ماند");
      expect(saved.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 300_000);

    it("R7 the committee returns the case for correction: «ثبت درخواست» round 2; a return from inside a parallel branch is refused by the designer", async () => {
      const r = await s.start("ramin", W4.key, order());
      await s.settle();
      await reviewsAndQuotes(s, r.case);
      await s.submit("kaveh", r.case, "committee", { outcome: "returned", comment: "پیش‌فاکتور را پیوست کنید" });
      await s.settle();
      expect(await s.openAt(r.case, "request")).toEqual(["ramin"]);
      expect((await s.tasks(r.case)).find((t) => t.step_key === "request" && t.status === "open")!.round).toBe(2);
      await s.submit("ramin", r.case, "request", { values: { u_aftab_pr_vendor: "شرکت نمونهٔ دوم" } });
      await s.settle();
      expect(await s.openAt(r.case, "legal")).toEqual(["lg1", "lg2"]);
      const saved = await s.saveDraft("aftab_procurement_check", w4Draft(s, { returnFromInside: true }));
      expect(saved.problems.filter((p: { level: string }) => p.level === "error").map((p: { message: string }) => p.message)).toContain("«بازگشت برای اصلاح» از مرز «موازی» و «پیوستن» نمی‌گذرد");
    }, 300_000);
  });
}
