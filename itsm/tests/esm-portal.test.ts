// The portal's registration hook and the data of the department screens (ESM-001/005/006, CSM-022, FSM-017): each
// caller gets the department sections and services they may use (audience applied, no record they may not read), a
// customer contact their account's section, a technician their visits; a department's home opens to its members and
// administrators only and counts with the caller's access; space availability shows whose bookings are whose without
// naming others'.
import "./fixtures/rag";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dayFrom, esmWorld, memberAt, type EsmWorld } from "./esm-helpers";

type Section = { key: string; kind: string; title: string; links: { key: string; path: string; count?: number | null }[]; services: { name: string; case_table: string }[]; facts: { key: string; value: string }[] };

// each test drives a whole organisation and drains its jobs; the full suite runs many such files side by side
vi.setConfig({ testTimeout: 180_000 });

describe("esm: portal sections and department screens", () => {
  let w: EsmWorld;

  beforeAll(async () => {
    w = await esmWorld();
    // an employee's open HR case (counted in their section's «my cases» link)
    await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "پرسش دربارهٔ مرخصی استحقاقی", dept_service_id: w.svc.hr_leave.id });
    await w.drain();
  }, 240_000);

  it("gives an employee the departments' sections with the services they may use and their own case count", async () => {
    const r = await w.p.emp.client.get(`${w.P}/esm/portal/sections`);
    const sections = r.sections as Section[];
    const hr = sections.find((s) => s.key === "department:hr")!;
    expect(hr).toBeTruthy();
    expect(hr.kind).toBe("department");
    expect(hr.services.map((s) => s.name)).toEqual(expect.arrayContaining(["مرخصی", "فیش حقوقی"]));
    const mine = hr.links.find((l) => l.key === "my-cases")!;
    expect(mine.path).toBe("esm/my-cases?department=hr");
    expect(mine.count).toBe(1);
    expect(sections.some((s) => s.key === "department:facilities")).toBe(true);
    // nothing names a record: services and links only
    expect(JSON.stringify(sections)).not.toContain("پرسش دربارهٔ مرخصی استحقاقی");
    // the IT agent sees the same departments to ask, with none of the employee's cases counted
    const it = (await w.p.it.client.get(`${w.P}/esm/portal/sections`)).sections as Section[];
    expect(it.find((s) => s.key === "department:hr")!.links.find((l) => l.key === "my-cases")!.count).toBe(0);
    // my cases of one department, the page those links open
    const cases = await w.p.emp.client.get(`${w.P}/esm/my/cases?department=hr`);
    expect(cases.cases.length).toBe(1);
    expect((await w.p.emp.client.get(`${w.P}/esm/my/cases?department=finance`)).cases.length).toBe(0);
  });

  it("adds a customer contact's account section and a technician's visits", async () => {
    await w.o.post(`${w.P}/csm/seed`, {});
    await w.o.post(`${w.P}/field_service/seed`, {});
    const cust = await memberAt(w.e, "ali@shop.example", "10.97.0.1");
    await w.o.put(`${w.P}/access/members/${cust.userId}`, { roles: ["requester"], persona: "requester" });
    const acc = (await w.o.post(`${w.P}/r/customer_account`, { name: "فروشگاه نمونه", email_domain: "shop.example" })).row;
    await w.o.post(`${w.P}/r/customer_contact`, { name: "علی", email: "ali@shop.example", user_id: cust.userId });
    const ent = (await w.o.post(`${w.P}/r/entitlement`, { name: "پشتیبانی پایه", account_id: acc.id, support_level: "premium", starts_on: "2026-01-01", ends_on: "2027-12-30" })).row;
    await w.o.post(`${w.P}/r/entitlement/${ent.id}/transition`, { to: "active", version: ent.version });
    const sections = (await cust.client.get(`${w.P}/esm/portal/sections`)).sections as Section[];
    const mine = sections.find((s) => s.kind === "customer")!;
    expect(mine.title).toBe("فروشگاه نمونه");
    expect(mine.links.map((l) => l.path)).toEqual(["customers/cases", "customers/cases/new"]);
    expect(mine.facts.find((f) => f.key === `ent:${ent.id}`)!.value).toContain("سطح ویژه");
    // another member sees no customer section
    expect(((await w.p.emp.client.get(`${w.P}/esm/portal/sections`)).sections as Section[]).some((s) => s.kind === "customer")).toBe(false);
    // a technician with an open visit gets the field section
    const tech = await memberAt(w.e, "tech.portal@example.com", "10.97.0.2");
    await w.o.put(`${w.P}/access/members/${tech.userId}`, { roles: ["field_technician"], persona: "agent" });
    await w.o.post(`${w.P}/r/technician`, { user_id: tech.userId, skills: [] });
    const wo = (await w.o.post(`${w.P}/r/work_order`, { short_description: "بازدید چاپگر طبقهٔ دوم" })).row;
    const task = (await w.o.post(`${w.P}/r/wo_task`, { short_description: "بازدید چاپگر", work_order_id: wo.id, technician_id: tech.userId, scheduled_start: `${dayFrom(1)}T06:00:00.000Z`, scheduled_end: `${dayFrom(1)}T07:00:00.000Z` })).row;
    await w.o.post(`${w.P}/r/wo_task/${task.id}/transition`, { to: "assigned", version: task.version });
    const field = ((await tech.client.get(`${w.P}/esm/portal/sections`)).sections as Section[]).find((s) => s.kind === "field")!;
    expect(field.links[0].path).toBe("field/my-day");
    expect(field.facts[0].value).toBe("۱");
  });

  it("opens a department's home to its members and counts with their access", async () => {
    const home = await w.p.hrdesk.client.get(`${w.P}/esm/departments/hr/home`);
    expect(home.department.key).toBe("hr");
    const q = home.queues.find((x: { table: string }) => x.table === "hr_case");
    expect(q.open).toBeGreaterThanOrEqual(1);
    expect(home.services.length).toBeGreaterThan(3);
    expect(home.journeys).toBeTruthy();
    // IT and the employee are not members of the HR workspace
    await w.p.it.client.get(`${w.P}/esm/departments/hr/home`, 403);
    await w.p.emp.client.get(`${w.P}/esm/departments/hr/home`, 403);
    // the facilities agent's own department
    const fac = await w.p.fac.client.get(`${w.P}/esm/departments/facilities/home`);
    expect(fac.queues.some((x: { table: string }) => x.table === "facility_request")).toBe(true);
  });

  it("shows when spaces are busy, marking only the caller's own bookings", async () => {
    const location = (await w.o.post(`${w.P}/r/location`, { name: "ساختمان آزمون — طبقهٔ سوم", kind: "floor" })).row.id;
    const space = (await w.p.fac.client.post(`${w.P}/r/space`, { name: "اتاق جلسهٔ آزمون", kind: "meeting_room", capacity: 8, bookable: true, location_id: location })).row;
    const start = `${dayFrom(2)}T06:00:00.000Z`;
    const end = `${dayFrom(2)}T07:00:00.000Z`;
    await w.p.emp.client.post(`${w.P}/r/reservation`, { title: "جلسهٔ تیم", space_id: space.id, start_at: start, end_at: end });
    const q = `from=${dayFrom(2)}T00:00:00.000Z&to=${dayFrom(3)}T00:00:00.000Z&kind=meeting_room`;
    const mine = (await w.p.emp.client.get(`${w.P}/esm/spaces/availability?${q}`)).spaces.find((s: { id: string }) => s.id === space.id);
    expect(mine.busy).toHaveLength(1);
    expect(mine.busy[0].mine).toBe(true);
    expect(mine.busy[0].id).toBeTruthy();
    const other = (await w.p.mgr.client.get(`${w.P}/esm/spaces/availability?${q}`)).spaces.find((s: { id: string }) => s.id === space.id);
    expect(other.busy[0].mine).toBe(false);
    expect(other.busy[0].id).toBeNull();
    expect(JSON.stringify(other)).not.toContain("جلسهٔ تیم");
  });
});
