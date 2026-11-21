// W1 «گردش کار پروژه» — the owner's exact case (report 1, screenshots 1–3): library fields, one form with two tabs and
// three sections used by two form steps, the position «مدیر گروه» «همه‌جا» with all holders — the pack's people and,
// later, a real one —, managers, a confidential case and a title from the values. Runs:
//   R1   a demo holder starts on the demo data: a demo case; «مرحلهٔ فرم» reaches both holders with a bell; the
//        holder fills the second tab (the first tab read-only) and the case completes with every value;
//   R1n  «ارسال» without the required delay: 400 and the task stays open;
//   R2   the start reaches the authority as a pending submission and the organisation's process.timer, due first,
//        applies it (RC3): still the pack's case, both holders;
//   R3   the owner starts (a real case): nobody — with the reason (1.1.5) —, the managers told; «ارجاع» to a demo
//        holder refused, to a real member accepted; the case completes;
//   R4   a real member starts while a real holder exists: the real holder only (the demo holders left out, said why);
//   R5   the designer's former default «واحد درخواست‌دهنده» (RC1): nobody, the resolver's note journaled and shown;
//        version 2 «همه‌جا» published mid-case: the case stays on version 1; «دوباره پیدا کردن انجام‌دهنده» with the
//        current version's rules (1.1.5 (c)); «ارجاع» on the demo case; a new case runs version 2;
//   R6   the requester cancels before the step is done: canceled, the open tasks «لغو»;
//   R7   the designer's preview, estimate and demo-people list say who the pack's people are (1.1.5 (e)–(g));
//   R8   a manager who is one of the pack's people acts on a real case; the demo purge leaves it as it was (report 3);
//        it runs last (the purge takes the pack's people and cases away).
import { describe, it, expect, beforeAll } from "vitest";
import { wakeTimer } from "@server/modules/process/timers/timer";
import { newRule } from "@ui/modules/workflows/kit/model";
import { runToEnd } from "@server/modules/demo";
import { PURGE_PHRASE } from "@server/routes/demo";
import { bankUnits, e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W1 = {
  key: "aftab_project",
  name: "گردش کار پروژه",
  v1Key: "aftab_project_v1",
};

/** The graph of W1 (`where`: «همه‌جا» as the owner's version 5, or the designer's former default for version 1). */
export function w1Graph(s: Scn, where: "anywhere" | "requester_unit" = "anywhere"): Draft["graph"] {
  const F = s.forms.prj;
  return {
    nodes: [
      n("start", "trigger"),
      n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
      n("form", "form_step", {
        action: "fill", form: F, rights: { default: "read", fields: { u_aftab_prj_delay: "required", u_aftab_prj_manager: "edit" } },
        assignees: [{ kind: "position", position: "aftab_group_manager", where }], ifNobody: "wait",
      }, "مرحلهٔ فرم"),
      n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
    ],
    edges: [e("start", "request"), e("request", "form"), e("form", "done")],
  };
}

export function w1Draft(s: Scn, where: "anywhere" | "requester_unit" = "anywhere"): Draft {
  return {
    graph: w1Graph(s, where),
    // the holders of both positions, and — to start the organisation's own cases — the owner and a real member
    starters: [
      { kind: "position", position: "aftab_group_manager", where: "anywhere" },
      { kind: "position", position: "aftab_project_expert", where: "anywhere" },
      { kind: "users", users: s.ids("owner", "mina") },
    ],
    title_template: "پروژهٔ {{case.u_aftab_prj_name}}",
    managers: s.ids("owner", "behrouz"),
    confidential: true,
  };
}

/** The people, fields, form and positions of W1 (as the owner made them on the demo data). */
export async function setupW1(s: Scn): Promise<void> {
  await bankUnits(s);
  // the pack's people (demo): the agent persona نگار works in IT but holds «مدیر گروه» in the Alborz province
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", demo: true });
  await s.person("babak", "بابک طاهری", { unit: "lorestan", demo: true });
  await s.person("behrouz", "بهروز مدیرنیا", { unit: "it", demo: true });
  await s.person("kambiz", "کامبیز پروژه‌پور", { unit: "it", demo: true });
  await s.person("sepideh", "سپیده انتشاری", { unit: "it", demo: true });
  // the organisation's own people (real)
  await s.person("reza", "رضا رستمی", { unit: "alborz" });
  await s.person("mina", "مینا مرادی", { unit: "b0" });
  await s.field("u_aftab_prj_name", "نام پروژه", "string");
  await s.field("u_aftab_prj_manager", "نام مدیر پروژه", "string");
  await s.field("u_aftab_prj_delay", "تعداد روز تاخیر", "int", { validation: { min: 0 } });
  await s.form("prj", "فرم پروژه", [
    tab("جزئیات", [section(null, [item("u_aftab_prj_name", { required: true })]), section("بخش تازه", [item("u_aftab_prj_manager")])]),
    tab("تاخیرات", [section(null, [item("u_aftab_prj_delay")])]),
  ]);
  await s.position("aftab_group_manager", "مدیر گروه");
  await s.hold("aftab_group_manager", "babak", "lorestan");
  await s.hold("aftab_group_manager", "negar", "alborz");
  await s.position("aftab_project_expert", "کارشناس پروژه");
  await s.hold("aftab_project_expert", "kambiz", "it");
  await s.hold("aftab_project_expert", "sepideh", "it");
}

const values = { u_aftab_prj_name: "سامانهٔ تسهیلات", u_aftab_prj_manager: "علی" };
const WAITING = "برای «مرحلهٔ فرم» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.";

export function w01(ref: EditionRef): void {
  describe("W1 «گردش کار پروژه» (the owner's case)", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW1(s);
      const pub = await s.publish(W1.key, W1.name, w1Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R5 (RC1) the designer's new «نقش سازمانی» rule no longer starts with the scope «واحد درخواست‌دهنده»", () => {
      expect(newRule("position")).not.toMatchObject({ where: "requester_unit" });
    });

    it("R1 a demo holder starts on the demo data: the pack's case, «مرحلهٔ فرم» reaches both holders, the second tab is filled, the case completes", async () => {
      const r = await s.start("negar", W1.key, values);
      expect(r.result).toBe("applied");
      await s.settle();
      expect(await s.isDemo(r.case)).toBe(true);
      expect(await s.kase(r.case)).toMatchObject({ title: "پروژهٔ سامانهٔ تسهیلات", state: "active", confidential: true });
      expect(await s.openAt(r.case, "form")).toEqual(["babak", "negar"]);
      for (const who of ["negar", "babak"]) expect(await s.bells(who)).toContain("مرحله‌ای منتظر شماست: «مرحلهٔ فرم»");
      // «کارتابل»: the step is there to act on
      const inbox = await s.as("negar").get(`${s.P}/process/inbox`);
      expect(inbox.rows.find((x: any) => x.case_id === r.case)).toMatchObject({ kind: "process_step", can_act: true });
      // the step form: the first tab read, the manager editable, the delay required
      const step = await s.myStep("negar", r.case, "form");
      expect(step.rights).toEqual({ u_aftab_prj_name: "read", u_aftab_prj_manager: "edit", u_aftab_prj_delay: "required" });
      await s.submit("negar", r.case, "form", { values: { u_aftab_prj_delay: 5 } });
      await s.settle();
      expect(await s.at(r.case, "form")).toEqual(["babak:not_needed", "negar:done"]);
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed", data: { ...values, u_aftab_prj_delay: 5 } });
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "form:out", "done"]);
      expect((await s.bells("negar")).some((t) => t.endsWith("به پایان رسید"))).toBe(true);
    }, 300_000);

    it("R1 (1.1.5 (d)) the inbox row of the pack's case says it is demo work", async () => {
      const r = await s.start("negar", W1.key, values);
      await s.settle();
      const inbox = await s.as("babak").get(`${s.P}/process/inbox`);
      expect(inbox.rows.find((x: any) => x.case_id === r.case)).toMatchObject({ kind: "process_step", demo: true });
      expect((await s.detail("behrouz", r.case)).demo).toBe(true);
    }, 300_000);

    it("R1n «ارسال» without the required delay is refused with the field's message; the task stays open", async () => {
      const r = await s.start("negar", W1.key, values);
      await s.settle();
      const bad = await s.refused(s.submit("babak", r.case, "form", { values: {} }, 400));
      expect(Object.keys(bad.fields)).toEqual(["u_aftab_prj_delay"]);
      expect(bad.message).toContain("تعداد روز تاخیر");
      expect(await s.openAt(r.case, "form")).toEqual(["babak", "negar"]);
      // a negative delay is refused too (min 0)
      await s.submit("babak", r.case, "form", { values: { u_aftab_prj_delay: -1 } }, 400);
      await s.submit("babak", r.case, "form", { values: { u_aftab_prj_delay: 0 } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_prj_delay: 0 } });
    }, 300_000);

    it("R2 (RC3) a pending start the organisation's process.timer applies first is still the pack's case: both holders", async () => {
      // the record API path of a submission (what a linked Windows app's push writes): a demo person's own create
      const caseId = (await s.db.one<{ id: string }>(`select gen_random_uuid()::text as id`))!.id;
      const sub = await s.as("negar").post(`${s.P}/r/process_submission`, { kind: "start", process_id: s.procs[W1.key].id, case_id: caseId, values });
      expect(await s.isDemo(String(sub.row.id))).toBe(true);
      // the organisation's timer was due before the submission's event job (a deadline of another case no tick reached)
      await wakeTimer(s.db, s.org, Date.now());
      await s.db.query(`update sm_jobs set run_at = now() - interval '1 minute' where org_id = $1 and kind = 'process.timer' and status = 'queued'`, [s.org]);
      await s.settle();
      expect(await s.submission(String(sub.row.id))).toMatchObject({ result: "applied" });
      expect({ demo: await s.isDemo(caseId), people: await s.openAt(caseId, "form") }).toEqual({ demo: true, people: ["babak", "negar"] });
    }, 300_000);

    it("R3 the owner starts the organisation's own case: nobody (the pack's holders left out), the managers told; «ارجاع» refuses the demo holder, takes a real member; the case completes", async () => {
      const r = await s.start("owner", W1.key, { u_aftab_prj_name: "پروژهٔ مالک" });
      await s.settle();
      expect(await s.isDemo(r.case)).toBe(false);
      expect(await s.kase(r.case)).toMatchObject({ state: "waiting" });
      expect(await s.openAt(r.case, "form")).toEqual([]);
      expect(await s.journal(r.case)).toContain(WAITING);
      expect((await s.bells("owner")).some((t) => t.includes("کسی پیدا نشد"))).toBe(true);
      const refused = await s.refused(s.reassign("owner", r.case, "form", ["negar"], { expect: 400 }));
      expect(refused.message).toBe("حساب‌های نمایشی کار پرونده‌های واقعی سازمان را بر عهده نمی‌گیرند");
      await s.reassign("owner", r.case, "form", ["reza"]);
      expect(await s.openAt(r.case, "form")).toEqual(["reza"]);
      await s.submit("reza", r.case, "form", { values: { u_aftab_prj_delay: 2 } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed", data: { u_aftab_prj_name: "پروژهٔ مالک", u_aftab_prj_delay: 2 } });
    }, 300_000);

    it("R3 (1.1.5 (b)) the waiting step says why nobody was found: the pack's holders are named in the journal and in CaseDetail.waiting", async () => {
      const r = await s.start("owner", W1.key, { u_aftab_prj_name: "پروژهٔ دوم مالک" });
      await s.settle();
      const lines = await s.journal(r.case);
      const nobody = lines.find((l) => l.startsWith("برای «مرحلهٔ فرم» کسی پیدا نشد"));
      expect(nobody).toBeTruthy();
      // the reason: the step's holders are the pack's people
      expect(lines.join("\n")).toContain("حساب نمایشی");
      const d = await s.detail("owner", r.case);
      expect(d.demo).toBe(false);
      expect(d.can.reresolve).toBe(true);
      expect(d.waiting?.form).toMatchObject({ reason: "nobody" });
      expect(d.waiting.form.message).toContain("کسی پیدا نشد");
      expect(d.waiting.form.notes.join(" ")).toContain("مدیر گروه");
      expect(d.waiting.form.notes.join(" ")).toContain("نمایشی");
    }, 300_000);

    it("R4 a real member starts while a real holder exists: the step reaches the real holder only, and completes", async () => {
      const holder = await s.hold("aftab_group_manager", "reza", "alborz");
      try {
        const r = await s.start("mina", W1.key, { u_aftab_prj_name: "پروژهٔ شعبه" });
        await s.settle();
        expect(await s.isDemo(r.case)).toBe(false);
        expect(await s.openAt(r.case, "form")).toEqual(["reza"]);
        await s.submit("reza", r.case, "form", { values: { u_aftab_prj_delay: 1 } });
        await s.settle();
        expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed" });
      } finally {
        await s.owner.del(`${s.P}/r/position_holder/${holder}`);
      }
    }, 300_000);

    it("R5 (RC1) the designer's former default «واحد درخواست‌دهنده»: nobody; version 2 «همه‌جا» mid-case; the case stays on version 1; «ارجاع» on the demo case; a new case runs version 2", async () => {
      const v1 = await s.publish(W1.v1Key, "گردش کار پروژه (پیش‌فرض طراح)", w1Draft(s, "requester_unit"));
      expect(v1.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
      const r = await s.start("negar", W1.v1Key, values);
      await s.settle();
      expect(await s.isDemo(r.case)).toBe(true);
      expect(await s.kase(r.case)).toMatchObject({ state: "waiting", version_no: 1 });
      expect(await s.openAt(r.case, "form")).toEqual([]);
      expect((await s.journal(r.case)).some((l) => l.startsWith("برای «مرحلهٔ فرم» کسی پیدا نشد"))).toBe(true);
      // version 2: «همه‌جا»
      const v2 = await s.publish(W1.v1Key, "گردش کار پروژه (پیش‌فرض طراح)", w1Draft(s, "anywhere"));
      expect(v2.version).not.toBe(v1.version);
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "waiting", version_no: 1 });
      expect(await s.openAt(r.case, "form")).toEqual([]);
      expect((await s.detail("owner", r.case)).case.version_no).toBe(1);
      // a manager gives the step to a holder: allowed on the pack's case
      await s.reassign("owner", r.case, "form", ["babak"]);
      expect(await s.openAt(r.case, "form")).toEqual(["babak"]);
      await s.submit("babak", r.case, "form", { values: { u_aftab_prj_delay: 3 } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed", version_no: 1 });
      // a new start runs version 2: both holders
      const r2 = await s.start("negar", W1.v1Key, values);
      await s.settle();
      expect(await s.kase(r2.case)).toMatchObject({ version_no: 2 });
      expect(await s.openAt(r2.case, "form")).toEqual(["babak", "negar"]);
    }, 300_000);

    it("R5 (RC1, 1.1.5 (b)) the resolver's note reaches the journal and CaseDetail.waiting: «مدیر گروه» has no holder in the requester's profile unit", async () => {
      const r = await s.start("negar", W1.v1Key, values);
      // started on version 2 («همه‌جا»): restore version 1's rule for this check with a case of its own
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ version_no: 2 });
      const v3 = await s.publish(W1.v1Key, "گردش کار پروژه (پیش‌فرض طراح)", w1Draft(s, "requester_unit"));
      expect(v3.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
      const stuck = await s.start("negar", W1.v1Key, values);
      await s.settle();
      expect(await s.openAt(stuck.case, "form")).toEqual([]);
      const note = "«مدیر گروه» در «ادارهٔ کل فناوری اطلاعات» دارنده‌ای ندارد";
      expect((await s.journal(stuck.case)).join("\n")).toContain(note);
      const d = await s.detail("owner", stuck.case);
      expect(d.demo).toBe(true);
      expect(d.can.reresolve).toBe(true);
      expect(d.waiting?.form).toMatchObject({ reason: "nobody", notes: expect.arrayContaining([note]) });
      // the requester, who is no manager, reads that the step waits, without the resolver's notes
      const mine = await s.detail("negar", stuck.case);
      expect(mine.can.reresolve).toBe(false);
      expect(mine.waiting?.form).toMatchObject({ reason: "nobody", notes: [] });
      expect(mine.waiting.form.candidates).toBeUndefined();
    }, 300_000);

    it("R5 (1.1.5 (c)) «دوباره پیدا کردن انجام‌دهنده»: the case's rules find nobody again; the current version's rules find both holders and open their tasks", async () => {
      // the latest version (3) is «واحد درخواست‌دهنده»; publish 4 «همه‌جا» after a case got stuck on 3
      const stuck = await s.start("negar", W1.v1Key, values);
      await s.settle();
      expect(await s.kase(stuck.case)).toMatchObject({ state: "waiting" });
      const v = (await s.kase(stuck.case)).version_no;
      await s.publish(W1.v1Key, "گردش کار پروژه (پیش‌فرض طراح)", w1Draft(s, "anywhere"));
      // only managers, only on a waiting step
      const notManager = await s.raw("negar", "POST", `/process/cases/${stuck.case}/reresolve`, { step: "form" });
      expect(notManager.status, JSON.stringify(notManager.body)).toBe(403);
      const again = await s.reresolve("owner", stuck.case, "form", "case");
      expect(again).toMatchObject({ status: "nobody", people: [] });
      expect(again.notes.join(" ")).toContain("ادارهٔ کل فناوری اطلاعات");
      expect(await s.openAt(stuck.case, "form")).toEqual([]);
      const current = await s.reresolve("owner", stuck.case, "form", "current");
      expect(current.status).toBe("ok");
      expect(current.people.map((p) => s.key(p.id)).sort()).toEqual(["babak", "negar"]);
      expect(current.people.every((p) => p.demo)).toBe(true);
      expect(await s.openAt(stuck.case, "form")).toEqual(["babak", "negar"]);
      // the case keeps its version (the form and the rights stay the case version's)
      expect(await s.kase(stuck.case)).toMatchObject({ version_no: v, state: "active" });
      expect((await s.journal(stuck.case)).some((l) => l.includes("بابک طاهری"))).toBe(true);
      expect(await s.db.one(`select 1 as x from sm_audit where org_id = $1 and entity_id = $2 and action like 'process.re%'`, [s.org, stuck.case])).toBeTruthy();
      // a step that is not waiting any more is refused
      const notWaiting = await s.raw("owner", "POST", `/process/cases/${stuck.case}/reresolve`, { step: "form", rules: "current" });
      expect([400, 409], JSON.stringify(notWaiting.body)).toContain(notWaiting.status);
      await s.submit("negar", stuck.case, "form", { values: { u_aftab_prj_delay: 4 } });
      await s.settle();
      expect(await s.kase(stuck.case)).toMatchObject({ state: "completed" });
    }, 300_000);

    it("R6 the requester cancels before «مرحلهٔ فرم» is done: canceled, the open tasks «لغو»", async () => {
      const r = await s.start("negar", W1.key, values);
      await s.settle();
      expect(await s.openAt(r.case, "form")).toEqual(["babak", "negar"]);
      const out = await s.caseAction("negar", r.case, "cancel", "دیگر لازم نیست");
      expect(out).toMatchObject({ result: "applied", by: "requester" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "canceled", outcome: "canceled" });
      expect(await s.at(r.case, "form")).toEqual(["babak:canceled", "negar:canceled"]);
      expect((await s.journal(r.case)).some((l) => l.startsWith("نگار کارشناس‌پور پرونده را لغو کرد"))).toBe(true);
      // closed: a second cancel is late
      const again = await s.caseAction("negar", r.case, "cancel", undefined, 200);
      expect(again.result).toBe("late");
    }, 300_000);

    it("R7 (1.1.5 (e)–(g)) the designer says who the pack's people are: preview, estimate and the demo-people list", async () => {
      const step = { assignees: [{ kind: "position", position: "aftab_group_manager", where: "anywhere" }] };
      // the preview for the owner as sample requester: nobody, and why
      const own = await s.owner.post(`${s.P}/positions/resolve`, { step, action: "fill", label: "مرحلهٔ فرم", requester: s.id("owner") });
      expect(own.status).toBe("nobody");
      expect(own.notes.join(" ")).toContain("حساب نمایشی");
      expect(own.display.demo ?? null).toEqual([]);
      // for a demo requester: both holders, both marked
      const pack = await s.owner.post(`${s.P}/positions/resolve`, { step, action: "fill", label: "مرحلهٔ فرم", requester: s.id("negar") });
      expect(s.keys(pack.people.map((p: { user: string }) => p.user))).toEqual(["babak", "negar"]);
      expect(s.keys(pack.display.demo)).toEqual(["babak", "negar"]);
      // the estimate counts them, and says they take only the pack's cases
      const est = await s.owner.post(`${s.P}/positions/estimate`, { step, action: "fill" });
      expect(est.total).toBe(2);
      expect(est.demo).toBe(2);
      expect(est.rules[0].demo).toBe(2);
      expect(est.warnings.join(" ")).toContain("حساب نمایشی");
      const people = await s.owner.get(`${s.P}/positions/demo-people`);
      expect(s.keys(people.users)).toEqual(["babak", "behrouz", "kambiz", "negar", "sepideh"]);
    }, 300_000);

    it("R8 (report 3) one of the pack's people manages the organisation's own case; «حذف داده‌های نمایشی» then leaves that case as it was — the real member keeps the step he was given", async () => {
      const r = await s.start("owner", W1.key, { u_aftab_prj_name: "پروژهٔ سوم مالک" });
      await s.settle();
      // بهروز (the pack's manager persona, a manager of the process) pauses, resumes and gives the step to a real
      // member — or is refused: either way the purge must not take work of the organisation's own case away
      const paused = await s.raw("behrouz", "POST", `/process/cases/${r.case}/pause`, { comment: "بررسی" });
      if (paused.status === 200) {
        await s.raw("behrouz", "POST", `/process/cases/${r.case}/resume`, {});
        await s.raw("behrouz", "POST", `/process/cases/${r.case}/reassign`, { step: "form", to: [s.id("reza")] });
        await s.settle();
      }
      const state = async () => {
        const k = await s.kase(r.case);
        const real = (await s.tasks(r.case)).filter((t) => !["negar", "babak", "behrouz", "kambiz", "sepideh"].includes(s.key(t.assigned_to) ?? ""));
        return { state: k?.state ?? null, open_rounds: k?.open_rounds ?? null, tasks: real.map((t) => `${s.key(t.assigned_to)}:${t.step_key}:${t.status}`).sort() };
      };
      const before = await state();
      // «حذف داده‌های نمایشی» (the console's purge, as the owner)
      await s.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [s.o.ownerId]);
      await s.owner.post(`${s.P}/demo/purge`, { confirm: PURGE_PHRASE });
      await runToEnd(s.cfg, s.org, "purge", { budgetMs: 600_000 });
      expect(await state()).toEqual(before);
      // and the organisation's case can still be finished by whoever holds it
      if (before.tasks.includes("reza:form:open")) {
        await s.submit("reza", r.case, "form", { values: { u_aftab_prj_delay: 1 } });
        await s.settle();
        expect(await s.kase(r.case)).toMatchObject({ state: "completed" });
      }
    }, 900_000);
  });
}
