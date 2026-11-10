// The flows' shared model (src/shared/flows): data pills and JSON bodies, data comparisons, Jalali-friendly
// schedules and the cron parser, the graph validator and the trigger checks. Pure functions, no server.
import { describe, it, expect } from "vitest";
import {
  compareData, describeSchedule, nextOccurrence, parseCron, pillsOf, renderBody, renderTemplate, renderText, scheduleProblem,
  triggerProblems, validateGraph, hasErrors, zonedTime, type ScheduleSpec, type ValidateContext,
} from "@shared/flows";
import { fromJalali, monthLength } from "@shared/jalali";
import { E, N, graph, line } from "./flows-helpers";

const TZ = "Asia/Tehran";
/** a Jalali date and time in Tehran as epoch ms */
const jat = (jy: number, jm: number, jd: number, hh = 0, mm = 0) => zonedTime(fromJalali(jy, jm, jd), hh * 60 + mm, TZ);

describe("flows: data pills", () => {
  const data = {
    trigger: { record: { priority: 3, short_description: "چاپگر", watch_list: ["a", "b"], $labels: { priority: "متوسط" } } },
    vars: { name: "علی", n: 3, s: 'a"b' },
    steps: { http: { output: { items: [{ id: 7, name: "cpu" }, { id: 8, name: "ram" }] } } },
    item: { id: "x1" },
  };

  it("keeps the type of a value that is one pill and writes pills inside text", () => {
    expect(renderTemplate("{{trigger.record.priority}}", data)).toBe(3);
    expect(renderTemplate(" {{ vars.n }} ", data)).toBe(3);
    expect(renderTemplate("{{trigger.record.watch_list}}", data)).toEqual(["a", "b"]);
    expect(renderTemplate("سلام {{vars.name}} — {{trigger.record.$labels.priority}}", data)).toBe("سلام علی — متوسط");
    expect(renderText("{{trigger.record.watch_list}}", data)).toBe("a، b");
    expect(renderTemplate("{{steps.http.output.items[1].id}} / {{steps.http.output.items[name=cpu].id}}", data)).toBe("8 / 7");
    expect(renderTemplate({ a: ["{{item.id}}", "x{{vars.n}}"], b: 5 }, data)).toEqual({ a: ["x1", "x3"], b: 5 });
  });

  it("gives an empty value for a pill that names nothing", () => {
    expect(renderTemplate("{{vars.missing}}", data)).toBeUndefined();
    expect(renderTemplate("[{{vars.missing}}]", data)).toBe("[]");
    expect(renderTemplate("{{steps.nope.output.x}}", data)).toBeUndefined();
  });

  it("reads the clock in the organisation's zone, with offsets and Jalali parts", () => {
    // 2026-03-20 22:00 UTC = 1405/01/01 01:30 in Tehran (a Saturday)
    const env = { now: Date.UTC(2026, 2, 20, 22, 0), tz: TZ };
    expect(renderTemplate("{{today}}", {}, env)).toBe("2026-03-21");
    expect(renderTemplate("{{today + 3d}}", {}, env)).toBe("2026-03-24");
    expect(renderTemplate("{{today - 1w}}", {}, env)).toBe("2026-03-14");
    expect(renderTemplate("{{now + 2h}}", {}, env)).toBe("2026-03-21T00:00:00.000Z");
    expect(renderTemplate("{{jalali.year}}", {}, env)).toBe(1405);
    expect(renderTemplate("نگهداری {{jalali.month_name}} {{jalali.year}} ({{jalali.weekday}})", {}, env)).toBe("نگهداری فروردین 1405 (شنبه)");
    expect(renderTemplate("{{jalali}}", {}, env)).toBe("1405/01/01");
  });

  it("lists the pills a setting uses", () => {
    expect(pillsOf({ a: "{{vars.x}} and {{ steps.s1.output.y }}", b: ["{{item.z}}"] })).toEqual(["vars.x", "steps.s1.output.y", "item.z"]);
  });

  it("fills JSON bodies keeping types, and text bodies as text", () => {
    const b = renderBody('{"p": {{vars.n}}, "t": "{{vars.s}}", "list": {{trigger.record.watch_list}}}', data);
    expect(b.json).toBe(true);
    expect(JSON.parse(b.text)).toEqual({ p: 3, t: 'a"b', list: ["a", "b"] });
    expect(renderBody("نام: {{vars.name}}", data)).toEqual({ json: false, text: "نام: علی" });
    expect(renderBody("", data)).toEqual({ json: false, text: "" });
  });

  it("compares data: numbers as numbers (Persian digits too), text exactly, contains ignoring Persian variants", () => {
    expect(compareData("۱۰", "gt", 9)).toBe(true);
    expect(compareData("10", "lt", "9")).toBe(false);
    expect(compareData("abc", "eq", "abc")).toBe(true);
    expect(compareData("abc", "eq", "ABC")).toBe(false);
    expect(compareData("كيف", "contains", "کیف")).toBe(true);
    expect(compareData(["a", "b"], "contains", "b")).toBe(true);
    expect(compareData([], "empty", null)).toBe(true);
    expect(compareData("", "nempty", null)).toBe(false);
    expect(compareData(null, "gt", 1)).toBe(false);
    expect(compareData("x", "ncontains", "y")).toBe(true);
  });
});

describe("flows: schedules", () => {
  it("parses cron and refuses broken expressions", () => {
    expect(() => parseCron("* * *")).toThrow(/پنج بخش/);
    expect(() => parseCron("61 * * * *")).toThrow(/دقیقه/);
    expect(parseCron("*/15 9-17 * * 1-5").minute.filter(Boolean).length).toBe(4);
  });

  it("finds the next cron time in the organisation's zone", () => {
    // Saturday 2026-03-21 → Monday 2026-03-23 09:30 Tehran = 06:00 UTC
    expect(nextOccurrence({ kind: "cron", expr: "30 9 * * 1" }, Date.UTC(2026, 2, 21, 0, 0), TZ)).toBe(Date.UTC(2026, 2, 23, 6, 0));
    // day-of-month OR day-of-week when both are restricted
    expect(nextOccurrence({ kind: "cron", expr: "0 0 1 * 0" }, Date.UTC(2026, 2, 21, 0, 0), "UTC")).toBe(Date.UTC(2026, 2, 22, 0, 0));
  });

  it("repeats daily and on chosen days of the Persian week", () => {
    // 08:30 Tehran has passed → tomorrow 08:00 Tehran
    expect(nextOccurrence({ kind: "daily", time: "08:00" }, Date.UTC(2026, 2, 21, 5, 0), TZ)).toBe(Date.UTC(2026, 2, 22, 4, 30));
    // Wednesday 2026-03-25 afternoon → Saturday 2026-03-28 08:00 (Thursday and Friday are not workdays)
    const workdays: ScheduleSpec = { kind: "weekly", time: "08:00", weekdays: [0, 1, 2, 3, 4] };
    expect(nextOccurrence(workdays, Date.UTC(2026, 2, 25, 10, 0), TZ)).toBe(Date.UTC(2026, 2, 28, 4, 30));
  });

  it("counts Jalali months: a day of the month, the last day, chosen months, day 31 only where it exists", () => {
    expect(nextOccurrence({ kind: "monthly", time: "09:00", days: [1] }, jat(1405, 1, 5), TZ)).toBe(jat(1405, 2, 1, 9));
    const last = monthLength(1405, 12);
    expect(nextOccurrence({ kind: "monthly", time: "09:00", days: [], last: true }, jat(1405, 12, 1), TZ)).toBe(jat(1405, 12, last, 9));
    expect(nextOccurrence({ kind: "monthly", time: "09:00", days: [1], months: [1, 4, 7, 10] }, jat(1405, 1, 2), TZ)).toBe(jat(1405, 4, 1, 9));
    expect(nextOccurrence({ kind: "monthly", time: "09:00", days: [31] }, jat(1405, 6, 31, 10), TZ)).toBe(jat(1406, 1, 31, 9));
  });

  it("repeats yearly on a Jalali date, at intervals, and once", () => {
    expect(nextOccurrence({ kind: "yearly", time: "09:00", month: 1, day: 1 }, jat(1405, 1, 1, 10), TZ)).toBe(jat(1406, 1, 1, 9));
    // month-end aware: 30 Esfand (a leap year's last day) runs on 29 Esfand of a common year, not years later
    expect(nextOccurrence({ kind: "yearly", time: "09:00", month: 12, day: 30 }, jat(1404, 1, 1), TZ)).toBe(jat(1404, 12, 29, 9));
    expect(nextOccurrence({ kind: "yearly", time: "09:00", month: 12, day: 30 }, jat(1408, 1, 1), TZ)).toBe(jat(1408, 12, 30, 9));
    const start = "2026-03-21T00:00:00.000Z";
    expect(nextOccurrence({ kind: "interval", every: 15, unit: "minute", start }, Date.parse("2026-03-21T00:20:00Z"), TZ)).toBe(Date.parse("2026-03-21T00:30:00Z"));
    expect(nextOccurrence({ kind: "interval", every: 2, unit: "hour" }, 1000, TZ)).toBe(1000 + 7_200_000);
    expect(nextOccurrence({ kind: "once", at: "2026-01-01T00:00:00Z" }, Date.UTC(2026, 5, 1), TZ)).toBeNull();
  });

  it("explains what is wrong with a schedule and describes it in Persian", () => {
    expect(scheduleProblem({ kind: "interval", every: 2, unit: "minute" })).toMatch(/دست‌کم/);
    expect(scheduleProblem({ kind: "weekly", time: "08:00", weekdays: [] })).toMatch(/روزهای هفته/);
    expect(scheduleProblem({ kind: "yearly", time: "08:00", month: 7, day: 31 })).toMatch(/روز/);
    expect(scheduleProblem({ kind: "daily", time: "25:00" })).toMatch(/ساعت/);
    expect(scheduleProblem({ kind: "monthly", time: "09:00", days: [1] })).toBeNull();
    expect(describeSchedule({ kind: "weekly", time: "08:00", weekdays: [0, 1, 2, 3, 4] })).toBe("هر شنبه تا چهارشنبه ساعت ۰۸:۰۰");
    expect(describeSchedule({ kind: "monthly", time: "09:00", days: [], last: true, months: [1, 7] })).toBe("آخرین روز هر ماه ساعت ۰۹:۰۰ در فروردین و مهر");
    expect(describeSchedule({ kind: "interval", every: 15, unit: "minute" })).toBe("هر ۱۵ دقیقه");
  });
});

describe("flows: graph validation", () => {
  const values = { values: { priority: "1" } };
  const fieldsOf = (t: string) =>
    t === "todo"
      ? [
          { name: "priority", label: "اولویت", type: "choice" },
          { name: "short_description", label: "عنوان", type: "string" },
          { name: "reopen_count", label: "بازگشایی", type: "int", readonly: true },
        ]
      : undefined;
  const ctx: ValidateContext = { trigger: { kind: "record", table: "todo", run_as: "trigger_user" }, fieldsOf };
  const errors = (g: unknown, c = ctx) => validateGraph(g, c).filter((p) => p.level === "error");
  const warnings = (g: unknown, c = ctx) => validateGraph(g, c).filter((p) => p.level === "warning");

  it("accepts a sound flow", () => {
    expect(errors(line(N("u", "update_record", values), N("c", "add_comment", { body: "{{steps.u.output.id}}" })))).toEqual([]);
  });

  it("needs exactly one trigger and edges between existing nodes", () => {
    expect(hasErrors(validateGraph({ nodes: [N("u", "update_record", values)], edges: [] }))).toBe(true);
    expect(errors({ nodes: [N("a", "trigger"), N("b", "trigger")], edges: [] })[0].message).toMatch(/فقط یک/);
    expect(errors(graph([], [E("trigger", "ghost")]))[0].message).toMatch(/ناموجود/);
    expect(validateGraph("nonsense")[0].message).toMatch(/معتبر نیست/);
  });

  it("refuses cycles, unknown ports and two edges from one port (parallel excepted)", () => {
    const cyc = graph([N("a", "set_vars", { vars: [{ name: "x", value: 1 }] }), N("b", "set_vars", { vars: [{ name: "y", value: 1 }] })], [E("trigger", "a"), E("a", "b"), E("b", "a")]);
    expect(errors(cyc).some((p) => /دور/.test(p.message))).toBe(true);
    expect(errors(graph([N("a", "update_record", values)], [E("trigger", "a", "nope")]))[0].message).toMatch(/خروجی/);
    const two = graph([N("a", "update_record", values), N("b", "update_record", values)], [E("trigger", "a"), E("trigger", "b")]);
    expect(errors(two).some((p) => /اجرای موازی/.test(p.message))).toBe(true);
    const par = graph([N("p", "parallel"), N("a", "update_record", values), N("b", "update_record", values), N("j", "join")], [E("trigger", "p"), E("p", "a"), E("p", "b"), E("a", "j"), E("b", "j")]);
    expect(errors(par)).toEqual([]);
    expect(warnings(par)).toEqual([]);
  });

  it("checks node settings: required values, fields of the table, read-only fields", () => {
    expect(errors(line(N("u", "update_record", {}))).map((p) => p.field)).toContain("values");
    expect(errors(line(N("u", "update_record", { values: { nope: 1 } })))[0].message).toMatch(/nope/);
    expect(errors(line(N("u", "update_record", { values: { reopen_count: 1 } })))[0].message).toMatch(/فقط‌خواندنی/);
    expect(errors(line(N("h", "call_http", {}))).map((p) => p.field)).toContain("connection");
    expect(errors(line(N("v", "set_vars", { vars: [{ name: "bad name", value: 1 }] })))[0].message).toMatch(/معتبر نیست/);
    expect(errors(line(N("w", "wait_duration", { duration: { amount: 0, unit: "hour" } }))).length).toBeGreaterThan(0);
    // a record step on a flow without a trigger table needs its own table
    const manual = { ...ctx, trigger: { kind: "manual" as const, run_as: "trigger_user" as const } };
    expect(errors(line(N("u", "update_record", values)), manual).map((p) => p.field)).toContain("table");
  });

  it("checks data pills: unknown steps, steps that do not run before, items outside loops", () => {
    expect(errors(line(N("c", "add_comment", { body: "{{steps.ghost.output.x}}" })))[0].message).toMatch(/ghost/);
    const g = graph(
      [N("a", "add_comment", { body: "{{steps.b.output.id}} {{item.id}}" }), N("b", "update_record", values)],
      [E("trigger", "a"), E("a", "b")],
    );
    const w = warnings(g).map((p) => p.message);
    expect(w.some((m) => /پیش از این گام/.test(m))).toBe(true);
    expect(w.some((m) => /مورد جاری/.test(m))).toBe(true);
    const loop = graph([N("l", "for_each", { table: "todo" }), N("u", "update_record", { record: "{{item.id}}", values: { priority: "{{item.priority}}" } })], [E("trigger", "l"), E("l", "u", "each")]);
    expect(warnings(loop)).toEqual([]);
    expect(warnings(graph([N("x", "update_record", values)], [])).some((p) => /وصل نیست/.test(p.message))).toBe(true);
  });

  it("checks trigger settings", () => {
    expect(triggerProblems({ kind: "record", run_as: "trigger_user" }).map((p) => p.field)).toEqual(["trigger_table", "trigger_events"]);
    expect(triggerProblems({ kind: "record", table: "todo", events: ["updated"], fields: ["nope"], run_as: "trigger_user" }, { fieldsOf })[0].field).toBe("trigger_fields");
    expect(triggerProblems({ kind: "manual", run_as: "user" })[0].field).toBe("run_as_user");
    expect(triggerProblems({ kind: "manual", run_as: "system" })).toEqual([]);
  });
});
