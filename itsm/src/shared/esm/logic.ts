// Pure logic of enterprise service management, shared by the server and the screens (no I/O):
//   · working-day arithmetic on the SLA service's calendars (Iranian weekends and holidays, half days count as working)
//   · journey planning: start and due dates of every activity from the anchor date, the offsets in working days and
//     the prerequisites; template problems (unknown or circular prerequisites, missing settings); which activities can
//     start now; progress, overdue work and day-one readiness
//   · reservations: overlap, series of a recurring booking, the check-in window and the no-show deadline
//   · cross-department routing: services ranked for a sentence by their names, categories and keywords
//   · the neutral title of sensitive cases
// Imported by the UI: keep it free of server imports.
import { addDays, diffDays } from "../jalali";
import { normalizeSearch } from "../model/conditions";
import { localDate } from "../model/jalali-buckets";
import { MINUTE, shiftsOf, type BusinessCalendar } from "../sla/calendar";

// ----- working days ---------------------------------------------------------------------------------------------------

/** Does `date` (YYYY-MM-DD) have working time on the calendar? Without a calendar every day is a working day. */
export function isWorkingDay(cal: BusinessCalendar | null, date: string): boolean {
  if (!cal) return true;
  return shiftsOf(cal, date).length > 0;
}

/** The first working day on or after (`dir` 1) / on or before (`dir` −1) `date`. */
export function nearestWorkingDay(cal: BusinessCalendar | null, date: string, dir: 1 | -1 = 1): string {
  let d = date;
  for (let i = 0; i < 400; i++) {
    if (isWorkingDay(cal, d)) return d;
    d = addDays(d, dir);
  }
  return date;
}

/**
 * `n` working days after (n > 0) or before (n < 0) `date`; 0 is the day itself when it is a working day, else the next
 * working one. «۳ روز کاری پیش از شروع» of a Saturday start skips the Friday and Thursday-afternoon closures the
 * calendar declares (a half day still counts as a working day).
 */
export function addWorkingDays(cal: BusinessCalendar | null, date: string, n: number): string {
  const steps = Math.trunc(n);
  if (steps === 0) return nearestWorkingDay(cal, date, 1);
  const dir: 1 | -1 = steps > 0 ? 1 : -1;
  let d = date;
  let left = Math.abs(steps);
  for (let guard = 0; left > 0 && guard < 3660; guard++) {
    d = addDays(d, dir);
    if (isWorkingDay(cal, d)) left--;
  }
  return d;
}

/** Working days from `a` to `b` (positive when b is later; the start day is not counted). */
export function workingDaysBetween(cal: BusinessCalendar | null, a: string, b: string): number {
  if (a === b) return 0;
  const dir = diffDays(b, a) > 0 ? 1 : -1;
  let n = 0;
  let d = a;
  for (let guard = 0; d !== b && guard < 3660; guard++) {
    d = addDays(d, dir);
    if (isWorkingDay(cal, d)) n += dir;
  }
  return n;
}

// ----- journeys -------------------------------------------------------------------------------------------------------

export interface PlanActivity {
  code: string;
  /** working days relative to the anchor (null: when the journey starts) */
  start_offset: number | null;
  /** working days to complete once started */
  duration_days: number;
  /** codes of the prerequisites */
  after: string[];
}

export interface PlannedDates {
  start_date: string;
  due_date: string;
}

export interface PlanProblem {
  code: string;
  message: string;
}

/** Codes in an order where every prerequisite comes first; circular or unknown prerequisites are reported. */
export function activityOrder(acts: readonly PlanActivity[]): { order: string[]; problems: PlanProblem[] } {
  const byCode = new Map(acts.map((a) => [a.code, a]));
  const problems: PlanProblem[] = [];
  const seen = new Set<string>();
  const done = new Set<string>();
  const order: string[] = [];
  const visit = (code: string, path: string[]): void => {
    if (done.has(code)) return;
    if (seen.has(code)) {
      problems.push({ code, message: `پیش‌نیازهای «${[...path, code].join(" ← ")}» دور می‌زنند` });
      return;
    }
    seen.add(code);
    const a = byCode.get(code);
    for (const dep of a?.after ?? []) {
      if (!byCode.has(dep)) {
        problems.push({ code, message: `پیش‌نیاز «${dep}» در این الگو نیست` });
        continue;
      }
      visit(dep, [...path, code]);
    }
    done.add(code);
    order.push(code);
  };
  for (const a of acts) visit(a.code, []);
  return { order, problems };
}

/**
 * Start and due dates of every activity: the start is the anchor moved by its offset in working days (or the
 * journey's start), never before the working day after its prerequisites are due; the due date is the start plus its
 * duration in working days. Moving the anchor and planning again re-plans every activity (the server keeps done ones).
 */
export function planJourney(acts: readonly PlanActivity[], opts: { anchor: string; start: string; cal: BusinessCalendar | null }): Map<string, PlannedDates> {
  const { order } = activityOrder(acts);
  const byCode = new Map(acts.map((a) => [a.code, a]));
  const out = new Map<string, PlannedDates>();
  for (const code of order) {
    const a = byCode.get(code)!;
    let start = a.start_offset === null || a.start_offset === undefined ? nearestWorkingDay(opts.cal, opts.start, 1) : addWorkingDays(opts.cal, opts.anchor, a.start_offset);
    for (const dep of a.after) {
      const p = out.get(dep);
      if (!p) continue;
      const afterDep = addWorkingDays(opts.cal, p.due_date, 1);
      if (afterDep > start) start = afterDep;
    }
    const due = addWorkingDays(opts.cal, start, Math.max(0, Math.trunc(a.duration_days || 0)));
    out.set(code, { start_date: start, due_date: due });
  }
  return out;
}

export interface TemplateActivityLike extends PlanActivity {
  name?: string;
  kind?: string;
  catalog_item_code?: string | null;
  case_table?: string | null;
  assignee?: string | null;
  group_id?: string | null;
}

/** What is wrong with a template's activities (Persian), for the template page and the start of a journey. */
export function templateProblems(acts: readonly TemplateActivityLike[]): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const codes = new Map<string, number>();
  for (const a of acts) codes.set(a.code, (codes.get(a.code) ?? 0) + 1);
  for (const [code, n] of codes) if (n > 1) problems.push({ code, message: `کد «${code}» ${n} بار آمده است` });
  for (const a of acts) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(a.code)) problems.push({ code: a.code, message: `کد «${a.code}» فقط حروف کوچک لاتین، رقم و _ دارد` });
    if (a.kind === "order" && !a.catalog_item_code) problems.push({ code: a.code, message: `«${a.name ?? a.code}»: کد قلم کاتالوگ لازم است` });
    if (a.kind === "case" && !a.case_table) problems.push({ code: a.code, message: `«${a.name ?? a.code}»: نوع پرونده لازم است` });
    if (a.assignee === "group" && !a.group_id && a.kind !== "order" && a.kind !== "case") problems.push({ code: a.code, message: `«${a.name ?? a.code}»: گروه انجام‌دهنده لازم است` });
  }
  problems.push(...activityOrder(acts).problems);
  return problems;
}

/** States of activities that let the ones after them start. */
export const ACTIVITY_SETTLED = new Set(["done", "skipped"]);
export const ACTIVITY_FINISHED = new Set(["done", "skipped", "failed"]);

export interface LiveActivity {
  code: string;
  state: string;
  after: string[];
  start_date: string | null;
  due_date: string | null;
  day_one?: boolean;
}

/**
 * The pending activities that may start now: every prerequisite done (or skipped) and their start no later than
 * `horizon` working days from today (work is created a few days ahead, as the template's owner chose).
 */
export function readyToStart(acts: readonly LiveActivity[], opts: { today: string; horizon: number; cal: BusinessCalendar | null }): string[] {
  const state = new Map(acts.map((a) => [a.code, a.state]));
  const limit = addWorkingDays(opts.cal, opts.today, Math.max(0, opts.horizon));
  return acts
    .filter((a) => a.state === "pending" && a.after.every((d) => !state.has(d) || ACTIVITY_SETTLED.has(state.get(d)!)) && (!a.start_date || a.start_date <= limit))
    .map((a) => a.code);
}

export interface JourneyProgress {
  total: number;
  done: number;
  overdue: number;
  progress: number;
  day_one_total: number;
  day_one_done: number;
  day_one_ready: boolean;
  next_due: string | null;
  finished: boolean;
}

/** Progress of a journey: finished activities over all of them, overdue open ones, day-one readiness, the next due date. */
export function journeyProgress(acts: readonly LiveActivity[], today: string): JourneyProgress {
  const total = acts.length;
  const done = acts.filter((a) => ACTIVITY_FINISHED.has(a.state)).length;
  const open = acts.filter((a) => !ACTIVITY_FINISHED.has(a.state));
  const overdue = open.filter((a) => a.due_date && a.due_date < today).length;
  const dayOne = acts.filter((a) => a.day_one);
  // the first day is ready when its work is done — a skipped or failed day-one activity is not (an activity whose
  // condition does not hold for the journey stops being a day-one one when it is skipped)
  const dayOneDone = dayOne.filter((a) => a.state === "done").length;
  const dues = open.map((a) => a.due_date).filter((d): d is string => !!d).sort();
  return {
    total,
    done,
    overdue,
    progress: total ? Math.round((done / total) * 100) : 0,
    day_one_total: dayOne.length,
    day_one_done: dayOneDone,
    day_one_ready: dayOne.length > 0 ? dayOneDone === dayOne.length : true,
    next_due: dues[0] ?? null,
    finished: total > 0 && open.length === 0,
  };
}

/** The activity's state that follows from its work record's state category (null: nothing to change). */
export function activityFromRecord(category: string | null | undefined): "done" | "failed" | null {
  if (category === "closed" || category === "resolved") return "done";
  if (category === "canceled") return "failed";
  return null;
}

// ----- reservations -----------------------------------------------------------------------------------------------------

export interface Span {
  start: number;
  end: number;
}

export const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

/** The reservations of a space that hold its time (a request waiting for approval does not yet). */
export const HOLDS_SPACE = ["confirmed", "checked_in"];

/**
 * The occurrences of a recurring booking: every working day (daily) or the same weekday (weekly) up to `until`
 * (inclusive, in the calendar's zone), at most `max`. The first occurrence is the booking itself.
 */
export function seriesOf(first: Span, recurrence: string, until: string | null, opts: { tz: string; cal: BusinessCalendar | null; max?: number }): Span[] {
  const out: Span[] = [first];
  if (recurrence !== "daily" && recurrence !== "weekly") return out;
  if (!until) return out;
  const max = opts.max ?? 52;
  const len = first.end - first.start;
  const day0 = localDate(first.start, opts.tz);
  for (let i = 1; out.length < max && i < 400; i++) {
    const step = recurrence === "weekly" ? i * 7 : i;
    const date = addDays(day0, step);
    if (date > until) break;
    if (recurrence === "daily" && !isWorkingDay(opts.cal, date)) continue;
    const start = first.start + diffDays(date, day0) * 86_400_000;
    out.push({ start, end: start + len });
  }
  return out;
}

/** When a confirmed reservation may be checked in: from 15 minutes before its start to `minutes` after it. */
export function checkInWindow(startAt: number, endAt: number, minutes: number): Span {
  return { start: startAt - 15 * MINUTE, end: Math.min(endAt, startAt + Math.max(0, minutes) * MINUTE) };
}

/** The instant a confirmed reservation nobody checked in to becomes a no-show (null: the space never releases). */
export function noShowAt(startAt: number, endAt: number, checkInMinutes: number, graceMinutes: number, autoRelease: boolean): number | null {
  if (!autoRelease) return null;
  return Math.min(endAt, startAt + (Math.max(0, checkInMinutes) + Math.max(0, graceMinutes)) * MINUTE);
}

// ----- routing (ESM-009) -------------------------------------------------------------------------------------------------

export interface RoutableService {
  id: string;
  name: string;
  category?: string | null;
  topic?: string | null;
  keywords?: string[] | null;
  description?: string | null;
  department_id: string;
}

const STOP = new Set([
  "و", "در", "به", "از", "که", "را", "با", "برای", "این", "آن", "یک", "من", "ما", "می", "نمی", "است", "هست", "نیست", "شود", "شده", "کند", "کنم", "کنید", "دارم", "دارد", "ندارد",
  "میخواهم", "می‌خواهم", "لطفا", "لطفاً", "چطور", "چگونه", "کار", "هم", "یا", "تا", "اگر", "چه", "برایم", "باید", "خیلی",
]);

/** Persian-normalised words of a sentence (no stop words, at least two letters). */
export function words(text: string): string[] {
  return normalizeSearch(text)
    .toLowerCase()
    .replace(/[‌]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/**
 * Services ranked for what an employee wrote (the employee need not know which department owns it): a keyword or the
 * service name counts most, then its category and topic, then words of its description; prefixes count (‎«حقوق» finds
 * «حقوقی»). Services that share no word are left out.
 */
export function rankServices<T extends RoutableService>(text: string, services: readonly T[], limit = 5): { service: T; score: number }[] {
  const q = words(text);
  if (!q.length) return [];
  const hit = (pool: string[], weight: number) => q.reduce((s, w) => s + (pool.some((p) => p === w) ? weight : pool.some((p) => p.startsWith(w) || w.startsWith(p)) && w.length >= 3 ? weight / 2 : 0), 0);
  const scored = services.map((s) => {
    const strong = [...words(s.name), ...(s.keywords ?? []).flatMap((k) => words(k))];
    const mid = [...words(s.category ?? ""), ...words(s.topic ?? "")];
    const weak = words(s.description ?? "");
    return { service: s, score: hit(strong, 3) + hit(mid, 2) + hit(weak, 1) };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.service.name.localeCompare(b.service.name, "fa")).slice(0, limit);
}

// ----- sensitive cases (ESM-011) -----------------------------------------------------------------------------------------

/** The display title of a case: its summary, or the neutral title when the case is sensitive. */
export const caseTitle = (summary: unknown, sensitive: boolean, mask: string): string => (sensitive ? mask : String(summary ?? "").slice(0, 200));

/** Days a resolved case may wait for its requester before it closes on its own. */
export function autoCloseDue(resolvedAt: number, days: number): number {
  return resolvedAt + Math.max(1, days) * 86_400_000;
}
