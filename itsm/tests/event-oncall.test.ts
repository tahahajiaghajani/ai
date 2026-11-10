// On-call, escalation and paging end to end: who is on call now (the seeded schedule of «پشتیبانی شبکه»), routing
// to the team's escalation policy, a page with a one-time acknowledgement link through the notification service,
// the sign-in-free acknowledgement page, levels advancing, an unanswered policy raising an incident, «take on-call»,
// the shifts and «my shifts» as iCalendar, the sweep (snoozes, auto-close, heartbeats) and the operations reports.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";
import { onCallForGroup, sweep, forgetSources } from "@server/modules/event";

let w: EventWorld;
let oncall: string;
let schedule: string;
type Row = Record<string, any>;
const q = async (table: string, filter: unknown, fields?: string[]) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 100, ...(fields ? { fields } : {}) })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
const due = async (alertId: string) => {
  await w.e.db.query(`update sm_alerts set next_escalation_at = now() - interval '1 minute' where id = $1`, [alertId]);
  await w.e.db.query(`update sm_jobs set run_at = now() where kind = 'event.escalate' and status = 'queued'`);
  await w.drain();
};
const clientOf = (userId: string) => Object.values(w.p).find((p) => p.userId === userId)!.client;
const tokenFor = async (userId: string, number: string) => {
  const inbox = await clientOf(userId).get(`${w.P}/notify/inbox?limit=50`);
  const item = (inbox.items as Row[]).find((i) => String(i.body ?? "").includes(number) && String(i.body ?? "").includes("/p/ack/"));
  const m = /\/p\/ack\/([A-Za-z0-9_-]+)/.exec(String(item?.body ?? ""));
  return m?.[1] ?? null;
};

beforeAll(async () => {
  w = await eventWorld();
  const now = await w.o.get(`${w.P}/event/oncall/now`);
  const item = (now.items as Row[]).find((i) => i.group_id === w.g.network)!;
  oncall = item.user_id;
  schedule = item.schedule_id;
}, 120_000);

describe("who is on call", () => {
  it("names a member of the team now, for the API and the notification service", async () => {
    expect([w.p.ops.userId, w.p.agent.userId]).toContain(oncall);
    expect(await onCallForGroup(w.e.db, w.sys, w.g.network)).toEqual([oncall]);
    const shifts = await w.o.get(`${w.P}/event/oncall/schedules/${schedule}/shifts?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 14 * 86_400_000).toISOString())}`);
    expect(shifts.final.length).toBeGreaterThan(0);
    expect(shifts.layers.length).toBe(2);
    expect(shifts.display[oncall]).toBeTruthy();
  });
});

describe("escalation and paging", () => {
  let alertId = "";
  let number = "";
  it("routes a network alert to the team's policy and pages the person on call with an acknowledgement link", async () => {
    const s = await w.source({ name: "شبکه" });
    await w.send(s.key, { title: "پورت ۲۴ قطع شد", host: "sw-edge1", severity: "major", check: "if24", event_id: "p1" });
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    alertId = a.id;
    number = a.number;
    const alert = await one("alert", alertId);
    expect(alert.assignment_group_id).toBe(w.g.network);
    expect(alert.escalation_state).toBe("running");
    expect(alert.escalation_level).toBe(1);
    expect(alert.responders).toContain(oncall);
    const pages = await q("page", { f: "alert_id", op: "eq", v: alertId });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ user_id: oncall, level: 1, state: "sent" });
    expect(await tokenFor(oncall, number)).toBeTruthy();
  });

  it("acknowledges by the link on behalf of the paged person and stops the escalation", async () => {
    const token = (await tokenFor(oncall, number))!;
    const view = await w.raw("GET", `/public/ack/${token}`);
    const v = await view.json();
    expect(v).toMatchObject({ number, state: "open", page_state: "sent", expired: false });
    expect(JSON.stringify(v)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    const res = await (await w.raw("POST", `/public/ack/${token}`, "{}", { "content-type": "application/json" })).json();
    expect(res).toMatchObject({ changed: true, state: "acknowledged" });
    await w.drain();
    const alert = await one("alert", alertId);
    expect(alert).toMatchObject({ state: "acknowledged", acknowledged_by: oncall, escalation_state: "acknowledged" });
    const [page] = await q("page", { f: "alert_id", op: "eq", v: alertId });
    expect(page).toMatchObject({ state: "acknowledged", ack_via: "link" });
    const again = await (await w.raw("POST", `/public/ack/${token}`, "{}", { "content-type": "application/json" })).json();
    expect(again.changed).toBe(false);
    expect((await w.raw("GET", "/public/ack/not-a-real-token-at-all-xxxxxxxx")).status).toBe(404);
  });

  it("moves to the next level when nobody answers, and a policy left unanswered raises an incident", async () => {
    const policy = (await w.o.post(`${w.P}/r/escalation_policy`, { name: "تک‌سطحی", group_id: w.g.db, repeat_times: 0 })).row.id;
    await w.o.post(`${w.P}/r/escalation_level`, { policy_id: policy, level: 1, delay_minutes: 0, target: "users", users: [w.p.other.userId], channels: ["in_app"] });
    await w.o.post(`${w.P}/r/escalation_level`, { policy_id: policy, level: 2, delay_minutes: 5, target: "users", users: [w.p.mgr.userId], channels: ["in_app"] });
    await w.o.post(`${w.P}/r/alert_route`, { name: "آزمون", sort_order: 1, condition: { f: "tags", op: "contains", v: "x-test" }, escalation_policy_id: policy });
    const s = await w.source({ name: "بی‌پاسخ" });
    await w.send(s.key, { title: "صف پیام انباشته شد", host: "mq1", severity: "warning", tags: ["x-test"], event_id: "u1" });
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    let pages = await q("page", { f: "alert_id", op: "eq", v: a.id });
    expect(pages.map((p) => p.user_id)).toEqual([w.p.other.userId]);
    await due(a.id);
    pages = await q("page", { f: "alert_id", op: "eq", v: a.id });
    expect(pages.map((p) => p.user_id).sort()).toEqual([w.p.other.userId, w.p.mgr.userId].sort());
    expect((await one("alert", a.id)).escalation_level).toBe(2);
    await due(a.id);
    const alert = await one("alert", a.id);
    expect(alert.escalation_state).toBe("exhausted");
    expect(alert.incident_id).toBeTruthy();
  });

  it("ends the open pages when a team member acknowledges from the console", async () => {
    const s = await w.source({ name: "کنسول" });
    await w.send(s.key, { title: "مسیریاب هسته کند است", host: "rtr-core", severity: "major", check: "lat", event_id: "k1" });
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    const by = oncall === w.p.ops.userId ? w.p.agent : w.p.ops;
    await by.client.post(`${w.P}/event/alerts/${a.id}/ack`, {});
    await w.drain();
    const pages = await q("page", { f: "alert_id", op: "eq", v: a.id });
    expect(pages.every((p) => p.state !== "sent")).toBe(true);
    expect((await one("alert", a.id)).acknowledged_by).toBe(by.userId);
    // a link acts once: the ended page's link acknowledges nothing, even when the alert is open again
    const old = (await tokenFor(oncall, a.number))!;
    expect(old).toBeTruthy();
    await by.client.post(`${w.P}/event/alerts/${a.id}/unack`, {});
    await w.drain();
    const again = await (await w.raw("POST", `/public/ack/${old}`, "{}", { "content-type": "application/json" })).json();
    expect(again).toMatchObject({ changed: false, page_state: "canceled", state: "open" });
    expect((await one("alert", a.id)).state).toBe("open");
  });

  it("shows the escalation timeline of an alert", async () => {
    const t = await w.o.get(`${w.P}/event/alerts/${alertId}/timeline`);
    expect(t.policy.name).toBe("ارتقای پشتیبانی شبکه");
    expect(t.items.map((i: Row) => i.kind)).toEqual(expect.arrayContaining(["opened", "paged", "page_ack", "acknowledged"]));
  });
});

describe("cover, shifts and the sweep", () => {
  it("lets a team member take on-call for an hour, not someone outside the team", async () => {
    const taker = oncall === w.p.ops.userId ? w.p.agent : w.p.ops;
    await taker.client.post(`${w.P}/event/oncall/schedules/${schedule}/take`, { minutes: 60 });
    const now = await w.o.get(`${w.P}/event/oncall/now?group_id=${w.g.network}`);
    expect(now.items[0]).toMatchObject({ user_id: taker.userId, override: true });
    await w.p.other.client.post(`${w.P}/event/oncall/schedules/${schedule}/take`, { minutes: 60 }, 403);
    const ics = await (await w.raw("GET", `${w.P}/event/oncall/mine.ics`, undefined, { cookie: taker.client.cookie })).text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
  });

  it("brings snoozed alerts back, closes cleared ones and watches heartbeats", async () => {
    const s = await w.source({ name: "جاروب", heartbeat_minutes: 1 });
    await w.send(s.key, [{ title: "a1", host: "z1", check: "c1", event_id: "s1" }, { title: "a2", host: "z2", check: "c2", event_id: "s2" }]);
    await w.drain();
    const [a1, a2] = (await q("alert", { f: "source_id", op: "eq", v: s.id })).sort((x, y) => String(x.short_description).localeCompare(String(y.short_description)));
    await w.o.post(`${w.P}/event/alerts/${a1.id}/snooze`, { minutes: 30 });
    await w.e.db.query(`update sm_alerts set snoozed_until = now() - interval '1 minute' where id = $1`, [a1.id]);
    await w.send(s.key, { title: "a2", host: "z2", check: "c2", status: "resolved", event_id: "s3" });
    await w.drain();
    await w.e.db.query(`update sm_alerts set resolved_at = now() - interval '1 day' where id = $1`, [a2.id]);
    await w.e.db.query(`update sm_event_sources set last_event_at = now() - interval '10 minutes' where id = $1`, [s.id]);
    const r = await sweep(w.sys);
    expect(r.unsnoozed).toBeGreaterThanOrEqual(1);
    expect(r.closed).toBeGreaterThanOrEqual(1);
    expect(r.heartbeats).toBeGreaterThanOrEqual(1);
    expect((await one("alert", a1.id)).state).toBe("open");
    expect((await one("alert", a2.id)).state).toBe("closed");
    const hb = await q("alert", { f: "metric", op: "eq", v: "heartbeat" });
    expect(hb).toHaveLength(1);
    // events resume: the heartbeat alert clears
    forgetSources();
    await w.e.db.query(`update sm_event_sources set last_event_at = now() where id = $1`, [s.id]);
    await sweep(w.sys);
    expect((await one("alert", hb[0].id)).state).toBe("cleared");
  });
});

describe("reports", () => {
  it("reports operations, noise and on-call load — alerts of the window's first hours included", async () => {
    // an alert from the first hours of a 7-day window falls on the day before the first bar
    const [old] = await q("alert", { f: "node", op: "eq", v: "sw-edge1" });
    await w.e.db.query(`update sm_alerts set created_at = now() - interval '6 days 23 hours' where id = $1`, [old.id]);
    const r = await w.o.get(`${w.P}/event/reports?days=7`);
    expect(r.trend).toHaveLength(7);
    expect(r.totals.alerts).toBeGreaterThan(0);
    expect(r.totals.paged_alerts).toBeGreaterThan(0);
    expect(r.pages.total).toBeGreaterThan(0);
    expect(r.pages.acknowledged).toBeGreaterThan(0);
    expect(r.mtta.count).toBeGreaterThan(0);
    const noise = await w.o.get(`${w.P}/event/noise?days=7`);
    expect(noise.alerts).toBeGreaterThan(0);
    const load = await w.o.get(`${w.P}/event/oncall/load?days=7`);
    expect((load.rows as Row[]).some((x) => x.user_id === oncall && x.pages > 0)).toBe(true);
    const narrated = await w.o.post(`${w.P}/event/ai/noise`, { days: 7 });
    expect(narrated.text).toBeTruthy();
    await w.p.req.client.get(`${w.P}/event/reports?days=7`, 403);
    await w.p.req.client.get(`${w.P}/event/oncall/load?days=7`, 403);
  });
});
