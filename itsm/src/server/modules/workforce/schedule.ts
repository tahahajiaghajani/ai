// Shifts and team calendars (WFM-015/018/043): a roster puts a person on a shift pattern in a team for a range of
// dates; the pattern's working calendar (the SLA service's calendars: weekly hours, a Thursday half day or none,
// Friday off, the official Iranian holidays and the organisation's own) decides the shifts of every day — nothing is
// materialised. Time off removes a person from the days it covers. The team board shows people × days with the shift
// code, hours and time off (its type only to the person and those who oversee the team), the coverage of each day
// against the team's minimum staff, and labour-rule findings (weekly hours, rest between shifts, Friday work).
import { addDays, weekday, WEEKDAYS_SHORT } from "@shared/jalali";
import { hoursOf, labourIssues, overlaps, rosterCovers, shiftIntervals, type LabourIssue } from "@shared/workforce/logic";
import type { BusinessCalendar } from "@shared/sla/calendar";
import { zonedMidnight } from "@shared/model/jalali-buckets";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { orgTz } from "../../engine";
import { forbidden } from "../../http/errors";
import { calendarFor, holidaysBetween } from "../sla";
import { isUuid, liveRows, membersOf, msOf, myGroups, namesOf, overseesGroup, sysOf, todayOf, workforceConfig, type Row } from "./common";

export interface Pattern {
  row: Row;
  cal: BusinessCalendar | null;
}

/** Shift patterns with their calendars (as the system). */
export async function patternsOf(q: Queryable, ctx: Ctx, ids?: string[]): Promise<Map<string, Pattern>> {
  const sys = sysOf(ctx);
  const rows = await liveRows(q, sys, "wfm_shift_pattern", ids ? { f: "id", op: "in", v: ids.length ? ids : ["00000000-0000-0000-0000-000000000000"] } : null, { limit: 500 });
  const out = new Map<string, Pattern>();
  for (const r of rows) out.set(String(r.id), { row: r, cal: isUuid(r.calendar_id) ? await calendarFor(q, sys, r.calendar_id).catch(() => null) : null });
  return out;
}

/** Rosters of people or teams that overlap [from, to] (dates, inclusive). */
export async function rostersIn(q: Queryable, ctx: Ctx, where: { users?: string[]; groups?: string[] }, from: string, to: string): Promise<Row[]> {
  const and: Row[] = [{ f: "valid_from", op: "lte", v: to }, { or: [{ f: "valid_to", op: "empty" }, { f: "valid_to", op: "gte", v: from }] }];
  if (where.users) and.push({ f: "user_id", op: "in", v: where.users.length ? where.users : ["00000000-0000-0000-0000-000000000000"] });
  if (where.groups) and.push({ f: "group_id", op: "in", v: where.groups.length ? where.groups : ["00000000-0000-0000-0000-000000000000"] });
  return liveRows(q, sysOf(ctx), "wfm_roster", { and } as never, { order: "t.valid_from", limit: 5000 });
}

/** Approved (and, with `requested`, pending) time off of people overlapping [fromIso, toIso). */
export async function absencesIn(q: Queryable, ctx: Ctx, users: string[], fromIso: string, toIso: string, requested = false): Promise<Row[]> {
  if (!users.length) return [];
  return liveRows(q, sysOf(ctx), "wfm_absence", { and: [{ f: "user_id", op: "in", v: users }, { f: "state", op: "in", v: requested ? ["approved", "requested"] : ["approved"] }, { f: "start_at", op: "lt", v: toIso }, { f: "end_at", op: "gt", v: fromIso }] }, { limit: 5000 });
}

/** The shifts of one person on a date (intervals in ms) from their rosters (optionally in one team). */
export function shiftsOn(rosters: Row[], patterns: Map<string, Pattern>, userId: string, day: string, groupId?: string): { intervals: [number, number][]; pattern: Row | null } {
  for (const r of rosters) {
    if (r.user_id !== userId || (groupId && r.group_id !== groupId) || !rosterCovers(r as never, day)) continue;
    const p = patterns.get(String(r.pattern_id));
    if (!p) continue;
    const intervals = shiftIntervals(p.cal, day);
    return { intervals, pattern: p.row };
  }
  return { intervals: [], pattern: null };
}

/** Is a person on shift at `now`, and how many minutes are left? (null: no roster — unknown) */
export async function shiftNow(q: Queryable, ctx: Ctx, userId: string, now = Date.now()): Promise<{ on: boolean | null; left: number | null; pattern: string | null; today: [number, number][] }> {
  const today = todayOf(ctx, now);
  const yesterday = addDays(today, -1);
  const rosters = await rostersIn(q, ctx, { users: [userId] }, yesterday, today);
  if (!rosters.length) return { on: null, left: null, pattern: null, today: [] };
  const patterns = await patternsOf(q, ctx, [...new Set(rosters.map((r) => String(r.pattern_id)))]);
  const t = shiftsOn(rosters, patterns, userId, today);
  const y = shiftsOn(rosters, patterns, userId, yesterday);
  for (const [s, e] of [...y.intervals, ...t.intervals]) if (s <= now && now < e) return { on: true, left: Math.round((e - now) / 60_000), pattern: (t.pattern ?? y.pattern)?.name ?? null, today: t.intervals };
  return { on: false, left: null, pattern: t.pattern?.name ?? null, today: t.intervals };
}

export interface BoardCell {
  date: string;
  code: string | null;
  color: string | null;
  hours: number;
  absent: boolean;
  absence: string | null;
}

export interface TeamBoard {
  group: { id: string; name: string };
  days: { date: string; weekday: string; holiday: string | null }[];
  people: { user_id: string; name: string; me: boolean; cells: BoardCell[] }[];
  coverage: { date: string; staff: number; min: number; gap: boolean }[];
  issues: LabourIssue[];
  can_manage: boolean;
}

/** The team's board over `days` days from `from` (members of the team or those who oversee it). */
export async function teamBoard(ctx: Ctx, groupId: string, from: string, days: number): Promise<TeamBoard> {
  const sys = sysOf(ctx);
  const mine = await myGroups(ctx.db, ctx);
  const oversees = await overseesGroup(ctx.db, ctx, groupId);
  if (!mine.includes(groupId) && !oversees) throw forbidden("برنامهٔ این تیم برای شما باز نیست");
  const n = Math.max(1, Math.min(42, days));
  const to = addDays(from, n - 1);
  const [group] = await liveRows(ctx.db, sys, "group", { f: "id", op: "eq", v: groupId }, { limit: 1 });
  const members = (await membersOf(ctx.db, sys, [groupId])).get(groupId) ?? [];
  const names = await namesOf(ctx.db, ctx.org.id, members);
  const rosters = await rostersIn(ctx.db, sys, { groups: [groupId] }, from, to);
  const patterns = await patternsOf(ctx.db, sys, [...new Set(rosters.map((r) => String(r.pattern_id)))]);
  const tz = orgTz(ctx);
  const fromIso = new Date(zonedMidnight(from, tz)).toISOString();
  const toIso = new Date(zonedMidnight(addDays(to, 1), tz)).toISOString();
  const absences = await absencesIn(ctx.db, sys, members, fromIso, toIso, true);
  const holidays = new Map((await holidaysBetween(ctx.db, sys, from, addDays(to, 1)).catch(() => [])).map((h) => [h.date, h.title]));
  const [cap] = await liveRows(ctx.db, sys, "wfm_capacity", { and: [{ f: "group_id", op: "eq", v: groupId }, { f: "user_id", op: "empty" }] }, { limit: 1 });
  const cfg = await workforceConfig(ctx.db, sys);
  const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
  const people: TeamBoard["people"] = [];
  const shiftsByUser = new Map<string, { day: string; start: number; end: number }[]>();
  for (const u of members.sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "fa"))) {
    const cells: BoardCell[] = [];
    for (const d of dates) {
      const { intervals, pattern } = shiftsOn(rosters, patterns, u, d, groupId);
      const ds = zonedMidnight(d, tz);
      const de = zonedMidnight(addDays(d, 1), tz);
      const off = absences.find((a) => a.user_id === u && overlaps(msOf(a.start_at) ?? 0, msOf(a.end_at) ?? 0, ds, de));
      // the type of time off is the person's and their overseers' business; teammates see that they are away
      const showType = u === ctx.user.id || oversees;
      cells.push({
        date: d, code: pattern?.code ?? null, color: pattern?.color ?? null, hours: off ? 0 : hoursOf(intervals), absent: !!off,
        absence: off ? (showType ? `${String(off.label ?? "مرخصی")}${off.state === "requested" ? " (در انتظار تأیید)" : ""}` : "غایب") : null,
      });
      if (!off) for (const [s, e] of intervals) (shiftsByUser.get(u) ?? shiftsByUser.set(u, []).get(u)!).push({ day: d, start: s, end: e });
    }
    people.push({ user_id: u, name: names.get(u) ?? "", me: u === ctx.user.id, cells });
  }
  const min = Number(cap?.min_staff ?? 1);
  const coverage = dates.map((d, i) => {
    const staff = people.filter((p) => p.cells[i].hours > 0).length;
    const working = !holidays.has(d) && people.some((p) => p.cells[i].code);
    return { date: d, staff, min, gap: working && staff < min };
  });
  const issues: LabourIssue[] = [];
  if (oversees) for (const [u, xs] of shiftsByUser) issues.push(...labourIssues(u, xs, { weekly_hours_max: cfg.weekly_hours_max, min_rest_hours: cfg.min_rest_hours, friday_rest: true }));
  return {
    group: { id: groupId, name: String(group?.name ?? "") },
    days: dates.map((d) => ({ date: d, weekday: WEEKDAYS_SHORT[weekday(d)], holiday: holidays.get(d) ?? null })),
    people,
    coverage,
    issues,
    can_manage: oversees,
  };
}
