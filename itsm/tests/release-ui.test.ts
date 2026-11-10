// Pure logic of the release, DevOps and project screens: queues valid for their tables, the roadmap's bars, the
// readiness board's grouping and the actions a check offers, DORA wording, the pipeline's promotions, the Gantt's
// geometry and the heat map's tones.
import { describe, expect, it } from "vitest";
import { validateCond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { DEPLOYMENT_QUEUES, QUEUES, boardColumns, checkActions, readinessTone, roadmapItems } from "../src/ui/modules/release/model";
import { RELEASE_POLICIES } from "../src/ui/modules/release/index";
import { frequencyText, humanDuration, bandTone, waitingInto, hookUrl, deployTone } from "../src/ui/modules/devops/model";
import { QUEUES as PROJECT_QUEUES, arrowsOf, barOf, depthOf, ganttRange, healthTone, loadTone } from "../src/ui/modules/project/model";
import { earnedValue } from "@shared/project/logic";

describe("release screens", () => {
  it("has queues and form policies valid for their tables", () => {
    const def = tableDef("release")!;
    for (const q of QUEUES) expect(validateCond(q.filter, def), q.key).toBeNull();
    const dep = tableDef("deployment")!;
    for (const q of DEPLOYMENT_QUEUES) expect(validateCond(q.filter, dep), q.key).toBeNull();
    for (const p of RELEASE_POLICIES) {
      if (p.when) expect(validateCond(p.when, def), p.key).toBeNull();
      for (const a of p.actions) expect(def.fields.some((f) => f.name === a.field), `${p.key}:${a.field}`).toBe(true);
    }
    const paths = [...QUEUES, ...DEPLOYMENT_QUEUES].map((q) => q.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("draws releases with a delivery date as bars, outlined when they need attention", () => {
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const items = roadmapItems([
      { id: "a", number: "REL1", short_description: "پرتال", version_name: "2.0", state: "build", planned_start: past, planned_end: new Date(Date.now() + 86_400_000).toISOString() },
      { id: "b", number: "REL2", short_description: "دیرکرد", state: "test", planned_end: past },
      { id: "c", number: "REL3", short_description: "بی‌تاریخ", state: "draft" },
    ]);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(items[0].label).toContain("2.0");
    expect(Date.parse(items[1].start)).toBeLessThan(Date.parse(items[1].end));
    expect(items[1].tone).toBe("danger");
  });

  it("groups the readiness board and offers the right actions on a check", () => {
    const cols = boardColumns([{ id: "1", state: "test" }, { id: "2", state: "readiness" }, { id: "3", state: "draft" }]);
    expect(cols.map((c) => c.items.length)).toEqual([0, 1, 1]);
    expect(checkActions({ rule: "manual", status: "pending", blocking: true }, false)).toEqual({ verdict: true, waive: false });
    expect(checkActions({ rule: "tasks_done", status: "fail", blocking: true }, true)).toEqual({ verdict: false, waive: true });
    expect(checkActions({ rule: "tasks_done", status: "pass", blocking: true }, true).waive).toBe(false);
    expect(readinessTone(100, true)).toBe("in");
    expect(readinessTone(50, false)).toBe("danger");
  });
});

describe("DevOps screens", () => {
  it("words durations and frequencies in Persian", () => {
    expect(humanDuration(1800)).toBe("۳۰ دقیقه");
    expect(humanDuration(5400)).toBe("۱٫۵ ساعت");
    expect(humanDuration(null)).toBe("—");
    expect(frequencyText(2)).toBe("۲ بار در روز");
    expect(frequencyText(2 / 7)).toBe("۲ بار در هفته");
    expect(frequencyText(0)).toBe("بدون استقرار");
    expect(bandTone("elite")).toBe("in");
    expect(bandTone("low")).toBe("danger");
    expect(deployTone("rolled_back")).toBe("danger");
  });

  it("finds versions waiting for promotion and builds the webhook URL", () => {
    expect(waitingInto({ waiting: [{ to: "prod", version: "1.2" }] }, "prod")).toBe("1.2");
    expect(waitingInto({ waiting: [] }, "prod")).toBeNull();
    expect(hookUrl("https://itsm.example.com/", "abc")).toBe("https://itsm.example.com/api/public/devops/hooks/abc");
  });
});

describe("project screens", () => {
  it("has queues valid for their tables", () => {
    for (const q of PROJECT_QUEUES) expect(validateCond(q.filter, tableDef(q.table)!), q.key).toBeNull();
  });

  it("places Gantt bars inside the range and indents by WBS depth", () => {
    const tasks = [
      { id: "a", wbs: "1", planned_start: "2026-11-01", planned_end: "2026-11-05", depends_on: [] },
      { id: "b", wbs: "1.1", planned_start: "2026-11-06", planned_end: "2026-11-20", depends_on: ["a"], is_critical: true },
      { id: "c", wbs: "1.1.1", planned_start: "2026-11-21", planned_end: "2026-11-21", depends_on: ["b"], is_critical: true },
    ];
    const r = ganttRange(tasks, "2026-11-03");
    expect(r.from <= "2026-11-01").toBe(true);
    expect(r.to >= "2026-11-21").toBe(true);
    const b = barOf("2026-11-06", "2026-11-20", r)!;
    expect(b.start).toBeGreaterThan(0);
    expect(b.start + b.size).toBeLessThanOrEqual(100);
    expect(barOf(null, null, r)).toBeNull();
    expect(depthOf("1.1.1")).toBe(2);
    expect(arrowsOf(tasks)).toEqual([{ from: 0, to: 1, critical: false }, { from: 1, to: 2, critical: true }]);
  });

  it("computes earned value from budget, progress, dates and cost", () => {
    const ev = earnedValue({ budget: "1000000", actual_cost: "600000", pct: 40, planned_start: "2026-01-01", planned_end: "2026-01-11", today: "2026-01-06" })!;
    expect(ev.pv).toBe(500000);
    expect(ev.ev).toBe(400000);
    expect(ev.spi).toBe(0.8);
    expect(ev.cpi).toBe(0.667);
    expect(ev.eac).toBe(1499250);
    expect(earnedValue({ budget: null, actual_cost: 0, pct: 10, today: "2026-01-01" })).toBeNull();
  });

  it("tones health and load", () => {
    expect(healthTone("red")).toBe("danger");
    expect(healthTone("unknown")).toBe("neutral");
    expect(loadTone(0)).toBe("low");
    expect(loadTone(60)).toBe("ok");
    expect(loadTone(95)).toBe("high");
    expect(loadTone(120)).toBe("over");
  });
});
