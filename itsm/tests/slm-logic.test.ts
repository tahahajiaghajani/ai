// Service level management — the pure logic shared by the server and the screens: lifecycle ↔ the portfolio's status,
// compliance and its status (goal and warning level), Jalali periods, credits, experience measures with small-group
// suppression, XLA scores, the watermelon gap, target recommendations and what-if replays, the breach probability and
// urgency of a running timer, the rule-based review narrative and improvement suggestions, the agreement document and
// the screens' helpers.
import { describe, expect, it } from "vitest";
import {
  addJalaliMonths, agreementDocument, bandOf, breachProbability, compliancePct, complianceStatus, creditPct, csiSuggestions, experienceOf, inForce, lastPeriods, packNarrative,
  parseTiers, percentile, periodOf, recommendHours, simulateBreaches, stateFromStatus, statusFromState, urgencyOf, watermelon, weightedMean, weightsProblem, worstStatus, xlaExplanation, xlaScore,
  improvementScore, type ReviewPack,
} from "@shared/slm/logic";
import { generationProblem, definitionValues, durationsOf } from "@server/modules/slm/definitions";
import { remainingText, valueText, QUEUES } from "../src/ui/modules/slm/model";

describe("lifecycle and the portfolio's status", () => {
  it("maps states to the status and back", () => {
    expect(statusFromState("active")).toBe("active");
    expect(statusFromState("renewal")).toBe("active");
    expect(statusFromState("expired")).toBe("expired");
    expect(statusFromState("withdrawn")).toBe("expired");
    expect(statusFromState("negotiation")).toBe("draft");
    expect(statusFromState("rejected")).toBe("draft");
    expect(stateFromStatus("active")).toBe("active");
    expect(stateFromStatus("draft")).toBeNull();
    expect(inForce("under_review")).toBe(true);
    expect(inForce("enablement")).toBe(false);
  });
});

describe("compliance", () => {
  it("computes the percentage and the status against the goal and the warning level", () => {
    expect(compliancePct(19, 1)).toBe(95);
    expect(compliancePct(0, 0)).toBeNull();
    expect(complianceStatus(null, 95, 97)).toBe("no_data");
    expect(complianceStatus(94.9, 95, 97)).toBe("missed");
    expect(complianceStatus(96, 95, 97)).toBe("at_risk");
    expect(complianceStatus(97, 95, 97)).toBe("met");
    // a warning level at or below the goal is ignored
    expect(complianceStatus(95.5, 95, 90)).toBe("met");
    expect(worstStatus(["met", "at_risk", "no_data"])).toBe("at_risk");
    expect(worstStatus(["met", "missed"])).toBe("missed");
    expect(worstStatus([])).toBe("no_data");
    expect(weightedMean([{ value: 90, weight: 1 }, { value: 100, weight: 3 }, { value: null, weight: 5 }])).toBe(97.5);
  });

  it("uses Jalali months and quarters", () => {
    const p = periodOf("2026-03-25", "month"); // 5 Farvardin 1405
    expect(p.key).toBe("1405-01");
    expect(p.start).toBe("2026-03-21");
    expect(p.end).toBe("2026-04-21");
    const q = periodOf("2026-07-01", "quarter");
    expect(q.key).toBe("1405-Q2");
    const three = lastPeriods("2026-05-10", "month", 3);
    expect(three.map((x) => x.key)).toEqual(["1404-12", "1405-01", "1405-02"]);
    // 31 Farvardin + 6 months = the last day of Mehr (30 days)
    expect(addJalaliMonths("2026-04-20", 6)).toBe("2026-10-22");
    expect(addJalaliMonths("2026-03-21", 1)).toBe("2026-04-21");
  });
});

describe("credits", () => {
  it("applies the lowest tier the value falls under, with the cap", () => {
    const tiers = parseTiers([{ below: 95, pct: 5 }, { below: 90, pct: 10 }, { below: "x", pct: 2 }]);
    expect(tiers).toEqual([{ below: 90, pct: 10 }, { below: 95, pct: 5 }]);
    expect(creditPct(96, tiers)).toBe(0);
    expect(creditPct(93, tiers)).toBe(5);
    expect(creditPct(80, tiers)).toBe(10);
    expect(creditPct(80, tiers, 8)).toBe(8);
    expect(creditPct(null, tiers)).toBe(0);
  });
});

describe("experience", () => {
  it("computes CSAT, NPS, CES, happiness and lost time, and suppresses small groups", () => {
    const answers = [
      { csat: 5, nps: 10, ces: 6, happiness: 10, lost_minutes: 0 },
      { csat: 4, nps: 9, ces: 5, happiness: 9, lost_minutes: 10 },
      { csat: 2, nps: 3, ces: 2, happiness: 2, lost_minutes: 60 },
      { csat: 5, nps: 8, ces: 7, happiness: 8, lost_minutes: 5 },
      { csat: 3, nps: 6, ces: 4, happiness: 6, lost_minutes: 20 },
    ];
    const e = experienceOf(answers, 5);
    expect(e.suppressed).toBe(false);
    expect(e.csat).toBe(60);
    expect(e.nps).toBe(0); // 2 promoters − 2 detractors of 5
    expect(e.ces).toBe(4.8);
    expect(e.happiness).toBe(0);
    expect(e.lost_minutes).toBe(10);
    expect(e.experience_pct).toBe(50);
    const small = experienceOf(answers.slice(0, 3), 5);
    expect(small.suppressed).toBe(true);
    expect(small.csat).toBeNull();
  });

  it("flags a watermelon only when the agreement is green and experience trails by the threshold", () => {
    expect(watermelon(98, 60, 20, 95)).toEqual({ gap: 38, flagged: true });
    expect(watermelon(90, 60, 20, 95).flagged).toBe(false); // the agreement is red anyway
    expect(watermelon(98, 85, 20, 95).flagged).toBe(false);
    expect(watermelon(null, 60, 20, 95).gap).toBeNull();
  });
});

describe("XLA scores", () => {
  const facts = { breaches: 0, reopens: 0, reassignments: 0, first_response_hours: 1, open_hours: 2, customer_comments: 1 };
  it("starts at 100 and loses points by theme and weight", () => {
    expect(xlaScore({}, facts).score).toBe(100);
    const r = xlaScore({}, { ...facts, breaches: 1, reassignments: 2, customer_comments: 4 });
    // reliability 100 − 30 = 70, quality 100 − 30 = 70, effort 100 − 20 = 80 → 0.4·70 + 0.4·70 + 0.2·80 = 72
    expect(r.reliability).toBe(70);
    expect(r.quality).toBe(70);
    expect(r.effort).toBe(80);
    expect(r.score).toBe(72);
    expect(r.band).toBe("good");
    expect(xlaExplanation(r)).toContain("نقض توافق");
  });

  it("takes the survey answer for the requester's effort and flags late first responses", () => {
    const r = xlaScore({ response_hours: 4 }, { ...facts, first_response_hours: 6, survey_happiness: 3 });
    expect(r.survey).toBe(true);
    expect(r.effort).toBe(30);
    expect(r.quality).toBe(80);
    expect(bandOf(49)).toBe("poor");
    expect(weightsProblem({ w_reliability: 40, w_quality: 40, w_effort: 30 })).toContain("۱۰۰");
    expect(weightsProblem({ w_reliability: 50, w_quality: 30, w_effort: 20 })).toBeNull();
  });
});

describe("targets from history", () => {
  it("recommends hours from a percentile and replays proposed hours", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    const samples = { "1": [1800, 3600, 5400, 7200], "2": [3600 * 10] };
    const rec = recommendHours(samples, 75);
    expect(rec["1"]).toEqual({ hours: 1.75, n: 4 });
    expect(rec["3"]).toEqual({ hours: null, n: 0 });
    const sim = simulateBreaches(samples, { "1": 1, "2": 8 });
    expect(sim.total).toBe(5);
    expect(sim.breached).toBe(3);
    expect(sim.pct).toBe(40);
  });

  it("estimates the probability of a breach from finished timers and labels urgency", () => {
    const finished = [...Array.from({ length: 8 }, () => ({ percent: 95, breached: false })), { percent: 140, breached: true }, { percent: 130, breached: true }];
    const at90 = breachProbability(90, finished);
    expect(at90.n).toBe(10);
    expect(at90.p).toBeGreaterThan(0.15);
    expect(at90.p).toBeLessThan(0.35);
    const at120 = breachProbability(120, finished);
    expect(at120.n).toBe(2);
    expect(at120.p).toBeGreaterThan(0.7);
    expect(urgencyOf({ percent: 30, remaining_ms: -1 }).level).toBe("critical");
    expect(urgencyOf({ percent: 80, remaining_ms: 5 * 3_600_000 }).level).toBe("high");
    expect(urgencyOf({ percent: 55, remaining_ms: 5 * 3_600_000, priority: "1" }).level).toBe("high");
    expect(urgencyOf({ percent: 20, remaining_ms: 9 * 3_600_000 }).level).toBe("low");
  });
});

describe("review packs and documents", () => {
  const pack: ReviewPack = {
    title: "بازبینی فصلی", period: { from: "2026-03-21", to: "2026-06-21", label: "بهار ۱۴۰۵" },
    agreement: { id: "a", number: "AGR00001", name: "توافق ایمیل", kind: "sla", service: "ایمیل", customer: "مالی" },
    overall: { value: 91, status: "missed", goal: 95 },
    targets: [
      { id: "t1", name: "حل رخداد", kind: "timer", metric_category: "warranty", goal: 95, value: 88, status: "missed", total: 50, breached: 6, trend: [] },
      { id: "t2", name: "پاسخ نخست", kind: "timer", metric_category: "warranty", goal: 95, value: 99, status: "met", total: 50, breached: 1, trend: [] },
    ],
    breaches: [{ by: "group", label: "شبکه", count: 5 }],
    volume: { created: 120, resolved: 110, limit: 100, over_limit: true },
    incidents: { total: 40, major: 1, open: 3 }, problems: { open: 2 }, changes: { total: 5, failed: 1 },
    experience: { responses: 30, suppressed: false, csat: 70, nps: 10, ces: 5, happiness: 20, lost_minutes: 15, experience_pct: 60 },
    watermelon: { gap: 30, flagged: true }, credits: { count: 1, pct_total: 5 }, improvements: { open: 2, overdue: 1, done: 3 }, generated_at: "2026-06-22T00:00:00Z",
  };

  it("writes the narrative from the pack's numbers only", () => {
    const text = packNarrative(pack);
    expect(text).toContain("توافق «توافق ایمیل»");
    expect(text).toContain("«حل رخداد» ۸۸٪");
    expect(text).toContain("هندوانه‌ای");
    expect(text).toContain("از سقف گذشت");
  });

  it("suggests improvements for missed targets, breaches, experience and overdue actions", () => {
    const s = csiSuggestions(pack);
    expect(s.map((x) => x.title)).toEqual(expect.arrayContaining(["بازگرداندن «حل رخداد» به هدف", "کاهش نقض‌ها در «شبکه»", "پیگیری اقدام‌های عقب‌افتاده"]));
    expect(s.length).toBeLessThanOrEqual(6);
    expect(improvementScore(5, 2)).toBe(25);
  });

  it("builds the Persian document; the customer view leaves internal targets out", () => {
    const a = { name: "توافق ایمیل", number: "AGR00001", kind: "sla", agreement_version: 2, valid_from: "2026-03-21", valid_to: "2027-03-20", compliance_target: "95", review_months: 3, terms: "شرح", exclusions: "قهری" };
    const targets = [
      { name: "حل رخداد", kind: "timer", metric_category: "warranty", goal: "95", p1_hours: "4", p2_hours: "8", customer_facing: true },
      { name: "OLA داخلی", kind: "timer", metric_category: "warranty", goal: "95", customer_facing: false },
    ];
    const full = agreementDocument({ agreement: a, targets, names: { service: "ایمیل", customer: "مالی" } });
    expect(full).toContain("# توافق سطح خدمت: توافق ایمیل");
    expect(full).toContain("نسخه ۲");
    expect(full).toContain("اولویت ۱: ۴ ساعت");
    expect(full).toContain("OLA داخلی");
    expect(full).toContain("## ۷. استثناها");
    const customer = agreementDocument({ agreement: a, targets, names: {}, customerView: true });
    expect(customer).not.toContain("OLA داخلی");
  });
});

describe("timer definitions from targets", () => {
  it("refuses tables without states or priorities and needs hours", () => {
    expect(generationProblem({ table_key: "nope" })).toContain("شناخته نیست");
    expect(generationProblem({ table_key: "incident", timer_target: "resolution" })).toContain("ساعت");
    expect(generationProblem({ table_key: "incident", timer_target: "resolution", p1_hours: 4 })).toBeNull();
    expect(durationsOf({ p1_hours: "4", p2_hours: 0.5, p3_hours: null })).toEqual({ "1": 14400, "2": 1800 });
  });

  it("scopes customer SLAs to the service and customer, OLAs to the provider group", () => {
    const t = { name: "حل", kind: "timer", table_key: "incident", timer_target: "resolution", p2_hours: 8, active: true };
    const sla = definitionValues(t, { kind: "sla", state: "active", service_id: "11111111-1111-4111-8111-111111111111", customer_unit_id: "22222222-2222-4222-8222-222222222222" }, "AGR1");
    expect(sla.type).toBe("sla");
    expect(sla.active).toBe(true);
    expect(sla.service_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(sla.customer_unit_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(sla.retroactive).toBe(true);
    const group = "33333333-3333-4333-8333-333333333333";
    const ola = definitionValues(t, { kind: "ola", state: "draft", service_id: "11111111-1111-4111-8111-111111111111", provider_group_id: group }, "AGR2");
    expect(ola.type).toBe("ola");
    expect(ola.active).toBe(false);
    expect(ola.customer_unit_id).toBeNull();
    expect(ola.service_id).toBeNull();
    expect(JSON.stringify(ola.start_condition)).toContain(group);
    expect(ola.retroactive).toBe(false);
  });
});

describe("screen helpers", () => {
  it("formats values and remaining times in Persian", () => {
    expect(valueText("timer", 95.26)).toBe("۹۵.۳٪");
    expect(valueText("experience", 72)).toBe("۷۲");
    expect(valueText("timer", null)).toBe("—");
    expect(remainingText(90 * 60_000)).toBe("۱ ساعت و ۳۰ دقیقه مانده");
    expect(remainingText(-26 * 3_600_000)).toBe("۱ روز و ۲ ساعت گذشته");
    expect(QUEUES.map((q) => q.key)).toEqual(["in_force", "risk", "pipeline", "reviews"]);
  });
});
