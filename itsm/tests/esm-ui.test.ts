// Pure logic of the enterprise, customer and field service screens (src/ui/modules/{esm,csm,field_service}/model.ts):
// queues valid for their tables, the journey tracker's phases, tones and readiness, the booking grid's free half-hours,
// entitlement usage and the health trend, the dispatch board's geometry (hours, bars, the time under a drop in RTL),
// local instants, the visit's steps and the checklist's answers.
import { describe, expect, it } from "vitest";
import { validateCond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { QUEUES as ESM_QUEUES, CASE_PATHS, activityTone, byPhase, freeSlots, readiness } from "../src/ui/modules/esm/model";
import { QUEUES as CSM_QUEUES, sparkline, usage, usageTone, healthTone } from "../src/ui/modules/csm/model";
import { QUEUES as FSM_QUEUES, boardWindow, cleanAnswers, clock, fractionAt, hhmm, hourTicks, instantOf, kpiTone, minutesText, placeBar, stepsFor, timeAt } from "../src/ui/modules/field_service/model";

const TZ = "Asia/Tehran";
const H = 3_600_000;

describe("queues", () => {
  it("every queue's filter is valid for its table and paths are unique", () => {
    for (const q of [...ESM_QUEUES, ...CSM_QUEUES, ...FSM_QUEUES]) {
      const def = tableDef(q.table);
      expect(def, q.key).toBeTruthy();
      expect(validateCond(q.filter, def!), `${q.table}:${q.key}`).toBeNull();
    }
    const paths = [...ESM_QUEUES, ...CSM_QUEUES, ...FSM_QUEUES].map((q) => q.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const t of Object.keys(CASE_PATHS)) expect(tableDef(t), t).toBeTruthy();
  });
});

describe("journey tracker", () => {
  it("groups activities by phase in the template's order and counts the settled ones", () => {
    const g = byPhase([
      { id: "a", phase: "first_week", state: "pending" },
      { id: "b", phase: "pre_start", state: "done" },
      { id: "c", phase: "pre_start", state: "skipped" },
      { id: "d", phase: "day_one", state: "in_progress" },
    ]);
    expect(g.map((p) => p.key)).toEqual(["pre_start", "day_one", "first_week"]);
    expect(g[0].done).toBe(2);
    expect(g[0].label).toBe("پیش از شروع");
  });

  it("tones: failed and overdue are danger, waiting approval a warning, done in", () => {
    expect(activityTone({ state: "failed" }, "2026-11-09")).toBe("danger");
    expect(activityTone({ state: "pending", due_date: "2026-11-01" }, "2026-11-09")).toBe("danger");
    expect(activityTone({ state: "in_progress", approval: "requested" }, "2026-11-09")).toBe("warning");
    expect(activityTone({ state: "done", due_date: "2026-11-01" }, "2026-11-09")).toBe("in");
    expect(activityTone({ state: "in_progress", due_date: "2026-11-20" }, "2026-11-09")).toBe("accent");
  });

  it("day-one readiness counts what remains", () => {
    expect(readiness({ day_one_total: 4, day_one_done: 4 }).ready).toBe(true);
    expect(readiness({ day_one_total: 4, day_one_done: 1 })).toEqual({ ready: false, text: "۳ از ۴ کار روز نخست مانده است" });
    expect(readiness({}).ready).toBe(true);
  });

  it("free half-hours leave out every busy span", () => {
    const from = Date.parse("2026-11-10T05:00:00Z");
    const slots = freeSlots([{ start: "2026-11-10T05:30:00Z", end: "2026-11-10T06:15:00Z" }], from, from + 3 * H);
    expect(slots.map((s) => new Date(s.start).toISOString().slice(11, 16))).toEqual(["05:00", "06:30", "07:00", "07:30"]);
  });
});

describe("customer service", () => {
  it("usage of an entitlement's units and its tone", () => {
    expect(usage({ unit_type: "none" })).toBeNull();
    expect(usage({ unit_type: "cases", units_total: "10", units_used: "8" })).toBe(80);
    expect(usage({ unit_type: "hours", units_total: "4", units_used: "6" })).toBe(100);
    expect(usageTone(80, 80)).toBe("warning");
    expect(usageTone(100)).toBe("danger");
    expect(usageTone(20)).toBe("in");
    expect(healthTone("red")).toBe("danger");
  });

  it("the health sparkline skips gaps and clamps the scale", () => {
    expect(sparkline([])).toBe("");
    const pts = sparkline([100, null, 0], 100, 20).split(" ");
    expect(pts).toEqual(["0,0", "100,20"]);
  });
});

describe("dispatch board geometry", () => {
  const day = Date.parse("2026-11-09T20:30:00Z"); // 00:00 in Tehran on 1405/08/19 (2026-11-10)
  const end = day + 24 * H;

  it("shows 07:00–19:00 at least and widens to shifts and visits on whole hours", () => {
    expect(boardWindow(day, end, [])).toEqual({ start: day + 7 * H, end: day + 19 * H });
    const w = boardWindow(day, end, [{ start: new Date(day + 6.5 * H).toISOString(), end: new Date(day + 20.25 * H).toISOString() }]);
    expect(w).toEqual({ start: day + 6 * H, end: day + 21 * H });
    expect(hourTicks(w, TZ)[0].label).toBe("۰۶:۰۰");
  });

  it("places bars in percent and clips them to the window", () => {
    const w = { start: day + 8 * H, end: day + 18 * H };
    expect(placeBar(new Date(day + 9 * H).toISOString(), new Date(day + 10 * H).toISOString(), w)).toEqual({ start: 10, size: 10 });
    expect(placeBar(new Date(day + 7 * H).toISOString(), new Date(day + 9 * H).toISOString(), w)).toEqual({ start: 0, size: 10 });
    expect(placeBar(new Date(day + 19 * H).toISOString(), null, w)).toBeNull();
    expect(placeBar(null, null, w)).toBeNull();
  });

  it("the time under a drop is snapped to a quarter and measured from the right edge in RTL", () => {
    const w = { start: day + 8 * H, end: day + 18 * H };
    expect(fractionAt(150, { left: 100, width: 200 }, true)).toBe(0.75);
    expect(fractionAt(150, { left: 100, width: 200 }, false)).toBe(0.25);
    expect(timeAt(0.25, w)).toBe(day + 10.5 * H);
    expect(timeAt(0.2551, w)).toBe(day + 10.5 * H);
    expect(timeAt(1, w)).toBe(day + 18 * H - 15 * 60_000);
    expect(timeAt(-1, w)).toBe(day + 8 * H);
  });

  it("local instants and clocks in the organisation's zone", () => {
    expect(instantOf("2026-11-10", "09:30", TZ)).toBe("2026-11-10T06:00:00.000Z");
    expect(instantOf("2026-11-10", "25:00", TZ)).toBeNull();
    expect(hhmm("2026-11-10T06:00:00.000Z", TZ)).toBe("09:30");
    expect(clock("2026-11-10T06:00:00.000Z", TZ)).toBe("۰۹:۳۰");
    expect(clock(null, TZ)).toBe("—");
  });
});

describe("the technician's visit", () => {
  it("offers the next step of each state", () => {
    expect(stepsFor("assigned").map((s) => s.step)).toEqual(["accept", "reject"]);
    expect(stepsFor("accepted").find((s) => s.step === "depart")?.position).toBe(true);
    expect(stepsFor("en_route").map((s) => s.step)).toEqual(["arrive"]);
    expect(stepsFor("on_site").map((s) => s.step)).toEqual(["complete"]);
    expect(stepsFor("closed")).toEqual([]);
  });

  it("sends only the checklist's answers, numbers as numbers", () => {
    const items = [{ key: "a", type: "bool" }, { key: "b", type: "number" }, { key: "c", type: "text" }];
    expect(cleanAnswers(items, { a: true, b: "42", c: "  ok", x: "drop", d: "" })).toEqual({ a: true, b: 42, c: "  ok" });
  });

  it("KPI tones and minute texts", () => {
    expect(kpiTone(90, 85, 75)).toBe("in");
    expect(kpiTone(80, 85, 75)).toBe("warning");
    expect(kpiTone(50, 85, 75)).toBe("danger");
    expect(kpiTone(null, 85, 75)).toBe("neutral");
    expect(kpiTone(20, 30, 45, true)).toBe("in");
    expect(minutesText(135)).toBe("۲ ساعت و ۱۵ دقیقه");
    expect(minutesText(45)).toBe("۴۵ دقیقه");
    expect(minutesText(null)).toBe("—");
  });
});
