// Pure logic of problem management (src/shared/problem/logic.ts): the RCA canvas (cleaning, checks, Markdown), the
// risk score and technical debt, and the candidate rules over recurring incidents.
import { describe, it, expect } from "vitest";
import { canvasSections, candidateGroups, candidateScore, cleanRca, emptyRca, problemTemplateParams, rcaMarkdown, rcaProblem, riskScore, techDebt, type CandidateIncident } from "@shared/problem/logic";
import { TABLES } from "@shared/tables";
import { PROBLEM_CHOICE_LISTS, PROACTIVE_SOURCES } from "@shared/tables/problem";

describe("the RCA canvas", () => {
  it("cleans a stored value: unknown keys out, malformed items dropped, lists capped", () => {
    const c = cleanRca({
      whys: [{ question: "چرا سرور افتاد؟", answer: "دیسک پر شد" }, "junk", ...Array.from({ length: 12 }, () => ({ question: "q", answer: "a" }))],
      fishbone: { people: ["آموزش ناکافی", " ", 3], process: [], alien: ["x"] },
      timeline: [{ at: "2026-11-07T10:00:00Z", text: "هشدار" }, { at: "x", text: "" }],
      hypotheses: [{ text: "پشتیبان‌گیری فضای دیسک را پر کرد", status: "confirmed", confidence: "high", evidence: "لاگ" }, { text: "" }, { text: "شبکه", status: "weird" }],
      is_isnot: { what: { is: "سرور ایمیل", isnot: "سرور وب" }, where: {}, nonsense: { is: "x" } },
      conclusion: "علت: سیاست نگهداری پشتیبان",
      extra: true,
    });
    expect(c.whys).toHaveLength(10);
    expect(c.whys[0]).toEqual({ question: "چرا سرور افتاد؟", answer: "دیسک پر شد" });
    expect(c.fishbone).toEqual({ people: ["آموزش ناکافی"] });
    expect(c.timeline).toEqual([{ at: "2026-11-07T10:00:00Z", text: "هشدار" }]);
    expect(c.hypotheses.map((h) => [h.text, h.status, h.confidence])).toEqual([["پشتیبان‌گیری فضای دیسک را پر کرد", "confirmed", "high"], ["شبکه", "open", "medium"]]);
    expect(c.is_isnot).toEqual({ what: { is: "سرور ایمیل", isnot: "سرور وب" } });
    expect(cleanRca(null)).toEqual(emptyRca());
    expect(cleanRca([1, 2])).toEqual(emptyRca());
  });

  it("refuses shapes it cannot keep", () => {
    expect(rcaProblem(null)).toBeNull();
    expect(rcaProblem({ whys: [] })).toBeNull();
    expect(rcaProblem([1])).toBe("کارگاه تحلیل علت ساختار درستی ندارد");
    expect(rcaProblem({ whys: "x" })).toBe("کارگاه تحلیل علت ساختار درستی ندارد");
    expect(rcaProblem({ whys: Array.from({ length: 11 }, () => ({})) })).toContain("حداکثر");
    expect(rcaProblem({ conclusion: "x".repeat(210_000) })).toContain("بزرگ");
  });

  it("writes the analysis as Markdown", () => {
    const md = rcaMarkdown(cleanRca({
      whys: [{ question: "چرا؟", answer: "دیسک پر شد" }],
      fishbone: { process: ["نبود پایش ظرفیت"] },
      hypotheses: [{ text: "پشتیبان‌ها", status: "confirmed", evidence: "لاگ" }, { text: "شبکه", status: "rejected" }],
      conclusion: "نتیجه",
    }));
    expect(md).toContain("1. چرا؟ — دیسک پر شد");
    expect(md).toContain("- فرایند و روش: نبود پایش ظرفیت");
    expect(md).toContain("- پشتیبان‌ها (شواهد: لاگ)");
    expect(md).not.toContain("شبکه");
    expect(md.endsWith("نتیجه")).toBe(true);
    expect(rcaMarkdown(emptyRca())).toBe("");
  });
});

describe("risk and technical debt", () => {
  it("ranks by severity × likelihood, volume, priority and workarounds in use", () => {
    expect(riskScore({ impact: "1", likelihood: "1" })).toBe(63);
    expect(riskScore({ impact: "3", likelihood: "3" })).toBe(7);
    expect(riskScore({ impact: "1", likelihood: "1", incident_count: 15, priority: "1", active_known_errors: 1 })).toBe(100);
    expect(riskScore({ impact: "2", likelihood: "2", incident_count: 3 })).toBe(38);
    expect(riskScore({})).toBe(14);
    expect(techDebt(2, 10)).toBe(20);
    expect(techDebt(1, 0)).toBe(1);
    expect(techDebt(0, 50)).toBe(0);
  });
});

describe("candidate rules", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const at = (d: number) => new Date(now - d * 86_400_000).toISOString();
  const inc = (id: string, x: Partial<CandidateIncident>): CandidateIncident => ({ id, opened_at: at(1), priority: "3", ...x });
  const rules = { candidate_window_days: 30, candidate_min_incidents: 3, candidate_reopen_min: 2 };

  it("groups recurring incidents by CI, then by subcategory, plus majors and repeated reopens", () => {
    const xs = [
      inc("a", { ci_id: "srv-1", short_description: "سرور ایمیل کند است", opened_at: at(10) }),
      inc("b", { ci_id: "srv-1", short_description: "سرور ایمیل پاسخ نمی‌دهد", opened_at: at(5) }),
      inc("c", { ci_id: "srv-1", short_description: "کندی سرور ایمیل", opened_at: at(1), reopen_count: 1 }),
      inc("d", { subcategory: "network.vpn", category: "network" }),
      inc("e", { subcategory: "network.vpn", category: "network" }),
      inc("f", { subcategory: "network.vpn", category: "network", ci_id: "srv-1x" }),
      inc("g", { subcategory: "other.general" }),
      inc("h", { subcategory: "other.general" }),
      inc("i", { subcategory: "other.general" }),
      inc("j", { major_state: "accepted", short_description: "قطعی فروش" }),
      inc("k", { reopen_count: 3 }),
      inc("old", { ci_id: "srv-1", opened_at: at(40) }),
      inc("linked", { ci_id: "srv-1", problem_id: "p1" }),
    ];
    const gs = candidateGroups(xs, rules, now);
    const by = Object.fromEntries(gs.map((g) => [g.signature, g]));
    expect(Object.keys(by).sort()).toEqual(["cat:network.vpn", "ci:srv-1", "mi:j", "reopen:k"].sort());
    expect(by["ci:srv-1"].incidents).toEqual(["a", "b", "c"]);
    expect(by["ci:srv-1"].title).toContain("سرور ایمیل");
    expect(by["ci:srv-1"].ci_id).toBe("srv-1");
    expect(by["cat:network.vpn"].incident_count).toBe(3);
    expect(by["mi:j"].rule_kind).toBe("major_incident");
    // strongest first
    expect(gs[0].score).toBeGreaterThanOrEqual(gs[gs.length - 1].score);
  });

  it("scores size, priority, span and reopens", () => {
    const base = [inc("a", { opened_at: at(1) }), inc("b", { opened_at: at(1) })];
    expect(candidateScore([])).toBe(0);
    expect(candidateScore(base)).toBe(6);
    expect(candidateScore([inc("a", { opened_at: at(16), priority: "1" }), inc("b", { opened_at: at(0), priority: "1", reopen_count: 1 })])).toBe(60);
    expect(candidateGroups(base, { ...rules, candidate_reopen_min: 0 }, now)).toEqual([]);
  });
});

describe("definitions", () => {
  it("registers the problem tables and lists", () => {
    for (const k of ["problem", "problem_task", "known_error", "problem_candidate", "corrective_action", "problem_config"]) expect(TABLES.get(k), k).toBeTruthy();
    const p = TABLES.get("problem")!;
    expect(p.states?.states.map((s) => s.value)).toEqual(["new", "assess", "rca", "fix_in_progress", "pending", "resolved", "closed", "canceled"]);
    expect(p.states?.transitions.find((t) => t.label === "تحلیل دوباره")?.roles).toEqual({ area: "problem", level: "full" });
    expect(p.scope.requesterTransitions).toEqual([]);
    expect(TABLES.get("known_error")!.numbered?.prefix).toBe("KE");
    expect(PROBLEM_CHOICE_LISTS["problem.source"].filter((o) => PROACTIVE_SOURCES.includes(o.value))).toHaveLength(6);
  });
});

describe("templates and the canvas's sections", () => {
  it("turn a template into new-problem parameters (lists comma-separated, empty values left out)", () => {
    expect(problemTemplateParams({ id: "t1", name: "x", short_description: "کندی", category: "infrastructure", rca_sections: ["whys", "fishbone"], impact: "", urgency: null, tasks: [{}] })).toEqual({
      short_description: "کندی", category: "infrastructure", rca_sections: "whys,fishbone", template_id: "t1",
    });
  });

  it("show the sections a problem names, else all", () => {
    expect([...canvasSections(["timeline", "whys", "bogus"])]).toEqual(["whys", "timeline"]);
    expect(canvasSections([]).size).toBe(5);
    expect(canvasSections(null).size).toBe(5);
  });
});
