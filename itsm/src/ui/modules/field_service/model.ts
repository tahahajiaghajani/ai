// Pure helpers of the field service screens (tested in tests/field_service-ui.test.ts): the dispatch board's geometry
// (the hours a day shows, bars, the time under a drop), the steps a technician may take in each state of a visit, the
// checklist's answers and the KPI tones.
import { toFa } from "@shared/jalali";
import { WO_TASK_STATES } from "@shared/tables/field_service";
import type { ChipTone } from "../../components/display";

export type Row = Record<string, any>;

export interface Window {
  start: number;
  end: number;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

const ms = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** The hours of a day the board shows: 07:00–19:00 at least, widened to the shifts and visits on it, on whole hours. */
export function boardWindow(dayStart: number, dayEnd: number, spans: readonly { start: unknown; end: unknown }[]): Window {
  let lo = dayStart + 7 * HOUR;
  let hi = dayStart + 19 * HOUR;
  for (const s of spans) {
    const a = ms(s.start);
    const b = ms(s.end);
    if (a !== null && a < hi) lo = Math.min(lo, a);
    if (b !== null && b > lo) hi = Math.max(hi, b);
  }
  lo = Math.max(dayStart, dayStart + Math.floor((lo - dayStart) / HOUR) * HOUR);
  hi = Math.min(dayEnd, dayStart + Math.ceil((hi - dayStart) / HOUR) * HOUR);
  return { start: lo, end: Math.max(hi, lo + HOUR) };
}

/** A bar in percent of the window (inline start and size); null when it falls outside or has no start. */
export function placeBar(start: unknown, end: unknown, w: Window): { start: number; size: number } | null {
  const a = ms(start);
  if (a === null) return null;
  const b = ms(end) ?? a + HOUR;
  if (b <= w.start || a >= w.end) return null;
  const s = Math.max(a, w.start);
  const e = Math.min(Math.max(b, a + 15 * MINUTE), w.end);
  const span = w.end - w.start;
  return { start: ((s - w.start) / span) * 100, size: Math.max(((e - s) / span) * 100, 0.8) };
}

/** The start under a drop at a fraction of the lane (0 = the window's start), snapped to `snapMinutes`. */
export function timeAt(fraction: number, w: Window, snapMinutes = 15): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const snap = snapMinutes * MINUTE;
  const raw = w.start + f * (w.end - w.start);
  return Math.min(w.end - snap, Math.max(w.start, Math.round(raw / snap) * snap));
}

/** The fraction of a lane a pointer is at, from the lane's box (the inline start is the right edge in RTL). */
export function fractionAt(clientX: number, box: { left: number; width: number }, rtl: boolean): number {
  if (box.width <= 0) return 0;
  const f = (clientX - box.left) / box.width;
  return rtl ? 1 - f : f;
}

/** "08:30" in the organisation's zone (Latin digits, for inputs); null without a time. */
export function hhmm(v: unknown, tz: string): string | null {
  const t = ms(v);
  if (t === null) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/** «۰۸:۳۰» in the organisation's zone. */
export function clock(v: unknown, tz: string): string {
  const s = hhmm(v, tz);
  return s === null ? "—" : toFa(s);
}

/** The hour ticks of the board's scale. */
export function hourTicks(w: Window, tz: string): { at: number; pct: number; label: string }[] {
  const out: { at: number; pct: number; label: string }[] = [];
  for (let t = w.start; t <= w.end; t += HOUR) out.push({ at: t, pct: ((t - w.start) / (w.end - w.start)) * 100, label: clock(t, tz) });
  return out;
}

/** An ISO instant of a local day and time in the organisation's zone ("2026-11-10", "09:30", "Asia/Tehran"). */
export function instantOf(day: string, hhmm: string, tz: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  // the zone's offset at that wall time: format a first guess back and correct by the difference
  const guess = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, min);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (shown - guess)).toISOString();
}

// ----- the visit's steps ----------------------------------------------------------------------------------------------

export interface StepButton {
  step: "accept" | "reject" | "depart" | "arrive" | "complete" | "leave";
  label: string;
  primary?: boolean;
  /** asks for a reason first */
  reason?: boolean;
  /** sends the position (when the person allows it) */
  position?: boolean;
}

/** What a technician can do with a visit in a state (the my-day buttons, in order). */
export function stepsFor(state: unknown): StepButton[] {
  switch (state) {
    case "assigned":
      return [{ step: "accept", label: "می‌پذیرم", primary: true }, { step: "reject", label: "نمی‌توانم بروم", reason: true }];
    case "accepted":
      return [{ step: "depart", label: "حرکت به محل", primary: true, position: true }, { step: "reject", label: "نمی‌توانم بروم", reason: true }];
    case "en_route":
      return [{ step: "arrive", label: "رسیدم", primary: true, position: true }];
    case "on_site":
      return [{ step: "complete", label: "کار انجام شد", primary: true }];
    case "work_complete":
      return [{ step: "leave", label: "ترک محل", position: true }];
    default:
      return [];
  }
}

export const taskState = (v: unknown) => WO_TASK_STATES.states.find((s) => s.value === v);
export const OPEN_VISIT = ["assigned", "accepted", "en_route", "on_site", "on_hold", "pending_parts"];

/** The answers to send with «کار انجام شد»: only the checklist's keys, numbers as numbers. */
export function cleanAnswers(items: readonly { key: string; type: string }[], answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const it of items) {
    const v = answers[it.key];
    if (v === undefined || v === null || v === "") continue;
    out[it.key] = it.type === "bool" ? v === true : it.type === "number" ? (Number.isFinite(Number(v)) ? Number(v) : String(v)) : String(v);
  }
  return out;
}

/** A KPI's tone against its target (higher is better unless `lowerBetter`). */
export function kpiTone(v: number | null | undefined, target: number, warn: number, lowerBetter = false): ChipTone {
  if (v === null || v === undefined) return "neutral";
  const ok = lowerBetter ? v <= target : v >= target;
  const bad = lowerBetter ? v > warn : v < warn;
  return ok ? "in" : bad ? "danger" : "warning";
}

/** «۲ ساعت و ۱۵ دقیقه» from minutes. */
export function minutesText(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${toFa(h)} ساعت و ${toFa(r)} دقیقه` : `${toFa(h)} ساعت`) : `${toFa(r)} دقیقه`;
}
