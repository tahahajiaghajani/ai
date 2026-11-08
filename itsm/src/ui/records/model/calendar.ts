// Calendar and timeline geometry on the Jalali calendar (weeks start on Saturday, Friday is the weekend): month and
// week grids, the local day of a stored date or date-time in the organisation's time zone, records as events
// (a start field and an optional end field), the condition that loads a visible window, moving a record by days
// while keeping its time of day, and the lanes of a timeline. Pure: no React, no antd.
import type { Cond } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { JALALI_MONTHS, addDays, diffDays, fromJalali, monthLength, toFa, toJalali, weekday } from "@shared/jalali";
import { localDate, zonedMidnight } from "@shared/model/jalali-buckets";
import type { RecordRow } from "./types";

export interface DayCell {
  iso: string;
  /** day of the Jalali month */
  jd: number;
  inMonth: boolean;
  /** 0 = Saturday … 6 = Friday */
  weekday: number;
  today: boolean;
}

const cell = (iso: string, jm: number | null, todayIso: string): DayCell => {
  const j = toJalali(iso);
  return { iso, jd: j.jd, inMonth: jm === null || j.jm === jm, weekday: weekday(iso), today: iso === todayIso };
};

/** The weeks (Saturday … Friday) that cover a Jalali month, with the neighbouring months' days at the edges. */
export function monthGrid(jy: number, jm: number, todayIso: string): DayCell[][] {
  const first = fromJalali(jy, jm, 1);
  const last = fromJalali(jy, jm, monthLength(jy, jm));
  const start = addDays(first, -weekday(first));
  const end = addDays(last, 6 - weekday(last));
  const weeks: DayCell[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => cell(addDays(d, i), jm, todayIso)));
  return weeks;
}

/** The Saturday-to-Friday week that holds `iso`. */
export function weekOf(iso: string, todayIso: string): DayCell[] {
  const start = addDays(iso, -weekday(iso));
  return Array.from({ length: 7 }, (_, i) => cell(addDays(start, i), null, todayIso));
}

export function shiftMonth(jy: number, jm: number, d: number): { jy: number; jm: number } {
  const n = jy * 12 + (jm - 1) + d;
  return { jy: Math.floor(n / 12), jm: (n % 12) + 1 };
}

export const monthTitle = (jy: number, jm: number): string => `${JALALI_MONTHS[jm - 1]} ${toFa(jy)}`;

/** «۱۲ تا ۱۸ آبان ۱۴۰۵» (or across months: «۲۸ مهر تا ۴ آبان ۱۴۰۵»). */
export function weekTitle(days: DayCell[]): string {
  const a = toJalali(days[0].iso);
  const b = toJalali(days[days.length - 1].iso);
  const ma = JALALI_MONTHS[a.jm - 1];
  const mb = JALALI_MONTHS[b.jm - 1];
  if (a.jm === b.jm) return `${toFa(a.jd)} تا ${toFa(b.jd)} ${mb} ${toFa(b.jy)}`;
  return `${toFa(a.jd)} ${ma}${a.jy !== b.jy ? ` ${toFa(a.jy)}` : ""} تا ${toFa(b.jd)} ${mb} ${toFa(b.jy)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The local calendar day of a stored date (as is) or date-time (in `tz`); null for an empty or bad value. */
export function dayOf(type: FieldDef["type"], v: unknown, tz: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (type === "date") {
    const d = String(v).slice(0, 10);
    return ISO_DATE.test(d) ? d : null;
  }
  const ms = Date.parse(String(v));
  return Number.isNaN(ms) ? null : localDate(ms, tz);
}

export interface CalendarEvent {
  id: string;
  row: RecordRow;
  /** first and last local day (inclusive) */
  start: string;
  end: string;
  /** epoch ms of a date-time start (sorting inside a day, the time label) */
  at: number | null;
}

/** Records as events: rows without a start are left out; an end before the start is the start's day. */
export function toEvents(rows: readonly RecordRow[], start: FieldDef, end: FieldDef | null, tz: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    const s = dayOf(start.type, row[start.name], tz);
    if (!s) continue;
    const e0 = end ? dayOf(end.type, row[end.name], tz) : null;
    const e = e0 && e0 >= s ? e0 : s;
    const at = start.type === "datetime" ? Date.parse(String(row[start.name])) : null;
    out.push({ id: row.id, row, start: s, end: e, at: at !== null && Number.isNaN(at) ? null : at });
  }
  return out;
}

/** Events that cover a day: multi-day ones first (longest first), then by start time. */
export function eventsOn(events: readonly CalendarEvent[], iso: string): CalendarEvent[] {
  return events
    .filter((e) => e.start <= iso && e.end >= iso)
    .sort((a, b) => diffDays(b.end, b.start) - diffDays(a.end, a.start) || (a.at ?? 0) - (b.at ?? 0) || (a.id < b.id ? -1 : 1));
}

/**
 * The condition that loads every record visible between `from` and `to` (inclusive days): its start in the window,
 * or — with an end field — a span that overlaps it. Date-times compare from local midnight of `from` to local
 * midnight after `to` (a bare date operand of a date-time is its local midnight).
 */
export function windowFilter(start: FieldDef, end: FieldDef | null, from: string, to: string): Cond {
  const after = addDays(to, 1);
  const inWindow = (f: FieldDef): Cond =>
    f.type === "date" ? { f: f.name, op: "between", v: [from, to] } : { and: [{ f: f.name, op: "gte", v: from }, { f: f.name, op: "lt", v: after }] };
  if (!end) return inWindow(start);
  const startsBy: Cond = start.type === "date" ? { f: start.name, op: "lte", v: to } : { f: start.name, op: "lt", v: after };
  return { or: [inWindow(start), { and: [startsBy, { f: end.name, op: "gte", v: from }] }] };
}

/** A stored value moved by `days` days; a date-time keeps its local time of day in `tz`. */
export function shiftValue(type: FieldDef["type"], v: unknown, days: number, tz: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (type === "date") {
    const d = dayOf("date", v, tz);
    return d ? addDays(d, days) : null;
  }
  const ms = Date.parse(String(v));
  if (Number.isNaN(ms)) return null;
  const day = localDate(ms, tz);
  const offset = ms - zonedMidnight(day, tz);
  return new Date(zonedMidnight(addDays(day, days), tz) + offset).toISOString();
}

/** The changes that move an event so it starts on `toDay` (an end field moves with it). */
export function moveEvent(e: CalendarEvent, toDay: string, start: FieldDef, end: FieldDef | null, tz: string): Record<string, string | null> {
  const days = diffDays(toDay, e.start);
  const out: Record<string, string | null> = { [start.name]: shiftValue(start.type, e.row[start.name], days, tz) };
  if (end && e.row[end.name]) out[end.name] = shiftValue(end.type, e.row[end.name], days, tz);
  return out;
}

/** A new record's start on a picked day: the date, or 09:00 local for a date-time. */
export function startValueFor(type: FieldDef["type"], day: string, tz: string): string {
  return type === "date" ? day : new Date(zonedMidnight(day, tz) + 9 * 3600_000).toISOString();
}

// ---------------------------------------------------------------- timeline

/** Every day from `from` to `to` (inclusive). */
export function daysBetween(from: string, to: string): string[] {
  const n = Math.max(0, diffDays(to, from));
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

export interface Bar {
  event: CalendarEvent;
  /** index of the first visible day and the number of visible days */
  offset: number;
  span: number;
  /** the bar continues before / after the window */
  clippedStart: boolean;
  clippedEnd: boolean;
  lane: number;
}

/** Bars of events within [from, to], packed into lanes so overlapping bars never share one. */
export function timelineBars(events: readonly CalendarEvent[], from: string, to: string): { bars: Bar[]; lanes: number } {
  const visible = events.filter((e) => e.end >= from && e.start <= to).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : diffDays(b.end, b.start) - diffDays(a.end, a.start)));
  const laneEnds: string[] = [];
  const bars: Bar[] = [];
  for (const e of visible) {
    const s = e.start < from ? from : e.start;
    const t = e.end > to ? to : e.end;
    let lane = laneEnds.findIndex((end) => end < s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(t);
    } else laneEnds[lane] = t;
    bars.push({ event: e, offset: diffDays(s, from), span: diffDays(t, s) + 1, clippedStart: e.start < from, clippedEnd: e.end > to, lane });
  }
  return { bars, lanes: laneEnds.length };
}

// ---------------------------------------------------------------- timeline at the minute, bands and tones

/** How an item needs attention: an outline and an icon (conflicts, a blackout; late, outside a window). */
export type CalendarTone = "danger" | "warning";

/**
 * A background band of a calendar or timeline: a maintenance window, a blackout or freeze period, an outage — any
 * span of time with a kind (its colour: maintenance, blackout, freeze, information, holiday, danger, warning, info).
 */
export interface CalendarBand {
  id: string;
  /** ISO date-times (or dates: local midnight) */
  start: string;
  end: string;
  label: string;
  kind: string;
  /** the tooltip (default: the label) */
  title?: string;
  /** stacking: higher sits on top (default by kind: maintenance < information < freeze < blackout) */
  rank?: number;
}

/** The instants a range of local days covers in `tz` ([start of `from`, start of the day after the last)). */
export function windowRange(from: string, days: number, tz: string): { start: number; end: number } {
  return { start: zonedMidnight(from, tz), end: zonedMidnight(addDays(from, days), tz) };
}

/** Epoch ms of a stored instant (an ISO date-time, a bare date as UTC midnight, or epoch ms); null when empty or bad. */
export function instantOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export interface Placed<T> {
  item: T;
  /** start and width in percent of the range (from the inline start) */
  left: number;
  width: number;
  lane: number;
  /** the item continues before / after the range */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Items within [start, end) positioned in percent at the minute and packed into lanes (a lane never holds two
 * overlapping items). Items without valid times or with an end not after the start are left out; `minWidth` (percent)
 * keeps short items visible.
 */
export function placeSpans<T>(items: readonly T[], range: { start: number; end: number }, startOf: (t: T) => unknown, endOf: (t: T) => unknown, minWidth = 0.6): { bars: Placed<T>[]; lanes: number } {
  const total = range.end - range.start;
  const rows = items
    .map((item) => ({ item, s: instantOf(startOf(item)), e: instantOf(endOf(item)) }))
    .filter((x): x is { item: T; s: number; e: number } => x.s !== null && x.e !== null && x.e > x.s && x.e > range.start && x.s < range.end)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const laneEnds: number[] = [];
  const bars: Placed<T>[] = [];
  for (const r of rows) {
    const s = Math.max(r.s, range.start);
    const e = Math.min(r.e, range.end);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    const left = ((s - range.start) / total) * 100;
    bars.push({ item: r.item, left, width: Math.min(100 - left, Math.max(minWidth, ((e - s) / total) * 100)), lane, clippedStart: r.s < range.start, clippedEnd: r.e > range.end });
  }
  return { bars, lanes: laneEnds.length };
}

const BAND_RANK: Record<string, number> = { maintenance: 0, information: 1, info: 1, holiday: 1, warning: 2, freeze: 2, danger: 3, blackout: 3 };

/** Bands of the range in stacking order (blackouts and freezes last, so they sit on top), each on the full height. */
export function placeBands<B extends Pick<CalendarBand, "start" | "end" | "kind" | "rank">>(bands: readonly B[], range: { start: number; end: number }): Placed<B>[] {
  const rank = (b: B) => b.rank ?? BAND_RANK[b.kind] ?? 0;
  return [...bands]
    .sort((a, b) => rank(a) - rank(b))
    .map((b) => placeSpans([b], range, (x) => x.start, (x) => x.end, 0).bars[0])
    .filter((x): x is Placed<B> => !!x);
}

/** Items whose span touches a local day in `tz`, earliest first (a month view's cell). */
export function spansOn<T>(items: readonly T[], day: string, tz: string, startOf: (t: T) => unknown, endOf: (t: T) => unknown): T[] {
  const s = zonedMidnight(day, tz);
  const e = zonedMidnight(addDays(day, 1), tz);
  return items
    .filter((x) => {
      const a = instantOf(startOf(x));
      const b = instantOf(endOf(x));
      return a !== null && b !== null && a < e && b > s;
    })
    .sort((a, b) => (instantOf(startOf(a)) ?? 0) - (instantOf(startOf(b)) ?? 0));
}

/** Bands that touch a local day (a month view's chips). */
export const bandsOn = <B extends Pick<CalendarBand, "start" | "end">>(bands: readonly B[], day: string, tz: string): B[] => spansOn(bands, day, tz, (b) => b.start, (b) => b.end);

export interface ScaleDay {
  iso: string;
  /** day and month of the Jalali calendar (a month's name at its first day) */
  jd: number;
  jm: number;
  weekday: number;
  /** a Friday or an official holiday (its title) */
  off: boolean;
  holiday: string | null;
  half: boolean;
  today: boolean;
}

/** The days of a timeline with Fridays and the organisation's holidays marked. */
export function scaleDays(from: string, n: number, holidays: readonly { date: string; title: string; half?: boolean }[], today: string): ScaleDay[] {
  const byDate = new Map(holidays.map((h) => [h.date, h]));
  return Array.from({ length: n }, (_, i) => {
    const iso = addDays(from, i);
    const j = toJalali(iso);
    const h = byDate.get(iso);
    const wd = weekday(iso);
    return { iso, jd: j.jd, jm: j.jm, weekday: wd, off: wd === 6 || !!h, holiday: h?.title ?? null, half: !!h?.half, today: iso === today };
  });
}

/**
 * The span of a calendar event as instants: dates cover their local days whole, date-times are as stored; a date-time
 * start without an end (or with an end before it) lasts an hour.
 */
export function eventSpan(e: CalendarEvent, start: FieldDef, end: FieldDef | null, tz: string): { start: number; end: number } {
  const timed = start.type === "datetime";
  const from = (timed ? instantOf(e.row[start.name]) : null) ?? zonedMidnight(e.start, tz);
  let to: number | null = null;
  if (end?.type === "datetime") to = instantOf(e.row[end.name]);
  else if (end) to = zonedMidnight(addDays(e.end, 1), tz);
  if (to === null || to <= from) to = timed ? from + 3600_000 : zonedMidnight(addDays(e.end, 1), tz);
  return { start: from, end: to };
}

/** «۲۵ اسفند»: a day and its Jalali month (a timeline's title). */
export function dayMonthLabel(iso: string): string {
  const j = toJalali(iso);
  return `${toFa(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
}
