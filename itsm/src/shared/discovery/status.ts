// Status of a target from all its sources (design A §9.3) and the ATM hysteresis (§9.5): pure rules, shared by the
// server's status code and its tests.
//
// Aggregation onto a CI or asset:
//   · a source's status older than 3 × its status interval is not fresh and does not count (signals of pushed alerts
//     never age: they last until their alert clears)
//   · an active maintenance wins: from any fresh source, an event-management maintenance window or a change being
//     implemented on the CI (`maintenanceFor`)
//   · `off` from a virtualisation source (vCenter) explains down or unreachable from monitors and wins over them
//   · otherwise the worst fresh state: down > unreachable > warning > off > up > unknown; `sources` counts the fresh ones
// The ATM step (`deviceStep`): a reported value that differs from the asset's becomes pending from the tool's `since`
// (else its first observation) and is applied only after `device_hold_minutes` and, for pulled sources, two passes in a
// row; a value that reverts earlier never opens a period. A connector never sets nor overwrites «در نگهداری», and a
// person's change (the asset's value differs from what Kariz last wrote) is respected until the tool reports a
// transition after it or `manual_hold_hours` pass.
// Imported by the UI: keep it free of server imports.
import type { StatusState } from "./types";

/** A source's status counts while it is younger than this many of its status intervals. */
export const FRESH_FACTOR = 3;
/** The interval of a source that names none (minutes). */
export const DEFAULT_STATUS_MINUTES = 60;

const RANK: Record<StatusState, number> = { unknown: 0, up: 1, off: 2, warning: 3, unreachable: 4, down: 5, maintenance: 6 };

/** Order of states for lists (worst first). */
export function stateRank(s: string | null | undefined): number {
  return RANK[(s ?? "unknown") as StatusState] ?? 0;
}

/** How long a connector's status stays fresh (ms): 3 × its status interval, else its inventory interval, else an hour. */
export function freshForMs(c: { status_every_minutes?: number | null; every_minutes?: number | null }): number {
  const every = Number(c.status_every_minutes) > 0 ? Number(c.status_every_minutes) : Number(c.every_minutes) > 0 ? Number(c.every_minutes) : DEFAULT_STATUS_MINUTES;
  return FRESH_FACTOR * every * 60_000;
}

export interface SourceStatus {
  state: StatusState;
  /** when the source saw the state begin */
  since?: string | null;
  message?: string | null;
  /** when the source last reported it (null: a signal that lasts until cleared) */
  observed_at?: string | null;
  /** how long it stays fresh (null: never ages) */
  fresh_ms?: number | null;
  /** a virtualisation source (its `off` explains monitors' down) */
  virtualisation?: boolean;
}

export interface Aggregate {
  state: StatusState;
  since: string | null;
  message: string | null;
  sources: number;
}

export function isFresh(s: SourceStatus, now: number): boolean {
  // a signal lasts until its alert clears
  if (s.fresh_ms === null || s.fresh_ms === undefined) return true;
  const at = s.observed_at ? Date.parse(s.observed_at) : NaN;
  return Number.isFinite(at) && now - at <= s.fresh_ms;
}

const earliest = (xs: (string | null | undefined)[]): string | null => {
  let best: number | null = null;
  for (const x of xs) {
    const t = x ? Date.parse(x) : NaN;
    if (Number.isFinite(t) && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
};

/** The status of a target from its sources (§9.3). */
export function aggregateStatus(sources: SourceStatus[], opts: { now: number; maintenance?: { label: string; since?: string | null } | null }): Aggregate {
  const fresh = sources.filter((s) => isFresh(s, opts.now));
  const pick = (state: StatusState, among: SourceStatus[], message?: string | null): Aggregate => {
    const these = among.filter((s) => s.state === state);
    return { state, since: earliest(these.map((s) => s.since)), message: message ?? these.find((s) => s.message)?.message ?? null, sources: fresh.length };
  };
  if (opts.maintenance) return { ...pick("maintenance", fresh, opts.maintenance.label), since: opts.maintenance.since ?? earliest(fresh.filter((s) => s.state === "maintenance").map((s) => s.since)) };
  if (fresh.some((s) => s.state === "maintenance")) return pick("maintenance", fresh);
  const off = fresh.filter((s) => s.virtualisation && s.state === "off");
  if (off.length) return pick("off", off);
  let worst: StatusState = "unknown";
  for (const s of fresh) if (RANK[s.state] > RANK[worst]) worst = s.state;
  return pick(worst, fresh);
}

// ---------------------------------------------------------------------------------------------------------------
// ATMs: the bank's device_status with hysteresis (§9.5)

/** The device statuses a connector may set (never «در نگهداری»: only a person sets and clears it). */
export const CONNECTOR_DEVICE_STATUSES = ["in_service", "out_of_service", "out_of_cash", "offline"] as const;
export const DEVICE_STATUS_VALUES = [...CONNECTOR_DEVICE_STATUSES, "maintenance"] as const;

/**
 * A tool's value as a DEVICE_STATUS value: through the connector's `device_status_map` (case-insensitive keys), else
 * the value itself when it already is one; unmapped values go only to the status message (null).
 */
export function mapDeviceStatus(raw: unknown, map: Record<string, unknown> | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const m = map && typeof map === "object" ? map : {};
  const hit = Object.entries(m).find(([k]) => k.trim().toLowerCase() === v.toLowerCase());
  const out = hit ? String(hit[1] ?? "").trim().toLowerCase() : v.toLowerCase();
  return (DEVICE_STATUS_VALUES as readonly string[]).includes(out) ? out : null;
}

/** discovery_state's ATM columns. */
export interface DeviceColumns {
  device_reported: string | null;
  device_reported_since: string | null;
  device_pending: string | null;
  device_pending_since: string | null;
  device_pending_polls: number | null;
  device_applied: string | null;
  device_applied_at: string | null;
}

export interface DeviceObservation {
  /** the mapped value (null: unmapped — status message only) */
  value: string | null;
  /** the tool's own time of the value */
  since?: string | null;
  /** when Kariz received it */
  at: string;
}

export interface DeviceRules {
  hold_minutes: number;
  manual_hold_hours: number;
  /** a pulled source (two passes in a row are needed); pushes need only the hold */
  pulled: boolean;
}

export interface DeviceStep {
  next: DeviceColumns;
  /** apply now: the value and the tool's time of it (the period starts there, clamped by the bank hook) */
  apply: { value: string; at: string } | null;
  /** when to look again (the end of the hold), when nothing is applied now */
  wake_at: string | null;
  /** why nothing is pending (tests and the run's warnings) */
  note?: "maintenance" | "person" | "same" | "unmapped" | "waiting";
}

const ms = (x: string | null | undefined) => (x ? Date.parse(x) : NaN);

/**
 * One step of an ATM's hysteresis: a new observation (`obs`) or, without one, the check at the end of a hold. The
 * asset's live value and its time decide what is current; `device_applied` tells Kariz's own last write from a
 * person's. `device_reported_since` is the tool's time of the reported value (else its first observation): the hold
 * runs from it and the applied period starts there. `device_pending_since` is when Kariz first saw the pending value;
 * a later observation of the same value is a second pass (the same observation again — the same listing read twice —
 * never counts twice).
 */
export function deviceStep(cur: DeviceColumns, asset: { device_status: string | null; device_status_at: string | null }, obs: DeviceObservation | null, rules: DeviceRules, now: number): DeviceStep {
  const next: DeviceColumns = { ...cur };
  if (obs) {
    if (!obs.value) return { next, apply: null, wake_at: null, note: "unmapped" };
    if (obs.value !== cur.device_reported) {
      next.device_reported = obs.value;
      next.device_reported_since = obs.since && Number.isFinite(ms(obs.since)) && ms(obs.since) <= Math.max(now, ms(obs.at)) ? new Date(ms(obs.since)).toISOString() : obs.at;
    }
  }
  const clear = (note: DeviceStep["note"]): DeviceStep => ({ next: { ...next, device_pending: null, device_pending_since: null, device_pending_polls: null }, apply: null, wake_at: null, note });
  const value = next.device_reported;
  const current = asset.device_status;
  // only a person sets and clears maintenance
  if (current === "maintenance") return clear("maintenance");
  // a person's change: the asset's value is not what Kariz last wrote — respected until the tool reports a transition
  // after it, or until manual_hold_hours pass
  if (cur.device_applied && current !== cur.device_applied) {
    const personAt = ms(asset.device_status_at);
    const transitionAfter = Number.isFinite(personAt) && ms(next.device_reported_since) > personAt;
    if (Number.isFinite(personAt) && !transitionAfter && now < personAt + rules.manual_hold_hours * 3600_000) return clear("person");
  }
  if (!value || !(CONNECTOR_DEVICE_STATUSES as readonly string[]).includes(value)) return clear("unmapped");
  if (value === current) return clear("same");
  if (next.device_pending !== value) {
    next.device_pending = value;
    next.device_pending_since = obs?.at ?? new Date(now).toISOString();
    next.device_pending_polls = obs && rules.pulled ? 1 : 0;
  } else if (obs && rules.pulled && ms(obs.at) > ms(next.device_pending_since)) next.device_pending_polls = Math.max(2, next.device_pending_polls ?? 0);
  const from = ms(next.device_reported_since ?? next.device_pending_since);
  const holdEnd = from + rules.hold_minutes * 60_000;
  const held = now >= holdEnd;
  const polled = !rules.pulled || (next.device_pending_polls ?? 0) >= 2;
  if (held && polled) return { next, apply: { value, at: new Date(from).toISOString() }, wake_at: null };
  return { next, apply: null, wake_at: held ? null : new Date(holdEnd).toISOString(), note: "waiting" };
}

/** The columns after an applied value. */
export function appliedColumns(cur: DeviceColumns, value: string, at: string): DeviceColumns {
  return { ...cur, device_pending: null, device_pending_since: null, device_pending_polls: null, device_applied: value, device_applied_at: at };
}
