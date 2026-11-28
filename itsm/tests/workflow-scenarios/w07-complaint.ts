// W7 «رسیدگی به شکایت مشتری» — «جریان خودکار» with its «بعدی» and «خطا» ports (an HTTP call refused inside the demo
// scope: nothing of the pack leaves the system), an unwired error → «نیاز به بررسی» → «ادامه از مرحلهٔ …», a value
// set from a subflow's output, a wait in business days, a people field with a group fallback, a record field, the
// requester's own step, «پایان (لغو)» and retiring while cases run. Runs R1–R6 of the scenario plan.
import { describe, it, expect, beforeAll } from "vitest";
import { bankUnits, e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W7 = { key: "aftab_complaint", name: "رسیدگی به شکایت مشتری", crmKey: "aftab_complaint_crm" };

export function w7Draft(s: Scn, flow: string, o: { errorWired?: boolean } = {}): Draft {
  const F = s.forms.cc;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_cc_crm_ref: "hidden", u_aftab_cc_answer: "hidden", u_aftab_cc_satisfied: "hidden" } } }, "ثبت درخواست"),
        n("crm", "subflow", { flow, inputs: [{ name: "customer", value: "{{case.u_aftab_cc_customer}}" }], wait: true }, "ثبت در سامانهٔ CRM"),
        n("setref", "set_values", { values: { u_aftab_cc_crm_ref: "{{steps.crm.output.outputs.ref}}" } }, "ثبت شمارهٔ CRM"),
        n("manual", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_cc_crm_ref: "required" } }, assignees: [{ kind: "group", group: s.g("csm") }] }, "ثبت دستی در CRM"),
        n("wait", "wait_duration", { mode: "duration", duration: { amount: 2, unit: "day" }, business: true }, "مهلت پاسخ"),
        n("follow", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_cc_answer: "required" } }, assignees: [{ kind: "field", field: "u_aftab_cc_followers" }], fallback: [{ kind: "group", group: s.g("csm") }] }, "پیگیری"),
        n("survey", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_cc_satisfied: "required" } }, assignees: [{ kind: "requester" }] }, "نظر مشتری"),
        n("happy", "choice", { cases: [{ key: "unhappy", label: "ناراضی", rules: [{ left: "{{case.u_aftab_cc_satisfied}}", op: "eq", right: "no" }] }] }, "رضایت"),
        n("head", "form_step", { action: "approve", quorum: "any", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "aftab_cx_head", where: "anywhere" }], exclude: [] }, "بررسی مدیر خدمات مشتریان"),
        n("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        n("dropped", "end", { outcome: "canceled" }, "پایان (لغو)"),
      ],
      edges: [
        e("start", "request"), e("request", "crm"), e("crm", "setref"), ...(o.errorWired === false ? [] : [e("crm", "manual", "error")]),
        e("setref", "wait"), e("manual", "wait"), e("wait", "follow"), e("follow", "survey"), e("survey", "happy"),
        e("happy", "head", "unhappy"), e("happy", "done", "else"), e("head", "done", "approved"), e("head", "dropped", "rejected"),
      ],
    },
    starters: [{ kind: "users", users: s.ids("negar", "somayeh", "shabnam") }],
    title_template: "شکایت {{case.u_aftab_cc_customer}}",
    managers: s.ids("shabnam"),
  };
}

/** An automation flow (the flows API, as the «جریان‌های خودکار» designer publishes it). */
async function flow(s: Scn, name: string, graph: unknown): Promise<string> {
  const id = String((await s.owner.post(`${s.P}/r/flow`, { name, trigger: "manual", trigger_table: "todo", run_as: "trigger_user", graph })).row.id);
  await s.owner.post(`${s.P}/flows/${id}/publish`, {});
  const cur = await s.owner.get(`${s.P}/r/flow/${id}`);
  await s.owner.patch(`${s.P}/r/flow/${id}`, { active: true, version: cur.row.version });
  return id;
}

export async function setupW7(s: Scn): Promise<{ ok: string; http: string }> {
  await bankUnits(s);
  const demo = { demo: true };
  await s.person("negar", "نگار کارشناس‌پور", { unit: "it", ...demo });
  await s.person("somayeh", "سمیه شعبه‌دار", { unit: "b0", ...demo });
  await s.person("shabnam", "شبنم مشتری‌مدار", { unit: "hq", ...demo });
  await s.person("csm1", "کارشناس خدمات مشتریان یکم", { unit: "hq", ...demo });
  await s.person("csm2", "کارشناس خدمات مشتریان دوم", { unit: "hq", ...demo });
  await s.person("fol1", "پیگیر یکم", { unit: "b0", ...demo });
  await s.person("fol2", "پیگیر دوم", { unit: "b1", ...demo });
  await s.group("csm", "خدمات مشتریان", ["csm1", "csm2"]);
  await s.position("aftab_cx_head", "مدیر خدمات مشتریان");
  await s.hold("aftab_cx_head", "shabnam", "hq");
  await s.field("u_aftab_cc_customer", "نام مشتری", "string");
  await s.field("u_aftab_cc_channel", "کانال", "select", { options: [{ value: "branch", label: "شعبه" }, { value: "phone", label: "تلفن" }, { value: "web", label: "وب" }] });
  await s.field("u_aftab_cc_text", "شرح شکایت", "text");
  await s.field("u_aftab_cc_followers", "پیگیری‌کنندگان", "users");
  await s.field("u_aftab_cc_incident", "رخداد مرتبط", "record", { validation: { ref: "incident" } });
  await s.field("u_aftab_cc_crm_ref", "شمارهٔ CRM", "string");
  await s.field("u_aftab_cc_answer", "پاسخ", "text");
  await s.field("u_aftab_cc_satisfied", "راضی هستید؟", "select", { options: [{ value: "yes", label: "بله" }, { value: "no", label: "خیر" }] });
  await s.form("cc", "فرم شکایت", [
    tab("شکایت", [section(null, [item("u_aftab_cc_customer", { required: true }), item("u_aftab_cc_channel"), item("u_aftab_cc_text"), item("u_aftab_cc_incident"), item("u_aftab_cc_followers")])]),
    tab("پیگیری", [section(null, [item("u_aftab_cc_crm_ref"), item("u_aftab_cc_answer")])]),
    tab("نظرسنجی", [section(null, [item("u_aftab_cc_satisfied")])]),
  ]);
  const ok = await flow(s, "ثبت شکایت (موفق)", {
    nodes: [n("trigger", "trigger"), n("v", "set_vars", { vars: [{ name: "ref", value: "CRM-{{trigger.inputs.customer}}" }] }), n("end", "end", { outputs: [{ name: "ref", value: "{{vars.ref}}" }] })],
    edges: [e("trigger", "v"), e("v", "end")],
  });
  const conn = String((await s.owner.post(`${s.P}/r/flow_connection`, { name: "CRM بانک (نمونه)", base_url: "https://crm.aftab-bank.example/api" })).row.id);
  const http = await flow(s, "ثبت شکایت در CRM (نمونه)", {
    nodes: [n("trigger", "trigger"), n("h", "call_http", { connection: conn, method: "POST", path: "/complaints", body: '{"customer":"{{trigger.inputs.customer}}"}' }), n("end", "end", { outputs: [{ name: "ref", value: "{{steps.h.output.body.id}}" }] })],
    edges: [e("trigger", "h"), e("h", "end")],
  });
  return { ok, http };
}

export function w07(ref: EditionRef): void {
  describe("W7 «رسیدگی به شکایت مشتری»", () => {
    let s: Scn;
    let flows: { ok: string; http: string };
    let incident = "";
    let open = "";
    beforeAll(async () => {
      s = await world(await ref.get());
      flows = await setupW7(s);
      incident = String((await s.owner.post(`${s.P}/r/incident`, { short_description: "قطعی خودپرداز شعبه", description: "خودپرداز شعبهٔ کرج کار نمی‌کند" })).row.id);
      const a = await s.publish(W7.key, W7.name, w7Draft(s, flows.ok));
      expect(a.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
      const b = await s.publish(W7.crmKey, "رسیدگی به شکایت مشتری (CRM)", w7Draft(s, flows.http));
      expect(b.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    }, 600_000);

    const complaint = (o: Record<string, unknown> = {}) => ({ u_aftab_cc_customer: "مشتری نمونه", u_aftab_cc_channel: "branch", u_aftab_cc_text: "کارت بلوکه شد", u_aftab_cc_followers: s.ids("fol1", "fol2"), u_aftab_cc_incident: incident, ...o });

    it("R1 the automation completes: the CRM number set from its output, the business-day wait, the two followers, the requester's survey; completed", async () => {
      const r = await s.start("negar", W7.key, complaint());
      open = r.case;
      await s.settle();
      expect((await s.kase(r.case)).data).toMatchObject({ u_aftab_cc_crm_ref: "CRM-مشتری نمونه", u_aftab_cc_incident: incident });
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "crm:out", "setref:out", "wait:waiting"]);
      await s.waitsDue();
      expect(await s.openAt(r.case, "follow")).toEqual(["fol1", "fol2"]);
    }, 300_000);

    it("R2 the CRM call is refused inside the demo scope: the error path, a manual CRM number, the case goes on", async () => {
      const calls = await s.db.one<{ n: number }>(`select count(*)::int as n from sm_flow_runs where org_id = $1 and flow_id = $2`, [s.org, flows.http]);
      const r = await s.start("negar", W7.crmKey, complaint({ u_aftab_cc_customer: "مشتری دوم" }));
      await s.settle();
      const child = await s.db.one<{ state: string; error: string | null }>(`select state, error from sm_flow_runs where org_id = $1 and flow_id = $2 order by started_at desc, id desc limit 1`, [s.org, flows.http]);
      expect(child?.state).toBe("failed");
      // refused before connecting: nothing of the pack leaves the system
      expect(child?.error ?? "").toContain("داده‌های نمایشی");
      expect((await s.db.one<{ n: number }>(`select count(*)::int as n from sm_flow_runs where org_id = $1 and flow_id = $2`, [s.org, flows.http]))!.n).toBe(calls!.n + 1);
      expect(await s.path(r.case)).toEqual(["start:out", "request:out", "crm:failed:error", "manual:waiting"]);
      expect(await s.openAt(r.case, "manual")).toEqual(["csm1", "csm2"]);
      await s.submit("csm2", r.case, "manual", { values: { u_aftab_cc_crm_ref: "CRM-دستی-7" } });
      await s.settle();
      await s.waitsDue();
      await s.submit("fol1", r.case, "follow", { values: { u_aftab_cc_answer: "کارت آزاد شد" } });
      await s.settle();
      await s.submit("negar", r.case, "survey", { values: { u_aftab_cc_satisfied: "yes" } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_cc_crm_ref: "CRM-دستی-7", u_aftab_cc_satisfied: "yes" } });
    }, 300_000);

    it("R3 version 2 leaves the error unwired: the run stops, «نیاز به بررسی», the managers told; «ادامه از مرحلهٔ «پیگیری»» runs it on", async () => {
      await s.publish(W7.crmKey, "رسیدگی به شکایت مشتری (CRM)", w7Draft(s, flows.http, { errorWired: false }));
      const r = await s.start("somayeh", W7.crmKey, complaint({ u_aftab_cc_customer: "مشتری سوم" }));
      await s.settle();
      const k = await s.kase(r.case);
      expect(k).toMatchObject({ state: "attention", version_no: 2 });
      expect((await s.journal(r.case)).some((l) => l.startsWith("اجرای پرونده متوقف شد و پرونده نیاز به بررسی دارد"))).toBe(true);
      expect(await s.bells("shabnam")).toContain(`پروندهٔ ${k.number} متوقف شد`);
      const d = await s.detail("shabnam", r.case);
      expect(d.can.resume_from).toBe(true);
      expect(d.restart_targets.map((t: { key: string }) => t.key)).toContain("follow");
      await s.resumeFrom("shabnam", r.case, "follow", "CRM در دسترس نیست؛ پیگیری دستی");
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "active" });
      expect(await s.openAt(r.case, "follow")).toEqual(["fol1", "fol2"]);
      await s.submit("fol2", r.case, "follow", { values: { u_aftab_cc_answer: "پاسخ داده شد" } });
      await s.settle();
      await s.submit("somayeh", r.case, "survey", { values: { u_aftab_cc_satisfied: "yes" } });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed" });
    }, 300_000);

    it("R4 an unhappy customer: the head of customer service decides — even on her own request (no exclusion) — and a rejection ends «پایان (لغو)»", async () => {
      const r = await s.start("shabnam", W7.key, complaint({ u_aftab_cc_customer: "مشتری ناراضی" }));
      await s.settle();
      await s.waitsDue();
      await s.submit("fol1", r.case, "follow", { values: { u_aftab_cc_answer: "پاسخ" } });
      await s.settle();
      await s.submit("shabnam", r.case, "survey", { values: { u_aftab_cc_satisfied: "no" } });
      await s.settle();
      expect(await s.openAt(r.case, "head")).toEqual(["shabnam"]);
      await s.submit("shabnam", r.case, "head", { outcome: "rejected", comment: "پیگیری بیشتر لازم نیست" });
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "canceled", outcome: "canceled" });
      expect((await s.bells("shabnam")).some((t) => t.endsWith("لغو شد"))).toBe(true);
    }, 300_000);

    it("R5 no followers: the group fallback takes the follow-up", async () => {
      const r = await s.start("negar", W7.key, complaint({ u_aftab_cc_followers: [] }));
      await s.settle();
      await s.waitsDue();
      expect(await s.openAt(r.case, "follow")).toEqual(["csm1", "csm2"]);
    }, 300_000);

    it("R6 retired while a case runs: new starts are refused, the open case finishes on its version", async () => {
      expect(open).toBeTruthy();
      await s.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [s.o.ownerId]);
      const retired = await s.owner.post(`${s.P}/process/defs/${s.procs[W7.key].id}/retire`, {});
      expect(retired.status).toBe("retired");
      const no = await s.refused(s.start("negar", W7.key, complaint(), { expect: 409 }));
      expect(no.message).toBe("این گردش‌کار بازنشسته شده است و درخواست تازه نمی‌پذیرد");
      await s.submit("fol2", open, "follow", { values: { u_aftab_cc_answer: "پیگیری شد" } });
      await s.settle();
      await s.submit("negar", open, "survey", { values: { u_aftab_cc_satisfied: "yes" } });
      await s.settle();
      expect(await s.kase(open)).toMatchObject({ state: "completed", outcome: "completed", version_no: 1 });
    }, 300_000);
  });
}
