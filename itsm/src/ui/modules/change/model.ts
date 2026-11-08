// Pure logic of the change screens (tests/change-ui.test.ts): the queues, the calendar's geometry (days with Fridays
// and holidays, window bands, change bars packed into lanes at the minute), tones of changes and windows, KPI rows of
// the dashboard, the CAB workbench's decision options and the questionnaire's progress. No React, no antd.
import type { Cond } from "@shared/model/conditions";
import { addDays, toJalali, weekday } from "@shared/jalali";
import { localInstant } from "@shared/sla/calendar";
import { answerOption, conflictLabel, riskLabel, windowKindLabel, type RiskOption } from "@shared/change/logic";

export type Row = Record<string, any>;

// ---------------------------------------------------------------------------------------------------------------
// Queues

export interface Queue {
  key: string;
  label: string;
  path: string;
  filter: Cond;
  sort?: string;
  empty: string;
}

const OPEN: Cond = { f: "active", op: "eq", v: true };

export const QUEUES: Queue[] = [
  {
    key: "mine", label: "تغییرهای من", path: "changes/mine", sort: "planned_start",
    filter: { and: [OPEN, { or: [{ f: "assigned_to", op: "is_me" }, { f: "change_owner_id", op: "is_me" }, { f: "change_manager_id", op: "is_me" }] }] },
    empty: "تغییر بازی به شما سپرده نشده است",
  },
  { key: "approval", label: "در انتظار تأیید", path: "changes/awaiting-approval", sort: "submitted_at", filter: { f: "state", op: "eq", v: "authorize" }, empty: "تغییری در انتظار تأیید نیست" },
  {
    key: "week", label: "اجرای هفتهٔ پیش رو", path: "changes/this-week", sort: "planned_start",
    filter: { and: [{ f: "state", op: "in", v: ["scheduled", "implement"] }, { f: "planned_start", op: "relative", v: { unit: "day", n: 7, dir: "next" } }] },
    empty: "برای هفتهٔ پیش رو تغییری زمان‌بندی نشده است",
  },
  { key: "implementing", label: "در حال اجرا", path: "changes/implementing", sort: "planned_end", filter: { f: "state", op: "eq", v: "implement" }, empty: "تغییری در حال اجرا نیست" },
  { key: "conflicts", label: "دارای تداخل", path: "changes/with-conflicts", sort: "planned_start", filter: { and: [OPEN, { f: "conflict_status", op: "eq", v: "conflict" }] }, empty: "تغییر بازی تداخل بررسی‌نشده ندارد" },
  { key: "emergency", label: "تغییرهای اضطراری", path: "changes/emergency", sort: "-opened_at", filter: { and: [OPEN, { f: "type", op: "eq", v: "emergency" }] }, empty: "تغییر اضطراری بازی نیست" },
  { key: "review", label: "در بازبینی", path: "changes/in-review", sort: "actual_end", filter: { f: "state", op: "eq", v: "review" }, empty: "تغییری در بازبینی نیست" },
];

export const queueOf = (key: string): Queue | undefined => QUEUES.find((q) => q.key === key);

// ---------------------------------------------------------------------------------------------------------------
// Tones

export type Tone = "danger" | "warning" | null;

/** How a change needs attention on lists and the calendar. */
export function changeTone(c: Row): Tone {
  if (c.conflict_status === "conflict" || Number(c.conflict_count) > 0 || c.in_blackout) return "danger";
  if (c.outside_window || c.is_late || c.on_hold) return "warning";
  return null;
}

/** Why a change is flagged (Persian, for chips and the calendar's tooltip). */
export function flags(c: Row): string[] {
  const out: string[] = [];
  if (Number(c.conflict_count) > 0) out.push(`${c.conflict_count} تداخل باز`);
  else if (c.conflict_status === "acknowledged") out.push("تداخل بررسی‌شده");
  if (c.in_blackout) out.push("در دورهٔ ممنوعیت یا انجماد");
  if (c.outside_window) out.push("بیرون از پنجرهٔ نگهداری");
  if (c.is_late) out.push("دیرهنگام");
  if (c.on_hold) out.push("متوقف");
  return out;
}

export const riskChip = (risk: unknown): "danger" | "warning" | "neutral" => (risk === "very_high" || risk === "high" ? "danger" : risk === "moderate" ? "warning" : "neutral");

export { riskLabel, conflictLabel, windowKindLabel };

// ---------------------------------------------------------------------------------------------------------------
// The calendar

export type Span = "week" | "2w" | "month";
export const SPANS: { value: Span; label: string; days: number }[] = [
  { value: "week", label: "هفته", days: 7 },
  { value: "2w", label: "دو هفته", days: 14 },
  { value: "month", label: "چهار هفته", days: 28 },
];

/** The Saturday of the week of `iso` (local dates). */
export const weekStart = (iso: string): string => addDays(iso, -weekday(iso));

export interface Day {
  iso: string;
  /** day of the Jalali month */
  jd: number;
  /** Jalali month (for month starts) */
  jm: number;
  weekday: number;
  friday: boolean;
  holiday: string | null;
  half: boolean;
  today: boolean;
}

/** The days of a range with Fridays and the official holidays marked. */
export function daysOf(from: string, n: number, holidays: readonly { date: string; title: string; half?: boolean }[], today: string): Day[] {
  const byDate = new Map(holidays.map((h) => [h.date, h]));
  return Array.from({ length: n }, (_, i) => {
    const iso = addDays(from, i);
    const j = toJalali(iso);
    const h = byDate.get(iso);
    const wd = weekday(iso);
    return { iso, jd: j.jd, jm: j.jm, weekday: wd, friday: wd === 6, holiday: h?.title ?? null, half: !!h?.half, today: iso === today };
  });
}

/** The instants a range of local days covers in `tz`. */
export function rangeMs(from: string, days: number, tz: string): { start: number; end: number } {
  return { start: localInstant(from, 0, tz), end: localInstant(addDays(from, days), 0, tz) };
}

export interface Placed<T> {
  item: T;
  /** start and width in percent of the range (inline-start based) */
  left: number;
  width: number;
  lane: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/**
 * Bars of items within [start, end), packed into lanes (a lane never holds two overlapping bars), positioned in
 * percent at the minute. Items without valid times are left out; a minimum width keeps short changes visible.
 */
export function placeBars<T>(items: readonly T[], range: { start: number; end: number }, startOf: (t: T) => unknown, endOf: (t: T) => unknown, minWidth = 0.6): { bars: Placed<T>[]; lanes: number } {
  const total = range.end - range.start;
  const rows = items
    .map((item) => ({ item, s: msOf(startOf(item)), e: msOf(endOf(item)) }))
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

export interface WindowOcc {
  window_id: string;
  name: string;
  kind: string;
  enforcement: string;
  start: string;
  end: string;
}

/** Window occurrences as bands of the range (blackouts and freezes first, so they sit on top). */
export function windowBands(windows: readonly WindowOcc[], range: { start: number; end: number }): Placed<WindowOcc>[] {
  const order: Record<string, number> = { maintenance: 0, information: 1, freeze: 2, blackout: 3 };
  const sorted = [...windows].sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0));
  return sorted
    .map((w) => placeBars([w], range, (x) => x.start, (x) => x.end, 0).bars[0])
    .filter((b): b is Placed<WindowOcc> => !!b);
}

/** Changes of a local day (month view): those whose planned window touches it, earliest first. */
export function changesOn<T extends Row>(changes: readonly T[], day: string, tz: string): T[] {
  const s = localInstant(day, 0, tz);
  const e = localInstant(addDays(day, 1), 0, tz);
  return changes
    .filter((c) => {
      const a = msOf(c.planned_start);
      const b = msOf(c.planned_end);
      return a !== null && b !== null && a < e && b > s;
    })
    .sort((a, b) => (msOf(a.planned_start) ?? 0) - (msOf(b.planned_start) ?? 0));
}

/** Windows that touch a local day (month view shading). */
export function windowsOn(windows: readonly WindowOcc[], day: string, tz: string): WindowOcc[] {
  const s = localInstant(day, 0, tz);
  const e = localInstant(addDays(day, 1), 0, tz);
  return windows.filter((w) => (msOf(w.start) ?? 0) < e && (msOf(w.end) ?? 0) > s);
}

export const WINDOW_TONE: Record<string, string> = { blackout: "danger", freeze: "freeze", maintenance: "maintenance", information: "info" };

// ---------------------------------------------------------------------------------------------------------------
// Dashboard

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: "%" | "";
  /** "good" when the value meets the usual target, "bad" when it clearly misses it */
  verdict: "good" | "bad" | null;
}

const PCT: [string, string, (v: number) => "good" | "bad" | null][] = [
  ["success_rate", "نرخ موفقیت", (v) => (v >= 95 ? "good" : v < 85 ? "bad" : null)],
  ["failure_rate", "نرخ شکست", (v) => (v <= 5 ? "good" : v > 15 ? "bad" : null)],
  ["backout_rate", "نرخ بازگشت", (v) => (v <= 3 ? "good" : v > 8 ? "bad" : null)],
  ["caused_incident_rate", "تغییرهای منجر به رخداد", (v) => (v <= 5 ? "good" : v > 10 ? "bad" : null)],
  ["emergency_ratio", "سهم تغییرهای اضطراری", (v) => (v <= 10 ? "good" : v > 20 ? "bad" : null)],
  ["standard_ratio", "سهم تغییرهای استاندارد", (v) => (v >= 50 ? "good" : null)],
  ["late_rate", "تغییرهای دیرهنگام", (v) => (v <= 10 ? "good" : v > 25 ? "bad" : null)],
  ["schedule_compliance", "اجرا در پنجرهٔ مجاز", (v) => (v >= 95 ? "good" : v < 85 ? "bad" : null)],
  ["pir_completion", "انجام بازبینی پس از اجرا", (v) => (v >= 95 ? "good" : v < 70 ? "bad" : null)],
];
const COUNTS: [string, string][] = [
  ["total", "تغییرهای ثبت‌شده"],
  ["implemented", "تغییرهای اجراشده"],
  ["backlog", "در ارزیابی یا انتظار تأیید"],
  ["unresolved_conflicts", "مجاز یا در انتظار با تداخل باز"],
];

/** The dashboard's KPI rows from the server's numbers (nothing is computed here but the verdict). */
export function kpiRows(k: Record<string, number | null>): { counts: Kpi[]; rates: Kpi[] } {
  return {
    counts: COUNTS.map(([key, label]) => ({ key, label, value: k[key] ?? null, unit: "" as const, verdict: key === "unresolved_conflicts" && (k[key] ?? 0) > 0 ? ("bad" as const) : null })),
    rates: PCT.map(([key, label, judge]) => ({ key, label, value: k[key] ?? null, unit: "%" as const, verdict: k[key] === null || k[key] === undefined ? null : judge(Number(k[key])) })),
  };
}

/** Is the failure rate monotonic over the risk bands (a calibrated risk model fails more often at higher risk)? */
export function calibrated(bands: readonly { implemented: number; failure_rate: number | null }[]): boolean | null {
  const xs = bands.filter((b) => b.implemented >= 5 && b.failure_rate !== null).map((b) => Number(b.failure_rate));
  if (xs.length < 2) return null;
  return xs.every((x, i) => i === 0 || x >= xs[i - 1]);
}

// ---------------------------------------------------------------------------------------------------------------
// CAB workbench

export interface Votes {
  approved: number;
  rejected: number;
  open: number;
  total: number;
  my_approval: string | null;
}

/** The decisions a person may take on an agenda item: their own vote (an approval of theirs is open) and the chair's. */
export function decisionsFor(item: Row, change: Row | undefined, votes: Votes | undefined, canManage: boolean): { vote: boolean; chair: ("deferred" | "info_requested" | "reviewed")[] } {
  const open = item.decision === "pending" || item.decision === "voting" || item.decision === "deferred" || item.decision === "info_requested";
  const vote = !!change && change.state === "authorize" && item.kind === "authorize" && !!votes?.my_approval && open;
  const chair: ("deferred" | "info_requested" | "reviewed")[] = !canManage || !open ? [] : item.kind === "authorize" ? ["deferred", "info_requested"] : ["reviewed", "deferred"];
  return { vote, chair };
}

/** «۲ موافق، ۱ مخالف از ۳» */
export function voteText(v: Votes | undefined): string {
  if (!v || !v.total) return "رأیی خواسته نشده است";
  return `${v.approved} موافق، ${v.rejected} مخالف از ${v.total}${v.open ? ` (${v.open} در انتظار)` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Risk questionnaire

export interface QuestionView {
  id: string;
  question: string;
  kind: "choice" | "yes_no" | "number";
  weight: number;
  mandatory: boolean;
  help: string | null;
  options: RiskOption[];
}

/** Answered and missing mandatory questions. */
export function progress(questions: readonly QuestionView[], answers: Record<string, unknown>): { answered: number; total: number; missing: number } {
  let answered = 0;
  let missing = 0;
  for (const q of questions) {
    if (answerOption(q, answers[q.id])) answered++;
    else if (q.mandatory) missing++;
  }
  return { answered, total: questions.length, missing };
}

/** Answers without the empty ones (what is sent). */
export function cleanAnswers(answers: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(answers)) if (v !== null && v !== undefined && v !== "") out[k] = typeof v === "number" ? v : String(v);
  return out;
}

/** The factors that weigh most (score × weight), for the risk panel's bars. */
export function topFactors(factors: readonly { key: string; label: string; score: number; weight: number; detail: string }[], n = 4) {
  return [...factors].sort((a, b) => b.score * b.weight - a.score * a.weight).slice(0, n);
}
