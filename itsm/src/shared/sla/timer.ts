// SLA timers (docs/spec/services/sla.md §3): what a task SLA row means at an instant — working time used, share of
// the target, the deadline, what is left — and when its next warning or its breach falls due. Pure: the engine's
// hooks and jobs, the record page's `meta.sla`, the timeline endpoint and the definition editor's preview all use it.
//
// Accounting: `elapsed = working time in [start_at, end) − paused_total − (the open pause)`, where `end` is the stop
// instant of a stopped timer and `now` otherwise, and `paused_total` (seconds) is the working time spent in pauses
// already closed. A running timer's deadline is the instant at which `duration + paused_total` of working time have
// passed since `start_at`; a paused one has no deadline of its own (shown as "if it resumed now").
import { addBusiness, businessBetween, type BusinessCalendar } from "./calendar";

export type SlaStage = "in_progress" | "paused" | "achieved" | "breached" | "canceled";

/** Stages in which a timer still counts (or waits to count again). */
export const LIVE_STAGES: SlaStage[] = ["in_progress", "paused", "breached"];

export interface TimerRow {
  start_at: string | null;
  stop_at?: string | null;
  pause_started_at?: string | null;
  /** seconds of working time spent in closed pauses */
  paused_total?: number | string | null;
  /** the target, in seconds of working time */
  duration: number | string | null;
  stage: SlaStage | string;
  /** the deadline passed at some point */
  breached?: boolean | null;
  breached_at?: string | null;
  planned_end_at?: string | null;
  /** still counting or paused (not stopped or canceled) */
  active?: boolean | null;
}

export interface TimerState {
  /** working ms used */
  elapsedMs: number;
  durationMs: number;
  /** share of the target used, in percent (beyond 100 once overdue) */
  percent: number;
  /** epoch ms of the deadline: running — when it falls; paused — if it resumed now; stopped — the one it had */
  plannedEnd: number | null;
  /** working ms left (negative once overdue) */
  remainingMs: number;
  /** wall-clock ms until the deadline (negative once overdue); null when unknown */
  remainingWallMs: number | null;
  running: boolean;
  paused: boolean;
  /** stopped or canceled */
  done: boolean;
  /** overdue now (or overdue when it stopped), or marked breached */
  breached: boolean;
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Is the row still counting or paused? */
export const isLive = (row: Pick<TimerRow, "stage" | "active">): boolean => (row.active ?? LIVE_STAGES.includes(row.stage as SlaStage)) && row.stage !== "achieved" && row.stage !== "canceled";

/** The timer of `row` at instant `now` on `cal` (null calendar = 24 × 7). */
export function evaluateTimer(row: TimerRow, cal: BusinessCalendar | null, now: number): TimerState {
  const start = ms(row.start_at) ?? now;
  const stop = ms(row.stop_at);
  const live = isLive(row) && stop === null;
  const end = live ? Math.max(now, start) : (stop ?? now);
  const pauseStart = ms(row.pause_started_at);
  const paused = live && pauseStart !== null;
  const durationMs = Math.max(0, num(row.duration) * 1000);
  const pausedTotalMs = Math.max(0, num(row.paused_total) * 1000);
  const openPause = pauseStart !== null && end > pauseStart ? businessBetween(cal, pauseStart, end) : 0;
  const elapsedMs = Math.max(0, businessBetween(cal, start, end) - pausedTotalMs - openPause);
  const percent = durationMs > 0 ? (elapsedMs / durationMs) * 100 : elapsedMs > 0 ? 100 : 0;
  let plannedEnd: number | null;
  if (!live) plannedEnd = ms(row.planned_end_at);
  else if (paused) plannedEnd = addBusiness(cal, end, Math.max(0, durationMs - elapsedMs));
  else plannedEnd = addBusiness(cal, start, durationMs + pausedTotalMs);
  const remainingMs = durationMs - elapsedMs;
  const breached = !!row.breached || row.stage === "breached" || (durationMs > 0 && elapsedMs >= durationMs);
  return {
    elapsedMs,
    durationMs,
    percent,
    plannedEnd,
    remainingMs,
    remainingWallMs: plannedEnd === null ? null : plannedEnd - end,
    running: live && !paused,
    paused,
    done: !live,
    breached,
  };
}

/** The instant a running timer reaches `pct` percent of its target (null when paused, stopped or unreachable). */
export function thresholdAt(row: TimerRow, cal: BusinessCalendar | null, pct: number): number | null {
  if (!isLive(row) || row.pause_started_at || row.stop_at) return null;
  const start = ms(row.start_at);
  if (start === null) return null;
  const target = (num(row.duration) * 1000 * pct) / 100;
  return addBusiness(cal, start, target + Math.max(0, num(row.paused_total) * 1000));
}

/** Warning thresholds (percent, ascending, unique, 1–99) from a definition's `warn_percents`. */
export function warnLevels(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,،\s]+/) : [];
  const out = new Set<number>();
  for (const x of list) {
    const n = Math.round(Number(String(x).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))));
    if (Number.isFinite(n) && n > 0 && n < 100) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * What a timer job must do at `now`: the highest warning level reached and not yet announced (`warn`), whether the
 * breach is due and not yet recorded (`breach`), and when to look again (`next`, null when nothing is left).
 */
export function dueEvents(row: TimerRow & { warned?: number | null }, cal: BusinessCalendar | null, levels: readonly number[], now: number): { warn: number | null; breach: boolean; next: number | null; state: TimerState } {
  const state = evaluateTimer(row, cal, now);
  if (state.done) return { warn: null, breach: false, next: null, state };
  const warned = num(row.warned);
  const reached = levels.filter((p) => p > warned && state.percent >= p);
  const warn = reached.length ? reached[reached.length - 1] : null;
  const already = !!row.breached || row.stage === "breached";
  const breach = !already && state.durationMs > 0 && state.elapsedMs >= state.durationMs;
  if (state.paused) return { warn, breach, next: null, state };
  const upcoming: number[] = [];
  const top = Math.max(warned, warn ?? 0);
  for (const p of levels) {
    if (p <= top) continue;
    const at = thresholdAt(row, cal, p);
    if (at !== null && at > now) upcoming.push(at);
  }
  if (!already && !breach && state.plannedEnd !== null && state.plannedEnd > now) upcoming.push(state.plannedEnd);
  return { warn, breach, next: upcoming.length ? Math.min(...upcoming) : null, state };
}

/** Priority values whose durations a definition may set (the task's 1–5). */
export const PRIORITY_KEYS = ["1", "2", "3", "4", "5"] as const;

export interface DurationSpec {
  duration_mode?: string | null;
  duration?: number | string | null;
  durations?: unknown;
  priority_field?: string | null;
}

/** The target (seconds) a definition gives a record: fixed, or by the record's priority. Null when none applies. */
export function targetSeconds(def: DurationSpec, record: Record<string, unknown>): number | null {
  if ((def.duration_mode ?? "priority") === "fixed") {
    const d = num(def.duration);
    return d > 0 ? Math.round(d) : null;
  }
  const map = def.durations && typeof def.durations === "object" && !Array.isArray(def.durations) ? (def.durations as Record<string, unknown>) : {};
  const key = record[def.priority_field || "priority"];
  if (key === null || key === undefined || key === "") return null;
  const d = num(map[String(key)]);
  return d > 0 ? Math.round(d) : null;
}

/** Why a `durations` object is not valid (Persian), or null. */
export function durationsProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "مدت‌ها باید به ازای هر اولویت تعیین شوند";
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return `اولویت «${k}» معتبر نیست`;
    if (v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 10 * 366 * 86400) return `مدت اولویت «${k}» معتبر نیست`;
  }
  return null;
}
