// W5 «گزارش رخداد امنیتی شعبه» — deadlines and escalations end to end: a due time in calendar hours, reminders,
// notices to reports_to, to the manager and to the process managers, a reassignment and the «پایان مهلت» port, an
// automatic decision; the unit a form field names (and its head as the fallback); «بر پایهٔ قاعده» after a return;
// quorum «نخستین پاسخ»; a notice to a group; pause and resume moving the timers. Runs R1–R5 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, H, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W5 = { key: "aftab_security_report", name: "گزارش رخداد امنیتی شعبه" };
const OFFICER = "بررسی مسئول امنیت شعبه";

export function w5Draft(s: Scn): Draft {
  const F = s.forms.si;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_si_officer_note: "hidden", u_aftab_si_soc_note: "hidden" } } }, "ثبت درخواست"),
        n("officer", "form_step", {
          action: "review", form: F, rights: { default: "read", fields: { u_aftab_si_officer_note: "required" } },
          assignees: [{ kind: "position", position: "aftab_branch_sec", where: "unit_field", unitField: "u_aftab_si_branch" }],
          fallback: [{ kind: "unit_head", of: "unit_field", unitField: "u_aftab_si_branch" }],
          ifNobody: "managers", returnTo: "rule", due: { amount: 6, unit: "hour" }, business: false, remind_every: { amount: 1, unit: "hour" },
          escalate: [
            { after: { amount: 2, unit: "hour" }, action: "notify", to: "reports_to" },
            { after: { amount: 3, unit: "hour" }, action: "notify", to: "manager" },
            { after: { amount: 4, unit: "hour" }, action: "reassign", rules: [{ kind: "position", position: "aftab_province_sec", where: "requester_unit_up", unitKind: "division" }] },
            { after: { amount: 5, unit: "hour" }, action: "notify", to: "managers" },
          ],
        }, OFFICER),
        n("urgent", "notify", { to: [{ kind: "group", group: s.g("soc") }], subject: "رخداد بی‌پاسخ {{case.number}}", body: "{{case.u_aftab_si_kind}} در {{case.title}}" }, "اعلان فوری به SOC"),
        n("soc", "form_step", {
          action: "approve", quorum: "first", form: F, rights: { default: "read", fields: { u_aftab_si_soc_note: "edit" } }, assignees: [{ kind: "group", group: s.g("soc") }],
          escalate: [{ after: { amount: 8, unit: "hour" }, action: "auto", outcome: "approved" }], business: false,
        }, "تحلیل مرکز عملیات امنیت"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("closed", "end", { outcome: "rejected" }, "پایان (بی‌اقدام)"),
      ],
      edges: [
        e("start", "request"), e("request", "officer"),
        e("officer", "soc"), e("officer", "request", "returned"), e("officer", "urgent", "timeout"),
        e("urgent", "soc"),
        e("soc", "done", "approved"), e("soc", "closed", "rejected"), e("soc", "officer", "returned"),
      ],
    },
    starters: [],
    title_template: "رخداد {{case.u_aftab_si_kind}} — {{case.u_aftab_si_branch}}",
    managers: s.ids("zhaleh"),
    manager_groups: [s.g("soc")],
  };
}

export async function setupW5(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  await s.person("emp_b0", "کارمند شعبهٔ کرج", { unit: "b0", ...demo });
  await s.person("yaser", "یاسر اموالی", { unit: "b0", ...demo });
  for (const b of ["b1", "b2", "b3"]) await s.person(`sec_${b}`, `مسئول امنیت ${b}`, { unit: b, ...demo });
  await s.person("zhaleh", "ژاله ریسک‌شناس", { unit: "alborz", ...demo });
  await s.person("psec_lorestan", "مسئول امنیت استان لرستان", { unit: "lorestan", ...demo });
  await s.person("ladan", "لادن امنیت‌یار", { unit: "sec", ...demo });
  await s.person("soc1", "تحلیلگر مرکز عملیات یکم", { unit: "sec", ...demo });
  await s.person("bm_b5", "رئیس شعبهٔ نظرآباد", { unit: "b5", ...demo });
  await s.unitHead("b5", "bm_b5");
  await s.group("soc", "مرکز عملیات امنیت", ["ladan", "soc1"]);
  await s.field("u_aftab_si_branch", "شعبهٔ محل رخداد", "unit");
  await s.field("u_aftab_si_when", "زمان رخداد", "datetime");
  await s.field("u_aftab_si_kind", "نوع رخداد", "select", { options: [{ value: "phishing", label: "فیشینگ" }, { value: "malware", label: "بدافزار" }, { value: "physical", label: "فیزیکی" }, { value: "fraud", label: "تقلب" }] });
  await s.field("u_aftab_si_desc", "شرح رخداد", "text");
  await s.field("u_aftab_si_evidence", "شواهد", "attachment");
  await s.field("u_aftab_si_severity", "شدت", "radio", { options: [{ value: "low", label: "کم" }, { value: "medium", label: "متوسط" }, { value: "high", label: "زیاد" }] });
  await s.field("u_aftab_si_officer_note", "نظر مسئول امنیت شعبه", "text");
  await s.field("u_aftab_si_soc_note", "نظر مرکز عملیات امنیت", "text");
  await s.form("si", "فرم گزارش رخداد", [
    tab("گزارش", [
      section("محل و زمان", [item("u_aftab_si_branch"), item("u_aftab_si_when")]),
      section("شرح", [item("u_aftab_si_kind", { required: true }), item("u_aftab_si_severity"), item("u_aftab_si_desc"), item("u_aftab_si_evidence")]),
    ]),
    tab("بررسی", [section(null, [item("u_aftab_si_officer_note"), item("u_aftab_si_soc_note")])]),
  ]);
  await s.position("aftab_province_sec", "مسئول امنیت استان", { unitKind: "division" });
  await s.position("aftab_branch_sec", "مسئول امنیت شعبه", { unitKind: "branch", reportsTo: "aftab_province_sec" });
  await s.hold("aftab_branch_sec", "yaser", "b0");
  for (const b of ["b1", "b2", "b3"]) await s.hold("aftab_branch_sec", `sec_${b}`, b);
  await s.hold("aftab_province_sec", "zhaleh", "alborz");
  await s.hold("aftab_province_sec", "psec_lorestan", "lorestan");
}

const report = (s: Scn, branch: string | null, o: Record<string, unknown> = {}) => ({
  u_aftab_si_branch: branch ? s.u(branch) : null, u_aftab_si_when: new Date(Date.now() - H).toISOString(), u_aftab_si_kind: "phishing", u_aftab_si_severity: "medium", u_aftab_si_desc: "ایمیل مشکوک", ...o,
});
const reminders = async (s: Scn, who: string) => (await s.bells(who)).filter((t) => t === `یادآوری مرحله: «${OFFICER}»`).length;

export function w05(ref: EditionRef): void {
  describe("W5 «گزارش رخداد امنیتی شعبه»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW5(s);
      const pub = await s.publish(W5.key, W5.name, w5Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R1 on time: the branch's security officer reviews, SOC decides by the first answer, the case completes", async () => {
      const r = await s.start("emp_b0", W5.key, report(s, "b0"));
      await s.settle();
      expect((await s.kase(r.case)).title).toBe("رخداد فیشینگ — شعبهٔ کرج مرکزی");
      expect(await s.openAt(r.case, "officer")).toEqual(["yaser"]);
      await s.submit("yaser", r.case, "officer", { outcome: "submitted", values: { u_aftab_si_officer_note: "به SOC رفت" } });
      await s.settle();
      expect(await s.openAt(r.case, "soc")).toEqual(["ladan", "soc1"]);
      await s.submit("ladan", r.case, "soc", { outcome: "approved", values: { u_aftab_si_soc_note: "مسدود شد" } });
      await s.settle();
      expect(await s.at(r.case, "soc")).toEqual(["ladan:done", "soc1:not_needed"]);
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_si_officer_note: "به SOC رفت", u_aftab_si_soc_note: "مسدود شد" } });
    }, 300_000);

    it("R2 nobody acts: hourly reminders, reports_to told at 2 h, no manager at 3 h, reassigned at 4 h, the managers at 5 h, «پایان مهلت» at 6 h (SOC told), then SOC decided automatically at 8 h", async () => {
      const r = await s.start("emp_b0", W5.key, report(s, "b0", { u_aftab_si_kind: "malware" }));
      await s.settle();
      const c = r.case;
      const lines = () => s.journal(c).then((j) => j.filter((l) => l.startsWith("مهلت")).length);
      // +1 h: a reminder
      await s.elapse(c, "officer", H + 60_000);
      await s.timers();
      expect(await reminders(s, "yaser")).toBe(1);
      expect(await lines()).toBe(0);
      // +2 h: another reminder; reports_to told (journaled once)
      await s.elapse(c, "officer", H);
      await s.timers();
      expect(await reminders(s, "yaser")).toBe(2);
      const j2 = (await s.journal(c)).filter((l) => l.startsWith("مهلت گذشت؛"));
      expect(j2).toHaveLength(1);
      expect(j2[0]).toContain("ژاله ریسک‌شناس");
      expect((await s.bells("zhaleh")).filter((t) => t.startsWith(`مهلت گذشت: «${OFFICER}»`))).toHaveLength(1);
      await s.timers();
      expect((await s.journal(c)).filter((l) => l.startsWith("مهلت"))).toHaveLength(1);
      // +3 h: یاسر has no manager
      await s.elapse(c, "officer", H);
      await s.timers();
      expect(await s.journal(c)).toContain(`مهلت «${OFFICER}» گذشت؛ کسی برای اطلاع پیدا نشد`);
      // +4 h: reassigned to the province's security officer (the requester's unit up, of kind division)
      await s.elapse(c, "officer", H);
      await s.timers();
      expect(await s.at(c, "officer")).toEqual(["yaser:not_needed", "zhaleh:open"]);
      expect(await s.journal(c)).toContain(`مهلت گذشت؛ «${OFFICER}» به ژاله ریسک‌شناس ارجاع شد`);
      expect((await s.tasks(c)).find((t) => t.step_key === "officer" && t.status === "open")).toBeTruthy();
      expect((await s.bells("zhaleh"))).toContain(`مرحله‌ای منتظر شماست: «${OFFICER}»`);
      // +5 h: the managers (ژاله and the SOC group)
      const ladan0 = (await s.bells("ladan")).length;
      await s.elapse(c, "officer", H);
      await s.timers();
      expect((await s.bells("ladan")).length).toBeGreaterThan(ladan0);
      expect((await s.journal(c)).filter((l) => l.startsWith("مهلت گذشت؛") && l.endsWith("اطلاع داده شد"))).toHaveLength(2);
      // +6 h: «پایان مهلت»: the round settles on timeout, SOC is told and gets the step
      await s.elapse(c, "officer", H);
      await s.timers();
      expect(await s.at(c, "officer")).toEqual(["yaser:not_needed", "zhaleh:not_needed"]);
      expect(await s.journal(c)).toContain(`مهلت «${OFFICER}» به پایان رسید؛ پرونده از مسیر «پایان مهلت» ادامه یافت`);
      const k = await s.kase(c);
      expect(await s.bells("soc1")).toContain(`رخداد بی‌پاسخ ${k.number}`);
      // (1.1.5 NB3) the notice's body names the kind of incident by its label, not its stored key
      const told = await s.db.one<{ body: string }>(`select body from sm_notifications where org_id = $1 and user_id = $2 and title = $3`, [s.org, s.id("soc1"), `رخداد بی‌پاسخ ${k.number}`]);
      expect(told?.body).toBe(`بدافزار در ${k.title}`);
      expect(await s.openAt(c, "soc")).toEqual(["ladan", "soc1"]);
      // +8 h at SOC: decided automatically
      await s.elapse(c, "soc", 8 * H + 60_000);
      await s.timers();
      expect(await s.journal(c)).toContain("مهلت گذشت؛ «تحلیل مرکز عملیات امنیت» خودکار «تأیید» شد");
      expect(await s.kase(c)).toMatchObject({ state: "completed", outcome: "completed" });
      expect(await s.path(c)).toEqual(["start:out", "request:out", "officer:timeout", "urgent:out", "soc:approved", "done"]);
    }, 300_000);

    it("R3 a vacant branch: the fallback, the branch's head, gets the review; an empty branch field: the note, then the process managers", async () => {
      const r = await s.start("emp_b0", W5.key, report(s, "b5"));
      await s.settle();
      expect(await s.openAt(r.case, "officer")).toEqual(["bm_b5"]);
      const r2 = await s.start("emp_b0", W5.key, report(s, null));
      await s.settle();
      expect(await s.openAt(r2.case, "officer")).toEqual(["ladan", "soc1", "zhaleh"]);
    }, 300_000);

    it("R4 SOC returns the case to the officer: round 2 is resolved again by the step's rules («بر پایهٔ قاعده»), the branch's officer again", async () => {
      const r = await s.start("emp_b0", W5.key, report(s, "b0", { u_aftab_si_kind: "fraud" }));
      await s.settle();
      await s.reassign("zhaleh", r.case, "officer", ["zhaleh"]);
      await s.submit("zhaleh", r.case, "officer", { outcome: "submitted", values: { u_aftab_si_officer_note: "بررسی شد" } });
      await s.settle();
      await s.submit("soc1", r.case, "soc", { outcome: "returned", comment: "شواهد کافی نیست" });
      await s.settle();
      // by the rule: the holder of the branch named in the form, not whoever acted last
      expect(await s.openAt(r.case, "officer")).toEqual(["yaser"]);
      expect((await s.tasks(r.case)).find((t) => t.step_key === "officer" && t.status === "open")!.round).toBe(2);
    }, 300_000);

    it("R5 paused: the timers skip the case; resumed later: the due time, reminders and escalations move by the pause and nothing fires at once", async () => {
      const r = await s.start("emp_b0", W5.key, report(s, "b0", { u_aftab_si_kind: "physical" }));
      await s.settle();
      const c = r.case;
      const due0 = Date.parse(String((await s.tasks(c)).find((t) => t.step_key === "officer")!.due_at));
      await s.caseAction("zhaleh", c, "pause", "در انتظار گزارش پلیس");
      expect(await s.kase(c)).toMatchObject({ state: "waiting" });
      const refused = await s.refused(s.submit("yaser", c, "officer", { outcome: "submitted", values: { u_aftab_si_officer_note: "x" } }, 409));
      expect(refused.message).toContain("موقتاً متوقف");
      expect((await s.as("yaser").get(`${s.P}/process/inbox`)).rows.find((x: any) => x.case_id === c)).toMatchObject({ paused: true, can_act: false });
      // two hours pass while it is paused: nothing fires
      const y0 = await reminders(s, "yaser");
      await s.elapse(c, "officer", 2 * H + 60_000);
      await s.db.query(`update sm_process_cases set paused_at = paused_at - interval '2 hours 1 minute' where id = $1`, [c]);
      await s.timers();
      expect(await reminders(s, "yaser")).toBe(y0);
      expect((await s.journal(c)).filter((l) => l.startsWith("مهلت"))).toEqual([]);
      await s.caseAction("zhaleh", c, "resume");
      await s.timers();
      // the due time moved on by the pause; nothing fired on resuming
      const due1 = Date.parse(String((await s.tasks(c)).find((t) => t.step_key === "officer")!.due_at));
      expect(Math.abs(due1 - due0)).toBeLessThan(5 * 60_000);
      expect(await reminders(s, "yaser")).toBe(y0);
      expect((await s.journal(c)).filter((l) => l.startsWith("مهلت"))).toEqual([]);
      expect(await s.kase(c)).toMatchObject({ state: "active", paused_at: null });
      await s.submit("yaser", c, "officer", { outcome: "submitted", values: { u_aftab_si_officer_note: "پس از ادامه" } });
      await s.settle();
      expect(await s.openAt(c, "soc")).toEqual(["ladan", "soc1"]);
    }, 300_000);

  });
}
