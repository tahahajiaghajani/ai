// W11 «درخواست تجهیزات جانبی» — the simplest everyday flow: a saved draft of the start, a group-type field naming the
// step's people (a group fallback), a delegation that starts after the step opened, a notice to the managers and an
// automatic «ثبت» after the deadline, a review by the requester with a return to the middle step, the print view,
// «انجام‌شده‌ها» and the inbox's chips. Runs R1, R3–R5 here; R2 (a linked Windows app offline) in ./linked.test.ts.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, DAY, e, item, n, PNG, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W11 = { key: "aftab_peripheral", name: "درخواست تجهیزات جانبی" };

export function w11Draft(s: Scn): Draft {
  const F = s.forms.eq;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_eq_serial: "hidden", u_aftab_eq_photo: "hidden" } } }, "ثبت درخواست"),
        n("deliver", "form_step", {
          action: "fill", form: F, rights: { default: "read", fields: { u_aftab_eq_serial: "required", u_aftab_eq_photo: "edit" } },
          assignees: [{ kind: "field", field: "u_aftab_eq_team" }], fallback: [{ kind: "group", group: s.g("desk") }],
          due: { amount: 2, unit: "day" }, escalate: [{ after: { amount: 1, unit: "day" }, action: "notify", to: "managers" }, { after: { amount: 3, unit: "day" }, action: "auto", outcome: "submitted" }],
        }, "تحویل تجهیز"),
        n("confirm", "form_step", { action: "review", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "requester" }] }, "تأیید دریافت"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
      ],
      edges: [e("start", "request"), e("request", "deliver"), e("deliver", "confirm"), e("confirm", "done"), e("confirm", "deliver", "returned")],
    },
    starters: [{ kind: "users", users: s.ids("negar", "yaser", "somayeh", "ramin", "behrouz") }],
    title_template: "{{case.u_aftab_eq_item}} برای {{case.requested_by}}",
    managers: s.ids("ramin"),
  };
}

export async function setupW11(s: Scn, o: { demo?: boolean } = {}): Promise<void> {
  await bankUnits(s);
  const demo = { demo: o.demo ?? true };
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", ...demo });
  await s.person("yaser", "یاسر اموالی", { unit: "b0", ...demo });
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", ...demo });
  await s.person("ramin", "رامین دارایی", { unit: "it", ...demo });
  await s.person("behrouz", "بهروز مدیرنیا", { unit: "it", ...demo });
  await s.person("as1", "کارشناس اموال یکم", { unit: "it", ...demo });
  await s.person("as2", "کارشناس اموال دوم", { unit: "it", ...demo });
  await s.person("col1", "همکار اموال", { unit: "it", manager: "as1", ...demo });
  await s.person("desk1", "کارشناس میز خدمت", { unit: "it", ...demo });
  await s.group("assets", "اموال و تجهیزات", ["as1", "as2"]);
  await s.group("desk", "میز خدمت", ["desk1"]);
  await s.field("u_aftab_eq_item", "تجهیز", "select", { options: [{ value: "monitor", label: "نمایشگر" }, { value: "keyboard", label: "صفحه‌کلید" }, { value: "printer", label: "چاپگر" }, { value: "headset", label: "هدست" }] });
  await s.field("u_aftab_eq_qty", "تعداد", "int", { validation: { min: 1, max: 10 } });
  await s.field("u_aftab_eq_team", "گروه پشتیبانی مسئول", "group");
  await s.field("u_aftab_eq_serial", "شمارهٔ اموال", "string");
  await s.field("u_aftab_eq_photo", "عکس تحویل", "attachment");
  await s.form("eq", "فرم تجهیزات جانبی", [tab("درخواست", [section(null, [item("u_aftab_eq_item", { required: true }), item("u_aftab_eq_qty", { required: true }), item("u_aftab_eq_team"), item("u_aftab_eq_serial"), item("u_aftab_eq_photo")])])]);
}

export const ask = (s: Scn, o: Record<string, unknown> = {}) => ({ u_aftab_eq_item: "monitor", u_aftab_eq_qty: 1, u_aftab_eq_team: s.g("assets"), ...o });

export function w11(ref: EditionRef): void {
  describe("W11 «درخواست تجهیزات جانبی»", () => {
    let s: Scn;
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW11(s);
      const pub = await s.publish(W11.key, W11.name, w11Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    it("R1 a saved draft reopened; the group the field names delivers (one takes it, the serial and a photo), the requester confirms; the print view, «انجام‌شده‌ها» and the inbox's chips", async () => {
      await s.saveStartDraft("negar", W11.key, { u_aftab_eq_item: "printer", u_aftab_eq_qty: 2 });
      const view = await s.as("negar").get(`${s.P}/process/defs/${W11.key}/view`);
      expect(view.start).toMatchObject({ can_start: true, draft: { u_aftab_eq_item: "printer", u_aftab_eq_qty: 2 } });
      const r = await s.start("negar", W11.key, ask(s, { ...view.start.draft }));
      await s.settle();
      expect((await s.kase(r.case)).title).toBe("چاپگر برای نگار کارشناس‌پور");
      expect(await s.openAt(r.case, "deliver")).toEqual(["as1", "as2"]);
      const inbox = await s.as("as1").get(`${s.P}/process/inbox`);
      expect(inbox.chips).toContainEqual(expect.objectContaining({ process_id: s.procs[W11.key].id, count: 1 }));
      await s.claim("as2", r.case, "deliver");
      const step = await s.myStep("as2", r.case, "deliver");
      const sent = await s.multipart("as2", `/process/tasks/${step.id}/submit`, { values: { u_aftab_eq_serial: "AM-1405-0091", u_aftab_eq_photo: [{ upload: 0 }] } }, [{ name: "delivery.png", data: PNG, type: "image/png" }], 200);
      expect(sent.result).toBe("applied");
      await s.settle();
      expect(await s.openAt(r.case, "confirm")).toEqual(["negar"]);
      await s.submit("negar", r.case, "confirm", { outcome: "submitted" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_eq_serial: "AM-1405-0091", u_aftab_eq_qty: 2 } });
      const print = await s.as("negar").get(`${s.P}/process/cases/${r.case}/print`);
      expect(print.case).toMatchObject({ finished: true, state: "انجام‌شده" });
      const decided = print.decisions.map((d: { step: string; by: string }) => [d.step, d.by]);
      expect(decided).toEqual(expect.arrayContaining([["تحویل تجهیز", "کارشناس اموال دوم"], ["تأیید دریافت", "نگار کارشناس‌پور"]]));
      expect(print.decisions.every((d: { at_text: string | null }) => !d.at_text || /[۰-۹]/.test(d.at_text))).toBe(true);
      expect(print.values.find((v: { field: string }) => v.field === "u_aftab_eq_team")?.text).toBe("اموال و تجهیزات");
      const done = await s.as("as2").get(`${s.P}/process/done`);
      expect((done.rows ?? done).some((x: { case_id: string; step: string }) => x.case_id === r.case && x.step === "تحویل تجهیز")).toBe(true);
    }, 300_000);

    it("R3 a delegation (scope «کارها») that starts after the step opened moves the task to the delegate «به جانشینی از …»; at its end it moves back", async () => {
      const r = await s.start("yaser", W11.key, ask(s, { u_aftab_eq_item: "keyboard" }));
      await s.settle();
      expect(await s.openAt(r.case, "deliver")).toEqual(["as1", "as2"]);
      const now = Date.now();
      const d = await s.as("as1").post(`${s.P}/r/delegation`, { from_user: s.id("as1"), to_user: s.id("col1"), starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + DAY).toISOString(), scopes: ["assignments"] });
      await s.settle();
      const moved = (await s.tasks(r.case)).find((t) => t.step_key === "deliver" && t.delegated_from === s.id("as1"))!;
      expect([s.key(moved.assigned_to), moved.status]).toEqual(["col1", "open"]);
      expect((await s.journal(r.case)).some((l) => l.includes("به جانشینی از کارشناس اموال یکم"))).toBe(true);
      expect((await s.bells("col1")).some((t) => t.includes("به جانشینی از کارشناس اموال یکم"))).toBe(true);
      await s.db.query(`update sm_delegations set ends_at = now() - interval '1 second' where id = $1`, [d.row.id]);
      await s.timers(["process.delegation"]);
      const back = (await s.tasks(r.case)).find((t) => t.step_key === "deliver" && t.assigned_to === s.id("as1"))!;
      expect([back.status, back.delegated_from]).toEqual(["open", null]);
    }, 300_000);

    it("R4 timers: the managers are told after a day; the deadline at two days fires nothing more (no «پایان مهلت» wired); after three days it is sent automatically to the requester's confirmation", async () => {
      const r = await s.start("somayeh", W11.key, ask(s, { u_aftab_eq_item: "headset" }));
      await s.settle();
      await s.elapse(r.case, "deliver", DAY + 60_000);
      await s.timers();
      expect((await s.bells("ramin")).filter((t) => t.startsWith("مهلت گذشت: «تحویل تجهیز»"))).toHaveLength(1);
      await s.elapse(r.case, "deliver", DAY);
      await s.timers();
      expect(await s.openAt(r.case, "deliver")).toEqual(["as1", "as2"]);
      await s.elapse(r.case, "deliver", DAY);
      await s.timers();
      expect(await s.journal(r.case)).toContain("مهلت گذشت؛ «تحویل تجهیز» خودکار «ثبت» شد");
      expect(await s.openAt(r.case, "confirm")).toEqual(["somayeh"]);
    }, 300_000);

    it("R5 the requester returns the delivery with a comment: round 2 goes to the earlier actor; resubmitted, confirmed, completed", async () => {
      const r = await s.start("behrouz", W11.key, ask(s));
      await s.settle();
      await s.submit("as1", r.case, "deliver", { values: { u_aftab_eq_serial: "AM-1" } });
      await s.settle();
      await s.submit("behrouz", r.case, "confirm", { outcome: "returned" }, 400);
      await s.submit("behrouz", r.case, "confirm", { outcome: "returned", comment: "نمایشگر ایراد دارد" });
      await s.settle();
      expect(await s.openAt(r.case, "deliver")).toEqual(["as1"]);
      await s.submit("as1", r.case, "deliver", { values: { u_aftab_eq_serial: "AM-2" } });
      await s.settle();
      await s.submit("behrouz", r.case, "confirm", { outcome: "submitted" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_eq_serial: "AM-2" } });
    }, 300_000);
  });
}
