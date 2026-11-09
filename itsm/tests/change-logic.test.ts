// Pure logic of change enablement (src/shared/change/logic.ts): lifecycles of the models, what each state requires and
// locks, the risk engine, Jalali window recurrences, conflict detection, free slots, notice, CAB / PIR requirements,
// readiness, success scores and the small helpers.
import { describe, expect, it } from "vitest";
import {
  agendaOrder, answerOption, applicableQuestions, bandOf, businessDaysBetween, cabRequired, checklistProgress, computeRisk, conflictState, detectConflicts, explainRisk, findSlots,
  humanSpan, leadDaysFor, lifecycleOf, lifecycleProblem, lifecycleSteps, localParts, lockdownApplies, lockedIn, missingFor, nextMeeting, nextState, occurrences, optionsOf, pirReasons,
  readiness, requiredFor, shiftJalaliMonths, subtract, successScore, windowApplies, type RiskQuestion, type WindowLike,
} from "@shared/change/logic";
import { calendarOf, DEFAULT_HOURS, localInstant } from "@shared/sla/calendar";
import { fromJalali, weekday } from "@shared/jalali";
import { CHANGE_CONFIG_DEFAULTS } from "@shared/tables/change";
import { levelOutcome, needed } from "@shared/sla/approvals";
import { approvalRules, CAB_RULE_NAME } from "@server/modules/change/seed";

const TZ = "Asia/Tehran";
const H = 3_600_000;
const at = (date: string, hh = 0, mm = 0) => localInstant(date, hh * 60 + mm, TZ);
const iso = (ms: number) => new Date(ms).toISOString();

describe("lifecycles", () => {
  it("each type has its reference lifecycle; a model's states are kept in order with the fixed states", () => {
    expect(lifecycleOf(null, "standard")).toEqual(["new", "scheduled", "implement", "review", "closed", "canceled"]);
    expect(lifecycleOf(null, "emergency")).toEqual(["new", "authorize", "implement", "review", "closed", "canceled"]);
    expect(lifecycleOf(null, "latent")).toEqual(["new", "review", "closed", "canceled"]);
    expect(lifecycleOf(["implement", "assess", "bogus"], "normal")).toEqual(["new", "assess", "implement", "closed", "canceled"]);
  });

  it("only moves forward to the next state of the lifecycle; back and cancel are allowed (not after implementation)", () => {
    const normal = lifecycleOf(null, "normal");
    expect(nextState(normal, "new")).toBe("assess");
    expect(nextState(normal, "authorize")).toBe("scheduled");
    expect(lifecycleProblem(normal, "new", "authorize")).toContain("ارزیابی");
    expect(lifecycleProblem(normal, "new", "assess")).toBeNull();
    expect(lifecycleProblem(normal, "scheduled", "assess")).toBeNull();
    expect(lifecycleProblem(normal, "implement", "canceled")).toBeNull();
    expect(lifecycleProblem(normal, "review", "canceled")).toContain("لغو");
    const emergency = lifecycleOf(null, "emergency");
    expect(lifecycleProblem(emergency, "authorize", "implement")).toBeNull();
    expect(lifecycleProblem(emergency, "new", "scheduled")).toContain("در مدل");
  });

  it("steps for the lifecycle bar", () => {
    const steps = lifecycleSteps(lifecycleOf(null, "normal"), "scheduled");
    expect(steps.map((s) => s.status)).toEqual(["done", "done", "done", "current", "todo", "todo", "todo"]);
    expect(lifecycleSteps(lifecycleOf(null, "normal"), "canceled").every((s) => s.status === "todo")).toBe(true);
  });
});

describe("requirements and locks", () => {
  it("what each state requires; emergency documentation moves to review and closing", () => {
    expect(requiredFor("authorize", null, "normal")).toContain("backout_plan");
    const emergency = requiredFor("authorize", null, "emergency");
    expect(emergency).not.toContain("implementation_plan");
    expect(requiredFor("review", null, "emergency")).toEqual(expect.arrayContaining(["implementation_plan", "planned_start", "close_code"]));
    expect(requiredFor("review", null, "latent")).toContain("justification");
    expect(requiredFor("scheduled", { requirements: { scheduled: ["short_description", "bad name"] } }, "normal")).toEqual(["short_description"]);
    expect(missingFor("closed", { close_code: "successful", close_notes: " " }, null)).toEqual([]);
    expect(missingFor("closed", { close_code: "successful", close_notes: "" }, null)).toEqual(["close_notes"]);
  });

  it("locks accumulate along the lifecycle, except documentation a model defers", () => {
    expect(lockedIn("new", null)).toEqual([]);
    expect(lockedIn("scheduled", null)).toEqual(["type", "model_id", "template_id"]);
    const impl = lockedIn("implement", null, "normal");
    expect(impl).toEqual(expect.arrayContaining(["type", "planned_start", "implementation_plan"]));
    const em = lockedIn("implement", null, "emergency");
    expect(em).toContain("affected_cis");
    expect(em).not.toContain("implementation_plan");
    expect(lockedIn("implement", { docs_deferred: false }, "emergency")).toContain("implementation_plan");
    expect(lockedIn("review", { locks: { review: ["lessons"] } })).toContain("lessons");
  });
});

const Q = (id: string, kind: RiskQuestion["kind"], options: RiskQuestion["options"], weight = 1, extra: Partial<RiskQuestion> = {}): RiskQuestion => ({ id, question: `پرسش ${id}`, kind, options, weight, ...extra });
const bands = { risk_moderate_from: 26, risk_high_from: 51, risk_very_high_from: 76, questionnaire_weight: 60 };

describe("risk engine", () => {
  it("options and answers: yes/no defaults, number ranges, Persian digits", () => {
    expect(optionsOf({ kind: "yes_no", options: [] }).map((o) => o.score)).toEqual([10, 0]);
    const num = Q("n", "number", [{ value: "a", label: "تا ۳۰", score: 2, max: 30 }, { value: "b", label: "بیشتر", score: 9 }]);
    expect(answerOption(num, "۲۵")?.value).toBe("a");
    expect(answerOption(num, 400)?.value).toBe("b");
    expect(answerOption(num, "")).toBeNull();
  });

  it("applicable questions follow the type and the condition", () => {
    const qs = [Q("a", "yes_no", [], 1, { change_types: ["emergency"] }), Q("b", "yes_no", [], 1, { condition: { f: "outage_expected", op: "eq", v: true } }), Q("c", "yes_no", [], 1, { active: false })];
    expect(applicableQuestions(qs, { type: "normal" }, () => false).map((q) => q.id)).toEqual([]);
    expect(applicableQuestions(qs, { type: "emergency" }, () => true).map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("combines the questionnaire with the profile under the bands", () => {
    const qs = [Q("q1", "choice", [{ value: "x", label: "کم", score: 0 }, { value: "y", label: "زیاد", score: 10 }], 2), Q("q2", "yes_no", [], 1)];
    const quiet = { type: "standard", impact: "3", backout_plan: "بازگشت", backout_tested: true, implementation_plan: "x", test_plan: "y", ci_id: "c1" };
    const low = computeRisk({ change: quiet, questions: qs, answers: { q1: "x", q2: "no" }, teamScore: 100, bands });
    expect(low.questionnaire.score).toBe(0);
    expect(low.level).toBe("low");
    const loud = { type: "emergency", impact: "1", in_blackout: true, outage_expected: true, outage_minutes: 120, conflict_count: 3 };
    const high = computeRisk({ change: loud, questions: qs, answers: { q1: "y", q2: "yes" }, teamScore: 20, bands });
    expect(high.questionnaire.score).toBe(100);
    expect(["high", "very_high"]).toContain(high.level);
    const unanswered = computeRisk({ change: quiet, questions: qs, answers: {}, bands });
    expect(unanswered.questionnaire.score).toBeNull();
    expect(unanswered.questionnaire.missing.length).toBe(2);
    expect(unanswered.score).toBe(unanswered.profile);
    expect(explainRisk(high)).toContain("عامل‌های اثرگذار");
    expect(explainRisk(unanswered)).toContain("هنوز پر نشده");
    expect(explainRisk(low, { manual: { level: "high", reason: "دلیل" } })).toContain("دلیل");
  });

  it("a questionnaire answered in part counts its unanswered mandatory questions at their worst", () => {
    const qs = [Q("q1", "choice", [{ value: "x", label: "کم", score: 0 }, { value: "y", label: "زیاد", score: 10 }], 2), Q("q2", "yes_no", [], 1), Q("q3", "choice", [{ value: "a", label: "الف", score: 2 }, { value: "b", label: "ب", score: 7 }], 1)];
    const change = { type: "normal", impact: "1", outage_expected: true, outage_minutes: 120 };
    const none = computeRisk({ change, questions: qs, answers: {}, bands });
    const best = computeRisk({ change, questions: qs, answers: { q1: "x" }, bands });
    // q2 (yes/no: worst 10) and q3 (worst 7) count at their worst: (0·2 + 10·1 + 7·1) / (10·4)
    expect(best.questionnaire.score).toBe(43);
    expect(best.questionnaire.missing.length).toBe(2);
    expect(best.score).toBeGreaterThan(computeRisk({ change, questions: qs, answers: { q1: "x", q2: "no", q3: "a" }, bands }).score);
    expect(none.questionnaire.score).toBeNull();
    expect(explainRisk(best)).toContain("بدترین پاسخ");
    // a question that is not mandatory does not count when unanswered
    const optional = computeRisk({ change, questions: [qs[0], { ...qs[1], mandatory: false }], answers: { q1: "x" }, bands });
    expect(optional.questionnaire.score).toBe(0);
  });

  it("bands", () => {
    expect([0, 25, 26, 50, 51, 75, 76, 100].map((s) => bandOf(s, bands))).toEqual(["low", "low", "moderate", "moderate", "high", "high", "very_high", "very_high"]);
  });
});

describe("windows on the Jalali calendar", () => {
  const w = (x: Partial<WindowLike>): WindowLike => ({ id: "w", name: "پنجره", kind: "maintenance", start_at: iso(at("2026-03-26", 22)), end_at: iso(at("2026-03-27", 4)), ...x });

  it("weekly on the chosen weekdays, at the first occurrence's local time", () => {
    const thu = "2026-03-26"; // a Thursday
    expect(weekday(thu)).toBe(5);
    const occ = occurrences(w({ recurrence: "weekly", weekdays: ["5"] }), at("2026-04-01"), at("2026-04-30"), TZ);
    expect(occ.length).toBe(4);
    for (const o of occ) {
      expect(weekday(localParts(o.start, TZ).date)).toBe(5);
      expect(localParts(o.start, TZ).minutes).toBe(22 * 60);
      expect(o.end - o.start).toBe(6 * H);
    }
  });

  it("monthly on the same Jalali day, the last day of each month, yearly on the same Jalali date", () => {
    const first = fromJalali(1405, 1, 15);
    const monthly = occurrences(w({ recurrence: "monthly", start_at: iso(at(first, 1)), end_at: iso(at(first, 3)) }), at(first), at(fromJalali(1405, 6, 30)), TZ);
    expect(monthly.length).toBe(6);
    const last = occurrences(w({ recurrence: "monthly_last", start_at: iso(at(fromJalali(1405, 1, 31), 20)), end_at: iso(at(fromJalali(1405, 1, 31), 23)) }), at(fromJalali(1405, 1, 1)), at(fromJalali(1405, 12, 1)), TZ);
    expect(last.map((o) => localParts(o.start, TZ).date)).toContain(fromJalali(1405, 7, 30));
    const nowruz = occurrences(w({ kind: "freeze", recurrence: "yearly", start_at: iso(at(fromJalali(1404, 1, 1))), end_at: iso(at(fromJalali(1404, 1, 14))) }), at(fromJalali(1405, 1, 5)), at(fromJalali(1405, 1, 6)), TZ);
    expect(nowruz.length).toBe(1);
    expect(localParts(nowruz[0].start, TZ).date).toBe(fromJalali(1405, 1, 1));
  });

  it("monthly and yearly recurrences are month-end aware and keep their end in calendar terms", () => {
    // 1403 and 1408 are leap years (30 Esfand), 1404–1407 common
    expect(shiftJalaliMonths(fromJalali(1405, 6, 31), 1)).toBe(fromJalali(1405, 7, 30));
    expect(shiftJalaliMonths(fromJalali(1403, 12, 30), 12)).toBe(fromJalali(1404, 12, 29));
    expect(shiftJalaliMonths(fromJalali(1407, 12, 29), 12)).toBe(fromJalali(1408, 12, 30));
    expect(shiftJalaliMonths(fromJalali(1405, 1, 15), -2)).toBe(fromJalali(1404, 11, 15));
    // a yearly freeze from 25 Esfand to 1 Farvardin ends on 1 Farvardin in a leap year too (a day longer)
    const nowruz = w({ kind: "freeze", recurrence: "yearly", start_at: iso(at(fromJalali(1404, 12, 25))), end_at: iso(at(fromJalali(1405, 1, 1))) });
    const leap = occurrences(nowruz, at(fromJalali(1408, 12, 20)), at(fromJalali(1409, 1, 10)), TZ);
    expect(leap.map((o) => [localParts(o.start, TZ).date, localParts(o.end, TZ).date])).toEqual([[fromJalali(1408, 12, 25), fromJalali(1409, 1, 1)]]);
    const common = occurrences(nowruz, at(fromJalali(1405, 12, 20)), at(fromJalali(1406, 1, 10)), TZ);
    expect(common.map((o) => [localParts(o.start, TZ).date, localParts(o.end, TZ).date])).toEqual([[fromJalali(1405, 12, 25), fromJalali(1406, 1, 1)]]);
    expect(leap[0].end - leap[0].start).toBe(common[0].end - common[0].start + 24 * H);
    // a monthly window of the 31st meets on the 30th of a 30-day month (not skipped)
    const m31 = occurrences(w({ recurrence: "monthly", start_at: iso(at(fromJalali(1405, 6, 31), 22)), end_at: iso(at(fromJalali(1405, 6, 31), 23)) }), at(fromJalali(1405, 7, 1)), at(fromJalali(1405, 9, 1)), TZ);
    expect(m31.map((o) => localParts(o.start, TZ).date)).toEqual([fromJalali(1405, 7, 30), fromJalali(1405, 8, 30)]);
    // a yearly window of 30 Esfand (a leap year) meets on 29 Esfand of a common one
    const last = occurrences(w({ recurrence: "yearly", start_at: iso(at(fromJalali(1403, 12, 30), 8)), end_at: iso(at(fromJalali(1403, 12, 30), 12)) }), at(fromJalali(1404, 12, 1)), at(fromJalali(1405, 1, 5)), TZ);
    expect(last.map((o) => localParts(o.start, TZ).date)).toEqual([fromJalali(1404, 12, 29)]);
    expect(last[0].end - last[0].start).toBe(4 * H);
  });

  it("a month-end end stays on the last day only for occurrences that start at a month's end", () => {
    // a blackout every month on the 29th, 20:00–23:00, created on 29 Esfand 1404 (the last day of a 29-day Esfand):
    // three hours on the 29th of every month, never until the 31st
    const blackout = w({ kind: "blackout", recurrence: "monthly", start_at: iso(at(fromJalali(1404, 12, 29), 20)), end_at: iso(at(fromJalali(1404, 12, 29), 23)) });
    const spring = occurrences(blackout, at(fromJalali(1405, 1, 1)), at(fromJalali(1405, 3, 1)), TZ);
    expect(spring.map((o) => [localParts(o.start, TZ).date, localParts(o.end, TZ).date])).toEqual([
      [fromJalali(1405, 1, 29), fromJalali(1405, 1, 29)],
      [fromJalali(1405, 2, 29), fromJalali(1405, 2, 29)],
    ]);
    for (const o of spring) expect(o.end - o.start).toBe(3 * H);
    // nothing on the 30th or 31st of a 31-day month
    expect(occurrences(blackout, at(fromJalali(1405, 1, 30)), at(fromJalali(1405, 2, 1)), TZ)).toEqual([]);
  });

  it("an occurrence longer than the first (a month-end window in a longer month) is found by a range at its end", () => {
    // a monthly freeze from 25 Mehr 12:00 to 1 Aban 12:00 (six days) runs from 25 Farvardin to 1 Ordibehesht (seven):
    // a change on 1 Ordibehesht 08:00–10:00 falls inside it
    const freeze = w({ kind: "freeze", recurrence: "monthly", start_at: iso(at(fromJalali(1404, 7, 25), 12)), end_at: iso(at(fromJalali(1404, 8, 1), 12)) });
    const hit = occurrences(freeze, at(fromJalali(1405, 2, 1), 8), at(fromJalali(1405, 2, 1), 10), TZ);
    expect(hit.map((o) => [localParts(o.start, TZ).date, localParts(o.end, TZ).date])).toEqual([[fromJalali(1405, 1, 25), fromJalali(1405, 2, 1)]]);
  });

  it("an occurrence that started before the range still counts; until stops a recurrence; inactive windows have none", () => {
    const daily = w({ recurrence: "daily", start_at: iso(at("2026-04-01", 23)), end_at: iso(at("2026-04-02", 2)), until: "2026-04-03" });
    const occ = occurrences(daily, at("2026-04-02", 1), at("2026-04-10"), TZ);
    expect(occ.length).toBe(3);
    expect(occurrences({ ...daily, active: false }, at("2026-04-02"), at("2026-04-10"), TZ)).toEqual([]);
  });

  it("which changes a window applies to", () => {
    const blackout = w({ kind: "blackout", cis: ["ci1"] });
    expect(windowApplies(blackout, { type: "normal", affected_cis: ["ci1"] })).toBe(true);
    expect(windowApplies(blackout, { type: "normal", affected_cis: ["ci2"] })).toBe(false);
    expect(windowApplies(blackout, { type: "emergency", affected_cis: ["ci1"] })).toBe(false);
    expect(windowApplies({ ...blackout, exempt_emergency: false }, { type: "emergency", affected_cis: ["ci1"] })).toBe(true);
    expect(windowApplies(w({ kind: "freeze", change_types: ["normal"] }), { type: "standard" })).toBe(false);
    expect(windowApplies(w({ kind: "freeze", scope_condition: { f: "category", op: "eq", v: "network" } }), { type: "normal" }, () => true)).toBe(true);
  });
});

describe("conflicts", () => {
  const base = { id: "c", number: "CHG1", type: "normal", state: "assess", planned_start: iso(at("2026-05-02", 10)), planned_end: iso(at("2026-05-02", 12)), affected_cis: ["ci1"], service_id: "s1", assigned_to: "u1" };
  const other = (x: Record<string, unknown>) => ({ id: "o", number: "CHG2", type: "normal", state: "scheduled", planned_start: iso(at("2026-05-02", 11)), planned_end: iso(at("2026-05-02", 13)), ...x });

  it("the same CI wins over the same service; a dependent CI only when nothing else is shared; the implementer twice", () => {
    const sameCi = detectConflicts({ change: base, others: [other({ ci_id: "ci1", service_id: "s1", assigned_to: "u1" })], occurrences: [] });
    expect(sameCi.map((c) => c.kind).sort()).toEqual(["assignee_busy", "same_ci"]);
    expect(sameCi.find((c) => c.kind === "same_ci")!.overlap_start).toBe(at("2026-05-02", 11));
    const sameService = detectConflicts({ change: base, others: [other({ service_id: "s1" })], occurrences: [] });
    expect(sameService.map((c) => c.kind)).toEqual(["same_service"]);
    const related = detectConflicts({ change: base, others: [other({ affected_cis: ["ci9"] })], occurrences: [], related: new Map([["ci1", ["ci9"]]]) });
    expect(related.map((c) => c.kind)).toEqual(["related_ci"]);
    expect(detectConflicts({ change: base, others: [other({ ci_id: "ci1", state: "new" })], occurrences: [] })).toEqual([]);
    expect(detectConflicts({ change: base, others: [other({ ci_id: "ci1", planned_start: base.planned_end, planned_end: iso(at("2026-05-02", 14)) })], occurrences: [] })).toEqual([]);
    expect(detectConflicts({ change: { ...base, exclude_conflicts: true }, others: [other({ ci_id: "ci1" })], occurrences: [] })).toEqual([]);
  });

  it("blackouts and freezes that apply, maintenance windows that do not contain the change, lockdowns", () => {
    const occ = (kind: string, s: number, e: number, applies = true, scoped = false) => ({ window_id: kind, name: kind, kind, enforcement: "block", start: s, end: e, applies, scoped });
    const found = detectConflicts({
      change: base,
      others: [],
      occurrences: [occ("blackout", at("2026-05-02", 9), at("2026-05-02", 11)), occ("freeze", at("2026-05-02", 0), at("2026-05-03"), false), occ("maintenance", at("2026-05-02", 22), at("2026-05-03", 4), true, true)],
      lockdowns: [{ id: "l", title: "قرنطینه", starts_at: iso(at("2026-05-01")), ends_at: null, applies: true }],
      tzDate: (ms) => localParts(ms, TZ).date,
    });
    expect(found.map((c) => c.kind).sort()).toEqual(["blackout", "lockdown", "outside_window"]);
    expect(found.find((c) => c.kind === "blackout")!.key).toBe("blackout:blackout:2026-05-02");
    const inside = detectConflicts({ change: base, others: [], occurrences: [occ("maintenance", at("2026-05-02", 9), at("2026-05-02", 13), true, true)] });
    expect(inside).toEqual([]);
  });

  it("a maintenance window the change is bound to counts wherever its occurrences fall; an excluded change is still seen", () => {
    const weekly = { id: "w1", name: "پنجرهٔ هفتگی", scoped: false, applies: true };
    // chosen, but no occurrence within a day of the change: still outside it
    const far = detectConflicts({ change: { ...base, maintenance_window_id: "w1" }, others: [], occurrences: [], maintenanceWindows: [weekly] });
    expect(far.map((c) => c.kind)).toEqual(["outside_window"]);
    expect(far[0].window_id).toBe("w1");
    expect(far[0].summary).toContain("پنجرهٔ هفتگی");
    // not chosen and not scoped: it does not bind the change
    expect(detectConflicts({ change: base, others: [], occurrences: [], maintenanceWindows: [weekly] })).toEqual([]);
    // a scoped window that applies binds it too; one that does not apply does not
    expect(detectConflicts({ change: base, others: [], occurrences: [], maintenanceWindows: [{ ...weekly, scoped: true }] }).map((c) => c.kind)).toEqual(["outside_window"]);
    expect(detectConflicts({ change: base, others: [], occurrences: [], maintenanceWindows: [{ ...weekly, scoped: true, applies: false }] })).toEqual([]);
    // the other change left out of detection keeps none of its own conflicts, but this one still sees it
    expect(detectConflicts({ change: base, others: [other({ ci_id: "ci1", exclude_conflicts: true })], occurrences: [] }).map((c) => c.kind)).toEqual(["same_ci"]);
  });

  it("lockdowns hold every non-emergency change unless scoped", () => {
    expect(lockdownApplies({ id: "l", starts_at: "" }, { type: "normal" })).toBe(true);
    expect(lockdownApplies({ id: "l", starts_at: "" }, { type: "emergency" })).toBe(false);
    expect(lockdownApplies({ id: "l", starts_at: "", services: ["s1"] }, { type: "normal", service_id: "s2" })).toBe(false);
    expect(lockdownApplies({ id: "l", starts_at: "", services: ["s1"] }, { type: "normal", affected_services: ["s1"] })).toBe(true);
  });

  it("conflict state from the rows", () => {
    expect(conflictState([])).toEqual({ status: "none", open: 0 });
    expect(conflictState([{ active: true, status: "detected" }, { active: false, status: "detected" }])).toEqual({ status: "conflict", open: 1 });
    expect(conflictState([{ active: true, status: "ignored" }])).toEqual({ status: "acknowledged", open: 0 });
  });
});

describe("slots and notice", () => {
  it("subtracts busy time and finds the earliest slots that fit", () => {
    expect(subtract([[0, 100]], [[10, 20], [15, 30], [90, 120]])).toEqual([[0, 10], [30, 90]]);
    expect(findSlots({ duration: 20, earliest: 0, until: 100, allowed: null, blocked: [[10, 40]], limit: 3 })).toEqual([[40, 60]]);
    expect(findSlots({ duration: 5, earliest: 0, until: 100, allowed: [[50, 60], [0, 4]], blocked: [], limit: 3 })).toEqual([[50, 55]]);
    expect(findSlots({ duration: 0, earliest: 0, until: 100, allowed: null, blocked: [] })).toEqual([]);
  });

  it("working days between two instants on the office calendar (Friday off) and the notice by risk", () => {
    const cal = calendarOf({ timezone: TZ, hours: DEFAULT_HOURS }, [{ date: "2026-04-01", title: "تعطیل" }]);
    // from Saturday 2026-03-28 to Saturday 2026-04-04: Sun..Thu are working (5) minus the holiday Wednesday 04-01
    expect(businessDaysBetween(cal, at("2026-03-28", 10), at("2026-04-04", 10))).toBe(5);
    expect(businessDaysBetween(cal, at("2026-03-28", 10), at("2026-03-28", 12))).toBe(0);
    expect(leadDaysFor("high", CHANGE_CONFIG_DEFAULTS)).toBe(5);
    expect(leadDaysFor(undefined, CHANGE_CONFIG_DEFAULTS)).toBe(1);
  });
});

describe("CAB, review, readiness, scores", () => {
  it("the seeded CAB rule needs more than half of the board: never a tie, never one yes of two", () => {
    const rule = approvalRules().find((r) => r.name === CAB_RULE_NAME)!;
    const level = (rule.levels as { rule: string; threshold: number }[])[0];
    expect(level.rule).toBe("percent");
    const votes = (yes: number, no: number, open: number) => [...Array(yes).fill({ state: "approved" }), ...Array(no).fill({ state: "rejected" }), ...Array(open).fill({ state: "requested" })];
    expect(levelOutcome(votes(2, 2, 0), level.rule, level.threshold)).toBe("rejected");
    expect(levelOutcome(votes(1, 0, 1), level.rule, level.threshold)).toBe("pending");
    expect(levelOutcome(votes(3, 1, 0), level.rule, level.threshold)).toBe("approved");
    for (let n = 1; n <= 50; n++) expect(needed(level.rule, level.threshold, n)).toBe(Math.floor(n / 2) + 1);
    for (let n = 51; n <= 100; n++) expect(needed(level.rule, level.threshold, n)).toBeGreaterThan(n / 2);
  });

  it("CAB by policy, type and risk; PIR reasons", () => {
    expect(cabRequired({ type: "normal", risk: "high" }, null, ["high"])).toBe(true);
    expect(cabRequired({ type: "normal", risk: "low" }, null, ["high"])).toBe(false);
    expect(cabRequired({ type: "emergency" }, null, [])).toBe(true);
    expect(cabRequired({ type: "standard", risk: "high" }, null, ["high"])).toBe(false);
    expect(cabRequired({ type: "normal", risk: "low" }, { cab_policy: "always" }, [])).toBe(true);
    expect(cabRequired({ type: "emergency" }, { cab_policy: "never" }, [])).toBe(false);
    expect(pirReasons({ type: "emergency", close_code: "backed_out", risk: "high" }, null, ["emergency", "failed", "high_risk"])).toEqual(["emergency", "failed", "high_risk"]);
    expect(pirReasons({ type: "normal", close_code: "successful", risk: "low" }, { pir_policy: "always" }, [])).toEqual(["policy"]);
    expect(pirReasons({ type: "emergency" }, { pir_policy: "never" }, ["emergency"])).toEqual([]);
  });

  it("readiness checks and status", () => {
    const r = readiness({ affected_cis: ["a"], planned_start: iso(at("2026-05-02", 10)), planned_end: iso(at("2026-05-02", 11)), assignment_group_id: "g", justification: "x".repeat(25), expected_outcome: "y", implementation_plan: "z".repeat(50), backout_plan: "b".repeat(25), backout_tested: true, test_plan: "t".repeat(25) });
    expect(r.status).toBe("complete");
    expect(r.score).toBe(100);
    const half = readiness({ affected_cis: ["a"] }, { unansweredQuestions: 2 });
    expect(half.status).toBe("incomplete");
    expect(half.checks.find((c) => c.key === "risk")!.ok).toBe(false);
  });

  it("success scores, checklists, agenda order, next meeting, spans", () => {
    expect(successScore({ implemented: 0, successful: 0, with_issues: 0, failed: 0, caused_incidents: 0, emergency: 0 })).toEqual({ score: null, band: null });
    expect(successScore({ implemented: 10, successful: 10, with_issues: 0, failed: 0, caused_incidents: 0, emergency: 1 })).toEqual({ score: 100, band: "excellent" });
    expect(successScore({ implemented: 10, successful: 6, with_issues: 1, failed: 3, caused_incidents: 2, emergency: 5 }).band).toBe("poor");
    expect(checklistProgress("- [x] یک\n- [ ] دو\n* [X] سه\nمتن")).toEqual({ done: 2, total: 3 });
    const sorted = [{ risk: "low", planned_start: "2026-01-01" }, { risk: "very_high", planned_start: "2026-02-01" }, { risk: "very_high", planned_start: "2026-01-15" }].sort(agendaOrder);
    expect(sorted.map((x) => x.planned_start)).toEqual(["2026-01-15", "2026-02-01", "2026-01-01"]);
    const m = nextMeeting(2, "10:00", 60, at("2026-04-06", 11), TZ)!; // Monday 11:00 → next Monday 10:00
    expect(localParts(m.start, TZ)).toEqual({ date: "2026-04-13", minutes: 600 });
    expect(m.end - m.start).toBe(H);
    expect(nextMeeting(2, "25:00", 60, Date.now(), TZ)).toBeNull();
    expect(humanSpan(90 * 60_000)).toBe("1 ساعت و 30 دقیقه");
    expect(humanSpan(0)).toBe("0 دقیقه");
  });
});
