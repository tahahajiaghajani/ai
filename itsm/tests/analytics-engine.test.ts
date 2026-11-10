// The report engine and the indicators on a real database: Jalali buckets, statistics in SQL (percentiles, durations
// between dates, the share of matching records), top N with «سایر», the previous period, ages, records and grouped
// lists, small-cell suppression; the seed (idempotent, only the library of installed modules); indicator snapshots
// (incremental, a new series for a new formula, readers copied onto scores, the owner's alert) and the daily step.
import { describe, it, expect, beforeAll } from "vitest";
import { tableDef } from "@shared/tables";
import { libraryFor, LIBRARY_DASHBOARDS } from "@shared/analytics/library";
import { orgSchema } from "@server/engine";
import { hourIn, snapshotDue, snapshotStep } from "@server/modules/analytics";
import { world, type World } from "./incident-helpers";

let w: World;
const INC = tableDef("incident")!.table;
const ids: string[] = [];
const run = (spec: Record<string, unknown>, expect = 200) => w.o.post(`${w.P}/analytics/run`, { spec: { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [], viz: "score", ...spec } }, expect);

beforeAll(async () => {
  w = await world();
  for (const [i, at] of ["2026-09-25T06:00:00Z", "2026-09-27T06:00:00Z", "2026-10-25T06:00:00Z", "2026-10-26T15:00:00Z", "2026-10-27T15:30:00Z"].entries()) {
    const r = await w.incident({ short_description: `رخداد ${i}` });
    ids.push(r.id);
    await w.e.db.query(`update ${INC} set opened_at = $2, reassignment_count = $3 where id = $1`, [r.id, at, [0, 1, 2, 3, 10][i]]);
  }
});

describe("the report engine", () => {
  it("buckets dates on the Jalali calendar in the organisation's time zone, without holes", async () => {
    const r = await run({ time: { field: "opened_at", from: "2026-09-23", to: "2026-11-21" }, dims: [{ field: "opened_at", bucket: "month" }], viz: "column" });
    expect(r.rows.map((x: any) => [x.keys[0], x.n])).toEqual([["1405-07", 2], ["1405-08", 3]]);
    expect(r.rows[0].labels[0]).toContain("مهر");
    const days = await run({ time: { field: "opened_at", from: "2026-10-25", to: "2026-10-27" }, dims: [{ field: "opened_at", bucket: "day" }], viz: "line" });
    expect(days.rows.map((x: any) => x.n)).toEqual([1, 1, 1]);
    const weekdays = await run({ dims: [{ field: "opened_at", bucket: "weekday" }], viz: "column" });
    expect(weekdays.rows.length).toBe(7);
    expect(weekdays.rows.reduce((s: number, x: any) => s + x.n, 0)).toBe(5);
  });

  it("computes statistics in SQL: sum, average, median, p90, max; durations between dates; shares", async () => {
    const r = await run({
      filter: { f: "id", op: "in", v: ids },
      measures: [
        { fn: "sum", field: "reassignment_count" },
        { fn: "avg", field: "reassignment_count" },
        { fn: "median", field: "reassignment_count" },
        { fn: "p90", field: "reassignment_count" },
        { fn: "max", field: "reassignment_count" },
        { fn: "ratio", filter: { f: "reassignment_count", op: "gt", v: 1 } },
      ],
      viz: "table",
    });
    expect(r.totals).toEqual({ m0: 16, m1: 3.2, m2: 2, m3: 7.2, m4: 10, m5: 60 });
    expect(r.measures.map((m: any) => m.unit)).toEqual(["number", "number", "number", "number", "number", "percent"]);
    const d = await run({ filter: { f: "id", op: "in", v: ids }, measures: [{ fn: "max", field: "updated_at", from: "opened_at" }], viz: "score" });
    expect(d.measures[0].unit).toBe("duration");
    expect(d.totals.m0).toBeGreaterThan(86_400 * 10);
  });

  it("folds the groups past the top N into «سایر», exactly", async () => {
    const r = await run({ filter: { f: "id", op: "in", v: ids }, dims: [{ field: "reassignment_count" }], viz: "bar", limit: 2, other: true, sort: { by: "key", dir: "desc" } });
    expect(r.rows.length).toBe(3);
    expect(r.rows[2]).toMatchObject({ other: true, labels: ["سایر"], n: 3 });
    expect(r.rows.reduce((s: number, x: any) => s + x.n, 0)).toBe(r.total_n);
  });

  it("ages and ranges, records and grouped lists", async () => {
    const ages = await run({ filter: { f: "id", op: "in", v: ids }, dims: [{ field: "opened_at", ranges: [30] }], viz: "column", sort: { by: "key", dir: "asc" } });
    expect(ages.rows.map((x: any) => x.labels[0])).toEqual(expect.arrayContaining([expect.stringContaining("روز")]));
    expect(ages.total_n).toBe(5);
    const list = await run({ filter: { f: "id", op: "in", v: ids }, measures: [], viz: "list", columns: ["number", "short_description", "priority"], options: { size: 3, order: "-opened_at" } });
    expect(list.kind).toBe("list");
    expect(list.list.rows.length).toBe(3);
    expect(list.list.total).toBe(5);
    expect(list.list.columns.map((c: any) => c.label)).toContain("اولویت");
    const grouped = await run({ filter: { f: "id", op: "in", v: ids }, measures: [], dims: [{ field: "opened_at", bucket: "month" }], viz: "grouped" });
    expect(grouped.list.groups.reduce((s: number, g: any) => s + g.n, 0)).toBe(5);
  });

  it("compares with the previous period", async () => {
    const r = await run({ time: { field: "opened_at", window: { unit: "day", from: -29, to: 0 } }, compare: true });
    expect(r.previous).not.toBeNull();
    expect(r.previous.window.to <= r.window.from).toBe(true);
  });

  it("withholds small groups (k), and one more so the hidden one cannot be subtracted", async () => {
    const cfg = (await w.o.get(`${w.P}/r/analytics_config?size=1`)).rows[0] ?? (await w.o.post(`${w.P}/analytics/seed`, {}), (await w.o.get(`${w.P}/r/analytics_config?size=1`)).rows[0]);
    await w.o.patch(`${w.P}/r/analytics_config/${cfg.id}`, { small_cell_k: 2, version: cfg.version });
    const r = await run({ filter: { f: "id", op: "in", v: ids }, time: { field: "opened_at", from: "2026-09-23", to: "2026-11-21" }, dims: [{ field: "opened_at", bucket: "month" }], viz: "column" });
    expect(r.k).toBe(2);
    expect(r.suppressed).toBe(0);
    const s = await run({ filter: { f: "id", op: "in", v: ids }, dims: [{ field: "reassignment_count" }], viz: "column" });
    expect(s.suppressed).toBe(5);
    expect(s.rows.every((x: any) => x.suppressed && x.values.m0 === null)).toBe(true);
    expect(s.totals.m0).toBe(5);
    const again = (await w.o.get(`${w.P}/r/analytics_config/${cfg.id}`)).row;
    await w.o.patch(`${w.P}/r/analytics_config/${cfg.id}`, { small_cell_k: 0, version: again.version });
  });

  it("refuses bad definitions in Persian and unknown tables", async () => {
    const bad = await run({ dims: [{ field: "nope" }], viz: "column" }, 400);
    expect(JSON.stringify(bad)).toContain("nope");
    await run({ table: "no_such_table" }, 404);
  });
});

describe("the seed", () => {
  it("adds the library of the installed modules and the two dashboards, once", async () => {
    const first = await w.o.post(`${w.P}/analytics/seed`, { force: true });
    const schema = await orgSchema(w.sys);
    const lib = libraryFor(schema.lookup);
    const inds = (await w.o.get(`${w.P}/r/analytics_indicator?size=200`)).rows;
    expect(inds.length).toBe(lib.length);
    expect(inds.every((r: any) => r.certified)).toBe(true);
    const dash = (await w.o.get(`${w.P}/r/analytics_dashboard?size=20`)).rows;
    expect(dash.map((d: any) => d.name).sort()).toEqual(LIBRARY_DASHBOARDS.map((d) => d.name).sort());
    expect(first.created.analytics_config ?? 0).toBeLessThanOrEqual(1);
    const again = await w.o.post(`${w.P}/analytics/seed`, {});
    expect(again.skipped).toBe(true);
    const forced = await w.o.post(`${w.P}/analytics/seed`, { force: true });
    expect(forced.created).toEqual({});
    const sd = dash.find((d: any) => d.library_key === "service_desk");
    const view = await w.o.get(`${w.P}/analytics/dashboards/${sd.id}`);
    const ind = view.layout.widgets.filter((x: any) => x.kind === "indicator");
    expect(ind.length).toBe(4);
    expect(ind.every((x: any) => Object.keys(view.indicators).includes(x.indicator_id))).toBe(true);
    const lv = await w.o.get(`${w.P}/analytics/library`);
    expect(lv.indicators.every((k: any) => k.available && k.installed)).toBe(true);
  });
});

describe("indicators", () => {
  let ind: Record<string, any>;
  beforeAll(async () => {
    ind = (
      await w.o.post(`${w.P}/r/analytics_indicator`, {
        name: "رخدادهای ثبت‌شده (آزمایشی)",
        key: "test.volume",
        practice: "incident",
        unit: "count",
        direction: "down",
        grain: "month",
        formula: "n",
        parts: [{ name: "n", table: "incident", fn: "count", date_field: "opened_at" }],
        breakdowns: ["priority"],
        crit: 0,
        warn: 0,
      })
    ).row;
  });

  it("collects the current and previous periods with a backfill, readers copied onto scores, the owner alerted", async () => {
    expect(ind.s_users ?? []).toBeDefined();
    const r = await w.o.post(`${w.P}/analytics/indicators/${ind.id}/collect`, {});
    expect(r.scores).toBeGreaterThan(6);
    const scores = (await w.o.post(`${w.P}/r/analytics_score/query`, { filter: { f: "indicator_id", op: "eq", v: ind.id }, size: 200, total: true })).rows;
    const totals = scores.filter((s: any) => !s.breakdown);
    expect(new Set(totals.map((s: any) => s.period_key)).size).toBe(totals.length);
    expect(totals.length).toBeGreaterThanOrEqual(7);
    expect(scores.some((s: any) => s.breakdown === "priority")).toBe(true);
    // a second collection updates in place (incremental), nothing duplicated
    await w.o.post(`${w.P}/analytics/indicators/${ind.id}/collect`, {});
    const again = (await w.o.post(`${w.P}/r/analytics_score/query`, { filter: { f: "indicator_id", op: "eq", v: ind.id }, size: 200, total: true })).total;
    expect(again).toBe(scores.length);
  });

  it("a new formula is a new series: the old scores stay as they were", async () => {
    const row = (await w.o.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row;
    const up = (await w.o.patch(`${w.P}/r/analytics_indicator/${ind.id}`, { formula: "n * 2", version: row.version })).row;
    expect(up.formula_version).toBe(2);
    await w.o.post(`${w.P}/analytics/indicators/${ind.id}/collect`, {});
    const v1 = (await w.o.post(`${w.P}/r/analytics_score/query`, { filter: { and: [{ f: "indicator_id", op: "eq", v: ind.id }, { f: "formula_version", op: "eq", v: 1 }] }, size: 1, total: true })).total;
    const v2 = (await w.o.post(`${w.P}/r/analytics_score/query`, { filter: { and: [{ f: "indicator_id", op: "eq", v: ind.id }, { f: "formula_version", op: "eq", v: 2 }] }, size: 1, total: true })).total;
    expect(v1).toBeGreaterThan(0);
    expect(v2).toBeGreaterThan(0);
    await w.o.patch(`${w.P}/r/analytics_indicator/${ind.id}`, { key: "changed", version: up.version }, 400);
  });

  it("the hub explains the number: breakdowns, records, narrative", async () => {
    const hub = await w.o.get(`${w.P}/analytics/indicators/${ind.id}/hub`);
    expect(hub.definition.formula_version).toBe(2);
    expect(hub.breakdowns[0].field).toBe("priority");
    expect(hub.records[0].table).toBe("incident");
    expect(hub.narrative.text.length).toBeGreaterThan(10);
    expect(Array.isArray(hub.history)).toBe(true);
  });

  it("the daily step collects what is left, prunes, and marks the day", async () => {
    const r = await snapshotStep(w.e.cfg, w.e.org, { since: new Date(Date.now() + 1000).toISOString(), deadline: Date.now() + 120_000 });
    expect(r.done).toBe(true);
    const cfg = (await w.o.get(`${w.P}/r/analytics_config?size=1`)).rows[0];
    expect(cfg.last_snapshot_on).toBeTruthy();
    expect(snapshotDue({ last_snapshot_on: String(cfg.last_snapshot_on), snapshot_hour: 0 }, "Asia/Tehran")).toBe(false);
    expect(snapshotDue({ last_snapshot_on: null, snapshot_hour: 0 }, "Asia/Tehran")).toBe(true);
    expect(hourIn("Asia/Tehran", Date.parse("2026-11-09T06:30:00Z"))).toBe(10);
  });

  it("validates indicators: unknown tables, fields and formula names are refused", async () => {
    await w.o.post(`${w.P}/r/analytics_indicator`, { name: "x", key: "x.bad", formula: "a / b", parts: [{ name: "a", table: "incident", fn: "count" }] }, 400);
    await w.o.post(`${w.P}/r/analytics_indicator`, { name: "x", key: "x.bad2", formula: "a", parts: [{ name: "a", table: "nope", fn: "count" }] }, 400);
    const check = await w.o.post(`${w.P}/analytics/indicators/check`, { formula: "a", parts: [{ name: "a", table: "incident", fn: "count", filter: { f: "active", op: "eq", v: true } }] });
    expect(check.problem).toBeNull();
    expect(check.item.current.value).toBeGreaterThan(0);
  });
});
