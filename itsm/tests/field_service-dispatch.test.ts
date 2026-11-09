// Field service (FSM-001…006/014/017/019/021/023/026): a work order from a customer case with coverage from the
// customer's onsite entitlement, a visit from a template (skills, checklist), candidates and assignment on the
// dispatch board (feasibility with reasons), the technician's day (accept, depart with an ETA the customer hears about
// without a name, arrive with a position only dispatch sees, the checklist before completion, sign-off and the service
// report), the work order following its visits (first-time fix), access (technicians read their own visits; others
// and IT do not), appointment slots without names, planned maintenance generated once.
import "./fixtures/rag";
import { beforeAll, describe, expect, it } from "vitest";
import { dayFrom, esmWorld, memberAt, type EsmWorld } from "./esm-helpers";
import type { Client } from "./helpers";
import { FULL_HOURS } from "@shared/sla/calendar";

type P = { client: Client; userId: string };

describe("field service: dispatch and the visit", () => {
  let w: EsmWorld;
  let disp: P, tech: P, tech2: P, contractor: P, cust: P;
  let group: string;
  let territory: string;
  let location: string;
  let caseId: string;
  let woId: string;
  let taskId: string;

  beforeAll(async () => {
    w = await esmWorld();
    await w.o.post(`${w.P}/csm/seed`, {});
    await w.o.post(`${w.P}/field_service/seed`, {});
    disp = await memberAt(w.e, "dispatch@example.com", "10.98.0.1");
    tech = await memberAt(w.e, "tech1@example.com", "10.98.0.2");
    tech2 = await memberAt(w.e, "tech2@example.com", "10.98.0.3");
    contractor = await memberAt(w.e, "vendor@example.com", "10.98.0.4");
    cust = await memberAt(w.e, "reza@client.example", "10.98.0.5");
    const groups = (await w.o.get(`${w.P}/r/group?size=200`)).rows as { id: string; name: string }[];
    group = groups.find((g) => g.name === "توزیع خدمات میدانی")!.id;
    await w.o.put(`${w.P}/access/members/${disp.userId}`, { roles: ["dispatcher", "csm_agent"], persona: "agent" });
    for (const p of [tech, tech2]) await w.o.put(`${w.P}/access/members/${p.userId}`, { roles: ["field_technician"], persona: "agent" });
    await w.o.put(`${w.P}/access/members/${contractor.userId}`, { roles: ["field_contractor"], persona: "agent" });
    await w.o.put(`${w.P}/access/members/${cust.userId}`, { roles: ["requester"], persona: "requester" });
    await w.o.post(`${w.P}/access/groups/${group}/members`, { user_ids: [disp.userId] });
    location = (await w.o.post(`${w.P}/r/location`, { name: "تهران — ساختمان مرکزی", kind: "building" })).row.id;
    territory = (await disp.client.post(`${w.P}/r/territory`, { name: "تهران", locations: [location], dispatch_group_id: group })).row.id;
    // a round-the-clock shift so that feasibility does not depend on when the suite runs
    const shift = (await w.o.post(`${w.P}/r/calendar`, { name: "شیفت شبانه‌روزی آزمون", timezone: "Asia/Tehran", hours: FULL_HOURS, holiday_sets: [] })).row.id;
    await disp.client.post(`${w.P}/r/technician`, { user_id: tech.userId, territories: [territory], dispatch_group_id: group, calendar_id: shift, skills: [{ skill: "شبکه", level: 3 }], home_lat: "35.70", home_lng: "51.40", max_tasks_per_day: 5 });
    await disp.client.post(`${w.P}/r/technician`, { user_id: tech2.userId, territories: [territory], dispatch_group_id: group, calendar_id: shift, skills: [{ skill: "شبکه", level: 4, expires_on: "2025-01-01" }] });
    await disp.client.post(`${w.P}/r/technician`, { user_id: contractor.userId, territories: [territory], dispatch_group_id: group, contractor: true, calendar_id: shift, skills: [] });
    // a customer with an onsite entitlement and a case
    const acc = (await w.o.post(`${w.P}/r/customer_account`, { name: "مشتری نمونه", email_domain: "client.example" })).row;
    await w.o.post(`${w.P}/r/customer_contact`, { name: "رضا", email: "reza@client.example", user_id: cust.userId });
    const ent = (await w.o.post(`${w.P}/r/entitlement`, { name: "پشتیبانی در محل", account_id: acc.id, channels: ["onsite", "portal"], starts_on: "2026-01-01", ends_on: "2027-12-30" })).row;
    await w.o.post(`${w.P}/r/entitlement/${ent.id}/transition`, { to: "active", version: ent.version });
    caseId = (await cust.client.post(`${w.P}/r/customer_case`, { short_description: "اینترنت طبقهٔ سوم قطع است", location_id: location })).row.id;
    await w.drain();
  });

  it("makes a work order for a customer case with coverage from the onsite entitlement", async () => {
    const wo = await disp.client.post(`${w.P}/field_service/from/customer_case/${caseId}`, { site_address: "خیابان آزادی، پلاک ۱۰", site_lat: "35.71", site_lng: "51.41" });
    woId = wo.id;
    const row = await w.get("work_order", woId, disp.client);
    expect(row.parent_table).toBe("customer_case");
    expect(row.coverage).toBe("covered");
    expect(row.billing_type).toBe("contract");
    expect(row.territory_id).toBe(territory);
    expect(row.assignment_group_id).toBe(group);
    const links = await disp.client.get(`${w.P}/r/work_order/${woId}/links`);
    expect(links.links.some((l: Record<string, any>) => l.other.id === caseId)).toBe(true);
  });

  it("creates a visit from a template with its skills and checklist, and ranks candidates", async () => {
    const tpl = (await disp.client.get(`${w.P}/r/wo_task_template?size=10`)).rows.find((t: Record<string, any>) => t.name === "نصب و راه‌اندازی تجهیزات شبکه");
    const t = await disp.client.post(`${w.P}/r/wo_task`, { short_description: "نصب سوئیچ تازه", work_order_id: woId, template_id: tpl.id });
    taskId = t.row.id;
    expect(t.row.required_skills).toEqual(["شبکه"]);
    expect(t.row.checklist.length).toBe(3);
    expect(t.row.visit_no).toBe(1);
    const c = await disp.client.get(`${w.P}/field_service/tasks/${taskId}/candidates`);
    const by = Object.fromEntries(c.candidates.map((x: Record<string, any>) => [x.user_id, x]));
    expect(by[tech.userId].feasible).toBe(true);
    expect(by[tech2.userId].feasible).toBe(false);
    expect(by[tech2.userId].blockers.join(" ")).toContain("منقضی");
    expect(by[contractor.userId].feasible).toBe(false);
    expect(c.candidates[0].user_id).toBe(tech.userId);
  });

  it("refuses an infeasible assignment with reasons and assigns the right technician on the board", async () => {
    const start = `${dayFrom(1)}T06:00:00.000Z`;
    const bad = await disp.client.post(`${w.P}/field_service/tasks/${taskId}/assign`, { technician_id: tech2.userId, start });
    expect(bad.assigned).toBe(false);
    expect(bad.warnings.length).toBeGreaterThan(0);
    const ok = await disp.client.post(`${w.P}/field_service/tasks/${taskId}/assign`, { technician_id: tech.userId, start });
    expect(ok.assigned).toBe(true);
    expect(ok.task.state).toBe("assigned");
    const board = await disp.client.get(`${w.P}/field_service/board?day=${dayFrom(1)}`);
    const lane = board.lanes.find((l: Record<string, any>) => l.user_id === tech.userId);
    expect(lane.tasks.map((x: Record<string, any>) => x.id)).toContain(taskId);
    expect(board.queue.map((x: Record<string, any>) => x.id)).not.toContain(taskId);
    expect((await w.get("work_order", woId, disp.client)).state).toBe("scheduled");
  });

  it("lets only the assigned technician (and dispatch) reach the visit and its work order", async () => {
    await w.get("wo_task", taskId, tech.client);
    await w.get("work_order", woId, tech.client);
    await w.get("wo_task", taskId, tech2.client, 404);
    await w.get("work_order", woId, tech2.client, 404);
    await w.get("wo_task", taskId, w.p.it.client, 404);
    // ranking and assigning people is the dispatchers' (a technician sees no colleague's load or distance)
    await tech.client.get(`${w.P}/field_service/tasks/${taskId}/candidates`, 403);
    await tech.client.post(`${w.P}/field_service/tasks/${taskId}/assign`, { technician_id: tech2.userId }, 403);
  });

  it("runs the visit: accept, depart (the customer hears it, no name), arrive, checklist, complete, sign-off", async () => {
    const day = await tech.client.get(`${w.P}/field_service/my-day?day=${dayFrom(1)}`);
    expect(day.visits.map((v: Record<string, any>) => v.task.id)).toContain(taskId);
    expect(day.visits[0].nav).toContain("neshan.org");
    await tech.client.post(`${w.P}/field_service/tasks/${taskId}/step`, { step: "accept" });
    const dep = await tech.client.post(`${w.P}/field_service/tasks/${taskId}/step`, { step: "depart", lat: 35.7, lng: 51.4 });
    expect(dep.task.eta_at).toBeTruthy();
    await w.drain();
    const j = await cust.client.get(`${w.P}/r/customer_case/${caseId}/journal`);
    const text = JSON.stringify(j);
    expect(text).toContain("در راه است");
    expect(text).not.toContain("tech1");
    await tech.client.post(`${w.P}/field_service/tasks/${taskId}/step`, { step: "arrive", lat: 35.71, lng: 51.41 });
    const asDisp = await w.get("wo_task", taskId, disp.client);
    expect(asDisp.check_in_lat).toBeTruthy();
    expect((await w.get("work_order", woId, disp.client)).state).toBe("in_progress");
    // the checklist comes first
    await tech.client.post(`${w.P}/field_service/tasks/${taskId}/step`, { step: "complete", resolution: "سوئیچ نصب شد" }, 409);
    const done = await tech.client.post(`${w.P}/field_service/tasks/${taskId}/step`, { step: "complete", resolution: "سوئیچ نصب و آزمایش شد", checklist_answers: { label: true, link: true, photo: true } });
    expect(done.task.state).toBe("work_complete");
    const signed = await tech.client.post(`${w.P}/field_service/tasks/${taskId}/signoff`, { signer_name: "رضا محمدی" });
    expect(signed.report).toContain("گزارش خدمت");
    expect(signed.report).toContain("رضا محمدی");
    await w.drain();
    const wo = await w.get("work_order", woId, disp.client);
    expect(wo.state).toBe("work_complete");
    expect(wo.first_time_fix).toBe(true);
    expect(wo.visits).toBe(1);
  });

  it("offers appointment slots without names and books one", async () => {
    const wo = await disp.client.post(`${w.P}/field_service/from/customer_case/${caseId}`, { short_description: "بازدید دوم" });
    await disp.client.post(`${w.P}/r/wo_task`, { short_description: "بازدید پیگیری", work_order_id: wo.id, required_skills: ["شبکه"], est_work_minutes: 60 });
    const s = await cust.client.get(`${w.P}/field_service/work-orders/${wo.id}/slots?days=7`);
    expect(s.slots.length).toBeGreaterThan(0);
    expect(JSON.stringify(s.slots)).not.toContain(tech.userId);
    const booked = await cust.client.post(`${w.P}/field_service/work-orders/${wo.id}/book`, { start: s.slots[0].start });
    expect(booked.window_start).toBe(s.slots[0].start);
    // someone else's work order is not theirs to book
    await w.p.emp.client.get(`${w.P}/field_service/work-orders/${wo.id}/slots`, 404);
  });

  it("generates planned maintenance once per occurrence and moves the plan on (Jalali months)", async () => {
    const tpl = (await disp.client.get(`${w.P}/r/wo_task_template?size=10`)).rows.find((t: Record<string, any>) => t.name === "بازدید دوره‌ای سامانهٔ سرمایش");
    const plan = await disp.client.post(`${w.P}/r/maintenance_plan`, { name: "سرویس فصلی چیلر", location_id: location, template_id: tpl.id, group_id: group, every_n: 3, interval_unit: "month", lead_days: 7, next_due: dayFrom(3) });
    const r1 = await disp.client.post(`${w.P}/field_service/maintenance/run`, {});
    expect(r1.generated).toBe(1);
    const r2 = await disp.client.post(`${w.P}/field_service/maintenance/run`, {});
    expect(r2.generated).toBe(0);
    const p = await w.get("maintenance_plan", plan.row.id, disp.client);
    expect(p.last_generated_due).toBe(dayFrom(3));
    expect(p.next_due > dayFrom(80)).toBe(true);
    const wos = await disp.client.get(`${w.P}/r/work_order?filter=${encodeURIComponent(JSON.stringify({ f: "maintenance_plan_id", op: "eq", v: plan.row.id }))}`);
    expect(wos.rows).toHaveLength(1);
    const tasks = await disp.client.get(`${w.P}/r/wo_task?filter=${encodeURIComponent(JSON.stringify({ f: "work_order_id", op: "eq", v: wos.rows[0].id }))}`);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0].window_start).toBeTruthy();
  });

  it("reports field KPIs", async () => {
    const d = await disp.client.get(`${w.P}/field_service/dashboard`);
    expect(d.completed).toBeGreaterThanOrEqual(1);
    expect(d.first_time_fix).toBe(100);
  });
});
