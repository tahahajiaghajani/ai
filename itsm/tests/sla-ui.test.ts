// The pure logic of the SLA service's screens (src/ui/modules/sla/model.ts): the week editor (typing times, adding,
// copying, checking, totals, day bars, the next two weeks with holidays), the SLA timeline preview, the targets per
// priority, the approval-rule builder's sentences, the priority matrix grid, the category tree, holidays by Jalali
// month, due states and a record's approval steps.
import { describe, it, expect } from "vitest";
import { DEFAULT_HOURS, FULL_HOURS, calendarOf, localInstant } from "@shared/sla/calendar";
import { ITIL_MATRIX } from "@shared/sla/rules";
import { fromJalali } from "@shared/jalali";
import {
  approvalSteps, axisLabels, categoryTree, copyDayTo, dayBars, dayProblem, dueState, durationsDraft, durationsValue, holidaysByMonth, levelSentence, matrixDraft,
  matrixValue, minutesText, moveItem, nextInterval, normalizeTime, ruleText, setCell, slaPreview, sourceText, suggestCode, upcomingDays, weekDraft,
  weekTotals, withDay, type Names,
} from "../src/ui/modules/sla/model";

const TZ = "Asia/Tehran";
const H = 3_600_000;

describe("week editor", () => {
  it("reads the stored week and tidies typed times", () => {
    expect(weekDraft(DEFAULT_HOURS)[0]).toEqual([["08:00", "16:00"]]);
    expect(weekDraft(null)).toEqual([[], [], [], [], [], [], []]);
    expect(weekDraft([[["8", 9], "junk"]])[0]).toEqual([["8", "9"]]);
    expect(normalizeTime("۸")).toBe("08:00");
    expect(normalizeTime("830")).toBe("08:30");
    expect(normalizeTime("8.30")).toBe("08:30");
    expect(normalizeTime(" 17:5 ")).toBe(" 17:5 ");
    expect(normalizeTime("24")).toBe("24:00");
    expect(normalizeTime("25")).toBe("25");
  });

  it("adds an interval after the day's last one, while there is room", () => {
    expect(nextInterval([])).toEqual(["08:00", "16:00"]);
    expect(nextInterval([["08:00", "12:00"]])).toEqual(["13:00", "17:00"]);
    expect(nextInterval([["08:00", "21:00"]])).toEqual(["22:00", "24:00"]);
    expect(nextInterval([["08:00", "23:30"]])).toBeNull();
    expect(nextInterval([["22:00", "06:00"]])).toBeNull();
  });

  it("changes and copies days without touching the others", () => {
    const week = weekDraft(DEFAULT_HOURS);
    const changed = withDay(week, 5, [["08:00", "13:00"]]);
    expect(changed[5]).toEqual([["08:00", "13:00"]]);
    expect(week[5]).toEqual([["08:00", "12:00"]]);
    const copied = copyDayTo(changed, 5, [0, 1, 6]);
    expect(copied[0]).toEqual([["08:00", "13:00"]]);
    expect(copied[6]).toEqual([["08:00", "13:00"]]);
    expect(copied[2]).toEqual([["08:00", "16:00"]]);
    copied[0][0][0] = "09:00";
    expect(changed[5][0][0]).toBe("08:00");
  });

  it("checks a day and adds up the week", () => {
    expect(dayProblem([["08:00", "12:00"], ["11:00", "14:00"]])).toContain("هم‌پوشانی");
    expect(dayProblem([["8:61", "12:00"]])).toContain("معتبر");
    expect(dayProblem([["22:00", "06:00"]])).toBeNull();
    const t = weekTotals(weekDraft(DEFAULT_HOURS));
    expect(t.perDay).toEqual([480, 480, 480, 480, 480, 240, 0]);
    expect(t.total).toBe(2640);
    expect(weekTotals(weekDraft(FULL_HOURS)).total).toBe(7 * 1440);
    expect(minutesText(2640)).toBe("۴۴ ساعت");
    expect(minutesText(450)).toBe("۷ ساعت و ۳۰ دقیقه");
    expect(minutesText(45)).toBe("۴۵ دقیقه");
    expect(minutesText(0)).toBe("—");
  });

  it("draws a day on a 24-hour bar, with the tail of the previous night's shift", () => {
    const week = withDay(weekDraft([]), 0, [["22:00", "06:00"], ["10:00", "12:00"]]);
    expect(dayBars(week, 0)).toEqual([{ from: 41.67, to: 50 }, { from: 91.67, to: 100, overnight: true }]);
    expect(dayBars(week, 1)).toEqual([{ from: 0, to: 25, carry: true }]);
    expect(dayBars(withDay(weekDraft([]), 3, [["20:00", "00:00"]]), 3)).toEqual([{ from: 83.33, to: 100 }]);
    expect(dayBars(withDay(weekDraft([]), 3, [["20:00", "00:00"]]), 4)).toEqual([]);
  });

  it("shows the next days as the calendar counts them, holidays and half days included", () => {
    const sat = fromJalali(1405, 8, 16); // a Saturday
    const days = upcomingDays(weekDraft(DEFAULT_HOURS), TZ, [{ date: fromJalali(1405, 8, 18), title: "تعطیل آزمایشی" }, { date: fromJalali(1405, 8, 19), half: true }], sat, 7);
    expect(days.map((d) => d.weekday)).toEqual(["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"]);
    expect(days.map((d) => d.minutes)).toEqual([480, 480, 0, 240, 480, 240, 0]);
    expect(days[2].holiday).toEqual({ title: "تعطیل آزمایشی", half: false });
    expect(days[3].holiday).toMatchObject({ half: true });
    // an overnight shift is counted in the hours of each local day it covers
    const night = upcomingDays(withDay(weekDraft([]), 0, [["22:00", "06:00"]]), TZ, [], sat, 2);
    expect(night.map((d) => d.minutes)).toEqual([120, 360]);
  });
});

describe("SLA definition preview", () => {
  it("places the warnings and the deadline of a round-the-clock target", () => {
    const start = Date.parse("2026-11-07T08:00:00Z");
    const p = slaPreview({ duration: 4 * 3600, warn: [50, 75, 90], cal: null, start });
    expect(p.end).toBe(start + 4 * H);
    expect(p.marks.map((m) => [m.kind, m.pct, m.pos])).toEqual([["start", 0, 0], ["warn", 50, 50], ["warn", 75, 75], ["warn", 90, 90], ["breach", 100, 100]]);
    expect(p.marks[1].at).toBe(start + 2 * H);
    expect(p.working).toEqual([[0, 100]]);
    expect(p.wallMs).toBe(4 * H);
  });

  it("follows the working calendar across the night and the weekend", () => {
    const cal = calendarOf({ timezone: TZ, hours: DEFAULT_HOURS });
    const wed = fromJalali(1405, 8, 20); // a Wednesday
    const start = localInstant(wed, 15 * 60, TZ);
    const p = slaPreview({ duration: 2 * 3600, warn: "50", cal, start });
    // one hour on Wednesday, one on Thursday morning
    expect(p.end).toBe(localInstant(fromJalali(1405, 8, 21), 9 * 60, TZ));
    expect(p.marks.find((m) => m.kind === "warn")!.at).toBe(localInstant(wed, 16 * 60, TZ));
    expect(p.working).toHaveLength(2);
    expect(p.working[0][0]).toBe(0);
    expect(p.working[1][1]).toBe(100);
    // past Thursday noon the target runs over Friday into Saturday
    const thu = localInstant(fromJalali(1405, 8, 21), 11 * 60, TZ);
    expect(slaPreview({ duration: 2 * 3600, warn: [], cal, start: thu }).end).toBe(localInstant(fromJalali(1405, 8, 23), 9 * 60, TZ));
  });

  it("keeps the axis readable: crowded warning labels give way to the deadline", () => {
    const m = (kind: "start" | "warn" | "breach", pos: number) => ({ kind, pos });
    expect(axisLabels([m("start", 0), m("warn", 50), m("warn", 75), m("warn", 90), m("breach", 100)])).toEqual([true, true, true, true, true]);
    expect(axisLabels([m("start", 0), m("warn", 2), m("warn", 80), m("warn", 92), m("warn", 97), m("breach", 100)])).toEqual([true, false, true, true, false, true]);
  });

  it("has nothing to show without a target or working time", () => {
    expect(slaPreview({ duration: null, warn: [50], cal: null, start: 0 }).end).toBeNull();
    const none = calendarOf({ timezone: TZ, hours: [[], [], [], [], [], [], []] });
    const p = slaPreview({ duration: 3600, warn: [50], cal: none, start: Date.now() });
    expect(p.duration).toBe(3600);
    expect(p.end).toBeNull();
  });

  it("keeps one target per priority option", () => {
    const opts = ["1", "2", "3"].map((value) => ({ value, label: value }));
    const d = durationsDraft({ "1": 3600, "2": "0", "9": 50 }, opts);
    expect(d).toEqual({ "1": 3600, "2": null, "3": null });
    expect(durationsValue({ ...d, "3": 7200.4 })).toEqual({ "1": 3600, "3": 7200 });
  });
});

describe("approval rule builder", () => {
  const names: Names = { user: (id) => ({ u1: "علی", u2: "رضا", u3: "مینا" })[id], group: (id) => (id === "g1" ? "شبکه" : undefined), field: (n) => (n === "manager_id" ? "مدیر" : undefined) };

  it("reads levels as sentences", () => {
    expect(sourceText({ kind: "manager" }, names)).toBe("مدیر درخواست‌دهنده");
    expect(sourceText({ kind: "manager", depth: 2 }, names)).toBe("مدیرِ مدیر درخواست‌دهنده");
    expect(sourceText({ kind: "users", users: ["u1", "u2"] }, names)).toBe("علی و رضا");
    expect(sourceText({ kind: "users", users: ["u1", "u2", "u3"] }, names)).toBe("علی، رضا و ۱ نفر دیگر");
    expect(sourceText({ kind: "users", users: ["u1", "x"] }, names)).toBe("۲ نفر");
    expect(sourceText({ kind: "groups", groups: ["g1"] }, names)).toBe("اعضای «شبکه»");
    expect(sourceText({ kind: "groups", groups: ["g1", "g2"] }, names)).toBe("اعضای ۲ گروه");
    expect(sourceText({ kind: "field", field: "manager_id" }, names)).toBe("کسی که در «مدیر» آمده است");
    expect(ruleText("any")).toBe("یک تأیید کافی است");
    expect(ruleText("all")).toBe("همه باید تأیید کنند");
    expect(ruleText("count", 2)).toBe("۲ نفر باید تأیید کنند");
    expect(ruleText("percent", 60)).toBe("۶۰٪ باید تأیید کنند");
    expect(levelSentence({ name: "مالی", sources: [{ kind: "manager" }, { kind: "groups", groups: ["g1"] }], rule: "count", threshold: 2 }, 1, names)).toBe(
      "سطح ۲ (مالی): مدیر درخواست‌دهنده یا اعضای «شبکه» — ۲ نفر باید تأیید کنند",
    );
  });

  it("moves levels", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a"], 0, 3)).toEqual(["a"]);
  });
});

describe("priority matrix grid", () => {
  it("round-trips the ITIL grid and leaves empty cells out", () => {
    const opts = ["1", "2", "3"];
    const m = matrixDraft(ITIL_MATRIX, opts, opts);
    expect(m["1"]["1"]).toBe("1");
    expect(matrixValue(m)).toEqual(ITIL_MATRIX);
    const cleared = setCell(m, "3", "3", null);
    expect(matrixValue(cleared)["3"]).toEqual({ "1": "3", "2": "4" });
    expect(m["3"]["3"]).toBe("5");
    expect(matrixDraft(null, ["1"], ["1", "2"])).toEqual({ "1": { "1": null, "2": null } });
  });
});

describe("categories, holidays, approvals", () => {
  it("builds the category tree in order", () => {
    const rows = [
      { id: "b", name: "نرم‌افزار", value: "software", sort_order: 20 },
      { id: "a", name: "سخت‌افزار", value: "hardware", sort_order: 10 },
      { id: "a2", name: "چاپگر", value: "printer", parent_id: "a", sort_order: 20 },
      { id: "a1", name: "لپ‌تاپ", value: "laptop", parent_id: "a", sort_order: 20 },
      { id: "x", name: "یتیم", value: "orphan", parent_id: "gone" },
    ];
    const tree = categoryTree(rows);
    expect(tree.map((n) => n.row.id)).toEqual(["a", "b", "x"]);
    expect(tree[0].children.map((n) => n.row.name)).toEqual(["چاپگر", "لپ‌تاپ"]);
    expect(suggestCode("Network Devices", new Set())).toBe("network_devices");
    expect(suggestCode("VPN", new Set(["vpn"]))).toBe("vpn_2");
    expect(suggestCode("شبکه", new Set())).toBe("");
  });

  it("groups a Jalali year's holidays by month", () => {
    const rows = [
      { id: "3", date: fromJalali(1405, 2, 14), title: "رحلت امام" },
      { id: "1", date: fromJalali(1405, 1, 1), title: "نوروز" },
      { id: "2", date: fromJalali(1405, 1, 12), title: "روز جمهوری" },
      { id: "4", date: fromJalali(1406, 1, 1), title: "نوروز بعد" },
    ];
    const months = holidaysByMonth(rows, 1405);
    expect(months.map((m) => [m.label, m.items.map((x) => x.id)])).toEqual([["فروردین", ["1", "2"]], ["اردیبهشت", ["3"]]]);
  });

  it("tells how close a deadline is", () => {
    const now = Date.parse("2026-11-07T10:00:00Z");
    expect(dueState(null, now)).toEqual({ tone: null, text: "" });
    expect(dueState("2026-11-07T09:00:00Z", now)).toEqual({ tone: "danger", text: "مهلت گذشته" });
    expect(dueState("2026-11-07T13:30:00Z", now)).toEqual({ tone: "warning", text: "۳ ساعت تا پایان مهلت" });
    expect(dueState("2026-11-07T10:20:00Z", now)).toEqual({ tone: "warning", text: "۲۰ دقیقه تا پایان مهلت" });
    expect(dueState("2026-11-09T10:00:00Z", now).tone).toBeNull();
  });

  it("shows a record's approvals as steps, newest round first", () => {
    const rows = [
      { id: "1", rule_id: "r", rule_name: "خرید", round: 1, level: 1, state: "rejected", rule: "any" },
      { id: "2", rule_id: "r", rule_name: "خرید", round: 2, level: 2, level_name: "مالی", state: "waiting", rule: "all" },
      { id: "3", rule_id: "r", rule_name: "خرید", round: 2, level: 1, state: "approved", rule: "any" },
      { id: "4", rule_id: null, rule_name: "درخواست موردی", round: 1, level: 1, state: "requested", rule: "count", threshold: 2 },
      { id: "5", rule_id: "r", rule_name: "خرید", round: 2, level: 2, level_name: "مالی", state: "waiting", rule: "all" },
    ];
    const steps = approvalSteps(rows);
    expect(steps.map((s) => [s.title, s.rows.map((r) => r.id)])).toEqual([
      ["خرید · سطح ۱ · دور ۲", ["3"]],
      ["خرید · مالی · دور ۲", ["2", "5"]],
      ["درخواست موردی", ["4"]],
      ["خرید · سطح ۱", ["1"]],
    ]);
    expect(steps[1].rule).toBe("همه باید تأیید کنند");
    expect(steps[2].rule).toBe("۲ نفر باید تأیید کنند");
  });
});
