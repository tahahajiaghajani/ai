// The pure model of analytics (src/shared/analytics, src/ui/modules/analytics/model.ts): formulas, Jalali periods and
// KPI status, definitions and their validation, drill-down conditions, the dashboard grid, sharing compilation, the
// export bundle, the rule-based question parser, the KPI library against the real schema, and the screens' chart
// shaping (series, «سایر», Pareto, matrices, the gallery's fit, the gauge).
import { describe, it, expect } from "vitest";
import { computeFormula, formulaProblem, formulaVars, parseFormula, FormulaError } from "@shared/analytics/formula";
import { deltaPct, improved, kpiStatus, partFilter, periodOf, periodsBack, indicatorProblem, formatValue } from "@shared/analytics/kpi";
import { addWidget, cleanLayout, compact, collides, moveWidget, nudge, resizeWidget, freeSpot, COLS } from "@shared/analytics/layout";
import { compileShares, cleanShares, sharesProblem, bundleProblem, layoutFromBundle, layoutToBundle, makeBundle } from "@shared/analytics/share";
import { applyDashboardFilters, bucketDates, drillCond, normalizeSpec, previousTime, specProblem, starterSpec, suggestViz, timeCond, drillDown } from "@shared/analytics/model";
import { KPI_LIBRARY, LIBRARY_DASHBOARDS, dashboardsFor, libraryFor } from "@shared/analytics/library";
import { parseQuestion, type NlTable } from "@shared/analytics/nl";
import type { ReportResult, ReportSpec, Widget } from "@shared/analytics/types";
import { tableDef, TABLES } from "@shared/tables";
import { chartData, deltaTone, elementCond, gaugeShare, matrix, nextDrill, paretoData, vizFits, recordsHref, MAX_SERIES } from "../src/ui/modules/analytics/model";
import { resolveLayout, seededShares } from "@server/modules/analytics/seed";

const lookup = (k: string) => tableDef(k);
const incident = tableDef("incident")!;
const TZ = "Asia/Tehran";
// 1405-08-18 (9 November 2026), 10:00 in Tehran
const NOW = Date.parse("2026-11-09T06:30:00Z");

describe("formulas", () => {
  it("parse and evaluate with precedence, functions, Persian digits and null rules", () => {
    expect(computeFormula("met / total * 100", { met: 45, total: 60 })).toBe(75);
    expect(computeFormula("(a + b) * 2 - c", { a: 1, b: 2, c: 1 })).toBe(5);
    expect(computeFormula("a / b", { a: 1, b: 0 })).toBeNull();
    expect(computeFormula("ifnull(a, 0) + 1", { a: null })).toBe(1);
    expect(computeFormula("round(a / 3, 2)", { a: 10 })).toBe(3.33);
    expect(computeFormula("max(a, b) - min(a, b)", { a: 3, b: 8 })).toBe(5);
    expect(computeFormula("a × ۲", { a: 4 })).toBe(8);
    expect(computeFormula("-a", { a: 2 })).toBe(-2);
    expect([...formulaVars(parseFormula("first / resolved * 100"))].sort()).toEqual(["first", "resolved"]);
  });

  it("refuse bad formulas in Persian", () => {
    expect(() => parseFormula("a +")).toThrow(FormulaError);
    expect(() => parseFormula("a; drop")).toThrow(FormulaError);
    expect(formulaProblem("x / y", ["x"])).toMatch(/y/);
    expect(formulaProblem("x / 2", ["x"])).toBeNull();
  });
});

describe("Jalali periods and KPI status", () => {
  it("periods follow the Jalali calendar in the organisation's time zone", () => {
    const m = periodOf("month", NOW, TZ);
    expect(m.key).toBe("1405-08");
    expect(m.start).toBe("2026-10-23");
    expect(m.end).toBe("2026-11-22");
    expect(periodOf("month", NOW, TZ, -1).key).toBe("1405-07");
    const w = periodOf("week", NOW, TZ);
    expect(new Date(`${w.start}T12:00:00Z`).getUTCDay()).toBe(6); // Saturday
    expect(periodOf("year", NOW, TZ).key).toBe("1405");
    expect(periodOf("quarter", NOW, TZ).key).toBe("1405-Q3");
    const back = periodsBack("month", NOW, TZ, 3);
    expect(back.map((p) => p.key)).toEqual(["1405-06", "1405-07", "1405-08"]);
  });

  it("a part's period filter: its own condition with $start/$end bound, or the date field's range", () => {
    const bounds = { start: "2026-10-22T20:30:00.000Z", end: "2026-11-21T20:30:00.000Z" };
    expect(partFilter({ name: "x", table: "incident", fn: "count", date_field: "opened_at" }, bounds)).toEqual({ and: [{ f: "opened_at", op: "gte", v: bounds.start }, { f: "opened_at", op: "lt", v: bounds.end }] });
    expect(partFilter({ name: "x", table: "incident", fn: "count", filter: { f: "resolved_at", op: "gte", v: "$start" } }, bounds)).toEqual({ f: "resolved_at", op: "gte", v: bounds.start });
    expect(partFilter({ name: "x", table: "incident", fn: "count", filter: { f: "active", op: "eq", v: true } }, bounds)).toEqual({ f: "active", op: "eq", v: true });
  });

  it("status by direction, thresholds and target; deltas and their tone", () => {
    const down = { direction: "down" as const, target: 900, warn: 1800, crit: 3600 };
    expect(kpiStatus(600, down)).toBe("good");
    expect(kpiStatus(2000, down)).toBe("warn");
    expect(kpiStatus(4000, down)).toBe("bad");
    const up = { direction: "up" as const, target: 70, warn: 60, crit: 45 };
    expect(kpiStatus(40, up)).toBe("bad");
    expect(kpiStatus(55, up)).toBe("warn");
    expect(kpiStatus(75, up)).toBe("good");
    expect(kpiStatus(50, { direction: "up", target: 70, warn: null, crit: null })).toBe("warn");
    expect(kpiStatus(50, { direction: "none", target: 70, warn: null, crit: null })).toBe("none");
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(1, 0)).toBeNull();
    expect(improved(-10, "down")).toBe(true);
    expect(deltaTone(-10, "down")).toBe("ok");
    expect(deltaTone(10, "down")).toBe("bad");
    expect(deltaTone(10, "none")).toBe("neutral");
    expect(formatValue(5400, "duration")).toMatch(/ساعت/);
    expect(formatValue(75, "percent")).toContain("٪");
  });
});

describe("report definitions", () => {
  const spec = (s: Partial<ReportSpec>): ReportSpec => ({ v: 1, table: "incident", measures: [{ fn: "count" }], dims: [], viz: "score", ...s });

  it("are validated against the table: shapes, fields, measures, buckets, ranges, time", () => {
    expect(specProblem(spec({}), incident, lookup)).toBeNull();
    expect(specProblem(spec({ viz: "pie", dims: [] }), incident, lookup)).toMatch(/بُعد/);
    expect(specProblem(spec({ viz: "heatmap", dims: [{ field: "opened_at", bucket: "weekday" }, { field: "opened_at", bucket: "hour_of_day" }] }), incident, lookup)).toBeNull();
    expect(specProblem(spec({ measures: [{ fn: "sum", field: "short_description" }] }), incident, lookup)).toMatch(/عددی نیست/);
    expect(specProblem(spec({ measures: [{ fn: "avg" }] }), incident, lookup)).toMatch(/فیلد/);
    expect(specProblem(spec({ measures: [{ fn: "ratio" }] }), incident, lookup)).toMatch(/شرط/);
    expect(specProblem(spec({ dims: [{ field: "nope" }], viz: "column" }), incident, lookup)).toMatch(/nope/);
    expect(specProblem(spec({ dims: [{ field: "priority", bucket: "month" }], viz: "column" }), incident, lookup)).toMatch(/تاریخ نیست/);
    expect(specProblem(spec({ dims: [{ field: "opened_at", ranges: [7, 3] }], viz: "column" }), incident, lookup)).toMatch(/صعودی/);
    expect(specProblem(spec({ compare: true }), incident, lookup)).toMatch(/بازهٔ زمانی/);
    expect(specProblem(spec({ dims: [{ field: "assignment_group_id.name" }], viz: "bar" }), incident, lookup)).toBeNull();
    expect(specProblem(spec({ dims: [{ field: "x;drop" }], viz: "bar" }), incident, lookup)).toBeTruthy();
    expect(specProblem(spec({ viz: "list", measures: [], columns: ["number", "nope"] }), incident, lookup)).toMatch(/nope/);
  });

  it("normalize, starter definitions, time conditions and the previous period", () => {
    const n = normalizeSpec({ ...spec({ viz: "list", measures: [{ fn: "count" }] }), junk: 1 } as never);
    expect(n.measures).toEqual([]);
    expect("junk" in n).toBe(false);
    const s = starterSpec(incident);
    expect(s.dims[0].field).toBe("state");
    expect(s.time?.field).toBe("opened_at");
    expect(timeCond({ field: "opened_at", from: "2026-01-01", to: "2026-01-31" })).toEqual({ and: [{ f: "opened_at", op: "gte", v: "2026-01-01" }, { f: "opened_at", op: "lt", v: "2026-02-01" }] });
    expect(previousTime({ field: "opened_at", window: { unit: "day", from: -29, to: 0 } })?.window).toEqual({ unit: "day", from: -59, to: -30 });
    expect(previousTime({ field: "opened_at", from: "2026-01-11", to: "2026-01-20" })).toEqual({ field: "opened_at", from: "2026-01-01", to: "2026-01-10" });
  });

  it("drill conditions for choices, Jalali buckets, ranges and ages; none for weekdays", () => {
    const opts = { tz: TZ, now: NOW, lookup };
    expect(drillCond(incident, { field: "priority" }, "1", opts)).toEqual({ f: "priority", op: "eq", v: "1" });
    expect(drillCond(incident, { field: "priority" }, null, opts)).toEqual({ f: "priority", op: "empty" });
    const month = drillCond(incident, { field: "opened_at", bucket: "month" }, "1405-08", opts) as { and: { v: string }[] };
    expect(month.and[0].v).toBe(new Date(Date.parse("2026-10-22T20:30:00Z")).toISOString());
    expect(drillCond(incident, { field: "opened_at", bucket: "weekday" }, 2, opts)).toBeNull();
    const age = drillCond(incident, { field: "opened_at", ranges: [1, 7] }, 1, opts) as { and: { op: string }[] };
    expect(age.and.map((x) => x.op)).toEqual(["lte", "gt"]);
    expect(bucketDates("1405-Q3", "quarter")).toEqual({ start: "2026-09-23", end: "2026-12-22" });
    const d = drillDown(spec({ dims: [{ field: "priority" }], viz: "column", options: { drill: ["priority", "category"] } }), { f: "priority", op: "eq", v: "1" }, "category");
    expect(d.dims[0].field).toBe("category");
    expect(d.filter).toEqual({ f: "priority", op: "eq", v: "1" });
  });

  it("dashboard controls apply to the widgets whose table has the field", () => {
    const r = applyDashboardFilters(spec({ time: { field: "opened_at", window: { unit: "day", from: -29, to: 0 } } }), incident, [{ key: "t", kind: "time", label: "زمان" }, { key: "g", kind: "field", field: "assignment_group_id", label: "گروه" }, { key: "x", kind: "field", field: "nope", label: "؟" }], { t: { unit: "month", from: 0, to: 0 }, g: ["a", "b"], x: ["1"] }, lookup);
    expect(r.applied).toEqual(["t", "g"]);
    expect(r.ignored).toEqual(["x"]);
    expect(r.spec.time?.window).toEqual({ unit: "month", from: 0, to: 0 });
    expect(r.spec.filter).toEqual({ f: "assignment_group_id", op: "in", v: ["a", "b"] });
  });

  it("the chart suggestion follows the rules", () => {
    expect(suggestViz([], 1)).toBe("score");
    expect(suggestViz([{ type: "datetime", bucket: "month" }], 1)).toBe("line");
    expect(suggestViz([{ type: "datetime", bucket: "weekday" }, { type: "datetime", bucket: "hour_of_day" }], 1)).toBe("heatmap");
    expect(suggestViz([{ type: "choice", options: 4 }], 1)).toBe("donut");
    expect(suggestViz([{ type: "ref" }], 1)).toBe("bar");
  });
});

describe("the dashboard grid", () => {
  const w = (id: string, x: number, y: number, ww = 4, h = 3): Widget => ({ id, kind: "report", x, y, w: ww, h });

  it("never overlaps: moves push down and everything floats up", () => {
    let ws = [w("a", 0, 0), w("b", 4, 0), w("c", 0, 3)];
    ws = moveWidget(ws, "c", 4, 0);
    for (const a of ws) for (const b of ws) if (a.id !== b.id) expect(collides(a, b)).toBe(false);
    expect(ws.find((x) => x.id === "c")!.y).toBe(0);
    ws = resizeWidget(ws, "a", 12, 3);
    for (const a of ws) for (const b of ws) if (a.id !== b.id) expect(collides(a, b)).toBe(false);
    expect(compact([w("a", 0, 9)])[0].y).toBe(0);
    ws = nudge(ws, "a", 0, 0, true);
    expect(Math.max(...ws.map((x) => x.x + x.w))).toBeLessThanOrEqual(COLS);
  });

  it("adds widgets in the first free place and cleans stored layouts", () => {
    const ws = addWidget([w("a", 0, 0, 6, 3)], "indicator", {}, "n1");
    expect(ws[1]).toMatchObject({ id: "n1", x: 6, y: 0, w: 3, h: 3 });
    expect(freeSpot([w("a", 0, 0, 12, 2)], 4, 2)).toEqual({ x: 0, y: 2 });
    const clean = cleanLayout({ tabs: [{ key: "t1", label: "یک" }, { key: "bad key!", label: "x" }], widgets: [{ id: "a", kind: "report", x: 20, y: 0, w: 40, h: 1 }, { id: "a", kind: "text", x: 0, y: 0, w: 2, h: 2 }, { id: "z", kind: "evil", x: 0, y: 0, w: 2, h: 2 }, { id: "t", kind: "text", x: 0, y: 0, w: 2, h: 2, tab: "nope" }] });
    expect(clean.tabs).toEqual([{ key: "t1", label: "یک" }]);
    expect(clean.widgets.map((x) => x.id)).toEqual(["a", "t"]);
    expect(clean.widgets[0]).toMatchObject({ x: 0, w: 12, h: 2 });
    expect(clean.widgets[1].tab).toBeNull();
  });
});

describe("sharing and the bundle", () => {
  it("compile shares into row columns; role holders resolved; edit implies view", () => {
    const c = compileShares(
      [
        { kind: "user", id: "U1", right: "edit" },
        { kind: "group", id: "g1" },
        { kind: "unit", id: "u1" },
        { kind: "unit_tree", id: "u2" },
        { kind: "role", id: "agent", right: "view" },
        { kind: "role", id: "service_desk_manager", right: "edit" },
      ],
      (r) => (r === "agent" ? ["a1", "a2"] : r === "service_desk_manager" ? ["m1"] : []),
    );
    expect(c.r_users).toEqual(["a1", "a2", "m1", "u1"]);
    expect(c.w_users).toEqual(["m1", "u1"]);
    expect(c.r_groups).toEqual(["g1"]);
    expect(c.r_units).toEqual(["u1"]);
    expect(c.r_lines).toEqual(["u2"]);
    expect(c.role_keys).toEqual(["agent", "service_desk_manager"]);
    expect(compileShares([{ kind: "everyone" }], () => []).r_all).toBe(true);
    expect(sharesProblem([{ kind: "group", id: "not-a-uuid" }])).toBeTruthy();
    expect(sharesProblem([{ kind: "role", id: "agent" }])).toBeNull();
    expect(cleanShares([{ kind: "user", id: "A", right: "view" }, { kind: "user", id: "a", right: "edit" }])).toEqual([{ kind: "user", id: "a", right: "edit" }]);
  });

  it("the bundle carries definitions only; layouts travel by refs and keys", () => {
    const layout = { widgets: [{ id: "a", kind: "report", x: 0, y: 0, w: 6, h: 4, report_id: "R" }, { id: "b", kind: "indicator", x: 6, y: 0, w: 3, h: 3, indicator_id: "I" }] as Widget[] };
    const out = layoutToBundle(layout, (id) => (id === "R" ? "r1" : null), (id) => (id === "I" ? "incident.mttr" : null));
    expect(out.widgets[0].report_id).toBe("r1");
    expect(out.widgets[1]).toMatchObject({ indicator_key: "incident.mttr", indicator_id: null });
    const back = layoutFromBundle(out, (ref) => (ref === "r1" ? "R2" : null), (k) => (k === "incident.mttr" ? "I2" : null));
    expect(back.widgets.map((x) => x.report_id ?? x.indicator_id)).toEqual(["R2", "I2"]);
    const b = makeBundle({ reports: [], dashboards: [], indicators: [] });
    expect(bundleProblem(b)).toMatch(/خالی/);
    expect(bundleProblem({ format: "x" })).toBeTruthy();
  });
});

describe("the KPI library", () => {
  it("every library indicator and dashboard is valid against the full schema (all modules installed here)", () => {
    for (const k of KPI_LIBRARY) expect([k.key, indicatorProblem(k, lookup)]).toEqual([k.key, null]);
    expect(libraryFor(lookup).length).toBe(KPI_LIBRARY.length);
    expect(dashboardsFor(lookup).map((d) => d.key)).toEqual(LIBRARY_DASHBOARDS.map((d) => d.key));
    expect(LIBRARY_DASHBOARDS.map((d) => d.name)).toEqual(["داشبورد میز خدمت", "داشبورد مدیریت تغییر", "داشبورد انتشار و دواپس"]);
  });

  it("a module that is not installed contributes nothing (its tables are missing at seed time)", () => {
    const noChange = (k: string) => (k === "change_request" ? undefined : tableDef(k));
    const keys = libraryFor(noChange).map((k) => k.key);
    expect(keys.some((k) => k.startsWith("change."))).toBe(false);
    expect(keys).toContain("incident.mttr");
    expect(dashboardsFor(noChange).map((d) => d.key)).toEqual(["service_desk", "release_devops"]);
    // without the release module: no DORA metric, no release KPI, no release dashboard
    const noRelease = (k: string) => (["deployment", "release"].includes(k) ? undefined : tableDef(k));
    const rest = libraryFor(noRelease).map((k) => k.key);
    expect(rest.some((k) => k.startsWith("devops.") || k.startsWith("release."))).toBe(false);
    expect(rest).toContain("project.on_schedule");
    expect(dashboardsFor(noRelease).map((d) => d.key)).toEqual(["service_desk", "change_management"]);
  });

  it("seeded layouts resolve indicator keys and drop unknown ones; curators edit, readers view", () => {
    const ids = new Map([["incident.backlog", "id-backlog"], ["incident.mttr", "id-mttr"]]);
    const ws = resolveLayout(LIBRARY_DASHBOARDS[0].layout.widgets, ids);
    expect(ws.filter((x) => x.kind === "indicator").map((x) => x.indicator_id)).toEqual(["id-backlog", "id-mttr"]);
    expect(ws.find((x) => x.kind === "scorecard")?.indicator_ids).toEqual(["id-mttr"]);
    expect(resolveLayout(LIBRARY_DASHBOARDS[0].layout.widgets, new Map()).some((x) => x.kind === "scorecard" || x.kind === "indicator")).toBe(false);
    const shares = seededShares(LIBRARY_DASHBOARDS[0]);
    expect(shares.filter((s) => s.right === "edit").map((s) => s.id)).toEqual(["service_desk_manager", "tenant_admin"]);
    expect(shares.some((s) => s.id === "auditor" && s.right === "view")).toBe(true);
  });
});

describe("questions without a model", () => {
  const tables: NlTable[] = ["incident", "change_request", "problem"].map((k) => ({ def: tableDef(k)!, options: (f) => (Array.isArray(f.choices) ? f.choices : []) }));

  it("reads tables, measures, breakdowns, Jalali times and charts", () => {
    const a = parseQuestion("تعداد رخدادها به تفکیک اولویت", tables, { now: "2026-11-09" });
    expect(a.spec?.table).toBe("incident");
    expect(a.spec?.dims[0].field).toBe("priority");
    const b = parseQuestion("میانگین زمان حل رخدادها ماهانه در ۶ ماه گذشته", tables, { now: "2026-11-09" });
    expect(b.spec?.measures[0].fn).toBe("avg");
    expect(b.spec?.dims.some((d) => d.bucket === "month")).toBe(true);
    expect(b.spec?.time?.window).toBeTruthy();
    const c = parseQuestion("تغییرهای فصل گذشته به صورت نمودار خطی", tables, { now: "2026-11-09" });
    expect(c.spec?.table).toBe("change_request");
    const d = parseQuestion("سلام", tables);
    expect(d.spec).toBeNull();
    expect(d.problem).toBeTruthy();
    for (const r of [a, b, c]) expect(specProblem(r.spec!, tableDef(r.spec!.table), lookup)).toBeNull();
  });
});

describe("the screens' chart shaping", () => {
  const res = (rows: ReportResult["rows"], dims = 1, additive = true): ReportResult => ({
    kind: "agg", table: "incident", table_label: "رخدادها",
    dims: Array.from({ length: dims }, (_, i) => ({ field: i ? "category" : "priority", label: "", type: "choice", drill: true })),
    measures: [{ key: "m0", label: "تعداد", unit: "count", additive }],
    rows, totals: { m0: rows.reduce((s, r) => s + (r.values.m0 ?? 0), 0) }, total_n: 0, window: null, previous: null, list: null, truncated: false, suppressed: 0, k: 0, filter: { f: "active", op: "eq", v: true }, generated_at: new Date(NOW).toISOString(),
  });

  it("two dimensions become series of the second, the eight largest and «سایر»", () => {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ keys: ["1", `c${i}`], labels: ["P1", `C${i}`], values: { m0: 10 - i }, n: 10 - i });
    rows.push({ keys: ["2", "c0"], labels: ["P2", "C0"], values: { m0: 5 }, n: 5 });
    const d = chartData(res(rows, 2));
    expect(d.series.length).toBe(MAX_SERIES + 1);
    expect(d.series.at(-1)?.label).toBe("سایر");
    expect(d.rows.find((r) => r._key === "1")?.s_other).toBe(2 + 1);
    expect(d.rows.find((r) => r._key === "2")?.s0).toBe(5);
    expect(chartData(res(rows, 2, false)).series.some((s) => s.label === "سایر")).toBe(false);
  });

  it("pareto, matrices, the gallery's fit, the gauge and drill targets", () => {
    const p = paretoData(res([{ keys: ["a"], labels: ["A"], values: { m0: 2 }, n: 2 }, { keys: ["b"], labels: ["B"], values: { m0: 6 }, n: 6 }, { keys: ["c"], labels: ["C"], values: { m0: 2 }, n: 2 }]));
    expect(p.map((x) => x.label)).toEqual(["B", "A", "C"]);
    expect(p.map((x) => x.cum)).toEqual([60, 80, 100]);
    const m = matrix(res([{ keys: [0, 9], labels: ["شنبه", "۹"], values: { m0: 3 }, n: 3 }, { keys: [0, 8], labels: ["شنبه", "۸"], values: { m0: 1 }, n: 1 }], 2));
    expect(m.cols.map((c) => c.key)).toEqual([8, 9]);
    expect(m.max).toBe(3);
    expect(m.rowTotals.get("0")).toBe(4);
    expect(vizFits("pie", 2, 1)).toBeTruthy();
    expect(vizFits("heatmap", 2, 1)).toBeNull();
    expect(vizFits("column", 2, 2)).toBeTruthy();
    expect(gaugeShare(50, { unit: "percent", target: 80 })).toMatchObject({ share: 0.5, target: 0.8, max: 100 });
    const spec: ReportSpec = { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [{ field: "priority" }], viz: "column", options: { drill: ["priority", "category"] } };
    expect(elementCond(spec, res([]), ["1"], incident, { tz: TZ, now: NOW, lookup })).toEqual({ and: [{ f: "active", op: "eq", v: true }, { f: "priority", op: "eq", v: "1" }] });
    expect(nextDrill(spec)).toBe("category");
    expect(recordsHref("/o/incidents", { f: "priority", op: "eq", v: "1" })).toBe(`/o/incidents?filter=${encodeURIComponent('{"f":"priority","op":"eq","v":"1"}')}`);
  });

  it("every engine table name the library uses exists in the registry", () => {
    const tables = new Set(KPI_LIBRARY.flatMap((k) => k.parts.map((p) => p.table)));
    for (const t of tables) expect(TABLES.has(t)).toBe(true);
  });
});
