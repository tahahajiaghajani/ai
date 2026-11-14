// Budgets of a pull (design A §7.1). Pure arithmetic, tested in tests/discovery-logic.test.ts.
//
//   · Lock-hold budget per IRE call: each call is its own write transaction; it is sized to hold its locks about one
//     budget long — 1 s while the organisation's writes are serialised by its lock (ITSM_SERIALIZE_WRITES), 3 s since D4
//     made writes lock-free (§7.1 «When D4 lands»): the budget then bounds transaction length and row-lock time. The
//     first call of a pass takes 25 items; later ones ⌊budget ÷ per-item time⌋ within [5, 100], from an EWMA of the
//     measured time per item kept apart for new items and refreshes.
//   · Slices: a job invocation works until min(start + 5 s, deadline − 1 s) and comes back for more; an IRE call
//     starts only when the rest of the slice covers 1.5 × its predicted time (it is made smaller to fit, down to 5) —
//     except a slice's first piece of work, which always starts while the deadline is more than a second away.
//   · At most 2 discovery jobs of an organisation work at once: a third comes back in 30 s (plus up to 20% jitter, so
//     jobs turned away together come back apart).
import { writesSerialised } from "../../context";

export const LOCK_BUDGET_SERIALISED_MS = 1000;
export const LOCK_BUDGET_MS = 3000;
export const FIRST_CALL = 25;
export const MIN_CALL = 5;
export const MAX_CALL = 100;
export const SLICE_MS = 5000;
export const SLICE_MARGIN_MS = 1000;
export const START_FACTOR = 1.5;
export const EWMA_WEIGHT = 0.3;
/** What an item is assumed to cost before anything was measured (the design's estimate: 20–40 ms a new item). */
export const DEFAULT_ITEM_MS = 40;
export const MAX_DISCOVERY_JOBS = 2;
export const BUSY_AGAIN_MS = 30_000;

/** When a job the limit turned away comes back: BUSY_AGAIN_MS plus up to 20% jitter. */
export function busyAgainMs(): number {
  return Math.round(BUSY_AGAIN_MS * (1 + Math.random() * 0.2));
}

export type CallMode = "new" | "refresh";
/** Measured milliseconds per item of an IRE call, per mode (kept in the run's cursor across slices). */
export type Ewma = Partial<Record<CallMode, number>>;

/** The lock-hold target of one IRE call in force. */
export function lockBudgetMs(): number {
  return writesSerialised() ? LOCK_BUDGET_SERIALISED_MS : LOCK_BUDGET_MS;
}

/** When a slice that starts at `start` ends: five seconds, and never later than a second before the tick's deadline. */
export function sliceEnd(start: number, deadline: number): number {
  return Math.min(start + SLICE_MS, deadline - SLICE_MARGIN_MS);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Items of the next call of a mode: 25 before any measurement, then what the budget holds within [5, 100]. */
export function callSize(ewma: Ewma, mode: CallMode, budgetMs = lockBudgetMs()): number {
  const per = ewma[mode];
  if (!per || !Number.isFinite(per) || per <= 0) return FIRST_CALL;
  return clamp(Math.floor(budgetMs / per), MIN_CALL, MAX_CALL);
}

/** The time a call of `n` items of a mode is expected to take (ms). */
export function predictMs(ewma: Ewma, mode: CallMode, n: number): number {
  const per = ewma[mode];
  return n * (per && Number.isFinite(per) && per > 0 ? per : DEFAULT_ITEM_MS);
}

/**
 * The size of the call that may start now (0: none — the slice ends): the budget's size, made smaller until the rest
 * of the slice covers 1.5 × its predicted time, never below 5.
 */
export function planCall(ewma: Ewma, mode: CallMode, now: number, end: number, budgetMs = lockBudgetMs()): number {
  const left = end - now;
  let n = callSize(ewma, mode, budgetMs);
  while (n >= MIN_CALL && START_FACTOR * predictMs(ewma, mode, n) > left) n = Math.floor(n / 2);
  if (n >= MIN_CALL) return n;
  // halving may step over the smallest call that still fits
  return START_FACTOR * predictMs(ewma, mode, MIN_CALL) <= left ? MIN_CALL : 0;
}

/**
 * The progress guarantee: a slice's first piece of work (a page, or a call of at least 5 items) starts whatever the
 * estimates say while the tick's deadline is more than a second away — else a pass whose items are slow, in short
 * ticks, would come back for ever without moving.
 */
export function mayForce(workedThisSlice: boolean, now: number, deadline: number): boolean {
  return !workedThisSlice && deadline - now > SLICE_MARGIN_MS;
}

/** The EWMA after a call of `n` items of a mode took `ms`. */
export function observe(ewma: Ewma, mode: CallMode, n: number, ms: number): Ewma {
  if (n <= 0 || !Number.isFinite(ms) || ms < 0) return ewma;
  const sample = Math.max(0.1, ms / n);
  const prev = ewma[mode];
  return { ...ewma, [mode]: prev && prev > 0 ? prev + EWMA_WEIGHT * (sample - prev) : sample };
}
