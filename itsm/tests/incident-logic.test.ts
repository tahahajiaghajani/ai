// Pure logic of incident management (src/shared/incident/logic.ts): similarity and known-error matching, the
// major-incident criteria and actions, the update cadence, the reopen window, the timeline (stored events, checks,
// order), the review draft, canned-response placeholders, templates, durations, working days and announcements.
import { describe, it, expect } from "vitest";
import {
  addWorkingDays, announcementActive, announcementProblem, announcementReaches, eventProblem, fillPlaceholders, humanDuration, knownErrorMatch, localDate, majorActionAllowed,
  majorCandidate, nextUpdateAt, overlap, reopenAllowed, reviewDraft, similarity, sortTimeline, storedEvents, templateParams, templateTasks, templateTasksProblem, words, SIMILAR_MIN,
  type AudienceMember,
} from "@shared/incident/logic";
import { calendarOf, DEFAULT_HOURS } from "@shared/sla/calendar";
import { INCIDENT_CHOICE_LISTS, INCIDENT_CONFIG_DEFAULTS, MAJOR_STATES } from "@shared/tables/incident";
import { TABLES } from "@shared/tables";

describe("words and similarity", () => {
  it("folds Persian typing differences and drops stop words", () => {
    expect(words("اينترنت ساختمان  كار نمي‌کند!")).toEqual(["اینترنت", "ساختمان", "نمیکند"]);
    expect(words("VPN connection is DOWN")).toEqual(["vpn", "connection", "down"]);
    expect(words("۱۲۳ ٤٥")).toEqual(["123", "45"]);
    expect(overlap(["الف", "ب"], ["ب", "ج"])).toBeCloseTo(1 / 3);
    expect(overlap([], ["ب"])).toBe(0);
  });

  it("scores and explains similar incidents", () => {
    const base = { short_description: "قطعی اینترنت ساختمان مرکزی", category: "network", subcategory: "network.internet", ci_id: "ci-1", caller_id: "u1", opened_at: "2026-11-01T08:00:00Z" };
    const same = similarity(base, { short_description: "قطعی اینترنت ساختمان مرکزی", category: "network", subcategory: "network.internet", ci_id: "ci-1", caller_id: "u1", opened_at: "2026-11-05T08:00:00Z" });
    expect(same.score).toBe(97);
    expect(same.reasons).toEqual(["عنوان و شرح نزدیک", "همان پیکربندی", "همان زیردسته", "همان درخواست‌دهنده در دو هفتهٔ اخیر"]);
    const far = similarity(base, { short_description: "چاپگر کاغذ نمی‌گیرد", category: "hardware", caller_id: "u1", opened_at: "2026-10-01T08:00:00Z" });
    expect(far.score).toBe(0);
    expect(far.score).toBeLessThan(SIMILAR_MIN);
    const cat = similarity(base, { short_description: "مشکل شبکه", category: "network" });
    expect(cat.reasons).toEqual(["همان دسته"]);
  });

  it("matches known errors by symptoms, CI and category", () => {
    const inc = { short_description: "خطای اتصال VPN پس از به‌روزرسانی", category: "network", subcategory: "network.vpn", ci_id: "vpn-gw" };
    const m = knownErrorMatch(inc, { short_description: "قطع VPN پس از به‌روزرسانی ویندوز", symptoms: "خطای اتصال VPN", affected_cis: ["vpn-gw"], subcategory: "network.vpn" });
    expect(m.score).toBeGreaterThanOrEqual(50);
    expect(m.reasons).toContain("همان پیکربندی");
    expect(m.reasons).toContain("همان زیردسته");
    expect(knownErrorMatch(inc, { short_description: "چاپگر", category: "hardware" }).score).toBe(0);
  });
});

describe("major incidents", () => {
  const cfg = { mi_candidate_priorities: ["1"], mi_candidate_affected: 10 };
  it("flags candidates by priority and affected people", () => {
    expect(majorCandidate(cfg, { priority: "1" })).toBe("معیار رخداد عمده: اولویت 1");
    expect(majorCandidate(cfg, { priority: "3", affected_users: Array.from({ length: 12 }, (_, i) => `u${i}`) })).toBe("معیار رخداد عمده: 12 کاربر متأثر");
    expect(majorCandidate(cfg, { priority: "2" })).toBeNull();
    expect(majorCandidate(cfg, { priority: "1", major_state: "accepted" })).toBeNull();
    expect(majorCandidate({ mi_candidate_priorities: [], mi_candidate_affected: 0 }, { priority: "1", affected_users: ["a"] })).toBeNull();
  });

  it("allows each overlay action only from its states", () => {
    expect(majorActionAllowed("propose", null)).toBe(true);
    expect(majorActionAllowed("propose", "accepted")).toBe(false);
    expect(majorActionAllowed("declare", "proposed")).toBe(true);
    expect(majorActionAllowed("declare", "accepted")).toBe(false);
    expect(majorActionAllowed("reject", "candidate")).toBe(true);
    expect(majorActionAllowed("reject", "accepted")).toBe(false);
    expect(majorActionAllowed("downgrade", "accepted")).toBe(true);
    expect(majorActionAllowed("downgrade", "resolved")).toBe(false);
    expect(MAJOR_STATES.map((o) => o.value)).toEqual(["candidate", "proposed", "accepted", "rejected", "downgraded", "resolved", "pir_done"]);
  });

  it("computes the next update from the cadence", () => {
    expect(nextUpdateAt("2026-11-07T10:00:00.000Z", 30)).toBe("2026-11-07T10:30:00.000Z");
    expect(nextUpdateAt("2026-11-07T10:00:00.000Z", 0)).toBeNull();
    expect(nextUpdateAt(null, 30)).toBeNull();
  });

  it("keeps a reopen window", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    expect(reopenAllowed("2026-11-05T00:00:00Z", 7, now)).toBe(true);
    expect(reopenAllowed("2026-11-01T00:00:00Z", 7, now)).toBe(false);
    expect(reopenAllowed("2026-01-01T00:00:00Z", 0, now)).toBe(true);
    expect(reopenAllowed(null, 7, now)).toBe(true);
  });
});

describe("the timeline", () => {
  it("cleans stored events and refuses bad input", () => {
    const raw = [
      { id: "a", at: "2026-11-07T10:00:00Z", kind: "decision", title: " تصمیم ", key: true },
      { id: "b", at: "not a date", kind: "note", title: "x" },
      { id: "c", at: "2026-11-07T09:00:00Z", kind: "unknown", title: "y" },
      "junk",
      { at: "2026-11-07T09:00:00Z", kind: "note", title: "no id" },
    ];
    const ev = storedEvents(raw);
    expect(ev.map((e) => [e.id, e.kind, e.title, e.key])).toEqual([["a", "decision", "تصمیم", true], ["c", "note", "y", false]]);
    expect(storedEvents(null)).toEqual([]);
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(eventProblem({ kind: "decision", title: "" }, now)).toBe("عنوان رویداد را بنویسید");
    expect(eventProblem({ kind: "state", title: "x" }, now)).toBe("نوع رویداد معتبر نیست");
    expect(eventProblem({ kind: "note", title: "x", at: "2026-11-08T12:00:00Z" }, now)).toBe("زمان رویداد در آینده است");
    expect(eventProblem({ kind: "note", title: "x", at: "2026-11-01T12:00:00Z" }, now)).toBeNull();
  });

  it("sorts by time, keeping the given order for equal instants", () => {
    const xs = sortTimeline([{ at: "2026-11-07T10:00:00Z", n: 1 }, { at: "2026-11-07T09:00:00Z", n: 2 }, { at: "2026-11-07T10:00:00Z", n: 3 }]);
    expect(xs.map((x) => x.n)).toEqual([2, 1, 3]);
  });

  it("drafts the review from the incident and its key events", () => {
    const d = reviewDraft({
      number: "INC0000001", title: "قطعی اینترنت", description: "شرح", children: 3, affected_users: 2, affected_services: ["اینترنت"], communications: 4,
      business_impact: "توقف فروش", close_notes: "روتر تعویض شد", workaround: "خط پشتیبان", cause_notes: "خرابی روتر", detected_at: "2026-11-07T05:30:00Z",
      timeline: [
        { when: "۹:۰۰", kind: "detection", title: "بروز", key: true },
        { when: "۹:۱۰", kind: "note", title: "یادداشت" },
        { when: "۹:۲۰", kind: "declaration", title: "اعلام", key: true },
        { when: "۱۰:۰۰", kind: "state", title: "حل", key: true },
      ],
      duration: "۲ ساعت",
    });
    expect(d.title).toBe("بازبینی INC0000001 — قطعی اینترنت");
    expect(d.timeline_md.split("\n")).toHaveLength(3);
    expect(d.impact).toContain("رخدادهای فرزند (گزارش‌های مشابه): 3");
    expect(d.root_cause).toBe("خرابی روتر");
    expect(d.resolution).toContain("خط پشتیبان");
    expect(d.detection).toContain("۹:۰۰");
  });
});

describe("canned responses and templates", () => {
  it("fills known placeholders and keeps unknown ones", () => {
    expect(fillPlaceholders("{{caller}} عزیز، {{ number }} — {{other}}", { caller: "سارا", number: "INC1" })).toBe("سارا عزیز، INC1 — {{other}}");
  });

  it("turns a template into new-record parameters and tasks", () => {
    expect(templateParams({ id: "t1", short_description: "عنوان", category: "network", impact: "2", description: "", tasks: [{}] })).toEqual({ short_description: "عنوان", category: "network", impact: "2", template_id: "t1" });
    expect(templateTasks([{ short_description: " بررسی " }, { short_description: "" }, { short_description: "دوم", mandatory: false, assignment_group_id: "bad" }, 5])).toEqual([
      { short_description: "بررسی", description: null, assignment_group_id: null, mandatory: true },
      { short_description: "دوم", description: null, assignment_group_id: null, mandatory: false },
    ]);
    expect(templateTasksProblem([{ short_description: "x" }])).toBeNull();
    expect(templateTasksProblem({})).toBe("کارهای الگو باید فهرستی از کارها باشد");
    expect(templateTasksProblem([{ title: "x" }])).toBe("کار 1 عنوان ندارد");
  });
});

describe("durations and working days", () => {
  it("says durations in Persian words", () => {
    expect(humanDuration(45 * 60_000)).toBe("45 دقیقه");
    expect(humanDuration(150 * 60_000)).toBe("2 ساعت و 30 دقیقه");
    expect(humanDuration(26 * 3600_000)).toBe("1 روز و 2 ساعت");
    expect(humanDuration(-1)).toBe("");
  });

  it("counts working days on the office calendar (Friday and holidays skipped)", () => {
    const cal = calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, [{ date: "2026-11-09", title: "تعطیل" }]);
    // Wednesday 2026-11-04 10:00 Tehran
    const start = Date.parse("2026-11-04T06:30:00Z");
    expect(localDate(start, "Asia/Tehran")).toBe("2026-11-04");
    // Thu 5th (half day 8–12) is a working day, Fri 6th off → 1 day = Thu 12:00, 2 days = Sat 16:00
    expect(new Date(addWorkingDays(cal, start, 1)).toISOString()).toBe("2026-11-05T08:30:00.000Z");
    expect(new Date(addWorkingDays(cal, start, 2)).toISOString()).toBe("2026-11-07T12:30:00.000Z");
    // Sun 8th, (Mon 9th holiday), Tue 10th
    expect(localDate(addWorkingDays(cal, start, 4), "Asia/Tehran")).toBe("2026-11-10");
    expect(addWorkingDays(null, start, 2)).toBe(start + 2 * 86_400_000);
    expect(addWorkingDays(cal, start, 0)).toBe(start);
  });
});

describe("definitions", () => {
  it("registers the module's tables, choice lists and defaults", () => {
    for (const k of ["incident", "incident_task", "incident_review", "incident_template", "incident_response", "announcement", "incident_config"]) expect(TABLES.get(k), k).toBeTruthy();
    const inc = TABLES.get("incident")!;
    expect(inc.numbered?.prefix).toBe("INC");
    expect(inc.states?.transitions.find((t) => t.to === "on_hold")?.requires).toEqual(["hold_reason"]);
    expect(inc.scope.own).toContain("affected_users");
    expect(inc.scope.requesterWritable).toContain("satisfaction");
    expect(inc.features?.confidential).toBe(true);
    expect(Object.keys(INCIDENT_CHOICE_LISTS)).toEqual(["incident.channel", "incident.hold_reason", "incident.close_code", "incident.cause_code", "incident.category", "incident.subcategory"]);
    expect(INCIDENT_CHOICE_LISTS["incident.subcategory"].every((o) => o.parent)).toBe(true);
    expect(INCIDENT_CONFIG_DEFAULTS.auto_close_days).toBe(3);
  });
});

describe("announcements", () => {
  const now = Date.parse("2026-11-08T10:00:00Z");
  const member = (over: Partial<AudienceMember> = {}): AudienceMember => ({ userId: "u1", agent: false, groups: ["g1"], units: ["unit-a", "unit-root"], location: "loc1", ...over });

  it("are on air when published and inside their window", () => {
    expect(announcementActive({ state: "published" }, now)).toBe(true);
    expect(announcementActive({ state: "draft" }, now)).toBe(false);
    expect(announcementActive({ state: "published", starts_at: "2026-11-08T11:00:00Z" }, now)).toBe(false);
    expect(announcementActive({ state: "published", starts_at: "2026-11-08T09:00:00Z", ends_at: "2026-11-08T10:00:00Z" }, now)).toBe(false);
    expect(announcementActive({ state: "published", starts_at: "2026-11-08T09:00:00Z", ends_at: "2026-11-08T10:30:00Z" }, now)).toBe(true);
  });

  it("reach everyone, agents only, or the named groups, unit trees, locations and people", () => {
    expect(announcementReaches({ audience: "everyone" }, member())).toBe(true);
    expect(announcementReaches({}, member())).toBe(true);
    expect(announcementReaches({ audience: "agents" }, member())).toBe(false);
    expect(announcementReaches({ audience: "agents" }, member({ agent: true }))).toBe(true);
    expect(announcementReaches({ audience: "targeted", groups: ["g2"] }, member())).toBe(false);
    expect(announcementReaches({ audience: "targeted", groups: ["g2", "g1"] }, member())).toBe(true);
    expect(announcementReaches({ audience: "targeted", units: ["unit-root"] }, member())).toBe(true);
    expect(announcementReaches({ audience: "targeted", locations: ["loc1"] }, member())).toBe(true);
    expect(announcementReaches({ audience: "targeted", locations: ["loc1"] }, member({ location: null }))).toBe(false);
    expect(announcementReaches({ audience: "targeted", users: ["u1"] }, member({ groups: [] }))).toBe(true);
  });

  it("need a window that ends after it starts and a target when targeted", () => {
    expect(announcementProblem({ audience: "everyone" })).toBeNull();
    expect(announcementProblem({ starts_at: "2026-11-08T10:00:00Z", ends_at: "2026-11-08T09:00:00Z" })?.ends_at).toContain("پس از آغاز");
    expect(announcementProblem({ audience: "targeted", groups: [] })?.audience).toContain("دست‌کم");
    expect(announcementProblem({ audience: "targeted", users: ["u1"] })).toBeNull();
  });
});
