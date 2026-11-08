// The service portfolio's pure logic (src/shared/service_portfolio/logic.ts) and the screens' model
// (src/ui/modules/service_portfolio/model.ts): live status from signals, the status page's daily bars and availability,
// the performance score, proposal scores and readiness, name overlap, value × cost quadrants, review dates, and the
// status page's headline and grouping.
import { describe, expect, it } from "vitest";
import {
  dailyBars, median, nameTokens, overlapPairs, proposalScore, quadrantOf, readinessPct, reviewDue, serviceScore, serviceValue, similarity, statusFromSignals,
} from "@shared/service_portfolio/logic";
import { barTitle, groupServices, headline, scatter, statusColor, statusTone } from "../src/ui/modules/service_portfolio/model";

describe("live status", () => {
  it("is set by the owner when overridden, else by major incidents, P1, failing CIs, P2, maintenance", () => {
    expect(statusFromSignals({ incidents: [{ priority: "1", major: true }], override: "maintenance" }).status).toBe("maintenance");
    expect(statusFromSignals({ incidents: [{ priority: "3", major: true }] }).status).toBe("major_outage");
    expect(statusFromSignals({ incidents: [{ priority: "1", major: false }] })).toEqual({ status: "partial_outage", reason: "1 رخداد اولویت ۱" });
    expect(statusFromSignals({ incidents: [], ci: { severity: 1, maintenance: false } }).status).toBe("partial_outage");
    expect(statusFromSignals({ incidents: [{ priority: "2", major: false }] }).status).toBe("degraded");
    expect(statusFromSignals({ incidents: [], ci: { severity: 0.5, maintenance: false } }).status).toBe("degraded");
    expect(statusFromSignals({ incidents: [], ci: { severity: 1, maintenance: true } }).status).toBe("maintenance");
    expect(statusFromSignals({ incidents: [{ priority: "4", major: false }], override: "auto" })).toEqual({ status: "operational", reason: "" });
  });
});

describe("the status page's bars", () => {
  const now = Date.parse("2026-06-10T12:00:00Z");
  it("shows the worst status of each day and the availability over the window", () => {
    const changes = [
      { at: "2026-06-08T08:00:00Z", from: "operational", to: "partial_outage" },
      { at: "2026-06-08T14:00:00Z", from: "partial_outage", to: "operational" },
      { at: "2026-06-09T10:00:00Z", from: "operational", to: "degraded" },
      { at: "2026-06-09T11:00:00Z", from: "degraded", to: "operational" },
    ];
    const { bars, availability } = dailyBars("operational", changes, 5, now, "UTC");
    const byDay = Object.fromEntries(bars.map((b) => [b.day, b]));
    expect(byDay["2026-06-08"].status).toBe("partial_outage");
    expect(byDay["2026-06-08"].availability).toBeCloseTo(75, 0);
    expect(byDay["2026-06-09"]).toMatchObject({ status: "degraded", availability: 100 });
    expect(byDay["2026-06-07"]).toMatchObject({ status: "operational", availability: 100 });
    expect(availability).toBeGreaterThan(94);
    expect(availability).toBeLessThan(100);
  });

  it("starts from the status before the first change, and skips days before the service existed", () => {
    const { bars } = dailyBars("operational", [{ at: "2026-06-09T00:00:00Z", from: "major_outage", to: "operational" }], 3, now, "UTC");
    expect(bars.find((b) => b.day === "2026-06-08")!.status).toBe("major_outage");
    const young = dailyBars("operational", [], 10, now, "UTC", "2026-06-09T00:00:00Z");
    expect(young.bars.length).toBe(10);
    expect(young.bars.filter((b) => b.empty).map((b) => b.day)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08"]);
    expect(young.availability).toBe(100);
  });
});

describe("scores", () => {
  it("weights availability against the target, incidents, breaches and satisfaction", () => {
    const w = { availability: 40, incidents: 30, breaches: 20, csat: 10 };
    const perfect = serviceScore({ availability: 99.9, target: 99.5, incidents: 0, major: 0, breaches: 0, csat: 5 }, w);
    expect(perfect.score).toBe(100);
    const bad = serviceScore({ availability: 90, target: 99.9, incidents: 4, major: 1, breaches: 2, csat: 2 }, w);
    expect(bad.score).toBeLessThan(80);
    expect(bad.components).toMatchObject({ incidents: 60, breaches: 50, csat: 25 });
    expect(serviceScore({ availability: null, target: null, incidents: 0, major: 0, breaches: 0, csat: null }, w).score).toBe(100);
  });

  it("scores proposals and readiness checklists", () => {
    expect(proposalScore(5, 5, 1)).toBe(100);
    expect(proposalScore(1, 1, 5)).toBe(0);
    expect(proposalScore(null, 3, 3)).toBeNull();
    expect(readinessPct([{ item: "a", done: true }, { item: "b", done: false }])).toBe(50);
    expect(readinessPct("nonsense")).toBe(0);
  });
});

describe("rationalization and reviews", () => {
  it("folds Persian typing differences and finds overlapping services", () => {
    expect(nameTokens("خدمت ايميل سازماني")).toEqual(new Set(["ایمیل", "سازمانی"]));
    expect(similarity(nameTokens("ایمیل سازمانی"), nameTokens("ايميل سازماني"))).toBe(1);
    const pairs = overlapPairs([
      { id: "a", name: "ایمیل سازمانی", node: "n1" },
      { id: "b", name: "سامانهٔ ایمیل سازمانی جدید", node: "n1" },
      { id: "c", name: "حقوق و دستمزد", node: "n2" },
    ]);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([["a", "b"]]);
  });

  it("places services on value × cost quadrants", () => {
    expect(quadrantOf(80, 10, 50, 20)).toBe("invest");
    expect(quadrantOf(80, 30, 50, 20)).toBe("maintain");
    expect(quadrantOf(20, 10, 50, 20)).toBe("review");
    expect(quadrantOf(20, 30, 50, 20)).toBe("retire");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(serviceValue("tier_1", 10, 10, 100)).toBe(100);
    expect(serviceValue("tier_4", 0, 10, null)).toBeLessThan(40);
  });

  it("computes the next review date, clamping month ends", () => {
    expect(reviewDue("2026-01-31", 1, null)).toBe("2026-02-28");
    expect(reviewDue(null, 12, "2025-05-10T08:00:00Z")).toBe("2026-05-10");
    expect(reviewDue("2026-01-01", 0, null)).toBeNull();
    expect(reviewDue(null, 12, null)).toBeNull();
  });
});

describe("the screens' model", () => {
  const svc = (id: string, status: string, group: string | null) => ({ id, number: null, name: id, status: status as never, since: null, note: null, bars: [], availability: 100, tier: null, group });

  it("writes the headline and groups services worst first", () => {
    expect(headline("operational", [])).toBe("همهٔ خدمت‌ها عادی کار می‌کنند");
    expect(headline("partial_outage", [svc("a", "partial_outage", null), svc("b", "operational", null)])).toContain("۱");
    const groups = groupServices([svc("a", "operational", "زیرساخت"), svc("b", "major_outage", "ارتباطات"), svc("c", "degraded", "زیرساخت")]);
    expect(groups.map((g) => g.group)).toEqual(["ارتباطات", "زیرساخت"]);
    expect(groups[1].services.map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("titles day bars in Jalali and maps statuses to tokens", () => {
    expect(barTitle({ day: "2026-03-21", status: "degraded", availability: 98.5 })).toBe("۱۴۰۵/۰۱/۰۱ — کاهش کارایی — دسترس‌پذیری ۹۸٫۵۰٪");
    expect(statusColor("major_outage")).toBe("var(--ds-danger)");
    expect(statusTone("operational")).toBe("in");
    expect(statusTone("maintenance")).toBe("neutral");
  });

  it("normalises the quadrant scatter", () => {
    const rows = [
      { id: "a", value: 100, annual_cost: "1000", incidents_90d: 2 },
      { id: "b", value: 0, annual_cost: "500", incidents_90d: 0 },
    ] as never;
    expect(scatter(rows, "cost")).toEqual([{ id: "a", x: 1, y: 1 }, { id: "b", x: 0, y: 0.5 }]);
    expect(scatter(rows, "load")[1].y).toBe(0);
  });
});
