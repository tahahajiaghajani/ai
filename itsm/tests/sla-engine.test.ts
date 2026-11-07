// The SLA engine end to end (src/server/modules/sla): attach on create, meta.sla and sla_due, pause/resume with
// working time not counted, stop (achieved / breached), warnings and the breach fired exactly once by the timer
// job (events, escalation, a system note), priority change repair, retroactive start, cancel and reset, business
// calendars, the timeline endpoint, and the seed of calendars and official holidays.
import { describe, it, expect, beforeAll } from "vitest";
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { addBusiness, calendarOf, DEFAULT_HOURS, HOUR } from "@shared/sla/calendar";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import { fireTimer, seedCalendars, SEED_DELAY_MS } from "@server/modules/sla";
import { engineOrg, outbox, type EngineOrg } from "./engine-helpers";

const CASE: TableDef = {
  key: "sla_case",
  table: "sm_sla_cases",
  label: "پرونده",
  plural: "پرونده‌ها",
  icon: "folder",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "CASE", pad: 5 },
  display: "short_description",
  fields: [{ name: "reported_at", label: "زمان گزارش", type: "datetime" }],
  scope: {},
};
registerTable(CASE);

const MIN = 60_000;
const near = (a: number | string | null | undefined, b: number, slack = 5000) => {
  const x = typeof a === "number" ? a : Date.parse(String(a));
  expect(Math.abs(x - b), `${new Date(x).toISOString()} ≈ ${new Date(b).toISOString()}`).toBeLessThanOrEqual(slack);
};

describe("SLA engine", () => {
  let e: EngineOrg;
  let P = "";
  let def = "";
  const timersOf = (id: string) => e.db.query<Record<string, any>>(`select * from sm_task_slas where org_id = $1 and record_id = $2 and deleted_at is null order by start_at, created_at`, [e.org, id]);
  /** move a timer back in time (as if `ms` had passed) */
  const age = async (taskSla: string, ms: number) => {
    await e.db.query(
      `update sm_task_slas set start_at = start_at - ($2::bigint * interval '1 millisecond'),
              pause_started_at = pause_started_at - ($2::bigint * interval '1 millisecond'),
              planned_end_at = planned_end_at - ($2::bigint * interval '1 millisecond') where id = $1`,
      [taskSla, ms],
    );
  };
  const dueNow = () => e.db.query(`update sm_jobs set run_at = now() - interval '1 second' where org_id = $1 and kind like 'sla.%' and status = 'queued'`, [e.org]);
  const create = (data: Record<string, unknown>) => e.owner.post(`${P}/r/sla_case`, { short_description: "پرونده", ...data }).then((r) => r.row);
  const get = (id: string) => e.owner.get(`${P}/r/sla_case/${id}`);

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    def = (
      await e.owner.post(`${P}/r/sla_definition`, {
        name: "حل پرونده",
        table_key: "sla_case",
        type: "sla",
        target: "resolution",
        duration_mode: "priority",
        durations: { "1": 3600, "2": 7200, "3": 14400, "4": 28800, "5": 57600 },
        pause_condition: { f: "state", op: "eq", v: "on_hold" },
        stop_condition: { f: "state", op: "in", v: ["resolved", "closed"] },
        cancel_condition: { f: "state", op: "eq", v: "canceled" },
        reset_condition: { f: "assignment_group_id", op: "changed" },
        warn_percents: [50, 75, 90],
        breach_actions: [{ type: "escalate" }, { type: "notify", users: [e.ownerId] }],
      })
    ).row.id;
  });

  it("attaches a timer on create; meta.sla and sla_due show its deadline", async () => {
    const t0 = Date.now();
    const row = await create({ priority: "2" });
    const [t] = await timersOf(row.id);
    expect(t).toMatchObject({ definition_id: def, stage: "in_progress", active: true, duration: 7200, table_key: "sla_case", record_number: row.number });
    near(t.planned_end_at, t0 + 2 * HOUR);
    const r = await get(row.id);
    near(r.row.sla_due, t0 + 2 * HOUR);
    expect(r.meta.sla).toHaveLength(1);
    expect(r.meta.sla[0]).toMatchObject({ label: "حل پرونده", state: "in_progress", paused: false, breached: false, met: false });
    near(r.meta.sla[0].due_at, t0 + 2 * HOUR);
    expect(r.meta.sla[0].remaining_ms).toBeGreaterThan(2 * HOUR - 10_000);
    // a timer job waits for the first warning (50 % = one hour)
    const jobs = await outbox(e.db, e.org, "sla.timer");
    const job = jobs.find((j) => j.payload.id === t.id && j.status === "queued");
    expect(job).toBeTruthy();
  });

  it("does not count the time it was paused", async () => {
    const row = await create({ priority: "2" });
    const t1 = await e.owner.post(`${P}/r/sla_case/${row.id}/transition`, { to: "on_hold" });
    expect(t1.meta.sla[0]).toMatchObject({ paused: true, state: "paused" });
    expect(t1.row.sla_due).toBeNull();
    let [t] = await timersOf(row.id);
    expect(t.stage).toBe("paused");
    // the pause lasted half an hour
    await e.db.query(`update sm_task_slas set pause_started_at = pause_started_at - interval '30 minutes' where id = $1`, [t.id]);
    const r = await e.owner.post(`${P}/r/sla_case/${row.id}/transition`, { to: "in_progress" });
    [t] = await timersOf(row.id);
    expect(t.stage).toBe("in_progress");
    expect(Number(t.paused_total)).toBeGreaterThanOrEqual(1800);
    expect(Number(t.paused_total)).toBeLessThan(1810);
    near(t.planned_end_at, Date.parse(t.start_at) + 2 * HOUR + 30 * MIN, 10_000);
    near(r.row.sla_due, Date.parse(t.planned_end_at), 1000);
  });

  it("stops as achieved in time, and as breached when late (announcing the breach once)", async () => {
    const ok = await create({ priority: "2" });
    const resolved = await e.owner.post(`${P}/r/sla_case/${ok.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "حل شد" } });
    expect(resolved.meta.sla[0]).toMatchObject({ state: "achieved", met: true });
    expect(resolved.row.sla_due).toBeNull();
    const late = await create({ priority: "1" });
    const [t] = await timersOf(late.id);
    await age(t.id, 90 * MIN);
    await e.owner.post(`${P}/r/sla_case/${late.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "دیر حل شد" } });
    const [after] = await timersOf(late.id);
    expect(after).toMatchObject({ stage: "breached", breached: true, active: false });
    const breaches = (await outbox(e.db, e.org, "record.sla_breach")).filter((j) => j.payload.id === late.id);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].payload.data).toMatchObject({ at_stop: true, task_sla_id: t.id });
  });

  it("fires the highest warning reached and the breach exactly once", async () => {
    const row = await create({ priority: "2" });
    const [t] = await timersOf(row.id);
    await age(t.id, 80 * MIN); // 67 %
    await dueNow();
    await tick(e.cfg);
    const warnings = async () => (await outbox(e.db, e.org, "record.sla_warning")).filter((j) => j.payload.id === row.id).map((j) => j.payload.data.threshold);
    expect(await warnings()).toEqual([50]);
    await dueNow();
    await tick(e.cfg);
    expect(await warnings()).toEqual([50]);
    await age(t.id, 50 * MIN); // 108 %
    await dueNow();
    await tick(e.cfg);
    expect(await warnings()).toEqual([50, 90]);
    const breaches = (await outbox(e.db, e.org, "record.sla_breach")).filter((j) => j.payload.id === row.id);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].payload.data).toMatchObject({ at_stop: false, notify: [{ users: [e.ownerId] }] });
    const r = await get(row.id);
    expect(r.row.escalation).toBe(1);
    expect(r.meta.sla[0]).toMatchObject({ breached: true, state: "breached" });
    const [after] = await timersOf(row.id);
    expect(after).toMatchObject({ stage: "breached", breached: true, active: true, warned: 90 });
    // the job and a direct look again change nothing
    const sys = await systemCtx(e.cfg, e.org);
    await fireTimer(sys, t.id);
    await dueNow();
    await tick(e.cfg);
    expect((await outbox(e.db, e.org, "record.sla_breach")).filter((j) => j.payload.id === row.id)).toHaveLength(1);
    expect((await get(row.id)).row.escalation).toBe(1);
    const journal = await e.owner.get(`${P}/r/sla_case/${row.id}/journal`);
    expect(journal.entries.some((x: { kind: string; body: string }) => x.kind === "system" && x.body.includes("نقض"))).toBe(true);
  });

  it("repairs the target when the priority changes", async () => {
    const row = await create({ priority: "3" }); // 4 h
    const [t] = await timersOf(row.id);
    await age(t.id, 3 * HOUR); // 75 %
    await e.owner.patch(`${P}/r/sla_case/${row.id}`, { priority: "1" }); // 1 h: overdue now
    let [x] = await timersOf(row.id);
    expect(Number(x.duration)).toBe(3600);
    near(x.planned_end_at, Date.parse(x.start_at) + HOUR, 2000);
    await dueNow();
    await tick(e.cfg);
    [x] = await timersOf(row.id);
    expect(x).toMatchObject({ breached: true, stage: "breached" });
    // a lower priority gives a longer target: no longer overdue
    await e.owner.patch(`${P}/r/sla_case/${row.id}`, { priority: "5" }); // 16 h
    [x] = await timersOf(row.id);
    expect(x).toMatchObject({ breached: false, stage: "in_progress", duration: 57600 });
    // thresholds already passed under the new target are not announced again
    expect(Number(x.warned)).toBe(0);
  });

  it("starts from a field of the record (retroactive start)", async () => {
    const retro = (
      await e.owner.post(`${P}/r/sla_definition`, {
        name: "پاسخ از زمان گزارش", table_key: "sla_case", target: "response", duration_mode: "fixed", duration: 3600,
        start_condition: { f: "reported_at", op: "nempty" }, stop_condition: { f: "state", op: "ne", v: "new" },
        retroactive: true, retroactive_field: "reported_at", warn_percents: [],
      })
    ).row.id;
    const reported = Date.now() - 2 * HOUR;
    const row = await create({ priority: "4", reported_at: new Date(reported).toISOString() });
    const t = (await timersOf(row.id)).find((x) => x.definition_id === retro)!;
    near(t.start_at, reported, 1000);
    near(t.planned_end_at, reported + HOUR, 1000);
    await dueNow();
    await tick(e.cfg);
    const breaches = (await outbox(e.db, e.org, "record.sla_breach")).filter((j) => j.payload.id === row.id && j.payload.data.definition_id === retro);
    expect(breaches).toHaveLength(1);
    await e.owner.patch(`${P}/r/sla_definition/${retro}`, { active: false });
  });

  it("cancels on the cancel condition and starts again on the reset condition", async () => {
    const g1 = (await e.owner.post(`${P}/r/group`, { name: "گروه یک" })).row.id;
    const g2 = (await e.owner.post(`${P}/r/group`, { name: "گروه دو" })).row.id;
    const row = await create({ priority: "2", assignment_group_id: g1 });
    await e.owner.patch(`${P}/r/sla_case/${row.id}`, { assignment_group_id: g2 });
    const ts = (await timersOf(row.id)).filter((x) => x.definition_id === def);
    expect(ts.map((x) => x.stage)).toEqual(["canceled", "in_progress"]);
    await e.owner.post(`${P}/r/sla_case/${row.id}/transition`, { to: "canceled", data: { close_notes: "لغو" } });
    const after = (await timersOf(row.id)).filter((x) => x.definition_id === def);
    expect(after.map((x) => x.stage)).toEqual(["canceled", "canceled"]);
    const r = await get(row.id);
    expect(r.meta.sla ?? []).toHaveLength(0);
  });

  it("counts working time on a business calendar", async () => {
    const cal = (await e.owner.post(`${P}/r/calendar`, { name: "اداری آزمایشی", timezone: "Asia/Tehran", hours: DEFAULT_HOURS, holiday_sets: ["org"] })).row.id;
    await e.owner.post(`${P}/r/holiday`, { date: "2030-01-05", title: "تعطیلی آزمایشی", holiday_set: "org" });
    const office = (
      await e.owner.post(`${P}/r/sla_definition`, { name: "اداری", table_key: "sla_case", duration_mode: "fixed", duration: 10 * 3600, calendar_id: cal, warn_percents: [] })
    ).row.id;
    const row = await create({ priority: "4" });
    const t = (await timersOf(row.id)).find((x) => x.definition_id === office)!;
    const expected = addBusiness(calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, [{ date: "2030-01-05" }]), Date.parse(t.start_at), 10 * HOUR)!;
    near(t.planned_end_at, expected, 1000);
    expect(t.calendar_id).toBe(cal);
    expect(t.timezone).toBe("Asia/Tehran");
    // a bad week is refused
    await e.owner.post(`${P}/r/calendar`, { name: "خراب", timezone: "Asia/Tehran", hours: [[["08:00", "12:00"], ["11:00", "13:00"]], [], [], [], [], [], []] }, 400);
    await e.owner.post(`${P}/r/calendar`, { name: "منطقهٔ ناشناخته", timezone: "Mars/Olympus", hours: DEFAULT_HOURS }, 400);
    await e.owner.patch(`${P}/r/sla_definition/${office}`, { active: false });
  });

  it("serves a record's SLA timeline", async () => {
    const row = await create({ priority: "2" });
    await e.owner.post(`${P}/r/sla_case/${row.id}/transition`, { to: "on_hold" });
    await e.owner.post(`${P}/r/sla_case/${row.id}/transition`, { to: "in_progress" });
    await e.owner.post(`${P}/r/sla_case/${row.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "-" } });
    const tl = await e.owner.get(`${P}/sla/records/sla_case/${row.id}`);
    const main = tl.timers.find((x: { definition_id: string }) => x.definition_id === def);
    expect(main.state).toBe("achieved");
    expect(main.events.map((x: { kind: string }) => x.kind)).toEqual(["start", "pause", "resume", "stop"]);
    // whoever may not read the record does not read its timeline
    const req = await e.member("member");
    await e.owner.put(`${P}/access/members/${req.userId}`, { roles: ["requester"] });
    await req.client.get(`${P}/sla/records/sla_case/${row.id}`, 404);
  });

  it("refuses writes of timers through the API", async () => {
    const row = await create({ priority: "2" });
    const [t] = await timersOf(row.id);
    await e.owner.patch(`${P}/r/task_sla/${t.id}`, { stage: "achieved" }, 403);
  });
});

describe("calendar seed", () => {
  it("queues the seed of a new organisation and seeds calendars and official holidays once", async () => {
    const e = await engineOrg();
    const job = await e.db.one<{ run_at: string }>(`select run_at from sm_jobs where org_id = $1 and kind = 'sla.seed' and status = 'queued'`, [e.org]);
    expect(job).toBeTruthy();
    expect(Date.parse(job!.run_at)).toBeGreaterThan(Date.now() + SEED_DELAY_MS - 60_000);
    const first = await seedCalendars(e.cfg, e.org);
    expect(first).toMatchObject({ calendars: 2, holidays: 79, years: [1404, 1405, 1406] });
    const again = await seedCalendars(e.cfg, e.org);
    expect(again).toMatchObject({ calendars: 0, holidays: 0, years: [] });
    const P = `/o/${e.org}`;
    const cals = await e.owner.get(`${P}/r/calendar`);
    expect(cals.rows.map((r: { name: string }) => r.name).sort()).toEqual(["ساعات اداری", "شبانه‌روزی"]);
    expect(cals.rows.find((r: { name: string }) => r.name === "ساعات اداری").is_default).toBe(true);
    const predicted = await e.owner.post(`${P}/r/holiday/query`, { filter: { and: [{ f: "predicted", op: "eq", v: true }, { f: "year", op: "eq", v: 1406 }] }, size: 100, fields: ["date", "alternative_date", "title"] });
    expect(predicted.total).toBe(16);
    expect(predicted.rows.filter((r: { alternative_date: string | null }) => r.alternative_date)).toHaveLength(2);
    // 29 Esfand 1404 and Nowruz 1405 are shaded on the default calendar
    const h = await e.owner.get(`${P}/calendars/holidays?from=2026-03-20&to=2026-03-25`);
    expect(h.holidays.map((x: { date: string }) => x.date)).toEqual(["2026-03-20", "2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24"]);
    // a deleted bundled holiday is not added again; the year stays seeded
    const one = predicted.rows[0];
    await e.owner.del(`${P}/r/holiday/${one.id}?version=1`);
    expect(await seedCalendars(e.cfg, e.org)).toMatchObject({ holidays: 0 });
    // every holiday is editable
    const nowruz = (await e.owner.post(`${P}/r/holiday/query`, { filter: { f: "date", op: "eq", v: "2026-03-21" } })).rows[0];
    const edited = await e.owner.patch(`${P}/r/holiday/${nowruz.id}`, { half_day: true, version: nowruz.version });
    expect(edited.row).toMatchObject({ half_day: true, year: 1405, source: "bundled", kind: "solar" });
    // the job of the seed finds nothing more to do
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'sla.seed'`, [e.org]);
    await tick(e.cfg);
    expect((await e.owner.get(`${P}/r/holiday?size=1`)).total).toBe(78);
  });
});
