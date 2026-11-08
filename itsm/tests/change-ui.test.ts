// Pure logic of the change screens (src/ui/modules/change/model.ts): queues valid for the table, the calendar's
// geometry on the record kit's (days with Fridays and holidays, lanes at the minute, windows as bands, a month's days),
// tones and flags, dashboard KPIs and calibration, the CAB workbench's decisions and the questionnaire's progress.
import { describe, expect, it } from "vitest";
import { validateCond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { localInstant } from "@shared/sla/calendar";
import {
  QUEUES, calibrated, changeTone, cleanAnswers, decisionsFor, flags, kpiRows, progress, topFactors, voteText, weekStart, windowBandsOf,
  type QuestionView,
} from "../src/ui/modules/change/model";
import { bandsOn, placeBands, placeSpans, scaleDays, spansOn, windowRange } from "../src/ui/records/model/calendar";
import { CHANGE_POLICIES } from "../src/ui/modules/change/index";

const TZ = "Asia/Tehran";
const at = (d: string, h = 0) => new Date(localInstant(d, h * 60, TZ)).toISOString();

describe("queues and policies", () => {
  it("every queue's filter and every form policy's condition is valid for change_request", () => {
    const def = tableDef("change_request")!;
    for (const q of QUEUES) expect(validateCond(q.filter, def), q.key).toBeNull();
    for (const p of CHANGE_POLICIES) {
      if (p.when) expect(validateCond(p.when, def), p.key).toBeNull();
      for (const a of p.actions) expect(def.fields.some((f) => f.name === a.field), `${p.key}:${a.field}`).toBe(true);
    }
    expect(new Set(QUEUES.map((q) => q.path)).size).toBe(QUEUES.length);
  });
});

describe("calendar geometry", () => {
  it("days of a range with Fridays and holidays; a week starts on Saturday", () => {
    expect(weekStart("2026-03-26")).toBe("2026-03-21"); // Thursday → Saturday
    const days = scaleDays("2026-03-21", 7, [{ date: "2026-03-21", title: "نوروز" }], "2026-03-23");
    expect(days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days[0].holiday).toBe("نوروز");
    expect(days[0].off).toBe(true);
    expect(days[6].off).toBe(true);
    expect(days[3].off).toBe(false);
    expect(days[2].today).toBe(true);
    expect(days[0].jd).toBe(1);
  });

  it("bars at the minute, packed into lanes, clipped at the edges", () => {
    const range = windowRange("2026-03-21", 7, TZ);
    const items = [
      { id: "a", s: at("2026-03-21", 10), e: at("2026-03-21", 12) },
      { id: "b", s: at("2026-03-21", 11), e: at("2026-03-22", 1) },
      { id: "c", s: at("2026-03-21", 12), e: at("2026-03-21", 13) },
      { id: "d", s: at("2026-03-20", 10), e: at("2026-03-21", 6) },
      { id: "x", s: at("2026-03-30", 10), e: at("2026-03-30", 11) },
      { id: "bad", s: "", e: at("2026-03-22") },
    ];
    const { bars, lanes } = placeSpans(items, range, (i) => i.s, (i) => i.e);
    expect(bars.map((b) => b.item.id)).toEqual(["d", "a", "b", "c"]);
    expect(lanes).toBe(2);
    const byId = Object.fromEntries(bars.map((b) => [b.item.id, b]));
    expect(byId.a.lane).toBe(byId.d.lane);
    expect(byId.b.lane).not.toBe(byId.a.lane);
    expect(byId.c.lane).toBe(byId.a.lane);
    expect(byId.d.clippedStart).toBe(true);
    expect(byId.d.left).toBe(0);
    expect(byId.a.left).toBeCloseTo((10 / (24 * 7)) * 100, 5);
    expect(byId.a.width).toBeCloseTo((2 / (24 * 7)) * 100, 5);
  });

  it("window bands put blackouts above maintenance; a month day finds its changes and windows", () => {
    const range = windowRange("2026-03-21", 7, TZ);
    const ws = [
      { window_id: "b", name: "ممنوعیت", kind: "blackout", enforcement: "block", start: at("2026-03-22"), end: at("2026-03-23") },
      { window_id: "m", name: "نگهداری", kind: "maintenance", enforcement: "block", start: at("2026-03-26", 22), end: at("2026-03-27", 4) },
    ];
    const bands = windowBandsOf([...ws, { window_id: "w", name: "هشدار", kind: "freeze", enforcement: "warn", start: at("2026-03-24"), end: at("2026-03-25") }]);
    expect(placeBands(bands, range).map((b) => b.item.kind)).toEqual(["maintenance", "freeze", "blackout"]);
    expect(bands.find((b) => b.kind === "freeze")!.title).toContain("فقط هشدار");
    expect(bandsOn(ws, "2026-03-27", TZ).map((w) => w.window_id)).toEqual(["m"]);
    const changes = [{ id: "1", planned_start: at("2026-03-22", 23), planned_end: at("2026-03-23", 2) }, { id: "2", planned_start: at("2026-03-22", 9), planned_end: at("2026-03-22", 10) }];
    const on = (day: string) => spansOn(changes, day, TZ, (c) => c.planned_start, (c) => c.planned_end).map((c) => c.id);
    expect(on("2026-03-22")).toEqual(["2", "1"]);
    expect(on("2026-03-23")).toEqual(["1"]);
  });
});

describe("tones, KPIs, workbench, questionnaire", () => {
  it("tones and flags of a change", () => {
    expect(changeTone({ conflict_count: 2 })).toBe("danger");
    expect(changeTone({ in_blackout: true })).toBe("danger");
    expect(changeTone({ is_late: true })).toBe("warning");
    expect(changeTone({ conflict_status: "acknowledged" })).toBeNull();
    expect(flags({ conflict_count: 1, outside_window: true, on_hold: true })).toEqual(["1 تداخل باز", "بیرون از پنجرهٔ نگهداری", "متوقف"]);
  });

  it("KPI verdicts and calibration by risk band", () => {
    const { counts, rates } = kpiRows({ total: 10, implemented: 8, success_rate: 97.5, failure_rate: 20, unresolved_conflicts: 1, pir_completion: null });
    expect(rates.find((k) => k.key === "success_rate")!.verdict).toBe("good");
    expect(rates.find((k) => k.key === "failure_rate")!.verdict).toBe("bad");
    expect(rates.find((k) => k.key === "pir_completion")!.verdict).toBeNull();
    expect(counts.find((k) => k.key === "unresolved_conflicts")!.verdict).toBe("bad");
    expect(calibrated([{ implemented: 10, failure_rate: 2 }, { implemented: 6, failure_rate: 10 }, { implemented: 1, failure_rate: 0 }])).toBe(true);
    expect(calibrated([{ implemented: 10, failure_rate: 20 }, { implemented: 6, failure_rate: 10 }])).toBe(false);
    expect(calibrated([{ implemented: 2, failure_rate: 20 }])).toBeNull();
  });

  it("who may decide what on an agenda item", () => {
    const item = { kind: "authorize", decision: "pending" };
    const change = { state: "authorize" };
    const votes = { approved: 0, rejected: 0, open: 3, total: 3, my_approval: "a1" };
    expect(decisionsFor(item, change, votes, false)).toEqual({ vote: true, chair: [] });
    expect(decisionsFor(item, change, { ...votes, my_approval: null }, true)).toEqual({ vote: false, chair: ["deferred", "info_requested"] });
    expect(decisionsFor({ ...item, decision: "approved" }, change, votes, true)).toEqual({ vote: false, chair: [] });
    expect(decisionsFor({ kind: "pir", decision: "pending" }, { state: "review" }, undefined, true).chair).toEqual(["reviewed", "deferred"]);
    expect(voteText({ ...votes, approved: 2, open: 1 })).toBe("2 موافق، 0 مخالف از 3 (1 در انتظار)");
    expect(voteText(undefined)).toBe("رأیی خواسته نشده است");
  });

  it("questionnaire progress and what is sent", () => {
    const qs: QuestionView[] = [
      { id: "a", question: "الف", kind: "choice", weight: 1, mandatory: true, help: null, options: [{ value: "x", label: "x", score: 1 }] },
      { id: "b", question: "ب", kind: "number", weight: 1, mandatory: true, help: null, options: [{ value: "n", label: "n", score: 1, max: 10 }] },
      { id: "c", question: "پ", kind: "yes_no", weight: 1, mandatory: false, help: null, options: [] },
    ];
    expect(progress(qs, { a: "x", b: "" })).toEqual({ answered: 1, total: 3, missing: 1 });
    expect(cleanAnswers({ a: "x", b: "", c: null, d: 5 })).toEqual({ a: "x", d: 5 });
    expect(topFactors([{ key: "a", label: "", score: 10, weight: 1, detail: "" }, { key: "b", label: "", score: 5, weight: 10, detail: "" }], 1).map((f) => f.key)).toEqual(["b"]);
  });
});
