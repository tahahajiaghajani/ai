// Capacity of teams (WFM-013/019/020/022): open work per team and person across every task table, the daily demand of
// each team (records created for it, eight weeks back, Jalali days in the organisation's time zone) and its forecast
// with Iranian holidays, the staff on shift each day (rosters minus time off; working days of the default calendar
// when a team has no roster), the capacity it gives (staff × daily throughput — the team's setting, else what its
// people resolved per working day) and the agents the forecast needs. The heatmap is teams × days coloured by
// utilisation; people's loads are shown only to those who oversee the team.
import { tableDef, TABLES } from "@shared/tables";
import { addDays, diffDays, weekday } from "@shared/jalali";
import { zonedMidnight } from "@shared/model/jalali-buckets";
import type { TableDef } from "@shared/model/types";
import { denseDays, forecastDaily, requiredFte, utilBand, utilisation, type UtilBand } from "@shared/workforce/logic";
import { num } from "@shared/slm/logic";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { condEnv, orgSchema, orgTz, readable } from "../../engine";
import { calendarFor, holidaysBetween } from "../sla";
import { isUuid, liveRows, membersOf, msOf, myGroups, namesOf, overseenGroups, sysOf, todayOf, workforceConfig, type Row } from "./common";
import { absencesIn, patternsOf, rostersIn, shiftsOn } from "./schedule";
import { hoursOf } from "@shared/workforce/logic";

/** Task tables that carry work for teams and people (assignment group, assignee, open flag). */
export function workTables(): TableDef[] {
  return [...TABLES.values()].filter((d) => !d.virtual && d.extends === "task" && ["assigned_to", "assignment_group_id", "active"].every((f) => d.fields.some((x) => x.name === f)));
}

/** Open records per team and person (as the system: counts only). */
export async function openLoads(q: Queryable, ctx: Ctx, groups: string[]): Promise<{ byGroup: Map<string, number>; byUser: Map<string, number>; unassigned: Map<string, number> }> {
  const sys = sysOf(ctx);
  const byGroup = new Map<string, number>();
  const byUser = new Map<string, number>();
  const unassigned = new Map<string, number>();
  if (!groups.length) return { byGroup, byUser, unassigned };
  const schema = await orgSchema(sys, q);
  const env = await condEnv(sys);
  for (const t of workTables()) {
    const def = schema.def(t.key) ?? t;
    const params: unknown[] = [];
    const where = readable(sys, def, "t", params, env);
    params.push(pgArray(groups));
    const rows = await q.query<{ g: string; u: string | null; n: number }>(
      `select t.assignment_group_id as g, t.assigned_to as u, count(*)::int as n from ${def.table} t where ${where} and t.deleted_at is null and t.active and t.assignment_group_id = any($${params.length}::uuid[]) group by 1, 2`,
      params,
    );
    for (const r of rows) {
      byGroup.set(r.g, (byGroup.get(r.g) ?? 0) + Number(r.n));
      if (r.u) byUser.set(r.u, (byUser.get(r.u) ?? 0) + Number(r.n));
      else unassigned.set(r.g, (unassigned.get(r.g) ?? 0) + Number(r.n));
    }
  }
  return { byGroup, byUser, unassigned };
}

/** Open records assigned to people (any team), for spare capacity in routing. */
export async function openByUser(q: Queryable, ctx: Ctx, users: string[]): Promise<Map<string, number>> {
  const sys = sysOf(ctx);
  const out = new Map<string, number>();
  if (!users.length) return out;
  const schema = await orgSchema(sys, q);
  const env = await condEnv(sys);
  for (const t of workTables()) {
    const def = schema.def(t.key) ?? t;
    const params: unknown[] = [];
    const where = readable(sys, def, "t", params, env);
    params.push(pgArray(users));
    const rows = await q.query<{ u: string; n: number }>(`select t.assigned_to as u, count(*)::int as n from ${def.table} t where ${where} and t.deleted_at is null and t.active and t.assigned_to = any($${params.length}::uuid[]) group by 1`, params);
    for (const r of rows) out.set(r.u, (out.get(r.u) ?? 0) + Number(r.n));
  }
  return out;
}

/** Daily counts per team of a measure (`created` records for the team, or `resolved` by it) in [from, to) dates. */
export async function dailyCounts(q: Queryable, ctx: Ctx, groups: string[], from: string, to: string, measure: "created" | "resolved"): Promise<Map<string, Map<string, number>>> {
  const sys = sysOf(ctx);
  const out = new Map<string, Map<string, number>>();
  if (!groups.length) return out;
  const tz = orgTz(sys);
  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  if (!days.length) return out;
  const starts = pgArray(days.map((d) => new Date(zonedMidnight(d, tz)).toISOString()));
  const end = new Date(zonedMidnight(to, tz)).toISOString();
  const schema = await orgSchema(sys, q);
  const env = await condEnv(sys);
  for (const t of workTables()) {
    const def = schema.def(t.key) ?? t;
    const field = measure === "created" ? "created_at" : def.fields.some((f) => f.name === "resolved_at") ? "resolved_at" : null;
    if (!field) continue;
    const params: unknown[] = [];
    const where = readable(sys, def, "t", params, env);
    params.push(pgArray(groups));
    const ig = params.length;
    params.push(starts);
    const is = params.length;
    params.push(end);
    const ie = params.length;
    const rows = await q.query<{ g: string; b: number; n: number }>(
      `select t.assignment_group_id as g, width_bucket(t.${field}, $${is}::timestamptz[]) as b, count(*)::int as n from ${def.table} t
        where ${where} and t.deleted_at is null and t.assignment_group_id = any($${ig}::uuid[]) and t.${field} >= ($${is}::timestamptz[])[1] and t.${field} < $${ie}::timestamptz group by 1, 2`,
      params,
    );
    for (const r of rows) {
      const day = days[Number(r.b) - 1];
      if (!day) continue;
      const m = out.get(r.g) ?? out.set(r.g, new Map()).get(r.g)!;
      m.set(day, (m.get(day) ?? 0) + Number(r.n));
    }
  }
  return out;
}

export interface HeatCell {
  date: string;
  forecast: number;
  lower: number;
  upper: number;
  staff: number;
  capacity: number;
  required: number;
  utilisation: number | null;
  band: UtilBand;
  holiday: boolean;
}

export interface HeatRow {
  group_id: string;
  name: string;
  members: number;
  open: number;
  unassigned: number;
  load_pct: number | null;
  load_band: UtilBand;
  throughput: number;
  mape: number | null;
  cells: HeatCell[];
  people: { user_id: string; name: string; open: number; limit: number; pct: number | null; band: UtilBand }[] | null;
}

export interface CapacityView {
  from: string;
  days: { date: string; weekday: number; holiday: string | null }[];
  rows: HeatRow[];
  all: boolean;
}

/** The capacity heatmap of the teams the caller may see: overseen teams (with people), their own teams (totals). */
export async function capacityView(ctx: Ctx, opts: { from?: string; days?: number; groups?: string[] } = {}): Promise<CapacityView> {
  const sys = sysOf(ctx);
  const cfg = await workforceConfig(ctx.db, sys);
  const today = todayOf(ctx);
  const from = opts.from ?? today;
  const n = Math.max(7, Math.min(cfg.forecast_days, opts.days ?? 14));
  const over = await overseenGroups(ctx.db, ctx);
  const own = await myGroups(ctx.db, ctx);
  let visible: string[];
  if (over.all) visible = (await liveRows(ctx.db, sys, "group", { and: [{ f: "active", op: "eq", v: true }, { f: "types", op: "contains", v: "assignment" }] }, { order: "t.name", limit: 200 })).map((g) => String(g.id));
  else visible = [...new Set([...over.groups, ...own])];
  if (opts.groups?.length) visible = visible.filter((g) => opts.groups!.includes(g));
  const groups = visible.slice(0, 60);
  const groupRows = groups.length ? await liveRows(ctx.db, sys, "group", { f: "id", op: "in", v: groups }, { order: "t.name" }) : [];
  const members = await membersOf(ctx.db, sys, groups);
  const allPeople = [...new Set([...members.values()].flat())];
  const loads = await openLoads(ctx.db, sys, groups);
  // history is what already happened: it ends today (exclusive) for a window that starts later — the days between
  // today and a future `from` are forecast, never counted as days without demand
  const histEnd = from < today ? from : today;
  const lead = Math.max(0, diffDays(from, histEnd));
  const histFrom = addDays(histEnd, -7 * cfg.history_weeks);
  const created = await dailyCounts(ctx.db, sys, groups, histFrom, histEnd, "created");
  const resolved = await dailyCounts(ctx.db, sys, groups, histFrom, histEnd, "resolved");
  const to = addDays(from, n);
  const holidayRows = await holidaysBetween(ctx.db, sys, histFrom, to).catch(() => []);
  const holidays = new Set(holidayRows.filter((h) => !h.half).map((h) => h.date));
  const holidayTitles = new Map(holidayRows.map((h) => [h.date, h.title]));
  const office = await calendarFor(ctx.db, sys, null).catch(() => null);
  const rosters = await rostersIn(ctx.db, sys, { groups }, from, addDays(to, -1));
  const patterns = await patternsOf(ctx.db, sys, [...new Set(rosters.map((r) => String(r.pattern_id)))]);
  const tz = orgTz(ctx);
  const absences = await absencesIn(ctx.db, sys, allPeople, new Date(zonedMidnight(from, tz)).toISOString(), new Date(zonedMidnight(to, tz)).toISOString());
  const caps = groups.length ? await liveRows(ctx.db, sys, "wfm_capacity", { f: "group_id", op: "in", v: groups }, { limit: 2000 }) : [];
  const names = over.all || over.groups.length ? await namesOf(ctx.db, ctx.org.id, allPeople) : new Map<string, string>();
  const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
  const rows: HeatRow[] = [];
  for (const g of groupRows) {
    const gid = String(g.id);
    const ms = members.get(gid) ?? [];
    const cap = caps.find((c) => c.group_id === gid && !isUuid(c.user_id));
    const maxOpen = num(cap?.max_open) ?? 8;
    const hist = denseDays([...(created.get(gid) ?? new Map()).entries()].map(([day, count]) => ({ day, count })), histFrom, histEnd);
    const fc = forecastDaily(hist, histEnd, lead + n, holidays);
    // throughput: the team's setting, else resolved per staffed working day of the history
    const resolvedTotal = [...(resolved.get(gid) ?? new Map()).values()].reduce((a, b) => a + b, 0);
    const workDays = hist.filter((h) => !holidays.has(h.day) && (office ? office.week[weekday(h.day)]?.length : weekday(h.day) !== 6)).length || 1;
    const throughput = num(cap?.daily_throughput) ?? (ms.length ? Math.max(1, Math.round((resolvedTotal / workDays / ms.length) * 10) / 10) : 5);
    const aht = num(cap?.aht_hours) ?? Math.max(0.25, Math.round((7 / throughput) * 100) / 100);
    const occ = num(cap?.occupancy) ?? 80;
    const shrink = num(cap?.shrinkage) ?? 30;
    const groupRosters = rosters.filter((r) => r.group_id === gid);
    const cells: HeatCell[] = dates.map((d, i) => {
      const ds = zonedMidnight(d, tz);
      const de = zonedMidnight(addDays(d, 1), tz);
      let staff = 0;
      let hours = 0;
      for (const u of ms) {
        if (absences.some((a) => a.user_id === u && (msOf(a.start_at) ?? 0) < de && (msOf(a.end_at) ?? 0) > ds)) continue;
        if (groupRosters.length) {
          const s = shiftsOn(groupRosters, patterns, u, d, gid);
          if (s.intervals.length) {
            staff++;
            hours += hoursOf(s.intervals);
          }
        } else if (office && !holidays.has(d) && office.week[weekday(d)]?.length) {
          staff++;
          hours += office.week[weekday(d)].reduce((a, [f, t]) => a + (t > f ? t - f : t + 1440 - f), 0) / 60;
        }
      }
      const point = fc.points[lead + i];
      const capacity = Math.round(staff * throughput * 10) / 10;
      const pct = capacity > 0 ? utilisation(point.predicted, capacity) : point.predicted > 0 ? 999 : null;
      const productive = staff ? hours / staff : 8;
      return {
        date: d, forecast: point.predicted, lower: point.lower, upper: point.upper, staff, capacity,
        required: requiredFte(point.predicted, aht, productive || 8, occ, shrink), utilisation: pct, band: utilBand(pct), holiday: holidays.has(d),
      };
    });
    const capTotal = ms.length * maxOpen;
    const open = loads.byGroup.get(gid) ?? 0;
    const loadPct = utilisation(open, capTotal);
    const seesPeople = over.all || over.groups.includes(gid);
    rows.push({
      group_id: gid, name: String(g.name ?? ""), members: ms.length, open, unassigned: loads.unassigned.get(gid) ?? 0, load_pct: loadPct, load_band: utilBand(loadPct),
      throughput, mape: fc.mape, cells,
      people: seesPeople
        ? ms.map((u) => {
            const own = caps.find((c) => c.group_id === gid && c.user_id === u);
            const limit = num(own?.max_open) ?? maxOpen;
            const o = loads.byUser.get(u) ?? 0;
            const pct = utilisation(o, limit);
            return { user_id: u, name: names.get(u) ?? "", open: o, limit, pct, band: utilBand(pct) };
          }).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
        : null,
    });
  }
  return { from, days: dates.map((d) => ({ date: d, weekday: weekday(d), holiday: holidayTitles.get(d) ?? null })), rows, all: over.all };
}

export { tableDef };
