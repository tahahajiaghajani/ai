// Business-time arithmetic (src/shared/sla/calendar.ts) and SLA timer maths (src/shared/sla/timer.ts): working weeks,
// holidays and half days, overnight shifts, DST-free Asia/Tehran and a zone with clock changes, block boundaries,
// and the algebra the SLA engine relies on (add ∘ between = id, monotonicity, additivity).
import { describe, it, expect } from "vitest";
import {
  addBusiness, businessBetween, calendarOf, DEFAULT_HOURS, FULL_HOURS, formatHours, HOUR, hoursProblem, isWorking, MINUTE,
  nextWorkingInstant, parseHours, parseTime, shiftsOf, weekMinutes, workingIntervals, type BusinessCalendar, type HoursJson,
} from "@shared/sla/calendar";
import { dueEvents, evaluateTimer, targetSeconds, thresholdAt, warnLevels, durationsProblem } from "@shared/sla/timer";

/** An instant in Tehran (UTC+03:30, no DST since 2022). */
const T = (s: string) => Date.parse(`${s}+03:30`);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const office = (holidays: { date: string; half_day?: boolean }[] = []) => calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, holidays);
const week = (days: Partial<Record<number, [string, string][]>>): HoursJson => Array.from({ length: 7 }, (_, i) => days[i] ?? []);

// 2026-11-07 is a Saturday (the first day of the Iranian week); 2026-11-13 is the Friday after it.
describe("working hours", () => {
  it("parses and prints times", () => {
    expect(parseTime("08:30")).toBe(510);
    expect(parseTime("۰۸:۳۰")).toBe(510);
    expect(parseTime("24:00")).toBe(1440);
    expect(parseTime("24:30")).toBeNull();
    expect(parseTime("8")).toBeNull();
    expect(formatHours(parseHours(DEFAULT_HOURS))).toEqual(DEFAULT_HOURS);
    expect(weekMinutes(parseHours(DEFAULT_HOURS))).toEqual([480, 480, 480, 480, 480, 240, 0]);
    expect(weekMinutes(parseHours(week({ 0: [["22:00", "06:00"]] })))[0]).toBe(480);
  });

  it("explains what is wrong with a week", () => {
    expect(hoursProblem(DEFAULT_HOURS)).toBeNull();
    expect(hoursProblem(FULL_HOURS)).toBeNull();
    expect(hoursProblem(week({ 0: [["22:00", "06:00"]] }))).toBeNull();
    expect(hoursProblem([[]])).toMatch(/هفت روز/);
    expect(hoursProblem(week({ 0: [["08:00", "12:00"], ["11:00", "14:00"]] }))).toMatch(/هم‌پوشانی/);
    expect(hoursProblem(week({ 0: [["8 صبح", "12:00"]] }))).toMatch(/معتبر/);
    expect(hoursProblem(week({ 0: [["24:00", "02:00"]] }))).toMatch(/۲۴:۰۰/);
  });
});

describe("business time on the office calendar (Asia/Tehran)", () => {
  const cal = office();

  it("adds within a day, across days and across the weekend", () => {
    expect(iso(addBusiness(cal, T("2026-11-07T10:00:00"), 4 * HOUR))).toBe(iso(T("2026-11-07T14:00:00")));
    expect(iso(addBusiness(cal, T("2026-11-07T15:00:00"), 4 * HOUR))).toBe(iso(T("2026-11-08T11:00:00")));
    // Wednesday 15:00 + 6 h = 1 h Wednesday + 4 h Thursday (08–12) + 1 h Saturday (Friday is off)
    expect(iso(addBusiness(cal, T("2026-11-11T15:00:00"), 6 * HOUR))).toBe(iso(T("2026-11-14T09:00:00")));
    // a start outside working time counts from the next working instant
    expect(iso(addBusiness(cal, T("2026-11-13T10:00:00"), HOUR))).toBe(iso(T("2026-11-14T09:00:00")));
    expect(iso(addBusiness(cal, T("2026-11-07T05:00:00"), 30 * MINUTE))).toBe(iso(T("2026-11-07T08:30:00")));
    // reaching the target exactly at the end of a shift ends there
    expect(iso(addBusiness(cal, T("2026-11-07T08:00:00"), 8 * HOUR))).toBe(iso(T("2026-11-07T16:00:00")));
    expect(addBusiness(cal, T("2026-11-07T20:00:00"), 0)).toBe(T("2026-11-07T20:00:00"));
  });

  it("measures working time between two instants", () => {
    expect(businessBetween(cal, T("2026-11-07T00:00:00"), T("2026-11-14T00:00:00"))).toBe(44 * HOUR);
    expect(businessBetween(cal, T("2026-11-07T15:00:00"), T("2026-11-08T09:00:00"))).toBe(2 * HOUR);
    expect(businessBetween(cal, T("2026-11-13T00:00:00"), T("2026-11-13T23:59:00"))).toBe(0);
    expect(businessBetween(cal, T("2026-11-08T09:00:00"), T("2026-11-07T15:00:00"))).toBe(0);
    expect(isWorking(cal, T("2026-11-12T11:59:00"))).toBe(true);
    expect(isWorking(cal, T("2026-11-12T12:00:00"))).toBe(false);
    expect(iso(nextWorkingInstant(cal, T("2026-11-12T12:00:00")))).toBe(iso(T("2026-11-14T08:00:00")));
  });

  it("skips holidays and keeps the first half of a half day", () => {
    const h = office([{ date: "2026-11-08" }, { date: "2026-11-09", half_day: true }]);
    // Saturday 15:00 + 4 h: 1 h Saturday, Sunday off, Monday 08–12 (half day) gives 3 h
    expect(iso(addBusiness(h, T("2026-11-07T15:00:00"), 4 * HOUR))).toBe(iso(T("2026-11-09T11:00:00")));
    expect(iso(addBusiness(h, T("2026-11-07T15:00:00"), 6 * HOUR))).toBe(iso(T("2026-11-10T09:00:00")));
    expect(businessBetween(h, T("2026-11-07T00:00:00"), T("2026-11-14T00:00:00"))).toBe(32 * HOUR);
    // a half day of split shifts keeps the first half of the working time, whatever the shifts
    const split = calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["08:00", "11:00"], ["13:00", "18:00"]] }) }, [{ date: "2026-11-07", half_day: true }]);
    expect(shiftsOf(split, "2026-11-07").map(([s, e]) => [iso(s), iso(e)])).toEqual([
      [iso(T("2026-11-07T08:00:00")), iso(T("2026-11-07T11:00:00"))],
      [iso(T("2026-11-07T13:00:00")), iso(T("2026-11-07T14:00:00"))],
    ]);
    // a whole holiday wins over a half day on the same date
    const both = office([{ date: "2026-11-08", half_day: true }, { date: "2026-11-08" }]);
    expect(businessBetween(both, T("2026-11-08T00:00:00"), T("2026-11-09T00:00:00"))).toBe(0);
  });

  it("follows the Iranian official holidays of a year (Nowruz)", () => {
    const nowruz = ["2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24"].map((date) => ({ date }));
    const h = office(nowruz);
    // Friday 1404-12-28 (2026-03-20) 10:00 + 1 h: 1405-01-01…04 are holidays, 1405-01-05 is Wednesday
    expect(iso(addBusiness(h, T("2026-03-20T10:00:00"), HOUR))).toBe(iso(T("2026-03-25T09:00:00")));
  });
});

describe("overnight shifts", () => {
  const night = calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["22:00", "06:00"]] }) });

  it("belong to the day they start on", () => {
    expect(iso(addBusiness(night, T("2026-11-07T23:00:00"), 2 * HOUR))).toBe(iso(T("2026-11-08T01:00:00")));
    // Sunday 05:00 is inside Saturday's shift: 1 h left of it, then the next Saturday night
    expect(iso(addBusiness(night, T("2026-11-08T05:00:00"), 2 * HOUR))).toBe(iso(T("2026-11-14T23:00:00")));
    expect(businessBetween(night, T("2026-11-07T00:00:00"), T("2026-11-09T00:00:00"))).toBe(8 * HOUR);
  });

  it("are removed whole by a holiday on their first day", () => {
    const h = calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["22:00", "06:00"]] }) }, [{ date: "2026-11-07" }]);
    expect(businessBetween(h, T("2026-11-07T00:00:00"), T("2026-11-09T00:00:00"))).toBe(0);
    // a holiday on the next day does not cut the shift that started the night before
    const next = calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["22:00", "06:00"]] }) }, [{ date: "2026-11-08" }]);
    expect(businessBetween(next, T("2026-11-07T00:00:00"), T("2026-11-09T00:00:00"))).toBe(8 * HOUR);
  });

  it("overlapping the next day's shift are counted once", () => {
    const cal = calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["20:00", "06:00"]], 1: [["04:00", "10:00"]] }) });
    // Saturday 20:00 → Sunday 10:00 is one 14-hour stretch
    expect(businessBetween(cal, T("2026-11-07T00:00:00"), T("2026-11-09T00:00:00"))).toBe(14 * HOUR);
    expect(iso(addBusiness(cal, T("2026-11-07T20:00:00"), 12 * HOUR))).toBe(iso(T("2026-11-08T08:00:00")));
  });
});

describe("24 × 7 and degenerate calendars", () => {
  it("without a calendar counts wall-clock time", () => {
    expect(addBusiness(null, 1000, 5000)).toBe(6000);
    expect(businessBetween(null, 1000, 6000)).toBe(5000);
    expect(isWorking(null, 0)).toBe(true);
  });

  it("a 24-hour week equals wall-clock time", () => {
    const full = calendarOf({ timezone: "Asia/Tehran", hours: FULL_HOURS });
    const s = T("2026-11-07T13:17:00");
    expect(addBusiness(full, s, 100 * HOUR)).toBe(s + 100 * HOUR);
    expect(businessBetween(full, s, s + 1000 * HOUR)).toBe(1000 * HOUR);
  });

  it("a week without working time never reaches a target", () => {
    const none = calendarOf({ timezone: "Asia/Tehran", hours: week({}) });
    expect(addBusiness(none, T("2026-11-07T10:00:00"), HOUR)).toBeNull();
    expect(addBusiness(none, T("2026-11-07T10:00:00"), 0)).toBe(T("2026-11-07T10:00:00"));
    expect(businessBetween(none, T("2026-11-07T10:00:00"), T("2026-12-07T10:00:00"))).toBe(0);
    expect(nextWorkingInstant(none, 0)).toBeNull();
  });

  it("a long run of holidays is crossed", () => {
    const days = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 10, 7 + i)).toISOString().slice(0, 10) }));
    const h = office(days);
    expect(iso(addBusiness(h, T("2026-11-07T08:00:00"), HOUR))).toBe(iso(T("2027-01-06T09:00:00")));
  });
});

describe("a zone with clock changes (Europe/Berlin)", () => {
  const berlin = (hours: HoursJson): BusinessCalendar => calendarOf({ timezone: "Europe/Berlin", hours });
  const all = (pair: [string, string]) => Array.from({ length: 7 }, () => [pair]) as HoursJson;

  it("keeps office hours in local time across the change", () => {
    const cal = berlin(all(["08:00", "16:00"]));
    // 2026-03-29: clocks go from 02:00 to 03:00 (CET → CEST)
    expect(iso(addBusiness(cal, Date.parse("2026-03-28T15:00:00+01:00"), 2 * HOUR))).toBe("2026-03-29T07:00:00.000Z");
    expect(businessBetween(cal, Date.parse("2026-03-29T00:00:00+01:00"), Date.parse("2026-03-30T00:00:00+02:00"))).toBe(8 * HOUR);
  });

  it("counts the real length of a night shift on the nights the clocks change", () => {
    const cal = berlin(all(["22:00", "06:00"]));
    const spring = shiftsOf(cal, "2026-03-28");
    expect(spring[0][1] - spring[0][0]).toBe(7 * HOUR);
    const autumn = shiftsOf(cal, "2026-10-24");
    expect(autumn[0][1] - autumn[0][0]).toBe(9 * HOUR);
  });

  it("moves a wall time inside the skipped hour forward", () => {
    const cal = berlin(week({ 1: [["02:30", "04:00"]] }));
    const [[s, e]] = shiftsOf(cal, "2026-03-29");
    expect(iso(s)).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(e)).toBe("2026-03-29T02:00:00.000Z");
  });
});

describe("algebra", () => {
  // a deterministic pseudo-random sequence
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cals: [string, BusinessCalendar][] = [
    ["office", office([{ date: "2026-11-10" }, { date: "2026-11-16", half_day: true }, { date: "2026-12-01" }])],
    ["night", calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["22:00", "06:00"]], 3: [["20:00", "04:00"]], 4: [["02:00", "08:00"]] }) })],
    ["split", calendarOf({ timezone: "Asia/Tehran", hours: week({ 0: [["07:30", "12:00"], ["13:00", "17:15"]], 2: [["09:00", "09:45"]], 5: [["00:00", "24:00"]] }) })],
    ["berlin", calendarOf({ timezone: "Europe/Berlin", hours: Array.from({ length: 7 }, () => [["01:00", "03:30"], ["21:00", "23:00"]]) as HoursJson })],
  ];

  for (const [name, cal] of cals) {
    it(`${name}: between(start, add(start, d)) = d, monotone and additive`, () => {
      const base = Date.parse("2026-03-20T00:00:00Z");
      for (let i = 0; i < 60; i++) {
        const start = base + Math.floor(rnd() * 300 * 24) * 30 * MINUTE + Math.floor(rnd() * 59) * MINUTE;
        const a = Math.floor(rnd() * 40 * 60) * MINUTE;
        const b = Math.floor(rnd() * 40 * 60) * MINUTE;
        const ea = addBusiness(cal, start, a)!;
        const eab = addBusiness(cal, start, a + b)!;
        expect(businessBetween(cal, start, ea)).toBe(a);
        expect(businessBetween(cal, start, eab)).toBe(a + b);
        expect(eab).toBeGreaterThanOrEqual(ea);
        expect(addBusiness(cal, ea, b)).toBe(eab);
        // a split point anywhere: between is additive
        const mid = start + Math.floor(rnd() * 90) * 24 * HOUR;
        const end = mid + Math.floor(rnd() * 90) * 24 * HOUR;
        expect(businessBetween(cal, start, end)).toBe(businessBetween(cal, start, mid) + businessBetween(cal, mid, end));
      }
    });
  }

  it("working intervals are sorted, disjoint and inside the window", () => {
    const cal = cals[1][1];
    const from = T("2026-11-01T00:00:00");
    const to = T("2027-02-01T00:00:00");
    const xs = workingIntervals(cal, from, to);
    expect(xs.length).toBeGreaterThan(20);
    for (let i = 0; i < xs.length; i++) {
      expect(xs[i][0]).toBeGreaterThanOrEqual(from);
      expect(xs[i][1]).toBeLessThanOrEqual(to);
      expect(xs[i][1]).toBeGreaterThan(xs[i][0]);
      if (i) expect(xs[i][0]).toBeGreaterThanOrEqual(xs[i - 1][1]);
    }
  });
});

describe("SLA timers", () => {
  const cal = office();
  const row = (o: Record<string, unknown> = {}) => ({ start_at: new Date(T("2026-11-07T08:00:00")).toISOString(), duration: 8 * 3600, stage: "in_progress", paused_total: 0, ...o });

  it("a running timer: used share, deadline, what is left", () => {
    const t = evaluateTimer(row(), cal, T("2026-11-07T12:00:00"));
    expect(t.percent).toBe(50);
    expect(iso(t.plannedEnd)).toBe(iso(T("2026-11-07T16:00:00")));
    expect(t.remainingMs).toBe(4 * HOUR);
    expect(t.running && !t.paused && !t.done && !t.breached).toBe(true);
    // overnight nothing is used up
    expect(evaluateTimer(row(), cal, T("2026-11-07T23:00:00")).percent).toBe(100);
    const over = evaluateTimer(row(), cal, T("2026-11-08T10:00:00"));
    expect(over.breached).toBe(true);
    expect(over.percent).toBe(125);
    expect(over.remainingMs).toBe(-2 * HOUR);
  });

  it("pauses: an open pause and closed ones are not counted", () => {
    // paused since 10:00 Saturday, looked at Sunday 09:00: 2 h used
    const paused = evaluateTimer(row({ stage: "paused", pause_started_at: new Date(T("2026-11-07T10:00:00")).toISOString() }), cal, T("2026-11-08T09:00:00"));
    expect(paused.paused).toBe(true);
    expect(paused.percent).toBe(25);
    // the deadline if it resumed now: 6 h of working time from Sunday 09:00
    expect(iso(paused.plannedEnd)).toBe(iso(T("2026-11-08T15:00:00")));
    // a closed pause of 3 h moves the deadline by 3 working hours
    const resumed = evaluateTimer(row({ paused_total: 3 * 3600 }), cal, T("2026-11-07T12:00:00"));
    expect(resumed.percent).toBe(12.5);
    expect(iso(resumed.plannedEnd)).toBe(iso(T("2026-11-08T11:00:00")));
    expect(iso(thresholdAt(row({ paused_total: 3 * 3600 }), cal, 50))).toBe(iso(T("2026-11-07T15:00:00")));
  });

  it("a stopped timer keeps what it had at the stop", () => {
    const stopped = evaluateTimer(row({ stage: "achieved", active: false, stop_at: new Date(T("2026-11-07T14:00:00")).toISOString(), planned_end_at: new Date(T("2026-11-07T16:00:00")).toISOString() }), cal, T("2026-12-01T10:00:00"));
    expect(stopped.done).toBe(true);
    expect(stopped.percent).toBe(75);
    expect(stopped.remainingWallMs).toBe(2 * HOUR);
    expect(stopped.breached).toBe(false);
  });

  it("due events: the highest warning reached once, then the breach", () => {
    const levels = warnLevels([90, "50", 75, 50, 0, 120]);
    expect(levels).toEqual([50, 75, 90]);
    expect(warnLevels("۵۰، ۷۵")).toEqual([50, 75]);
    const at = (h: string, o: Record<string, unknown> = {}) => dueEvents(row(o), cal, levels, T(`2026-11-07T${h}`));
    const early = at("09:00:00");
    expect(early.warn).toBeNull();
    expect(iso(early.next)).toBe(iso(T("2026-11-07T12:00:00")));
    // a late job announces only the highest level reached
    const late = at("15:00:00");
    expect(late.warn).toBe(75);
    expect(iso(late.next)).toBe(iso(T("2026-11-07T15:12:00")));
    const announced = at("15:30:00", { warned: 90 });
    expect(announced.warn).toBeNull();
    expect(iso(announced.next)).toBe(iso(T("2026-11-07T16:00:00")));
    const breach = at("16:00:00", { warned: 90 });
    expect(breach.breach).toBe(true);
    expect(breach.next).toBeNull();
    expect(at("17:00:00", { warned: 90, breached: true, stage: "breached" }).breach).toBe(false);
  });

  it("targets per priority or fixed", () => {
    const def = { duration_mode: "priority", durations: { "1": 3600, "2": 7200, "4": 0 }, priority_field: "priority" };
    expect(targetSeconds(def, { priority: "1" })).toBe(3600);
    expect(targetSeconds(def, { priority: "2" })).toBe(7200);
    expect(targetSeconds(def, { priority: "4" })).toBeNull();
    expect(targetSeconds(def, { priority: null })).toBeNull();
    expect(targetSeconds({ duration_mode: "fixed", duration: 600 }, {})).toBe(600);
    expect(durationsProblem({ "1": 60, "2": "x" })).toMatch(/اولویت/);
    expect(durationsProblem([1, 2])).toMatch(/اولویت/);
    expect(durationsProblem({ "1": 60 })).toBeNull();
  });
});
