// W3 «درخواست مرخصی و معرفی جانشین» — people-dependent rules: a user field, the manager at depth 1 and 2 and the
// previous actor's manager, an earlier step's actor, the requester; «انتخاب» with «هیچ‌کدام» and operator families;
// «تعیین مقدار», «اعلان», «انتظار تا»; «اگر کسی پیدا نشد: بگذرد»; delegation (out of office, and a delegation row of
// the wrong scope); a read-only field; a tab whose field shows by showIf. Runs R1–R8 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, item, n, note, PNG, section, tab, tehranDay, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W3 = { key: "aftab_leave", name: "درخواست مرخصی و معرفی جانشین" };

export function w3Draft(s: Scn): Draft {
  const F = s.forms.lv;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_lv_hr_note: "hidden", u_aftab_lv_status: "hidden", u_aftab_lv_back: "hidden", u_aftab_lv_doctor: "required" } } }, "ثبت درخواست"),
        n("sub_ok", "form_step", { action: "fill", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "field", field: "u_aftab_lv_sub" }], exclude: ["requester"], ifNobody: "skip" }, "موافقت جانشین"),
        n("mgr", "form_step", {
          action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} },
          assignees: [{ kind: "manager", of: "requester" }], fallback: [{ kind: "manager", of: "requester", depth: 2 }], ifNobody: "managers",
        }, "تأیید مدیر مستقیم"),
        n("kind", "choice", {
          cases: [
            { key: "sick", label: "استعلاجی", rules: [{ left: "{{case.u_aftab_lv_type}}", op: "eq", right: "sick" }] },
            { key: "long", label: "طولانی یا بدون حقوق", match: "any", rules: [{ left: "{{case.u_aftab_lv_days}}", op: "gt", right: "7" }, { left: "{{case.u_aftab_lv_type}}", op: "eq", right: "unpaid" }] },
            { key: "nosub", label: "بی‌جانشین", rules: [{ left: "{{case.u_aftab_lv_sub}}", op: "empty" }] },
          ],
        }, "نوع مرخصی"),
        n("hr", "form_step", { action: "review", form: F, rights: { default: "read", fields: { u_aftab_lv_hr_note: "required" } }, assignees: [{ kind: "group", group: s.g("hr") }] }, "بررسی منابع انسانی"),
        n("senior", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "manager", of: "previous_actor" }], exclude: ["earlier_actors"] }, "تأیید مدیر ارشد"),
        n("warn", "notify", { to: [{ kind: "manager", of: "requester" }], subject: "مرخصی بدون جانشین: {{case.number}}", body: "{{case.title}}" }, "اعلان بی‌جانشین"),
        n("setv", "set_values", { values: { u_aftab_lv_status: "تأییدشده از {{case.u_aftab_lv_from}} تا {{case.u_aftab_lv_to}}" } }, "ثبت وضعیت"),
        n("tell", "notify", { to: [{ kind: "field", field: "u_aftab_lv_sub" }, { kind: "requester" }], subject: "مرخصی تأیید شد", body: "{{case.u_aftab_lv_status}}" }, "اعلان تأیید"),
        n("wait", "wait_duration", { mode: "until", until: "{{case.u_aftab_lv_to}}" }, "تا پایان مرخصی"),
        n("back", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_lv_back: "required" } }, assignees: [{ kind: "step_actor", step: "request" }] }, "ثبت بازگشت به کار"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
      ],
      edges: [
        e("start", "request"), e("request", "sub_ok"), e("sub_ok", "mgr"),
        e("mgr", "kind", "approved"), e("mgr", "rej", "rejected"), e("mgr", "request", "returned"),
        e("kind", "hr", "sick"), e("kind", "senior", "long"), e("kind", "warn", "nosub"), e("kind", "setv", "else"),
        e("hr", "setv"), e("hr", "request", "returned"),
        e("senior", "setv", "approved"), e("senior", "rej", "rejected"),
        e("warn", "setv"), e("setv", "tell"), e("tell", "wait"), e("wait", "back"), e("back", "done"),
      ],
    },
    starters: [{ kind: "users", users: s.ids("negar", "yaser", "somayeh", "desk1") }],
    title_template: "مرخصی {{case.u_aftab_lv_type}} {{case.requested_by}}",
    managers: s.ids("parvaneh"),
  };
}

export async function setupW3(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  // the manager chain the pack sets on its own people
  await s.person("techvp", "معاون فناوری", { unit: "it", ...demo });
  await s.person("itdir", "مدیر کل فناوری اطلاعات", { unit: "it", manager: "techvp", ...demo });
  await s.person("behrouz", "بهروز مدیرنیا", { unit: "it", manager: "itdir", ...demo });
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", manager: "behrouz", ...demo });
  await s.person("desk1", "کارمند میز خدمت", { unit: "it", manager: "negar", ...demo });
  await s.person("colleague", "همکار جانشین", { unit: "it", manager: "behrouz", ...demo });
  await s.person("yaser", "یاسر اموالی", { unit: "b0", ...demo });
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", ...demo });
  await s.person("parvaneh", "پروانه منابعی", { unit: "hr", ...demo });
  await s.person("hr1", "کارشناس منابع انسانی", { unit: "hr", ...demo });
  await s.group("hr", "منابع انسانی", ["parvaneh", "hr1"]);
  await s.field("u_aftab_lv_type", "نوع مرخصی", "select", { options: [{ value: "annual", label: "استحقاقی" }, { value: "sick", label: "استعلاجی" }, { value: "unpaid", label: "بدون حقوق" }] });
  await s.field("u_aftab_lv_from", "از تاریخ", "date");
  await s.field("u_aftab_lv_to", "تا تاریخ", "date");
  await s.field("u_aftab_lv_days", "تعداد روز", "int", { validation: { min: 1, max: 30 } });
  await s.field("u_aftab_lv_sub", "جانشین در مدت مرخصی", "user");
  await s.field("u_aftab_lv_doctor", "گواهی پزشک", "attachment", { validation: { max: 2 } });
  await s.field("u_aftab_lv_hr_note", "نظر منابع انسانی", "text");
  await s.field("u_aftab_lv_status", "وضعیت ثبت", "string");
  await s.field("u_aftab_lv_back", "بازگشت به کار ثبت شد", "checkbox");
  await s.form("lv", "فرم مرخصی", [
    tab("درخواست", [
      section("نوع و تاریخ", [item("u_aftab_lv_type", { required: true }), item("u_aftab_lv_from"), item("u_aftab_lv_to"), item("u_aftab_lv_days", { required: true })], 2),
      section("جانشین", [item("u_aftab_lv_sub")]),
    ]),
    tab("مدارک", [section(null, [item("u_aftab_lv_doctor", { showIf: { f: "u_aftab_lv_type", op: "eq", v: "sick" } }), note("برای مرخصی استعلاجی گواهی لازم است", "warning")])]),
    tab("منابع انسانی", [section(null, [item("u_aftab_lv_hr_note"), item("u_aftab_lv_status", { readonly: true }), item("u_aftab_lv_back")])]),
  ]);
}

const leave = (s: Scn, o: Record<string, unknown> = {}) => ({
  u_aftab_lv_type: "annual", u_aftab_lv_from: tehranDay(1), u_aftab_lv_to: tehranDay(3), u_aftab_lv_days: 3, u_aftab_lv_sub: s.id("colleague"), ...o,
});

/** From «تعیین مقدار» to the end: the wait is due, the requester confirms the return to work. */
async function finish(s: Scn, caseId: string, requester = "negar") {
  await s.waitsDue();
  expect(await s.openAt(caseId, "back")).toEqual([requester]);
  const step = await s.myStep(requester, caseId, "back");
  expect(step.rights).toMatchObject({ u_aftab_lv_back: "required", u_aftab_lv_status: "read" });
  await s.submit(requester, caseId, "back", { values: { u_aftab_lv_back: true } });
  await s.settle();
  expect(await s.kase(caseId)).toMatchObject({ state: "completed", outcome: "completed" });
}

export function w03(ref: EditionRef): void {
  describe("W3 «درخواست مرخصی و معرفی جانشین»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW3(s);
      const pub = await s.publish(W3.key, W3.name, w3Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R1 annual leave with a substitute: the substitute agrees, the manager approves, the status is written, both are told, the wait ends and the requester confirms the return", async () => {
      // the status is read-only: a value sent at the start is left out
      const r = await s.start("negar", W3.key, leave(s, { u_aftab_lv_status: "تأیید شد!" }));
      await s.settle();
      expect((await s.kase(r.case)).data.u_aftab_lv_status ?? null).toBeNull();
      expect((await s.kase(r.case)).title).toBe("مرخصی استحقاقی نگار کارشناس‌پور");
      expect(await s.openAt(r.case, "sub_ok")).toEqual(["colleague"]);
      await s.submit("colleague", r.case, "sub_ok");
      await s.settle();
      expect(await s.openAt(r.case, "mgr")).toEqual(["behrouz"]);
      await s.submit("behrouz", r.case, "mgr", { outcome: "approved" });
      await s.settle();
      const k = await s.kase(r.case);
      expect(k.data.u_aftab_lv_status).toMatch(/^تأییدشده از .+ تا .+$/);
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "sub_ok:out", "mgr:approved", "kind:else", "setv:out", "tell:out", "wait:waiting"]);
      for (const who of ["colleague", "negar"]) expect(await s.bells(who)).toContain("مرخصی تأیید شد");
      await finish(s, r.case);
      expect((await s.kase(r.case)).data).toMatchObject({ u_aftab_lv_back: true, u_aftab_lv_days: 3 });
    }, 300_000);

    it("R2 sick leave: the doctor's note is required and taken only for sick leave; HR returns it, the requester resubmits, the case completes", async () => {
      // annual: the note is neither asked nor taken
      const annual = await s.multipart("negar", "/process/start", { process: W3.key, values: { ...leave(s), u_aftab_lv_doctor: [{ upload: 0 }] } }, [{ name: "note.png", data: PNG, type: "image/png" }], 201);
      await s.settle();
      expect((await s.kase(annual.case)).data.u_aftab_lv_doctor ?? null).toBeNull();
      // sick without the note: refused
      const bad = await s.refused(s.start("negar", W3.key, leave(s, { u_aftab_lv_type: "sick" }), { expect: 400 }));
      expect(Object.keys(bad.fields)).toEqual(["u_aftab_lv_doctor"]);
      const sick = await s.multipart("negar", "/process/start", { process: W3.key, values: { ...leave(s, { u_aftab_lv_type: "sick" }), u_aftab_lv_doctor: [{ upload: 0 }] } }, [{ name: "note.png", data: PNG, type: "image/png" }], 201);
      const c = sick.case as string;
      await s.settle();
      await s.submit("colleague", c, "sub_ok");
      await s.settle();
      await s.submit("behrouz", c, "mgr", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(c, "hr")).toEqual(["hr1", "parvaneh"]);
      await s.submit("hr1", c, "hr", { outcome: "returned" }, 400);
      await s.submit("hr1", c, "hr", { outcome: "returned", comment: "تاریخ گواهی خوانا نیست" });
      await s.settle();
      expect(await s.openAt(c, "request")).toEqual(["negar"]);
      await s.submit("negar", c, "request", { values: { u_aftab_lv_days: 2 } });
      await s.settle();
      // the way forward again: the substitute and the manager decide the corrected request
      await s.submit("colleague", c, "sub_ok");
      await s.settle();
      await s.submit("behrouz", c, "mgr", { outcome: "approved" });
      await s.settle();
      await s.submit("parvaneh", c, "hr", { outcome: "submitted", values: { u_aftab_lv_hr_note: "ثبت شد" } });
      await s.settle();
      await finish(s, c);
      expect((await s.kase(c)).data).toMatchObject({ u_aftab_lv_hr_note: "ثبت شد", u_aftab_lv_days: 2 });
    }, 300_000);

    it("R3 unpaid leave of 10 days: «طولانی» — the senior approval goes to the manager of the previous actor, the earlier actors left out", async () => {
      const r = await s.start("negar", W3.key, leave(s, { u_aftab_lv_type: "unpaid", u_aftab_lv_days: 10, u_aftab_lv_to: tehranDay(11) }));
      await s.settle();
      await s.submit("colleague", r.case, "sub_ok");
      await s.settle();
      await s.submit("behrouz", r.case, "mgr", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "senior")).toEqual(["itdir"]);
      await s.submit("itdir", r.case, "senior", { outcome: "approved" });
      await s.settle();
      expect((await s.path(r.case)).slice(4, 6)).toEqual(["kind:long", "senior:approved"]);
      await finish(s, r.case);
    }, 300_000);

    it("R4 no substitute: «موافقت جانشین» finds nobody and is skipped (journaled); «بی‌جانشین» tells the manager", async () => {
      const r = await s.start("negar", W3.key, leave(s, { u_aftab_lv_sub: null }));
      await s.settle();
      expect(await s.journal(r.case)).toContain("برای «موافقت جانشین» کسی پیدا نشد؛ از این مرحله گذشت.");
      expect(await s.openAt(r.case, "mgr")).toEqual(["behrouz"]);
      await s.submit("behrouz", r.case, "mgr", { outcome: "approved" });
      await s.settle();
      expect((await s.path(r.case)).slice(2, 6)).toEqual(["sub_ok:out", "mgr:approved", "kind:nosub", "warn:out"]);
      const k = await s.kase(r.case);
      expect(await s.bells("behrouz")).toContain(`مرخصی بدون جانشین: ${k.number}`);
      await finish(s, r.case);
    }, 300_000);

    it("R5 the requester names herself as substitute: excluded, nobody, skipped", async () => {
      const r = await s.start("negar", W3.key, leave(s, { u_aftab_lv_sub: s.id("negar") }));
      await s.settle();
      expect(await s.at(r.case, "sub_ok")).toEqual([]);
      expect(await s.journal(r.case)).toContain("برای «موافقت جانشین» کسی پیدا نشد؛ از این مرحله گذشت.");
      expect(await s.openAt(r.case, "mgr")).toEqual(["behrouz"]);
    }, 300_000);

    it("R6 delegation: the manager is out of office — his delegate approves «به جانشینی از …»; a delegation of «assignments» does not reach an approval", async () => {
      await s.profile("behrouz", { out_of_office: true, delegate_id: s.id("itdir") });
      try {
        const r = await s.start("negar", W3.key, leave(s, { u_aftab_lv_sub: null }));
        await s.settle();
        const t = (await s.tasks(r.case)).find((x) => x.step_key === "mgr")!;
        expect([s.key(t.assigned_to), s.key(t.delegated_from)]).toEqual(["itdir", "behrouz"]);
        await s.submit("itdir", r.case, "mgr", { outcome: "approved" });
        await s.settle();
        expect((await s.journal(r.case)).some((l) => l.includes("«تأیید مدیر مستقیم» را تأیید کرد (به جانشینی از بهروز مدیرنیا)"))).toBe(true);
      } finally {
        await s.profile("behrouz", { out_of_office: false, delegate_id: null });
      }
      const now = Date.now();
      // his own delegation («جانشینی»), of the scope «کارها» only
      await s.as("behrouz").post(`${s.P}/r/delegation`, { from_user: s.id("behrouz"), to_user: s.id("colleague"), starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 86_400_000).toISOString(), scopes: ["assignments"] });
      const r2 = await s.start("negar", W3.key, leave(s, { u_aftab_lv_sub: null }));
      await s.settle();
      expect(await s.openAt(r2.case, "mgr")).toEqual(["behrouz"]);
    }, 300_000);

    it("R7 a requester with no manager at either depth: the step goes to the process managers", async () => {
      const r = await s.start("yaser", W3.key, leave(s, { u_aftab_lv_sub: null }));
      await s.settle();
      expect(await s.openAt(r.case, "mgr")).toEqual(["parvaneh"]);
    }, 300_000);

    it("R7b the manager's manager stands in at depth 2 when the first has gone (the fallback rule)", async () => {
      // the desk employee's manager is نگار; with her membership inactive the fallback (depth 2) finds بهروز
      await s.setActive("negar", false);
      try {
        const r = await s.start("desk1", W3.key, leave(s, { u_aftab_lv_sub: null }));
        await s.settle();
        expect(await s.openAt(r.case, "mgr")).toEqual(["behrouz"]);
      } finally {
        await s.setActive("negar", true);
      }
    }, 300_000);

    it("R8 the manager rejects with a comment: «پایان (ردشده)»", async () => {
      const r = await s.start("negar", W3.key, leave(s, { u_aftab_lv_sub: null }));
      await s.settle();
      await s.submit("behrouz", r.case, "mgr", { outcome: "rejected", comment: "در این هفته ممکن نیست" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "rejected", outcome: "rejected" });
    }, 300_000);
  });
}
