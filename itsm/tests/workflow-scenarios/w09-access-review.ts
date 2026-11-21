// W9 «بازبینی سالانهٔ دسترسی‌ها» — pool limits: more than 50 approvers for quorum «همه» and more than 100 people for a
// fill step make the step wait for the managers, who choose through «ارجاع»; the designer's estimate and warning; a
// group's leads only; a group narrowed to some members; an access role; a notice to too many people; a step that
// waits for several decisions is not taken. Runs R1–R2 of the scenario plan, and the 1.1.5 candidates (contract (b)).
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W9 = { key: "aftab_access_review", name: "بازبینی سالانهٔ دسترسی‌ها" };

export function w9Draft(s: Scn): Draft {
  const F = s.forms.ar;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_ar_ok: "hidden" } } }, "ثبت درخواست"),
        n("leads", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "group", group: s.g("desk"), leadsOnly: true }, { kind: "group", group: s.g("soc"), members: s.ids("ladan") }] }, "تأیید سرپرستان"),
        n("all", "form_step", { action: "approve", quorum: "all", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "role", role: "requester" }] }, "تأیید همهٔ کارکنان"),
        n("everyone", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_ar_ok: "required" } }, assignees: [{ kind: "role", role: "requester" }] }, "اعلام کاربران"),
        n("tell", "notify", { to: [{ kind: "role", role: "requester" }], subject: "بازبینی دسترسی {{case.number}}", body: "{{case.title}}" }, "اعلان بازبینی"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [e("start", "request"), e("request", "leads"), e("leads", "all", "approved"), e("leads", "rej", "rejected"), e("all", "everyone", "approved"), e("all", "rej", "rejected"), e("everyone", "tell"), e("tell", "done")],
    },
    starters: [{ kind: "users", users: s.ids("zhaleh") }],
    title_template: "بازبینی دسترسی — {{case.u_aftab_ar_scope}}",
    managers: s.ids("zhaleh"),
  };
}

export async function setupW9(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  await s.person("zhaleh", "ژاله ریسک‌شناس", { unit: "sec", roles: ["agent"], ...demo });
  await s.person("behrouz", "بهروز مدیرنیا", { unit: "it", ...demo });
  await s.person("desk1", "کارشناس میز خدمت یکم", { unit: "it", ...demo });
  await s.person("desk2", "کارشناس میز خدمت دوم", { unit: "it", ...demo });
  await s.person("ladan", "لادن امنیت‌یار", { unit: "sec", ...demo });
  await s.person("soc1", "تحلیلگر مرکز عملیات یکم", { unit: "sec", ...demo });
  await s.group("desk", "میز خدمت", ["desk1", "desk2"], ["behrouz"]);
  await s.group("soc", "مرکز عملیات امنیت", ["ladan", "soc1"]);
  // the pack's employees: more than 100 people with the access role «درخواست‌کننده»
  await s.crowd("کارمند بانک", 101, { unit: "b0", demo: true });
  await s.field("u_aftab_ar_scope", "دامنهٔ بازبینی", "text");
  await s.field("u_aftab_ar_ok", "دسترسی‌ها درست است", "checkbox");
  await s.field("u_aftab_ar_note", "توضیح", "text");
  await s.form("ar", "فرم بازبینی دسترسی", [tab("بازبینی", [section(null, [item("u_aftab_ar_scope", { required: true }), item("u_aftab_ar_ok"), item("u_aftab_ar_note")])])]);
}

export function w09(ref: EditionRef): void {
  describe("W9 «بازبینی سالانهٔ دسترسی‌ها»", () => {
    let s: Scn;
    let c = "";
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW9(s);
      const pub = await s.publish(W9.key, W9.name, w9Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("the designer's estimate counts the role's holders and warns of the 50-approver limit", async () => {
      const est = await s.owner.post(`${s.P}/positions/estimate`, { step: { assignees: [{ kind: "role", role: "requester" }] }, action: "approve", quorum: "all" });
      expect(est.total).toBeGreaterThan(100);
      expect(est.limit).toBe(50);
      expect(est.warnings.join(" ")).toContain("۵۰");
    }, 300_000);

    it("R1 the leads (a group's leads only, a group narrowed to one member); then more than 50 approvers: the step waits for the managers, who choose three; then more than 100 people: two chosen; completed", async () => {
      const r = await s.start("zhaleh", W9.key, { u_aftab_ar_scope: "سامانه‌های شعب" });
      c = r.case;
      await s.settle();
      expect(await s.openAt(c, "leads")).toEqual(["behrouz", "ladan"]);
      await s.submit("behrouz", c, "leads", { outcome: "approved" });
      await s.settle();
      expect(await s.at(c, "all")).toEqual([]);
      expect(await s.kase(c)).toMatchObject({ state: "waiting" });
      // (1.1.5: the journal's entry is a sentence of its own, as the waiting step's line)
      expect(await s.journal(c)).toContain("بیش از ۵۰ تأییدکننده پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند.");
      await s.reassign("zhaleh", c, "all", ["desk1", "desk2", "soc1"]);
      expect(await s.openAt(c, "all")).toEqual(["desk1", "desk2", "soc1"]);
      // a step that waits for several decisions is not taken by one person
      const no = await s.refused(s.claim("desk1", c, "all", 409));
      expect(no.message).toBe("این مرحله تصمیم چند نفر را می‌خواهد و برداشتنی نیست");
      for (const who of ["desk1", "desk2"]) await s.submit(who, c, "all", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(c)).toMatchObject({ state: "active" });
      await s.submit("soc1", c, "all", { outcome: "approved" });
      await s.settle();
      expect(await s.at(c, "everyone")).toEqual([]);
      expect(await s.journal(c)).toContain("بیش از ۱۰۰ نفر پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند.");
      await s.reassign("zhaleh", c, "everyone", ["desk1", "ladan"]);
      await s.submit("ladan", c, "everyone", { values: { u_aftab_ar_ok: true } });
      await s.settle();
      expect(await s.kase(c)).toMatchObject({ state: "completed", outcome: "completed", data: { u_aftab_ar_ok: true } });
      const tell = await s.db.one<{ output: { recipients: string[]; count: number } }>(`select output from sm_flow_run_steps where run_id = (select run_ref::uuid from sm_process_cases where id = $1) and node_id = 'tell'`, [c]);
      expect(tell!.output.recipients.length).toBeGreaterThan(100);
    }, 300_000);

    it("R1 (NB1) the notice to too many people reaches them: their bells", async () => {
      expect(c).toBeTruthy();
      const k = await s.kase(c);
      // a crowd member who never had a task on the case (the delivery log says why when the bell is missing)
      const log = await s.db.query(`select channel, status, reason from sm_notification_log where org_id = $1 and recipient_id = $2`, [s.org, s.id("کارمند بانک#7")]);
      expect(await s.bells("کارمند بانک#7"), JSON.stringify(log)).toContain(`بازبینی دسترسی ${k.number}`);
    }, 60_000);

    it("R1 (1.1.5 (b), (c)) a step waiting with too many people: CaseDetail.waiting lists the candidates for the managers; re-resolving says too_many again", async () => {
      const r = await s.start("zhaleh", W9.key, { u_aftab_ar_scope: "سامانهٔ کارت" });
      await s.settle();
      await s.submit("ladan", r.case, "leads", { outcome: "approved" });
      await s.settle();
      const d = await s.detail("zhaleh", r.case);
      expect(d.can.reresolve).toBe(true);
      expect(d.waiting?.all).toMatchObject({ reason: "too_many" });
      expect(d.waiting.all.message).toBe("بیش از ۵۰ تأییدکننده پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند");
      expect(d.waiting.all.candidates.length).toBeGreaterThan(50);
      expect(d.waiting.all.candidates.every((x: { demo: boolean }) => typeof x.demo === "boolean")).toBe(true);
      // the reader who is no manager: no candidates
      const reader = await s.detail("ladan", r.case);
      expect(reader.waiting?.all?.candidates).toBeUndefined();
      const again = await s.reresolve("zhaleh", r.case, "all");
      expect(again.status).toBe("too_many");
      expect(await s.at(r.case, "all")).toEqual([]);
    }, 300_000);
  });
}
