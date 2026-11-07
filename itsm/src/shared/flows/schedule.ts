// Schedules of scheduled flows and of recurring records (`schedule` table): when the next run is, whether a spec is
// valid, and the Persian sentence the screens show. Everything is in the organisation's time zone; `monthly` and
// `yearly` count Jalali months and days, `weekly` days are 0 = Saturday … 6 = Friday, `cron` is the classic five
// fields (minute hour day-of-month month day-of-week; Gregorian; 0 or 7 = Sunday). Pure: server and UI.
import type { ScheduleSpec } from "./types";
import { JALALI_MONTHS, WEEKDAYS, fromJalali, isValidJalali, monthLength, toJalali } from "../jalali";
import { localDate, tzOffsetMs } from "../model/jalali-buckets";
import { faDigits } from "../format";
import { DEFAULT_TIMEZONE } from "../constants";

const DAY = 86_400_000;
/** Shortest interval a schedule may repeat at. */
export const MIN_INTERVAL_MINUTES = 5;

/** Ready-made schedules the editor offers (Jalali months, the Persian week). */
export const SCHEDULE_PRESETS: { key: string; label: string; spec: ScheduleSpec }[] = [
  { key: "hourly", label: "هر ساعت", spec: { kind: "interval", every: 1, unit: "hour" } },
  { key: "daily", label: "هر روز ساعت ۸", spec: { kind: "daily", time: "08:00" } },
  { key: "workdays", label: "روزهای کاری (شنبه تا چهارشنبه) ساعت ۸", spec: { kind: "weekly", time: "08:00", weekdays: [0, 1, 2, 3, 4] } },
  { key: "weekly", label: "هر شنبه ساعت ۹", spec: { kind: "weekly", time: "09:00", weekdays: [0] } },
  { key: "month-start", label: "اول هر ماه شمسی ساعت ۹", spec: { kind: "monthly", time: "09:00", days: [1] } },
  { key: "month-end", label: "آخرین روز هر ماه شمسی ساعت ۹", spec: { kind: "monthly", time: "09:00", days: [], last: true } },
  { key: "season", label: "اول هر فصل ساعت ۹", spec: { kind: "monthly", time: "09:00", days: [1], months: [1, 4, 7, 10] } },
  { key: "nowruz", label: "اول فروردین هر سال ساعت ۹", spec: { kind: "yearly", time: "09:00", month: 1, day: 1 } },
];

/** "HH:MM" → minutes of the day (null when invalid). */
export function parseTime(t: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** The instant of a wall-clock time (minutes of the day) on a local date in `tz`. */
export function zonedTime(isoDate: string, minutes: number, tz: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
};
/** 0 = Saturday … 6 = Friday */
const persianWeekday = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;

// ----- cron ------------------------------------------------------------------------------------------------

interface CronSets {
  minute: boolean[];
  hour: boolean[];
  dom: boolean[];
  month: boolean[];
  dow: boolean[];
  domAny: boolean;
  dowAny: boolean;
}

function cronField(src: string, min: number, max: number, name: string): boolean[] {
  const set = new Array<boolean>(max + 1).fill(false);
  for (const part of src.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`بخش «${name}» در cron معتبر نیست`);
    const step = m[4] ? Number(m[4]) : 1;
    let from = min;
    let to = max;
    if (m[1] !== "*") {
      from = Number(m[2]);
      to = m[3] !== undefined ? Number(m[3]) : m[4] ? max : from;
    }
    if (!step || from < min || to > max || from > to) throw new Error(`بخش «${name}» در cron خارج از بازه است`);
    for (let v = from; v <= to; v += step) set[v] = true;
  }
  return set;
}

/** Parse a five-field cron expression (throws a Persian message). */
export function parseCron(expr: string): CronSets {
  const parts = String(expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("عبارت cron باید پنج بخش داشته باشد: دقیقه ساعت روز ماه روزِهفته");
  const [mi, h, dom, mon, dow] = parts;
  const dowSet = cronField(dow, 0, 7, "روز هفته");
  if (dowSet[7]) dowSet[0] = true;
  return {
    minute: cronField(mi, 0, 59, "دقیقه"),
    hour: cronField(h, 0, 23, "ساعت"),
    dom: cronField(dom, 1, 31, "روز ماه"),
    month: cronField(mon, 1, 12, "ماه"),
    dow: dowSet.slice(0, 7),
    domAny: dom.trim() === "*",
    dowAny: dow.trim() === "*",
  };
}

function cronNext(c: CronSets, after: number, tz: string): number | null {
  let day = localDate(after, tz);
  for (let i = 0; i < 366 * 5; i++, day = addDays(day, 1)) {
    const [, m, d] = day.split("-").map(Number);
    if (!c.month[m]) continue;
    const dowOk = c.dow[new Date(`${day}T00:00:00Z`).getUTCDay()];
    const domOk = c.dom[d];
    const dayOk = c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) continue;
    for (let h = 0; h < 24; h++) {
      if (!c.hour[h]) continue;
      for (let mi = 0; mi < 60; mi++) {
        if (!c.minute[mi]) continue;
        const t = zonedTime(day, h * 60 + mi, tz);
        if (t > after) return t;
      }
    }
  }
  return null;
}

// ----- validation and next run -------------------------------------------------------------------------------

/** Why a schedule is not valid (Persian), or null. */
export function scheduleProblem(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return "زمان‌بندی را مشخص کنید";
  const s = spec as ScheduleSpec;
  const timeOk = (t: unknown) => parseTime(t) !== null;
  switch (s.kind) {
    case "interval": {
      const every = Number(s.every);
      if (!Number.isInteger(every) || every < 1 || every > 10_000) return "فاصلهٔ تکرار باید عددی صحیح و مثبت باشد";
      if (!["minute", "hour", "day"].includes(s.unit)) return "واحد فاصلهٔ تکرار معتبر نیست";
      if (s.unit === "minute" && every < MIN_INTERVAL_MINUTES) return `فاصلهٔ تکرار دست‌کم ${faDigits(MIN_INTERVAL_MINUTES)} دقیقه است`;
      if (s.start && Number.isNaN(Date.parse(s.start))) return "زمان آغاز تکرار معتبر نیست";
      return null;
    }
    case "daily":
      return timeOk(s.time) ? null : "ساعت را به شکل ۰۸:۳۰ وارد کنید";
    case "weekly":
      if (!timeOk(s.time)) return "ساعت را به شکل ۰۸:۳۰ وارد کنید";
      if (!Array.isArray(s.weekdays) || !s.weekdays.length || s.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "روزهای هفته را انتخاب کنید";
      return null;
    case "monthly":
      if (!timeOk(s.time)) return "ساعت را به شکل ۰۸:۳۰ وارد کنید";
      if (!Array.isArray(s.days) || s.days.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return "روزهای ماه باید میان ۱ و ۳۱ باشند";
      if (!s.days.length && !s.last) return "روزهای ماه را انتخاب کنید";
      if (s.months && (!Array.isArray(s.months) || s.months.some((m) => !Number.isInteger(m) || m < 1 || m > 12))) return "ماه‌ها معتبر نیستند";
      return null;
    case "yearly":
      if (!timeOk(s.time)) return "ساعت را به شکل ۰۸:۳۰ وارد کنید";
      if (!Number.isInteger(s.month) || s.month < 1 || s.month > 12) return "ماه معتبر نیست";
      if (!Number.isInteger(s.day) || s.day < 1 || s.day > (s.month <= 6 ? 31 : 30)) return "روز معتبر نیست";
      return null;
    case "cron":
      try {
        parseCron(s.expr);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    case "once":
      return s.at && !Number.isNaN(Date.parse(s.at)) ? null : "زمان اجرا معتبر نیست";
    default:
      return "نوع زمان‌بندی معتبر نیست";
  }
}

/**
 * The first instant strictly after `after` (epoch ms) at which the schedule fires, in `tz`; null when it never
 * fires again (a past `once`) or the spec is invalid.
 */
export function nextOccurrence(spec: ScheduleSpec, after: number, tz: string = DEFAULT_TIMEZONE): number | null {
  if (scheduleProblem(spec)) return null;
  switch (spec.kind) {
    case "interval": {
      const step = spec.every * (spec.unit === "minute" ? 60_000 : spec.unit === "hour" ? 3_600_000 : DAY);
      if (!spec.start) return after + step;
      const start = Date.parse(spec.start);
      if (start > after) return start;
      return start + (Math.floor((after - start) / step) + 1) * step;
    }
    case "daily":
    case "weekly": {
      const t = parseTime(spec.time)!;
      let day = localDate(after, tz);
      for (let i = 0; i < 9; i++, day = addDays(day, 1)) {
        if (spec.kind === "weekly" && !spec.weekdays.includes(persianWeekday(day))) continue;
        const at = zonedTime(day, t, tz);
        if (at > after) return at;
      }
      return null;
    }
    case "monthly": {
      const t = parseTime(spec.time)!;
      let day = localDate(after, tz);
      for (let i = 0; i < 400; i++, day = addDays(day, 1)) {
        const j = toJalali(day);
        if (spec.months?.length && !spec.months.includes(j.jm)) continue;
        const last = j.jd === monthLength(j.jy, j.jm);
        if (!spec.days.includes(j.jd) && !(spec.last && last)) continue;
        const at = zonedTime(day, t, tz);
        if (at > after) return at;
      }
      return null;
    }
    case "yearly": {
      const t = parseTime(spec.time)!;
      const { jy } = toJalali(localDate(after, tz));
      for (let y = jy; y <= jy + 8; y++) {
        if (!isValidJalali(y, spec.month, spec.day)) continue;
        const at = zonedTime(fromJalali(y, spec.month, spec.day), t, tz);
        if (at > after) return at;
      }
      return null;
    }
    case "cron":
      return cronNext(parseCron(spec.expr), after, tz);
    case "once": {
      const at = Date.parse(spec.at);
      return at > after ? at : null;
    }
  }
}

const listFa = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join("، ")} و ${items[items.length - 1]}`);

function wallTime(ms: number, tz: string): string {
  const local = new Date(ms + tzOffsetMs(ms, tz));
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

/** «هر روز ساعت ۰۸:۰۰», «آخرین روز هر ماه ساعت ۰۹:۰۰ در فروردین و تیر»… */
export function describeSchedule(spec: ScheduleSpec | null | undefined, tz: string = DEFAULT_TIMEZONE): string {
  if (!spec || scheduleProblem(spec)) return "زمان‌بندی نامعتبر";
  const at = (t: string) => `ساعت ${faDigits(t)}`;
  switch (spec.kind) {
    case "interval":
      return `هر ${spec.every === 1 ? "" : `${faDigits(spec.every)} `}${spec.unit === "minute" ? "دقیقه" : spec.unit === "hour" ? "ساعت" : "روز"}`.replace("  ", " ");
    case "daily":
      return `هر روز ${at(spec.time)}`;
    case "weekly": {
      const days = [...spec.weekdays].sort((a, b) => a - b);
      const contiguous = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
      const names = contiguous ? `${WEEKDAYS[days[0]]} تا ${WEEKDAYS[days[days.length - 1]]}` : listFa(days.map((d) => WEEKDAYS[d]));
      return `هر ${names} ${at(spec.time)}`;
    }
    case "monthly": {
      const parts = [...spec.days].sort((a, b) => a - b).map((d) => faDigits(d));
      const which = [parts.length ? `روز ${listFa(parts)}` : "", spec.last ? "آخرین روز" : ""].filter(Boolean).join(" و ");
      const months = spec.months?.length ? ` در ${listFa([...spec.months].sort((a, b) => a - b).map((m) => JALALI_MONTHS[m - 1]))}` : "";
      return `${which} هر ماه ${at(spec.time)}${months}`;
    }
    case "yearly":
      return `هر سال ${faDigits(spec.day)} ${JALALI_MONTHS[spec.month - 1]} ${at(spec.time)}`;
    case "cron":
      return `cron: ${spec.expr}`;
    case "once": {
      const ms = Date.parse(spec.at);
      const j = toJalali(localDate(ms, tz));
      return `یک بار، ${faDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faDigits(j.jy)} ${at(wallTime(ms, tz))}`;
    }
  }
}

/** A stable text of a spec (the scheduler re-plans a timer when it changes). */
export function scheduleKey(spec: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(spec ?? null));
}
