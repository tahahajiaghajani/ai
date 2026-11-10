// Change enablement — the schedule: conflicts between changes (both sides, reviews kept by key, the gate before
// approval), blackout windows (flags, the gate before scheduling, the override reason), scoped maintenance windows
// and the scheduling assistant, lockdowns (hold, refuse, release), the calendar route, iCalendar and blackouts made
// from the official holidays.
import { describe, expect, it, beforeAll } from "vitest";
import { localInstant } from "@shared/sla/calendar";
import { sweep } from "@server/modules/change";
import { at, DAY, HOUR, world, type World } from "./change-helpers";

let w: World;
// real CIs: references to the CMDB are checked
let CI = "";
let CI2 = "";
const conflictsOf = async (id: string) =>
  (await w.o.get(`${w.P}/r/change_conflict?filter=${encodeURIComponent(JSON.stringify({ f: "change_id", op: "eq", v: id }))}&size=50`)).rows as Record<string, any>[];

beforeAll(async () => {
  w = await world();
  CI = await w.ci("سرور برنامهٔ حقوق");
  CI2 = await w.ci("سرور پایگاه داده", { class: "database" });
}, 120_000);

describe("conflicts between changes", () => {
  it("finds the same CI on both changes, keeps reviews by key and gates the request for approval", async () => {
    const { P, p } = w;
    const a = await w.change({ affected_cis: [CI], planned_start: at(20, 8), planned_end: at(20, 10) });
    expect(a.conflict_status).toBe("none");
    const b = await w.change({ affected_cis: [CI], planned_start: at(20, 9), planned_end: at(20, 11), assignment_group_id: w.g.servers }, p.other.client);
    // a draft does not collide with others; the other one does once it is in assessment
    expect(b.conflict_status).toBe("none");
    await w.move(a.id, ["assess"]);
    await w.drain();
    const bNow = await w.get(b.id);
    expect(bNow.conflict_status).toBe("conflict");
    expect(bNow.conflict_count).toBe(1);
    const [c] = await conflictsOf(b.id);
    expect(c.kind).toBe("same_ci");
    expect(c.other_change_id).toBe(a.id);
    // the gate: a detected conflict must be reviewed before approval
    await w.move(b.id, ["assess"], p.other.client);
    const before = await w.get(b.id, p.other.client);
    const refused = await p.other.client.post(`${P}/r/change_request/${b.id}/transition`, { to: "authorize", version: before.version }, 409);
    expect(refused.error.message).toContain("تداخل");
    const noReason = await p.other.client.patch(`${P}/r/change_conflict/${c.id}`, { status: "ignored", version: c.version }, 400);
    expect(noReason.error.details.fields.justification).toBeTruthy();
    await p.other.client.patch(`${P}/r/change_conflict/${c.id}`, { status: "ignored", justification: "دو تیم هماهنگ شده‌اند", version: c.version });
    const ack = await w.get(b.id, p.other.client);
    expect(ack.conflict_status).toBe("acknowledged");
    expect(ack.conflict_count).toBe(0);
    // a re-check keeps the review
    await p.other.client.post(`${P}/change/records/${b.id}/conflicts/check`, {});
    expect((await conflictsOf(b.id))[0].status).toBe("ignored");
    // approval also needs the questionnaire answered
    const risk = await p.other.client.get(`${P}/change/records/${b.id}/risk`);
    const answers = Object.fromEntries(risk.questions.map((q: any) => [q.id, q.kind === "number" ? 0 : q.options[0].value]));
    await p.other.client.put(`${P}/change/records/${b.id}/risk`, { answers, version: risk.version });
    const moved = await w.move(b.id, ["authorize"], p.other.client, {});
    expect(moved.state).toBe("authorize");
    // moving one change away removes the conflict on both
    await w.move(a.id, ["new"]);
    const aRow = await w.get(a.id);
    await p.agent.client.patch(`${P}/r/change_request/${a.id}`, { planned_start: at(21, 8), planned_end: at(21, 9), version: aRow.version });
    await w.drain();
    expect((await conflictsOf(b.id)).every((x) => x.active === false)).toBe(true);
  });
});

describe("windows", () => {
  it("a blackout flags the change and blocks scheduling unless a reason is given", async () => {
    const { P, o, p } = w;
    await o.post(`${P}/r/change_window`, { name: "ممنوعیت آزمایشی", kind: "blackout", start_at: at(30, 0), end_at: at(31, 0), enforcement: "block" });
    await w.drain();
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes("DNS"));
    const r = await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: at(30, 9), planned_end: at(30, 10), assignment_group_id: w.g.network, submit: true });
    expect(r.change.state).toBe("new");
    expect(r.change.in_blackout).toBe(true);
    expect(r.warning).toContain("ممنوعیت");
    const kinds = (await conflictsOf(r.change.id)).map((c) => c.kind);
    expect(kinds).toContain("blackout");
    const row = await w.get(r.change.id, p.agent.client);
    const ok = (await p.agent.client.post(`${P}/r/change_request/${r.change.id}/transition`, { to: "scheduled", data: { blackout_override_reason: "رفع فوری نشانی سرویس پرداخت" }, version: row.version })).row;
    expect(ok.state).toBe("scheduled");
  });

  it("a change bound to the weekly maintenance window is outside it even days away from its next occurrence", async () => {
    const { P, o } = w;
    const weekly = (await o.get(`${P}/r/change_window?size=50`)).rows.find((x: any) => x.kind === "maintenance" && x.recurrence === "weekly");
    // a Monday noon two weeks ahead: the Thursday-night window has no occurrence within a day of it
    const d = new Date(Date.now() + 14 * DAY);
    while (d.getUTCDay() !== 1) d.setTime(d.getTime() + DAY);
    d.setUTCHours(9, 0, 0, 0);
    const c = await w.change({ maintenance_window_id: weekly.id, planned_start: d.toISOString(), planned_end: new Date(d.getTime() + 2 * HOUR).toISOString() });
    expect(c.outside_window).toBe(true);
    expect(c.conflict_status).toBe("conflict");
    const kinds = (await conflictsOf(c.id)).map((x) => x.kind);
    expect(kinds).toContain("outside_window");
  });

  it("a maintenance window of a CI: outside it is flagged and the assistant proposes slots inside it", async () => {
    const { P, o, p } = w;
    const day = at(40, 0).slice(0, 10);
    await o.post(`${P}/r/change_window`, { name: "پنجرهٔ سرور پایگاه داده", kind: "maintenance", cis: [CI2], start_at: at(40, 20), end_at: at(40, 23), recurrence: "daily" });
    await w.drain();
    const c = await w.change({ affected_cis: [CI2], planned_start: at(42, 9), planned_end: at(42, 10) });
    expect(c.outside_window).toBe(true);
    expect((await conflictsOf(c.id)).map((x) => x.kind)).toContain("outside_window");
    const slots = await p.agent.client.get(`${P}/change/records/${c.id}/slots?days=60`);
    expect(slots.slots.length).toBeGreaterThan(0);
    const tz = "Asia/Tehran";
    // the window runs 20:00–23:00 UTC (the helper's hours are UTC); a one-hour slot starts by 22:00
    for (const s of slots.slots) {
      const utc = new Date(s.start).toISOString().slice(11, 16);
      expect(utc >= "20:00" && utc <= "22:00").toBe(true);
    }
    expect(Date.parse(slots.slots[0].start)).toBeGreaterThanOrEqual(localInstant(day, 0, tz));
    const inside = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { planned_start: slots.slots[0].start, planned_end: slots.slots[0].end, version: c.version });
    expect(inside.row.outside_window).toBe(false);
  });
});

describe("lockdowns", () => {
  it("a lockdown that starts later holds the changes in flight when its start comes, once", async () => {
    const { P, o, p, sys } = w;
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes("گواهی"));
    const scheduled = (await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: at(8, 9), planned_end: at(8, 10), assignment_group_id: w.g.network, submit: true })).change;
    expect(scheduled.state).toBe("scheduled");
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const lock = (await o.post(`${P}/r/change_lockdown`, { title: "قرنطینهٔ برنامه‌ریزی‌شده", starts_at: soon, reason: "مهاجرت مرکز داده" })).row;
    expect(lock.held_count).toBe(0);
    expect((await w.get(scheduled.id)).on_hold).toBe(false);
    const later = Date.now() + 30 * 60_000;
    expect((await sweep(sys, Number.POSITIVE_INFINITY, later)).started).toBe(1);
    const held = await w.get(scheduled.id);
    expect(held.on_hold).toBe(true);
    expect(held.lockdown_id).toBe(lock.id);
    const applied = (await o.get(`${P}/r/change_lockdown/${lock.id}`)).row;
    expect(applied.applied_at).toBeTruthy();
    expect(applied.held_count).toBeGreaterThanOrEqual(1);
    expect((await sweep(sys, Number.POSITIVE_INFINITY, later)).started).toBe(0);
    await o.post(`${P}/r/change_lockdown/${lock.id}/transition`, { to: "released" });
    expect((await w.get(scheduled.id)).on_hold).toBe(false);
  });

  it("holds changes in flight, refuses scheduling others and resumes them when released", async () => {
    const { P, o, p } = w;
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes("گواهی"));
    const scheduled = (await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: at(5, 9), planned_end: at(5, 10), assignment_group_id: w.g.network, submit: true })).change;
    expect(scheduled.state).toBe("scheduled");
    const lock = (await o.post(`${P}/r/change_lockdown`, { title: "قرنطینهٔ رخداد عمدهٔ شبکه", reason: "اختلال سراسری" })).row;
    expect(lock.state).toBe("active");
    const held = await w.get(scheduled.id);
    expect(held.on_hold).toBe(true);
    expect(held.on_hold_reason).toBe("lockdown");
    expect(held.lockdown_id).toBe(lock.id);
    expect((await o.get(`${P}/r/change_lockdown/${lock.id}`)).row.held_count).toBeGreaterThanOrEqual(1);
    await p.agent.client.post(`${P}/change/records/${scheduled.id}/resume`, {}, 409);
    const another = (await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: at(6, 9), planned_end: at(6, 10), assignment_group_id: w.g.network, submit: true }));
    expect(another.warning).toContain("قرنطینه");
    // an emergency change may still proceed past a lockdown
    const em = await w.change({ type: "emergency" });
    await w.move(em.id, ["authorize"]);
    const list = await w.approvals(em.id);
    await p.cm.client.post(`${P}/approvals/${list.find((x) => x.approver_id === p.cm.userId)!.id}/decide`, { decision: "approved" });
    expect((await w.get(em.id)).state).toBe("implement");
    await o.post(`${P}/r/change_lockdown/${lock.id}/transition`, { to: "released" });
    const resumed = await w.get(scheduled.id);
    expect(resumed.on_hold).toBe(false);
    expect(resumed.lockdown_id).toBeNull();
  });
});

describe("calendar", () => {
  it("serves changes with their flags, window occurrences and holidays; iCal; blackouts from official holidays", async () => {
    const { P, o, p } = w;
    await o.post(`${P}/calendars/seed`, { years: [1405] });
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 45 * 86_400_000).toISOString();
    const cal = await p.agent.client.get(`${P}/change/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(cal.changes.length).toBeGreaterThan(0);
    expect(cal.changes.some((c: any) => c.in_blackout === true)).toBe(true);
    expect(cal.windows.some((x: any) => x.kind === "maintenance")).toBe(true);
    expect(cal.windows.some((x: any) => x.kind === "blackout")).toBe(true);
    expect(Array.isArray(cal.holidays)).toBe(true);
    const mine = await p.other.client.get(`${P}/change/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mine=1`);
    expect(mine.changes.every((c: any) => c.assignment_group_id === w.g.servers || c.change_owner_id === p.other.userId || c.assigned_to === p.other.userId)).toBe(true);
    await p.agent.client.get(`${P}/change/calendar?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`, 400);

    const res = await w.e.app.fetch(new Request(`http://local.test/api${P}/change/calendar.ics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { cookie: p.agent.client.cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);

    const made = await o.post(`${P}/change/windows/from-holidays`, { year: 1405 });
    expect(made.created).toBeGreaterThan(0);
    const again = await o.post(`${P}/change/windows/from-holidays`, { year: 1405 });
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(made.created);
    await p.auditor.client.post(`${P}/change/windows/from-holidays`, { year: 1405 }, 403);
  });
});
