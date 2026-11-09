// Pure logic of the portal's screens and its shared model: paths inside the portal, the home layout an administrator
// edits (normalised, reordered, checked, sections added), where a record stands for its requester (stages and the four
// steps), the answer scales of survey questions and the checks and metrics of answers, the website widget's origins,
// the greeting, relative times and sizes in Persian, and the grouping of search hits.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT, PORTAL_WIDGETS, addableWidgets, checkSurveyAnswers, csatPctOf, layoutProblems, moveWidget, newWidget, normalizeLayout, npsOf, originAllowed, originOf,
  responseMetrics, stageOf, stageSteps, isOpenStage, type SurveyQuestion, type WidgetInstance,
} from "@shared/portal/logic";
import { accentOf, ago, appPath, fileSize, greeting, groupHits, portalPath, scaleEnds, scaleOf, sortForRequester, ticketPath } from "@ui/modules/portal/model";
import { portalItemTableKeys } from "@ui/modules/portal/tables";

describe("paths", () => {
  it("keeps every page inside the portal and maps the server's paths", () => {
    expect(portalPath("o1")).toBe("/o1/portal");
    expect(portalPath("o1", "requests")).toBe("/o1/portal/requests");
    expect(portalPath("o1", "/kb/123")).toBe("/o1/portal/kb/123");
    expect(ticketPath("o1", "incident", "abc")).toBe("/o1/portal/t/incident/abc");
    expect(appPath("o1", "portal/kb/9")).toBe("/o1/portal/kb/9");
    expect(appPath("o1", "/r/incident/9")).toBe("/o1/r/incident/9");
    expect(portalItemTableKeys).toEqual(expect.arrayContaining(["incident", "request_item", "portal_feedback"]));
  });

  it("takes only a named colour as the portal's accent", () => {
    expect(accentOf("teal")).toBe("teal");
    expect(accentOf("#ff0000")).toBe("indigo");
    expect(accentOf(null)).toBe("indigo");
  });
});

describe("the home layout", () => {
  it("puts the search first, once, and drops what it does not know", () => {
    const raw = [
      { id: "a", type: "popular", enabled: true, limit: 99 },
      { id: "b", type: "nonsense", enabled: true },
      { id: "c", type: "search", enabled: false },
      { id: "d", type: "popular", enabled: true },
    ];
    const l = normalizeLayout(raw);
    expect(l[0].type).toBe("search");
    expect(l[0].enabled).toBe(true);
    expect(l.filter((w) => w.type === "popular")).toHaveLength(1);
    expect(l.some((w) => (w.type as string) === "nonsense")).toBe(false);
    const pop = l.find((w) => w.type === "popular")!;
    expect(pop.limit).toBeLessThanOrEqual(PORTAL_WIDGETS.popular.limit!.max);
  });

  it("starts from a clean default and checks it", () => {
    const l = normalizeLayout(DEFAULT_LAYOUT);
    expect(l[0].type).toBe("search");
    expect(layoutProblems(l)).toEqual([]);
  });

  it("moves sections and adds only what may be added", () => {
    const l = normalizeLayout(DEFAULT_LAYOUT);
    const moved = moveWidget(l, 2, 1);
    expect(moved[1].id).toBe(l[2].id);
    expect(moved[0].type).toBe("search");
    const addable = addableWidgets(l).map((d) => d.type);
    expect(addable).toContain("text");
    expect(addable).not.toContain("search");
    const t: WidgetInstance = newWidget(l, "text");
    expect(t.type).toBe("text");
    expect(l.some((w) => w.id === t.id)).toBe(false);
    const two = normalizeLayout([...l, t, newWidget([...l, t], "text")]);
    expect(two.filter((w) => w.type === "text").length).toBeGreaterThanOrEqual(2);
  });
});

describe("where a record stands", () => {
  it("speaks of stages, never of internal states", () => {
    expect(stageOf("new")).toBe("received");
    expect(stageOf("active")).toBe("working");
    expect(stageOf("active", { info_requested: true })).toBe("waiting_you");
    expect(stageOf("waiting", { hold_reason: "awaiting_caller" })).toBe("waiting_you");
    expect(stageOf("waiting", { hold_reason: "awaiting_vendor" })).toBe("waiting");
    expect(stageOf("resolved")).toBe("done");
    expect(stageOf("closed")).toBe("closed");
    expect(stageOf("canceled")).toBe("canceled");
    expect(isOpenStage("done")).toBe(true);
    expect(isOpenStage("closed")).toBe(false);
  });

  it("draws four steps with the current one marked, and none for a canceled record", () => {
    const s = stageSteps("working");
    expect(s.map((x) => x.status)).toEqual(["done", "current", "todo", "todo"]);
    expect(stageSteps("closed").every((x) => x.status === "done")).toBe(true);
    expect(stageSteps("canceled")).toEqual([]);
  });

  it("lists what waits on the requester first", () => {
    const sorted = sortForRequester([
      { id: "1", stage: "working" as const, updated_at: "2026-01-03T00:00:00Z" },
      { id: "2", stage: "waiting_you" as const, updated_at: "2026-01-01T00:00:00Z" },
      { id: "3", stage: "done" as const, updated_at: "2026-01-02T00:00:00Z" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["2", "3", "1"]);
  });
});

describe("surveys", () => {
  const qs: SurveyQuestion[] = [
    { id: "q1", label: "رضایت", kind: "rating", metric: "csat", required: true, options: [], help: null },
    { id: "q2", label: "توصیه", kind: "nps", metric: "nps", required: false, options: [], help: null },
    { id: "q3", label: "چه چیزی؟", kind: "multi", metric: "none", required: false, options: ["سرعت", "رفتار"], help: null },
    { id: "q4", label: "نظر", kind: "text", metric: "none", required: false, options: [], help: null },
  ];

  it("offers the right scale for each question", () => {
    expect(scaleOf("rating").map((s) => s.value)).toEqual([1, 2, 3, 4, 5]);
    expect(scaleOf("nps")).toHaveLength(11);
    expect(scaleOf("ces")).toHaveLength(7);
    expect(scaleOf("faces")[4].label).toBe("عالی");
    expect(scaleOf("text")).toEqual([]);
    expect(scaleEnds("nps")).toEqual(["اصلاً", "حتماً"]);
    expect(scaleEnds("choice")).toBeNull();
  });

  it("checks answers as the server does: required, ranges, options, Persian digits", () => {
    expect(checkSurveyAnswers(qs, {}).problems.q1).toBeTruthy();
    expect(checkSurveyAnswers(qs, { q1: 6 }).problems.q1).toBeTruthy();
    expect(checkSurveyAnswers(qs, { q1: "۴", q3: ["سرعت", "چیز دیگر"] }).problems.q3).toBeTruthy();
    const ok = checkSurveyAnswers(qs, { q1: "۵", q2: 9, q3: ["سرعت", "سرعت"], q4: "  عالی بود  " });
    expect(ok.problems).toEqual({});
    expect(ok.clean).toEqual({ q1: 5, q2: 9, q3: ["سرعت"], q4: "عالی بود" });
  });

  it("derives CSAT, NPS and the satisfied flag", () => {
    const m = responseMetrics(qs, { q1: 4, q2: 10 });
    expect(m.csat).toBe(4);
    expect(m.satisfied).toBe(true);
    expect(m.nps).toBe(10);
    expect(npsOf([10, 9, 8, 0])).toBe(25);
    expect(npsOf([])).toBeNull();
    expect(csatPctOf([5, 4, 3, 1])).toBe(50);
  });
});

describe("the website widget's origins", () => {
  it("compares scheme, host and port only, and refuses everything else", () => {
    expect(originOf("https://example.com/help?x=1")).toBe("https://example.com");
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originAllowed("https://example.com", ["https://example.com"])).toBe(true);
    expect(originAllowed("https://example.com.evil.io", ["https://example.com"])).toBe(false);
    expect(originAllowed("http://example.com", ["https://example.com"])).toBe(false);
    expect(originAllowed(null, ["https://example.com"])).toBe(false);
  });
});

describe("words of the screens", () => {
  it("greets by the hour, tells times and sizes in Persian, and groups hits", () => {
    expect(greeting(8)).toBe("صبح بخیر");
    expect(greeting(22)).toBe("شب بخیر");
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(ago("2026-11-09T11:59:40Z", now)).toBe("هم‌اکنون");
    expect(ago(null)).toBeNull();
    expect(ago("2026-11-09T09:00:00Z", now)).toMatch(/ساعت/);
    expect(fileSize(512)).toContain("بایت");
    expect(fileSize(5 * 1024 * 1024)).toContain("مگابایت");
    const g = groupHits([
      { kind: "item", id: "1" },
      { kind: "record", id: "2" },
      { kind: "article", id: "3" },
      { kind: "article", id: "4" },
    ]);
    expect(g.map((x) => x.kind)).toEqual(["record", "article", "item"]);
    expect(g[1].hits).toHaveLength(2);
  });
});
