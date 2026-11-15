// Write-lock probe (docs/PERFORMANCE_FA.md «دور دوم» و «دور سوم»): how long transactions wait for and hold an
// organisation's lock (its sm_org_sync row, taken by `lockOrg` — since round 3 only by rare organisation-wide changes,
// or by every write with ITSM_SERIALIZE_WRITES), and what they were doing — the HTTP route or the job kind.
// Off unless a measurement runner installs a sink (scripts/serve-pg.mjs --lock-stats): then `lockOrg` stamps the
// moment the lock was granted on the transaction and the database layer reports wait and hold when the transaction
// ends (commit or rollback). Nothing is recorded and nothing changes in production.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Tx } from "./index";

export interface LockSample {
  /** what the transaction belonged to: "PATCH /o/:org/r/incident/:id", "job notify.send"… ("-" when unknown) */
  label: string;
  /** time spent waiting for the lock (the lockOrg statement) */
  waitMs: number;
  /** from the moment the lock was granted until the transaction ended */
  holdMs: number;
  /** whether the transaction committed */
  committed: boolean;
}

type Sink = (s: LockSample) => void;

let sink: Sink | null = null;
const labels = new AsyncLocalStorage<string>();
const held = new WeakMap<object, { at: number; waitMs: number; label: string }>();

/** Install (or remove, with null) the sink that receives one sample per transaction that took the write lock. */
export function setLockProbe(fn: Sink | null): void {
  sink = fn;
}

export const lockProbeOn = (): boolean => sink !== null;

/** Run `fn` with a label for the write locks it takes (a no-op without a sink). */
export function withLockLabel<T>(label: string, fn: () => T): T {
  return sink ? labels.run(label, fn) : fn();
}

/** `lockOrg` reports the lock it was granted after waiting `waitMs` (first grant of a transaction counts). */
export function lockGranted(tx: Tx, waitMs: number): void {
  if (!sink || held.has(tx)) return;
  held.set(tx, { at: performance.now(), waitMs, label: labels.getStore() ?? "-" });
}

/** The database layer reports the end of a transaction (after COMMIT or ROLLBACK). */
export function txEnded(tx: Tx | null, committed: boolean): void {
  if (!sink || !tx) return;
  const h = held.get(tx);
  if (!h) return;
  held.delete(tx);
  try {
    sink({ label: h.label, waitMs: h.waitMs, holdMs: performance.now() - h.at, committed });
  } catch {
    // a measurement must never break a write
  }
}
