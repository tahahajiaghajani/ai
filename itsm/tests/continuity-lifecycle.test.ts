// Availability, capacity and continuity end to end: the outage lifecycle and its derived figures, the availability
// report and a service's trend, a declared major incident proposing an outage and its resolution proposing the end,
// capacity records fed by monitoring events (and the owner told on crossing), a BIA from the template with the
// proposed RTO and its checks, a plan's exercise (start, steps, result) marking the plan tested, the dashboard, and
// who may read it; the defaults (idempotent, kept for continuity managers).
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";
import { seedContinuityDefaults } from "@server/modules/continuity";

let w: EventWorld;
let service = "";
type Row = Record<string, any>;
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 100 })).rows as Row[];

beforeAll(async () => {
  w = await eventWorld();
  await w.o.post(`${w.P}/continuity/seed`, {});
  await w.o.post(`${w.P}/incident/seed`, {});
  service = (await w.o.post(`${w.P}/r/service`, { name: "پرداخت آنلاین", service_type: "business", state: "live", availability_target: "99.9" })).row.id;
  await w.drain();
}, 120_000);

describe("outages and availability", () => {
  it("derives duration and customer-minutes, needs an end to end and a cause to validate", async () => {
    const begin = new Date(Date.now() - 3 * 3600_000).toISOString();
    const o = (await w.o.post(`${w.P}/r/outage`, { title: "قطعی درگاه", service_id: service, begin_at: begin, affected_users: 100, impact_pct: "50" })).row;
    expect(o.state).toBe("ongoing");
    await w.o.post(`${w.P}/r/outage/${o.id}/transition`, { to: "ended" }, 400);
    const end = new Date(Date.parse(begin) + 3600_000).toISOString();
    const ended = (await w.o.post(`${w.P}/r/outage/${o.id}/transition`, { to: "ended", data: { end_at: end } })).row;
    expect(ended.duration).toBe(3600);
    expect(ended.customer_minutes).toBe(60 * 100 * 0.5);
    await w.o.post(`${w.P}/r/outage/${o.id}/transition`, { to: "validated" }, 400);
    expect((await w.o.post(`${w.P}/r/outage/${o.id}/transition`, { to: "validated", data: { cause: "network" } })).row.state).toBe("validated");
    await w.o.post(`${w.P}/r/outage`, { title: "بد", service_id: service, begin_at: end, end_at: begin }, 400);
  });

  it("reports availability per service against its target, and a service's trend", async () => {
    const r = await w.o.get(`${w.P}/continuity/availability?unit=month`);
    const s = (r.services as Row[]).find((x) => x.id === service)!;
    expect(s.target).toBe(99.9);
    expect(s.failures).toBe(1);
    expect(s.downtime_ms).toBe(30 * 60_000);
    expect(s.availability).toBeLessThan(100);
    expect(r.period.label).toBeTruthy();
    const t = await w.o.get(`${w.P}/continuity/availability/${service}?unit=month`);
    expect(t.periods).toHaveLength(12);
    expect(t.outages.length).toBe(1);
    const comp = await w.o.post(`${w.P}/continuity/composite`, { tree: { serial: [{ a: 99.9 }, { parallel: [{ a: 99 }, { a: 99 }] }] } });
    expect(comp.availability).toBeCloseTo(99.89, 2);
  });

  it("proposes an outage when a major incident is declared, and its end when it is resolved", async () => {
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "درگاه پرداخت از دسترس خارج است", service_id: service, impact: "1", urgency: "1" })).row;
    await w.o.post(`${w.P}/incident/${inc.id}/major`, { action: "declare", reason: "همهٔ پرداخت‌ها" });
    await w.drain();
    const [o] = await q("outage", { f: "incident_id", op: "eq", v: inc.id });
    expect(o).toMatchObject({ state: "proposed", service_id: service, proposed_by: "رخداد عمده" });
    await w.o.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "حل شد" } });
    await w.drain();
    expect((await one("outage", o.id)).end_at).toBeTruthy();
    // by hand from an incident: the same outage comes back
    const again = await w.o.post(`${w.P}/continuity/outages/from-incident`, { incident_id: inc.id });
    expect(again.row.id).toBe(o.id);
  });
});

describe("capacity", () => {
  it("follows monitoring values, rates them and tells the owner on crossing", async () => {
    const rec = (await w.o.post(`${w.P}/r/capacity_record`, { name: "دیسک داده db01", ci_id: w.ci.db, metric: "disk_used", unit: "GB", capacity: "100", event_match: " DB01/Disk_Used ", owner_id: w.p.ops.userId })).row;
    expect(rec.event_match).toBe("db01/disk_used");
    expect(rec.status).toBe("unknown");
    const s = await w.source({ name: "ظرفیت" });
    await w.send(s.key, { title: "disk used", host: "db01", metric: "disk_used", value: 95, severity: "info", event_id: "c1" });
    await w.drain();
    const after = await one("capacity_record", rec.id);
    expect(after).toMatchObject({ utilisation: "95", status: "critical" });
    expect(Number(after.utilisation_pct)).toBe(95);
    const inbox = await w.p.ops.client.get(`${w.P}/notify/inbox?limit=50`);
    expect((inbox.items as Row[]).some((i) => String(i.title).includes("ظرفیت بحرانی"))).toBe(true);
  });
});

describe("business impact, plans and exercises", () => {
  it("drafts a BIA from the template with the proposed RTO and checks RTO against MTPD", async () => {
    const b = await w.o.post(`${w.P}/continuity/bia/from-template`, { title: "تحلیل اثر پرداخت", service_id: service });
    expect(b.row.impacts.operational.d1).toBe(3);
    expect(b.row.proposed_rto).toBe(86_400);
    await w.o.patch(`${w.P}/r/bia/${b.row.id}`, { rto: 8 * 3600, mtpd: 4 * 3600 }, 400);
    await w.o.patch(`${w.P}/r/bia/${b.row.id}`, { rto: 4 * 3600, rpo: 3600, mtpd: 24 * 3600 });
    await w.o.post(`${w.P}/r/bia/${b.row.id}/transition`, { to: "in_review" });
    const approved = (await w.o.post(`${w.P}/r/bia/${b.row.id}/transition`, { to: "approved" })).row;
    expect(approved.approved_at).toBeTruthy();
    expect(approved.review_due).toBeTruthy();
  });

  it("runs an exercise of a plan: steps copied and timed, the result marks the plan tested", async () => {
    const [plan] = await q("continuity_plan", { f: "title", op: "eq", v: "الگوی طرح بازیابی خدمت" });
    await w.o.patch(`${w.P}/r/continuity_plan/${plan.id}`, { rto: 5 * 3600 });
    const ex = (await w.o.post(`${w.P}/r/exercise`, { title: "مانور جابه‌جایی", plan_id: plan.id, exercise_type: "failover", scheduled_at: new Date().toISOString() })).row;
    expect(ex.rto_target).toBe(5 * 3600);
    const started = (await w.o.post(`${w.P}/continuity/exercises/${ex.id}/start`, {})).row;
    expect(started.state).toBe("in_progress");
    expect(started.started_at).toBeTruthy();
    const full = await one("exercise", ex.id);
    expect(full.step_log).toHaveLength(6);
    for (const s of full.step_log as Row[]) await w.o.post(`${w.P}/continuity/exercises/${ex.id}/steps/${s.seq}`, { done: true });
    const done = (await w.o.post(`${w.P}/continuity/exercises/${ex.id}/finish`, { result: "passed", actual_data_loss: 0 })).row;
    expect(done.state).toBe("results");
    expect(done.rto_met).toBe(true);
    expect(done.actual_recovery).toBeGreaterThanOrEqual(0);
    expect((await one("continuity_plan", plan.id))).toMatchObject({ last_test_result: "passed" });
    expect((await one("continuity_plan", plan.id)).last_tested_at).toBeTruthy();
  });

  it("summarises continuity on the dashboard, for those who may read it", async () => {
    const d = await w.o.get(`${w.P}/continuity/dashboard`);
    expect(d.plans).toBeGreaterThan(0);
    expect(d.exercises_12m).toBe(1);
    expect(d.results.passed).toBe(1);
    expect(d.rto_achievement).toBe(100);
    expect(d.capacity.critical).toBe(1);
    await w.p.agent.client.get(`${w.P}/continuity/dashboard`, 403);
    await w.p.agent.client.get(`${w.P}/r/outage`, 403);
    await w.p.auditor.client.get(`${w.P}/continuity/dashboard`);
    await w.p.req.client.get(`${w.P}/continuity/availability`, 403);
  });
});

describe("seed", () => {
  it("is idempotent, re-adds what was deleted, and only a continuity manager runs it", async () => {
    expect((await seedContinuityDefaults(w.e.cfg, w.e.org)).skipped).toBe(true);
    expect((await seedContinuityDefaults(w.e.cfg, w.e.org, { force: true })).created).toEqual({});
    const [step] = await q("plan_step", { f: "seq", op: "eq", v: 6 });
    await w.o.del(`${w.P}/r/plan_step/${step.id}`);
    expect((await w.o.post(`${w.P}/continuity/seed`, {})).created).toEqual({ plan_step: 1 });
    const roles = (await w.o.get(`${w.P}/access/roles`)).roles as Row[];
    expect(roles.map((r) => r.key)).toContain("continuity_manager");
    // the operations manager writes its group's continuity records but approves nothing: no defaults either
    await w.p.mgr.client.post(`${w.P}/continuity/seed`, {}, 403);
    await w.p.agent.client.post(`${w.P}/continuity/seed`, {}, 403);
  });
});
