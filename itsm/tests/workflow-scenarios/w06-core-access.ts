// W6 «درخواست دسترسی ویژه به کربنکینگ» — a confidential case with named managers and a managers' group, readers left
// out (an auditor, a designer), restricted starters, a request on someone's behalf, a field of the «اطلاعات شخصی»
// group, requester_view, a pool step taken and put back, pause and resume, the requester's cancel and the managers',
// and a publish that narrows the managers reaching every case. Runs R1–R7 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, item, n, section, tab, tehranDay, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W6 = { key: "aftab_core_access", name: "درخواست دسترسی ویژه به کربنکینگ" };

export function w6Draft(s: Scn, o: { cab?: boolean } = {}): Draft {
  const F = s.forms.ca;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_ca_ticket: "hidden" } } }, "ثبت درخواست"),
        n("soc", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "group", group: s.g("soc") }], due: { amount: 1, unit: "day" } }, "تأیید امنیت اطلاعات"),
        n("grant", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_ca_ticket: "required", u_aftab_ca_nid: "hidden" } }, assignees: [{ kind: "group", group: s.g("core") }] }, "اعطای دسترسی"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [e("start", "request"), e("request", "soc"), e("soc", "grant", "approved"), e("soc", "rej", "rejected"), e("soc", "request", "returned"), e("grant", "done")],
    },
    starters: [{ kind: "position", position: "aftab_branch_head", where: "anywhere" }, { kind: "users", users: s.ids("somayeh", "negar") }],
    title_template: "دسترسی {{case.u_aftab_ca_system}} برای {{case.requested_for}}",
    requester_view: ["u_aftab_ca_ticket"],
    managers: s.ids("zhaleh"),
    manager_groups: o.cab === false ? [] : [s.g("cab")],
    confidential: true,
  };
}

export async function setupW6(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  // «کارشناس» (agent) holds the personal field group; «درخواست‌کننده» does not
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", roles: ["agent"], ...demo });
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", roles: ["agent"], ...demo });
  await s.person("emp", "کارمند شعبهٔ کرج", { unit: "b0", ...demo });
  await s.person("bh1", "رئیس شعبهٔ فردیس", { unit: "b1", ...demo });
  await s.person("parvaneh", "پروانه منابعی", { unit: "hr", ...demo });
  await s.person("zhaleh", "ژاله ریسک‌شناس", { unit: "sec", roles: ["agent"], ...demo });
  await s.person("ladan", "لادن امنیت‌یار", { unit: "sec", ...demo });
  await s.person("soc1", "تحلیلگر مرکز عملیات یکم", { unit: "sec", ...demo });
  await s.person("core1", "کارشناس کربنکینگ یکم", { unit: "it", ...demo });
  await s.person("core2", "کارشناس کربنکینگ دوم", { unit: "it", ...demo });
  await s.person("cab1", "عضو کمیتهٔ تغییرات", { unit: "it", ...demo });
  await s.person("auditor", "حسابرس داخلی", { unit: "hq", roles: ["auditor"], ...demo });
  await s.person("designer", "طراح گردش‌کار", { unit: "it", roles: ["process_designer"], ...demo });
  await s.group("soc", "مرکز عملیات امنیت", ["ladan", "soc1"]);
  await s.group("core", "کربنکینگ", ["core1", "core2"]);
  await s.group("cab", "کمیتهٔ تغییرات", ["cab1"]);
  await s.field("u_aftab_ca_system", "سامانه", "select", { options: [{ value: "core", label: "کربنکینگ" }, { value: "cards", label: "کارت" }, { value: "swift", label: "سوئیفت" }] });
  await s.field("u_aftab_ca_level", "سطح", "radio", { options: [{ value: "read", label: "خواندن" }, { value: "write", label: "نوشتن" }, { value: "admin", label: "مدیریت" }] });
  await s.field("u_aftab_ca_until", "تا تاریخ", "date");
  await s.field("u_aftab_ca_nid", "کد ملی کاربر", "national_id", { field_group: "personal" });
  await s.field("u_aftab_ca_reason", "دلیل", "text");
  await s.field("u_aftab_ca_ticket", "شمارهٔ تیکت اجرا", "string");
  await s.form("ca", "فرم دسترسی ویژه", [
    tab("درخواست", [section(null, [item("u_aftab_ca_system", { required: true }), item("u_aftab_ca_level", { required: true }), item("u_aftab_ca_until"), item("u_aftab_ca_nid"), item("u_aftab_ca_reason")])]),
    tab("اجرا", [section(null, [item("u_aftab_ca_ticket")])]),
  ]);
  await s.position("aftab_branch_head", "رئیس شعبه", { unitKind: "branch" });
  await s.hold("aftab_branch_head", "somayeh", "b0");
  await s.hold("aftab_branch_head", "bh1", "b1");
}

const request = (o: Record<string, unknown> = {}) => ({ u_aftab_ca_system: "core", u_aftab_ca_level: "read", u_aftab_ca_until: tehranDay(30), u_aftab_ca_nid: "0012345679", u_aftab_ca_reason: "گزارش‌گیری", ...o });

export function w06(ref: EditionRef): void {
  describe("W6 «درخواست دسترسی ویژه به کربنکینگ»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW6(s);
      const pub = await s.publish(W6.key, W6.name, w6Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R1 a non-starter has no «شروع» and an API start is refused", async () => {
      const mine = await s.as("parvaneh").get(`${s.P}/process/mine`);
      const row = mine.processes.find((p: any) => p.key === W6.key);
      expect(row?.can_start ?? false).toBe(false);
      const no = await s.refused(s.start("parvaneh", W6.key, request(), { expect: 409 }));
      expect(no.message).toBe("شما اجازهٔ آغاز این گردش‌کار را ندارید");
      // a holder of the starters' position may
      expect((await s.as("bh1").get(`${s.P}/process/mine`)).processes.find((p: any) => p.key === W6.key)?.can_start).toBe(true);
    }, 300_000);

    it("R2 a request on someone's behalf: the approval leaves out both the filer and the beneficiary", async () => {
      const r = await s.start("somayeh", W6.key, request(), { requested_for: "soc1" });
      await s.settle();
      const k = await s.kase(r.case);
      expect([s.key(k.requested_by), s.key(k.requested_for)]).toEqual(["somayeh", "soc1"]);
      expect(k.title).toBe("دسترسی کربنکینگ برای تحلیلگر مرکز عملیات یکم");
      expect(await s.openAt(r.case, "soc")).toEqual(["ladan"]);
      // the beneficiary reads the case as its requester
      expect((await s.detail("soc1", r.case)).case.requested_for).toBe(s.id("soc1"));
    }, 300_000);

    it("R3 a pool step taken: the others cannot send it until it is put back; the ticket is entered; the requester reads it, the national id stays with its field group", async () => {
      const r = await s.start("somayeh", W6.key, request());
      await s.settle();
      expect(await s.openAt(r.case, "soc")).toEqual(["ladan", "soc1"]);
      await s.claim("ladan", r.case, "soc");
      expect((await s.tasks(r.case)).filter((t) => t.step_key === "soc").map((t) => s.key(t.claimed_by))).toEqual(["ladan", "ladan"]);
      expect((await s.as("soc1").get(`${s.P}/process/inbox`)).rows.find((x: any) => x.case_id === r.case)).toMatchObject({ claimed_by: s.id("ladan") });
      const taken = await s.refused(s.submit("soc1", r.case, "soc", { outcome: "approved" }, 409));
      expect(taken.message).toBe("این مرحله در دست لادن امنیت‌یار است");
      await s.release("ladan", r.case, "soc");
      expect((await s.tasks(r.case)).filter((t) => t.step_key === "soc").map((t) => t.claimed_by)).toEqual([null, null]);
      await s.submit("ladan", r.case, "soc", { outcome: "approved" });
      await s.settle();
      // the grant step: the ticket required, the national id hidden
      const step = await s.myStep("core1", r.case, "grant");
      expect(step.rights).toMatchObject({ u_aftab_ca_ticket: "required", u_aftab_ca_nid: "hidden" });
      expect((await s.detail("core1", r.case)).data.u_aftab_ca_nid ?? null).toBeNull();
      await s.submit("core1", r.case, "grant", { values: { u_aftab_ca_ticket: "CHG-4410" } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_ca_ticket: "CHG-4410", u_aftab_ca_nid: "0012345679" } });
      const mine = await s.detail("somayeh", r.case);
      expect(mine.data).toMatchObject({ u_aftab_ca_ticket: "CHG-4410", u_aftab_ca_system: "core", u_aftab_ca_nid: "0012345679" });
      // the SOC member read the request without the personal field
      expect((await s.detail("ladan", r.case)).data.u_aftab_ca_nid ?? null).toBeNull();
    }, 300_000);

    it("R4 confidential: an auditor and a designer cannot open the case; the named manager and the managers' group can", async () => {
      const r = await s.start("somayeh", W6.key, request({ u_aftab_ca_system: "swift" }));
      await s.settle();
      await s.detail("auditor", r.case, 404);
      await s.detail("designer", r.case, 404);
      expect((await s.detail("zhaleh", r.case)).data).toMatchObject({ u_aftab_ca_system: "swift", u_aftab_ca_nid: "0012345679" });
      const cab = await s.detail("cab1", r.case);
      expect(cab.can.manage).toBe(true);
      expect(cab.data.u_aftab_ca_nid ?? null).toBeNull();
    }, 300_000);

    it("R5 paused by a manager: the SOC's submit is refused and its inbox row shows it paused; resumed: the step goes on", async () => {
      const r = await s.start("somayeh", W6.key, request({ u_aftab_ca_system: "cards" }));
      await s.settle();
      await s.caseAction("zhaleh", r.case, "pause");
      const no = await s.refused(s.submit("ladan", r.case, "soc", { outcome: "approved" }, 409));
      expect(no.message).toContain("موقتاً متوقف");
      expect((await s.as("ladan").get(`${s.P}/process/inbox`)).rows.find((x: any) => x.case_id === r.case)).toMatchObject({ paused: true, can_act: false });
      await s.caseAction("zhaleh", r.case, "resume");
      await s.submit("ladan", r.case, "soc", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "grant")).toEqual(["core1", "core2"]);
    }, 300_000);

    it("R6 the requester cancels before the SOC acts; after the approval only a manager may, and with a comment", async () => {
      const a = await s.start("somayeh", W6.key, request());
      await s.settle();
      expect(await s.caseAction("somayeh", a.case, "cancel")).toMatchObject({ result: "applied", by: "requester" });
      await s.settle();
      expect(await s.kase(a.case)).toMatchObject({ state: "canceled" });
      const b = await s.start("somayeh", W6.key, request());
      await s.settle();
      await s.submit("soc1", b.case, "soc", { outcome: "approved" });
      await s.settle();
      const no = await s.refused(s.caseAction("somayeh", b.case, "cancel", undefined, 409));
      expect(no.message).toBe("پس از انجام نخستین مرحله، پرونده را فقط مسئولان گردش‌کار لغو می‌کنند");
      const empty = await s.refused(s.caseAction("zhaleh", b.case, "cancel", undefined, 400));
      expect(empty.message).toBe("برای لغو پرونده، توضیح بنویسید");
      await s.caseAction("zhaleh", b.case, "cancel", "دسترسی دیگر لازم نیست");
      await s.settle();
      expect(await s.kase(b.case)).toMatchObject({ state: "canceled" });
      expect(await s.at(b.case, "grant")).toEqual(["core1:canceled", "core2:canceled"]);
    }, 300_000);

    it("R7 a new version without the managers' group reaches every case: the group's member no longer opens them", async () => {
      const r = await s.start("somayeh", W6.key, request());
      await s.settle();
      await s.detail("cab1", r.case);
      await s.publish(W6.key, W6.name, w6Draft(s, { cab: false }));
      await s.detail("cab1", r.case, 404);
      expect(await s.kase(r.case)).toMatchObject({ manager_groups: [] });
      await s.detail("zhaleh", r.case);
    }, 300_000);
  });
}
