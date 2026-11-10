// Review fixes of enterprise, customer and field service (each case failed before its fix):
//   · CSM definitions are CSM staff's: a customer contact (requester) creates no entitlement or brand; a new
//     entitlement starts as a draft; a customer files cases only under their own account; brands and notices do not
//     show customers other accounts; a proactive case never carries the internal incident's title
//   · only HR of the department starts a journey, and the HR owner it names is HR too
//   · a Windows push neither moves an HR case out of its secure workspace nor adds outsiders as its watchers
//   · technicians do not read each other's positions
//   · a case's requester neither transfers it nor spawns child cases; a protected case's text stays behind on transfer
//   · bookings of approval-only spaces wait for approval (also when promoted from the waiting list); a visit is never
//     created already checked in
//   · HR tasks: no parentless task from an employee, no change of type by its doer, skipping is HR's; day-one
//     readiness counts done work only
//   · the customer signs completed work once, and what they signed stays as signed
import { beforeAll, describe, expect, it, vi } from "vitest";
import { esmWorld, dayFrom, inHours, memberAt, type EsmWorld } from "./esm-helpers";
import { statusOf } from "./portal-helpers";
import type { Client } from "./helpers";
import { tableDef } from "@shared/tables";
import { journeyProgress } from "@shared/esm/logic";
import { createIn, transitionIn, updateIn } from "@server/engine";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import type { Tx } from "@server/db";

vi.setConfig({ testTimeout: 180_000 });

type P = { client: Client; userId: string };
type Result = { entity: string; id: string; status: string; message?: string };
let w: EsmWorld;

async function push(c: Client, aggregates: { entity: string; id: string; base_rev: number; row: Record<string, unknown> }[]): Promise<Result[]> {
  return (await c.post(`/sync/push`, { org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates })).results as Result[];
}
/** A stored row in the shape a Windows app pushes it, with `patch` and a later stamp. */
async function rowOf(table: string, id: string, patch: Record<string, unknown>): Promise<{ row: Record<string, unknown>; rev: number }> {
  const r = (await w.e.db.one<Record<string, unknown>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
  return { row: { ...JSON.parse(JSON.stringify(r)), ...patch, updated_at: new Date(Date.now() + 5_000).toISOString() }, rev: Number(r.rev) };
}
const stored = async (table: string, id: string) => (await w.e.db.one<Record<string, any>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
const sysWrite = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> => w.sys.write(fn);

describe("esm/csm/field service review fixes", () => {
  let lead: P, cust: P, other: P, disp: P, tech1: P, tech2: P;
  let acme: Record<string, any>, globex: Record<string, any>;
  let product: string;

  beforeAll(async () => {
    w = await esmWorld();
    await w.o.post(`${w.P}/csm/seed`, {});
    await w.o.post(`${w.P}/field_service/seed`, {});
    lead = await memberAt(w.e, "rf.lead@example.com", "10.97.0.1");
    cust = await memberAt(w.e, "ali@rf-acme.example", "10.97.0.2");
    other = await memberAt(w.e, "sara@rf-globex.example", "10.97.0.3");
    disp = await memberAt(w.e, "rf.dispatch@example.com", "10.97.0.4");
    tech1 = await memberAt(w.e, "rf.tech1@example.com", "10.97.0.5");
    tech2 = await memberAt(w.e, "rf.tech2@example.com", "10.97.0.6");
    const groups = (await w.o.get(`${w.P}/r/group?size=200`)).rows as { id: string; name: string }[];
    const support = groups.find((g) => g.name === "پشتیبانی مشتریان")!.id;
    const dispatch = groups.find((g) => g.name === "توزیع خدمات میدانی")!.id;
    await w.o.put(`${w.P}/access/members/${lead.userId}`, { roles: ["csm_manager"], persona: "agent" });
    for (const p of [cust, other]) await w.o.put(`${w.P}/access/members/${p.userId}`, { roles: ["requester"], persona: "requester" });
    await w.o.put(`${w.P}/access/members/${disp.userId}`, { roles: ["dispatcher"], persona: "agent" });
    for (const p of [tech1, tech2]) await w.o.put(`${w.P}/access/members/${p.userId}`, { roles: ["field_technician"], persona: "agent" });
    await w.o.post(`${w.P}/access/groups/${support}/members`, { user_ids: [lead.userId] });
    await w.o.post(`${w.P}/access/groups/${dispatch}/members`, { user_ids: [disp.userId] });
    acme = (await lead.client.post(`${w.P}/r/customer_account`, { name: "آکمه آزمون", email_domain: "rf-acme.example", support_group_id: support, relationship_manager_id: lead.userId })).row;
    globex = (await lead.client.post(`${w.P}/r/customer_account`, { name: "گلوبکس آزمون", email_domain: "rf-globex.example", support_group_id: support })).row;
    product = (await lead.client.post(`${w.P}/r/customer_product`, { name: "سامانهٔ صورت‌حساب", support_group_id: support })).row.id;
    await lead.client.post(`${w.P}/r/customer_contact`, { name: "علی", email: "ali@rf-acme.example", user_id: cust.userId, is_primary: true });
    await lead.client.post(`${w.P}/r/customer_contact`, { name: "سارا", email: "sara@rf-globex.example", user_id: other.userId, is_primary: true });
    // Globex holds a premium entitlement
    const ge = (await lead.client.post(`${w.P}/r/entitlement`, { name: "پشتیبانی ویژهٔ گلوبکس", account_id: globex.id, support_level: "premium", channels: ["portal"], starts_on: "2026-01-01", ends_on: "2027-12-30" })).row;
    await lead.client.post(`${w.P}/r/entitlement/${ge.id}/transition`, { to: "active", version: ge.version });
    await disp.client.post(`${w.P}/r/technician`, { user_id: tech1.userId, dispatch_group_id: dispatch, home_lat: "35.70", home_lng: "51.40" });
    await disp.client.post(`${w.P}/r/technician`, { user_id: tech2.userId, dispatch_group_id: dispatch, home_lat: "35.80", home_lng: "51.50" });
    await w.drain();
  }, 300_000);

  // ----- CSM ----------------------------------------------------------------------------------------------------------

  it("refuses customer contacts' entitlements, brands and contacts; a new entitlement is a draft", async () => {
    const forged = { name: "سازمانی جعلی", account_id: acme.id, support_level: "enterprise", channels: ["portal"], starts_on: "2026-01-01", ends_on: "2030-01-01", state: "active" };
    expect(await statusOf(cust.client, "POST", `${w.P}/r/entitlement`, forged)).toBe(403);
    expect(Number((await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_entitlements where org_id = $1 and account_id = $2`, [w.e.org, acme.id]))!.n)).toBe(0);
    expect(await statusOf(cust.client, "POST", `${w.P}/r/customer_experience`, { name: "x", brand_name: "BRAND-X", greeting: "call +98-000", accounts: [] })).toBe(403);
    expect(await statusOf(cust.client, "POST", `${w.P}/r/customer_contact`, { name: "علی", email: "ali2@rf-acme.example", user_id: cust.userId, account_id: globex.id })).toBe(403);
    expect(await statusOf(cust.client, "POST", `${w.P}/r/customer_account`, { name: "حساب من" })).toBe(403);
    // the customer still keeps their own contact details
    const [mine] = (await cust.client.get(`${w.P}/r/customer_contact`)).rows;
    await cust.client.patch(`${w.P}/r/customer_contact/${mine.id}`, { preferred_channel: "email", version: mine.version });
    // staff create entitlements as drafts, activated by a transition
    const e = (await lead.client.post(`${w.P}/r/entitlement`, { ...forged, name: "پشتیبانی آکمه" })).row;
    expect(e.state).toBe("draft");
    await lead.client.post(`${w.P}/r/entitlement/${e.id}/transition`, { to: "active", version: e.version });
  });

  it("files a customer's case only under their own account (never another's entitlement)", async () => {
    expect([400, 403]).toContain(await statusOf(cust.client, "POST", `${w.P}/r/customer_case`, { short_description: "پرونده برای حساب دیگر", account_id: globex.id, channel: "portal" }));
    expect(await statusOf(cust.client, "POST", `${w.P}/r/customer_case`, { short_description: "برای دیگری", account_id: globex.id, requested_for: null, caller_id: null, channel: "portal" })).toBe(403);
    const sara = (await other.client.get(`${w.P}/r/customer_contact`)).rows[0];
    expect(await statusOf(cust.client, "POST", `${w.P}/r/customer_case`, { short_description: "با مخاطب دیگر", contact_id: sara.id, channel: "portal" })).toBe(403);
    const own = await cust.client.post(`${w.P}/r/customer_case`, { short_description: "پرسش دربارهٔ صورت‌حساب", channel: "portal" });
    expect(own.row.account_id).toBe(acme.id);
    expect(own.row.support_level ?? null).not.toBe("premium");
  });

  it("shows customers neither a brand's accounts nor a notice's other accounts and recipients", async () => {
    const exp = (await lead.client.post(`${w.P}/r/customer_experience`, { name: "برند آکمه", brand_name: "آکمه", accounts: [acme.id, globex.id] })).row;
    const seen = await w.get("customer_experience", exp.id, cust.client);
    expect(seen.brand_name).toBe("آکمه");
    expect(seen.accounts).toBeUndefined();
    const n = (await lead.client.post(`${w.P}/r/customer_notice`, { title: "اطلاع اختلال", body: "متن", accounts: [acme.id, globex.id], state: "sent" })).row;
    expect(n.state).toBe("draft");
    await lead.client.post(`${w.P}/r/customer_notice/${n.id}/transition`, { to: "approved", version: n.version });
    await lead.client.post(`${w.P}/csm/notices/${n.id}/send`, {});
    const read = await w.get("customer_notice", n.id, cust.client);
    expect(read.accounts).toBeUndefined();
    expect(read.recipients).toBeUndefined();
  });

  it("titles a proactive case with the customer's product, never the internal incident", async () => {
    await w.o.post(`${w.P}/cmdb/seed`, {});
    const ci = (await w.o.post(`${w.P}/r/ci`, { name: "db-prod-03", class: "server" })).row.id;
    await lead.client.post(`${w.P}/r/install_base_item`, { name: "صورت‌حساب آکمه", account_id: acme.id, product_id: product, ci_id: ci });
    const inc = await w.o.post(`${w.P}/r/incident`, { short_description: "db-prod-03 down for Acme and Globex after CHG-123", ci_id: ci, priority: "2" });
    expect((await lead.client.post(`${w.P}/csm/incidents/${inc.row.id}/proactive`, {})).created).toBe(1);
    await w.drain();
    const mine = (await cust.client.get(`${w.P}/r/customer_case?filter=${encodeURIComponent(JSON.stringify({ f: "proactive", op: "eq", v: true }))}`)).rows;
    expect(mine).toHaveLength(1);
    expect(mine[0].short_description).toContain("سامانهٔ صورت‌حساب");
    expect(mine[0].short_description).not.toContain("db-prod-03");
    expect(mine[0].short_description).not.toContain("CHG-123");
  });

  // ----- journeys ---------------------------------------------------------------------------------------------------

  it("starts journeys only for HR of the department, with an HR owner from HR", async () => {
    const tpl = (await w.p.hrdesk.client.get(`${w.P}/r/journey_template?size=20`)).rows.find((t: Record<string, any>) => t.code === "onboarding_standard");
    const input = { template_id: tpl.id, anchor_date: dayFrom(5), subject_person_id: w.p.hire.userId, manager_id: w.p.emp.userId, hr_owner_id: w.p.hrdesk.userId };
    expect(await statusOf(w.p.emp.client, "POST", `${w.P}/esm/journeys`, input)).toBe(403);
    expect(await statusOf(w.p.emp.client, "POST", `${w.P}/r/journey`, input)).toBe(403);
    // an HR agent names no non-HR person the journey's HR owner (its orders and cases act in that name)
    expect(await statusOf(w.p.hrdesk.client, "POST", `${w.P}/esm/journeys`, { ...input, manager_id: w.p.mgr.userId, hr_owner_id: w.p.emp.userId })).toBe(400);
    const t2 = await w.o.post(`${w.P}/r/journey_template`, { name: "آزمون ساده", type: "custom", department_id: w.dept.hr.id, owner_group_id: w.g["کارشناسان منابع انسانی"] });
    await w.o.post(`${w.P}/r/journey_template_activity`, { template_id: t2.row.id, code: "ack", name: "خواندن آیین‌نامه", kind: "acknowledge", assignee: "subject", start_offset: null, duration_days: 2 });
    const ok = await w.p.hrdesk.client.post(`${w.P}/esm/journeys`, { template_id: t2.row.id, anchor_date: dayFrom(3), subject_person_id: w.p.emp.userId, manager_id: w.p.mgr.userId, hr_owner_id: w.p.hr.userId });
    expect(ok.journey.hr_owner_id).toBe(w.p.hr.userId);
  });

  // ----- department cases -------------------------------------------------------------------------------------------

  it("keeps a pushed HR case in its secure workspace and its watchers inside the department", async () => {
    const made = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "گواهی برای سفارت", dept_service_id: w.svc.hr_certificate.id });
    await w.drain();
    await w.get("hr_case", made.row.id, w.p.auditor.client, 404);
    const moved = await rowOf("hr_case", made.row.id, { department_id: w.dept.finance.id, dept_service_id: null });
    await push(w.p.hrdesk.client, [{ entity: "hr_case", id: made.row.id, base_rev: moved.rev, row: moved.row }]);
    const after = await stored("hr_case", made.row.id);
    expect(after.department_id).toBe(w.dept.hr.id);
    expect(after.workspace_id).toBe(w.ws.hr);
    await w.get("hr_case", made.row.id, w.p.auditor.client, 404);
    const watch = await rowOf("hr_case", made.row.id, { watch_list: [w.p.it.userId] });
    expect((await push(w.p.hrdesk.client, [{ entity: "hr_case", id: made.row.id, base_rev: watch.rev, row: watch.row }]))[0].status).not.toBe("ok");
    await w.get("hr_case", made.row.id, w.p.it.client, 404);
  });

  it("lets only those who work a case transfer it or spawn child work", async () => {
    const made = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "پرسش دربارهٔ بیمه", dept_service_id: w.svc.hr_certificate.id });
    await w.drain();
    const asEmp = await w.p.emp.client.get(`${w.P}/r/hr_case/${made.row.id}`);
    expect(asEmp.meta.esm.can_work).toBe(false);
    expect(await statusOf(w.p.emp.client, "POST", `${w.P}/esm/cases/hr_case/${made.row.id}/transfer`, { department_id: w.dept.finance.id, note: "مالی است" })).toBe(403);
    expect(await statusOf(w.p.emp.client, "POST", `${w.P}/esm/cases/hr_case/${made.row.id}/child`, { department_id: w.dept.facilities.id, short_description: "میز تازه" })).toBe(403);
    expect((await w.get("hr_case", made.row.id, w.p.hrdesk.client)).state).not.toBe("closed_incomplete");
  });

  it("leaves a protected case's text behind on transfer and refuses moving a confidential one to a table without confidentiality", async () => {
    const hr = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "SECRET-HR-TITLE وام", description: "SECRET-HR-BODY جزئیات وام", dept_service_id: w.svc.hr_certificate.id });
    await w.drain();
    const moved = await w.p.hrdesk.client.post(`${w.P}/esm/cases/hr_case/${hr.row.id}/transfer`, { department_id: w.dept.finance.id, note: "پیگیری پرداخت وام" });
    expect(moved.table).toBe("finance_case");
    const fin = await stored("finance_case", moved.id);
    expect(JSON.stringify([fin.short_description, fin.description])).not.toContain("SECRET-HR");
    expect(fin.description).toContain("پیگیری پرداخت وام");
    // an employee-relations complaint is confidential: finance cannot hold it
    const er = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "شکایت محرمانه", dept_service_id: w.svc.hr_complaint.id });
    await w.drain();
    expect((await w.get("hr_case", er.row.id, w.p.er.client)).confidential).toBe(true);
    expect(await statusOf(w.p.er.client, "POST", `${w.P}/esm/cases/hr_case/${er.row.id}/transfer`, { department_id: w.dept.finance.id, note: "x" })).toBe(400);
  });

  // ----- facilities -------------------------------------------------------------------------------------------------

  it("asks approval for bookings of approval-only spaces, also when promoted from the waiting list", async () => {
    const loc = (await w.o.post(`${w.P}/r/location`, { name: "ساختمان آزمون رزرو", kind: "building" })).row.id;
    const space = (await w.o.post(`${w.P}/r/space`, { name: "تالار با تأیید", kind: "meeting_room", location_id: loc, bookable: true, requires_approval: true, owner_group_id: w.g["پشتیبانی و تأسیسات"], max_hours: 8 })).row;
    const forged = await w.p.emp.client.post(`${w.P}/r/reservation`, { title: "جلسه", space_id: space.id, start_at: inHours(48), end_at: inHours(49), state: "confirmed" });
    expect(forged.row.state).toBe("requested");
    const asked = await w.e.db.query(`select id from sm_approvals where org_id = $1 and record_id = $2`, [w.e.org, forged.row.id]);
    expect(asked.length).toBeGreaterThan(0);
    // a slot held by a confirmed booking; a booking waits for it, then the slot is freed
    const held = await sysWrite((tx) => createIn(tx, w.sys, "reservation", { title: "نگه‌داشته", space_id: space.id, start_at: inHours(72), end_at: inHours(73), booked_for: w.p.mgr.userId, state: "confirmed" }, { trusted: true }));
    expect(held.state).toBe("confirmed");
    const waiting = await w.p.emp.client.post(`${w.P}/r/reservation`, { title: "در انتظار", space_id: space.id, start_at: inHours(72), end_at: inHours(73) });
    expect(waiting.row.waitlist_position).toBe(1);
    await sysWrite((tx) => transitionIn(tx, w.sys, "reservation", String(held.id), "cancelled", {}, { trusted: true }));
    const promoted = await stored("reservation", waiting.row.id);
    expect(promoted.state).toBe("requested");
    expect(promoted.waitlist_position ?? null).toBeNull();
    expect((await w.e.db.query(`select id from sm_approvals where org_id = $1 and record_id = $2`, [w.e.org, waiting.row.id])).length).toBeGreaterThan(0);
  });

  it("creates a visit expected, never already checked in past its NDA and safety guard", async () => {
    const site = (await w.o.post(`${w.P}/r/location`, { name: "ساختمان آزمون پذیرش", kind: "building" })).row.id;
    const v = await w.p.emp.client.post(`${w.P}/r/visit`, { visitor_name: "مهمان آزمون", site_id: site, expected_at: inHours(2), requires_nda: true, state: "checked_in" });
    expect(v.row.state).toBe("expected");
  });

  // ----- HR tasks and readiness -------------------------------------------------------------------------------------

  it("refuses employees' HR tasks without a case or journey and keeps a task's type and skipping to HR", async () => {
    expect(await statusOf(w.p.emp.client, "POST", `${w.P}/r/hr_task`, { type: "sign", assigned_to: w.p.mgr.userId, short_description: "SPOOF-SIGN", document_url: "https://evil.example/x" })).toBe(403);
    const todos = await w.p.mgr.client.get(`${w.P}/esm/my/todos`);
    expect(JSON.stringify(todos)).not.toContain("SPOOF-SIGN");
    const task = (await w.p.hrdesk.client.post(`${w.P}/r/hr_task`, { type: "upload", assigned_to: w.p.hire.userId, short_description: "بارگذاری مدارک", assignment_group_id: w.g["کارشناسان منابع انسانی"] })).row;
    const mine = await w.get("hr_task", task.id, w.p.hire.client);
    await w.p.hire.client.patch(`${w.P}/r/hr_task/${task.id}`, { type: "task", version: mine.version }, 403);
    await w.p.hire.client.post(`${w.P}/r/hr_task/${task.id}/transition`, { to: "done", version: mine.version }, 409);
    await w.p.hire.client.post(`${w.P}/r/hr_task/${task.id}/transition`, { to: "skipped", data: { outcome: "نیازی نیست" }, version: mine.version }, 409);
    const asHr = await w.get("hr_task", task.id, w.p.hrdesk.client);
    await w.p.hrdesk.client.post(`${w.P}/r/hr_task/${task.id}/transition`, { to: "skipped", data: { outcome: "مدارک حضوری تحویل شد" }, version: asHr.version });
    // day-one readiness counts done work only
    const acts = [
      { code: "a", state: "done", after: [], start_date: null, due_date: null, day_one: true },
      { code: "b", state: "skipped", after: [], start_date: null, due_date: null, day_one: true },
    ];
    expect(journeyProgress(acts, dayFrom(0)).day_one_ready).toBe(false);
    expect(journeyProgress([acts[0]], dayFrom(0)).day_one_ready).toBe(true);
  });

  // ----- field service ----------------------------------------------------------------------------------------------

  it("shows technicians' positions to dispatch only", async () => {
    const t2 = (await disp.client.get(`${w.P}/r/technician?size=50`)).rows.find((t: Record<string, any>) => t.user_id === tech2.userId);
    expect(t2.home_lat).toBeTruthy();
    const seen = (await tech1.client.get(`${w.P}/r/technician?size=50`)).rows.find((t: Record<string, any>) => t.user_id === tech2.userId);
    expect(seen).toBeTruthy();
    for (const f of ["home_lat", "home_lng", "last_lat", "last_lng", "last_seen_at"]) expect(seen[f], f).toBeUndefined();
    expect(tableDef("technician")!.fields.find((f) => f.name === "home_lat")!.noSync).toBe(true);
  });

  it("takes the customer's sign-off once, on completed work, and keeps what they signed", async () => {
    const { task } = await sysWrite(async (tx) => {
      const wo = await createIn(tx, w.sys, "work_order", { short_description: "تعویض سوئیچ" }, { trusted: true });
      const t = await createIn(tx, w.sys, "wo_task", { short_description: "بازدید", work_order_id: wo.id, technician_id: tech1.userId }, { trusted: true });
      await transitionIn(tx, w.sys, "wo_task", String(t.id), "assigned", {}, { trusted: true });
      return { task: t };
    });
    expect(await statusOf(tech1.client, "POST", `${w.P}/field_service/tasks/${task.id}/signoff`, { signer_name: "مشتری آزمون" })).toBe(409);
    await sysWrite(async (tx) => {
      for (const to of ["accepted", "on_site"]) await transitionIn(tx, w.sys, "wo_task", String(task.id), to, {}, { trusted: true });
      await updateIn(tx, w.sys, "wo_task", String(task.id), { resolution: "سوئیچ تعویض شد" }, { trusted: true });
      await transitionIn(tx, w.sys, "wo_task", String(task.id), "work_complete", {}, { trusted: true });
    });
    const signed = await tech1.client.post(`${w.P}/field_service/tasks/${task.id}/signoff`, { signer_name: "مشتری آزمون" });
    expect(signed.task.signer_name).toBe("مشتری آزمون");
    expect(await statusOf(tech1.client, "POST", `${w.P}/field_service/tasks/${task.id}/signoff`, { signer_name: "کس دیگر" })).toBe(409);
    const t = await w.get("wo_task", String(task.id), tech1.client);
    await tech1.client.patch(`${w.P}/r/wo_task/${task.id}`, { resolution: "کار دیگری که مشتری ندید", version: t.version }, 403);
    expect((await stored("wo_task", String(task.id))).resolution).toBe("سوئیچ تعویض شد");
  });
});
