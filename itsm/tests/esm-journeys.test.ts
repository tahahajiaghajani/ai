// Enterprise service management — services and journeys (ESM-006/007/009/010/012/013/014/025):
//   · an employee files an HR service from the department catalogue (record producer → HR case with the service)
//   · cross-department routing ranks services for a sentence; transfer re-keys a case to another department; child
//     work in another department rolls up into the parent
//   · onboarding: activities planned on the working calendar, HR tasks for the new hire, orders from the IT catalogue,
//     a desk from facilities — each department works its own record under its own access; activities follow their
//     records; the anchor date re-plans open work; approval activities settle with their round; cancelling skips
//     what is open
import "./fixtures/rag";
import { beforeAll, describe, expect, it } from "vitest";
import { dayFrom, esmWorld, type EsmWorld } from "./esm-helpers";

describe("esm: services, routing, transfer and child work", () => {
  let w: EsmWorld;
  beforeAll(async () => {
    w = await esmWorld();
  });

  it("files an HR service from the department catalogue as an HR case of that service", async () => {
    const item = w.svc.hr_leave.catalog_item_id;
    const res = await w.p.emp.client.post(`${w.P}/request/order`, { lines: [{ item_id: item, answers: { leave_type: "annual", from: dayFrom(10), to: dayFrom(12), reason: "سفر خانوادگی" } }] });
    expect(res.produced.table).toBe("hr_case");
    const row = await w.get("hr_case", res.produced.id, w.p.emp.client);
    expect(row.dept_service_id).toBe(w.svc.hr_leave.id);
    expect(row.department_id).toBe(w.dept.hr.id);
    expect(row.effective_date).toBe(dayFrom(10));
    expect(row.short_description).toContain("مرخصی");
    await w.drain();
    const asHr = await w.get("hr_case", res.produced.id, w.p.hrdesk.client);
    expect(asHr.assignment_group_id).toBe(w.g["کارشناسان منابع انسانی"]);
    expect(asHr.category).toBe("leave");
  });

  it("ranks services across departments for what an employee wrote", async () => {
    const r = await w.p.emp.client.post(`${w.P}/esm/route`, { text: "کولر اتاقم خراب شده و کار نمی‌کند" });
    expect(r.matches[0].service.name).toBe("تعمیر و نگهداری");
    expect(r.matches[0].department.key).toBe("facilities");
    const pay = await w.p.emp.client.post(`${w.P}/esm/route`, { text: "فیش حقوقی ماه قبل را می‌خواهم" });
    expect(pay.matches[0].service.name).toBe("فیش حقوقی");
  });

  it("transfers a case to another department (a new case there, the old one closed and linked)", async () => {
    const made = await w.p.emp.client.post(`${w.P}/r/facility_request`, { short_description: "پرسش دربارهٔ بازپرداخت هزینهٔ تاکسی", dept_service_id: w.svc.fac_cleaning.id });
    await w.drain();
    await w.p.it.client.post(`${w.P}/esm/cases/facility_request/${made.row.id}/transfer`, { department_id: w.dept.finance.id, note: "x" }, 403);
    const moved = await w.p.fac.client.post(`${w.P}/esm/cases/facility_request/${made.row.id}/transfer`, { department_id: w.dept.finance.id, service_id: w.svc.fin_expense.id, note: "موضوع مالی است" });
    expect(moved.table).toBe("finance_case");
    const old = await w.get("facility_request", made.row.id, w.p.fac.client);
    expect(old.state).toBe("closed_incomplete");
    await w.drain();
    const fin = await w.get("finance_case", moved.id, w.p.fin.client);
    expect(fin.workspace_id).toBe(w.ws.finance);
    expect(fin.requested_for ?? fin.caller_id).toBeTruthy();
    // the facilities agent no longer reaches the finance case (another department's workspace)
    await w.get("finance_case", moved.id, w.p.fac.client, 404);
    // the employee still follows their own record
    await w.get("finance_case", moved.id, w.p.emp.client);
  });

  it("rolls cross-department child work up into the parent case", async () => {
    const parent = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "انتقال به دفتر اصفهان", dept_service_id: w.svc.hr_certificate.id });
    await w.drain();
    const child = await w.p.hrdesk.client.post(`${w.P}/esm/cases/hr_case/${parent.row.id}/child`, { department_id: w.dept.facilities.id, service_id: w.svc.fac_desk.id, short_description: "آماده‌سازی میز در دفتر اصفهان" });
    expect(child.table).toBe("facility_request");
    await w.drain();
    let p = await w.get("hr_case", parent.row.id, w.p.hrdesk.client);
    expect(p.child_total).toBe(1);
    expect(p.child_open).toBe(1);
    // the facilities agent works the child; the employee does not see it
    const c = await w.get("facility_request", child.id, w.p.fac.client);
    await w.get("facility_request", child.id, w.p.emp.client, 404);
    await w.p.fac.client.post(`${w.P}/r/facility_request/${child.id}/transition`, { to: "resolved", data: { close_notes: "میز آماده شد" }, version: c.version });
    await w.drain();
    p = await w.get("hr_case", parent.row.id, w.p.hrdesk.client);
    expect(p.child_open).toBe(0);
  });

  it("moves «منتظر اطلاعات» back to work when the requester answers", async () => {
    const made = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "گواهی برای بانک", dept_service_id: w.svc.hr_certificate.id });
    await w.drain();
    const row = await w.get("hr_case", made.row.id, w.p.hrdesk.client);
    await w.p.hrdesk.client.post(`${w.P}/r/hr_case/${made.row.id}/transition`, { to: "awaiting_info", version: row.version });
    await w.p.emp.client.post(`${w.P}/r/hr_case/${made.row.id}/journal`, { kind: "comment", body: "بانک ملت، شعبهٔ مرکزی" });
    await w.drain();
    expect((await w.get("hr_case", made.row.id, w.p.hrdesk.client)).state).toBe("in_progress");
  });

  it("enforces separation of duties on purchases and asks approvals by amount band", async () => {
    // the requester never receives their own purchase
    await w.p.emp.client.post(`${w.P}/r/purchase_request`, { short_description: "مانیتور", items: "دو مانیتور ۲۷ اینچ", amount: "120000000", receiver_id: w.p.emp.userId }, 400);
    const ok = await w.p.emp.client.post(`${w.P}/r/purchase_request`, { short_description: "مانیتور", items: "دو مانیتور ۲۷ اینچ", amount: "120000000", receiver_id: w.p.hire.userId });
    await w.drain();
    // band 2 (50–500 million rial): the manager first, then finance
    const appr = await w.p.emp.client.get(`${w.P}/approvals/record/purchase_request/${ok.row.id}`);
    const first = appr.approvals.find((a: Record<string, any>) => a.state === "requested");
    expect(first.approver_id).toBe(w.p.mgr.userId);
    expect(appr.approvals.some((a: Record<string, any>) => a.level === 2)).toBe(true);
    // the receiver reads the purchase but cannot change it
    const asReceiver = await w.get("purchase_request", ok.row.id, w.p.hire.client);
    await w.p.hire.client.patch(`${w.P}/r/purchase_request/${ok.row.id}`, { amount: "1", version: asReceiver.version }, 403);
    // a manager who is also the receiver may not decide (separation of duties)
    const sod = await w.p.emp.client.post(`${w.P}/r/purchase_request`, { short_description: "صندلی", items: "یک صندلی", amount: "20000000", receiver_id: w.p.mgr.userId });
    await w.drain();
    const mine = (await w.p.mgr.client.get(`${w.P}/approvals/mine`)).approvals as Record<string, any>[];
    const a = mine.find((x) => x.record_id === sod.row.id);
    expect(a).toBeTruthy();
    await w.p.mgr.client.post(`${w.P}/approvals/${a!.id}/decide`, { decision: "approved" }, 403);
  });
});

describe("esm: employee journeys", () => {
  let w: EsmWorld;
  let journeyId: string;
  const anchor = dayFrom(5);
  beforeAll(async () => {
    w = await esmWorld();
  });

  it("previews a template's plan on the working calendar", async () => {
    const tpl = (await w.p.hrdesk.client.get(`${w.P}/r/journey_template?size=10`)).rows.find((t: Record<string, any>) => t.code === "onboarding_standard");
    const pv = await w.p.hrdesk.client.get(`${w.P}/esm/templates/${tpl.id}/preview?anchor=${anchor}`);
    expect(pv.problems).toEqual([]);
    const policies = pv.activities.find((a: Record<string, any>) => a.code === "policies");
    const documents = pv.activities.find((a: Record<string, any>) => a.code === "documents");
    expect(policies.start_date > documents.due_date).toBe(true);
    // no activity is planned on a Friday (the office calendar)
    for (const a of pv.activities) if (a.start_date) expect(new Date(`${a.start_date}T12:00:00Z`).getUTCDay(), a.code).not.toBe(5);
  });

  it("starts onboarding: HR tasks for the new hire, IT orders and a facilities case, each in its department", async () => {
    const tpl = (await w.p.hrdesk.client.get(`${w.P}/r/journey_template?size=10`)).rows.find((t: Record<string, any>) => t.code === "onboarding_standard");
    const res = await w.p.hrdesk.client.post(`${w.P}/esm/journeys`, { template_id: tpl.id, anchor_date: anchor, subject_person_id: w.p.hire.userId, manager_id: w.p.mgr.userId });
    journeyId = res.journey.id;
    await w.drain();
    const t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${journeyId}/tracker`);
    expect(t.journey.state).toBe("active");
    expect(t.journey.workspace_id).toBe(w.ws.hr);
    const by = Object.fromEntries(t.activities.map((a: Record<string, any>) => [a.code, a]));
    expect(by.documents.state).toBe("in_progress");
    expect(by.documents.record_table).toBe("hr_task");
    expect(by.laptop.record_table).toBe("request_item");
    expect(by.account.record_table).toBe("request_item");
    expect(by.desk.record_table).toBe("facility_request");
    expect(by.policies.state).toBe("pending"); // waits for the documents
    expect(t.journey.day_one_total).toBeGreaterThan(0);
    // the new hire and the manager read the journey; IT does not
    await w.get("journey", journeyId, w.p.hire.client);
    await w.get("journey", journeyId, w.p.mgr.client);
    await w.get("journey", journeyId, w.p.it.client, 404);
    // the desk case lives in facilities; facilities reads it, not the journey
    const desk = await w.get("facility_request", by.desk.record_id, w.p.fac.client);
    expect(desk.workspace_id).toBe(w.ws.facilities);
    expect(desk.journey_id).toBe(journeyId);
    await w.get("journey", journeyId, w.p.fac.client, 404);
    // the laptop order is the IT catalogue's, for the new hire
    const ritm = await w.get("request_item", by.laptop.record_id, w.o);
    expect(ritm.requested_for).toBe(w.p.hire.userId);
  });

  it("gives the new hire their to-dos and moves on when they are done", async () => {
    const todos = await w.p.hire.client.get(`${w.P}/esm/my/todos`);
    const upload = todos.tasks.find((x: Record<string, any>) => x.type === "upload");
    expect(upload).toBeTruthy();
    expect(todos.journeys.map((j: Record<string, any>) => j.id)).toContain(journeyId);
    // an upload task needs a file first
    await w.p.hire.client.post(`${w.P}/r/hr_task/${upload.id}/transition`, { to: "done", version: upload.version }, 409);
    const form = new FormData();
    form.append("file", new File([Buffer.from("scan")], "id-card.png", { type: "image/png" }));
    const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/r/hr_task/${upload.id}/attachments`, { method: "POST", headers: { cookie: w.p.hire.client.cookie }, body: form }));
    expect(res.status).toBe(200);
    const fresh = await w.get("hr_task", upload.id, w.p.hire.client);
    await w.p.hire.client.post(`${w.P}/r/hr_task/${upload.id}/transition`, { to: "done", version: fresh.version });
    await w.drain();
    const t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${journeyId}/tracker`);
    const by = Object.fromEntries(t.activities.map((a: Record<string, any>) => [a.code, a]));
    expect(by.documents.state).toBe("done");
    expect(by.policies.state).toBe("in_progress");
    const sign = await w.get("hr_task", by.policies.record_id, w.p.hire.client);
    await w.p.hire.client.post(`${w.P}/r/hr_task/${sign.id}/transition`, { to: "done", version: sign.version }, 409);
    await w.p.hire.client.patch(`${w.P}/r/hr_task/${sign.id}`, { signed_name: "مریم احمدی", version: sign.version });
    const s2 = await w.get("hr_task", sign.id, w.p.hire.client);
    await w.p.hire.client.post(`${w.P}/r/hr_task/${sign.id}/transition`, { to: "done", version: s2.version });
    await w.drain();
    const after = await w.get("hr_task", sign.id, w.p.hire.client);
    expect(after.signed_at).toBeTruthy();
  });

  it("finishes the desk activity when facilities resolves its case, and re-plans open work when the anchor moves", async () => {
    let t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${journeyId}/tracker`);
    const desk = t.activities.find((a: Record<string, any>) => a.code === "desk");
    const row = await w.get("facility_request", desk.record_id, w.p.fac.client);
    await w.p.fac.client.post(`${w.P}/r/facility_request/${row.id}/transition`, { to: "resolved", data: { close_notes: "میز و کارت آماده است" }, version: row.version });
    await w.drain();
    t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${journeyId}/tracker`);
    expect(t.activities.find((a: Record<string, any>) => a.code === "desk").state).toBe("done");
    const before = t.activities.find((a: Record<string, any>) => a.code === "welcome").due_date;
    const j = await w.get("journey", journeyId, w.p.hrdesk.client);
    await w.p.hrdesk.client.patch(`${w.P}/r/journey/${journeyId}`, { anchor_date: dayFrom(19), version: j.version });
    await w.drain();
    t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${journeyId}/tracker`);
    const after = t.activities.find((a: Record<string, any>) => a.code === "welcome").due_date;
    expect(after > before).toBe(true);
    expect(Number(t.journey.progress)).toBeGreaterThan(0);
  });

  it("settles an approval activity with its round and skips open work when the journey is cancelled", async () => {
    // a template of the HR department with an immediate approval of the manager
    const tpl = await w.p.hrdesk.client.get(`${w.P}/r/journey_template?size=10`);
    const hrDept = w.dept.hr.id;
    const t2 = await w.o.post(`${w.P}/r/journey_template`, { name: "ارتقا", type: "promotion", department_id: hrDept, owner_group_id: w.g["کارشناسان منابع انسانی"] });
    await w.o.post(`${w.P}/r/journey_template_activity`, { template_id: t2.row.id, code: "approve", name: "تأیید مدیر", kind: "approval", assignee: "manager", start_offset: null, duration_days: 2 });
    await w.o.post(`${w.P}/r/journey_template_activity`, { template_id: t2.row.id, code: "letter", name: "ابلاغ حکم", kind: "acknowledge", assignee: "subject", start_offset: null, duration_days: 2, after: ["approve"] });
    expect(tpl.rows.length).toBeGreaterThan(0);
    const res = await w.p.hrdesk.client.post(`${w.P}/esm/journeys`, { template_id: t2.row.id, anchor_date: dayFrom(3), subject_person_id: w.p.emp.userId, manager_id: w.p.mgr.userId });
    await w.drain();
    const mine = (await w.p.mgr.client.get(`${w.P}/approvals/mine`)).approvals as Record<string, any>[];
    const a = mine.find((x) => x.table_key === "journey_activity");
    expect(a).toBeTruthy();
    await w.p.mgr.client.post(`${w.P}/approvals/${a!.id}/decide`, { decision: "approved" });
    await w.drain();
    let tr = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${res.journey.id}/tracker`);
    expect(tr.activities.find((x: Record<string, any>) => x.code === "approve").state).toBe("done");
    expect(tr.activities.find((x: Record<string, any>) => x.code === "letter").state).toBe("in_progress");
    const j = await w.get("journey", res.journey.id, w.p.hrdesk.client);
    await w.p.hrdesk.client.post(`${w.P}/r/journey/${res.journey.id}/transition`, { to: "cancelled", data: { notes: "ارتقا لغو شد" }, version: j.version });
    await w.drain();
    tr = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${res.journey.id}/tracker`);
    expect(tr.activities.find((x: Record<string, any>) => x.code === "letter").state).toBe("skipped");
    const task = tr.tasks[0];
    expect(task.state).toBe("skipped");
  });

  it("refuses a template with circular prerequisites and keeps definitions to the department's administrators", async () => {
    const tpl = await w.o.post(`${w.P}/r/journey_template`, { name: "دوری", type: "custom", department_id: w.dept.hr.id });
    await w.o.post(`${w.P}/r/journey_template_activity`, { template_id: tpl.row.id, code: "a", name: "الف", kind: "task", after: ["b"] });
    await w.o.post(`${w.P}/r/journey_template_activity`, { template_id: tpl.row.id, code: "b", name: "ب", kind: "task", after: ["a"] });
    const pv = await w.o.get(`${w.P}/esm/templates/${tpl.row.id}/preview?anchor=${dayFrom(3)}`);
    expect(pv.problems.length).toBeGreaterThan(0);
    await w.p.hrdesk.client.post(`${w.P}/esm/journeys`, { template_id: tpl.row.id, anchor_date: dayFrom(3), subject_person_id: w.p.emp.userId }, 400);
    // an HR agent is no administrator of the department: no services of their own
    await w.p.hrdesk.client.post(`${w.P}/r/esm_service`, { name: "خدمت تازه", department_id: w.dept.hr.id, case_table: "hr_case" }, 403);
  });
});
