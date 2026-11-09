// Pure logic of availability, capacity and continuity: availability on agreed hours (overlaps, degradations, planned
// outages, failures, MTBF/MTRS, budgets), composite availability, Jalali periods, capacity status and exhaustion,
// the BIA matrix and its proposed RTO, exercise outcomes and step timings; and the screens' helpers.
import { describe, expect, it } from "vitest";
import {
  addSample, availabilityOf, biaProblem, bucketWorst, capacityStatus, cleanImpacts, compositeAvailability, exerciseOutcome, exhaustionAt, monthlyBudgetMinutes,
  outageWeight, periodOf, proposedRto, recoveryFromSteps, stepDelays, stepLog,
} from "@shared/continuity/logic";
import { calendarOf, DEFAULT_HOURS } from "@shared/sla/calendar";
import { availabilityText, availabilityTone, matrixSummary, minutesText, secondsText, setCell, stepProgress } from "../src/ui/modules/continuity/model";

const H = 3600_000;
const D = 86_400_000;
const T0 = Date.parse("2026-11-01T00:00:00Z");
const base = { from: T0, to: T0 + 30 * D, now: T0 + 40 * D, cal: null, excludePlanned: true, degradationWeight: 50 };

describe("availability", () => {
  it("counts outages whole, degradations by impact, planned ones only when asked, overlaps once", () => {
    const outages = [
      { begin_at: new Date(T0 + D).toISOString(), end_at: new Date(T0 + D + H).toISOString(), outage_type: "outage", state: "ended" },
      { begin_at: new Date(T0 + D + 30 * 60_000).toISOString(), end_at: new Date(T0 + D + 90 * 60_000).toISOString(), outage_type: "outage", state: "validated" },
      { begin_at: new Date(T0 + 2 * D).toISOString(), end_at: new Date(T0 + 2 * D + 2 * H).toISOString(), outage_type: "degradation", state: "ended" },
      { begin_at: new Date(T0 + 3 * D).toISOString(), end_at: new Date(T0 + 3 * D + 4 * H).toISOString(), outage_type: "planned", state: "ended" },
      { begin_at: new Date(T0 + 4 * D).toISOString(), end_at: new Date(T0 + 4 * D + 9 * H).toISOString(), outage_type: "outage", state: "proposed" },
    ];
    const a = availabilityOf({ ...base, outages, target: 99.5 });
    // 90 min (overlap merged) + 2 h × 50 % = 150 min of downtime over 30 days
    expect(a.downtime_ms).toBe(150 * 60_000);
    expect(a.failures).toBe(3);
    expect(a.availability).toBeCloseTo(100 - (150 / (30 * 24 * 60)) * 100, 3);
    expect(a.met).toBe(true);
    expect(a.budget_ms).toBe(Math.round(30 * D * 0.005));
    expect(a.mtrs_ms).toBe(Math.round((90 + 120) * 60_000 / 3));
    const withPlanned = availabilityOf({ ...base, outages, excludePlanned: false });
    expect(withPlanned.downtime_ms).toBe(150 * 60_000 + 4 * H);
    expect(outageWeight({ begin_at: null, end_at: null, outage_type: "degradation", impact_pct: "20" }, true, 50)).toBe(0.2);
    expect(outageWeight({ begin_at: null, end_at: null, outage_type: "outage", excluded: true }, true, 50)).toBeNull();
  });

  it("counts only agreed hours on a working calendar, and an ongoing outage until now", () => {
    const cal = calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, []);
    // Friday 2026-11-06 is not a working day: an outage on it costs nothing
    const friday = Date.parse("2026-11-06T06:00:00Z");
    const a = availabilityOf({ ...base, cal, outages: [{ begin_at: new Date(friday).toISOString(), end_at: new Date(friday + 3 * H).toISOString(), outage_type: "outage", state: "ended" }] });
    expect(a.downtime_ms).toBe(0);
    expect(a.availability).toBe(100);
    const now = T0 + 2 * D;
    const ongoing = availabilityOf({ ...base, now, outages: [{ begin_at: new Date(T0 + D).toISOString(), end_at: null, outage_type: "outage", state: "ongoing" }] });
    expect(ongoing.downtime_ms).toBe(D);
    expect(ongoing.agreed_ms).toBe(2 * D);
    expect(ongoing.availability).toBe(50);
  });

  it("composes serial and redundant components, and gives monthly budgets", () => {
    expect(compositeAvailability({ serial: [{ a: 99.9 }, { a: 99.9 }] })).toBeCloseTo(99.8001, 4);
    expect(compositeAvailability({ parallel: [{ a: 99 }, { a: 99 }] })).toBeCloseTo(99.99, 4);
    expect(compositeAvailability({ serial: [{ a: 99.95 }, { parallel: [{ a: 99 }, { a: 99 }] }] })).toBeCloseTo(99.94, 2);
    expect(monthlyBudgetMinutes(99.9)).toBeCloseTo(43.2, 1);
  });

  it("gives Jalali months, quarters and years in the organisation's zone", () => {
    const now = Date.parse("2026-11-09T12:00:00Z"); // 18 Aban 1405
    const m = periodOf("month", 0, now, "Asia/Tehran");
    expect(m.label).toContain("آبان");
    expect(new Date(m.from).toISOString()).toBe("2026-10-22T20:30:00.000Z");
    const prev = periodOf("month", -1, now, "Asia/Tehran");
    expect(prev.to).toBe(m.from);
    expect(periodOf("year", 0, now, "Asia/Tehran").label).toContain("۱۴۰۵");
  });
});

describe("capacity", () => {
  it("rates utilisation against thresholds and finds the time to exhaustion", () => {
    expect(capacityStatus(85, 100)).toEqual({ pct: 85, status: "warning" });
    expect(capacityStatus(95, 100, 80, 90).status).toBe("critical");
    expect(capacityStatus(null, 100).status).toBe("unknown");
    const t = Date.parse("2026-11-01T00:00:00Z");
    let samples: { at: number; v: number }[] = [];
    for (let i = 0; i < 5; i++) samples = addSample(samples, t + i * D, 50 + i * 10);
    const at = exhaustionAt(samples, 100);
    expect(at).not.toBeNull();
    expect(Math.abs(at! - (t + 5 * D))).toBeLessThan(H);
    expect(exhaustionAt(samples.map((s) => ({ ...s, v: 50 })), 100)).toBeNull();
    expect(exhaustionAt(samples.slice(0, 2), 100)).toBeNull();
  });
});

describe("business impact analysis and exercises", () => {
  it("cleans the matrix, carries the worst rating forward and proposes the RTO", () => {
    const m = cleanImpacts({ financial: { h1: 1, h4: 2, d1: 3, bogus: 4 }, operational: { h1: 2, h4: 9 }, unknown: { h1: 4 } });
    expect(m).toEqual({ financial: { h1: 1, h4: 2, d1: 3 }, operational: { h1: 2, h4: 4 } });
    expect(bucketWorst(m)).toEqual([2, 4, 4, 4, 4]);
    expect(proposedRto(m, 3)).toBe(4 * 3600);
    expect(proposedRto(m, 5)).toBeNull();
    expect(biaProblem({ rto: 8 * 3600, mtpd: 4 * 3600 })).toContain("MTPD");
    expect(biaProblem({ rto: 3600, rpo: 1800, mtpd: 4 * 3600 })).toBeNull();
  });

  it("judges RTO/RPO and times the steps", () => {
    expect(exerciseOutcome({ rto_target: 3600, actual_recovery: 3000, rpo_target: 600, actual_data_loss: 900 })).toEqual({ rto_met: true, rpo_met: false });
    expect(exerciseOutcome({ rto_target: 3600 })).toEqual({ rto_met: false, rpo_met: true });
    const log = stepLog([{ seq: 2, title: "ب", rto_offset_minutes: 60 }, { seq: 1, title: "الف", rto_offset_minutes: 15 }]);
    expect(log.map((s) => s.seq)).toEqual([1, 2]);
    const start = "2026-11-09T08:00:00.000Z";
    log[0].done_at = "2026-11-09T08:20:00.000Z";
    log[1].done_at = "2026-11-09T08:50:00.000Z";
    expect(stepDelays(log, start)).toEqual([{ seq: 1, actual_min: 20, late_min: 5 }, { seq: 2, actual_min: 50, late_min: -10 }]);
    expect(recoveryFromSteps(log, start)).toBe(50 * 60);
    expect(stepProgress(log, start, Date.parse("2026-11-09T09:00:00Z"))).toMatchObject({ done: 2, total: 2, late: 1, next: null, elapsed_min: 60 });
  });
});

describe("screens", () => {
  it("formats availability, budgets and durations in Persian", () => {
    expect(availabilityText(99.95)).toBe("۹۹٫۹۵٪");
    expect(availabilityText(null)).toBe("—");
    expect(availabilityTone(99.9, 99.5)).toBe("good");
    expect(availabilityTone(99.2, 99.5)).toBe("warn");
    expect(availabilityTone(98, 99.5)).toBe("bad");
    expect(minutesText(43 * 60_000)).toBe("۴۳ دقیقه");
    expect(minutesText(125 * 60_000)).toBe("۲ ساعت و ۵ دقیقه");
    expect(secondsText(4 * 3600)).toBe("۴ ساعت");
    const m = setCell({}, "financial", "h4", 3);
    expect(matrixSummary(m, 3)).toEqual({ worst: [0, 3, 3, 3, 3], rto: 4 * 3600 });
    expect(setCell(m, "financial", "h4", null)).toEqual({ financial: {} });
  });
});
