// W10 «ثبت نیاز آموزشی واحد» — every member may start; the head of the requester's nearest department; a position in
// a fixed unit narrowed to some people; «بگذرد» on an approval (it leaves by «تأیید شد»); «انتخاب» with nempty/ne;
// a users field in a notice; «پایان (لغو)»; versions: version 2 mid-case without a retired field, the diff, restoring
// version 1 to the draft; a process with no managers (the organisation's administrators stand in). Runs R1–R6, and
// (1.1.5) a confidential notice of the organisation's own: who it reaches, who reads the case because of it, and what
// its journal says.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W10 = { key: "aftab_training", name: "ثبت نیاز آموزشی واحد" };

const layout = (withOld = true) => [
  tab("دوره", [section(null, [
    item("u_aftab_tn_course", { required: true }), item("u_aftab_tn_kind", { required: true }),
    item("u_aftab_tn_cost", { showIf: { f: "u_aftab_tn_kind", op: "ne", v: "internal" } }), item("u_aftab_tn_vendor"), item("u_aftab_tn_people"),
    ...(withOld ? [item("u_aftab_tn_old")] : []),
  ])]),
];

export function w10Draft(s: Scn): Draft {
  const F = s.forms.tn;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
        n("head", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "unit_head", of: "requester", unitKind: "department" }], ifNobody: "skip" }, "تأیید رئیس اداره"),
        n("plan", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_tn_course: "edit" } }, assignees: [{ kind: "position", position: "aftab_training_officer", where: "unit", unit: s.u("hr"), members: s.ids("parvaneh") }] }, "برنامه‌ریزی آموزش"),
        n("kind", "choice", {
          cases: [
            { key: "cancel", label: "لغو", rules: [{ left: "{{case.u_aftab_tn_kind}}", op: "eq", right: "cancel" }] },
            { key: "internal", label: "داخلی", rules: [{ left: "{{case.u_aftab_tn_kind}}", op: "eq", right: "internal" }] },
            { key: "external", label: "بیرونی با هزینه", match: "all", rules: [{ left: "{{case.u_aftab_tn_vendor}}", op: "nempty" }, { left: "{{case.u_aftab_tn_cost}}", op: "ne", right: "0" }] },
          ],
        }, "نوع دوره"),
        n("announce", "notify", { to: [{ kind: "field", field: "u_aftab_tn_people" }], subject: "دورهٔ آموزشی: {{case.u_aftab_tn_course}}", body: "{{case.title}}" }, "اعلان به شرکت‌کنندگان"),
        n("cost", "form_step", { action: "approve", quorum: "first", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "aftab_finance_deputy", where: "anywhere" }] }, "تأیید هزینه"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("rej", "end", { outcome: "rejected" }, "پایان (ردشده)"),
        n("dropped", "end", { outcome: "canceled" }, "پایان (لغو)"),
      ],
      edges: [
        e("start", "request"), e("request", "head"), e("head", "plan", "approved"), e("head", "rej", "rejected"), e("plan", "kind"),
        e("kind", "dropped", "cancel"), e("kind", "announce", "internal"), e("kind", "cost", "external"), e("kind", "done", "else"),
        e("announce", "done"), e("cost", "done", "approved"), e("cost", "rej", "rejected"),
      ],
    },
    starters: [],
    title_template: "آموزش {{case.u_aftab_tn_course}}",
    managers: [],
  };
}

/**
 * (1.1.5) A confidential process whose only manager is one of the pack's people: «اعلان» to the people a users field
 * names, then a step held only by one of the pack's people — on the organisation's own case it finds nobody, and its
 * manager cannot be told of it.
 */
export const W10N = { key: "aftab_training_notice", name: "اعلان دورهٔ محرمانه" };

export function w10NoticeDraft(s: Scn): Draft {
  const F = s.forms.tn;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
        n("announce", "notify", { to: [{ kind: "field", field: "u_aftab_tn_people" }], subject: "دورهٔ محرمانه: {{case.number}}", body: "دوره‌ای برای شما ثبت شد" }, "اعلان به شرکت‌کنندگان"),
        n("plan", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_tn_course: "edit" } }, assignees: [{ kind: "position", position: "aftab_training_officer", where: "unit", unit: s.u("hr"), members: s.ids("parvaneh") }] }, "برنامه‌ریزی آموزش"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
      ],
      edges: [e("start", "request"), e("request", "announce"), e("announce", "plan"), e("plan", "done")],
    },
    starters: [],
    title_template: "آموزش {{case.u_aftab_tn_course}}",
    managers: s.ids("mehrdad"),
    confidential: true,
  };
}

export async function setupW10(s: Scn): Promise<void> {
  await bankUnits(s);
  const demo = { demo: true };
  await s.person("itdir", "مدیر کل فناوری اطلاعات", { unit: "it", ...demo });
  await s.unitHead("it", "itdir");
  await s.person("emp_it", "کارشناس فناوری اطلاعات", { unit: "it", ...demo });
  await s.person("emp_fin", "کارشناس امور مالی", { unit: "fin", ...demo });
  await s.person("parvaneh", "پروانه منابعی", { unit: "hr", ...demo });
  await s.person("tr2", "کارشناس آموزش دوم", { unit: "hr", ...demo });
  await s.person("tr3", "کارشناس آموزش استان", { unit: "alborz", ...demo });
  await s.person("mehrdad", "مهرداد بودجه‌نژاد", { unit: "fin", ...demo });
  await s.person("ppl1", "شرکت‌کنندهٔ یکم", { unit: "it", ...demo });
  await s.person("ppl2", "شرکت‌کنندهٔ دوم", { unit: "it", ...demo });
  // (1.1.5) the organisation's own people: a requester, a participant, and one who leaves before the notice
  await s.person("realemp", "کارمند واقعی فناوری", { unit: "it" });
  await s.person("realppl", "شرکت‌کنندهٔ واقعی", { unit: "it" });
  await s.person("gone", "شرکت‌کنندهٔ رفته", { unit: "it" });
  await s.field("u_aftab_tn_course", "عنوان دوره", "string");
  await s.field("u_aftab_tn_kind", "نوع دوره", "select", { options: [{ value: "internal", label: "داخلی" }, { value: "external", label: "بیرونی" }, { value: "cancel", label: "لغو" }] });
  await s.field("u_aftab_tn_cost", "هزینه", "money");
  await s.field("u_aftab_tn_vendor", "برگزارکننده", "string");
  await s.field("u_aftab_tn_people", "شرکت‌کنندگان", "users");
  await s.field("u_aftab_tn_old", "فیلد قدیمی", "string");
  await s.form("tn", "فرم نیاز آموزشی", layout(true));
  await s.position("aftab_training_officer", "کارشناس آموزش");
  for (const [p, u] of [["parvaneh", "hr"], ["tr2", "hr"], ["tr3", "alborz"]]) await s.hold("aftab_training_officer", p, u);
  await s.position("aftab_finance_deputy", "معاون مالی", { unitKind: "department" });
  await s.hold("aftab_finance_deputy", "mehrdad", "fin");
}

export function w10(ref: EditionRef): void {
  describe("W10 «ثبت نیاز آموزشی واحد»", () => {
    let s: Scn;
    let problems: { level: string; message: string }[] = [];
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW10(s);
      const pub = await s.publish(W10.key, W10.name, w10Draft(s));
      problems = pub.problems;
      expect(problems.filter((p) => p.level === "error")).toEqual([]);
      await s.publish(W10N.key, W10N.name, w10NoticeDraft(s));
    }, 600_000);

    const need = (o: Record<string, unknown> = {}) => ({ u_aftab_tn_course: "امنیت شبکه", u_aftab_tn_kind: "internal", u_aftab_tn_people: s.ids("ppl1", "ppl2"), ...o });

    it("the designer warns that the process has no managers", () => {
      expect(problems.some((p) => p.level === "warning" && p.message.includes("مسئول"))).toBe(true);
    });

    it("R1 internal: the head of the requester's department, the training officer of the fixed unit narrowed to one person, the notice; completed", async () => {
      const r = await s.start("emp_it", W10.key, need());
      await s.settle();
      expect(await s.openAt(r.case, "head")).toEqual(["itdir"]);
      await s.submit("itdir", r.case, "head", { outcome: "approved" });
      await s.settle();
      expect(await s.openAt(r.case, "plan")).toEqual(["parvaneh"]);
      await s.submit("parvaneh", r.case, "plan", { values: { u_aftab_tn_course: "امنیت شبکهٔ پیشرفته" } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_tn_course: "امنیت شبکهٔ پیشرفته" } });
      expect((await s.path(r.case)).slice(-3)).toEqual(["kind:internal", "announce:out", "done"]);
      const out = await s.db.one<{ output: { recipients: string[] } }>(`select output from sm_flow_run_steps where run_id = (select run_ref::uuid from sm_process_cases where id = $1) and node_id = 'announce'`, [r.case]);
      expect(s.keys(out!.output.recipients)).toEqual(["ppl1", "ppl2"]);
    }, 300_000);

    it("R1 (NB1) the notice reaches the people the users field names: their bells", async () => {
      const r = await s.start("emp_it", W10.key, need({ u_aftab_tn_course: "مدیریت پروژه" }));
      await s.settle();
      await s.submit("itdir", r.case, "head", { outcome: "approved" });
      await s.settle();
      await s.submit("parvaneh", r.case, "plan", {});
      await s.settle();
      const log = await s.db.query(`select channel, status, reason from sm_notification_log where org_id = $1 and recipient_id = $2`, [s.org, s.id("ppl1")]);
      expect(await s.bells("ppl1"), JSON.stringify(log)).toContain("دورهٔ آموزشی: مدیریت پروژه");
    }, 300_000);

    it("R1 (NB1, 1.1.5) the organisation's own confidential case: the notice reaches the real, active people the field names — readers of the case from then on, its values hidden — and the journal names whom it reached and whom not, and why", async () => {
      await s.setActive("gone", false);
      try {
        const r = await s.start("realemp", W10N.key, need({ u_aftab_tn_course: "دورهٔ محرمانهٔ واقعی", u_aftab_tn_people: s.ids("realppl", "ppl1", "gone") }));
        await s.settle();
        const k = await s.kase(r.case);
        expect([await s.isDemo(r.case), k.confidential]).toEqual([false, true]);
        const j = await s.journal(r.case);
        expect(j, j.join("\n")).toContain(
          "«اعلان به شرکت‌کنندگان» به شرکت‌کنندهٔ واقعی فرستاده شد. شرکت‌کنندهٔ یکم حساب نمایشی است؛ اعلان به او نرسید. شرکت‌کنندهٔ رفته عضو فعال سازمان نیست؛ اعلان به او نرسید.",
        );
        const out = await s.db.one<{ output: { recipients: string[] } }>(`select output from sm_flow_run_steps where run_id = (select run_ref::uuid from sm_process_cases where id = $1) and node_id = 'announce'`, [r.case]);
        expect(s.keys(out!.output.recipients)).toEqual(["realppl"]);
        const subject = `دورهٔ محرمانه: ${k.number}`;
        const log = await s.db.query(`select channel, status, reason from sm_notification_log where org_id = $1 and recipient_id = $2`, [s.org, s.id("realppl")]);
        expect(await s.bells("realppl"), JSON.stringify(log)).toContain(subject);
        expect(await s.bells("ppl1")).not.toContain(subject);
        expect(await s.bells("gone")).not.toContain(subject);
        // the person told opens the confidential case the bell links to, and reads none of its values
        const d = await s.detail("realppl", r.case);
        expect([d.case.number, d.data]).toEqual([k.number, {}]);
        expect(k.participants).toContain(s.id("realppl"));
        // one of the pack's people named by the field reads nothing of the organisation's own case
        await s.detail("ppl1", r.case, 404);
      } finally {
        await s.setActive("gone", true);
      }
    }, 300_000);

    it("R1 (OB1, NB4, 1.1.5) the organisation's own case whose only manager is one of the pack's people: the organisation's administrators, who manage it, are told that its step found nobody, and the journal and the case page name them and the pack's manager who was not told", async () => {
      const r = await s.start("realemp", W10N.key, need({ u_aftab_tn_course: "دورهٔ بی‌برنامه‌ریز", u_aftab_tn_people: s.ids("realppl") }));
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "waiting" });
      // (1.1.5, merge of the notices and the demo boundary) the pack's people manage none of the organisation's own
      // cases, so a case whose managers are all theirs is the administrators' (actingManagers): its managers' notice
      // goes to them, the pack's manager named as not told
      const told = "برای «برنامه‌ریزی آموزش» کسی پیدا نشد؛ مدیران سازمان (مالک آزمایشی) باخبر شدند. مهرداد بودجه‌نژاد حساب نمایشی است؛ اعلان به او نرسید.";
      const line = (await s.journal(r.case)).find((l) => l.startsWith("برای «برنامه‌ریزی آموزش» کسی پیدا نشد")) ?? "";
      expect(line.startsWith(told), line).toBe(true);
      expect(await s.db.query(`select title from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3`, [s.org, s.id("mehrdad"), r.case])).toEqual([]);
      const owner = await s.db.query<{ title: string }>(`select title from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3`, [s.org, s.id("owner"), r.case]);
      expect(owner.length, JSON.stringify(owner)).toBe(1);
      // the requester's page says why the step waits; the owner manages the case
      const d = await s.detail("realemp", r.case);
      expect(d.waiting?.plan).toMatchObject({ reason: "nobody", message: told });
      expect((await s.detail("owner", r.case)).can).toMatchObject({ manage: true, reassign: true, reresolve: true });
    }, 300_000);

    it("R1 (NB1, 1.1.5) a pack's case tells only the pack's people the field names; the journal says the real one was not told", async () => {
      const r = await s.start("emp_it", W10N.key, need({ u_aftab_tn_course: "دورهٔ نمایشی", u_aftab_tn_people: s.ids("ppl2", "realppl") }));
      await s.settle();
      const k = await s.kase(r.case);
      expect(await s.isDemo(r.case)).toBe(true);
      expect(await s.journal(r.case)).toContain("«اعلان به شرکت‌کنندگان» به شرکت‌کنندهٔ دوم فرستاده شد. پروندهٔ نمایشی است و اعلان به شرکت‌کنندهٔ واقعی نرسید.");
      expect(await s.bells("ppl2")).toContain(`دورهٔ محرمانه: ${k.number}`);
      expect(await s.bells("realppl")).not.toContain(`دورهٔ محرمانه: ${k.number}`);
      expect(k.participants).not.toContain(s.id("realppl"));
    }, 300_000);

    it("R2 a department without a head: «بگذرد» on the approval — it leaves by «تأیید شد» to the planning step", async () => {
      const r = await s.start("emp_fin", W10.key, need({ u_aftab_tn_course: "حسابداری دولتی" }));
      await s.settle();
      expect(await s.at(r.case, "head")).toEqual([]);
      expect((await s.path(r.case)).slice(0, 3)).toEqual(["start:out", "request:out", "head:approved"]);
      expect(await s.openAt(r.case, "plan")).toEqual(["parvaneh"]);
      expect((await s.journal(r.case)).some((l) => l.startsWith("برای «تأیید رئیس اداره» کسی پیدا نشد"))).toBe(true);
    }, 300_000);

    it("R2 (1.1.5) the skipped approval's journal says why nobody was found and that it counts as approved", async () => {
      const r = await s.start("emp_fin", W10.key, need({ u_aftab_tn_course: "بودجه‌ریزی" }));
      await s.settle();
      const line = (await s.journal(r.case)).find((l) => l.startsWith("برای «تأیید رئیس اداره» کسی پیدا نشد")) ?? "";
      const lines = (await s.journal(r.case)).join("\n");
      expect(lines).toContain("«ادارهٔ کل امور مالی» رئیس ندارد");
      expect(line.replace("«تأیید رئیس اداره»", "")).toContain("تأیید");
    }, 300_000);

    it("R3 external: a zero cost goes «هیچ‌کدام» and completes; a cost with a vendor goes to the finance deputy (first answer)", async () => {
      const zero = await s.start("emp_it", W10.key, need({ u_aftab_tn_kind: "external", u_aftab_tn_vendor: "مؤسسهٔ آموزشی", u_aftab_tn_cost: "0" }));
      await s.settle();
      await s.submit("itdir", zero.case, "head", { outcome: "approved" });
      await s.settle();
      await s.submit("parvaneh", zero.case, "plan", {});
      await s.settle();
      expect(await s.kase(zero.case)).toMatchObject({ state: "completed" });
      expect((await s.path(zero.case)).slice(-2)).toEqual(["kind:else", "done"]);
      const paid = await s.start("emp_it", W10.key, need({ u_aftab_tn_kind: "external", u_aftab_tn_vendor: "مؤسسهٔ آموزشی", u_aftab_tn_cost: "45000000" }));
      await s.settle();
      await s.submit("itdir", paid.case, "head", { outcome: "approved" });
      await s.settle();
      await s.submit("parvaneh", paid.case, "plan", {});
      await s.settle();
      expect(await s.openAt(paid.case, "cost")).toEqual(["mehrdad"]);
      await s.submit("mehrdad", paid.case, "cost", { outcome: "approved" });
      await s.settle();
      expect(await s.kase(paid.case)).toMatchObject({ state: "completed" });
    }, 300_000);

    it("R4 «لغو» as the kind: «پایان (لغو)»", async () => {
      const r = await s.start("emp_it", W10.key, need({ u_aftab_tn_kind: "cancel" }));
      await s.settle();
      await s.submit("itdir", r.case, "head", { outcome: "approved" });
      await s.settle();
      await s.submit("parvaneh", r.case, "plan", {});
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "canceled", outcome: "canceled" });
    }, 300_000);

    it("R5 versions: a case on version 1 keeps the retired field; version 2 without it; the diff; restoring version 1 to the draft leaves version 2 published", async () => {
      const r = await s.start("emp_it", W10.key, need({ u_aftab_tn_old: "مقدار قدیمی" }));
      await s.settle();
      const lib = (await s.owner.get(`${s.P}/fields/library`)).rows ?? (await s.owner.get(`${s.P}/fields/library`)).fields;
      const old = (lib as { id: string; name: string }[]).find((f) => f.name === "u_aftab_tn_old")!;
      await s.owner.patch(`${s.P}/fields/library/${old.id}`, { status: "retired" });
      const f = await s.owner.get(`${s.P}/forms/${s.forms.tn}`);
      await s.owner.patch(`${s.P}/forms/${s.forms.tn}`, { name: f.form.name, layout: { tabs: layout(false) }, version: f.form.version });
      await s.publish(W10.key, W10.name, w10Draft(s));
      // the version 1 case: its snapshot keeps the field and its value
      const d = await s.detail("emp_it", r.case);
      expect(d.case.version_no).toBe(1);
      expect(d.data.u_aftab_tn_old).toBe("مقدار قدیمی");
      expect(Object.keys(d.forms.fields)).toContain("u_aftab_tn_old");
      // a new case on version 2: no such field
      const r2 = await s.start("emp_it", W10.key, need({ u_aftab_tn_old: "دیگر نه" }));
      await s.settle();
      expect((await s.kase(r2.case)).version_no).toBe(2);
      expect((await s.kase(r2.case)).data.u_aftab_tn_old ?? null).toBeNull();
      expect(Object.keys((await s.detail("emp_it", r2.case)).forms.fields)).not.toContain("u_aftab_tn_old");
      // «نسخه‌ها» and «بازگرداندن به پیش‌نویس»
      const list = await s.owner.get(`${s.P}/process/defs/${s.procs[W10.key].id}/versions`);
      expect(list.versions.map((v: { version_no: number; current: boolean }) => [v.version_no, v.current])).toEqual([[2, true], [1, false]]);
      expect(list.versions[0].diff).toBeTruthy();
      const restored = await s.owner.post(`${s.P}/process/defs/${s.procs[W10.key].id}/versions/${list.versions[1].id}/restore`, {});
      expect(restored.draft.graph.nodes.map((x: { id: string }) => x.id)).toEqual(w10Draft(s).graph.nodes.map((x) => x.id));
      // the published version stays version 2
      expect((await s.db.one<{ current_version_id: string }>(`select current_version_id from sm_processes where id = $1`, [s.procs[W10.key].id]))!.current_version_id).toBe(list.versions[0].id);
    }, 300_000);

    it("R6 no managers: a step that finds nobody is the organisation's administrators' to manage", async () => {
      const pos = s.positions.aftab_finance_deputy;
      const cur = await s.owner.get(`${s.P}/r/position/${pos}`);
      await s.owner.patch(`${s.P}/r/position/${pos}`, { active: false, version: cur.row.version });
      try {
        const r = await s.start("emp_it", W10.key, need({ u_aftab_tn_kind: "external", u_aftab_tn_vendor: "مؤسسه", u_aftab_tn_cost: "1000000" }));
        await s.settle();
        await s.submit("itdir", r.case, "head", { outcome: "approved" });
        await s.settle();
        await s.submit("parvaneh", r.case, "plan", {});
        await s.settle();
        expect(await s.kase(r.case)).toMatchObject({ state: "waiting" });
        expect((await s.detail("owner", r.case)).can.manage).toBe(true);
        await s.reassign("owner", r.case, "cost", ["mehrdad"]);
        await s.submit("mehrdad", r.case, "cost", { outcome: "approved" });
        await s.settle();
        expect(await s.kase(r.case)).toMatchObject({ state: "completed" });
      } finally {
        const now = await s.owner.get(`${s.P}/r/position/${pos}`);
        await s.owner.patch(`${s.P}/r/position/${pos}`, { active: true, version: now.row.version });
      }
    }, 300_000);

    it("R6 (OB1) the journal's «مسئولان گردش‌کار باخبر شدند» on the pack's case is true: the administrators who manage it were told", async () => {
      const pos = s.positions.aftab_finance_deputy;
      const cur = await s.owner.get(`${s.P}/r/position/${pos}`);
      await s.owner.patch(`${s.P}/r/position/${pos}`, { active: false, version: cur.row.version });
      try {
        const r = await s.start("emp_it", W10.key, need({ u_aftab_tn_kind: "external", u_aftab_tn_vendor: "مؤسسه", u_aftab_tn_cost: "2000000" }));
        await s.settle();
        await s.submit("itdir", r.case, "head", { outcome: "approved" });
        await s.settle();
        await s.submit("parvaneh", r.case, "plan", {});
        await s.settle();
        const claimed = (await s.journal(r.case)).some((l) => l === "برای «تأیید هزینه» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.");
        const told = (await s.bells("owner")).filter((t) => t === "برای «تأیید هزینه» کسی پیدا نشد").length > 0;
        expect({ claimed, told }).not.toEqual({ claimed: true, told: false });
      } finally {
        const now = await s.owner.get(`${s.P}/r/position/${pos}`);
        await s.owner.patch(`${s.P}/r/position/${pos}`, { active: true, version: now.row.version });
      }
    }, 300_000);
  });
}
