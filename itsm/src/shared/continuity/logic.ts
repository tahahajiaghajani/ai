// Pure logic of availability, capacity and continuity (docs/modules/continuity_FA.md), shared by the server and the
// screens:
//   availability  availability % of a service over a period on its agreed hours (the service's working calendar with
//                 the official holidays), from the outage register: outages count whole, degradations by their impact,
//                 planned outages only when the organisation counts them; overlapping outages never count twice.
//                 MTBF = uptime ÷ failures, MTRS = downtime ÷ failures, MTBSI = MTBF + MTRS; the downtime budget of
//                 the target; composite availability of serial and redundant components
//   periods       Jalali month, quarter and year in the organisation's zone
//   capacity      utilisation against thresholds; a least-squares time to exhaustion
//   BIA           the RTO a matrix proposes (the first time bucket whose worst impact reaches the tolerance), checks
//   exercises     RTO/RPO met; the timing of the plan's steps during an exercise
// No server or UI imports.
import { businessBetween, type BusinessCalendar } from "../sla/calendar";
import { addUnits, bucketLabel, localDate, unitStart, zonedMidnight } from "../model/jalali-buckets";
import { BIA_BUCKETS, BIA_CATEGORIES } from "../tables/continuity";

export interface OutageLike {
  id?: string;
  begin_at: string | null;
  end_at: string | null;
  outage_type: string;
  impact_pct?: string | number | null;
  excluded?: boolean | null;
  state?: string | null;
}

export interface AvailabilityInput {
  outages: readonly OutageLike[];
  from: number;
  to: number;
  now: number;
  /** the service's agreed hours (null: 24 × 7) */
  cal: BusinessCalendar | null;
  excludePlanned: boolean;
  /** weight of a degradation without an impact percentage (0–100) */
  degradationWeight: number;
  /** availability target in percent (null: none) */
  target?: number | null;
}

export interface Availability {
  agreed_ms: number;
  /** weighted downtime on agreed hours */
  downtime_ms: number;
  /** time with any outage on agreed hours (unweighted) */
  outage_ms: number;
  failures: number;
  availability: number | null;
  mtbf_ms: number | null;
  mtrs_ms: number | null;
  mtbsi_ms: number | null;
  target: number | null;
  met: boolean | null;
  budget_ms: number | null;
  budget_left_ms: number | null;
}

/** States of an outage that count (a proposal is not an outage yet; a canceled one never was). */
export const COUNTED_STATES = ["ongoing", "ended", "validated"];

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

const pct = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

/** The weight (0–1) with which an outage makes its service unavailable, or null when it does not count. */
export function outageWeight(o: OutageLike, excludePlanned: boolean, degradationWeight: number): number | null {
  if (o.state && !COUNTED_STATES.includes(o.state)) return null;
  if (o.excluded) return null;
  if (o.outage_type === "planned" && excludePlanned) return null;
  const impact = pct(o.impact_pct);
  if (o.outage_type === "degradation") return (impact ?? Math.max(0, Math.min(100, degradationWeight))) / 100;
  return (impact ?? 100) / 100;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Availability, downtime, failures, MTBF and MTRS of one service over [from, min(to, now)). */
export function availabilityOf(input: AvailabilityInput): Availability {
  const end = Math.min(input.to, input.now);
  const target = input.target === null || input.target === undefined ? null : pct(input.target);
  const empty: Availability = { agreed_ms: 0, downtime_ms: 0, outage_ms: 0, failures: 0, availability: null, mtbf_ms: null, mtrs_ms: null, mtbsi_ms: null, target, met: null, budget_ms: null, budget_left_ms: null };
  if (!(end > input.from)) return empty;
  const intervals: { a: number; b: number; w: number }[] = [];
  let failures = 0;
  for (const o of input.outages) {
    const w = outageWeight(o, input.excludePlanned, input.degradationWeight);
    const begin = ms(o.begin_at);
    if (w === null || begin === null) continue;
    const stop = ms(o.end_at) ?? input.now;
    if (o.outage_type !== "planned" && begin >= input.from && begin < end) failures++;
    const a = Math.max(begin, input.from);
    const b = Math.min(stop, end);
    if (b > a && w > 0) intervals.push({ a, b, w });
  }
  const points = [...new Set(intervals.flatMap((x) => [x.a, x.b]))].sort((x, y) => x - y);
  let downtime = 0;
  let outage = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const w = Math.max(0, ...intervals.filter((x) => x.a <= a && x.b >= b).map((x) => x.w));
    if (w <= 0) continue;
    const span = businessBetween(input.cal, a, b);
    downtime += span * w;
    outage += span;
  }
  const agreed = businessBetween(input.cal, input.from, end);
  const availability = agreed > 0 ? round(((agreed - downtime) / agreed) * 100) : null;
  const mtrs = failures ? Math.round(outage / failures) : null;
  const mtbf = failures ? Math.round(Math.max(0, agreed - outage) / failures) : null;
  const budget = target !== null && agreed > 0 ? Math.round(agreed * (1 - target / 100)) : null;
  return {
    agreed_ms: agreed,
    downtime_ms: Math.round(downtime),
    outage_ms: Math.round(outage),
    failures,
    availability,
    mtbf_ms: mtbf,
    mtrs_ms: mtrs,
    mtbsi_ms: mtbf !== null && mtrs !== null ? mtbf + mtrs : null,
    target,
    met: availability !== null && target !== null ? availability >= target : null,
    budget_ms: budget,
    budget_left_ms: budget !== null ? budget - Math.round(downtime) : null,
  };
}

/** The monthly downtime budget of a target over a 30-day month, in minutes (99.9 % ≈ 43.2). */
export const monthlyBudgetMinutes = (target: number): number => round(30 * 24 * 60 * (1 - target / 100), 1);

/** A component tree for composite availability: a leaf, components in series (all needed) or redundant ones. */
export type Component = { a: number } | { serial: Component[] } | { parallel: Component[] };

/** Availability (percent) of a component tree: series ΠA, redundant 1 − Π(1 − A). */
export function compositeAvailability(c: Component): number {
  const f = (x: Component): number => {
    if ("a" in x) return Math.max(0, Math.min(100, x.a)) / 100;
    if ("serial" in x) return x.serial.reduce((p, y) => p * f(y), 1);
    return 1 - x.parallel.reduce((p, y) => p * (1 - f(y)), 1);
  };
  return round(f(c) * 100);
}

// ---------------------------------------------------------------------------------------------------------------
// Periods

export type PeriodUnit = "month" | "quarter" | "year";

/** The Jalali month, quarter or year `offset` units from the one containing `now` (0 = current). */
export function periodOf(unit: PeriodUnit, offset: number, now: number, tz: string): { from: number; to: number; label: string; key: string } {
  const start = addUnits(unitStart(localDate(now, tz), unit), unit, offset);
  const next = addUnits(start, unit, 1);
  return { from: zonedMidnight(start, tz), to: zonedMidnight(next, tz), label: bucketLabel(start, unit), key: start };
}

// ---------------------------------------------------------------------------------------------------------------
// Capacity

export function capacityStatus(utilisation: unknown, capacity: unknown, warnPct: unknown = 80, critPct: unknown = 90): { pct: number | null; status: "ok" | "warning" | "critical" | "unknown" } {
  const u = Number(utilisation);
  const c = Number(capacity);
  if (utilisation === null || utilisation === undefined || utilisation === "" || !Number.isFinite(u) || !Number.isFinite(c) || c <= 0) return { pct: null, status: "unknown" };
  const p = round((u / c) * 100, 2);
  const crit = Number(critPct ?? 90);
  const warn = Number(warnPct ?? 80);
  return { pct: p, status: p >= crit ? "critical" : p >= warn ? "warning" : "ok" };
}

/**
 * When the utilisation reaches the capacity on a least-squares line through the samples (epoch ms, value); null
 * without at least three samples over an hour or when it is not growing. Already full: the last sample's time.
 */
export function exhaustionAt(samples: readonly { at: number; v: number }[], capacity: number): number | null {
  const s = samples.filter((x) => Number.isFinite(x.at) && Number.isFinite(x.v)).slice(-200);
  if (s.length < 3 || !(capacity > 0)) return null;
  const t0 = s[0].at;
  if (s[s.length - 1].at - t0 < 3600_000) return null;
  const xs = s.map((x) => (x.at - t0) / 3600_000);
  const n = s.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = s.reduce((a, b) => a + b.v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (s[i].v - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const last = s[n - 1];
  if (last.v >= capacity) return last.at;
  if (!(slope > 0)) return null;
  const hours = (capacity - (my - slope * mx)) / slope;
  const at = t0 + hours * 3600_000;
  return Number.isFinite(at) && at > last.at ? Math.round(at) : last.at;
}

/** Keep the latest samples of a capacity record (at most `max`), adding one. */
export function addSample(samples: unknown, at: number, v: number, max = 120): { at: number; v: number }[] {
  const list = (Array.isArray(samples) ? samples : []).filter((x) => x && Number.isFinite(Number(x.at)) && Number.isFinite(Number(x.v))).map((x) => ({ at: Number(x.at), v: Number(x.v) }));
  list.push({ at, v });
  return list.sort((a, b) => a.at - b.at).slice(-max);
}

// ---------------------------------------------------------------------------------------------------------------
// Business impact analysis

export type Impacts = Record<string, Record<string, number>>;

/** A clean impact matrix: known categories × known buckets, ratings 0–4. */
export function cleanImpacts(raw: unknown): Impacts {
  const out: Impacts = {};
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const c of BIA_CATEGORIES) {
    const row = obj[c.value] && typeof obj[c.value] === "object" ? (obj[c.value] as Record<string, unknown>) : {};
    const clean: Record<string, number> = {};
    for (const b of BIA_BUCKETS) {
      const n = Number(row[b.value]);
      if (Number.isFinite(n)) clean[b.value] = Math.max(0, Math.min(4, Math.round(n)));
    }
    if (Object.keys(clean).length) out[c.value] = clean;
  }
  return out;
}

/** The worst rating of each time bucket across categories, carried forward (impact never shrinks with time). */
export function bucketWorst(impacts: Impacts): number[] {
  let carry = 0;
  return BIA_BUCKETS.map((b) => {
    const worst = Math.max(0, ...Object.values(impacts).map((row) => row[b.value] ?? 0));
    carry = Math.max(carry, worst);
    return carry;
  });
}

/** The RTO the matrix proposes (seconds): the first bucket whose worst impact reaches the tolerance; null when none does. */
export function proposedRto(impacts: Impacts, tolerance = 3): number | null {
  const worst = bucketWorst(impacts);
  const i = worst.findIndex((w) => w >= tolerance);
  return i < 0 ? null : BIA_BUCKETS[i].seconds;
}

/** Why a BIA's targets are inconsistent (Persian), or null: RTO within MTPD, RPO within MTPD. */
export function biaProblem(row: { rto?: unknown; rpo?: unknown; mtpd?: unknown }): string | null {
  const rto = Number(row.rto);
  const rpo = Number(row.rpo);
  const mtpd = Number(row.mtpd);
  if (row.rto !== null && row.rto !== undefined && row.mtpd !== null && row.mtpd !== undefined && Number.isFinite(rto) && Number.isFinite(mtpd) && rto > mtpd) return "زمان هدف بازیابی (RTO) نباید از حداکثر زمان قابل تحمل (MTPD) بیشتر باشد";
  if (row.rpo !== null && row.rpo !== undefined && row.mtpd !== null && row.mtpd !== undefined && Number.isFinite(rpo) && Number.isFinite(mtpd) && rpo > mtpd) return "نقطهٔ هدف بازیابی (RPO) نباید از حداکثر زمان قابل تحمل (MTPD) بیشتر باشد";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Exercises

export function exerciseOutcome(r: { rto_target?: unknown; rpo_target?: unknown; actual_recovery?: unknown; actual_data_loss?: unknown }): { rto_met: boolean; rpo_met: boolean } {
  const has = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  return {
    rto_met: has(r.actual_recovery) && (!has(r.rto_target) || Number(r.actual_recovery) <= Number(r.rto_target)),
    rpo_met: has(r.actual_data_loss) ? !has(r.rpo_target) || Number(r.actual_data_loss) <= Number(r.rpo_target) : has(r.rpo_target) ? false : true,
  };
}

export interface StepTiming {
  seq: number;
  title: string;
  role: string | null;
  /** planned completion, minutes after the start */
  target_min: number;
  /** when it was done (ISO), or null */
  done_at: string | null;
  done_by: string | null;
}

/** The steps of a plan copied into an exercise (in order). */
export function stepLog(steps: readonly { seq?: unknown; title?: unknown; role?: unknown; rto_offset_minutes?: unknown }[]): StepTiming[] {
  return [...steps]
    .map((s) => ({ seq: Number(s.seq) || 0, title: String(s.title ?? ""), role: s.role ? String(s.role) : null, target_min: Math.max(0, Number(s.rto_offset_minutes) || 0), done_at: null, done_by: null }))
    .sort((a, b) => a.seq - b.seq);
}

/** Minutes each done step took against its target (positive: late). */
export function stepDelays(log: readonly StepTiming[], startedAt: string | null): { seq: number; actual_min: number | null; late_min: number | null }[] {
  const start = ms(startedAt);
  return log.map((s) => {
    const done = ms(s.done_at);
    if (start === null || done === null) return { seq: s.seq, actual_min: null, late_min: null };
    const actual = Math.round((done - start) / 60_000);
    return { seq: s.seq, actual_min: actual, late_min: actual - s.target_min };
  });
}

/** The recovery time an exercise's steps show: the last done step after the start (seconds), or null. */
export function recoveryFromSteps(log: readonly StepTiming[], startedAt: string | null): number | null {
  const start = ms(startedAt);
  const done = log.map((s) => ms(s.done_at)).filter((x): x is number => x !== null);
  if (start === null || !done.length || done.length < log.length) return null;
  return Math.max(0, Math.round((Math.max(...done) - start) / 1000));
}
