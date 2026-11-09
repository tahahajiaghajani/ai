// Pure logic of workforce and agent experience: skills and the routing score, utilisation bands, the demand forecast,
// staffing (FTE, Erlang C), labour rules, points/levels/badges and the rule-based coaching notes.
import { describe, expect, it } from "vitest";
import { addDays } from "@shared/jalali";
import {
  agentsForServiceLevel,
  badgesOf,
  coachingNotes,
  countingSkills,
  denseDays,
  erlangC,
  forecastDaily,
  labourIssues,
  levelOf,
  overlaps,
  rankCandidates,
  requiredFte,
  rosterCovers,
  routingScore,
  shiftIntervals,
  skillMatch,
  teamLargeEnough,
  utilBand,
  utilisation,
  type AgentMetrics,
  type RoutingInput,
} from "@shared/workforce/logic";

const H = 3_600_000;

describe("skills and routing", () => {
  it("counts only active, unexpired skills at the level asked", () => {
    const xs = [
      { skill_id: "a", level: 3, verified: true },
      { skill_id: "b", level: 2, expires_at: "2026-01-01" },
      { skill_id: "c", level: 4, status: "retired" },
      { skill_id: "d", level: 1 },
    ];
    expect(countingSkills(xs, "2026-06-01").map((s) => s.skill_id)).toEqual(["a", "d"]);
    expect(countingSkills(xs, "2025-06-01", { minLevel: 2 }).map((s) => s.skill_id)).toEqual(["a", "b"]);
    expect(countingSkills(xs, "2026-06-01", { needsVerified: true }).map((s) => s.skill_id)).toEqual(["a"]);
  });

  it("matches required skills by level ratio, verified skills a little more", () => {
    expect(skillMatch([], [])).toEqual({ match: 1, missing: [] });
    const r = skillMatch([{ skill_id: "net", level: 4 }, { skill_id: "db", level: 2 }], [{ skill_id: "net", level: 2, verified: true }]);
    expect(r.missing).toEqual(["db"]);
    expect(r.match).toBe(0.25);
    expect(skillMatch([{ skill_id: "net", level: 2 }], [{ skill_id: "net", level: 5 }]).match).toBe(0.9);
  });

  const base: RoutingInput = { user_id: "u1", match: 1, presence: "available", on_shift: true, shift_left_minutes: 240, absent: false, open: 0, limit: 10 };

  it("routing score: absent, off-shift, near the end of a shift and at the limit are not eligible", () => {
    const ok = routingScore(base);
    expect(ok.eligible).toBe(true);
    expect(ok.score).toBe(1);
    expect(routingScore({ ...base, absent: true })).toMatchObject({ eligible: false, score: 0 });
    expect(routingScore({ ...base, absent: true }).reasons[0]).toContain("مرخصی");
    expect(routingScore({ ...base, on_shift: false }).reasons).toContain("در شیفت نیست");
    expect(routingScore({ ...base, shift_left_minutes: 30 }).eligible).toBe(false);
    expect(routingScore({ ...base, shift_left_minutes: 30 }, 15).eligible).toBe(true);
    expect(routingScore({ ...base, open: 10 }).eligible).toBe(false);
    expect(routingScore({ ...base, presence: "offline" }).eligible).toBe(false);
    // unknown roster = working hours
    expect(routingScore({ ...base, on_shift: null, shift_left_minutes: null }).eligible).toBe(true);
    // busy people and loaded people score lower
    expect(routingScore({ ...base, presence: "busy" }).score).toBe(0.6);
    expect(routingScore({ ...base, open: 5 }).score).toBe(0.6);
  });

  it("ranks eligible candidates first, then by score and fewer open items", () => {
    const xs = [
      routingScore({ ...base, user_id: "absent", absent: true }),
      routingScore({ ...base, user_id: "loaded", open: 8 }),
      routingScore({ ...base, user_id: "free" }),
      routingScore({ ...base, user_id: "weak", match: 0.5 }),
    ];
    expect(rankCandidates(xs).map((c) => c.user_id)).toEqual(["free", "weak", "loaded", "absent"]);
  });
});

describe("capacity and utilisation", () => {
  it("bands utilisation", () => {
    expect(utilBand(null)).toBe("idle");
    expect(utilBand(5)).toBe("idle");
    expect(utilBand(30)).toBe("optimal");
    expect(utilBand(60)).toBe("high");
    expect(utilBand(84)).toBe("high");
    expect(utilBand(85)).toBe("overloaded");
    expect(utilisation(5, 10)).toBe(50);
    expect(utilisation(5, 0)).toBeNull();
  });
});

describe("demand forecast", () => {
  // Saturday 2026-10-10 … four weeks: Saturday–Wednesday 10, Thursday 4, Friday 0
  const start = "2026-10-10";
  const pattern = [10, 10, 10, 10, 10, 4, 0];
  const history = Array.from({ length: 28 }, (_, i) => ({ day: addDays(start, i), count: pattern[i % 7] }));
  const from = addDays(start, 28);

  it("learns the weekday pattern and back-tests it", () => {
    const f = forecastDaily(history, from, 7, new Set());
    expect(f.points.map((p) => p.predicted)).toEqual([10, 10, 10, 10, 10, 4, 0]);
    expect(f.points[0].lower).toBe(10);
    expect(f.mape).toBe(0);
    expect(f.weekdays[6]).toBe(0);
  });

  it("scales holidays (default to a fifth without observed holidays)", () => {
    const f = forecastDaily(history, from, 7, new Set([addDays(from, 1)]));
    expect(f.points[1]).toMatchObject({ predicted: 2, holiday: true });
    expect(f.holiday_factor).toBe(0.2);
  });

  it("needs three weeks for a back-test and fills missing days", () => {
    expect(forecastDaily(history.slice(-14), from, 3, new Set()).mape).toBeNull();
    expect(denseDays([{ day: "2026-10-11", count: 3 }], "2026-10-10", "2026-10-13")).toEqual([
      { day: "2026-10-10", count: 0 },
      { day: "2026-10-11", count: 3 },
      { day: "2026-10-12", count: 0 },
    ]);
  });
});

describe("staffing", () => {
  it("FTE from volume, handle time, occupancy and shrinkage", () => {
    expect(requiredFte(40, 0.5, 6, 80, 20)).toBe(5.21);
    expect(requiredFte(0, 0.5, 6, 80, 20)).toBe(0);
  });

  it("Erlang C", () => {
    expect(erlangC(2, 3)).toBeCloseTo(0.4444, 3);
    expect(erlangC(5, 5)).toBe(1);
    expect(erlangC(0, 3)).toBe(0);
  });

  it("finds the fewest agents that meet a service level", () => {
    const r = agentsForServiceLevel(100, 180, 20, 80);
    expect(r.service_level).toBeGreaterThanOrEqual(80);
    const a = (100 * 180) / 3600;
    const fewer = r.agents - 1;
    const sl = fewer > a ? 1 - erlangC(a, fewer) * Math.exp(-((fewer - a) * 20) / 180) : 0;
    expect(sl * 100).toBeLessThan(80);
    expect(agentsForServiceLevel(0, 180, 20, 80)).toEqual({ agents: 0, service_level: 100 });
  });
});

describe("rosters and labour rules", () => {
  it("roster validity, overlaps and shift hours", () => {
    expect(rosterCovers({ user_id: "u", group_id: "g", pattern_id: "p", valid_from: "2026-10-01", valid_to: "2026-10-31" }, "2026-10-15")).toBe(true);
    expect(rosterCovers({ user_id: "u", group_id: "g", pattern_id: "p", valid_from: "2026-10-01", valid_to: "2026-10-31" }, "2026-11-01")).toBe(false);
    expect(rosterCovers({ user_id: "u", group_id: "g", pattern_id: "p", valid_from: "2026-10-01" }, "2027-01-01")).toBe(true);
    expect(overlaps(0, 10, 10, 20)).toBe(false);
    expect(overlaps(0, 11, 10, 20)).toBe(true);
    expect(shiftIntervals(null, "2026-10-10")).toEqual([]);
  });

  it("flags weekly hours, short rest between days and Friday work; a lunch break is not a rest period", () => {
    const sat = Date.UTC(2026, 9, 10, 5); // Saturday 2026-10-10 05:00 UTC
    const shifts: { day: string; start: number; end: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const s = sat + i * 24 * H;
      shifts.push({ day: addDays("2026-10-10", i), start: s, end: s + 4 * H }, { day: addDays("2026-10-10", i), start: s + 5 * H, end: s + 10 * H });
    }
    const issues = labourIssues("u", shifts, { weekly_hours_max: 44, min_rest_hours: 11 });
    expect(issues.filter((i) => i.kind === "weekly_hours")).toHaveLength(1);
    expect(issues.filter((i) => i.kind === "rest")).toHaveLength(0);
    // a night shift ending at 05:00 followed by a day shift at 09:00
    const tight = labourIssues("u", [{ day: "2026-10-10", start: sat + 11 * H, end: sat + 24 * H }, { day: "2026-10-11", start: sat + 28 * H, end: sat + 36 * H }], { weekly_hours_max: 44, min_rest_hours: 11 });
    expect(tight.map((i) => i.kind)).toEqual(["rest"]);
    const friday = labourIssues("u", [{ day: "2026-10-16", start: sat + 6 * 24 * H, end: sat + 6 * 24 * H + 4 * H }], { weekly_hours_max: 44, min_rest_hours: 11 });
    expect(friday.map((i) => i.kind)).toEqual(["friday"]);
    expect(labourIssues("u", [{ day: "2026-10-16", start: sat, end: sat + H }], { weekly_hours_max: 44, min_rest_hours: 11, friday_rest: false })).toEqual([]);
  });
});

describe("points, levels and badges", () => {
  it("levels with progress to the next", () => {
    expect(levelOf(0)).toMatchObject({ index: 0, next: 100, progress: 0 });
    expect(levelOf(150)).toMatchObject({ index: 1, next: 300, progress: 25 });
    expect(levelOf(5000)).toMatchObject({ index: 5, next: null, progress: 100 });
  });

  it("badges of a month", () => {
    const none = { resolved_month: 0, within_sla_pct: null, first_contact: 0, knowledge: 0, kudos: 0, csat_pct: null };
    expect(badgesOf(none)).toEqual([]);
    const keys = badgesOf({ resolved_month: 55, within_sla_pct: 100, first_contact: 12, knowledge: 2, kudos: 3, csat_pct: 95 }).map((b) => b.key);
    expect(keys).toEqual(["fifty", "on_time", "first_contact", "author", "thanked", "loved"]);
    expect(badgesOf({ ...none, resolved_month: 25 }).map((b) => b.key)).toEqual(["twenty"]);
  });
});

describe("coaching notes and small teams", () => {
  const m: AgentMetrics = { period: "مهر ۱۴۰۵", resolved: 30, open: 4, median_resolve_hours: 20, within_sla_pct: 80, reassigned_pct: 30, reopened_pct: 10, first_contact_pct: 70, csat_pct: 92, csat_n: 8, knowledge: 0, points: 120 };

  it("strengths first, at most three things to work on, and a privacy line", () => {
    const text = coachingNotes(m, { median_resolve_hours: 10 });
    expect(text).toContain("نقاط قوت");
    expect(text).toContain("رضایت درخواست‌کنندگان");
    expect(text).toContain("صف «در خطر»");
    expect(text).toContain("فقط برای شماست");
    expect(text).toContain("بازگشایی");
    expect(text).not.toContain("راه‌حل‌های تکراری");
    expect(text).not.toContain("میانهٔ تیم");
  });

  it("encourages when nothing needs work", () => {
    const text = coachingNotes({ ...m, within_sla_pct: 97, reassigned_pct: 5, reopened_pct: 1, knowledge: 2 });
    expect(text).toContain("همین روند");
    expect(text).toContain("مقالهٔ دانش منتشر کردید");
  });

  it("hides the numbers of small teams", () => {
    expect(teamLargeEnough(3, 5)).toBe(false);
    expect(teamLargeEnough(5, 5)).toBe(true);
    expect(teamLargeEnough(1, 0)).toBe(true);
  });
});
