// W12 «انتقال کارمند بین شعب» — two unit fields naming the heads of two branches in parallel (joined by «همه»), a
// members filter with a dynamic scope that may leave nobody (the unit's head as the fallback), the manager three
// levels up, a calendar-day wait, «تعیین مقدار» with unit pills, a position-type field, a unit in the title, and a
// rejection inside a parallel branch ending the case. Runs R1–R5 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { restartTargets, type ProcessGraph } from "@shared/process/graph";
import { bankUnits, e, item, n, section, tab, tehranDay, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W12 = { key: "aftab_transfer", name: "انتقال کارمند بین شعب" };

export function w12Draft(s: Scn, o: { returnFromBranch?: boolean } = {}): Draft {
  const F = s.forms.tr;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_tr_from_ok: "hidden", u_aftab_tr_to_ok: "hidden", u_aftab_tr_done_note: "hidden" } } }, "ثبت درخواست"),
        n("par", "parallel", {}, "موافقت دو شعبه"),
        n("src", "form_step", {
          action: "approve", quorum: "any", form: F, rights: { default: "read", fields: { u_aftab_tr_from_ok: "required" } },
          assignees: [{ kind: "position", position: "aftab_branch_head", where: "unit_field", unitField: "u_aftab_tr_from", members: s.ids("somayeh") }],
          fallback: [{ kind: "unit_head", of: "unit_field", unitField: "u_aftab_tr_from" }],
        }, "موافقت رئیس شعبهٔ مبدأ"),
        n("dst", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: { u_aftab_tr_to_ok: "required" } }, assignees: [{ kind: "position", position: "aftab_branch_head", where: "unit_field", unitField: "u_aftab_tr_to" }] }, "موافقت رئیس شعبهٔ مقصد"),
        n("join", "join", { mode: "all" }),
        n("senior", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "manager", of: "requester", depth: 3 }] }, "تأیید مدیر ارشد"),
        n("wait", "wait_duration", { mode: "duration", duration: { amount: 1, unit: "day" }, business: false }, "یک روز تقویمی پیش از اجرا"),
        n("setv", "set_values", { values: { u_aftab_tr_done_note: "انتقال از {{case.u_aftab_tr_from}} به {{case.u_aftab_tr_to}}" } }, "ثبت یادداشت"),
        n("hr", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_tr_done_note: "read", u_aftab_tr_role: "edit" } }, assignees: [{ kind: "group", group: s.g("hr") }] }, "ثبت در منابع انسانی"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej_src", "end", { outcome: "rejected" }, "پایان (رد مبدأ)"),
        n("rej_dst", "end", { outcome: "rejected" }, "پایان (رد مقصد)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [
        e("start", "request"), e("request", "par"), e("par", "src"), e("par", "dst"),
        e("src", "join", "approved"), e("src", "rej_src", "rejected"),
        e("dst", "join", "approved"), e("dst", "rej_dst", "rejected"),
        ...(o.returnFromBranch ? [e("dst", "request", "returned")] : []),
        e("join", "senior"), e("senior", "wait", "approved"), e("senior", "rej", "rejected"),
        e("wait", "setv"), e("setv", "hr"), e("hr", "done"),
      ],
    },
    starters: [{ kind: "users", users: s.ids("somayeh", "yaser") }],
    title_template: "انتقال {{case.requested_by}} به {{case.u_aftab_tr_to}}",
    managers: s.ids("parvaneh"),
  };
}

export async function setupW12(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  await s.person("mgr3", "معاون شعب", { unit: "hq", ...demo });
  await s.person("mgr2", "مدیر امور شعب البرز", { unit: "alborz", manager: "mgr3", ...demo });
  await s.person("mgr1", "معاون شعبهٔ کرج", { unit: "b0", manager: "mgr2", ...demo });
  await s.person("yaser", "یاسر اموالی", { unit: "b0", manager: "mgr1", ...demo });
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", ...demo });
  for (const b of ["b1", "b2", "b3"]) await s.person(`bh_${b}`, `رئیس ${b}`, { unit: b, ...demo });
  for (const b of ["b1", "b2"]) {
    await s.person(`bm_${b}`, `مدیر واحد ${b}`, { unit: b, ...demo });
    await s.unitHead(b, `bm_${b}`);
  }
  await s.person("parvaneh", "پروانه منابعی", { unit: "hr", ...demo });
  await s.person("hr1", "کارشناس منابع انسانی", { unit: "hr", ...demo });
  await s.group("hr", "منابع انسانی", ["parvaneh", "hr1"]);
  await s.field("u_aftab_tr_from", "شعبهٔ مبدأ", "unit");
  await s.field("u_aftab_tr_to", "شعبهٔ مقصد", "unit");
  await s.field("u_aftab_tr_date", "تاریخ انتقال", "date");
  await s.field("u_aftab_tr_role", "نقش سازمانی در مقصد", "position");
  await s.field("u_aftab_tr_from_ok", "موافقت شعبهٔ مبدأ", "checkbox");
  await s.field("u_aftab_tr_to_ok", "موافقت شعبهٔ مقصد", "checkbox");
  await s.field("u_aftab_tr_done_note", "یادداشت ثبت", "string");
  await s.form("tr", "فرم انتقال", [
    tab("انتقال", [section(null, [item("u_aftab_tr_from", { required: true }), item("u_aftab_tr_to", { required: true }), item("u_aftab_tr_date"), item("u_aftab_tr_role")])]),
    tab("موافقت‌ها", [section(null, [item("u_aftab_tr_from_ok"), item("u_aftab_tr_to_ok")])]),
    tab("ثبت", [section(null, [item("u_aftab_tr_done_note")])]),
  ]);
  await s.position("aftab_branch_head", "رئیس شعبه", { unitKind: "branch" });
  await s.hold("aftab_branch_head", "somayeh", "b0");
  for (const b of ["b1", "b2", "b3"]) await s.hold("aftab_branch_head", `bh_${b}`, b);
}

export function w12(ref: EditionRef): void {
  describe("W12 «انتقال کارمند بین شعب»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW12(s);
      const pub = await s.publish(W12.key, W12.name, w12Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    const move = (from: string, to: string) => ({ u_aftab_tr_from: s.u(from), u_aftab_tr_to: s.u(to), u_aftab_tr_date: tehranDay(10) });

    it("R1 both branch heads in parallel, the manager three levels up, a calendar day's wait, the note, HR's position field; the title names the unit", async () => {
      const r = await s.start("yaser", W12.key, move("b0", "b1"));
      await s.settle();
      expect((await s.kase(r.case)).title).toBe("انتقال یاسر اموالی به شعبهٔ فردیس");
      expect([await s.openAt(r.case, "src"), await s.openAt(r.case, "dst")]).toEqual([["somayeh"], ["bh_b1"]]);
      await s.submit("somayeh", r.case, "src", { outcome: "approved", values: { u_aftab_tr_from_ok: true } });
      await s.settle();
      expect(await s.openAt(r.case, "senior")).toEqual([]);
      await s.submit("bh_b1", r.case, "dst", { outcome: "approved", values: { u_aftab_tr_to_ok: true } });
      await s.settle();
      expect(await s.openAt(r.case, "senior")).toEqual(["mgr3"]);
      await s.submit("mgr3", r.case, "senior", { outcome: "approved" });
      await s.settle();
      expect((await s.path(r.case)).at(-1)).toBe("wait:waiting");
      await s.waitsDue();
      expect(await s.openAt(r.case, "hr")).toEqual(["hr1", "parvaneh"]);
      await s.submit("hr1", r.case, "hr", { values: { u_aftab_tr_role: s.positions.aftab_branch_head } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_tr_from_ok: true, u_aftab_tr_to_ok: true, u_aftab_tr_role: s.positions.aftab_branch_head } });
    }, 300_000);

    it("R1 «تعیین مقدار» with unit pills writes the units' names into the note (as the title does), not their ids", async () => {
      const r = await s.start("yaser", W12.key, move("b0", "b2"));
      await s.settle();
      await s.submit("somayeh", r.case, "src", { outcome: "approved", values: { u_aftab_tr_from_ok: true } });
      await s.submit("bh_b2", r.case, "dst", { outcome: "approved", values: { u_aftab_tr_to_ok: true } });
      await s.settle();
      await s.submit("mgr3", r.case, "senior", { outcome: "approved" });
      await s.settle();
      await s.waitsDue();
      expect((await s.kase(r.case)).data.u_aftab_tr_done_note).toBe("انتقال از شعبهٔ کرج مرکزی به شعبهٔ خرم‌آباد");
    }, 300_000);

    it("R2 the members filter leaves nobody in the source branch: the branch's head (the fallback) decides", async () => {
      const r = await s.start("yaser", W12.key, move("b2", "b1"));
      await s.settle();
      expect([await s.openAt(r.case, "src"), await s.openAt(r.case, "dst")]).toEqual([["bm_b2"], ["bh_b1"]]);
    }, 300_000);

    it("R3 a rejection in one branch ends the case: rejected, the other branch's open task «دیگر لازم نیست»", async () => {
      const r = await s.start("yaser", W12.key, move("b0", "b3"));
      await s.settle();
      await s.submit("bh_b3", r.case, "dst", { outcome: "rejected", comment: "جای خالی نداریم" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "rejected", outcome: "rejected" });
      expect(await s.at(r.case, "src")).toEqual(["somayeh:not_needed"]);
    }, 300_000);

    it("R4 a requester without a manager three levels up: the senior step waits; a manager's «ارجاع» moves it on", async () => {
      const r = await s.start("somayeh", W12.key, move("b1", "b3"));
      await s.settle();
      expect([await s.openAt(r.case, "src"), await s.openAt(r.case, "dst")]).toEqual([["bm_b1"], ["bh_b3"]]);
      await s.submit("bm_b1", r.case, "src", { outcome: "approved", values: { u_aftab_tr_from_ok: true } });
      await s.submit("bh_b3", r.case, "dst", { outcome: "approved", values: { u_aftab_tr_to_ok: true } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "waiting" });
      // (1.1.5: the line naming the managers told, then the resolver's reason)
      expect(await s.journal(r.case)).toContain("برای «تأیید مدیر ارشد» کسی پیدا نشد؛ مسئولان گردش‌کار (پروانه منابعی) باخبر شدند. درخواست‌دهنده مدیر مستقیم ندارد.");
      await s.reassign("parvaneh", r.case, "senior", ["mgr3"]);
      await s.submit("mgr3", r.case, "senior", { outcome: "approved" });
      await s.settle();
      expect((await s.path(r.case)).at(-1)).toBe("wait:waiting");
    }, 300_000);

    it("R5 the designer refuses a return across the parallel block, and «ادامه از مرحلهٔ …» never offers a branch's step", async () => {
      const saved = await s.saveDraft(W12.key, w12Draft(s, { returnFromBranch: true }));
      expect(saved.problems.filter((p: { level: string }) => p.level === "error").map((p: { message: string }) => p.message)).toContain("«بازگشت برای اصلاح» از مرز «موازی» و «پیوستن» نمی‌گذرد");
      const targets = restartTargets(w12Draft(s).graph as unknown as ProcessGraph);
      expect(targets).toContain("senior");
      expect(targets).not.toContain("src");
      expect(targets).not.toContain("dst");
      await s.saveDraft(W12.key, w12Draft(s));
    }, 300_000);
  });
}
